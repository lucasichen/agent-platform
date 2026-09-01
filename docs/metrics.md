# Metrics

Expands spec Appendix D and §14.0. What to track, what to ignore, and how
the scaling ladder is earned rather than scheduled.

## What not to optimize

None of these, alone, indicate the platform is working — they're easy to
move in the wrong direction (spec Appendix D):

```
commits
lines of code
active agents
tokens generated
```

## What to track

### Task-level

```
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

READY -> DONE latency
```

### Mission-level

```
cost / approved spec
mission cycle time (goal -> approved outputs)
spec-review pass % (project-definition)
child-mission rework %
```

### Architecture-health

```
duplicate concepts
new shallow modules
dependency violations
hot files
architecture-related reverts
rapid post-merge refactors
```

These pair with the periodic inspection spec §12.3 asks architecture-
health agents to run (recently hot code, new abstractions, shallow
modules, dependency growth, duplicate concepts, high-conflict files,
frequent agent confusion) and the file-contention signals (size, touch
frequency, concurrent modifications, merge conflicts, unrelated
responsibilities) that should trigger an architecture-health task rather
than unlimited parallel modification on a contested file.

## The governing formula

```
                        accepted verified changes
Fleet efficiency = ─────────────────────────────────────
                   dollars + human attention + future debt
```

Every metric above exists to make one term of this formula legible.
`cost / accepted task` and mission cost metrics measure the denominator's
dollar term. `human minutes / accepted task` and the attention-economics
formula below measure the human-attention term. Architecture-health and
evolutionary-gate metrics are the leading indicators for the future-debt
term, which otherwise only shows up much later as rework.

## Attention economics (spec §14.0)

The binding constraint on how much concurrency is sustainable is not
compute or budget — it's human attention:

```
                          human minutes available / day
sustainable tasks/day ≈ ─────────────────────────────────
                        escalation rate × minutes/escalation
```

Worked examples from the spec:

```
human exception budget:   240 min/day
escalation rate:          10%
minutes per escalation:   20

240 / (0.10 × 20) = 120 tasks/day

at 5% and 15 min:

240 / (0.05 × 15) = 320 tasks/day
```

Escalation rate does not fall because concurrency rises — it falls
because verification, review, and the learning loop improve. Raising
concurrency without improving those first just saturates the human.

## Promotion gates (spec §14.0)

Each rung of the 1–5 / 5–20 / 20–50 / 50–100+ scaling ladder (spec §1) is
**earned, not scheduled** — promote only when the metrics above prove it,
sustained over a trailing window:

| Promotion | First-pass verification | Escalation | Human min / accepted task | Window |
|---|---|---|---|---|
| 5 → 20 | ≥ 80% | ≤ 10% | ≤ 15 | 50 tasks |
| 20 → 50 | ≥ 85% | ≤ 7% | ≤ 8 | 200 tasks |
| 50 → 100+ | ≥ 90% | ≤ 4% | ≤ 4 | 500 tasks |

These thresholds are initial targets to tune from fleet data, not gospel
— the shape (measured, sustained, per-rung) is the requirement.

Demotion is symmetric and mechanical:

```
thresholds regress
      ↓
reduce concurrency to the last rung where thresholds held
      ↓
fix the cause via the learning loop (spec §13)
      ↓
re-earn promotion
```

Concurrency is a controlled variable, not a goal. Running more agents
than the promotion gates support just produces unreviewed merges — the
architecture-degradation failure this entire platform exists to prevent.

## Human attention: what to surface (spec §14.5)

Humans should monitor exceptions, not agent activity. Do not surface:

```
agent reading file
agent running test
agent writing code
```

Do surface:

```
architecture ambiguity
contradictory requirements
repeated verification failure
security-sensitive discovery
budget exhaustion
review disagreement
semantic merge conflict
production regression
```

Example exception-first dashboard shape (spec §14.5) — this is what
`agent status` should render:

```
ACCOUNT MANAGEMENT                    87%

Backend                   done
Portal                    done
Android                   in progress
iOS                       in progress
Security                  done
Integration               done

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

The per-stage `Spend` breakdown rolls up from each task's `cost.json`
(see `docs/evidence-contract.md`); the per-feature completion rollup
comes from `.agent/features/feature-map.yaml`.
