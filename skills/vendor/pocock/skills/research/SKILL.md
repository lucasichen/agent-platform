---
name: pocock-research
description: Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to a background agent.
---
<!-- Vendored from skills/engineering/research/SKILL.md @ 6654f6b60cd9d5be8b54c6fafe44346dabeb3b76; adaptations logged in ../../VENDOR.md. MIT (c) 2026 Matt Pocock. -->

Spin up a **background agent** to do the research, so you keep working while it reads.

Its job:

1. Investigate the question against **primary sources** (official docs, source code, specs, first-party APIs), not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Write the findings to a single Markdown file, citing each claim's source.
3. Save it where the repo already keeps such notes; match the existing convention, and if there is none, put it somewhere sensible and say where.

## Platform integration

On this platform "where the repo already keeps such notes" is `.agent/missions/<MISSION-ID>/artifacts/`: write the findings file there (e.g. `.agent/missions/<MISSION-ID>/artifacts/research-<topic-slug>.md`) instead of inventing a location. Every claim keeps its citation (link, code reference, or transcript) inline — this is what lets F.1 (Uncertainty Resolver) mark a question `resolved` with `evidence:` rather than confidence alone, and what lets downstream F.2 (Specifier) reference the finding by id instead of re-copying it (spec §3.2 DRY rule). Findings that only partially answer the question are recorded as such, not rounded up to `resolved` — carry the remainder forward as `questions_open` on the owning F.1 investigation artifact, never silently dropped.
