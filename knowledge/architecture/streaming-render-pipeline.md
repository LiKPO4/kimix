---
type: Architecture
title: Streaming Render Pipeline
description: How streaming output stays cheap through identity-preserving projection, active-turn draft writes, plain streaming markdown, and scroll-yield viewport gates.
resource: https://github.com/LiKPO4/kimix/tree/master/src/components/chat
tags: [architecture, chat, streaming, performance, projection, scroll-yield]
timestamp: "2026-07-22T12:00:00+08:00"
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

The draft identity may legitimately strengthen during one dispatch: the first
token can be scoped by a renderer-created turn id and a later frame by the
official turn id. `roomMessageId` remains the immutable dispatch owner. When the
session, room Agent, and `roomMessageId` match, the store must migrate the
existing draft to the new key and continue appending; two buffers for the same
message are forbidden. A batch commit collects drafts in insertion order and
prepends them once. Repeated `unshift` reverses two identity-era fragments (for
example `你好` and `霖江路。我会`) and produces a temporarily scrambled body that
the terminal authoritative frame merely hides later.

Subagent-scoped stream events (`agentId` present and not `main`) never enter the
draft store at all: `resolveActiveTurnDraftKey` returns `null` for them and they
flow through the formal batch path into their own subagent card. Because the
draft key has no subagent dimension, admitting them would splice a subagent's
delta into the main turn's buffer in arrival order (interleaved, duplicated
body), and their boundary frames would clear or commit the main draft early.

## Thinking merges are idempotent; canonical replay replaces, never appends

Live `thinking.delta` fragments and snapshot-replayed full `think` parts both
converge on the same assistant event, so every merge point must be idempotent.
`mergeAssistantThinkingText` compares whitespace-normalized containment before
concatenating, and `mergeAssistantThinkingParts` lets a superset part supersede
*all* fragments it covers while dropping fragments already covered elsewhere;
the draft fast path and `mergeAssistantProcessEvents` reuse these functions
instead of blind concatenation. When a canonical snapshot row maps onto an
already-mounted live row, `kimiCodeSnapshotReplay` replaces the row's
content/thinking/thinkingParts with the snapshot's clean think/text split
(keeping live-only fields and never closing a turn early) rather than merging
on top — the "local text already includes replay text" skip heuristic must not
fire first, because a fat, duplicated row needs repair, not a skip. History
reconciliation compares the canonical timeline against a deduplicated local
timeline so a locally duplicated (and therefore longer) thinking history cannot
win the regression guard and fossilize duplicates into the persisted state.

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

Layout and text shaping are the dominant streaming cost once JS is cheap. Measured on a production reproduction: 395 flushes/10s at 14ms each (streaming tool-call arguments were misclassified as immediate boundaries — `tool_call` with `status === "running"` must batch like other informational events), and the remaining main-thread saturation was browser text layout, not JS (Profiler callbacks are no-ops in production React, so commit time must be inferred, not measured that way). Two invariants follow: live thinking renders only the tail (`capLiveThinkingRenderText`, 2000 chars — the viewport is 144px), and draft notifications cap at 10 fps (`STREAMING_NOTIFY_MS = 100`, 250 ms while scrolling) because every notification re-shapes the growing text.

## Streaming markdown is plain until settled

While an assistant turn is active, the body renders through a fence-aware plain
path (no remark-math / katex / highlight, no full-document `Lexer.lex`), then
upgrades to the full ReactMarkdown stack once complete and not scrolling.
Feature flags (localStorage, default on): `kimix_streaming_plain_markdown`,
`kimix_scroll_yield`, `kimix_active_turn_draft`; diagnostics behind
`kimix_perf_diag` (`getPerfDiagSnapshot()`). "运行中折叠过程详情"
(`kimix_collapse_process_while_running`) is a user setting, default on, and only
affects the default-expanded state while a turn is active.
