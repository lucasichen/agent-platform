# Vendored: superpowers
- upstream: https://github.com/obra/superpowers
- pinned commit: b36e0829c6d0140e93cfef2ca599b1b07d4a7797
- fetched: 2026-08-31
- license: MIT, (c) 2025 Jesse Vincent — see ./LICENSE (verbatim upstream)
- adopted subset: 5 of 14 upstream skills (see inventory)

## Discovery notes

Upstream layout matches the expected shape exactly: `skills/<name>/SKILL.md`
at the repo root's `skills/`. All 5 requested skills
(`test-driven-development`, `systematic-debugging`,
`verification-before-completion`, `dispatching-parallel-agents`,
`writing-skills`) exist verbatim under those exact names — no name
mismatches, no substitutions needed. `brainstorming` and `writing-plans`
also exist upstream but are deliberately **not** adopted (whiteboard
decision recorded in docs/integrations.md §3: planning stays with the
pocock chain). The other 7 upstream skills not requested
(`executing-plans`, `finishing-a-development-branch`,
`receiving-code-review`, `requesting-code-review`,
`subagent-driven-development`, `using-git-worktrees`,
`using-superpowers`) were left un-vendored as out of the adopted subset.

Markdown reference files a `SKILL.md` directly links to as load-bearing
content were vendored alongside it: `test-driven-development/
writing-good-tests.md`; `systematic-debugging/{root-cause-tracing.md,
defense-in-depth.md,condition-based-waiting.md}`; `writing-skills/
{anthropic-best-practices.md,testing-skills-with-subagents.md,
persuasion-principles.md}`. Left un-vendored as tooling/test-fixture
assets rather than methodology text (each still referenced intact in the
adopted `SKILL.md` prose, so nothing upstream points at is silently
missing without a trace): `systematic-debugging/{CREATION-LOG.md,
condition-based-waiting-example.ts,find-polluter.sh,test-academic.md,
test-pressure-1.md,test-pressure-2.md,test-pressure-3.md}`;
`writing-skills/{graphviz-conventions.dot,render-graphs.js,
examples/CLAUDE_MD_TESTING.md}`. `dispatching-parallel-agents` and
`verification-before-completion` have no supporting files upstream
(`SKILL.md` only).

## Inventory

| local path | upstream path |
|---|---|
| skills/vendor/superpowers/LICENSE | LICENSE |
| skills/vendor/superpowers/skills/test-driven-development/SKILL.md | skills/test-driven-development/SKILL.md |
| skills/vendor/superpowers/skills/test-driven-development/writing-good-tests.md | skills/test-driven-development/writing-good-tests.md |
| skills/vendor/superpowers/skills/systematic-debugging/SKILL.md | skills/systematic-debugging/SKILL.md |
| skills/vendor/superpowers/skills/systematic-debugging/root-cause-tracing.md | skills/systematic-debugging/root-cause-tracing.md |
| skills/vendor/superpowers/skills/systematic-debugging/defense-in-depth.md | skills/systematic-debugging/defense-in-depth.md |
| skills/vendor/superpowers/skills/systematic-debugging/condition-based-waiting.md | skills/systematic-debugging/condition-based-waiting.md |
| skills/vendor/superpowers/skills/verification-before-completion/SKILL.md | skills/verification-before-completion/SKILL.md |
| skills/vendor/superpowers/skills/dispatching-parallel-agents/SKILL.md | skills/dispatching-parallel-agents/SKILL.md |
| skills/vendor/superpowers/skills/writing-skills/SKILL.md | skills/writing-skills/SKILL.md |
| skills/vendor/superpowers/skills/writing-skills/anthropic-best-practices.md | skills/writing-skills/anthropic-best-practices.md |
| skills/vendor/superpowers/skills/writing-skills/testing-skills-with-subagents.md | skills/writing-skills/testing-skills-with-subagents.md |
| skills/vendor/superpowers/skills/writing-skills/persuasion-principles.md | skills/writing-skills/persuasion-principles.md |

Not vendored (present upstream, out of adopted scope, listed for
completeness of the discovery record): `skills/{brainstorming,
executing-plans,finishing-a-development-branch,receiving-code-review,
requesting-code-review,subagent-driven-development,
using-git-worktrees,using-superpowers,writing-plans}/`.

## Adaptation log

| file | change | reason |
|---|---|---|
| skills/test-driven-development/SKILL.md | `name: test-driven-development` → `name: superpowers-test-driven-development`; added vendored-from comment | skills-design.md §2 naming/provenance convention (frontmatter already had no non-standard keys to strip) |
| skills/test-driven-development/SKILL.md | appended "Platform integration" section (relationship to worker-startup/pstack-poteto-mode task-start structure; points to superpowers-verification-before-completion for evidence freshness) | integrations.md §3 "F6's execution discipline" composition note |
| skills/systematic-debugging/SKILL.md | `name: systematic-debugging` → `name: superpowers-systematic-debugging`; added vendored-from comment | §2 |
| skills/systematic-debugging/SKILL.md | updated in-body cross-references `superpowers:test-driven-development` → `superpowers-test-driven-development`, `superpowers:verification-before-completion` → `superpowers-verification-before-completion` | keep intra-pack cross-references resolvable under this pack's renamed skill ids |
| skills/systematic-debugging/SKILL.md | appended "Platform integration" section (pairs with §8.1 three-failure rule and pocock-diagnosing-bugs; Phase 4 evidence → `.agent/runs/<TASK-ID>/`; architecture escalation → F.8) | integrations.md §3 "pairs with our §8.1 three-failure rule" |
| skills/verification-before-completion/SKILL.md | `name: verification-before-completion` → `name: superpowers-verification-before-completion`; added vendored-from comment | §2 |
| skills/verification-before-completion/SKILL.md | appended "Platform integration" section: fresh evidence = files under `.agent/runs/<TASK-ID>/` per the platform evidence contract, not agent confidence; reviewers/verifiers may auto-FAIL a claim with no matching evidence file | docs/skills-design.md §6 exact required wording; integrations.md §3 |
| skills/dispatching-parallel-agents/SKILL.md | `name: dispatching-parallel-agents` → `name: superpowers-dispatching-parallel-agents`; added vendored-from comment | §2 |
| skills/dispatching-parallel-agents/SKILL.md | appended "Platform integration" section: parallel work still maps 1 task = 1 lease via the agent CLI; independent domains not already split into tasks are a decomposition signal, not a license to share one lease | docs/skills-design.md §6 exact required wording |
| skills/writing-skills/SKILL.md | `name: writing-skills` → `name: superpowers-writing-skills`; added vendored-from comment | §2 |
| skills/writing-skills/SKILL.md | rewrote the "Personal skills live in…" line: dropped the Claude-Code-specific path assertion and the broken links to un-vendored `using-superpowers/references/{codex-tools,gemini-tools}.md`, restated as harness-neutral prose pointing at "your harness's own docs" | §2: plugin/harness-specific reference stripped, real behavior restated as prose; integrations.md §3 "strip hooks references" (extended here to the analogous plugin-path reference, the only such reference found in this skill's body) |
| skills/writing-skills/SKILL.md | updated in-body cross-references `superpowers:test-driven-development` → `superpowers-test-driven-development` (both occurrences, in the REQUIRED BACKGROUND lines) | keep intra-pack cross-references resolvable under this pack's renamed skill ids |
| skills/writing-skills/SKILL.md | appended "Platform integration" section: this is the meta-skill for authoring the platform's own Layer-1 contract skills; clarifies that the "Cross-Referencing Other Skills" section's `superpowers:name` colon-namespacing examples are upstream's own convention, not this platform's (`<pack>-<name>` here); notes the "push to your fork" deployment step doesn't apply | docs/skills-design.md §6/§1 naming convention; skills-design.md §7 (this skill backs our own contract-skill authoring) |

All other prose in every adopted `SKILL.md` (and every verbatim support
file: `writing-good-tests.md`, `root-cause-tracing.md`,
`defense-in-depth.md`, `condition-based-waiting.md`,
`anthropic-best-practices.md`, `testing-skills-with-subagents.md`,
`persuasion-principles.md`) is unchanged upstream text. The illustrative
`superpowers:test-driven-development` / `superpowers:systematic-debugging`
examples inside `writing-skills/SKILL.md`'s "Cross-Referencing Other
Skills" ✅/❌ example block were left as upstream text (they demonstrate
a generic naming *pattern*, not a link into this pack) and are called
out instead in that file's Platform integration section.
