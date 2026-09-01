// Shared test helpers: temp repos, fixture templates, minimal missions.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Mission, WorkflowTemplate } from "../src/types";
import { ensureDir, writeYamlAtomic, writeFileAtomic, readYaml } from "../src/fsutil";
import * as P from "../src/paths";
import { initRepo } from "../src/scaffold";

export function makeTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-cli-test-"));
  return dir;
}

/** `agent init`-equivalent, used by tests that need a fully installed .agent/ (policies etc). */
export function initTempRepo(): string {
  const repo = makeTempRepo();
  initRepo(repo);
  return repo;
}

const FIXTURES_DIR = path.join(__dirname, "fixtures");

/** Copies test/fixtures/templates/<name>.yaml into <repo>/.agent/workflows/<template.id>.yaml. */
export function installFixtureTemplate(repo: string, name: string): WorkflowTemplate {
  const srcPath = path.join(FIXTURES_DIR, "templates", `${name}.yaml`);
  const template = readYaml<WorkflowTemplate>(srcPath);
  const destPath = path.join(P.workflowsDirIn(repo), `${template.id}.yaml`);
  ensureDir(P.workflowsDirIn(repo));
  fs.copyFileSync(srcPath, destPath);
  return template;
}

export function baseMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: "MISSION-TEST-1",
    type: "happy-path",
    workflow: { id: "happy-path", version: 1 },
    goal: "Exercise the compiler in tests.",
    parent_mission: null,
    inputs: ["brief.md"],
    outputs: ["candidate-diff", "verification-result", "approved-change"],
    constraints: { default_risk: "R1" },
    budget: { dollars: 12 },
    human_gates: ["sign-off"],
    status: "DRAFT",
    ...overrides,
  };
}

/** Writes mission.yaml directly (bypassing `mission create`'s duplicate check) and ensures its dirs exist. */
export function registerMission(repo: string, mission: Mission): void {
  ensureDir(P.missionArtifactsDir(repo, mission.id));
  ensureDir(P.missionTasksDir(repo, mission.id));
  writeYamlAtomic(P.missionFile(repo, mission.id), mission);
}

export function writeMissionArtifact(repo: string, missionId: string, relPath: string, content = "content"): void {
  const filePath = path.join(P.missionArtifactsDir(repo, missionId), relPath);
  writeFileAtomic(filePath, content);
}
