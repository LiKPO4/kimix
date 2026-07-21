---
type: Architecture
title: Streaming Render Pipeline
description: How streaming output stays cheap through identity-preserving projection, active-turn draft writes, plain streaming markdown, and scroll-yield viewport gates.
resource: https://github.com/LiKPO4/kimix/tree/master/src/components/chat
tags: [architecture, chat, streaming, performance, projection, scroll-yield]
timestamp: "2026-07-20T23:53:00+08:00"
---

# Streaming Render Pipeline

Streaming scroll performance is governed as three isolated layers: sparse/local
writes, cheap active-block rendering, and viewport work that yields to user
scrolling. The full plan and acceptance criteria live in
`docs/plan-streaming-scroll-performance.md`; this entry records the durable
invariants the code now depends on.

## Storage event identity is stable; projection must preserve it

`getRoomAgentEvents` returns the stored per-agent array by reference, and
`mergeEvents` only replaces the events it merges, so untouched history keeps
stable object identity across flushes. The completed-turn render cache in
`buildRenderItems` hits on reference equality. Therefore
`projectCollaborationTimeline` is **identity-preserving**: every projected event
(delivery events, unclaimed segments, synthesized room user messages, and
delivery fallback frames) is cached in a module-level `WeakMap` keyed by the
source object reference plus a signature of every projection input
(`roomAgentId`, `roomMessageId`, `agentTurnId`, `recipientAgentIds`,
delivery status/error). Any new object-construction site in the projection must
go through the same cache, or history turns silently re-render on every 80 ms
flush. Correctness relies on immutable updates: a changed source event is a new
object, which is a new WeakMap key, so no manual invalidation exists or is
allowed.

`useProjectedTimeline` short-circuits the whole projection when the actual
inputs (`collaboration.agentEvents`, `collaboration.messages`, `session.events`)
are unchanged by reference, so metadata-only session updates (title, updatedAt)
never reproject.

## Active-turn draft is a second write source with one commit point

Pure text/thinking deltas (assistant events without `snapshotMessageId` /
`snapshotMessageIdStable`) are written to `activeTurnDraftStore` keyed by
`sessionId + roomAgentId + agentTurnId` instead of the session store, so
historical subscribers are not woken per token. Only the active bubble
subscribes (`useActiveTurnDraft` + `pickDraftText` merge-over-event). The single
commit point is `commitActiveTurnDraftsToBatch`, invoked before every formal
flush and before any boundary event merges; snapshot/barrier frames stay on the
formal path because they may replace body text while the draft only appends.
When reading assistant content, always treat formal events as authority once
committed.

## Memo keys never change semantics for performance

`timelineEventMemoKey` keeps its full-content semantics. Memo cost is reduced by
an `===` fast path plus a `WeakMap` key cache (valid because identity is stable),
never by weakening the key. A lighter key used for cache-hit equality would
misfire on same-length rewritten content (retry after recall, history reload).

## Scroll yield is a shared active signal, not scattered timestamps

`userScrollActivity` is a module-level signal (350 ms window) fed by wheel,
touch, navigation keys, and native scrolls in manual mode (scrollbar drags);
programmatic writes must never mark activity, which is why `handleScroll` only
notes while `userScrollRef` is set. Readers: anchor restore, resize restore, the
bottom-distance-preservation effect, navigation-rail measurement (throttled to
≥200 ms with a guaranteed trailing measure), stream flush (80 ms → 250 ms for
deferrable deltas only), and the streaming→settled markdown upgrade. Boundary
events (tool start/end, approvals, questions, completion, failure) always flush
immediately and carry buffered deltas with them; immediacy is a correctness
requirement, not a tuning knob.

Draft notifications are coalesced, never per-token. SSE deltas arrive at token frequency; waking React per delta saturates the main thread (whole-bubble re-render plus full-content markdown work per event), starving unrelated UI like menus. `scheduleNotify` batches draft updates to at most one per animation frame — and to a 250 ms timer while the user is actively scrolling — while commit paths (`take`/`clear`) flush pending notifications synchronously so no update is lost. Draft accumulation itself is append-only by construction (snapshot/barrier frames stay formal), so per-delta work must stay O(fragment); the plain streaming path also skips the full markdown-repair stack and renders raw content until the settled rich pass.

Session persistence is a main-thread budget item, not background work. Each debounced persist walks and serializes the whole sessions value (tens of MB for long sessions: stringify plus IndexedDB structured clone), so it freezes every interaction when it runs on a hot interval. While any session is actively streaming, the debounced cadence stretches to at most one persist per minute (`resolvePersistDelayMs`), with explicit flushes on streaming end, archive/delete, visibility loss, and unload; server-backed sessions re-import from canonical history after a crash, so the wider window is safe. The event flush classifier must likewise keep informational high-frequency events (status updates, running-subagent progress) inside the 80 ms batch; only true boundaries (tool lifecycle, approvals, questions, errors, completion, subagent status transitions) flush immediately.

## Streaming markdown is plain until settled

While an assistant turn is active, the body renders through a fence-aware plain
path (no remark-math / katex / highlight, no full-document `Lexer.lex`), then
upgrades to the full ReactMarkdown stack once complete and not scrolling.
Feature flags (localStorage, default on): `kimix_streaming_plain_markdown`,
`kimix_scroll_yield`, `kimix_active_turn_draft`; diagnostics behind
`kimix_perf_diag` (`getPerfDiagSnapshot()`). "运行中折叠过程详情"
(`kimix_collapse_process_while_running`) is a user setting, default on, and only
affects the default-expanded state while a turn is active.
