// .agent/verification/lib/evidence.mjs
//
// owner: repo maintainer role (spec §12.4); the shape this module writes
//   is defined upstream by docs/evidence-contract.md and spec Appendix B
//   — change that doc first, this module second, never the reverse.
// staleness trigger: exercised by every run.mjs invocation (spec §9);
//   `agent evidence check <task-id>` validates the shape this module
//   produces against docs/evidence-contract.md — a drift here fails that
//   check, the same mechanical trigger as a broken repo.yaml command.
//
// Writes verification/result.json in the exact shape
// docs/evidence-contract.md defines, plus the raw evidence files each
// check's `evidence` field points to. Secret redaction runs on capture,
// before anything touches disk (spec §16.2) — never as a later cleanup
// pass; if you add a new evidence writer, route it through
// writeEvidenceFile/appendLogLine below rather than writeFileSync
// directly, so redaction always applies.

import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

// Deliberately conservative (over-redact rather than leak): common
// secret shapes, not an exhaustive scanner. Extend per repo if a
// project's fixtures produce a distinctive credential format.
const SECRET_PATTERNS = [
  /((?:api|access)[_-]?(?:key|token)|secret|password|passwd)\s*[:=]\s*['"]?[A-Za-z0-9\-_.]{8,}['"]?/gi,
  /Authorization:\s*Bearer\s+[A-Za-z0-9\-_.]+/gi,
  /\b(postgres|postgresql|mysql|mongodb|redis):\/\/[^:\s]+:[^@\s]+@[^\s'"]+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

export function redact(text) {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, '[REDACTED]');
  }
  return out;
}

export function ensureOutDir(outDir) {
  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, 'logs'), { recursive: true });
  mkdirSync(join(outDir, 'screenshots'), { recursive: true });
  return outDir;
}

export function writeEvidenceFile(outDir, relPath, content) {
  const full = join(outDir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  writeFileSync(full, redact(text));
  return relPath;
}

export function appendLogLine(outDir, relPath, line) {
  const full = join(outDir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  appendFileSync(full, redact(line.endsWith('\n') ? line : `${line}\n`));
  return relPath;
}

/**
 * Writes verification/result.json per docs/evidence-contract.md:
 * `{task, commit, checks: [{name, status, evidence}], environment,
 * reproducible_with}`. `checks` entries may carry extra fields
 * (classification, note, error) beyond the contract's minimum — those
 * are additive context for the human/verifier that reads this file, not
 * a deviation from the required shape.
 */
export function writeResult({ outDir, task, commit, checks, environment, reproducibleWith }) {
  for (const check of checks) {
    if (!check.evidence) {
      throw new Error(
        `check "${check.name}" has no evidence file — a check with no evidence is invalid ` +
          'per docs/evidence-contract.md ("a check with no evidence value is invalid, not ' +
          'merely trust me"), not a status worth writing.'
      );
    }
  }
  const result = {
    task: task ?? null,
    commit: commit ?? null,
    checks,
    environment,
    reproducible_with: reproducibleWith,
  };
  writeFileSync(join(outDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
