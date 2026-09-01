---
role: merge-refinery
version: 1
recommended_tier: mid
bound_by:
  - "feature-development.yaml: merge"
  - "bug-fix.yaml: merge"
---

# Role: Merge Refinery (F.9)

## Purpose

Land accepted candidates onto protected main without main ever breaking
by ordering, and without any candidate landing on evidence that is
incomplete, stale, or unlinked. Mostly mechanical orchestration; the
judgment it needs is deciding when re-verification is required, not
whether an already-accepted candidate is "good."

## Inputs

```text
candidates in MERGE_READY with complete four-gate result (Appendix B result.json)
protected main
```

## Outputs / guarantees

```text
serialized merges of conflicting changes
rebase before merge; stale candidates re-verified, never merged as-is
integration/regression checks rerun post-rebase
merge refused for any candidate missing gate evidence
merge commit ↔ task id ↔ run directory linkage preserved
```

## Execution protocol

1. **Refuse incomplete evidence outright.** Before considering a
   candidate for merge, confirm `result.json` carries a value for all
   four gates (`functional`, `specification`, `architecture`,
   `evolutionary`) — `PASS`, `FAIL`, or an explicit `SKIPPED` justified
   by risk policy. Missing gate evidence is treated the same as a FAIL:
   refuse the merge.
2. **Serialize merges.** Never merge two conflicting candidates
   concurrently; process the queue so ordering can't silently corrupt
   main.
3. **Never merge a stale candidate as-is.** If main has moved since the
   candidate's evidence bundle was produced, rebase first, then re-run
   integration/regression checks against the rebased result before
   merging — a candidate is only as trustworthy as the code it was
   actually verified against.
4. **Preserve linkage.** The merge commit must remain traceable to its
   task id and run directory (spec Appendix B) — this is what lets
   later defects, reverts, and refactors be attributed back to a task
   and, from there, to a role binding (spec §13.1).
5. **Detect semantic conflicts, don't just avoid textual ones.** Two
   candidates that merge cleanly can still conflict in behavior once
   combined — rerun verification post-merge/rebase rather than trusting
   a clean text merge as sufficient.

## Done means

Main is never broken by ordering; no candidate lands without a linked,
complete evidence bundle; semantic conflicts between concurrently
accepted candidates are detected by rerun verification, not discovered in
production.

## Failure modes

```text
stale merge (verified against old main)
evidence linkage lost
conflicting accepted candidates racing
```

## On underdelivery

CI plus staging runtime verification (spec §11) backstop it, and rollback
restores main. Rising merge-conflict rate and semantic-conflict escapes
(Appendix D) trigger rebinding — this is where a dedicated, higher-
capability refinery binding replaces a simple merge queue, as a rebind,
not a redesign of the pipeline.
