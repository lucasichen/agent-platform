import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import type { Task } from "../src/types";
import { initTempRepo, baseMission, registerMission } from "./testutil";
import * as ledger from "../src/ledger";
import { FourGateResultError } from "../src/ledger";
import { checkEvidence, scaffoldRunDir } from "../src/evidence";
import * as P from "../src/paths";
import { readJson, writeFileAtomic, writeJsonAtomic } from "../src/fsutil";
import { collectProblems } from "../src/validate";

const MISSION_ID = "MISSION-TEST-1";

function implTask(id: string, risk: Task["risk"] = "R2"): Task {
  return {
    id,
    mission: MISSION_ID,
    workflow: { id: "happy-path", version: 1, step: "build" },
    type: "implementation",
    role: "worker",
    dependencies: [],
    risk,
    inputs: [],
    outputs: ["candidate-diff"],
    budget: { attempts: 3, dollars: 3 },
    payload: { areas: ["api"], design: { authority: "worker" }, acceptance: ["works"], verification: ["unit"] },
    status: "REVIEWING",
    lease: { owner: "agent-a", expires_at: new Date(Date.now() + 60_000).toISOString() },
    attempt: 0,
  };
}

function passReview(repo: string, id: string, task: Task): void {
  scaffoldRunDir(repo, task);
  const lenses = task.risk === "R2" ? ["spec", "quality"] : [];
  for (const lens of lenses) {
    writeJsonAtomic(P.reviewVerdictFile(repo, id, lens), {
      lens,
      artifact: "candidate-diff",
      verdict: "PASS",
      findings: [],
      reviewer: "reviewer-1",
    });
  }
}

// Fix 2: writing result.json on review-gate pass.

test("review gate pass writes a schema-valid result.json: functional PASS, required lenses PASS, non-required lenses SKIPPED", () => {
  const repo = initTempRepo();
  registerMission(repo, baseMission());
  const id = "MISSION-TEST-1-RESULT-1";
  const task = implTask(id, "R2"); // required_review_lenses: [spec, quality]
  ledger.writeTask(repo, MISSION_ID, task);
  passReview(repo, id, task);

  const updated = ledger.gateTask(repo, id, { gate: "review", result: "pass", actor: "reviewer-1" }, checkEvidence);
  assert.equal(updated.status, "MERGE_READY");

  const resultPath = P.resultFile(repo, id);
  assert.ok(fs.existsSync(resultPath), "result.json must be written on review-gate pass");
  const result = readJson<Record<string, unknown>>(resultPath);
  assert.deepEqual(collectProblems("result", result), []);
  assert.equal(result.task, id);
  assert.equal(result.functional, "PASS");
  assert.equal(result.specification, "PASS"); // spec is required for R2
  assert.equal(result.architecture, "SKIPPED"); // architecture lens not required for R2
  assert.equal(result.evolutionary, "PASS"); // quality is required for R2
  assert.equal(result.verifier, "reviewer-1");
  assert.equal(result.commit, "UNKNOWN"); // initTempRepo is not a git repo
});

test("review gate pass at R1 (no required lenses): specification/architecture/evolutionary all SKIPPED", () => {
  const repo = initTempRepo();
  registerMission(repo, baseMission());
  const id = "MISSION-TEST-1-RESULT-2";
  const task = implTask(id, "R1"); // required_review_lenses: []
  ledger.writeTask(repo, MISSION_ID, task);
  passReview(repo, id, task);

  ledger.gateTask(repo, id, { gate: "review", result: "pass", actor: "reviewer-2" }, checkEvidence);
  const result = readJson<Record<string, unknown>>(P.resultFile(repo, id));
  assert.equal(result.specification, "SKIPPED");
  assert.equal(result.architecture, "SKIPPED");
  assert.equal(result.evolutionary, "SKIPPED");
});

test("verification-gate pass does not write result.json (only the review gate does)", () => {
  const repo = initTempRepo();
  registerMission(repo, baseMission());
  const id = "MISSION-TEST-1-RESULT-3";
  const task = { ...implTask(id, "R1"), status: "VERIFYING" as const };
  ledger.writeTask(repo, MISSION_ID, task);
  scaffoldRunDir(repo, task);
  const evidenceFile = P.runDir(repo, id) + "/verification/unit.json";
  writeFileAtomic(evidenceFile, "{}");
  writeJsonAtomic(P.verificationResultFile(repo, id), {
    task: id,
    commit: "abc123",
    checks: [{ name: "unit", status: "PASS", evidence: "unit.json" }],
    environment: "local",
    reproducible_with: ".agent/verification/api/run.sh",
  });

  ledger.gateTask(repo, id, { gate: "verification", result: "pass", actor: "agent-a" }, checkEvidence);
  assert.equal(fs.existsSync(P.resultFile(repo, id)), false);
});

// Fix 2: `task done` refuses MERGE_READY -> MERGED without a valid result.json.

test("task done refuses when result.json is missing", () => {
  const repo = initTempRepo();
  registerMission(repo, baseMission());
  const id = "MISSION-TEST-1-RESULT-4";
  const task = { ...implTask(id, "R1"), status: "MERGE_READY" as const };
  ledger.writeTask(repo, MISSION_ID, task);

  assert.throws(() => ledger.doneTask(repo, id, "merge-refinery"), FourGateResultError);
  assert.equal(ledger.readTask(repo, id).status, "MERGE_READY", "must not transition on a refused done");
});

test("task done refuses when result.json is schema-invalid", () => {
  const repo = initTempRepo();
  registerMission(repo, baseMission());
  const id = "MISSION-TEST-1-RESULT-5";
  const task = { ...implTask(id, "R1"), status: "MERGE_READY" as const };
  ledger.writeTask(repo, MISSION_ID, task);
  writeJsonAtomic(P.resultFile(repo, id), { task: id, commit: "abc" }); // missing required gate fields

  assert.throws(() => ledger.doneTask(repo, id, "merge-refinery"), FourGateResultError);
});

test("task done succeeds once a schema-valid result.json for the right task is present", () => {
  const repo = initTempRepo();
  registerMission(repo, baseMission());
  const id = "MISSION-TEST-1-RESULT-6";
  const task = implTask(id, "R2");
  ledger.writeTask(repo, MISSION_ID, task);
  passReview(repo, id, task);
  ledger.gateTask(repo, id, { gate: "review", result: "pass", actor: "reviewer-1" }, checkEvidence);

  const updated = ledger.doneTask(repo, id, "merge-refinery");
  assert.equal(updated.status, "MERGED");
});
