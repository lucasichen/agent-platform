# agent-platform

A harness-agnostic **agent engineering platform**: declarative artifacts
(missions, workflow templates, task envelopes, policies, role contracts)
plus a small file-based control-plane CLI, that let one senior developer
safely delegate increasing amounts of software work to autonomous coding
agents — in Cursor, Claude Code, or any other harness.

The goal is not maximum concurrency, commits, or agent utilization. The
goal, verbatim from the spec:

> Maximize architecture-approved, verified engineering output per dollar
> and per minute of human attention.

The central risk this platform is built against isn't agents failing to
produce code — it's locally correct shortcuts becoming merged reference
implementations, getting retrieved by future agents, and progressively
degrading the architecture. Functional correctness alone is insufficient;
independent verification, review, memory, and continual evaluation
constrain which local decisions are allowed to become permanent.

Full objective, principles, and architecture:
[`docs/spec/agent-engineering-platform-spec-v3.md`](./docs/spec/agent-engineering-platform-spec-v3.md)
§1–§3.

## Architecture, in brief

```
human mission
     |
workflow selector (thin composition layer)
     |
uncertainty + domain  ->  behavioral requirements  ->  design authority
     |
spec synthesis  ->  task decomposition  ->  task DAG
     |
control plane (scheduler + router: cheapest capable model per task)
     |
workers  (bounded implementation, never self-certifying)
     |
verification (deterministic + runtime, independent of the worker)
     |
review gates (spec / quality / architecture)
     |
merge refinery  ->  deploy / canary  ->  production telemetry
     |
learning evaluator (retrospectives + fleet evals feed back in)
```

No single framework or vendor owns this pipeline. Every stage is a **role
contract** — inputs, outputs, acceptance bar, failure behavior — bindable
to any model/harness that can meet it (spec Appendix F). The platform
speaks capability **tiers** (`frontier`, `strong`, `mid`, `cheap`), never
vendor models.

Every role can be bound at three layers: the platform's own portable
contract skills, pinned MIT snapshots of four vendored packs — pstack,
Matt Pocock's skills, Superpowers, gstack, under `skills/vendor/` with
their upstream commit and license recorded in each pack's `VENDOR.md` —
or an operator's own native harness install; `policies/bindings.yaml`
declares which is active per role per harness and `agent task claim`
announces it (`docs/integrations.md`, `skills/README.md`). The platform
also grows a tiered, gated memory — candidate facts proposed at task
submit, approved into durable Field Guide entries only by the tier's
authority role — so what one run learns durably helps the next
(`docs/memory.md`).

## Repository layout

| Path | What |
|---|---|
| `AGENTS.md` | Harness entrypoint — read this first if you're an agent |
| `docs/DESIGN.md` | Binding interface contract for building this repo |
| `docs/getting-started.md` | Install, `agent init`, first mission, the loop |
| `docs/evidence-contract.md` | Evidence bundle shapes, "PASS without evidence is FAIL" |
| `docs/integrations.md` | Third-party integration plan: the three-layer binding model, per-pack adoption |
| `docs/skills-design.md` | Binding interface contract for the skills/bindings build |
| `docs/memory.md` | Memory architecture: candidate facts to durable, tier-gated Field Guide entries |
| `docs/metrics.md` | Fleet/mission metrics, promotion gates, attention economics |
| `docs/security.md` | Prompt injection, secrets, sandboxing, supply chain |
| `docs/harness/` | Cursor / Claude Code / generic-harness how-to |
| `docs/spec/` | The full specification (read-only, authoritative) |
| `schemas/` | JSON Schemas — source of truth for every artifact shape |
| `registry/workflows/` | Reusable workflow templates (`project-definition`, `feature-development`, `bug-fix`) |
| `roles/` | Role contracts F.0–F.10, one file per role |
| `skills/` | Agent Skills: our contract skills, plus vendored MIT packs — the three-layer binding model behind every role (`skills/README.md`) |
| `policies/` | Default risk/model/escalation/architecture/bindings policy, copied into target repos by `agent init` |
| `templates/repo/.agent/` | The installable `.agent/` scaffold (spec Appendix A) |
| `platform/` | The `agent` control-plane CLI (Node/TypeScript) |

## Quickstart

Install the CLI, scaffold a target repository, author a mission, and run
the claim/start/submit/gate loop: see
[`docs/getting-started.md`](./docs/getting-started.md).

## Spec

The full specification — including the MVP milestone (§15), the fleet
security model (§16), and the sections marked "north star" that are
direction rather than committed build scope (§1.1) — lives at
[`docs/spec/agent-engineering-platform-spec-v3.md`](./docs/spec/agent-engineering-platform-spec-v3.md).
