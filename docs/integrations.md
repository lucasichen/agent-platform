# Third-Party Integration Plan

<!--
owner: repo-maintainer (spec §12.4)
staleness trigger: provenance table below carries as_of dates; any entry
older than 90 days is a hint, not truth — re-verify repo/license/contents
before relying on it. Upstream pins live in each skills/vendor/<pack>/VENDOR.md.
-->

This document is the plan for bringing the spec's named third-party tools
into this single platform: what each verified tool actually is, which
parts we adopt, how they compose across the pipeline, and how they are
distributed to any harness. It implements the spec's Appendix F stance —
*the system depends on the contracts, never the tools* — by making every
adoption a **binding** to a role contract, never a dependency of one.

## 1. Verified provenance (as of 2026-08-31)

The spec names tools without provenance. All six have now been located,
read, and license-verified at source:

| Spec name | Actual project | Author | License | Format |
|---|---|---|---|---|
| pstack | [github.com/cursor/plugins](https://github.com/cursor/plugins) → `pstack/` | Lauren Tan ("poteto", Cursor) | MIT (`pstack/LICENSE`, © 2026 Lauren Tan) | Cursor plugin wrapping Agent-Skills `SKILL.md` (35 skills, 2 agents, automations) |
| "Matt" | [github.com/mattpocock/skills](https://github.com/mattpocock/skills) | **Matt Pocock** (not "Paddock") | MIT (© 2026 Matt Pocock) | Claude Code plugin + Agent Skills + `npx skills add` CLI installer |
| Superpowers | [github.com/obra/superpowers](https://github.com/obra/superpowers) | Jesse Vincent | MIT (© 2025) | Multi-harness plugin (Claude Code, Cursor, Codex, Devin, Gemini, more) — 14 skills |
| gstack | [github.com/garrytan/gstack](https://github.com/garrytan/gstack) | Garry Tan | MIT (© 2026) | Claude-Code-native Agent Skills + a `hosts/` multi-harness adapter layer (23 tools) |
| Hermes | [github.com/NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) | Nous Research | MIT (© 2025) | Standalone Python agent; its **Kanban** subsystem is the control-plane feature set the spec quotes |
| Gas Town / Gas City / Beads | [github.com/gastownhall](https://github.com/gastownhall) (`gastown`, `gascity`, `beads`) | Steve Yegge | MIT | Go CLIs (`gt`, `gc`, `bd`) — real runnable code, not just concepts |

Two identity corrections vs. earlier working assumptions: gstack is **not**
a `cursor/plugins` sibling of pstack, and the skills author is Matt
**Pocock**. "Field Guide memory" is this spec's own house pattern, not a
third-party product (v1 confirms: no tool provenance was ever recorded).

Everything is MIT — every tool is legally embeddable with attribution.

## 2. Binding architecture: three layers

Every role contract (`roles/F*.md`) can be satisfied at three levels.
`policies/bindings.yaml` declares which binding is active per role per
harness; the `agent` CLI resolves and announces it at `task claim`.

```text
Layer 1  CONTRACT SKILLS (ours, always present)
         skills/<name>/ — portable to ANY harness; the default binding.
         Know our task envelope, CLI, evidence bundles, policies.

Layer 2  VENDORED SKILLS (pinned, adapted upstream)
         skills/vendor/<pack>/ — MIT snapshots pinned to an upstream
         commit (VENDOR.md records pin + adaptations), with harness-
         specific frontmatter stripped or adapted. Preferred binding
         where the harness supports them (Claude Code, Cursor).

Layer 3  NATIVE INSTALLS (operator-managed, optional)
         Full upstream plugins installed through the harness's own
         plugin system (pstack in Cursor, Superpowers in Claude Code).
         Documented, never required; the platform's gates still apply.
```

The rule that keeps this honest: **gates never move.** Whatever binding
executes a role, the output lands in the run directory in the contract's
shape and passes the same verification/review gates. A binding that can't
clear the gates prices itself out (spec F.11).

## 3. What we take from each tool

### pstack → execution style + architecture review (roles F6, F3, F8)

Adopt (vendor + adapt):
- **`poteto-mode`** — the worker's task-start router: principles-first
  todolist, playbook matching, justify-if-skipped. Bound as a
  `startup_skills` entry for F6 at task start (not session start).
- **23 `principle-*` skills** — portable, self-contained engineering
  principles; loaded on demand by poteto-mode.
- **`interrogate`** — multi-model adversarial review → an F8 lens binding.
- **`arena`** — parallel design-candidate competition → F3's "arena
  depth" conditional stage.
- **`unslop`**, **`blast-radius`**, **`show-me-your-work`** — cleanup,
  verify-by-running, and decision-audit logging. `show-me-your-work`'s
  TSV audit maps directly onto our `decisions.tsv` evidence artifact.
- **`reflect`**, **`automate-me`**, and the eval playbook → the F10
  Learning Evaluator binding: `reflect`'s parallel-reviewer synthesis
  into Accepted/Rejected/Backlog (with its explicit warning against
  promoting one weird run into permanent policy) is the shape our
  retrospectives take; `automate-me` is the slow-loop transcript miner;
  the blind A/B eval playbook governs skill-version canaries (§13.6).

Whiteboard decision honored: pstack runs at **two levels** — the
architecture gate before implementation, and the quality harness inside
workers — and is **risk-gated**: not every task pays for every pstack
skill (the R0–R4 table decides), or the cost advantage dies.

Adapt: strip Cursor-only frontmatter (`disable-model-invocation`, `mode`,
`is_background`) into portable equivalents; drop the Slack automations
and Cursor `/loop`/`/babysit` couplings. Delegation inside poteto-mode is
rewritten to be harness-conditional (native subagents where available,
sequential todolist otherwise).

### Matt Pocock skills → the planning pipeline (roles F1, F1A, F2, F4, F8-spec)

Adopt (vendor + adapt): `wayfinder`, `research`, `prototype`,
`grill-with-docs`, `domain-modeling`, `to-spec`, `to-tickets`,
`code-review`, `diagnosing-bugs`, `improve-codebase-architecture`,
`ask-matt`. This is the closest 1:1 match in the whole ecosystem — the
spec's planning pipeline (§4) was built around these skills' shapes.

Adapt: outputs are re-pointed at our artifact graph — `domain-modeling`
writes `.agent/domain/CONTEXT.md`, `to-spec` writes the project-spec
shape F.2 requires (every requirement mapped to a verification line),
`to-tickets` emits task envelopes conforming to `schemas/task.schema.json`
instead of free-form tickets, `research` emits cited findings into
`.agent/missions/<ID>/artifacts/`. `ask-matt` binds to F.0's advisory
slot only (it may advise planning depth; it never owns routing).

### Superpowers → worker discipline (role F6)

Adopt (vendor + adapt): `test-driven-development`,
`systematic-debugging` (the 4-phase root-cause protocol — pairs with our
§8.1 three-failure rule), `verification-before-completion`,
`dispatching-parallel-agents`, `writing-skills` (the meta-skill — used
to author and maintain our own contract skills).

Deliberately **not** adopted for planning: `brainstorming` and
`writing-plans`. The whiteboarding session decided this explicitly —
they duplicate Matt's `grill-with-docs`/`to-spec`/`to-tickets` planning
chain, so Superpowers is scoped downstream to worker-execution
methodology only.

F6's execution discipline = Superpowers methodology inside poteto-mode's
task-start structure: poteto-mode routes and structures; TDD/debugging
skills govern how each step is done; our `worker-startup` contract skill
guarantees the platform preconditions and evidence duties around both.

### gstack → verification + release (roles F7, F9) and the adapter idea

Adopt (vendor + adapt): `qa`/`qa-only` (iterative live-browser QA →
F7's web verification binding), `canary` (post-deploy screenshot-diff
monitoring), `ship` + `land-and-deploy` (the F9 merge/release pipeline
shape for when the `release` workflow earns its template), `investigate`
(root-cause debugging with its freeze-during-debugging discipline), and
the **`ios-qa` real-device loop** — a debug-only StateServer in the app
lets a Mac-side agent drive a real iPhone over USB (screenshot → analyze
→ act → verify → repeat), feeding reproduced issues into fix/rebuild/
reverify on the same device. The whiteboarding session singled this out
as exactly the verification primitive to steal; it becomes the spec §9.3
iOS binding.

Adopt as **design**, not code: the `hosts/` adapter layer (one small
adapter per harness over shared skill content) — this becomes the model
for our `agent skills install --harness <h>`, replacing per-harness
hand-written sugar.

Adapt: `allowed-tools`/hooks frontmatter is Claude-Code-shaped; port via
the adapter layer. gstack's `learn`/`learnings.jsonl` feeds the memory
architecture (see §6).

### Hermes → patterns for our control plane (role F5), optional binding later

Do **not** vendor: Hermes is a general-purpose Python personal-assistant
agent; embedding it contradicts the platform's shape and our CLI already
implements F5's guarantees. Adopt its Kanban patterns into `platform/`:
- dependency-graph dispatch (ours exists; theirs validates the design)
- **worktree-per-task isolation** (`git worktree add` under
  `.worktrees/<task-id>/`) — the one Kanban feature our CLI lacks; add
  as `agent task claim --worktree`.
- PID/TTL crash-reclaim refinements for leases; per-task model override.

Document Hermes Kanban as an alternative F5 binding an operator may run
at the 5–20 agent tier; our CLI remains the reference binding.

**Spec amendment note.** Spec §6.2 says "Use Hermes first instead of
rebuilding orchestration" — written when the whiteboarding session
identified Hermes's Kanban as "extremely close to what we want." What
that session actually valued was the *contract* (durable tasks,
dependencies, worktrees, leases, retries, review states), and both it
and the spec flag Hermes's single-host limits. Our CLI now implements
that same F.5 contract harness-agnostically (Hermes is a Python
personal-assistant agent — a poor fit to embed in a Cursor-portable
platform), so the amended position recorded in spec Appendix G is: the
platform CLI is the F.5 reference binding; Hermes Kanban is a documented
alternative at the 5–20 tier; Gas City is the candidate above it, earned
per §14.0 telemetry — matching the whiteboard's own "don't build the
distributed controller until telemetry shows which limits matter."

### Gas Town / Gas City / Beads → the scale tier (north star, per spec §1.1)

No vendoring now. Documented as the named binding path for F5/F9 above
~20 agents: Gas City's declarative orchestration for the control plane,
Gas Town's Refinery (bisecting merge queue) as the F9 binding when merge
volume demands it, its three-tier watchdog for fleet supervision. Beads
(`bd remember`/`bd prime`, memory decay) is an input to the memory
architecture (§6). Re-evaluate at each §14.0 promotion gate — earned,
not scheduled.

## 4. How they compose — the pipeline with bindings

```text
mission → F0 compiler ............ platform CLI  (ask-matt may advise depth)
uncertainty ...................... F1  = wayfinder / research / prototype
domain + product ................. F1A = grill-with-docs / domain-modeling
architecture ..................... F3  = architect + arena (pstack)
spec synthesis ................... F2  = to-spec
decomposition .................... F4  = to-tickets → task envelopes
scheduling ....................... F5  = agent CLI (Hermes patterns; Gas City at scale)
implementation ................... F6  = worker-startup → poteto-mode
                                        + Superpowers TDD/debugging
                                        + principle-* / unslop / show-me-your-work
verification ..................... F7  = gstack qa + Playwright/Testcontainers
review ........................... F8  = code-review (spec lens)
                                        + interrogate (adversarial/architecture)
                                        + our quality lens
merge / release .................. F9  = merge queue now; gstack ship/canary;
                                        Gas Town Refinery at scale
learning ......................... F10 = reflect-shaped retrospectives + evals
memory ........................... platform-owned (see §6)
```

Handoffs stay artifact-shaped: every binding reads pinned inputs from the
mission artifact graph and writes outputs to the run directory. No tool
talks to another tool directly; they compose through the ledger and the
evidence contract. That is what makes any single binding swappable.

## 5. Distribution mechanics

- `skills/vendor/<pack>/` — pinned snapshot, upstream LICENSE retained,
  `VENDOR.md` with upstream commit hash, date, file list, and a diff-log
  of every adaptation we made.
- `skills/<name>/` — our contract skills (Layer 1), including the glue
  skills: `worker-startup`, `operate-platform`.
- `policies/bindings.yaml` — role → binding per harness profile; schema
  added to `/schemas`; validated by `agent validate`.
- `agent skills install --harness claude-code|cursor|generic` — gstack-
  style adapters emit each skill into the harness's discovery path
  (`.claude/skills/`, Cursor's skills directory, or an AGENTS.md index
  for generic harnesses).
- `agent task claim` prints the resolved binding + `startup_skills` for
  the task's role — the harness-neutral trigger every agent sees.
- Gates enforce: reviewer/verifier checks of `decisions.tsv` preconditions
  at R2+ make the discipline real ("PASS without evidence is FAIL").

## 6. Memory (design in progress)

"Field Guide memory" is ours to build, not adopt — no third-party product
matches it. Verified prior art feeding the design: Hermes's capped
`MEMORY.md` injection, Beads's DB-backed `bd remember`/`bd prime` with
memory decay, gstack's `learnings.jsonl` discoveries log. A dedicated
memory-architecture design (subagent memory → fleet memory, promotion
tiers per spec §12.2, concurrency, freshness per §12.4, and the external
repo survey) is being produced and will land as `docs/memory.md` plus a
spec appendix update.

## 7. Build waves

| Wave | Content | Depends on |
|---|---|---|
| A — binding infrastructure | `bindings.yaml` + schema, `startup_skills` in role frontmatter, CLI: claim prints bindings, `skills install` adapter layer, `--worktree` isolation | nothing |
| B — vendor the four packs | `skills/vendor/{pstack,pocock,superpowers,gstack}/` pinned + adapted per §3 | A |
| C — contract/glue skills | `worker-startup`, `operate-platform`, remaining Layer-1 defaults for gaps | A |
| D — memory architecture | per the forthcoming `docs/memory.md` | design report |
| E — scale bindings | Hermes-Kanban option docs; Gas Town/City evaluation | §14.0 promotion gates |

Waves A–C are buildable immediately with the same orchestration pattern
used for the MVP (parallel subagents on disjoint paths, integration pass,
end-to-end smoke).
