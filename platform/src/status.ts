// `agent status` — exception-first fleet dashboard (spec §14.5, DESIGN.md
// §6 item 8). "Humans should monitor exceptions, not agent activity."
// Never a stream of routine activity: the dashboard surfaces
// budget-exhaustion, expired leases, tasks stuck in REPAIR, and gate
// failures first, then mission progress counts and per-state tallies —
// never a per-task listing of routine RUNNING/GATING work.
import type { Task, TaskState } from "./types";
import { listMissionIds, listTasks, readMission, readTransitions } from "./ledger";
import { isDependencySatisfied } from "./states";
import { memoryStatusSummary, type MemoryStatusSummary } from "./memory";

export interface BudgetExhaustedItem {
  task: string;
  mission: string;
  reason: string;
  attempt: number | undefined;
  budget_attempts: number;
}

export interface ExpiredLeaseItem {
  task: string;
  mission: string;
  owner: string;
  expires_at: string;
}

export interface StuckInRepairItem {
  task: string;
  mission: string;
  attempt: number | undefined;
  budget_attempts: number;
}

export interface GateFailureItem {
  task: string;
  mission: string;
  reason: string;
  ts: string;
}

export interface MissionProgress {
  id: string;
  status: string;
  total_tasks: number;
  complete_tasks: number;
  percent: number;
}

export interface StatusReport {
  exceptions: {
    budget_exhausted: BudgetExhaustedItem[];
    expired_leases: ExpiredLeaseItem[];
    stuck_in_repair: StuckInRepairItem[];
    gate_failures: GateFailureItem[];
    // A pending Tier-C proposal is an escalation, not routine memory
    // housekeeping (docs/memory.md §1 Layer 3, spec §12.2: "a worker
    // cannot establish architectural truth by writing memory"); a
    // needs-reverification entry is a freshness exception for its owning
    // role (spec §12.4).
    memory_tier_c_pending: MemoryStatusSummary["tier_c_pending"];
    memory_needs_reverification: MemoryStatusSummary["needs_reverification"];
  };
  missions: MissionProgress[];
  state_tally: Record<string, number>;
}

const ALL_STATES: TaskState[] = [
  "BLOCKED",
  "READY",
  "ASSIGNED",
  "RUNNING",
  "GATING",
  "REPAIR",
  "DONE",
  "VERIFYING",
  "REVIEWING",
  "MERGE_READY",
  "MERGED",
  "DEPLOYED",
  "PRODUCTION_VERIFIED",
];

function lastFailureReason(repo: string, task: Task): { reason: string; ts: string } | undefined {
  const transitions = readTransitions(repo, task.id);
  for (let i = transitions.length - 1; i >= 0; i--) {
    const t = transitions[i]!;
    if (t.to === "REPAIR" || (t.to === "BLOCKED" && /gate .* failed/.test(t.reason))) {
      return { reason: t.reason, ts: t.ts };
    }
  }
  return undefined;
}

export function buildStatusReport(repo: string): StatusReport {
  const now = Date.now();
  const tasks = listTasks(repo);

  const budgetExhausted: BudgetExhaustedItem[] = tasks
    .filter((t) => t.status === "BLOCKED" && t.blocked_reason === "budget-exhausted")
    .map((t) => ({
      task: t.id,
      mission: t.mission,
      reason: t.blocked_reason ?? "budget-exhausted",
      attempt: t.attempt,
      budget_attempts: t.budget.attempts,
    }));

  const expiredLeases: ExpiredLeaseItem[] = tasks
    .filter((t) => !!t.lease && new Date(t.lease.expires_at).getTime() <= now)
    .map((t) => ({ task: t.id, mission: t.mission, owner: t.lease!.owner, expires_at: t.lease!.expires_at }));

  const stuckInRepair: StuckInRepairItem[] = tasks
    .filter((t) => t.status === "REPAIR")
    .map((t) => ({ task: t.id, mission: t.mission, attempt: t.attempt, budget_attempts: t.budget.attempts }));

  const gateFailures: GateFailureItem[] = tasks
    .filter((t) => t.status === "REPAIR" || (t.status === "BLOCKED" && t.blocked_reason === "budget-exhausted"))
    .map((t) => {
      const f = lastFailureReason(repo, t);
      return f ? { task: t.id, mission: t.mission, reason: f.reason, ts: f.ts } : undefined;
    })
    .filter((x): x is GateFailureItem => x !== undefined);

  const missions: MissionProgress[] = listMissionIds(repo).map((id) => {
    const mission = readMission(repo, id);
    const missionTasks = listTasks(repo, { mission: id });
    const complete = missionTasks.filter((t) => isDependencySatisfied(t.status)).length;
    const total = missionTasks.length;
    return {
      id,
      status: mission.status,
      total_tasks: total,
      complete_tasks: complete,
      percent: total === 0 ? 0 : Math.round((complete / total) * 100),
    };
  });

  const stateTally: Record<string, number> = Object.fromEntries(ALL_STATES.map((s) => [s, 0]));
  for (const t of tasks) {
    stateTally[t.status] = (stateTally[t.status] ?? 0) + 1;
  }

  const memorySummary = memoryStatusSummary(repo);

  return {
    exceptions: {
      budget_exhausted: budgetExhausted,
      expired_leases: expiredLeases,
      stuck_in_repair: stuckInRepair,
      gate_failures: gateFailures,
      memory_tier_c_pending: memorySummary.tier_c_pending,
      memory_needs_reverification: memorySummary.needs_reverification,
    },
    missions,
    state_tally: stateTally,
  };
}

export function renderStatusText(report: StatusReport): string {
  const lines: string[] = [];
  const hasExceptions =
    report.exceptions.budget_exhausted.length +
      report.exceptions.expired_leases.length +
      report.exceptions.stuck_in_repair.length +
      report.exceptions.gate_failures.length +
      report.exceptions.memory_tier_c_pending.length +
      report.exceptions.memory_needs_reverification.length >
    0;

  lines.push("EXCEPTIONS");
  if (!hasExceptions) {
    lines.push("  (none)");
  } else {
    for (const e of report.exceptions.budget_exhausted) {
      lines.push(`  [budget-exhausted] ${e.task} (mission ${e.mission}) attempt ${e.attempt}/${e.budget_attempts}`);
    }
    for (const e of report.exceptions.expired_leases) {
      lines.push(`  [expired-lease] ${e.task} (mission ${e.mission}) held by ${e.owner}, expired ${e.expires_at}`);
    }
    for (const e of report.exceptions.stuck_in_repair) {
      lines.push(`  [stuck-in-repair] ${e.task} (mission ${e.mission}) attempt ${e.attempt}/${e.budget_attempts}`);
    }
    for (const e of report.exceptions.gate_failures) {
      lines.push(`  [gate-failure] ${e.task} (mission ${e.mission}) ${e.reason}`);
    }
    for (const e of report.exceptions.memory_tier_c_pending) {
      lines.push(`  [memory-tier-c-escalation] ${e.id} (source ${e.source_task}) areas=${e.areas.join(",")} — pending design-authority approval, ${e.file}`);
    }
    for (const e of report.exceptions.memory_needs_reverification) {
      lines.push(`  [memory-needs-reverification] ${e.id} areas=${e.areas.join(",")} — ${e.file}`);
    }
  }

  lines.push("");
  lines.push("MISSION PROGRESS");
  if (report.missions.length === 0) {
    lines.push("  (no missions)");
  } else {
    for (const m of report.missions) {
      lines.push(`  ${m.id} [${m.status}]  ${m.complete_tasks}/${m.total_tasks} tasks (${m.percent}%)`);
    }
  }

  lines.push("");
  lines.push("STATE TALLY");
  for (const [state, count] of Object.entries(report.state_tally)) {
    if (count > 0) lines.push(`  ${state.padEnd(20)} ${count}`);
  }

  return lines.join("\n");
}
