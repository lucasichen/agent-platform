// Phase 1 static-table router (spec §7.3 "Phase 1 - static policy": "The
// risk-policy table (§10.5) is the router. Full stop."). No statistics, no
// learning — `agent route <task>` is a pure lookup against the target
// repo's installed policies/risk.yaml and policies/models.yaml, and prints
// its provenance (which policy file/row backed each field).
import * as path from "node:path";
import * as fs from "node:fs";
import type { ModelsPolicy, RiskLevel, RiskPolicy, RiskPolicyLevel, Task, Tier } from "./types";
import { policiesDirIn } from "./paths";
import { readYaml } from "./fsutil";
import { validateOrThrow } from "./validate";

export class RouterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouterError";
  }
}

export function riskPolicyFile(repo: string): string {
  return path.join(policiesDirIn(repo), "risk.yaml");
}

export function modelsPolicyFile(repo: string): string {
  return path.join(policiesDirIn(repo), "models.yaml");
}

export function loadRiskPolicy(repo: string): RiskPolicy {
  const filePath = riskPolicyFile(repo);
  if (!fs.existsSync(filePath)) {
    throw new RouterError(
      `Risk policy not found at ${filePath}. Run 'agent init' to install the default policies into this repo.`
    );
  }
  const data = readYaml<RiskPolicy>(filePath);
  validateOrThrow("risk-policy", data, filePath);
  return data;
}

export function loadModelsPolicy(repo: string): ModelsPolicy {
  const filePath = modelsPolicyFile(repo);
  if (!fs.existsSync(filePath)) {
    throw new RouterError(
      `Models policy not found at ${filePath}. Run 'agent init' to install the default policies into this repo.`
    );
  }
  const data = readYaml<ModelsPolicy>(filePath);
  validateOrThrow("models-policy", data, filePath);
  return data;
}

export function requiredReviewLenses(repo: string, risk: RiskLevel): string[] {
  const policy = loadRiskPolicy(repo);
  return policy.levels[risk].required_review_lenses;
}

export interface RouteResolution {
  task: string;
  risk: RiskLevel;
  planning_tier: Tier;
  implementation_tier: Tier;
  verification_depth: RiskPolicyLevel["verification_depth"];
  required_review_lenses: string[];
  human_approval: boolean | string[];
  staged_release: boolean;
  planning_model: string | undefined;
  implementation_model: string | undefined;
  provenance: {
    risk_policy_file: string;
    risk_policy_row: string; // JSON pointer into risk.yaml
    models_policy_file: string;
    active_profile: string;
    planning_model_pointer: string;
    implementation_model_pointer: string;
  };
}

/** Resolves task.risk -> {tier/verification/review/approval} per policies/risk.yaml, then tier -> model per policies/models.yaml's active_profile. */
export function resolveRoute(repo: string, task: Task): RouteResolution {
  const riskPolicy = loadRiskPolicy(repo);
  const modelsPolicy = loadModelsPolicy(repo);

  const level = riskPolicy.levels[task.risk];
  if (!level) {
    throw new RouterError(`Risk policy has no entry for risk level '${task.risk}' (task '${task.id}').`);
  }

  const profileName = modelsPolicy.active_profile;
  const profile = modelsPolicy.profiles[profileName];
  if (!profile) {
    throw new RouterError(
      `Models policy active_profile '${profileName}' has no matching entry under profiles in ${modelsPolicyFile(repo)}.`
    );
  }

  return {
    task: task.id,
    risk: task.risk,
    planning_tier: level.planning_tier,
    implementation_tier: level.implementation_tier,
    verification_depth: level.verification_depth,
    required_review_lenses: level.required_review_lenses,
    human_approval: level.human_approval,
    staged_release: level.staged_release,
    planning_model: profile[level.planning_tier],
    implementation_model: profile[level.implementation_tier],
    provenance: {
      risk_policy_file: riskPolicyFile(repo),
      risk_policy_row: `/levels/${task.risk}`,
      models_policy_file: modelsPolicyFile(repo),
      active_profile: profileName,
      planning_model_pointer: `/profiles/${profileName}/${level.planning_tier}`,
      implementation_model_pointer: `/profiles/${profileName}/${level.implementation_tier}`,
    },
  };
}
