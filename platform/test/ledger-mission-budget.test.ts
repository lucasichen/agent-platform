import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import type { Mission } from "../src/types";
import { makeTempRepo, baseMission, registerMission } from "./testutil";
import * as ledger from "../src/ledger";
import { LedgerError } from "../src/ledger";
import { writeYamlAtomic } from "../src/fsutil";
import { main } from "../src/cli";

function childMission(overrides: Partial<Mission> = {}): Mission {
  return baseMission({
    id: "CHILD-1",
    parent_mission: "PARENT-1",
    budget: { dollars: 5 },
    ...overrides,
  });
}

// Fix 12: child-mission budget rule (DESIGN.md §3).

test("assertChildMissionBudget is a no-op for a root mission (parent_mission: null)", () => {
  const repo = makeTempRepo();
  assert.doesNotThrow(() => ledger.assertChildMissionBudget(repo, baseMission({ parent_mission: null })));
});

test("assertChildMissionBudget refuses when the named parent mission does not exist", () => {
  const repo = makeTempRepo();
  assert.throws(() => ledger.assertChildMissionBudget(repo, childMission()), (e: unknown) => {
    assert.ok(e instanceof LedgerError);
    assert.match((e as Error).message, /parent_mission 'PARENT-1'.*no such mission exists/s);
    return true;
  });
});

test("assertChildMissionBudget accepts a child whose budget fits within the parent's remaining budget", () => {
  const repo = makeTempRepo();
  registerMission(repo, baseMission({ id: "PARENT-1", parent_mission: null, budget: { dollars: 20 } }));
  assert.doesNotThrow(() => ledger.assertChildMissionBudget(repo, childMission({ budget: { dollars: 20 } })));
});

test("assertChildMissionBudget refuses a child budget exceeding the parent's total budget", () => {
  const repo = makeTempRepo();
  registerMission(repo, baseMission({ id: "PARENT-1", parent_mission: null, budget: { dollars: 20 } }));
  assert.throws(() => ledger.assertChildMissionBudget(repo, childMission({ budget: { dollars: 21 } })), (e: unknown) => {
    assert.ok(e instanceof LedgerError);
    assert.match((e as Error).message, /only 20 remaining/);
    return true;
  });
});

test("assertChildMissionBudget accounts for budget already committed to sibling children", () => {
  const repo = makeTempRepo();
  registerMission(repo, baseMission({ id: "PARENT-1", parent_mission: null, budget: { dollars: 20 } }));
  registerMission(repo, childMission({ id: "CHILD-A", budget: { dollars: 12 } }));

  // 8 remaining (20 - 12): a second child asking for 8 fits exactly.
  assert.doesNotThrow(() => ledger.assertChildMissionBudget(repo, childMission({ id: "CHILD-B", budget: { dollars: 8 } })));
  // A third child asking for 9 does not (only 8 remaining).
  assert.throws(() => ledger.assertChildMissionBudget(repo, childMission({ id: "CHILD-C", budget: { dollars: 9 } })), (e: unknown) => {
    assert.ok(e instanceof LedgerError);
    assert.match((e as Error).message, /only 8 remaining/);
    return true;
  });
});

test("a mission being re-validated (same id already registered) does not double-count itself as a sibling", () => {
  const repo = makeTempRepo();
  registerMission(repo, baseMission({ id: "PARENT-1", parent_mission: null, budget: { dollars: 20 } }));
  registerMission(repo, childMission({ id: "CHILD-A", budget: { dollars: 12 } }));
  assert.doesNotThrow(() => ledger.assertChildMissionBudget(repo, childMission({ id: "CHILD-A", budget: { dollars: 12 } })));
});

// -------------------------------------------------------------- CLI wiring

function runCli(args: string[]): number | undefined {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    main(["node", "agent", ...args]);
    return process.exitCode;
  } finally {
    process.exitCode = previousExitCode;
  }
}

test("`agent mission create` refuses a child mission whose budget exceeds the parent's remaining budget", () => {
  const repo = makeTempRepo();
  registerMission(repo, baseMission({ id: "PARENT-1", parent_mission: null, budget: { dollars: 10 } }));

  const filePath = path.join(repo, "child-mission.yaml");
  writeYamlAtomic(filePath, childMission({ budget: { dollars: 11 } }));

  const exitCode = runCli(["--repo", repo, "mission", "create", "--file", filePath]);
  assert.equal(exitCode, 1);
  assert.equal(ledger.missionExists(repo, "CHILD-1"), false, "the over-budget child must not have been registered");
});

test("`agent mission create` registers a child mission within budget", () => {
  const repo = makeTempRepo();
  registerMission(repo, baseMission({ id: "PARENT-1", parent_mission: null, budget: { dollars: 10 } }));

  const filePath = path.join(repo, "child-mission.yaml");
  writeYamlAtomic(filePath, childMission({ budget: { dollars: 10 } }));

  const exitCode = runCli(["--repo", repo, "mission", "create", "--file", filePath]);
  assert.notEqual(exitCode, 1);
  assert.equal(ledger.missionExists(repo, "CHILD-1"), true);
});
