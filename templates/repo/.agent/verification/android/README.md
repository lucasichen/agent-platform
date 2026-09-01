# Android Verification (spec §9.3)

<!--
owner: repo maintainer role (spec §12.4, same authority as repo.yaml)
staleness trigger: every command below is executed by CI and by
  verifier tasks (spec §9, roles/F7-verifier.md); a command that stops
  succeeding fails the build, the same mechanical trigger as a broken
  repo.yaml command (spec §12.4). Verify the exact commands/paths below
  against this repository's actual Gradle module layout before trusting
  them — they are the standard Android toolchain sequence, not this
  repo's pinned module names.
-->

There is no `run.mjs` here, deliberately. Android toolchains vary too
much across repos — Gradle module layout, flavor/variant names, device
lab vs. local emulator, instrumentation framework (Espresso, UI
Automator, Compose testing) — for one script to pretend to run them
generically without silently doing the wrong thing for this repo. An
honest checklist a verifier (human or agent) executes step by step beats
a script that fakes success. If this repo's CI already runs these steps
as a named job, point `repo.yaml`'s `verification.android` at that job
instead of re-deriving it here.

Fill in the placeholders below once for this repository (module name,
package id, flavor/variant, device/AVD name), then this file *is* the
deterministic instruction sequence spec §9 requires — a verifier follows
it top to bottom and gets a reproducible pass/fail, exactly like a
script would.

```
{{APP_MODULE}}       e.g. app
{{PACKAGE_ID}}        e.g. com.example.app
{{VARIANT}}           e.g. debug
{{LAUNCH_ACTIVITY}}    e.g. com.example.app.MainActivity
{{AVD_NAME}}          e.g. verify-pixel-6-api-34
```

## Run-checklist

### 1. Environment setup

- Android SDK installed, `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) set.
- JDK version this repo's `build.gradle`/`gradle.properties` requires.
- Licenses accepted: `sdkmanager --licenses` (non-interactive: `yes | sdkmanager --licenses`).
- `./gradlew --version` succeeds from the repo root (proves the wrapper + JDK match).

### 2. Backend dependencies, if this app talks to one

If `repo.yaml` declares `services`/`dependencies` this app needs at
runtime, start and health-check them the same way the web/API scaffolds
do (`repo.yaml` `services.*.command` / `.health`) before installing the
app — an app that can't reach its backend fails every journey for the
wrong reason.

### 3. Port allocation (concurrent verifier runs)

Give each concurrent verifier run its own AVD (`{{AVD_NAME}}-$RUN_ID`)
or its own physical device via `adb -s <serial>` — never share one
emulator/device across concurrent runs; ADB commands below assume a
single target device is unambiguous (`adb devices` returns exactly one),
so add `-s <serial>` to every `adb`/`gradlew -Pandroid.testInstrumentationRunnerArguments...`
invocation once more than one device is in play.

### 4. Build

```sh
./gradlew :{{APP_MODULE}}:assemble{{VARIANT}} :{{APP_MODULE}}:assemble{{VARIANT}}AndroidTest
```

A build failure here is a build failure, full stop — do not proceed to
install/launch on a broken build.

### 5. Emulator / device

```sh
# Emulator (create once, reuse across runs by name):
avdmanager create avd -n {{AVD_NAME}} -k "system-images;android-34;google_apis;x86_64" --force
emulator -avd {{AVD_NAME}} -no-snapshot -no-window &   # drop -no-window for a visible run
adb wait-for-device
adb shell 'while [[ -z $(getprop sys.boot_completed) ]]; do sleep 1; done'

# Physical device: connect via USB, `adb devices` must list it as `device` (not `unauthorized`).
```

### 6. Install

```sh
adb install -r {{APP_MODULE}}/build/outputs/apk/{{VARIANT}}/{{APP_MODULE}}-{{VARIANT}}.apk
```

### 7. Launch

```sh
adb shell am start -n {{PACKAGE_ID}}/{{LAUNCH_ACTIVITY}}
```

### 8. Drive UI + inspect resulting state

Prefer instrumented tests as the deterministic driver — they are the
"program executes assertions deterministically" half of spec §9.2's rule
applied to mobile:

```sh
./gradlew :{{APP_MODULE}}:connected{{VARIANT}}AndroidTest
```

Instrumented-test results land under
`{{APP_MODULE}}/build/outputs/androidTest-results/connected/` and
`{{APP_MODULE}}/build/reports/androidTests/connected/` — copy both into
this run's evidence directory (see Evidence capture below).

If a task's `verification:` block calls for a manual/exploratory drive
instead of (or in addition to) instrumented tests, use `adb shell input
tap <x> <y>` / `adb shell input text "<string>"` / `adb shell input
keyevent <code>` and pair every action with a screenshot (step 10) so
the transcript is reconstructable.

### 9. Inspect network

- Simplest deterministic option: if the app already logs its HTTP calls
  (e.g. an OkHttp `HttpLoggingInterceptor` in debug builds), capture them
  via logcat (step 11) filtered to that logger's tag.
- For full traffic capture independent of app logging: route the
  emulator/device through a local proxy (`adb shell settings put global
  http_proxy <host>:<port>`, then `mitmdump -w network.mitm` or similar)
  and stop the proxy after the run; **only on emulators/dedicated test
  devices with test-only credentials** — never point a real user's
  device or account at an interception proxy.

### 10. Screenshots

```sh
adb exec-out screencap -p > screenshots/<step-name>.png
```
or, from inside an instrumented test, `Screenshot.capture(...).process()`
(AndroidX Test) writes to the device's screenshot output directory that
`connectedAndroidTest` already pulls back under
`build/outputs/connected_android_test_additional_output/`.

### 11. adb logcat

```sh
adb logcat -c                      # clear before the run so logs are scoped to it
# ... drive the app (steps 8-10) ...
adb logcat -d --pid=$(adb shell pidof -s {{PACKAGE_ID}}) > logcat.txt
```

Treat any `E/`-level line from the app's own package as a candidate
failure — attach it to the relevant check's evidence even if the
instrumented test itself passed, the same way the web scaffold treats a
browser console error as a failure (spec §9.1 parity).

### 12. Cleanup

```sh
adb uninstall {{PACKAGE_ID}}
adb emu kill        # if this run started its own emulator
```

Never leave a run's emulator/AVD running for the next run to inherit
state from — spec §9 "cleanup" exists specifically so runs don't
contaminate each other (see also §16.3 isolation).

## Evidence capture

Copy into `.agent/runs/<TASK-ID>/verification/`:

```
logs/logcat.txt
logs/<service-name>.log            (if a backend was started per repo.yaml)
screenshots/*.png
androidTest-results/               (instrumented test XML)
androidTests-report/               (instrumented test HTML report)
network.mitm                       (if network capture was used)
```

Then write `verification/result.json` per `docs/evidence-contract.md`
(same shape the web/api scaffolds' `run.mjs` produces) — one `checks[]`
entry per instrumented test class/journey, each `evidence` pointing at
the file(s) above that back it. There is no script here to write that
file automatically; a verifier (or a thin repo-specific wrapper around
`./gradlew connectedAndroidTest` that parses the JUnit XML) produces it.

## Flake control

Same policy as every other app type (spec §9.5, see `../README.md`):
retry a failing instrumented test class once automatically before
recording FAIL, classify every failure PRODUCT FAILURE | ENVIRONMENT
FAILURE | FLAKE, and track repeat offenders in `../quarantine.yaml` as
`android:<test-class-or-journey-name>`.
