// The file-based task/mission ledger (DESIGN.md §6: "no DB - ledger is
// files under .agent/"). All writes atomic; all reads schema-validated
// (DESIGN.md §3 "the CLI validates against them", §6 "State machine rules
// enforced, not advisory"). Implements leases, budget enforcement, and
// dependency-driven readiness (spec §6.3 Lifecycle).
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { Mission, ReviewVerdict, Task, TaskState, TransitionRecord } from "./types";
import * as P from "./paths";
import { ensureDir, readYaml, writeYamlAtomic, appendJsonlAtomic, readJsonl, readJsonIfExists, writeJsonAtomic, listDirs, listFiles, nowIso } from "./fsutil";
import { validateOrThrow, collectProblems } from "./validate";
import { assertLegalTransition, isDependencySatisfied, makeTransitionRecord } from "./states";
import { requiredReviewLenses } from "./router";

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

// ---------------------------------------------------------------- missions

export function listMissionIds(repo: string): string[] {
  return listDirs(P.missionsRootDir(repo)).filter((id) => fs.existsSync(P.missionFile(repo, id)));
}

export function missionExists(repo: string, missionId: string): boolean {
  return fs.existsSync(P.missionFile(repo, missionId));
}

export function readMission(repo: string, missionId: string): Mission {
  const filePath = P.missionFile(repo, missionId);
  if (!fs.existsSync(filePath)) {
    throw new LedgerError(`Mission '${missionId}' not found (expected ${filePath}).`);
  }
  const data = readYaml<Mission>(filePath);
  validateOrThrow("mission", data, filePath);
  return data;
}

export function writeMission(repo: string, mission: Mission): void {
  const filePath = P.missionFile(repo, mission.id);
  validateOrThrow("mission", mission, filePath);
  ensureDir(P.missionArtifactsDir(repo, mission.id));
  ensureDir(P.missionTasksDir(repo, mission.id));
  writeYamlAtomic(filePath, mission);
}

/**
 * Child-mission budget rule (DESIGN.md §3: "Child budgets draw down parent
 * remaining budget"). A no-op for a root mission (parent_mission: null).
 * For a child mission: the named parent must exist, and the child's
 * budget.dollars must not exceed the parent's budget.dollars minus what
 * every other existing child of that same parent has already committed —
 * refused with a clear reason otherwise (`agent mission create`).
 */
export function assertChildMissionBudget(repo: string, mission: Mission): void {
  if (mission.parent_mission === null) return;
  const parentId = mission.parent_mission;
  if (!missionExists(repo, parentId)) {
    throw new LedgerError(
      `Mission '${mission.id}' names parent_mission '${parentId}', but no such mission exists ` +
        `(DESIGN.md §3: child budgets draw down the parent's remaining budget — the parent must exist first).`
    );
  }
  const parent = readMission(repo, parentId);
  const siblings = listMissionIds(repo)
    .filter((id) => id !== mission.id)
    .map((id) => readMission(repo, id))
    .filter((m) => m.parent_mission === parentId);
  const committed = siblings.reduce((sum, m) => sum + m.budget.dollars, 0);
  const remaining = Math.round((parent.budget.dollars - committed) * 100) / 100;
  if (mission.budget.dollars > remaining) {
    throw new LedgerError(
      `Mission '${mission.id}' requests budget.dollars=${mission.budget.dollars}, but parent '${parent.id}' has only ` +
        `${remaining} remaining (parent budget.dollars=${parent.budget.dollars}, already committed to ` +
        `${siblings.length} existing child mission(s): ${committed}) — refused (DESIGN.md §3: child budgets draw down ` +
        `the parent's remaining budget).`
    );
  }
}

// -------------------------------------------------------------------- tasks

interface TaskLocation {
  missionId: string;
  filePath: string;
}

function locateTask(repo: string, taskId: string): TaskLocation | undefined {
  for (const missionId of listMissionIds(repo)) {
    const filePath = P.taskFile(repo, missionId, taskId);
    if (fs.existsSync(filePath)) return { missionId, filePath };
  }
  // Fall back to scanning in case a task file's basename does not match its
  // id (defensive; the CLI itself always keeps them in sync).
  for (const missionId of listMissionIds(repo)) {
    const dir = P.missionTasksDir(repo, missionId);
    for (const name of listFiles(dir, ".yaml")) {
      const filePath = path.join(dir, name);
      const data = readYaml<Task>(filePath);
      if (data.id === taskId) return { missionId, filePath };
    }
  }
  return undefined;
}

export function readTask(repo: string, taskId: string): Task {
  const loc = locateTask(repo, taskId);
  if (!loc) throw new LedgerError(`Task '${taskId}' not found in ${P.missionsRootDir(repo)}.`);
  const data = readYaml<Task>(loc.filePath);
  validateOrThrow("task", data, loc.filePath);
  return data;
}

export function taskExists(repo: string, taskId: string): boolean {
  return locateTask(repo, taskId) !== undefined;
}

export function writeTask(repo: string, missionId: string, task: Task): void {
  const filePath = P.taskFile(repo, missionId, task.id);
  validateOrThrow("task", task, filePath);
  writeYamlAtomic(filePath, task);
}

export interface ListTasksFilter {
  state?: TaskState;
  mission?: string;
}

export function listTasks(repo: string, filter: ListTasksFilter = {}): Task[] {
  const missionIds = filter.mission ? [filter.mission] : listMissionIds(repo);
  const tasks: Task[] = [];
  for (const missionId of missionIds) {
    const dir = P.missionTasksDir(repo, missionId);
    for (const name of listFiles(dir, ".yaml")) {
      const filePath = path.join(dir, name);
      const data = readYaml<Task>(filePath);
      validateOrThrow("task", data, filePath);
      if (!filter.state || data.status === filter.state) tasks.push(data);
    }
  }
  tasks.sort((a, b) => a.id.localeCompare(b.id));
  return tasks;
}

// -------------------------------------------------------------- transitions

export function appendTransition(repo: string, taskId: string, record: TransitionRecord): void {
  ensureDir(P.runDir(repo, taskId));
  appendJsonlAtomic(P.transitionsFile(repo, taskId), record);
}

export function readTransitions(repo: string, taskId: string): TransitionRecord[] {
  return readJsonl<TransitionRecord>(P.transitionsFile(repo, taskId));
}

/**
 * Move `task` to `to`, enforcing the state machine, persisting the task,
 * and appending the transition record. Callers apply any additional field
 * mutations (lease, attempt, blocked_reason) to `task` before calling.
 */
function commitTransition(repo: string, missionId: string, task: Task, to: TaskState, actor: string, reason: string): Task {
  assertLegalTransition(task, to);
  const from = task.status;
  task.status = to;
  writeTask(repo, missionId, task);
  appendTransition(repo, task.id, makeTransitionRecord(from, to, actor, reason));
  // A task landing on a dependency-satisfying state (DONE, or MERGED which
  // implies DONE, spec §6.3) may unblock sibling tasks in the same mission;
  // recompute their readiness immediately rather than waiting for a
  // separate call (DESIGN.md §3 "dependency-driven readiness"). READY is
  // never itself dependency-satisfying, so this cannot recurse.
  if (isDependencySatisfied(to)) {
    refreshReadiness(repo, missionId);
  }
  return task;
}

// ------------------------------------------------------------------ leases

const DEFAULT_TTL_MINUTES = 60;

export function claimTask(repo: string, taskId: string, owner: string, ttlMinutes = DEFAULT_TTL_MINUTES): Task {
  const loc = locateTask(repo, taskId);
  if (!loc) throw new LedgerError(`Task '${taskId}' not found.`);
  const task = readTask(repo, taskId);

  if (task.status !== "READY") {
    if (task.lease && new Date(task.lease.expires_at).getTime() > Date.now()) {
      throw new LedgerError(
        `Task '${taskId}' is already claimed by '${task.lease.owner}' (lease expires ${task.lease.expires_at}). ` +
          `Use 'agent task reclaim' once the lease expires, or wait.`
      );
    }
    assertLegalTransition(task, "ASSIGNED"); // will throw a descriptive IllegalTransitionError
  }

  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  task.lease = { owner, expires_at: expiresAt };
  return commitTransition(repo, loc.missionId, task, "ASSIGNED", owner, `claimed by ${owner}, ttl ${ttlMinutes}m`);
}

export function startTask(repo: string, taskId: string, actor: string): Task {
  const loc = locateTask(repo, taskId);
  if (!loc) throw new LedgerError(`Task '${taskId}' not found.`);
  const task = readTask(repo, taskId);
  return commitTransition(repo, loc.missionId, task, "RUNNING", actor, "work started");
}

export function submitTask(repo: string, taskId: string, actor: string): Task {
  const loc = locateTask(repo, taskId);
  if (!loc) throw new LedgerError(`Task '${taskId}' not found.`);
  const task = readTask(repo, taskId);
  const to: TaskState = task.type === "implementation" ? "VERIFYING" : "GATING";
  return commitTransition(repo, loc.missionId, task, to, actor, "candidate submitted");
}

export interface GateOptions {
  gate: "verification" | "review";
  result: "pass" | "fail";
  actor: string;
  evidencePath?: string;
}

export class EvidenceIncompleteError extends LedgerError {
  constructor(taskId: string, problems: string[]) {
    super(
      [`PASS without evidence is FAIL (spec F.7): task '${taskId}' gate refused, evidence incomplete:`, ...problems.map((p) => `  - ${p}`)].join(
        "\n"
      )
    );
    this.name = "EvidenceIncompleteError";
  }
}

/** Layer 1 architecture invariant violations block a gate the same way incomplete evidence does (spec §10.3: "A functionally correct implementation can fail this gate"). */
export class ArchViolationsError extends LedgerError {
  constructor(taskId: string, problems: string[]) {
    super(
      [
        `Architecture check failed (spec §10.3, Layer 1): task '${taskId}' gate refused, invariant violations found:`,
        ...problems.map((p) => `  - ${p}`),
      ].join("\n")
    );
    this.name = "ArchViolationsError";
  }
}

// ---------------------------------------------------------- four-gate result

/** `git rev-parse HEAD` of the target repo, or "UNKNOWN" when it is not a git repository (or has no commits yet) — result.schema.json's `commit` is a plain string, so this sentinel keeps it always resolvable rather than requiring git. */
function resolveCommit(repo: string): string {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }).trim();
    return sha.length > 0 ? sha : "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}

/**
 * Writes .agent/runs/<TASK-ID>/result.json (schemas/result.schema.json,
 * spec Appendix B / F.9) the moment an implementation task's review gate
 * passes (REVIEWING -> MERGE_READY). By this point `checkEvidence` has
 * already refused the gate if any risk-required review lens is missing or
 * FAIL, so every required lens here is known PASS; a lens not required by
 * policies/risk.yaml for this task's risk is SKIPPED, never guessed.
 */
function writeFourGateResult(repo: string, task: Task, actor: string): void {
  const lenses = requiredReviewLenses(repo, task.risk);
  const lensGate = (lens: string): "PASS" | "SKIPPED" => {
    if (!lenses.includes(lens)) return "SKIPPED";
    const verdict = readJsonIfExists<ReviewVerdict>(P.reviewVerdictFile(repo, task.id, lens));
    return verdict?.verdict === "PASS" ? "PASS" : "SKIPPED";
  };
  const result = {
    task: task.id,
    commit: resolveCommit(repo),
    // Functional gate: this is a review-gate pass, which is only reachable
    // once the verification gate already passed (VERIFYING -> REVIEWING,
    // spec §6.3) — functional is therefore PASS by construction here.
    functional: "PASS" as const,
    specification: lensGate("spec"),
    architecture: lensGate("architecture"),
    // Evolutionary gate maps to the 'quality' review lens (spec §10 four
    // gates: Functional, Specification, Architectural, Evolutionary).
    evolutionary: lensGate("quality"),
    verifier: actor,
  };
  const filePath = P.resultFile(repo, task.id);
  validateOrThrow("result", result, filePath);
  writeJsonAtomic(filePath, result);
}

/** Problems with .agent/runs/<TASK-ID>/result.json for `task done` (empty = complete). Missing or schema-invalid is refused per spec F.9. */
function checkFourGateResult(repo: string, task: Task): string[] {
  const filePath = P.resultFile(repo, task.id);
  if (!fs.existsSync(filePath)) {
    return [`missing ${filePath}`];
  }
  const data = readJsonIfExists<Record<string, unknown>>(filePath);
  if (!data) {
    return [`${filePath} is not valid JSON`];
  }
  const problems = collectProblems("result", data).map((p) => `${filePath} ${p}`);
  if (data.task !== task.id) {
    problems.push(`${filePath}: task field '${String(data.task)}' does not match '${task.id}'`);
  }
  return problems;
}

export class FourGateResultError extends LedgerError {
  constructor(taskId: string, problems: string[]) {
    super(
      [
        `Task '${taskId}' cannot reach MERGED: four-gate result required before merge (spec F.9):`,
        ...problems.map((p) => `  - ${p}`),
      ].join("\n")
    );
    this.name = "FourGateResultError";
  }
}

/**
 * Apply a gate result. `checkEvidence` is injected by evidence.ts to
 * avoid a circular import; it must return a list of problem strings
 * (empty = complete) when result === 'pass' and evidence is incomplete for
 * the given gate.
 *
 * `checkArch` (optional, injected by archcheck.ts via cli.ts, again to
 * avoid a circular import) is consulted only for `review` gates on
 * implementation tasks passing — the same point spec §10.3 places the
 * architecture gate. Omitted by direct ledger callers (and by existing
 * tests) it is a no-op, so this is backward compatible: only `agent task
 * gate` wires the real check.
 */
export function gateTask(
  repo: string,
  taskId: string,
  opts: GateOptions,
  checkEvidence: (repo: string, task: Task, gate: "verification" | "review") => string[],
  checkArch?: (repo: string, task: Task) => string[]
): Task {
  const loc = locateTask(repo, taskId);
  if (!loc) throw new LedgerError(`Task '${taskId}' not found.`);
  const task = readTask(repo, taskId);

  const isImpl = task.type === "implementation";
  const fromExpected: TaskState = isImpl ? (opts.gate === "verification" ? "VERIFYING" : "REVIEWING") : "GATING";
  if (task.status !== fromExpected) {
    throw new LedgerError(
      `Task '${taskId}' cannot be gated on '${opts.gate}': current status is ${task.status}, expected ${fromExpected}.`
    );
  }

  if (opts.result === "pass") {
    const problems = checkEvidence(repo, task, opts.gate);
    if (problems.length > 0) {
      throw new EvidenceIncompleteError(taskId, problems);
    }
    if (opts.gate === "review" && isImpl && checkArch) {
      const archProblems = checkArch(repo, task);
      if (archProblems.length > 0) {
        throw new ArchViolationsError(taskId, archProblems);
      }
    }
    const to: TaskState = isImpl ? (opts.gate === "verification" ? "REVIEWING" : "MERGE_READY") : "DONE";
    if (isImpl && opts.gate === "review") {
      // REVIEWING -> MERGE_READY: the four-gate summary (spec Appendix B,
      // F.9) is written now, before the transition commits, so a failure
      // here refuses the gate rather than leaving a half-applied state.
      writeFourGateResult(repo, task, opts.actor);
    }
    return commitTransition(repo, loc.missionId, task, to, opts.actor, `gate ${opts.gate} passed`);
  }

  // result === 'fail': attempt increments, budget enforced (DESIGN.md §6:
  // "budget.attempts exceeded ⇒ task → BLOCKED with reason budget-exhausted")
  const nextAttempt = (task.attempt ?? 0) + 1;
  task.attempt = nextAttempt;
  if (nextAttempt > task.budget.attempts) {
    task.blocked_reason = "budget-exhausted";
    task.lease = null;
    return commitTransition(
      repo,
      loc.missionId,
      task,
      "BLOCKED",
      opts.actor,
      `budget-exhausted: attempt ${nextAttempt} exceeds budget.attempts=${task.budget.attempts} (gate ${opts.gate} failed)`
    );
  }
  task.lease = null;
  return commitTransition(repo, loc.missionId, task, "REPAIR", opts.actor, `gate ${opts.gate} failed (attempt ${nextAttempt})`);
}

export function doneTask(repo: string, taskId: string, actor: string): Task {
  const loc = locateTask(repo, taskId);
  if (!loc) throw new LedgerError(`Task '${taskId}' not found.`);
  const task = readTask(repo, taskId);
  if (task.type !== "implementation" || task.status !== "MERGE_READY") {
    throw new LedgerError(
      `Task '${taskId}' is not awaiting 'done' (status=${task.status}, type=${task.type}). ` +
        `Implementation tasks reach MERGED (their DONE point) via 'task done' only once MERGE_READY (after both gates pass). ` +
        `Non-implementation tasks reach DONE automatically via 'task gate --result pass'.`
    );
  }
  const resultProblems = checkFourGateResult(repo, task);
  if (resultProblems.length > 0) {
    throw new FourGateResultError(taskId, resultProblems);
  }
  return commitTransition(repo, loc.missionId, task, "MERGED", actor, "merged");
}

export function failTask(repo: string, taskId: string, reason: string, actor: string): Task {
  const loc = locateTask(repo, taskId);
  if (!loc) throw new LedgerError(`Task '${taskId}' not found.`);
  const task = readTask(repo, taskId);
  task.blocked_reason = reason;
  task.lease = null;
  return commitTransition(repo, loc.missionId, task, "BLOCKED", actor, reason);
}

// -------------------------------------------------------------- reclaiming

// REPAIR is deliberately absent: every path into REPAIR (gateTask's fail
// branch) already nulls the lease, and REPAIR has no legal edge back to
// ASSIGNED (states.ts EDGES), so `agent task claim` can never re-lease a
// REPAIR task regardless of this set — including it here would imply a
// safety net that does not exist. A task stuck in REPAIR is recovered by
// a human via `agent status`'s exception-first `stuck_in_repair` surface
// (status.ts), not by lease reclamation.
const RECLAIMABLE_STATES: ReadonlySet<TaskState> = new Set(["ASSIGNED", "RUNNING", "VERIFYING", "REVIEWING"]);

export interface ReclaimResult {
  taskId: string;
  from: TaskState;
  previousOwner: string;
}

/** Expire dead leases: any reclaimable task with lease.expires_at in the past goes back to READY. */
export function reclaimExpired(repo: string): ReclaimResult[] {
  const results: ReclaimResult[] = [];
  const now = Date.now();
  for (const task of listTasks(repo)) {
    if (!RECLAIMABLE_STATES.has(task.status)) continue;
    if (!task.lease) continue;
    if (new Date(task.lease.expires_at).getTime() > now) continue;
    const loc = locateTask(repo, task.id);
    if (!loc) continue;
    const previousOwner = task.lease.owner;
    const from = task.status;
    task.lease = null;
    commitTransition(repo, loc.missionId, task, "READY", "system", `lease expired (was held by ${previousOwner})`);
    results.push({ taskId: task.id, from, previousOwner });
  }
  return results;
}

// ------------------------------------------------------------- readiness

export interface ReadinessResult {
  taskId: string;
}

/**
 * BLOCKED -> READY only when every dependency is satisfied (DONE, or
 * MERGED/DEPLOYED/PRODUCTION_VERIFIED which imply DONE, spec §6.3). Skips
 * tasks BLOCKED for a reason other than unmet dependencies
 * (budget-exhausted, or an operator `task fail`) — those need a human,
 * per the exception-first principle (spec §14.5), not silent recovery.
 */
export function refreshReadiness(repo: string, missionId?: string): ReadinessResult[] {
  const results: ReadinessResult[] = [];
  const tasks = listTasks(repo, missionId ? { mission: missionId } : {});
  // Build a full lookup across the whole repo since dependencies could in
  // principle reference tasks outside the filtered mission set.
  const allTasks = missionId ? listTasks(repo) : tasks;
  const statusById = new Map(allTasks.map((t) => [t.id, t.status] as const));

  for (const task of tasks) {
    if (task.status !== "BLOCKED") continue;
    if (task.blocked_reason && task.blocked_reason !== "dependencies-not-satisfied") continue;
    const depsSatisfied = task.dependencies.every((depId) => {
      const st = statusById.get(depId);
      return st !== undefined && isDependencySatisfied(st);
    });
    if (!depsSatisfied) continue;
    const loc = locateTask(repo, task.id);
    if (!loc) continue;
    task.blocked_reason = undefined;
    commitTransition(repo, loc.missionId, task, "READY", "system", "dependencies satisfied");
    results.push({ taskId: task.id });
  }
  return results;
}
