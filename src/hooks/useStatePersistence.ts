import { useEffect, useRef } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import { isHiddenInternalSession } from "@/utils/internalSessions";
import {
  LOCAL_PERSIST_DEBOUNCE_MS,
  persistLocalConversationState,
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
      scheduleLocalConversationPersist();
    });

    const handleBeforeUnload = flushLocalConversationState;
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      unsubscribeSessionPersistence();
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (persistenceTimerRef.current) {
        clearTimeout(persistenceTimerRef.current);
        persistenceTimerRef.current = null;
      }
      flushLocalConversationState();
    };
  }, []);
}
