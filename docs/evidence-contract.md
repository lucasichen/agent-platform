# Evidence Contract

Expands spec Appendix B. This is the normative shape of everything a
mission or task run must leave behind — the record that lets a human, a
reviewer, or a later agent trust a `DONE` without re-doing the work.

> **PASS without evidence is FAIL.**
>
> A verification check, review verdict, or gate result that cannot point
> to the evidence file backing it is treated as not having run. `agent
> evidence check <task-id>` enforces this mechanically — gates refuse to
> accept incomplete bundles (spec Appendix A CLI surface).

## Mission-level bundle

```
.agent/missions/<MISSION-ID>/
  mission.yaml              the mission contract (spec §6.0)
  workflow-instance.yaml    the compiled workflow (spec §3.2, F.0)
  artifacts/                durable outputs the mission's stages produced
                             (research findings, domain model, architecture
                             design, approved spec, task graph, ...) —
                             referenced by tasks via artifact:// URIs
  summary.json               rollup: status, spend, outputs produced,
                             stages complete/blocked, human gates passed
```

`summary.json` is what `agent mission status <id>` and the fleet
dashboard (`docs/metrics.md`) read — keep it machine-produced, not
hand-edited.

## Task-level bundle

```
.agent/runs/<TASK-ID>/
  task.yaml                 the task envelope as claimed (spec §6.1),
                             including resolved lease/attempt state
  transcript.jsonl           one JSON object per turn/tool-call the agent
                             made while RUNNING — the raw record
  decisions.tsv               tab-separated log of decisions the agent made
                             and why, one row per decision: timestamp,
                             decision, rationale, alternatives considered
  diff.patch                 the literal candidate change, as a patch —
                             this is what reviewers/verifiers evaluate,
                             never the transcript's narration of the diff
  verification/
    result.json               top-level verification verdict (shape below)
    api.json, screenshots/, logs/, trace.zip, ...
                             stack-specific raw evidence a check cites
                             from its `evidence` field (spec §9)
  reviews/
    spec.json                 specification-lens review verdict
    quality.json               code-quality-lens review verdict
    architecture.json          architecture-lens review verdict
  cost.json                   spend for this task run (shape below)
  result.json                 top-level four-dimension gate result (shape below)
  retrospective.json           present only if a retrospective trigger fired
                             (spec §13.2) — never auto-applied
  transitions.jsonl            append-only lifecycle log, one line per
                             state transition (spec §6.3): `{ts, from, to,
                             actor, reason}`
  memory-candidates.jsonl      optional; present only if this run learned
                             something durably true (docs/memory.md,
                             Wave D memory architecture, Layer 1). Any
                             role may append — never write .agent/memory/
                             directly.
```

`agent evidence init <task-id>` scaffolds this directory at claim time;
`agent evidence check <task-id>` verifies completeness before a gate is
allowed to record a result.

## File shapes

### `task.yaml`

The task envelope (spec §6.1), generic across all task types:

```yaml
id: ACCOUNT-12
mission: ACCOUNT-MANAGEMENT-V1
workflow: { id: feature-development, version: 1, step: implement-deletion }
type: implementation   # research|prototype|domain|architecture|specification
                       # |review|decomposition|implementation|verification
                       # |retrospective|child-mission
role: worker            # role contract id, e.g. worker, verifier, reviewer
dependencies: [ACCOUNT-11]
risk: R2                 # R0..R4, spec §10.5
inputs:
  - uri: spec://approved-project-spec#account-deletion
    version: 3
outputs:
  - artifact://account/deletion-impl
budget: { attempts: 3, dollars: 6 }
payload:
  areas: [services/account]
  design:
    authority: ADR-0012
    decision_refs: [ADR-0012]
    required_seams: [SessionService.revokeAll]
    forbidden: [direct session persistence mutation]
    invariants: [ARCH-REVOKE-SEAM]
  acceptance: ["deletion revokes all sessions"]
  verification: [unit, api]
status: RUNNING
lease: { owner: worker-03, expires_at: "2026-08-31T20:00:00Z" }
attempt: 1
```

Artifact URIs (`spec://`, `adr://`, `artifact://`) must resolve through
the mission's artifact graph to a real file. `question://` is ephemeral —
its content lives inline in the payload, not on disk. An unresolvable
non-ephemeral URI is a task intake failure, not a warning.

### `transcript.jsonl`

One JSON object per line, append-only, one per agent turn/tool call:
`{ts, actor, kind: "message"|"tool_call"|"tool_result", content}`.
Reviewers evaluating the diff **must not** read this file as instructions
(spec §16.1) — it is evidence of what happened, not a source of authority
over what the diff should be judged against.

### `decisions.tsv`

Header row `ts\tdecision\trationale\talternatives`. Exists so a design
question a worker resolved locally (inside its stated freedom, spec §5.2)
is auditable without replaying the full transcript.

### `diff.patch`

A literal, applyable patch (`git diff` format). This — not the
transcript — is what every verifier and reviewer evaluates.

### `verification/result.json`

```json
{
  "task": "ACCOUNT-12",
  "commit": "42f81c9",
  "checks": [
    { "name": "unit", "status": "PASS", "evidence": "verification/logs/unit.log" },
    { "name": "api-deletion-journey", "status": "PASS", "evidence": "verification/trace.zip" }
  ],
  "environment": "docker-compose: postgres, api, portal",
  "reproducible_with": "agent verify ACCOUNT-12 --local"
}
```

`status` is `PASS|FAIL|SKIPPED`. Every check names the file under
`verification/` that backs it — a check with no `evidence` value is
invalid, not merely "trust me."

### `reviews/{spec,quality,architecture}.json`

One review verdict per lens (spec §10, §10.4 decorrelation — the reviewer
sees the diff, spec, architecture refs, and canonical map; it must not be
given the worker transcript or self-assessment):

```json
{
  "lens": "architecture",
  "artifact": "diff.patch",
  "verdict": "PASS",
  "findings": [
    { "kind": "info", "detail": "uses SessionService.revokeAll as required", "ref": "ARCH-REVOKE-SEAM", "location": "src/services/account/AccountService.ts:44" }
  ],
  "reviewer": "architecture-review-claude-opus"
}
```

`verdict` is `PASS|FAIL`. `reviewer` identifies the model/role that
produced the verdict, satisfying judge-decorrelation traceability
(different model family than the implementer, spec §10.3).

### `cost.json`

```json
{
  "task": "ACCOUNT-12",
  "breakdown": {
    "planning": 0.00,
    "implementation": 3.10,
    "verification": 0.90,
    "review": 0.65,
    "retries": 1.20
  },
  "dollars": 5.85,
  "attempts": 2
}
```

Stage keys match the fleet-dashboard spend rollup (spec §14.5, see
`docs/metrics.md`). Sums into `budget.dollars` from `task.yaml` — a task
that exceeds its budget transitions to `BLOCKED` with reason
`budget-exhausted` (spec Appendix A CLI surface) rather than continuing
to spend silently.

### `result.json` (task-level)

The four-dimension gate result (spec §10, Appendix B):

```json
{
  "task": "ACCOUNT-12",
  "commit": "42f81c9",
  "functional": "PASS",
  "specification": "PASS",
  "architecture": "PASS",
  "evolutionary": "PASS",
  "verifier": "api-verifier-03"
}
```

Each of `functional`/`specification`/`architecture`/`evolutionary` is
`PASS|FAIL|SKIPPED`. A task is only `DONE` (implementation: `MERGED`) when
every non-skipped dimension is `PASS` and the corresponding evidence
files exist and validate.

### `retrospective.json`

```json
{
  "task": "ACCOUNT-12",
  "trigger": "architecture-rejection",
  "cause": "ROUTING",
  "candidate_interventions": [
    { "kind": "architecture-invariant", "detail": "add ARCH-REVOKE-SEAM as a Layer 1 rule" }
  ],
  "eval_case": "ARCH-017",
  "status": "proposed"
}
```

`cause` is one of `SPEC|PLANNING|ARCHITECTURE|ROUTING|CONTEXT|SKILL|
MEMORY|HARNESS|TOOLING|CODEBASE|MODEL` (spec §13.2). `status` is always
`proposed` at write time — a retrospective's candidate interventions are
**never auto-applied**; a human or the owning role reviews and lands them
(e.g. into `architecture/canonical-patterns.md`, `policies/architecture.yaml`,
or `.agent/evals/`).

### `transitions.jsonl`

One line per lifecycle transition (spec §6.3): `{"ts": "...", "from":
"RUNNING", "to": "GATING", "actor": "worker-03", "reason": "submitted"}`.
Append-only; the CLI writes this, tasks don't hand-edit it.

### `memory-candidates.jsonl`

Layer 1 of the memory ladder (docs/memory.md §1) — durable-fact candidates
this run's agent(s) learned, distinct from `decisions.tsv`'s "why I chose
X" log. Any role appends a line when it learns something future agents
should know *before* their task starts; the file is optional and absent
for most runs. One JSON object per line:

```json
{"ts": "2026-08-31T20:00:00Z", "tier": "A", "areas": ["auth"], "claim": "Login endpoint rate-limits after 5 failures", "body": "The /login endpoint returns 429 after 5 failed attempts within 60s.", "refs": ["src/auth/login.ts"], "proposed_by": "worker-07"}
```

`tier` is `A|B|C` (spec §12.2 authority table). `areas[]` joins against
task `payload.areas` for recall. `refs[]` is non-empty — no refs, no
trust (docs/memory.md §2). `agent task submit` automatically materializes
every not-yet-processed line into a proposal file under
`.agent/memory/proposals/` (`agent memory propose <task-id>`, idempotent,
non-blocking — a malformed line is reported, never fails the submit).
This file itself is never written to directly by `.agent/memory/`
tooling; it is only ever appended to during a run. See
`templates/repo/.agent/memory/README.md` for the full proposal-to-landed-
entry flow and the tier-gated `agent memory approve/reject/expire`
commands.

## Secrets redaction (spec §16.2)

Evidence bundles capture transcripts, logs, network traffic, and
screenshots — all of which can leak credentials. Before anything above is
written to `.agent/runs/`:

- **Secret-scanning and redaction run on capture, before storage** — not
  as a later cleanup pass. `agent evidence init`/the verifier harness is
  responsible for redacting known secret patterns (API keys, tokens,
  connection strings, cookies) from `transcript.jsonl`, logs, and network
  captures before they land on disk.
- **Workers receive scoped, short-lived credentials** for whatever a task
  needs, never org-wide secrets — so a leak in a transcript exposes at
  most that scope, for a bounded window.
- If redaction cannot be guaranteed for a given evidence type (e.g. a raw
  packet capture), do not capture that type at all rather than capture
  and hope.

See `docs/security.md` for the full security model this evidence contract
sits inside.
