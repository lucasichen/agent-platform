# Field Guide Memory

<!--
owner: see the authority table below — ownership is per-entry, by tier,
  not a single owner for the whole directory (spec §12.2, §12.4)
staleness trigger: entries carry a verified date and code references.
  A change to referenced code queues the entry for re-verification; an
  entry unverified past its bound (default 90 days — tune per repo) is
  expired (spec §12.4, verbatim). Expiry is a task for the owning tier's
  approving role, not silence.
-->

Memory stores durable **discoveries**, not transcripts (spec §12.1). A
memory entry is something worth an agent knowing before it starts work —
not a record that "an agent tried something once."

**Good** (specific, durable, actionable):

```
Legacy mobile clients expect the error envelope with HTTP 200 for
this endpoint. Do not normalize to HTTP 401 without checking
backward compatibility.
```

**Bad** (not durable knowledge — delete on sight):

```
Claude tried changing this once and it failed.
```

## Structure

```
memory/
  index.md            this directory's table of contents (you are here-adjacent)
  <topic>.md           e.g. frontend.md, java-api.md, mobile.md, auth.md —
                       created as topics accumulate entries; don't
                       pre-create empty ones
  discoveries/          point-in-time findings pending promotion to a
                       topic file, or narrow enough to stay standalone
  incidents/            postmortem-style entries: what broke, why, the
                       durable rule that prevents recurrence
```

See `memory/index.md` for the current topic list.

## Authority model (spec §12.2)

Memory is not self-certifying. Who may **write** a proposed entry and who
must **approve** it before it is trusted differs by tier:

| Tier | Examples | Proposes | Approves |
|---|---|---|---|
| A — operational facts | build command, third-party quirk, test-environment limitation | Workers | Verifiers |
| B — domain knowledge | business terminology, state transitions, compatibility rules | Workers/domain roles | Domain/spec authority |
| C — architecture | ownership, canonical seams, dependency direction, architectural invariants | Workers/architect | Design authority |

**A normal worker cannot establish architectural truth simply by writing
memory.** A worker proposing a Tier C entry is a signal to escalate to
design authority (spec §5.2), not to write the file directly.

## Entry format

Every entry, regardless of tier, states:

```
<Topic / one-line claim>

<The durable fact, in the "good" style above — specific enough to act on.>

tier: A | B | C
verified: YYYY-MM-DD
refs: [code paths / commits the claim is anchored to]
approved_by: <role, per the authority table above>
```

An entry missing `verified` or `refs` cannot be trusted or freshness-
checked and should not be merged.

## Trust decay

Per spec §12.4: a fresh entry, cite it and rely on it. A stale entry
(unverified past its bound, or whose `refs` no longer resolve), treat as
a hint — verify against code before relying on it, and propose a refresh
or expiry rather than leaving it silently wrong.
