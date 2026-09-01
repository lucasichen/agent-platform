import { test } from "node:test";
import assert from "node:assert/strict";
import type { Task } from "../src/types";
import { makeTempRepo, baseMission, registerMission } from "./testutil";
import * as ledger from "./../src/ledger";

function readyTask(id: string): Task {
  return {
    id,
    mission: "MISSION-TEST-1",
    workflow: { id: "happy-path", version: 1, step: "research" },
    type: "research",
    role: "uncertainty-resolver",
    dependencies: [],
    risk: "R1",
    inputs: [],
    outputs: [],
    budget: { attempts: 3, dollars: 1 },
    payload: {},
    status: "READY",
    lease: null,
    attempt: 0,
  };
}

function setup() {
  const repo = makeTempRepo();
  registerMission(repo, baseMission());
  const task = readyTask("MISSION-TEST-1-LEASE");
  ledger.writeTask(repo, "MISSION-TEST-1", task);
  return repo;
}

test("claim: READY -> ASSIGNED with a lease", () => {
  const repo = setup();
  const task = ledger.claimTask(repo, "MISSION-TEST-1-LEASE", "agent-a", 30);
  assert.equal(task.status, "ASSIGNED");
  assert.equal(task.lease?.owner, "agent-a");
  assert.ok(new Date(task.lease!.expires_at).getTime() > Date.now());
});

test("claim: a validly-leased task cannot be claimed again", () => {
  const repo = setup();
  ledger.claimTask(repo, "MISSION-TEST-1-LEASE", "agent-a", 30);
  assert.throws(() => ledger.claimTask(repo, "MISSION-TEST-1-LEASE", "agent-b", 30), /already claimed by 'agent-a'/);
});

test("reclaim: a task with an expired lease is not reclaimed early", () => {
  const repo = setup();
  ledger.claimTask(repo, "MISSION-TEST-1-LEASE", "agent-a", 30);
  const results = ledger.reclaimExpired(repo);
  assert.deepEqual(results, []);
  const task = ledger.readTask(repo, "MISSION-TEST-1-LEASE");
  assert.equal(task.status, "ASSIGNED");
});

test("reclaim: expired lease -> READY, attempt preserved, transition logged", () => {
  const repo = setup();
  ledger.claimTask(repo, "MISSION-TEST-1-LEASE", "agent-a", 30);
  ledger.startTask(repo, "MISSION-TEST-1-LEASE", "agent-a");

  // Simulate a crashed worker: force the lease into the past directly on disk.
  const task = ledger.readTask(repo, "MISSION-TEST-1-LEASE");
  task.attempt = 1;
  task.lease = { owner: "agent-a", expires_at: new Date(Date.now() - 60_000).toISOString() };
  ledger.writeTask(repo, "MISSION-TEST-1", task);

  const results = ledger.reclaimExpired(repo);
  assert.equal(results.length, 1);
  assert.equal(results[0]!.taskId, "MISSION-TEST-1-LEASE");
  assert.equal(results[0]!.from, "RUNNING");
  assert.equal(results[0]!.previousOwner, "agent-a");

  const reclaimed = ledger.readTask(repo, "MISSION-TEST-1-LEASE");
  assert.equal(reclaimed.status, "READY");
  assert.equal(reclaimed.lease, null);
  assert.equal(reclaimed.attempt, 1, "attempt count must be preserved across reclaim");

  const transitions = ledger.readTransitions(repo, "MISSION-TEST-1-LEASE");
  const last = transitions[transitions.length - 1]!;
  assert.equal(last.from, "RUNNING");
  assert.equal(last.to, "READY");
  assert.equal(last.actor, "system");
  assert.match(last.reason, /lease expired/);
  assert.ok(last.ts);

  // Now claimable again by a different owner.
  const reclaimedTask = ledger.claimTask(repo, "MISSION-TEST-1-LEASE", "agent-b", 30);
  assert.equal(reclaimedTask.lease?.owner, "agent-b");
});

test("every transition is appended to transitions.jsonl as {ts, from, to, actor, reason}", () => {
  const repo = setup();
  ledger.claimTask(repo, "MISSION-TEST-1-LEASE", "agent-a", 30);
  ledger.startTask(repo, "MISSION-TEST-1-LEASE", "agent-a");
  const transitions = ledger.readTransitions(repo, "MISSION-TEST-1-LEASE");
  assert.equal(transitions.length, 2);
  for (const t of transitions) {
    assert.ok(typeof t.ts === "string");
    assert.ok(typeof t.from === "string");
    assert.ok(typeof t.to === "string");
    assert.ok(typeof t.actor === "string");
    assert.ok(typeof t.reason === "string");
  }
  assert.deepEqual(
    transitions.map((t) => [t.from, t.to]),
    [
      ["READY", "ASSIGNED"],
      ["ASSIGNED", "RUNNING"],
    ]
  );
});
