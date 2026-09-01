// `agent init` (spec Appendix A, DESIGN.md §6 `agent init` CLI entry): installs the .agent/
// scaffold and the default policies into a target repo. Never overwrites a
// file that already exists there; reports what was created vs. skipped so
// re-running `agent init` is safe (idempotent).
import * as fs from "node:fs";
import * as path from "node:path";
import { agentDir, policiesDirIn, workflowsDirIn } from "./paths";
import { copyDirNoOverwrite, ensureDir } from "./fsutil";
import { repoScaffoldDir, policiesDir, packagedRegistryWorkflowsDir } from "./assets";

export interface InitResult {
  repo: string;
  agentDir: string;
  scaffoldCreated: string[];
  scaffoldSkipped: string[];
  policiesCreated: string[];
  policiesSkipped: string[];
  workflowsCreated: string[];
  workflowsSkipped: string[];
}

export function initRepo(repo: string): InitResult {
  ensureDir(agentDir(repo));

  const scaffoldSrc = repoScaffoldDir(); // templates/repo/.agent
  const scaffoldDest = agentDir(repo);
  const allScaffoldFiles = listAllRelativeFiles(scaffoldSrc);
  const scaffoldSkipped = copyDirNoOverwrite(scaffoldSrc, scaffoldDest);
  const scaffoldCreated = allScaffoldFiles.filter((f) => !scaffoldSkipped.includes(f));

  const policiesSrc = policiesDir(); // /policies at the platform repo root
  const policiesDest = policiesDirIn(repo);
  const allPolicyFiles = listAllRelativeFiles(policiesSrc);
  const policiesSkipped = copyDirNoOverwrite(policiesSrc, policiesDest);
  const policiesCreated = allPolicyFiles.filter((f) => !policiesSkipped.includes(f));

  // registry/workflows/*.yaml (spec Appendix A: a self-describing repo
  // carries its own workflow templates under .agent/workflows/; compiler.ts
  // already prefers this repo-local copy over the packaged registry).
  // packagedRegistryWorkflowsDir() may legitimately be absent (a bare
  // install with no bundled registry) — that is a clean no-op, not an error.
  let workflowsCreated: string[] = [];
  let workflowsSkipped: string[] = [];
  const workflowsSrc = packagedRegistryWorkflowsDir();
  if (workflowsSrc) {
    const workflowsDest = workflowsDirIn(repo);
    const allWorkflowFiles = listAllRelativeFiles(workflowsSrc);
    workflowsSkipped = copyDirNoOverwrite(workflowsSrc, workflowsDest);
    workflowsCreated = allWorkflowFiles.filter((f) => !workflowsSkipped.includes(f));
  }

  return {
    repo,
    agentDir: scaffoldDest,
    scaffoldCreated,
    scaffoldSkipped,
    policiesCreated,
    policiesSkipped,
    workflowsCreated,
    workflowsSkipped,
  };
}

function listAllRelativeFiles(dir: string, relBase = ""): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = relBase ? path.join(relBase, entry.name) : entry.name;
    if (entry.isDirectory()) {
      out.push(...listAllRelativeFiles(path.join(dir, entry.name), rel));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}
