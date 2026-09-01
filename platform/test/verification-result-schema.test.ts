import { test } from "node:test";
import assert from "node:assert/strict";
import { collectProblems } from "../src/validate";

// Fix 13: schemas/verification-result.schema.json must accept what the
// shipped verification scaffold legitimately emits (task/commit null, and
// per-check classification/note/error per the §9.5 flake policy), while
// still rejecting a genuinely unknown property.

function baseResult(overrides: Record<string, unknown> = {}) {
  return {
    task: "ACCOUNT-12",
    commit: "abc123",
    checks: [{ name: "unit", status: "PASS", evidence: "unit.json" }],
    environment: "local",
    reproducible_with: ".agent/verification/api/run.sh",
    ...overrides,
  };
}

test("verification-result accepts commit:null and task:null (no-git / no-task-id scaffold output)", () => {
  assert.deepEqual(collectProblems("verification-result", baseResult({ task: null, commit: null })), []);
});

test("verification-result accepts a check carrying classification/note/error (spec §9.5 flake policy)", () => {
  const result = baseResult({
    checks: [
      {
        name: "web:sign-up",
        status: "FAIL",
        evidence: "logs/web-sign-up-attempt1.json, logs/web-sign-up-attempt2.json",
        classification: "UNCLASSIFIED",
        note: "inconsistent across retry (flake candidate)",
        error: "expected 200, got 500",
      },
    ],
  });
  assert.deepEqual(collectProblems("verification-result", result), []);
});

test("verification-result accepts every documented classification value", () => {
  for (const classification of ["PRODUCT FAILURE", "ENVIRONMENT FAILURE", "FLAKE", "UNCLASSIFIED"]) {
    const result = baseResult({ checks: [{ name: "unit", status: "FAIL", evidence: "unit.json", classification }] });
    assert.deepEqual(collectProblems("verification-result", result), [], `classification '${classification}' must be accepted`);
  }
});

test("verification-result still rejects an unknown check property (additionalProperties: false preserved)", () => {
  const result = baseResult({ checks: [{ name: "unit", status: "PASS", evidence: "unit.json", totallyMadeUp: true }] });
  assert.ok(collectProblems("verification-result", result).length > 0);
});

test("verification-result still rejects an unknown top-level property", () => {
  const result = baseResult({ totallyMadeUp: true });
  assert.ok(collectProblems("verification-result", result).length > 0);
});

test("verification-result still requires task/commit to be present (even if null)", () => {
  const { task: _task, ...withoutTask } = baseResult();
  assert.ok(collectProblems("verification-result", withoutTask).length > 0);
});
