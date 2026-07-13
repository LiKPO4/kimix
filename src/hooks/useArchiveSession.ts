import { useCallback } from "react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import {
  archiveCollaborationRoom,
  archiveSessionOfficialFirst,
  getRelatedArchiveSessionIds,
  roomHasActiveAgentWork,
} from "@/utils/sessionArchive";
import { rememberArchivedSessionTombstone } from "@/utils/persistence";

export function useArchiveSession() {
  const archiveLocalSession = useSessionStore((state) => state.archiveSession);
  const updateSession = useSessionStore((state) => state.updateSession);

  return useCallback(async (sessionId: string) => {
    const session = useSessionStore.getState().sessions.find((item) => item.id === sessionId);
    if (!session) return { success: false as const, error: "没有找到要归档的会话" };
    if (session.collaboration) {
      if (roomHasActiveAgentWork(session, Object.values(useAppStore.getState().roomAgentActivities))) {
        return { success: false as const, error: "房间仍有 Agent 在运行、排队或等待交互，暂时不能归档" };
      }
      const result = await archiveCollaborationRoom(
        session,
        (officialSessionId) => window.api.archiveKimiCodeSession({ sessionId: officialSessionId }),
      );
      updateSession(session.id, () => result.session);
      if (useAppStore.getState().currentSession?.id === session.id) {
        useAppStore.getState().setCurrentSession(result.session.archivedAt ? null : result.session);
      }
      for (const outcome of result.outcomes) {
        if (outcome.success) useAppStore.getState().removeRoomAgentActivity(session.id, outcome.roomAgentId);
      }
      if (result.success) {
        const relatedIds = getRelatedArchiveSessionIds(useSessionStore.getState().sessions, result.session);
        for (const relatedId of relatedIds) {
          if (relatedId !== session.id) archiveLocalSession(relatedId);
        }
        const archived = useSessionStore.getState().sessions.find((item) => item.id === session.id);
        if (archived?.archivedAt) rememberArchivedSessionTombstone(archived);
        return { success: true as const };
      }
      return {
        success: false as const,
        error: result.partial ? `房间仅部分归档：${result.error ?? "请重试失败的 Agent"}` : result.error ?? "房间归档失败",
      };
    }
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
  }, [archiveLocalSession, updateSession]);
}
