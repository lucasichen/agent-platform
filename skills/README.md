# Skills

<!-- owner: repo-maintainer (spec §12.4).
     staleness trigger: this file's directory listing, naming
     convention, and CLI usage must match docs/skills-design.md §1-§5
     and docs/integrations.md §2 and the actual contents of skills/ and
     policies/bindings.yaml. If a pack under skills/vendor/ is added,
     removed, or re-pinned, or the bindings schema changes, re-verify
     this file before trusting it. -->

This directory holds every **Agent Skill** (open Agent Skills format —
`SKILL.md` with `name`/`description` frontmatter) the platform ships or
vendors. It's the concrete implementation of the three-layer binding
model in `docs/integrations.md` §2: every role contract in `roles/` can
be satisfied by a contract skill, a vendored pack, or an operator's own
native harness install, and the platform gates don't care which.

## Layout

```text
skills/
  README.md                     # this file
  worker-startup/SKILL.md       # Layer 1: contract skills (ours)
  operate-platform/SKILL.md
  vendor/                       # Layer 2: pinned upstream snapshots
    pstack/
      LICENSE                   # upstream LICENSE, verbatim
      VENDOR.md                 # pin + inventory + adaptation log
      skills/<name>/SKILL.md    # adopted subset only, adapted
    pocock/    (same shape)
    superpowers/ (same shape)
    gstack/    (same shape)
```

## The three-layer binding model

```text
Layer 1  CONTRACT SKILLS (ours, always present)
         skills/<name>/ — portable to ANY harness; the default binding.
         Know our task envelope, CLI, evidence bundles, policies.
         e.g. worker-startup, operate-platform.

Layer 2  VENDORED SKILLS (pinned, adapted upstream)
         skills/vendor/<pack>/ — MIT snapshots pinned to an upstream
         commit (VENDOR.md records the pin + every adaptation), with
         harness-specific frontmatter stripped or restated as prose.
         Preferred binding where the harness supports Agent Skills
         natively (Claude Code, Cursor).

Layer 3  NATIVE INSTALLS (operator-managed, optional)
         Full upstream plugins installed through the harness's own
         plugin system (e.g. pstack in Cursor, Superpowers as a Claude
         Code plugin). Documented, never required.
```

**The rule that keeps this honest: gates never move.** Whichever layer
executes a role, its output lands in the run directory
(`.agent/runs/<TASK-ID>/`) in the evidence contract's shape and passes
the same verification/review gates as every other binding. A binding
that can't clear the gates at its assigned risk tier prices itself out
(spec Appendix F.11) — it does not get the gates relaxed for it.

`policies/bindings.yaml` is the single source of truth for which binding
is active per role per harness (schema:
`schemas/bindings-policy.schema.json`). It is installed into target
repos by `agent init` like the other policies, and validated by `agent
validate` (which also checks that every path it names — including every
`startup_skills` entry — actually resolves to a `SKILL.md`, in-repo or
packaged).

```yaml
version: 1
roles:
  worker:
    startup_skills:                    # printed by `agent task claim`/`start`
      - skills/worker-startup
    skills:                            # recommended per harness (informational
      generic: []                      # for the agent; gates do the enforcing)
      claude-code:
        - skills/vendor/superpowers/skills/test-driven-development
        - skills/vendor/pstack/skills/poteto-mode
      cursor:
        - skills/vendor/pstack/skills/poteto-mode
active_harness: generic
install:
  claude-code: ".claude/skills"
  cursor: ".cursor/skills"
```

`startup_skills` are the skills a role must load before doing any work —
`worker-startup` operationalizes `roles/F6-worker.md`'s task-start
protocol this way. `skills` are per-harness *recommendations*: not
loading one doesn't fail a gate, but the resulting candidate still has to
clear the same verification/review bar as one that did.

## Install flow

```bash
agent skills install [--harness claude-code|cursor|generic] [--repo <path>]
```

Reads `bindings.yaml` (the target repo's `.agent/policies/`, falling back
to the packaged default) and copies every skill referenced by any role
binding for the given harness — plus every `startup_skills` entry,
regardless of harness — from the packaged skills tree into that
harness's discovery path (`install:` map above; `.claude/skills/` and
Cursor's skills directory by default). For `--harness generic`, it
instead writes `<repo>/.agent/skills-index.md` (name, description, path
table) — generic harnesses have no plugin discovery mechanism to copy
into, so the index is the binding surface; this never edits `AGENTS.md`.
The install is idempotent: re-running it skips files it already placed,
and reports what it skipped; pass `--force` to overwrite a file that's
been locally modified since.

You don't have to run this for the platform to work — `agent task
claim`/`start` always print the resolved `startup_skills` and
recommended skills for a task's role (see `skills/operate-platform`),
and any agent can open a `SKILL.md` directly by path. `skills install` is
purely a convenience for harnesses that auto-discover skills from a
fixed directory instead of being told the path.

## Naming conventions

- **Our skills (Layer 1)**: `name` in frontmatter is the plain
  kebab-case directory name — `worker-startup`, `operate-platform`.
- **Vendored skills (Layer 2)**: `name` becomes `<pack>-<upstream-name>`
  (e.g. `pstack-poteto-mode`, `pocock-to-spec`) so installed skill names
  never collide across packs or with our own. The directory keeps the
  upstream skill's own name (`skills/vendor/pstack/skills/poteto-mode/`)
  — only the frontmatter `name` gets the pack prefix.
- Harness-specific frontmatter keys that aren't part of the open Agent
  Skills standard (`disable-model-invocation`, `mode`, `is_background`,
  `allowed-tools`, `hooks`, ...) are stripped from vendored copies; where
  the key carried real behavior, that behavior is restated as prose in
  the skill body instead.

## How to add a skill

**A new contract skill (Layer 1)** — something the platform itself
needs, not sourced from an upstream pack:

1. Create `skills/<name>/SKILL.md` with `name: <name>` (kebab-case) and a
   `description` written for auto-triggering: state exactly when a
   harness should load it, not just what it's about.
2. Write the skill so it stands alone — an agent with only that file plus
   its task/context can work correctly, citing the spec/`docs/` sections
   it operationalizes rather than restating them wholesale.
3. Add an `owner:`/staleness-trigger HTML comment under the frontmatter
   (spec §12.4) naming what would make the file stale.
4. If any role should load it automatically, add it to that role's
   `startup_skills` or `skills.<harness>` list in `policies/bindings.yaml`
   and run `agent validate` to confirm the path resolves.

**A vendored skill (Layer 2)**, or adding to an existing pack:

1. Fetch the real upstream file at the pack's pinned commit (see that
   pack's `VENDOR.md` for the SHA; `raw.githubusercontent.com` at that
   SHA, not a paraphrase).
2. Place it at `skills/vendor/<pack>/skills/<upstream-name>/SKILL.md`,
   strip non-standard frontmatter keys per the naming-conventions section
   above, prefix `name:` with `<pack>-`, and add the vendoring comment
   directly under the frontmatter: `<!-- Vendored from <upstream path> @
   <commit>; adaptations logged in ../../VENDOR.md. MIT (c) <author>.
   -->`.
3. Log every edit as a row in that pack's `VENDOR.md` adaptation-log
   table, and the file in its inventory table. Never paraphrase upstream
   text where a verbatim copy plus a logged edit will do.
4. Wire it into `policies/bindings.yaml` under the relevant role/harness
   if it should be a recommended or startup skill.

Full format rules for both cases: `docs/skills-design.md` §2-§3, §7.

## Where the source of truth lives

- `policies/bindings.yaml` — role → binding per harness (this file
  documents its shape above; the file itself is authoritative).
- `docs/integrations.md` §2-§5 — the binding architecture and per-pack
  adoption rationale this directory implements.
- `docs/skills-design.md` — the binding interface contract for this
  build: directory layout, `SKILL.md`/`VENDOR.md` conventions, the CLI
  additions listed above, and per-pack vendoring scope.
