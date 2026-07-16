import { useRef, useCallback } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import { mergeEvents } from "@/utils/eventMapper";
import { deriveSessionTitle } from "@/utils/sessionTitle";
import { getLastUsedModelFromEventsAfter } from "@/utils/modelDisplay";
import type { TimelineEvent } from "@/types/ui";
import {
  getEventRoomAgentId,

  getRoomAgent,
  getRoomAgentEvents,
  isPrimaryRoomAgent,
  replaceRoomAgentEvents,
  scopeEventToRoomAgent,
  updateRoomAgent,
} from "@/utils/collaborationRooms";

const STREAM_EVENT_FLUSH_MS = 80;

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
    previous.model === incoming.model;
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

  const flushStreamEvents = useCallback(() => {
    streamFlushTimerRef.current = null;
    const batches = streamBatchRef.current;
    if (batches.size === 0) return;
    streamBatchRef.current = new Map();
    batches.forEach(({ roomId, roomAgentId, items }) => {
      updateSession(roomId, (session) => {
        let events = getRoomAgentEvents(session, roomAgentId);
        for (const item of coalesceStreamEventBatch(items)) {
          events = mergeEvents(events, item);
        }
        const agent = getRoomAgent(session, roomAgentId);
        const modelSwitchedAt = agent?.modelSwitchedAt ?? session.modelSwitchedAt;
        const lastUsedModel = getLastUsedModelFromEventsAfter(events, modelSwitchedAt);
        let next = replaceRoomAgentEvents(session, roomAgentId, events);
        if (session.collaboration && lastUsedModel) {
          next = updateRoomAgent(next, roomAgentId, (current) => ({ ...current, modelAlias: lastUsedModel }));
        }
        if (isPrimaryRoomAgent(session, roomAgentId) && !session.titleLocked) {
          next = { ...next, title: deriveSessionTitle(events, session.title) };
        }
        if (!session.collaboration && lastUsedModel) {
          next = { ...next, model: lastUsedModel };
        }
        return { ...next, updatedAt: Date.now() };
      });
    });
  }, [updateSession]);

  const enqueueStreamEvent = useCallback((uiSessionId: string, event: TimelineEvent) => {
    const session = useSessionStore.getState().sessions.find((item) => item.id === uiSessionId);
    if (!session) return;
    const roomAgentId = getEventRoomAgentId(session, event);
    const key = JSON.stringify([uiSessionId, roomAgentId]);
    const current = streamBatchRef.current.get(key) ?? { roomId: uiSessionId, roomAgentId, items: [] };
    current.items.push(scopeEventToRoomAgent(event, roomAgentId));
    streamBatchRef.current.set(key, current);
    if (!streamFlushTimerRef.current) {
      streamFlushTimerRef.current = setTimeout(flushStreamEvents, STREAM_EVENT_FLUSH_MS);
    }
  }, [flushStreamEvents]);

  return { streamBatchRef, streamFlushTimerRef, enqueueStreamEvent, flushStreamEvents };
}
