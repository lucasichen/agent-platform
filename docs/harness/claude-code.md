# Running agent-platform from Claude Code

Claude Code satisfies the generic contract (`docs/harness/generic.md`):
it reads repo files, runs the `agent` CLI directly, and loads role
contracts as skills or subagents. This page is the concrete how-to.

## CLAUDE.md pointer

This repo's own `CLAUDE.md` is a three-line pointer to `AGENTS.md` — that
is the intended pattern for target repos too: keep `AGENTS.md` as the one
harness-agnostic entrypoint, and let `CLAUDE.md` just point at it rather
than duplicating content that would then drift. `agent init` installs
this same pattern into target repos; if a target repo already has a
`CLAUDE.md`, add the pointer line rather than replacing whatever else is
there.

Claude Code reads `CLAUDE.md` automatically at session start; the pointer
gets `AGENTS.md` — and through it, the whole operating loop — in front of
every Claude Code session in the repo without hardcoding platform content
into a Claude-specific file.

## Role files as skills or subagents

Two ways to bind a role contract in Claude Code, pick based on how much
isolation the role needs:

### As a skill

Good for roles you invoke inline within an ongoing session — e.g.
consulting the worker role's failure modes without leaving your current
context. Package a role file as a skill (`.claude/skills/<role>/SKILL.md`
whose body is the role contract, or a thin wrapper that loads it) when you
want it available as `/`-invokable but sharing the calling session's
context.

### As a subagent

Preferred for roles that need **isolation from the worker's context** —
most importantly verifier and reviewer. Define a subagent per role (see
Claude Code's subagent configuration) whose system prompt is the role
file's full text, with tool access scoped to what that role legitimately
needs (a reviewer subagent doesn't need write access; a verifier subagent
needs to run tests but not touch production credentials — see
`docs/security.md` sandboxing). Launching the reviewer as a subagent
rather than continuing in the worker's own session is what makes
judge decorrelation (spec §10.3) real rather than nominal: a subagent
does not inherit the worker's transcript or rationalizations unless you
explicitly hand them over, which the reviewer contract says not to do
(`docs/evidence-contract.md` reviews section).

Either way: load the role file's **full text**, not a paraphrase. The
contract's inputs/outputs/done-means/failure-modes are binding.

## Running the `agent` CLI from Claude Code

No special integration — Claude Code runs shell commands directly. From
the target repo root (after `agent init`, see `docs/getting-started.md`):

```
agent task list --state READY --mission <MISSION-ID>
agent task claim <TASK-ID> --agent claude-code-<you>
agent task start <TASK-ID>
# implementation work, in a session governed by the worker role/skill ...
agent task submit <TASK-ID>
agent task gate <TASK-ID> --gate verification --result pass --evidence .agent/runs/<TASK-ID>/verification/result.json
```

Claude Code can drive these transitions itself as part of its own tool
use — same CLI, same state-machine rules, same evidence requirements as
running them by hand. Nothing about the CLI is Claude-Code-specific;
what's specific to this harness is only how you package and isolate
roles (skills/subagents, above).

## Suggested composer workflow per role

- **Worker**: main session or a worker-scoped skill, task's pinned inputs
  read via `Read`/`Grep`, implementation bounded to what the role and
  task payload authorize. Hitting an escalation trigger (`AGENTS.md`
  "Core rules") means stop and hand off — don't let the session
  improvise a new abstraction to route around it.
- **Verifier**: a dedicated subagent, launched fresh per task, with only
  the diff, the task's `verification[]` payload, and
  `.agent/verification/README.md`'s per-repo instructions in context —
  not the worker's transcript.
- **Reviewer**: a dedicated subagent per lens (spec/quality/architecture)
  where risk level warrants decorrelated review (spec §10.4), with tool
  access limited to reading (diff, spec, architecture refs, canonical
  map) — no write access, and never given the worker's transcript or
  self-assessment, per `docs/evidence-contract.md`.

For higher-risk tasks (R3+, `policies/risk.yaml`), prefer launching
verifier/reviewer subagents as their own top-level Claude Code
invocations rather than nested subagents of the worker's session, so
there is no path for the worker's context to leak in implicitly.
