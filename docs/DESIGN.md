# Platform Design Contract (MVP)

This document is the **binding interface contract** for the MVP build. Every component must conform to the shapes and conventions here. The authoritative requirements are in `docs/spec/agent-engineering-platform-spec-v3.md` (referenced below as "spec §N"). Where this document and the spec conflict, the spec wins — flag the conflict, don't improvise.

## 1. What we are building (spec §15 MVP)

A harness-agnostic agent engineering platform:

- **Declarative artifacts**: mission contracts, workflow templates, task envelopes, policies (risk/models/escalation/architecture), role contracts — all YAML/Markdown, no runtime dependency on any specific AI product.
- **Control plane CLI** (`agent`): a Node/TypeScript CLI providing durable file-based task ledger, workflow compilation/validation, lifecycle state machine, leases, budgets, static risk-table routing (Phase 1, spec §7.3), and evidence-bundle helpers.
- **Repository operating contract**: an installable `.agent/` scaffold for target repos (spec Appendix A).
- **Role contracts**: F.0–F.10 as harness-agnostic prompt/contract files usable as system prompts in Cursor, Claude Code, or any agent harness.

The platform's own agents are *roles bound to whatever models the operator's harness provides*. Nothing in the platform hardcodes a vendor model — routing resolves **capability tiers** through a harness profile (see §5 below).

## 2. Repository layout (this repo)

```
agent-platform/
  README.md
  AGENTS.md                  # harness entrypoint (Cursor & most harnesses read this)
  CLAUDE.md                  # thin pointer to AGENTS.md
  docs/
    DESIGN.md                # this file
    getting-started.md
    evidence-contract.md
    harness/
      cursor.md
      claude-code.md
      generic.md
    spec/agent-engineering-platform-spec-v3.md
  schemas/                   # JSON Schema (draft 2020-12), one file per shape
    mission.schema.json
    task.schema.json
    workflow-template.schema.json
    workflow-instance.schema.json
    verification-result.schema.json
    review-verdict.schema.json
    result.schema.json
    cost.schema.json
    retrospective.schema.json
    eval-case.schema.json
    repo.schema.json         # repo.yaml
    models-policy.schema.json
    risk-policy.schema.json
  registry/
    workflows/
      project-definition.yaml
      feature-development.yaml
      bug-fix.yaml
  roles/                     # role contracts, one file per role
    F0-workflow-compiler.md
    F1-uncertainty-resolver.md
    F1A-domain-product-clarifier.md
    F2-specifier.md
    F3-architect.md
    F4-task-decomposer.md
    F5-control-plane.md      # documents the CLI's guarantees (not a prompt)
    F6-worker.md
    F7-verifier.md
    F8-reviewer.md
    F9-merge-refinery.md
    F10-learning-evaluator.md
  policies/                  # platform defaults, copied into target repos by `agent init`
    risk.yaml
    models.yaml
    escalation.yaml
    architecture.example.yaml
  templates/
    repo/                    # the .agent/ scaffold `agent init` installs (Appendix A)
      .agent/
        repo.yaml            # template with placeholders
        domain/CONTEXT.md
        architecture/{system.md,canonical-patterns.md,adr/,design/}
        features/feature-map.yaml
        policies/            # populated from /policies at init
        workflows/           # populated from registry/workflows/ at init (spec Appendix A)
        verification/README.md
        memory/{index.md,discoveries/,incidents/}
        evals/README.md
        missions/            # created at runtime
        runs/                # created at runtime
  platform/                  # control plane CLI (TypeScript)
    package.json             # name: @agent-platform/cli, bin: { agent: dist/cli.js }
    tsconfig.json
    src/
    test/
```

Flagged conflict, resolved in the spec's favor per this document's own
rule (§1): spec Appendix A's target-repo scaffold includes
`.agent/workflows/`; this document's scaffold listing above now carries
it too, populated at `agent init` time from `registry/workflows/` rather
than shipped as static files under `templates/repo/.agent/workflows/`.

## 3. Canonical data shapes

JSON Schemas in `/schemas` are the source of truth; the CLI validates against them (bundle them into the CLI at build time or load from a known path — CLI author's choice, but `agent validate` must work in a target repo without this repo present, so schemas ship inside the npm package).

All YAML examples in the spec are normative. Field summary:

### Mission (`mission.yaml`, spec §6.0)
`id` (SCREAMING-KEBAB, pattern `^[A-Z0-9][A-Z0-9-]+$`), `type` (workflow id), `workflow: {id, version}`, `goal` (string), `parent_mission` (string|null), `inputs[]`, `outputs[]` (required output artifact names), `constraints` (map), `budget: {dollars}`, `human_gates[]`, `status` (`DRAFT|ACTIVE|BLOCKED|COMPLETE|ABANDONED`). Child-mission rules: child budgets draw down parent remaining budget; depth/child-count capped by policy; child creation is a human gate by default.

### Task envelope (spec §6.1) — generic for ALL task types
`id`, `mission`, `workflow: {id, version, step}`, `type` (`research|prototype|domain|architecture|specification|review|decomposition|implementation|verification|retrospective|child-mission`), `role` (role contract id, e.g. `worker`), `dependencies[]` (task ids), `risk` (`R0..R4`), `inputs[]` (each `{uri, version?|hash?}` — pinned at instantiation), `outputs[]`, `budget: {attempts, dollars}`, `payload` (type-specific object), `status`, plus runtime fields maintained by the CLI: `lease: {owner, expires_at}|null`, `attempt` (int), `state_log` implied via transitions file.

Implementation payload: `areas[]`, `design: {authority, decision_refs[], required_seams[], forbidden[], invariants[]}`, `acceptance[]`, `verification[]`.

Artifact URIs: `spec://`, `adr://`, `artifact://`, `question://` (ephemeral, content in payload). Non-ephemeral URIs must resolve through the mission artifact graph to a real file; unresolvable URI ⇒ task intake failure.

### Workflow template (`registry/workflows/*.yaml`, spec §3.2, F.0)
`id`, `version` (int), `description`, `entry_conditions[]`, `required_inputs[]`, `stages[]` (each: `id`, `role`, `type`, `depends_on[]`, `outputs[]`, optional `human_gate`, optional `condition: {predicate | owner}` — every conditional stage names either a mechanical predicate or an owning role, spec §3.2), `required_outputs[]`, `terminal_condition`, `child_missions[]` (each `{workflow, gated_by}`).

### Workflow instance (`workflow-instance.yaml`, spec F.0)
`mission`, `template`, `version`, `stages[]` (resolved stages with pinned inputs). Compiler ("`agent workflow instantiate`") must validate: every stage maps to a known role; deps explicit and acyclic; all mission `outputs` covered by some stage's outputs; every human gate has a named DAG point. Reject otherwise — composition only, no planning decisions.

### Lifecycle (spec §6.3)
Generic: `BLOCKED → READY → ASSIGNED → RUNNING → GATING → DONE`, with `GATING --fail--> REPAIR → READY/RUNNING`.
Implementation specialization: `RUNNING → VERIFYING → (fail → REPAIR → RUNNING) → REVIEWING → MERGE_READY → MERGED → DEPLOYED → PRODUCTION_VERIFIED`. Implementation tasks are **DONE at MERGED**; DEPLOYED/PRODUCTION_VERIFIED never block dependents. Every transition appended to the run record with `{ts, from, to, actor, reason}`. Leases: expired lease ⇒ task safely reclaimable. Retries bounded by `budget.attempts`.

### Evidence bundle (spec Appendix B)
```
.agent/missions/<MISSION-ID>/{mission.yaml, workflow-instance.yaml, artifacts/, summary.json}
.agent/runs/<TASK-ID>/{task.yaml, transcript.jsonl, decisions.tsv, diff.patch,
  verification/{result.json, ...}, reviews/{spec.json,quality.json,architecture.json},
  cost.json, result.json, retrospective.json, transitions.jsonl}
```
`result.json`: `{task, commit, functional, specification, architecture, evolutionary, verifier}` with values `PASS|FAIL|SKIPPED`. `verification/result.json`: `{task, commit, checks[{name,status,evidence}], environment, reproducible_with}`. Review verdict: `{lens, artifact, verdict, findings[{kind,detail,ref,location}], reviewer}`. Retrospective: `{task, trigger, cause (SPEC|PLANNING|ARCHITECTURE|ROUTING|CONTEXT|SKILL|MEMORY|HARNESS|TOOLING|CODEBASE|MODEL), candidate_interventions[], eval_case?, status: proposed}` — never auto-applied.

## 4. Risk policy (spec §10.5) — `policies/risk.yaml`

Encodes the table: per risk level R0–R4 → required model tier for planning/implementation, verification depth (`deterministic|smoke|runtime|isolated-runtime`), required review lenses, human approval requirements. Phase-1 routing = this table, nothing else (`agent route <task>` resolves it).

## 5. Model tiers & harness profiles — `policies/models.yaml`

The platform speaks **tiers**, never vendor models:

```yaml
tiers: [frontier, strong, mid, cheap]
profiles:
  generic:      # capability descriptions only
  cursor:       # example mapping, editable, dated
  claude-code:  # example mapping, editable, dated
active_profile: generic
```

Example mappings are illustrative defaults the operator edits (model catalogs rot; the file carries an `as_of` date and a staleness note per spec §12.4 — owner: repo maintainer role; trigger: date older than 90 days ⇒ treat as hint). Cursor profile must only use models available in Cursor (Claude Sonnet/Opus/Haiku, GPT-5 family, Gemini, etc. — **no Fable**).

## 6. Control plane CLI surface (spec F.5)

Node ≥ 18, TypeScript, minimal deps (suggested: `commander`, `yaml`, `ajv` + `ajv-formats`; no DB — ledger is files under `.agent/`). All commands operate on the target repo's `.agent/` directory (cwd or `--repo <path>`). All writes atomic (write temp + rename). Exit code 0/1. `--json` flag on read commands for machine output.

```
agent init [--repo <path>]                  # install .agent/ scaffold + policies
agent validate [path...]                    # schema-validate missions/tasks/policies/templates
agent mission create --file mission.yaml    # validate + register
agent mission list|status <id>
agent workflow instantiate --mission <id>   # F.0 compiler: template → workflow-instance.yaml + task stubs (BLOCKED/READY)
agent task list [--state S] [--mission M]
agent task show <id>
agent task claim <id> --agent <name> [--ttl <min>] [--worktree]    # READY→ASSIGNED, lease; scaffolds the run dir; prints startup skills/bindings/memory paths
agent task start <id>                       # ASSIGNED→RUNNING
agent task submit <id>                      # RUNNING→GATING or VERIFYING (implementation)
agent task gate <id> --gate verification|review --result pass|fail [--evidence <file>]
agent task done <id> / agent task fail <id> --reason ...
agent task reclaim                          # expire dead leases
agent route <task-id>                       # print resolved tier/verification/review per risk policy
agent skills install [--harness <harness>] [--force]        # install bindings.yaml-referenced skills into the harness discovery path
agent arch check [--diff <ref>] [--json]    # deterministic Layer-1 architecture check against policies/architecture.yaml
agent evidence init <task-id>               # scaffold run directory
agent evidence check <task-id>              # completeness check (gates refuse incomplete bundles)
agent retro create <task-id> --trigger ... [--eval] [--eval-category <c>]  # scaffold retrospective.json; --eval chains agent eval create
agent eval create --from-retro <id> [--category <c>]   # scaffold a replayable eval case from a task's retrospective
agent eval list                             # list eval cases under .agent/evals/
agent memory propose <task-id>              # materialize memory-candidates.jsonl into pending proposals
agent memory list [--status <s>]            # list proposals + landed entries
agent memory show <id>                      # show one proposal or entry
agent memory approve <id> --by <role>       # land a pending proposal (tier-gated)
agent memory reject <id> --by <role> --reason ...   # decline a pending proposal (tier-gated)
agent memory expire <id> --by <role> --reason ...   # retire a landed entry (tier-gated)
agent status                                # mission/fleet dashboard (exception-first, spec §14.5)
```

State machine rules enforced, not advisory: illegal transitions rejected; budget.attempts exceeded ⇒ task → BLOCKED with reason `budget-exhausted` (escalation per policy); missing evidence ⇒ gate refuses.

Known inconsistency, candidate for a future normalization pass: `--json` output shapes are per-command, not a shared envelope — each command's JSON is whatever that command's own result type is, not a common `{data, ...}` wrapper.

## 7. Harness integration principle

Role contracts in `/roles` are self-contained: an operator (or orchestrating agent) opens a role file, gives it to any model in any harness along with the task YAML and pinned inputs, and the role knows its inputs/outputs/done-means/failure modes. `AGENTS.md` explains this loop. No component may assume a specific harness, model vendor, or the availability of Matt/pstack/Superpowers/Hermes/gstack — those are default bindings in the spec that we generalize (spec Appendix F: contracts, not tools).

## 8. Conventions

- YAML for human-authored artifacts, JSON for machine-produced records.
- kebab-case filenames; SCREAMING-KEBAB ids for missions/tasks.
- Every durable artifact template carries `owner:` (a role) and a staleness trigger comment (spec §12.4).
- Timestamps: ISO-8601 UTC.
- Node CLI must run on Windows (no POSIX-only path handling).
