# Field Guide Memory

<!--
owner: see the authority table below — ownership is per-entry, by tier,
  not a single owner for the whole directory (spec §12.2, §12.4)
staleness trigger: entries carry a verified date and code references.
  A change to referenced code queues the entry for re-verification; an
  entry unverified past its bound (tier defaults A=60, B=90, C=180 days,
  overridable per entry) is flagged `status: needs-reverification` by
  `agent validate` — not silently deleted. Expiry (`agent memory expire`)
  is a task for the owning tier's approving role, not silence (spec
  §12.4, verbatim).
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
                       pre-create empty ones. Landed here by
                       `agent memory approve` — see "Proposal flow" below.
  proposals/            Layer 2 candidates awaiting tier-gated approval,
                       one file per proposal: <TASK-ID>-<NN>.md
  proposals/rejected/   declined proposals, reason preserved — never
                       silently deleted
  expired/              retired entries, superseded_by preserved
  discoveries/          point-in-time findings pending promotion to a
                       topic file, or narrow enough to stay standalone
  incidents/            postmortem-style entries: what broke, why, the
                       durable rule that prevents recurrence
```

See `memory/index.md` for the current topic list.

## The memory ladder (docs/memory.md §1)

Memory is never written directly. A candidate fact travels through three
layers before it is trusted:

```
Layer 0  within-task     .agent/runs/<TASK-ID>/ — nothing shared

Layer 1  candidate facts .agent/runs/<TASK-ID>/memory-candidates.jsonl —
                          any role appends {ts, tier, areas[], claim,
                          body, refs[], proposed_by} when it learns
                          something durably true. This is "what is
                          durably true," distinct from decisions.tsv's
                          "why I chose."

Layer 2  proposals        memory/proposals/<TASK-ID>-<NN>.md — one file
                          per candidate line, materialized automatically
                          by `agent task submit` (never silently lost),
                          or by `agent memory propose <task-id>` on
                          demand (idempotent — safe to re-run).

Layer 3  durable memory    memory/{index.md, <topic>.md, discoveries/,
                          incidents/} — entries land here ONLY through
                          tier-gated approval (below).
```

**Every role's duty**: when you learn something durably true, append it
to `.agent/runs/<TASK-ID>/memory-candidates.jsonl` — never write
`.agent/memory/` directly.

## Authority model (spec §12.2)

Memory is not self-certifying. Who may **write** a proposed entry and who
must **approve** it before it is trusted differs by tier:

| Tier | Examples | Proposes | Approves (`--by` role) |
|---|---|---|---|
| A — operational facts | build command, third-party quirk, test-environment limitation | Workers | `verifier` |
| B — domain knowledge | business terminology, state transitions, compatibility rules | Workers/domain roles | `verifier`, `domain-product-clarifier`, or `specifier` |
| C — architecture | ownership, canonical seams, dependency direction, architectural invariants | Workers/architect | `architect` or `design-authority` |

**A normal worker cannot establish architectural truth simply by writing
memory.** A worker proposing a Tier C entry is a signal to escalate to
design authority (spec §5.2), not to write the file directly. A pending
Tier C proposal is surfaced as an escalation by `agent status`, and
`agent memory approve`/`reject`/`expire` refuse (quoting this rule) when
`--by` names a role outside the tier's accepted set.

## Entry format (schemas/memory-entry.schema.json)

One format for a proposal, a standalone discovery/incident file, and a
block appended inside a topic file — a `---`-delimited YAML frontmatter
followed by a markdown body:

```markdown
---
id: MEM-AUTH-014
tier: A                      # A | B | C
areas: [auth]                 # join key to task payload.areas
owner: verifier-fleet         # role (tier default, overridable)
proposed_by: worker-07
approved_by: verifier         # null while pending
verified: 2026-08-12          # last attestation date
staleness_bound_days: 60      # tier defaults: A=60, B=90, C=180
refs:                         # minItems 1 — no refs, no trust
  - src/auth/session.ts
superseded_by: null           # supersession over deletion
status: active                # pending|active|needs-reverification|rejected|expired
source_task: ACCOUNT-12
---
## <claim as a heading>
<the fact, and why it matters>
```

An entry missing `verified` or `refs` cannot be trusted or freshness-
checked — `agent validate` rejects it against the schema.

## Proposal flow and CLI commands (docs/memory.md §3)

```
agent memory propose <task-id>        # materialize memory-candidates.jsonl
                                       # into proposals/ (auto-fired by
                                       # `agent task submit`; idempotent)
agent memory list [--status pending|active|needs-reverification|rejected|expired] [--json]
agent memory show <id>                # proposal filename (<TASK-ID>-<NN>)
                                       # or an entry's frontmatter id
agent memory approve <id> --by <role> # tier-checked against the table above
agent memory reject <id> --by <role> --reason "..."
agent memory expire <id> --by <role> --reason "..."
```

- **Approve** appends the entry into its first `areas[]` entry's topic
  file (`memory/<area>.md`), creating the topic file and adding a row to
  `index.md` if it's new, then deletes the proposal. This build's one
  consistent landing behavior is **topic-append** — `discoveries/` and
  `incidents/` remain available for entries a human author judges
  standalone, but the CLI never writes there itself.
- **Reject** moves the proposal to `proposals/rejected/` with the reason
  preserved in frontmatter — never silently deleted (a rejected Tier C
  proposal is escalation signal and retrospective input).
- **Expire** retires a landed entry to `expired/`, preserving
  `superseded_by`, with the reason added. If a topic file's last entry is
  expired, the (now-empty) topic file and its `index.md` row are removed
  — an empty file with no verified entries is worse than no file (spec
  §12.4).
- Approve/reject/expire are serialized by an exclusive-create lock
  (`mkdir .agent/memory/.lock`, atomic on POSIX and NTFS). On contention:
  fails fast with a retry message, matching the lease model's posture.
- `--by <role>` uses the same trust model as `agent task gate` (shape-
  checked free text, process discipline not cryptography).

## Recall at claim (docs/memory.md §3)

`agent task claim`/`agent task start` resolve the task's `payload.areas`
against memory (topic filename match + frontmatter `areas:` match) and
print the matching paths — `index.md` plus every matching topic,
discoveries, and incidents file — in their text output and under a
`memory` key in `--json`. Pure filesystem/frontmatter matching, no
embeddings; silent no-op when `.agent/memory` is absent.

## Trust decay (spec §12.4)

`agent validate` checks every landed entry's `refs` still resolve and its
`verified` date is within its tier's staleness bound. A failure flags
`status: needs-reverification` **in the entry itself** (never auto-
deletes) and surfaces on `agent status`'s exception dashboard for the
owning role. Per spec §12.4: a fresh entry, cite it and rely on it. A
stale entry (flagged `needs-reverification`, or whose `refs` no longer
resolve), treat as a hint — verify against code before relying on it, and
propose a refresh (re-`approve` to re-attest `verified`) or `expire`
rather than leaving it silently wrong.
