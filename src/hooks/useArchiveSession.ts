import { useCallback } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import { archiveSessionOfficialFirst, getRelatedArchiveSessionIds } from "@/utils/sessionArchive";
import { rememberArchivedSessionTombstone } from "@/utils/persistence";

export function useArchiveSession() {
  const archiveLocalSession = useSessionStore((state) => state.archiveSession);

  return useCallback(async (sessionId: string) => {
    const session = useSessionStore.getState().sessions.find((item) => item.id === sessionId);
    if (!session) return { success: false as const, error: "没有找到要归档的会话" };
    return archiveSessionOfficialFirst(
      session,
      (officialSessionId) => window.api.archiveKimiCodeSession({ sessionId: officialSessionId }),
      () => {
        const relatedIds = getRelatedArchiveSessionIds(useSessionStore.getState().sessions, session);
        for (const relatedId of relatedIds) archiveLocalSession(relatedId);
        for (const relatedId of relatedIds) {
          const archived = useSessionStore.getState().sessions.find((item) => item.id === relatedId);
          if (archived?.archivedAt) rememberArchivedSessionTombstone(archived);
        }
      },
    );
  }, [archiveLocalSession]);
}
