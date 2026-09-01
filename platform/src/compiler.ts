// F.0 Mission Router / Workflow Compiler (spec Appendix F.0, DESIGN.md §3,
// §6). "The compiler performs composition only; it does not invent product
// or architecture decisions." On any validation failure the whole instance
// is rejected BEFORE any task becomes READY, listing every violation.
import * as fs from "node:fs";
import * as path from "node:path";
import type { Mission, RiskLevel, Task, TaskInputRef, WorkflowInstance, WorkflowInstanceStage, WorkflowTemplate, WorkflowTemplateStage } from "./types";
import * as P from "./paths";
import { readMission, writeMission, writeTask } from "./ledger";
import { readYaml, sha256File, writeYamlAtomic, ensureDir } from "./fsutil";
import { validateOrThrow, collectProblems } from "./validate";
import { packagedRegistryWorkflowsDir } from "./assets";

// Role ids known to the platform (roles/F*.md, DESIGN.md §2 roles/ listing).
// The compiler's "every stage role known" check (F.0 Done means) is a
// closed-world lookup against this list, not a role-contract execution.
export const KNOWN_ROLES: ReadonlySet<string> = new Set([
  "workflow-compiler", // F0
  "uncertainty-resolver", // F1
  "domain-product-clarifier", // F1A
  "specifier", // F2
  "architect", // F3
  "task-decomposer", // F4
  "control-plane", // F5 - documents the CLI's own guarantees, not a worker role
  "worker", // F6
  "verifier", // F7
  "reviewer", // F8
  "merge-refinery", // F9
  "learning-evaluator", // F10
]);

// Stages of type child-mission are a control-plane mechanism, not a
// role-contract task (registry/workflows/project-definition.yaml comment:
// "this stage is a control-plane mechanism (mission creation), not a
// role-contract task"). The task schema still requires a `role`, so the
// compiler binds these to the control-plane role explicitly. Resolved
// ambiguity: DESIGN.md/spec do not name a role for child-mission stages.
const CHILD_MISSION_ROLE = "control-plane";

const DEFAULT_RISK: RiskLevel = "R2";
const DEFAULT_TASK_ATTEMPTS = 3;

export class CompilerError extends Error {
  constructor(
    public readonly missionId: string,
    public readonly violations: string[]
  ) {
    super(
      [`Workflow instantiation rejected for mission '${missionId}' (${violations.length} violation(s)); no task became READY:`, ...violations.map((v) => `  - ${v}`)].join(
        "\n"
      )
    );
    this.name = "CompilerError";
  }
}

interface LoadedTemplate {
  template: WorkflowTemplate;
  source: string;
}

function loadWorkflowTemplate(repo: string, id: string): LoadedTemplate | undefined {
  const localPath = path.join(P.workflowsDirIn(repo), `${id}.yaml`);
  if (fs.existsSync(localPath)) {
    return { template: readYaml<WorkflowTemplate>(localPath), source: localPath };
  }
  const packagedDir = packagedRegistryWorkflowsDir();
  if (packagedDir) {
    const packagedPath = path.join(packagedDir, `${id}.yaml`);
    if (fs.existsSync(packagedPath)) {
      return { template: readYaml<WorkflowTemplate>(packagedPath), source: packagedPath };
    }
  }
  return undefined;
}

function stripScheme(uri: string): { scheme?: string; rest: string } {
  const m = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(uri);
  if (!m) return { rest: uri };
  return { scheme: m[1] ?? "", rest: m[2] ?? "" };
}

const EPHEMERAL_SCHEMES = new Set(["question"]);

function detectCycle(stages: WorkflowTemplateStage[]): string[] | undefined {
  const byId = new Map(stages.map((s) => [s.id, s] as const));
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>(stages.map((s) => [s.id, WHITE]));
  const stack: string[] = [];

  function visit(id: string): string[] | undefined {
    color.set(id, GRAY);
    stack.push(id);
    const stage = byId.get(id);
    for (const dep of stage?.depends_on ?? []) {
      if (!byId.has(dep)) continue; // reported separately as an unknown dependency
      const c = color.get(dep);
      if (c === GRAY) {
        const cycleStart = stack.indexOf(dep);
        return [...stack.slice(cycleStart), dep];
      }
      if (c === WHITE) {
        const found = visit(dep);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(id, BLACK);
    return undefined;
  }

  for (const stage of stages) {
    if (color.get(stage.id) === WHITE) {
      const found = visit(stage.id);
      if (found) return found;
    }
  }
  return undefined;
}

function outputsCover(stageOutputs: string[], name: string): boolean {
  for (const out of stageOutputs) {
    if (out === name) return true;
    const base = out.split("/").pop();
    if (base === name) return true;
  }
  return false;
}

// ------------------------------------------------------- condition resolution
// roles/F0-workflow-compiler.md step 2: every conditional stage carries
// either a `predicate` (evaluated mechanically, never guessed) or an
// `owner` (the stage is always instantiated; the owning role decides at
// execution time). A `condition` with neither is a template defect and is
// already rejected by the workflow-template schema's `condition` oneOf
// (schemaProblems check above runs before any of this).

const RISK_ORDER: RiskLevel[] = ["R0", "R1", "R2", "R3", "R4"];

function riskAtLeast(risk: RiskLevel, threshold: RiskLevel): boolean {
  return RISK_ORDER.indexOf(risk) >= RISK_ORDER.indexOf(threshold);
}

/** Same fallback the compiler already uses to stamp task.risk (see the task-construction loop below): mission.constraints.default_risk, else the platform default. */
function resolveMissionRisk(mission: Mission): RiskLevel {
  return (mission.constraints?.default_risk as RiskLevel | undefined) ?? DEFAULT_RISK;
}

/**
 * `payload.design.decision_refs` (spec §3.2's predicate text) names a
 * *task* payload field, but conditional stages are resolved at mission
 * instantiation time, before any task (or its payload) exists. Resolved
 * ambiguity: the compiler reads the same shape off the mission's own
 * `constraints.design.decision_refs`, the one place a mission can pin
 * design authority ahead of decomposition. A mission that does not supply
 * it is, correctly, "absent" — the predicate's decision_refs clause is
 * then true and the stage is not skipped on that clause alone.
 */
function missionDecisionRefs(mission: Mission): string[] {
  const constraints = mission.constraints as Record<string, unknown> | undefined;
  const design = constraints?.design as { decision_refs?: unknown } | undefined;
  const refs = design?.decision_refs;
  return Array.isArray(refs) ? refs.filter((r): r is string => typeof r === "string") : [];
}

type PredicateEval = { matched: true; value: boolean } | { matched: false };

/** One recognized mechanical predicate clause. Anything else is not mechanically evaluable (roles/F0-workflow-compiler.md: "if the predicate cannot be evaluated from data on hand, that is a compiler failure, not a license to guess"). */
function evalPredicateClause(clause: string, mission: Mission): PredicateEval {
  const trimmed = clause.trim();
  const riskMatch = /^task\.risk\s*>=\s*(R[0-4])$/i.exec(trimmed);
  if (riskMatch) {
    const threshold = riskMatch[1]!.toUpperCase() as RiskLevel;
    return { matched: true, value: riskAtLeast(resolveMissionRisk(mission), threshold) };
  }
  if (/^payload\.design\.decision_refs\s+is\s+empty\s+or\s+absent$/i.test(trimmed)) {
    return { matched: true, value: missionDecisionRefs(mission).length === 0 };
  }
  return { matched: false };
}

/**
 * Clauses combine with OR only (the only combinator the registry's
 * templates use). Split on the literal uppercase " OR " combinator only
 * (case-sensitive) — the decision_refs clause's own prose ("is empty or
 * absent") legitimately contains a lowercase "or" that must not be
 * mistaken for a clause boundary. The whole predicate is mechanically
 * evaluable only if every clause is.
 */
function evalPredicate(predicate: string, mission: Mission): PredicateEval {
  const clauses = predicate.split(/\s+OR\s+/);
  const evals = clauses.map((c) => evalPredicateClause(c, mission));
  if (evals.some((e) => !e.matched)) return { matched: false };
  return { matched: true, value: evals.some((e) => e.matched && e.value) };
}

interface ConditionResolution {
  /** false only for a mechanically-evaluated predicate that resolved to false: the stage is skipped, no task is created for it. */
  included: boolean;
  /** Set for owner-style stages (explicit `owner:`, or a predicate the compiler could not mechanically evaluate) — recorded into the task's payload for visibility (roles/F0-workflow-compiler.md step 2). */
  conditionOwner?: string;
  /** Human-readable note surfaced in CompileResult.notes, never silently swallowed. */
  note?: string;
}

/**
 * Resolves every stage's `condition` per roles/F0-workflow-compiler.md
 * step 2. Called only after schema validation, so every `condition` is
 * either `{predicate}` or `{owner}` (never neither/both).
 */
function resolveStageConditions(stages: WorkflowTemplateStage[], mission: Mission): { resolutions: Map<string, ConditionResolution>; notes: string[] } {
  const resolutions = new Map<string, ConditionResolution>();
  const notes: string[] = [];
  for (const stage of stages) {
    if (!stage.condition) {
      resolutions.set(stage.id, { included: true });
      continue;
    }
    if ("owner" in stage.condition) {
      resolutions.set(stage.id, { included: true, conditionOwner: stage.condition.owner });
      continue;
    }
    const evalResult = evalPredicate(stage.condition.predicate, mission);
    if (evalResult.matched) {
      resolutions.set(stage.id, { included: evalResult.value });
      continue;
    }
    // Rule (c): a predicate string that does not match a supported
    // mechanical form is treated as owner-style — instantiated, never
    // guessed — with the stage's own role deciding at runtime, and a note
    // surfaced so this is visible rather than silent.
    const fallbackOwner = stage.role ?? CHILD_MISSION_ROLE;
    const note =
      `stage '${stage.id}': predicate '${stage.condition.predicate}' is not one of the compiler's mechanically-evaluable forms ` +
      `(risk comparison, decision_refs presence); treated as owner-style and instantiated for role '${fallbackOwner}' to decide at runtime ` +
      `(roles/F0-workflow-compiler.md: never guess a predicate the compiler cannot evaluate).`;
    notes.push(note);
    resolutions.set(stage.id, { included: true, conditionOwner: fallbackOwner, note });
  }
  return { resolutions, notes };
}

/**
 * Returns a function resolving each stage id to its *effective*
 * dependencies: a skipped stage is transparently replaced by its own
 * dependencies (recursively), so a dependent stage re-points around it
 * (roles/F0-workflow-compiler.md step 2 / spec §3.2 conditional stages).
 * Operates on the original template graph, already proven acyclic.
 */
function computeEffectiveDeps(stages: WorkflowTemplateStage[], resolutions: Map<string, ConditionResolution>): (stageId: string) => string[] {
  const byId = new Map(stages.map((s) => [s.id, s] as const));
  const cache = new Map<string, string[]>();

  function resolve(stageId: string, seen: Set<string>): string[] {
    const cached = cache.get(stageId);
    if (cached) return cached;
    if (seen.has(stageId)) return []; // defensive; the graph is already validated acyclic
    seen.add(stageId);
    const rawDeps = byId.get(stageId)?.depends_on ?? [];
    const out: string[] = [];
    for (const dep of rawDeps) {
      const depIncluded = resolutions.get(dep)?.included ?? true;
      const chain = depIncluded ? [dep] : resolve(dep, seen);
      for (const id of chain) {
        if (!out.includes(id)) out.push(id);
      }
    }
    cache.set(stageId, out);
    return out;
  }

  return (stageId: string) => resolve(stageId, new Set());
}

interface ResolvedInput {
  ref: TaskInputRef;
  problem?: string;
}

/** Resolve one mission-level entry input against the mission's artifact directory. Ephemeral schemes need no file. */
function resolveMissionInput(repo: string, missionId: string, raw: string): ResolvedInput {
  const { scheme, rest } = stripScheme(raw);
  if (scheme && EPHEMERAL_SCHEMES.has(scheme)) {
    return { ref: raw };
  }
  const relPath = scheme ? rest : raw;
  const filePath = path.join(P.missionArtifactsDir(repo, missionId), relPath);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return { ref: raw, problem: `unresolvable artifact URI '${raw}' (expected file at ${filePath})` };
  }
  return { ref: { uri: raw, hash: sha256File(filePath) } };
}

export interface CompileOptions {
  actor?: string;
}

export interface CompileResult {
  workflowInstance: WorkflowInstance;
  tasks: Task[];
  templateSource: string;
  /** Non-fatal compiler notes, e.g. an owner-style fallback for a predicate the compiler could not mechanically evaluate (roles/F0-workflow-compiler.md step 2). Never silent. */
  notes: string[];
}

/**
 * `agent workflow instantiate --mission <id>`. Validates the whole
 * instance up front (F.0 Done means) and only then writes
 * workflow-instance.yaml + one task per stage + registers them in the
 * ledger. Throws CompilerError (listing every violation) without writing
 * anything on failure.
 */
export function instantiateWorkflow(repo: string, missionId: string, _opts: CompileOptions = {}): CompileResult {
  const mission = readMission(repo, missionId);
  const violations: string[] = [];

  const loaded = loadWorkflowTemplate(repo, mission.workflow.id);
  if (!loaded) {
    throw new CompilerError(missionId, [
      `workflow template '${mission.workflow.id}' not found under ${P.workflowsDirIn(repo)} or the packaged registry`,
    ]);
  }
  const { template, source } = loaded;

  const schemaProblems = collectProblems("workflow-template", template);
  if (schemaProblems.length > 0) {
    throw new CompilerError(missionId, schemaProblems.map((p) => `template '${source}' ${p}`));
  }

  if (template.version !== mission.workflow.version) {
    violations.push(
      `mission pins workflow ${mission.workflow.id}@${mission.workflow.version}, but the resolved template is version ${template.version} (${source})`
    );
  }

  const stages = template.stages;
  const stageIds = new Set<string>();
  for (const stage of stages) {
    if (stageIds.has(stage.id)) {
      violations.push(`duplicate stage id '${stage.id}'`);
    }
    stageIds.add(stage.id);
  }

  for (const stage of stages) {
    if (stage.role !== undefined && !KNOWN_ROLES.has(stage.role)) {
      violations.push(`stage '${stage.id}': unknown role '${stage.role}'`);
    }
    if (stage.type !== "child-mission" && stage.role === undefined) {
      violations.push(`stage '${stage.id}': role is required for non-child-mission stages`);
    }
    for (const dep of stage.depends_on ?? []) {
      if (!stageIds.has(dep)) {
        violations.push(`stage '${stage.id}': depends_on references unknown stage '${dep}'`);
      }
    }
  }

  const cycle = detectCycle(stages);
  if (cycle) {
    violations.push(`dependency cycle detected: ${cycle.join(" -> ")}`);
  }

  // Mission required outputs must be covered by some stage's outputs (F.0 Done means).
  for (const requiredOutput of mission.outputs) {
    const covered = stages.some((s) => outputsCover(s.outputs ?? [], requiredOutput));
    if (!covered) {
      violations.push(`mission output '${requiredOutput}' has no producing stage`);
    }
  }
  // Template well-formedness: its own declared required_outputs should also
  // be produced by some stage (belt-and-suspenders on top of the mission
  // check above; catches a template authored inconsistently with itself).
  for (const requiredOutput of template.required_outputs) {
    const covered = stages.some((s) => outputsCover(s.outputs ?? [], requiredOutput));
    if (!covered) {
      violations.push(`template required output '${requiredOutput}' has no producing stage`);
    }
  }

  // Every human gate named: every mission.human_gates entry must bind to a
  // stage.human_gate DAG point (F.0 Done means: "every human gate has a
  // named point in the DAG").
  for (const gateName of mission.human_gates) {
    const bound = stages.some((s) => s.human_gate === gateName);
    if (!bound) {
      violations.push(`human gate '${gateName}' (declared on mission) has no named DAG point (no stage.human_gate matches)`);
    }
  }

  // Resolve entry-stage inputs from mission.inputs; unresolvable -> intake
  // failure (spec §6.1 Artifact references / Pinning).
  const missionInputResolutions = mission.inputs.map((raw) => ({ raw, resolved: resolveMissionInput(repo, missionId, raw) }));
  for (const { resolved } of missionInputResolutions) {
    if (resolved.problem) violations.push(resolved.problem);
  }

  if (violations.length > 0) {
    throw new CompilerError(missionId, violations);
  }

  // ---- Composition (no more violations possible past this point) ----

  const stageTaskId = (stage: WorkflowTemplateStage) => `${missionId}-${stage.id}`.toUpperCase();
  const entryInputs: TaskInputRef[] = missionInputResolutions.map((m) => m.resolved.ref);

  // Resolve every stage's `condition` (roles/F0-workflow-compiler.md step
  // 2): a mechanically-false predicate skips the stage entirely (no task
  // is created for it, and dependents re-point around it to its own
  // dependencies); an owner-style stage (explicit `owner:`, or a predicate
  // the compiler cannot mechanically evaluate) is always instantiated.
  const { resolutions: conditionResolutions, notes: conditionNotes } = resolveStageConditions(stages, mission);
  const effectiveDepsFor = computeEffectiveDeps(stages, conditionResolutions);
  const missionRisk = resolveMissionRisk(mission);

  const instanceStages: WorkflowInstanceStage[] = [];
  const tasks: Task[] = [];
  const stageCount = stages.length || 1;
  const perTaskDollars = Math.max(0.01, Math.round((mission.budget.dollars / stageCount) * 100) / 100);

  for (const stage of stages) {
    const resolution = conditionResolutions.get(stage.id)!;
    if (!resolution.included) continue; // skipped: no task; dependents already re-point via effectiveDepsFor

    const deps = effectiveDepsFor(stage.id);
    const inputs: TaskInputRef[] =
      deps.length === 0
        ? entryInputs
        : deps.flatMap((depId) => {
            const depStage = stages.find((s) => s.id === depId);
            return (depStage?.outputs ?? []).map((o) => o as TaskInputRef);
          });

    const role = stage.role ?? CHILD_MISSION_ROLE;
    const dependencies = deps.map((depId) => stageTaskId(stages.find((s) => s.id === depId)!));
    const status = dependencies.length === 0 ? "READY" : "BLOCKED";

    const instanceStage: WorkflowInstanceStage = {
      id: stage.id,
      role: stage.role,
      type: stage.type,
      depends_on: deps,
      inputs,
      outputs: stage.outputs,
      human_gate: stage.human_gate,
      gated_by: stage.gated_by,
    };
    instanceStages.push(instanceStage);

    const payload: Record<string, unknown> =
      stage.type === "implementation"
        ? { areas: [], design: { authority: role }, acceptance: [], verification: [] }
        : {};
    // Owner-style stage (spec §3.2 step 2b): the compiler does not resolve
    // the judgment call itself; it records who owns it so it stays visible.
    if (resolution.conditionOwner) payload.condition_owner = resolution.conditionOwner;

    const task: Task = {
      id: stageTaskId(stage),
      mission: missionId,
      workflow: { id: template.id, version: template.version, step: stage.id },
      type: stage.type,
      role,
      dependencies,
      // Risk is not part of the workflow-template schema: assigning risk is
      // a planning/architecture judgment the compiler must not invent (F.0
      // failure mode: "router makes architecture decisions"). Resolved
      // ambiguity: fall back to mission.constraints.default_risk, else a
      // conservative platform default (R2); a real deployment has the
      // task-decomposer/architect role stamp risk per task before/at
      // decomposition. Same resolution used to mechanically evaluate any
      // risk-comparison predicate above (resolveMissionRisk).
      risk: missionRisk,
      inputs,
      outputs: stage.outputs ?? [],
      budget: { attempts: DEFAULT_TASK_ATTEMPTS, dollars: perTaskDollars },
      payload,
      status,
      blocked_reason: status === "BLOCKED" ? "dependencies-not-satisfied" : undefined,
      lease: null,
      attempt: 0,
    };
    tasks.push(task);
  }

  const workflowInstance: WorkflowInstance = {
    mission: missionId,
    template: template.id,
    version: template.version,
    stages: instanceStages,
  };
  validateOrThrow("workflow-instance", workflowInstance, P.workflowInstanceFile(repo, missionId));
  for (const task of tasks) {
    validateOrThrow("task", task, P.taskFile(repo, missionId, task.id));
  }

  // ---- Writes (only after every validation above has passed) ----
  ensureDir(P.missionTasksDir(repo, missionId));
  writeYamlAtomic(P.workflowInstanceFile(repo, missionId), workflowInstance);
  for (const task of tasks) {
    writeTask(repo, missionId, task);
  }
  if (mission.status === "DRAFT") {
    writeMission(repo, { ...mission, status: "ACTIVE" });
  }

  return { workflowInstance, tasks, templateSource: source, notes: conditionNotes };
}
