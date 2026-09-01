// Memory architecture (docs/memory.md, Wave D). Implements the memory
// ladder's Layer 1->2->3 materialization and tier-gated approval, plus
// claim-time recall and validate/status freshness reporting.
//
// File format: every proposal, standalone discovery/incident file, and
// block appended inside a topic file shares one shape (docs/memory.md §2):
// a `---`-delimited YAML frontmatter (schemas/memory-entry.schema.json)
// followed by a markdown body (`## <claim>` heading + prose). Topic files
// may carry a plain-markdown preamble (a title, an explanatory comment)
// before the first `---`, and multiple entry blocks concatenated after it
// — parseMemoryFileWithPreamble/serializeBlock are the read/write pair for
// that shape everywhere it appears.
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import * as P from "./paths";
import { ensureDir, readFileIfExists, readJsonIfExists, writeFileAtomic, writeJsonAtomic } from "./fsutil";
import { collectProblems, validateOrThrow } from "./validate";

export type MemoryTier = "A" | "B" | "C";
export type MemoryStatus = "pending" | "active" | "needs-reverification" | "rejected" | "expired";

export interface MemoryFrontmatter {
  id: string;
  tier: MemoryTier;
  areas: string[];
  owner: string;
  proposed_by: string;
  approved_by: string | null;
  verified: string;
  staleness_bound_days: number;
  refs: string[];
  superseded_by: string | null;
  status: MemoryStatus;
  source_task: string;
  reason?: string | null;
}

export interface MemoryBlock {
  frontmatter: MemoryFrontmatter;
  body: string;
}

// Tier-differentiated staleness defaults and default owning role (docs/memory.md §2, §3).
export const TIER_STALENESS_DEFAULT_DAYS: Record<MemoryTier, number> = { A: 60, B: 90, C: 180 };
export const TIER_DEFAULT_OWNER: Record<MemoryTier, string> = {
  A: "verifier-fleet",
  B: "domain-authority",
  C: "design-authority",
};

// Tier authority table (spec §12.2, memory/README.md). --by is shape-checked
// free text, process discipline not cryptography (docs/memory.md §3, same
// trust model as `agent task gate`). Tier B deliberately also accepts
// 'verifier' alongside the domain/spec authority roles per this build's
// brief (see report: "tier gate ... B -> accept role strings
// verifier|domain-product-clarifier|specifier").
const TIER_APPROVERS: Record<MemoryTier, ReadonlySet<string>> = {
  A: new Set(["verifier"]),
  B: new Set(["verifier", "domain-product-clarifier", "specifier"]),
  C: new Set(["architect", "design-authority"]),
};

const TIER_LABEL: Record<MemoryTier, string> = {
  A: "operational facts",
  B: "domain knowledge",
  C: "architecture",
};

export class MemoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryError";
  }
}

export class MemoryTierGateError extends MemoryError {
  constructor(message: string) {
    super(message);
    this.name = "MemoryTierGateError";
  }
}

export class MemoryLockError extends MemoryError {
  constructor(repo: string) {
    super(
      `Memory directory is locked (${P.memoryLockDir(repo)} exists) — another approve/reject/expire is in ` +
        `progress. Retry shortly (docs/memory.md §3: fail fast and retry, matching the lease model's posture).`
    );
    this.name = "MemoryLockError";
  }
}

/** `--by <role>` refused for this tier: quotes the spec §12.2 rule verbatim, per this build's brief. */
export function assertTierAuthority(tier: MemoryTier, role: string, action: "approve" | "reject" | "expire"): void {
  const allowed = TIER_APPROVERS[tier];
  if (allowed.has(role)) return;
  throw new MemoryTierGateError(
    [
      `REFUSED: role '${role}' cannot ${action} a Tier ${tier} (${TIER_LABEL[tier]}) entry.`,
      `Tier ${tier} requires one of: ${[...allowed].join(", ")} (spec §12.2 authority table).`,
      `"A normal worker cannot establish architectural truth simply by writing memory. A worker proposing a ` +
        `Tier C entry is a signal to escalate to design authority (spec §5.2), not to write the file directly." ` +
        `(spec §12.2, templates/repo/.agent/memory/README.md)`,
    ].join("\n")
  );
}

// -------------------------------------------------------------- utilities

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function relPath(repo: string, filePath: string): string {
  return path.relative(repo, filePath).split(path.sep).join("/");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstHeadingText(body: string): string {
  const firstLine = body.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  return firstLine.replace(/^#+\s*/, "").trim();
}

function listMdFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => path.join(dir, e.name))
    .sort();
}

/** Topic files are every .md directly under memory/ except index.md/README.md (docs/memory.md §1, memory/README.md "Structure"). */
function listTopicFiles(repo: string): string[] {
  const dir = P.memoryDir(repo);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== "index.md" && e.name !== "README.md")
    .map((e) => path.join(dir, e.name))
    .sort();
}

// ------------------------------------------------------- block parse/write

/**
 * Parses a memory file into its optional leading markdown preamble (title,
 * explanatory comment — anything before the first `---`) and its sequence
 * of `---\n<yaml>\n---\n<body>` entry blocks. One block for a proposal or a
 * standalone discovery/incident file; one-or-more for a topic file that has
 * accumulated entries over time.
 */
export function parseMemoryFileWithPreamble(content: string): { preamble: string; blocks: MemoryBlock[] } {
  const lines = content.split(/\r?\n/);
  let i = 0;
  const preambleLines: string[] = [];
  while (i < lines.length && lines[i]!.trim() !== "---") {
    preambleLines.push(lines[i]!);
    i++;
  }
  const blocks: MemoryBlock[] = [];
  while (i < lines.length) {
    while (i < lines.length && lines[i]!.trim() === "") i++;
    if (i >= lines.length) break;
    if (lines[i]!.trim() !== "---") {
      i++;
      continue;
    }
    i++; // consume opening ---
    const fmLines: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "---") {
      fmLines.push(lines[i]!);
      i++;
    }
    i++; // consume closing ---
    const bodyLines: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "---") {
      bodyLines.push(lines[i]!);
      i++;
    }
    const frontmatter = parseYaml(fmLines.join("\n")) as MemoryFrontmatter;
    blocks.push({ frontmatter, body: bodyLines.join("\n").trim() });
  }
  return { preamble: preambleLines.join("\n").trimEnd(), blocks };
}

export function parseMemoryBlocks(content: string): MemoryBlock[] {
  return parseMemoryFileWithPreamble(content).blocks;
}

const FRONTMATTER_KEY_ORDER: (keyof MemoryFrontmatter)[] = [
  "id",
  "tier",
  "areas",
  "owner",
  "proposed_by",
  "approved_by",
  "verified",
  "staleness_bound_days",
  "refs",
  "superseded_by",
  "status",
  "source_task",
  "reason",
];

export function serializeBlock(fm: MemoryFrontmatter, body: string): string {
  const ordered: Record<string, unknown> = {};
  for (const key of FRONTMATTER_KEY_ORDER) {
    if (key === "reason" && fm.reason === undefined) continue;
    ordered[key] = fm[key];
  }
  const fmText = stringifyYaml(ordered, { lineWidth: 0 }).trimEnd();
  return `---\n${fmText}\n---\n${body.trim()}\n`;
}

function topicFileHeader(area: string): string {
  const title = area
    .split("-")
    .filter((w) => w.length > 0)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
  return (
    `# ${title}\n\n` +
    `<!--\n` +
    `Entries below follow schemas/memory-entry.schema.json (docs/memory.md §2). Each\n` +
    `entry carries its own owner/verified/staleness_bound_days/refs — this file has\n` +
    `no single owner or staleness trigger; per-entry tier/authority applies\n` +
    `(memory/README.md). Landed via \`agent memory approve\` — do not hand-append\n` +
    `without following the entry format there.\n` +
    `-->`
  );
}

/** Appends one entry block to a topic file, creating it (with a header) if it doesn't exist yet. Returns true if the file was newly created. */
function appendBlockToTopicFile(filePath: string, area: string, fm: MemoryFrontmatter, body: string): boolean {
  const isNew = !fs.existsSync(filePath);
  const existing = isNew ? topicFileHeader(area) : readFileIfExists(filePath) ?? "";
  const blockText = serializeBlock(fm, body);
  const next = `${existing.trimEnd()}\n\n${blockText}`;
  writeFileAtomic(filePath, `${next.trimEnd()}\n`);
  return isNew;
}

// ------------------------------------------------------------------ lock

function withMemoryLock<T>(repo: string, fn: () => T): T {
  ensureDir(P.memoryDir(repo));
  const lockDir = P.memoryLockDir(repo);
  try {
    fs.mkdirSync(lockDir); // exclusive create: atomic on POSIX and NTFS, throws EEXIST if held
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new MemoryLockError(repo);
    throw e;
  }
  try {
    return fn();
  } finally {
    fs.rmdirSync(lockDir);
  }
}

// ---------------------------------------------------- index.md maintenance

function addIndexRow(repo: string, area: string, covers: string): void {
  const indexPath = P.memoryIndexFile(repo);
  if (!fs.existsSync(indexPath)) return; // no index.md scaffolded: silent no-op, matches the rest of this module's absence posture
  const content = readFileIfExists(indexPath) ?? "";
  const lines = content.split(/\r?\n/);
  const coversShort = covers.replace(/\|/g, "/").trim().slice(0, 80) || "—";
  const newRow = `| ${area}.md | ${coversShort} | active |`;
  const placeholderIdx = lines.findIndex((l) => l.trim() === "| _(none yet)_ | | |");
  if (placeholderIdx >= 0) {
    lines[placeholderIdx] = newRow;
  } else {
    const sepIdx = lines.findIndex((l) => /^\|\s*-{2,}\s*\|/.test(l.trim()));
    if (sepIdx >= 0) {
      let insertAt = sepIdx + 1;
      while (insertAt < lines.length && lines[insertAt]!.trim().startsWith("|")) insertAt++;
      lines.splice(insertAt, 0, newRow);
    } else {
      lines.push(newRow);
    }
  }
  writeFileAtomic(indexPath, `${lines.join("\n").trimEnd()}\n`);
}

function removeIndexRow(repo: string, area: string): void {
  const indexPath = P.memoryIndexFile(repo);
  if (!fs.existsSync(indexPath)) return;
  const content = readFileIfExists(indexPath) ?? "";
  const rowPattern = new RegExp(`^\\|\\s*${escapeRegExp(area)}\\.md\\s*\\|`);
  const lines = content.split(/\r?\n/).filter((l) => !rowPattern.test(l.trim()));
  const sepIdx = lines.findIndex((l) => /^\|\s*-{2,}\s*\|/.test(l.trim()));
  if (sepIdx >= 0) {
    const hasRow = sepIdx + 1 < lines.length && lines[sepIdx + 1]!.trim().startsWith("|");
    if (!hasRow) lines.splice(sepIdx + 1, 0, "| _(none yet)_ | | |");
  }
  writeFileAtomic(indexPath, `${lines.join("\n").trimEnd()}\n`);
}

// ------------------------------------------------ Layer 1 -> Layer 2 (propose)

interface RawCandidate {
  ts?: unknown;
  tier?: unknown;
  areas?: unknown;
  claim?: unknown;
  body?: unknown;
  refs?: unknown;
  proposed_by?: unknown;
}

function validateCandidateShape(raw: RawCandidate): string[] {
  const problems: string[] = [];
  if (typeof raw.ts !== "string" || raw.ts.length === 0) problems.push("missing/invalid 'ts'");
  if (raw.tier !== "A" && raw.tier !== "B" && raw.tier !== "C") problems.push("'tier' must be one of A, B, C");
  if (!Array.isArray(raw.areas) || raw.areas.length === 0 || !raw.areas.every((a) => typeof a === "string" && a.length > 0)) {
    problems.push("'areas' must be a non-empty array of strings");
  }
  if (typeof raw.claim !== "string" || raw.claim.trim().length === 0) problems.push("missing/invalid 'claim'");
  if (typeof raw.body !== "string") problems.push("'body' must be a string");
  if (!Array.isArray(raw.refs) || raw.refs.length === 0 || !raw.refs.every((r) => typeof r === "string" && r.length > 0)) {
    problems.push("'refs' must be a non-empty array of strings (docs/memory.md §2: 'no refs, no trust')");
  }
  if (typeof raw.proposed_by !== "string" || raw.proposed_by.length === 0) problems.push("missing/invalid 'proposed_by'");
  return problems;
}

export interface CandidateProblem {
  line: number;
  message: string;
}

export interface MaterializeResult {
  taskId: string;
  created: string[];
  problems: CandidateProblem[];
  totalLines: number;
  alreadyMaterialized: number;
}

/**
 * `agent memory propose <task-id>`: materializes every not-yet-processed
 * line of .agent/runs/<TASK-ID>/memory-candidates.jsonl into one proposal
 * file each. Idempotent (tracks a per-task processed-line marker, docs/
 * memory.md §3) and non-blocking: a malformed line is reported and
 * skipped, never thrown (this is also what `agent task submit` auto-fires,
 * and submit must never fail because of a bad memory candidate line).
 */
export function materializeProposals(repo: string, taskId: string): MaterializeResult {
  const candidatesFile = P.memoryCandidatesFile(repo, taskId);
  const created: string[] = [];
  const problems: CandidateProblem[] = [];
  if (!fs.existsSync(candidatesFile)) {
    return { taskId, created, problems, totalLines: 0, alreadyMaterialized: 0 };
  }

  const rawText = readFileIfExists(candidatesFile) ?? "";
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const markerFile = P.memoryMaterializedFile(repo, taskId);
  const marker = readJsonIfExists<{ materialized: number }>(markerFile);
  const already = marker?.materialized ?? 0;

  for (let i = already; i < lines.length; i++) {
    const lineNo = i + 1;
    let parsed: RawCandidate;
    try {
      parsed = JSON.parse(lines[i]!) as RawCandidate;
    } catch (e) {
      problems.push({ line: lineNo, message: `not valid JSON: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    const shapeProblems = validateCandidateShape(parsed);
    if (shapeProblems.length > 0) {
      problems.push({ line: lineNo, message: shapeProblems.join("; ") });
      continue;
    }
    const candidate = parsed as unknown as {
      ts: string;
      tier: MemoryTier;
      areas: string[];
      claim: string;
      body: string;
      refs: string[];
      proposed_by: string;
    };

    const nn = String(lineNo).padStart(2, "0");
    const area = candidate.areas[0]!;
    const areaSlug =
      area
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "AREA";
    const id = `MEM-${areaSlug}-${taskId.toUpperCase()}-${nn}`;
    const verified = !Number.isNaN(Date.parse(candidate.ts)) ? candidate.ts.slice(0, 10) : todayDate();

    const frontmatter: MemoryFrontmatter = {
      id,
      tier: candidate.tier,
      areas: candidate.areas,
      owner: TIER_DEFAULT_OWNER[candidate.tier],
      proposed_by: candidate.proposed_by,
      approved_by: null,
      verified,
      staleness_bound_days: TIER_STALENESS_DEFAULT_DAYS[candidate.tier],
      refs: candidate.refs,
      superseded_by: null,
      status: "pending",
      source_task: taskId,
    };

    const proposalId = `${taskId}-${nn}`;
    const proposalPath = P.memoryProposalFile(repo, proposalId);
    const body = `## ${candidate.claim}\n${candidate.body}`.trim();
    writeFileAtomic(proposalPath, serializeBlock(frontmatter, body));
    created.push(relPath(repo, proposalPath));
  }

  ensureDir(P.runDir(repo, taskId));
  writeJsonAtomic(markerFile, { materialized: lines.length });
  return { taskId, created, problems, totalLines: lines.length, alreadyMaterialized: already };
}

// ---------------------------------------------------------------- listing

export interface MemoryListItem {
  id: string;
  tier: MemoryTier;
  areas: string[];
  status: MemoryStatus;
  claim: string;
  source_task: string;
  file: string;
}

export function listMemoryItems(repo: string, statusFilter?: MemoryStatus): MemoryListItem[] {
  const items: MemoryListItem[] = [];
  const collect = (filePath: string) => {
    const { blocks } = parseMemoryFileWithPreamble(readFileIfExists(filePath) ?? "");
    for (const b of blocks) {
      items.push({
        id: b.frontmatter.id,
        tier: b.frontmatter.tier,
        areas: b.frontmatter.areas,
        status: b.frontmatter.status,
        claim: firstHeadingText(b.body),
        source_task: b.frontmatter.source_task,
        file: relPath(repo, filePath),
      });
    }
  };
  for (const f of listMdFiles(P.memoryProposalsDir(repo))) collect(f);
  for (const f of listMdFiles(P.memoryRejectedDir(repo))) collect(f);
  for (const f of listTopicFiles(repo)) collect(f);
  for (const f of listMdFiles(P.memoryDiscoveriesDir(repo))) collect(f);
  for (const f of listMdFiles(P.memoryIncidentsDir(repo))) collect(f);
  for (const f of listMdFiles(P.memoryExpiredDir(repo))) collect(f);
  const filtered = statusFilter ? items.filter((i) => i.status === statusFilter) : items;
  filtered.sort((a, b) => a.id.localeCompare(b.id));
  return filtered;
}

export interface MemoryShowResult {
  id: string;
  status: MemoryStatus;
  file: string;
  frontmatter: MemoryFrontmatter;
  body: string;
}

/** Accepts either a proposal/rejected filename stem (<TASK-ID>-<NN>) or a landed entry's frontmatter id (MEM-...). */
export function findMemoryItem(repo: string, id: string): MemoryShowResult | undefined {
  const tryFile = (filePath: string, matchId?: string): MemoryShowResult | undefined => {
    const content = readFileIfExists(filePath);
    if (content === undefined) return undefined;
    const { blocks } = parseMemoryFileWithPreamble(content);
    const block = matchId ? blocks.find((b) => b.frontmatter.id === matchId) : blocks[0];
    if (!block) return undefined;
    return { id: block.frontmatter.id, status: block.frontmatter.status, file: relPath(repo, filePath), frontmatter: block.frontmatter, body: block.body };
  };

  const direct = tryFile(P.memoryProposalFile(repo, id)) ?? tryFile(P.memoryRejectedFile(repo, id)) ?? tryFile(P.memoryExpiredFile(repo, id));
  if (direct) return direct;

  const allFiles = [
    ...listMdFiles(P.memoryProposalsDir(repo)),
    ...listMdFiles(P.memoryRejectedDir(repo)),
    ...listTopicFiles(repo),
    ...listMdFiles(P.memoryDiscoveriesDir(repo)),
    ...listMdFiles(P.memoryIncidentsDir(repo)),
    ...listMdFiles(P.memoryExpiredDir(repo)),
  ];
  for (const f of allFiles) {
    const found = tryFile(f, id);
    if (found) return found;
  }
  return undefined;
}

// --------------------------------------------------------- approve/reject/expire

export interface MemoryActionResult {
  id: string;
  status: MemoryStatus;
  file: string;
}

/**
 * Lands a pending proposal into its matching topic file (first area wins),
 * creating the topic file (+ an index.md row) if it's new, then deletes
 * the proposal (docs/memory.md §3). Topic-append is this build's one
 * consistent landing behavior — see report for the discoveries/ alternative
 * considered and why topic-append was chosen.
 */
export function approveProposal(repo: string, id: string, role: string): MemoryActionResult {
  const proposalPath = P.memoryProposalFile(repo, id);
  if (!fs.existsSync(proposalPath)) {
    throw new MemoryError(`No pending proposal '${id}' found at ${proposalPath}.`);
  }
  const { blocks } = parseMemoryFileWithPreamble(readFileIfExists(proposalPath) ?? "");
  const block = blocks[0];
  if (!block) throw new MemoryError(`Proposal '${id}' at ${proposalPath} has no parseable entry block.`);
  validateOrThrow("memory-entry", block.frontmatter, proposalPath);
  assertTierAuthority(block.frontmatter.tier, role, "approve");

  return withMemoryLock(repo, () => {
    const area = block.frontmatter.areas[0]!;
    const topicPath = P.memoryTopicFile(repo, area);
    const landed: MemoryFrontmatter = {
      ...block.frontmatter,
      approved_by: role,
      verified: todayDate(),
      status: "active",
    };
    const isNewTopic = appendBlockToTopicFile(topicPath, area, landed, block.body);
    if (isNewTopic) addIndexRow(repo, area, firstHeadingText(block.body) || landed.id);
    fs.unlinkSync(proposalPath);
    return { id: landed.id, status: "active", file: relPath(repo, topicPath) };
  });
}

/** Moves a pending proposal to proposals/rejected/ with the reason preserved in frontmatter — never silently deleted (docs/memory.md §3). */
export function rejectProposal(repo: string, id: string, role: string, reason: string): MemoryActionResult {
  const proposalPath = P.memoryProposalFile(repo, id);
  if (!fs.existsSync(proposalPath)) {
    throw new MemoryError(`No pending proposal '${id}' found at ${proposalPath}.`);
  }
  const { blocks } = parseMemoryFileWithPreamble(readFileIfExists(proposalPath) ?? "");
  const block = blocks[0];
  if (!block) throw new MemoryError(`Proposal '${id}' at ${proposalPath} has no parseable entry block.`);
  assertTierAuthority(block.frontmatter.tier, role, "reject");

  return withMemoryLock(repo, () => {
    const rejectedFm: MemoryFrontmatter = { ...block.frontmatter, status: "rejected", reason };
    const destPath = P.memoryRejectedFile(repo, id);
    ensureDir(path.dirname(destPath));
    writeFileAtomic(destPath, serializeBlock(rejectedFm, block.body));
    fs.unlinkSync(proposalPath);
    return { id, status: "rejected", file: relPath(repo, destPath) };
  });
}

interface ActiveLocation {
  filePath: string;
  kind: "topic" | "discoveries" | "incidents";
  area?: string;
  preamble: string;
  allBlocks: MemoryBlock[];
  block: MemoryBlock;
}

function findActiveEntryLocation(repo: string, id: string): ActiveLocation | undefined {
  const candidates: { filePath: string; kind: ActiveLocation["kind"]; area?: string }[] = [
    ...listTopicFiles(repo).map((f) => ({ filePath: f, kind: "topic" as const, area: path.basename(f, ".md") })),
    ...listMdFiles(P.memoryDiscoveriesDir(repo)).map((f) => ({ filePath: f, kind: "discoveries" as const })),
    ...listMdFiles(P.memoryIncidentsDir(repo)).map((f) => ({ filePath: f, kind: "incidents" as const })),
  ];
  for (const c of candidates) {
    const { preamble, blocks } = parseMemoryFileWithPreamble(readFileIfExists(c.filePath) ?? "");
    const block = blocks.find((b) => b.frontmatter.id === id);
    if (block) return { ...c, preamble, allBlocks: blocks, block };
  }
  return undefined;
}

/** Retires a landed entry to expired/, preserving superseded_by and adding the reason (docs/memory.md §3, spec §12.4 supersession over deletion). */
export function expireEntry(repo: string, id: string, role: string, reason: string): MemoryActionResult {
  const found = findActiveEntryLocation(repo, id);
  if (!found) throw new MemoryError(`No active memory entry '${id}' found under ${P.memoryDir(repo)}.`);
  assertTierAuthority(found.block.frontmatter.tier, role, "expire");

  return withMemoryLock(repo, () => {
    const expiredFm: MemoryFrontmatter = { ...found.block.frontmatter, status: "expired", reason };
    const destPath = P.memoryExpiredFile(repo, id);
    ensureDir(path.dirname(destPath));
    writeFileAtomic(destPath, serializeBlock(expiredFm, found.block.body));

    const remaining = found.allBlocks.filter((b) => b.frontmatter.id !== id);
    if (remaining.length === 0) {
      fs.unlinkSync(found.filePath);
      if (found.kind === "topic" && found.area) removeIndexRow(repo, found.area);
    } else {
      const rebuilt = `${found.preamble ? `${found.preamble.trimEnd()}\n\n` : ""}${remaining
        .map((b) => serializeBlock(b.frontmatter, b.body))
        .join("\n\n")}`;
      writeFileAtomic(found.filePath, `${rebuilt.trimEnd()}\n`);
    }
    return { id, status: "expired", file: relPath(repo, destPath) };
  });
}

// ------------------------------------------------------------------ recall

export interface MemoryRecall {
  index?: string;
  topics: string[];
  discoveries: string[];
  incidents: string[];
}

/**
 * `agent task claim`/`start` recall (docs/memory.md §3): index.md always
 * (when .agent/memory exists), plus topic/discoveries/incidents files
 * whose filename or any block's frontmatter `areas` intersects the task's
 * `payload.areas`. Pure filesystem + frontmatter matching, no embeddings.
 * Silent no-op (empty result) when .agent/memory is absent.
 */
export function recallForAreas(repo: string, areas: string[]): MemoryRecall {
  const result: MemoryRecall = { topics: [], discoveries: [], incidents: [] };
  const dir = P.memoryDir(repo);
  if (!fs.existsSync(dir)) return result;

  const indexPath = P.memoryIndexFile(repo);
  if (fs.existsSync(indexPath)) result.index = relPath(repo, indexPath);

  const areaSet = new Set(areas.map((a) => a.toLowerCase()));
  if (areaSet.size === 0) return result;

  const matches = (filePath: string, filenameArea?: string): boolean => {
    if (filenameArea && areaSet.has(filenameArea.toLowerCase())) return true;
    const { blocks } = parseMemoryFileWithPreamble(readFileIfExists(filePath) ?? "");
    return blocks.some((b) => (b.frontmatter.areas ?? []).some((a) => areaSet.has(String(a).toLowerCase())));
  };

  for (const f of listTopicFiles(repo)) {
    if (matches(f, path.basename(f, ".md"))) result.topics.push(relPath(repo, f));
  }
  for (const f of listMdFiles(P.memoryDiscoveriesDir(repo))) {
    if (matches(f)) result.discoveries.push(relPath(repo, f));
  }
  for (const f of listMdFiles(P.memoryIncidentsDir(repo))) {
    if (matches(f)) result.incidents.push(relPath(repo, f));
  }
  return result;
}

// -------------------------------------------------------------- freshness

export interface MemoryValidationItem {
  file: string;
  id: string;
  schemaProblems: string[];
  flagged?: true;
  flagReasons?: string[];
}

export interface MemoryValidationReport {
  items: MemoryValidationItem[];
}

/**
 * `agent validate` extension (docs/memory.md §3, spec §12.4): schema-checks
 * every proposal/active/rejected/expired entry block, and for `active`
 * blocks additionally checks refs resolution and verified-date staleness.
 * A flagged entry is mutated in place to `status: needs-reverification`
 * (never deleted) — this is the mechanical staleness trigger the design
 * doc requires, not merely a report.
 */
export function validateMemoryEntries(repo: string): MemoryValidationReport {
  const items: MemoryValidationItem[] = [];
  const now = Date.now();

  const collectFile = (filePath: string, checkFreshness: boolean) => {
    const content = readFileIfExists(filePath);
    if (content === undefined) return;
    const { preamble, blocks } = parseMemoryFileWithPreamble(content);
    let changed = false;
    for (const block of blocks) {
      const schemaProblems = collectProblems("memory-entry", block.frontmatter);
      const item: MemoryValidationItem = {
        file: relPath(repo, filePath),
        id: typeof block.frontmatter?.id === "string" ? block.frontmatter.id : "?",
        schemaProblems,
      };
      if (schemaProblems.length === 0 && checkFreshness && block.frontmatter.status === "active") {
        const reasons: string[] = [];
        for (const ref of block.frontmatter.refs) {
          const refFile = ref.split("#")[0] ?? "";
          if (refFile.length > 0 && !fs.existsSync(path.join(repo, refFile))) {
            reasons.push(`ref does not resolve: ${ref}`);
          }
        }
        const boundDays = block.frontmatter.staleness_bound_days ?? TIER_STALENESS_DEFAULT_DAYS[block.frontmatter.tier];
        const verifiedMs = Date.parse(block.frontmatter.verified);
        if (!Number.isNaN(verifiedMs)) {
          const ageDays = (now - verifiedMs) / 86_400_000;
          if (ageDays > boundDays) {
            reasons.push(`verified ${block.frontmatter.verified} exceeds the ${boundDays}-day bound for tier ${block.frontmatter.tier}`);
          }
        }
        if (reasons.length > 0) {
          item.flagged = true;
          item.flagReasons = reasons;
          block.frontmatter.status = "needs-reverification";
          changed = true;
        }
      }
      items.push(item);
    }
    if (changed) {
      const rebuilt = `${preamble ? `${preamble.trimEnd()}\n\n` : ""}${blocks.map((b) => serializeBlock(b.frontmatter, b.body)).join("\n\n")}`;
      writeFileAtomic(filePath, `${rebuilt.trimEnd()}\n`);
    }
  };

  for (const f of listTopicFiles(repo)) collectFile(f, true);
  for (const f of listMdFiles(P.memoryDiscoveriesDir(repo))) collectFile(f, true);
  for (const f of listMdFiles(P.memoryIncidentsDir(repo))) collectFile(f, true);
  for (const f of listMdFiles(P.memoryProposalsDir(repo))) collectFile(f, false);
  for (const f of listMdFiles(P.memoryRejectedDir(repo))) collectFile(f, false);
  for (const f of listMdFiles(P.memoryExpiredDir(repo))) collectFile(f, false);

  return { items };
}

// ---------------------------------------------------------------- status

export interface MemoryStatusSummary {
  tier_c_pending: { id: string; file: string; areas: string[]; source_task: string }[];
  needs_reverification: { id: string; file: string; areas: string[] }[];
}

/** `agent status` memory exceptions line (docs/memory.md §1 Layer 3, §3 Freshness): pending Tier-C proposals (escalations) and needs-reverification counts. */
export function memoryStatusSummary(repo: string): MemoryStatusSummary {
  const tierCPending: MemoryStatusSummary["tier_c_pending"] = [];
  for (const f of listMdFiles(P.memoryProposalsDir(repo))) {
    const { blocks } = parseMemoryFileWithPreamble(readFileIfExists(f) ?? "");
    for (const b of blocks) {
      if (b.frontmatter.tier === "C" && b.frontmatter.status === "pending") {
        tierCPending.push({ id: b.frontmatter.id, file: relPath(repo, f), areas: b.frontmatter.areas, source_task: b.frontmatter.source_task });
      }
    }
  }

  const needsReverification: MemoryStatusSummary["needs_reverification"] = [];
  const scanActive = (f: string) => {
    const { blocks } = parseMemoryFileWithPreamble(readFileIfExists(f) ?? "");
    for (const b of blocks) {
      if (b.frontmatter.status === "needs-reverification") {
        needsReverification.push({ id: b.frontmatter.id, file: relPath(repo, f), areas: b.frontmatter.areas });
      }
    }
  };
  for (const f of listTopicFiles(repo)) scanActive(f);
  for (const f of listMdFiles(P.memoryDiscoveriesDir(repo))) scanActive(f);
  for (const f of listMdFiles(P.memoryIncidentsDir(repo))) scanActive(f);

  return { tier_c_pending: tierCPending, needs_reverification: needsReverification };
}
