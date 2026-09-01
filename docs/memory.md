# Memory Architecture (Wave D design)

<!--
owner: repo-maintainer (design doc); memory entries themselves are owned
per tier (spec §12.2) — A: verifier fleet, B: domain authority, C: design
authority.
staleness trigger: this design is implemented by Wave D; once built, the
CLI sections below are superseded by the CLI's own --help and
docs/DESIGN.md. Re-verify the §5 landscape claims after 90 days.
-->

Design for how the platform remembers — from a single subagent's working
state up to durable, fleet-trusted knowledge — with concurrency and
freshness handled. Grounded in spec §12 (Field Guide memory, tier
authority, artifact freshness) and a 13-system survey of the 2026
agent-memory landscape (§5). Status: **approved design, buildable as
Wave D** (see docs/integrations.md §7).

## 1. The memory ladder

```text
LAYER 0  within-task (exists today)
         .agent/runs/<TASK-ID>/ — transcript.jsonl, decisions.tsv,
         evidence. One lease = one writer. Nothing shared.

LAYER 1  candidate facts (new)
         .agent/runs/<TASK-ID>/memory-candidates.jsonl — any role
         appends {ts, tier, areas[], claim, body, refs[], proposed_by}
         when it learns something future agents should know BEFORE
         their task starts. Distinct from decisions.tsv (why I chose)
         — this is "what is durably true."

LAYER 2  proposals (new)
         .agent/memory/proposals/<TASK-ID>-<NN>.md — one file per
         candidate, materialized by `agent memory propose <task-id>`
         (fired automatically on `agent task submit`, so candidates are
         never silently lost). One-file-per-proposal ⇒ zero write
         contention at any concurrency.

LAYER 3  durable Field Guide memory (exists; now gated)
         .agent/memory/{index.md, <topic>.md, discoveries/, incidents/}
         — entries land here ONLY through tier-gated approval:
         Tier A (operational)   → verifier approves
         Tier B (domain)        → domain/spec authority approves
         Tier C (architecture)  → design authority approves
         A pending Tier-C proposal is an ESCALATION, surfaced by
         `agent status` — a worker cannot establish architectural
         truth by writing memory (spec §12.2).

LAYER 4  fleet memory (sketched, not built)
         Cross-repo Tier-A facts promoted only when the same entry is
         independently approved in multiple repos. Opt-in by reference
         from a repo's index.md; only ever hints. Built when a second
         platform repo actually exhibits duplication — earned, not
         scheduled.
```

## 2. Entry schema

One format for proposals, standalone discovery/incident files, and
blocks inside topic files (`schemas/memory-entry.schema.json`, Wave D):

```markdown
---
id: MEM-AUTH-014
tier: A                      # A | B | C
areas: [auth, api]           # join key to task payload.areas
owner: verifier-fleet        # role (tier default, overridable)
proposed_by: worker-07
approved_by: verifier-fleet  # null while pending
verified: 2026-08-12         # last attestation date
staleness_bound_days: 60     # tier defaults: A=60, B=90, C=180
refs:                        # minItems 1 — no refs, no trust
  - src/auth/session.ts
superseded_by: null          # supersession over deletion
status: active               # pending|active|needs-reverification|rejected|expired
source_task: ACCOUNT-12
---
## <claim as a heading>
<the fact, and why it matters>
```

Tier-differentiated staleness defaults (third-party quirks rot fastest,
architecture invariants slowest): **A=60, B=90, C=180 days** —
overridable per entry.

## 3. CLI surface (Wave D)

```
agent memory propose <task-id>        # auto-fired by task submit
agent memory list [--status pending|...]
agent memory show <proposal-or-entry-id>
agent memory approve <id> --by <role> # tier-checked against §12.2 table
agent memory reject <id> --by <role> --reason "..."
agent memory expire <id> --by <role> --reason "..."
```

- Approve appends the entry into the matching topic file (or
  discoveries/), updates index.md when a topic is created, deletes the
  proposal. Reject moves it to proposals/rejected/ with the reason —
  never silently deleted (a rejected Tier-C proposal is escalation
  signal and retrospective input).
- Approval is the only write to a shared file; it is serialized by an
  exclusive-create lock (`mkdir .agent/memory/.lock` — atomic on POSIX
  and NTFS). On contention: fail fast and retry, matching the lease
  model's posture. Note: `appendJsonlAtomic` is single-writer-safe
  only; that is exactly why proposals are one file each.
- `--by <role>` uses the same trust model as `agent task gate` (shape-
  checked free text, process discipline not cryptography) — consistent
  platform-wide; strengthen both together if ever needed.

**Recall** — `agent task claim` resolves the task's `payload.areas`
against memory (topic filename match + frontmatter `areas:` grep) and
prints the matching *paths* (index, topics, discoveries, incidents) in
its output and `--json`. Pure filesystem matching; the role prompt tells
the agent to also grep for task-specific keywords. No embeddings: a
vector index is not diffable/reviewable and couples every harness to an
embedding vendor. It may only ever appear later as an optional,
regenerable accelerator if area/keyword recall is *measured* to miss —
never gating correctness.

**Freshness** — `agent validate` checks every entry's `refs` still
resolve and `verified` is within the tier's staleness bound; failures
flag `status: needs-reverification` (never auto-delete) and surface on
`agent status`'s exception dashboard for the owning role. Expired
entries retire to `expired/` with `superseded_by` pointing at any
replacement (supersession over deletion, borrowed from Graphiti's
temporal model).

## 4. Duplicates and hygiene

Duplicate entries from independent discovery are not prevented at
propose time — they're caught by the existing architecture-health
mechanism (spec §12.3 already hunts "duplicate concepts"): a periodic
memory dedup/merge scan, added once duplicates are actually observed.

## 5. Landscape survey — why build, not adopt

Thirteen systems evaluated against our constraints (file-based, no
always-on server, three harness primitives only, human-auditable/
git-diffable, tiered authority). Verdict: **no framework fits for
adoption; several are worth stealing from.**

| System | License | Verdict |
|---|---|---|
| Letta/MemGPT | Apache-2.0 | No — competing runtime, Postgres+pgvector. Steal: size-capped always-in-context memory blocks; background "sleep-time" curator |
| mem0 | Apache-2.0 | No — vector personalization store; add-only (hostile to staleness) |
| Zep/Graphiti | Apache-2.0 | No — mandatory graph DB. **Steal: bi-temporal supersession** (valid_from/valid_until/superseded_by, never delete) — adopted in §2/§3 |
| LangMem | MIT | No — LangGraph/Postgres-bound. Steal: gated procedural-memory revision |
| cognee | Apache-2.0 | No — local but binary on-disk (not diffable). Steal: Remember/Recall/Forget/Improve verb set |
| Claude Code CLAUDE.md pattern | — | Closest structural baseline (files, layered scopes, lazy topic loading) — pattern adopted, mechanism not (harness lock-in) |
| Anthropic memory tool / Managed Agents | — | Reference contracts: six-verb file API; per-store read-only-by-default + immutable versions — mirrored in our approval gating |
| ByteRover | Elastic 2.0 | License rules out adoption. Steal: zero-LLM-call retrieval discipline |
| Trellis | AGPL-3.0 | License rules out adoption. Structurally closest (journal→spec promotion); emulate, don't copy |
| Cline/Roo memory banks | various | The familiar pattern; no authority model — their community's drift to DB servers is the failure our tiers prevent. Steal: Roo's role-scoped write duties |
| AGENTS.md | open std | Adopt as-is as the emission format for operational-tier guidance |

## 6. Build plan (Wave D)

1. `schemas/memory-entry.schema.json`; `memory-candidates.jsonl` added
   to the evidence contract (docs/evidence-contract.md + Appendix B
   note).
2. CLI: `agent memory propose/list/show/approve/reject/expire`;
   auto-propose on submit; claim-time recall output; validate freshness
   checks; the approval lock.
3. Template updates: `templates/repo/.agent/memory/` gains proposals/
   and the formalized entry format in README.
4. `worker-startup` and role contracts gain one line: "when you learn
   something durably true, append it to memory-candidates.jsonl —
   don't write .agent/memory/ directly."

Open question for the owner (the one real fork): does "fleet" ever mean
multi-repo for you? Layer 4 stays a sketch until a second repo runs the
platform.
