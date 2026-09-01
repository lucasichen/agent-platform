import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { makeTempRepo, baseMission, registerMission, installFixtureTemplate, writeMissionArtifact } from "./testutil";
import { instantiateWorkflow, CompilerError } from "../src/compiler";
import * as ledger from "../src/ledger";
import * as P from "../src/paths";
import { readYaml } from "../src/fsutil";
import type { WorkflowInstance } from "../src/types";

test("compiler happy path: writes workflow-instance.yaml + one READY/BLOCKED task per stage", () => {
  const repo = makeTempRepo();
  installFixtureTemplate(repo, "happy-path");
  const mission = baseMission();
  registerMission(repo, mission);
  writeMissionArtifact(repo, mission.id, "brief.md");

  const result = instantiateWorkflow(repo, mission.id);

  assert.equal(result.tasks.length, 4);
  const byStage = new Map(result.tasks.map((t) => [t.workflow.step, t]));

  const research = byStage.get("research")!;
  assert.equal(research.status, "READY", "no dependencies -> immediately READY");
  assert.deepEqual(research.dependencies, []);

  const build = byStage.get("build")!;
  assert.equal(build.status, "BLOCKED");
  assert.equal(build.blocked_reason, "dependencies-not-satisfied");
  assert.deepEqual(build.dependencies, [research.id]);
  // implementation payload stub must satisfy the schema's required fields
  assert.ok(Array.isArray((build.payload as { areas: unknown[] }).areas));

  const review = byStage.get("review")!;
  assert.equal(review.status, "BLOCKED");

  // workflow-instance.yaml is written and schema-shaped
  const instance = readYaml<WorkflowInstance>(P.workflowInstanceFile(repo, mission.id));
  assert.equal(instance.mission, mission.id);
  assert.equal(instance.template, "happy-path");
  assert.equal(instance.stages.length, 4);
  const reviewStage = instance.stages.find((s) => s.id === "review")!;
  assert.equal(reviewStage.human_gate, "sign-off");

  // Tasks are registered in the ledger (readable via ledger.listTasks).
  const listed = ledger.listTasks(repo, { mission: mission.id });
  assert.equal(listed.length, 4);

  // Mission flips DRAFT -> ACTIVE on successful instantiation.
  const missionAfter = ledger.readMission(repo, mission.id);
  assert.equal(missionAfter.status, "ACTIVE");
});

test("rejection: unknown role -> whole instance rejected, no task file written", () => {
  const repo = makeTempRepo();
  installFixtureTemplate(repo, "unknown-role");
  const mission = baseMission({
    type: "unknown-role",
    workflow: { id: "unknown-role", version: 1 },
    outputs: ["candidate-diff"],
    human_gates: [],
  });
  registerMission(repo, mission);
  writeMissionArtifact(repo, mission.id, "brief.md");

  assert.throws(() => instantiateWorkflow(repo, mission.id), (err: unknown) => {
    assert.ok(err instanceof CompilerError);
    assert.ok(err.violations.some((v) => v.includes("unknown role 'astrologer'")));
    return true;
  });
  assert.equal(fs.existsSync(P.workflowInstanceFile(repo, mission.id)), false);
  assert.equal(ledger.listTasks(repo, { mission: mission.id }).length, 0, "no task became READY/was written");
});

test("rejection: dependency cycle", () => {
  const repo = makeTempRepo();
  installFixtureTemplate(repo, "cycle");
  const mission = baseMission({
    type: "cycle",
    workflow: { id: "cycle", version: 1 },
    outputs: ["output-a", "output-b"],
    human_gates: [],
  });
  registerMission(repo, mission);
  writeMissionArtifact(repo, mission.id, "brief.md");

  assert.throws(() => instantiateWorkflow(repo, mission.id), (err: unknown) => {
    assert.ok(err instanceof CompilerError);
    assert.ok(err.violations.some((v) => v.includes("dependency cycle detected")));
    return true;
  });
});

test("rejection: uncovered mission output", () => {
  const repo = makeTempRepo();
  installFixtureTemplate(repo, "uncovered-output");
  const mission = baseMission({
    type: "uncovered-output",
    workflow: { id: "uncovered-output", version: 1 },
    outputs: ["candidate-diff", "audit-log"], // audit-log is never produced
    human_gates: [],
  });
  registerMission(repo, mission);
  writeMissionArtifact(repo, mission.id, "brief.md");

  assert.throws(() => instantiateWorkflow(repo, mission.id), (err: unknown) => {
    assert.ok(err instanceof CompilerError);
    assert.ok(err.violations.some((v) => v.includes("mission output 'audit-log' has no producing stage")));
    return true;
  });
});

test("rejection: human gate with no named DAG point", () => {
  const repo = makeTempRepo();
  installFixtureTemplate(repo, "unnamed-gate");
  const mission = baseMission({
    type: "unnamed-gate",
    workflow: { id: "unnamed-gate", version: 1 },
    outputs: ["candidate-diff"],
    human_gates: ["approval"], // no stage.human_gate === 'approval'
  });
  registerMission(repo, mission);
  writeMissionArtifact(repo, mission.id, "brief.md");

  assert.throws(() => instantiateWorkflow(repo, mission.id), (err: unknown) => {
    assert.ok(err instanceof CompilerError);
    assert.ok(err.violations.some((v) => v.includes("human gate 'approval'") && v.includes("no named DAG point")));
    return true;
  });
});

test("rejection: unresolvable artifact URI on a mission input", () => {
  const repo = makeTempRepo();
  installFixtureTemplate(repo, "happy-path");
  const mission = baseMission();
  registerMission(repo, mission);
  // Deliberately do NOT create artifacts/brief.md.

  assert.throws(() => instantiateWorkflow(repo, mission.id), (err: unknown) => {
    assert.ok(err instanceof CompilerError);
    assert.ok(err.violations.some((v) => v.includes("unresolvable artifact URI 'brief.md'")));
    return true;
  });
  assert.equal(fs.existsSync(P.workflowInstanceFile(repo, mission.id)), false);
});

test("rejection: multiple violations are all listed together", () => {
  const repo = makeTempRepo();
  installFixtureTemplate(repo, "unknown-role");
  const mission = baseMission({
    type: "unknown-role",
    workflow: { id: "unknown-role", version: 1 },
    outputs: ["candidate-diff", "something-missing"],
    human_gates: [],
  });
  registerMission(repo, mission);
  // Also omit brief.md to trigger the unresolvable-URI violation simultaneously.

  assert.throws(() => instantiateWorkflow(repo, mission.id), (err: unknown) => {
    assert.ok(err instanceof CompilerError);
    assert.ok(err.violations.length >= 3, `expected >= 3 violations, got: ${JSON.stringify(err.violations)}`);
    return true;
  });
});

test("workflow template version mismatch is rejected", () => {
  const repo = makeTempRepo();
  installFixtureTemplate(repo, "happy-path");
  const mission = baseMission({ workflow: { id: "happy-path", version: 2 } });
  registerMission(repo, mission);
  writeMissionArtifact(repo, mission.id, "brief.md");

  assert.throws(() => instantiateWorkflow(repo, mission.id), (err: unknown) => {
    assert.ok(err instanceof CompilerError);
    assert.ok(err.violations.some((v) => v.includes("version 1")));
    return true;
  });
});
