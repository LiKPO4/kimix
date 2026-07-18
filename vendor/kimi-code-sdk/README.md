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
| Source commit | `5cc194956f6f9752d172aa4994385d2d2e7a066f` (2026-07-17, "ci: release packages (#1785)", tag `@moonshot-ai/kimi-code@0.27.0`) |
| node-sdk version | `0.13.4` |
| Validated against CLI | installed `0.27.0` / source tag `@moonshot-ai/kimi-code@0.27.0` |
| Bundled on | 2026-07-18 |
| Bundler | `esbuild` (`--bundle --platform=node --format=esm`) + `createRequire` banner |
| Externalized (optional natives) | `bufferutil`, `utf-8-validate`, `canvas` (consumers guard with try/catch) |

## Kimix runtime policy

Kimix changes the SDK fallback MCP startup timeout from 30 seconds to 4 seconds.
Servers that declare `startupTimeoutMs` keep their own value. The fallback can be
overridden with `KIMIX_KIMI_CODE_MCP_STARTUP_TIMEOUT_MS`. The vendor script applies
this patch after every regeneration and fails loudly if the upstream marker changes.

## How to refresh

1. Update the research checkout and rebuild the SDK:
   `pnpm install && pnpm --filter @moonshot-ai/kimi-code-sdk build`
   (the `tsdown` bundle step is what matters for runtime; `.d.ts` output is useful but
   not required by the packaged app.)
2. Regenerate this bundle:
   `node scripts/vendor-kimi-code-sdk.mjs`
   The script first honors `KIMIX_KIMI_CODE_RESEARCH_REPO`, then local workspace
   checkouts such as `.kimix-upstream-kimi-code`, then the legacy `%TEMP%`
   research checkout. This avoids Windows user-directory ACL issues during
   esbuild dependency resolution.
3. Re-validate compatibility by running the current host smoke probe:
   `node scripts/probe-kimi-code-host.mjs`.
4. Update the provenance table above and commit.

## Strategic risk

Kimix's main interaction depends on an SDK the vendor has not publicly released or
documented. If Moonshot restructures or stops shipping `packages/node-sdk`, this
vendored bundle is the pinned, known-good fallback — keep tracking the upstream repo.

Historical migration and probe notes are archived under `docs/archive/`; they should
not be used as the current integration source of truth.
