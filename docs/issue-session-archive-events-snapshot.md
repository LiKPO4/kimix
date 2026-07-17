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

## Follow-up snapshot after v2.16.39

- The still-visible room `session_200eea74-3dfb-461a-99b4-73580a295190` had 284 events, no open timeline events, and only `completed` or `cancelled` deliveries.
- Its footer reported connected and the global `runningSessionId` was already clear, so persisted conversation data was no longer the archive blocker.
- `creating` was still a lifecycle-active archive blocker, but it was absent from both the runtime reconciliation target set and the activity signature that schedules reconciliation.
- A stale `creating` activity for an Agent whose official runtime was already bound could therefore survive indefinitely in memory and block archive until the app restarted.

3. `creating` activities with a bound official runtime must enter terminal runtime reconciliation just like queued or running work.
