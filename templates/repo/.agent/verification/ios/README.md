# iOS Verification (spec §9.3)

<!--
owner: repo maintainer role (spec §12.4, same authority as repo.yaml)
staleness trigger: every command below is executed by CI and by
  verifier tasks (spec §9, roles/F7-verifier.md); a command that stops
  succeeding fails the build, the same mechanical trigger as a broken
  repo.yaml command (spec §12.4). Verify the exact scheme/bundle-id
  below against this repository's actual Xcode project before trusting
  them — they are the standard Xcode toolchain sequence, not this
  repo's pinned scheme name.
-->

There is no `run.mjs` here, deliberately, for the same reason as
`../android/README.md`: Xcode toolchains, project vs. workspace vs. SPM
layout, scheme/target naming, and simulator vs. real-device targeting
vary too much across repos for one script to fake generically. An
honest checklist beats a script that pretends. If this repo's CI already
runs these steps as a named job, point `repo.yaml`'s `verification.ios`
at that job instead of re-deriving it here.

```
{{SCHEME}}            e.g. MyApp
{{BUNDLE_ID}}         e.g. com.example.MyApp
{{SIMULATOR_DEVICE}}   e.g. "iPhone 15"
{{SIMULATOR_OS}}       e.g. "17.5"
```

## Run-checklist (Simulator / XCTest — the default deterministic path)

### 1. Environment setup

- macOS with Xcode installed; `xcodebuild -version` succeeds.
- `xcrun simctl list` succeeds (confirms the Simulator toolchain is
  usable, not just installed).
- Signing: Simulator builds need no provisioning profile — if this repo
  requires one even for Simulator (some CocoaPods/SPM setups do), verify
  `CODE_SIGNING_ALLOWED=NO` is set for the test build below rather than
  wiring real signing into an automated verification run.

### 2. Backend dependencies, if this app talks to one

Same as Android (see `../android/README.md` §2): start and health-check
via `repo.yaml` `services`/`dependencies` before building/testing.

### 3. Port allocation (concurrent verifier runs)

Boot a dedicated Simulator instance per concurrent run rather than
sharing one (`xcrun simctl create <run-id>-{{SIMULATOR_DEVICE}} ...`,
see step 5) — a shared simulator across concurrent verifier runs makes
"cleanup" (spec §9's ninth requirement) impossible to reason about.

### 4. Build

```sh
xcodebuild build-for-testing \
  -scheme "{{SCHEME}}" \
  -destination "platform=iOS Simulator,name={{SIMULATOR_DEVICE}},OS={{SIMULATOR_OS}}" \
  -derivedDataPath build/DerivedData
```

A build failure here is a build failure — do not proceed to install/run
on a broken build.

### 5. Simulator

```sh
xcrun simctl boot "{{SIMULATOR_DEVICE}}" 2>/dev/null || true   # no-op if already booted
xcrun simctl bootstatus "{{SIMULATOR_DEVICE}}" -b
```

### 6. Install + launch (handled by `xcodebuild test`, or manually)

`xcodebuild test-without-building` installs and launches the app itself
as part of running the test bundle built in step 4 — that's the
preferred path (step 8). To install/launch standalone (e.g. for a manual
exploratory pass instead of XCTest):

```sh
xcrun simctl install "{{SIMULATOR_DEVICE}}" build/DerivedData/Build/Products/Debug-iphonesimulator/{{SCHEME}}.app
xcrun simctl launch "{{SIMULATOR_DEVICE}}" {{BUNDLE_ID}}
```

### 7. Drive UI + inspect resulting state — XCTest / XCUITest

```sh
xcodebuild test-without-building \
  -scheme "{{SCHEME}}" \
  -destination "platform=iOS Simulator,name={{SIMULATOR_DEVICE}},OS={{SIMULATOR_OS}}" \
  -derivedDataPath build/DerivedData \
  -resultBundlePath build/TestResults.xcresult
```

`build/TestResults.xcresult` is the deterministic evidence bundle —
`xcrun xcresulttool get --path build/TestResults.xcresult --format json`
extracts pass/fail per test, and `xcresulttool` also pulls any
screenshots/attachments an XCUITest captured on failure
(`XCTAttachment` / automatic failure screenshots are already inside the
`.xcresult`, no separate step needed).

### 8. Inspect network/logs

```sh
xcrun simctl spawn "{{SIMULATOR_DEVICE}}" log stream \
  --predicate 'subsystem == "{{BUNDLE_ID}}"' --style compact > logs/os_log.txt &
LOG_PID=$!
# ... run step 7 ...
kill $LOG_PID
```

For request/response-level network capture rather than app log lines,
either rely on the app's own debug-build logging (as with Android) or
route the Simulator through a local proxy (`http_proxy`/`https_proxy`
env vars, or `mitmproxy`) for the duration of the run — Simulator network
traffic is the host Mac's network stack, so a host-level proxy sees it
without any Simulator-side configuration.

### 9. Screenshots

`xcresulttool` already extracts any XCUITest-captured screenshots (step
7). For a manual/exploratory pass instead:

```sh
xcrun simctl io "{{SIMULATOR_DEVICE}}" screenshot screenshots/<step-name>.png
```

### 10. Cleanup

```sh
xcrun simctl uninstall "{{SIMULATOR_DEVICE}}" {{BUNDLE_ID}}
xcrun simctl shutdown "{{SIMULATOR_DEVICE}}"
xcrun simctl delete "{{SIMULATOR_DEVICE}}"   # if this run created a dedicated instance (step 3)
```

## Evidence capture

Copy into `.agent/runs/<TASK-ID>/verification/`:

```
build/TestResults.xcresult          (or an extracted subset — xcresult bundles can be large)
logs/os_log.txt
logs/<service-name>.log             (if a backend was started per repo.yaml)
screenshots/*.png
```

Then write `verification/result.json` per `docs/evidence-contract.md` —
one `checks[]` entry per XCUITest class/journey, `evidence` pointing at
the `.xcresult` (or an extracted JSON summary via `xcresulttool`) plus
any manual screenshots. There is no script here to write that file
automatically; a thin repo-specific wrapper around `xcresulttool get
--format json` can generate it mechanically once this repo's test
target names are known.

## Where gstack-ios-qa plugs in — real device, no Simulator/XCTest

The checklist above is the deterministic Simulator/XCTest path spec
§9.3 lists first. For **live-device** verification — driving an actual
iPhone over USB, reading Swift source to understand every screen, and
running a vision-driven find→fix→verify agent loop against a debug
StateServer bridge instead of WebDriverAgent/XCUITest — see
`skills/vendor/gstack/skills/ios-qa/SKILL.md`. That skill's own
"Platform integration" section already states the contract this
platform expects: it lands reproduce → fix → rebuild → reverify evidence
(screenshots, StateServer captures, repro steps) under
`.agent/runs/<TASK-ID>/verification/`, shaped as `result.json` entries
per the same F.7 shape this README's checklist produces — it is
complementary evidence, not a replacement for F.7's own independent,
re-executed verification of the candidate (roles/F7-verifier.md #1;
AGENTS.md "Workers do not certify themselves").

Use the Simulator/XCTest path above when a task's risk tier calls for
runtime verification without device-specific behavior (spec §9.5 R2);
reach for gstack-ios-qa when the task specifically concerns real-device
behavior (camera, biometrics, push notifications, performance on actual
hardware) that a Simulator cannot exercise.

## Flake control

Same policy as every other app type (spec §9.5, see `../README.md`):
retry a failing XCUITest class once automatically before recording FAIL,
classify every failure PRODUCT FAILURE | ENVIRONMENT FAILURE | FLAKE,
and track repeat offenders in `../quarantine.yaml` as
`ios:<test-class-or-journey-name>`.
