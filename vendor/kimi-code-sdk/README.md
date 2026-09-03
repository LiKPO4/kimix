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
| Official base | `0d45dddc57510e6b1306dd12c0b0703c37b8c63a` (tag `@moonshot-ai/kimi-code@0.40.1`) |
| Feature overlay | None; custom Agents, plugin Agents/system prompts, and secondary-model routing are upstream |
| Kimix overlay | MCP fallback startup timeout only, applied by the vendor script |
| node-sdk version | `0.20.0` |
| Validated against CLI | source tag `@moonshot-ai/kimi-code@0.40.1` |
| Bundled on | 2026-09-03 |
| Bundler | `esbuild` (`--bundle --platform=node --format=esm`) + `createRequire` banner |
| Externalized (optional natives) | `bufferutil`, `utf-8-validate`, `canvas` (consumers guard with try/catch) |

## Kimix runtime policy

Kimix changes the SDK fallback MCP startup timeout from 30 seconds to 4 seconds.
Servers that declare `startupTimeoutMs` keep their own value. The fallback can be
overridden with `KIMIX_KIMI_CODE_MCP_STARTUP_TIMEOUT_MS`. The vendor script applies
this patch after every regeneration and fails loudly if the upstream marker changes.

This overlay only patches the agent-core-v2 engine's `McpConnectionManager`; the v1 fallback engine (`KIMIX_SDK_ENGINE=v1`) keeps the upstream 30s fallback and remains overridable via the upstream `KIMI_MCP_STARTUP_TIMEOUT_MS`.

Kimi Code `0.31.0` brings Markdown custom Agents and secondary-model routing to the
legacy Node SDK path, and adds plugin-contributed Agents and system prompts to both
engines. Kimix therefore vendors the clean official tag instead of carrying the
former dual-model-routing and sticky-resume overlays. Runtime feature flags and
profile precedence remain owned by the official SDK.

The `0.39.0` SDK restores live v2 context-window usage snapshots and lets global MCP
management calls carry an optional working directory. Kimi Code `0.40.1` updates the
bundled SDK to `0.20.0`, which adds session-less `suggestFiles(workDir, { query, limit })`
through the v2 workspace file-service (the v1 engine returns `undefined`). Tower mode is
available through the SDK session contract and is surfaced by Kimix's existing desktop
control; Kimix receives live context snapshots through its existing status path.

The `0.31.0` host-identity contract requires `productName`, `version`, and `platform`.
Kimix identifies itself as the desktop host rather than impersonating the CLI.

## How to refresh

1. Start from the latest official release tag without feature overlays.
2. Install and rebuild the SDK:
   `pnpm install && pnpm --filter @moonshot-ai/kimi-code-sdk build`
   The `tsdown` output is what matters for runtime. A Windows-only `build:dts`
   cleanup failure does not invalidate an already-successful `dist/index.mjs` build.
3. Regenerate this bundle:
   `node scripts/vendor-kimi-code-sdk.mjs`
   The script first honors `KIMIX_KIMI_CODE_RESEARCH_REPO`, then local workspace
   checkouts such as `.kimix-upstream-kimi-code`, then the legacy `%TEMP%`
   research checkout. This avoids Windows user-directory ACL issues during
   esbuild dependency resolution.
4. Re-validate compatibility by running the current host smoke probe:
   `node scripts/probe-kimi-code-host.mjs`.
5. Confirm that the vendor script still applies exactly the MCP timeout patch, then
   update the provenance table above and commit.

## Strategic risk

Kimix's main interaction depends on an SDK the vendor has not publicly released or
documented. If Moonshot restructures or stops shipping `packages/node-sdk`, this
vendored bundle is the pinned, known-good fallback — keep tracking the upstream repo.

Historical migration and probe notes are archived under `docs/archive/`; they should
not be used as the current integration source of truth.
