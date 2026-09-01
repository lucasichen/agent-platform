# Vendored: pocock
- upstream: https://github.com/mattpocock/skills
- pinned commit: 6654f6b60cd9d5be8b54c6fafe44346dabeb3b76
- fetched: 2026-08-31
- license: MIT, (c) 2026 Matt Pocock — see ./LICENSE (verbatim upstream)
- adopted subset: 11 of 37 upstream skills (see inventory)

## Discovery notes

Upstream has no top-level `skills/<name>/` layout as the platform's own
layout guide sketches; the real layout is `skills/<category>/<name>/`
with skills grouped into `engineering/`, `in-progress/`, `misc/`,
`productivity/`, and `deprecated/` (the last holding only a README, no
skills). All 11 requested skills exist verbatim under `skills/engineering/`
with the exact names requested — no name mismatches, no substitutions
needed. Each upstream skill directory also carries an `agents/openai.yaml`
(an OpenAI-runtime adapter file) which was **not** vendored: it is
harness-specific glue for a runtime this platform does not target, not
skill content. Markdown reference files that a skill's `SKILL.md`
directly links to as load-bearing content (format templates, prototype
sub-guides, the HTML report scaffold, the phase-boundary decision tree)
were vendored alongside their `SKILL.md`; a debugging helper script
(`diagnosing-bugs/scripts/hitl-loop.template.sh`) was left un-vendored
since it is a runnable tool, not methodology text — `diagnosing-bugs`'s
prose reference to it is kept intact as upstream context.

## Inventory

| local path | upstream path |
|---|---|
| skills/vendor/pocock/LICENSE | LICENSE |
| skills/vendor/pocock/skills/wayfinder/SKILL.md | skills/engineering/wayfinder/SKILL.md |
| skills/vendor/pocock/skills/research/SKILL.md | skills/engineering/research/SKILL.md |
| skills/vendor/pocock/skills/prototype/SKILL.md | skills/engineering/prototype/SKILL.md |
| skills/vendor/pocock/skills/prototype/LOGIC.md | skills/engineering/prototype/LOGIC.md |
| skills/vendor/pocock/skills/prototype/UI.md | skills/engineering/prototype/UI.md |
| skills/vendor/pocock/skills/grill-with-docs/SKILL.md | skills/engineering/grill-with-docs/SKILL.md |
| skills/vendor/pocock/skills/domain-modeling/SKILL.md | skills/engineering/domain-modeling/SKILL.md |
| skills/vendor/pocock/skills/domain-modeling/ADR-FORMAT.md | skills/engineering/domain-modeling/ADR-FORMAT.md |
| skills/vendor/pocock/skills/domain-modeling/CONTEXT-FORMAT.md | skills/engineering/domain-modeling/CONTEXT-FORMAT.md |
| skills/vendor/pocock/skills/to-spec/SKILL.md | skills/engineering/to-spec/SKILL.md |
| skills/vendor/pocock/skills/to-tickets/SKILL.md | skills/engineering/to-tickets/SKILL.md |
| skills/vendor/pocock/skills/code-review/SKILL.md | skills/engineering/code-review/SKILL.md |
| skills/vendor/pocock/skills/diagnosing-bugs/SKILL.md | skills/engineering/diagnosing-bugs/SKILL.md |
| skills/vendor/pocock/skills/improve-codebase-architecture/SKILL.md | skills/engineering/improve-codebase-architecture/SKILL.md |
| skills/vendor/pocock/skills/improve-codebase-architecture/HTML-REPORT.md | skills/engineering/improve-codebase-architecture/HTML-REPORT.md |
| skills/vendor/pocock/skills/ask-matt/SKILL.md | skills/engineering/ask-matt/SKILL.md |
| skills/vendor/pocock/skills/ask-matt/PHASE-BOUNDARIES.md | skills/engineering/ask-matt/PHASE-BOUNDARIES.md |

Not vendored (present upstream, out of adopted scope, listed for
completeness of the discovery record): `skills/engineering/{codebase-design,
implement,resolving-merge-conflicts,setup-matt-pocock-skills,tdd,triage,
wizard}`, all of `skills/in-progress/`, `skills/misc/`, `skills/productivity/`,
and every `agents/openai.yaml` adapter file under the 11 adopted skill
directories.

## Adaptation log

| file | change | reason |
|---|---|---|
| skills/wayfinder/SKILL.md | `name: wayfinder` → `name: pocock-wayfinder`; added vendored-from comment | skills-design.md §2 naming/provenance convention |
| skills/wayfinder/SKILL.md | removed `disable-model-invocation: true`; restated as an inline note in the body | §2: non-standard harness key stripped, real behavior kept as prose |
| skills/wayfinder/SKILL.md | appended "Platform integration" section (map/tickets → `.agent/missions/<ID>/artifacts/wayfinder/`, decisions_proposed hand off to F.1A/F.3/F.2, advisory-only routing) | docs/integrations.md §3 pocock adaptation + skills-design.md §6 |
| skills/research/SKILL.md | `name: research` → `name: pocock-research`; added vendored-from comment | §2 |
| skills/research/SKILL.md | appended "Platform integration" section (findings → `.agent/missions/<ID>/artifacts/`, citations required, ties to F.1 evidence contract) | integrations.md §3 explicit research mapping |
| skills/prototype/SKILL.md | `name: prototype` → `name: pocock-prototype`; added vendored-from comment | §2 |
| skills/prototype/SKILL.md | appended "Platform integration" section (capture step → F.1 `decisions_proposed`/`prototypes_deleted: true`, merge-refinery rejection of surviving prototypes) | roles/F1-uncertainty-resolver.md Done means/Failure modes |
| skills/grill-with-docs/SKILL.md | `name: grill-with-docs` → `name: pocock-grill-with-docs`; added vendored-from comment | §2 |
| skills/grill-with-docs/SKILL.md | removed `disable-model-invocation: true`; restated as an inline note in the body | §2 |
| skills/grill-with-docs/SKILL.md | appended "Platform integration" section (composes grilling + pocock-domain-modeling; feeds F.1A/F.3 sharpening, not spec/ticket output) | skills-design.md §6 |
| skills/domain-modeling/SKILL.md | `name: domain-modeling` → `name: pocock-domain-modeling`; added vendored-from comment | §2 |
| skills/domain-modeling/SKILL.md | appended "Platform integration" section (glossary/ADR output re-pointed at `.agent/domain/CONTEXT.md` and `.agent/domain/adr/`) | integrations.md §3 explicit domain-modeling mapping |
| skills/to-spec/SKILL.md | `name: to-spec` → `name: pocock-to-spec`; added vendored-from comment | §2 |
| skills/to-spec/SKILL.md | removed `disable-model-invocation: true`; restated as an inline note in the body | §2 |
| skills/to-spec/SKILL.md | appended "Platform integration" section (spec template mapped onto the F.2 spec shape; every requirement mapped to a verification line; unresolved high-risk questions bounce to F.1/F.1A/F.3) | integrations.md §3 explicit to-spec mapping; roles/F2-specifier.md; schemas/task.schema.json implementationPayload shape |
| skills/to-tickets/SKILL.md | `name: to-tickets` → `name: pocock-to-tickets`; added vendored-from comment | §2 |
| skills/to-tickets/SKILL.md | removed `disable-model-invocation: true`; restated as an inline note in the body | §2 |
| skills/to-tickets/SKILL.md | appended "Platform integration" section (tickets → `schemas/task.schema.json` task envelopes: dependencies, payload.design/acceptance/verification, risk, budget) | integrations.md §3 explicit to-tickets mapping; roles/F4-task-decomposer.md; schemas/task.schema.json |
| skills/code-review/SKILL.md | `name: code-review` → `name: pocock-code-review`; added vendored-from comment | §2 |
| skills/code-review/SKILL.md | appended "Platform integration" section (Standards/Spec axes → quality/spec review lenses; verdicts → `schemas/review-verdict.schema.json` files under `.agent/runs/<TASK-ID>/reviews/`; judge decorrelation preserved) | integrations.md §3 explicit code-review mapping; roles/F8-reviewer.md; schemas/review-verdict.schema.json |
| skills/diagnosing-bugs/SKILL.md | `name: diagnosing-bugs` → `name: pocock-diagnosing-bugs`; added vendored-from comment | §2 |
| skills/diagnosing-bugs/SKILL.md | appended "Platform integration" section (relationship to superpowers-systematic-debugging; evidence lands under `.agent/runs/<TASK-ID>/`; no-seam finding feeds F.8 Layer-2→Layer-1 shrinking rule) | skills-design.md §6 general integration requirement |
| skills/improve-codebase-architecture/SKILL.md | `name: improve-codebase-architecture` → `name: pocock-improve-codebase-architecture`; added vendored-from comment | §2 |
| skills/improve-codebase-architecture/SKILL.md | removed `disable-model-invocation: true`; restated as an inline note in the body | §2 |
| skills/improve-codebase-architecture/SKILL.md | appended "Platform integration" section (candidates → ADRs under `.agent/domain/adr/`, adoption owned by F.3/human; mechanically-catchable findings feed `architecture.yaml` per F.8 shrinking rule) | roles/F8-reviewer.md step 2; skills-design.md §6 |
| skills/ask-matt/SKILL.md | `name: ask-matt` → `name: pocock-ask-matt`; added vendored-from comment | §2 |
| skills/ask-matt/SKILL.md | removed `disable-model-invocation: true`; restated as an inline note in the body | §2 |
| skills/ask-matt/SKILL.md | appended "Platform integration" section: maps named upstream skills to their vendored `pocock-*` equivalents, flags non-adopted skills as upstream-context-only, and states explicitly that this skill is advisory only and never owns routing (F.0 does) | integrations.md §3 "ask-matt binds to F.0's advisory slot only … never owns routing"; skills-design.md §6 |

All other prose in every adopted `SKILL.md` (and every verbatim support
file: `LOGIC.md`, `UI.md`, `ADR-FORMAT.md`, `CONTEXT-FORMAT.md`,
`HTML-REPORT.md`, `PHASE-BOUNDARIES.md`) is unchanged upstream text, per
the "keep upstream methodology text intact" instruction.
