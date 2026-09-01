# Getting Started

This platform is built for one audience: **a solo senior developer** who
wants to safely delegate increasing amounts of engineering work to
coding agents, without watching them work and without trusting their
self-report (spec §1). Everything below assumes that's you.

The goal for your first working setup — the MVP milestone, verbatim from
the spec (§15):

> Five independent tasks can be delegated without watching the workers,
> completion status can be trusted, architectural shortcuts are rejected
> before becoming reference code, and failures automatically enter the
> learning system.

That's what this walkthrough gets you to. Not a 100-agent fleet — five
trustworthy delegated tasks, first.

## 1. Install the CLI

From this repo, the `agent` CLI lives in `platform/` (`@agent-platform/cli`,
bin `agent`). Two ways to get it on your PATH:

```bash
# Global install from a local checkout
cd platform
npm install
npm run build
npm install -g .

# or, without installing globally, run it via npx from the target repo
npx --prefix <path-to-agent-platform>/platform agent --help
```

Once installed, `agent --help` should list the full command surface (see
`docs/DESIGN.md` §6 for the complete list). Everything below assumes
`agent` is on your PATH; substitute the `npx` form if not.

## 2. Initialize a target repo

In the repository you actually want to delegate work in (not this
platform repo):

```bash
cd path/to/your-project
agent init
```

`agent init` installs the `.agent/` scaffold (spec Appendix A) from
`templates/repo/.agent/` and copies default policies from this platform's
`/policies` into `.agent/policies/`. After this you'll have:

```
your-project/.agent/
  repo.yaml               fill in {{placeholders}} — see below
  domain/CONTEXT.md
  architecture/{system.md,canonical-patterns.md,adr/,design/}
  features/feature-map.yaml
  policies/{risk.yaml,models.yaml,escalation.yaml,architecture.yaml}
  verification/README.md
  memory/{index.md,README.md,discoveries/,incidents/}
  evals/README.md
  missions/
  runs/
```

Fill in `.agent/repo.yaml` first — name, setup commands, services,
dependencies, verification commands (`docs/evidence-contract.md`'s
verification section explains what each entry needs to satisfy). Every
template file explains, in its own header comment, who owns it and what
makes it go stale (spec §12.4) — read those before editing.

Then run:

```bash
agent validate
```

to confirm the scaffold and policies are structurally valid before you
build anything on top of them.

## 3. Install skills into your harness

```bash
agent skills install --harness claude-code|cursor|generic [--repo <path>]
```

Reads `.agent/policies/bindings.yaml` (installed by `agent init` above,
falling back to the packaged default) and copies every skill your roles
are bound to for that harness — the platform's own contract skills
(`skills/worker-startup`, `skills/operate-platform`) plus pinned MIT
snapshots of vendored packs under `skills/vendor/` — into your harness's
discovery path (`.claude/skills/`, Cursor's skills dir). For
`--harness generic` it instead writes `.agent/skills-index.md` (name,
description, path table), since a generic harness has no fixed
discovery directory to copy into; it never edits `AGENTS.md`. Idempotent
— re-running skips files it already placed and reports what it skipped;
`--force` overwrites a locally-modified copy.

This step is optional: `agent task claim`/`start` always print the
resolved skills for a task's role regardless (step 6 below), so nothing
downstream depends on having run this. It just puts skills where your
harness auto-discovers them instead of you opening a `SKILL.md` by hand.
See `skills/README.md` for the three-layer binding model (contract
skills, vendored packs, optional native installs) this reads, and
`docs/harness/{cursor,claude-code,generic}.md` for the per-harness
specifics.

## 4. Author a mission

A mission is the unit of delegated intent — goal, inputs, outputs,
budget, and which decisions require a human (spec §6.0). Example,
adapted from the spec:

```yaml
# .agent/missions/PROJECT-CODING-GRADER/mission.yaml
id: PROJECT-CODING-GRADER
type: project-definition
workflow:
  id: project-definition
  version: 1

goal:
  Build a LeetCode-style C++ coding platform.

parent_mission: null

inputs:
  - human-brief.md
  - existing-repo

outputs:
  - domain-model
  - research-findings
  - architecture-design
  - approved-project-spec
  - implementation-task-graph

constraints:
  language: C++20

budget:
  dollars: 40

human_gates:
  - product-decisions
  - major-architecture
  - spec-approval

status: ACTIVE
```

`id` is SCREAMING-KEBAB. `workflow.id` must name a template that exists
in `registry/workflows/` (MVP ships `project-definition`,
`feature-development`, `bug-fix` — spec §15). `outputs[]` are the
artifact names the workflow's stages must collectively produce; the
compiler (next step) rejects the mission if any output has no producing
stage.

Register it:

```bash
agent mission create --file .agent/missions/PROJECT-CODING-GRADER/mission.yaml
```

## 5. Instantiate the workflow

```bash
agent workflow instantiate --mission PROJECT-CODING-GRADER
```

This compiles the named workflow template into a concrete
`workflow-instance.yaml` plus task stubs (`BLOCKED`/`READY` per
dependency), validating as it goes (spec DESIGN.md §3): every stage maps
to a known role, dependencies are explicit and acyclic, every mission
output is covered by some stage, and every human gate has a named DAG
point. This is **composition only** — it does not make product or
architecture decisions on your behalf; if it can't validate, it rejects
the instance before any task goes `READY` rather than guessing.

```bash
agent task list --mission PROJECT-CODING-GRADER
```

now shows the compiled task DAG.

## 6. Run the loop: claim, start, submit, gate

Every task names a role contract (`.agent/runs/<TASK-ID>/task.yaml`'s
`role` field, e.g. `worker`, `verifier`, `reviewer`). Open the matching
file in `/roles` — `F6-worker.md`, `F7-verifier.md`, `F8-reviewer.md`,
etc. — and give it, along with the task envelope and its pinned inputs,
to whatever model/harness you're running that role in. See
`docs/harness/cursor.md`, `docs/harness/claude-code.md`, or
`docs/harness/generic.md` for how to bind a role file to your specific
harness.

```bash
agent task list --state READY --mission PROJECT-CODING-GRADER

agent task claim <TASK-ID> --agent <you-or-your-agent-name> [--ttl <minutes>] [--worktree]
agent task start <TASK-ID>                                    # ASSIGNED -> RUNNING

# ... the role does its bounded work, per its contract's inputs/outputs/
#     done-means/failure-modes ...

agent task submit <TASK-ID>                                   # -> GATING or VERIFYING
```

`claim` (`READY -> ASSIGNED`, default lease TTL 60 minutes) does more
than transition state — it resolves the task's `role` through
`.agent/policies/bindings.yaml` and prints the harness-neutral trigger
every agent should read before doing anything else:

```text
Required before work begins:
  skills/worker-startup
Recommended skills (claude-code):
  skills/vendor/superpowers/skills/test-driven-development
  skills/vendor/pstack/skills/poteto-mode
```

plus, once memory recall is live (`docs/memory.md` §3 — landing in the
current build wave), any memory paths matching the task's
`payload.areas`. `--json` carries the same data as `{startup_skills:
[], skills: []}`. A repo with no `bindings.yaml` prints nothing — this
is optional policy, not a hard dependency, and step 3's `skills install`
is not required for it to work.

Pass `--worktree` for implementation tasks where filesystem isolation
helps: on a git repo it creates `.worktrees/<TASK-ID>` on branch
`task/<TASK-ID>` (reusing the branch if it exists) and records the
workspace path on the task; it fails clearly on a non-git repo instead
of silently working in the main tree. Reclaiming the task or reaching a
terminal state leaves the worktree in place and prints a `git worktree
remove` hint — cleanup is yours, never automatic.

For implementation tasks the lifecycle specializes (spec §6.3):
`RUNNING -> VERIFYING -> (fail -> REPAIR -> RUNNING) -> REVIEWING ->
MERGE_READY -> MERGED -> DEPLOYED -> PRODUCTION_VERIFIED`. A task is
**`DONE` at `MERGED`** — dependents unblock there; `DEPLOYED`/
`PRODUCTION_VERIFIED` update the record but never block anything.

Gates are recorded, never assumed:

```bash
agent task gate <TASK-ID> --gate verification --result pass \
  --evidence .agent/runs/<TASK-ID>/verification/result.json

agent task gate <TASK-ID> --gate review --result pass \
  --evidence .agent/runs/<TASK-ID>/reviews/architecture.json
```

A gate call with no `--evidence` pointing to a real file is refused — see
`docs/evidence-contract.md`'s **PASS without evidence is FAIL** rule.
This is the mechanical version of "workers do not certify themselves"
(spec §2): the CLI will not accept a worker's own say-so as a passing
verification or review.

If a task's lease expires (agent crashed, walked away, whatever),
`agent task reclaim` frees it back to `READY` so nothing silently stalls.
If it exhausts `budget.attempts`, it moves to `BLOCKED` with reason
`budget-exhausted` — check `agent status` (below).

## 7. Evidence bundles

Every task run leaves a full bundle under `.agent/runs/<TASK-ID>/` —
transcript, diff, verification results, review verdicts, cost, the final
four-dimension result, and (when triggered) a retrospective. Full shapes:
`docs/evidence-contract.md`. `agent evidence init <TASK-ID>` scaffolds the
directory at claim time; `agent evidence check <TASK-ID>` is what gates
call internally to refuse incomplete bundles.

You should rarely need to touch these files by hand — the CLI and the
role contracts produce them. Read them when you're deciding whether to
trust a `DONE`, when a task failed and you want to know why, or when
you're running `agent retro create` to turn a failure into learning.

## 8. Memory: from candidate to durable fact

(`agent memory ...` is landing in the current build wave — see
`docs/memory.md` for the full design; a role that hasn't shipped this
yet in your checkout is expected, not a bug.)

The short version of the loop:

1. Any role, while working a task, appends a fact future agents should
   know *before* their task starts to
   `.agent/runs/<TASK-ID>/memory-candidates.jsonl` — distinct from
   `decisions.tsv` ("why I chose"), this is "what is durably true."
2. `agent task submit` auto-fires `agent memory propose <task-id>`, so a
   candidate is never silently lost — each becomes a proposal file under
   `.agent/memory/proposals/`.
3. A human or the tier's authority role reviews it:

   ```bash
   agent memory list [--status pending]
   agent memory show <proposal-id>
   agent memory approve <id> --by <role>
   agent memory reject <id> --by <role> --reason "..."
   ```

   Tier A (operational) needs verifier approval, Tier B (domain) needs
   domain/spec authority, Tier C (architecture) needs design authority —
   a worker cannot establish architectural truth by writing memory. Only
   approval writes the shared `.agent/memory/{index.md,<topic>.md,...}`
   files; nothing else does, and never you directly.
4. `agent task claim` recalls matching entries for a task's
   `payload.areas` and prints their paths, same as it does for skills
   (step 6).

## 9. Checking in without watching

```bash
agent status
```

is the exception-first dashboard (spec §14.5) — mission/feature
completion, first-pass success, retries, escalations, spend, and
outstanding human decisions. It deliberately does not show you "agent is
reading a file" — see `docs/metrics.md` for what it surfaces instead and
why. This is the view you should actually be checking, not individual
task transcripts.

## Where to go next

- `docs/metrics.md` — what "good" looks like, and when you've earned the
  next concurrency rung.
- `docs/security.md` — what's already defended against by default
  (prompt injection, secret leakage, sandboxing, supply-chain adds) and
  what that means for how you configure a target repo.
- `docs/evidence-contract.md` — full file-by-file shape of everything a
  task run produces.
- `skills/README.md` and `docs/integrations.md` — the three-layer skill
  binding model (contract skills, vendored MIT packs, native installs)
  behind step 3 and every role's `startup_skills`.
- `docs/memory.md` — the full memory design behind step 8.
- `docs/harness/` — the concrete per-harness how-to for wherever you're
  actually running your agents.
- `AGENTS.md` — hand this (via `CLAUDE.md`'s pointer, or directly) to any
  agent working in a target repo; it's the harness-agnostic operating
  loop and core rules in one page.
