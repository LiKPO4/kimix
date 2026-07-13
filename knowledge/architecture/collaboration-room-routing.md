---
type: Architecture
title: Collaboration Room Routing
description: Defines identity, event ownership, history authority, lifecycle, and compatibility invariants for user-controlled multi-Agent rooms.
tags: [architecture, collaboration, multi-agent, events, persistence]
timestamp: "2026-07-13T14:43:16+08:00"
---

# Collaboration Room Routing

Kimix collaboration rooms project multiple independent Kimi Code sessions into one visible conversation. The room is the local navigation and presentation boundary; each room Agent remains the authority for its own official context, runtime identity, event stream, history, approval requests, and model alias.

# Identity Model

* `roomId` is the existing Kimix Session ID and remains the sidebar identity.
* `roomAgentId` is a Kimix-stable participant ID and is never reused as a Kimi internal Subagent ID.
* `runtimeSessionId` and `officialSessionId` belong to a room Agent, not directly to the room.
* `roomMessageId` identifies a user-visible room message shared by one or more deliveries.
* `agentTurnId` identifies one Agent's stable response block for a room message.
* The technical primary Agent mirrors legacy top-level Session fields during migration but has no product role.

# Event and History Authority

1. Every runtime event resolves to `{ roomId, roomAgentId }` before it enters renderer state.
2. Streaming merge, tool/request matching, terminal settlement, usage, approval, question, and Subagent aggregation operate only within the resolved Agent partition.
3. Official snapshots reconcile only the matching Agent partition. Startup, running-sample, repair, and undo reasons may use different replacement policies, but none may replace another Agent's events.
4. A room user message is displayed once. Each recipient delivery records its own official user-event identity and response `agentTurnId`.
5. Deterministic source identities keep `agentTurnId`, React keys, search anchors, expansion state, and scroll anchors stable across snapshot replay and restart.
6. Agent output is visible in the room but does not enter another Agent's official context unless the user explicitly routes or quotes it.
7. New deliveries bind through persisted official prompt or message identities. Text-and-time matching is only a legacy recovery hint; ambiguous history stays in the owning Agent partition without being attached to an arbitrary turn.
8. Usage and terminal presentation settle by `roomAgentId + agentTurnId`; another Agent's running state cannot keep a completed response open or close it early.

# Runtime and Queue Authority

* The authoritative activity registry is keyed by `roomId + roomAgentId`; the legacy scalar `runningSessionId` is only a single-Agent compatibility projection.
* Busy, queued, sending, running, waiting-for-approval, waiting-for-answer, failed, and completed states are Agent-scoped.
* A busy Agent queues only its own delivery. Other idle recipients dispatch immediately.
* Room messages and stable delivery attempts are persisted before network dispatch. An attempt whose official acceptance is unknown becomes indeterminate and is never automatically resent.
* Cancel, steer, approval, question response, permission mutation, model mutation, Plan, Goal, Swarm, and slash session mutation require an explicit Agent/runtime owner.
* A terminal event or Server-to-SDK migration for one Agent cannot clear or replace another Agent's activity or runtime binding.

# Persistence and Catalog Authority

* Old Sessions are normalized as one synthetic primary Agent in memory and are not persistently upgraded until a second Agent is added.
* Legacy top-level runtime, official ID, model, and event fields continue to mirror the primary Agent during the compatibility period.
* Secondary official sessions carry Kimix room metadata so catalog reconciliation groups them under the room.
* Room metadata is a controlled main-process contract and must survive Server creation, SDK creation, and Server-to-SDK fallback. Renderer callers cannot inject arbitrary session metadata.
* Agent provisioning persists the local participant before official creation. Fixed room and Agent metadata allows an official session created immediately before a crash to be rebound idempotently instead of duplicated or hidden.
* A bound secondary session is hidden as a duplicate sidebar row only after an exact supported metadata, project, room, and Agent match. Missing or ambiguous bindings keep the official session discoverable as an independent conversation rather than making it invisible.
* Persistence records when a collaboration-aware writer last synchronized the legacy primary mirror. If a legacy version later changes the top-level Session, the next compatible version merges those changes into the primary Agent only and preserves every secondary partition.
* Unknown future collaboration schemas are read-only and retained verbatim; current code must not downgrade or overwrite them.
* Removing an Agent preserves its history. Room archive and restore operate per Agent and expose partial failure because official sessions have no cross-session transaction.
* Backup schema migration must remap room Agent IDs, recipients, deliveries, events, queues, and official bindings together.

# UI Stability

* Single-Agent conversations do not show room controls.
* Multi-recipient response blocks are created in user-selected order and never reordered by later timestamps.
* `agentTurnId` is the permanent render identity. New stream events, snapshots, and runtime migration may update content but may not remount an existing block.
* Manual history browsing and expansion state remain owned by the user while any Agent continues streaming.
* Existing Provider/model configuration remains the only source for add-Agent model selection.

# Related Knowledge

* [User-Controlled Multi-Agent Rooms](/decisions/user-controlled-multi-agent-rooms.md)
* [Runtime Routing](/architecture/runtime-routing.md)
