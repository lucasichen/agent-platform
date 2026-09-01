# Web Verification (spec §9.1)

<!--
owner: repo maintainer role (spec §12.4, same authority as repo.yaml)
staleness trigger: run.mjs is executed by CI and by verifier tasks
  (spec §9, roles/F7-verifier.md); a journey that stops succeeding fails
  the build, the same mechanical trigger as a broken repo.yaml command
  (spec §12.4).
-->

`run.mjs` is a runnable scaffold, not a placeholder — it starts
`repo.yaml`'s `services`, polls their health, seeds fixtures, drives the
browser journeys in `journeys.yaml`, captures evidence, and writes
`verification/result.json` in the shape `docs/evidence-contract.md`
defines. What you fill in for this repository:

```
journeys.yaml   copy journeys.example.yaml, fill in every {{placeholder}}
```

## Quick start

```sh
# from the target repo's root, once Playwright is installed (see below)
node .agent/verification/web/run.mjs \
  --out .agent/runs/<TASK-ID>/verification \
  --task <TASK-ID>
```

Run without arguments first (`node .agent/verification/web/run.mjs
--out /tmp/x`) against a fresh scaffold to see the intended failure mode:
it reports exactly which `{{placeholder}}` is unfilled and where, rather
than doing anything with the placeholder text. That is the scaffold
proving itself runnable, not a bug to route around.

Flags: `--repo-root <path>` (default: cwd), `--journeys <path>`
(default: `.agent/verification/web/journeys.yaml`), `--base-url <url>`
(overrides `journeys.yaml`'s `base_url`), `--skip-services` (assume
services are already running — e.g. against a live dev server instead of
starting them), `--health-timeout-ms <n>` (default 30000).

## Where Playwright plugs in

This scaffold has no dependency of its own beyond Node >=18. It expects
the **target repository** to install Playwright:

```sh
npm install -D playwright
npx playwright install chromium   # or your browser(s) of choice
```

`run.mjs` does `await import('playwright')`, resolved through the target
repo's own `node_modules` (Node's module resolution walks up from
`.agent/verification/web/` to the repo root) — install it there, not
here. If it is missing, `run.mjs` fails immediately with that exact
instruction rather than a stack trace.

Journey steps map onto Playwright's `page` API directly (see
`journeys.example.yaml` for the full list: `goto`, `fill`, `click`,
`wait_for`, `assert_text`, `assert_url`). If a repository's journeys need
a step this scaffold doesn't have yet (drag-and-drop, file upload,
iframe traversal, multi-tab flows), add a `case` to the `runStep`
switch in `run.mjs` — that function is the intended extension point, not
something to route around with inline browser scripts in `journeys.yaml`.

## Evidence captured per journey (spec §9.1)

| Evidence | Where |
|---|---|
| Playwright trace | `trace-<journey>-attempt<N>.zip` (screenshots + snapshots + network, open with `npx playwright show-trace`) |
| Screenshot | `screenshots/<journey>-attempt<N>.png` (full page, taken at the end of the journey) |
| DOM assertions | `assert_text`/`assert_url`/`wait_for` steps — failure is the assertion, not a separate artifact |
| Network requests/responses | `logs/<journey>-attempt<N>-network.log` |
| Browser console | `logs/<journey>-attempt<N>-console.log` — any `[error]` line fails the journey |
| Backend logs | `logs/<service-name>.log` — one per `repo.yaml` service, captured for the whole run |
| Database assertions | not automated generically — add a step or a post-journey check specific to this repo's schema/ORM if a journey needs one |

`N` is `1`, or `1` and `2` if the retry-once flake policy fired — see
`../lib/checks.mjs` and `../README.md` "Flake control". Every file above
is per-attempt so a retry never silently overwrites the failing first
attempt's evidence with the second.

Visual verification should combine these deterministic checks with
semantic visual review only where needed (spec §9.1) — e.g. a human or a
vision-capable review step looking at the captured screenshot for a
journey where "the button exists and is clickable" isn't the same
question as "does this look right." That review is a separate step from
this script; it consumes the screenshot this script produces.

## Fixtures and authentication

`journeys.yaml`'s `fixtures.seed` command runs once, after services are
healthy and before any journey. `auth.strategy` documents the mechanism
(`none`, `cookie`, `header`, `login-form`); for `login-form`, express the
sign-in as ordinary journey steps (see the example) rather than a
separate code path, so it gets the same evidence capture as everything
else. Never inline a real credential in `journeys.yaml` — reference an
environment variable (`value: "$TEST_USER_PASSWORD"`) and set it in the
verifier's environment.

## Related skills

`skills/vendor/gstack/skills/qa` and `qa-only` run a broader,
LLM-driven exploratory pass (find bugs, optionally fix them) and land
their evidence under this same `.agent/runs/<TASK-ID>/verification/`
tree. They are complementary to, not a substitute for, this script:
F.7's independent, re-executed verification of the candidate is this
script (or the repo's own `verify-*` skill), never the worker's own
qa pass (roles/F7-verifier.md #1, AGENTS.md "Workers do not certify
themselves").
