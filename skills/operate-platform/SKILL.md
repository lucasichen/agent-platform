---
name: operate-platform
description: >
  How to drive the agent-platform mission loop end to end with the
  `agent` CLI — mission creation, workflow instantiation, claiming and
  running tasks, evidence, gates, and exception-first monitoring. Load
  this whenever an agent (in any role, or an operator) needs to create a
  mission, instantiate a workflow, list/claim/start/submit a task, gate a
  task, check fleet status, or otherwise operate the platform's control
  plane in a repo that has run `agent init`. Also trigger on: "create a
  mission", "run the workflow", "claim the next task", "what's ready",
  "check status", "gate this task", "why is this task blocked". Not the
  file to load for how to *do* a specific task's work — that's the
  matching `roles/F<N>-*.md` file plus, for workers, `skills/worker-startup`.
---

<!-- owner: repo-maintainer (spec §12.4). staleness trigger: every command
     below must match docs/DESIGN.md §6 and its extension in
     docs/skills-design.md §5. Re-verify against `agent --help` and
     platform/src/cli.ts after any CLI change; a command name, flag, or
     transition described here that no longer matches the CLI is stale. -->

# Operate the Platform

This is the harness-agnostic loop for driving `agent` (the control-plane
CLI, spec F.5, `platform/`) from an empty ready-to-work repo through a
merged, evidence-backed task. It complements — doesn't replace — the role
contracts in `roles/`: this file is *how to move tasks through the
system*; the role contract is *how to do the work a task asks for*.

## Prerequisites

- The `agent` CLI is installed and on `PATH` (or run via `npx --prefix
  <path-to-agent-platform>/platform agent ...`) — see
  `docs/getting-started.md` §1.
- The target repo has been initialized: `agent init [--repo <path>]`
  installs the `.agent/` scaffold and default policies (spec Appendix A).
  Every command below implicitly operates on `--repo <path>` (defaults to
  cwd).
- `agent validate` passes before you build anything on top of the
  scaffold — it schema-validates missions/tasks/policies/templates,
  and (once `policies/bindings.yaml` exists) the bindings policy and
  every skill path/`startup_skills` entry it names.
- Optional: `agent skills install --harness <claude-code|cursor|generic>`
  copies the skills your bound roles need into your harness's discovery
  path (`.claude/skills/`, Cursor's skills dir, or a generic
  `.agent/skills-index.md`) — see `skills/README.md` for the binding
  model this reads (`policies/bindings.yaml`). Not required for the loop
  below to work; it just puts skills where your harness auto-discovers
  them instead of you opening them by hand.

## The loop

### 1. Author and register a mission

A mission is the unit of delegated intent (spec §6.0): goal, inputs,
outputs, budget, human gates. Write `mission.yaml` (see
`docs/getting-started.md` §3 for a full example), then:

```bash
agent mission create --file <path/to/mission.yaml>
```

Validates against `schemas/mission.schema.json` and registers it under
`.agent/missions/<MISSION-ID>/`. `workflow.id` must name a template that
exists in `registry/workflows/` (`project-definition`,
`feature-development`, `bug-fix` ship in the MVP).

### 2. Instantiate the workflow

```bash
agent workflow instantiate --mission <MISSION-ID>
```

Compiles the named template into `workflow-instance.yaml` plus task
stubs (`BLOCKED`/`READY` per dependency) — spec F.0, composition only, no
planning decisions. Validates: every stage maps to a known role, deps are
explicit and acyclic, every mission `outputs[]` entry is covered by some
stage's outputs, every human gate names a DAG point. Rejects rather than
guessing if any of that doesn't hold.

```bash
agent task list --mission <MISSION-ID>
```

now shows the compiled task DAG.

### 3. Find and claim a task

```bash
agent task list --state READY --mission <MISSION-ID>
agent task claim <TASK-ID> --agent <name> [--ttl <minutes>] [--worktree]
```

`READY → ASSIGNED`, takes a lease (default TTL 60 minutes). **Read the
printed output before doing anything else** — `task claim` (and `task
start`) resolve the task's `role` through `policies/bindings.yaml` and
print the harness-neutral trigger every agent should see:

```text
Required before work begins:
  skills/worker-startup
Recommended skills (claude-code):
  skills/vendor/superpowers/skills/test-driven-development
  skills/vendor/pstack/skills/poteto-mode
```

(`--json` includes the same data as `{startup_skills: [], skills: []}`.)
If the task's role has no `startup_skills` binding, load the role's own
contract file (`roles/F<N>-*.md`) and work from that directly — a task
whose role names a `worker` binding should still be treated as if
`skills/worker-startup` applies even absent an explicit binding entry,
since that skill *is* the F.6 protocol. Missing `bindings.yaml` entirely
prints nothing and is not an error — bindings are optional policy, not a
hard dependency.

Pass `--worktree` for implementation tasks where filesystem isolation
helps (parallel workers, or you want a clean revert path): on a git repo
this creates `.worktrees/<TASK-ID>` on branch `task/<TASK-ID>` (reusing
the branch if it already exists) and records `{workspace:
".worktrees/<TASK-ID>"}` on the task; work happens inside that directory.
It fails clearly on a non-git repo — don't fight it, just work in the
main tree. Reclaiming a task or reaching a terminal state never deletes
the worktree; the CLI prints a `git worktree remove` hint when it's safe
to clean up — do that yourself when you're done, the platform won't do
it for you.

### 4. Start, do the work, submit

```bash
agent task start <TASK-ID>          # ASSIGNED -> RUNNING
```

Do the bounded work per the role contract the task names (`roles/F<N>-*
.md`) — plus, for `worker`-role implementation/bug-fix tasks,
`skills/worker-startup`'s preconditions and evidence duties. Leave the
full evidence bundle in `.agent/runs/<TASK-ID>/` as you go (scaffolded at
claim time by `agent evidence init <TASK-ID>` if it wasn't already) —
`docs/evidence-contract.md` is the normative shape:
`decisions.tsv`, `diff.patch` (implementation tasks), `cost.json`, local
verification results, `transcript.jsonl`.

```bash
agent evidence check <TASK-ID> [--json]   # completeness check before you submit
agent task submit <TASK-ID>               # RUNNING -> VERIFYING (implementation) or GATING (other types)
```

Submitting ends the doing-role's authority over the task — it does not
mark it done, and the submitting role never gates its own work.

### 5. Gates

Gates are recorded from evidence, never assumed:

```bash
agent task gate <TASK-ID> --gate verification --result pass|fail \
  --evidence .agent/runs/<TASK-ID>/verification/result.json

agent task gate <TASK-ID> --gate review --result pass|fail \
  --evidence .agent/runs/<TASK-ID>/reviews/architecture.json
```

`--gate` is `verification` or `review`; `--result` is `pass` or `fail`.
A `pass` result runs `agent evidence check` internally and **refuses**
if the bundle is incomplete — "PASS without evidence is FAIL"
(`docs/evidence-contract.md`, spec Appendix B). This is the mechanical
form of "workers do not certify themselves" (spec §2): the CLI will not
accept a worker's own say-so, and the person/agent invoking `task gate`
should be the independent verifier/reviewer role (F.7/F.8), not the
worker that produced the candidate.

What a `pass` does depends on task type and, for implementation tasks,
which gate:

```text
non-implementation task:   GATING --(gate pass, any --gate value)--> DONE
implementation task:       VERIFYING --(gate verification, pass)--> REVIEWING
                            REVIEWING  --(gate review, pass)-->        MERGE_READY
```

A `fail` result increments `attempt`; if the next attempt would exceed
`budget.attempts`, the task goes to `BLOCKED` with reason
`budget-exhausted` instead of retrying (see Budget/lease semantics
below) — otherwise it goes to `REPAIR` (`REPAIR → RUNNING` to resume
work, per the role contract's failure-mode handling).

### 6. Done / MERGED semantics

Non-implementation tasks reach `DONE` directly from a passing gate — no
further command needed. Implementation tasks are **`DONE` at `MERGED`**,
one more step after both gates pass:

```bash
agent task done <TASK-ID>     # MERGE_READY -> MERGED
```

`MERGED` is where dependents unblock (`isDependencySatisfied`, spec
§6.3) — the CLI recomputes sibling-task readiness automatically the
moment a task lands on `DONE`/`MERGED`/`DEPLOYED`/`PRODUCTION_VERIFIED`,
you do not need to re-run anything to propagate it. `DEPLOYED` and
`PRODUCTION_VERIFIED` (reached by later, out-of-loop tooling/gates) update
the record but never block anything — treat them as informational once a
task is `MERGED`.

### 7. Check in without watching

```bash
agent status [--json]
```

Exception-first (spec §14.5): budget-exhausted tasks, expired leases,
tasks stuck in `REPAIR`, and gate failures surface first; mission
progress and per-state tallies come after. It deliberately does not show
routine `RUNNING`/`GATING` activity — see `docs/metrics.md` for why. This
is the view to check regularly; individual task transcripts are for when
something in the exceptions list needs investigating.

## Budget / lease semantics

- **Lease**: `agent task claim <id> --agent <name> --ttl <minutes>`
  (default 60). While held, no one else can claim the task. If an agent
  crashes or walks away, the lease simply expires — nothing else changes
  until someone reclaims it.
- **Reclaim**: `agent task reclaim` scans for tasks in a
  lease-holding state (`ASSIGNED`, `RUNNING`, `REPAIR`, `VERIFYING`,
  `REVIEWING`) whose lease has expired, and returns them to `READY`
  (attempt count preserved) so nothing silently stalls. Run this
  periodically, or whenever `agent status` shows an expired lease.
- **Attempts / budget-exhausted**: every gate `fail` increments
  `attempt`. When the next attempt would exceed `budget.attempts`, the
  task moves to `BLOCKED` with `blocked_reason: budget-exhausted` instead
  of returning to `REPAIR` — this is a human-attention state, not
  something the platform auto-recovers (unlike a `BLOCKED` task waiting
  only on unmet dependencies, which unblocks itself the moment its
  dependencies complete). `agent status` surfaces it under exceptions;
  resolving it (raise the budget, rebind to a stronger configuration,
  descope) is a human/operator decision, not a retry.
- **`agent task fail <id> --reason <reason>`** is the manual escalation
  path — an operator (or a role explicitly authorized to abandon a task,
  e.g. after a §8.1 three-failure architecture escalation) can move a
  task straight to `BLOCKED` from any in-flight state without waiting for
  a gate to fail it.

## Retrospectives

When a failure trigger fires — `failed-task`, `architecture-rejection`,
`human-correction`, `high-cost-run`, `unexpected-escalation`, `rollback`,
or (for a surprisingly good outcome worth capturing) `strong-success` —
scaffold a retrospective rather than letting the failure pattern
disappear:

```bash
agent retro create <TASK-ID> --trigger <trigger> [--cause <cause>]
```

`--cause` is one of `SPEC|PLANNING|ARCHITECTURE|ROUTING|CONTEXT|SKILL|
MEMORY|HARNESS|TOOLING|CODEBASE|MODEL` (spec §13.2; defaults to
`CODEBASE` if omitted — refine it). This writes
`.agent/runs/<TASK-ID>/retrospective.json` with `status: "proposed"` and
a stub `candidate_interventions[]` — refine and reclassify it (per F.10,
`roles/F10-learning-evaluator.md`) before anything in it is treated as
policy. Retrospective interventions are **never auto-applied**; a human
or the owning role reviews and lands them (e.g. into
`architecture/canonical-patterns.md`, `policies/architecture.yaml`, or
`.agent/evals/`).

## Where the role contracts live

Every task names exactly one role (`task.role`, spec §6.1). Open the
matching `roles/F<N>-*.md` file, give it — plus the task envelope and its
pinned `inputs[]` — to whatever model/harness is doing the work. See
`roles/README.md` for the full index and the binding rule (spec Appendix
F.11: "the system depends on the contracts, never the tools"), and
`docs/harness/{cursor,claude-code,generic}.md` for how to bind a role
file to a specific harness. `AGENTS.md` is the one-page harness-agnostic
summary of the whole loop and the core rules (workers don't self-certify,
escalate uncertainty not task size, existing code isn't automatically
canonical, PASS without evidence is FAIL) that apply throughout every
step above.
