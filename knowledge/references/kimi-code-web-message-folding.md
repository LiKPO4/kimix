---
type: Standard
title: Kimi Code Web Message Folding
description: Pinned facts about the official web UI's message-folding settings (turnFolding / activityRunFolding), the fold-split algorithm, and Kimix's counterpart setting through web bundle 0.39.1.
tags: [kimi-code, web-ui, message-folding, upstream]
timestamp: "2026-08-28T20:00:00+08:00"
---

# Kimi Code Web Message Folding

Facts pinned from the official web bundle 0.39.1 cached at `%LOCALAPPDATA%/kimi-code/web/<version>/.../dist-web` (minified; verify against a newer bundle before relying on them again).

## Settings (Settings → 高级 → 消息折叠)

- `消息自动折叠` (turnFolding): localStorage `kimi-web.turn-folding`, default **off** (`getItem === "1"`).
- `工具调用汇总` (activityRunFolding): localStorage `kimi-web.activity-run-folding`, default **on** (`getItem !== "0"`). Consecutive tool calls collapse into one `activity-run` summary line.
- Both are pure client-side UI preferences; the server/SDK is not involved.

## Fold-Split Algorithm

For each assistant turn's render items, a memoized splitter produces `{folded, visible}`:

- Find the **last** item with `kind === "text"` and non-empty trimmed text; everything before it is folded, it and everything after stays visible.
- If no text exists, the first non-hidden tool or first notification becomes the boundary; if none, everything folds.
- Notifications inside the folded range are pulled out and stay visible.
- When turnFolding is off (or inspector mode), folded and visible are merged back sorted by `sourceIndex` (`activity-run` groups sort by their first item).

The fold group renders as a `turn-fold` bar labeled `已工作 {duration}` / `工作过程`, expanded while streaming, collapsed once settled, user-toggleable per turn.

## Kimix Counterpart

- Kimix v2.21.137 adds `autoCollapseTurnProcess` (localStorage `kimix_auto_collapse_turn_process`, default **on** — deliberate deviation from the official default, per user requirement) under 设置 → 对话与权限 → 过程展示方式.
- Kimix does not re-split items like the official `MG`; it gates the existing process-summary behavior via `resolveProcessDefaultExpanded` (`src/utils/liveThinkingViewport.ts`) plus the final-content collapse transition. When off, the process stays expanded (including historical turns); `collapseProcessWhileRunning` still wins while a turn is active.
- Kimix already aggregates consecutive tool calls (`groupTurnBlocks`), so the official `activityRunFolding` toggle has no separate Kimix counterpart yet.

# Sources

- Official web bundle 0.39.1: `%LOCALAPPDATA%/kimi-code/web/0.39.1/win32-x64/.../dist-web/assets/index-*.js` (local cache, minified)
