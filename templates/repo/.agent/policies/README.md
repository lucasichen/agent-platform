# Policies

<!--
owner: repo maintainer role (local edits/overrides); platform defaults
  are owned upstream by the agent-platform package.
staleness trigger: `agent validate` schema-checks every policy file on
  every run; a policy that fails validation blocks `agent init`/`agent
  route` rather than silently applying stale rules. `models.yaml` also
  carries its own `as_of` date — treat mappings older than 90 days as a
  hint and re-check against what the harness actually offers before
  routing on them (spec §12.4).
-->

This directory is populated by `agent init`, which copies the platform's
default policy files from the `agent-platform` package's own `/policies`
into this repository:

```
policies/
  risk.yaml           R0-R4 -> model tier / verification depth / review
                       lenses / human-approval requirements (spec §10.5)
  models.yaml          capability tiers -> harness-specific model mappings,
                       one profile per harness (spec §7, §5 of DESIGN.md)
  escalation.yaml       who/what gets notified for which trigger (spec §5.2,
                       §14.5)
  architecture.yaml     repo-specific architecture policy (depth of review,
                       required seams enforcement, etc.)
```

**This README is the only file this template ships in `policies/`.** The
actual policy files are not authored here — they are installed (and can
be regenerated) by `agent init` from the platform's packaged defaults, and
are a separate work package's contract. Do not hand-author `risk.yaml`,
`models.yaml`, `escalation.yaml`, or `architecture.yaml` against this
template; edit the installed copies in your target repo instead, and see
`docs/metrics.md` and `docs/security.md` in the platform repo for what
each governs.

Local edits are expected and normal — `models.yaml`'s harness profiles in
particular are "illustrative defaults the operator edits" (spec DESIGN.md
§5) since model catalogs rot. Re-run `agent validate` after editing any
policy file.
