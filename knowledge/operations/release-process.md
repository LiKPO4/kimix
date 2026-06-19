---
type: Runbook
title: Release Process
description: Kimix releases are built and published only by the tag-triggered GitHub Actions workflow with version-specific release notes.
resource: https://github.com/LiKPO4/kimix/blob/master/.github/workflows/release.yml
tags: [release, github-actions, versioning, operations]
timestamp: "2026-06-19T00:00:00+08:00"
---

# Release Process

Kimix release artifacts are produced by GitHub Actions, not by manual local packaging or manual upload.

# Preconditions

1. Synchronize the application version in `package.json`, `src/components/layout/Sidebar.tsx`, and `src/components/settings/SettingsPanel.tsx` when a product release is being prepared.
2. Add `docs/release-notes/vX.Y.Z.md` with content specific to that version.
3. Run `pnpm knowledge:validate`, tests, production build, and `git diff --check`.
4. Commit and push the reviewed code to `master`.

# Publish

1. Create tag `vX.Y.Z` on the intended commit.
2. Push the tag.
3. Let `.github/workflows/release.yml` build Windows, macOS, and Linux artifacts.
4. Confirm the release job selected `docs/release-notes/vX.Y.Z.md` instead of the root fallback.
5. Confirm all platform jobs and the final published release succeeded.

# Prohibitions

* Do not run a local distribution build and upload its artifacts over CI output.
* Do not tag without version-specific release notes.
* Do not reuse stale release notes from a previous version.

# Related Knowledge

* [Knowledge Maintenance Policy](/maintenance/knowledge-maintenance.md)

# Sources

* [Release workflow](https://github.com/LiKPO4/kimix/blob/master/.github/workflows/release.yml)
* [Project development rules](https://github.com/LiKPO4/kimix/blob/master/AGENTS.md)
