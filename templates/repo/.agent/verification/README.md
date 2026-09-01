# Verification Contract

<!--
owner: repo maintainer role (spec §12.4, same authority as repo.yaml —
  this directory is what repo.yaml's `verification:` block points to)
staleness trigger: every instruction/script referenced from here is
  executed by CI and by verifier tasks (spec §9); a script or command
  that stops succeeding fails the build, the same mechanical trigger as
  repo.yaml (spec §12.4).
-->

Verification asks one question: **does the real system behave
correctly?** (spec §9). It is independent from the worker that wrote the
change — a worker cannot certify its own work (spec §2, AGENTS.md
"Workers do not certify themselves"). This directory is the executable
half of that contract: not just prose describing what verification
should do, but scaffolds a verifier (human or agent, spec
`roles/F7-verifier.md`) actually runs to get a deterministic PASS/FAIL
with attached evidence.

## The nine things every repository must expose (spec §9)

"Deterministic" means: a script or documented command sequence a
verifier can run and get a reproducible pass/fail, not a description
that requires judgment to execute.

| # | Requirement | Where it lives here |
|---|---|---|
| 1 | environment setup | `repo.yaml` `setup:` |
| 2 | service startup | `repo.yaml` `services.*.command`, started by `web/run.mjs` / `api/run.mjs`, or manually per `android/README.md` / `ios/README.md` |
| 3 | port allocation | `repo.yaml` `services.*.health` URLs use env-var ports; concurrent runs use distinct `--out` dirs and (for mobile) distinct emulator/simulator instances |
| 4 | fixtures | `web/journeys.yaml` `fixtures.seed`, `api/scenarios.yaml` scenario setup requests |
| 5 | authentication | `web/journeys.yaml` `auth`, `api/scenarios.yaml` request `headers` (env-var-backed tokens, never inline secrets) |
| 6 | runtime interaction | `web/journeys.yaml` journeys, `api/scenarios.yaml` scenarios, `android/README.md` / `ios/README.md` checklists |
| 7 | logs | `<out>/logs/<service-name>.log` (every scaffold), plus `adb logcat` / `xcrun simctl spawn log stream` for mobile |
| 8 | cleanup | `lib/process.mjs` `stopAll()` (web/api), explicit teardown commands in the mobile checklists |
| 9 | evidence capture | `<out>/result.json` + `<out>/logs/`, `<out>/screenshots/`, trace files — see "Evidence" below |

## Layout

```
verification/
  README.md            this file — the umbrella contract
  quarantine.yaml        flake-control durable record (spec §9.5)
  lib/                   shared, dependency-free helpers used by web/run.mjs
                         and api/run.mjs (config loading + minimal YAML
                         fallback, service start/health-poll/cleanup,
                         evidence writing, retry-once-then-quarantine)
  web/                   browser journeys (spec §9.1) — run.mjs + journeys.yaml
  api/                   API scenarios (spec §9.2) — run.mjs + scenarios.yaml
  android/                Gradle build + emulator/device checklist (spec §9.3)
  ios/                    xcodebuild + Simulator/XCTest checklist (spec §9.3)
```

Create only the app-type subdirectories this repository needs — delete
`android/`/`ios/` from a web-only repo, for instance, rather than leaving
an empty scaffold that reads as "verified: nothing here."

`web/run.mjs` and `api/run.mjs` are genuinely runnable: Node >=18, no
dependency beyond Node itself in this directory (Playwright plugs into
`web/` via the *target repo's* own `node_modules` — see
`web/README.md`). Each validates its own config exists and is fully
filled in before doing anything else, and fails with a specific,
actionable message when it isn't — run either one with no config beyond
the `.example.yaml` scaffold to see that failure mode, rather than
having to imagine it.

`android/` and `ios/` are checklists, not scripts, on purpose: mobile
toolchains vary too much per repo (module layout, scheme names, device
lab vs. emulator) for one generic script to fake running them without
silently doing the wrong thing. An honest, deterministic command
sequence a verifier follows step by step satisfies spec §9 exactly as
well as a script does — see those READMEs' "Run-checklist" sections.

## Where `repo.yaml` points here

```yaml
verification:
  browser:
    command: "node .agent/verification/web/run.mjs --out .agent/runs/$TASK_ID/verification --task $TASK_ID"
  api:
    command: "node .agent/verification/api/run.mjs --out .agent/runs/$TASK_ID/verification --task $TASK_ID"
  android:
    skill: "see .agent/verification/android/README.md"
  ios:
    skill: "see .agent/verification/ios/README.md"
```

## Tiered depth (spec §9.5, resolved from the §10.5 risk table)

Verification is a cost line, not an afterthought (spec §9.5) — R0/R1
tasks do not pay for a full runtime environment the risk level doesn't
warrant.

| Risk | Required depth | What that means here |
|---|---|---|
| R0 | deterministic checks only | `repo.yaml` `verification.unit`/`verification.lint` — no `web/`/`api/` run |
| R1 | deterministic checks / smoke | the above, plus a single smoke journey/scenario (not the full suite) |
| R2 | runtime verification | full `web/run.mjs` / `api/run.mjs` run against every journey/scenario relevant to the change |
| R3+ | full isolated runtime environment | R2, plus genuinely ephemeral/isolated dependencies (spec §9.2, §16.3) — real Testcontainers/ephemeral DB, not a shared instance, and (for mobile) a dedicated device/emulator per run |

`roles/F7-verifier.md` step 2 resolves the risk tier from `task.yaml`
`risk` (spec §10.5) before choosing what to run — never habit, never
"run everything to be safe" for an R0 doc change.

## Flake control (spec §9.5, verbatim)

> Flaky runtime verification is the main threat to: "Completion status
> can be trusted." A flaky verifier trains humans to ignore failures,
> trains the learning loop on noise.
>
> Requirements: quarantine list for flaky checks; retry-once-then-
> quarantine, automatic; flake rate as a first-class metric (Appendix D).
>
> Every verifier failure is classified before entering the learning
> loop: PRODUCT FAILURE, ENVIRONMENT FAILURE, FLAKE. Unclassified
> failures poison retrospectives.

How this directory implements that:

- **Automatic retry-once**: `lib/checks.mjs` `runCheckWithRetry` retries
  every failing check exactly once before recording a final result — no
  script here retries more than once, and none retries silently forever.
- **Never a silent flaky PASS**: if a check fails then passes on retry,
  the result is still `FAIL` (with `classification: "UNCLASSIFIED"` and
  a note flagging it as an inconsistent/flake candidate) — never
  silently reported as `PASS` (`roles/F7-verifier.md` #7).
- **Quarantine list**: `quarantine.yaml` — a durable record of checks
  with an already-demonstrated flake history. A check enters it only
  after that history is demonstrated, never to silence a real failure.
  It does not suppress a run's result; it's what lets a human reading
  `result.json` tell "known flake, tracked" apart from "new failure,
  needs classification."
- **Classification before the learning loop**: every `FAIL` this
  directory's scripts produce carries `classification: "UNCLASSIFIED"`
  and a `note` explaining why — a human or the verifier role must assign
  `PRODUCT FAILURE | ENVIRONMENT FAILURE | FLAKE` before the result feeds
  a retrospective (`.agent/runs/<TASK-ID>/retrospective.json`, spec
  §13.2). No script here guesses that classification on its own — it
  requires judgment these scripts deliberately don't have.
- **Flake rate as a metric**: tracked at the fleet level per
  `docs/metrics.md` (spec Appendix D "verification flake %"), rolled up
  from `quarantine.yaml` entries and repeated `UNCLASSIFIED`/flake-noted
  results across runs — not something to compute ad hoc per run.

## Evidence and `result.json` (spec Appendix B, `docs/evidence-contract.md`)

Every scaffold in this directory writes
`<out>/result.json` in exactly the shape `docs/evidence-contract.md`
defines:

```json
{
  "task": "ACCOUNT-12",
  "commit": "42f81c9",
  "checks": [
    { "name": "web:sign-up-and-create-project", "status": "PASS", "evidence": "screenshots/sign-up-and-create-project.png, trace-sign-up-and-create-project.zip, logs/sign-up-and-create-project-console.log" },
    { "name": "api:create-account", "status": "FAIL", "evidence": "logs/create-account.json", "error": "read_after_write: expected status 200, got 500", "classification": "UNCLASSIFIED", "note": "failed consistently across both attempts — verifier must classify PRODUCT FAILURE | ENVIRONMENT FAILURE | FLAKE before this enters the learning loop (spec §9.5)" }
  ],
  "environment": "local processes: api, portal",
  "reproducible_with": "node .agent/verification/api/run.mjs --out .agent/runs/ACCOUNT-12/verification --task ACCOUNT-12"
}
```

`status` is `PASS`, `FAIL`, or `SKIPPED`. Every check names the evidence
file(s) under `<out>/` that back it — `lib/evidence.mjs`
`writeResult()` refuses to write a check with no `evidence` value,
mechanically enforcing "**PASS without evidence is FAIL**"
(`docs/evidence-contract.md`) at the point evidence is produced, not
just at review time.

**Task-run wiring**: `--out` should point at
`.agent/runs/<TASK-ID>/verification/` so the run lands exactly where
`docs/evidence-contract.md`'s task-level bundle expects it —
`result.json` plus `logs/`, `screenshots/`, and any `trace-*.zip` files
alongside it, all under that one task's evidence directory. `--task
<TASK-ID>` stamps the same id into `result.json`'s `task` field so the
two stay consistent.

**Secrets**: `lib/evidence.mjs` redacts common secret shapes (API keys,
bearer tokens, DB connection strings, private key blocks) from every
file it writes, on capture — before anything touches disk (spec §16.2).
This is a conservative pattern match, not a guarantee; never rely on it
as the only thing standing between a test credential and a committed
evidence bundle — use scoped, short-lived, test-only credentials in the
first place (spec §16.2, `docs/security.md`).

## Related roles and skills

- `roles/F7-verifier.md` — the role contract this directory exists to
  serve. Read it before running anything here as a verifier: it defines
  what "done" means for a verification pass, not just how to invoke a
  script.
- `skills/vendor/gstack/skills/qa`, `qa-only`, `ios-qa` — broader,
  LLM-driven exploratory QA passes that land their own evidence under
  this same `.agent/runs/<TASK-ID>/verification/` tree. They are
  complementary inputs, never a substitute for F.7's own independent,
  re-executed verification of the candidate (`roles/F7-verifier.md` #1;
  AGENTS.md "Workers do not certify themselves") — a worker's own qa
  pass, however thorough, is still the worker's own say-so.
