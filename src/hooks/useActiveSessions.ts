import { useMemo } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import type { Session } from "@/types/ui";

/**
 * Returns active (non-archived) sessions, optionally filtered to a project.
 * Automatically memoized at the selector level.
 */
export function useActiveSessions(projectPath: string | null | undefined): Session[] {
  return useSessionStore(
    useMemo(
      () => (s) => {
        if (!projectPath) return s.sessions.filter((session) => !session.archivedAt);
        return s.sessions.filter(
          (session) => !session.archivedAt && session.projectPath === projectPath,
        );
      },
      [projectPath],
    ),
  );
}
