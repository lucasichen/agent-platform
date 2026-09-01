# API Verification (spec §9.2)

<!--
owner: repo maintainer role (spec §12.4, same authority as repo.yaml)
staleness trigger: run.mjs is executed by CI and by verifier tasks
  (spec §9, roles/F7-verifier.md); a scenario that stops succeeding
  fails the build, the same mechanical trigger as a broken repo.yaml
  command (spec §12.4).
-->

`run.mjs` is a runnable scaffold, not a placeholder — it starts
`repo.yaml`'s `services`, polls their health, then executes the
scenarios in `scenarios.yaml` against the running app using Node's
built-in `fetch`, and writes `verification/result.json` in the shape
`docs/evidence-contract.md` defines. No dependency beyond Node >=18: an
API check needs no browser, so this scaffold has none. What you fill in
for this repository:

```
scenarios.yaml   copy scenarios.example.yaml, fill in every {{placeholder}}
```

## Quick start

```sh
node .agent/verification/api/run.mjs \
  --out .agent/runs/<TASK-ID>/verification \
  --task <TASK-ID>
```

Run against a fresh scaffold first to see the intended failure mode: it
reports exactly which `{{placeholder}}` is unfilled, rather than sending
requests built from placeholder text.

Flags: `--repo-root <path>` (default: cwd), `--scenarios <path>`
(default: `.agent/verification/api/scenarios.yaml`), `--base-url <url>`
(overrides `scenarios.yaml`'s `base_url`), `--skip-services` (assume the
app under test is already running), `--health-timeout-ms <n>` (default
30000).

## Deterministic assertions, LLM-picked scenarios (spec §9.2)

> LLMs may generate scenarios. Programs should execute assertions
> deterministically.

Nothing in `run.mjs` asks a model to judge a response — every scenario
field maps to a fixed, mechanical check (`assertExpect`, `getPath`,
strict status/body comparison). An agent (or a human) decides *which*
scenarios `scenarios.yaml` needs to cover this repo's real behavior;
`run.mjs` is what actually executes and grades them. If a scenario needs
an assertion this scaffold doesn't have (e.g. a JSON Schema check, a
header-shape check, a rate-limit/boundary probe), extend `assertExpect`
or add a new scenario field + branch in `runScenario` — that is the
intended extension point, not a comment in the report saying "looks
right."

## Scenario coverage (spec §9.2 checklist -> scenario fields)

| spec §9.2 item | `scenarios.yaml` field |
|---|---|
| status | `expect.status` |
| schema / response body | `expect.body_contains` (dot-path deep-equal); wire a real JSON Schema validator here if a repo's contracts need more than substring/field checks |
| persistence effects, read-after-write | `read_after_write` (a second request confirming the first write is actually visible on read) |
| authentication / authorization | `authz` (an adjacent request with different/missing credentials must be rejected) |
| idempotency | `idempotency` (`repeat`, `expect_status`, `expect_same_result`) |
| external calls, logs | not automated generically — capture via the service's own log (`logs/<service>.log`) or a scenario-specific header/assertion if this repo mocks/sandboxes an external dependency |
| failure scenarios, boundary behavior | ordinary scenarios whose `request` is deliberately invalid/out-of-range and whose `expect.status` is the 4xx/5xx the app should return |

`${capture.<key>}` lets a later request in the same scenario (path,
headers, body, or `expect.body_contains` values) reference a value
captured from an earlier response — e.g. asserting a create response's
`id` is exactly what a later read returns. See `scenarios.example.yaml`
for a full worked scenario.

## Evidence captured per scenario

Every request/response in a scenario (`request`, `read_after_write`,
`authz`, each `idempotency` repetition) is logged — method, URL, status,
duration, and body — to `logs/<scenario>.json`, referenced from
`verification/result.json`. Backend service logs are captured for the
whole run at `logs/<service-name>.log`.

## Where Testcontainers plugs in

`repo.yaml`'s `dependencies` block (e.g. `postgres: { container: true }`)
declares what the app needs beyond its own code. This scaffold does
**not** orchestrate containers generically — `repo.yaml`'s dependency
schema doesn't carry enough (no image, no port mapping) for that, and
guessing would be worse than an honest gap. `run.mjs` prints a note
naming the declared dependencies and exits normally if none block
startup; wire real ephemeral instances for this repo's stack one of two
ways:

1. **Docker Compose** — if the repo already has a `docker-compose.yml`
   with services matching the `dependencies` names, start them before
   `run.mjs` (`docker compose up -d postgres`) and pass `--skip-services`
   only if the app itself also needs to be started that way; otherwise
   let `run.mjs` start the app service normally once its dependency is
   up.
2. **Testcontainers (Node)** — `npm install -D testcontainers` in the
   target repo, then add a short setup step (own script, or a few lines
   at the top of a repo-specific wrapper around this `run.mjs`) that
   starts the containers this repo needs and exports their connection
   info as the env vars `repo.yaml`'s `services.*.command` /
   `scenarios.yaml` already expect (`$DATABASE_URL`, etc.) before
   invoking `run.mjs`.

Either way, prefer ephemeral/containerized instances over shared
infrastructure so verification is reproducible and isolated (spec
§9.2, §16.3) — a scenario that passes only because of leftover state
from a previous run is not evidence.

## Related skill

For iOS's equivalent evidence-producing loop, see
`skills/vendor/gstack/skills/ios-qa`. There is no vendored API-specific
QA skill in this platform today — `run.mjs` here **is** the deterministic
harness `docs/spec/agent-engineering-platform-spec-v3.md` Appendix C
("API QA | deterministic harness") refers to.
