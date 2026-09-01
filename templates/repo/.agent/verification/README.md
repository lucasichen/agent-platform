# Verification Contract

<!--
owner: repo maintainer role (spec §12.4, same authority as repo.yaml —
  these instructions are what repo.yaml's `verification:` block points to)
staleness trigger: every instruction/script referenced from here is
  executed by CI and by verifier tasks (spec §9); a script that stops
  succeeding fails the build, the same mechanical trigger as repo.yaml
  (spec §12.4).
-->

Verification asks one question: **does the real system behave correctly?**
(spec §9). It is independent from the worker that wrote the change — a
worker cannot certify its own work (spec §2).

Every repository must expose **deterministic** instructions for each of
the following. "Deterministic" means: a script or documented command
sequence a verifier (human or agent) can run and get a reproducible
pass/fail, not a description that requires judgment to execute.

```
environment setup       how to get a clean, runnable checkout
service startup          how to bring up every service under test, and how
                          to know each one is ready (repo.yaml `services.*.health`)
port allocation           how concurrent verifier runs avoid colliding
fixtures                  how to seed the data a scenario needs
authentication             how a verifier obtains a test identity/session
runtime interaction         how to actually exercise the behavior (API
                          calls, browser journey, mobile UI automation)
logs                       where to find backend/service logs during and
                          after a run
cleanup                    how to tear down/reset so the next run is clean
evidence capture            what gets written to `.agent/runs/<TASK-ID>/verification/`
                          (spec Appendix B) — traces, screenshots, network
                          logs, DB assertions
```

## Where these live

- `.agent/repo.yaml` `verification:` block — the command/skill entry
  points (`agent route`/workers/verifiers invoke these).
- `.agent/verification/<app-type>/` — repo- and stack-specific scripts,
  fixtures, and verify-skill implementations, organized by application
  type as they are added, e.g.:
  ```
  verification/
    web/       browser journeys (spec §9.1) — Playwright, DOM/console/network assertions
    api/       API scenarios (spec §9.2) — Testcontainers, ephemeral DB, mock externals
    android/   Gradle build + emulator/device (spec §9.3)
    ios/       XCTest/XCUITest (spec §9.3)
  ```
  Create only the subdirectories this repository needs; do not scaffold
  empty ones for stacks that don't apply.

## What "verified" produces

A verifier task writes `.agent/runs/<TASK-ID>/verification/result.json`
matching the shape in `docs/evidence-contract.md`:
`{task, commit, checks: [{name, status, evidence}], environment,
reproducible_with}`. Every check must be reproducible by a human from
`reproducible_with` alone — that is the bar for "deterministic" above.

**PASS without evidence is FAIL.** A verification or review gate that
cannot point to the evidence file backing its verdict is treated as not
having run (see `docs/evidence-contract.md`).

## Per-app-type guidance (spec §9)

- **Web** (§9.1): start isolated dependencies -> backend -> portal -> seed
  fixture -> open browser -> perform the actual journey -> inspect
  network -> inspect browser console -> inspect resulting state -> capture
  evidence. Combine deterministic layout/DOM/accessibility assertions with
  semantic visual review only where needed.
- **APIs** (§9.2): application + Testcontainers + ephemeral database +
  mock/sandboxed external dependencies. Verify status, schema, response
  body, persistence effects, read-after-write, external calls, logs,
  authN/authZ, idempotency, failure scenarios, boundary behavior. LLMs may
  generate scenarios; programs execute assertions deterministically.
- **Mobile** (§9.3) and **SDKs** (§9.4): see spec for stack-specific
  detail; the same shape applies — real build, real runtime, deterministic
  assertions, captured evidence.

## Flake control (spec §9.5)

A flaky check is not evidence. Track verification-flake % (see
`docs/metrics.md`) and quarantine/fix flaky checks rather than retrying
past them silently.
