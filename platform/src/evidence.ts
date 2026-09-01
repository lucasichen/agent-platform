// Evidence bundle helpers (spec Appendix B, F.7). `evidence init` scaffolds
// the run directory; `evidence check` verifies completeness for the task's
// current gate. Gates refuse to pass on incomplete evidence — "PASS
// without evidence is FAIL" (spec F.7 On underdelivery) — enforced here
// and consumed by ledger.gateTask.
import * as fs from "node:fs";
import * as path from "node:path";
import type { ReviewVerdict, Task, VerificationResult } from "./types";
import * as P from "./paths";
import { ensureDir, readJsonIfExists, writeFileAtomic, writeJsonAtomic, writeYamlAtomic } from "./fsutil";
import { collectProblems } from "./validate";
import { requiredReviewLenses } from "./router";

export interface ScaffoldResult {
  runDir: string;
  created: string[];
  skipped: string[];
}

/** Scaffold .agent/runs/<TASK-ID>/ per Appendix B. Never overwrites an existing file. */
export function scaffoldRunDir(repo: string, task: Task): ScaffoldResult {
  const runDir = P.runDir(repo, task.id);
  const created: string[] = [];
  const skipped: string[] = [];

  const ensureFile = (filePath: string, write: () => void, label: string) => {
    if (fs.existsSync(filePath)) {
      skipped.push(label);
    } else {
      write();
      created.push(label);
    }
  };

  ensureDir(path.join(runDir, "verification"));
  ensureDir(path.join(runDir, "verification", "screenshots"));
  ensureDir(path.join(runDir, "verification", "logs"));
  ensureDir(path.join(runDir, "reviews"));

  ensureFile(P.runTaskFile(repo, task.id), () => writeYamlAtomic(P.runTaskFile(repo, task.id), task), "task.yaml");
  ensureFile(path.join(runDir, "transcript.jsonl"), () => writeFileAtomic(path.join(runDir, "transcript.jsonl"), ""), "transcript.jsonl");
  ensureFile(
    path.join(runDir, "decisions.tsv"),
    () => writeFileAtomic(path.join(runDir, "decisions.tsv"), "ts\tdecision\trationale\n"),
    "decisions.tsv"
  );
  ensureFile(path.join(runDir, "diff.patch"), () => writeFileAtomic(path.join(runDir, "diff.patch"), ""), "diff.patch");
  ensureFile(P.transitionsFile(repo, task.id), () => writeFileAtomic(P.transitionsFile(repo, task.id), ""), "transitions.jsonl");
  ensureFile(
    P.costFile(repo, task.id),
    () => writeJsonAtomic(P.costFile(repo, task.id), { task: task.id, total_dollars: 0 }),
    "cost.json"
  );

  return { runDir, created, skipped };
}

/**
 * Completeness problems for the given gate (empty array = complete). This
 * is the function wired into ledger.gateTask so `task gate --result pass`
 * refuses when incomplete.
 */
export function checkEvidence(repo: string, task: Task, gate: "verification" | "review"): string[] {
  if (gate === "verification") return checkVerificationEvidence(repo, task);
  return checkReviewEvidence(repo, task);
}

function checkVerificationEvidence(repo: string, task: Task): string[] {
  const problems: string[] = [];
  const filePath = P.verificationResultFile(repo, task.id);
  if (!fs.existsSync(filePath)) {
    problems.push(`missing ${filePath}`);
    return problems;
  }
  const data = readJsonIfExists<VerificationResult>(filePath);
  if (!data) {
    problems.push(`${filePath} is not valid JSON`);
    return problems;
  }
  const schemaProblems = collectProblems("verification-result", data);
  if (schemaProblems.length > 0) {
    problems.push(...schemaProblems.map((p) => `${filePath} ${p}`));
  }
  if (data.task !== task.id) {
    problems.push(`${filePath}: task field '${data.task}' does not match '${task.id}'`);
  }
  const runDir = P.runDir(repo, task.id);
  for (const check of data.checks ?? []) {
    if (!check.evidence) {
      problems.push(`check '${check.name}' has no evidence reference`);
      continue;
    }
    const evidencePath = path.join(runDir, "verification", check.evidence);
    if (!fs.existsSync(evidencePath)) {
      problems.push(`check '${check.name}' evidence not found: ${evidencePath}`);
    }
    if (check.status === "FAIL") {
      problems.push(`check '${check.name}' status is FAIL`);
    }
  }
  return problems;
}

function checkReviewEvidence(repo: string, task: Task): string[] {
  const problems: string[] = [];
  const lenses = requiredReviewLenses(repo, task.risk);
  for (const lens of lenses) {
    const filePath = P.reviewVerdictFile(repo, task.id, lens);
    if (!fs.existsSync(filePath)) {
      problems.push(`missing review verdict for required lens '${lens}': ${filePath}`);
      continue;
    }
    const data = readJsonIfExists<ReviewVerdict>(filePath);
    if (!data) {
      problems.push(`${filePath} is not valid JSON`);
      continue;
    }
    const schemaProblems = collectProblems("review-verdict", data);
    if (schemaProblems.length > 0) {
      problems.push(...schemaProblems.map((p) => `${filePath} ${p}`));
    }
    if (data.verdict === "FAIL") {
      problems.push(`review lens '${lens}' verdict is FAIL`);
    }
  }
  return problems;
}
