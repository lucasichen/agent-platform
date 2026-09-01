// .agent/verification/lib/log.mjs
//
// owner: repo maintainer role (spec §12.4, same authority as repo.yaml —
//   this directory is what repo.yaml's `verification:` block points to)
// staleness trigger: exercised by every run.mjs invocation, executed by
//   CI and by verifier tasks (spec §9); a broken helper fails every
//   verification run the same mechanical way a broken repo.yaml command
//   fails the build (spec §12.4).
//
// Tiny, dependency-free console logging shared by every script under
// .agent/verification/. Not a general logging framework — three
// functions, consistent `[verify]` prefix, nothing else.

export function info(msg) {
  console.log(`[verify] ${msg}`);
}

export function warn(msg) {
  console.warn(`[verify] WARNING: ${msg}`);
}

/**
 * Prints an error and exits the process immediately with code 1. Use
 * this only for setup/config failures where continuing would produce a
 * misleading result — a check that fails during a journey/scenario
 * should be recorded as a FAIL check instead, not fail() the whole run.
 */
export function fail(msg) {
  console.error(`[verify] ERROR: ${msg}`);
  process.exit(1);
}
