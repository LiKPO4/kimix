# Kimi Code 0.18.0 Follow-up

- Date: 2026-06-19
- Upstream package: `@moonshot-ai/kimi-code@0.18.0`
- Upstream tag: `@moonshot-ai/kimi-code@0.18.0`
- Upstream commit: `e6c2f51fa3ed471e983a6dc4b2977709c62a9200`
- Official node SDK package version: `@moonshot-ai/kimi-code-sdk@0.9.4`

## Completed In Kimix v2.10.17

- Confirmed the locally installed official CLI is `kimi 0.18.0`.
- Fetched the official `@moonshot-ai/kimi-code@0.18.0` tag from `github.com/MoonshotAI/kimi-code`.
- Rebuilt `packages/node-sdk` from the 0.18.0 source checkout.
- Regenerated Kimix's self-contained vendored SDK bundle at `vendor/kimi-code-sdk/index.mjs`.
- Kept Kimix's fallback MCP startup timeout patch: upstream default `30s` remains narrowed to `4s` unless a server declares `startupTimeoutMs` or `KIMIX_KIMI_CODE_MCP_STARTUP_TIMEOUT_MS` overrides it.
- Updated `vendor/kimi-code-sdk/README.md` provenance to the 0.18.0 tag.
- Hardened `scripts/vendor-kimi-code-sdk.mjs` to prefer a workspace-local official source checkout before the legacy `%TEMP%` checkout, avoiding Windows user-directory ACL failures during bundling.

## Upstream Notes

- Official release notes mention AgentSwarm concurrent agent limit changes.
- The Web sidebar gained instant search behavior.
- Plugin change prompts now guide users toward `/reload`.
- The official CLI still does not expose `kimi plugin ...` or `kimi mcp ...` management subcommands in `kimi --help`; Kimix should keep using the SDK/harness path for plugin updates and direct `mcp.json` maintenance for ordinary MCP config.

## Kimix Impact

- `packages/node-sdk` remains version `0.9.4`, so the follow-up is a source refresh rather than a public SDK semver bump.
- The MCP update work from v2.10.13-v2.10.16 remains aligned with official behavior: plugin updates go through SDK install APIs, and runtime reload/restart is still required after plugin MCP changes.
- The previous 4-second MCP fallback timeout is still present after regeneration.

## Verification

- `git -c http.sslBackend=openssl fetch --tags origin` in the legacy official research checkout.
- `pnpm install --frozen-lockfile` in the workspace-local 0.18.0 official checkout.
- `pnpm --filter @moonshot-ai/kimi-code-sdk build` in the workspace-local 0.18.0 official checkout.
- `node scripts/vendor-kimi-code-sdk.mjs`.

