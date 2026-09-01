import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { runArchCheck } from "../src/archcheck";
import * as ledger from "../src/ledger";
import { EvidenceIncompleteError } from "../src/ledger";
import { checkEvidence } from "../src/evidence";
import { archCheckProblemsForGate } from "../src/archcheck";
import { ArchViolationsError } from "../src/ledger";
import * as P from "../src/paths";
import { makeTempRepo, initTempRepo, baseMission, registerMission } from "./testutil";
import type { Task } from "../src/types";

const FIXTURES = path.join(__dirname, "fixtures", "arch");

function git(repo: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

function copyFile(src: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/** A temp repo with the fixture's clean source tree + architecture.yaml installed, not a git repo. */
function makeCleanArchRepo(): string {
  const repo = makeTempRepo();
  copyDir(path.join(FIXTURES, "repo"), repo);
  copyFile(path.join(FIXTURES, "architecture.yaml"), P.architecturePolicyFile(repo));
  return repo;
}

function snippet(name: string): string {
  return path.join(FIXTURES, "snippets", `${name}.ts`);
}

// ------------------------------------------------------------ policy absent

test("runArchCheck: absent architecture.yaml is a clean pass with a note", () => {
  const repo = makeTempRepo();
  const result = runArchCheck(repo);
  assert.equal(result.policyFound, false);
  assert.deepEqual(result.violations, []);
  assert.ok(result.notes.length > 0);
});

// ------------------------------------------------------- forbidden-dependency

test("forbidden-dependency: clean tree has no ARCH-SESSION-PERSISTENCE violation", () => {
  const repo = makeCleanArchRepo();
  const result = runArchCheck(repo);
  assert.equal(result.policyFound, true);
  assert.deepEqual(
    result.violations.filter((v) => v.rule === "ARCH-SESSION-PERSISTENCE"),
    []
  );
});

test("forbidden-dependency: a controller importing persistence/session directly is flagged with file+line", () => {
  const repo = makeCleanArchRepo();
  copyFile(snippet("forbidden-dependency-violation"), path.join(repo, "controllers", "session_controller.ts"));
  const result = runArchCheck(repo);
  const hit = result.violations.find((v) => v.rule === "ARCH-SESSION-PERSISTENCE");
  assert.ok(hit, "expected ARCH-SESSION-PERSISTENCE violation");
  assert.equal(hit?.file, "controllers/session_controller.ts");
  assert.equal(typeof hit?.line, "number");
  assert.match(hit?.message ?? "", /SessionService/);
});

// ------------------------------------------------- required-call (when_touching)

test("required-call when_touching: clean deletion handler has no ARCH-DELETION-SEAM violation", () => {
  const repo = makeCleanArchRepo();
  const result = runArchCheck(repo);
  assert.deepEqual(
    result.violations.filter((v) => v.rule === "ARCH-DELETION-SEAM"),
    []
  );
});

test("required-call when_touching: bypassing AccountService.delete for AccountRepository.updateStatus is flagged", () => {
  const repo = makeCleanArchRepo();
  copyFile(snippet("required-call-violation"), path.join(repo, "account", "deletion", "handler.ts"));
  const result = runArchCheck(repo);
  const hits = result.violations.filter((v) => v.rule === "ARCH-DELETION-SEAM");
  // Both branches of the rule should fire: missing require_any (no call
  // to AccountService.delete anywhere in the touched set) and a forbidden
  // symbol present (AccountRepository.updateStatus).
  assert.equal(hits.length, 2, "expected both the missing-require_any and the forbid violation");
  assert.ok(hits.every((h) => h.file === "account/deletion/handler.ts"));
});

// --------------------------------------------------- required-call (when_calling)

test("required-call when_calling: clean AccountService.delete calling SessionService.revokeAll has no ARCH-REVOKE-SEAM violation", () => {
  const repo = makeCleanArchRepo();
  const result = runArchCheck(repo);
  assert.deepEqual(
    result.violations.filter((v) => v.rule === "ARCH-REVOKE-SEAM"),
    []
  );
});

test("required-call when_calling: AccountService.delete without SessionService.revokeAll is flagged", () => {
  const repo = makeCleanArchRepo();
  copyFile(snippet("when-calling-violation"), path.join(repo, "services", "account", "AccountService.ts"));
  const result = runArchCheck(repo);
  const hit = result.violations.find((v) => v.rule === "ARCH-REVOKE-SEAM");
  assert.ok(hit, "expected ARCH-REVOKE-SEAM violation");
  // Grep-grade (spec §10.3): the violation is reported at a call site of
  // "AccountService.delete" (the literal text the rule matches on), not at
  // the method's own definition — a plain-text scan cannot identify a
  // method's defining class without AST-level parsing. account/deletion/
  // sorts before controllers/ alphabetically (deterministic scan order).
  assert.equal(hit?.file, "account/deletion/handler.ts");
});

// -------------------------------------------------------------------- ownership

function makeScratchGitArchRepo(): string {
  const repo = makeTempRepo();
  git(repo, ["init", "--quiet"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test"]);
  copyDir(path.join(FIXTURES, "repo"), repo);
  copyFile(path.join(FIXTURES, "architecture.yaml"), P.architecturePolicyFile(repo));
  git(repo, ["add", "."]);
  git(repo, ["commit", "--quiet", "-m", "initial commit"]);
  return repo;
}

test("ownership: whole-tree mode never flags ownership (no notion of 'changed')", () => {
  const repo = makeCleanArchRepo();
  const result = runArchCheck(repo);
  assert.deepEqual(
    result.violations.filter((v) => v.rule === "ARCH-ACCOUNT-OWNERSHIP"),
    []
  );
});

test("ownership diff-mode: an unauthorized change under services/account/** is flagged needs-design-authority-approval", () => {
  const repo = makeScratchGitArchRepo();
  fs.writeFileSync(path.join(repo, "services", "account", "AccountService.ts"), "export class AccountService {\n  static delete(_id: string) {}\n}\n", "utf8");

  const result = runArchCheck(repo, { diff: "HEAD" });
  assert.equal(result.mode, "diff");
  const hit = result.violations.find((v) => v.rule === "ARCH-ACCOUNT-OWNERSHIP");
  assert.ok(hit, "expected ARCH-ACCOUNT-OWNERSHIP violation");
  assert.match(hit?.message ?? "", /needs-design-authority-approval/);
});

test("ownership diff-mode: also touching the architecture.yaml manifest authorizes the change", () => {
  const repo = makeScratchGitArchRepo();
  fs.writeFileSync(path.join(repo, "services", "account", "AccountService.ts"), "export class AccountService {\n  static delete(_id: string) {}\n}\n", "utf8");
  fs.appendFileSync(P.architecturePolicyFile(repo), "\n# manifest updated alongside the ownership change\n", "utf8");

  const result = runArchCheck(repo, { diff: "HEAD" });
  assert.deepEqual(
    result.violations.filter((v) => v.rule === "ARCH-ACCOUNT-OWNERSHIP"),
    []
  );
});

// -------------------------------------------------------------- diff-mode scope

test("diff-mode only scans touched files: an untouched pre-existing violation is not reported, a touched one is", () => {
  const repo = makeScratchGitArchRepo();
  // Pre-existing violation, committed, never touched by the diff under test.
  copyFile(snippet("forbidden-dependency-violation"), path.join(repo, "controllers", "session_controller.ts"));
  git(repo, ["add", "."]);
  git(repo, ["commit", "--quiet", "-m", "pre-existing violation"]);

  // Confirm whole-tree scan WOULD catch it.
  const wholeTree = runArchCheck(repo);
  assert.ok(wholeTree.violations.some((v) => v.rule === "ARCH-SESSION-PERSISTENCE"));

  // Touch an unrelated, already-tracked file only (an untracked file would
  // not show up in `git diff` at all, which would make this assertion
  // trivially true rather than exercising diff-mode scoping).
  fs.appendFileSync(path.join(repo, "persistence", "session", "store.ts"), "// unrelated change\n", "utf8");

  const diffResult = runArchCheck(repo, { diff: "HEAD" });
  assert.deepEqual(diffResult.filesScanned, 1, "diff mode must scan exactly the one touched file");
  assert.deepEqual(
    diffResult.violations.filter((v) => v.rule === "ARCH-SESSION-PERSISTENCE"),
    [],
    "diff mode must not flag an untouched file"
  );
});

test("--diff falls back to whole-tree scan on a non-git repo, with a note", () => {
  const repo = makeCleanArchRepo(); // never git-init'd
  copyFile(snippet("forbidden-dependency-violation"), path.join(repo, "controllers", "session_controller.ts"));
  const result = runArchCheck(repo, { diff: "HEAD" });
  assert.equal(result.mode, "whole-tree");
  assert.ok(result.notes.some((n) => /not a git repository/.test(n)));
  assert.ok(result.violations.some((v) => v.rule === "ARCH-SESSION-PERSISTENCE"));
});

// ------------------------------------------------------------------- warn-level

// Fix 7: an invalid regex on a duplicate-domain-concept rule is surfaced in result.notes, not silently swallowed.

test("duplicate-domain-concept with an invalid regex pattern is reported as a note, rule not evaluated", () => {
  const repo = makeTempRepo();
  fs.mkdirSync(path.dirname(P.architecturePolicyFile(repo)), { recursive: true });
  fs.writeFileSync(
    P.architecturePolicyFile(repo),
    "invariants:\n  - id: ARCH-BAD-REGEX\n    rule: duplicate-domain-concept\n    pattern: \"(unclosed\"\n",
    "utf8"
  );
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "widget.ts"), "export class Widget {}\n", "utf8");

  const result = runArchCheck(repo);
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.warnings, []);
  assert.ok(
    result.notes.some((n) => n.includes("ARCH-BAD-REGEX") && n.includes("invalid pattern") && n.includes("rule not evaluated")),
    `expected an invalid-pattern note; got: ${JSON.stringify(result.notes)}`
  );
});

test("duplicate-domain-concept is warn-only: reported in warnings, never in violations", () => {
  const repo = makeCleanArchRepo();
  copyFile(snippet("duplicate-widget"), path.join(repo, "services", "widget", "RogueWidgetManager.ts"));
  const result = runArchCheck(repo);
  assert.deepEqual(
    result.violations.filter((v) => v.rule === "ARCH-DUP-WIDGET"),
    []
  );
  const warn = result.warnings.find((w) => w.rule === "ARCH-DUP-WIDGET");
  assert.ok(warn, "expected a warn-level ARCH-DUP-WIDGET finding");
  assert.equal(warn?.severity, "warn");
});

// --------------------------------------------------------------- gate wiring

const MISSION_ID = "MISSION-TEST-1";

function implTaskR1(id: string): Task {
  return {
    id,
    mission: MISSION_ID,
    workflow: { id: "happy-path", version: 1, step: "build" },
    type: "implementation",
    role: "worker",
    dependencies: [],
    risk: "R1", // required_review_lenses: [] -> checkEvidence('review') is trivially satisfied
    inputs: [],
    outputs: ["candidate-diff"],
    budget: { attempts: 3, dollars: 3 },
    payload: { areas: ["api"], design: { authority: "worker" }, acceptance: ["works"], verification: ["unit"] },
    status: "REVIEWING",
    lease: { owner: "agent-a", expires_at: new Date(Date.now() + 60_000).toISOString() },
    attempt: 0,
  };
}

test("gate --gate review --result pass is refused when the whole-tree architecture check has a violation", () => {
  const repo = initTempRepo();
  registerMission(repo, baseMission());
  const id = "MISSION-TEST-1-ARCH-1";
  ledger.writeTask(repo, MISSION_ID, implTaskR1(id));

  copyFile(path.join(FIXTURES, "architecture.yaml"), P.architecturePolicyFile(repo));
  copyFile(snippet("forbidden-dependency-violation"), path.join(repo, "controllers", "session_controller.ts"));
  fs.mkdirSync(path.join(repo, "persistence", "session"), { recursive: true });
  fs.writeFileSync(path.join(repo, "persistence", "session", "store.ts"), "export class SessionStore {}\n", "utf8");

  assert.throws(
    () => ledger.gateTask(repo, id, { gate: "review", result: "pass", actor: "agent-a" }, checkEvidence, archCheckProblemsForGate),
    ArchViolationsError
  );
  assert.equal(ledger.readTask(repo, id).status, "REVIEWING", "must not transition on a refused gate");
});

test("gate --gate review --result pass succeeds when the whole-tree architecture check is clean", () => {
  const repo = initTempRepo();
  registerMission(repo, baseMission());
  const id = "MISSION-TEST-1-ARCH-2";
  ledger.writeTask(repo, MISSION_ID, implTaskR1(id));
  // No architecture.yaml installed -> clean pass, archCheckProblemsForGate returns [].

  const updated = ledger.gateTask(repo, id, { gate: "review", result: "pass", actor: "agent-a" }, checkEvidence, archCheckProblemsForGate);
  assert.equal(updated.status, "MERGE_READY");
});

test("gate --gate review --result pass ignores a warn-level (duplicate-domain-concept) finding: non-blocking", () => {
  const repo = initTempRepo();
  registerMission(repo, baseMission());
  const id = "MISSION-TEST-1-ARCH-3";
  ledger.writeTask(repo, MISSION_ID, implTaskR1(id));

  copyFile(path.join(FIXTURES, "architecture.yaml"), P.architecturePolicyFile(repo));
  copyFile(snippet("duplicate-widget"), path.join(repo, "services", "widget", "RogueWidgetManager.ts"));

  const updated = ledger.gateTask(repo, id, { gate: "review", result: "pass", actor: "agent-a" }, checkEvidence, archCheckProblemsForGate);
  assert.equal(updated.status, "MERGE_READY", "a warn-level-only finding must not block the gate");
});

test("gate --gate verification is never subject to the architecture check (only review is)", () => {
  const repo = initTempRepo();
  registerMission(repo, baseMission());
  const id = "MISSION-TEST-1-ARCH-4";
  const task = { ...implTaskR1(id), status: "VERIFYING" as const };
  ledger.writeTask(repo, MISSION_ID, task);

  copyFile(path.join(FIXTURES, "architecture.yaml"), P.architecturePolicyFile(repo));
  copyFile(snippet("forbidden-dependency-violation"), path.join(repo, "controllers", "session_controller.ts"));

  // No verification/result.json at all -> refused, but for evidence reasons, not architecture.
  assert.throws(
    () => ledger.gateTask(repo, id, { gate: "verification", result: "pass", actor: "agent-a" }, checkEvidence, archCheckProblemsForGate),
    EvidenceIncompleteError
  );
});
