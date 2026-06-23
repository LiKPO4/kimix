# Kimi Code 0.19.0 Follow-up

- Date: 2026-06-23
- Upstream package: `@moonshot-ai/kimi-code@0.19.0`
- Upstream tag: `@moonshot-ai/kimi-code@0.19.0`
- Upstream commit: `b2d3ad07282278a64c11f4e7dd192a208e5756f5`
- Official node SDK package version: `@moonshot-ai/kimi-code-sdk@0.10.0`

## Confirmed

- Local `kimi --version` returns `0.19.0`.
- npm latest for `@moonshot-ai/kimi-code` is `0.19.0`.
- The local upstream audit checkout at `%TEMP%/kimix-kimi-code-0.19-audit` is on tag `@moonshot-ai/kimi-code@0.19.0` / commit `b2d3ad07282278a64c11f4e7dd192a208e5756f5`.

## Follow-up Todolist

1. [x] Refresh Kimix's vendored SDK bundle from official node SDK `0.10.0`, keeping the Kimix MCP fallback startup timeout patch.
2. [ ] Add probes for 0.19.0 session/workspace changes:
   - [x] SDK `additionalDirs` on create/resume/session summary.
   - [x] `session.addAdditionalDir(path, { persist })`.
   - [x] Server `/sessions/{id}/snapshot` schema and timeout compatibility.
3. [x] Wire `additionalDirs` through Kimix runtime creation/resume where official APIs expose it, while keeping existing project root safety boundaries.
4. [x] Review Server snapshot usage after upstream direct disk reader changes; keep Kimix history and pending approval/question recovery compatible with the 0.19.0 schema.
5. [x] Review safety-policy block event mapping so Kimix does not display a blocked turn as a normal completed answer.
6. [x] Review local image upload/media handling against upstream real image format sniffing; prefer official Server upload behavior where possible.
7. [x] Decide whether Ctrl+B background task transfer and `/tasks` need Kimix UI follow-up; defer if the Server/SDK API is not product-ready for Kimix.

## Upstream Notes

- 0.19.0 adds multi-workspace directory support through `/add-dir <path>`, `kimi --add-dir <path>`, project-local `.kimi-code/local.toml`, and SDK `additionalDirs` APIs.
- Server snapshot loading is faster and has a timeout safeguard, with legacy fallback retained upstream.
- Provider safety-policy blocks are surfaced explicitly instead of being silently treated as completed turns.
- Image format detection now uses file contents, reducing API failures when file extensions do not match actual media type.
- Foreground commands and subagents can be moved to background tasks in the official TUI with Ctrl+B and inspected via `/tasks`.

## Kimix Impact

- Multi-directory workspaces are the highest product-impact change. Kimix must not assume one project root is the whole official workspace once a session has `additionalDirs`.
- Kimix now passes the configured extra work directories into SDK-backed create/resume/startRuntime paths. The 0.19 Server `/sessions` REST schema does not expose an explicit `additionalDirs` field, so Server sessions still rely on upstream workspace-local config support until an official REST route is available.
- Snapshot and safety-policy changes affect the main chat correctness path and should be probed before deeper UI work.
- Image MIME sniffing is relevant to Kimix because the app supports local image attachments and already uses Server `/files` when available.
- `node scripts/probe-kimi-code-0.19.mjs` now covers both SDK `additionalDirs` and Server snapshot schema. The 0.19 Server snapshot currently returns `as_of_seq`, `epoch`, `session`, `messages`, `in_flight_turn`, `pending_approvals`, and `pending_questions`, which matches Kimix's live recovery and one-shot history adapters.
- Kimix maps `turn.ended` with `reason: "filtered"` to a concise user-facing error instead of normal assistant completion.
- Kimix now sniffs PNG/JPEG/GIF/WebP magic bytes from inline data URLs before base64 fallback or official `/files` upload, so mismatched browser MIME labels do not leak into the Server prompt payload.
- Kimix already maps Server `/tasks` to the existing background-task panel for list/get/cancel. Official 0.19 SDK exposes `session.detachBackgroundTask(taskId)` for foreground-to-background handoff, so Kimix exposes that as a compatibility-chain IPC. Server 0.19 does not expose an equivalent detach REST route; Kimix therefore does not add a misleading Server UI button.

## Verification Plan

- Regenerated `vendor/kimi-code-sdk/index.mjs` from the 0.19.0 upstream checkout.
- `node scripts/probe-kimi-code-0.19.mjs` verified SDK `additionalDirs` create, `session.addAdditionalDir(..., { persist: false })`, session summary update, and resume input.
- The same probe verified Server `/sessions/{id}/snapshot` schema on the local 0.19 Server.
- Run host smoke probes and targeted 0.19.0 probes.
- Run `pnpm knowledge:validate`, relevant tests, `pnpm build`, and `git diff --check` before committing.
