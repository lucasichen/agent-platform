#!/usr/bin/env node
// `agent` — control plane CLI (spec F.5, DESIGN.md §6). Commander wiring
// only; all behavior lives in the sibling modules.
import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";

import type { Mission, TaskState } from "./types";
import { readYaml, readJson, ensureDir, writeJsonAtomic } from "./fsutil";
import { validateOrThrow, collectProblems, inferSchemaName } from "./validate";
import * as ledger from "./ledger";
import { LedgerError } from "./ledger";
import { instantiateWorkflow } from "./compiler";
import { resolveRoute } from "./router";
import { checkEvidence, scaffoldRunDir } from "./evidence";
import { initRepo } from "./scaffold";
import { buildStatusReport, renderStatusText } from "./status";
import * as P from "./paths";

const program = new Command();
program
  .name("agent")
  .description("Control plane CLI for the agent-platform (spec F.5 / DESIGN.md §6).")
  .option("--repo <path>", "target repository path", process.cwd())
  .exitOverride();

function getRepo(): string {
  return path.resolve(String(program.opts().repo));
}

function guarded<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  return (...args: A) => {
    try {
      fn(...args);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(message);
      process.exitCode = 1;
    }
  };
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function actorFor(repo: string, taskId: string): string {
  const task = ledger.readTask(repo, taskId);
  return task.lease?.owner ?? "cli-operator";
}

// ------------------------------------------------------------------- init

program
  .command("init")
  .description("install .agent/ scaffold + policies into --repo (spec Appendix A)")
  .action(
    guarded(() => {
      const repo = getRepo();
      const result = initRepo(repo);
      console.log(`agent init: ${result.agentDir}`);
      console.log(`  scaffold: ${result.scaffoldCreated.length} created, ${result.scaffoldSkipped.length} skipped`);
      for (const f of result.scaffoldSkipped) console.log(`    skipped (already exists): ${f}`);
      console.log(`  policies: ${result.policiesCreated.length} created, ${result.policiesSkipped.length} skipped`);
      for (const f of result.policiesSkipped) console.log(`    skipped (already exists): ${f}`);
    })
  );

// --------------------------------------------------------------- validate

function defaultValidationTargets(repo: string): string[] {
  const targets: string[] = [];
  const repoYaml = path.join(P.agentDir(repo), "repo.yaml");
  if (fs.existsSync(repoYaml)) targets.push(repoYaml);

  const policiesDir = P.policiesDirIn(repo);
  if (fs.existsSync(policiesDir)) {
    for (const name of fs.readdirSync(policiesDir)) {
      if (name.endsWith(".yaml") && inferSchemaName(path.join(policiesDir, name))) {
        targets.push(path.join(policiesDir, name));
      }
    }
  }

  const workflowsDir = P.workflowsDirIn(repo);
  if (fs.existsSync(workflowsDir)) {
    for (const name of fs.readdirSync(workflowsDir)) {
      if (name.endsWith(".yaml")) targets.push(path.join(workflowsDir, name));
    }
  }

  for (const missionId of ledger.listMissionIds(repo)) {
    targets.push(P.missionFile(repo, missionId));
    const wi = P.workflowInstanceFile(repo, missionId);
    if (fs.existsSync(wi)) targets.push(wi);
    const tasksDir = P.missionTasksDir(repo, missionId);
    if (fs.existsSync(tasksDir)) {
      for (const name of fs.readdirSync(tasksDir)) {
        if (name.endsWith(".yaml")) targets.push(path.join(tasksDir, name));
      }
    }
  }
  return targets;
}

program
  .command("validate")
  .description("schema-validate missions/tasks/policies/templates (defaults to scanning --repo/.agent)")
  .argument("[paths...]", "explicit files to validate")
  .action(
    guarded((paths: string[]) => {
      const repo = getRepo();
      const targets = paths.length > 0 ? paths.map((p) => path.resolve(p)) : defaultValidationTargets(repo);
      if (targets.length === 0) {
        console.log("No files to validate.");
        return;
      }
      let ok = true;
      for (const target of targets) {
        const schemaName = inferSchemaName(target);
        if (!schemaName) {
          console.log(`SKIP  ${target}  (no known schema convention)`);
          continue;
        }
        try {
          const data = target.endsWith(".json") ? readJson(target) : readYaml(target);
          const problems = collectProblems(schemaName, data);
          if (problems.length === 0) {
            console.log(`OK    ${target}  [${schemaName}]`);
          } else {
            ok = false;
            console.log(`FAIL  ${target}  [${schemaName}]`);
            for (const p of problems) console.log(`        ${p}`);
          }
        } catch (e) {
          ok = false;
          const message = e instanceof Error ? e.message : String(e);
          console.log(`FAIL  ${target}  [${schemaName}]`);
          console.log(`        ${message}`);
        }
      }
      if (!ok) process.exitCode = 1;
    })
  );

// ---------------------------------------------------------------- mission

const missionCmd = program.command("mission").description("mission commands (spec §6.0)");

missionCmd
  .command("create")
  .description("validate + register a mission.yaml")
  .requiredOption("--file <path>", "path to mission.yaml")
  .action(
    guarded((opts: { file: string }) => {
      const repo = getRepo();
      const filePath = path.resolve(opts.file);
      const mission = readYaml<Mission>(filePath);
      validateOrThrow("mission", mission, filePath);
      if (ledger.missionExists(repo, mission.id)) {
        throw new LedgerError(`Mission '${mission.id}' already exists. Edit it directly under ${P.missionDir(repo, mission.id)}.`);
      }
      ledger.writeMission(repo, mission);
      console.log(`Registered mission '${mission.id}' at ${P.missionFile(repo, mission.id)}`);
    })
  );

missionCmd
  .command("list")
  .description("list missions")
  .option("--json", "machine-readable output")
  .action(
    guarded((opts: { json?: boolean }) => {
      const repo = getRepo();
      const missions = ledger.listMissionIds(repo).map((id) => ledger.readMission(repo, id));
      if (opts.json) {
        printJson(missions);
        return;
      }
      if (missions.length === 0) {
        console.log("No missions.");
        return;
      }
      for (const m of missions) {
        console.log(`${m.id}  [${m.status}]  ${m.goal.trim().slice(0, 72)}`);
      }
    })
  );

missionCmd
  .command("status")
  .description("mission status: task state breakdown")
  .argument("<id>", "mission id")
  .option("--json", "machine-readable output")
  .action(
    guarded((id: string, opts: { json?: boolean }) => {
      const repo = getRepo();
      const mission = ledger.readMission(repo, id);
      const tasks = ledger.listTasks(repo, { mission: id });
      const byState: Record<string, number> = {};
      for (const t of tasks) byState[t.status] = (byState[t.status] ?? 0) + 1;
      const report = { mission, task_count: tasks.length, by_state: byState };
      if (opts.json) {
        printJson(report);
        return;
      }
      console.log(`${mission.id}  [${mission.status}]`);
      console.log(`goal: ${mission.goal.trim()}`);
      console.log(`tasks: ${tasks.length}`);
      for (const [state, count] of Object.entries(byState)) console.log(`  ${state.padEnd(20)} ${count}`);
    })
  );

// --------------------------------------------------------------- workflow

const workflowCmd = program.command("workflow").description("workflow compiler commands (spec F.0)");

workflowCmd
  .command("instantiate")
  .description("compile a mission's workflow template into a workflow-instance + task stubs")
  .requiredOption("--mission <id>", "mission id")
  .action(
    guarded((opts: { mission: string }) => {
      const repo = getRepo();
      const result = instantiateWorkflow(repo, opts.mission);
      console.log(
        `Instantiated ${result.workflowInstance.template}@${result.workflowInstance.version} for mission '${opts.mission}' from ${result.templateSource}`
      );
      console.log(`Wrote ${P.workflowInstanceFile(repo, opts.mission)}`);
      console.log(`Created ${result.tasks.length} task(s):`);
      for (const t of result.tasks) {
        console.log(`  ${t.id}  [${t.status}]  role=${t.role}  type=${t.type}`);
      }
    })
  );

// -------------------------------------------------------------------- task

const taskCmd = program.command("task").description("task commands (spec §6.1, §6.3)");

taskCmd
  .command("list")
  .option("--state <state>", "filter by lifecycle state")
  .option("--mission <id>", "filter by mission")
  .option("--json", "machine-readable output")
  .action(
    guarded((opts: { state?: TaskState; mission?: string; json?: boolean }) => {
      const repo = getRepo();
      const tasks = ledger.listTasks(repo, { state: opts.state, mission: opts.mission });
      if (opts.json) {
        printJson(tasks);
        return;
      }
      if (tasks.length === 0) {
        console.log("No tasks.");
        return;
      }
      for (const t of tasks) {
        console.log(`${t.id}  [${t.status}]  mission=${t.mission}  role=${t.role}  risk=${t.risk}  attempt=${t.attempt ?? 0}/${t.budget.attempts}`);
      }
    })
  );

taskCmd
  .command("show")
  .argument("<id>")
  .option("--json", "machine-readable output")
  .action(
    guarded((id: string, opts: { json?: boolean }) => {
      const repo = getRepo();
      const task = ledger.readTask(repo, id);
      if (opts.json) {
        printJson(task);
        return;
      }
      console.log(JSON.stringify(task, null, 2));
    })
  );

taskCmd
  .command("claim")
  .argument("<id>")
  .requiredOption("--agent <name>", "claiming agent name")
  .option("--ttl <minutes>", "lease TTL in minutes", "60")
  .action(
    guarded((id: string, opts: { agent: string; ttl: string }) => {
      const repo = getRepo();
      const ttlMinutes = Number(opts.ttl);
      if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0) {
        throw new Error(`--ttl must be a positive number of minutes, got '${opts.ttl}'`);
      }
      const task = ledger.claimTask(repo, id, opts.agent, ttlMinutes);
      console.log(`Claimed ${task.id} for '${opts.agent}', lease expires ${task.lease?.expires_at}`);
    })
  );

taskCmd
  .command("start")
  .argument("<id>")
  .action(
    guarded((id: string) => {
      const repo = getRepo();
      const actor = actorFor(repo, id);
      const task = ledger.startTask(repo, id, actor);
      console.log(`${task.id} -> ${task.status}`);
    })
  );

taskCmd
  .command("submit")
  .argument("<id>")
  .action(
    guarded((id: string) => {
      const repo = getRepo();
      const actor = actorFor(repo, id);
      const task = ledger.submitTask(repo, id, actor);
      console.log(`${task.id} -> ${task.status}`);
    })
  );

taskCmd
  .command("gate")
  .argument("<id>")
  .requiredOption("--gate <gate>", "verification|review")
  .requiredOption("--result <result>", "pass|fail")
  .option("--evidence <file>", "optional evidence file reference (informational)")
  .action(
    guarded((id: string, opts: { gate: string; result: string; evidence?: string }) => {
      const repo = getRepo();
      if (opts.gate !== "verification" && opts.gate !== "review") {
        throw new Error(`--gate must be 'verification' or 'review', got '${opts.gate}'`);
      }
      if (opts.result !== "pass" && opts.result !== "fail") {
        throw new Error(`--result must be 'pass' or 'fail', got '${opts.result}'`);
      }
      const actor = actorFor(repo, id);
      const task = ledger.gateTask(
        repo,
        id,
        { gate: opts.gate, result: opts.result, actor, evidencePath: opts.evidence },
        checkEvidence
      );
      console.log(`${task.id} -> ${task.status}`);
    })
  );

taskCmd
  .command("done")
  .argument("<id>")
  .action(
    guarded((id: string) => {
      const repo = getRepo();
      const actor = actorFor(repo, id);
      const task = ledger.doneTask(repo, id, actor);
      console.log(`${task.id} -> ${task.status}`);
    })
  );

taskCmd
  .command("fail")
  .argument("<id>")
  .requiredOption("--reason <reason>", "failure reason")
  .action(
    guarded((id: string, opts: { reason: string }) => {
      const repo = getRepo();
      const task = ledger.failTask(repo, id, opts.reason, "cli-operator");
      console.log(`${task.id} -> ${task.status} (${opts.reason})`);
    })
  );

taskCmd
  .command("reclaim")
  .description("expire dead leases: reclaimable tasks with an expired lease go back to READY")
  .action(
    guarded(() => {
      const repo = getRepo();
      const results = ledger.reclaimExpired(repo);
      if (results.length === 0) {
        console.log("No expired leases.");
        return;
      }
      for (const r of results) {
        console.log(`Reclaimed ${r.taskId} (was ${r.from}, held by ${r.previousOwner}) -> READY`);
      }
    })
  );

// ------------------------------------------------------------------- route

program
  .command("route")
  .argument("<task-id>")
  .option("--json", "machine-readable output")
  .description("print resolved tier/verification/review per policies/risk.yaml (spec §7.3 Phase 1)")
  .action(
    guarded((taskId: string, opts: { json?: boolean }) => {
      const repo = getRepo();
      const task = ledger.readTask(repo, taskId);
      const resolution = resolveRoute(repo, task);
      if (opts.json) {
        printJson(resolution);
        return;
      }
      console.log(`route ${resolution.task}  risk=${resolution.risk}`);
      console.log(`  planning_tier:        ${resolution.planning_tier}  (${resolution.provenance.risk_policy_row} planning_tier)`);
      console.log(`  implementation_tier:  ${resolution.implementation_tier}  (${resolution.provenance.risk_policy_row} implementation_tier)`);
      console.log(`  verification_depth:   ${resolution.verification_depth}`);
      console.log(`  required_review_lenses: ${resolution.required_review_lenses.join(", ") || "(none)"}`);
      console.log(`  human_approval:       ${JSON.stringify(resolution.human_approval)}`);
      console.log(`  staged_release:       ${resolution.staged_release}`);
      console.log(`  planning_model:       ${resolution.planning_model ?? "(unset)"}  (${resolution.provenance.planning_model_pointer})`);
      console.log(`  implementation_model: ${resolution.implementation_model ?? "(unset)"}  (${resolution.provenance.implementation_model_pointer})`);
      console.log(`  provenance: ${resolution.provenance.risk_policy_file} ; ${resolution.provenance.models_policy_file} (active_profile=${resolution.provenance.active_profile})`);
    })
  );

// ---------------------------------------------------------------- evidence

const evidenceCmd = program.command("evidence").description("evidence bundle commands (spec Appendix B, F.7)");

evidenceCmd
  .command("init")
  .argument("<task-id>")
  .description("scaffold .agent/runs/<task-id>/ (never overwrites existing files)")
  .action(
    guarded((taskId: string) => {
      const repo = getRepo();
      const task = ledger.readTask(repo, taskId);
      const result = scaffoldRunDir(repo, task);
      console.log(`Evidence run directory: ${result.runDir}`);
      console.log(`  created: ${result.created.join(", ") || "(none)"}`);
      console.log(`  skipped (already exist): ${result.skipped.join(", ") || "(none)"}`);
    })
  );

evidenceCmd
  .command("check")
  .argument("<task-id>")
  .option("--json", "machine-readable output")
  .description("completeness check for the task's current gate; gates refuse pass on incomplete evidence (spec F.7)")
  .action(
    guarded((taskId: string, opts: { json?: boolean }) => {
      const repo = getRepo();
      const task = ledger.readTask(repo, taskId);
      // Resolved ambiguity: the CLI surface does not take a --gate flag for
      // `evidence check`, so the gate is inferred from the task's current
      // status: VERIFYING checks verification evidence; any other gating
      // state (GATING, REVIEWING) checks review evidence, since generic
      // (non-implementation) GATING is most commonly review-shaped work
      // (research/spec/architecture review) per spec §6.3's "The role
      // contract defines what GATING means."
      const gate: "verification" | "review" = task.status === "VERIFYING" ? "verification" : "review";
      const problems = checkEvidence(repo, task, gate);
      const complete = problems.length === 0;
      if (opts.json) {
        printJson({ task: taskId, gate, complete, problems });
      } else {
        console.log(`${taskId}  gate=${gate}  ${complete ? "COMPLETE" : "INCOMPLETE"}`);
        for (const p of problems) console.log(`  - ${p}`);
      }
      if (!complete) process.exitCode = 1;
    })
  );

// ------------------------------------------------------------------- retro

const RETRO_TRIGGERS = new Set([
  "failed-task",
  "architecture-rejection",
  "human-correction",
  "high-cost-run",
  "unexpected-escalation",
  "rollback",
  "strong-success",
]);
const RETRO_CAUSES = new Set([
  "SPEC",
  "PLANNING",
  "ARCHITECTURE",
  "ROUTING",
  "CONTEXT",
  "SKILL",
  "MEMORY",
  "HARNESS",
  "TOOLING",
  "CODEBASE",
  "MODEL",
]);

const retroCmd = program.command("retro").description("retrospective commands (spec §13.2, F.10)");

retroCmd
  .command("create")
  .argument("<task-id>")
  .requiredOption("--trigger <trigger>", [...RETRO_TRIGGERS].join("|"))
  .option("--cause <cause>", [...RETRO_CAUSES].join("|"), "CODEBASE")
  .description("scaffold retrospective.json (spec F.10: proposals only, status is always 'proposed')")
  .action(
    guarded((taskId: string, opts: { trigger: string; cause: string }) => {
      const repo = getRepo();
      ledger.readTask(repo, taskId); // ensures the task exists
      if (!RETRO_TRIGGERS.has(opts.trigger)) {
        throw new Error(`--trigger must be one of: ${[...RETRO_TRIGGERS].join(", ")}`);
      }
      if (!RETRO_CAUSES.has(opts.cause)) {
        throw new Error(`--cause must be one of: ${[...RETRO_CAUSES].join(", ")}`);
      }
      const retro = {
        task: taskId,
        trigger: opts.trigger,
        cause: opts.cause,
        candidate_interventions: [
          {
            kind: "field-guide",
            detail: "Stub captured by `agent retro create`; refine and reclassify before promoting from 'proposed'.",
          },
        ],
        status: "proposed",
      };
      validateOrThrow("retrospective", retro, P.retrospectiveFile(repo, taskId));
      ensureDir(P.runDir(repo, taskId));
      writeJsonAtomic(P.retrospectiveFile(repo, taskId), retro);
      console.log(`Wrote ${P.retrospectiveFile(repo, taskId)}`);
    })
  );

// ------------------------------------------------------------------ status

program
  .command("status")
  .description("exception-first fleet dashboard (spec §14.5)")
  .option("--json", "machine-readable output")
  .action(
    guarded((opts: { json?: boolean }) => {
      const repo = getRepo();
      const report = buildStatusReport(repo);
      if (opts.json) {
        printJson(report);
        return;
      }
      console.log(renderStatusText(report));
    })
  );

// --------------------------------------------------------------------- run

export function main(argv: string[]): void {
  try {
    program.parse(argv);
  } catch (e) {
    // exitOverride() throws instead of calling process.exit(); translate
    // known "successful" exits (help/version) to code 0, everything else 1.
    const err = e as { code?: string; exitCode?: number };
    if (typeof err.exitCode === "number") {
      process.exitCode = err.exitCode;
    } else {
      process.exitCode = 1;
    }
  }
}

if (require.main === module) {
  main(process.argv);
}
