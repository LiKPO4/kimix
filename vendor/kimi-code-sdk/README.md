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
| Source commit | `9143fdadf68c252ed4d84b16db0d8274390fa132` (2026-06-02, "docs(changelog): sync 0.8.0 from apps/kimi-code/CHANGELOG.md (#342)") |
| node-sdk version | `0.6.0` |
| Validated against CLI | `kimi 0.8.0` |
| Bundled on | 2026-06-02 |
| Bundler | `esbuild` (`--bundle --platform=node --format=esm`) + `createRequire` banner |
| Externalized (optional natives) | `bufferutil`, `utf-8-validate`, `canvas` (consumers guard with try/catch) |

## How to refresh

1. Update the research checkout and rebuild the SDK:
   `pnpm install && pnpm --filter @moonshot-ai/kimi-code-sdk build`
   (the `tsdown` bundle step is what matters; the `build:dts` step fails on Windows
   with `spawn EINVAL` but only affects `.d.ts`, not the runtime `index.mjs`.)
2. Regenerate this bundle:
   `node scripts/vendor-kimi-code-sdk.mjs`
3. Re-validate compatibility by re-running the P0 probe:
   `node scripts/probe-kimi-code-sdk.mjs` (see `docs/kimi-code-sdk-probe-result.md`).
4. Update the provenance table above and commit.

## Strategic risk (tracked in `KIMI_CODE_SDK_MIGRATION_PLAN.md`, audit item 1b)

Kimix's main interaction depends on an SDK the vendor has not publicly released or
documented. If Moonshot restructures or stops shipping `packages/node-sdk`, this
vendored bundle is the pinned, known-good fallback — keep tracking the upstream repo.
