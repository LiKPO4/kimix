# Session archive state snapshot

Captured on 2026-07-17 while diagnosing false archive blockers and a reappearing Skill conversation.

## Room archive blocker

- The reported toast was emitted by `roomHasActiveAgentWork`, so the selected conversation was a collaboration room rather than a standalone empty session.
- The post-reconciliation local snapshot had no in-memory room activities, no open timeline events, and only `completed` deliveries.
- The runtime reconciliation path could discover a persisted active delivery, read a terminal official status, and then return early because the in-memory activity and `runningSessionId` had already cleared. It also settled Agent events without settling the persisted delivery status.
- Persisted `queued`, `sending`, and `indeterminate` deliveries were not included in the reconciliation targets at all.

## Skill conversation resurrection

- Local session: `skill-80ab4f33-810b-4496-827f-5f68b022a5f9`.
- Transparent parent: `session_fb0b3ac1-29f9-4053-bcbc-514c87be0c1f`.
- The local Skill mirror was archived and had no open events; the official archived catalog also contained the Skill session.
- During the archive propagation window, an older Server active-catalog row could still be returned. Catalog reconciliation treated every active Server row as an explicit restore even when its `updatedAt` preceded the local `archivedAt`, temporarily clearing the local archive state.

## Required invariants

1. Runtime reconciliation must include every persisted lifecycle-active delivery and settle the delivery when the official runtime is terminal.
2. A Server active-catalog row can restore an archived local mirror only when that row was updated after the local archive timestamp.
