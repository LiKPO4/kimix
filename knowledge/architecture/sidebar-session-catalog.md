---
type: Architecture
title: Sidebar Session Catalog Confirmation
description: Expanding a project confirms the official session catalog before rendering its list, so Web-archived sessions never flash in and then vanish.
tags: [architecture, sidebar, session-catalog, archive, reconcile]
timestamp: "2026-08-18T23:05:00+08:00"
---

# Sidebar Session Catalog Confirmation

Kimix renders each expanded project's session list from the `sessionStore` mirror, whose archive state lags the official (Web) catalog: archiving happens server-side, and Kimix only learns about it when a triggered or periodic `listKimiCodeSessions` refresh (active directory merged with the archived directory, `electron/kimiCodeHost.ts`) returns and `reconcileOfficialSessionCatalog` stamps the matching local mirrors with `archivedAt` (`src/utils/sessionCatalog.ts`).

Without a confirmation gate, expanding a project first rendered the stale mirrors — including sessions archived elsewhere — and then removed them once the async reconcile landed, producing a visible "many, then a few" flash.

## Invariants

- A user-initiated expand enters a confirmation state: the project's list renders a loading placeholder until the catalog refresh finishes (success or failure), then the final list appears in one frame. See `expandProjectPath` and `confirmedProjectPaths` in `src/components/layout/Sidebar.tsx`.
- The catalog refresh effect confirms the project in `finally`, so a failed refresh degrades to the current store list instead of leaving a permanent placeholder.
- `reconcileOfficialSessionCatalog` only archives on explicit evidence — an `archived: true` catalog row, a visible duplicate mirror, a transparent-fork supersession, or an abandoned empty mirror. Directory absence alone never archives a content-bearing session.

## Known boundaries

- Re-expanding a confirmed project forces re-confirmation, closing the flash window even for archives made on the Web within the last 30-second polling interval.
- While a project stays expanded, the 30-second / focus / visibility refresh may still hide a newly Web-archived session during the poll window; this is a bounded one-frame update, not the expand-time flash.

## Related Knowledge

- [Runtime Routing](/architecture/runtime-routing.md) — how Kimix routes sessions between the official Server and vendored SDK fallback.
- [Collaboration Room Routing](/architecture/collaboration-room-routing.md) — how multi-Agent rooms isolate official sessions.

# Sources

- `src/components/layout/Sidebar.tsx` — confirmation gate, loading placeholder, refresh effect.
- `src/utils/sessionCatalog.ts` — `reconcileOfficialSessionCatalog` archive evidence rules.
- `electron/kimiCodeHost.ts` — `listSessions` merges active and archived directories.
