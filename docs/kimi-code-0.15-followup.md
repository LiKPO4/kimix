# Kimi Code 0.15.0 Follow-up

- Date: 2026-06-16
- Upstream package: `@moonshot-ai/kimi-code@0.15.0`
- Upstream tag: `@moonshot-ai/kimi-code@0.15.0`
- Upstream commit: `18aa21575b893c02f244272e78e994afe1b0adcc`
- Official node SDK package version: `@moonshot-ai/kimi-code-sdk@0.9.3`

## Completed In Kimix v2.9.109

- Confirmed npm latest for `@moonshot-ai/kimi-code` is `0.15.0`.
- Updated the local upstream research checkout to tag `@moonshot-ai/kimi-code@0.15.0`.
- Rebuilt `packages/node-sdk` successfully.
- Regenerated Kimix's self-contained vendored SDK bundle at `vendor/kimi-code-sdk/index.mjs`.
- Updated `vendor/kimi-code-sdk/README.md` provenance to the 0.15.0 tag.
- Updated the local lightweight SDK probe to use the current `getExperimentalFeatures()` API with a legacy fallback.

## Upstream Notes

- 0.15.0 adds an all-sessions picker in the official TUI.
- 0.15.0 adds legacy SSE MCP server support.
- 0.15.0 adds staged automatic update rollout infrastructure.
- 0.15.0 includes TUI rendering, prompt guidance, resume recovery, model metadata, media detection, and skill-context fixes.

## Kimix Impact

- No Kimix renderer or IPC API change was required in this pass.
- `packages/node-sdk` remains version `0.9.3`, and the public SDK surface used by Kimix did not show a breaking API change during this diff.
- The official all-sessions picker is TUI-only for now; Kimix already owns its session list and migration UX, so no UI was added.
- SSE MCP support is inherited through the refreshed SDK/runtime path; no extra Kimix MCP schema change was needed in this pass.

## Verification

- `pnpm --filter @moonshot-ai/kimi-code-sdk build` in the upstream research checkout.
- `pnpm vendor:kimi-code-sdk`
- `node scripts/probe-kimi-code-0.8.mjs`
- `pnpm test:run -- src/utils/__tests__/kimiCodeEventMapper.test.ts src/utils/__tests__/eventMapper.test.ts`
- `pnpm build`
