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

  useEffect(() => {
    const flushLocalConversationState = () => {
      if (persistenceTimerRef.current) {
        clearTimeout(persistenceTimerRef.current);
        persistenceTimerRef.current = null;
      }
      persistLocalConversationState();
    };

    const scheduleLocalConversationPersist = () => {
      if (persistenceTimerRef.current) clearTimeout(persistenceTimerRef.current);
      persistenceTimerRef.current = setTimeout(() => {
        persistenceTimerRef.current = null;
        persistLocalConversationState();
      }, LOCAL_PERSIST_DEBOUNCE_MS);
    };

    const unsubscribeSessionPersistence = useSessionStore.subscribe((state, prev) => {
      if (state.sessions === prev.sessions && state.pendingMessages === prev.pendingMessages) return;
      const visibleSessions = state.sessions.filter((session) => !isHiddenInternalSession(session));
      if (visibleSessions.length !== state.sessions.length) {
        useSessionStore.setState({ sessions: visibleSessions });
        return;
      }
      const archiveOrDeletionChanged =
        state.sessions.length !== prev.sessions.length ||
        state.sessions.some((session) => prev.sessions.find((prevSession) => prevSession.id === session.id)?.archivedAt !== session.archivedAt);
      if (archiveOrDeletionChanged) {
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
      scheduleLocalConversationPersist();
    });
    const unsubscribeActiveContextPersistence = useAppStore.subscribe((state, prev) => {
      if (state.currentProject === prev.currentProject && state.currentSession === prev.currentSession) return;
      persistLocalActiveContext();
    });

    const handleBeforeUnload = flushLocalConversationState;
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      unsubscribeSessionPersistence();
      unsubscribeActiveContextPersistence();
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (persistenceTimerRef.current) {
        clearTimeout(persistenceTimerRef.current);
        persistenceTimerRef.current = null;
      }
      flushLocalConversationState();
      persistLocalActiveContext();
    };
  }, []);
}
