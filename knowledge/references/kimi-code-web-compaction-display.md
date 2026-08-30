---
type: Standard
title: Kimi Code Web Compaction Display
description: Pinned facts about the official web UI's compaction rendering — the summary message is identified by metadata.origin.kind=compaction_summary and rendered as a divider row, never as a user bubble — through web bundle 0.39.1.
tags: [kimi-code, web-ui, compaction, upstream]
timestamp: "2026-08-30T09:15:00+08:00"
---

# Kimi Code Web Compaction Display

Facts pinned from the official web bundle 0.39.1 cached at `%LOCALAPPDATA%/kimi-code/web/<version>/.../dist-web` (minified; verify against a newer bundle before relying on them again) and the vendored SDK (`vendor/kimi-code-sdk/index.mjs`).

## Data Layer

- The SDK persists compaction as a `context.apply_compaction` wire record carrying `summary`; when rebuilding the transcript it materializes the summary as a synthetic message: `role: "user"`, `content: [{type:"text", text: summary}]`, `origin: { kind: "compaction_summary" }` (vendor `context.apply_compaction` case).
- Server/snapshot history therefore contains that summary as a user-role message whose identity marker is **`metadata.origin.kind === "compaction_summary"`** (not a text prefix).
- The web bundle also converts live stream markers (`kind:"marker", marker:"compaction", phase:"completed"`, with `result.summary/tokensBefore/tokensAfter`) into a message carrying `metadata.origin.kind:"compaction_summary"` plus `metadata["kimiWeb.compaction"]:{trigger,tokensBefore,tokensAfter}`.

## Official Rendering

- The history mapper tests `metadata.origin.kind === "compaction_summary"` first; a match becomes a virtual turn with `role:"compaction"` and **never enters the user-bubble branch**.
- The timeline shows a `compact-divider` separator row: `上下文已压缩` / `已自动压缩上下文` (`conversation.compactedPlain` / `compactedAuto`), optionally with `（{before} → {after} tokens）`.
- With a summary present, the divider gets a `查看摘要` button that opens a side panel (`ThinkingPanel` reused, subtitle `压缩摘要`) showing the full summary in a `<pre>` — no inline expansion, no truncation.
- The divider has no collapsed/expanded state; it is always visible.

## Kimix Counterpart

- Kimix keeps its own `CompactionNotice` card (inline expandable summary) instead of the divider + side panel — a deliberate superset.
- Since v2.21.147, both TurnBegin mappers (`src/utils/eventMapper.ts`, `src/utils/kimiCodeEventMapper.ts`) map an `origin.kind === "compaction_summary"` message to a `compaction` end event carrying the summary, so the summary lands on the card and no duplicate user bubble is produced. Adjacent duplicate cards are normalized by `normalizeCompactionDisplay` (`src/utils/eventHelpers.ts`), which prefers the summary-carrying end event.

# Sources

- Official web bundle 0.39.1: `%LOCALAPPDATA%/kimi-code/web/0.39.1/win32-x64/.../dist-web/assets/index-*.js` (local cache, minified)
- Vendored SDK: `vendor/kimi-code-sdk/index.mjs` (`context.apply_compaction` transcript materialization, `compactionSummaryOriginSchema`)
