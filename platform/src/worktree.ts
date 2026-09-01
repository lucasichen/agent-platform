// `agent task claim --worktree` (docs/skills-design.md §5, docs/
// integrations.md §3 "Hermes -> patterns for our control plane": worktree-
// per-task isolation, `git worktree add` under .worktrees/<task-id>/).
// Windows-safe: paths are built with path.join and normalized to
// forward-slash for storage (task.payload.workspace, bindings.yaml
// convention). Never deletes a worktree — reclaim/terminal states print a
// cleanup hint instead (cli.ts).
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export class WorktreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorktreeError";
  }
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function runGit(repo: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repo, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
}

function isGitRepo(repo: string): boolean {
  try {
    runGit(repo, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

function branchExists(repo: string, branch: string): boolean {
  try {
    runGit(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

export interface EnsureWorktreeResult {
  workspace: string; // repo-relative, forward-slash, e.g. ".worktrees/TASK-1"
  branch: string;
  reusedBranch: boolean;
  created: boolean; // false when the worktree directory already existed
}

/**
 * Ensures `.worktrees/<taskId>` exists as a git worktree on branch
 * `task/<taskId>` (creating the branch if it does not already exist, else
 * reusing it). Idempotent: calling again for a worktree that already
 * exists on disk is a no-op that reports created:false. Throws
 * WorktreeError with a clear message when `repo` is not a git repository.
 */
export function ensureWorktree(repo: string, taskId: string): EnsureWorktreeResult {
  if (!isGitRepo(repo)) {
    throw new WorktreeError(
      `--worktree requires a git repository; '${repo}' is not one (git rev-parse --is-inside-work-tree failed).`
    );
  }

  const branch = `task/${taskId}`;
  const workspaceRel = toPosix(path.join(".worktrees", taskId));
  const workspaceAbs = path.join(repo, ".worktrees", taskId);

  if (fs.existsSync(workspaceAbs)) {
    return { workspace: workspaceRel, branch, reusedBranch: branchExists(repo, branch), created: false };
  }

  const reused = branchExists(repo, branch);
  const args = reused ? ["worktree", "add", workspaceAbs, branch] : ["worktree", "add", workspaceAbs, "-b", branch];
  try {
    runGit(repo, args);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new WorktreeError(`git worktree add failed for task '${taskId}' (branch '${branch}'): ${detail}`);
  }
  return { workspace: workspaceRel, branch, reusedBranch: reused, created: true };
}
