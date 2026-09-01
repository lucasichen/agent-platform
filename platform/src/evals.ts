// Eval capture (spec §13.5, F.10). Turns an actual failure — a task's
// retrospective.json — into a reusable, schema-conformant regression case
// under .agent/evals/<category>/<ID>.yaml, so future agents (and future
// model/config changes) are checked against it before it can recur
// silently. F.10 "Produce a replayable eval case for every qualifying
// failure" — this module is that mechanism, `agent eval create` is its CLI
// surface.
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { EvalCase, Retrospective } from "./types";
import * as P from "./paths";
import { ensureDir, listDirs, listFiles, readJsonIfExists, readYaml, writeYamlAtomic } from "./fsutil";
import { validateOrThrow } from "./validate";
import * as ledger from "./ledger";

export class EvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalError";
  }
}

/**
 * category -> eval id prefix. The only prefix the spec pins directly is
 * ARCH (spec §13.5's ARCH-017 example, mirrored in
 * templates/repo/.agent/evals/README.md's directory list); the rest are
 * this module's own convention, chosen to read naturally next to it.
 * Categories outside this map (repos are told to "create only the
 * categories this repository needs") fall back to their own uppercased
 * name as the prefix.
 */
const CATEGORY_ID_PREFIX: Record<string, string> = {
  architecture: "ARCH",
  backend: "BACKEND",
  frontend: "FRONTEND",
  android: "ANDROID",
  ios: "IOS",
  debugging: "DEBUG",
  migrations: "MIGRATION",
};

function idPrefixForCategory(category: string): string {
  return CATEGORY_ID_PREFIX[category] ?? category.toUpperCase();
}

const CATEGORY_RE = /^[a-z][a-z0-9-]*$/;

function repoSnapshot(repo: string): { snapshot: string; warning?: string } {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }).trim();
    if (sha) return { snapshot: sha };
  } catch {
    // fall through
  }
  return {
    snapshot: "UNPINNED",
    warning: `Could not resolve a git commit SHA for '${repo}' (not a git repository, or no commits yet); repo_snapshot set to 'UNPINNED'. Pin it manually once the repo has a commit — an eval case that cannot replay against a known snapshot is a named F.10 failure mode.`,
  };
}

function nextEvalId(repo: string, category: string, prefix: string): string {
  const dir = P.evalCategoryDir(repo, category);
  let max = 0;
  if (fs.existsSync(dir)) {
    const re = new RegExp(`^${prefix}-(\\d+)\\.yaml$`);
    for (const name of listFiles(dir, ".yaml")) {
      const m = re.exec(name);
      if (m) max = Math.max(max, parseInt(m[1] as string, 10));
    }
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

export interface CreateEvalOptions {
  /** .agent/evals/<category>/ subdirectory and id-prefix source. Default: the retrospective's `cause`, lowercased (spec §13.5's own ARCH-017 example is exactly cause=ARCHITECTURE -> category "architecture"). */
  category?: string;
}

export interface CreateEvalResult {
  file: string;
  /** Repo-relative, e.g. ".agent/evals/architecture/ARCH-017.yaml" — the shape retrospective.schema.json's `eval_case` field expects. */
  relFile: string;
  evalCase: EvalCase;
  warning?: string;
}

/** `agent eval create --from-retro <task-id>` (spec §13.5, F.10 "Produce a replayable eval case for every qualifying failure"). */
export function createEvalFromRetro(repo: string, taskId: string, opts: CreateEvalOptions = {}): CreateEvalResult {
  const retroPath = P.retrospectiveFile(repo, taskId);
  const retro = readJsonIfExists<Retrospective>(retroPath);
  if (!retro) {
    throw new EvalError(`No retrospective found for '${taskId}' at ${retroPath}. Run 'agent retro create ${taskId} --trigger ...' first.`);
  }

  const task = ledger.readTask(repo, taskId);
  const mission = ledger.readMission(repo, task.mission);

  const category = (opts.category ?? retro.cause.toLowerCase()).trim();
  if (!CATEGORY_RE.test(category)) {
    throw new EvalError(`--category must be lowercase kebab-case (got '${category}').`);
  }
  const prefix = idPrefixForCategory(category);
  const id = nextEvalId(repo, category, prefix);

  const { snapshot, warning } = repoSnapshot(repo);

  const details = retro.candidate_interventions.map((c) => c.detail).join(" ");
  const known_failure = `[${retro.cause}] ${details || "(no intervention detail recorded on the retrospective)"}`;

  const payload = task.payload as Record<string, unknown> | undefined;
  const design = (payload?.design as { required_seams?: string[]; forbidden?: string[] } | undefined) ?? {};

  const evalCase: EvalCase = {
    id,
    repo_snapshot: snapshot,
    task: `${mission.goal.trim()} (task ${taskId})`,
    known_failure,
  };
  if (design.required_seams && design.required_seams.length > 0) evalCase.required = design.required_seams;
  if (design.forbidden && design.forbidden.length > 0) evalCase.forbidden = design.forbidden;

  const filePath = P.evalCaseFile(repo, category, id);
  validateOrThrow("eval-case", evalCase, filePath);
  ensureDir(P.evalCategoryDir(repo, category));
  writeYamlAtomic(filePath, evalCase);

  const relFile = path.relative(repo, filePath).split(path.sep).join("/");
  return { file: filePath, relFile, evalCase, warning };
}

export interface EvalListItem {
  id: string;
  category: string;
  file: string;
  repo_snapshot: string;
  task: string;
}

/** `agent eval list`. */
export function listEvalCases(repo: string): EvalListItem[] {
  const root = P.evalsDir(repo);
  if (!fs.existsSync(root)) return [];
  const items: EvalListItem[] = [];
  for (const category of listDirs(root)) {
    const dir = P.evalCategoryDir(repo, category);
    for (const name of listFiles(dir, ".yaml")) {
      const filePath = path.join(dir, name);
      const data = readYaml<EvalCase>(filePath);
      items.push({ id: data.id, category, file: filePath, repo_snapshot: data.repo_snapshot, task: data.task });
    }
  }
  items.sort((a, b) => a.id.localeCompare(b.id));
  return items;
}
