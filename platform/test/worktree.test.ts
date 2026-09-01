import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { ensureWorktree, WorktreeError } from "../src/worktree";
import * as ledger from "../src/ledger";
import { makeTempRepo, registerMission, baseMission } from "./testutil";

function git(repo: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

/** A scratch git repo with one commit on its default branch, so `git worktree add -b` has a HEAD to branch from. */
function makeScratchGitRepo(): string {
  const repo = makeTempRepo();
  git(repo, ["init", "--quiet"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(repo, "README.md"), "scratch repo for worktree tests\n", "utf8");
  git(repo, ["add", "."]);
  git(repo, ["commit", "--quiet", "-m", "initial commit"]);
  return repo;
}

test("ensureWorktree creates .worktrees/<task-id> on a new branch task/<task-id>", () => {
  const repo = makeScratchGitRepo();
  const result = ensureWorktree(repo, "TASK-1");

  assert.equal(result.workspace, ".worktrees/TASK-1");
  assert.equal(result.branch, "task/TASK-1");
  assert.equal(result.reusedBranch, false);
  assert.equal(result.created, true);
  assert.ok(fs.existsSync(path.join(repo, ".worktrees", "TASK-1")));

  const branches = git(repo, ["branch", "--list", "task/TASK-1"]);
  assert.match(branches, /task\/TASK-1/);

  const worktrees = git(repo, ["worktree", "list"]);
  assert.match(worktrees, /\.worktrees[\\/]TASK-1/);
});

test("ensureWorktree is idempotent: calling again for an existing worktree is a no-op (never deletes)", () => {
  const repo = makeScratchGitRepo();
  const first = ensureWorktree(repo, "TASK-2");
  assert.equal(first.created, true);

  // Prove the worktree is real work, not a stub: write a file into it.
  fs.writeFileSync(path.join(repo, first.workspace, "in-progress.txt"), "do not delete\n", "utf8");

  const second = ensureWorktree(repo, "TASK-2");
  assert.equal(second.created, false);
  assert.equal(second.workspace, first.workspace);
  assert.equal(second.reusedBranch, true);
  assert.ok(fs.existsSync(path.join(repo, first.workspace, "in-progress.txt")), "ensureWorktree must never delete existing work");
});

test("ensureWorktree reuses an existing branch instead of failing on -b when the branch already exists", () => {
  const repo = makeScratchGitRepo();
  // Create the branch ahead of time, without a worktree.
  git(repo, ["branch", "task/TASK-3"]);

  const result = ensureWorktree(repo, "TASK-3");
  assert.equal(result.created, true);
  assert.equal(result.reusedBranch, true);
  assert.ok(fs.existsSync(path.join(repo, ".worktrees", "TASK-3")));
});

test("ensureWorktree fails clearly on a non-git repo", () => {
  const repo = makeTempRepo(); // never `git init`
  assert.throws(() => ensureWorktree(repo, "TASK-4"), (e: unknown) => {
    assert.ok(e instanceof WorktreeError);
    assert.match((e as Error).message, /requires a git repository/);
    return true;
  });
});

test("claim --worktree flow: ledger.writeTask accepts the recorded workspace in task.payload (schema's open-ended extension point)", () => {
  const repo = makeTempRepo();
  registerMission(repo, baseMission());
  const task = {
    id: "MISSION-TEST-1-WT",
    mission: "MISSION-TEST-1",
    workflow: { id: "happy-path", version: 1, step: "implement" },
    type: "implementation" as const,
    role: "worker",
    dependencies: [],
    risk: "R1" as const,
    inputs: [],
    outputs: [],
    budget: { attempts: 3, dollars: 1 },
    payload: { areas: [], design: { authority: "architect" }, acceptance: [], verification: [] },
    status: "READY" as const,
    lease: null,
    attempt: 0,
  };
  ledger.writeTask(repo, "MISSION-TEST-1", task);

  const claimed = ledger.claimTask(repo, task.id, "agent-a", 30);
  const gitRepo = makeScratchGitRepo();
  const wt = ensureWorktree(gitRepo, claimed.id);
  const withWorkspace = { ...claimed, payload: { ...(claimed.payload as Record<string, unknown>), workspace: wt.workspace } };
  assert.doesNotThrow(() => ledger.writeTask(repo, claimed.mission, withWorkspace));

  const persisted = ledger.readTask(repo, claimed.id);
  assert.equal((persisted.payload as Record<string, unknown>).workspace, ".worktrees/MISSION-TEST-1-WT");
});
