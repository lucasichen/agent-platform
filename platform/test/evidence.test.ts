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
import { writeFileAtomic, writeJsonAtomic } from "../src/fsutil";

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
