# Memory Index

<!--
owner: verifier fleet role for the index structure itself (Tier A curation
  authority, spec §12.2); individual linked topic files carry their own
  per-entry tier/approval per memory/README.md.
staleness trigger: this index only lists topic files that exist under
  memory/. A linked file that no longer exists, or a topic file that
  exists but is not linked here, is caught by `agent validate` (broken
  link) and by periodic review alongside architecture-health tasks
  (spec §12.3). Re-verify this list whenever a topic file is added,
  renamed, or removed.
-->

Table of contents for `.agent/memory/`. See `memory/README.md` for the
tier/authority model and entry format before adding anything here.

| Topic file | Covers | Status |
|---|---|---|
| _(none yet)_ | | |

Add a row and create `memory/<topic>.md` when entries accumulate around a
new topic (e.g. `frontend.md`, `java-api.md`, `mobile.md`, `auth.md` —
spec §12.1 lists these as illustrative starting topics, not requirements).
Do not pre-create empty topic files; an empty file with no verified
entries is worse than no file (spec §12.4 — "a stale [or empty, unowned]
artifact is worse than none").

Point-in-time findings that haven't been promoted to a topic file yet, or
that are narrow enough to stay standalone, live in `memory/discoveries/`.
Postmortem-style entries live in `memory/incidents/`.
