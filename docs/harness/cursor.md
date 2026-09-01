# Running agent-platform from Cursor

Cursor satisfies the generic contract (`docs/harness/generic.md`): it can
read repo files, run the `agent` CLI in its integrated terminal, and load
custom instructions for a session. This page is the concrete how-to.

## Models available in Cursor

Cursor does not offer Fable. `policies/models.yaml`'s `cursor` profile
must map the platform's capability tiers only to models Cursor actually
exposes — Claude Sonnet/Opus/Haiku, the GPT-5 family, Gemini, etc. (spec
DESIGN.md §5). Example shape (the real file is installed/edited per
`.agent/policies/models.yaml` in your target repo — see
`docs/getting-started.md`):

```yaml
profiles:
  cursor:
    as_of: "2026-08-31"   # staleness note per spec §12.4 — recheck if > 90 days old
    tiers:
      frontier: claude-opus-4-6      # example — check Cursor's current model list
      strong: claude-sonnet-4-6
      mid: gpt-5-mini
      cheap: gpt-5-nano
```

Treat any mapping here as a hint once its `as_of` date is stale — Cursor's
model list changes; re-check before routing a real task on it (spec
§12.4 trust decay rule).

## Role files as custom modes / rules

Cursor supports project rules and custom chat modes. Bind a role contract
to a mode so switching roles is a dropdown, not a copy-paste:

1. In Cursor, create a custom mode per role you use often (worker,
   verifier, reviewer are the ones a solo dev cycles through most).
2. Set that mode's instructions to the **full text** of the role file,
   e.g. `roles/F6-worker.md` — not a summary. The role contract's stated
   inputs/outputs/done-means/failure-modes are the actual contract; don't
   paraphrase it into the mode description.
3. Keep the mode's context small otherwise — Cursor will additionally
   pull in whatever files you `@`-reference or have open. The role file
   plus the task's pinned inputs (per `agent task show <id>`) is normally
   enough; avoid dumping the whole repo into context.
4. Re-sync the mode's instructions whenever the role file changes — a
   mode with stale instructions is a stale artifact like any other (spec
   §12.4); there's no mechanical CI check for this one, so re-copy it
   deliberately after editing `/roles`.

## Installing skills into Cursor

`policies/bindings.yaml` binds roles to skills at three layers
(`docs/integrations.md` §2): the platform's own portable contract
skills, pinned MIT snapshots of vendored packs (`skills/vendor/pstack`,
`pocock`, `superpowers`, `gstack` — each pinned to an upstream commit in
its own `VENDOR.md`), or a full native plugin install through Cursor's
own plugin system. `agent task claim`/`start` always print the resolved
`startup_skills` and recommended skills for a task's role regardless of
which layer you use, so nothing requires an install step. To put those
skills where Cursor auto-discovers them instead of opening a `SKILL.md`
by hand:

```bash
agent skills install --harness cursor [--repo <path>]
```

This copies every skill your bound roles need — startup skills plus the
`cursor` entries under each role in `bindings.yaml` — into
`.cursor/skills/` (the `install.cursor` path in `bindings.yaml`,
`.cursor/skills` by default). Vendored skills install under their
pack-prefixed frontmatter `name` (e.g. pstack's `poteto-mode` skill
installs as `pstack-poteto-mode`) so names never collide across packs.
Idempotent — re-running skips files already placed and reports what it
skipped; pass `--force` to overwrite a copy you've locally modified.

For the `worker` role this is how `pstack-poteto-mode` actually reaches
a Cursor session: `skills/worker-startup`'s task-start protocol hands
off to it once installed ("if `pstack-poteto-mode` is installed in your
harness, enter it now for execution style") — the platform's
preconditions and evidence duties in `worker-startup` still bind
regardless; poteto-mode governs *how* the steps are worked, not whether
they're required.

Layer 3 — a full native install of the upstream pstack Cursor plugin
through Cursor's own plugin system, rather than the pinned/adapted
snapshot `skills install` places — remains available as an optional
upgrade path; it's operator-managed and never required. Whichever layer
executes a role, the same gates apply to its output (`docs/integrations.md`
§2: "gates never move").

## AGENTS.md support

Cursor reads `AGENTS.md` at the repo root automatically as background
project instructions. This platform's `AGENTS.md` is written for exactly
that — it's the harness entrypoint every agent (Cursor included) should
absorb before touching a task. You do not need to duplicate its content
into a Cursor rule; it's picked up on its own. Custom-mode instructions
for a specific role are additive on top of it, not a replacement for it.

## Running the `agent` CLI from Cursor's terminal

Cursor's integrated terminal is an ordinary shell — no special
integration needed. From the target repo root (after `agent init`, see
`docs/getting-started.md`):

```
agent task list --state READY --mission <MISSION-ID>
agent task claim <TASK-ID> --agent cursor-<you>
agent task start <TASK-ID>
# ... do the work in the editor, in the role's custom mode ...
agent task submit <TASK-ID>
agent task gate <TASK-ID> --gate verification --result pass --evidence .agent/runs/<TASK-ID>/verification/result.json
```

Cursor's agent can run these commands itself if you're driving task
transitions from chat rather than typing them by hand — same CLI, same
rules, same evidence requirements either way. The CLI enforces state-
machine legality regardless of who typed the command.

## Suggested composer workflow per role

- **Worker**: switch to the worker mode, `@`-reference the task's pinned
  inputs (spec file, ADRs, `architecture/canonical-patterns.md`) and the
  target files/areas, do the bounded implementation, run `agent task
  submit` from the terminal when done. Do not let the composer invent
  architecture — if it hits an escalation trigger (`AGENTS.md` "Core
  rules"), stop and hand off rather than pushing through.
- **Verifier**: separate chat, separate mode, fresh context — do not
  reuse the worker's composer thread. The verifier should not see the
  worker's rationalizations (spec §10.3 judge decorrelation); a fresh
  Cursor chat with only the verifier role, the diff, and the repo's
  `.agent/verification/` instructions loaded is the point.
- **Reviewer**: same isolation principle — new chat, reviewer mode, inputs
  limited to diff + spec + architecture refs + canonical map, per
  `docs/evidence-contract.md` reviews section. If your Cursor plan lets
  you pick a different model family for this mode than the one that
  implemented the change, do so — decorrelation is the point.
