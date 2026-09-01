import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Task } from "../src/types";
import { initTempRepo } from "./testutil";
import * as ledger from "../src/ledger";
import * as P from "../src/paths";
import { ensureDir, writeFileAtomic, writeYamlAtomic, readFileIfExists } from "../src/fsutil";
import * as memory from "../src/memory";
import { main } from "../src/cli";
import { buildStatusReport, renderStatusText } from "../src/status";

const MISSION_ID = "MISSION-TEST-1";

function registerMinimalMission(repo: string): void {
  ensureDir(P.missionArtifactsDir(repo, MISSION_ID));
  ensureDir(P.missionTasksDir(repo, MISSION_ID));
  writeYamlAtomic(P.missionFile(repo, MISSION_ID), {
    id: MISSION_ID,
    type: "happy-path",
    workflow: { id: "happy-path", version: 1 },
    goal: "Exercise memory in tests.",
    parent_mission: null,
    inputs: [],
    outputs: [],
    constraints: {},
    budget: { dollars: 12 },
    human_gates: [],
    status: "DRAFT",
  });
}

function taskWithAreas(id: string, areas: string[], overrides: Partial<Task> = {}): Task {
  return {
    id,
    mission: MISSION_ID,
    workflow: { id: "happy-path", version: 1, step: "build" },
    type: "research",
    role: "worker",
    dependencies: [],
    risk: "R1",
    inputs: [],
    outputs: [],
    budget: { attempts: 3, dollars: 3 },
    payload: { areas },
    status: "RUNNING",
    lease: { owner: "agent-a", expires_at: new Date(Date.now() + 60_000).toISOString() },
    attempt: 0,
    ...overrides,
  };
}

function candidateLine(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ts: "2026-08-01T00:00:00Z",
    tier: "A",
    areas: ["auth"],
    claim: "Login endpoint rate-limits after 5 failures",
    body: "The /login endpoint returns 429 after 5 failed attempts.",
    refs: ["package.json"], // a file that reliably exists at repo root in these fixtures
    proposed_by: "worker-07",
    ...overrides,
  };
}

function writeCandidates(repo: string, taskId: string, lines: (Record<string, unknown> | string)[]): void {
  ensureDir(P.runDir(repo, taskId));
  const text = lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n";
  writeFileAtomic(P.memoryCandidatesFile(repo, taskId), text);
}

/** Ensures package.json (used as a stable existing ref) is present at repo root for tests. */
function ensureRefFile(repo: string): void {
  writeFileAtomic(path.join(repo, "package.json"), "{}\n");
}

function runCli(args: string[]): void {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    main(["node", "agent", ...args]);
  } finally {
    process.exitCode = previousExitCode;
  }
}

// -------------------------------------------------- Layer 1 -> 2 materialization

test("task submit auto-materializes memory-candidates.jsonl into a pending proposal (never fails submit on a bad line)", () => {
  const repo = initTempRepo();
  registerMinimalMission(repo);
  ensureRefFile(repo);
  const id = "MEM-SUBMIT-1";
  ledger.writeTask(repo, MISSION_ID, taskWithAreas(id, ["auth"]));
  writeCandidates(repo, id, [candidateLine(), "not-json-garbage"]);

  runCli(["--repo", repo, "task", "submit", id]);

  assert.equal(ledger.readTask(repo, id).status, "GATING");
  const proposals = fs.readdirSync(P.memoryProposalsDir(repo)).filter((f) => f.endsWith(".md"));
  assert.deepEqual(proposals, [`${id}-01.md`]);
  assert.equal(process.exitCode === 1, false, "a malformed candidate line must never fail `task submit`");
});

test("agent memory propose is idempotent: a manual re-run skips already-materialized lines, reports malformed ones", () => {
  const repo = initTempRepo();
  ensureRefFile(repo);
  const id = "MEM-IDEMP-1";
  writeCandidates(repo, id, [candidateLine(), "{broken", candidateLine({ areas: ["billing"], claim: "second claim" })]);

  const first = memory.materializeProposals(repo, id);
  assert.equal(first.created.length, 2);
  assert.equal(first.problems.length, 1);
  assert.equal(first.problems[0]!.line, 2);
  assert.equal(first.alreadyMaterialized, 0);

  const second = memory.materializeProposals(repo, id);
  assert.deepEqual(second.created, []);
  assert.deepEqual(second.problems, []);
  assert.equal(second.alreadyMaterialized, 3);

  // Appending a genuinely new line after a manual re-run picks up only the new one.
  writeCandidates(repo, id, [
    candidateLine(),
    "{broken",
    candidateLine({ areas: ["billing"], claim: "second claim" }),
    candidateLine({ areas: ["billing"], claim: "third claim" }),
  ]);
  const third = memory.materializeProposals(repo, id);
  assert.equal(third.created.length, 1);
  assert.match(third.created[0]!, /-04\.md$/);
});

test("a candidate with empty refs is reported as malformed, never materialized ('no refs, no trust')", () => {
  const repo = initTempRepo();
  const id = "MEM-NOREFS-1";
  writeCandidates(repo, id, [candidateLine({ refs: [] })]);
  const result = memory.materializeProposals(repo, id);
  assert.deepEqual(result.created, []);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0]!.message, /refs/);
});

// -------------------------------------------------------------- approve/reject

test("approve refuses a role outside the tier's authority, quoting the spec §12.2 rule", () => {
  const repo = initTempRepo();
  ensureRefFile(repo);
  const id = "MEM-GATE-1";
  writeCandidates(repo, id, [candidateLine({ tier: "C", areas: ["architecture"], claim: "New event bus abstraction" })]);
  memory.materializeProposals(repo, id);

  assert.throws(
    () => memory.approveProposal(repo, `${id}-01`, "worker"),
    (e: unknown) => {
      assert.ok(e instanceof memory.MemoryTierGateError);
      assert.match((e as Error).message, /cannot establish architectural truth simply by writing memory/);
      return true;
    }
  );
  // still pending: refusal must not have mutated the proposal
  assert.equal(fs.existsSync(P.memoryProposalFile(repo, `${id}-01`)), true);
});

test("approve lands the entry into its topic file, creates an index.md row for a new topic, and deletes the proposal", () => {
  const repo = initTempRepo();
  ensureRefFile(repo);
  const id = "MEM-LAND-1";
  writeCandidates(repo, id, [candidateLine({ areas: ["auth", "api"] })]);
  memory.materializeProposals(repo, id);
  const proposalId = `${id}-01`;

  const result = memory.approveProposal(repo, proposalId, "verifier");
  assert.equal(result.status, "active");
  assert.equal(fs.existsSync(P.memoryProposalFile(repo, proposalId)), false, "proposal must be deleted after landing");

  const topicPath = P.memoryTopicFile(repo, "auth");
  assert.equal(fs.existsSync(topicPath), true);
  const { blocks } = memory.parseMemoryFileWithPreamble(readFileIfExists(topicPath) ?? "");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.frontmatter.status, "active");
  assert.equal(blocks[0]!.frontmatter.approved_by, "verifier");
  assert.deepEqual(blocks[0]!.frontmatter.areas, ["auth", "api"]);

  const indexText = readFileIfExists(P.memoryIndexFile(repo)) ?? "";
  assert.match(indexText, /\|\s*auth\.md\s*\|/);
  assert.doesNotMatch(indexText, /_\(none yet\)_/);

  // A second entry for the same area appends a second block, does not duplicate the index row.
  writeCandidates(repo, id, [candidateLine({ areas: ["auth", "api"] }), candidateLine({ areas: ["auth"], claim: "second auth fact" })]);
  memory.materializeProposals(repo, id);
  memory.approveProposal(repo, `${id}-02`, "verifier");
  const { blocks: blocks2 } = memory.parseMemoryFileWithPreamble(readFileIfExists(topicPath) ?? "");
  assert.equal(blocks2.length, 2);
  // index.md's own boilerplate prose illustratively mentions "auth.md" as an example
  // topic name, so match only real table rows (`| auth.md | ... |`), not that prose.
  const indexRows = (readFileIfExists(P.memoryIndexFile(repo)) ?? "").split("\n").filter((l) => /^\|\s*auth\.md\s*\|/.test(l.trim()));
  assert.equal(indexRows.length, 1, "index must not gain a duplicate row for an existing topic");
});

// Fix 3: Tier B authority is domain-product-clarifier/specifier only (spec §12.2) — verifier is a Tier A approver, not Tier B.

test("approve refuses 'verifier' for a Tier B entry (Tier B is domain-product-clarifier/specifier only)", () => {
  const repo = initTempRepo();
  ensureRefFile(repo);
  const id = "MEM-TIERB-1";
  writeCandidates(repo, id, [candidateLine({ tier: "B", areas: ["billing"] })]);
  memory.materializeProposals(repo, id);

  assert.throws(
    () => memory.approveProposal(repo, `${id}-01`, "verifier"),
    memory.MemoryTierGateError
  );
  const result = memory.approveProposal(repo, `${id}-01`, "domain-product-clarifier");
  assert.equal(result.status, "active");
});

// Fix 4: approve/reject accept either the proposal's filename stem or its frontmatter id (the id `memory list` displays).

test("approve accepts the frontmatter id (MEM-...) that `memory list` displays, not just the filename stem", () => {
  const repo = initTempRepo();
  ensureRefFile(repo);
  const id = "MEM-BYFMID-1";
  writeCandidates(repo, id, [candidateLine({ areas: ["auth"] })]);
  memory.materializeProposals(repo, id);
  const stem = `${id}-01`;

  const listed = memory.listMemoryItems(repo, "pending");
  const item = listed.find((i) => i.fileStem === stem);
  assert.ok(item, "expected a pending item with this fileStem");
  assert.notEqual(item!.id, stem, "frontmatter id must differ from the filename stem in this fixture");

  const result = memory.approveProposal(repo, item!.id, "verifier");
  assert.equal(result.status, "active");
  assert.equal(fs.existsSync(P.memoryProposalFile(repo, stem)), false, "proposal must be landed");
});

test("reject accepts the frontmatter id (MEM-...) too", () => {
  const repo = initTempRepo();
  ensureRefFile(repo);
  const id = "MEM-BYFMID-2";
  writeCandidates(repo, id, [candidateLine({ tier: "B", areas: ["billing"] })]);
  memory.materializeProposals(repo, id);
  const stem = `${id}-01`;
  const listed = memory.listMemoryItems(repo, "pending");
  const item = listed.find((i) => i.fileStem === stem)!;

  const result = memory.rejectProposal(repo, item.id, "specifier", "not durable enough");
  assert.equal(result.status, "rejected");
  assert.equal(fs.existsSync(P.memoryRejectedFile(repo, stem)), true);
});

test("reject moves a pending proposal to proposals/rejected/ with the reason preserved in frontmatter", () => {
  const repo = initTempRepo();
  ensureRefFile(repo);
  const id = "MEM-REJECT-1";
  writeCandidates(repo, id, [candidateLine({ tier: "B", areas: ["billing"] })]);
  memory.materializeProposals(repo, id);
  const proposalId = `${id}-01`;

  const result = memory.rejectProposal(repo, proposalId, "specifier", "insufficient evidence for this claim");
  assert.equal(result.status, "rejected");
  assert.equal(fs.existsSync(P.memoryProposalFile(repo, proposalId)), false);

  const rejectedPath = P.memoryRejectedFile(repo, proposalId);
  assert.equal(fs.existsSync(rejectedPath), true);
  const { blocks } = memory.parseMemoryFileWithPreamble(readFileIfExists(rejectedPath) ?? "");
  assert.equal(blocks[0]!.frontmatter.status, "rejected");
  assert.equal(blocks[0]!.frontmatter.reason, "insufficient evidence for this claim");
});

test("expire retires a landed entry to expired/, preserving superseded_by, and removes an emptied topic file + index row", () => {
  const repo = initTempRepo();
  ensureRefFile(repo);
  const id = "MEM-EXPIRE-1";
  writeCandidates(repo, id, [candidateLine({ areas: ["mobile"] })]);
  memory.materializeProposals(repo, id);
  const landed = memory.approveProposal(repo, `${id}-01`, "verifier");

  const result = memory.expireEntry(repo, landed.id, "verifier", "superseded by a newer entry");
  assert.equal(result.status, "expired");

  const expiredPath = P.memoryExpiredFile(repo, landed.id);
  assert.equal(fs.existsSync(expiredPath), true);
  const { blocks } = memory.parseMemoryFileWithPreamble(readFileIfExists(expiredPath) ?? "");
  assert.equal(blocks[0]!.frontmatter.status, "expired");
  assert.equal(blocks[0]!.frontmatter.superseded_by, null);
  assert.equal(blocks[0]!.frontmatter.reason, "superseded by a newer entry");

  assert.equal(fs.existsSync(P.memoryTopicFile(repo, "mobile")), false, "the now-empty topic file must be removed");
  // index.md's own boilerplate prose illustratively mentions "mobile.md" as an example
  // topic name, so check for a real table row specifically, not that prose.
  const indexLines = (readFileIfExists(P.memoryIndexFile(repo)) ?? "").split("\n");
  assert.ok(!indexLines.some((l) => /^\|\s*mobile\.md\s*\|/.test(l.trim())), "no table row for the removed topic must remain");
  assert.ok(indexLines.some((l) => l.trim() === "| _(none yet)_ | | |"), "the placeholder row must be restored once the table is empty");
});

test("approve/reject/expire fail fast when the memory lock directory is already held, and leave the proposal untouched", () => {
  const repo = initTempRepo();
  ensureRefFile(repo);
  const id = "MEM-LOCK-1";
  writeCandidates(repo, id, [candidateLine()]);
  memory.materializeProposals(repo, id);
  const proposalId = `${id}-01`;

  ensureDir(P.memoryDir(repo));
  fs.mkdirSync(P.memoryLockDir(repo));
  try {
    assert.throws(() => memory.approveProposal(repo, proposalId, "verifier"), memory.MemoryLockError);
  } finally {
    fs.rmdirSync(P.memoryLockDir(repo));
  }
  assert.equal(fs.existsSync(P.memoryProposalFile(repo, proposalId)), true, "contention must not have consumed the proposal");

  // Lock released: the same call now succeeds.
  const result = memory.approveProposal(repo, proposalId, "verifier");
  assert.equal(result.status, "active");
  assert.equal(fs.existsSync(P.memoryLockDir(repo)), false, "the lock must be released in finally");
});

// ------------------------------------------------------------------- recall

test("recallForAreas matches topic files by filename and by frontmatter areas, plus index.md always", () => {
  const repo = initTempRepo();
  ensureRefFile(repo);

  // auth.md matched by filename; a second topic matched only via frontmatter areas.
  writeCandidates(repo, "MEM-RECALL-A", [candidateLine({ areas: ["auth"] })]);
  memory.materializeProposals(repo, "MEM-RECALL-A");
  memory.approveProposal(repo, "MEM-RECALL-A-01", "verifier");

  writeCandidates(repo, "MEM-RECALL-B", [candidateLine({ areas: ["payments", "auth"], claim: "cross-cutting auth fact" })]);
  memory.materializeProposals(repo, "MEM-RECALL-B");
  memory.approveProposal(repo, "MEM-RECALL-B-01", "verifier");

  writeCandidates(repo, "MEM-RECALL-C", [candidateLine({ areas: ["unrelated-area"], claim: "irrelevant" })]);
  memory.materializeProposals(repo, "MEM-RECALL-C");
  memory.approveProposal(repo, "MEM-RECALL-C-01", "verifier");

  const recall = memory.recallForAreas(repo, ["auth"]);
  assert.equal(recall.index, ".agent/memory/index.md");
  assert.ok(recall.topics.includes(".agent/memory/auth.md"));
  assert.ok(recall.topics.includes(".agent/memory/payments.md"));
  assert.ok(!recall.topics.includes(".agent/memory/unrelated-area.md"));
});

test("recallForAreas is a silent no-op when .agent/memory is absent", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "agent-cli-noMem-"));
  const recall = memory.recallForAreas(repo, ["auth"]);
  assert.deepEqual(recall, { topics: [], discoveries: [], incidents: [] });
});

test("`agent task claim`/`start` --json output carries the memory recall under a 'memory' key", () => {
  const repo = initTempRepo();
  registerMinimalMission(repo);
  ensureRefFile(repo);
  const id = "MEM-CLAIM-1";
  ledger.writeTask(repo, MISSION_ID, taskWithAreas(id, ["auth"], { status: "READY", lease: null }));

  writeCandidates(repo, "MEM-CLAIM-SEED", [candidateLine({ areas: ["auth"] })]);
  memory.materializeProposals(repo, "MEM-CLAIM-SEED");
  memory.approveProposal(repo, "MEM-CLAIM-SEED-01", "verifier");

  const logs: string[] = [];
  const original = console.log;
  console.log = (...a: unknown[]) => logs.push(a.map(String).join(" "));
  try {
    runCli(["--repo", repo, "task", "claim", id, "--agent", "agent-x", "--json"]);
  } finally {
    console.log = original;
  }
  const out = JSON.parse(logs.join("\n")) as { memory?: memory.MemoryRecall };
  assert.ok(out.memory);
  assert.equal(out.memory!.index, ".agent/memory/index.md");
  assert.ok(out.memory!.topics.includes(".agent/memory/auth.md"));
});

// ---------------------------------------------------------------- validate

test("validate flags a stale (past staleness bound) active entry as needs-reverification, without deleting it", () => {
  const repo = initTempRepo();
  ensureRefFile(repo);
  const id = "MEM-STALE-1";
  writeCandidates(repo, id, [candidateLine({ areas: ["stale-topic"] })]);
  memory.materializeProposals(repo, id);
  const landed = memory.approveProposal(repo, `${id}-01`, "verifier");

  // Backdate `verified` well past the tier-A 60-day bound.
  const topicPath = P.memoryTopicFile(repo, "stale-topic");
  const { preamble, blocks } = memory.parseMemoryFileWithPreamble(readFileIfExists(topicPath) ?? "");
  blocks[0]!.frontmatter.verified = "2020-01-01";
  writeFileAtomic(topicPath, `${preamble}\n\n${memory.serializeBlock(blocks[0]!.frontmatter, blocks[0]!.body)}`);

  const report = memory.validateMemoryEntries(repo);
  const item = report.items.find((i) => i.id === landed.id);
  assert.ok(item);
  assert.equal(item!.flagged, true);
  assert.ok(item!.flagReasons!.some((r) => r.includes("60-day bound")));

  const { blocks: after } = memory.parseMemoryFileWithPreamble(readFileIfExists(topicPath) ?? "");
  assert.equal(after[0]!.frontmatter.status, "needs-reverification", "validate must mutate the file, not just report");
});

test("validate flags an active entry whose refs no longer resolve, and rejects a schema-invalid entry as FAIL", () => {
  const repo = initTempRepo();
  const refPath = path.join(repo, "will-be-deleted.txt");
  writeFileAtomic(refPath, "x");
  const id = "MEM-BROKENREF-1";
  writeCandidates(repo, id, [candidateLine({ areas: ["broken-ref-topic"], refs: ["will-be-deleted.txt"] })]);
  memory.materializeProposals(repo, id);
  memory.approveProposal(repo, `${id}-01`, "verifier");
  fs.unlinkSync(refPath);

  const report = memory.validateMemoryEntries(repo);
  const flagged = report.items.find((i) => i.file.endsWith("broken-ref-topic.md"));
  assert.ok(flagged);
  assert.equal(flagged!.flagged, true);
  assert.ok(flagged!.flagReasons!.some((r) => r.includes("does not resolve")));

  // A hand-corrupted proposal (missing required fields) fails schema validation.
  ensureDir(P.memoryProposalsDir(repo));
  writeFileAtomic(path.join(P.memoryProposalsDir(repo), "BAD-1.md"), "---\nid: MEM-BAD-1\ntier: A\n---\nbroken, missing required fields\n");
  const report2 = memory.validateMemoryEntries(repo);
  const bad = report2.items.find((i) => i.id === "MEM-BAD-1");
  assert.ok(bad);
  assert.ok(bad!.schemaProblems.length > 0);
});

// ------------------------------------------------------------------ status

test("status surfaces a pending Tier-C proposal as an escalation and counts needs-reverification entries", () => {
  const repo = initTempRepo();
  ensureRefFile(repo);

  const cId = "MEM-STATUSC-1";
  writeCandidates(repo, cId, [candidateLine({ tier: "C", areas: ["architecture"], claim: "proposed architectural change" })]);
  memory.materializeProposals(repo, cId);

  const staleId = "MEM-STATUSSTALE-1";
  writeCandidates(repo, staleId, [candidateLine({ areas: ["status-stale-topic"] })]);
  memory.materializeProposals(repo, staleId);
  const landed = memory.approveProposal(repo, `${staleId}-01`, "verifier");
  const topicPath = P.memoryTopicFile(repo, "status-stale-topic");
  const { preamble, blocks } = memory.parseMemoryFileWithPreamble(readFileIfExists(topicPath) ?? "");
  blocks[0]!.frontmatter.status = "needs-reverification";
  writeFileAtomic(topicPath, `${preamble}\n\n${memory.serializeBlock(blocks[0]!.frontmatter, blocks[0]!.body)}`);

  const summary = memory.memoryStatusSummary(repo);
  assert.equal(summary.tier_c_pending.length, 1);
  assert.equal(summary.tier_c_pending[0]!.id, `MEM-ARCHITECTURE-${cId}-01`);
  assert.equal(summary.needs_reverification.length, 1);
  assert.equal(summary.needs_reverification[0]!.id, landed.id);

  const report = buildStatusReport(repo);
  assert.equal(report.exceptions.memory_tier_c_pending.length, 1);
  assert.equal(report.exceptions.memory_needs_reverification.length, 1);
  const text = renderStatusText(report);
  assert.match(text, /memory-tier-c-escalation/);
  assert.match(text, /memory-needs-reverification/);
});
