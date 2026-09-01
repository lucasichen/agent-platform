# ADR-{{NNNN}}: {{short decision title}}

<!--
owner: architect role (F.3) authors; design authority approves (spec §5.1)
staleness trigger: an ADR does not go stale in place — its `status` field
  is the freshness signal. A `superseded` ADR must name the ADR that
  replaces it. A reviewer checking architecture fit (spec §10.3) treats
  a `proposed` ADR as not yet authoritative, and a `superseded` one as
  historical record only — current truth lives in the ADR it points to,
  and in architecture/system.md and canonical-patterns.md, which the
  superseding ADR must update in the same change.
-->

Status: proposed | accepted | superseded-by ADR-{{NNNN}}
Date: {{YYYY-MM-DD}}
Deciders: {{role(s) — e.g. architect, design authority, human (mission M gate)}}

## Context

What problem forced this decision? What is the situation that made the
default/status-quo insufficient? Link the task, mission, or escalation
that raised it (spec §5.2 worker-escalation workflow: worker discovers a
design question it must not resolve on its own).

## Decision

The decision, stated as a single clear sentence, followed by the
reasoning. Be explicit about what is now required and what is now
forbidden — this is what `design.invariants` / `design.forbidden` in
downstream task payloads (spec §6.1) will cite.

## Alternatives considered

For each alternative: what it was, and why it was rejected. This is what
stops a future agent from relitigating a close call without new
information (see architecture/system.md "Consequential tradeoffs").

## Consequences

What this makes easier, what it makes harder, what it obsoletes. If it
demotes an existing pattern to legacy, update
`architecture/canonical-patterns.md` in the same change. If it changes
system shape, update `architecture/system.md` in the same change.

## Affected tasks / follow-ups

Tasks that were in flight when this decision was made and need their
`design` payload updated (spec §5.2: "affected tasks updated" is the last
step before execution resumes).
