import { useRef, useCallback } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import { mergeEvents } from "@/utils/eventMapper";
import { deriveSessionTitle } from "@/utils/sessionTitle";
import { getLastUsedModelFromEventsAfter } from "@/utils/modelDisplay";
import type { TimelineEvent } from "@/types/ui";

const STREAM_EVENT_FLUSH_MS = 80;

export function useEventStream() {
  const streamBatchRef = useRef<Map<string, TimelineEvent[]>>(new Map());
  const streamFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateSession = useSessionStore((s) => s.updateSession);

  const flushStreamEvents = useCallback(() => {
    streamFlushTimerRef.current = null;
    const batches = streamBatchRef.current;
    if (batches.size === 0) return;
    streamBatchRef.current = new Map();
    batches.forEach((items, uiSessionId) => {
      updateSession(uiSessionId, (session) => {
        let events = session.events;
        for (const item of items) {
          events = mergeEvents(events, item);
        }
        const title = session.titleLocked ? session.title : deriveSessionTitle(events, session.title);
        const lastUsedModel = getLastUsedModelFromEventsAfter(events, session.modelSwitchedAt);
        return {
          ...session,
          events,
          title,
          updatedAt: Date.now(),
          ...(lastUsedModel ? { model: lastUsedModel } : {}),
        };
      });
    });
  }, [updateSession]);

  const enqueueStreamEvent = useCallback((uiSessionId: string, event: TimelineEvent) => {
    const current = streamBatchRef.current.get(uiSessionId) ?? [];
    current.push(event);
    streamBatchRef.current.set(uiSessionId, current);
    if (!streamFlushTimerRef.current) {
      streamFlushTimerRef.current = setTimeout(flushStreamEvents, STREAM_EVENT_FLUSH_MS);
    }
  }, [flushStreamEvents]);

  return { streamBatchRef, streamFlushTimerRef, enqueueStreamEvent, flushStreamEvents };
}
