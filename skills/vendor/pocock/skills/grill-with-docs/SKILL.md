---
name: pocock-grill-with-docs
description: A relentless interview to sharpen a plan or design, which also creates docs (ADR's and glossary) as we go.
---
<!-- Vendored from skills/engineering/grill-with-docs/SKILL.md @ 6654f6b60cd9d5be8b54c6fafe44346dabeb3b76; adaptations logged in ../../VENDOR.md. MIT (c) 2026 Matt Pocock. -->

Note: upstream marks this skill `disable-model-invocation: true` — it is meant to be invoked explicitly (by name, or by a session that already decided the situation calls for it), not auto-triggered by the model from its description alone.

Call the Skill tool twice, for "grilling" and "domain-modeling".

## Platform integration

This skill is a thin composition of two upstream primitives we did not vendor separately: "grilling" (the interview primitive) and `pocock-domain-modeling` (vendored in this pack). Where a harness supports the Skill tool, call it for both in sequence; otherwise perform the equivalent interview inline, then follow `pocock-domain-modeling`'s Platform integration section for where the glossary/ADR output lands (`.agent/domain/CONTEXT.md`). This is the on-ramp F.1A (domain/product clarifier) and F.3 (architecture) use to sharpen an idea before it reaches F.2 (specifier); it produces sharpened understanding and domain artifacts, not a spec or tickets — those are `pocock-to-spec` and `pocock-to-tickets`.
