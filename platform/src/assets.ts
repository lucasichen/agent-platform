// Resolves the packaged read-only inputs (schemas, policies, repo scaffold
// template, workflow registry) at runtime. Two layouts are supported so the
// exact same code works both as the installed npm package and inside this
// monorepo during development/tests:
//
//   installed:  dist/cli.js  + dist/assets/{schemas,policies,templates,registry}
//               (produced by scripts/copy-assets.js at build time)
//   monorepo:   platform/src/*.ts running under tsx, falling back to the
//               sibling ../schemas, ../policies, ../templates/repo,
//               ../registry/workflows directories at the repo root.
import * as fs from "node:fs";
import * as path from "node:path";

function firstExisting(candidates: string[]): string | undefined {
  return candidates.find((c) => fs.existsSync(c));
}

function monorepoRoot(): string {
  // __dirname is platform/src (tsx/dev) or platform/dist (compiled). Either
  // way, one level up is platform/, and one more level up is the repo root.
  return path.join(__dirname, "..", "..");
}

export function schemasDir(): string {
  const dir = firstExisting([
    path.join(__dirname, "assets", "schemas"),
    path.join(monorepoRoot(), "schemas"),
  ]);
  if (!dir) throw new Error("Could not locate packaged schemas directory (dist/assets/schemas or ../schemas).");
  return dir;
}

export function policiesDir(): string {
  const dir = firstExisting([
    path.join(__dirname, "assets", "policies"),
    path.join(monorepoRoot(), "policies"),
  ]);
  if (!dir) throw new Error("Could not locate packaged policies directory (dist/assets/policies or ../policies).");
  return dir;
}

/** Returns the directory whose CONTENTS are copied onto a target repo's .agent/ (i.e. .../templates/repo/.agent itself, not its parent). */
export function repoScaffoldDir(): string {
  const dir = firstExisting([
    path.join(__dirname, "assets", "templates", "repo", ".agent"),
    path.join(monorepoRoot(), "templates", "repo", ".agent"),
  ]);
  if (!dir) {
    throw new Error(
      "Could not locate packaged repo scaffold directory (dist/assets/templates/repo/.agent or ../templates/repo/.agent)."
    );
  }
  return dir;
}

/** May legitimately not exist (registry/workflows is authored in parallel). */
export function packagedRegistryWorkflowsDir(): string | undefined {
  return firstExisting([
    path.join(__dirname, "assets", "registry", "workflows"),
    path.join(monorepoRoot(), "registry", "workflows"),
  ]);
}

/**
 * The packaged skills/ tree root (contains worker-startup/, vendor/<pack>/skills/<name>/,
 * etc. — docs/skills-design.md §1). May legitimately not exist: skills/ is
 * authored by a parallel work package (Waves B/C) and copy-assets.js copies
 * it only if present. Callers (bindings.ts) must tolerate undefined.
 */
export function skillsDir(): string | undefined {
  return firstExisting([path.join(__dirname, "assets", "skills"), path.join(monorepoRoot(), "skills")]);
}
