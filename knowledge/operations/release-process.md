---
type: Runbook
title: Release Process
description: Kimix releases are built and published only by the tag-triggered GitHub Actions workflow with version-specific release notes.
resource: https://github.com/LiKPO4/kimix/blob/master/.github/workflows/release.yml
tags: [release, github-actions, versioning, operations]
timestamp: "2026-07-13T21:58:00+08:00"
---

# Release Process

Kimix release artifacts are produced by GitHub Actions, not by manual local packaging or manual upload.

# Preconditions

1. Synchronize the application version in `package.json`, `src/components/layout/Sidebar.tsx`, and `src/components/settings/SettingsPanel.tsx` when a product release is being prepared.
2. Add `docs/release-notes/vX.Y.Z.md` with content specific to that version.
3. Run `pnpm knowledge:validate`, tests, production build, and `git diff --check`.
4. Commit and push the reviewed code to `master`.

After changing `package.json`, `pnpm-lock.yaml`, or dependency state, run the `pnpm` validation commands serially. Multiple fresh `pnpm` processes may simultaneously enter dependency-status repair and race on `node_modules/.bin` or native rebuild output; that infrastructure failure does not provide valid test evidence. Non-`pnpm` read-only checks such as `git diff --check` may still run alongside a single package-manager command.

# Publish

1. Create tag `vX.Y.Z` on the intended commit.
2. Push the tag.
3. Let `.github/workflows/release.yml` build Windows, macOS, and Linux artifacts.
4. Confirm the release job selected `docs/release-notes/vX.Y.Z.md` instead of the root fallback.
5. Confirm all platform jobs and the final published release succeeded.

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

# Related Knowledge

* [Knowledge Maintenance Policy](/maintenance/knowledge-maintenance.md)

# Sources

* [Release workflow](https://github.com/LiKPO4/kimix/blob/master/.github/workflows/release.yml)
* [Project development rules](https://github.com/LiKPO4/kimix/blob/master/AGENTS.md)
