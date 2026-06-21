import { useCallback } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import { archiveSessionOfficialFirst } from "@/utils/sessionArchive";

export function useArchiveSession() {
  const archiveLocalSession = useSessionStore((state) => state.archiveSession);

  return useCallback(async (sessionId: string) => {
    const session = useSessionStore.getState().sessions.find((item) => item.id === sessionId);
    if (!session) return { success: false as const, error: "没有找到要归档的会话" };
    return archiveSessionOfficialFirst(
      session,
      (officialSessionId) => window.api.archiveKimiCodeSession({ sessionId: officialSessionId }),
      archiveLocalSession,
    );
  }, [archiveLocalSession]);
}
