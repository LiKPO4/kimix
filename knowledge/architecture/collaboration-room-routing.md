---
type: Architecture
title: Collaboration Room Routing
description: Defines identity, event ownership, history authority, lifecycle, and compatibility invariants for user-controlled multi-Agent rooms.
tags: [architecture, collaboration, multi-agent, events, persistence]
timestamp: "2026-07-13T17:07:00+08:00"
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
* Room messages, recipient order, and stable delivery attempts are persisted as `queued` before dispatch; each target must then persist `sending` before any network call. Failure to persist `sending` returns that target to `queued` without invoking the runtime.
* Official acceptance records prompt/message identities. A `sending` attempt whose result is unknown or whose persisted state cannot be reconciled with stable official or canonical room/turn evidence becomes `indeterminate` and is never automatically resent.
* Delivery transitions are monotonic after acceptance and terminal settlement. Only an explicit user retry may replace an indeterminate, failed, or cancelled attempt; the retry creates a new `dispatchAttemptId` and `agentTurnId` while preserving the previous attempt as durable audit history.
* Cancel, steer, approval, question response, permission mutation, model mutation, Plan, Goal, Swarm, and slash session mutation require an explicit Agent/runtime owner.
* A terminal event or Server-to-SDK migration for one Agent cannot clear or replace another Agent's activity or runtime binding.
* Startup, background repair, running snapshots, and resume all derive an ordered runtime/official candidate list per Agent. A stale runtime may fall back only to another identity owned by the same Agent; recovery never borrows another participant's session.
* Server-to-SDK migration moves the target Agent's binding, activity, turn anchor, and polling ownership to the migrated runtime while leaving every other Agent unchanged.

# Persistence and Catalog Authority

* Old Sessions are normalized as one synthetic primary Agent in memory and are not persistently upgraded until a second Agent is added.
* Legacy top-level runtime, official ID, model, and event fields continue to mirror the primary Agent during the compatibility period.
* Secondary official sessions carry Kimix room metadata so catalog reconciliation groups them under the room.
* Room metadata is a controlled main-process contract and must survive Server creation, SDK creation, and Server-to-SDK fallback. Renderer callers cannot inject arbitrary session metadata.
* Agent provisioning persists the local participant before official creation. Fixed room and Agent metadata allows an official session created immediately before a crash to be rebound idempotently instead of duplicated or hidden.
* Secondary provisioning requests the stable room Agent ID as the official session ID and also searches metadata across empty, active, and archived catalog entries before creation. One active match resumes, while duplicate or archived matches stop automatic creation instead of guessing.
* A bound secondary session is hidden as a duplicate sidebar row only after an exact supported metadata schema, project path, room ID, primary identity, and Agent ID match. The same room and Agent must have exactly one active candidate; missing, unknown, or ambiguous bindings keep every candidate discoverable as an independent conversation rather than making history invisible.
* Folding a secondary catalog row never claims the whole room from the primary catalog row. A catalog containing the primary and several uniquely bound secondary sessions still reconciles to one local room mirror, and secondary titles never replace the room title.
* A Server-authoritative catalog marks only a bound secondary Agent whose active session is absent or archived as missing; it never archives the room because one participant disappeared. SDK fallback catalogs and failed catalog requests are non-authoritative and cannot infer deletion from absence.
* Recovery failures are Agent-scoped durable issues. The failed Agent keeps its canonical history and can remain unavailable while successfully recovered participants continue to load and run.
* Model availability is checked against the existing Kimi model and Server catalogs. A missing persisted alias is marked unavailable and blocks resume/create paths from silently substituting the default model.
* Persistence records when a collaboration-aware writer last synchronized the legacy primary mirror. If a legacy version later changes the top-level Session, the next compatible version merges those changes into the primary Agent only and preserves every secondary partition.
* Unknown future collaboration schemas are read-only and retained verbatim; current code must not downgrade or overwrite them.
* Removing an Agent preserves its history. Room archive and restore operate per Agent and expose partial failure because official sessions have no cross-session transaction.
* Backup schema 2 serializes complete collaboration partitions and scoped Agent activity references, while schema 1 remains a single-Agent import format. Unknown future backup schemas and collaboration payloads with dangling or cross-Agent references are rejected instead of being normalized into partial rooms.
* A conflict fork remaps the room ID, every Agent, message, turn, dispatch attempt, delivery key, event scope, pending-queue reference, activity reference, hidden-session reference, and active context as one transaction. The copy clears top-level and per-Agent runtime, official, catalog, Skill-fork, missing, recovery, Swarm, model-switch, and Goal bindings before it becomes visible.
* Archived-room tombstones contain the room ID plus every Agent runtime and official identity so a secondary catalog row cannot resurrect an archived room. A collaboration-aware exporter refuses opaque future collaboration data rather than writing it back under schema 2.

# UI Stability

* Single-Agent conversations do not show room controls.
* Multi-recipient response blocks are created in user-selected order and never reordered by later timestamps.
* `agentTurnId` is the permanent render identity. New stream events, snapshots, and runtime migration may update content but may not remount an existing block.
* Manual history browsing and expansion state remain owned by the user while any Agent continues streaming.
* Existing Provider/model configuration remains the only source for add-Agent model selection.

# Related Knowledge

* [User-Controlled Multi-Agent Rooms](/decisions/user-controlled-multi-agent-rooms.md)
* [Runtime Routing](/architecture/runtime-routing.md)
