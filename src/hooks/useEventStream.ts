import { useRef, useCallback } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import { mergeEvents } from "@/utils/eventMapper";
import { deriveSessionTitle } from "@/utils/sessionTitle";
import type { TimelineEvent } from "@/types/ui";
import {
  getEventRoomAgentId,

  getRoomAgentEvents,
  isPrimaryRoomAgent,
  replaceRoomAgentEvents,
  scopeEventToRoomAgent,
} from "@/utils/collaborationRooms";
import {
  applyActiveTurnDraftDelta,
  buildFormalReplayCoverage,
  clearActiveTurnDraft,
  draftToAssistantEvent,
  getActiveTurnDraft,
  isAuthoritativeAssistantBodyEvent,
  listActiveTurnDraftKeys,
  makeActiveTurnDraftKey,
  parseActiveTurnDraftKey,
  takeActiveTurnDraft,
  type FormalReplayCoverage,
} from "@/utils/activeTurnDraftStore";
import { isActiveTurnDraftEnabled, isScrollYieldEnabled } from "@/utils/perfFlags";
import { timeSync } from "@/utils/perfDiag";
import { isUserScrollActive } from "@/utils/userScrollActivity";

// Resync 重放覆盖串缓存：按正式事件数组引用缓存每个 turn 的覆盖串。deltas 驻留
// draft 期间时间线不变（引用稳定），只有 flush 落批换新数组后才重建，避免每
// delta O(历史) 扫描。
const formalReplayCoverageCache = new WeakMap<
  readonly TimelineEvent[],
  Map<string, FormalReplayCoverage>
>();

function getFormalReplayCoverage(
  events: readonly TimelineEvent[],
  agentTurnId: string,
): FormalReplayCoverage {
  let byTurn = formalReplayCoverageCache.get(events);
  if (!byTurn) {
    byTurn = new Map();
    formalReplayCoverageCache.set(events, byTurn);
  }
  let coverage = byTurn.get(agentTurnId);
  if (!coverage) {
    coverage = buildFormalReplayCoverage(events, agentTurnId);
    byTurn.set(agentTurnId, coverage);
  }
  return coverage;
}

const STREAM_EVENT_FLUSH_MS = 80;
const STREAM_EVENT_FLUSH_MS_WHEN_SCROLLING = 250;
const TOOL_ONLY_STREAM_EVENT_FLUSH_MS = 500;

export function getStreamEventFlushDelay(items: TimelineEvent[], scrolling: boolean): number {
  if (scrolling) return STREAM_EVENT_FLUSH_MS_WHEN_SCROLLING;
  // Raw tool arguments are not conversational text. On long tool calls they
  // can otherwise force an O(history) projection several times per second and
  // starve the actual assistant stream. Completion/boundary frames still flush
  // synchronously before this delay is consulted.
  const onlyBackgroundProgress = items.length > 0 && items.every((event) => (
    event.type === "status_update" ||
    (event.type === "subagent" && event.status === "running") ||
    (event.type === "tool_call" && event.status === "running")
  ));
  return onlyBackgroundProgress ? TOOL_ONLY_STREAM_EVENT_FLUSH_MS : STREAM_EVENT_FLUSH_MS;
}

export function isDeferrableStreamEvent(event: TimelineEvent): boolean {
  if (event.type === "assistant_message" && !event.isComplete) return true;
  // Status updates (token counts, progress text), running-subagent progress,
  // and streaming tool-call arguments are informational and can arrive at high
  // frequency; flushing them immediately would bypass the 80ms batch and
  // re-render the whole thread per event. They merge cheaply in the batch.
  // True boundaries (tool completion, approvals, questions, errors,
  // completion, subagent status transitions) still flush immediately.
  if (event.type === "status_update") return true;
  if (event.type === "subagent" && event.status === "running") return true;
  // Tool calls stream their rawArguments token by token; treating every
  // argument delta as a boundary flushed ~40 times/sec at O(events) each and
  // saturated the main thread (measured 395 flushes / 10s at 14ms avg).
  // Argument streaming batches; the start (~80ms late is invisible) and the
  // completion (status leaves running) stay immediate.
  if (event.type === "tool_call" && event.status === "running") return true;
  return false;
}

function batchHasBoundaryEvent(items: TimelineEvent[]): boolean {
  return items.some((event) => !isDeferrableStreamEvent(event));
}

/**
 * Events carrying a subagent scope (`agentId` other than the main agent) must
 * never enter the active-turn draft store. The draft key is
 * (sessionId, roomAgentId, agentTurnId) with no subagent dimension, and room
 * sessions stamp every delta with the main turn's agentTurnId — so subagent
 * deltas would be appended into the MAIN turn's draft, leaking subagent text
 * into the visible main content in arrival order and resurrecting the draft
 * after the main turn closed (duplicate `active-draft:` event ids). These
 * events stay on the formal batch path, where mergeEvents attaches them to
 * their own subagent card via attachScopedEventToSubagent.
 */
export function hasSubagentEventScope(event: TimelineEvent): boolean {
  if (!("agentId" in event)) return false;
  const agentId = event.agentId;
  return typeof agentId === "string" && agentId.length > 0 && agentId !== "main";
}

function resolveActiveTurnDraftKey(
  sessionId: string,
  roomAgentId: string,
  event: TimelineEvent,
): string | null {
  if (event.type !== "assistant_message" || !event.agentTurnId) return null;
  if (hasSubagentEventScope(event)) return null;
  return makeActiveTurnDraftKey(sessionId, roomAgentId, event.agentTurnId);
}

/** Commit buffered draft text/thinking into the stream batch before formal merge. */
export function commitActiveTurnDraftsToBatch(
  batches: Map<string, { roomId: string; roomAgentId: string; items: TimelineEvent[] }>,
  options?: { sessionId?: string; roomAgentId?: string; agentTurnId?: string },
): void {
  // Identity eras (optimistic vs official turn id) can leave several drafts
  // for the same room. Commit order must follow each draft's first-delta
  // timestamp: a turn-filtered commit may never leapfrog an older sibling
  // draft, and segments inserted into a batch must stay behind formal items
  // that arrived earlier. Otherwise the merged body reads "f2,f1,f3" (e.g.
  // "霖江路。你好…") until an authoritative frame rewrites it.
  const candidates: {
    key: string;
    parsed: NonNullable<ReturnType<typeof parseActiveTurnDraftKey>>;
    firstDeltaAt: number;
  }[] = [];
  for (const key of listActiveTurnDraftKeys()) {
    const parsed = parseActiveTurnDraftKey(key);
    if (!parsed) continue;
    if (options?.sessionId && parsed.sessionId !== options.sessionId) continue;
    if (options?.roomAgentId !== undefined && parsed.roomAgentId !== options.roomAgentId) continue;
    const draft = getActiveTurnDraft(key);
    if (!draft) continue;
    if (!draft.content && !draft.thinking && !(draft.thinkingParts?.length)) continue;
    candidates.push({ key, parsed, firstDeltaAt: draft.timestamp });
  }

  const matched = options?.agentTurnId
    ? candidates.filter((candidate) => candidate.parsed.agentTurnId === options.agentTurnId)
    : candidates;
  if (matched.length === 0) return;
  const selected = options?.agentTurnId
    ? candidates.filter((candidate) =>
        matched.some(
          (hit) =>
            hit.parsed.sessionId === candidate.parsed.sessionId &&
            hit.parsed.roomAgentId === candidate.parsed.roomAgentId &&
            candidate.firstDeltaAt <= hit.firstDeltaAt,
        ),
      )
    : matched;
  // Stable sort: same-millisecond drafts keep their creation (arrival) order.
  const ordered = [...selected].sort((a, b) => a.firstDeltaAt - b.firstDeltaAt);

  const prependedByBatch = new Map<string, {
    roomId: string;
    roomAgentId: string;
    items: TimelineEvent[];
  }>();
  for (const { key, parsed } of ordered) {
    const draft = takeActiveTurnDraft(key);
    if (!draft) continue;
    if (!draft.content && !draft.thinking && !(draft.thinkingParts?.length)) continue;
    const batchKey = JSON.stringify([parsed.sessionId, parsed.roomAgentId]);
    const prepended = prependedByBatch.get(batchKey) ?? {
      roomId: parsed.sessionId,
      roomAgentId: parsed.roomAgentId,
      items: [] as TimelineEvent[],
    };
    prepended.items.push(scopeEventToRoomAgent(
      draftToAssistantEvent(key, draft),
      parsed.roomAgentId,
    ));
    prependedByBatch.set(batchKey, prepended);
  }

  for (const [batchKey, prepended] of prependedByBatch) {
    const current = batches.get(batchKey);
    if (!current) {
      batches.set(batchKey, prepended);
      continue;
    }
    // Segments stay ahead of the triggering boundary, but never leap ahead
    // of an item that arrived earlier: the segment timestamp is its first
    // delta, so it lands before the first LATER item. Assistant ties keep the
    // formal item's lead (the "f2,f1,f3" guard); official wire gives a
    // thinking part and its following tool the same timestamp, so a
    // non-assistant tie still inserts the segment first. Never jump ahead of
    // already-batched running tool deltas: deferrable tool frames pile up
    // between flushes, and leaping past them clumps many steps' tools into
    // one merged "N 个工具调用" card while the interleaved thinking/text
    // segments coalesce into a single block (official kimi-web never does).
    const items = [...current.items];
    for (const segment of prepended.items) {
      const insertAt = items.findIndex((item) => (
        item.type === "assistant_message"
          ? item.timestamp > segment.timestamp
          : item.timestamp >= segment.timestamp
      ));
      if (insertAt === -1) items.push(segment);
      else items.splice(insertAt, 0, segment);
    }
    batches.set(batchKey, { ...current, items });
  }
}

function canCoalesceAssistantDelta(previous: TimelineEvent, incoming: TimelineEvent): boolean {
  return previous.type === "assistant_message" &&
    incoming.type === "assistant_message" &&
    !previous.isComplete &&
    !incoming.isComplete &&
    previous.roomAgentId === incoming.roomAgentId &&
    previous.roomMessageId === incoming.roomMessageId &&
    previous.agentTurnId === incoming.agentTurnId &&
    previous.dispatchAttemptId === incoming.dispatchAttemptId &&
    previous.agentId === incoming.agentId &&
    previous.agentRole === incoming.agentRole &&
    previous.model === incoming.model &&
    (
      (!previous.snapshotMessageId && !incoming.snapshotMessageId) ||
      (
        previous.snapshotMessageId === incoming.snapshotMessageId &&
        previous.snapshotMessageIdStable === incoming.snapshotMessageIdStable
      )
    );
}

export function coalesceStreamEventBatch(items: TimelineEvent[]): TimelineEvent[] {
  const coalesced: TimelineEvent[] = [];
  for (const item of items) {
    const previous = coalesced.at(-1);
    if (!previous || !canCoalesceAssistantDelta(previous, item)) {
      coalesced.push(item);
      continue;
    }
    const merged = mergeEvents([previous], item);
    if (merged.length === 1 && merged[0].type === "assistant_message") {
      coalesced[coalesced.length - 1] = merged[0];
    } else {
      coalesced.push(item);
    }
  }
  return coalesced;
}

export function useEventStream() {
  const streamBatchRef = useRef<Map<string, { roomId: string; roomAgentId: string; items: TimelineEvent[] }>>(new Map());
  const streamFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateSession = useSessionStore((s) => s.updateSession);

  const flushStreamEventsInner = useCallback((commitDrafts = true) => {
    streamFlushTimerRef.current = null;
    if (commitDrafts && isActiveTurnDraftEnabled()) {
      commitActiveTurnDraftsToBatch(streamBatchRef.current);
    }
    const batches = streamBatchRef.current;
    if (batches.size === 0) return;
    streamBatchRef.current = new Map();
    batches.forEach(({ roomId, roomAgentId, items }) => {
      updateSession(roomId, (session) => {
        let events = getRoomAgentEvents(session, roomAgentId);
        for (const item of coalesceStreamEventBatch(items)) {
          events = mergeEvents(events, item);
        }
        let next = replaceRoomAgentEvents(session, roomAgentId, events);
        if (isPrimaryRoomAgent(session, roomAgentId) && !session.titleLocked) {
          next = { ...next, title: deriveSessionTitle(events, session.title) };
        }
        return { ...next, updatedAt: Date.now() };
      });
    });
  }, [updateSession]);

  const flushStreamEvents = useCallback(
    () => timeSync("flushStreamEvents", flushStreamEventsInner),
    [flushStreamEventsInner],
  );

  const enqueueStreamEvent = useCallback((uiSessionId: string, event: TimelineEvent) => {
    const session = useSessionStore.getState().sessions.find((item) => item.id === uiSessionId);
    if (!session) return;
    const roomAgentId = getEventRoomAgentId(session, event);
    const scoped = scopeEventToRoomAgent(event, roomAgentId);
    const draftKey = resolveActiveTurnDraftKey(uiSessionId, roomAgentId, scoped);

    // B1: pure text/thinking deltas stay in the active-turn draft store so
    // historical session subscribers are not woken on every token.
    // Stable snapshot / barrier frames stay on the formal path (they may REPLACE
    // body text; draft only knows how to append live deltas).
    if (
      isActiveTurnDraftEnabled() &&
      draftKey &&
      isDeferrableStreamEvent(scoped) &&
      scoped.type === "assistant_message" &&
      !scoped.snapshotMessageId &&
      !scoped.snapshotMessageIdStable &&
      !scoped.completionBarrierReplay
    ) {
      applyActiveTurnDraftDelta(
        draftKey,
        scoped,
        getFormalReplayCoverage(getRoomAgentEvents(session, roomAgentId), scoped.agentTurnId as string),
      );
      return;
    }

    if (isActiveTurnDraftEnabled() && !hasSubagentEventScope(scoped) && scoped.type !== "status_update") {
      // Authoritative full-body frames (barrier / stable snapshot / complete with
      // content) own the final text. Drop the draft instead of committing it so
      // mergeEvents does not append draft + full body (duplicate greeting).
      // Subagent-scoped frames never touch the MAIN turn's draft: they must not
      // clear it (their authoritative body belongs to the subagent card) nor
      // force an early commit of it.
      if (draftKey && isAuthoritativeAssistantBodyEvent(scoped)) {
        const draft = getActiveTurnDraft(draftKey);
        const frameHasThinking = scoped.type === "assistant_message" &&
          Boolean(scoped.thinking?.trim() || scoped.thinkingParts?.some((part) => part.text.trim()));
        const draftHasThinking = Boolean(
          draft && (draft.thinking?.trim() || draft.thinkingParts?.some((part) => part.text.trim())),
        );
        if (draft && draftHasThinking && !frameHasThinking) {
          // The frame owns the BODY but carries no thinking. Commit only the
          // draft's thinking ahead of it so the last reasoning phase does not
          // vanish until a later snapshot restores it (completion flicker).
          const taken = takeActiveTurnDraft(draftKey);
          if (taken) {
            const parsed = parseActiveTurnDraftKey(draftKey);
            const segment = scopeEventToRoomAgent(
              { ...draftToAssistantEvent(draftKey, taken), content: "" },
              parsed?.roomAgentId ?? roomAgentId,
            );
            const segmentBatchKey = JSON.stringify([uiSessionId, roomAgentId]);
            const segmentBatch = streamBatchRef.current.get(segmentBatchKey) ?? {
              roomId: uiSessionId,
              roomAgentId,
              items: [] as TimelineEvent[],
            };
            segmentBatch.items.push(segment);
            streamBatchRef.current.set(segmentBatchKey, segmentBatch);
          }
        } else {
          clearActiveTurnDraft(draftKey);
        }
      } else {
        commitActiveTurnDraftsToBatch(streamBatchRef.current, {
          sessionId: uiSessionId,
          roomAgentId,
          agentTurnId: typeof scoped.agentTurnId === "string" ? scoped.agentTurnId : undefined,
        });
      }
    }

    const key = JSON.stringify([uiSessionId, roomAgentId]);
    const current = streamBatchRef.current.get(key) ?? { roomId: uiSessionId, roomAgentId, items: [] as TimelineEvent[] };
    current.items.push(scoped);
    streamBatchRef.current.set(key, current);

    const immediate = !isDeferrableStreamEvent(scoped) || batchHasBoundaryEvent(current.items);
    if (immediate) {
      if (streamFlushTimerRef.current) {
        clearTimeout(streamFlushTimerRef.current);
        streamFlushTimerRef.current = null;
      }
      flushStreamEvents();
      return;
    }

    if (!streamFlushTimerRef.current) {
      const delay = getStreamEventFlushDelay(
        current.items,
        isScrollYieldEnabled() && isUserScrollActive(),
      );
      // Informational status/tool-progress batches may flush between every text
      // delta. They must not materialize the active draft: doing so resets the
      // per-step accumulator while its offset anchor keeps advancing, reducing
      // the formal body to the final fragment (observed as a lone "？"). True
      // boundaries commit synchronously above or call the public flush path.
      streamFlushTimerRef.current = setTimeout(() => flushStreamEventsInner(false), delay);
    }
  }, [flushStreamEvents, flushStreamEventsInner]);

  return { streamBatchRef, streamFlushTimerRef, enqueueStreamEvent, flushStreamEvents };
}
