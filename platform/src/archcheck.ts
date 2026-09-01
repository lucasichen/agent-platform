// Layer 1 — deterministic architecture enforcement (spec §10.3). Reads a
// target repo's `.agent/policies/architecture.yaml` and mechanically
// checks the four invariant rule types shown in the spec's worked example
// (policies/architecture.example.yaml): forbidden-dependency, required-call
// (both shapes), and ownership. A fifth, weaker rule type —
// duplicate-domain-concept — is supported as report-only (spec §10.3:
// "these warn rather than block, and route to Layer 2").
//
// This is intentionally "grep-grade" (spec §10.3: "any -> grep-grade
// forbidden-API rules, custom AST checks"), not a full AST/type-checker
// per ecosystem (ArchUnit/eslint-plugin-boundaries/import-linter). Import
// extraction is regex-based per language family (JS/TS, Python, Java) and
// symbol usage is literal substring matching. This trades precision for
// zero new dependencies and applicability across any repo `agent` targets
// (DESIGN.md §6: "minimal deps").
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { Task } from "./types";
import * as P from "./paths";
import { readYamlIfExists } from "./fsutil";

// ------------------------------------------------------------ policy shapes

interface InvariantBase {
  id: string;
  message?: string;
}

interface ForbiddenDependencyInvariant extends InvariantBase {
  rule: "forbidden-dependency";
  from: string;
  to: string;
}

interface RequiredCallTouchingInvariant extends InvariantBase {
  rule: "required-call";
  when_touching: string;
  require_any?: string[];
  require?: string[];
  forbid?: string[];
}

interface RequiredCallCallingInvariant extends InvariantBase {
  rule: "required-call";
  when_calling: string;
  require: string[];
  forbid?: string[];
}

type RequiredCallInvariant = RequiredCallTouchingInvariant | RequiredCallCallingInvariant;

interface OwnershipInvariant extends InvariantBase {
  rule: "ownership";
  owner: string;
  paths: string[];
  /** Optional explicit manifest file (repo-relative) that must also be touched to authorize a cross-owner change. Defaults to the architecture.yaml policy file itself. */
  manifest?: string;
}

interface DuplicateConceptInvariant extends InvariantBase {
  rule: "duplicate-domain-concept";
  /** Regex (string form) applied against new/changed content; a match is a warn-level finding, never a block (spec §10.3). */
  pattern?: string;
  paths?: string;
}

type ArchInvariant =
  | ForbiddenDependencyInvariant
  | RequiredCallInvariant
  | OwnershipInvariant
  | DuplicateConceptInvariant;

interface ArchPolicy {
  invariants?: ArchInvariant[];
}

// ------------------------------------------------------------------ results

export interface ArchViolation {
  /** The invariant's `id` from architecture.yaml. */
  rule: string;
  message: string;
  file?: string;
  line?: number;
  severity: "block" | "warn";
}

export interface ArchCheckResult {
  policyFound: boolean;
  policyFile: string;
  mode: "diff" | "whole-tree";
  diffRef?: string;
  invariantsEvaluated: number;
  filesScanned: number;
  /** Block-level violations (exit 1). */
  violations: ArchViolation[];
  /** Warn-level findings (duplicate-domain-concept heuristics) — report-only, never exit 1 (spec §10.3). */
  warnings: ArchViolation[];
  notes: string[];
}

export interface ArchCheckOptions {
  /** git ref to diff against (`git diff --name-only <ref>`); omitted = whole-tree scan. */
  diff?: string;
}

// -------------------------------------------------------------- glob utility

/**
 * Minimal glob-to-RegExp: `**` matches zero or more path segments,
 * `*` matches within one segment, everything else is literal. No new
 * dependency (DESIGN.md §6 "minimal deps"); sufficient for the
 * from/to/when_touching/paths patterns shown in the spec's worked example.
 */
function globToRegExp(glob: string): RegExp {
  const g = glob.replace(/\\/g, "/");
  let re = "";
  let i = 0;
  while (i < g.length) {
    const c = g[i];
    if (c === "*" && g[i + 1] === "*") {
      i += 2;
      if (g[i] === "/") {
        re += "(?:.*/)?";
        i += 1;
      } else {
        re += ".*";
      }
    } else if (c === "*") {
      re += "[^/]*";
      i += 1;
    } else if (c === "?") {
      re += "[^/]";
      i += 1;
    } else {
      re += (c as string).replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }
  return new RegExp(`^${re}$`);
}

function globMatch(glob: string, relPath: string): boolean {
  return globToRegExp(glob).test(relPath);
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

// ---------------------------------------------------------------- git utils

function isGitRepoDir(repo: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: repo, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

function gitDiffNameOnly(repo: string, ref: string): string[] {
  const out = execFileSync("git", ["diff", "--name-only", ref], { cwd: repo, encoding: "utf8" });
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map(toPosix);
}

// ------------------------------------------------------------- file walking

const EXCLUDED_DIRS = new Set([".git", "node_modules", ".worktrees", "dist", "build", ".next", "coverage", ".agent"]);

/** Whole-tree file listing, repo-relative posix paths. `.agent/` is excluded — architecture invariants apply to source code, not the agent's own runtime state. */
function listAllFiles(repo: string): string[] {
  const out: string[] = [];
  const walk = (absDir: string, relDir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      const abs = path.join(absDir, entry.name);
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  };
  walk(repo, "");
  // Deterministic order: readdirSync's order is filesystem-dependent, and
  // "first matching file" is used as a violation's reported location for
  // rules with no more specific site (e.g. evalRequiredCallCalling).
  out.sort();
  return out;
}

// -------------------------------------------------------------- extraction

interface ImportRef {
  specifier: string;
  line: number;
}

function lineOf(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function extractJsImports(content: string): ImportRef[] {
  const refs: ImportRef[] = [];
  const patterns = [/\bfrom\s+["']([^"']+)["']/g, /\brequire\(\s*["']([^"']+)["']\s*\)/g, /\bimport\(\s*["']([^"']+)["']\s*\)/g, /^\s*import\s+["']([^"']+)["']/gm];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      refs.push({ specifier: m[1] as string, line: lineOf(content, m.index) });
    }
  }
  return refs;
}

function extractPyImports(content: string): ImportRef[] {
  const refs: ImportRef[] = [];
  const fromRe = /^\s*from\s+([\w.]+)\s+import\b/gm;
  const importRe = /^\s*import\s+([\w., ]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(content))) {
    refs.push({ specifier: m[1] as string, line: lineOf(content, m.index) });
  }
  while ((m = importRe.exec(content))) {
    const line = lineOf(content, m.index);
    for (const part of (m[1] as string).split(",")) {
      const mod = part.trim().split(/\s+as\s+/)[0]?.trim();
      if (mod) refs.push({ specifier: mod, line });
    }
  }
  return refs;
}

function extractJavaImports(content: string): ImportRef[] {
  const refs: ImportRef[] = [];
  const re = /^\s*import\s+(?:static\s+)?([\w.]+)\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    refs.push({ specifier: m[1] as string, line: lineOf(content, m.index) });
  }
  return refs;
}

const JS_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function extractImports(relFile: string, content: string): ImportRef[] {
  const ext = path.extname(relFile).toLowerCase();
  if (JS_EXTS.has(ext)) return extractJsImports(content);
  if (ext === ".py") return extractPyImports(content);
  if (ext === ".java") return extractJavaImports(content);
  return [];
}

/** Candidate repo-relative paths a given import specifier could resolve to, for matching against a `to` glob. Grep-grade (spec §10.3): resolves relative JS/TS specifiers against the importing file's directory; treats dotted Python/Java module paths as slash paths. */
function candidatePaths(fromFile: string, specifier: string): string[] {
  const candidates = new Set<string>();
  if (specifier.startsWith(".")) {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
    for (const suffix of ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"]) {
      candidates.add(resolved + suffix);
    }
  } else {
    candidates.add(specifier);
    if (specifier.includes(".")) {
      const asPath = specifier.split(".").join("/");
      candidates.add(asPath);
      const parts = specifier.split(".");
      if (parts.length > 1) candidates.add(parts.slice(0, -1).join("/"));
    }
  }
  return [...candidates];
}

// ------------------------------------------------------------------- engine

interface ScanContext {
  repo: string;
  /** Files this run is willing to flag violations in: touched set (diff mode) or whole tree. */
  scanSet: string[];
  /** Whole-tree file list, always — needed to resolve forbidden-dependency targets even in diff mode (the imported file need not itself be touched). */
  allFiles: string[];
  /** Diff mode only: every path git reports changed, including deletions (ownership needs this even when the file no longer exists). */
  diffAllPaths?: string[];
  mode: "diff" | "whole-tree";
  readContent: (relFile: string) => string | undefined;
}

function evalForbiddenDependency(inv: ForbiddenDependencyInvariant, ctx: ScanContext, out: ArchViolation[]): void {
  for (const file of ctx.scanSet) {
    if (!globMatch(inv.from, file)) continue;
    const content = ctx.readContent(file);
    if (content === undefined) continue;
    for (const ref of extractImports(file, content)) {
      const candidates = candidatePaths(file, ref.specifier);
      if (candidates.some((c) => globMatch(inv.to, c))) {
        out.push({
          rule: inv.id,
          message: (inv.message ?? `forbidden dependency: ${inv.from} -> ${inv.to}`).trim(),
          file,
          line: ref.line,
          severity: "block",
        });
      }
    }
  }
}

function firstLineOf(content: string, needle: string): number | undefined {
  const idx = content.indexOf(needle);
  if (idx < 0) return undefined;
  return lineOf(content, idx);
}

function evalRequiredCallTouching(inv: RequiredCallTouchingInvariant, ctx: ScanContext, out: ArchViolation[]): void {
  const touched = ctx.scanSet.filter((f) => globMatch(inv.when_touching, f));
  if (touched.length === 0) return;

  const contents = touched.map((f) => ({ file: f, content: ctx.readContent(f) })).filter((x): x is { file: string; content: string } => x.content !== undefined);

  const requireAny = inv.require_any ?? [];
  if (requireAny.length > 0) {
    const found = contents.some(({ content }) => requireAny.some((sym) => content.includes(sym)));
    if (!found) {
      out.push({
        rule: inv.id,
        message: (inv.message ?? `required-call: touching ${inv.when_touching} requires one of ${requireAny.join(", ")}`).trim(),
        file: touched[0],
        severity: "block",
      });
    }
  }

  for (const forbidden of inv.forbid ?? []) {
    for (const { file, content } of contents) {
      if (content.includes(forbidden)) {
        out.push({
          rule: inv.id,
          message: (inv.message ?? `required-call: ${forbidden} is forbidden when touching ${inv.when_touching}`).trim(),
          file,
          line: firstLineOf(content, forbidden),
          severity: "block",
        });
      }
    }
  }
}

function evalRequiredCallCalling(inv: RequiredCallCallingInvariant, ctx: ScanContext, out: ArchViolation[]): void {
  const withContent = ctx.scanSet.map((f) => ({ file: f, content: ctx.readContent(f) })).filter((x): x is { file: string; content: string } => x.content !== undefined);
  const callers = withContent.filter(({ content }) => content.includes(inv.when_calling));
  if (callers.length === 0) return;

  const scanSetHasSymbol = (sym: string) => withContent.some(({ content }) => content.includes(sym));

  for (const missing of inv.require.filter((sym) => !scanSetHasSymbol(sym))) {
    const caller = callers[0] as { file: string; content: string };
    out.push({
      rule: inv.id,
      message: (inv.message ?? `required-call: calling ${inv.when_calling} requires ${missing} in the touched set`).trim(),
      file: caller.file,
      line: firstLineOf(caller.content, inv.when_calling),
      severity: "block",
    });
  }

  for (const forbidden of inv.forbid ?? []) {
    for (const { file, content } of callers) {
      if (content.includes(forbidden)) {
        out.push({ rule: inv.id, message: (inv.message ?? `required-call: ${forbidden} forbidden alongside ${inv.when_calling}`).trim(), file, line: firstLineOf(content, forbidden), severity: "block" });
      }
    }
  }
}

function evalOwnership(inv: OwnershipInvariant, ctx: ScanContext, out: ArchViolation[]): void {
  // Ownership is inherently diff-relative ("a change crosses an ownership
  // line", spec §10.3) — there is no meaningful violation in a whole-tree
  // scan where nothing is known to have "changed". Skipped there; see
  // runArchCheck's mode selection.
  if (ctx.mode !== "diff") return;
  const changed = ctx.diffAllPaths ?? [];
  const offending = changed.filter((f) => inv.paths.some((glob) => globMatch(glob, f)));
  if (offending.length === 0) return;

  const manifestRel = toPosix(path.relative(ctx.repo, P.architecturePolicyFile(ctx.repo)));
  const manifestPath = inv.manifest ? toPosix(inv.manifest) : manifestRel;
  const manifestTouched = changed.includes(manifestPath);
  if (manifestTouched) return;

  for (const file of offending) {
    out.push({
      rule: inv.id,
      message: `${(inv.message ?? `${inv.owner} owns this path`).trim()} (needs-design-authority-approval: ${manifestPath} not updated in this change)`,
      file,
      severity: "block",
    });
  }
}

function evalDuplicateConcept(inv: DuplicateConceptInvariant, ctx: ScanContext, out: ArchViolation[], notes: string[]): void {
  if (!inv.pattern) return;
  let re: RegExp;
  try {
    re = new RegExp(inv.pattern);
  } catch (e) {
    notes.push(`invariant '${inv.id}': invalid pattern, rule not evaluated: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  const files = inv.paths ? ctx.scanSet.filter((f) => globMatch(inv.paths as string, f)) : ctx.scanSet;
  for (const file of files) {
    const content = ctx.readContent(file);
    if (content === undefined) continue;
    const m = re.exec(content);
    if (m) {
      out.push({
        rule: inv.id,
        message: (inv.message ?? `possible duplicate domain concept matching /${inv.pattern}/`).trim(),
        file,
        line: lineOf(content, m.index),
        severity: "warn",
      });
    }
  }
}

// -------------------------------------------------------------------- entry

export function runArchCheck(repo: string, opts: ArchCheckOptions = {}): ArchCheckResult {
  const policyFile = P.architecturePolicyFile(repo);
  const mode: "diff" | "whole-tree" = opts.diff ? "diff" : "whole-tree";
  const notes: string[] = [];

  if (!fs.existsSync(policyFile)) {
    return {
      policyFound: false,
      policyFile,
      mode,
      diffRef: opts.diff,
      invariantsEvaluated: 0,
      filesScanned: 0,
      violations: [],
      warnings: [],
      notes: [`No architecture policy found at ${policyFile}; clean pass (spec §10.3: an absent policy has nothing to enforce).`],
    };
  }

  const policy = readYamlIfExists<ArchPolicy>(policyFile) ?? {};
  const invariants = policy.invariants ?? [];

  let effectiveMode: "diff" | "whole-tree" = "whole-tree";
  let diffAllPaths: string[] | undefined;
  let diffExisting: string[] | undefined;

  if (opts.diff) {
    if (!isGitRepoDir(repo)) {
      notes.push(`--diff requested but '${repo}' is not a git repository; whole-tree scan used instead.`);
    } else {
      diffAllPaths = gitDiffNameOnly(repo, opts.diff);
      diffExisting = diffAllPaths.filter((f) => fs.existsSync(path.join(repo, f)));
      effectiveMode = "diff";
    }
  }

  const allFiles = listAllFiles(repo);
  const scanSet = effectiveMode === "diff" ? (diffExisting ?? []) : allFiles;

  const contentCache = new Map<string, string | undefined>();
  const readContent = (relFile: string): string | undefined => {
    if (contentCache.has(relFile)) return contentCache.get(relFile);
    let content: string | undefined;
    try {
      content = fs.readFileSync(path.join(repo, relFile), "utf8");
    } catch {
      content = undefined;
    }
    contentCache.set(relFile, content);
    return content;
  };

  const ctx: ScanContext = { repo, scanSet, allFiles, diffAllPaths, mode: effectiveMode, readContent };

  const violations: ArchViolation[] = [];
  const warnings: ArchViolation[] = [];

  for (const inv of invariants) {
    switch (inv.rule) {
      case "forbidden-dependency":
        evalForbiddenDependency(inv, ctx, violations);
        break;
      case "required-call":
        if ("when_touching" in inv) evalRequiredCallTouching(inv, ctx, violations);
        else evalRequiredCallCalling(inv, ctx, violations);
        break;
      case "ownership":
        evalOwnership(inv, ctx, violations);
        break;
      case "duplicate-domain-concept":
        evalDuplicateConcept(inv, ctx, warnings, notes);
        break;
      default:
        notes.push(`Unknown rule type on invariant '${(inv as InvariantBase).id}'; skipped.`);
    }
  }

  return {
    policyFound: true,
    policyFile,
    mode: effectiveMode,
    diffRef: opts.diff,
    invariantsEvaluated: invariants.length,
    filesScanned: scanSet.length,
    violations,
    warnings,
    notes,
  };
}

export function formatArchViolation(v: ArchViolation): string {
  const loc = v.file ? ` (${v.file}${v.line ? `:${v.line}` : ""})` : "";
  return `[${v.rule}] ${v.message}${loc}`;
}

export function formatArchViolations(violations: ArchViolation[]): string[] {
  return violations.map(formatArchViolation);
}

/**
 * Gate-facing entry point used by `agent task gate --gate review --result
 * pass` (ledger.gateTask's injected checkArch). Always whole-tree: the
 * task ledger does not record the base ref a task branched from, so there
 * is no reliable ref to diff against here — running the deterministic
 * whole-tree scan is the simplest correct behavior available without that
 * missing piece of state (see AGENTS report / archcheck design notes).
 * `agent arch check --diff <ref>` remains available for fast, cheap,
 * worker-local diff-mode feedback during the task itself.
 */
export function archCheckProblemsForGate(repo: string, _task: Task): string[] {
  const result = runArchCheck(repo, {});
  return result.violations.map(formatArchViolation);
}
