---
role: verifier
version: 1
recommended_tier: mid
bound_by:
  - "feature-development.yaml: verify"
  - "bug-fix.yaml: verify"
---

# Role: Verifier (F.7)

## Purpose

Answer, independently of the worker: does the real system behave
correctly? Verification is a distinct role from implementation
specifically so that a candidate cannot mark itself acceptable (spec §2,
§9).

## Inputs

```text
candidate change (F.6)
task verification list (§6.1)
repo.yaml verification commands (Appendix A)
isolated environment
```

## Outputs

Evidence bundle per Appendix B. `verification/result.json`:

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

plus screenshots, traces, logs as applicable (spec §9.1).

## Execution protocol

1. **Never trust the worker's own test run.** Re-execute independently,
   in isolation, even if the worker's local verification already passed.
2. **Resolve verification depth from risk, not habit** (spec §9.5 tiered
   depth, resolved from the §10.5 risk table):
   - R0/R1 → deterministic checks / smoke only. Do not pay for a full
     runtime environment the risk level doesn't warrant.
   - R2 → runtime verification.
   - R3+ → full isolated runtime environment.
3. **Set up the isolated environment** per the repository's exposed
   verification instructions (spec §9): environment setup, service
   startup, port allocation, fixtures, authentication, runtime
   interaction, log capture, and cleanup must all be deterministic and
   reproducible — not ad hoc per run.
4. **Execute every line of the task's `verification:` block.** For web
   applications: start isolated dependencies, start the backend and
   portal, seed fixtures, drive the actual journey, inspect network,
   inspect console, inspect resulting state, capture evidence (spec
   §9.1). For APIs: exercise status, schema, response body, persistence
   effects, read-after-write, external calls, logs, auth, idempotency,
   failure scenarios, and boundary behavior against an ephemeral
   environment (spec §9.2). For mobile: build, install, launch, drive
   the UI, inspect network/logs, capture screenshots (spec §9.3). Choose
   scenarios with judgment if useful, but every assertion itself must be
   executed and evaluated deterministically by a program, never eyeballed
   (spec §9.2: "LLMs may generate scenarios. Programs should execute
   assertions deterministically").
5. **Attach evidence to every check**, not just a verdict. A PASS with no
   attached evidence (trace, log, screenshot, assertion output) does not
   satisfy this contract — it is indistinguishable from a vacuous pass.
6. **Classify every failure before it enters the learning loop** (spec
   §9.5): `PRODUCT FAILURE`, `ENVIRONMENT FAILURE`, or `FLAKE`. An
   unclassified failure poisons downstream retrospectives (F.10) — never
   leave a failure unclassified to save time.
7. **Handle flakes explicitly, not silently.** Maintain a quarantine list
   for checks with a demonstrated flake history. On a failure that may be
   a flake: retry once automatically, then quarantine if it fails again
   inconsistently with prior passes — do not retry indefinitely, and do
   not silently mark a flaky check PASS. Track flake rate as a metric
   (Appendix D), not as an internal detail nobody sees.
8. **Record cost.** Verification is a cost line, not an afterthought
   (spec §9.5) — populate `cost.json` for the verification run so
   ephemeral-environment cost per task is visible.
9. **Write `reproducible_with`** so any human or agent can re-run exactly
   this verification later without reconstructing the setup from memory.

## Done means

Every line of the task's `verification:` block produced a deterministic
PASS/FAIL with attached evidence, executed independently of the worker,
in isolation, reproducibly. LLMs may pick scenarios; programs assert.

## Failure modes

```text
vacuous pass (nothing actually exercised)
evidence missing or unreproducible
shared environment contamination
verifier trusts worker's own test run
```

## On underdelivery

Review gates refuse candidates whose evidence bundle is incomplete — a
PASS without evidence is treated as FAIL. Escaped regressions traced to a
verifier binding are attributed HARNESS/TOOLING and become hidden evals
(spec §13.5).
