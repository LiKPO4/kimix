---
type: Architecture
title: Streaming Render Pipeline
description: How streaming output stays cheap through identity-preserving projection, active-turn draft writes, plain streaming markdown, and scroll-yield viewport gates.
resource: https://github.com/LiKPO4/kimix/tree/master/src/components/chat
tags: [architecture, chat, streaming, performance, projection, scroll-yield]
timestamp: "2026-07-25T01:40:00+08:00"
---

# Streaming Render Pipeline

Streaming scroll performance is governed as three isolated layers: sparse/local
writes, cheap active-block rendering, and viewport work that yields to user
scrolling. The full plan and acceptance criteria live in
`docs/plan-streaming-scroll-performance.md`; this entry records the durable
invariants the code now depends on.

## Turn blocks preserve official step order

A kimi-code turn is rendered from an ordered `TurnBlock[]` built by walking the
turn's event array once (`src/utils/turnBlocks.ts`). Each block is one of
thinking / text / tool / subagent / approval, and adjacent same-kind blocks may
merge, but **timestamp sorting is forbidden**: official wire data stamps a
think part and its following tool call with the same millisecond, so any
timestamp-based reordering (or tool-timestamp cutting of thinking phases)
scrambles the sequence into multiple split tool groups and mis-ordered Swarm
cards. Continuous tool blocks still aggregate into one "N 个工具调用" card;
a thinking/text/subagent boundary starts a new run — the same rule as official
kimi-web `assistantRenderBlocks`.

Agent/Task/AgentSwarm tool calls are absorbed into the matching subagent card
via `parentToolCallId` at the tool-call position (official treats the Agent
tool itself as the task card). Unmatched Agent calls fall back to plain tool
blocks. Subagent-internal assistant content is **never** promoted into the
main timeline body: `createSubagentOnlyAssistantEvent` is gone, and a tool- or
subagent-only turn renders an empty-content process container with the ordered
blocks. History cache mapping version 17 forces re-hydration of sessions that
previously fossilized that synthetic body.

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

## Offset-anchored volatile deltas take precedence over order-based merging

Kimi Code 0.29 Server tags volatile `assistant.delta` / `thinking.delta` WS
frames with a cumulative character `offset` within the in-flight turn's
accumulated stream (per-stream: text and thinking lengths are tracked
separately). The official web client assembles strictly by this anchor —
`offset === 0` restarts the stream (retry/reconnect discards the old one),
`offset === local length` appends, `offset < local length` skips a duplicated
tail, and `offset > local length` means frames were missed and triggers a
re-snapshot. Kimix's draft store implements the same model
(`streamContentAnchor` / `streamThinkAnchor` per draft key, with the offset
threaded `ServerFrame → flattenServerEvent → mapKimiCodeEvent →
AssistantMessageEvent.streamOffset`), except that a gap falls back to the
legacy fuzzy merge for that delta instead of re-snapshotting, keeping content
while dropping the anchor for the rest of the turn. Order-based concatenation
plus containment checks must never be applied to offset-bearing frames: fuzzy
containment drops genuine fragments and produces scrambled, duplicated
thinking (observed live as paragraphs repeated with words spliced across
sentences). Anchored thinking collapses to a single growing part per draft,
mirroring the official one-block-per-turn presentation. SDK-route deltas carry
no offset and keep the legacy path.

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

Session persistence is a main-thread budget item, not background work. Each debounced persist walks and serializes the whole sessions value (tens of MB for long sessions: stringify plus IndexedDB structured clone), so it freezes every interaction when it runs on a hot interval. While any session is actively streaming, the debounced cadence stretches to at most one persist per minute (`resolvePersistDelayMs`), with explicit flushes on streaming end, archive/delete, visibility loss, and unload; server-backed sessions re-import from canonical history after a crash, so the wider window is safe. The startup window gets the same treatment: for the first 30 s after renderer launch the non-streaming cadence stretches to a 10 s debounce / 30 s max wait, because the history-repair loop and catalog sync each produce real state changes that would otherwise trigger a full ~70 MB persist apiece inside the first 15 s (measured: two persists ≈ 3.3 s of long tasks). Explicit flushes never consult `resolvePersistDelayMs`, and `timeAsync` (not `timeSync`) must wrap `commitState` — the stringify hides in the Promise continuation where a synchronous timer reads 0 ms. The event flush classifier must likewise keep informational high-frequency events (status updates, running-subagent progress) inside the 80 ms batch; only true boundaries (tool lifecycle, approvals, questions, errors, completion, subagent status transitions) flush immediately.

The same persistence budget applies at startup, where the hammer was a redundant full rewrite: hydration's 0→N `setState` trips the archive/deletion branch of the persistence subscriber (length change) and flushes immediately, and the history-repair loop used to call `persistLocalConversationState()` directly per repaired session, bypassing the debounce. `persistLocalConversationState` now tracks `lastPersistedSessionsRef`/`lastPersistedPendingRef` and returns `{ success: true }` without touching disk when the store's array references match the last durable snapshot. Three rules keep the guard sound: register **old references only** (the snapshot source captured at call entry — never a post-await `getState()`, which would mark unwritten state durable); hydration must call `markConversationStatePersisted(restoredSessions, currentPending)` **before** `setState`, because the subscription fires synchronously; and skipped flushes must still report success, since room delivery and the composer treat persist as a pre-dispatch barrier and roll back on failure. Background repair loops must never bypass the debounce with direct persist calls — the subscription already coalesces their `setState` storms.

**Incremental per-session persistence (v2.20.0)** takes the next step: instead of a single `kimix_sessions` key holding the entire sessions array, each session is stored under its own key `kimix_local_session_<id>` with a lightweight index at `kimix_local_sessions_index` (version 2, entries with id/updatedAt/archivedAt/projectPath). A module-level `hydratedSessionRefs: Map<sessionId, Session>` caches the store reference as established by hydration and updated on each successful write. On each persist, `runPersist` compares every current session's store reference against the cache — unchanged sessions (the same JS object identity from the store) skip strip+stringify+write entirely. Only changed, new, or deleted sessions touch disk, and the index is rewritten only when the set of sessions or their metadata changes. Image GC collects refs from changed sessions only; unchanged sessions' image refs come from `sessionImageRefs`, which is pre-populated at load/registration and lazily backfilled from the cached store session on first need — never leave an unchanged session without a refs source (see Invariant D). Stale session keys from deleted sessions are removed. The old single-key format is automatically migrated on the first per-session write (the old key is deleted after a successful new-format write). `loadLocalSessions` reads the index first, then batches parallel session loads (20 per batch); it falls back to the old single key when no index exists.

**Reconcile circuit breaker (v2.20.0)** prevents the repair/startup/running-sample loops from repeatedly reconciling a canonical-event pair that was already rejected. The breaker persists a fingerprint (assistant body size + process event count + latest timestamp for both local and canonical events) per `sessionId:roomAgentId` into localStorage (`kimix_reconcile_circuit_v1`, LRU 500). On each rejected `shouldReplaceWithCanonicalKimiHistory`, the fingerprint is registered; an accepted branch clears it. Before calling `reconcileAgentCanonicalHistory`, the repair/startup/running-sample call sites check `isCanonicalReconciliationCircuitOpen(...)` and skip the entire reconcile+setState block when the same fingerprint was previously rejected and the canonical data hasn't changed. When canonical data grows, the fingerprint shifts and the circuit closes for one retry. This reduces the "15 rejected reconciles per second" to "one reject per fingerprint change".

**Subscription shallow guard + startup archive flush merge (v2.20.0)**: the `useStatePersistence` subscription now checks per-element reference equality when `sessions` is a new array but every element is the same reference (the `map()` false-change pattern), returning early without scheduling a persist. During the startup window (first 30s), `archiveOrDeletionChanged` routes through the debounced `scheduleLocalConversationPersist` instead of forcing an immediate flush (tombstone localStorage writes remain immediate); after the window, the old immediate behavior applies.

New invariants:
- **Invariant A (incremental persist)**: after hydration populates `hydratedSessionRefs`, the first persist skips every session (all store references match). A subsequent write only touches sessions whose store reference differs from the cache, plus pending messages and the index (when dirty). The `markConversationStatePersisted` guard (lastPersistedSessionsRef) still provides the coarser array-level skip; the cache provides the finer per-session skip beneath it.
- **Invariant B (circuit breaker)**: a rejected reconcile pair is never retried with identical canonical data; when canonical grows, the fingerprint changes and one retry fires. An accepted reconciliation clears the circuit for that target. The undo path and user-initiated manual reconcile never consult the breaker.
- **Invariant C (startup archive flush)**: inside the 30s startup window, archive/deletion state changes merge into the debounced persist cadence instead of forcing an immediate full-write flush. Outside the window the old immediate behavior applies. Tombstone writes to localStorage remain synchronous in both modes.
- **Invariant D (GC ref availability)**: every session skipped by incremental persist must still contribute its image refs to garbage collection — either from `sessionImageRefs` (pre-populated at load/registration and refreshed whenever that session is stripped) or via the lazy fallback that collects once from the cached store session. A cache that is only populated for *changed* sessions makes unchanged sessions' refs vanish from `referencedRefs`, and the GC deletes their in-use images (caught in review, v2.20.0: the first real persist after hydration would have bulk-deleted history images). Any GC test that mocks `getAllImageIds` to `[]` structurally cannot catch this — at least one test must report an in-use image id and assert it is never passed to `deleteImages`.
- **Invariant E (tool boundary breaks assistant segments)**: `mergeEvents` must never merge an incoming assistant text/thinking frame into an earlier unfinished assistant when a `tool_call`/`subagent`/`approval_request` event already sits between them (v2.20.0, `hasToolBoundary` in both the `stableAssistantIndex` and fallback merge paths). The old `sameTurnAssistantIndex` behavior absorbed a whole turn's text into one pre-tools message, which collapsed every completed turn to a single text block before its tools — and `computeFinalTextBlockContent` then misclassified that sole block as "intermediate process" (trailing tools ⇒ bottom body `""`), making all historical turn bodies vanish into the collapsed process summary. Empty identity-terminal frames (`isComplete`, no content/thinking) are exempt and still complete the latest unfinished assistant; barrier replays and stable snapshot ids keep their own paths. As a display-layer backstop for already-merged legacy histories, a complete turn with exactly one text block and trailing process blocks shows that block in full.
- **Invariant F (stream-offset-ordered body merge)**: when both assistant frames carry `streamOffset`, content must merge by offset interval order — prepend when the incoming fragment ends before the target starts, append after, and on overlap keep the earlier fragment plus the later fragment's non-overlapping suffix (`mergeAssistantContentWithOffset`, v2.20.0). Plain concatenation corrupts text whenever a provider emits out-of-order deltas (observed with grok-4.5: offset 2 arrived before offset 0, rendering "霖江路…你好" until the authoritative snapshot frame rewrote the body). When either side lacks an offset, fall back to **prefix-safe** merge (`startsWith`, never `includes`) — a fragment that merely contains the existing text mid-string must not be treated as an authoritative superset, because `includes` silently drops the prefix context while `startsWith` at worst concatenates once and self-heals on the next frame.

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
