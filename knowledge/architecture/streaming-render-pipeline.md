---
type: Architecture
title: Streaming Render Pipeline
description: How streaming output stays cheap and addressable through identity-preserving projection, active-turn draft writes, rich streaming markdown, and scroll-yield viewport gates.
resource: https://github.com/LiKPO4/kimix/tree/master/src/components/chat
tags: [architecture, chat, streaming, performance, projection, scroll-yield, search-navigation]
timestamp: "2026-08-09T21:04:00+08:00"
---

# Streaming Render Pipeline

## Completion replay uses an explicit authoritative body

The Server completion barrier reads the persisted `/messages` record after the volatile stream ends. That replay is semantic state, not another stream: for each stable assistant message it emits one full text body marked `kimixPromptCompletionFullBody`, while preserving thinking and tool frames. The event mapper carries the marker into the UI timeline, and the event reducer replaces the matching live body instead of applying delta/substring heuristics. Ordinary streaming and history snapshots continue to use incremental parts. This prevents a short-lived duplicate body when the persisted answer differs in paragraph or wording from the volatile draft.

The replacement invariant also applies when the volatile draft has no snapshot identity yet. The first completion replay binds its stable `snapshotMessageId` to that draft and must preserve the full-body marker through the binding branch; identity acquisition is not a content boundary and must never turn authoritative replacement into append.

When aggregating persisted text parts for that full body, concatenate parts without an inserted separator. Server parts already carry the exact whitespace and line breaks; adding `\n` between them changes short poetry/code fragments into artificial one-line paragraphs.

Streaming scroll performance is governed as three isolated layers: sparse/local
writes, cheap active-block rendering, and viewport work that yields to user
scrolling. The full plan and acceptance criteria live in
`docs/plan-streaming-scroll-performance.md`; this entry records the durable
invariants the code now depends on.

## Turn blocks preserve official step order

A kimi-code turn is rendered from an ordered `TurnBlock[]` built by walking the
turn's event array once (`src/utils/turnBlocks.ts`). Each block is one of
thinking / text / tool / subagent / approval / question, and adjacent same-kind blocks may
merge, but **timestamp sorting is forbidden**: official wire data stamps a
think part and its following tool call with the same millisecond, so any
timestamp-based reordering (or tool-timestamp cutting of thinking phases)
scrambles the sequence into multiple split tool groups and mis-ordered Swarm
cards. Continuous tool blocks still aggregate into one "N 个工具调用" card;
a thinking/text/subagent boundary starts a new run — the same rule as official
kimi-web `assistantRenderBlocks`. Non-pending approval/question_request cards
become blocks at their own wire position (folded into the assistant process
flow); pending ones stay as standalone interactive cards below the body.

Agent/Task/AgentSwarm tool calls are absorbed into the matching subagent card
via `parentToolCallId` at the tool-call position (official treats the Agent
tool itself as the task card). Unmatched RUNNING Agent calls fall back to plain tool
blocks (until the real subagent event arrives); settled unmatched calls
synthesize a display-layer subagent from the tool call itself
(synthesizeSubagentFromAgentCall), because official history and snapshot
replays carry the dispatch but never the subagent event — this keeps the
task card (with prompt) intact across restore/reload. At render time a single-dispatch subagent
group becomes an official-style 任务 card (KimiWebTaskCard: 任务 + agent type +
status header, expanded full delegation prompt, internal activity, result
summary — the card body renders only when the user expands that entry); multi-dispatch
groups keep the Swarm progress card. Expansion is strictly per level: the
parent 思考工具链 summary only reveals the entry list, and every inner
collapsible card (task card, Swarm card, tool group, approval group, question
card, subagent row, thinking teaser) starts collapsed on mount regardless of
running/active status — inner expansion is the user's own per-entry decision,
never inherited from the parent's expanded state. groupTurnBlocks
lives in src/utils/turnBlocks.ts and keeps each dispatching Agent tool call
index-aligned in subagent groups so the task card can show the full prompt. Subagent-internal assistant content is **never** promoted into the
main timeline body: `createSubagentOnlyAssistantEvent` is gone, and a tool- or
subagent-only turn renders an empty-content process container with the ordered
blocks. History cache mapping version 19 forces re-hydration of sessions whose
caches predate the offset-anchored thinking fix or were certified current while
carrying inflated thinking (see Invariant I's certification guard).

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

Search navigation uses the stored `TimelineEvent.id`, while `buildRenderItems`
may merge many Assistant/tool/status events into one turn container. Every
merged event `RenderItem` must therefore retain all represented
`sourceEventIds`, and every grouped thinking/text/tool block must expose its
source IDs as complete whitespace-delimited DOM tokens. IDs containing colons
are atomic and must never be split on punctuation. `useEventFocus` expands old
history and each collapsed process/tool layer only when needed, then prefers
the most specific mounted source block containing the query before selecting
and scrolling to the exact text. A merged turn ID alone is not a valid search
locator.

## Active-turn draft is a second write source with one commit point

Pure text/thinking deltas (assistant events without `snapshotMessageId` /
`snapshotMessageIdStable`) are written to `activeTurnDraftStore` keyed by
`sessionId + roomAgentId + agentTurnId` instead of the session store, so
historical subscribers are not woken per token. The bubble itself does not
subscribe: the active-turn draft key (a stable string across deltas) is passed
to leaf components — `LiveDraftTail` renders the streaming thinking inside the
process detail and `AssistantBodyBlock` renders the body tail from its own
`useActiveTurnDraft` + `pickDraftText` merge-over-event — so a delta re-renders
only those leaves while memoized process blocks keep reference-stable props. The
single commit point is `commitActiveTurnDraftsToBatch`, invoked before every
structural/formal boundary merges; snapshot/barrier frames stay on the formal
path because they may replace body text while the draft only appends. An
informational `status_update` timer may flush its own 80 ms event batch, but it
must never materialize the active draft. Status heartbeats can arrive between
every text fragment: clearing the accumulator while retaining its stream-offset
anchor makes every later fragment look consumed and leaves only the final tail.
The public/terminal flush path still commits drafts synchronously.
When reading assistant content, always treat formal events as authority once
committed.

The main prompt's delivered `prompt.completed` is also a formal completion
marker. It carries no duplicate body: enqueueing the marker commits every
offset-assembled draft segment ahead of it in one synchronous batch, then
`mergeEvents` closes the Assistant and records a duration from the owning user
boundary. Completion presentation requires this formal `isComplete` evidence;
`!runtimeActive + visible text` is not completion because status ownership can
briefly disappear while only a tail fragment is formal. Canonical history may
later replace the body, but reconciliation must retain a reliable local
duration when the canonical Assistant omits it.

The Server completion barrier may replay one official Assistant message as
several `content.part` frames sharing a stable message id before an empty
terminal. A part is not a whole-message snapshot. Binding it to a complete live
draft must use coverage-aware accumulation: keep the live body when it already
contains the part, upgrade to a richer cumulative replay, otherwise append the
next part. Replacing on every barrier part collapses a complete answer to the
last sentence for the interval before canonical repair. Only a content-bearing
`isComplete` whole-message frame may authoritatively replace the body; the empty
terminal only closes it.

Coverage comparison for the same stable barrier message must also collapse
whitespace before testing containment. `/messages` may normalize blank lines or
list layout relative to volatile deltas, so two equivalent near-full bodies can
fail raw `includes` and be concatenated into a double answer (273 live chars
observed as 543 until canonical repair). Preserve the raw text from the side
whose whitespace-normalized form covers the other; only genuinely independent
parts proceed to ordered append. This relaxed comparison is barrier-scoped and
must not become a global Assistant dedupe heuristic.

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

Server v2 intermediate Assistant steps can carry `isComplete:true` while the
session runtime remains active. Active-draft subscription is therefore owned
solely by runtime activity plus session/turn identity; step completion must not
detach the bubble. The live draft renders as leaf components appended after the
formal timeline — not as a transient merged block: `LiveDraftTail` shows the
growing thinking as one raw pre-wrap text block (no markdown, no per-segment
summarize) and the uncommitted text tail as a streaming intermediate block, so
each delta re-renders only the leaf. A tool boundary atomically commits the
draft (same materialization) into formal order and the leaf detaches until the
next segment.

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

Thinking-part merging is incremental by immutable array identity. A `WeakMap`
keeps the canonical part order, normalized text, and id-to-position index for
each returned array; the next streaming batch processes only its incoming
parts, normalizes each new object once, and rebuilds the full index only after
a rare superset replacement or timestamp reorder. An uncached history array is
canonicalized once before it enters this path. The cache is deliberately
ephemeral and never persisted, and callers must keep treating both part objects
and their arrays as immutable. The 240-independent-part regression fixture also
ends with a full replay, so performance work cannot weaken deduplication,
whitespace normalization, source timestamp ordering, or replay coverage.

Reconnect replay adds two stricter ownership rules. An unseen stable snapshot
message ID may not use the generic same-turn open-Assistant shortcut: it must
pass the guarded completion-binding path, and any tool/subagent/approval whose
timestamp lies between the replayed official step and the live draft proves
they are different materializations. Otherwise an older official step can be
spliced into the newest process sentence even though the Server history is
clean. For current 0.29 frames that omit `offset`, thinking parts retain their
source timestamps; merges restore a stable timestamp order (equal timestamps
keep arrival order), and a growing same-ID part keeps its original position.
This fallback is limited to `thinkingParts`; offset-bearing body/thinking streams
continue to use the turn-global anchor rules below.

Prompt-completion replay is chronological, but it arrives after the live turn
has already crossed its tool boundaries. Each previously unseen stable message
must therefore bind to the corresponding unowned live materialization even
when that segment is already complete; the boundary-time guard above, not
`isComplete`, distinguishes an older pre-tool segment from the current
post-tool draft. Once bound, every later part carrying that exact stable ID
updates the same event even if a tool is now present later in the array.
Appending the pre-tool message at the tail makes an array-tail selector replace
a full final answer with the earlier progress sentence. Completion replay should
bind it in place; the completed-body projector additionally selects the text
block with the greatest source-event timestamp, using array order only for equal
timestamps, so a non-barrier snapshot/reconciliation replay cannot regress an
already persisted final body.

## Offset-anchored volatile deltas take precedence over order-based merging

Kimi Code Server tags volatile `assistant.delta` / `thinking.delta` WS frames
with a character `offset` that **restarts at 0 for every step** and accumulates
only within that step; text and thinking cursors are tracked separately. This
was measured on 0.32 with 1240 unsampled `[live] anchor` rows: splitting the
sequence at `offset === 0` yields per-step blocks that are each strictly
monotonic (thinking 0..2339, then 0..259, then 0..3493, and so on).

The earlier text here claimed one cumulative cursor across the whole Agent turn
that never resets at a `turn.step` or tool boundary, and required
`takeActiveTurnDraft` to retain it. That was wrong, and it caused the worst
live-output defect of this family: a retained anchor made every new step's
opening `offset === 0` delta byte-identical to a reconnect replay, so the
`!acc && anchor !== null -> reject` rule dropped it, the anchor never advanced,
and the rest of that step was rejected as well (measured 814/932 thinking and
146/308 body deltas discarded in a single turn). That one cause produced three
long-standing symptoms at once: intermediate thinking segments missing, many
steps' tools clumping into one "N 个工具调用" card (only tool frames survived
the batch), and final bodies surviving only as fragments — the per-turn
fragment patch in `kimiHistoryReconciliation` had been salvaging that damage
after the fact.

So a committed visual segment now ends its anchoring scope:
`takeActiveTurnDraft` drops the cursors, and `offset === 0` always opens the
segment's new stream. `offset === anchor` appends, `offset < anchor` skips an
already-seen tail, and `offset > anchor` means frames were missed and requires
an authoritative snapshot. A genuine reconnect/resync replay is instead
detected by content: it re-sends the prefix just committed, so the store keeps
that text and rejects an `offset === 0` delta that is a prefix of it. Such a
rejection deliberately leaves the anchor `null`, because replies routinely open
with identical words and a false positive must cost one delta and resume on the
next frame rather than freeze the step. An authoritative body/snapshot clears
the cursor because its per-message text cannot reconstruct the step length; the
next live frame may seed a fresh cursor from a non-zero offset, with the
snapshot already carrying the prefix.
An offset gap against a known cursor is never fuzzy-appended: showing a shorter
authoritative/live prefix is preferable to persisting invented prose.

The committed-prefix replay guard survives authoritative clears. `clearActiveTurnDraft` (step-completion / authoritative body frames) drops the stream cursors but keeps the committed segment text, because the very next step of the same turn re-opens at `offset === 0` and may re-send the just-committed prefix — observed after a steer (session_532ff5cb): the Server appended the steer user message mid-turn, the step boundary frame cleared the draft, and the next step's thinking stream restarted at offset 0 with the same opening text; with the committed text deleted the replay guard had no baseline and rematerialized a second thinking block next to the settled one (double thinking blocks, user-visible). Keeping the baseline costs at most one delta on a false positive (the existing self-heal), and keys are turn-scoped so different turns never share baselines.

A steer can re-push the pre-steer step's full body as a fresh volatile stream (offset 0 re-open, observed session_532ff5cb 08:54: the Server replayed the 191-char step-1 body after the steer confirmation, while the step-1 draft had never committed at the tool boundary — its 35-char opening stayed stranded and was re-materialized onto a later step's draft). The draft replay guard rejects a committed-prefix delta only while the accumulator is empty, so a non-empty stranded draft swallows the replay instead; the result is two assistant events whose bodies share a 30+ char verbatim prefix (differing only at the tail punctuation), rendered as two identical text segments. `buildTurnBlocks` now drops a text segment that shares a ≥20-char verbatim prefix with an existing text block of the same turn (the stranded duplicate), keeping the fuller segment; ordinary shared openings like 你好霖江路。 stay below the threshold. The draft-side committedSegments guard remains the primary defense; the block-level prefix dedup is the renderer fallback for stranded-draft rematerialization.

The committedSegments guard has two holes it cannot see: a think-only commit overwrites the single-slot body baseline, and a window reload empties the whole map — in both states a Server resync that replays the turn body cumulatively from offset 0 (observed session_532ff5cb 12:11: X+Y replayed to 161 chars, later to 585) is swallowed into the empty draft and rendered as a second copy of bodies the formal timeline already owns. The primary defense is therefore the formal-coverage suppression in `anchorStreamText`: while the accumulator is empty and unanchored, a delta of >=8 chars that prefix-matches at its own offset inside any coverage string built by `buildFormalReplayCoverage` (per-segment bodies/thinking plus raw and 

-joined cumulative variants, collected from the same turn's assistant events already in the formal timeline) is rejected without anchoring; divergence from every coverage string falls back to the normal path automatically. The >=8 floor keeps a new step's short greeting opening (你好霖江路。 routinely prefixes every segment) out of suppression — the same false-positive tradeoff the committed guard already accepts, with the formal frame restoring full text at commit. `useEventStream` caches coverage per events-array reference in a WeakMap so no O(history) scan is added per delta. On the persistence side, `collapseDuplicateMaterializations` also blanks an `active-draft:` body that is byte-identical to an earlier formal event's body in the same user-turn scope (>=16 chars, formal-before-materialized order only), keeping its distinct thinking segment — mirroring the hydration `deliveryContentKey` guard for the live-timeline and runtime-recovery paths that never pass through `deduplicateTimelineEvents`.

Diagnosing this anchor model requires an unsampled log. `[live] stream` (`noteLiveStreamFrame`) samples at most one row per session every 2s, which makes "offset resets to 0 at a stream restart" and "offset is scoped per step" **observationally equivalent**: in both cases the first sampled row after a reset carries a small non-zero offset (a few hundred chars accumulated inside the sampling window). Those two hypotheses imply opposite fixes, so the turn-global claim above must never be revised from sampled rows. `noteStreamAnchorDecision` emits unsampled `[live] anchor` rows at the decision point (offset, delta/accumulator lengths, anchor before/after, accepted, offset-regression flag), capped per `key:kind` at 1200 full rows then key signals only (rejections and offset regressions) to a hard stop at 2000.

The offset is threaded `ServerFrame → flattenServerEvent →
mapKimiCodeEvent → AssistantMessageEvent.streamOffset`. Order-based
concatenation plus containment checks must never be applied to offset-bearing
frames: fuzzy containment drops genuine fragments and produces scrambled,
duplicated thinking. Anchored thinking collapses to a single growing part per
draft, mirroring the official one-block-per-turn presentation. Hydration also
repairs already-persisted protocol artifacts in two layers. Exact semantic
mirrors compare normalized body + complete thinking, independent of how
`thinkingParts` were fragmented; an identity-bearing live/snapshot event may
absorb its bounded identity-less canonical mirror inside the same deduplicated
user turn. When later `active-draft:` materializations repeat only the old body
but own distinct thinking, hydration clears that repeated body and keeps the
thinking/process segment. Different user turns, delivery identities, room
Agents, and ordinary identity-less Assistant events remain independent.
Repaired session ids are invalidated only after pending-message hydration, then
persisted once through the incremental writer, so the cleanup is durable
without restoring the old all-session startup rewrite. SDK-route deltas carry
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

**Reconcile circuit breaker (v2.20.0)** prevents the repair/startup/running-sample loops from repeatedly reconciling a canonical-event pair that was already rejected. The breaker persists a fingerprint (assistant body size + process event count + thinking history size + displayable user image count, for both local and canonical events) per `sessionId:roomAgentId` into localStorage (`kimix_reconcile_circuit_v6`, LRU 500). Timestamps are deliberately excluded (rejected-path patches append Date.now() status events that would shift the fingerprint every ~70ms); thinking size and user image count are required because the rejection gates compare exactly them, so a canonical that regains either must shift the fingerprint to earn a retry. On each rejected `shouldReplaceWithCanonicalKimiHistory`, the fingerprint is registered; an accepted branch clears it. Before calling `reconcileAgentCanonicalHistory`, the repair/startup/running-sample call sites check `isCanonicalReconciliationCircuitOpen(...)` and skip the entire reconcile+setState block when the same fingerprint was previously rejected and the canonical data hasn't changed. When canonical data grows, the fingerprint shifts and the circuit closes for one retry. This reduces the "15 rejected reconciles per second" to "one reject per fingerprint change".

**Subscription shallow guard + startup archive flush merge (v2.20.0)**: the `useStatePersistence` subscription now checks per-element reference equality when `sessions` is a new array but every element is the same reference (the `map()` false-change pattern), returning early without scheduling a persist. During the startup window (first 30s), `archiveOrDeletionChanged` routes through the debounced `scheduleLocalConversationPersist` instead of forcing an immediate flush (tombstone localStorage writes remain immediate); after the window, the old immediate behavior applies.

New invariants:
- **Invariant A (incremental persist)**: after hydration populates `hydratedSessionRefs`, the first persist skips every session (all store references match). Store Session objects must NEVER be mutated in place — the per-session skip is keyed on object identity, so an in-place mutation makes a changed session look unchanged and silently drops it from persistence. A subsequent write only touches sessions whose store reference differs from the cache, plus pending messages and the index (when dirty). The `markConversationStatePersisted` guard (lastPersistedSessionsRef) still provides the coarser array-level skip; the cache provides the finer per-session skip beneath it.
- **Invariant B (circuit breaker)**: a rejected reconcile pair is never retried with identical canonical data; when canonical grows, the fingerprint changes and one retry fires. An accepted reconciliation clears the circuit for that target. The undo path and user-initiated manual reconcile never consult the breaker.
- **Invariant C (startup archive flush)**: inside the 30s startup window, archive/deletion state changes merge into the debounced persist cadence instead of forcing an immediate full-write flush. Outside the window the old immediate behavior applies. Tombstone writes to localStorage remain synchronous in both modes.
- **Invariant D (GC ref availability)**: every session skipped by incremental persist must still contribute its image refs to garbage collection — either from `sessionImageRefs` (pre-populated at load/registration and refreshed whenever that session is stripped) or via the lazy fallback that collects once from the cached store session. A cache that is only populated for *changed* sessions makes unchanged sessions' refs vanish from `referencedRefs`, and the GC deletes their in-use images (caught in review, v2.20.0: the first real persist after hydration would have bulk-deleted history images). Any GC test that mocks `getAllImageIds` to `[]` structurally cannot catch this — at least one test must report an in-use image id and assert it is never passed to `deleteImages`.
- **Invariant E (tool boundary breaks assistant segments)**: `mergeEvents` must never merge an incoming assistant text/thinking frame into an earlier unfinished assistant when a `tool_call`/`subagent`/`approval_request` event already sits between them (v2.20.0, `hasToolBoundary` in both the `stableAssistantIndex` and fallback merge paths). The old `sameTurnAssistantIndex` behavior absorbed a whole turn's text into one pre-tools message, which collapsed every completed turn to a single text block before its tools — and `computeFinalTextBlockContent` then misclassified that sole block as "intermediate process" (trailing tools ⇒ bottom body `""`), making all historical turn bodies vanish into the collapsed process summary. Empty identity-terminal frames (`isComplete`, no content/thinking) are exempt and still complete the latest unfinished assistant; barrier replays and stable snapshot ids keep their own paths. As a display-layer backstop for already-merged legacy histories, a complete turn with exactly one text block and trailing process blocks shows that block in full.
- **Invariant F (stream-offset-ordered body merge)**: when both assistant frames carry `streamOffset`, content must merge by offset interval order — prepend when the incoming fragment ends before the target starts, append after, and on overlap keep the earlier fragment plus the later fragment's non-overlapping suffix (`mergeAssistantContentWithOffset`, v2.20.0). Plain concatenation corrupts text whenever a provider emits out-of-order deltas (observed with grok-4.5: offset 2 arrived before offset 0, rendering "霖江路…你好" until the authoritative snapshot frame rewrote the body). When either side lacks an offset, fall back to **prefix-safe** merge (`startsWith`, never `includes`) — a fragment that merely contains the existing text mid-string must not be treated as an authoritative superset, because `includes` silently drops the prefix context while `startsWith` at worst concatenates once and self-heals on the next frame.
- **Invariant G (per-step stream cursor)**: Server `assistant.delta` / `thinking.delta` offsets restart at 0 for every step and accumulate only within that step (measured on 0.32 with 1240 unsampled `[live] anchor` rows), so a committed visual segment ends its anchoring scope: `takeActiveTurnDraft` drops the cursors, and `offset === 0` always opens the next segment's stream. `offset === anchor` appends, `offset < anchor` skips an already-seen tail, and `offset > anchor` means frames were missed and requires an authoritative snapshot. A genuine reconnect replay is detected by content against the just-committed segment, and such a rejection deliberately leaves the anchor `null` so a false positive costs one delta and self-heals on the next frame. The earlier turn-global reading (retain the cursor across commits, reject empty-accumulator `offset === 0` as replay) froze the anchor at the first commit and discarded the rest of every later step — 76% of deltas in the capture. After an authoritative snapshot clears the cursor, an empty draft may seed from the next non-zero offset because the snapshot owns the omitted prefix.
- **Invariant H (draft identity is per materialization, not per turn)**: the active-draft key locates the current in-memory buffer for `(session, room agent, Agent turn)`, but it is not a durable event identity. One Agent turn can cross many tool/status boundaries, and each boundary commits the current draft before a later segment reuses the same buffer key. Every genuinely new draft segment therefore gets a cross-process unique `materializationId`; its persisted `active-draft:` event ID remains stable while that segment grows, but differs from every earlier/later materialization of the same turn—even if the app restarts while that turn is still resumable. Reusing the bare turn key as the event ID lets live `mergeEvents` display all boundary-separated segments, then makes startup `deduplicateTimelineEvents` discard every later segment—including the final answer—as duplicate IDs. Conversely, a transport replay must never mint a materialization. Hydration compares full Assistant semantics rather than raw part segmentation: it may fold a bounded identity-less mirror into an identity-bearing live/snapshot event in the same user turn, and may clear an old body repeated by a later same-delivery `active-draft:` while retaining distinct thinking. It must never globally content-deduplicate different user turns, deliveries, room Agents, or ordinary identity-less Assistant steps. Any hydration repair is marked dirty only after pending-message load and incrementally persisted once.
- **Invariant I (rejected canonical history may still repair a missing tail)**: whole-history monotonicity remains conservative—shorter canonical thinking/tool history must not replace richer local history—but rejection does not forbid a bounded additive repair. When the latest user turn matches, a canonical last Assistant may be appended without replacing local process history through either of two evidence channels: (1) its stable snapshot sequence is strictly newer than every local stable Assistant in the same sequence, or (2) a local wire mirror has no message IDs but its last Assistant timestamp is strictly newer than the local turn's last visible Assistant and its exact body is absent. When local persistence missed the latest user boundary itself, recovery is turn-atomic: the canonical latest user must be strictly newer than the local latest user, absent from every local user turn, and followed by a non-empty visible final Assistant. If local post-boundary remnants contain no visible process output, recover the complete canonical turn tail (thinking, tools, statuses and final body), not merely the body; if local remnants contain richer visible output, move those events behind the recovered user boundary and append only the missing final body rather than replacing them. A persisted body-only recovery from v2.20.29 is upgraded when the local latest turn has the exact canonical final body but no expandable thinking/tool process and canonical does. This repairs “progress sentence remains, final answer missing”, “newest whole turn absent”, and the body-only recovery regression while rejecting same-time different users, older/equal wire tails, identity-less empty local turns, and destructive thinner-tail replacement. Persistent reconciliation-circuit keys are algorithm-versioned (v5 for turn-atomic process recovery); changing additive recovery semantics must bump the key so an old rejected fingerprint cannot suppress the new repair. Certifying a rejected pair as cache-current **without** replacement additionally requires that deduped local thinking does not exceed canonical thinking (`hasInflatedLocalKimiThinkingHistory`, v2.20.232): a body-only equivalence check once certified a cache carrying ~7.5K chars of duplicated thinking, which removed it from every future repair candidate list and froze the damage in persistence. Development and built renderers use different origins/IndexedDB stores, so a recovery observed in `pnpm dev` is not evidence that the daily built window's local history was repaired.
- **Invariant J (completion replay preserves live materialization order)**: a chronological prompt-completion replay must bind each stable Assistant message to the matching unowned live segment, including a pre-tool segment already marked complete. It may not require “no later tool anywhere”; it rejects a candidate only when a tool/subagent/approval falls temporally between the official message and that candidate. After identity binding, later think/text/terminal parts with the same stable ID continue updating that exact segment even when tools follow it. Otherwise an early progress sentence is appended after the final answer and becomes the last text block shown at completion.
- **Invariant K (runtime activity owns live-thinking subscription)**: an active Server v2 turn continues reading `activeTurnDraftStore` even when its latest formal Assistant step is already complete. The live draft thinking must render appended after formal `turnBlocks` (leaf components after the timeline), not hidden by them. Only the TRAILING (still-growing) thinking phase of an active turn uses the five-line (120px) internal scroll viewport — it follows the bottom until the user scrolls upward and retains the complete text; character-tail truncation is forbidden because it makes earlier reasoning permanently inaccessible. Once a text/tool/subagent/approval block follows a phase, that phase settles into the foldable teaser (Invariant N) instead of keeping a live scroll box; completed phases must not keep scrollbars.
- **Invariant L (draft commits follow first-delta order across identity eras and channels)**: committing active-turn drafts must preserve true arrival order. A turn-filtered commit (per `agentTurnId`) must also take every older sibling draft of the same room — never leapfrog it — and selected segments commit in first-delta timestamp order (identity migration can move an older draft to the drafts-map tail). Segments inserted into a pending batch stay ahead of the triggering boundary but never ahead of an assistant item that arrived earlier (same-millisecond ties keep the formal item’s lead). Violating either rule interleaves two identity eras or two channels into “f2,f1,f3” body text (v2.20.23: wire deltas arrived correctly as “你好”→“霖江路。”→“我来查…” with no offsets, yet the live body rendered “霖江路。你好我来查…” until the completion barrier rewrote it).
- **Invariant M (authoritative body frames preserve uncommitted draft thinking)**: a barrier/stable/complete frame that carries body text owns the body, but when it carries no thinking of its own, the draft’s buffered thinking must be committed as a thinking-only segment ahead of it instead of being dropped with the draft. Clearing the draft wholesale makes the last reasoning phase vanish until a later snapshot restores it — the completion flicker.
- **Invariant O (trailing text streams in flow; single copy at settle)**: while a turn is active, every text segment — including the trailing one — streams at its own position in the process flow (official kimi-web has no separate final-body area). the draft tail streams as a leaf (`LiveDraftTail` text block, wire order think → text) instead of being merged into the formal array — per-delta merging rebuilt the array and defeated memoization, so `mergeLiveDraftBlocks` is no longer called by the render path. At settle the timeline skips exactly the group the bottom body selected — `computeFinalTextBlockIndex` (greatest source-event timestamp, later array block on ties) hands that block's key to the flow — instead of heuristically skipping the last array text group; a late trailing tool or a replayed older-timestamp step can therefore never render the same body twice nor hide the official final answer. When the process detail is collapsed while running, the flow copy is invisible and the body streams the trailing candidate instead (`computeStreamingTrailingTextContent`); expanded, the body stays empty — one visible copy in every state. The ordinary Assistant copy action follows this same final/trailing body projection and must never read the turn-wide merged `event.content`, because that aggregate deliberately retains intermediate process text; only the explicit “全部复制（含思考）” action owns the aggregate content plus thinking.
- **Invariant N (live thinking is a raw-text leaf; settled thinking folds)**: while the turn streams, `LiveDraftTail` renders the draft thinking as one raw pre-wrap text block (no markdown, no per-segment summarize — official kimi-web renders thinking as plain text and swaps the text node per frame) inside the five-line scroll viewport; it always holds the complete text, never a truncation. The live leaf is a different component from the settled block, so the live→formal handoff is a mount, not a DOM-key reuse; the structural change is masked by the scroll-viewport → teaser transition. Settled (completed) thinking folds by `resolveSettledThinkingFold`: multi-paragraph blocks teaser their last paragraph (official kimi-web rule), and long single-paragraph streams (>5 lines or >200 chars) teaser their last non-empty line — settled long reasoning is never a fixed, non-clickable wall, and the full text stays one click away. Exception: a block whose teaser already covers the whole text (a single unbroken long line is the main case) is NOT foldable — expanding would render the same content twice, so it stays fully visible instead. When the trailing formal thinking group is still live (a mid-turn commit already landed a segment there), the draft tail renders INSIDE that group's scrollbox via the `LiveThinkingDraftTail` leaf (`shouldMergeLiveThinkingDraftIntoTimeline`), and `LiveDraftTail` suppresses its own `LiveThinkingPre` — committed segments and the still-streaming continuation share one viewport; before v2.20.278 each owned a scrollbox, so a short committed first sentence sat fixed above the scrolling bulk.
- **Invariant O (completed body and duration ignore late passive replay order)**: `TurnBlock[]` keeps official array order and is never timestamp-sorted, but the completed bottom body chooses the text block whose source Assistant timestamp is greatest; equal timestamps keep the later array block. This is a display-only backstop for an unseen non-barrier stable snapshot that arrives after a newer live final materialization. Derived turn duration likewise ends at the last actual Agent/process event, not at status/usage samples or derived change/diff/todo/recommendation artifacts that may be appended minutes after completion—or, after a locally missing user boundary, accidentally grouped into the previous turn. Mapped multi-step Assistant segments carry cumulative duration as of each segment; merging them must use the maximum reliable value, then compare it with the user→actual-process-end projection. The first segment's shorter cumulative value must never replace the complete turn duration. Neither rule changes draft assembly, WebSocket delivery, completion binding, or the expanded process timeline.
- **Invariant P (search keeps source-event addressability across render merging)**: search results carry the original stored event ID. Any display projection that absorbs that event into another `RenderItem` or `TurnBlockGroup` must retain and expose the complete source ID; punctuation inside an ID is data, not a delimiter. Exact search focus expands only the target history/process/tool ancestry, retries after each mount, and selects the query inside the deepest matching source block. Falling back directly from a source ID to the merged turn container makes repeated terms land on the wrong occurrence and is forbidden.
- **Invariant Q (thinking-part indexes follow immutable array identity)**: `mergeAssistantThinkingParts` may reuse a `WeakMap` index only for the exact part-array object it canonicalized or returned. Existing normalized text and id positions are not recomputed for every token; only the incoming batch is processed. Callers must never mutate a cached array or part object in place. A full replay still removes every covered fragment in one batch, same-id growth stays at its original source position, out-of-order timestamps are stably sorted, and an uncached persisted array is canonicalized once before incremental merging.
- **Invariant R (a steer turn boundary settles the pre-steer render turn; the waiting label requires real output)**: the conditional steer split (v2.20.244) flushes the pre-steer turn with `hasLaterSteerBoundary`, which feeds `turnSettled` exactly like a user boundary. Without it, the still-running official turn's `roomAgentActivities` entry matches the pre-steer render turn through the shared `agentTurnId` (`roomAgentActivityMatchesTurn` ignores `isLatestTurn`), so the pre-steer turn stays `isAssistantActive` for the rest of the official turn: its old thinking keeps a live scroll viewport instead of folding into a teaser, its footer sticks on 消息处理中, and the same draft renders in BOTH the pre-steer and post-steer windows — duplicated content plus two scrollbar regions (observed v2.20.247, session_532ff5cb live window). Live state belongs only to the post-steer latest turn; reload already settled the pre-steer turn via `isSessionLevelTurnStopped`, so this aligns the live window with the reload shape. Separately, an established draft KEY is not model output: the key appears with `activeTurnId` the moment a prompt/steer is sent, so the process header reads the boolean `useActiveTurnDraftHasOutput` snapshot (re-renders only on the empty→non-empty flip, preserving the v2.20.237 leaf-subscription performance invariant) and shows 等待模型输出 until the draft actually holds thinking or text — never 正在思考 on key presence alone.

Layout and text shaping are the dominant streaming cost once JS is cheap. Measured on production reproductions: an earlier immediate-boundary bug caused 395 flushes/10s at 14ms each; a later 5,500-event long turn still spent 6–7s of every 10s rebuilding render items while running tool arguments flushed 38–42 times. Running tool/status/subagent-only batches therefore use a 500ms cadence, while Assistant text keeps the 80ms cadence and true boundaries remain synchronous. Live thinking keeps its full text but constrains layout growth inside a 120px five-line scroll viewport (`LiveThinkingPre`, the leaf's internal scrollbox), so the outer conversation does not reflow taller after the fifth line; the viewport follows the bottom only while the user is within 24px of it (official kimi-web threshold) and yields otherwise. When the user is not scrolling, draft notifications publish on the next animation frame (matching official web's immediate per-event state update while coalescing same-frame fragments); active outer-chat scrolling alone switches them to the 250ms yield timer.

## Streaming markdown is rich and interval-throttled while active

While an assistant turn is active, the body renders RICH markdown by default
through the block-memoized StreamingRichMarkdown path (`Lexer.lex` block split +
per-block memoized ReactMarkdown), with the visible content advanced on a bounded
300ms cadence that pauses while the user scrolls — whole-content lex/normalize and
the growing tail block run a few times per second, not per token. The fence-aware
plain path remains as an explicit fallback (`kimix_streaming_plain_markdown=1` or
`kimix_streaming_rich_markdown=0`). Settled content upgrades to the full
ReactMarkdown stack once complete and not scrolling, as before.

Every visible Assistant text route must use this shared renderer, including
`KimiWebIntermediateTextBlock` inside the expanded process timeline; directly
emitting its source string exposes Markdown markers and creates a renderer split.
Only the active trailing text group receives `streaming=true`. Earlier
intermediate groups are immutable and render immediately through the settled rich
path, preserving the existing streaming cost boundary and leaving
thinking/tool-card expansion untouched.
The wrapper around rich Markdown must use normal whitespace collapsing:
`white-space: pre-wrap` is reserved for raw thinking text, because inheriting it
into ReactMarkdown makes the separator newlines around paragraphs and loose-list
`<li><p>` nodes visible as blank rows on top of the intended Markdown margins.

Feature flags (localStorage): `kimix_streaming_rich_markdown` (default on), `kimix_streaming_plain_markdown`,
`kimix_scroll_yield`, `kimix_active_turn_draft`; diagnostics behind
`kimix_perf_diag` (`getPerfDiagSnapshot()`). "运行中折叠过程详情"
(`kimix_collapse_process_while_running`) is a user setting, default on, and only
affects the default-expanded state while a turn is active.
