# Domain Context

<!--
owner: domain-product-clarifier role (F.1A) — spec §4.2, §12.2 Tier B
  ("business terminology, state transitions, compatibility rules" ->
  domain/spec authority approves)
staleness trigger: each entry below should carry the date it was last
  verified against the running system. When the code implementing a term
  or state machine changes, the entry is queued for re-verification; an
  entry that has gone unverified past 90 days is a hint, not truth (spec
  §12.4) — re-check it against code before a new mission relies on it, and
  propose a refresh or deletion rather than leaving it silently stale.
-->

This file is the repository's canonical vocabulary: the small set of
domain nouns and state machines every agent working in this repo must use
consistently. Its purpose is to stop independent agents from inventing
overlapping concepts for the same thing (spec §4.2) — e.g. `Customer`,
`User`, `UserAccount`, and `ProfileAccount` all meaning "a registered
user" in different parts of the codebase.

Populate this file during the `project-definition` workflow's domain
stage (role: `domain-product-clarifier`), and update it whenever a
mission introduces or changes a domain concept. Keep entries short:
a name, a one-line canonical definition, and — for anything with a
lifecycle — its states and legal transitions.

## How to write an entry

```
<Term>
<One-line canonical definition.>
<verified: YYYY-MM-DD>

<optional state machine, if the term has a lifecycle>
State -> State -> State
```

## Example entries

These are illustrative — replace them with this repository's real
vocabulary. Delete this section once real entries exist.

```
Account
Canonical representation of a registered user.
verified: 2026-01-15

Session
Authenticated access belonging to an Account.
verified: 2026-01-15

Deletion
Account lifecycle transition:
Active -> PendingDeletion -> Deleted
verified: 2026-01-15
```

## Entries

<!-- Add real entries below, one per concept, in the format above. -->
