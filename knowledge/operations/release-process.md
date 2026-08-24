---
type: Runbook
title: Release Process
description: Kimix releases are built and published only by the tag-triggered GitHub Actions workflow with version-specific release notes.
resource: https://github.com/LiKPO4/kimix/blob/master/.github/workflows/release.yml
tags: [release, github-actions, versioning, operations]
timestamp: "2026-08-24T21:38:41+08:00"
---

# Release Process

Kimix release artifacts are produced by GitHub Actions, not by manual local packaging or manual upload.

# Preconditions

1. Set the application version in `package.json`, the single version source injected into the renderer at build time.
2. Add `docs/release-notes/vX.Y.Z.md` with content specific to that version, written for end users: user-visible changes and known limitations only, scoped from the last actually published release (a withdrawn version folds into the next one). Omit developer-facing sections such as verification evidence and suggested retest steps.
3. Run `pnpm typecheck`, tests, production build, `pnpm knowledge:validate`, and `git diff --check`.
4. Commit and push the reviewed code to `master`.

After changing `package.json`, `pnpm-lock.yaml`, or dependency state, run the `pnpm` validation commands serially. Multiple fresh `pnpm` processes may simultaneously enter dependency-status repair and race on `node_modules/.bin` or native rebuild output; that infrastructure failure does not provide valid test evidence. Non-`pnpm` read-only checks such as `git diff --check` may still run alongside a single package-manager command.

`pnpm typecheck` is the strict compile-time gate for both process boundaries. It runs `tsconfig.node.json` for Electron main/preload code before `tsconfig.json` for renderer, shared utilities, and tests. Production builds are not accepted as type evidence because Vite transpiles TypeScript without proving these contracts. Unused-symbol cleanup remains outside this safety gate; strict nullability, unions, IPC payloads, and control-flow checks remain enabled.

# Publish

1. Create tag `vX.Y.Z` on the intended commit.
2. Push the tag.
3. Let `.github/workflows/release.yml` validate the tag-specific notes before building Windows, macOS, and Linux artifacts. Platform jobs package with `--publish never` and upload Actions artifacts; they must never create GitHub Releases in parallel.
4. The single `publish-release` job downloads and merges all platform artifacts, creates one draft Release, uploads every asset plus `SHA256SUMS.txt`, and only then makes it public. This job is the sole Release owner.
5. Confirm the release job found `docs/release-notes/vX.Y.Z.md`; the workflow must fail before publishing when the tag-specific file is missing and must never fall back to `RELEASE_NOTES.md`.
6. Confirm all platform jobs and the final published release succeeded, then inspect the public asset inventory. A green workflow is insufficient when Windows, macOS, or Linux artifacts are absent.

7. Verify naming consistency across the three metadata sources before declaring the release healthy: `latest.yml` / `latest-mac.yml` / `latest-linux.yml`, `SHA256SUMS.txt`, and the actual Release asset names must match exactly. The Windows updater reads `latest.yml`, resolves `releases/latest/download/<path>`, and verifies SHA256/SHA512 keyed by asset name. A mismatch (e.g. re-renamed assets after upload) breaks auto-update with “缺少 SHA256/SHA512 校验值” or a 404. Spot-check with `curl -sIL <download-url>`. The workflow already asserts that the built `latest.yml` path exists in `dist/` before upload.



# Packaging Notes

* Platform-level `files` (e.g. `win.files`) **replaces** the top-level `files` whitelist instead of merging. Keep the full whitelist (`out/**/*`, `package.json`, exclusions) inside every platform block; otherwise electron-builder packages the entire working directory, including local-only directories such as `.pnpm-store` (multi-GB), blowing up `app.asar`.

* `@huggingface/transformers` pulls `onnxruntime-node` (npm tarball ships all-platform libs, ~208 MB) and `onnxruntime-web` (~89 MB) into production dependencies. Exclude non-current-platform binaries per platform block (`!**/onnxruntime-node/bin/napi-v3/{darwin,linux}/**` on Windows, etc.) and exclude `onnxruntime-web` entirely — the local-translation worker only uses the Node backend. Unpack `node_modules/onnxruntime-node/**` via `asarUnpack` because its DLLs must be real files for `LoadLibrary`.

* Windows artifact naming defaults vary; pin explicit `nsis.artifactName` / `portable.artifactName` so `latest.yml`, `SHA256SUMS.txt`, and the uploaded asset names stay identical across builds.

* Windows icon identity has three linked consumers, none of which may rely on Electron fallback: `win.icon` embeds the version-controlled `build/icon.ico` into the executable, `extraResources` copies it to `resources/icon.ico`, and the main process loads that packaged/dev path for both `BrowserWindow.setIcon()` and `setAppDetails({ appId, appIconPath })`. The ICO must retain a 256px frame and the AppUserModelID must remain equal to electron-builder `appId`. A renderer PNG or an icon present only under `build/` is insufficient because platform `files` whitelists do not copy it into the packaged runtime.

# Development Guidelines

## Error reporting

Background operation failures (persistence, cleanup, polling) must not interrupt the user but must leave a trace for debugging. Use the `reportError` utility (`src/utils/reportError.ts`) instead of `.catch(() => {})`:

- `reportError(error, { context })` — writes to `console.warn` and the diag log.
- `reportError(error, { context, userVisible: true })` — also dispatches a toast.
- The `logError(context)` shorthand can be passed directly to `.catch()`.

Best-effort cleanup operations (`cancelKimiCodeTurn`, `closeKimiCodeSession`) may remain silent, but all other previously silent catches should be converted.

# Prohibitions

* Do not run a local distribution build and upload its artifacts over CI output.
* Do not tag without version-specific release notes.
* Do not reuse stale release notes from a previous version.
* Do not add one release-notes file for every untagged internal patch. The next actual release gets one aggregate file covering changes since the previous published tag.
* Do not let parallel platform jobs use `electron-builder --publish always`; concurrent draft creation can split one tag's assets across multiple hidden Releases.

# Related Knowledge

* [Knowledge Maintenance Policy](/maintenance/knowledge-maintenance.md)

# Sources

* [Release workflow](https://github.com/LiKPO4/kimix/blob/master/.github/workflows/release.yml)
* [Project development rules](https://github.com/LiKPO4/kimix/blob/master/AGENTS.md)
