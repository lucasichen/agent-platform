# Vendored: gstack

- upstream: https://github.com/garrytan/gstack
- pinned commit: e76f65a8da31ec14776a965c608222c1aecad656
- fetched: 2026-08-31
- license: MIT, (c) 2026 Garry Tan — see `./LICENSE` (verbatim upstream copy of the repo-root `LICENSE` at the pinned commit)
- adopted subset: 7 of 7 requested skills, all found under the exact requested directory name at the repo root (see inventory and note below)

Pin resolution: `GET /repos/garrytan/gstack/commits?per_page=1` → SHA
`e76f65a8da31ec14776a965c608222c1aecad656` (2026-08-31T15:55:30Z, "v1.77.0.0
feat: test-infrastructure overhaul wave 1 — matrix deletion, flake telemetry,
sync-spawn wedge class extinct (#2746)"). Root listing:
`GET /repos/garrytan/gstack/contents/?ref=<sha>`. Files fetched via
`raw.githubusercontent.com/garrytan/gstack/<sha>/<name>/SKILL.md` and
`.../LICENSE`.

## Repo shape note

Unlike pstack, gstack keeps each skill as its own top-level directory in the
repo root (`qa/SKILL.md`, `ship/SKILL.md`, ...), not nested under a `skills/`
subdirectory — confirmed by the root listing before fetching anything.
Every skill requested in the task brief exists under exactly the expected
name: `qa`, `qa-only`, `canary`, `ship`, `land-and-deploy`, `investigate`,
`ios-qa` — no substitutions were necessary.

The repo root contains roughly 90 entries total (71 directories, the rest
top-level files), mixing skill-shaped command directories with
infrastructure that is not a skill: `lib/`, `bin/`, `test/`, `docs/`,
`scripts/`, `hosts/` (the multi-harness adapter layer noted in
`docs/integrations.md` §3 as a design reference, not vendored as code),
`patches/`, `contrib/`, `supabase/`, `extension/`, `claude/`, `codex/`,
`browser-skills/`, `benchmark/`, `benchmark-models/`, `model-overlays/`,
`agents/`, `agents-digest/`, and more. We did not exhaustively verify which
of the ~60 remaining directories are individually skill-shaped (each with
its own `SKILL.md`) — that would have required a `contents` API call per
directory, which the rate-limited GitHub API did not accommodate. The "7 of
7" adopted-subset figure above is against the task's requested targets, all
confirmed present with their own `SKILL.md`; it is not a claim about the
total skill count in the upstream repo.

Each fetched skill directory also carries upstream-only supporting files
(`SKILL.md.tmpl`, and per-skill `references/`, `sections/`, `templates/`,
`daemon/`, `docs/`, `scripts/` subdirectories for `qa` and `ios-qa`
specifically). Only each skill's top-level `SKILL.md` is vendored, per the
`skills/vendor/<pack>/skills/<name>/SKILL.md` layout in
`docs/skills-design.md` §1; several `SKILL.md` bodies reference paths under
those upstream-only directories (e.g. `references/rubric.md`,
`daemon/StateServer`) that this vendored subset does not include locally.

Every fetched `SKILL.md` opens with the same auto-generation header
(`<!-- AUTO-GENERATED from SKILL.md.tmpl — do not edit directly -->`,
`<!-- Regenerate: bun run gen:skill-docs -->`) — kept verbatim; it documents
upstream's own build process and is informational, not a harness-specific
key.

## Inventory

| local path | upstream path |
|---|---|
| skills/qa/SKILL.md | qa/SKILL.md |
| skills/qa-only/SKILL.md | qa-only/SKILL.md |
| skills/canary/SKILL.md | canary/SKILL.md |
| skills/ship/SKILL.md | ship/SKILL.md |
| skills/land-and-deploy/SKILL.md | land-and-deploy/SKILL.md |
| skills/investigate/SKILL.md | investigate/SKILL.md |
| skills/ios-qa/SKILL.md | ios-qa/SKILL.md |
| LICENSE | LICENSE |

## Adaptation log

| file | change | reason |
|---|---|---|
| all 7 `SKILL.md` | frontmatter `name` renamed to `gstack-<dirname>` | skills-design.md §2: avoid name collisions across vendored packs once installed |
| all 7 `SKILL.md` | removed frontmatter key `allowed-tools` (list of tool names varying per skill); restated as prose immediately after the vendored-from comment ("Tool scope (upstream frontmatter, restated)...") naming the tool list and noting the equivalent for harnesses that support per-skill tool scoping | non-standard harness key not in the open Agent Skills format (§2); real behavior (tool scoping) restated as prose per §2 |
| `investigate/SKILL.md` | removed frontmatter key `hooks` (a `PreToolUse` hook on `Edit`/`Write` calling `check-freeze.sh` to enforce the debug-scope boundary); restated as prose ("Hook-based enforcement (upstream frontmatter, restated)...") describing the same check and directing harnesses without hook support to apply it manually before each edit | non-standard harness key not in the open Agent Skills format (§2); real behavior (scope-lock enforcement) restated as prose per §2 |
| all 7 `SKILL.md` | inserted `<!-- Vendored from ... -->` comment directly under frontmatter | required by skills-design.md §2 |
| all 7 `SKILL.md` | kept `preamble-tier`, `version`, `triggers`, and (on `investigate`) `gbrain` frontmatter keys as-is | not on the explicit non-standard-key removal list in §2 (`disable-model-invocation`, `mode`, `is_background`, `allowed-tools`, `hooks`); these are portable metadata (a version string, trigger phrases, a tiering hint), not harness-coupled mechanism, so kept verbatim per "verbatim copy beats paraphrase" |
| all 7 `SKILL.md` | no body-text rewriting of the `.claude/skills/gstack/bin/gstack-skill-start` preamble scripts, `AskUserQuestion` tool references, or other Claude-Code-native mechanics | gstack ships as Claude-Code-native Agent Skills (docs/integrations.md §1), not a Cursor plugin — skills-design.md §6's gstack adaptation instructions call only for stripping `allowed-tools`/`hooks` and appending Platform integration sections, not for a harness-neutralization pass; every fetched skill's body already documents its own "degraded mode" fallback when its companion `bin/` scripts are absent, which is the situation this vendored subset (SKILL.md only, no `bin/`) is actually in |
| `qa/SKILL.md` | appended a "Platform integration" section routing QA findings/evidence to `.agent/runs/<TASK-ID>/verification/` per the F.7 result shape, and noting this skill's pass does not substitute for F.7's independent verification | required by skills-design.md §6: "qa/ios-qa evidence lands in .agent/runs/<TASK-ID>/verification/ per the F.7 result shape" |
| `ios-qa/SKILL.md` | appended a "Platform integration" section (spec §9.3 iOS binding), same evidence-routing and non-substitution note as `qa` | same as above |
| `ship/SKILL.md` | appended a "Platform integration" section: maps to F.9, must clear the platform's merge queue/gates (independent F.7 verification, F.8 review), never a direct push around them | required by skills-design.md §6: "ship/land-and-deploy/canary map to the F.9/release stages and never bypass the merge gates" |
| `land-and-deploy/SKILL.md` | appended a "Platform integration" section, same F.9/merge-gate framing as `ship` | same as above |
| `canary/SKILL.md` | appended a "Platform integration" section: post-deploy monitoring half of F.9 after gates have cleared, evidence lands alongside the F.7 bundle, an alert re-opens the task rather than authorizing a direct hotfix push | same as above |
| `qa-only/SKILL.md`, `investigate/SKILL.md` | no "Platform integration" section appended | skills-design.md §6 names only `qa`/`ios-qa` and `ship`/`land-and-deploy`/`canary` for appended sections; `qa-only` and `investigate` were left as adapted (frontmatter stripped, name renamed) without inventing an unrequested section |
