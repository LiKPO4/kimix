# Vendored official Kimi Code SDK (`@moonshot-ai/kimi-code-sdk`)

`index.mjs` here is a **self-contained, re-bundled** copy of the official Kimi Code
Node SDK (`KimiHarness` / `Session`), which Kimix's new main engine
(`electron/kimiCodeHost.ts`) loads at runtime.

## Why this is vendored (and not an npm dependency)

- The official SDK is **not published to npm** — `registry.npmjs.org/@moonshot-ai/kimi-code-sdk`
  returns 404. Only the CLI package `@moonshot-ai/kimi-code` is published.
- In the official repo the SDK package (`packages/node-sdk`) is still marked
  `private: true` and is not mentioned in the official docs.
- The SDK's own built `dist/index.mjs` is **not self-contained** — it bare-imports
  `zod`, `ajv`, `google-auth-library`, `@modelcontextprotocol/sdk`, `@google/genai`,
  `smol-toml`, `yazl`, etc. from `node_modules`. Copying `dist/` alone crashes on any
  machine without the research repo's `node_modules` (CI, packaged app, fresh checkout).

So we re-bundle it into one file with all JS dependencies inlined. This removes the
previous runtime dependency on a `%TEMP%/kimix-kimi-code-research` directory.

## Provenance (update when refreshing)

| Field | Value |
|---|---|
| Source repo | `github.com/MoonshotAI/kimi-code` (`packages/node-sdk`) |
| Official base | `8bf5bacba9e524c38fb808c0122070037ead25a8` (tag `@moonshot-ai/kimi-code@0.29.0`) |
| Feature overlay | PR #1996 commits `3f473324`, `6a07fe8e`, `86e052d1`, `142292e5`, `f9473d4c`, `30f7418c` |
| Kimix overlay | sticky resume/retry + effective spawn routing audit (`3e8c36a3` in the local build worktree) |
| node-sdk version | `0.14.0` |
| Validated against CLI | installed `0.29.0` / source tag `@moonshot-ai/kimi-code@0.29.0` |
| Bundled on | 2026-07-22 |
| Bundler | `esbuild` (`--bundle --platform=node --format=esm`) + `createRequire` banner |
| Externalized (optional natives) | `bufferutil`, `utf-8-validate`, `canvas` (consumers guard with try/catch) |

## Kimix runtime policy

Kimix changes the SDK fallback MCP startup timeout from 30 seconds to 4 seconds.
Servers that declare `startupTimeoutMs` keep their own value. The fallback can be
overridden with `KIMIX_KIMI_CODE_MCP_STARTUP_TIMEOUT_MS`. The vendor script applies
this patch after every regeneration and fails loudly if the upstream marker changes.

The official `0.29.0` release does not include the still-open PR #1996. Kimix ports
that PR onto the clean `0.29.0` tag instead of bundling the PR branch wholesale,
because its branch package metadata and unrelated tree state differ from the release.
Kimix enables the resulting `dual-model-routing` experiment for SDK sessions and
keeps resumed/retried subagents on the model and thinking effort they were created
with. New defaults apply only to newly spawned children. The bundled protocol adds
the effective `modelAlias` and `thinkingEffort` to `subagent.spawned` events so the
UI can audit the model actually used. These two semantics are Kimix patches on top
of the referenced open upstream PR and must be re-applied when refreshing the bundle.

Kimi Code `0.29.0` Markdown custom agents are implemented by the official v2 Server,
not by this legacy Node SDK harness. Kimix keeps inherited subagent routing on Server
so project/user `agents/*.md` discovery remains available. Choosing a dedicated
subagent model or effort is an explicit compatibility-route opt-in until upstream
exposes dual-model routing in an official Server release.

## How to refresh

1. Start from the latest official release tag, then cherry-pick only the six PR #1996
   commits listed in the provenance table. Re-apply the Kimix sticky resume/retry and
   `subagent.spawned` audit patch; do not use the PR branch tree as the release base.
2. Install and rebuild the SDK:
   `pnpm install && pnpm --filter @moonshot-ai/kimi-code-sdk build`
   (the `tsdown` bundle step is what matters for runtime; `.d.ts` output is useful but
   not required by the packaged app.)
3. Regenerate this bundle:
   `node scripts/vendor-kimi-code-sdk.mjs`
   The script first honors `KIMIX_KIMI_CODE_RESEARCH_REPO`, then local workspace
   checkouts such as `.kimix-upstream-kimi-code`, then the legacy `%TEMP%`
   research checkout. This avoids Windows user-directory ACL issues during
   esbuild dependency resolution.
4. Re-validate compatibility by running the current host smoke probe:
   `node scripts/probe-kimi-code-host.mjs`.
5. Update the provenance table above and commit.

## Strategic risk

Kimix's main interaction depends on an SDK the vendor has not publicly released or
documented. If Moonshot restructures or stops shipping `packages/node-sdk`, this
vendored bundle is the pinned, known-good fallback — keep tracking the upstream repo.

Historical migration and probe notes are archived under `docs/archive/`; they should
not be used as the current integration source of truth.
