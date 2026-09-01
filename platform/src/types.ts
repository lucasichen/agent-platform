// Shared TypeScript shapes mirroring schemas/*.json (DESIGN.md §3). These
// are convenience types for the CLI's own code; schemas/*.json remain the
// source of truth and every read/write path is additionally validated
// against them at runtime via validate.ts.

export type RiskLevel = "R0" | "R1" | "R2" | "R3" | "R4";

export type Tier = "frontier" | "strong" | "mid" | "cheap";

export type TaskType =
  | "research"
  | "prototype"
  | "domain"
  | "architecture"
  | "specification"
  | "review"
  | "decomposition"
  | "implementation"
  | "verification"
  | "retrospective"
  | "child-mission";

// Generic lifecycle: BLOCKED -> READY -> ASSIGNED -> RUNNING -> GATING -> DONE
//   (GATING --fail--> REPAIR -> READY/RUNNING)
// Implementation specialization: RUNNING -> VERIFYING -> (fail -> REPAIR -> RUNNING)
//   -> REVIEWING -> MERGE_READY -> MERGED -> DEPLOYED -> PRODUCTION_VERIFIED
// (spec §6.3, DESIGN.md §3)
export type TaskState =
  | "BLOCKED"
  | "READY"
  | "ASSIGNED"
  | "RUNNING"
  | "GATING"
  | "REPAIR"
  | "DONE"
  | "VERIFYING"
  | "REVIEWING"
  | "MERGE_READY"
  | "MERGED"
  | "DEPLOYED"
  | "PRODUCTION_VERIFIED";

// States at or beyond which a dependent task may treat this task as
// satisfied (DONE, or MERGED which implies DONE for implementation tasks,
// or anything reachable after MERGED since DEPLOYED/PRODUCTION_VERIFIED
// never block dependents; spec §6.3).
export const DEPENDENCY_SATISFIED_STATES: ReadonlySet<TaskState> = new Set([
  "DONE",
  "MERGED",
  "DEPLOYED",
  "PRODUCTION_VERIFIED",
]);

export interface Lease {
  owner: string;
  expires_at: string;
}

export type TaskInputRef = string | { uri: string; version?: number; hash?: string };

export interface ImplementationPayload {
  areas: string[];
  design: {
    authority: string;
    decision_refs?: string[];
    required_seams?: string[];
    forbidden?: string[];
    invariants?: string[];
  };
  acceptance: string[];
  verification: string[];
  [key: string]: unknown;
}

export interface Task {
  id: string;
  mission: string;
  workflow: { id: string; version: number; step: string };
  type: TaskType;
  role: string;
  dependencies: string[];
  risk: RiskLevel;
  inputs: TaskInputRef[];
  outputs: string[];
  budget: { attempts: number; dollars: number };
  payload: Record<string, unknown> | ImplementationPayload;
  status: TaskState;
  blocked_reason?: string;
  lease?: Lease | null;
  attempt?: number;
}

export interface Mission {
  id: string;
  type: string;
  workflow: { id: string; version: number };
  goal: string;
  parent_mission: string | null;
  inputs: string[];
  outputs: string[];
  constraints: Record<string, unknown>;
  budget: { dollars: number };
  human_gates: string[];
  status: "DRAFT" | "ACTIVE" | "BLOCKED" | "COMPLETE" | "ABANDONED";
}

export interface WorkflowTemplateStage {
  id: string;
  role?: string;
  type: TaskType;
  depends_on?: string[];
  outputs?: string[];
  human_gate?: string;
  gated_by?: string;
  condition?: { predicate: string } | { owner: string };
}

export interface WorkflowTemplate {
  id: string;
  version: number;
  description: string;
  entry_conditions: string[];
  required_inputs: string[];
  stages: WorkflowTemplateStage[];
  required_outputs: string[];
  terminal_condition: string | Record<string, unknown>;
  child_missions?: { workflow: string; gated_by?: string }[];
}

export interface WorkflowInstanceStage {
  id: string;
  role?: string;
  type?: TaskType;
  depends_on?: string[];
  inputs?: TaskInputRef[];
  outputs?: string[];
  human_gate?: string;
  gated_by?: string;
}

export interface WorkflowInstance {
  mission: string;
  template: string;
  version: number;
  stages: WorkflowInstanceStage[];
}

export interface TransitionRecord {
  ts: string;
  from: string;
  to: string;
  actor: string;
  reason: string;
}

export interface RiskPolicyLevel {
  description: string;
  example: string;
  planning_tier: Tier;
  implementation_tier: Tier;
  verification_depth: "deterministic" | "smoke" | "runtime" | "isolated-runtime";
  required_review_lenses: string[];
  human_approval: boolean | string[];
  staged_release: boolean;
}

export interface RiskPolicy {
  levels: Record<RiskLevel, RiskPolicyLevel>;
  third_party_dependency_escalation?: { trigger: string; minimum_risk: RiskLevel };
}

export interface ModelsPolicyProfile {
  frontier?: string;
  strong?: string;
  mid?: string;
  cheap?: string;
}

export interface ModelsPolicy {
  tiers: Tier[];
  profiles: Record<string, ModelsPolicyProfile>;
  active_profile: string;
  as_of: string;
  owner: string;
}

export interface VerificationCheck {
  name: string;
  status: "PASS" | "FAIL" | "SKIPPED";
  evidence: string;
}

export interface VerificationResult {
  task: string;
  commit: string;
  checks: VerificationCheck[];
  environment: string;
  reproducible_with: string;
}

export interface ReviewVerdict {
  lens: string;
  artifact: string;
  verdict: "PASS" | "FAIL";
  findings: { kind: string; detail: string; ref?: string; location?: string }[];
  reviewer: string;
}
