import { useEffect, useRef } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import { useAppStore } from "@/stores/appStore";
import { isHiddenInternalSession } from "@/utils/internalSessions";
import {
  forgetArchivedSessionTombstone,
  persistLocalActiveContext,
  persistLocalConversationState,
  rememberArchivedSessionTombstone,
  resolvePersistDelayMs,
} from "@/utils/persistence";

export function useStatePersistence(activeContextReady = true) {
  const persistenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conversationDirtyRef = useRef(false);
  const isUnloadingRef = useRef(false);
  const lastConversationPersistAtRef = useRef(Date.now());
  const activeContextReadyRef = useRef(activeContextReady);

  useEffect(() => {
    const becameReady = !activeContextReadyRef.current && activeContextReady;
    activeContextReadyRef.current = activeContextReady;
    if (becameReady) persistLocalActiveContext();
  }, [activeContextReady]);

  useEffect(() => {
    const STREAMING_ACTIVITY_STATUSES = new Set(["creating", "queued", "sending", "accepted", "running", "waiting_approval", "waiting_question"]);
    const hasActiveStreamingWork = () => {
      const appState = useAppStore.getState();
      if (appState.runningSessionId) return true;
      return Object.values(appState.roomAgentActivities).some((activity) => STREAMING_ACTIVITY_STATUSES.has(activity.status));
    };

    const clearConversationPersistTimer = () => {
      if (persistenceTimerRef.current) {
        clearTimeout(persistenceTimerRef.current);
        persistenceTimerRef.current = null;
      }
    };

    const flushLocalConversationState = async () => {
      clearConversationPersistTimer();
      if (!conversationDirtyRef.current) return;
      conversationDirtyRef.current = false;
      lastConversationPersistAtRef.current = Date.now();
      await persistLocalConversationState();
    };

    const scheduleLocalConversationPersist = () => {
      conversationDirtyRef.current = true;
      if (persistenceTimerRef.current) clearTimeout(persistenceTimerRef.current);
      const elapsedSincePersist = Date.now() - lastConversationPersistAtRef.current;
      const delay = resolvePersistDelayMs({ streaming: hasActiveStreamingWork(), elapsedSincePersistMs: elapsedSincePersist });
      persistenceTimerRef.current = setTimeout(() => {
        persistenceTimerRef.current = null;
        conversationDirtyRef.current = false;
        lastConversationPersistAtRef.current = Date.now();
        void persistLocalConversationState();
      }, delay);
    };

    const unsubscribeSessionPersistence = useSessionStore.subscribe((state, prev) => {
      if (state.sessions === prev.sessions && state.pendingMessages === prev.pendingMessages) return;
      const visibleSessions = state.sessions.filter((session) => !isHiddenInternalSession(session));
      if (visibleSessions.length !== state.sessions.length) {
        useSessionStore.setState({ sessions: visibleSessions });
        return;
      }
      const previousSessionsById = new Map(prev.sessions.map((session) => [session.id, session]));
      const archiveOrDeletionChanged =
        state.sessions.length !== prev.sessions.length ||
        state.sessions.some((session) => previousSessionsById.get(session.id)?.archivedAt !== session.archivedAt);
      if (archiveOrDeletionChanged) {
        conversationDirtyRef.current = true;
        for (const session of state.sessions) {
          const previous = previousSessionsById.get(session.id);
          if (!previous?.archivedAt && session.archivedAt) {
            rememberArchivedSessionTombstone(session);
          } else if (previous?.archivedAt && !session.archivedAt) {
            forgetArchivedSessionTombstone(session);
          }
        }
        void flushLocalConversationState();
        return;
      }
      scheduleLocalConversationPersist();
    });
    const unsubscribeActiveContextPersistence = useAppStore.subscribe((state, prev) => {
      if (state.currentProject === prev.currentProject && state.currentSession === prev.currentSession) return;
      if (!activeContextReadyRef.current) return;
      persistLocalActiveContext();
    });
    // Streaming stretches the persist cadence to once per minute; flush as
    // soon as the running turn ends so the wider durability window closes.
    const unsubscribeStreamingEndPersistence = useAppStore.subscribe((state, prev) => {
      if (prev.runningSessionId && !state.runningSessionId) {
        void flushLocalConversationState();
      }
    });

    const handleBeforeUnload = () => {
      isUnloadingRef.current = true;
      clearConversationPersistTimer();
      // beforeunload 是同步事件，无法等待异步 IndexedDB 写入完成。
      // 串行化队列在平时已尽量保证最新状态落地，此处仅作最后尝试。
      void persistLocalConversationState();
      if (activeContextReadyRef.current) persistLocalActiveContext();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void flushLocalConversationState();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      unsubscribeSessionPersistence();
      unsubscribeActiveContextPersistence();
      unsubscribeStreamingEndPersistence();
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearConversationPersistTimer();
      if (!isUnloadingRef.current) void flushLocalConversationState();
    };
  }, []);
}
