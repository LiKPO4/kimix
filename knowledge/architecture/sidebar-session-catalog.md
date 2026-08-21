---
type: Architecture
title: Sidebar Session Catalog Refresh
description: Expanding a project shows its store sessions immediately while the official catalog refresh runs in the background; archives from other clients settle with a bounded one-frame update.
tags: [architecture, sidebar, session-catalog, archive, reconcile]
timestamp: "2026-08-22T01:20:00+08:00"
---

# Sidebar Session Catalog Refresh

Kimix renders each expanded project's session list from the `sessionStore` mirror, whose archive state lags the official (Web) catalog: archiving happens server-side, and Kimix only learns about it when a triggered or periodic `listKimiCodeSessions` refresh (active directory merged with the archived directory, `electron/kimiCodeHost.ts`) returns and `reconcileOfficialSessionCatalog` stamps the matching local mirrors with `archivedAt` (`src/utils/sessionCatalog.ts`).

v2.21.90 曾以确认门禁掩盖这个滞后：展开即占位、刷新完成才渲染，代价是展开必须强制等待 3-4 秒。后续（1d5328ac，v2.21.92 一带）改为「即时显示 + 有界收缩」：展开立即渲染 store 已有会话，catalog 刷新在后台进行并增量更新，因此折叠期间 Web 端归档的会话在展开后仍可能被一次有界更新隐藏——这是有意的产品取舍，不是未被修复的回归。

## Invariants

- A user-initiated expand renders existing store sessions immediately and never waits for the catalog refresh. The loading placeholder renders only when the project has no local sessions (cold expand after startup restore). The catalog refresh effect confirms the project in `finally`, so a failed refresh degrades to the current store list instead of leaving a permanent placeholder. See `expandProjectPath` and `confirmedProjectPaths` in `src/components/layout/Sidebar.tsx`.
- Re-expanding a confirmed project does not force re-confirmation; once confirmed, the project renders its list until `removeProject` unconditionally clears the project's confirmation key.
- `reconcileOfficialSessionCatalog` only archives on explicit evidence — an `archived: true` catalog row, a visible duplicate mirror, a transparent-fork supersession, or an abandoned empty mirror. Directory absence alone never archives a content-bearing session.

## Known boundaries

- While a project stays expanded, the 30-second / focus / visibility refresh may hide a newly Web-archived session during the poll window; this is a bounded one-frame update, not the expand-time flash (the expand-time flash window was traded for instant rendering).
- The refresh effect re-runs on any change to the expanded-project set or recent-project order, firing one `listKimiCodeSessions` per expanded project; reconcile is idempotent so this costs IPC and scan work, not correctness.

## Related Knowledge

- [Runtime Routing](/architecture/runtime-routing.md) — how Kimix routes sessions between the official Server and vendored SDK fallback.
- [Collaboration Room Routing](/architecture/collaboration-room-routing.md) — how multi-Agent rooms isolate official sessions.

# Sources

- `src/components/layout/Sidebar.tsx` — instant render, loading placeholder, confirmation cleanup, refresh effect.
- `src/utils/sessionCatalog.ts` — `reconcileOfficialSessionCatalog` archive evidence rules.
- `electron/kimiCodeHost.ts` — `listSessions` merges active and archived directories.
