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
} from "@/utils/persistence";

export function useStatePersistence() {
  const persistenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conversationDirtyRef = useRef(false);
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
      conversationDirtyRef.current = false;
      lastConversationPersistAtRef.current = Date.now();
      persistLocalConversationState();
    };

    const scheduleLocalConversationPersist = () => {
      conversationDirtyRef.current = true;
      if (persistenceTimerRef.current) clearTimeout(persistenceTimerRef.current);
      const elapsedSincePersist = Date.now() - lastConversationPersistAtRef.current;
      const delay = Math.max(0, Math.min(LOCAL_PERSIST_DEBOUNCE_MS, maxPersistWaitMs - elapsedSincePersist));
      persistenceTimerRef.current = setTimeout(() => {
        persistenceTimerRef.current = null;
        conversationDirtyRef.current = false;
        lastConversationPersistAtRef.current = Date.now();
        persistLocalConversationState();
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
        flushLocalConversationState();
        return;
      }
      scheduleLocalConversationPersist();
    });
    const unsubscribeActiveContextPersistence = useAppStore.subscribe((state, prev) => {
      if (state.currentProject === prev.currentProject && state.currentSession === prev.currentSession) return;
      persistLocalActiveContext();
    });

    const handleBeforeUnload = () => {
      isUnloadingRef.current = true;
      clearConversationPersistTimer();
      persistLocalConversationState();
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
