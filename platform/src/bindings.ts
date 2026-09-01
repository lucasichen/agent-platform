// policies/bindings.yaml resolution (docs/skills-design.md §4-5, spec
// Appendix G.1, docs/integrations.md §2/§5). This is the single module
// every consumer goes through: `agent skills install` (skills.ts), `agent
// task claim`/`start` (cli.ts, prints startup_skills + recommended
// skills), and `agent validate` (schema check + skill-path resolution,
// cli.ts). Bindings are optional policy: a target repo that never ran
// `agent init` (or deleted the file) simply gets no binding behavior,
// never an error (docs/skills-design.md §5 "no output, no error").
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { readYamlIfExists } from "./fsutil";
import { validateOrThrow } from "./validate";
import * as P from "./paths";
import { policiesDir as packagedPoliciesDir, skillsDir } from "./assets";

export type Harness = "generic" | "claude-code" | "cursor";
export const HARNESSES: readonly Harness[] = ["generic", "claude-code", "cursor"];

export interface BindingsRoleEntry {
  startup_skills?: string[];
  skills?: Partial<Record<Harness, string[]>>;
}

export interface BindingsPolicy {
  version: number;
  roles: Record<string, BindingsRoleEntry>;
  active_harness: Harness;
  install?: Partial<Record<"claude-code" | "cursor" | "generic", string>>;
}

export function bindingsFileIn(repo: string): string {
  return path.join(P.policiesDirIn(repo), "bindings.yaml");
}

function packagedBindingsFile(): string {
  return path.join(packagedPoliciesDir(), "bindings.yaml");
}

/**
 * Reads the target repo's installed bindings.yaml only — no packaged
 * fallback. Returns undefined when absent (bindings are optional policy;
 * callers must no-op silently, per docs/skills-design.md §5). Used by
 * `agent task claim`/`start`.
 */
export function readRepoBindings(repo: string): BindingsPolicy | undefined {
  const filePath = bindingsFileIn(repo);
  const data = readYamlIfExists<BindingsPolicy>(filePath);
  if (!data) return undefined;
  validateOrThrow("bindings-policy", data, filePath);
  return data;
}

/**
 * Reads the target repo's bindings.yaml, falling back to the packaged
 * platform default when the repo has none (e.g. `agent skills install`
 * run before `agent init`). Throws if neither exists.
 */
export function readBindingsWithFallback(repo: string): { data: BindingsPolicy; source: string } {
  const repoPath = bindingsFileIn(repo);
  const fromRepo = readYamlIfExists<BindingsPolicy>(repoPath);
  if (fromRepo) {
    validateOrThrow("bindings-policy", fromRepo, repoPath);
    return { data: fromRepo, source: repoPath };
  }
  const packagedPath = packagedBindingsFile();
  const fromPackaged = readYamlIfExists<BindingsPolicy>(packagedPath);
  if (fromPackaged) {
    validateOrThrow("bindings-policy", fromPackaged, packagedPath);
    return { data: fromPackaged, source: packagedPath };
  }
  throw new Error(`No bindings.yaml found (checked ${repoPath} and packaged default ${packagedPath}).`);
}

export function skillsForHarness(entry: BindingsRoleEntry | undefined, harness: Harness): string[] {
  return entry?.skills?.[harness] ?? [];
}

/**
 * Resolves a bindings.yaml skill path (repo-root-relative into the
 * platform's skills tree, e.g. 'skills/vendor/pstack/skills/architect') to
 * its SKILL.md, checking the target repo first (a repo may vendor/copy
 * skills directly), then the packaged skills tree (dist/assets/skills, or
 * ../skills in the monorepo). Returns undefined if neither resolves —
 * callers must warn per-item, never crash (packs may be absent).
 */
export function resolveSkillMdPath(repo: string, relPath: string): string | undefined {
  const inRepo = path.join(repo, relPath, "SKILL.md");
  if (fs.existsSync(inRepo)) return inRepo;
  const root = skillsDir();
  if (root) {
    const rel = relPath.replace(/^skills[\\/]/, "");
    const packaged = path.join(root, rel, "SKILL.md");
    if (fs.existsSync(packaged)) return packaged;
  }
  return undefined;
}

export interface SkillFrontmatter {
  name: string;
  description?: string;
}

/** Parses the SKILL.md YAML frontmatter block (Open Agent Skills format, docs/skills-design.md §2). */
export function parseSkillFrontmatter(skillMdPath: string): SkillFrontmatter {
  const raw = fs.readFileSync(skillMdPath, "utf8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const frontmatterBlock = match?.[1];
  if (frontmatterBlock === undefined) {
    throw new Error(`${skillMdPath}: missing YAML frontmatter (expected a leading '---' ... '---' block).`);
  }
  const frontmatter = parseYaml(frontmatterBlock) as { name?: string; description?: string };
  if (!frontmatter.name) {
    throw new Error(`${skillMdPath}: frontmatter is missing the required 'name' field.`);
  }
  return { name: frontmatter.name, description: frontmatter.description };
}

export interface ResolvedRoleBindings {
  role: string;
  harness: Harness;
  startup_skills: string[];
  skills: string[];
}

/**
 * Resolves task.role -> {startup_skills, skills} against the target
 * repo's installed bindings.yaml. Returns undefined when the repo has no
 * bindings.yaml (silent no-op, docs/skills-design.md §5) or when the role
 * has no entry in it.
 */
export function resolveRoleBindings(repo: string, role: string): ResolvedRoleBindings | undefined {
  const data = readRepoBindings(repo);
  if (!data) return undefined;
  const entry = data.roles[role];
  if (!entry) return { role, harness: data.active_harness, startup_skills: [], skills: [] };
  return {
    role,
    harness: data.active_harness,
    startup_skills: entry.startup_skills ?? [],
    skills: skillsForHarness(entry, data.active_harness),
  };
}

/**
 * `agent validate` extension: every startup_skills / skills path across
 * every role must resolve to a SKILL.md, in-repo or packaged. Returns a
 * list of "<pointer>: <message>" problems, empty on success.
 */
export function bindingsSkillPathProblems(repo: string, data: BindingsPolicy): string[] {
  const problems: string[] = [];
  for (const [role, entry] of Object.entries(data.roles)) {
    for (const relPath of entry.startup_skills ?? []) {
      if (!resolveSkillMdPath(repo, relPath)) {
        problems.push(`/roles/${role}/startup_skills: '${relPath}' does not resolve to a SKILL.md (checked repo and packaged skills tree)`);
      }
    }
    for (const harness of HARNESSES) {
      for (const relPath of skillsForHarness(entry, harness)) {
        if (!resolveSkillMdPath(repo, relPath)) {
          problems.push(`/roles/${role}/skills/${harness}: '${relPath}' does not resolve to a SKILL.md (checked repo and packaged skills tree)`);
        }
      }
    }
  }
  return problems;
}
