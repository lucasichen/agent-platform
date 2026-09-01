import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { makeTempRepo } from "./testutil";
import { initRepo } from "../src/scaffold";
import { agentDir, policiesDirIn } from "../src/paths";
import { readYaml } from "../src/fsutil";
import { validateOrThrow } from "../src/validate";

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
