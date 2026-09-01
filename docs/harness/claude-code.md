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

## Installing skills into Claude Code

`policies/bindings.yaml` binds roles to skills at three layers
(`docs/integrations.md` §2): the platform's own portable contract
skills, pinned MIT snapshots of vendored packs (`skills/vendor/pstack`,
`pocock`, `superpowers`, `gstack` — each pinned to an upstream commit in
its own `VENDOR.md`), or a full native plugin install through Claude
Code's own plugin system (e.g. Superpowers as a Claude Code plugin).
`agent task claim`/`start` always print the resolved `startup_skills`
and recommended skills for a task's role regardless of which layer you
use, so nothing requires an install step. To put those skills where
Claude Code auto-discovers them instead of packaging one by hand as
described above:

```bash
agent skills install --harness claude-code [--repo <path>]
```

This copies every skill your bound roles need — startup skills plus the
`claude-code` entries under each role in `bindings.yaml` — into
`.claude/skills/` (the `install.claude-code` path in `bindings.yaml`,
`.claude/skills` by default). Vendored skills install under their
pack-prefixed frontmatter `name` (e.g. pstack's `poteto-mode` skill
installs as `pstack-poteto-mode`) so names never collide across packs,
and can be loaded as ordinary skills or wrapped as subagents per the
"Role files as skills or subagents" section above. Idempotent —
re-running skips files already placed and reports what it skipped; pass
`--force` to overwrite a copy you've locally modified.

For the `worker` role this is how `pstack-poteto-mode` actually reaches
a Claude Code session: `skills/worker-startup`'s task-start protocol
hands off to it once installed ("if `pstack-poteto-mode` is installed in
your harness, enter it now for execution style") — the platform's
preconditions and evidence duties in `worker-startup` still bind
regardless; poteto-mode governs *how* the steps are worked, not whether
they're required.

Layer 3 — a full native install of an upstream plugin (e.g. Superpowers)
through Claude Code's own plugin marketplace, rather than the
pinned/adapted snapshot `skills install` places — remains available as
an optional upgrade path; it's operator-managed and never required.
Whichever layer executes a role, the same gates apply to its output
(`docs/integrations.md` §2: "gates never move").

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
