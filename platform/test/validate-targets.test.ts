import { test } from "node:test";
import assert from "node:assert/strict";
import type { Task } from "../src/types";
import { initTempRepo, baseMission, registerMission } from "./testutil";
import * as ledger from "../src/ledger";
import * as P from "../src/paths";
import { writeJsonAtomic, ensureDir } from "../src/fsutil";
import { inferSchemaName } from "../src/validate";
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
    risk: "R2",
    inputs: [],
    outputs: ["candidate-diff"],
    budget: { attempts: 3, dollars: 3 },
    payload: { areas: ["auth"], design: { authority: "worker" }, acceptance: ["works"], verification: ["unit"] },
    status: "MERGED",
    lease: null,
    attempt: 0,
  };
}

function runCli(args: string[]): { logs: string[]; exitCode: number | undefined } {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  const logs: string[] = [];
  const original = console.log;
  console.log = (...a: unknown[]) => logs.push(a.map(String).join(" "));
  try {
    main(["node", "agent", ...args]);
    return { logs, exitCode: process.exitCode };
  } finally {
    console.log = original;
    process.exitCode = previousExitCode;
  }
}

// Fix 5a: inferSchemaName recognizes .agent/evals/<category>/<ID>.yaml at its documented depth.

test("inferSchemaName recognizes an eval case at its real depth (evals/<category>/<ID>.yaml), not just a literal 'eval(s)' parent dir", () => {
  assert.equal(inferSchemaName("/x/.agent/evals/architecture/ARCH-001.yaml"), "eval-case");
  assert.equal(inferSchemaName("/x/.agent/evals/backend/BACKEND-003.yaml"), "eval-case");
  // Still no false-positive on an unrelated directory that merely starts with "eval".
  assert.equal(inferSchemaName("/x/evaluations/whatever.yaml"), undefined);
});

// Fix 5b: `agent validate` (bare, no path args) scans .agent/evals/** and .agent/runs/**.

test("agent validate: an eval case scaffolded by `retro create --eval` is picked up and reported OK", () => {
  const repo = initTempRepo();
  registerMission(repo, baseMission());
  const id = "ACCOUNT-EVAL-1";
  ledger.writeTask(repo, MISSION_ID, implTask(id));

  runCli(["--repo", repo, "retro", "create", id, "--trigger", "architecture-rejection", "--cause", "ARCHITECTURE", "--eval"]);

  const { logs, exitCode } = runCli(["--repo", repo, "validate"]);
  const evalLine = logs.find((l) => l.includes("ARCH-001.yaml"));
  assert.ok(evalLine, `expected a validate line for the scaffolded eval case; got: ${logs.join("\n")}`);
  assert.match(evalLine!, /^OK\s+/);
  assert.match(evalLine!, /\[eval-case\]/);
  assert.notEqual(exitCode, 1);
});

test("agent validate: a run dir with an invalid retrospective.json fails", () => {
  const repo = initTempRepo();
  registerMission(repo, baseMission());
  const id = "ACCOUNT-EVAL-2";
  ledger.writeTask(repo, MISSION_ID, implTask(id));
  ensureDir(P.runDir(repo, id));
  // Missing required fields (trigger, cause, candidate_interventions, status).
  writeJsonAtomic(P.retrospectiveFile(repo, id), { task: id });

  const { logs, exitCode } = runCli(["--repo", repo, "validate"]);
  const failLine = logs.find((l) => l.includes("retrospective.json") && l.startsWith("FAIL"));
  assert.ok(failLine, `expected a FAIL line for the invalid retrospective; got: ${logs.join("\n")}`);
  assert.equal(exitCode, 1);
});

test("agent validate: a valid verification/result.json and review verdict under .agent/runs/ are picked up", () => {
  const repo = initTempRepo();
  registerMission(repo, baseMission());
  const id = "ACCOUNT-EVAL-3";
  ledger.writeTask(repo, MISSION_ID, implTask(id));
  ensureDir(P.runDir(repo, id));
  writeJsonAtomic(P.verificationResultFile(repo, id), {
    task: id,
    commit: "abc123",
    checks: [{ name: "unit", status: "PASS", evidence: "unit.json" }],
    environment: "local",
    reproducible_with: ".agent/verification/api/run.sh",
  });
  writeJsonAtomic(P.reviewVerdictFile(repo, id, "spec"), {
    lens: "spec",
    artifact: "candidate-diff",
    verdict: "PASS",
    findings: [],
    reviewer: "reviewer-1",
  });

  const { logs, exitCode } = runCli(["--repo", repo, "validate"]);
  assert.ok(logs.some((l) => l.includes("verification") && l.includes("result.json") && l.startsWith("OK")));
  assert.ok(logs.some((l) => l.includes("reviews") && l.includes("spec.json") && l.startsWith("OK")));
  assert.notEqual(exitCode, 1);
});
