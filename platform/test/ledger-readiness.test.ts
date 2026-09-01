import { test } from "node:test";
import assert from "node:assert/strict";
import type { Task } from "../src/types";
import { makeTempRepo, baseMission, registerMission } from "./testutil";
import * as ledger from "../src/ledger";
import * as P from "../src/paths";
import { writeJsonAtomic } from "../src/fsutil";

const MISSION_ID = "MISSION-TEST-1";

function task(id: string, deps: string[], status: Task["status"], type: Task["type"] = "research"): Task {
  return {
    id,
    mission: MISSION_ID,
    workflow: { id: "happy-path", version: 1, step: id },
    type,
    role: "worker",
    dependencies: deps,
    risk: "R1",
    inputs: [],
    outputs: [],
    budget: { attempts: 3, dollars: 1 },
    payload: type === "implementation" ? { areas: [], design: { authority: "worker" }, acceptance: [], verification: [] } : {},
    status,
    blocked_reason: status === "BLOCKED" ? "dependencies-not-satisfied" : undefined,
    lease: null,
    attempt: 0,
  };
}

test("a task is READY only once every dependency is DONE", () => {
  const repo = makeTempRepo();
  registerMission(repo, baseMission());
  const upstreamId = "MISSION-TEST-1-UP";
  const downstreamId = "MISSION-TEST-1-DOWN";
  ledger.writeTask(repo, MISSION_ID, task(upstreamId, [], "GATING"));
  ledger.writeTask(repo, MISSION_ID, task(downstreamId, [upstreamId], "BLOCKED"));

  // Upstream not DONE yet: refreshing readiness must not unblock downstream.
  let refreshed = ledger.refreshReadiness(repo, MISSION_ID);
  assert.deepEqual(refreshed, []);
  assert.equal(ledger.readTask(repo, downstreamId).status, "BLOCKED");

  // Reaching a dependency-satisfying state refreshes readiness automatically
  // (no separate call needed) so dependents unblock as part of the same
  // gate/done command that completed the upstream task.
  ledger.gateTask(repo, upstreamId, { gate: "review", result: "pass", actor: "a" }, () => []);
  assert.equal(ledger.readTask(repo, upstreamId).status, "DONE");
  assert.equal(ledger.readTask(repo, downstreamId).status, "READY");

  // A subsequent explicit refresh is then a no-op: already satisfied.
  refreshed = ledger.refreshReadiness(repo, MISSION_ID);
  assert.deepEqual(refreshed, []);
});

test("MERGED (an implementation task's DONE point) satisfies dependents", () => {
  const repo = makeTempRepo();
  registerMission(repo, baseMission());
  const implId = "MISSION-TEST-1-IMPL";
  const downstreamId = "MISSION-TEST-1-DOWN2";
  ledger.writeTask(repo, MISSION_ID, task(implId, [], "MERGE_READY", "implementation"));
  ledger.writeTask(repo, MISSION_ID, task(downstreamId, [implId], "BLOCKED"));

  // `task done` refuses MERGE_READY -> MERGED without a four-gate result.json (spec F.9, fix 2).
  writeJsonAtomic(P.resultFile(repo, implId), {
    task: implId,
    commit: "UNKNOWN",
    functional: "PASS",
    specification: "SKIPPED",
    architecture: "SKIPPED",
    evolutionary: "SKIPPED",
    verifier: "agent-a",
  });

  ledger.doneTask(repo, implId, "merge-refinery");
  assert.equal(ledger.readTask(repo, implId).status, "MERGED");
  assert.equal(ledger.readTask(repo, downstreamId).status, "READY", "MERGED must satisfy dependents automatically");
});

test("readiness refresh never auto-recovers a budget-exhausted or manually-failed task", () => {
  const repo = makeTempRepo();
  registerMission(repo, baseMission());
  const id = "MISSION-TEST-1-FAILED";
  ledger.writeTask(repo, MISSION_ID, task(id, [], "RUNNING"));
  ledger.failTask(repo, id, "operator-decided-abandon", "cli-operator");
  assert.equal(ledger.readTask(repo, id).status, "BLOCKED");

  const refreshed = ledger.refreshReadiness(repo, MISSION_ID);
  assert.deepEqual(refreshed, []);
  assert.equal(ledger.readTask(repo, id).status, "BLOCKED", "must stay BLOCKED for a human, not silently recover");
});
