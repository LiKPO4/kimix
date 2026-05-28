import { useMemo } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import type { Session } from "@/types/ui";

/**
 * Returns the "live" session object from the sessions array that matches the
 * given session id. This is needed because the `currentSession` reference in
 * AppStore can become stale when SessionStore mutations create new session
 * objects.
 */
export function useLiveSession(sessionId: string | null | undefined): Session | undefined {
  return useSessionStore(
    useMemo(
      () => (s) => {
        if (!sessionId) return undefined;
        return s.sessions.find((session) => session.id === sessionId);
      },
      [sessionId],
    ),
  );
}
