#!/usr/bin/env node
// .agent/verification/api/run.mjs
//
// owner: repo maintainer role (spec §12.4, same authority as repo.yaml —
//   this file is what repo.yaml's `verification:` block should point an
//   "api" entry at, e.g. `command: "node .agent/verification/api/run.mjs
//   --out .agent/runs/$TASK/verification"`)
// staleness trigger: executed by CI and by verifier tasks (spec §9,
//   roles/F7-verifier.md); a step that stops succeeding fails the
//   build, the same mechanical trigger as repo.yaml (spec §12.4).
//
// API verification scaffold (spec §9.2): reads repo.yaml `services`,
// starts them, polls health, then executes the deterministic scenarios
// in scenarios.yaml against the running app using Node's built-in
// fetch — status, schema-ish body checks, persistence via
// read-after-write, authZ, and idempotency. LLMs may pick which
// scenarios to write; this script executes and evaluates every
// assertion deterministically (spec §9.2).
//
// Node >=18 (uses global fetch). No dependency of its own.
//
// Usage:
//   node run.mjs --out <dir> [--repo-root <path>] [--task <TASK-ID>]
//                [--scenarios <path>] [--base-url <url>]
//                [--skip-services] [--health-timeout-ms <n>]
//
// Exit code 0 if every check PASSes, 1 if any check FAILs or setup fails.

import { resolve, join, dirname, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

import { parseArgs } from '../lib/cli.mjs';
import { info, warn, fail } from '../lib/log.mjs';
import { loadRepoYaml, loadConfigWithFallback } from '../lib/config.mjs';
import { startService, waitForHealth, stopAll, interpolateEnv } from '../lib/process.mjs';
import { ensureOutDir, writeResult, writeEvidenceFile } from '../lib/evidence.mjs';
import { loadQuarantine, runCheckWithRetry } from '../lib/checks.mjs';

async function main() {
  const args = parseArgs(process.argv.slice(2), {
    defaults: { repoRoot: process.cwd() },
    boolean: ['skipServices'],
  });

  if (!args.out) {
    fail('--out <dir> is required — evidence is written there, per docs/evidence-contract.md.');
  }

  const repoRoot = resolve(String(args.repoRoot));
  const outDir = resolve(String(args.out));
  ensureOutDir(outDir);
  const logsDir = join(outDir, 'logs');

  info(`repo root: ${repoRoot}`);
  info(`evidence out: ${outDir}`);

  const repoYaml = await loadRepoYaml(repoRoot);
  // --scenarios overrides the default `.agent/verification/api/scenarios.yaml`
  // location — resolved relative to cwd (like every other path-valued flag
  // here), not --repo-root, so `--scenarios ./fixtures/scenarios.yaml` means
  // what it looks like from wherever you invoked the command.
  let scenariosDir = join(repoRoot, '.agent', 'verification', 'api');
  let scenariosPrimaryName = 'scenarios.yaml';
  if (args.scenarios) {
    const resolvedScenarios = resolve(String(args.scenarios));
    scenariosDir = dirname(resolvedScenarios);
    scenariosPrimaryName = basename(resolvedScenarios);
  }
  const { path: scenariosPath, config: scenariosConfig } = await loadConfigWithFallback({
    dir: scenariosDir,
    primaryName: scenariosPrimaryName,
    exampleName: 'scenarios.example.yaml',
    kind: 'API scenarios (spec §9.2)',
  });
  info(`scenarios config: ${scenariosPath}`);

  const dependencies = repoYaml.dependencies ?? {};
  if (Object.keys(dependencies).length > 0) {
    info(
      `repo.yaml declares dependencies: ${Object.keys(dependencies).join(', ')}. This scaffold ` +
        'does not orchestrate containers generically — see README.md "Where Testcontainers ' +
        'plugs in" for how to bring up ephemeral instances of these for this repo, or start ' +
        'them yourself and pass --skip-services once the app under test can already reach them.'
    );
  }

  const quarantineList = await loadQuarantine(repoRoot);
  const started = [];
  const checks = [];

  try {
    if (!args.skipServices) {
      const services = repoYaml.services ?? {};
      const entries = Object.entries(services);
      if (entries.length === 0) {
        warn('repo.yaml has no services defined; nothing to start (pass --skip-services if the app is already running).');
      }
      for (const [name, svc] of entries) {
        if (!svc?.command || !svc?.health) {
          fail(`repo.yaml services.${name} is missing command/health — see .agent/repo.yaml.`);
        }
        started.push(startService(name, svc, { logsDir, cwd: repoRoot }));
      }
      for (const [name, svc] of entries) {
        const target = interpolateEnv(svc.health);
        info(`waiting for "${name}" health at ${target} ...`);
        // eslint-disable-next-line no-await-in-loop -- app must be up before scenarios can run
        const health = await waitForHealth(svc.health, { timeoutMs: Number(args.healthTimeoutMs) || 30000 });
        if (!health.ok) {
          fail(
            `service "${name}" did not become healthy: ${health.error} (${health.url}). ` +
              `Check ${join(logsDir, `${name}.log`)} for what it printed on startup.`
          );
        }
        info(`"${name}" healthy (status ${health.status}).`);
      }
    } else {
      warn('--skip-services: assuming the app under test is already running.');
    }

    const baseUrl = String(args.baseUrl || scenariosConfig?.base_url || '');
    if (!baseUrl) {
      fail('no base_url resolved — set scenarios.yaml base_url or pass --base-url.');
    }
    const scenarios = scenariosConfig?.scenarios ?? [];
    if (scenarios.length === 0) {
      warn('no scenarios defined in scenarios.yaml — nothing to verify.');
    }

    for (const scenario of scenarios) {
      // eslint-disable-next-line no-await-in-loop -- scenarios may depend on shared server-side state, run sequentially
      const result = await runCheckWithRetry(
        `api:${scenario.name}`,
        (attempt) => runScenario({ baseUrl, scenario, outDir, attempt }),
        quarantineList
      );
      checks.push(result);
    }
  } finally {
    stopAll(started);
  }

  const commit = safeGitCommit(repoRoot);
  writeResult({
    outDir,
    task: args.task ?? null,
    commit,
    checks,
    environment: args.skipServices
      ? 'external (--skip-services)'
      : `local processes: ${Object.keys(repoYaml.services ?? {}).join(', ') || 'none'}`,
    reproducibleWith: `node .agent/verification/api/run.mjs --out ${args.out}${args.task ? ` --task ${args.task}` : ''}`,
  });
  info(`wrote ${join(outDir, 'result.json')}`);

  const failed = checks.filter((c) => c.status === 'FAIL');
  if (failed.length > 0) {
    warn(`${failed.length} check(s) FAILed: ${failed.map((c) => c.name).join(', ')}`);
    process.exitCode = 1;
  } else {
    info(`all ${checks.length} check(s) PASSed.`);
    process.exitCode = 0;
  }
}

async function runScenario({ baseUrl, scenario, outDir, attempt }) {
  const name = slug(scenario.name);
  const log = [];
  const context = {};
  // Per-attempt evidence path (lib/checks.mjs "Per-attempt evidence"): a
  // retried scenario must not silently overwrite the failing first
  // attempt's evidence with the second attempt's.
  const evidencePath = `logs/${name}-attempt${attempt}.json`;

  async function call(reqSpec, label) {
    const path = interpolateTemplate(String(reqSpec.path ?? ''), context);
    const url = joinUrl(baseUrl, path);
    const headers = { 'Content-Type': 'application/json', ...(reqSpec.headers || {}) };
    for (const [k, v] of Object.entries(headers)) headers[k] = interpolateTemplate(String(v), context);
    const method = reqSpec.method || 'GET';
    const bodyText =
      reqSpec.body !== undefined ? interpolateTemplate(JSON.stringify(reqSpec.body), context) : undefined;

    const started = Date.now();
    const res = await fetch(url, { method, headers, body: bodyText });
    const durationMs = Date.now() - started;
    const text = await res.text();
    let bodyJson = null;
    try {
      bodyJson = text ? JSON.parse(text) : null;
    } catch {
      // non-JSON response body; keep raw text below
    }
    log.push({ label, method, url, status: res.status, durationMs, body: bodyJson ?? text });
    return { res, bodyJson };
  }

  try {
    const { res, bodyJson } = await call(scenario.request, 'request');

    if (scenario.request?.capture) {
      for (const [key, path] of Object.entries(scenario.request.capture)) {
        context[key] = getPath(bodyJson, path);
      }
    }

    // `expect` is asserted after capture, so body_contains values may
    // themselves reference ${capture.<key>} (e.g. asserting the id a
    // prior step captured is echoed back unchanged).
    assertExpect(scenario.expect, res, bodyJson, 'request', context);

    if (scenario.read_after_write) {
      const raw = scenario.read_after_write;
      const { res: res2, bodyJson: body2 } = await call(raw.request, 'read_after_write');
      assertExpect(raw.expect, res2, body2, 'read_after_write', context);
    }

    if (scenario.authz) {
      const { res: res3 } = await call(scenario.authz.request, 'authz');
      if (scenario.authz.expect_status !== undefined && res3.status !== scenario.authz.expect_status) {
        throw new Error(`authz: expected status ${scenario.authz.expect_status}, got ${res3.status}`);
      }
    }

    if (scenario.idempotency) {
      const repeat = scenario.idempotency.repeat || 2;
      let prevBody;
      for (let i = 0; i < repeat; i++) {
        // eslint-disable-next-line no-await-in-loop -- idempotency check requires sequential repeated calls
        const { res: resN, bodyJson: bodyN } = await call(scenario.request, `idempotency-${i}`);
        if (scenario.idempotency.expect_status !== undefined && resN.status !== scenario.idempotency.expect_status) {
          throw new Error(`idempotency attempt ${i}: expected status ${scenario.idempotency.expect_status}, got ${resN.status}`);
        }
        if (scenario.idempotency.expect_same_result && i > 0 && JSON.stringify(bodyN) !== JSON.stringify(prevBody)) {
          throw new Error(`idempotency attempt ${i}: response body differed from the previous attempt`);
        }
        prevBody = bodyN;
      }
    }

    writeEvidenceFile(outDir, evidencePath, log);
    return { status: 'PASS', evidence: evidencePath };
  } catch (err) {
    writeEvidenceFile(outDir, evidencePath, log);
    return { status: 'FAIL', evidence: evidencePath, error: err.message };
  }
}

function assertExpect(expect, res, bodyJson, label, context = {}) {
  if (!expect) return;
  if (expect.status !== undefined && res.status !== expect.status) {
    throw new Error(`${label}: expected status ${expect.status}, got ${res.status}`);
  }
  if (expect.body_contains !== undefined) {
    for (const [path, expectedRaw] of Object.entries(expect.body_contains)) {
      const expected = typeof expectedRaw === 'string' ? interpolateTemplate(expectedRaw, context) : expectedRaw;
      const actual = getPath(bodyJson, path);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${label}: expected body.${path} === ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    }
  }
}

function getPath(obj, path) {
  return String(path)
    .split('.')
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function interpolateTemplate(str, context) {
  return str.replace(/\$\{capture\.([a-zA-Z0-9_]+)\}/g, (_, key) => (context[key] !== undefined ? String(context[key]) : ''));
}

function joinUrl(baseUrl, path) {
  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return `${baseUrl.replace(/\/$/, '')}${path}`;
  }
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function safeGitCommit(repoRoot) {
  try {
    if (!existsSync(join(repoRoot, '.git'))) return null;
    return execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

main().catch((err) => {
  console.error(`[verify] FATAL: ${err.stack || err.message}`);
  process.exitCode = 1;
});
