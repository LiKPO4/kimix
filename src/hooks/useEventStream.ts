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
  clearActiveTurnDraft,
  draftToAssistantEvent,
  isAuthoritativeAssistantBodyEvent,
  listActiveTurnDraftKeys,
  makeActiveTurnDraftKey,
  parseActiveTurnDraftKey,
  takeActiveTurnDraft,
} from "@/utils/activeTurnDraftStore";
import { isActiveTurnDraftEnabled, isScrollYieldEnabled } from "@/utils/perfFlags";
import { timeSync } from "@/utils/perfDiag";
import { isUserScrollActive } from "@/utils/userScrollActivity";

const STREAM_EVENT_FLUSH_MS = 80;
const STREAM_EVENT_FLUSH_MS_WHEN_SCROLLING = 250;

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

function resolveActiveTurnDraftKey(
  sessionId: string,
  roomAgentId: string,
  event: TimelineEvent,
): string | null {
  if (event.type !== "assistant_message" || !event.agentTurnId) return null;
  return makeActiveTurnDraftKey(sessionId, roomAgentId, event.agentTurnId);
}

/** Commit buffered draft text/thinking into the stream batch before formal merge. */
export function commitActiveTurnDraftsToBatch(
  batches: Map<string, { roomId: string; roomAgentId: string; items: TimelineEvent[] }>,
  options?: { sessionId?: string; roomAgentId?: string; agentTurnId?: string },
): void {
  const keys = listActiveTurnDraftKeys().filter((key) => {
    const parsed = parseActiveTurnDraftKey(key);
    if (!parsed) return false;
    if (options?.sessionId && parsed.sessionId !== options.sessionId) return false;
    if (options?.roomAgentId !== undefined && parsed.roomAgentId !== options.roomAgentId) return false;
    if (options?.agentTurnId && parsed.agentTurnId !== options.agentTurnId) return false;
    return true;
  });

  for (const key of keys) {
    const parsed = parseActiveTurnDraftKey(key);
    const draft = takeActiveTurnDraft(key);
    if (!parsed || !draft) continue;
    if (!draft.content && !draft.thinking && !(draft.thinkingParts?.length)) continue;
    const batchKey = JSON.stringify([parsed.sessionId, parsed.roomAgentId]);
    const current = batches.get(batchKey) ?? {
      roomId: parsed.sessionId,
      roomAgentId: parsed.roomAgentId,
      items: [] as TimelineEvent[],
    };
    current.items.unshift(scopeEventToRoomAgent(
      draftToAssistantEvent(key, draft),
      parsed.roomAgentId,
    ));
    batches.set(batchKey, current);
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

  const flushStreamEventsInner = useCallback(() => {
    streamFlushTimerRef.current = null;
    if (isActiveTurnDraftEnabled()) {
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
      applyActiveTurnDraftDelta(draftKey, scoped);
      return;
    }

    if (isActiveTurnDraftEnabled()) {
      // Authoritative full-body frames (barrier / stable snapshot / complete with
      // content) own the final text. Drop the draft instead of committing it so
      // mergeEvents does not append draft + full body (duplicate greeting).
      if (draftKey && isAuthoritativeAssistantBodyEvent(scoped)) {
        clearActiveTurnDraft(draftKey);
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
      const delay = isScrollYieldEnabled() && isUserScrollActive()
        ? STREAM_EVENT_FLUSH_MS_WHEN_SCROLLING
        : STREAM_EVENT_FLUSH_MS;
      streamFlushTimerRef.current = setTimeout(flushStreamEvents, delay);
    }
  }, [flushStreamEvents]);

  return { streamBatchRef, streamFlushTimerRef, enqueueStreamEvent, flushStreamEvents };
}
