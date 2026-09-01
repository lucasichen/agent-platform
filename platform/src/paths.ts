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
