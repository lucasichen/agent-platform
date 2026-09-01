# Repository Evals

<!--
owner: learning-evaluator role (F.10) — spec §13.5, §13.2 (failures become
  reusable eval cases)
staleness trigger: each eval case pins a `repo_snapshot` (commit). When
  code the case depends on (a required/forbidden symbol, a scenario's
  preconditions) changes meaningfully, the case is queued for
  re-validation by the learning-evaluator role before it is trusted again
  — the same "verify against code before relying on it" rule as any other
  curated artifact (spec §12.4).
-->

Actual failures become reusable eval cases (spec §13.5). When a worker
produces a locally-plausible but wrong implementation — especially one
that bypasses an architectural seam — that failure is captured here so
future agents, and future model/role changes, are checked against it
before it can recur silently.

## Directory structure

```
evals/
  architecture/
  backend/
  frontend/
  android/
  ios/
  debugging/
  migrations/
```

Create only the categories this repository needs.

## Eval case format

```yaml
id: ARCH-017

repo_snapshot: abc123

task:
  Implement account deletion.

known_failure:
  Worker bypassed SessionService.

required:
  - SessionService.revokeAll

forbidden:
  - direct session persistence mutation
```

`required`/`forbidden` should reference the same seams named in
`architecture/canonical-patterns.md` and in a task's
`design.required_seams` / `design.forbidden` payload (spec §6.1) — an
eval case is, among other things, a regression test for an escalation
that already happened once (spec §5.2).

## Three layers (spec §13.5)

Evaluation for any given change should combine all three, not just the
first:

```
VISIBLE
  unit/integration tests, acceptance criteria, repository standards

INDEPENDENT / HIDDEN
  additional scenarios, architecture checks, mutation tests,
  cross-feature regressions, adversarial cases

PRODUCTION
  canary telemetry, errors, rollbacks
```

This exists specifically to stop agents from optimizing the known,
visible grader while missing the actual requirement (spec §13.5).

## How cases enter this directory

A task retrospective (`.agent/runs/<TASK-ID>/retrospective.json`,
`cause` field) that identifies a recurring or architecturally significant
failure mode produces a `candidate_intervention` proposing a new eval
case here. Per the retrospective schema, this is **never auto-applied**
(spec Appendix B) — the learning-evaluator role reviews and lands it.

## CLI commands

```
agent eval create --from-retro <task-id> [--category <category>]
  # reads .agent/runs/<task-id>/retrospective.json and scaffolds a
  # schema-conformant .agent/evals/<category>/<ID>.yaml. --category
  # defaults to the retrospective's `cause`, lowercased (its own
  # ARCHITECTURE -> architecture is exactly this directory's canonical
  # ARCH-017 example); repos are free to use any lowercase-kebab
  # category, per "create only the categories this repository needs"
  # above. repo_snapshot is pinned via `git rev-parse HEAD`; when the
  # repo isn't git (or has no commits yet), it is set to "UNPINNED" with
  # a printed warning — pin it manually before trusting the case to
  # replay. required/forbidden are seeded from the originating task's
  # payload.design.required_seams / .forbidden when present.

agent eval list [--json]
  # lists every case under .agent/evals/, across categories.

agent retro create <task-id> --trigger ... [--eval] [--eval-category <category>]
  # `--eval` chains `agent eval create --from-retro` onto the new
  # retrospective and records the resulting path in the
  # retrospective's own `eval_case` field (spec F.10 "Produce a
  # replayable eval case for every qualifying failure").
```
