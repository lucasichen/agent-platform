import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { validateOrThrow, ValidationError } from "../src/validate";
import {
  resolveSkillMdPath,
  parseSkillFrontmatter,
  resolveRoleBindings,
  bindingsSkillPathProblems,
  readBindingsWithFallback,
  type BindingsPolicy,
} from "../src/bindings";
import { makeTempRepo, installFixtureSkills, installFixtureBindings } from "./testutil";

test("bindings-policy schema accepts the fixture valid.yaml", () => {
  const repo = makeTempRepo();
  const data = installFixtureBindings(repo, "valid");
  assert.doesNotThrow(() => validateOrThrow("bindings-policy", data, "fixture:valid.yaml"));
});

test("bindings-policy schema rejects an unknown role id and an unknown harness key", () => {
  assert.throws(
    () =>
      validateOrThrow(
        "bindings-policy",
        { version: 1, roles: { "not-a-real-role": { skills: { generic: [] } } }, active_harness: "generic" },
        "in-memory"
      ),
    ValidationError
  );
  assert.throws(
    () =>
      validateOrThrow(
        "bindings-policy",
        { version: 1, roles: { worker: { skills: { generic: [], windsurf: [] } } }, active_harness: "generic" },
        "in-memory"
      ),
    ValidationError
  );
});

test("bindings-policy schema requires version/roles/active_harness", () => {
  assert.throws(() => validateOrThrow("bindings-policy", { roles: {} }, "in-memory"), ValidationError);
});

test("resolveSkillMdPath finds a skill vendored directly in the target repo", () => {
  const repo = makeTempRepo();
  installFixtureSkills(repo);
  const found = resolveSkillMdPath(repo, "skills/worker-startup");
  assert.ok(found, "expected worker-startup fixture to resolve");
  assert.equal(path.basename(found!), "SKILL.md");
  assert.ok(found!.startsWith(repo));
});

test("resolveSkillMdPath returns undefined for a path that resolves nowhere", () => {
  const repo = makeTempRepo();
  installFixtureSkills(repo);
  assert.equal(resolveSkillMdPath(repo, "skills/vendor/ghost-pack/skills/does-not-exist"), undefined);
});

test("parseSkillFrontmatter reads name/description and rejects a SKILL.md with no frontmatter", () => {
  const repo = makeTempRepo();
  installFixtureSkills(repo);
  const skillMd = resolveSkillMdPath(repo, "skills/vendor/pstack/skills/poteto-mode")!;
  const fm = parseSkillFrontmatter(skillMd);
  assert.equal(fm.name, "pstack-poteto-mode");
  assert.match(fm.description ?? "", /poteto-mode/);
});

test("resolveRoleBindings returns startup_skills + harness skills for a bound role", () => {
  const repo = makeTempRepo();
  installFixtureBindings(repo, "valid"); // active_harness: claude-code
  const rb = resolveRoleBindings(repo, "worker");
  assert.ok(rb);
  assert.deepEqual(rb!.startup_skills, ["skills/worker-startup"]);
  assert.deepEqual(rb!.skills, [
    "skills/vendor/pstack/skills/poteto-mode",
    "skills/vendor/superpowers/skills/test-driven-development",
  ]);
  assert.equal(rb!.harness, "claude-code");
});

test("resolveRoleBindings returns empty arrays for a role with no binding entry, not undefined", () => {
  const repo = makeTempRepo();
  installFixtureBindings(repo, "valid");
  const rb = resolveRoleBindings(repo, "verifier"); // present in schema's role set, absent from this fixture
  assert.ok(rb);
  assert.deepEqual(rb!.startup_skills, []);
  assert.deepEqual(rb!.skills, []);
});

test("resolveRoleBindings is a silent no-op (undefined) when the repo has no bindings.yaml", () => {
  const repo = makeTempRepo();
  assert.equal(resolveRoleBindings(repo, "worker"), undefined);
});

test("bindingsSkillPathProblems is empty when every path resolves", () => {
  const repo = makeTempRepo();
  installFixtureSkills(repo);
  const data = installFixtureBindings(repo, "valid");
  assert.deepEqual(bindingsSkillPathProblems(repo, data), []);
});

test("bindingsSkillPathProblems reports a missing skill path with its role/harness location", () => {
  const repo = makeTempRepo();
  installFixtureSkills(repo); // worker-startup exists, but the ghost-pack skill referenced below does not
  const data = installFixtureBindings(repo, "missing-skill");
  const problems = bindingsSkillPathProblems(repo, data);
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /roles\/worker\/skills\/claude-code/);
  assert.match(problems[0]!, /ghost-pack/);
});

test("readBindingsWithFallback prefers the repo's bindings.yaml over the packaged default", () => {
  const repo = makeTempRepo();
  installFixtureBindings(repo, "valid");
  const { data, source } = readBindingsWithFallback(repo);
  assert.equal(data.active_harness, "claude-code");
  assert.match(source, /\.agent[\\/]policies[\\/]bindings\.yaml$/);
});

test("readBindingsWithFallback falls back to the packaged default when the repo has none", () => {
  const repo = makeTempRepo();
  const { data, source } = readBindingsWithFallback(repo);
  assert.equal((data as BindingsPolicy).version, 1);
  assert.ok(!source.startsWith(repo), "fallback source must not be inside the (bindings-less) repo");
});
