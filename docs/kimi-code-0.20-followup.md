# Kimi Code 0.20.0 Follow-up

- Date: 2026-06-26
- Upstream package: `@moonshot-ai/kimi-code@0.20.0`
- Upstream tag: `@moonshot-ai/kimi-code@0.20.0`
- Upstream commit: `5f36e763ca671a2a67b4b9e5c42a611511a1e6b3`
- Official node SDK package version: `@moonshot-ai/kimi-code-sdk@0.10.0`

## Confirmed

- Local `kimi --version` returns `0.20.0`.
- npm latest for `@moonshot-ai/kimi-code` is `0.20.0`.
- The local upstream audit checkout at `%TEMP%/kimix-kimi-code-0.20-audit` is on tag `@moonshot-ai/kimi-code@0.20.0` / commit `5f36e763ca671a2a67b4b9e5c42a611511a1e6b3`.
- The upstream tag object is `1f19b8ff68ef1e36e3f531348b3a71098d4a7540`.

## Follow-up Todolist

1. [x] Refresh Kimix's vendored SDK bundle from the official node SDK `0.10.0`, keeping the Kimix MCP fallback startup timeout patch.
2. [x] Support web-chat Markdown display math by adding `remark-math`, `rehype-katex`, and KaTeX styling.
3. [x] Pass `forcePluginSessionStartReminder: true` for the explicit SDK `/reload` path so plugin Skill changes are visible in the current session.
4. [x] Keep Server `/reload` unsupported until an official REST route is exposed; do not pretend a local metadata refresh updates Server session plugin state.
5. [ ] Evaluate whether official web-chat line-by-line file diff should be mirrored in Kimix, or whether existing tool/output rendering is sufficient.
6. [ ] Evaluate official plugin management changes (`/plugins` Installed/Official/Third-party/Custom tabs, update badges, third-party confirmation) against Kimix's existing plugin UI.
7. [ ] Evaluate whether web-session pagination/title sync changes require Kimix sidebar data-source adjustments.
8. [ ] Track shell mode, `kimi web --host`, TUI focus, clipboard, compression Ctrl-C, subagent git context, and task-output keyboard changes as upstream CLI/TUI behavior unless Kimix exposes the same surface.

## Upstream Notes

- 0.20.0 adds TUI shell mode through `!`, with Ctrl+B support for moving long-running shell commands to background tasks.
- `kimi web` adds `--host` for exposing the server beyond localhost with hardened token authentication and rate limiting.
- The official Web UI renders LaTeX display math (`$$...$$`).
- `/reload` refreshes the Assistant's plugin Skill view in the current session.
- The official Web UI now shows line-by-line diffs while the Agent edits or writes files.
- Web sessions are loaded by workspace pages, and the session sidebar avoids re-rendering on every streaming token.
- Official Server sessions now synchronize title changes across connected clients.

## Kimix Impact

- The vendored SDK has been regenerated from the 0.20.0 source checkout. Kimix's SDK fallback MCP startup timeout patch remains applied.
- Markdown display math is a direct user-facing chat rendering improvement and is implemented in Kimix's `MarkdownRenderer`.
- Explicit SDK `/reload` now requests the plugin Skill start reminder refresh. Server `/reload` remains a clear unsupported boundary because no public Server REST route was found.
- Shell mode and `kimi web --host` are official CLI/Web entry-point features. Kimix should not expose them until the product surface and security model are intentionally designed.
- Official plugin page redesign and web diff rendering are product/UI follow-ups, not protocol blockers for the main chat route.

## Verification Plan

- Regenerated `vendor/kimi-code-sdk/index.mjs` from the 0.20.0 upstream checkout.
- `node scripts/probe-kimi-code-0.20.mjs` checks SDK session creation, explicit reload with `forcePluginSessionStartReminder`, and plugin-list availability without sending a model prompt.
- Run `node scripts/probe-kimi-code-host.mjs`, targeted tests, `pnpm test:run`, `pnpm knowledge:validate`, `pnpm build`, and `git diff --check` before committing.
