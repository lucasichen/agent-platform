---
role: control-plane
version: 1
recommended_tier: "n/a — deterministic software component, not model-routed"
bound_by: >
  Underlies every stage transition in every workflow instance produced
  from registry/workflows/*.yaml (project-definition, feature-development,
  bug-fix). Not itself a DAG stage or a model-driven role.
---

# Role: Control Plane / Scheduler (F.5)

This file documents a **contract**, not a prompt. Unlike the other files
in `/roles`, F.5 is not model-driven — it is deterministic software. The
control-plane CLI in `/platform` (the `agent` command, per
`docs/DESIGN.md` §6) is the reference implementation of this contract.
Any replacement binding (a different scheduler, a hosted service) must
meet the same guarantees below before it may sit in this role.

## Purpose

Durably schedule and track every task in every mission's workflow
instance: assign work, enforce the lifecycle state machine, hold leases,
enforce budgets, route to the cheapest capable configuration, and expose
an exception-first view of the fleet. This role is the platform's safety
net — everything else assumes it never silently loses or duplicates work.

## Inputs

```text
validated workflow/task DAG (F.0 and, for implementation, F.4)
routing policy (§7)
role/worker/verifier pool registrations
```

## Outputs / guarantees

```text
durable tasks        survive process crash; no task lost or duplicated
lifecycle states      generic §6.3 lifecycle + type-specific gates, transitions logged
leases                expired lease → task safely reclaimed, work discarded or resumed
retries                bounded by task budget.attempts; each retry recorded
crash recovery        restart resumes from persisted state, idempotently
routing                cheapest capable configuration per §7.1, decision logged
dashboard              exception surface per §14.5
mission linkage        every task/state transition remains linked to mission + workflow version
```

Every state transition is appended to the run record (Appendix B) with
timestamp, actor, and reason.

## Execution protocol (as a contract, not a step list)

Because this role is not model-driven, its "execution protocol" is the
set of invariants a binding must uphold at every point, not a sequence a
model follows:

1. **State transitions are enforced, not advisory.** Illegal transitions
   are rejected outright — a binding may not "help out" by allowing a
   task to skip GATING or move RUNNING→DONE directly.
2. **Leases are the only mechanism for exclusive ownership of a task.**
   A task claimed by one owner is never handed to a second owner while
   its lease is live; an expired lease makes the task safely
   reclaimable, and the binding must decide (per task type / policy)
   whether reclaimed work is discarded or resumed — never left
   ambiguous.
3. **Budgets are hard limits.** `budget.attempts` exceeded moves the task
   to `BLOCKED` with reason `budget-exhausted` and triggers escalation
   per policy — it does not silently retry past the limit, and it does
   not silently drop the task instead of blocking it.
4. **Every transition is logged**, with enough detail (`{ts, from, to,
   actor, reason}`) to reconstruct what happened without asking the
   agent that ran it.
5. **Routing decisions are logged, not just applied** — `agent route
   <task-id>` must be able to show what the resolved tier/verification/
   review requirement was and why, for every routed task (spec §7.1,
   §10.5).
6. **Crash recovery is idempotent.** Restarting after a crash must
   resume from persisted state without re-running completed work or
   losing in-flight state.
7. **The dashboard surfaces exceptions, not noise** (spec §14.5) —
   healthy tasks proceeding normally should not compete for human
   attention with genuinely stuck or blocked ones.

## Done means

Kill any component at any moment; on restart, no task is lost,
double-assigned, or stuck outside the state machine. Budgets are
enforced, never advisory.

## Failure modes

```text
task stuck in ASSIGNED with dead worker and live lease
retry beyond budget
two workers on one task
lost state after crash
```

## On underdelivery

This role has no downstream safety net — it is the safety net. Contract
violations here are detected by audit (state log vs. observed work) and
are grounds for immediate rebinding. A hosted or third-party scheduler is
the initial binding precisely because the platform's own scaling story
(spec §14.4) already anticipates replacing it above team scale — the
contract, not the specific scheduler, is what workflow templates and
other roles depend on.
