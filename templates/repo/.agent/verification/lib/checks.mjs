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
 * @param {() => Promise<{status: 'PASS'|'FAIL', evidence: string, [k: string]: unknown}>} fn
 * @param {Array<{check: string}>} quarantineList
 */
export async function runCheckWithRetry(name, fn, quarantineList) {
  const first = await fn();
  if (first.status !== 'FAIL') return { name, ...first };

  warn(`check "${name}" failed; retrying once per spec §9.5 flake policy...`);
  const retry = await fn();
  const inQuarantine = quarantineList.some((q) => q.check === name);

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
      evidence: first.evidence,
      error: first.error,
      classification: 'UNCLASSIFIED',
      note:
        'inconsistent across retry (flake candidate) — verifier must classify PRODUCT ' +
        'FAILURE | ENVIRONMENT FAILURE | FLAKE before this enters the learning loop (spec §9.5)',
    };
  }

  return {
    name,
    status: 'FAIL',
    evidence: retry.evidence,
    error: retry.error,
    classification: 'UNCLASSIFIED',
    note:
      `failed consistently across both attempts${
        inQuarantine
          ? ' (check is in quarantine.yaml but still failed both attempts here — not being treated as flake)'
          : ''
      } — verifier must classify PRODUCT FAILURE | ENVIRONMENT FAILURE | FLAKE before this ` +
      'enters the learning loop (spec §9.5)',
  };
}
