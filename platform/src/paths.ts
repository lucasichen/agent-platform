// Path helpers for a target repo's .agent/ directory (Appendix A, Appendix
// B). Every path is built with path.join so this is correct on Windows.
import * as path from "node:path";

export function agentDir(repo: string): string {
  return path.join(repo, ".agent");
}

export function policiesDirIn(repo: string): string {
  return path.join(agentDir(repo), "policies");
}

export function workflowsDirIn(repo: string): string {
  return path.join(agentDir(repo), "workflows");
}

export function missionsRootDir(repo: string): string {
  return path.join(agentDir(repo), "missions");
}

export function missionDir(repo: string, missionId: string): string {
  return path.join(missionsRootDir(repo), missionId);
}

export function missionFile(repo: string, missionId: string): string {
  return path.join(missionDir(repo, missionId), "mission.yaml");
}

export function workflowInstanceFile(repo: string, missionId: string): string {
  return path.join(missionDir(repo, missionId), "workflow-instance.yaml");
}

export function missionArtifactsDir(repo: string, missionId: string): string {
  return path.join(missionDir(repo, missionId), "artifacts");
}

export function missionSummaryFile(repo: string, missionId: string): string {
  return path.join(missionDir(repo, missionId), "summary.json");
}

export function missionTasksDir(repo: string, missionId: string): string {
  return path.join(missionDir(repo, missionId), "tasks");
}

export function taskFile(repo: string, missionId: string, taskId: string): string {
  return path.join(missionTasksDir(repo, missionId), `${taskId}.yaml`);
}

export function runsRootDir(repo: string): string {
  return path.join(agentDir(repo), "runs");
}

export function runDir(repo: string, taskId: string): string {
  return path.join(runsRootDir(repo), taskId);
}

export function transitionsFile(repo: string, taskId: string): string {
  return path.join(runDir(repo, taskId), "transitions.jsonl");
}

export function runTaskFile(repo: string, taskId: string): string {
  return path.join(runDir(repo, taskId), "task.yaml");
}

export function verificationResultFile(repo: string, taskId: string): string {
  return path.join(runDir(repo, taskId), "verification", "result.json");
}

export function reviewVerdictFile(repo: string, taskId: string, lens: string): string {
  return path.join(runDir(repo, taskId), "reviews", `${lens}.json`);
}

export function resultFile(repo: string, taskId: string): string {
  return path.join(runDir(repo, taskId), "result.json");
}

export function costFile(repo: string, taskId: string): string {
  return path.join(runDir(repo, taskId), "cost.json");
}

export function retrospectiveFile(repo: string, taskId: string): string {
  return path.join(runDir(repo, taskId), "retrospective.json");
}

export function memoryCandidatesFile(repo: string, taskId: string): string {
  return path.join(runDir(repo, taskId), "memory-candidates.jsonl");
}

/** Bookkeeping marker so `agent memory propose <task-id>` is idempotent (docs/memory.md §3 "manual re-run, idempotent"). Not a memory entry itself — lives under the task's own run dir, not under memoryDir. */
export function memoryMaterializedFile(repo: string, taskId: string): string {
  return path.join(runDir(repo, taskId), "memory-candidates.materialized.json");
}

export function memoryDir(repo: string): string {
  return path.join(agentDir(repo), "memory");
}

export function memoryIndexFile(repo: string): string {
  return path.join(memoryDir(repo), "index.md");
}

// -------------------------------------------------------------- architecture

/** .agent/policies/architecture.yaml (spec §10.3 Layer 1). Repo-specific; not installed by `agent init` (see policies/architecture.example.yaml header) — its absence is a clean pass, not an error. */
export function architecturePolicyFile(repo: string): string {
  return path.join(policiesDirIn(repo), "architecture.yaml");
}

// -------------------------------------------------------------------- evals

/** .agent/evals/ (spec §13.5, F.10). */
export function evalsDir(repo: string): string {
  return path.join(agentDir(repo), "evals");
}

export function evalCategoryDir(repo: string, category: string): string {
  return path.join(evalsDir(repo), category);
}

export function evalCaseFile(repo: string, category: string, id: string): string {
  return path.join(evalCategoryDir(repo, category), `${id}.yaml`);
}

export function memoryTopicFile(repo: string, area: string): string {
  return path.join(memoryDir(repo), `${area}.md`);
}

export function memoryProposalsDir(repo: string): string {
  return path.join(memoryDir(repo), "proposals");
}

export function memoryRejectedDir(repo: string): string {
  return path.join(memoryProposalsDir(repo), "rejected");
}

export function memoryExpiredDir(repo: string): string {
  return path.join(memoryDir(repo), "expired");
}

export function memoryDiscoveriesDir(repo: string): string {
  return path.join(memoryDir(repo), "discoveries");
}

export function memoryIncidentsDir(repo: string): string {
  return path.join(memoryDir(repo), "incidents");
}

export function memoryLockDir(repo: string): string {
  return path.join(memoryDir(repo), ".lock");
}

export function memoryProposalFile(repo: string, id: string): string {
  return path.join(memoryProposalsDir(repo), `${id}.md`);
}

export function memoryRejectedFile(repo: string, id: string): string {
  return path.join(memoryRejectedDir(repo), `${id}.md`);
}

export function memoryExpiredFile(repo: string, id: string): string {
  return path.join(memoryExpiredDir(repo), `${id}.md`);
}
