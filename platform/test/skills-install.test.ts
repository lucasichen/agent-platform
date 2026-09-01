import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { installSkills } from "../src/skills";
import { makeTempRepo, installFixtureSkills, installFixtureBindings } from "./testutil";

function setup() {
  const repo = makeTempRepo();
  installFixtureSkills(repo);
  installFixtureBindings(repo, "valid"); // active_harness: claude-code
  return repo;
}

test("install --harness claude-code copies every referenced skill (startup + per-role) flattened by frontmatter name", () => {
  const repo = setup();
  const result = installSkills(repo, { harness: "claude-code" });

  assert.equal(result.harness, "claude-code");
  assert.equal(result.installDir, path.join(repo, ".claude", "skills"));
  const names = result.items.map((i) => i.name).sort();
  assert.deepEqual(names, ["pstack-poteto-mode", "superpowers-test-driven-development", "worker-startup"]);
  assert.ok(result.items.every((i) => i.status === "installed"));

  const workerStartupDir = path.join(repo, ".claude", "skills", "worker-startup");
  assert.ok(fs.existsSync(path.join(workerStartupDir, "SKILL.md")));
  // A skill directory's non-SKILL.md files are copied too.
  assert.ok(fs.existsSync(path.join(workerStartupDir, "reference.md")));
  assert.ok(fs.existsSync(path.join(repo, ".claude", "skills", "pstack-poteto-mode", "SKILL.md")));
});

test("install --harness cursor installs only cursor-recommended + startup skills", () => {
  const repo = setup();
  const result = installSkills(repo, { harness: "cursor" });
  assert.equal(result.installDir, path.join(repo, ".cursor", "skills"));
  const names = result.items.map((i) => i.name).sort();
  // architect's cursor list is empty in the fixture; only worker's startup + cursor skill show up.
  assert.deepEqual(names, ["pstack-poteto-mode", "worker-startup"]);
});

test("install --harness generic writes .agent/skills-index.md instead of copying, and never touches AGENTS.md", () => {
  const repo = setup();
  const result = installSkills(repo, { harness: "generic" });
  assert.equal(result.installDir, undefined);
  assert.ok(result.indexFile);
  const content = fs.readFileSync(result.indexFile!, "utf8");
  assert.match(content, /# Skills Index/);
  assert.match(content, /\| worker-startup \|/);
  assert.ok(!fs.existsSync(path.join(repo, "AGENTS.md")), "must never create/edit AGENTS.md");
});

test("generic index collapses a multi-line frontmatter description onto one table row", () => {
  const repo = makeTempRepo();
  installFixtureSkills(repo);
  installFixtureBindings(repo, "generic-multiline");

  const result = installSkills(repo, { harness: "generic" });
  const content = fs.readFileSync(result.indexFile!, "utf8");
  const lines = content.split("\n");
  const rowIndex = lines.findIndex((l) => l.includes("testpack-multiline-desc"));
  assert.ok(rowIndex >= 0, "expected a row for the multiline-description skill");
  const row = lines[rowIndex]!;
  assert.match(row, /^\| testpack-multiline-desc \| .*spans multiple lines.* \| skills\/vendor\/testpack\/skills\/multiline-desc \|$/);
  // No stray continuation line: the very next line is a new table row or blank, not a fragment of this one.
  assert.ok(!(lines[rowIndex + 1] ?? "").startsWith(" |"), "description must not leak a raw newline into the table");
});

test("harness defaults to bindings.yaml's active_harness when --harness is omitted", () => {
  const repo = setup(); // fixture active_harness: claude-code
  const result = installSkills(repo);
  assert.equal(result.harness, "claude-code");
});

test("install is idempotent: re-running without --force skips already-installed skills and reports it, never errors", () => {
  const repo = setup();
  installSkills(repo, { harness: "claude-code" });
  const second = installSkills(repo, { harness: "claude-code" });
  assert.ok(second.items.every((i) => i.status === "skipped"));

  const skillMd = path.join(repo, ".claude", "skills", "worker-startup", "SKILL.md");
  const untouched = fs.readFileSync(skillMd, "utf8");
  assert.match(untouched, /name: worker-startup/);
});

test("--force overwrites a previously installed skill", () => {
  const repo = setup();
  installSkills(repo, { harness: "claude-code" });
  const skillMd = path.join(repo, ".claude", "skills", "worker-startup", "SKILL.md");
  fs.writeFileSync(skillMd, "locally modified\n", "utf8");

  const forced = installSkills(repo, { harness: "claude-code", force: true });
  const item = forced.items.find((i) => i.name === "worker-startup");
  assert.equal(item?.status, "overwritten");
  assert.match(fs.readFileSync(skillMd, "utf8"), /name: worker-startup/);
});

test("a referenced skill whose directory cannot be resolved is a per-item warning, not a crash", () => {
  const repo = makeTempRepo();
  installFixtureSkills(repo); // worker-startup exists; the ghost-pack skill below does not
  installFixtureBindings(repo, "missing-skill");

  const result = installSkills(repo, { harness: "claude-code" });
  const statuses = new Map(result.items.map((i) => [i.relPath, i.status]));
  assert.equal(statuses.get("skills/worker-startup"), "installed");
  assert.equal(statuses.get("skills/vendor/ghost-pack/skills/does-not-exist"), "missing");
});

// Fix 6: a malformed SKILL.md frontmatter is a per-item warning, not a crash that aborts the batch.

test("install --harness claude-code: a malformed SKILL.md frontmatter is a per-item warning, other skills still install", () => {
  const repo = makeTempRepo();
  installFixtureSkills(repo);
  installFixtureBindings(repo, "bad-skill");

  const result = installSkills(repo, { harness: "claude-code" });
  const statuses = new Map(result.items.map((i) => [i.relPath, i.status]));
  assert.equal(statuses.get("skills/worker-startup"), "installed", "the well-formed skill must still install");
  assert.equal(statuses.get("skills/vendor/badpack/skills/broken-skill"), "warning");
  const broken = result.items.find((i) => i.relPath === "skills/vendor/badpack/skills/broken-skill")!;
  assert.match(broken.detail ?? "", /malformed SKILL\.md frontmatter/);
  assert.ok(fs.existsSync(path.join(repo, ".claude", "skills", "worker-startup", "SKILL.md")));
});

test("install --harness generic: a malformed SKILL.md frontmatter is a per-item warning, the index still gets the other skill's row", () => {
  const repo = makeTempRepo();
  installFixtureSkills(repo);
  installFixtureBindings(repo, "bad-skill");

  const result = installSkills(repo, { harness: "generic" });
  const statuses = new Map(result.items.map((i) => [i.relPath, i.status]));
  assert.equal(statuses.get("skills/vendor/badpack/skills/broken-skill"), "warning");
  const content = fs.readFileSync(result.indexFile!, "utf8");
  assert.match(content, /\| worker-startup \|/);
});

test("installSkills falls back to the packaged default bindings.yaml when the repo has none", () => {
  const repo = makeTempRepo();
  // No installFixtureBindings call: the repo has no .agent/policies/bindings.yaml at all.
  assert.doesNotThrow(() => installSkills(repo, { harness: "generic" }));
});
