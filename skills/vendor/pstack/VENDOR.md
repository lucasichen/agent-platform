# Vendored: pstack

- upstream: https://github.com/cursor/plugins (subtree `pstack/`)
- pinned commit: 6fecddba65801f9b9c08b8b328d998ee5b09d290
- fetched: 2026-08-31
- license: MIT, (c) 2026 Lauren Tan — see `./LICENSE` (verbatim upstream copy of `pstack/LICENSE` at the pinned commit)
- adopted subset: 30 of 45 upstream skills under `pstack/skills/` (see inventory)

Pin resolution: `GET /repos/cursor/plugins/commits?path=pstack&per_page=1` →
SHA `6fecddba65801f9b9c08b8b328d998ee5b09d290` (2026-08-27T17:33:06Z, "fix(pstack):
register make-bot-ui at skills root (#275)"). Listing:
`GET /repos/cursor/plugins/contents/pstack/skills?ref=<sha>` → 45 entries. Files
fetched via `raw.githubusercontent.com/cursor/plugins/<sha>/pstack/skills/<name>/SKILL.md`
and `.../pstack/LICENSE`.

## Requested-vs-found note

Every skill named in the task brief exists under the exact requested name at
the pinned commit — no substitutions were necessary: `poteto-mode`,
`architect`, `arena`, `interrogate`, `unslop`, `blast-radius`,
`show-me-your-work`, `reflect`, `automate-me`, and all 21 `principle-*`
skills present at that commit (listed in the inventory below).

`pstack/docs/` at the pinned commit contains only a `guide/` subdirectory of
10 numbered chapter files (`01-setup.md` … `10-recipes-and-pitfalls.md`) plus
its own `README.md` and an `images/` directory — there is no standalone
eval-playbook doc directly under `pstack/docs/` (the closest concept, the
blind A/B eval playbook, lives inside `pstack/skills/poteto-mode/playbooks/eval.md`,
which is not vendored here — only skills' top-level `SKILL.md` files are
vendored per the directory layout in `docs/skills-design.md` §1). Per the
task brief's "if it doesn't exist as a standalone file" clause, nothing was
copied to `vendor/pstack/docs/`.

The upstream `pstack/skills/` tree also carries nested `references/`,
`playbooks/`, and `scripts/` subdirectories inside several skill folders
(`poteto-mode`, `architect`, `interrogate`, `reflect`, `show-me-your-work`).
Only each skill's top-level `SKILL.md` is vendored, per the `skills/vendor/<pack>/skills/<name>/SKILL.md`
layout in `docs/skills-design.md` §1; the SKILL.md bodies still reference
those upstream-only paths (e.g. `playbooks/prototype.md`, `references/rubric.md`)
as prose pointers to material this vendored subset does not include locally.

## Not adopted (upstream skills present at the pinned commit, out of scope)

`bro`, `create-verification-skill`, `figure-it-out`, `how`,
`maintain-verification-skill`, `make-bot-ui`, `no-comments`, `recall`,
`setup-pstack`, `swarm`, `tdd`, `teach`, `technical-writing`,
`typescript-best-practices`, `why` — named in the adopted skills' own body
text as companions, not vendored here because they were not in the task's
requested subset.

## Inventory

| local path | upstream path |
|---|---|
| skills/poteto-mode/SKILL.md | pstack/skills/poteto-mode/SKILL.md |
| skills/architect/SKILL.md | pstack/skills/architect/SKILL.md |
| skills/arena/SKILL.md | pstack/skills/arena/SKILL.md |
| skills/interrogate/SKILL.md | pstack/skills/interrogate/SKILL.md |
| skills/unslop/SKILL.md | pstack/skills/unslop/SKILL.md |
| skills/blast-radius/SKILL.md | pstack/skills/blast-radius/SKILL.md |
| skills/show-me-your-work/SKILL.md | pstack/skills/show-me-your-work/SKILL.md |
| skills/reflect/SKILL.md | pstack/skills/reflect/SKILL.md |
| skills/automate-me/SKILL.md | pstack/skills/automate-me/SKILL.md |
| skills/principle-boundary-discipline/SKILL.md | pstack/skills/principle-boundary-discipline/SKILL.md |
| skills/principle-build-the-lever/SKILL.md | pstack/skills/principle-build-the-lever/SKILL.md |
| skills/principle-encode-lessons-in-structure/SKILL.md | pstack/skills/principle-encode-lessons-in-structure/SKILL.md |
| skills/principle-exhaust-the-design-space/SKILL.md | pstack/skills/principle-exhaust-the-design-space/SKILL.md |
| skills/principle-experience-first/SKILL.md | pstack/skills/principle-experience-first/SKILL.md |
| skills/principle-fix-root-causes/SKILL.md | pstack/skills/principle-fix-root-causes/SKILL.md |
| skills/principle-foundational-thinking/SKILL.md | pstack/skills/principle-foundational-thinking/SKILL.md |
| skills/principle-guard-the-context-window/SKILL.md | pstack/skills/principle-guard-the-context-window/SKILL.md |
| skills/principle-laziness-protocol/SKILL.md | pstack/skills/principle-laziness-protocol/SKILL.md |
| skills/principle-make-operations-idempotent/SKILL.md | pstack/skills/principle-make-operations-idempotent/SKILL.md |
| skills/principle-migrate-callers-then-delete-legacy-apis/SKILL.md | pstack/skills/principle-migrate-callers-then-delete-legacy-apis/SKILL.md |
| skills/principle-minimize-reader-load/SKILL.md | pstack/skills/principle-minimize-reader-load/SKILL.md |
| skills/principle-model-the-domain/SKILL.md | pstack/skills/principle-model-the-domain/SKILL.md |
| skills/principle-never-block-on-the-human/SKILL.md | pstack/skills/principle-never-block-on-the-human/SKILL.md |
| skills/principle-outcome-oriented-execution/SKILL.md | pstack/skills/principle-outcome-oriented-execution/SKILL.md |
| skills/principle-prove-it-works/SKILL.md | pstack/skills/principle-prove-it-works/SKILL.md |
| skills/principle-redesign-from-first-principles/SKILL.md | pstack/skills/principle-redesign-from-first-principles/SKILL.md |
| skills/principle-separate-before-serializing-shared-state/SKILL.md | pstack/skills/principle-separate-before-serializing-shared-state/SKILL.md |
| skills/principle-sequence-verifiable-units/SKILL.md | pstack/skills/principle-sequence-verifiable-units/SKILL.md |
| skills/principle-subtract-before-you-add/SKILL.md | pstack/skills/principle-subtract-before-you-add/SKILL.md |
| skills/principle-type-system-discipline/SKILL.md | pstack/skills/principle-type-system-discipline/SKILL.md |
| LICENSE | pstack/LICENSE |

## Adaptation log

| file | change | reason |
|---|---|---|
| all 30 `SKILL.md` | frontmatter `name` renamed to `pstack-<dirname>` | skills-design.md §2: avoid name collisions across vendored packs once installed |
| all 30 `SKILL.md` | removed frontmatter key `disable-model-invocation` (present on 28 of 30; absent on `unslop` and one other) | non-standard harness key not in the open Agent Skills format (§2) |
| `poteto-mode/SKILL.md` | removed frontmatter keys `mode`, `icon`, `color`, `reminder` | non-standard Cursor "mode" UI keys (§2); `reminder`'s trigger heuristic restated as prose in the body opening paragraph, `icon`/`color` were purely cosmetic and dropped |
| all 30 `SKILL.md` | inserted `<!-- Vendored from ... -->` comment directly under frontmatter | required by skills-design.md §2 |
| `poteto-mode/SKILL.md` | "About to `AskQuestion` on..." → "About to ask the user... (use your harness's structured-question tool if it has one, otherwise ask directly in your reply)" | rewrite Cursor-specific tool reference to harness-neutral prose (§6) |
| `poteto-mode/SKILL.md` | "Agent-facing prose also follows the **create-skill** skill (Cursor's built-in for authoring SKILL.md files)" → "...(this pack's SKILL.md-authoring conventions, or your harness's own skill-authoring tooling where it has one)" | harness-neutral prose (§6) |
| `poteto-mode/SKILL.md` | "the `deslop` skill from the `cursor-team-kit` plugin (`/deslop`)" → "the equivalent of the `deslop` skill if your companion tooling provides one (originally shipped as part of a Cursor-only companion plugin, not vendored here)" | Cursor automations/companion-plugin reference rewritten to harness-neutral prose (§6) |
| `poteto-mode/SKILL.md` | "`cursor-team-kit` publishes `control-cli`... `control-ui`..." → "...if your companion tooling provides one (originally shipped as `control-cli`/`control-ui` in a Cursor-only companion plugin, not vendored here)" | same as above |
| `poteto-mode/SKILL.md` | "not Cursor's built-in babysit skill" → "not a built-in PR-babysitting feature your harness might separately provide under an overlapping name" | harness-neutral prose (§6) |
| `poteto-mode/SKILL.md` | three occurrences of "/loop until X" → "run continuously until X" | rewrite Cursor slash-command reference to harness-neutral prose (§6, explicitly named example) |
| `poteto-mode/SKILL.md` | "a Cursor restart" → "a session or tool restart" | harness-neutral prose (§6) |
| `poteto-mode/SKILL.md` | rewrote the entire "Subagents" section (`subagent_type: "poteto-agent"`, `Task` call defaults, hardcoded model slugs, `/setup-pstack` rule) into harness-conditional prose: "where your harness supports spawning subagents... otherwise execute the playbook's steps sequentially yourself" | required by skills-design.md §6: "poteto-mode's subagent delegation becomes harness-conditional" |
| `poteto-mode/SKILL.md` | appended a "Platform integration" section (payload.design constraints, decisions.tsv logging, §5.2 escalation) | required by skills-design.md §6 |
| `arena/SKILL.md` | two occurrences of `~/.cursor/rules/pstack-models.mdc` → "your harness's model-routing config when it exposes one (upstream keeps this in a Cursor rules file...)" | rewrite Cursor-specific config path to harness-neutral prose (§6, `.cursor/rules` explicitly named) |
| `interrogate/SKILL.md` | `~/.cursor/rules/pstack-models.mdc` reference and "Task tool" → harness-neutral "your harness's subagent-spawning tool" / "your harness's model-routing config" | same as above |
| `reflect/SKILL.md` | `agent-transcripts/`/`~/.cursor/projects/*/` path guidance → harness-neutral ("your harness names it; upstream calls it...") | rewrite Cursor-specific path to harness-neutral prose (§6) |
| `reflect/SKILL.md` | "hand to Cursor's built-in `create-skill` skill..." (3 occurrences) → "hand to your harness's skill-authoring tooling if it has one (Cursor's built-in `create-skill`, for example)..." | harness-neutral prose (§6) |
| `show-me-your-work/SKILL.md` | `agent-transcripts/`/`~/.cursor/projects/*/` path guidance → harness-neutral | same as reflect |
| `automate-me/SKILL.md` | Cursor's built-in `create-skill` references (5 occurrences across the flow, evaluation, and reference-files sections) → "your harness's built-in skill-authoring tooling... (Cursor's `create-skill`, for example); otherwise author/edit the SKILL.md by hand" | harness-neutral prose (§6) |
| `automate-me/SKILL.md` | `.cursor/skills/**/*-mode/SKILL.md`, `~/.cursor/skills/*-mode/SKILL.md`, `.cursor/skills/<handle>/...` paths → "your harness's skill discovery directories" with Cursor and Claude Code named as examples | rewrite `.cursor/` paths to harness-neutral prose (§6, `.cursor/rules` explicitly named as the class of thing to rewrite) |
| `automate-me/SKILL.md` | `AskQuestion` tool (2 occurrences) → "your harness's structured multi-choice question tool if it has one" | harness-neutral prose (§6) |
| `automate-me/SKILL.md` | `agent-transcripts/`/`~/.cursor/projects/*/` path guidance → harness-neutral | same as reflect |
| `automate-me/SKILL.md` | frontmatter `disable-model-invocation: true` guidance in step 4 → "If your harness supports an explicit-invocation-only frontmatter key, set it by default... Harnesses without such a key rely on the description text itself" | harness-neutral prose (§6) |
| all 7 gstack-parallel pstack skills above | (see individual rows) | — |
| `unslop/SKILL.md`, `blast-radius/SKILL.md`, all 21 `principle-*` | no body-text edits beyond frontmatter/name/comment | grepped for `cursor`/`AskQuestion`/`/loop`/`/babysit`/`automations`; none found — upstream text is harness-neutral already, kept verbatim per the "verbatim copy beats paraphrase" rule |
