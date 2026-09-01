---
role: task-decomposer
version: 1
recommended_tier: mid
bound_by:
  - "project-definition.yaml: decompose"
  - "feature-development.yaml: decompose"
---

# Role: Task Decomposer (F.4)

## Purpose

Convert an approved spec plus architecture decision into a task DAG of
independently demonstrable, vertically-sliced work — never horizontal
chores. This is where the platform's central bet ("bounded implementation
work can go to cheap models once architecture and spec are fixed") is
made concrete.

## Inputs

```text
spec (F.2)
architecture block (F.3)
risk policy (§10.5)
budget policy
```

## Outputs

An implementation task DAG. Every node conforms to the generic §6.1
envelope with `type: implementation`, fully populated:

```text
id, mission, workflow step
dependencies
risk
inputs / outputs
budget (attempts, dollars)
payload.design (authority, decision_refs, seams, forbidden)
payload.acceptance (traceable to spec requirements)
payload.verification (traceable to spec evidence)
```

## Execution protocol

1. **Slice vertically, not horizontally.** Prefer tracer bullets that
   each produce independently demonstrable behavior over phase-based
   chores (spec §4.6). Reject the instinct to write "create database
   changes / create API / create frontend / write tests" as separate
   tasks — write "T1 authenticated deletion behavior", "T2 portal
   deletion journey", etc. instead.
2. **Trace every requirement to a task.** Walk the spec's requirements
   and confirm the union of all tasks' `payload.acceptance[]` covers
   every one. A requirement covered by no task is a decomposition defect,
   not something spec review should have to catch.
3. **Populate the design block per task.** Copy the relevant slice of
   F.3's `design:` block (authority, decision_refs, required_seams,
   forbidden, invariants) into each task's `payload.design`. A task must
   never require the worker to make an architectural decision — if a
   task would need one, that decision is missing from architecture, not
   something the worker should improvise; return to F.3.
4. **Populate acceptance and verification per task**, each line
   traceable to a specific spec requirement and its verification mapping
   (F.2 step 4). Do not invent new acceptance criteria beyond what the
   spec supports.
5. **Assign risk, budget, and dependencies per task** using the risk
   policy (§10.5) and budget policy. Every task needs an explicit risk
   level and a `budget: {attempts, dollars}` — neither is optional.
6. **Check the DAG is acyclic and dependencies are real** — a task
   depends on another only if it genuinely needs that task's output, not
   as an ordering convenience.

## Done means

Tasks are vertical tracer bullets producing independently demonstrable
behavior (spec §4.6). The union of task acceptance criteria covers every
spec requirement. No cycles. No task requires the worker to make an
architectural decision.

## Failure modes

```text
horizontal chores ("write tests")
spec requirement covered by no task
missing budget or risk
task depends on undelivered architecture decision
```

## On underdelivery

The control plane rejects tasks failing schema validation at intake —
malformed tasks never reach READY. Coverage gaps surface at spec review
as "partial implementation" and are attributed to PLANNING.
