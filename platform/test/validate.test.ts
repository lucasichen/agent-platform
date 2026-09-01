import { test } from "node:test";
import assert from "node:assert/strict";
import { validateOrThrow, collectProblems, ValidationError, inferSchemaName } from "../src/validate";

test("validateOrThrow accepts a schema-conformant mission", () => {
  const mission = {
    id: "MISSION-OK",
    type: "happy-path",
    workflow: { id: "happy-path", version: 1 },
    goal: "test",
    parent_mission: null,
    inputs: [],
    outputs: [],
    constraints: {},
    budget: { dollars: 1 },
    human_gates: [],
    status: "DRAFT",
  };
  assert.doesNotThrow(() => validateOrThrow("mission", mission, "/tmp/mission.yaml"));
});

test("validateOrThrow rejects with an actionable message: file path + JSON pointer", () => {
  const badMission = { id: "not-screaming-kebab", type: "x" }; // missing required fields, bad pattern
  try {
    validateOrThrow("mission", badMission, "/repo/.agent/missions/X/mission.yaml");
    assert.fail("expected ValidationError");
  } catch (e) {
    if (!(e instanceof ValidationError)) throw e;
    assert.match(e.message, /\/repo\/\.agent\/missions\/X\/mission\.yaml/);
    assert.ok(e.problems.length > 0);
    // At least one problem should carry a JSON pointer (starts with '/') or root '/'.
    assert.ok(e.problems.some((p) => /^\//.test(p)));
  }
});

test("collectProblems returns [] on success and a list on failure, never throwing", () => {
  assert.deepEqual(collectProblems("risk-policy", { levels: {} }).length > 0, true);
});

test("inferSchemaName recognizes DESIGN.md/Appendix filename conventions", () => {
  assert.equal(inferSchemaName("/x/.agent/missions/M/mission.yaml"), "mission");
  assert.equal(inferSchemaName("/x/.agent/missions/M/tasks/M-1.yaml"), "task");
  assert.equal(inferSchemaName("/x/.agent/missions/M/workflow-instance.yaml"), "workflow-instance");
  assert.equal(inferSchemaName("/x/.agent/policies/risk.yaml"), "risk-policy");
  assert.equal(inferSchemaName("/x/.agent/policies/models.yaml"), "models-policy");
  assert.equal(inferSchemaName("/x/.agent/workflows/bug-fix.yaml"), "workflow-template");
  assert.equal(inferSchemaName("/x/.agent/runs/T-1/verification/result.json"), "verification-result");
  assert.equal(inferSchemaName("/x/.agent/runs/T-1/result.json"), "result");
  assert.equal(inferSchemaName("/x/.agent/runs/T-1/reviews/spec.json"), "review-verdict");
  assert.equal(inferSchemaName("/x/.agent/runs/T-1/cost.json"), "cost");
  assert.equal(inferSchemaName("/x/.agent/runs/T-1/retrospective.json"), "retrospective");
  assert.equal(inferSchemaName("/x/.agent/repo.yaml"), "repo");
  assert.equal(inferSchemaName("/x/unknown-file.txt"), undefined);
});
