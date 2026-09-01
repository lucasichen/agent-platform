// The lifecycle state machine (spec §6.3, DESIGN.md §3, §6). Rules are
// enforced, not advisory (spec F.5 "Done means"): every module that moves
// a task must go through assertLegalTransition, which rejects illegal
// transitions with a clear error naming the current state and the legal
// next states.
import type { Task, TaskState, TransitionRecord } from "./types";

const IMPLEMENTATION_ONLY_STATES: ReadonlySet<TaskState> = new Set([
  "VERIFYING",
  "REVIEWING",
  "MERGE_READY",
  "MERGED",
  "DEPLOYED",
  "PRODUCTION_VERIFIED",
]);

const GENERIC_ONLY_STATES: ReadonlySet<TaskState> = new Set(["GATING", "DONE"]);

// Every legal (from -> to) edge in the union of the generic lifecycle and
// its implementation specialization (spec §6.3 diagrams). Which edges are
// reachable for a given task additionally depends on task.type (checked
// separately below), since GATING/DONE and VERIFYING/REVIEWING/... are
// mutually exclusive branches of the same generic RUNNING -> gate step.
const EDGES: ReadonlyArray<[TaskState, TaskState]> = [
  // dependency/artifact ready (system)
  ["BLOCKED", "READY"],
  // claim
  ["READY", "ASSIGNED"],
  // start
  ["ASSIGNED", "RUNNING"],
  // reclaim: expired lease -> back to READY, attempt preserved
  ["ASSIGNED", "READY"],
  ["RUNNING", "READY"],
  ["REPAIR", "READY"],
  ["VERIFYING", "READY"],
  ["REVIEWING", "READY"],
  // generic: submit, gate
  ["RUNNING", "GATING"],
  ["GATING", "DONE"],
  ["GATING", "REPAIR"],
  ["GATING", "BLOCKED"], // budget-exhausted
  ["REPAIR", "RUNNING"], // resume after repair
  // implementation specialization: submit, gate(verification), gate(review)
  ["RUNNING", "VERIFYING"],
  ["VERIFYING", "REVIEWING"],
  ["VERIFYING", "REPAIR"],
  ["VERIFYING", "BLOCKED"], // budget-exhausted
  ["REVIEWING", "MERGE_READY"],
  ["REVIEWING", "REPAIR"],
  ["REVIEWING", "BLOCKED"], // budget-exhausted
  ["MERGE_READY", "MERGED"], // DONE at MERGED (spec §6.3)
  ["MERGED", "DEPLOYED"],
  ["DEPLOYED", "PRODUCTION_VERIFIED"],
  // manual `task fail` from any in-flight state
  ["ASSIGNED", "BLOCKED"],
  ["RUNNING", "BLOCKED"],
  ["GATING", "BLOCKED"],
  ["VERIFYING", "BLOCKED"],
  ["REVIEWING", "BLOCKED"],
  ["REPAIR", "BLOCKED"],
];

const EDGE_SET: ReadonlySet<string> = new Set(EDGES.map(([f, t]) => `${f}->${t}`));

export class IllegalTransitionError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly from: TaskState,
    public readonly to: TaskState,
    public readonly legalNext: TaskState[]
  ) {
    super(
      `Illegal transition for task ${taskId}: ${from} -> ${to} is not allowed. ` +
        (legalNext.length > 0 ? `Legal next state(s): ${legalNext.join(", ")}.` : "This is a terminal state.")
    );
    this.name = "IllegalTransitionError";
  }
}

export function legalNextStates(task: Pick<Task, "status" | "type">): TaskState[] {
  const from = task.status;
  const isImpl = task.type === "implementation";
  return EDGES.filter(([f]) => f === from)
    .map(([, t]) => t)
    .filter((t) => (isImpl ? !GENERIC_ONLY_STATES.has(t) : !IMPLEMENTATION_ONLY_STATES.has(t)));
}

/** Throws IllegalTransitionError if task.status -> to is not a legal edge. */
export function assertLegalTransition(task: Pick<Task, "id" | "status" | "type">, to: TaskState): void {
  const from = task.status;
  const isImpl = task.type === "implementation";
  if (isImpl && GENERIC_ONLY_STATES.has(to)) {
    throw new IllegalTransitionError(task.id, from, to, legalNextStates(task));
  }
  if (!isImpl && IMPLEMENTATION_ONLY_STATES.has(to)) {
    throw new IllegalTransitionError(task.id, from, to, legalNextStates(task));
  }
  if (!EDGE_SET.has(`${from}->${to}`)) {
    throw new IllegalTransitionError(task.id, from, to, legalNextStates(task));
  }
}

export function isDependencySatisfied(state: TaskState): boolean {
  return state === "DONE" || state === "MERGED" || state === "DEPLOYED" || state === "PRODUCTION_VERIFIED";
}

export function isTerminalForBudget(state: TaskState): boolean {
  return state === "BLOCKED";
}

export function makeTransitionRecord(from: TaskState, to: TaskState, actor: string, reason: string): TransitionRecord {
  return { ts: new Date().toISOString(), from, to, actor, reason };
}
