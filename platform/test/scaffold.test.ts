import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { makeTempRepo, baseMission, registerMission } from "./testutil";
import { initRepo } from "../src/scaffold";
import { agentDir, policiesDirIn, workflowsDirIn } from "../src/paths";
import { readYaml } from "../src/fsutil";
import { validateOrThrow } from "../src/validate";
import { instantiateWorkflow } from "../src/compiler";

test("init installs the .agent scaffold and default policies", () => {
  const repo = makeTempRepo();
  const result = initRepo(repo);

  assert.ok(result.scaffoldCreated.includes("repo.yaml"));
  assert.ok(result.scaffoldCreated.some((f) => f.includes("domain") && f.includes("CONTEXT.md")));
  assert.ok(result.policiesCreated.includes("risk.yaml"));
  assert.ok(result.policiesCreated.includes("models.yaml"));
  assert.ok(result.policiesCreated.includes("escalation.yaml"));
  assert.ok(result.policiesCreated.includes("bindings.yaml"), "agent init must install bindings.yaml alongside the other policies");
  assert.equal(result.scaffoldSkipped.length, 0);
  assert.equal(result.policiesSkipped.length, 0);

  assert.ok(fs.existsSync(path.join(agentDir(repo), "repo.yaml")));
  assert.ok(fs.existsSync(path.join(policiesDirIn(repo), "risk.yaml")));
  assert.ok(fs.existsSync(path.join(policiesDirIn(repo), "bindings.yaml")));
  assert.ok(fs.existsSync(path.join(agentDir(repo), "missions")));
  assert.ok(fs.existsSync(path.join(agentDir(repo), "runs")));
});

test("init-installed bindings.yaml is schema-valid and covers every DESIGN.md role", () => {
  const repo = makeTempRepo();
  initRepo(repo);
  const data = readYaml<{ roles: Record<string, unknown> }>(path.join(policiesDirIn(repo), "bindings.yaml"));
  assert.doesNotThrow(() => validateOrThrow("bindings-policy", data, "installed bindings.yaml"));
  for (const role of [
    "workflow-compiler",
    "uncertainty-resolver",
    "domain-product-clarifier",
    "specifier",
    "architect",
    "task-decomposer",
    "control-plane",
    "worker",
    "verifier",
    "reviewer",
    "merge-refinery",
    "learning-evaluator",
  ]) {
    assert.ok(role in data.roles, `bindings.yaml is missing role '${role}' (spec Appendix G.1)`);
  }
});

test("init is idempotent: re-running never overwrites, reports everything as skipped", () => {
  const repo = makeTempRepo();
  initRepo(repo);

  // Simulate a local edit the operator made after the first init.
  const riskPath = path.join(policiesDirIn(repo), "risk.yaml");
  const edited = "# locally edited by the operator\nlevels: {}\n";
  fs.writeFileSync(riskPath, edited, "utf8");

  const second = initRepo(repo);
  assert.equal(second.scaffoldCreated.length, 0);
  assert.equal(second.policiesCreated.length, 0);
  assert.ok(second.scaffoldSkipped.length > 0);
  assert.ok(second.policiesSkipped.includes("risk.yaml"));

  // The local edit must survive: init never overwrites an existing file.
  assert.equal(fs.readFileSync(riskPath, "utf8"), edited);
});

// Fix 11: `agent init` also populates .agent/workflows/ with the packaged registry templates (spec Appendix A self-describing repos).

test("init populates .agent/workflows/ with the packaged registry templates", () => {
  const repo = makeTempRepo();
  const result = initRepo(repo);

  assert.ok(result.workflowsCreated.includes("feature-development.yaml"));
  assert.ok(result.workflowsCreated.includes("bug-fix.yaml"));
  assert.ok(result.workflowsCreated.includes("project-definition.yaml"));
  assert.equal(result.workflowsSkipped.length, 0);
  assert.ok(fs.existsSync(path.join(workflowsDirIn(repo), "feature-development.yaml")));
});

test("init's workflow population is idempotent and never overwrites a locally-edited template", () => {
  const repo = makeTempRepo();
  initRepo(repo);
  const localPath = path.join(workflowsDirIn(repo), "feature-development.yaml");
  const edited = "# locally edited by the operator\nid: feature-development\n";
  fs.writeFileSync(localPath, edited, "utf8");

  const second = initRepo(repo);
  assert.ok(second.workflowsSkipped.includes("feature-development.yaml"));
  assert.ok(!second.workflowsCreated.includes("feature-development.yaml"));
  assert.equal(fs.readFileSync(localPath, "utf8"), edited);
});

test("after init, `agent workflow instantiate` resolves feature-development from the repo-local copy", () => {
  const repo = makeTempRepo();
  initRepo(repo);

  const mission = baseMission({
    id: "MISSION-INIT-FD",
    type: "feature-development",
    workflow: { id: "feature-development", version: 1 },
    inputs: [],
    outputs: ["merged-commit"],
    human_gates: [],
    constraints: { default_risk: "R3" },
  });
  registerMission(repo, mission);

  const result = instantiateWorkflow(repo, mission.id);
  assert.equal(result.templateSource, path.join(workflowsDirIn(repo), "feature-development.yaml"));
  assert.ok(result.tasks.length > 0);
});

test("init on a repo with only some files present creates the rest and skips the rest", () => {
  const repo = makeTempRepo();
  fs.mkdirSync(agentDir(repo), { recursive: true });
  fs.writeFileSync(path.join(agentDir(repo), "repo.yaml"), "name: pre-existing\n", "utf8");

  const result = initRepo(repo);
  assert.ok(result.scaffoldSkipped.includes("repo.yaml"));
  assert.ok(!result.scaffoldCreated.includes("repo.yaml"));
  assert.ok(result.scaffoldCreated.length > 0, "other scaffold files should still be created");
  assert.equal(fs.readFileSync(path.join(agentDir(repo), "repo.yaml"), "utf8"), "name: pre-existing\n");
});
