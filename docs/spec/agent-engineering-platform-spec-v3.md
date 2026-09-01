# Agent Engineering Platform Specification

# 1. Objective

Build an engineering system that lets one senior developer safely delegate increasing amounts of software work to autonomous coding agents.

The system should support this progression:

```text
1–5 agents
Human supervises execution
        ↓
5–20 agents
Human manages tasks and exceptions
        ↓
20–50 agents
Human manages missions and agent teams
        ↓
50–100+ agents
Human manages priorities, architecture,
quality, economics, and escalations
```

The goal is not maximum concurrency, commits, or agent utilization.

The goal is:

> Maximize architecture-approved, verified engineering output per dollar and per minute of human attention.

The central risk is not that agents fail to generate code. It is that locally correct shortcuts become merged reference implementations, get retrieved by future agents, and progressively degrade the architecture.

Therefore, functional correctness alone is insufficient.

---

## 1.1 How to read this document

Two kinds of content share this document.

**Buildable now — the actual spec:**

```text
§3.1–3.2     mission model and workflow templates
§6           mission/task schema and lifecycle
§10.3        Layer 1 deterministic enforcement
§10.5        risk policy
§15          MVP and build plan
Appendix A   repository operating contract
Appendix B   evidence contract
Appendix F   role contracts
```

**North star — direction, not commitment:**

```text
§7.3 Phase 3    learned routing
§13.3           fleet-scale learning
§14.3–14.4      20–100+ agent hierarchies
Gas Town / Gas City references
```

Build the first list.

Let the second list justify design choices, not consume build time.

---

# 2. Governing Principles

### Workers do not certify themselves

Workers produce candidate implementations. Independent systems determine whether those implementations are acceptable.

### Architecture is decided before cheap execution

Strong reasoning should resolve ambiguity, ownership, seams, interfaces, and consequential tradeoffs.

Cheaper models should execute bounded work against those decisions.

### Escalate uncertainty, not task size

A large mechanical migration may be cheap-model work.

A five-line authentication change may require architectural or human review.

### Existing code is not automatically canonical

Agents must distinguish approved patterns from legacy, deprecated, experimental, or accidental implementations.

### Durable artifacts are organizational memory

Important knowledge should live in:

```text
Specs
Domain models
ADRs
Design documents
Tasks
Code
Tests
Evidence
Reviews
Field Guide entries
Production telemetry
Eval results
```

not only in conversations.

### Optimize lifecycle cost

The relevant cost is:

```text
implementation
+ verification
+ reviews
+ retries
+ human intervention
+ escaped defects
+ architecture debt
+ future confusion
```

not worker-token cost alone.

---

# 3. End-to-End Architecture

The platform operates on **missions**. A mission selects a reusable workflow template, and that workflow composes the existing role contracts into a task/artifact DAG.

```text
                              HUMAN
                                │
                       mission / constraints
                                │
                                ▼
                ┌─────────────────────────┐
                │ MISSION                 │
                │ goal / outputs / budget │
                └─────────────┬───────────┘
                              │
                              ▼
                ┌─────────────────────────┐
                │ WORKFLOW SELECTOR       │
                │ thin composition layer  │
                └─────────────┬───────────┘
                              │
                    workflow instance / DAG
                              │
                              ▼
                ┌─────────────────────────┐
                │ UNCERTAINTY + DOMAIN    │
                │ Matt skills             │
                └─────────────┬───────────┘
                              │
                              ▼
                ┌─────────────────────────┐
                │ BEHAVIORAL REQUIREMENTS │
                │ Matt skills             │
                └─────────────┬───────────┘
                              │
                              ▼
                ┌─────────────────────────┐
                │ DESIGN AUTHORITY        │
                │ pstack + Matt           │
                └─────────────┬───────────┘
                              │
                     architecture constraints
                              │
                              ▼
                ┌─────────────────────────┐
                │ SPEC SYNTHESIS          │
                │ Matt to-spec            │
                └─────────────┬───────────┘
                              │
                              ▼
                ┌─────────────────────────┐
                │ TASK DECOMPOSITION      │
                │ Matt tracer bullets     │
                └─────────────┬───────────┘
                              │
                           task DAG
                              │
                              ▼
                ┌─────────────────────────┐
                │ CONTROL PLANE           │
                │ Hermes initially        │
                │ scheduler + router      │
                └─────────────┬───────────┘
                              │
                     cheapest capable model
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
      Worker               Worker               Worker
 pstack/Superpowers   pstack/Superpowers   pstack/Superpowers
         │                    │                    │
         └────────────────────┼────────────────────┘
                              │
                      candidate changes
                              │
                              ▼
                ┌─────────────────────────┐
                │ VERIFICATION            │
                │ deterministic + runtime │
                │ gstack / verify-*       │
                └─────────────┬───────────┘
                              │
                              ▼
                ┌─────────────────────────┐
                │ REVIEW GATES            │
                │ spec / quality / arch   │
                └─────────────┬───────────┘
                              │
                              ▼
                       merge refinery
                              │
                              ▼
                       deploy / canary
                              │
                              ▼
                    production telemetry
                              │
                              ▼
                ┌─────────────────────────┐
                │ LEARNING EVALUATOR      │
                │ reflect + fleet evals   │
                └─────────────────────────┘
```

The lower half of the diagram shows the common implementation path. Other workflows reuse the same roles and infrastructure but may stop earlier or arrange them differently.

No framework owns the whole workflow.

Each framework is used where it is strongest.

## 3.1 Mission model

A **Mission** is the durable goal-level unit above a task.

A mission owns:

```text
goal
workflow type + version
required outputs
constraints
budget
human approval gates
parent/child mission links
```

A **Task** is one executable unit inside the mission's workflow.

This distinction allows the same platform to manage knowledge work and code work:

```text
Mission: define a new project
    │
    ├── research task
    ├── prototype task
    ├── domain-model task
    ├── architecture task
    ├── spec task
    └── spec-review task
            │
            ▼
      child implementation mission
            │
            ├── backend task
            ├── portal task
            ├── mobile task
            └── verification tasks
```

The output of one mission may become the input to another. Project definition therefore does not require a separate platform.

## 3.2 Workflow templates

A **Workflow Template** is a versioned, declarative composition of role contracts.

It defines:

```text
entry conditions
required input artifacts
role/stage DAG
artifact dependencies
review / human gates
required outputs
terminal condition
child missions to create
```

A workflow template should contain as little original reasoning methodology as possible. It routes work to existing roles and skills; the role contracts remain the source of execution behavior.

Initial workflow registry:

| Workflow | Purpose | Main composition |
|---|---|---|
| `project-definition` | Turn a project idea into an approved engineering spec and implementation DAG | wayfinder/research/prototype → domain/product requirements → architect/arena → to-spec synthesis → spec review → to-tickets |
| `feature-development` | Implement a bounded product change | spec refresh if needed → architecture check → to-tickets → workers → verification → review → merge/release |
| `bug-fix` | Reproduce, diagnose, repair, and prevent regression | diagnosing-bugs/systematic-debugging → worker → verifier → review → merge → reflect |
| `research` | Resolve a factual or technical question | parallel research/prototype → cited synthesis → decision owner |
| `architecture-migration` | Change a consequential system boundary safely | wayfinder/research → architect/arena → migration plan → phased implementation → compatibility verification |
| `codebase-health` | Repair accumulated architecture debt | architecture-health scan → design proposal → bounded refactor mission |
| `release` | Promote accepted changes safely | merge refinery → staging verification → canary → production |

Only the first three need to exist for the MVP. The others are workflow-library growth, not new platform primitives.

### Conditional stages

Registry entries contain conditions: "spec refresh if needed", "/arena if needed".

Every condition has a named owner, because the workflow compiler (F.0) performs composition only and cannot make planning decisions.

```text
mechanical predicate where possible
(risk level, files touched, decision_refs present)
→ evaluated by the compiler from policy

judgment otherwise
→ escalated to the owning role
  (design authority for architecture depth,
   spec authority for spec refresh)
```

An "if needed" with no predicate and no owner is a planning decision hiding in a template.

### Project-definition workflow

Project definition is the main workflow for creating a project engineering spec:

```text
                         PROJECT IDEA
                              │
                              ▼
                    uncertainty assessment
                              │
                ┌─────────────┼─────────────┐
                ▼             ▼             ▼
             research      research      prototype
                │             │             │
                └─────────────┼─────────────┘
                              ▼
                        cited findings
                              │
                              ▼
                  domain + product requirements
                              │
                              ▼
                      design authority
                   /architect, /arena if needed
                              │
                              ▼
                    engineering-spec synthesis
                         Matt /to-spec
                              │
                              ▼
                  independent spec reviews
          product / research / architecture / ambiguity
                              │
                              ▼
                      approved project spec
                              │
                              ▼
                       Matt /to-tickets
                              │
                              ▼
                  implementation task graph
                              │
                              ▼
                 CHILD IMPLEMENTATION MISSION
```

Research tasks may fan out in parallel because they answer independent questions. Their outputs are cited facts or prototype evidence, not architectural authority. The planner/design authority synthesizes those artifacts and owns consequential decisions.

### Artifact ownership and DRY rule

Project definition should produce a linked artifact graph, not one document that repeats every fact:

```text
research/
    what is externally or empirically true

domain/CONTEXT.md
    what canonical terms mean

architecture/adr/
    why consequential decisions were made

architecture/design/
    what shape the system has

project-spec.md
    what behavior and implementation constraints the project commits to

task tracker
    what bounded work must be executed
```

Each downstream artifact references upstream truth instead of copying it.

A ticket references the spec and ADRs. The spec references ADRs and research where necessary. An ADR does not duplicate the research report that motivated it.

---

# 4. Planning Pipeline

Planning converts vague intent into bounded implementation work.

It is a reusable sub-pipeline invoked by workflow templates such as `project-definition`, `feature-development`, and `architecture-migration`; it is not mandatory for every mission.

The sequence is:

```text
uncertainty
    ↓
domain understanding
    ↓
behavioral requirements
    ↓
architecture
    ↓
engineering-spec synthesis
    ↓
task DAG
```

## 4.1 Uncertainty resolution

For missions that cannot yet be safely specified, first investigate.

Primary skills:

```text
Matt:
- wayfinder
- research
- prototype
```

The workflow may fan out independent research and prototype tasks in parallel. Each task returns cited findings or measured evidence. Research establishes facts; it does not silently establish product or architecture decisions.

Example:

```text
Mission:
Replace legacy authorization

        ↓

Investigations:
- current ownership
- affected clients
- migration constraints
- backward compatibility
- persistence implications

        ↓

decisions
```

Investigation tasks produce decisions, not production code.

Prototype code is disposable:

```text
question
   ↓
prototype
   ↓
answer learned
   ↓
delete prototype
   ↓
update design/spec
```

Prototype implementations must not quietly become production reference code.

---

## 4.2 Domain model

Primary driver:

```text
Matt domain-modeling
```

Create canonical vocabulary before many agents begin working.

Example:

```text
Account
Canonical representation of a registered user.

Session
Authenticated access belonging to an Account.

Deletion
Account lifecycle transition:
Active → PendingDeletion → Deleted
```

This prevents agents from independently inventing overlapping concepts such as:

```text
Customer
User
UserAccount
ProfileAccount
```

---

## 4.3 Behavioral requirements

Primary skills:

```text
Matt:
- grill-with-docs
- research
- domain-modeling
```

This stage establishes **what the product must do** without prematurely fixing the implementation shape.

Example:

```text
Feature: Account deletion

Journey:
Settings
→ Account
→ Delete Account
→ confirmation
→ deletion
→ logout

Requirements:
- authentication required
- deletion eventually removes access
- sessions are revoked
- repeated deletion remains safe
- deleted accounts cannot authenticate

Evidence expectations:
- UI journey succeeds
- API behavior is observable
- persistence state can be checked
- previous sessions fail
- future login fails
```

The output is a requirements/product artifact plus any human product decisions. It is input to architecture, not yet the final engineering spec.

The key question is:

> What observable behavior must the system provide?

---

## 4.4 Architecture

Primary drivers:

```text
pstack:
- /architect
- /arena
- /interrogate

Matt:
- codebase-design
- domain-modeling
```

Architecture should establish:

```text
ownership
dependency direction
public interfaces
canonical seams
data ownership
cross-service contracts
important invariants
```

Use `/arena` only when multiple consequential designs are credible.

Examples:

```text
new service boundary
database ownership change
public API redesign
major concurrency strategy
migration design
cross-service workflow
```

The chosen design becomes an ADR or durable design document.

---

## 4.5 Engineering-spec synthesis

Primary driver:

```text
Matt to-spec
```

`to-spec` runs after uncertainty, product requirements, and consequential architecture decisions are resolved.

Its job is synthesis, not rediscovery:

```text
research findings
+
domain model
+
behavioral requirements
+
ADRs / system design
+
human constraints
        ↓
      to-spec
        ↓
canonical engineering spec
```

The spec references upstream research and ADRs rather than copying them. It should contain the observable requirements, implementation decisions that downstream tasks must respect, verification expectations, non-goals, and unresolved items that still block execution.

If a high-risk question remains unresolved, synthesis fails backward to the owning role instead of guessing.

---

## 4.6 Task decomposition

Primary driver:

```text
Matt to-tickets
```

Prefer vertical tracer bullets over horizontal implementation chores.

Bad:

```text
create database changes
create API
create frontend
write tests
```

Better:

```text
T1 authenticated deletion behavior
T2 portal deletion journey
T3 mobile integration
T4 retry/idempotency behavior
T5 compatibility verification
```

Each task should produce independently demonstrable behavior.

---

# 5. Design Authority and Reference Integrity

This is the primary defense against architecture degradation.

## 5.1 Design authority

Every meaningful mission has an explicit owner for architectural decisions.

Example:

```yaml
design:
  authority: account-mission-planner

  decision_refs:
    - ADR-021
    - DESIGN-account-lifecycle

  required_seams:
    - AccountService.delete
    - SessionService.revokeAll

  forbidden:
    - direct session persistence mutation

  invariants:
    - AccountService owns account lifecycle
    - controllers cannot mutate session persistence directly
    - clients cannot directly alter deletion state
```

Workers implement these decisions.

They do not silently replace them.

---

## 5.2 Worker freedom

Workers may independently decide:

```text
private helper structure
local algorithms
naming
test organization
small local refactors
internal implementation details
```

Workers must escalate:

```text
new service
new domain abstraction
new public interface
ownership change
API contract change
new persistence abstraction
dependency-direction change
duplicate domain concept
cross-module bypass
new third-party dependency
```

Workflow:

```text
worker discovers design question
          ↓
STOP architectural invention
          ↓
design-authority escalation
          ↓
architect / arena if necessary
          ↓
ADR/design update
          ↓
affected tasks updated
          ↓
execution resumes
```

---

## 5.3 Canonical vs legacy code

Agents should not interpret code frequency as architectural approval.

Maintain an explicit map where useful:

```text
CANONICAL

✓ AccountService
✓ standard transaction helper
✓ current API error envelope
✓ current mobile networking layer

LEGACY / NON-CANONICAL

⚠ LegacyAccountManager
⚠ v1 authentication handlers
⚠ deprecated networking wrapper
```

Future retrieval and examples should prefer canonical patterns.

This prevents:

```text
bad shortcut
    ↓
merge
    ↓
future code search
    ↓
shortcut copied
    ↓
frequency increases
    ↓
agents become more confident
    ↓
architecture cascade
```

---

# 6. Task and Orchestration Model

## 6.0 Mission contract

Every mission is durable and versioned against a workflow template.

```yaml
id: PROJECT-CODING-GRADER
type: project-definition
workflow:
  id: project-definition
  version: 1

goal:
  Build a LeetCode-style C++ coding platform.

parent_mission: null

inputs:
  - human-brief.md
  - existing-repo

outputs:
  - domain-model
  - research-findings
  - architecture-design
  - approved-project-spec
  - implementation-task-graph

constraints:
  language: C++20

budget:
  dollars: 40

human_gates:
  - product-decisions
  - major-architecture
  - spec-approval

status: ACTIVE
```

A completed mission may create child missions. For example, `project-definition` ends by creating a `feature-development` or project implementation mission from its approved spec and task graph.

Child missions are the one place agents create new goal-level work, so they are bounded:

```text
child budgets draw down the parent's remaining budget

mission depth and child count are capped by policy

creating a child mission is a human gate by default
```

For `project-definition`, the human approval of the spec is that gate — approving the spec approves the implementation mission it creates.

## 6.1 Task contract

All tasks share a generic envelope so the same scheduler can run research, specification, architecture, implementation, verification, and review work.

```yaml
id: ACCOUNT-12
mission: account-deletion

workflow:
  id: feature-development
  version: 1
  step: implementation

type: implementation
role: worker

dependencies:
  - ACCOUNT-10

risk: R3

inputs:
  - uri: spec://account-deletion
    version: 4
  - uri: adr://ADR-021
    version: 2

outputs:
  - candidate-change
  - local-verification
  - run-evidence

budget:
  attempts: 3
  dollars: 3.00

payload:
  areas:
    - java-api
    - auth

  design:
    authority: account-mission-planner

    decision_refs:
      - ADR-021

    required_seams:
      - AccountService.delete
      - SessionService.revokeAll

    forbidden:
      - direct session persistence mutation

    invariants:
      - AccountService owns account lifecycle

  acceptance:
    - DELETE /account returns 204
    - account enters PendingDeletion
    - sessions become invalid
    - repeated deletion remains safe

  verification:
    - unit
    - integration
    - api-runtime
    - persistence
    - auth-regression
```

Non-implementation tasks use the same envelope with a different typed `payload`.

Example research task:

```yaml
id: PROJECT-RESEARCH-3
mission: PROJECT-CODING-GRADER

workflow:
  id: project-definition
  version: 1
  step: research

type: research
role: uncertainty-resolver

dependencies: []
risk: R1

inputs:
  - question://sandbox-isolation

outputs:
  - artifact://research/sandboxing.md

budget:
  attempts: 2
  dollars: 2.00

payload:
  question: >
    What isolation model is sufficient for the MVP?
  evidence_policy:
    primary_sources_required: true
```

The scheduler handles the generic envelope. The bound role contract validates the type-specific payload and output.

### Artifact references

Task inputs name artifacts by typed URI:

```text
spec://account-deletion
adr://ADR-021
artifact://research/sandboxing.md
```

Two rules:

**Resolution.** Every URI resolves through the mission's artifact graph (Appendix B) to a file in the repository or mission directory. A URI that does not resolve fails task intake, exactly like a broken dependency.

**Pinning.** Templates may use bare URIs; at workflow instantiation each input is pinned to a version or content hash in the task record:

```yaml
inputs:
  - uri: spec://account-deletion
    version: 4
```

Workers read the pinned version. If upstream changes mid-mission, dependent tasks are explicitly re-pointed and re-validated — they never silently read a moving head.

Pinning applies to URIs that name artifacts. Ephemeral references such as `question://` carry their content in the task payload instead; outputs are produced fresh and need no pin.

Evals pin `repo_snapshot` for the same reason (§13.5). Task inputs get the same discipline.

---

## 6.2 Initial control plane

Use **Hermes** first instead of rebuilding orchestration.

Hermes provides:

```text
durable tasks
dependencies
worker profiles
worktree isolation
retries
crash recovery
model overrides
review states
human dashboard
```

---

## 6.3 Task lifecycle

All workflow tasks share a small generic lifecycle:

```text
BLOCKED
   ↓ dependency/artifact ready
READY
   ↓
ASSIGNED
   ↓
RUNNING
   ↓
GATING
   │
   ├── fail → REPAIR → READY/RUNNING
   │
   ▼
DONE
```

The role contract defines what `GATING` means. A research task may require evidence review; a spec task may require product/architecture review.

Implementation work specializes the gate:

```text
RUNNING
   ↓
VERIFYING
   │
   ├── fail → REPAIR → RUNNING
   │
   ▼
REVIEWING
   ↓
MERGE_READY
   ↓
MERGED
   ↓
DEPLOYED
   ↓
PRODUCTION_VERIFIED
```

The two lifecycles map at one point:

> An implementation task is DONE at MERGED.

Dependent tasks unblock at DONE. DEPLOYED and PRODUCTION_VERIFIED belong to the release workflow; they update the task record but never block dependents or mission completion.

Workers use leases so abandoned tasks can be safely reclaimed.

---

# 7. Model Routing and Economics

The router chooses the cheapest **agent configuration** likely to produce an accepted outcome.

An agent configuration includes:

```text
model
skills
instructions
context
memory
tools
architecture constraints
verification policy
review policy
budget
```

---

## 7.1 Routing logic

```text
task arrives
     │
     ▼
architecture resolved?
   /              \
 no                yes
 │                  │
strong/frontier     ▼
planning        bounded implementation?
                 /          \
               yes           no
                │             │
             cheap/mid      stronger
                │
                ▼
           verification
                │
              pass?
             /    \
           yes     no
            │       │
          done    retry
                    │
                repeated?
                    │
                 escalate
```

The tree above routes implementation-shaped tasks. Non-implementation tasks (research, spec, review) route by role and risk from the §10.5 table.

Cheap models are appropriate when the shape of the solution is already constrained.

Frontier models are most valuable for:

```text
ambiguity
architecture
difficult debugging
security-sensitive reasoning
conflicting evidence
cross-system tradeoffs
```

---

## 7.2 Routing objective

Do not minimize:

```text
worker token cost
```

Minimize:

```text
expected lifecycle cost
=
implementation
+ verification
+ reviews
+ retries
+ human correction
+ escaped regressions
+ future architecture debt
```

A cheap worker that repeatedly fails architecture review may be more expensive than a stronger worker.

---

## 7.3 Routing maturity

Learned routing needs data volume a small operation will not have for a long time.

`P(accepted | model, skills, task type, repo, risk)` is a large conditioning space.

Early on, most cells hold two or three outcomes. That is anecdote, not policy.

Routing therefore matures in three phases.

### Phase 1 — static policy

The risk-policy table (§10.5) is the router. Full stop.

Risk level and area determine model, verification, and review. No statistics.

### Phase 2 — measured adjustment

Record outcomes per coarse bucket only:

```text
(model, area, risk)
```

Review monthly, by hand. Adjust the static table when evidence accumulates.

Example of Phase 2 evidence:

```text
Java API / R2

Model A
functional:      94%
architecture:    71%
cost/task:      $0.30

Model B
functional:      95%
architecture:    93%
cost/task:      $0.51
```

Or:

```text
Model A worker
+
architecture reviewer

accepted cost: $0.44
```

Conclusion, applied by editing the table: route Java API / R2 to Model A plus an architecture reviewer.

### Phase 3 — learned routing (future work)

Only when a bucket holds enough outcomes to trust:

```text
≥ 100 outcomes per (model, area, risk) bucket
```

may the router optimize `P(accepted | configuration)` against expected total cost automatically.

Until that bar is met, the hand-written table runs, and the data collection of Phase 2 is the only learning.

---

# 8. Worker Execution Protocol

Primary drivers:

```text
Superpowers:
- test-driven-development
- systematic-debugging
- subagent-driven-development
- verification-before-completion

pstack:
- poteto-mode
- tdd
- unslop
- interrogate
- architect when escalated
```

Worker workflow:

```text
read bounded task
       ↓
read referenced architecture
       ↓
inspect canonical patterns
       ↓
create failing test/reproduction
       ↓
implement
       ↓
refactor
       ↓
unslop
       ↓
local verification
       ↓
submit candidate
```

The worker does not determine whether the task is accepted.

---

## 8.1 Debugging escalation

Prevent agents from endlessly stacking workarounds.

```text
failure 1
diagnose

failure 2
fresh diagnosis / stronger context

failure 3
STOP PATCHING
     ↓
root-cause escalation
     ↓
strong debugger
     ↓
architecture suspicion?
     ↓
architect
```

Repeated repair failure is evidence that assumptions or architecture may be wrong.

---

# 9. Verification System

Verification asks:

> Does the real system behave correctly?

The verifier is independent from the worker.

Primary mechanisms:

```text
deterministic tests
pstack project-specific verify-* skills
gstack runtime QA
Playwright
Testcontainers
XCTest / XCUITest
Android emulator/device tooling
```

Every repository should expose deterministic instructions for:

```text
environment setup
service startup
port allocation
fixtures
authentication
runtime interaction
logs
cleanup
evidence capture
```

---

## 9.1 Web applications

Example:

```text
Backbone
   ↓
Express
   ↓
service
   ↓
database
```

Verifier:

```text
start isolated dependencies
        ↓
start backend
        ↓
start portal
        ↓
seed fixture
        ↓
open browser
        ↓
perform actual journey
        ↓
inspect network
        ↓
inspect browser console
        ↓
inspect resulting state
        ↓
capture evidence
```

Evidence may include:

```text
Playwright trace
screenshots
DOM assertions
network requests/responses
browser console
backend logs
database assertions
```

Visual verification should combine:

```text
deterministic layout/DOM/accessibility assertions
+
semantic visual review where needed
```

---

## 9.2 APIs

Prefer:

```text
application
+
Testcontainers
+
ephemeral database
+
mock/sandbox external dependencies
```

Verify:

```text
status
schema
response body
persistence effects
read-after-write
external calls
logs
authentication
authorization
idempotency
failure scenarios
boundary behavior
```

LLMs may generate scenarios.

Programs should execute assertions deterministically.

---

## 9.3 Mobile

### Android

```text
Gradle build
   ↓
emulator/device
   ↓
install
   ↓
launch
   ↓
drive UI
   ↓
inspect network
   ↓
screenshots
   ↓
adb logcat
```

### iOS

```text
xcodebuild
   ↓
Simulator / device
   ↓
XCTest / XCUITest
   ↓
drive UI
   ↓
inspect network/logs
   ↓
screenshots
```

gstack can provide richer runtime verification where appropriate.

---

## 9.4 SDKs

SDK repositories should include executable reference apps:

```text
sdk/
test-app-android/
test-app-ios/
mock-server/
contract-tests/
```

Verify:

```text
library behavior
serialization
headers
network requests
response parsing
callbacks/events
Android integration
iOS integration
runtime logs
```

---

## 9.5 Verification economics and flake control

Verification is a cost line, not an afterthought.

Ephemeral environments per task are expensive at high concurrency.

Track verification cost per task in `cost.json` (Appendix B).

### Flakes

Flaky runtime verification is the main threat to:

> Completion status can be trusted.

A flaky verifier:

```text
trains humans to ignore failures
trains the learning loop on noise
```

Requirements:

```text
quarantine list for flaky checks

retry-once-then-quarantine, automatic

flake rate as a first-class metric (Appendix D)
```

Every verifier failure is classified before entering the learning loop:

```text
PRODUCT FAILURE
ENVIRONMENT FAILURE
FLAKE
```

Unclassified failures poison retrospectives.

### Tiered depth

Verification depth follows the §10.5 risk table.

```text
R0/R1   deterministic checks / smoke
R2      runtime verification
R3+     full isolated runtime environment
```

R0/R1 tasks do not pay for full runtime environments.

---

# 10. Quality and Review Gates

A candidate passes four dimensions.

| Gate | Question | Primary mechanism |
|---|---|---|
| Functional | Does it work? | deterministic/runtime verifier |
| Specification | Did we build the requested behavior? | Matt spec review |
| Architectural | Did we preserve intended system shape? | pstack + design authority |
| Evolutionary | Is this healthy reference code for future changes? | codebase-design + quality review |

---

## 10.1 Specification review

Check:

```text
missing requirements
incorrect interpretation
unrequested scope
partial implementation
acceptance criteria
important edge cases
```

Primary driver:

```text
Matt code-review spec axis
```

---

## 10.2 Code quality

Primary drivers:

```text
Matt standards review
Superpowers code-quality review
pstack /unslop
pstack /interrogate
```

Detect:

```text
unnecessary abstractions
duplicate concepts
shallow wrappers
dead code
fragile tests
poor naming
excessive configuration
hidden scope growth
cargo-culted patterns
```

The goal is deliberate code, not stylistic perfection.

---

## 10.3 Architecture review

The architecture gate has two layers.

```text
candidate
    ↓
Layer 1
deterministic architecture enforcement
    │
    ├── fail → reject, no LLM spend
    │
    ▼
Layer 2
LLM architecture review
residual judgment only
```

An LLM judging LLM output shares blind spots with the worker.

Correlated judges fail together.

Therefore:

> Every invariant that can be a machine check must be a machine check.

The LLM layer exists only for what cannot be mechanized.

A functionally correct implementation can fail this gate.

### Layer 1 — deterministic enforcement

Mechanically checkable invariant classes:

```text
import / dependency-boundary rules
forbidden APIs
module ownership manifests
required-seam usage
forbidden mutations
duplicate-domain-concept heuristics
```

Tooling by ecosystem:

```text
JVM      ArchUnit
JS/TS    eslint-plugin-boundaries, dependency-cruiser
Python   import-linter
any      grep-grade forbidden-API rules, custom AST checks
```

Ownership manifests declare which module owns which
directory, table, and public interface.

CI fails when a change crosses an ownership line
without a manifest update approved by design authority.

Duplicate-concept heuristics are weaker but useful:

```text
new class name fuzzy-matches domain vocabulary
new table resembling an existing entity
second implementation of a canonical seam's signature
```

These warn rather than block, and route to Layer 2.

Rules are expressed as policy in the repo:

```yaml
# .agent/policies/architecture.yaml

invariants:

  - id: ARCH-SESSION-PERSISTENCE
    rule: forbidden-dependency
    from: "**/controllers/**"
    to: "**/persistence/session/**"
    message: >
      Controllers cannot mutate session persistence directly.
      Use SessionService.

  - id: ARCH-DELETION-SEAM
    rule: required-call
    when_touching: "**/account/deletion/**"
    require_any:
      - AccountService.delete
    forbid:
      - AccountRepository.updateStatus
    message: >
      Deletion state changes only through AccountService.delete().

  - id: ARCH-REVOKE-SEAM
    rule: required-call
    when_calling: AccountService.delete
    require:
      - SessionService.revokeAll
    message: >
      Deletion must revoke sessions through the canonical seam.

  - id: ARCH-ACCOUNT-OWNERSHIP
    rule: ownership
    owner: account-service
    paths:
      - "services/account/**"
      - "db/migrations/account_*"
    message: >
      AccountService owns account lifecycle.
      Cross-module writes require a design-authority decision.
```

These rules run twice:

```text
worker-local verification
fast feedback, cheap repair

        +

independent verifier
authoritative, worker cannot skip it
```

The policy file is code.

It is reviewed, versioned, and evolved like code.

### Layer 2 — LLM architecture review

Reserved for judgment that cannot be mechanized:

```text
new abstractions
duplicate concepts
design intent vs ADR
API boundary taste
is this healthy reference code
```

The mechanical layer strips the noise so the LLM
reviews only the residual questions.

The shrinking rule:

> When the LLM reviewer catches a violation that could
> have been a mechanical rule, the retrospective's
> required output is that rule.

```text
LLM catches mechanizable violation
          ↓
retrospective
          ↓
new architecture.yaml rule
          ↓
Layer 1 grows
Layer 2 shrinks
```

A Layer 2 gate that stays the same size is not learning.

### Judge decorrelation

Where the LLM layer remains:

```text
different model family
reviewer ≠ implementer
```

The reviewer sees:

```text
diff
spec
architecture refs
canonical map
```

The reviewer does not see:

```text
worker transcript
worker rationalizations
worker self-assessment
```

A worker that can explain its shortcut to the judge
will convince a correlated judge.

---

## 10.4 Decorrelated reviewers

Higher-risk tasks should use independent lenses:

```text
                       candidate
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
        Spec           Quality        Architecture
       review           review           review
           │               │               │
           └───────────────┼───────────────┘
                           ▼
                      adjudication
```

Add a fourth security/adversarial lens for sensitive tasks.

pstack `/interrogate` is useful for multi-model review.

---

## 10.5 Risk policy

| Risk | Example | Required process |
|---|---|---|
| R0 | docs/formatting | cheap worker + deterministic checks |
| R1 | small local/UI change | cheap worker + smoke verification |
| R2 | normal feature | runtime verification + review |
| R3 | auth/API/schema/core behavior | strong planning + architecture review + integration/runtime verification |
| R4 | security/critical architecture/data migration | frontier design + multiple reviews + human approval + staged release |

Not every task pays the maximum review cost.

---

# 11. Merge, Release, and Production Validation

Workers should not merge directly.

```text
accepted candidate
       ↓
merge queue
       ↓
rebase
       ↓
CI
       ↓
integration/regression checks
       ↓
main
       ↓
staging
       ↓
runtime verification
       ↓
canary
       ↓
production
```

Initial shipping drivers:

```text
gstack ship
gstack deploy
gstack canary
existing CI/CD
```

At higher concurrency, introduce a dedicated **merge refinery** responsible for:

```text
serializing conflicting changes
preventing stale merges
rerunning integration verification
protecting main
```

Critical changes should support staged rollout and rollback.

---

## 11.1 Semantic integration

The task DAG captures known ordering only.

Two independently correct concurrent tasks can be jointly wrong:

```text
T1 verified ✓
T2 verified ✓
        ↓
     merged
        ↓
combined behavior wrong
```

No textual conflict. A semantic one.

The merge refinery therefore does more than serialize:

```text
rerun the FULL verification suite of every task
merged since each candidate's base commit
(or a bounded regression set)

detect overlap via the task schema's
`payload.areas` field (implementation tasks)

force sequential merge for overlapping
high-risk tasks
```

A post-merge verification failure is a system event:

```text
pause the merge queue
        ↓
diagnose
        ↓
resume
```

It is never silently retried.

---

# 12. Memory and Architecture Health

## 12.1 Field Guide memory

Memory stores durable discoveries, not transcripts.

Suggested structure:

```text
.agent/memory/

index.md
frontend.md
java-api.md
mobile.md
auth.md

discoveries/
incidents/
```

Good:

```text
Legacy mobile clients expect the error envelope
with HTTP 200 for this endpoint.

Do not normalize to HTTP 401 without checking
backward compatibility.
```

Bad:

```text
Claude tried changing this once and it failed.
```

---

## 12.2 Memory authority

### Tier A — operational facts

Examples:

```text
build command
third-party quirk
test-environment limitation
```

Workers may propose; verifiers can approve.

### Tier B — domain knowledge

Examples:

```text
business terminology
state transitions
compatibility rules
```

Domain/spec authority approves.

### Tier C — architecture

Examples:

```text
ownership
canonical seams
dependency direction
architectural invariants
```

Design authority approves.

A normal worker cannot establish architectural truth simply by writing memory.

---

## 12.3 Architecture health

PR review catches local damage.

Architecture-health agents detect accumulated damage.

Primary skill:

```text
Matt improve-codebase-architecture
```

Periodically inspect:

```text
recently hot code
new abstractions
shallow modules
dependency growth
duplicate concepts
high-conflict files
frequent agent confusion
```

Also track file contention:

```text
file size
touch frequency
concurrent modifications
merge conflicts
unrelated responsibilities
```

A heavily contested file should trigger an architecture-health task rather than unlimited parallel modification.

---

## 12.4 Artifact freshness

Curated artifacts rot:

```text
canonical/legacy map
Field Guide memory
repo.yaml
feature maps
ownership manifests
mission artifacts (research findings,
product requirements)
```

A stale canonical map is worse than none.

Agents trust it.

Every durable artifact therefore carries three things:

### Owner

A role, not a person.

```text
canonical map        design authority
Tier A memory        verifier fleet
Tier B memory        domain authority
repo.yaml            repo maintainer role
feature maps         mission planner
mission artifacts    owning mission's planner
```

Unowned artifacts are deleted or demoted.

### Staleness trigger

A mechanical condition that flags or fails the artifact.

```text
canonical map entries reference symbols
→ CI fails if a symbol no longer exists

memory entries carry a verified date and code refs
→ change to referenced code queues re-verification
→ unverified past bound: expired

repo.yaml commands
→ executed in CI; a broken command fails the build

feature maps reference routes/screens
→ checked against the running app by verifiers

research findings carry a verified date
→ the fastest-rotting class; re-verify before
  a later mission reuses them
```

Expiry is a task for the owning role, not silence.

### Trust decay rule

> Agents treat artifacts past their freshness bound
> as hints, not truth.

```text
fresh artifact
cite it, rely on it

stale artifact
verify against code before relying
propose refresh or expiry
```

An artifact that cannot name its owner and its
staleness trigger should not be created.

---

# 13. Continual Agent Improvement

The fleet itself must improve from real engineering outcomes.

Primary ingredients:

```text
pstack /reflect
pstack /automate-me
pstack skill eval methodology
Cursor-style continual learning
our Learning Evaluator
```

---

## 13.1 Learning inputs

Do not analyze conversation alone.

Join:

```text
task
transcript
decision trail
diff
verification
reviews
retries
model/configuration
tokens
cost
human corrections
later defects
reverts
production telemetry
future refactors
```

---

## 13.2 Fast loop: task retrospective

Trigger on:

```text
failed task
architecture rejection
human correction
high-cost run
unexpected escalation
rollback
unusually strong success worth learning from
```

Ask:

### What happened?

Example:

```text
cheap worker
→ functional pass
→ architecture fail
→ repair
→ fail
→ stronger worker
→ pass
```

### Why?

Classify:

```text
SPEC
PLANNING
ARCHITECTURE
ROUTING
CONTEXT
SKILL
MEMORY
HARNESS
TOOLING
CODEBASE
MODEL
```

### What should change?

Possible interventions:

```text
skill
lint rule
test
architecture invariant
canonical pattern
verification harness
Field Guide
router policy
task-decomposition policy
tooling
```

Prefer making mistakes impossible over adding more prose instructions.

`/reflect` produces candidate lessons, not automatic permanent policy.

---

## 13.3 Slow loop: fleet learning

Aggregate many tasks.

Example:

```text
last 500 backend tasks
         ↓
cluster failure causes
         ↓
31% of architecture rejects involve
bypassing transaction ownership
         ↓
identify systemic cause
         ↓
propose system change
         ↓
evaluate candidate
```

Use `/automate-me` and fleet-level analysis to identify repeated patterns.

One unusual task is anecdote.

Repeated evidence can justify policy.

---

## 13.4 Version agent configurations

Treat agent configurations like software:

```text
backend-worker@23
planner@8
portal-verifier@11
```

Evaluate the full combination of:

```text
model
instructions
skills
context strategy
memory
tools
verification
review requirements
budgets
```

rather than attributing outcomes only to the base model.

---

## 13.5 Historical and hidden evals

Actual failures become reusable eval cases:

```text
.agent/evals/

architecture/
backend/
frontend/
android/
ios/
debugging/
migrations/
```

Example:

```yaml
id: ARCH-017

repo_snapshot: abc123

task:
  Implement account deletion.

known_failure:
  Worker bypassed SessionService.

required:
  - SessionService.revokeAll

forbidden:
  - direct session persistence mutation
```

Evaluation should contain three layers:

```text
VISIBLE
unit/integration tests
acceptance criteria
repository standards

        +

INDEPENDENT / HIDDEN
additional scenarios
architecture checks
mutation tests
cross-feature regressions
adversarial cases

        +

PRODUCTION
canary telemetry
errors
rollbacks
```

This prevents agents from merely optimizing the known grader.

---

## 13.6 Agent canaries

Do not update the whole fleet at once.

```text
worker-v23
   └── 90%

worker-v24
   └── 10%

      ↓

compare:
functional quality
architecture quality
cost
retries
human intervention

      ↓

better?
 /       \
yes       no
 │         │
25%      rollback
 ↓
50%
 ↓
100%
```

Skills, prompts, context strategies, workflow templates, and model-routing changes should be deployed like production software.

In-flight missions pin the template version they started with. A template version bump applies to new missions only.

---

# 14. Scaling Model and Human Interface

## 14.0 Promotion gates

Each rung of the scaling ladder is earned, not scheduled.

The binding constraint is human attention:

```text
                          human minutes available / day
sustainable tasks/day ≈ ─────────────────────────────────
                        escalation rate × minutes/escalation
```

Worked example:

```text
human exception budget:   240 min/day
escalation rate:          10%
minutes per escalation:   20

240 / (0.10 × 20) = 120 tasks/day

at 5% and 15 min:

240 / (0.05 × 15) = 320 tasks/day
```

Escalation rate does not fall because concurrency rises.

It falls because verification, review, and the learning loop improve.

Promote only when the metrics of Appendix D prove it, sustained over a trailing window:

| Promotion | First-pass verification | Escalation | Human min / accepted task | Window |
|---|---|---|---|---|
| 5 → 20 | ≥ 80% | ≤ 10% | ≤ 15 | 50 tasks |
| 20 → 50 | ≥ 85% | ≤ 7% | ≤ 8 | 200 tasks |
| 50 → 100+ | ≥ 90% | ≤ 4% | ≤ 4 | 500 tasks |

These thresholds are initial targets to be tuned from fleet data, not gospel.

The shape is the requirement: measured, sustained, per-rung.

Demotion is symmetric:

```text
thresholds regress
      ↓
reduce concurrency to the last rung
where thresholds held
      ↓
fix the cause via the learning loop
      ↓
re-earn promotion
```

Concurrency is a controlled variable, not a goal.

Running 100 agents that saturate one human produces unreviewed merges, which is precisely the architecture-degradation failure this system exists to prevent.

---

## 14.1 1–5 agents

```text
Human
  ↓
Hermes/task board
  ↓
3–5 workers
  ↓
independent verifier
```

Human focus:

```text
observe failure modes
improve task quality
review architecture
improve verification
build eval corpus
```

Goal:

> Learn why agents still require babysitting.

---

## 14.2 5–20 agents

```text
                   Human
                     │
                   Hermes
                     │
                Lead Planner
                     │
       ┌─────────────┼─────────────┐
       ▼             ▼             ▼
    backend       frontend       mobile
      pool           pool          pool
       │             │             │
       └─────────────┼─────────────┘
                     ▼
                verifier pool
                     │
                merge refinery
```

Required before reaching this stage:

```text
task DAGs
design authority
isolated environments
evidence bundles
model routing
retry budgets
independent verification
architecture review
exception dashboard
```

---

## 14.3 20–50 agents

Introduce hierarchy.

```text
                         Human
                           │
                   Portfolio Planner
                           │
       ┌───────────────────┼───────────────────┐
       ▼                   ▼                   ▼
   Portal Lead          API Lead           Mobile Lead
       │                   │                   │
   worker cell         worker cell         worker cell
       │                   │                   │
   verifier            verifier            verifier
```

Leads hold scoped design authority.

Cross-domain architectural changes escalate upward.

---

## 14.4 50–100+ agents

One planner should not manage every worker.

```text
                           Human
                             │
                   Portfolio Controller
                             │
                       mission queue
                             │
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
     Portal Org            API Org           Mobile Org
         │                   │                   │
      planners            planners            planners
         │                   │                   │
     worker cells        worker cells        worker cells
         │                   │                   │
         └───────────────────┼───────────────────┘
                             ▼
                      verifier fleet
                             │
                      merge refinery
                             │
                     release platform
                             │
                       observability
                             │
                    learning evaluator
```

Hermes can remain useful at team level.

A distributed control plane becomes appropriate above it.

Gas Town / Gas City concepts are useful references for:

```text
persistent task ledger
hierarchical delegation
worker supervisors
dedicated merge refinery
large concurrent fleets
```

---

## 14.5 Human attention

Humans should monitor exceptions, not agent activity.

Do not prioritize:

```text
agent reading file
agent running test
agent writing code
```

Surface:

```text
architecture ambiguity
contradictory requirements
repeated verification failure
security-sensitive discovery
budget exhaustion
review disagreement
semantic merge conflict
production regression
```

Example dashboard:

```text
ACCOUNT MANAGEMENT                    87%

Backend                   ✓
Portal                    ✓
Android                   ●
iOS                       ●
Security                  ✓
Integration               ✓

Tasks                   47 / 54
First-pass success          84%
Architecture pass           91%
Retries                      6
Escalations                  2
Human decisions              1

Spend
Planning                   $8
Implementation            $24
Verification               $7
Review                      $5

TOTAL                      $44
```

---

# 15. MVP and Build Plan

Do not build a 100-agent platform first.

The first milestone is:

> Five independent tasks can be delegated without watching the workers, completion status can be trusted, architectural shortcuts are rejected before becoming reference code, and failures automatically enter the learning system.

Initial stack:

```text
Hermes
+
mission + workflow registry
+
repository operating contract
+
domain/spec pipeline
+
design authority
+
task schema
+
risk/model policy
+
pstack/Superpowers workers
+
repo-specific verification
+
spec and architecture review
+
evidence bundles
+
retrospective/eval capture
```

Workflow:

```text
human mission
      ↓
select / instantiate workflow
      ↓
resolve uncertainty
      ↓
domain + spec
      ↓
architecture
      ↓
task DAG
      ↓
Hermes schedules
      ↓
workers implement
      ↓
runtime verification
      ↓
spec / quality / architecture review
      ↓
automatic repair where possible
      ↓
merge refinery
      ↓
deploy / canary
      ↓
production telemetry
      ↓
learning evaluator
```

Only after this works reliably should concurrency increase.

The MVP workflow library contains only:

```text
project-definition
feature-development
bug-fix
```

Additional workflows reuse the same primitives and role contracts and should be added only when repeated work justifies them.

In the MVP, the deploy / canary / production stages above run through existing CI/CD and gstack (§11). The dedicated `release` workflow packages them only once release automation earns its own template.

---

# 16. Fleet Security Model

Agents read untrusted text and run arbitrary commands.

Both are attack surfaces.

## 16.1 Prompt injection

Workers read:

```text
repository content
tickets
dependency code
web content
error messages
```

Any of it can contain text written to steer an agent.

Defenses:

```text
repo/ticket text is data, not instructions,
wherever the harness can enforce it

high-risk actions gated by policy,
never by model judgment alone

verifiers and reviewers never execute
instructions found inside the diff under review
```

A reviewer that obeys the code it is reviewing is not independent.

## 16.2 Secrets

Evidence bundles (Appendix B) capture:

```text
transcripts
logs
network traffic
screenshots
```

All of these can leak credentials.

Requirements:

```text
secret-scanning + redaction on evidence capture,
before storage

workers receive scoped, short-lived credentials

no worker holds org-wide secrets
```

## 16.3 Sandboxing

Workers run arbitrary build and test commands.

Each worker gets:

```text
isolated environment (container/worktree)
least-privilege network egress
no production credentials
```

Anything touching production requires escalation.

## 16.4 Supply chain

Adding a dependency changes what every future agent trusts.

It is a policy decision, not worker freedom.

It appears in the §5.2 escalation list:

```text
new third-party dependency
```

Treat it as R3+.

---

# Appendix A — Repository Operating Contract

Each repository should be self-describing to agents.

```text
.agent/

    repo.yaml

    workflows/
        project-definition.yaml
        feature-development.yaml
        bug-fix.yaml

    missions/

    domain/
        CONTEXT.md

    architecture/
        system.md
        services.md
        canonical-patterns.md
        adr/
        design/

    features/
        feature-map.yaml
        journeys/

    policies/
        risk.yaml
        models.yaml
        escalation.yaml
        architecture.yaml

    verification/
        web/
        api/
        android/
        ios/

    memory/

    evals/

    runs/
```

Example `repo.yaml`:

```yaml
name: portal

type:
  - backbone
  - express

setup:
  - npm install

services:
  api:
    command: npm run api
    health: http://localhost:${API_PORT}/health

  portal:
    command: npm run portal
    health: http://localhost:${WEB_PORT}

dependencies:
  postgres:
    container: true

verification:
  unit:
    command: npm test

  lint:
    command: npm run lint

  browser:
    skill: verify-portal
```

---

# Appendix B — Evidence Contract

Each mission preserves its selected workflow and artifact graph:

```text
.agent/missions/PROJECT-CODING-GRADER/

mission.yaml
workflow-instance.yaml
artifacts/
summary.json
```

Each task run should preserve enough evidence to reproduce and evaluate it.

```text
.agent/runs/ACCOUNT-12/

task.yaml
transcript.jsonl
decisions.tsv
diff.patch

verification/
    result.json
    api.json
    screenshots/
    logs/
    trace.zip

reviews/
    spec.json
    quality.json
    architecture.json

cost.json
result.json
retrospective.json
```

Example result:

```json
{
  "task": "ACCOUNT-12",
  "commit": "42f81c9",
  "functional": "PASS",
  "specification": "PASS",
  "architecture": "PASS",
  "evolutionary": "PASS",
  "verifier": "api-verifier-03"
}
```

---

# Appendix C — Skill Ownership

| Responsibility | Primary driver |
|---|---|
| Mission/workflow selection | Platform workflow registry; Matt `ask-matt` may advise planning depth |
| Project-definition workflow | Composition of existing role contracts; no new monolithic spec skill |
| Large uncertain mission | Matt `wayfinder` |
| Research | Matt `research` |
| Prototype | Matt `prototype` |
| Requirement interrogation | Matt `grill-with-docs` |
| Domain modeling | Matt `domain-modeling` |
| Engineering-spec synthesis | Matt `to-spec` |
| Architecture | pstack `/architect` |
| Architecture competition | pstack `/arena` |
| Codebase design principles | Matt `codebase-design` |
| Task decomposition | Matt `to-tickets` |
| Orchestration | Hermes |
| Implementation discipline | Superpowers + pstack |
| TDD | Superpowers / pstack |
| Debugging | Superpowers + Matt diagnosing-bugs |
| Code cleanup | pstack `/unslop` |
| Adversarial review | pstack `/interrogate` |
| Browser QA | gstack + Playwright |
| API QA | deterministic harness |
| iOS QA | gstack + XCTest |
| Spec review | Matt code-review |
| Code-quality review | Matt + Superpowers |
| Architecture review | pstack + codebase-design |
| Shipping | gstack |
| Memory | Field Guide model |
| Task retrospective | pstack `/reflect` |
| Longitudinal transcript mining | pstack `/automate-me` |
| Skill evaluation | pstack eval methodology |
| Architecture hygiene | Matt `improve-codebase-architecture` |
| Large-fleet architecture | Gas Town/Gas City concepts |

These tools are ingredients, not competing operating systems.

---

# Appendix D — Fleet Metrics

Do not optimize:

```text
commits
lines of code
active agents
tokens generated
```

Track:

```text
verified accepted tasks / day
cost / accepted task
human minutes / accepted task

first-pass verification %
spec-review pass %
architecture-review pass %

retry %
escalation %
merge-conflict %
rollback %
escaped-regression %
verification flake %

READY → DONE latency
```

Mission metrics:

```text
cost / approved spec
mission cycle time (goal → approved outputs)
spec-review pass % (project-definition)
child-mission rework %
```

Architecture-health metrics:

```text
duplicate concepts
new shallow modules
dependency violations
hot files
architecture-related reverts
rapid post-merge refactors
```

The governing optimization is:

```text
                        accepted verified changes
Fleet efficiency = ─────────────────────────────────────
                   dollars + human attention + future debt
```

---

# Appendix E — Governing Operating Model

```text
Humans determine
WHAT MATTERS.

Workflow templates determine
WHICH ENGINEERING PROCESS APPLIES.

Exploration agents determine
WHAT IS UNKNOWN.

Domain/spec agents determine
WHAT BEHAVIOR IS REQUIRED.

Architects determine
WHAT SHAPE THE SYSTEM SHOULD HAVE.

Task planners determine
WHAT CAN BE DELEGATED.

Routers determine
WHO SHOULD DO IT AND AT WHAT COST.

Workers implement
BOUNDED CHANGES.

Verifiers prove
THE BEHAVIOR WORKS.

Reviewers prove
THE CHANGE FITS THE SPEC AND ARCHITECTURE.

Release systems determine
WHETHER IT IS SAFE IN PRODUCTION.

Memory preserves
VERIFIED KNOWLEDGE.

The Learning Evaluator improves
THE ENGINEERING SYSTEM ITSELF.

The Control Plane keeps
EVERYTHING MOVING.
```

The long-term objective is not one extremely capable coding agent.

It is an engineering organization where inexpensive agents can perform most execution safely because architecture, verification, review, memory, and continual evaluation constrain which local decisions are allowed to become permanent.

---

# Appendix F — Role Contracts

The pipeline names tools (Matt, pstack, Superpowers, Hermes, gstack, Gas Town) at every critical junction.

Those names are default bindings, not dependencies.

Each stage is a **role** with a contract: inputs, outputs, acceptance bar, failure behavior. Any tool that fails its contract is replaced without redesigning the system. The system depends on the contracts. It never depends on the tools.

---

## F.0 Mission Router / Workflow Compiler

Default binding: platform workflow registry. Matt `ask-matt` may advise planning depth inside project-definition, but does not own platform routing.

**Inputs**

```text
mission contract (§6.0)
available workflow templates (§3.2)
repository/project context
risk and budget policies
```

**Outputs**

A versioned workflow instance:

```yaml
workflow_instance:
  mission: PROJECT-CODING-GRADER
  template: project-definition
  version: 1

  stages:
    - id: research-sandbox
      role: uncertainty-resolver
      type: research
      outputs: [artifact://research/sandboxing.md]

    - id: domain-product
      role: domain-product-clarifier
      depends_on: [research-sandbox]
      outputs: [domain/CONTEXT.md, product-requirements.md]

    - id: architecture
      role: architect
      depends_on: [research-sandbox, domain-product]
      outputs: [architecture-design]

    - id: specification
      role: specifier
      depends_on: [domain-product, architecture]
      outputs: [project-spec]

    - id: spec-review
      role: reviewer
      depends_on: [specification]
      human_gate: spec-approval
      outputs: [approved-project-spec]

    - id: decompose
      role: task-decomposer
      depends_on: [spec-review]
      outputs: [implementation-task-graph]

    - id: create-implementation-mission
      type: child-mission
      depends_on: [decompose]
      gated_by: spec-approval
```

It may fan out stages with independent dependencies.

**Done means**

Every workflow node maps to a role contract in Appendix F, every dependency is explicit, required mission outputs are covered, and every human gate has a named point in the DAG. The compiler performs composition only; it does not invent product or architecture decisions.

**Failure modes**

```text
workflow duplicates reasoning already owned by a role
required mission output has no producing stage
hidden dependency between stages
workflow routes around a required review/human gate
router makes architecture decisions
```

**On underdelivery:** workflow validation rejects the instance before any task becomes READY. Rebinding or template repair changes the workflow compiler/template, not the downstream role contracts.

---

## F.1 Uncertainty Resolver / Researcher

Default binding: Matt `wayfinder` / `research` / `prototype`.

**Inputs**

```text
mission statement
open questions
repository access
prototype budget (time + dollars)
```

**Outputs**

```yaml
investigation:
  mission: account-deletion
  questions_resolved:
    - q: who owns session persistence?
      answer: SessionService, exclusively
      confidence: high
      evidence: [link to code, transcript, prototype result]
  questions_open:
    - backward compatibility for v1 mobile clients
  decisions_proposed:
    - deletion must be asynchronous
  prototypes_deleted: true
```

**Done means**

Every question is answered with cited evidence, escalated as still-open, or explicitly descoped. Prototype code is deleted. No production code produced.

**Failure modes**

```text
answers without evidence
prototype survives into a branch
open question silently dropped
```

**On underdelivery:** downstream domain/product, architecture, or specification stages refuse input containing unresolved high-risk questions; task returns to READY for a different resolver binding or human. Surviving prototype code is rejected at merge refinery (no task ref).

---

## F.1A Domain / Product Clarifier

Default binding: Matt `grill-with-docs`, `domain-modeling`.

**Inputs**

```text
mission goal and human constraints
resolved/cited investigation artifacts (F.1)
existing domain context, if any
```

**Outputs**

```text
domain/CONTEXT.md updates
product-requirements.md
explicit product decisions
open product questions, if any
```

Requirements describe observable behavior and evidence expectations, not architecture that has not yet been decided.

**Done means**

Canonical vocabulary is defined; behavioral requirements are observable and falsifiable; material product ambiguity is resolved by the human or explicitly marked blocking. No consequential architecture is silently chosen.

**Failure modes**

```text
invented duplicate domain vocabulary
implementation choice disguised as a requirement
open product question silently guessed
research conclusion copied without evidence/ref
```

**On underdelivery:** architecture (F.3) refuses requirements with unresolved high-risk product questions or conflicting domain terminology. The workflow returns the artifact to this role rather than allowing the architect or final specifier to guess.

---

## F.2 Specifier

Default binding: Matt `to-spec`.

**Inputs**

```text
resolved investigation/research artifacts (F.1)
domain/product requirements (F.1A)
architecture/design decisions (F.3)
human constraints
```

**Outputs**

A canonical engineering spec synthesizing the approved upstream artifacts, containing per feature:

```text
observable journey
requirements (testable statements)
non-goals
edge cases considered
verification: what evidence would prove this works
```

Each requirement must map to at least one verification line usable in a task's `payload.acceptance` and `payload.verification` blocks (§6.1).

**Done means**

Every requirement is observable and falsifiable. The verification section is executable in principle by F.7 without asking the author anything. The spec synthesizes and references upstream research/ADRs rather than re-copying their contents.

**Failure modes**

```text
requirements stated as implementation ("use Redis")
no evidence definition
vocabulary invented outside the domain model
```

**On underdelivery:** decomposer (F.4) refuses specs whose requirements lack verification mappings — spec bounces back, it does not flow forward. Spec review (F.8) later scores against this same document; an unusable spec fails there, attributed to SPEC in the retrospective taxonomy (§13.2).

---

## F.3 Architect / Design Authority

Default binding: pstack `/architect`, `/arena`.

**Inputs**

```text
domain/product requirements (F.1A)
resolved investigation evidence (F.1)
existing ADRs and canonical-pattern map
risk classification
competing design options (for /arena cases)
```

**Outputs**

A durable ADR/design document, plus the machine-readable block workers receive (§5.1, §6.1):

```yaml
design:
  authority: account-mission-planner
  decision_refs: [ADR-021]
  required_seams: [AccountService.delete, SessionService.revokeAll]
  forbidden: [direct session persistence mutation]
  invariants:
    - AccountService owns account lifecycle
```

**Done means**

Ownership, dependency direction, seams, and invariants are stated concretely enough that F.8 architecture review can check conformance mechanically-ish, and F.6 workers can escalate against a named authority. Every R3+ task references at least one decision_ref.

**Failure modes**

```text
invariants too vague to review against
no named escalation owner
decision contradicts an existing ADR without superseding it
```

**On underdelivery:** worker escalations (§5.2) go unanswered → tasks stall in RUNNING → control plane surfaces this as an exception, not silence. Architecture-review rejections that cluster on "no applicable decision_ref" trigger a PLANNING/ARCHITECTURE retrospective and rebinding.

---

## F.4 Task Decomposer

Default binding: Matt `to-tickets`.

**Inputs**

```text
spec (F.2)
architecture block (F.3)
risk policy (§10.5)
budget policy
```

**Outputs**

An implementation task DAG. Every node conforms to the generic §6.1 envelope with `type: implementation`, fully populated:

```text
id, mission, workflow step
dependencies
risk
inputs / outputs
budget (attempts, dollars)
payload.design (authority, decision_refs, seams, forbidden)
payload.acceptance (traceable to spec requirements)
payload.verification (traceable to spec evidence)
```

**Done means**

Tasks are vertical tracer bullets producing independently demonstrable behavior (§4.6). Union of task acceptance criteria covers every spec requirement. No cycles. No task requires the worker to make an architectural decision.

**Failure modes**

```text
horizontal chores ("write tests")
spec requirement covered by no task
missing budget or risk
task depends on undelivered architecture decision
```

**On underdelivery:** control plane rejects tasks failing schema validation at intake — malformed tasks never reach READY. Coverage gaps surface at spec review as "partial implementation" and are attributed to PLANNING.

---

## F.5 Control Plane / Scheduler

Default binding: Hermes.

**Inputs**

```text
validated workflow/task DAG (F.0 and, for implementation, F.4)
routing policy (§7)
role/worker/verifier pool registrations
```

**Outputs / guarantees**

```text
durable tasks        survive process crash; no task lost or duplicated
lifecycle states     generic §6.3 lifecycle + type-specific gates, transitions logged
leases               expired lease → task safely reclaimed, work discarded or resumed
retries              bounded by task budget.attempts; each retry recorded
crash recovery       restart resumes from persisted state, idempotently
routing              cheapest capable configuration per §7.1, decision logged
dashboard            exception surface per §14.5
mission linkage      every task/state transition remains linked to mission + workflow version
```

Every state transition is appended to the run record (Appendix B) with timestamp, actor, and reason.

**Done means**

Kill any component at any moment; on restart, no task is lost, double-assigned, or stuck outside the state machine. Budgets are enforced, never advisory.

**Failure modes**

```text
task stuck in ASSIGNED with dead worker and live lease
retry beyond budget
two workers on one task
lost state after crash
```

**On underdelivery:** this role has no downstream safety net — it is the safety net. Contract violations here are detected by audit (state log vs. observed work) and are grounds for immediate rebinding. Hermes is the initial binding precisely because §14.4 already anticipates replacing it above team scale.

---

## F.6 Worker

Default binding: pstack/Superpowers execution discipline (§8).

**Inputs**

```text
one bounded task (§6.1 schema, complete)
referenced ADRs and canonical patterns
repository operating contract (Appendix A)
budget
```

**Outputs**

A candidate change, never a merge:

```text
diff.patch
transcript.jsonl
decisions.tsv
local verification results
escalations raised (if any)
cost.json
```

placed in the run directory (Appendix B).

**Done means**

Candidate submitted within budget; failing test written before implementation; required seams used; forbidden list untouched; §5.2 escalation triggers honored — architectural questions stopped, not improvised. The worker never certifies itself (§2).

**Failure modes**

```text
silent architectural invention
workaround stacking past the 3-failure rule (§8.1)
budget overrun
green-by-weakening-tests
```

**On underdelivery:** verification (F.7) and review gates (F.8) exist precisely because this role is untrusted. Repeated rejects consume budget.attempts → escalation to stronger configuration (§7.1). Per-configuration acceptance rates feed learned routing (§7.3); a binding that cannot clear the gates prices itself out.

---

## F.7 Verifier

Default binding: gstack, `verify-*` skills, Playwright/Testcontainers.

**Inputs**

```text
candidate change (F.6)
task verification list (§6.1)
repo.yaml verification commands (Appendix A)
isolated environment
```

**Outputs**

Evidence bundle per Appendix B:

`verification/result.json`:

```json
{
  "task": "ACCOUNT-12",
  "commit": "42f81c9",
  "checks": [
    {"name": "api-runtime", "status": "PASS", "evidence": "api.json"},
    {"name": "persistence", "status": "FAIL", "evidence": "logs/db.log"}
  ],
  "environment": "ephemeral-postgres-14",
  "reproducible_with": ".agent/verification/api/run.sh"
}
```

plus screenshots, traces, logs as applicable (§9.1).

**Done means**

Every line of the task's `verification:` block produced a deterministic PASS/FAIL with attached evidence, executed independently of the worker, in isolation, reproducibly. LLMs may pick scenarios; programs assert (§9.2).

**Failure modes**

```text
vacuous pass (nothing actually exercised)
evidence missing or unreproducible
shared environment contamination
verifier trusts worker's own test run
```

**On underdelivery:** review gates refuse candidates whose evidence bundle is incomplete — a PASS without evidence is treated as FAIL. Escaped regressions traced to a verifier binding are attributed HARNESS/TOOLING and become hidden evals (§13.5).

---

## F.8 Reviewer (artifact / spec / quality / architecture lenses)

Default bindings: Matt code-review (spec), Matt + Superpowers + `/unslop` (quality), pstack + codebase-design / `/interrogate` (architecture and adversarial artifact review).

**Inputs**

The reviewed object depends on workflow stage.

```text
PROJECT-DEFINITION REVIEW

candidate engineering spec (F.2)
original mission goal / human constraints
research evidence (F.1)
domain/product requirements (F.1A)
design block + ADRs (F.3)

CODE REVIEW

candidate diff + evidence bundle (F.7)
engineering spec (F.2)
design block + ADRs (F.3)
risk level → which lenses are mandatory (§10.5)
```

**Outputs**

One verdict file per required lens (stored with the mission artifact or task run):

```json
{
  "lens": "architecture",
  "artifact": "project-spec.md",
  "verdict": "FAIL",
  "findings": [
    {
      "kind": "unsupported-design-claim",
      "detail": "spec assumes synchronous deletion despite ADR-021",
      "ref": "ADR-021",
      "location": "project-spec.md#account-deletion"
    }
  ],
  "reviewer": "arch-reviewer-02"
}
```

**Done means**

Each mandatory lens returns PASS/FAIL with findings citing the reviewed artifact, source evidence, spec lines, or decision_refs — never taste alone. Lenses are decorrelated: independent contexts, no shared verdict (§10.4).

For project-definition, the default lenses are:

```text
intent/coverage       does the spec match the mission and product decisions?
research grounding    are factual claims supported by cited evidence?
architecture          does the spec conform to ADRs/system design?
ambiguity             could downstream agents interpret a requirement differently?
```

For implementation, the normal spec / quality / architecture lenses apply. A functional PASS can still fail review.

**Failure modes**

```text
rubber-stamping (near-100% pass with later reverts)
findings without refs
reviewer silently invents missing product/design decisions
lenses collapsing into one opinion
```

**On underdelivery:** reviewer quality is measured downstream — escaped defects, architecture-related reverts, rapid post-merge refactors (Appendix D) are attributed back to the passing reviewer binding. A lens whose passes decay in production is rebound; its misses become hidden eval cases.

---

## F.9 Merge Refinery

Default binding: none mature — merge queue + gstack ship initially; dedicated refinery at scale (§11).

**Inputs**

```text
candidates in MERGE_READY with complete four-gate result (Appendix B result.json)
protected main
```

**Outputs / guarantees**

```text
serialized merges of conflicting changes
rebase before merge; stale candidates re-verified, never merged as-is
integration/regression checks rerun post-rebase
merge refused for any candidate missing gate evidence
merge commit ↔ task id ↔ run directory linkage preserved
```

**Done means**

Main is never broken by ordering; no candidate lands without a linked, complete evidence bundle; semantic conflicts between concurrently accepted candidates are detected by rerun verification, not discovered in production.

**Failure modes**

```text
stale merge (verified against old main)
evidence linkage lost
conflicting accepted candidates racing
```

**On underdelivery:** CI plus staging runtime verification (§11) backstop it, and rollback restores main. Rising merge-conflict % and semantic-conflict escapes (Appendix D) trigger rebinding — this is where Gas Town-style dedicated refineries enter, as a binding, not a rewrite.

---

## F.10 Learning Evaluator

Default binding: pstack `/reflect`, `/automate-me`.

**Inputs**

The full join of §13.1:

```text
task, transcript, diff, verification, reviews,
retries, configuration, cost, human corrections,
later defects, reverts, production telemetry
```

**Outputs**

```yaml
retrospective:
  task: ACCOUNT-12
  trigger: architecture-rejection
  cause: ARCHITECTURE        # taxonomy of §13.2
  candidate_interventions:
    - kind: lint-rule
      detail: forbid direct session persistence imports outside SessionService
  eval_case: .agent/evals/architecture/ARCH-017.yaml
  status: proposed           # never auto-applied
```

Plus fleet-level cluster reports (§13.3) and configuration canary verdicts (§13.6).

**Done means**

Every §13.2 trigger event produces a retrospective within its window; each proposes an intervention preferring "make the mistake impossible" over prose; each qualifying failure becomes a replayable eval case with repo snapshot. Proposals are candidates — humans or canaries promote them.

**Failure modes**

```text
lessons written as prose no agent reads
single anecdote promoted to policy
eval cases that cannot replay
interventions auto-applied fleet-wide
```

**On underdelivery:** the fleet stops improving but does not break — this role degrades gracefully. Detection is longitudinal: flat first-pass and architecture-pass rates (Appendix D) despite accumulating retrospectives means the loop is dead; rebind it.

---

## F.11 Binding Rule

```text
role underdelivers
       ↓
contract violation observed
(missing output, failed guarantee, decayed metric)
       ↓
downstream gate refuses its output
       ↓
task does not silently proceed
       ↓
rebind the role
       ↓
pipeline unchanged
```

A tool earns its slot by meeting the contract, and keeps it the same way.
