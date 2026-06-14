import { useEffect, useRef } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import { useAppStore } from "@/stores/appStore";
import { isHiddenInternalSession } from "@/utils/internalSessions";
import {
  LOCAL_PERSIST_DEBOUNCE_MS,
  forgetArchivedSessionTombstone,
  persistLocalActiveContext,
  persistLocalConversationState,
  rememberArchivedSessionTombstone,
  shouldSuppressLocalConversationPersist,
} from "@/utils/persistence";

export function useStatePersistence() {
  const persistenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conversationDirtyRef = useRef(false);
  const dirtySessionIdsRef = useRef<Set<string>>(new Set());
  const isUnloadingRef = useRef(false);
  const lastConversationPersistAtRef = useRef(Date.now());

  useEffect(() => {
    const maxPersistWaitMs = 5000;

    const clearConversationPersistTimer = () => {
      if (persistenceTimerRef.current) {
        clearTimeout(persistenceTimerRef.current);
        persistenceTimerRef.current = null;
      }
    };

    const flushLocalConversationState = () => {
      clearConversationPersistTimer();
      if (!conversationDirtyRef.current) return;
      const dirtySessionIds = Array.from(dirtySessionIdsRef.current);
      dirtySessionIdsRef.current.clear();
      conversationDirtyRef.current = false;
      lastConversationPersistAtRef.current = Date.now();
      persistLocalConversationState(dirtySessionIds);
    };

    const scheduleLocalConversationPersist = (sessionIds: string[]) => {
      conversationDirtyRef.current = true;
      sessionIds.forEach((id) => dirtySessionIdsRef.current.add(id));
      if (persistenceTimerRef.current) clearTimeout(persistenceTimerRef.current);
      const elapsedSincePersist = Date.now() - lastConversationPersistAtRef.current;
      const delay = Math.max(0, Math.min(LOCAL_PERSIST_DEBOUNCE_MS, maxPersistWaitMs - elapsedSincePersist));
      persistenceTimerRef.current = setTimeout(() => {
        persistenceTimerRef.current = null;
        const dirtySessionIds = Array.from(dirtySessionIdsRef.current);
        dirtySessionIdsRef.current.clear();
        conversationDirtyRef.current = false;
        lastConversationPersistAtRef.current = Date.now();
        persistLocalConversationState(dirtySessionIds);
      }, delay);
    };

    const unsubscribeSessionPersistence = useSessionStore.subscribe((state, prev) => {
      if (state.sessions === prev.sessions && state.pendingMessages === prev.pendingMessages) return;
      if (shouldSuppressLocalConversationPersist()) return;
      const prevById = new Map(prev.sessions.map((session) => [session.id, session]));
      const changedSessionIds = state.sessions
        .filter((session) => prevById.get(session.id) !== session)
        .map((session) => session.id);
      const visibleSessions = state.sessions.filter((session) => !isHiddenInternalSession(session));
      if (visibleSessions.length !== state.sessions.length) {
        useSessionStore.setState({ sessions: visibleSessions });
        return;
      }
      const archiveOrDeletionChanged =
        state.sessions.length !== prev.sessions.length ||
        state.sessions.some((session) => prev.sessions.find((prevSession) => prevSession.id === session.id)?.archivedAt !== session.archivedAt);
      if (archiveOrDeletionChanged) {
        conversationDirtyRef.current = true;
        changedSessionIds.forEach((id) => dirtySessionIdsRef.current.add(id));
        for (const session of state.sessions) {
          const previous = prev.sessions.find((prevSession) => prevSession.id === session.id);
          if (!previous?.archivedAt && session.archivedAt) {
            rememberArchivedSessionTombstone(session);
          } else if (previous?.archivedAt && !session.archivedAt) {
            forgetArchivedSessionTombstone(session);
          }
        }
        flushLocalConversationState();
        return;
      }
      scheduleLocalConversationPersist(changedSessionIds);
    });
    const unsubscribeActiveContextPersistence = useAppStore.subscribe((state, prev) => {
      if (state.currentProject === prev.currentProject && state.currentSession === prev.currentSession) return;
      persistLocalActiveContext();
    });

    const handleBeforeUnload = () => {
      isUnloadingRef.current = true;
      clearConversationPersistTimer();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      unsubscribeSessionPersistence();
      unsubscribeActiveContextPersistence();
      window.removeEventListener("beforeunload", handleBeforeUnload);
      clearConversationPersistTimer();
      if (!isUnloadingRef.current) flushLocalConversationState();
      persistLocalActiveContext();
    };
  }, []);
}
