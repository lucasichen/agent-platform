import { test } from "node:test";
import assert from "node:assert/strict";
import type { Task } from "../src/types";
import { makeTempRepo, baseMission, registerMission } from "./testutil";
import * as ledger from "../src/ledger";

const MISSION_ID = "MISSION-TEST-1";

function makeGenericTask(id: string, attempts: number): Task {
  return {
    id,
    mission: MISSION_ID,
    workflow: { id: "happy-path", version: 1, step: "research" },
    type: "research",
    role: "uncertainty-resolver",
    dependencies: [],
    risk: "R1",
    inputs: [],
    outputs: [],
    budget: { attempts, dollars: 1 },
    payload: {},
    status: "RUNNING",
    lease: { owner: "agent-a", expires_at: new Date(Date.now() + 60_000).toISOString() },
    attempt: 0,
  };
}

const noEvidenceProblems = () => [];

test("gate fail increments attempt and stays in REPAIR while within budget", () => {
  const repo = makeTempRepo();
  registerMission(repo, baseMission());
  const id = "MISSION-TEST-1-BUDGET-1";
  ledger.writeTask(repo, MISSION_ID, makeGenericTask(id, 2));

  ledger.submitTask(repo, id, "agent-a"); // RUNNING -> GATING
  let task = ledger.gateTask(repo, id, { gate: "review", result: "fail", actor: "agent-a" }, noEvidenceProblems);
  assert.equal(task.status, "REPAIR");
  assert.equal(task.attempt, 1);
  assert.equal(task.blocked_reason, undefined);

  task = ledger.startTask(repo, id, "agent-a"); // REPAIR -> RUNNING
  assert.equal(task.status, "RUNNING");
  ledger.submitTask(repo, id, "agent-a");
  task = ledger.gateTask(repo, id, { gate: "review", result: "fail", actor: "agent-a" }, noEvidenceProblems);
  assert.equal(task.status, "REPAIR", "attempt 2 of 2 must still be within budget");
  assert.equal(task.attempt, 2);
});

test("budget.attempts exceeded -> BLOCKED with reason budget-exhausted (never advisory)", () => {
  const repo = makeTempRepo();
  registerMission(repo, baseMission());
  const id = "MISSION-TEST-1-BUDGET-2";
  ledger.writeTask(repo, MISSION_ID, makeGenericTask(id, 2));

  for (let i = 0; i < 2; i++) {
    ledger.submitTask(repo, id, "agent-a");
    ledger.gateTask(repo, id, { gate: "review", result: "fail", actor: "agent-a" }, noEvidenceProblems);
    ledger.startTask(repo, id, "agent-a");
  }
  // Third submit+fail exceeds budget.attempts=2.
  ledger.submitTask(repo, id, "agent-a");
  const task = ledger.gateTask(repo, id, { gate: "review", result: "fail", actor: "agent-a" }, noEvidenceProblems);

  assert.equal(task.status, "BLOCKED");
  assert.equal(task.blocked_reason, "budget-exhausted");
  assert.equal(task.attempt, 3);
  assert.equal(task.lease, null);

  const transitions = ledger.readTransitions(repo, id);
  const last = transitions[transitions.length - 1]!;
  assert.equal(last.to, "BLOCKED");
  assert.match(last.reason, /budget-exhausted/);
});

test("a budget-exhausted task is surfaced by `agent status` as an exception", async () => {
  const repo = makeTempRepo();
  registerMission(repo, baseMission());
  const id = "MISSION-TEST-1-BUDGET-3";
  ledger.writeTask(repo, MISSION_ID, makeGenericTask(id, 1));
  // budget.attempts=1: the rule is `attempt > budget.attempts` (DESIGN.md §6
  // item 3), so exhaustion requires a second failed attempt.
  ledger.submitTask(repo, id, "agent-a");
  ledger.gateTask(repo, id, { gate: "review", result: "fail", actor: "agent-a" }, noEvidenceProblems);
  ledger.startTask(repo, id, "agent-a");
  ledger.submitTask(repo, id, "agent-a");
  ledger.gateTask(repo, id, { gate: "review", result: "fail", actor: "agent-a" }, noEvidenceProblems);

  const { buildStatusReport } = await import("../src/status");
  const report = buildStatusReport(repo);
  assert.equal(report.exceptions.budget_exhausted.length, 1);
  assert.equal(report.exceptions.budget_exhausted[0]!.task, id);
});

test("REPAIR is not a legal predecessor of DONE without a passing gate", () => {
  const repo = makeTempRepo();
  registerMission(repo, baseMission());
  const id = "MISSION-TEST-1-BUDGET-4";
  ledger.writeTask(repo, MISSION_ID, makeGenericTask(id, 3));
  ledger.submitTask(repo, id, "agent-a");
  ledger.gateTask(repo, id, { gate: "review", result: "fail", actor: "agent-a" }, noEvidenceProblems);
  assert.throws(() => ledger.gateTask(repo, id, { gate: "review", result: "pass", actor: "agent-a" }, noEvidenceProblems));
});
