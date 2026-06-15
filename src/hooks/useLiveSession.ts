import { useMemo } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import { selectSessionById } from "@/stores/selectors";
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
      () => selectSessionById(sessionId),
      [sessionId],
    ),
  );
}
