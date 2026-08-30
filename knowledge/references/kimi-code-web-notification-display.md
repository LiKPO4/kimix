---
type: Standard
title: Kimi Code Web Notification Display
description: Pinned facts about the official web UI's agent-initiated notification cards — which origin kinds qualify, the source-attributed headline format, status suffix mapping, and the output-file/raw-payload card body — through web bundle 0.39.1.
tags: [kimi-code, web-ui, notification, background-task, subagent, upstream]
timestamp: "2026-08-30T09:50:58+08:00"
---

# Kimi Code Web Notification Display

Facts pinned from the official web bundle 0.39.1 cached at `%LOCALAPPDATA%/kimi-code/web/<version>/.../dist-web` (minified; string literals survive minification — verify against a newer bundle before relying on them again).

## Which Messages Become Notification Cards

- Only `role: "user"` messages whose `metadata.origin.kind` is `task`, `background_task`, or `task_notification` enter the notification path, and only when they carry a `<notification>` XML envelope or a pre-parsed `metadata["kimiWeb.taskNotification"]` object (validated: id/category/type/sourceKind/sourceId/title/severity/body/raw all strings).
- A live background-task frame (`taskId` + state) is also converted into the same notification object; task states are `running/completed/failed/timed_out/killed/lost`.
- Other agent-initiated messages deliberately do **not** use this path: `<cron-fire>` is unwrapped and rendered as a standalone `role:"cron"` message; `system_trigger` + `goal_continuation` becomes a small turn-anchor row; `injection` and non-user-slash `skill_activation` are dropped from rendering.

## Envelope Parsing

- Regex-level parsing of `<notification ...>...</notification>`: attributes `id`, `category`, `type`, `source_kind`, `sourceId` (`source_id`), `agentId` (`agent_id`); body lines `Title:` and `Severity:` are lifted out; the remaining body is truncated at the first line starting with `<tag`.
- `<output-file path bytes>` yields `{ path, bytes }`; `<output-preview bytes total_bytes truncated>` yields a text preview (content after the first newline).

## Official Rendering

- Source-attributed headline, always: `{kind}{status} · {id}` where kind is `子代理` when `sourceKind === "subagent"` else `后台任务`, and the id is `agentId` for subagents, otherwise `sourceId` (e.g. `子代理完成 · agent-4`, `后台任务完成 · bash-bv5pc30f`).
- Status comes from the `type` suffix — `completed/failed/timed_out/killed/lost`, anything else falls back to `info` — and drives the title template (`{kind}完成/失败/超时/被终止/丢失/通知`), the status word (`完成/失败/超时/已终止/丢失/信息`), and the icon (check / alert-triangle / clock / stop / info, robot for subagent info).
- Card body: bold `Title`, body text, an output-file row (path + formatted bytes + 复制路径 button with 已复制 feedback), optional output preview, a collapsed 原始 payload section (类型/来源/严重度 fields plus the raw XML), and a timestamp. Consecutive notification blocks are grouped, and grouping/folding never hides them.

## Kimix Counterpart

- `src/utils/eventHelpers.ts` `parseKimiAgentEnvelope` parses the same envelope (added `<output-file>` extraction and `endsWith`-based status suffixes in v2.21.148); `src/components/chat/NotificationCard.tsx` renders the same source-attributed headline and output-file row.
- Deliberate differences: Kimix keeps the card collapsed by default (consistent with its process-chain cards) instead of showing the body inline; cron-fire stays a `定时任务触发` card instead of becoming a `role:"cron"` message; `output-preview` is parsed by upstream but not rendered by Kimix.

# Sources

- Official web bundle 0.39.1 (`index-ClWTW3HX.js`): envelope parsing near offset 1471247–1473242, turn-branch entry near 1487729, `NotificationCard` at 2468878, zh-CN i18n `notification` table at 221797.
