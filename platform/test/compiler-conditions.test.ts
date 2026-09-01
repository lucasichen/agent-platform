import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTempRepo, baseMission, registerMission, installFixtureTemplate, writeMissionArtifact } from "./testutil";
import { instantiateWorkflow, CompilerError } from "../src/compiler";
import * as ledger from "../src/ledger";

// Fix 1: stage.condition must actually be evaluated at instantiation
// (roles/F0-workflow-compiler.md step 2, spec §3.2).

test("predicate-false: stage is skipped and dependents re-point to its own dependencies", () => {
  const repo = makeTempRepo();
  installFixtureTemplate(repo, "condition-predicate");
  const mission = baseMission({
    type: "condition-predicate",
    workflow: { id: "condition-predicate", version: 1 },
    outputs: ["candidate-diff"],
    human_gates: [],
    // R1 < R3, and decision_refs is non-empty -> both OR clauses false.
    constraints: { default_risk: "R1", design: { decision_refs: ["ADR-1"] } },
  });
  registerMission(repo, mission);
  writeMissionArtifact(repo, mission.id, "brief.md");

  const result = instantiateWorkflow(repo, mission.id);

  const byStage = new Map(result.tasks.map((t) => [t.workflow.step, t]));
  assert.equal(byStage.has("gate"), false, "skipped stage must not become a task");
  assert.equal(result.workflowInstance.stages.some((s) => s.id === "gate"), false, "skipped stage must not appear in the instance");

  const build = byStage.get("build")!;
  assert.deepEqual(build.dependencies, [`${mission.id}-SEED`]);
  assert.equal(build.status, "BLOCKED"); // seed is not yet DONE
  const buildInstance = result.workflowInstance.stages.find((s) => s.id === "build")!;
  assert.deepEqual(buildInstance.depends_on, ["seed"]);

  const seed = byStage.get("seed")!;
  assert.equal(seed.status, "READY");
});

test("predicate-true: stage is instantiated normally (risk forces the OR true)", () => {
  const repo = makeTempRepo();
  installFixtureTemplate(repo, "condition-predicate");
  const mission = baseMission({
    type: "condition-predicate",
    workflow: { id: "condition-predicate", version: 1 },
    outputs: ["candidate-diff"],
    human_gates: [],
    constraints: { default_risk: "R4", design: { decision_refs: ["ADR-1"] } },
  });
  registerMission(repo, mission);
  writeMissionArtifact(repo, mission.id, "brief.md");

  const result = instantiateWorkflow(repo, mission.id);
  const byStage = new Map(result.tasks.map((t) => [t.workflow.step, t]));
  const gate = byStage.get("gate");
  assert.ok(gate, "predicate-true stage must be instantiated");
  assert.equal(gate!.payload && (gate!.payload as Record<string, unknown>).condition_owner, undefined);

  const build = byStage.get("build")!;
  assert.deepEqual(build.dependencies, [`${mission.id}-GATE`]);
});

test("owner-only: stage is always instantiated, condition_owner recorded in payload", () => {
  const repo = makeTempRepo();
  installFixtureTemplate(repo, "condition-owner");
  const mission = baseMission({
    type: "condition-owner",
    workflow: { id: "condition-owner", version: 1 },
    outputs: ["project-spec"],
    human_gates: [],
  });
  registerMission(repo, mission);
  writeMissionArtifact(repo, mission.id, "brief.md");

  const result = instantiateWorkflow(repo, mission.id);
  const plan = result.tasks.find((t) => t.workflow.step === "plan")!;
  assert.ok(plan, "owner-style stage must always be instantiated");
  assert.equal((plan.payload as Record<string, unknown>).condition_owner, "specifier");
});

test("condition with neither predicate nor owner rejects the whole template (F.0 template defect)", () => {
  const repo = makeTempRepo();
  installFixtureTemplate(repo, "condition-neither");
  const mission = baseMission({
    type: "condition-neither",
    workflow: { id: "condition-neither", version: 1 },
    outputs: ["candidate-diff"],
    human_gates: [],
  });
  registerMission(repo, mission);
  writeMissionArtifact(repo, mission.id, "brief.md");

  assert.throws(() => instantiateWorkflow(repo, mission.id), (err: unknown) => {
    assert.ok(err instanceof CompilerError);
    return true;
  });
  assert.equal(ledger.listTasks(repo, { mission: mission.id }).length, 0);
});

test("predicate not mechanically evaluable falls back to owner-style, with a surfaced note", () => {
  const repo = makeTempRepo();
  installFixtureTemplate(repo, "condition-unmatched-predicate");
  const mission = baseMission({
    type: "condition-unmatched-predicate",
    workflow: { id: "condition-unmatched-predicate", version: 1 },
    outputs: ["review-verdict/spec.json"],
    human_gates: [],
  });
  registerMission(repo, mission);
  writeMissionArtifact(repo, mission.id, "brief.md");

  const result = instantiateWorkflow(repo, mission.id);
  const reviewish = result.tasks.find((t) => t.workflow.step === "reviewish")!;
  assert.ok(reviewish, "unmatched predicate must fall back to instantiating the stage, never guessing a skip");
  assert.equal((reviewish.payload as Record<string, unknown>).condition_owner, "reviewer");
  assert.ok(result.notes.some((n) => n.includes("reviewish") && n.includes("not one of the compiler's mechanically-evaluable forms")));
});

// -------------------------------------- real feature-development template

test("real feature-development template at R2 with pinned decision_refs: architecture-check is skipped, decompose re-points to spec-refresh", () => {
  const repo = makeTempRepo();
  const mission = baseMission({
    id: "MISSION-FD-R2",
    type: "feature-development",
    workflow: { id: "feature-development", version: 1 },
    inputs: [],
    outputs: ["merged-commit"],
    human_gates: [],
    constraints: { default_risk: "R2", design: { decision_refs: ["ADR-42"] } },
  });
  registerMission(repo, mission);

  const result = instantiateWorkflow(repo, mission.id);
  const byStage = new Map(result.tasks.map((t) => [t.workflow.step, t]));
  assert.equal(byStage.has("architecture-check"), false, "R2 + pinned decision_refs must skip architecture-check");

  const decomposeInstance = result.workflowInstance.stages.find((s) => s.id === "decompose")!;
  assert.deepEqual(decomposeInstance.depends_on, ["spec-refresh"], "decompose must re-point to spec-refresh");

  const decompose = byStage.get("decompose")!;
  assert.deepEqual(decompose.dependencies, [`${mission.id}-SPEC-REFRESH`]);

  const specRefresh = byStage.get("spec-refresh")!;
  assert.equal((specRefresh.payload as Record<string, unknown>).condition_owner, "specifier");
});

test("real feature-development template at R3: architecture-check is present", () => {
  const repo = makeTempRepo();
  const mission = baseMission({
    id: "MISSION-FD-R3",
    type: "feature-development",
    workflow: { id: "feature-development", version: 1 },
    inputs: [],
    outputs: ["merged-commit"],
    human_gates: [],
    constraints: { default_risk: "R3", design: { decision_refs: ["ADR-42"] } },
  });
  registerMission(repo, mission);

  const result = instantiateWorkflow(repo, mission.id);
  const byStage = new Map(result.tasks.map((t) => [t.workflow.step, t]));
  assert.ok(byStage.has("architecture-check"), "R3 must instantiate architecture-check regardless of decision_refs");

  const decomposeInstance = result.workflowInstance.stages.find((s) => s.id === "decompose")!;
  assert.deepEqual(decomposeInstance.depends_on, ["architecture-check"]);

  // The review stage's predicate is a lens lookup, not a skip decision: it
  // must fall into rule (c), never be silently skipped.
  const review = byStage.get("review")!;
  assert.equal((review.payload as Record<string, unknown>).condition_owner, "reviewer");
});
