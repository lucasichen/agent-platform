# Canonical vs. Legacy Patterns

<!--
owner: design authority / architect role (F.3) — spec §5.3, §12.4
  ("canonical map -> design authority")
staleness trigger: every entry below names a real symbol (class, module,
  function, or file). CI (or `agent validate --run-checks`) resolves each
  symbol reference; if a symbol no longer exists, the entry — and the
  build — fails (spec §12.4, verbatim: "canonical map entries reference
  symbols -> CI fails if a symbol no longer exists"). A stale canonical
  map is worse than none: agents trust it, so an unresolvable entry must
  be fixed or removed promptly, not left to rot.
-->

Code frequency is not architectural approval (spec §5.3). This file is
the explicit, curated map that tells agents which implementation of a
concept is the one to read, copy, and extend — and which ones exist only
for backward compatibility, migration, or historical reasons and must not
be treated as examples.

Without this map, a bad shortcut that merges once gets found by a future
code search, gets copied because it looks like an established pattern,
and its frequency — and agents' confidence in it — increases with every
copy. This is how architecture cascades degrade (spec §5.3).

## Format

Two lists: `CANONICAL` (safe to read, copy, extend) and `LEGACY /
NON-CANONICAL` (do not use as a reference; migrate away from when
touched). Each entry is a real, resolvable symbol reference, not prose.

```
CANONICAL

✓ <Symbol/Module> — <path or module reference> — <one-line why this is the canonical one>

LEGACY / NON-CANONICAL

⚠ <Symbol/Module> — <path or module reference> — <one-line why this is legacy, and what replaces it>
```

## Example

Replace with this repository's real canonical/legacy split. Delete once
populated.

```
CANONICAL

✓ AccountService — src/services/account/AccountService.ts — current account lifecycle owner
✓ standard transaction helper — src/db/withTransaction.ts — all multi-write operations go through this
✓ current API error envelope — src/http/errorEnvelope.ts — matches project-spec §error-handling
✓ current mobile networking layer — mobile/net/ApiClient.kt — replaces LegacyNetworkManager

LEGACY / NON-CANONICAL

⚠ LegacyAccountManager — src/legacy/LegacyAccountManager.ts — pre-AccountService; do not extend
⚠ v1 authentication handlers — src/legacy/authV1/ — superseded by src/auth/; kept for v1 mobile clients only, see memory/auth.md
⚠ deprecated networking wrapper — mobile/net/LegacyNetworkManager.kt — replaced by ApiClient.kt
```

## Entries

<!-- Add this repository's real canonical/legacy entries below. -->

CANONICAL

LEGACY / NON-CANONICAL
