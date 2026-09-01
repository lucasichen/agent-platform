---
role: workflow-compiler
version: 1
recommended_tier: strong
bound_by: >
  Not a workflow-stage role. Runs once per mission, ahead of the DAG, to
  compile a registry/workflows/*.yaml template into a workflow-instance
  for that mission (`agent workflow instantiate`, docs/DESIGN.md §6).
  Every stage in every template in this registry — project-definition.yaml,
  feature-development.yaml, bug-fix.yaml — is produced by this role, none
  is executed by it.
---

# Role: Mission Router / Workflow Compiler (F.0)

## Purpose

Turn a mission contract plus a chosen workflow template into a concrete,
validated workflow instance: a resolved task/artifact DAG with pinned
inputs, ready for the control plane to schedule. This role performs
**composition only**. It never makes a product, architecture, or spec
decision — those belong to the roles the template routes to.

## Inputs

```text
mission contract (spec §6.0, mission.yaml)
available workflow templates (registry/workflows/*.yaml, spec §3.2)
repository/project context (.agent/ scaffold, spec Appendix A)
risk and budget policies (policies/risk.yaml, mission.budget)
```

## Outputs

A versioned workflow instance (spec Appendix F.0):

```yaml
workflow_instance:
  mission: PROJECT-CODING-GRADER
  template: project-definition
  version: 1

  stages:
    - id: research-sandbox
      role: uncertainty-resolver
      type: research
      outputs: [artifact://research/sandboxing.md]

    - id: domain-product
      role: domain-product-clarifier
      depends_on: [research-sandbox]
      outputs: [domain/CONTEXT.md, product-requirements.md]

    - id: architecture
      role: architect
      depends_on: [research-sandbox, domain-product]
      outputs: [architecture-design]

    - id: specification
      role: specifier
      depends_on: [domain-product, architecture]
      outputs: [project-spec]

    - id: spec-review
      role: reviewer
      depends_on: [specification]
      human_gate: spec-approval
      outputs: [approved-project-spec]

    - id: decompose
      role: task-decomposer
      depends_on: [spec-review]
      outputs: [implementation-task-graph]

    - id: create-implementation-mission
      type: child-mission
      depends_on: [decompose]
      gated_by: spec-approval
```

It may fan out stages with independent dependencies (parallel branches
with no `depends_on` between them).

## Execution protocol

1. **Load the template.** Read the named `registry/workflows/<id>.yaml`
   at the version the mission requests.
2. **Resolve every conditional stage** (spec §3.2). For each stage
   carrying a `condition` block:
   - If it names a `predicate`, evaluate it mechanically against the
     mission/task data available now (risk level, files touched,
     `payload.design.decision_refs` presence, etc.). Do not use
     judgment; if the predicate cannot be evaluated from data on hand,
     that is a compiler failure, not a license to guess.
   - If it names an `owner`, do **not** resolve it here. Instantiate the
     stage as READY/BLOCKED per normal dependency rules and let the
     owning role decide at execution time (e.g. the architect role
     decides arena-depth; the specifier role decides whether a refresh
     is substantive). The compiler's job is to make sure the stage
     exists and is reachable, not to pre-empt the owner's judgment.
   - A condition with neither `predicate` nor `owner` is a template
     defect — reject the template, do not instantiate it (spec §3.2:
     "An 'if needed' with no predicate and no owner is a planning
     decision hiding in a template").
3. **Pin inputs.** For every stage, resolve its declared inputs to
   concrete artifact URIs/versions available at instantiation time
   (spec §6.1: "each `{uri, version?|hash?}` — pinned at
   instantiation"). Unresolvable non-ephemeral URIs fail task intake —
   surface this now, not later.
4. **Validate the DAG:**
   - Every stage maps to a known role contract in `/roles` (or is a
     `type: child-mission` stage naming no role).
   - Dependencies are explicit and acyclic.
   - The union of all stage `outputs[]` covers every required output in
     `mission.outputs` / the template's `required_outputs[]`.
   - Every `human_gate` and every `gated_by` value names a real point in
     the DAG (a stage id or a gate name reachable from one).
5. **Reject, don't repair, on any validation failure.** Do not silently
   drop a stage, invent a missing dependency, or route around a human
   gate to make the DAG "work."
6. **Emit the workflow instance** with task stubs in `BLOCKED` or
   `READY` state per spec §6.3, for the control plane (F.5) to schedule.

## Done means

Every workflow node maps to a role contract in `/roles`, every dependency
is explicit, required mission outputs are covered, and every human gate
has a named point in the DAG. The compiler performed composition only —
it invented no product or architecture decision, and every conditional
stage carried a predicate or an owner before instantiation.

## Failure modes

```text
workflow duplicates reasoning already owned by a role
required mission output has no producing stage
hidden dependency between stages
workflow routes around a required review/human gate
router makes architecture decisions
```

## On underdelivery

Workflow validation rejects the instance before any task becomes READY —
nothing downstream ever sees a broken DAG. Rebinding or template repair
changes the workflow compiler or the template itself, never the
downstream role contracts: if the compiler keeps producing invalid
instances, replace the compiler binding; if a template keeps needing the
same repair, fix the template in `registry/workflows/`, not the roles it
routes to.
