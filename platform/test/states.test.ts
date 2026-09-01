import { test } from "node:test";
import assert from "node:assert/strict";
import { assertLegalTransition, IllegalTransitionError, legalNextStates } from "../src/states";
import type { Task } from "../src/types";

function genericTask(status: Task["status"]): Pick<Task, "id" | "status" | "type"> {
  return { id: "T-1", status, type: "research" };
}

function implTask(status: Task["status"]): Pick<Task, "id" | "status" | "type"> {
  return { id: "T-2", status, type: "implementation" };
}

test("generic lifecycle: legal transitions succeed", () => {
  assertLegalTransition(genericTask("BLOCKED"), "READY");
  assertLegalTransition(genericTask("READY"), "ASSIGNED");
  assertLegalTransition(genericTask("ASSIGNED"), "RUNNING");
  assertLegalTransition(genericTask("RUNNING"), "GATING");
  assertLegalTransition(genericTask("GATING"), "DONE");
  assertLegalTransition(genericTask("GATING"), "REPAIR");
  assertLegalTransition(genericTask("REPAIR"), "RUNNING");
  assertLegalTransition(genericTask("REPAIR"), "READY");
});

test("generic lifecycle: illegal transitions rejected with a clear error", () => {
  assert.throws(() => assertLegalTransition(genericTask("READY"), "RUNNING"), IllegalTransitionError);
  assert.throws(() => assertLegalTransition(genericTask("BLOCKED"), "DONE"), IllegalTransitionError);
  assert.throws(() => assertLegalTransition(genericTask("DONE"), "RUNNING"), IllegalTransitionError);

  try {
    assertLegalTransition(genericTask("READY"), "RUNNING");
    assert.fail("expected throw");
  } catch (e) {
    if (!(e instanceof IllegalTransitionError)) throw e;
    assert.match(e.message, /READY -> RUNNING/);
    assert.match(e.message, /Legal next state/);
  }
});

test("generic lifecycle: cannot reach implementation-only states", () => {
  assert.throws(() => assertLegalTransition(genericTask("RUNNING"), "VERIFYING"), IllegalTransitionError);
  assert.throws(() => assertLegalTransition(genericTask("GATING"), "MERGE_READY"), IllegalTransitionError);
});

test("implementation lifecycle: legal transitions succeed", () => {
  assertLegalTransition(implTask("RUNNING"), "VERIFYING");
  assertLegalTransition(implTask("VERIFYING"), "REVIEWING");
  assertLegalTransition(implTask("VERIFYING"), "REPAIR");
  assertLegalTransition(implTask("REPAIR"), "RUNNING");
  assertLegalTransition(implTask("REVIEWING"), "MERGE_READY");
  assertLegalTransition(implTask("REVIEWING"), "REPAIR");
  assertLegalTransition(implTask("MERGE_READY"), "MERGED");
  assertLegalTransition(implTask("MERGED"), "DEPLOYED");
  assertLegalTransition(implTask("DEPLOYED"), "PRODUCTION_VERIFIED");
});

test("implementation lifecycle: cannot reach generic-only states", () => {
  assert.throws(() => assertLegalTransition(implTask("RUNNING"), "GATING"), IllegalTransitionError);
  assert.throws(() => assertLegalTransition(implTask("VERIFYING"), "DONE"), IllegalTransitionError);
});

test("implementation lifecycle: skipping VERIFYING/REVIEWING is illegal", () => {
  assert.throws(() => assertLegalTransition(implTask("RUNNING"), "MERGE_READY"), IllegalTransitionError);
  assert.throws(() => assertLegalTransition(implTask("RUNNING"), "MERGED"), IllegalTransitionError);
});

test("legalNextStates lists only reachable states for the task's type", () => {
  const generic = legalNextStates(genericTask("RUNNING"));
  assert.deepEqual(generic.sort(), ["BLOCKED", "GATING", "READY"].sort());

  const impl = legalNextStates(implTask("RUNNING"));
  assert.deepEqual(impl.sort(), ["BLOCKED", "READY", "VERIFYING"].sort());
});

test("DONE and PRODUCTION_VERIFIED are terminal (no legal next states)", () => {
  assert.deepEqual(legalNextStates(genericTask("DONE")), []);
  assert.deepEqual(legalNextStates(implTask("PRODUCTION_VERIFIED")), []);
});
