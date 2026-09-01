# Generic Harness Contract

Role contracts in `/roles` are harness-agnostic by design (spec §7 of
`docs/DESIGN.md`): "an operator (or orchestrating agent) opens a role
file, gives it to any model in any harness along with the task YAML and
pinned inputs, and the role knows its inputs/outputs/done-means/failure
modes." No component may assume a specific harness, model vendor, or
default-binding tool named in the spec (Matt, pstack, Superpowers, Hermes,
gstack) — those are illustrative bindings, not dependencies (spec
Appendix F).

This document is the minimum any harness — including ones not yet
written docs for — must satisfy to run this platform. If you're
integrating a new harness, `docs/harness/cursor.md` and
`docs/harness/claude-code.md` are worked examples of applying this
contract; this file is the contract itself.

## The three capabilities a harness must provide

### 1. Read files

The agent running inside the harness must be able to read, at minimum:

- The role contract for the task it's been assigned (`/roles/F*.md` in
  this repo, or the target repo's copy).
- The task envelope (`agent task show <id> --json`, or the raw
  `.agent/runs/<TASK-ID>/task.yaml`).
- Every path the task's pinned `inputs[]` resolve to (specs, ADRs,
  domain context, canonical-patterns map — whatever the role contract and
  task payload reference).
- `AGENTS.md` at the target repo's root, and everything under its
  `.agent/` directory.

A harness that can only read a single "current file" or can't follow a
repo-relative path reference cannot run this platform's roles correctly.

### 2. Run the CLI

The agent must be able to invoke the `agent` CLI as an ordinary shell
command and read its stdout/exit code — `agent task claim`, `agent task
start`, `agent task submit`, `agent task gate`, `agent evidence init`,
`agent evidence check`, `agent route`, etc. (full surface:
`docs/getting-started.md`, spec DESIGN.md §6). The CLI is the state
machine and the ledger; a harness that can't shell out cannot legally
transition a task — no agent should hand-edit `task.yaml` status fields
to fake a transition.

`--json` on read commands exists specifically so a harness's own
orchestration (if any) can parse CLI output without scraping text.

### 3. Follow a role prompt

The harness must let an operator (or an orchestrating agent) set the
active role contract as governing instructions for a work session —
however that harness spells "system prompt," "custom mode," "rule,"
"skill," or "subagent." Concretely, the harness must support:

- Loading a role file's full text as the standing instructions for the
  session (not just as one more file the agent might read among many).
- The agent treating repository content it reads *while doing the task*
  as data, not instructions (spec §16.1) — the role file and task
  envelope are the only sources of instruction authority for that
  session.
- The operator swapping which role file governs a session between tasks
  — a harness that hardcodes one persona for the whole project can't
  play worker, verifier, and reviewer at different times, which breaks
  "workers do not certify themselves" (spec §2) if the same unmodified
  session is asked to do both.

## Skills

`policies/bindings.yaml` binds each role to skills at three layers
(`docs/integrations.md` §2) — contract skills, vendored MIT packs, or an
operator's own native install — but a generic harness needs no new
mechanism to make skills work: `agent task claim`/`task start`
(capability 2, run the CLI and read its stdout) print the resolved
`startup_skills` and recommended skills for the task's role directly, and
the paths they name are then read like any other file (capability 1).
That printed output, not a harness-specific skill-discovery directory,
is the universal trigger every harness sees — skills ride on the same
two capabilities above, no fourth one needed.

```bash
agent skills install --harness generic [--repo <path>]
```

is available for convenience: since a generic harness has no fixed
directory a skill loader auto-discovers, this writes
`<repo>/.agent/skills-index.md` — a name/description/path table of
every skill your bound roles use — instead of copying files anywhere,
and never edits `AGENTS.md`. It's optional; reading the index or reading
the paths `task claim` already printed are both just ordinary file
reads under capability 1, so nothing about skills changes what a
harness must provide.

## What a harness is explicitly not required to provide

- A specific model vendor or tier — routing resolves capability tiers
  through `policies/models.yaml`'s harness profile (see
  `docs/DESIGN.md` §5); a harness only needs to expose *some* models
  matching the tiers it claims to support.
- Native workflow orchestration, task scheduling, or a ledger — the
  `agent` CLI is the control plane; the harness is where a single role's
  work happens for a single task, not where missions get planned.
- Any built-in understanding of this platform's YAML/JSON shapes — the
  CLI validates and produces those; the harness only needs to read/write
  ordinary files and run ordinary shell commands.

## Minimal operator loop in any harness

```
1. agent task list --state READY --mission <id>     # what can I pick up?
2. agent task claim <id> --agent <you>               # READY -> ASSIGNED
3. open /roles/<role-for-this-task>.md as governing instructions
4. agent task start <id>                             # ASSIGNED -> RUNNING
5. do the bounded work the role contract describes
6. agent task submit <id>                            # -> GATING/VERIFYING
7. run/await verification + review per the role contract
8. agent task gate <id> --gate ... --result ... --evidence ...
```

If a harness can do all eight steps, it can run this platform.
