import { test } from "node:test";
import assert from "node:assert/strict";
import type { RiskLevel, Task } from "../src/types";
import { initTempRepo } from "./testutil";
import { resolveRoute } from "../src/router";

function taskWithRisk(risk: RiskLevel): Task {
  return {
    id: `T-${risk}`,
    mission: "M",
    workflow: { id: "happy-path", version: 1, step: "x" },
    type: "implementation",
    role: "worker",
    dependencies: [],
    risk,
    inputs: [],
    outputs: [],
    budget: { attempts: 1, dollars: 1 },
    payload: { areas: [], design: { authority: "x" }, acceptance: [], verification: [] },
    status: "READY",
    lease: null,
    attempt: 0,
  };
}

test("route resolves R0 to the cheapest, lightest-process policy row", () => {
  const repo = initTempRepo();
  const r = resolveRoute(repo, taskWithRisk("R0"));
  assert.equal(r.planning_tier, "cheap");
  assert.equal(r.implementation_tier, "cheap");
  assert.equal(r.verification_depth, "deterministic");
  assert.deepEqual(r.required_review_lenses, []);
  assert.equal(r.human_approval, false);
  assert.equal(r.staged_release, false);
  assert.equal(r.provenance.risk_policy_row, "/levels/R0");
});

test("route resolves R1: cheap + smoke verification", () => {
  const repo = initTempRepo();
  const r = resolveRoute(repo, taskWithRisk("R1"));
  assert.equal(r.planning_tier, "cheap");
  assert.equal(r.implementation_tier, "cheap");
  assert.equal(r.verification_depth, "smoke");
});

test("route resolves R2: mid tier, runtime verification, spec+quality review", () => {
  const repo = initTempRepo();
  const r = resolveRoute(repo, taskWithRisk("R2"));
  assert.equal(r.planning_tier, "mid");
  assert.equal(r.implementation_tier, "mid");
  assert.equal(r.verification_depth, "runtime");
  assert.deepEqual(r.required_review_lenses, ["spec", "quality"]);
});

test("route resolves R3: strong planning, mid (bounded) implementation, architecture review added", () => {
  const repo = initTempRepo();
  const r = resolveRoute(repo, taskWithRisk("R3"));
  assert.equal(r.planning_tier, "strong");
  assert.equal(r.implementation_tier, "mid");
  assert.equal(r.verification_depth, "isolated-runtime");
  assert.deepEqual(r.required_review_lenses, ["spec", "quality", "architecture"]);
});

test("route resolves R4: frontier planning, every review lens, human approval, staged release", () => {
  const repo = initTempRepo();
  const r = resolveRoute(repo, taskWithRisk("R4"));
  assert.equal(r.planning_tier, "frontier");
  assert.equal(r.implementation_tier, "strong");
  assert.deepEqual(r.required_review_lenses, ["spec", "quality", "architecture", "security"]);
  assert.deepEqual(r.human_approval, ["security-approval", "release-approval"]);
  assert.equal(r.staged_release, true);
});

test("route reports provenance: which policy files and which row/pointer resolved each field", () => {
  const repo = initTempRepo();
  const r = resolveRoute(repo, taskWithRisk("R3"));
  assert.match(r.provenance.risk_policy_file, /risk\.yaml$/);
  assert.match(r.provenance.models_policy_file, /models\.yaml$/);
  assert.equal(r.provenance.risk_policy_row, "/levels/R3");
  assert.equal(r.provenance.active_profile, "generic");
  assert.equal(r.provenance.planning_model_pointer, "/profiles/generic/strong");
  assert.equal(r.provenance.implementation_model_pointer, "/profiles/generic/mid");
  // The active profile is 'generic' (vendor-neutral capability descriptions), so
  // both resolved model fields should be populated strings, not vendor names.
  assert.ok(typeof r.planning_model === "string" && r.planning_model.length > 0);
});

test("route is a pure static-table lookup: identical inputs resolve identically (no statistics)", () => {
  const repo = initTempRepo();
  const a = resolveRoute(repo, taskWithRisk("R2"));
  const b = resolveRoute(repo, taskWithRisk("R2"));
  assert.deepEqual(a, b);
});
