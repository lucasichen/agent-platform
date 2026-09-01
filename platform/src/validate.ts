// Schema validation (DESIGN.md §3, §6 item 10: "all reads schema-validated
// (ajv) with actionable error messages including file path and JSON
// pointer"). Loads the packaged schemas/*.json (source of truth) once and
// exposes validate(name, data, sourcePath) for every module that reads a
// YAML/JSON artifact off disk.
import * as fs from "node:fs";
import * as path from "node:path";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { schemasDir } from "./assets";

export const SCHEMA_FILES: Record<string, string> = {
  mission: "mission.schema.json",
  task: "task.schema.json",
  "workflow-template": "workflow-template.schema.json",
  "workflow-instance": "workflow-instance.schema.json",
  "verification-result": "verification-result.schema.json",
  "review-verdict": "review-verdict.schema.json",
  result: "result.schema.json",
  cost: "cost.schema.json",
  retrospective: "retrospective.schema.json",
  "eval-case": "eval-case.schema.json",
  repo: "repo.schema.json",
  "models-policy": "models-policy.schema.json",
  "risk-policy": "risk-policy.schema.json",
  "bindings-policy": "bindings-policy.schema.json",
};

let ajv: Ajv2020 | undefined;
const compiled = new Map<string, ValidateFunction>();

function getAjv(): Ajv2020 {
  if (ajv) return ajv;
  ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

function loadSchema(name: string): ValidateFunction {
  const cached = compiled.get(name);
  if (cached) return cached;
  const fileName = SCHEMA_FILES[name];
  if (!fileName) {
    throw new Error(`Unknown schema '${name}'. Known schemas: ${Object.keys(SCHEMA_FILES).join(", ")}`);
  }
  const schemaPath = path.join(schemasDir(), fileName);
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const fn = getAjv().compile(schema);
  compiled.set(name, fn);
  return fn;
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly sourcePath: string | undefined,
    public readonly problems: string[]
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Validate `data` against the named schema. Throws ValidationError with an
 * actionable message (file path + JSON pointer per violation) on failure.
 */
export function validateOrThrow(schemaName: string, data: unknown, sourcePath?: string): void {
  const fn = loadSchema(schemaName);
  const ok = fn(data);
  if (ok) return;
  const errors = fn.errors ?? [];
  const problems = errors.map((e) => {
    const pointer = e.instancePath && e.instancePath.length > 0 ? e.instancePath : "/";
    return `${pointer}: ${e.message ?? "invalid"}${e.params ? ` (${JSON.stringify(e.params)})` : ""}`;
  });
  const where = sourcePath ? sourcePath : "<in-memory data>";
  const message = [`Schema validation failed for '${schemaName}' at ${where}:`, ...problems.map((p) => `  - ${p}`)].join(
    "\n"
  );
  throw new ValidationError(message, sourcePath, problems);
}

export function isValid(schemaName: string, data: unknown): boolean {
  const fn = loadSchema(schemaName);
  return !!fn(data);
}

/** Returns null-list on success, else a list of "<pointer>: <message>" problems. */
export function collectProblems(schemaName: string, data: unknown): string[] {
  const fn = loadSchema(schemaName);
  const ok = fn(data);
  if (ok) return [];
  return (fn.errors ?? []).map((e) => {
    const pointer = e.instancePath && e.instancePath.length > 0 ? e.instancePath : "/";
    return `${pointer}: ${e.message ?? "invalid"}${e.params ? ` (${JSON.stringify(e.params)})` : ""}`;
  });
}

/**
 * Best-effort schema inference for `agent validate <path...>` and the
 * default repo scan, based on filename and containing directory
 * conventions used throughout DESIGN.md §2 / Appendix A / Appendix B.
 * Returns undefined when no convention matches (validate reports SKIP).
 */
export function inferSchemaName(filePath: string): string | undefined {
  const base = path.basename(filePath);
  const parentDir = path.basename(path.dirname(filePath));
  if (base === "mission.yaml") return "mission";
  if (base === "workflow-instance.yaml") return "workflow-instance";
  if (base === "repo.yaml") return "repo";
  if (base === "risk.yaml") return "risk-policy";
  if (base === "models.yaml") return "models-policy";
  if (base === "bindings.yaml") return "bindings-policy";
  if (parentDir === "tasks" && base.endsWith(".yaml")) return "task";
  if (parentDir === "workflows" && base.endsWith(".yaml")) return "workflow-template";
  if (parentDir === "reviews" && base.endsWith(".json")) return "review-verdict";
  if (base === "result.json" && parentDir === "verification") return "verification-result";
  if (base === "result.json") return "result";
  if (base === "cost.json") return "cost";
  if (base === "retrospective.json") return "retrospective";
  if (parentDir.match(/^evals?/) && base.endsWith(".yaml")) return "eval-case";
  return undefined;
}
