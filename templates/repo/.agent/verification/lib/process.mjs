// .agent/verification/lib/process.mjs
//
// owner: repo maintainer role (spec §12.4)
// staleness trigger: exercised by every run.mjs invocation (spec §9);
//   service startup, port/health readiness, and cleanup are three of the
//   nine deterministic instructions every repo must expose (spec §9, see
//   ../README.md) — a break here fails the build the same mechanical way
//   a broken repo.yaml command does (spec §12.4).
//
// Cross-platform (Windows + POSIX) service process management: start a
// repo.yaml `services.*` command, poll its `health` URL, capture its
// stdout/stderr to a log file, and clean it (and any children it spawns)
// up afterwards. Uses `spawn(..., { shell: true })` so a repo's own
// command string (e.g. "npm run api") runs under the platform's native
// shell — this file itself contains no bash-isms.

import { spawn, execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { info, warn } from './log.mjs';

/** Expands `$VAR` / `${VAR}` references against process.env. Unresolved
 * references are left as-is (verbatim) so a missing env var fails loudly
 * later (e.g. an unreachable health URL) instead of silently.
 */
export function interpolateEnv(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, name) => process.env[name] ?? m)
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, name) => process.env[name] ?? m);
}

export function startService(name, svc, { logsDir, cwd }) {
  const command = interpolateEnv(svc.command);
  info(`starting service "${name}": ${command}`);
  const logPath = join(logsDir, `${name}.log`);
  const logStream = createWriteStream(logPath, { flags: 'a' });
  logStream.write(`[verify] $ ${command}\n`);
  const child = spawn(command, {
    cwd,
    shell: true,
    env: process.env,
    // POSIX: run as its own process-group leader so stopAll() can kill
    // the whole tree via a negative pid. Windows has no equivalent
    // concept here — stopAll() uses `taskkill /t` for that platform
    // instead (see below).
    detached: process.platform !== 'win32',
  });
  child.stdout?.on('data', (d) => logStream.write(d));
  child.stderr?.on('data', (d) => logStream.write(d));
  child.on('error', (err) => logStream.write(`[verify] spawn error: ${err.message}\n`));
  return { name, child, logPath };
}

export async function waitForHealth(url, { timeoutMs = 30000, intervalMs = 500 } = {}) {
  const target = interpolateEnv(url);
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      // eslint-disable-next-line no-await-in-loop -- intentional poll loop
      const res = await fetch(target, { signal: AbortSignal.timeout(Math.max(intervalMs * 4, 2000)) });
      if (res.status < 500) return { ok: true, status: res.status, url: target };
      lastError = new Error(`health endpoint returned ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    // eslint-disable-next-line no-await-in-loop -- intentional poll loop
    await sleep(intervalMs);
  }
  return { ok: false, error: lastError ? String(lastError) : `timed out after ${timeoutMs}ms`, url: target };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Best-effort tree kill for every started service. Known limitation:
 * on Windows, `taskkill /t` targets the process tree rooted at the
 * spawned cmd.exe, which usually — but not always, depending on how a
 * repo's own script re-execs — reaches grandchildren too. If a repo's
 * service leaks a process on Windows, give that service its own
 * stop script and call it from a wrapping `services.<name>.command`
 * rather than relying on this generic killer.
 */
export function stopAll(started) {
  for (const { name, child } of started) {
    if (child.exitCode !== null || child.killed) continue;
    info(`stopping service "${name}" (pid ${child.pid})`);
    try {
      if (process.platform === 'win32') {
        execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], () => {});
      } else {
        process.kill(-child.pid, 'SIGTERM');
      }
    } catch (err) {
      warn(`failed to stop "${name}" cleanly: ${err.message}`);
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
    }
  }
}
