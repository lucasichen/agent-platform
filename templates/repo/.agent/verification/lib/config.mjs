// .agent/verification/lib/config.mjs
//
// owner: repo maintainer role (spec §12.4, same authority as repo.yaml)
// staleness trigger: exercised by every run.mjs invocation, executed by
//   CI and by verifier tasks (spec §9); a parsing/loading bug here fails
//   every verification run, the same mechanical trigger as a broken
//   repo.yaml command (spec §12.4).
//
// Dependency-free config loading shared by web/run.mjs and api/run.mjs:
// resolves a YAML parser (preferring the target repo's own `yaml` or
// `js-yaml` package if installed; falling back to a minimal built-in
// parser otherwise), loads repo.yaml, and loads a primary config file
// with a documented fallback to its .example.yaml sibling.
//
// Minimal fallback parser scope: block mappings, block sequences (of
// scalars or mappings), quoted/bare scalars, comments, blank lines, and
// basic literal (`|`) / folded (`>`) block scalars (including the `-`
// strip-chomp indicator) — exactly what repo.yaml and this directory's
// own journeys/scenarios/quarantine templates use. Block-scalar support
// is a deliberate approximation, not a full YAML 1.1 implementation: it
// does not handle explicit indentation indicators (`|2`), `+` keep-chomp,
// or more-indented "literal" lines inside a folded block (those fold like
// any other line here, where real YAML would preserve their line breaks)
// — see `extractBlockScalars()` below. It does NOT support flow style
// ({}/[] beyond the empty literals), anchors/aliases, or tags. If a
// repo's real journeys.yaml/scenarios.yaml grows past this subset, `npm
// install -D yaml` in the target repo — this module prefers that
// automatically, no code change needed here.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fail, warn } from './log.mjs';

let cachedParser; // undefined = not resolved yet; null = none available

async function resolveParser() {
  if (cachedParser !== undefined) return cachedParser;
  const candidates = [
    { name: 'yaml', wrap: (mod) => (text) => mod.parse(text) },
    { name: 'js-yaml', wrap: (mod) => (text) => (mod.default ?? mod).load(text) },
  ];
  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential fallback probe, not a hot path
      const mod = await import(candidate.name);
      cachedParser = candidate.wrap(mod);
      return cachedParser;
    } catch {
      // Not installed in the target repo — try the next candidate, then
      // fall back to the minimal built-in parser below.
    }
  }
  cachedParser = null;
  return cachedParser;
}

export async function parseYaml(text) {
  const parser = await resolveParser();
  if (parser) return parser(text);
  return minimalYamlParse(text);
}

export function findPlaceholders(text) {
  const matches = [];
  const re = /\{\{[^}]*\}\}/g;
  let m = re.exec(text);
  while (m) {
    matches.push(m[0]);
    m = re.exec(text);
  }
  return matches;
}

export function assertNoPlaceholders(text, filePath) {
  const placeholders = findPlaceholders(text);
  if (placeholders.length > 0) {
    const shown = placeholders.slice(0, 5).join(', ');
    const more = placeholders.length > 5 ? `, and ${placeholders.length - 5} more` : '';
    fail(
      `${filePath} still has unfilled template placeholders: ${shown}${more}. ` +
        'This is a scaffold, not a runnable config — fill in every {{placeholder}} ' +
        'for this repository before running verification (see the README next to this file).'
    );
  }
}

export async function loadRepoYaml(repoRoot) {
  const path = join(repoRoot, '.agent', 'repo.yaml');
  if (!existsSync(path)) {
    fail(
      `${path} not found. Run from a repository that has run \`agent init\` ` +
        '(spec Appendix A), or pass --repo-root <path>.'
    );
  }
  const text = readFileSync(path, 'utf8');
  assertNoPlaceholders(text, path);
  return parseYaml(text);
}

/**
 * Loads `<dir>/<primaryName>` if present; otherwise falls back to
 * `<dir>/<exampleName>` with a visible warning. Either way, the loaded
 * file must have every {{placeholder}} filled in — the example file is
 * there to prove the scaffold parses and runs, not so example data can
 * silently stand in for real verification.
 */
export async function loadConfigWithFallback({ dir, primaryName, exampleName, kind }) {
  const primaryPath = join(dir, primaryName);
  const examplePath = join(dir, exampleName);
  let path = primaryPath;
  if (!existsSync(primaryPath)) {
    if (!existsSync(examplePath)) {
      fail(
        `Neither ${primaryPath} nor ${examplePath} exists. Create ${primaryName} ` +
          `for this repo's ${kind} (copy ${exampleName} as a starting point).`
      );
    }
    warn(
      `${primaryPath} not found; falling back to ${examplePath}. ` +
        `Create a real ${primaryName} for this repository before trusting any ` +
        'result this run produces.'
    );
    path = examplePath;
  }
  const text = readFileSync(path, 'utf8');
  assertNoPlaceholders(text, path);
  const config = await parseYaml(text);
  return { path, isExample: path === examplePath, config };
}

// ---------------------------------------------------------------------
// Minimal fallback YAML parser. See module header for supported subset.
// ---------------------------------------------------------------------

function minimalYamlParse(text) {
  const { text: expanded, placeholders } = extractBlockScalars(text);
  const lines = normalizeLines(expanded);
  let idx = 0;

  function indentOf(line) {
    return line.match(/^ */)[0].length;
  }

  function findColon(s) {
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "'" && !inDouble) inSingle = !inSingle;
      else if (c === '"' && !inSingle) inDouble = !inDouble;
      else if (c === ':' && !inSingle && !inDouble && (i + 1 === s.length || s[i + 1] === ' ')) {
        return i;
      }
    }
    return -1;
  }

  function stripKey(k) {
    if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
      return k.slice(1, -1);
    }
    return k;
  }

  function parseScalar(raw) {
    const s = raw.trim();
    if (s === '') return null;
    if (/^(~|null|Null|NULL)$/.test(s)) return null;
    if (/^(true|True|TRUE)$/.test(s)) return true;
    if (/^(false|False|FALSE)$/.test(s)) return false;
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
    if (s === '[]') return [];
    if (s === '{}') return {};
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      return s.slice(1, -1);
    }
    return s;
  }

  function parseBlock(minIndent) {
    if (idx >= lines.length) return null;
    const ind = indentOf(lines[idx]);
    if (ind < minIndent) return null;
    const trimmed = lines[idx].trim();
    if (trimmed === '-') return parseSeq(ind);
    if (findColon(trimmed) !== -1) return parseMap(ind);
    idx += 1;
    return parseScalar(trimmed);
  }

  function parseSeq(indent) {
    const arr = [];
    while (idx < lines.length) {
      const ind = indentOf(lines[idx]);
      if (ind < indent) break;
      if (ind > indent) {
        idx += 1;
        continue;
      }
      if (lines[idx].trim() !== '-') break;
      idx += 1;
      arr.push(parseBlock(indent + 2));
    }
    return arr;
  }

  function parseMap(indent) {
    const obj = {};
    while (idx < lines.length) {
      const ind = indentOf(lines[idx]);
      if (ind < indent) break;
      if (ind > indent) {
        idx += 1;
        continue;
      }
      const trimmed = lines[idx].trim();
      if (trimmed === '-') break; // this indent belongs to a sibling sequence
      const c = findColon(trimmed);
      if (c === -1) {
        idx += 1;
        continue;
      }
      const key = stripKey(trimmed.slice(0, c).trim());
      const valPart = trimmed.slice(c + 1).trim();
      idx += 1;
      obj[key] = valPart === '' ? parseBlock(indent + 1) : parseScalar(valPart);
    }
    return obj;
  }

  const result = parseBlock(0);
  return restoreBlockScalars(result === null ? {} : result, placeholders);
}

// A NUL-delimited prefix can't appear in any real YAML text this parser
// sees, so it's safe as a swap-in token that survives comment-stripping
// and blank-line filtering (a bare word — parseScalar returns it as-is).
const BLOCK_SCALAR_PLACEHOLDER = '\u0000BLOCKSCALAR';

/**
 * Pre-pass over the raw text (before comment/blank-line stripping, which
 * would otherwise corrupt block-scalar content): finds `key: |`/`key: >`
 * headers (optionally `-` strip-chomped), consumes the following
 * more-indented block, folds/joins it into a single string per the
 * (approximate) rules below, and replaces the whole header+block with a
 * one-line `key: <placeholder>` so the rest of the parser never has to
 * know block scalars exist. `restoreBlockScalars()` swaps the
 * placeholders back in after the normal recursive-descent parse.
 */
function extractBlockScalars(text) {
  const raw = text.split(/\r?\n/);
  const headerRe = /^(\s*)([^:\n]+):[ \t]*([|>])([+-]?)[ \t]*$/;
  const out = [];
  const placeholders = new Map();
  let counter = 0;
  let i = 0;
  while (i < raw.length) {
    const line = raw[i];
    const m = !/^\s*#/.test(line) && line.match(headerRe);
    if (!m) {
      out.push(line);
      i += 1;
      continue;
    }
    const [, indent, keyPart, style, chomp] = m;
    const headerIndent = indent.length;
    const blockLines = [];
    let j = i + 1;
    while (j < raw.length) {
      const l = raw[j];
      if (l.trim() === '') {
        blockLines.push('');
        j += 1;
        continue;
      }
      if (l.match(/^ */)[0].length <= headerIndent) break;
      blockLines.push(l);
      j += 1;
    }
    // Trailing blank lines collected above are just lookahead before the
    // next key/EOF, not block content.
    while (blockLines.length > 0 && blockLines[blockLines.length - 1] === '') {
      blockLines.pop();
    }
    if (blockLines.length === 0) {
      // `key: >` with nothing under it — not really a block scalar; leave
      // the line as-is and let parseScalar treat `>`/`|` as a bare scalar
      // like before.
      out.push(line);
      i += 1;
      continue;
    }
    const blockIndent = blockLines.find((l) => l !== '').match(/^ */)[0].length;
    const dedented = blockLines.map((l) => (l === '' ? '' : l.slice(blockIndent)));
    const content = style === '|' ? foldLiteral(dedented) : foldFolded(dedented);
    const chomped = chomp === '-' ? content : `${content}\n`;
    const token = `${BLOCK_SCALAR_PLACEHOLDER}${counter}\u0000`;
    counter += 1;
    placeholders.set(token, chomped);
    out.push(`${indent}${keyPart}: ${token}`);
    i = j;
  }
  return { text: out.join('\n'), placeholders };
}

// Literal (`|`): line breaks are preserved as-is.
function foldLiteral(lines) {
  return lines.join('\n');
}

// Folded (`>`, approximate): blank lines mark paragraph breaks (become a
// single `\n`); consecutive non-blank lines within a paragraph are joined
// with a space, same as real YAML folding. Unlike real YAML, a
// more-indented "literal" line inside a folded block is not special-cased
// here — it folds like any other line.
function foldFolded(lines) {
  const paragraphs = [];
  let current = [];
  for (const l of lines) {
    if (l === '') {
      if (current.length > 0) paragraphs.push(current.join(' '));
      current = [];
    } else {
      current.push(l);
    }
  }
  if (current.length > 0) paragraphs.push(current.join(' '));
  return paragraphs.join('\n');
}

function restoreBlockScalars(value, placeholders) {
  if (placeholders.size === 0) return value;
  if (typeof value === 'string') return placeholders.has(value) ? placeholders.get(value) : value;
  if (Array.isArray(value)) return value.map((v) => restoreBlockScalars(v, placeholders));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = restoreBlockScalars(v, placeholders);
    return out;
  }
  return value;
}

function normalizeLines(text) {
  const raw = text.split(/\r?\n/);
  const kept = [];
  for (const line of raw) {
    if (/^\s*#/.test(line)) continue;
    if (line.trim() === '' || line.trim() === '---') continue;
    kept.push(stripInlineComment(line));
  }
  // Split "<indent>- key: value" into a bare "<indent>-" marker line plus
  // a "<indent+2>  key: value" line, so the recursive-descent parser
  // above never has to special-case inline sequence-item content.
  const normalized = [];
  for (const line of kept) {
    const m = line.match(/^(\s*)-\s+(.*)$/);
    if (m) {
      const [, indent, rest] = m;
      normalized.push(`${indent}-`);
      if (rest.trim() !== '') normalized.push(`${indent}  ${rest}`);
    } else {
      normalized.push(line);
    }
  }
  return normalized;
}

function stripInlineComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '#' && !inSingle && !inDouble && (i === 0 || line[i - 1] === ' ')) {
      return line.slice(0, i).replace(/\s+$/, '');
    }
  }
  return line;
}
