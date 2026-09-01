import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { Task } from "../src/types";
import { initTempRepo, baseMission, registerMission } from "./testutil";
import * as ledger from "../src/ledger";
import * as P from "../src/paths";
import { readYaml, writeJsonAtomic, ensureDir } from "../src/fsutil";
import { validateOrThrow, collectProblems } from "../src/validate";
import { createEvalFromRetro, listEvalCases, EvalError } from "../src/evals";
import { main } from "../src/cli";

const MISSION_ID = "MISSION-TEST-1";
const FIXTURES = path.join(__dirname, "fixtures", "evals");

function implTask(id: string, overrides: Partial<Task> = {}): Task {
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
    payload: {
      areas: ["auth"],
      design: { authority: "worker", required_seams: ["SessionService.revokeAll"], forbidden: ["direct session persistence mutation"] },
      acceptance: ["works"],
      verification: ["unit"],
    },
    status: "MERGED",
    lease: null,
    attempt: 0,
    ...overrides,
  };
}

function installFixtureRetro(repo: string, taskId: string): void {
  const data = JSON.parse(fs.readFileSync(path.join(FIXTURES, "retrospective.json"), "utf8"));
  data.task = taskId;
  ensureDir(P.runDir(repo, taskId));
  writeJsonAtomic(P.retrospectiveFile(repo, taskId), data);
}

function setupRepoWithRetro(taskId: string): string {
  const repo = initTempRepo();
  registerMission(repo, baseMission());
  ledger.writeTask(repo, MISSION_ID, implTask(taskId));
  installFixtureRetro(repo, taskId);
  return repo;
}

// -------------------------------------------------------------- create

test("eval create --from-retro: schema-conformant, category default from cause (ARCHITECTURE -> architecture -> ARCH-001)", () => {
  const repo = setupRepoWithRetro("ACCOUNT-12");
  const result = createEvalFromRetro(repo, "ACCOUNT-12");

  assert.equal(result.evalCase.id, "ARCH-001");
  assert.equal(result.relFile, ".agent/evals/architecture/ARCH-001.yaml");
  assert.ok(fs.existsSync(result.file));
  assert.deepEqual(collectProblems("eval-case", result.evalCase), []);
  assert.doesNotThrow(() => validateOrThrow("eval-case", readYaml(result.file), result.file));
});

test("eval create --from-retro: required/forbidden seeded from task.payload.design; known_failure from retro cause+detail", () => {
  const repo = setupRepoWithRetro("ACCOUNT-13");
  const result = createEvalFromRetro(repo, "ACCOUNT-13");

  assert.deepEqual(result.evalCase.required, ["SessionService.revokeAll"]);
  assert.deepEqual(result.evalCase.forbidden, ["direct session persistence mutation"]);
  assert.match(result.evalCase.known_failure, /ARCHITECTURE/);
  assert.match(result.evalCase.known_failure, /SessionService\.revokeAll/);
  assert.match(result.evalCase.task, /ACCOUNT-13/);
});

test("eval create --from-retro: repo_snapshot is 'UNPINNED' with a warning when the repo is not git", () => {
  const repo = setupRepoWithRetro("ACCOUNT-14");
  const result = createEvalFromRetro(repo, "ACCOUNT-14");

  assert.equal(result.evalCase.repo_snapshot, "UNPINNED");
  assert.ok(result.warning && /UNPINNED/.test(result.warning));
});

test("eval create --from-retro: repo_snapshot pins the real commit SHA when the repo is git", () => {
  const repo = setupRepoWithRetro("ACCOUNT-15");
  execFileSync("git", ["init", "--quiet"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "README.md"), "scratch\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repo });
  execFileSync("git", ["commit", "--quiet", "-m", "initial"], { cwd: repo });
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();

  const result = createEvalFromRetro(repo, "ACCOUNT-15");
  assert.equal(result.evalCase.repo_snapshot, sha);
  assert.equal(result.warning, undefined);
});

test("eval create --from-retro: explicit --category overrides the cause-derived default", () => {
  const repo = setupRepoWithRetro("ACCOUNT-16");
  const result = createEvalFromRetro(repo, "ACCOUNT-16", { category: "backend" });
  assert.equal(result.evalCase.id, "BACKEND-001");
  assert.equal(result.relFile, ".agent/evals/backend/BACKEND-001.yaml");
});

test("eval create --from-retro: ids increment per category (ARCH-001, then ARCH-002)", () => {
  const repo = initTempRepo();
  registerMission(repo, baseMission());
  ledger.writeTask(repo, MISSION_ID, implTask("ACCOUNT-17"));
  ledger.writeTask(repo, MISSION_ID, implTask("ACCOUNT-18"));
  installFixtureRetro(repo, "ACCOUNT-17");
  installFixtureRetro(repo, "ACCOUNT-18");

  const first = createEvalFromRetro(repo, "ACCOUNT-17");
  const second = createEvalFromRetro(repo, "ACCOUNT-18");
  assert.equal(first.evalCase.id, "ARCH-001");
  assert.equal(second.evalCase.id, "ARCH-002");
});

test("eval create --from-retro: a category outside the known map falls back to its own uppercased name as prefix", () => {
  const repo = setupRepoWithRetro("ACCOUNT-19");
  const result = createEvalFromRetro(repo, "ACCOUNT-19", { category: "migrations" });
  assert.equal(result.evalCase.id, "MIGRATION-001");
});

test("eval create --from-retro: clear error when no retrospective.json exists for the task", () => {
  const repo = initTempRepo();
  registerMission(repo, baseMission());
  ledger.writeTask(repo, MISSION_ID, implTask("ACCOUNT-20"));
  assert.throws(() => createEvalFromRetro(repo, "ACCOUNT-20"), EvalError);
});

// ---------------------------------------------------------------- list

test("eval list: empty repo has no cases", () => {
  const repo = initTempRepo();
  assert.deepEqual(listEvalCases(repo), []);
});

test("eval list: returns every case across categories, sorted by id", () => {
  const repo = setupRepoWithRetro("ACCOUNT-21");
  createEvalFromRetro(repo, "ACCOUNT-21", { category: "backend" });
  ledger.writeTask(repo, MISSION_ID, implTask("ACCOUNT-22"));
  installFixtureRetro(repo, "ACCOUNT-22");
  createEvalFromRetro(repo, "ACCOUNT-22", { category: "architecture" });

  const items = listEvalCases(repo);
  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((i) => i.id),
    ["ARCH-001", "BACKEND-001"]
  );
  assert.ok(items.every((i) => i.repo_snapshot === "UNPINNED"));
});

// -------------------------------------------------------- retro create --eval

function runCli(args: string[]): void {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    main(["node", "agent", ...args]);
  } finally {
    process.exitCode = previousExitCode;
  }
}

test("retro create without --eval does not create an eval case", () => {
  const repo = initTempRepo();
  registerMission(repo, baseMission());
  const id = "ACCOUNT-24";
  ledger.writeTask(repo, MISSION_ID, implTask(id));

  runCli(["--repo", repo, "retro", "create", id, "--trigger", "human-correction", "--cause", "SPEC"]);

  const retroData = JSON.parse(fs.readFileSync(P.retrospectiveFile(repo, id), "utf8"));
  assert.equal(retroData.eval_case, undefined);
  // .agent/evals/ itself always exists post-`agent init` (it ships a
  // README.md, per templates/repo/.agent/evals/); the real assertion is
  // that no category subdirectory / case file was scaffolded.
  assert.deepEqual(listEvalCases(repo), []);
});

test("retro create --eval chains eval creation and records eval_case on the retrospective", () => {
  const repo = initTempRepo();
  registerMission(repo, baseMission());
  const id = "ACCOUNT-23";
  ledger.writeTask(repo, MISSION_ID, implTask(id));

  runCli(["--repo", repo, "retro", "create", id, "--trigger", "architecture-rejection", "--cause", "ARCHITECTURE", "--eval"]);

  const retroData = JSON.parse(fs.readFileSync(P.retrospectiveFile(repo, id), "utf8"));
  assert.equal(retroData.eval_case, ".agent/evals/architecture/ARCH-001.yaml");
  assert.ok(fs.existsSync(path.join(repo, ".agent", "evals", "architecture", "ARCH-001.yaml")));
});
