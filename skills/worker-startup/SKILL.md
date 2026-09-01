---
name: worker-startup
description: >
  Task-start protocol for the agent-platform Worker role (spec Appendix
  F.6, roles/F6-worker.md). Load and run this automatically before
  writing any code, running any fix, or touching any file for a bounded
  task claimed through `agent task claim` in a repo that has run `agent
  init` (has a `.agent/` directory) — i.e. whenever an agent is about to
  begin platform implementation, bug-fix, or other worker-role work.
  Also trigger on: "start this task", "begin implementation", "work
  TASK-<id>", "pick up the next ready task", "implement <TASK-ID>", or
  being handed a task envelope together with `roles/F6-worker.md`. Do
  not skip this because a task looks small — the preconditions below are
  what makes a candidate trustworthy without anyone watching the work.
---

<!-- owner: repo-maintainer (spec §12.4). staleness trigger: this file
     restates roles/F6-worker.md, spec §5.1-§5.3, §8, §8.1, and the CLI
     surface in docs/DESIGN.md §6 / docs/skills-design.md §5 — if any of
     those change shape, this file is stale until re-synced. -->

# Worker Startup

This is the F.6 Worker's task-start protocol: the preconditions that must
run **before** any implementation work, the evidence duties that run
**throughout** and at the end, and the two hard stop-conditions (design
escalation, three-failure rule) that override "just keep trying." This
file is self-contained — an agent with only this file plus its claimed
task can work correctly. For the full role contract (inputs/outputs/done
means/failure modes), see `roles/F6-worker.md`; this skill operationalizes
its steps 1-4 and its evidence duties as a checklist you actually run.

The worker never certifies its own work (spec §2, §10.3, AGENTS.md "Core
rules"). Everything below exists so an independent verifier and reviewer
can trust the candidate from evidence, not from narration.

## Step 1 — Write the precondition todolist, then check it off

Immediately after `agent task start <id>` (or the harness-equivalent of
beginning work on the claimed task), and **before reading any source file
beyond the task envelope itself**, write out these four items verbatim as
a todolist — using your harness's todo/task-tracking tool if it has one,
otherwise as a plain checklist in your working notes — and check each one
off as, and only as, you actually complete it:

```text
1. [ ] Read the full task envelope, including payload.acceptance[] and
       payload.verification[], without assuming scope.
2. [ ] Read every payload.design.decision_refs[] entry and the full
       payload.design block (authority, required_seams, forbidden,
       invariants) before writing any code.
3. [ ] Check .agent/architecture/canonical-patterns.md before treating
       any existing code as an example to copy.
4. [ ] Write the failing test or reproduction first, before implementing
       anything.
```

Do not silently do the underlying work and skip writing the list — the
list is the artifact that lets a reviewer or a later agent see the
protocol was actually followed, not merely known.

### 1. Read the task envelope without assuming scope

`agent task show <id> --json` (or the task YAML directly, spec §6.1).
Read the whole envelope, not just the title/goal line — in particular:

- `payload.acceptance[]` — the behaviors that must be independently
  demonstrable. This is the scope boundary; if it isn't in acceptance, it
  isn't in scope, and if the work you think is needed isn't covered by
  acceptance, that's a signal to check with the task, not to add it
  silently (spec §4: "each task should produce independently
  demonstrable behavior").
- `payload.verification[]` — which verification depths apply (`unit`,
  `api`, etc., spec §9) so you run the same category of check locally
  that F.7 will run independently.
- `dependencies[]`, `inputs[]` (pinned `uri`/`version`/`hash`), and
  `budget: {attempts, dollars}` — know your ceiling before you start.

### 2. Read every decision_ref and the full design block first

Load every entry in `payload.design.decision_refs[]` (ADRs, design docs —
resolve `adr://`/`spec://`/`artifact://` URIs through the mission
artifact graph; an unresolvable non-ephemeral URI is a task intake
failure, not something to guess past) and the complete `payload.design`
block: `authority`, `required_seams`, `forbidden`, `invariants` (spec
§5.1). These are constraints, not suggestions, and they must be read
**before** any code is written, not discovered by grepping the diff
afterward.

```yaml
design:
  authority: account-mission-planner
  decision_refs: [ADR-021, DESIGN-account-lifecycle]
  required_seams: [AccountService.delete, SessionService.revokeAll]
  forbidden: [direct session persistence mutation]
  invariants:
    - AccountService owns account lifecycle
    - controllers cannot mutate session persistence directly
```

You implement these decisions. You do not silently replace them (spec
§5.1, last line).

### 3. Canonical patterns before copying anything

Check the target repo's `.agent/architecture/canonical-patterns.md`
before treating any existing pattern in the codebase as an example to
copy (spec §5.3, AGENTS.md "Existing code is not automatically
canonical"). Code frequency is not architectural approval — the most
common or most recently touched implementation of a seam may be marked
legacy. Prefer the marked-canonical implementation even if it's less
common in the codebase. This file, like every durable `.agent/` artifact,
carries an owner and staleness trigger (spec §12.4) — if it looks stale,
verify against code rather than blindly trusting or blindly ignoring it,
and note the discrepancy rather than silently picking a side.

### 4. Failing test / reproduction before implementation

Write the test that demonstrates the required behavior does not yet
exist, before writing the fix (spec §8). For a bug-fix
`reproduce-diagnose` task, this step **is** the entire deliverable:
produce the reproduction and the failing test, plus a root-cause
hypothesis — do not also write the fix in this step.

## Skip rule

Every precondition above should normally run for every task. If one
genuinely does not apply (e.g. a task with no `decision_refs[]` because
none exist yet, or a `reproduce-diagnose` task where "implementation" in
step 4 doesn't apply because the reproduction *is* the deliverable), that
is a skip, and every skip requires a one-line justification logged as a
row in `.agent/runs/<TASK-ID>/decisions.tsv`:

```text
ts	decision	rationale	alternatives
2026-08-31T14:02:00Z	skipped precondition 2 (no decision_refs)	payload.design.decision_refs is empty; task has no design block to read	none — nothing to skip past
```

Never skip silently. A precondition skipped without a logged
justification is a protocol violation regardless of whether the resulting
code passes tests (mirrors spec §5.2's "silently invents ... has failed
this contract" standard).

## Step 2 — Do the work

Once the four preconditions are checked off (or skipped-with-justification):

5. **Implement** the smallest change that makes the failing test pass
   while honoring every `required_seams` entry and touching nothing on
   `forbidden`.
6. **Refactor** for clarity once green — this is worker freedom territory
   (below).
7. **Clean up.** Remove dead code and anything reading as scope creep
   beyond `payload.acceptance[]`. A candidate that "also" touches
   unrelated code is not a clean candidate.
8. **Run local verification** — whatever deterministic checks the repo
   exposes for this change (`.agent/repo.yaml` verification commands,
   `payload.verification[]` categories). This is fast feedback for you,
   not a substitute for F.7's independent run of the same or stronger
   checks.

If `pstack-poteto-mode` is installed in your harness, enter it now for
execution style (task-start routing, principle-* skill loading, playbook
matching) — the platform preconditions and evidence duties in this file
still bind regardless; poteto-mode governs *how* you work the steps, not
whether these platform obligations apply.

## Worker freedom vs. escalation (spec §5.2)

Workers may independently decide:

```text
private helper structure
local algorithms
naming
test organization
small local refactors
internal implementation details
```

Workers **must escalate** — stop, do not invent — any of:

```text
new service
new domain abstraction
new public interface
ownership change
API contract change
new persistence abstraction
dependency-direction change
duplicate domain concept
cross-module bypass
new third-party dependency
```

Escalation workflow, verbatim (spec §5.2):

```text
worker discovers design question
          ↓
STOP architectural invention
          ↓
design-authority escalation
          ↓
architect / arena if necessary
          ↓
ADR/design update
          ↓
affected tasks updated
          ↓
execution resumes
```

A worker that silently invents an architectural decision instead of
escalating has failed this contract regardless of whether the resulting
code passes tests. Log the escalation itself as a decision in
`decisions.tsv` (what was discovered, why it crosses the line above, who
it was escalated to) — an escalation with no record is indistinguishable
from one that never happened.

## Debugging escalation — the three-failure rule (spec §8.1)

Prevents endlessly stacking workarounds on the same underlying problem:

```text
failure 1
diagnose

failure 2
fresh diagnosis / stronger context

failure 3
STOP PATCHING
     ↓
root-cause escalation
     ↓
strong debugger
     ↓
architecture suspicion?
     ↓
architect
```

Repeated repair failure is evidence that assumptions or architecture may
be wrong, not evidence to try a fourth patch. On the third consecutive
failure to fix the *same underlying problem* (not three unrelated bugs),
stop patching and escalate: to a stronger configuration for root-cause
diagnosis, and to the architect (F.3) if the pattern suggests the
architecture itself — not the implementation — is wrong. This pairs with
`skills/vendor/superpowers/skills/systematic-debugging` where that pack
is bound (its 4-phase root-cause protocol governs *how* each diagnosis
attempt is done); this rule governs *when to stop* regardless of which
debugging methodology is bound.

## Evidence duties

When you learn something durably true, append it to
`.agent/runs/<TASK-ID>/memory-candidates.jsonl` — never write
`.agent/memory/` directly (docs/memory.md).

Log decisions **as you make them**, not batched at the end — a design
question resolved inside your stated freedom (worker freedom list above)
still gets a row in `decisions.tsv` so it's auditable without replaying
the full transcript (`docs/evidence-contract.md`). Every consequential
decision — a chosen algorithm with a real alternative, a helper structure
that could have gone another way, a skipped precondition, an escalation —
gets one row: `ts\tdecision\trationale\talternatives`.

Before calling `agent task submit <id>`, the run directory
(`.agent/runs/<TASK-ID>/`, scaffolded by `agent evidence init <id>` at
claim time) must contain:

```text
decisions.tsv               every consequential decision, one row each
diff.patch                  the literal candidate change (git diff format) —
                             this, not the transcript, is what verifier/
                             reviewer evaluate
cost.json                   spend for this run (spec Appendix B shape)
verification/…              your local verification results (fast
                             feedback; F.7 runs its own, independently)
transcript.jsonl             the raw turn/tool-call record (most harnesses
                             produce this automatically)
```

Then, and only then:

```bash
agent task submit <id>
```

This moves `RUNNING → VERIFYING` (implementation tasks) or `RUNNING →
GATING` (other task types) — spec §6.3. **Submitting is the end of this
role's authority over the task.** You do not call `agent task gate`, you
do not write `verification/result.json`'s verdict, you do not write
`reviews/*.json`, and you do not mark your own task `DONE`/`MERGED`. If
`agent evidence check <id>` reports incomplete evidence, fix the bundle
before submitting — a gate will refuse it anyway ("PASS without evidence
is FAIL", `docs/evidence-contract.md`), and the worker never certifies
itself.

## Done means (recap)

Candidate submitted within budget; failing test written before
implementation; every precondition run or logged-skipped; required seams
used; forbidden list untouched; §5.2 escalation triggers honored; §8.1
three-failure rule honored. See `roles/F6-worker.md` for the full
Failure modes / On underdelivery sections this protocol exists to
prevent.
