---
type: Architecture Decision
title: User-Controlled Multi-Agent Rooms
description: Kimix upgrades ordinary conversations into user-routed rooms of independent Kimi Code sessions without adding a new provider or runtime system.
tags: [decision, collaboration, multi-agent, session, provider]
timestamp: "2026-07-14T10:18:37+08:00"
---

# User-Controlled Multi-Agent Rooms

# Status

Accepted for staged implementation behind an internal development gate until the concurrency, history, persistence, and catalog invariants pass.

# Context

Users want one conversation surface that can contain multiple independent model contexts for implementation, review, and cross-validation. Kimix already supports multiple configured Provider/model aliases through Kimi Code, and its Electron hosts already manage multiple official sessions by session ID. Introducing external runtime adapters or a separate product mode would duplicate existing integration and configuration boundaries.

The renderer currently assumes that one visible Kimix Session owns one runtime, one global running state, one event timeline, and one pending queue. Exposing an add-Agent control before replacing those assumptions would allow events, approvals, snapshots, terminal state, and rendering identity to cross Agent boundaries.

# Decision

* Keep a visible Kimix Session as the room and represent each room participant as an independent Kimi Code session.
* Reuse the existing Kimi Code Provider and model alias catalog. Provider credentials remain global configuration and are never copied into room data.
* Add Agents directly from the existing Composer `+` menu; do not introduce a separate collaboration or Swarm mode.
* Do not assign built-in implementer, reviewer, explorer, or test-runner identities. User prompts define behavior.
* Route the current message only to Agents explicitly selected by the user or named through registered room mentions. A routed Agent may also receive a user-selected projection of visible room bodies: the previous completed turn by default, with one-shot recent-three, selected-message, all-body, or none overrides.
* Keep visible-body sharing delivery-scoped and duplicate-aware. It never merges official sessions, includes hidden reasoning/tool state, or causes an Agent to trigger another Agent.
* Keep room Agents separate from Kimi internal Subagent/Swarm identities and Long Task executor/reviewer roles.
* Permit multiple room Agents to share the same project directory, but do not add implicit worktrees, filesystem locks, automatic rollback, or Agent-to-Agent triggering in the first version.
* Complete runtime ownership, event/history partitioning, persistence/catalog grouping, and recovery gates before the add-Agent UI becomes available.
* Keep the first release bounded to four Agents and ordinary Kimi Code conversations. Multi-recipient session mutations and atomic multi-session undo remain unavailable until their semantics can be guaranteed.

# Consequences

* Different Provider/model aliases can cross-check the same user request while retaining independent official context.
* Cross-Agent review can consume visible prior results without copying whole official histories. Shared bodies still occupy the recipient model's context, so each entry is injected at most once per logical Agent context and oversized selections are rejected explicitly.
* Single-Agent conversations retain their current behavior through a compatibility view and lazy room upgrade.
* Room-level UI must project one user message over multiple Agent-scoped deliveries and stable response blocks.
* Approval, question, cancellation, model, permission, snapshot, undo, export, archive, and recovery operations must always resolve an explicit room Agent and runtime.
* Concurrent write-capable Agents can conflict in the shared project directory; the UI must disclose that risk rather than pretending to provide isolation.
* Removing an Agent must preserve discoverable history and must not silently archive or delete its official session.

# Related Knowledge

* [Collaboration Room Routing](/architecture/collaboration-room-routing.md)
* [Runtime Routing](/architecture/runtime-routing.md)

# Related Plan

* `docs/multi-agent-room-plan.md`
