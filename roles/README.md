<title>Role Contracts</title>

# Role contracts

This directory holds the platform's role contracts: F.0 through F.10 as
defined in `docs/spec/agent-engineering-platform-spec-v3.md` Appendix F,
plus this README. Each `F<N>-<name>.md` file is **both** a binding
contract and a usable system prompt.

## The binding rule (spec Appendix F.11)

> The system depends on the contracts. It never depends on the tools.

Every stage in a workflow template (`registry/workflows/*.yaml`) names a
**role**, not a product, a model, or a specific harness skill. A role is
defined entirely by:

- **Inputs** it requires before it may start
- **Outputs** it must produce, in an exact shape
- **Done means** — the acceptance bar for its output
- **Failure modes** — the ways it predictably underdelivers
- **On underdelivery** — what happens downstream when it does, and who
  detects it

Binding is the act of assigning a concrete tool, model, and prompt to a
role for a given repository or harness. Rebinding — replacing the
concrete tool without touching the workflow template or the contract — is
the platform's normal response to a role underdelivering:

```text
role underdelivers
       ↓
contract violation observed
(missing output, failed guarantee, decayed metric)
       ↓
downstream gate refuses its output
       ↓
task does not silently proceed
       ↓
rebind the role
       ↓
pipeline unchanged
```

No role file in this directory names a required tool, model vendor, or
harness. The spec's own worked examples default-bind these roles to
specific skill packages — **Matt** (wayfinder/research/prototype,
domain-modeling, grill-with-docs, to-spec, to-tickets), **pstack**
(/architect, /arena, /interrogate, poteto-mode, /unslop), **Superpowers**
(test-driven-development, systematic-debugging, verification-before-
completion), **Hermes** (the control-plane scheduler), and **gstack**
(runtime QA / verify-* skills) — but those are illustrative default
bindings from the spec, not dependencies of the contracts themselves.
This README is the only place in `/roles` that names them; every other
role file describes the underlying behavior in harness-agnostic terms so
it can be bound to any tool, model, or harness that meets the contract.

## Using a role file in any harness

A role file is self-contained. To run a role in Cursor, Claude Code, an
API-driven agent loop, or any other harness:

1. **Open the role file** and give its full contents to the model as (or
   prepended to) its system prompt. The frontmatter's `recommended_tier`
   is a starting point for model selection — the actual binding is
   resolved per task by `policies/risk.yaml` and `policies/models.yaml`
   (spec §7).
2. **Attach the task.** Give the model the task envelope YAML (spec
   §6.1) for the one task it owns, plus every artifact the task's
   `inputs[]` pin — nothing more. A role only sees what its contract
   lists as Inputs.
3. **Let it work the Execution protocol** in the role file. This is the
   harness-agnostic step list; a bound tool (a slash command, a skill, a
   plain prompt) may implement each step differently, but the sequence
   and the stop conditions are the contract.
4. **Collect the Outputs** in the exact shape the role file specifies
   and write them to the run directory (spec Appendix B:
   `.agent/runs/<TASK-ID>/...`). Downstream roles and the control plane
   (`agent` CLI, see `roles/F5-control-plane.md`) only trust what lands
   there in the specified shape — a plausible-sounding chat reply that
   never reaches the evidence bundle does not count as the role's
   output.
5. **Check Done means** before calling the task submitted. If Done means
   is not met, the role has not finished — see Failure modes and On
   underdelivery in that file for what happens next; usually a downstream
   gate refuses the output and the task is returned, not silently passed.

## The roles

| File | Spec ref | Role |
|---|---|---|
| `F0-workflow-compiler.md` | Appendix F.0 | Mission Router / Workflow Compiler |
| `F1-uncertainty-resolver.md` | Appendix F.1 | Uncertainty Resolver / Researcher |
| `F1A-domain-product-clarifier.md` | Appendix F.1A | Domain / Product Clarifier |
| `F2-specifier.md` | Appendix F.2 | Specifier |
| `F3-architect.md` | Appendix F.3 | Architect / Design Authority |
| `F4-task-decomposer.md` | Appendix F.4 | Task Decomposer |
| `F5-control-plane.md` | Appendix F.5 | Control Plane / Scheduler (documentation, not a prompt — see below) |
| `F6-worker.md` | Appendix F.6 | Worker |
| `F7-verifier.md` | Appendix F.7 | Verifier |
| `F8-reviewer.md` | Appendix F.8 | Reviewer (spec / quality / architecture / ambiguity / research-grounding lenses) |
| `F9-merge-refinery.md` | Appendix F.9 | Merge Refinery |
| `F10-learning-evaluator.md` | Appendix F.10 | Learning Evaluator |

`F5-control-plane.md` is the one exception to "usable as a system
prompt": it documents the guarantees the control-plane CLI must provide
(spec F.5's outputs/guarantees table), because the control plane is
deterministic software, not a model-driven role. The CLI implemented in
`/platform` (`agent`, per `docs/DESIGN.md` §6) is the reference binding
for this contract. Every other role in this directory is model-driven and
directly usable as a system prompt per the loop above.

## How roles map to workflow stages

Workflow templates in `registry/workflows/*.yaml` reference roles by the
`role:` id in the table above's filename stem (e.g. `role: architect` →
`F3-architect.md`). Each role file's frontmatter lists the specific
stages that currently bind to it (`bound_by:`) across the three MVP
templates. A role is not limited to those stages — any future workflow
template may route additional stages to the same role contract without
touching this directory.
