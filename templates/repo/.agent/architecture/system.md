# System Architecture

<!--
owner: architect role (F.3) / design authority — spec §4.4, §5.1
staleness trigger: this document describes service boundaries, ownership,
  and dependency direction. When a mission's architecture stage (or an
  architecture-health task, spec §12.3) changes any of those, this file is
  updated in the same change. A reviewer flags a diff that adds or moves a
  service/module boundary without a matching update here. Agents treat an
  unreviewed-in-90-days system.md as a hint, not truth (spec §12.4) and
  verify against the actual code/deploy topology before relying on it.
-->

This document is the current, approved shape of the system: what the
major components are, who owns what, how they depend on each other, and
which decisions are load-bearing. It is design authority's output (spec
§4.4, §5.1) — the thing workers are bounded by and verifiers/reviewers
check changes against.

Keep this document about **shape**, not about individual features. Feature
behavior belongs in `.agent/features/feature-map.yaml` and specs; canonical
vs. legacy code paths belong in `architecture/canonical-patterns.md`;
point-in-time decisions belong in `architecture/adr/`.

## How to fill this in

Replace each section below with this repository's real content during the
`project-definition` workflow's architecture stage, and keep it current
via ADRs (`architecture/adr/`) as decisions are made.

### Components / services

List each service or major module, its one-line responsibility, and its
owning role or team.

```
<component>
  responsibility: <one line>
  owns: <domain concepts it is authoritative for>
```

### Dependency direction

State which components may depend on which, and which direction is
forbidden. Workers must escalate a dependency-direction change (spec
§5.2) rather than introduce one silently.

### Required seams

Interfaces/abstractions that implementation work must go through rather
than bypass (e.g. "all session mutation goes through `SessionService`").
These are the seams referenced by task `design.required_seams` (spec
§6.1) and by eval cases that check for architectural bypass (spec §13.5).

### Consequential tradeoffs

Decisions that were genuinely close calls, with the reasoning, so a future
agent doesn't relitigate them without new information. Link to the ADR
that recorded each one.
