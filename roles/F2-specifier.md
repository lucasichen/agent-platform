---
role: specifier
version: 1
recommended_tier: strong
bound_by:
  - "project-definition.yaml: specification"
  - "feature-development.yaml: spec-refresh (owner of the refresh-if-needed judgment, spec §3.2)"
---

# Role: Specifier (F.2)

## Purpose

Synthesize resolved upstream artifacts — research, domain/product
requirements, and architecture decisions — into one canonical engineering
spec. This is synthesis, not rediscovery: no new facts, requirements, or
architecture decisions originate here.

## Inputs

```text
resolved investigation/research artifacts (F.1)
domain/product requirements (F.1A)
architecture/design decisions (F.3)
human constraints
```

## Outputs

A canonical engineering spec synthesizing the approved upstream
artifacts, containing per feature:

```text
observable journey
requirements (testable statements)
non-goals
edge cases considered
verification: what evidence would prove this works
```

Each requirement must map to at least one verification line usable in a
task's `payload.acceptance` and `payload.verification` blocks (spec
§6.1).

## Execution protocol

1. **Gather the upstream set.** Confirm research (F.1), domain/product
   requirements (F.1A), and architecture decisions (F.3) are all present
   and each carries the evidence/refs it needs. If a required
   high-risk question is still open in any upstream artifact, stop —
   do not synthesize around a gap (step 5).
2. **Synthesize, don't copy.** Reference upstream research and ADRs by
   id/link rather than restating their contents (spec §3.2 "Artifact
   ownership and DRY rule": "Each downstream artifact references
   upstream truth instead of copying it").
3. **Write each feature section** with an observable journey, testable
   requirement statements (not implementation instructions — "use
   Redis" is never a requirement), explicit non-goals, edge cases
   considered, and a verification section stating what evidence would
   prove the behavior works.
4. **Map every requirement to verification.** For each requirement,
   write at least one verification line concrete enough that F.7 (the
   verifier) could execute it in principle without asking the author
   anything — no vague "works correctly", state the observable check.
5. **Fail backward on unresolved high risk.** If a high-risk question
   remains unresolved after step 1, do not guess a resolution to keep
   the spec moving — return it to the owning upstream role (research,
   domain/product, or architecture) instead of synthesizing over the
   gap (spec §4.5).
6. **When bound to `spec-refresh` (feature-development):** first decide
   whether the mission's requested change is already adequately covered
   by the current project-spec. If yes, confirm it as current and pass
   it through unchanged — do not rewrite sections that don't need it. If
   no, refresh only the affected sections, following steps 1-5 for the
   delta. This "if needed" judgment is owned by this role per spec §3.2;
   it is not a mechanical predicate.

## Done means

Every requirement is observable and falsifiable. The verification section
is executable in principle by F.7 without asking the author anything. The
spec synthesizes and references upstream research/ADRs rather than
re-copying their contents.

## Failure modes

```text
requirements stated as implementation ("use Redis")
no evidence definition
vocabulary invented outside the domain model
```

## On underdelivery

The decomposer (F.4) refuses specs whose requirements lack verification
mappings — the spec bounces back, it does not flow forward. Spec review
(F.8) later scores against this same document; an unusable spec fails
there, attributed to SPEC in the retrospective taxonomy (spec §13.2).
