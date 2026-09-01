#!/usr/bin/env node
// .agent/verification/web/run.mjs
//
// owner: repo maintainer role (spec §12.4, same authority as repo.yaml —
//   this file is what repo.yaml's `verification:` block should point a
//   "browser"/"portal" entry at, e.g. `command: "node
//   .agent/verification/web/run.mjs --out .agent/runs/$TASK/verification"`)
// staleness trigger: executed by CI and by verifier tasks (spec §9,
//   roles/F7-verifier.md); a step that stops succeeding fails the
//   build, the same mechanical trigger as repo.yaml (spec §12.4).
//
// Web verification scaffold (spec §9.1): reads repo.yaml `services`,
// starts them, polls health, seeds fixtures, drives the browser
// journeys defined in journeys.yaml, inspects network/console/DOM,
// captures evidence, and writes verification/result.json in the shape
// docs/evidence-contract.md defines.
//
// Node >=18 (uses global fetch). No hard dependency of its own beyond
// Node itself — Playwright plugs in via the target repo's own
// node_modules; see README.md "Where Playwright plugs in".
//
// Usage:
//   node run.mjs --out <dir> [--repo-root <path>] [--task <TASK-ID>]
//                [--journeys <path>] [--base-url <url>]
//                [--skip-services] [--health-timeout-ms <n>]
//
// Exit code 0 if every check PASSes (or none were defined to run — see
// README "Empty scaffold" note), 1 if any check FAILs or setup fails.

import { resolve, join, dirname, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

import { parseArgs } from '../lib/cli.mjs';
import { info, warn, fail } from '../lib/log.mjs';
import { loadRepoYaml, loadConfigWithFallback } from '../lib/config.mjs';
import { startService, waitForHealth, stopAll, interpolateEnv } from '../lib/process.mjs';
import { ensureOutDir, writeResult, writeEvidenceFile, appendLogLine } from '../lib/evidence.mjs';
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
  // --journeys overrides the default `.agent/verification/web/journeys.yaml`
  // location — resolved relative to cwd (like every other path-valued flag
  // here), not --repo-root, so `--journeys ./fixtures/journeys.yaml` means
  // what it looks like from wherever you invoked the command.
  let journeysDir = join(repoRoot, '.agent', 'verification', 'web');
  let journeysPrimaryName = 'journeys.yaml';
  if (args.journeys) {
    const resolvedJourneys = resolve(String(args.journeys));
    journeysDir = dirname(resolvedJourneys);
    journeysPrimaryName = basename(resolvedJourneys);
  }
  const { path: journeysPath, config: journeysConfig } = await loadConfigWithFallback({
    dir: journeysDir,
    primaryName: journeysPrimaryName,
    exampleName: 'journeys.example.yaml',
    kind: 'browser journeys (spec §9.1)',
  });
  info(`journeys config: ${journeysPath}`);

  const quarantineList = await loadQuarantine(repoRoot);
  const started = [];
  const checks = [];

  try {
    if (!args.skipServices) {
      const services = repoYaml.services ?? {};
      const entries = Object.entries(services);
      if (entries.length === 0) {
        warn('repo.yaml has no services defined; nothing to start (pass --skip-services to silence this if that is intentional, e.g. against a live dev server).');
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
        // eslint-disable-next-line no-await-in-loop -- services must come up before journeys can run
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
      warn('--skip-services: assuming services are already running (e.g. a live dev server).');
    }

    const fixtureCmd = journeysConfig?.fixtures?.seed;
    if (fixtureCmd) {
      info(`seeding fixtures: ${fixtureCmd}`);
      try {
        const output = execSync(interpolateEnv(fixtureCmd), { cwd: repoRoot, encoding: 'utf8' });
        appendLogLine(outDir, 'logs/fixtures.log', output);
      } catch (err) {
        fail(`fixture seed command failed: ${err.message}`);
      }
    }

    let playwright;
    try {
      playwright = await import('playwright');
    } catch {
      fail(
        'Playwright is not installed in this repository. Run `npm install -D playwright` ' +
          "(or your package manager's equivalent) in the target repo, then re-run. " +
          'See README.md "Where Playwright plugs in."'
      );
    }

    const baseUrl = String(args.baseUrl || journeysConfig?.base_url || '');
    const journeys = journeysConfig?.journeys ?? [];
    if (journeys.length === 0) {
      warn('no journeys defined in journeys.yaml — nothing to verify.');
    }

    const browser = await playwright.chromium.launch();
    try {
      for (const journey of journeys) {
        // eslint-disable-next-line no-await-in-loop -- journeys share one browser instance, run sequentially
        const result = await runCheckWithRetry(
          `web:${journey.name}`,
          (attempt) => runJourney({ browser, baseUrl, journey, outDir, attempt }),
          quarantineList
        );
        checks.push(result);
      }
    } finally {
      await browser.close();
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
    reproducibleWith: `node .agent/verification/web/run.mjs --out ${args.out}${args.task ? ` --task ${args.task}` : ''}`,
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

async function runJourney({ browser, baseUrl, journey, outDir, attempt }) {
  const page = await browser.newPage();
  // Per-attempt evidence (lib/checks.mjs "Per-attempt evidence"): every
  // file this journey writes is suffixed with the attempt number, so a
  // retry never silently overwrites the first (possibly failing)
  // attempt's screenshot/trace/console/network evidence.
  const name = `${slug(journey.name)}-attempt${attempt}`;
  const consoleLines = [];
  const networkLines = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
  page.on('request', (req) => networkLines.push(`--> ${req.method()} ${req.url()}`));
  page.on('response', (res) => networkLines.push(`<-- ${res.status()} ${res.url()}`));

  await page.context().tracing.start({ screenshots: true, snapshots: true });
  const tracePath = `trace-${name}.zip`;

  try {
    for (const step of journey.steps ?? []) {
      // eslint-disable-next-line no-await-in-loop -- steps within one journey are inherently sequential
      await runStep(page, step, baseUrl);
    }

    const screenshotRel = `screenshots/${name}.png`;
    await page.screenshot({ path: join(outDir, screenshotRel), fullPage: true });

    const consoleRel = writeEvidenceFile(outDir, `logs/${name}-console.log`, consoleLines.join('\n'));
    writeEvidenceFile(outDir, `logs/${name}-network.log`, networkLines.join('\n'));

    const consoleErrors = consoleLines.filter((l) => l.startsWith('[error]'));
    if (consoleErrors.length > 0) {
      throw new Error(`browser console had ${consoleErrors.length} error(s): ${consoleErrors[0]}`);
    }

    return { status: 'PASS', evidence: `${screenshotRel}, ${tracePath}, ${consoleRel}` };
  } catch (err) {
    const consoleRel = writeEvidenceFile(outDir, `logs/${name}-console.log`, consoleLines.join('\n'));
    return { status: 'FAIL', evidence: consoleRel, error: err.message };
  } finally {
    await page.context().tracing.stop({ path: join(outDir, tracePath) });
    await page.close();
  }
}

async function runStep(page, step, baseUrl) {
  switch (step.action) {
    case 'goto':
      await page.goto(joinUrl(baseUrl, step.target));
      break;
    case 'fill':
      await page.fill(step.selector, resolveValue(step.value));
      break;
    case 'click':
      await page.click(step.selector);
      break;
    case 'wait_for':
      await page.waitForSelector(step.selector);
      break;
    case 'assert_text': {
      const text = await page.textContent(step.selector);
      if (!text || !text.includes(step.expected)) {
        throw new Error(`assert_text failed: ${step.selector} did not contain "${step.expected}" (got: ${text})`);
      }
      break;
    }
    case 'assert_url':
      if (!page.url().includes(step.expected)) {
        throw new Error(`assert_url failed: ${page.url()} did not contain "${step.expected}"`);
      }
      break;
    default:
      throw new Error(`unknown journey step action "${step.action}" (see journeys.example.yaml for supported actions)`);
  }
}

function joinUrl(baseUrl, target) {
  if (!baseUrl) return target;
  try {
    return new URL(target, baseUrl).toString();
  } catch {
    return `${baseUrl.replace(/\/$/, '')}${target}`;
  }
}

function resolveValue(v) {
  if (typeof v === 'string' && v.startsWith('$')) return process.env[v.slice(1)] ?? v;
  return v;
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
