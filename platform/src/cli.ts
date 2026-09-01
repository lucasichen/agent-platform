#!/usr/bin/env node
// `agent` — control plane CLI (spec F.5, DESIGN.md §6). Commander wiring
// only; all behavior lives in the sibling modules.
import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";

import type { Mission, Task, TaskState } from "./types";
import { readYaml, readJson, ensureDir, writeJsonAtomic } from "./fsutil";
import { validateOrThrow, collectProblems, inferSchemaName } from "./validate";
import * as ledger from "./ledger";
import { LedgerError } from "./ledger";
import { instantiateWorkflow } from "./compiler";
import { resolveRoute } from "./router";
import { checkEvidence, scaffoldRunDir } from "./evidence";
import { initRepo } from "./scaffold";
import * as memory from "./memory";
import { buildStatusReport, renderStatusText } from "./status";
import * as P from "./paths";
import type { BindingsPolicy, Harness, ResolvedRoleBindings } from "./bindings";
import { resolveRoleBindings, bindingsSkillPathProblems } from "./bindings";
import { installSkills } from "./skills";
import { ensureWorktree } from "./worktree";
import { runArchCheck, formatArchViolation, archCheckProblemsForGate, type ArchCheckResult } from "./archcheck";
import { createEvalFromRetro, listEvalCases } from "./evals";

const program = new Command();
program
  .name("agent")
  .description("Control plane CLI for the agent-platform (spec F.5 / DESIGN.md §6).")
  .option("--repo <path>", "target repository path", process.cwd())
  .exitOverride();

function getRepo(): string {
  return path.resolve(String(program.opts().repo));
}

function guarded<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  return (...args: A) => {
    try {
      fn(...args);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(message);
      process.exitCode = 1;
    }
  };
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function actorFor(repo: string, taskId: string): string {
  const task = ledger.readTask(repo, taskId);
  return task.lease?.owner ?? "cli-operator";
}

// ---------------------------------------------------------- bindings/skills

/** Text-mode printing for `agent task claim`/`start` (docs/skills-design.md §5). No-op if bindings.yaml is absent. */
function printBindingsText(rb: ResolvedRoleBindings | undefined): void {
  if (!rb) return;
  if (rb.startup_skills.length > 0) {
    console.log("Required before work begins:");
    for (const s of rb.startup_skills) console.log(`  - ${s}`);
  }
  if (rb.skills.length > 0) {
    console.log(`Recommended skills (${rb.harness}):`);
    for (const s of rb.skills) console.log(`  - ${s}`);
  }
}

// -------------------------------------------------------------------- memory

/** payload.areas, tolerating non-implementation payloads that lack it (docs/memory.md §3 Recall). */
function taskAreas(task: Task): string[] {
  const payload = task.payload as Record<string, unknown> | undefined;
  const areas = payload?.areas;
  if (!Array.isArray(areas)) return [];
  return areas.filter((a): a is string => typeof a === "string");
}

/** Text-mode printing for `agent task claim`/`start` recall (docs/memory.md §3). No-op if .agent/memory is absent or nothing matched. */
function printMemoryRecallText(recall: memory.MemoryRecall): void {
  const total = (recall.index ? 1 : 0) + recall.topics.length + recall.discoveries.length + recall.incidents.length;
  if (total === 0) return;
  console.log("Related memory:");
  if (recall.index) console.log(`  - ${recall.index}`);
  for (const t of recall.topics) console.log(`  - ${t}`);
  for (const d of recall.discoveries) console.log(`  - ${d}`);
  for (const i of recall.incidents) console.log(`  - ${i}`);
}

function printMaterializeResult(result: memory.MaterializeResult): void {
  console.log(
    `memory propose ${result.taskId}: ${result.created.length} proposal(s) created ` +
      `(of ${result.totalLines} candidate line(s), ${result.alreadyMaterialized} already materialized)`
  );
  for (const f of result.created) console.log(`  created: ${f}`);
  if (result.problems.length > 0) {
    console.log(`  ${result.problems.length} malformed candidate line(s) (reported, not fatal):`);
    for (const p of result.problems) console.log(`    line ${p.line}: ${p.message}`);
  }
}

// ------------------------------------------------------------- worktrees

const WORKTREE_HINT_STATES: ReadonlySet<TaskState> = new Set(["DONE", "MERGED", "DEPLOYED", "PRODUCTION_VERIFIED", "BLOCKED", "READY"]);

/**
 * `agent task reclaim` and terminal states leave the worktree in place but
 * print a cleanup hint (docs/skills-design.md §5) — never delete work.
 * workspace is read from task.payload.workspace (schemas/task.schema.json
 * is out of this build's scope; payload is the schema's designated
 * open-ended extension point, so the worktree path is recorded there
 * rather than as a new top-level task field).
 */
function printWorktreeHint(task: Task): void {
  const workspace = (task.payload as Record<string, unknown> | undefined)?.workspace;
  if (typeof workspace !== "string" || workspace.length === 0) return;
  if (!WORKTREE_HINT_STATES.has(task.status)) return;
  console.log(`  worktree left in place: ${workspace} (clean up manually: git worktree remove ${workspace})`);
}

// ------------------------------------------------------------------- init

program
  .command("init")
  .description("install .agent/ scaffold + policies into --repo (spec Appendix A)")
  .action(
    guarded(() => {
      const repo = getRepo();
      const result = initRepo(repo);
      console.log(`agent init: ${result.agentDir}`);
      console.log(`  scaffold: ${result.scaffoldCreated.length} created, ${result.scaffoldSkipped.length} skipped`);
      for (const f of result.scaffoldSkipped) console.log(`    skipped (already exists): ${f}`);
      console.log(`  policies: ${result.policiesCreated.length} created, ${result.policiesSkipped.length} skipped`);
      for (const f of result.policiesSkipped) console.log(`    skipped (already exists): ${f}`);
      console.log(`  workflows: ${result.workflowsCreated.length} created, ${result.workflowsSkipped.length} skipped`);
      for (const f of result.workflowsSkipped) console.log(`    skipped (already exists): ${f}`);
    })
  );

// --------------------------------------------------------------- validate

function defaultValidationTargets(repo: string): string[] {
  const targets: string[] = [];
  const repoYaml = path.join(P.agentDir(repo), "repo.yaml");
  if (fs.existsSync(repoYaml)) targets.push(repoYaml);

  const policiesDir = P.policiesDirIn(repo);
  if (fs.existsSync(policiesDir)) {
    for (const name of fs.readdirSync(policiesDir)) {
      if (name.endsWith(".yaml") && inferSchemaName(path.join(policiesDir, name))) {
        targets.push(path.join(policiesDir, name));
      }
    }
  }

  const workflowsDir = P.workflowsDirIn(repo);
  if (fs.existsSync(workflowsDir)) {
    for (const name of fs.readdirSync(workflowsDir)) {
      if (name.endsWith(".yaml")) targets.push(path.join(workflowsDir, name));
    }
  }

  for (const missionId of ledger.listMissionIds(repo)) {
    targets.push(P.missionFile(repo, missionId));
    const wi = P.workflowInstanceFile(repo, missionId);
    if (fs.existsSync(wi)) targets.push(wi);
    const tasksDir = P.missionTasksDir(repo, missionId);
    if (fs.existsSync(tasksDir)) {
      for (const name of fs.readdirSync(tasksDir)) {
        if (name.endsWith(".yaml")) targets.push(path.join(tasksDir, name));
      }
    }
  }

  // .agent/evals/<category>/<ID>.yaml (spec §13.5).
  const evalsDir = P.evalsDir(repo);
  if (fs.existsSync(evalsDir)) {
    for (const category of fs.readdirSync(evalsDir, { withFileTypes: true })) {
      if (!category.isDirectory()) continue;
      const categoryDir = path.join(evalsDir, category.name);
      for (const name of fs.readdirSync(categoryDir)) {
        if (name.endsWith(".yaml")) targets.push(path.join(categoryDir, name));
      }
    }
  }

  // .agent/runs/<TASK-ID>/{retrospective.json, cost.json, result.json,
  // verification/result.json, reviews/*.json} (spec Appendix B). Every
  // other file under a run dir (transcript.jsonl, decisions.tsv,
  // diff.patch, transitions.jsonl, task.yaml) has no schema of its own.
  const runsDir = P.runsRootDir(repo);
  if (fs.existsSync(runsDir)) {
    for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const taskId = entry.name;
      const retro = P.retrospectiveFile(repo, taskId);
      if (fs.existsSync(retro)) targets.push(retro);
      const cost = P.costFile(repo, taskId);
      if (fs.existsSync(cost)) targets.push(cost);
      const result = P.resultFile(repo, taskId);
      if (fs.existsSync(result)) targets.push(result);
      const verificationResult = P.verificationResultFile(repo, taskId);
      if (fs.existsSync(verificationResult)) targets.push(verificationResult);
      const reviewsDir = path.join(P.runDir(repo, taskId), "reviews");
      if (fs.existsSync(reviewsDir)) {
        for (const name of fs.readdirSync(reviewsDir)) {
          if (name.endsWith(".json")) targets.push(path.join(reviewsDir, name));
        }
      }
    }
  }

  return targets;
}

program
  .command("validate")
  .description("schema-validate missions/tasks/policies/templates (defaults to scanning --repo/.agent)")
  .argument("[paths...]", "explicit files to validate")
  .action(
    guarded((paths: string[]) => {
      const repo = getRepo();
      const targets = paths.length > 0 ? paths.map((p) => path.resolve(p)) : defaultValidationTargets(repo);
      // Memory entries (proposals + active + rejected + expired) are always
      // checked, regardless of explicit --paths args: they are markdown
      // files with embedded frontmatter blocks, not directly nameable
      // targets under the schema-per-file convention above (docs/memory.md
      // §3, spec §12.4).
      const memoryReport = memory.validateMemoryEntries(repo);
      if (targets.length === 0 && memoryReport.items.length === 0) {
        console.log("No files to validate.");
        return;
      }
      let ok = true;
      for (const target of targets) {
        const schemaName = inferSchemaName(target);
        if (!schemaName) {
          console.log(`SKIP  ${target}  (no known schema convention)`);
          continue;
        }
        try {
          const data = target.endsWith(".json") ? readJson(target) : readYaml(target);
          const problems = collectProblems(schemaName, data);
          if (schemaName === "bindings-policy" && problems.length === 0) {
            problems.push(...bindingsSkillPathProblems(repo, data as BindingsPolicy));
          }
          if (problems.length === 0) {
            console.log(`OK    ${target}  [${schemaName}]`);
          } else {
            ok = false;
            console.log(`FAIL  ${target}  [${schemaName}]`);
            for (const p of problems) console.log(`        ${p}`);
          }
        } catch (e) {
          ok = false;
          const message = e instanceof Error ? e.message : String(e);
          console.log(`FAIL  ${target}  [${schemaName}]`);
          console.log(`        ${message}`);
        }
      }
      for (const item of memoryReport.items) {
        if (item.schemaProblems.length > 0) {
          ok = false;
          console.log(`FAIL  ${item.file}  [memory-entry ${item.id}]`);
          for (const p of item.schemaProblems) console.log(`        ${p}`);
        } else if (item.flagged) {
          // Never fails validate on its own (docs/memory.md §3 "never
          // auto-delete") — flagged and re-verified, not an error.
          console.log(`FLAG  ${item.file}  [memory-entry ${item.id}]  needs-reverification`);
          for (const r of item.flagReasons ?? []) console.log(`        ${r}`);
        } else {
          console.log(`OK    ${item.file}  [memory-entry ${item.id}]`);
        }
      }
      if (!ok) process.exitCode = 1;
    })
  );

// ---------------------------------------------------------------- mission

const missionCmd = program.command("mission").description("mission commands (spec §6.0)");

missionCmd
  .command("create")
  .description("validate + register a mission.yaml")
  .requiredOption("--file <path>", "path to mission.yaml")
  .action(
    guarded((opts: { file: string }) => {
      const repo = getRepo();
      const filePath = path.resolve(opts.file);
      const mission = readYaml<Mission>(filePath);
      validateOrThrow("mission", mission, filePath);
      if (ledger.missionExists(repo, mission.id)) {
        throw new LedgerError(`Mission '${mission.id}' already exists. Edit it directly under ${P.missionDir(repo, mission.id)}.`);
      }
      ledger.assertChildMissionBudget(repo, mission);
      ledger.writeMission(repo, mission);
      console.log(`Registered mission '${mission.id}' at ${P.missionFile(repo, mission.id)}`);
    })
  );

missionCmd
  .command("list")
  .description("list missions")
  .option("--json", "machine-readable output")
  .action(
    guarded((opts: { json?: boolean }) => {
      const repo = getRepo();
      const missions = ledger.listMissionIds(repo).map((id) => ledger.readMission(repo, id));
      if (opts.json) {
        printJson(missions);
        return;
      }
      if (missions.length === 0) {
        console.log("No missions.");
        return;
      }
      for (const m of missions) {
        console.log(`${m.id}  [${m.status}]  ${m.goal.trim().slice(0, 72)}`);
      }
    })
  );

missionCmd
  .command("status")
  .description("mission status: task state breakdown")
  .argument("<id>", "mission id")
  .option("--json", "machine-readable output")
  .action(
    guarded((id: string, opts: { json?: boolean }) => {
      const repo = getRepo();
      const mission = ledger.readMission(repo, id);
      const tasks = ledger.listTasks(repo, { mission: id });
      const byState: Record<string, number> = {};
      for (const t of tasks) byState[t.status] = (byState[t.status] ?? 0) + 1;
      const report = { mission, task_count: tasks.length, by_state: byState };
      if (opts.json) {
        printJson(report);
        return;
      }
      console.log(`${mission.id}  [${mission.status}]`);
      console.log(`goal: ${mission.goal.trim()}`);
      console.log(`tasks: ${tasks.length}`);
      for (const [state, count] of Object.entries(byState)) console.log(`  ${state.padEnd(20)} ${count}`);
    })
  );

// --------------------------------------------------------------- workflow

const workflowCmd = program.command("workflow").description("workflow compiler commands (spec F.0)");

workflowCmd
  .command("instantiate")
  .description("compile a mission's workflow template into a workflow-instance + task stubs")
  .requiredOption("--mission <id>", "mission id")
  .action(
    guarded((opts: { mission: string }) => {
      const repo = getRepo();
      const result = instantiateWorkflow(repo, opts.mission);
      console.log(
        `Instantiated ${result.workflowInstance.template}@${result.workflowInstance.version} for mission '${opts.mission}' from ${result.templateSource}`
      );
      console.log(`Wrote ${P.workflowInstanceFile(repo, opts.mission)}`);
      console.log(`Created ${result.tasks.length} task(s):`);
      for (const t of result.tasks) {
        console.log(`  ${t.id}  [${t.status}]  role=${t.role}  type=${t.type}`);
      }
      if (result.notes.length > 0) {
        console.log(`${result.notes.length} note(s):`);
        for (const n of result.notes) console.log(`  - ${n}`);
      }
    })
  );

// -------------------------------------------------------------------- task

const taskCmd = program.command("task").description("task commands (spec §6.1, §6.3)");

taskCmd
  .command("list")
  .option("--state <state>", "filter by lifecycle state")
  .option("--mission <id>", "filter by mission")
  .option("--json", "machine-readable output")
  .action(
    guarded((opts: { state?: TaskState; mission?: string; json?: boolean }) => {
      const repo = getRepo();
      const tasks = ledger.listTasks(repo, { state: opts.state, mission: opts.mission });
      if (opts.json) {
        printJson(tasks);
        return;
      }
      if (tasks.length === 0) {
        console.log("No tasks.");
        return;
      }
      for (const t of tasks) {
        console.log(`${t.id}  [${t.status}]  mission=${t.mission}  role=${t.role}  risk=${t.risk}  attempt=${t.attempt ?? 0}/${t.budget.attempts}`);
      }
    })
  );

taskCmd
  .command("show")
  .argument("<id>")
  .option("--json", "machine-readable output")
  .action(
    guarded((id: string, opts: { json?: boolean }) => {
      const repo = getRepo();
      const task = ledger.readTask(repo, id);
      if (opts.json) {
        printJson(task);
        return;
      }
      console.log(JSON.stringify(task, null, 2));
    })
  );

taskCmd
  .command("claim")
  .argument("<id>")
  .requiredOption("--agent <name>", "claiming agent name")
  .option("--ttl <minutes>", "lease TTL in minutes", "60")
  .option("--worktree", "create/reuse a git worktree at .worktrees/<task-id> on branch task/<task-id>", false)
  .option("--json", "machine-readable output", false)
  .action(
    guarded((id: string, opts: { agent: string; ttl: string; worktree?: boolean; json?: boolean }) => {
      const repo = getRepo();
      const ttlMinutes = Number(opts.ttl);
      if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0) {
        throw new Error(`--ttl must be a positive number of minutes, got '${opts.ttl}'`);
      }
      let task = ledger.claimTask(repo, id, opts.agent, ttlMinutes);
      // "scaffolded at claim time" (spec Appendix B / F.7): idempotent —
      // scaffoldRunDir never overwrites a file that already exists, so a
      // re-claim (after a lease reclaim) never clobbers evidence collected
      // on a prior attempt.
      scaffoldRunDir(repo, task);

      let workspace: string | undefined;
      if (opts.worktree) {
        const wt = ensureWorktree(repo, id);
        workspace = wt.workspace;
        const payload = { ...(task.payload as Record<string, unknown>), workspace };
        task = { ...task, payload };
        ledger.writeTask(repo, task.mission, task);
      }

      const rb = resolveRoleBindings(repo, task.role);
      const memoryRecall = memory.recallForAreas(repo, taskAreas(task));

      if (opts.json) {
        const out: Record<string, unknown> = { ...task };
        if (rb) {
          out.startup_skills = rb.startup_skills;
          out.skills = rb.skills;
        }
        out.memory = memoryRecall;
        printJson(out);
        return;
      }

      console.log(`Claimed ${task.id} for '${opts.agent}', lease expires ${task.lease?.expires_at}`);
      if (workspace) console.log(`Worktree: ${workspace}`);
      printBindingsText(rb);
      printMemoryRecallText(memoryRecall);
    })
  );

taskCmd
  .command("start")
  .argument("<id>")
  .option("--json", "machine-readable output", false)
  .action(
    guarded((id: string, opts: { json?: boolean }) => {
      const repo = getRepo();
      const actor = actorFor(repo, id);
      const task = ledger.startTask(repo, id, actor);
      const rb = resolveRoleBindings(repo, task.role);
      const memoryRecall = memory.recallForAreas(repo, taskAreas(task));

      if (opts.json) {
        const out: Record<string, unknown> = { ...task };
        if (rb) {
          out.startup_skills = rb.startup_skills;
          out.skills = rb.skills;
        }
        out.memory = memoryRecall;
        printJson(out);
        return;
      }

      console.log(`${task.id} -> ${task.status}`);
      printBindingsText(rb);
      printMemoryRecallText(memoryRecall);
    })
  );

taskCmd
  .command("submit")
  .argument("<id>")
  .action(
    guarded((id: string) => {
      const repo = getRepo();
      const actor = actorFor(repo, id);
      const task = ledger.submitTask(repo, id, actor);
      console.log(`${task.id} -> ${task.status}`);
      // Layer 1 -> Layer 2 auto-fire (docs/memory.md §3 build plan item 2):
      // never blocks or fails submit itself, even on an unexpected error.
      try {
        const result = memory.materializeProposals(repo, id);
        if (result.created.length > 0 || result.problems.length > 0) {
          printMaterializeResult(result);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.log(`  memory propose warning (non-blocking): ${message}`);
      }
    })
  );

taskCmd
  .command("gate")
  .argument("<id>")
  .requiredOption("--gate <gate>", "verification|review")
  .requiredOption("--result <result>", "pass|fail")
  .option("--evidence <file>", "optional evidence file reference (informational)")
  .action(
    guarded((id: string, opts: { gate: string; result: string; evidence?: string }) => {
      const repo = getRepo();
      if (opts.gate !== "verification" && opts.gate !== "review") {
        throw new Error(`--gate must be 'verification' or 'review', got '${opts.gate}'`);
      }
      if (opts.result !== "pass" && opts.result !== "fail") {
        throw new Error(`--result must be 'pass' or 'fail', got '${opts.result}'`);
      }
      const actor = actorFor(repo, id);
      // Layer 1 architecture check (spec §10.3) is additionally enforced on
      // `--gate review --result pass` for implementation tasks, with the
      // same posture as evidence incompleteness ("PASS without evidence is
      // FAIL"): a violation refuses the gate rather than failing it silently.
      // Always whole-tree (see archcheck.ts's archCheckProblemsForGate doc
      // comment for why); `agent arch check --diff <ref>` is the fast,
      // cheap, worker-local check during the task itself.
      const task = ledger.gateTask(
        repo,
        id,
        { gate: opts.gate, result: opts.result, actor, evidencePath: opts.evidence },
        checkEvidence,
        archCheckProblemsForGate
      );
      console.log(`${task.id} -> ${task.status}`);
      printWorktreeHint(task);
    })
  );

taskCmd
  .command("done")
  .argument("<id>")
  .action(
    guarded((id: string) => {
      const repo = getRepo();
      const actor = actorFor(repo, id);
      const task = ledger.doneTask(repo, id, actor);
      console.log(`${task.id} -> ${task.status}`);
      printWorktreeHint(task);
    })
  );

taskCmd
  .command("fail")
  .argument("<id>")
  .requiredOption("--reason <reason>", "failure reason")
  .action(
    guarded((id: string, opts: { reason: string }) => {
      const repo = getRepo();
      const task = ledger.failTask(repo, id, opts.reason, "cli-operator");
      console.log(`${task.id} -> ${task.status} (${opts.reason})`);
      printWorktreeHint(task);
    })
  );

taskCmd
  .command("reclaim")
  .description("expire dead leases: reclaimable tasks with an expired lease go back to READY")
  .action(
    guarded(() => {
      const repo = getRepo();
      const results = ledger.reclaimExpired(repo);
      if (results.length === 0) {
        console.log("No expired leases.");
        return;
      }
      for (const r of results) {
        console.log(`Reclaimed ${r.taskId} (was ${r.from}, held by ${r.previousOwner}) -> READY`);
        printWorktreeHint(ledger.readTask(repo, r.taskId));
      }
    })
  );

// ------------------------------------------------------------------ skills

const skillsCmd = program.command("skills").description("skill binding commands (docs/skills-design.md §5)");

skillsCmd
  .command("install")
  .description("install bindings.yaml-referenced skills into the harness discovery path (or write a generic index)")
  .option("--harness <harness>", "generic|claude-code|cursor (default: bindings.yaml's active_harness)")
  .option("--force", "overwrite already-installed skills", false)
  .action(
    guarded((opts: { harness?: string; force?: boolean }) => {
      const repo = getRepo();
      if (opts.harness && opts.harness !== "generic" && opts.harness !== "claude-code" && opts.harness !== "cursor") {
        throw new Error(`--harness must be one of: generic, claude-code, cursor (got '${opts.harness}')`);
      }
      const result = installSkills(repo, { harness: opts.harness as Harness | undefined, force: opts.force });
      console.log(`skills install --harness ${result.harness}  (bindings: ${result.source})`);
      if (result.indexFile) console.log(`  index: ${result.indexFile}`);
      if (result.installDir) console.log(`  install dir: ${result.installDir}`);
      for (const item of result.items) {
        const label = item.name ?? item.relPath;
        console.log(`  ${item.status.padEnd(11)} ${label}${item.detail ? `  (${item.detail})` : ""}`);
      }
      const missing = result.items.filter((i) => i.status === "missing");
      if (missing.length > 0) {
        console.log(`${missing.length} skill(s) could not be resolved (see 'missing' above) — this is a warning, not a failure.`);
      }
      const warnings = result.items.filter((i) => i.status === "warning");
      if (warnings.length > 0) {
        console.log(`${warnings.length} skill(s) had malformed SKILL.md frontmatter and were skipped (see 'warning' above) — this is a warning, not a failure.`);
      }
    })
  );

// ------------------------------------------------------------------- route

program
  .command("route")
  .argument("<task-id>")
  .option("--json", "machine-readable output")
  .description("print resolved tier/verification/review per policies/risk.yaml (spec §7.3 Phase 1)")
  .action(
    guarded((taskId: string, opts: { json?: boolean }) => {
      const repo = getRepo();
      const task = ledger.readTask(repo, taskId);
      const resolution = resolveRoute(repo, task);
      if (opts.json) {
        printJson(resolution);
        return;
      }
      console.log(`route ${resolution.task}  risk=${resolution.risk}`);
      console.log(`  planning_tier:        ${resolution.planning_tier}  (${resolution.provenance.risk_policy_row} planning_tier)`);
      console.log(`  implementation_tier:  ${resolution.implementation_tier}  (${resolution.provenance.risk_policy_row} implementation_tier)`);
      console.log(`  verification_depth:   ${resolution.verification_depth}`);
      console.log(`  required_review_lenses: ${resolution.required_review_lenses.join(", ") || "(none)"}`);
      console.log(`  human_approval:       ${JSON.stringify(resolution.human_approval)}`);
      console.log(`  staged_release:       ${resolution.staged_release}`);
      console.log(`  planning_model:       ${resolution.planning_model ?? "(unset)"}  (${resolution.provenance.planning_model_pointer})`);
      console.log(`  implementation_model: ${resolution.implementation_model ?? "(unset)"}  (${resolution.provenance.implementation_model_pointer})`);
      console.log(`  provenance: ${resolution.provenance.risk_policy_file} ; ${resolution.provenance.models_policy_file} (active_profile=${resolution.provenance.active_profile})`);
    })
  );

// -------------------------------------------------------------- architecture

function printArchCheckText(result: ArchCheckResult): void {
  console.log(
    `arch check  mode=${result.mode}${result.diffRef ? `(${result.diffRef})` : ""}  policy=${result.policyFile}${result.policyFound ? "" : " (absent)"}`
  );
  console.log(`  invariants evaluated: ${result.invariantsEvaluated}  files scanned: ${result.filesScanned}`);
  for (const n of result.notes) console.log(`  note: ${n}`);
  for (const v of result.violations) console.log(`FAIL  ${formatArchViolation(v)}`);
  for (const w of result.warnings) console.log(`WARN  ${formatArchViolation(w)}`);
  if (result.violations.length === 0) {
    console.log(result.policyFound ? "No Layer-1 architecture violations." : "Clean pass (no policy file).");
  }
}

const archCmd = program.command("arch").description("architecture invariant commands (spec §10.3, Layer 1)");

archCmd
  .command("check")
  .description(
    "deterministic Layer-1 architecture check against .agent/policies/architecture.yaml; absent policy = clean pass"
  )
  .option("--diff <ref>", "check only files changed vs <ref> (git diff --name-only <ref>); default is a whole-tree scan")
  .option("--json", "machine-readable output")
  .action(
    guarded((opts: { diff?: string; json?: boolean }) => {
      const repo = getRepo();
      const result = runArchCheck(repo, { diff: opts.diff });
      if (opts.json) {
        printJson(result);
      } else {
        printArchCheckText(result);
      }
      if (result.violations.length > 0) process.exitCode = 1;
    })
  );

// ---------------------------------------------------------------- evidence

const evidenceCmd = program.command("evidence").description("evidence bundle commands (spec Appendix B, F.7)");

evidenceCmd
  .command("init")
  .argument("<task-id>")
  .description("scaffold .agent/runs/<task-id>/ (never overwrites existing files)")
  .action(
    guarded((taskId: string) => {
      const repo = getRepo();
      const task = ledger.readTask(repo, taskId);
      const result = scaffoldRunDir(repo, task);
      console.log(`Evidence run directory: ${result.runDir}`);
      console.log(`  created: ${result.created.join(", ") || "(none)"}`);
      console.log(`  skipped (already exist): ${result.skipped.join(", ") || "(none)"}`);
    })
  );

evidenceCmd
  .command("check")
  .argument("<task-id>")
  .option("--json", "machine-readable output")
  .description("completeness check for the task's current gate; gates refuse pass on incomplete evidence (spec F.7)")
  .action(
    guarded((taskId: string, opts: { json?: boolean }) => {
      const repo = getRepo();
      const task = ledger.readTask(repo, taskId);
      // Resolved ambiguity: the CLI surface does not take a --gate flag for
      // `evidence check`, so the gate is inferred from the task's current
      // status: VERIFYING checks verification evidence; any other gating
      // state (GATING, REVIEWING) checks review evidence, since generic
      // (non-implementation) GATING is most commonly review-shaped work
      // (research/spec/architecture review) per spec §6.3's "The role
      // contract defines what GATING means."
      const gate: "verification" | "review" = task.status === "VERIFYING" ? "verification" : "review";
      const problems = checkEvidence(repo, task, gate);
      const complete = problems.length === 0;
      if (opts.json) {
        printJson({ task: taskId, gate, complete, problems });
      } else {
        console.log(`${taskId}  gate=${gate}  ${complete ? "COMPLETE" : "INCOMPLETE"}`);
        for (const p of problems) console.log(`  - ${p}`);
      }
      if (!complete) process.exitCode = 1;
    })
  );

// ------------------------------------------------------------------- retro

const RETRO_TRIGGERS = new Set([
  "failed-task",
  "architecture-rejection",
  "human-correction",
  "high-cost-run",
  "unexpected-escalation",
  "rollback",
  "strong-success",
]);
const RETRO_CAUSES = new Set([
  "SPEC",
  "PLANNING",
  "ARCHITECTURE",
  "ROUTING",
  "CONTEXT",
  "SKILL",
  "MEMORY",
  "HARNESS",
  "TOOLING",
  "CODEBASE",
  "MODEL",
]);

const retroCmd = program.command("retro").description("retrospective commands (spec §13.2, F.10)");

retroCmd
  .command("create")
  .argument("<task-id>")
  .requiredOption("--trigger <trigger>", [...RETRO_TRIGGERS].join("|"))
  .option("--cause <cause>", [...RETRO_CAUSES].join("|"), "CODEBASE")
  .option("--eval", "also scaffold a replayable eval case from this retrospective (chains `agent eval create`, spec F.10)", false)
  .option("--eval-category <category>", "category for --eval (default: --cause, lowercased)")
  .description("scaffold retrospective.json (spec F.10: proposals only, status is always 'proposed')")
  .action(
    guarded((taskId: string, opts: { trigger: string; cause: string; eval?: boolean; evalCategory?: string }) => {
      const repo = getRepo();
      ledger.readTask(repo, taskId); // ensures the task exists
      if (!RETRO_TRIGGERS.has(opts.trigger)) {
        throw new Error(`--trigger must be one of: ${[...RETRO_TRIGGERS].join(", ")}`);
      }
      if (!RETRO_CAUSES.has(opts.cause)) {
        throw new Error(`--cause must be one of: ${[...RETRO_CAUSES].join(", ")}`);
      }
      const retro: Record<string, unknown> = {
        task: taskId,
        trigger: opts.trigger,
        cause: opts.cause,
        candidate_interventions: [
          {
            kind: "field-guide",
            detail: "Stub captured by `agent retro create`; refine and reclassify before promoting from 'proposed'.",
          },
        ],
        status: "proposed",
      };
      validateOrThrow("retrospective", retro, P.retrospectiveFile(repo, taskId));
      ensureDir(P.runDir(repo, taskId));
      writeJsonAtomic(P.retrospectiveFile(repo, taskId), retro);
      console.log(`Wrote ${P.retrospectiveFile(repo, taskId)}`);

      if (opts.eval) {
        const result = createEvalFromRetro(repo, taskId, { category: opts.evalCategory });
        retro.eval_case = result.relFile;
        validateOrThrow("retrospective", retro, P.retrospectiveFile(repo, taskId));
        writeJsonAtomic(P.retrospectiveFile(repo, taskId), retro);
        console.log(`Wrote ${result.file}`);
        if (result.warning) console.log(`  warning: ${result.warning}`);
      }
    })
  );

// -------------------------------------------------------------------- eval

const evalCmd = program.command("eval").description("replayable eval case commands (spec §13.5, F.10)");

evalCmd
  .command("create")
  .requiredOption("--from-retro <task-id>", "task id whose .agent/runs/<task-id>/retrospective.json to scaffold an eval case from")
  .option("--category <category>", "eval category / .agent/evals/<category>/ subdirectory (default: the retrospective's cause, lowercased)")
  .description("scaffold a schema-conformant .agent/evals/<category>/<ID>.yaml from a task retrospective")
  .action(
    guarded((opts: { fromRetro: string; category?: string }) => {
      const repo = getRepo();
      const result = createEvalFromRetro(repo, opts.fromRetro, { category: opts.category });
      console.log(`Wrote ${result.file}`);
      if (result.warning) console.log(`  warning: ${result.warning}`);
    })
  );

evalCmd
  .command("list")
  .description("list eval cases under .agent/evals/")
  .option("--json", "machine-readable output")
  .action(
    guarded((opts: { json?: boolean }) => {
      const repo = getRepo();
      const items = listEvalCases(repo);
      if (opts.json) {
        printJson(items);
        return;
      }
      if (items.length === 0) {
        console.log("No eval cases.");
        return;
      }
      for (const i of items) {
        console.log(`${i.id}  [${i.category}]  snapshot=${i.repo_snapshot.slice(0, 12)}  ${i.task.trim().slice(0, 60)}`);
      }
    })
  );

// ------------------------------------------------------------------ memory

const memoryCmd = program.command("memory").description("Field Guide memory commands (docs/memory.md, spec §12)");

memoryCmd
  .command("propose")
  .argument("<task-id>")
  .description(
    "materialize .agent/runs/<task-id>/memory-candidates.jsonl into pending proposals (idempotent manual re-run; auto-fired by `task submit`)"
  )
  .action(
    guarded((taskId: string) => {
      const repo = getRepo();
      const result = memory.materializeProposals(repo, taskId);
      printMaterializeResult(result);
    })
  );

memoryCmd
  .command("list")
  .description("list proposals + landed entries (all statuses by default)")
  .option("--status <status>", "pending|active|needs-reverification|rejected|expired")
  .option("--json", "machine-readable output")
  .action(
    guarded((opts: { status?: string; json?: boolean }) => {
      const repo = getRepo();
      if (opts.status && !["pending", "active", "needs-reverification", "rejected", "expired"].includes(opts.status)) {
        throw new Error(`--status must be one of: pending, active, needs-reverification, rejected, expired (got '${opts.status}')`);
      }
      const items = memory.listMemoryItems(repo, opts.status as memory.MemoryStatus | undefined);
      if (opts.json) {
        printJson(items);
        return;
      }
      if (items.length === 0) {
        console.log("No memory items.");
        return;
      }
      for (const i of items) {
        // Both ids are accepted by approve/reject/expire (resolve like `memory show`
        // does) — shown together so it's never ambiguous which one to pass.
        const idDisplay = i.fileStem ? `${i.id}  (file id: ${i.fileStem})` : i.id;
        console.log(`${idDisplay}  [${i.status}]  tier=${i.tier}  areas=${i.areas.join(",")}  ${i.claim}`);
      }
    })
  );

memoryCmd
  .command("show")
  .argument("<id>")
  .description("show one proposal or entry, by proposal filename (<TASK-ID>-<NN>) or frontmatter id (MEM-...)")
  .option("--json", "machine-readable output")
  .action(
    guarded((id: string, opts: { json?: boolean }) => {
      const repo = getRepo();
      const item = memory.findMemoryItem(repo, id);
      if (!item) throw new Error(`No memory item '${id}' found under ${P.memoryDir(repo)}.`);
      if (opts.json) {
        printJson(item);
        return;
      }
      console.log(`${item.id}  [${item.status}]  ${item.file}`);
      console.log(JSON.stringify(item.frontmatter, null, 2));
      console.log("");
      console.log(item.body);
    })
  );

memoryCmd
  .command("approve")
  .argument("<id>")
  .description("land a pending proposal into its topic file (tier-gated, spec §12.2)")
  .requiredOption("--by <role>", "approving role")
  .action(
    guarded((id: string, opts: { by: string }) => {
      const repo = getRepo();
      const result = memory.approveProposal(repo, id, opts.by);
      console.log(`${result.id} -> ${result.status}  (${result.file})`);
    })
  );

memoryCmd
  .command("reject")
  .argument("<id>")
  .description("decline a pending proposal to proposals/rejected/, reason preserved (tier-gated, spec §12.2)")
  .requiredOption("--by <role>", "rejecting role")
  .requiredOption("--reason <reason>", "reason, preserved in frontmatter")
  .action(
    guarded((id: string, opts: { by: string; reason: string }) => {
      const repo = getRepo();
      const result = memory.rejectProposal(repo, id, opts.by, opts.reason);
      console.log(`${result.id} -> ${result.status}  (${result.file})`);
    })
  );

memoryCmd
  .command("expire")
  .argument("<id>")
  .description("retire a landed entry to expired/, superseded_by preserved (tier-gated, spec §12.2)")
  .requiredOption("--by <role>", "expiring role")
  .requiredOption("--reason <reason>", "reason, preserved in frontmatter")
  .action(
    guarded((id: string, opts: { by: string; reason: string }) => {
      const repo = getRepo();
      const result = memory.expireEntry(repo, id, opts.by, opts.reason);
      console.log(`${result.id} -> ${result.status}  (${result.file})`);
    })
  );

// ------------------------------------------------------------------ status

program
  .command("status")
  .description("exception-first fleet dashboard (spec §14.5)")
  .option("--json", "machine-readable output")
  .action(
    guarded((opts: { json?: boolean }) => {
      const repo = getRepo();
      const report = buildStatusReport(repo);
      if (opts.json) {
        printJson(report);
        return;
      }
      console.log(renderStatusText(report));
    })
  );

// --------------------------------------------------------------------- run

export function main(argv: string[]): void {
  try {
    program.parse(argv);
  } catch (e) {
    // exitOverride() throws instead of calling process.exit(); translate
    // known "successful" exits (help/version) to code 0, everything else 1.
    const err = e as { code?: string; exitCode?: number };
    if (typeof err.exitCode === "number") {
      process.exitCode = err.exitCode;
    } else {
      process.exitCode = 1;
    }
  }
}

if (require.main === module) {
  main(process.argv);
}
