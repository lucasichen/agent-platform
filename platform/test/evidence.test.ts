import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Task } from "../src/types";
import { initTempRepo, baseMission, registerMission } from "./testutil";
import * as ledger from "../src/ledger";
import { EvidenceIncompleteError } from "../src/ledger";
import { checkEvidence, scaffoldRunDir } from "../src/evidence";
import * as P from "../src/paths";
import { writeFileAtomic, writeJsonAtomic, readFileIfExists } from "../src/fsutil";
import { main } from "../src/cli";

const MISSION_ID = "MISSION-TEST-1";

function implTask(id: string): Task {
  return {
    id,
    mission: MISSION_ID,
    workflow: { id: "happy-path", version: 1, step: "build" },
    type: "implementation",
    role: "worker",
    dependencies: [],
    risk: "R2", // required_review_lenses: [spec, quality]
    inputs: [],
    outputs: ["candidate-diff"],
    budget: { attempts: 3, dollars: 3 },
    payload: { areas: ["api"], design: { authority: "worker" }, acceptance: ["works"], verification: ["unit"] },
    status: "VERIFYING",
    lease: { owner: "agent-a", expires_at: new Date(Date.now() + 60_000).toISOString() },
    attempt: 0,
  };
}

test("gate --result pass refuses when verification/result.json is entirely missing", () => {
  const repo = initTempRepo();
  registerMission(repo, baseMission());
  const id = "MISSION-TEST-1-EV-1";
  ledger.writeTask(repo, MISSION_ID, implTask(id));

  assert.throws(
    () => ledger.gateTask(repo, id, { gate: "verification", result: "pass", actor: "agent-a" }, checkEvidence),
    EvidenceIncompleteError
  );
  assert.equal(ledger.readTask(repo, id).status, "VERIFYING", "must not transition on refused gate");
});

test("evidence init scaffolds the run directory without creating result.json itself", () => {
  const repo = initTempRepo();
  registerMission(repo, baseMission());
  const id = "MISSION-TEST-1-EV-2";
  const task = implTask(id);
  ledger.writeTask(repo, MISSION_ID, task);

  const result = scaffoldRunDir(repo, task);
  assert.ok(result.created.includes("task.yaml"));
  assert.equal(fs.existsSync(P.verificationResultFile(repo, id)), false);

  // Re-running init is idempotent: nothing already present is recreated.
  const second = scaffoldRunDir(repo, task);
  assert.deepEqual(second.created, []);
  assert.ok(second.skipped.length > 0);
});

test("gate --result pass refuses when a check's evidence file does not exist", () => {
  const repo = initTempRepo();
  registerMission(repo, baseMission());
  const id = "MISSION-TEST-1-EV-3";
  const task = implTask(id);
  ledger.writeTask(repo, MISSION_ID, task);
  scaffoldRunDir(repo, task);

  writeJsonAtomic(P.verificationResultFile(repo, id), {
    task: id,
    commit: "abc123",
    checks: [{ name: "unit", status: "PASS", evidence: "unit.json" }],
    environment: "local",
    reproducible_with: ".agent/verification/api/run.sh",
  });

  const problems = checkEvidence(repo, task, "verification");
  assert.ok(problems.some((p) => p.includes("evidence not found")));
});

test("gate --result pass succeeds once evidence is complete: VERIFYING -> REVIEWING", () => {
  const repo = initTempRepo();
  registerMission(repo, baseMission());
  const id = "MISSION-TEST-1-EV-4";
  const task = implTask(id);
  ledger.writeTask(repo, MISSION_ID, task);
  scaffoldRunDir(repo, task);

  const evidenceFile = path.join(P.runDir(repo, id), "verification", "unit.json");
  writeFileAtomic(evidenceFile, "{}");
  writeJsonAtomic(P.verificationResultFile(repo, id), {
    task: id,
    commit: "abc123",
    checks: [{ name: "unit", status: "PASS", evidence: "unit.json" }],
    environment: "local",
    reproducible_with: ".agent/verification/api/run.sh",
  });

  const problems = checkEvidence(repo, task, "verification");
  assert.deepEqual(problems, []);

  const updated = ledger.gateTask(repo, id, { gate: "verification", result: "pass", actor: "agent-a" }, checkEvidence);
  assert.equal(updated.status, "REVIEWING");
});

test("review gate requires a verdict file for every risk-required lens (R2: spec, quality)", () => {
  const repo = initTempRepo();
  registerMission(repo, baseMission());
  const id = "MISSION-TEST-1-EV-5";
  const task = { ...implTask(id), status: "REVIEWING" as const };
  ledger.writeTask(repo, MISSION_ID, task);
  scaffoldRunDir(repo, task);

  let problems = checkEvidence(repo, task, "review");
  assert.ok(problems.some((p) => p.includes("required lens 'spec'")));
  assert.ok(problems.some((p) => p.includes("required lens 'quality'")));

  writeJsonAtomic(P.reviewVerdictFile(repo, id, "spec"), {
    lens: "spec",
    artifact: "candidate-diff",
    verdict: "PASS",
    findings: [],
    reviewer: "reviewer-1",
  });
  problems = checkEvidence(repo, task, "review");
  assert.ok(!problems.some((p) => p.includes("required lens 'spec'")));
  assert.ok(problems.some((p) => p.includes("required lens 'quality'")));

  writeJsonAtomic(P.reviewVerdictFile(repo, id, "quality"), {
    lens: "quality",
    artifact: "candidate-diff",
    verdict: "PASS",
    findings: [],
    reviewer: "reviewer-2",
  });
  problems = checkEvidence(repo, task, "review");
  assert.deepEqual(problems, []);

  const updated = ledger.gateTask(repo, id, { gate: "review", result: "pass", actor: "agent-a" }, checkEvidence);
  assert.equal(updated.status, "MERGE_READY");
});

// Fix 10: `agent task claim` scaffolds .agent/runs/<TASK-ID>/, idempotently.

function runCli(args: string[]): void {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    main(["node", "agent", ...args]);
  } finally {
    process.exitCode = previousExitCode;
  }
}

test("task claim scaffolds the run directory (spec Appendix B: 'scaffolded at claim time')", () => {
  const repo = initTempRepo();
  registerMission(repo, baseMission());
  const id = "MISSION-TEST-1-EV-CLAIM-1";
  const task = { ...implTask(id), status: "READY" as const, lease: null };
  ledger.writeTask(repo, MISSION_ID, task);

  assert.equal(fs.existsSync(P.runDir(repo, id)), false);
  runCli(["--repo", repo, "task", "claim", id, "--agent", "agent-a"]);

  assert.ok(fs.existsSync(P.runTaskFile(repo, id)));
  assert.ok(fs.existsSync(P.transitionsFile(repo, id)));
  assert.ok(fs.existsSync(P.costFile(repo, id)));
  assert.ok(fs.existsSync(path.join(P.runDir(repo, id), "verification")));
  assert.ok(fs.existsSync(path.join(P.runDir(repo, id), "reviews")));
});

test("task claim's scaffold never clobbers evidence already collected (idempotent, skip-existing)", () => {
  const repo = initTempRepo();
  registerMission(repo, baseMission());
  const id = "MISSION-TEST-1-EV-CLAIM-2";
  const task = { ...implTask(id), status: "READY" as const, lease: null };
  ledger.writeTask(repo, MISSION_ID, task);

  runCli(["--repo", repo, "task", "claim", id, "--agent", "agent-a"]);
  // Simulate work already recorded on this run.
  writeFileAtomic(path.join(P.runDir(repo, id), "decisions.tsv"), "ts\tdecision\trationale\n2026-01-01\tchose X\tbecause Y\n");

  // Force the lease into the past (as ledger-lease.test.ts does) and reclaim, so a second claim is legal.
  const claimed = ledger.readTask(repo, id);
  claimed.lease = { owner: "agent-a", expires_at: new Date(Date.now() - 60_000).toISOString() };
  ledger.writeTask(repo, MISSION_ID, claimed);
  ledger.reclaimExpired(repo);

  runCli(["--repo", repo, "task", "claim", id, "--agent", "agent-b"]);

  const decisions = readFileIfExists(path.join(P.runDir(repo, id), "decisions.tsv"));
  assert.match(decisions ?? "", /chose X/, "claim's scaffold must never overwrite existing run-dir content");
});

test("a FAIL verdict on a required lens is treated as incomplete evidence for a pass gate", () => {
  const repo = initTempRepo();
  registerMission(repo, baseMission());
  const id = "MISSION-TEST-1-EV-6";
  const task = { ...implTask(id), status: "REVIEWING" as const };
  ledger.writeTask(repo, MISSION_ID, task);
  scaffoldRunDir(repo, task);

  writeJsonAtomic(P.reviewVerdictFile(repo, id, "spec"), {
    lens: "spec",
    artifact: "candidate-diff",
    verdict: "FAIL",
    findings: [{ kind: "unsupported-claim", detail: "no ref" }],
    reviewer: "reviewer-1",
  });
  writeJsonAtomic(P.reviewVerdictFile(repo, id, "quality"), {
    lens: "quality",
    artifact: "candidate-diff",
    verdict: "PASS",
    findings: [],
    reviewer: "reviewer-2",
  });

  const problems = checkEvidence(repo, task, "review");
  assert.ok(problems.some((p) => p.includes("verdict is FAIL")));
  assert.throws(() => ledger.gateTask(repo, id, { gate: "review", result: "pass", actor: "agent-a" }, checkEvidence), EvidenceIncompleteError);
});
