# Skills & Bindings Design Contract (Waves A–C)

Binding interface contract for the skills/bindings build, companion to
`docs/DESIGN.md` (which still governs everything it covers) and
implementing `docs/integrations.md` §2–§5 and spec Appendix G. Where this
document and those conflict, flag it — don't improvise.

## 1. Directory layout

```
skills/
  README.md                     # how skills work, three-layer binding model
  worker-startup/SKILL.md       # Layer-1 contract skills (ours)
  operate-platform/SKILL.md
  vendor/                       # Layer-2 pinned upstream snapshots
    pstack/
      LICENSE                   # upstream LICENSE, verbatim
      VENDOR.md                 # pin + inventory + adaptation log (see §3)
      skills/<name>/SKILL.md    # adopted subset only, adapted
    pocock/    (same shape)
    superpowers/ (same shape)
    gstack/    (same shape)
```

## 2. SKILL.md conventions

Open Agent Skills format. Frontmatter: `name` and `description` required.
- Our skills: `name` is the plain kebab-case dir name.
- Vendored skills keep upstream content as close to verbatim as the
  adaptation allows. Frontmatter `name` becomes `<pack>-<upstream-name>`
  (e.g. `pstack-poteto-mode`) so installed skill names never collide.
- Harness-specific frontmatter keys that are not part of the open
  standard (`disable-model-invocation`, `mode`, `is_background`,
  `allowed-tools`, `hooks`) are REMOVED from vendored copies; where the
  key carried real behavior, the behavior is restated as prose in the
  skill body ("run this in the background if your harness supports it").
- Every vendored SKILL.md gets a comment directly under the frontmatter:
  `<!-- Vendored from <upstream path> @ <commit>; adaptations logged in ../../VENDOR.md. MIT (c) <author>. -->`

## 3. VENDOR.md format (one per pack)

```markdown
# Vendored: <pack>
- upstream: <repo URL>
- pinned commit: <full SHA>       # the commit actually fetched from
- fetched: 2026-08-31
- license: MIT, (c) <year> <author> — see ./LICENSE (verbatim upstream)
- adopted subset: <n> of <total> upstream skills (see inventory)

## Inventory
| local path | upstream path |
|---|---|

## Adaptation log
| file | change | reason |
|---|---|---|
```
Rules: fetch REAL upstream content (raw.githubusercontent.com at the
pinned SHA; get the SHA from the GitHub API first). Never paraphrase
upstream text where a verbatim copy plus a logged edit will do. Every
edit gets an adaptation-log row. Retain upstream LICENSE verbatim.

## 4. `policies/bindings.yaml` (authoritative; schema-validated)

Single source of truth for role→skill bindings (deliberate deviation
from integrations.md's "frontmatter" phrasing: a repo-editable policy
file beats editing platform role files; roles may mention the concept
but the policy binds). Installed into target repos by `agent init` like
the other policies.

```yaml
# header comment: what/spec-ref (Appendix G, integrations.md §2)/owner:
# repo-maintainer/staleness trigger: referenced skill paths are checked
# by `agent validate`; a missing path fails validation.
version: 1
roles:
  worker:
    startup_skills:            # printed by `agent task claim`/`start`
      - skills/worker-startup
    skills:                    # recommended per harness (informational
      generic: []              # for the agent; gates do the enforcing)
      claude-code:
        - skills/vendor/superpowers/skills/test-driven-development
        - skills/vendor/pstack/skills/poteto-mode
      cursor:
        - skills/vendor/pstack/skills/poteto-mode
  architect:
    skills:
      claude-code: [skills/vendor/pstack/skills/architect, skills/vendor/pstack/skills/arena]
      cursor: [skills/vendor/pstack/skills/architect, skills/vendor/pstack/skills/arena]
  # verifier → gstack qa/ios-qa; reviewer → pocock code-review +
  # pstack interrogate/unslop; learning-evaluator → pstack reflect/
  # automate-me; specifier/decomposer/etc → pocock chain, per Appendix G.1
active_harness: generic
install:                       # optional per-harness path overrides
  claude-code: ".claude/skills"
  cursor: ".cursor/skills"
```
Role keys = role ids from DESIGN.md (worker, architect, verifier,
reviewer, specifier, task-decomposer, uncertainty-resolver,
domain-product-clarifier, workflow-compiler, merge-refinery,
learning-evaluator, control-plane). Paths are repo-root-relative into
the platform's skills tree; after `agent skills install` they also exist
in the target repo's harness discovery dir.

Schema: `schemas/bindings-policy.schema.json` ($id convention as the
other schemas; version, roles map with startup_skills[]/skills{harness:
[]}, active_harness enum generic|claude-code|cursor, optional install map).

## 5. CLI additions (platform/, extends DESIGN.md §6)

```
agent skills install [--harness claude-code|cursor|generic] [--repo <path>]
    Reads bindings.yaml (target repo's .agent/policies/, falling back to
    packaged default). Copies every skill referenced by any role binding
    for that harness (plus all startup_skills) from the packaged skills
    tree into the harness discovery path (install map, defaults above).
    generic: writes <repo>/.agent/skills-index.md (name, description,
    path table) instead of copying; never edits AGENTS.md.
    Idempotent; --force to overwrite modified files, otherwise skip+report.

agent task claim/start (extended)
    After claiming/starting, resolve task.role → bindings.yaml and print:
    startup_skills (as "Required before work begins:") and the harness's
    recommended skills. Included in --json output as
    {startup_skills:[], skills:[]}. Missing bindings.yaml → no output,
    no error (bindings are optional policy).

agent task claim --worktree
    If the target repo is a git repo: `git worktree add
    .worktrees/<task-id> -b task/<task-id>` (branch reused if it exists),
    record {workspace: ".worktrees/<task-id>"} on the task, print the
    path. Fails with a clear message on non-git repos. `agent task
    reclaim` and terminal states leave the worktree in place but print a
    cleanup hint (`git worktree remove`) — never delete work.

agent validate (extended)
    Validates bindings.yaml against its schema AND verifies every
    referenced skill path exists (in-repo or packaged) and every
    startup_skills entry resolves to a SKILL.md.
```
Build packaging: `skills/` tree ships in the package like schemas/
policies/templates (copy-assets step; tolerate absence at build time —
tests use fixtures under platform/test/fixtures/skills/).

## 6. Vendored subsets (from integrations.md §3 / Appendix G.1)

- **pstack** (`cursor/plugins` → `pstack/skills/`): poteto-mode,
  architect, arena, interrogate, unslop, blast-radius,
  show-me-your-work, reflect, automate-me, and ALL principle-* skills.
  Also copy the eval-playbook doc from `pstack/docs/` if it exists as a
  standalone file (place under vendor/pstack/docs/). Adapt: strip Cursor
  frontmatter (§2); rewrite Cursor-specific references (`/loop`,
  `/babysit`, `.cursor/rules`, Cursor automations) to harness-neutral
  prose; poteto-mode's subagent delegation becomes harness-conditional
  ("where your harness supports spawning subagents… otherwise execute
  the playbook steps sequentially yourself"); poteto-mode additionally
  gets a short appended "Platform integration" section: honor the task
  envelope's payload.design constraints, log decisions to decisions.tsv,
  escalate per §5.2 instead of inventing architecture.
- **pocock** (`mattpocock/skills`): wayfinder, research, prototype,
  grill-with-docs, domain-modeling, to-spec, to-tickets, code-review,
  diagnosing-bugs, improve-codebase-architecture, ask-matt. Adapt:
  append a "Platform integration" section to each re-pointing outputs at
  our artifact graph — domain-modeling → .agent/domain/CONTEXT.md;
  research → .agent/missions/<ID>/artifacts/ with citations; to-spec →
  the F.2 spec shape (every requirement maps to a verification line);
  to-tickets → task envelopes per schemas/task.schema.json; code-review
  verdicts → the F.8 review-verdict JSON shape. Keep the upstream
  methodology text itself intact.
- **superpowers** (`obra/superpowers/skills/`): test-driven-development,
  systematic-debugging, verification-before-completion,
  dispatching-parallel-agents, writing-skills. NOT brainstorming/
  writing-plans (whiteboard decision — planning stays Matt+pstack).
  Adapt: strip hooks references; "Platform integration" note tying
  verification-before-completion to our evidence bundle ("fresh evidence
  = files in .agent/runs/<TASK-ID>/, not agent confidence").
- **gstack** (`garrytan/gstack`): qa, qa-only, canary, ship,
  land-and-deploy, investigate, ios-qa (find actual skill dir names via
  the repo listing; adopt the closest matches and record exact upstream
  paths). Adapt: strip allowed-tools/hooks frontmatter (restate as
  prose); "Platform integration" notes: qa/ios-qa evidence lands in
  .agent/runs/<TASK-ID>/verification/ per the F.7 result shape; ship/
  land-and-deploy/canary map to the F.9/release stages and never bypass
  the merge gates.

If an expected upstream skill does not exist under the expected name,
record what WAS found in VENDOR.md and adopt the nearest real file —
never invent content and present it as vendored.

## 7. Contract skills (Layer 1, ours)

- `skills/worker-startup/SKILL.md` — task-start protocol for F6: the
  four preconditions as an explicit todolist (read task envelope +
  acceptance/verification; read every decision_ref + payload.design;
  check .agent/architecture/canonical-patterns.md; failing test first),
  skip = one-line justification logged to decisions.tsv; evidence duties
  (decisions.tsv, diff.patch, cost.json, `agent task submit`); §5.2
  escalation triggers; hand-off line: "if pstack-poteto-mode is
  installed, enter it now for execution style — platform preconditions
  above still bind."
- `skills/operate-platform/SKILL.md` — how ANY agent drives the mission
  loop: mission create → workflow instantiate → task claim (read the
  printed startup skills!) → start → work per role contract → evidence
  → submit → gate; exception-first status; budget/lease semantics;
  where the role contracts live. Written against the real CLI surface
  (verify commands against platform/src/cli.ts, don't guess).
- `skills/README.md` — three-layer binding model, install flow, naming
  conventions, how to add a skill, pointer to bindings.yaml.

## 8. Conventions

Kebab-case; ISO dates; every durable file carries owner + staleness note
(spec §12.4); Windows-safe paths in all code; no git commands from
subagents; docs/DESIGN.md conventions apply throughout.
