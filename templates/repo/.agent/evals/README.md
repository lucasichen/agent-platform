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
