---
type: Standard
title: Kimi Code Web File Changes Card
description: Pinned facts about the official web UI's per-turn file-changes card (TurnFilesSummary/TurnDiffPanel), its client-side derivation from tool calls, and Kimix's counterpart pipeline through web bundle 0.39.1.
tags: [kimi-code, web-ui, file-changes, diff, upstream]
timestamp: "2026-08-28T21:35:00+08:00"
---

# Kimi Code Web File Changes Card

Facts pinned from the official web bundle 0.39.1 cached at `%LOCALAPPDATA%/kimi-code/web/0.39.1/win32-x64/.../dist-web/assets/index-ClWTW3HX.js` (minified) and the upstream protocol snapshot `.kimix-upstream-kimi-code-0.18.0/packages/protocol/src`. Verify against a newer bundle before relying on them again.

## No Wire-Level File-Change Event Exists

The upstream `AgentEvent` union (`packages/protocol/src/events.ts`) contains no `file_change` / `files_changed` / `diff` event; `toolResultEventSchema` carries only `turnId`, `toolCallId`, `output`, `isError`, `synthetic`. A "connect to the official file-changes API" option does not exist — every client derives file changes in the presentation layer.

The most structured official carrier is the tool result `display` block `{ kind: "diff", path, before, after, hunks? }` (`vendor/kimi-code-sdk/index.mjs` ToolInput/OutputDisplaySchema, ~line 176633/176718), alongside `kind: "file_io"` (`operation: read|write|edit|glob|grep`).

## Official Web Derivation (0.39.1)

- `TurnFilesSummary` ("N 个文件已修改") is computed client-side: `ChatPane` maps each settled assistant turn through a cached aggregator (`EG` with LRU key = tool id/status/arg-length) that walks tool blocks, accepts only `edit` / `multi_edit` / `write`, parses paths from tool args and diffs from `old_string`/`new_string` or `edits[]`, and merges by normalized path (multi-edit diffs join with a `···` hunk separator; missing diff → `statsIncomplete`, path only).
- The currently streaming assistant turn is excluded; the card appears only after the turn settles. History replay uses the same cached path.
- Display: header count + total `+N/−N` with a ratio bar, per-file dir/base path + per-file stats, default 3 files then "还有 N 个文件". Click: `write` files open directly; `edit`/`multi_edit` open `TurnDiffPanel` (diff view, fallback "无法按 diff 展示" + open file).
- No revert/undo/discard anywhere in the card or panel.

## Kimix Counterpart

- Kimix derives `change_summary`/`diff` from the same wire stream but prefers the structured `display.diff` block when present (`src/utils/eventMapper.ts:2632`), falling back to tool-call argument derivation (same idea as the official `Xrt`), plus Kimix-only sources: git numstat endpoint-diff fallback for non-Write/Edit mutations (`src/App.tsx:3415`, `src/utils/gitFallbackChanges.ts`), delete-tool summaries, commitSha attachment, and a `TurnChanges` compatibility mapping (not emitted by current vendor/server code).
- Kimix rendering is a superset: multi-file merged card, diff preview (including recovery from historical commits via `project:getChangePreview`), and revert with snapshot-hash conflict checks (`src/components/chat/ChangeCard.tsx`, `electron/projectService.ts`).
- Kimix shows the card during streaming; the official card waits for turn settlement.

# Sources

- Official web bundle 0.39.1: `%LOCALAPPDATA%/kimi-code/web/0.39.1/win32-x64/.../dist-web/assets/index-ClWTW3HX.js` (`TurnFilesSummary` ~offset 2475145, `TurnDiffPanel` ~2608260, `EG/nlt/Xrt` ~2679318-2679531)
- Upstream protocol: `.kimix-upstream-kimi-code-0.18.0/packages/protocol/src/events.ts` (AgentEvent union), `message.ts` (toolResultContentSchema)
- Vendored SDK display schema: `vendor/kimi-code-sdk/index.mjs` (~line 176609-176730)
