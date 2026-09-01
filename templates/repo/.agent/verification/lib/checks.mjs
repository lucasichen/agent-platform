// .agent/verification/lib/checks.mjs
//
// owner: repo maintainer role (spec §12.4)
// staleness trigger: implements the retry-once-then-quarantine flake
//   policy from spec §9.5 verbatim (see ../README.md "Flake control") —
//   exercised on every check in every run.mjs invocation; a drift from
//   that policy here is a spec violation, not a style choice.
//
// Flake control shared by web/run.mjs and api/run.mjs. Every check runs
// through runCheckWithRetry: on FAIL, retry exactly once, automatically
// (spec §9.5 "retry-once-then-quarantine, automatic"; roles/F7-verifier
// #7 "do not retry indefinitely"). An inconsistent PASS-on-retry is
// still recorded FAIL — never silently promoted to PASS (roles/F7
// #7 "do not silently mark a flaky check PASS"). Either way the failure
// is left UNCLASSIFIED for a human/verifier to assign PRODUCT FAILURE |
// ENVIRONMENT FAILURE | FLAKE before it enters the learning loop (spec
// §9.5) — this script has no basis to make that call on its own.
//
// Per-attempt evidence: `fn` is called as `fn(attempt)` with `attempt`
// 1 then (only on a first-attempt FAIL) 2, and is expected to route that
// into its evidence file name (e.g. `logs/<name>-attempt1.json`,
// `-attempt2.json`) rather than reusing one shared path — otherwise a
// second attempt's evidence silently overwrites the first's, and a FAIL
// verdict whose evidence field points at "the attempt that failed" would
// actually show whatever the second attempt happened to do. When a
// result comes back from a single attempt, `evidence` is that attempt's
// file. When both attempts ran, `evidence` is a comma-separated list of
// both attempts' files (in order), so a human reading result.json can
// see the full retry history, not just the one that determined the
// verdict.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { warn } from './log.mjs';
import { parseYaml } from './config.mjs';

export async function loadQuarantine(repoRoot) {
  const path = join(repoRoot, '.agent', 'verification', 'quarantine.yaml');
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  const parsed = await parseYaml(text);
  return parsed?.quarantine ?? [];
}

/**
 * @param {string} name check name, e.g. "web:sign-up" or "api:create-account"
 * @param {(attempt: 1|2) => Promise<{status: 'PASS'|'FAIL', evidence: string, [k: string]: unknown}>} fn
 *   called with the attempt number so it can write per-attempt evidence
 *   (see module header "Per-attempt evidence").
 * @param {Array<{check: string}>} quarantineList
 */
export async function runCheckWithRetry(name, fn, quarantineList) {
  const first = await fn(1);
  if (first.status !== 'FAIL') return { name, ...first };

  warn(`check "${name}" failed; retrying once per spec §9.5 flake policy...`);
  const retry = await fn(2);
  const inQuarantine = quarantineList.some((q) => q.check === name);
  const bothAttemptsEvidence = `${first.evidence}, ${retry.evidence}`;

  if (retry.status !== 'FAIL') {
    warn(
      `check "${name}" was inconsistent across attempts (fail, then pass). Recording FAIL, ` +
        'not PASS — "do not silently mark a flaky check PASS" (roles/F7-verifier.md #7). ' +
        (inQuarantine
          ? 'Already tracked in quarantine.yaml.'
          : 'Consider adding it to quarantine.yaml if this recurs (spec §9.5).')
    );
    return {
      name,
      status: 'FAIL',
      evidence: bothAttemptsEvidence,
      error: first.error,
      classification: 'UNCLASSIFIED',
      note:
        'inconsistent across retry (flake candidate) — evidence lists attempt 1 (failed, ' +
        'determined this verdict) then attempt 2 (passed) — verifier must classify PRODUCT ' +
        'FAILURE | ENVIRONMENT FAILURE | FLAKE before this enters the learning loop (spec §9.5)',
    };
  }

  return {
    name,
    status: 'FAIL',
    evidence: bothAttemptsEvidence,
    error: retry.error,
    classification: 'UNCLASSIFIED',
    note:
      `failed consistently across both attempts (evidence lists attempt 1 then attempt 2)${
        inQuarantine
          ? ' (check is in quarantine.yaml but still failed both attempts here — not being treated as flake)'
          : ''
      } — verifier must classify PRODUCT FAILURE | ENVIRONMENT FAILURE | FLAKE before this ` +
      'enters the learning loop (spec §9.5)',
  };
}
