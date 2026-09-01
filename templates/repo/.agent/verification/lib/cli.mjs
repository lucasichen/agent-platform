// .agent/verification/lib/cli.mjs
//
// owner: repo maintainer role (spec §12.4)
// staleness trigger: exercised by every run.mjs invocation (spec §9); a
//   parsing bug here breaks every verification run the same mechanical
//   way a broken repo.yaml command fails the build (spec §12.4).
//
// Minimal, dependency-free CLI flag parsing shared by web/run.mjs and
// api/run.mjs. Supports `--flag value` and `--flag=value` (kebab-case
// flags become camelCase keys) plus boolean flags declared up front.
// Positional/unrecognized-looking tokens land in `_unknown` instead of
// being silently swallowed, so a typo'd flag is visible in the output.

export function parseArgs(argv, { defaults = {}, boolean = [] } = {}) {
  const out = { ...defaults };
  const unknown = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      unknown.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    let key;
    let value;
    if (eq !== -1) {
      key = toCamel(arg.slice(2, eq));
      value = arg.slice(eq + 1);
    } else {
      key = toCamel(arg.slice(2));
      // `boolean` is keyed by the same camelCase name callers read the
      // parsed value back under (e.g. args.skipServices) — compare
      // camelCase to camelCase, not the raw --kebab-case flag text.
      if (boolean.includes(key)) {
        value = true;
      } else {
        value = argv[i + 1];
        i += 1;
      }
    }
    out[key] = value;
  }
  if (unknown.length > 0) out._unknown = unknown;
  return out;
}

function toCamel(key) {
  return key.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}
