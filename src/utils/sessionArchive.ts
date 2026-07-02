import type { Session } from "@/types/ui";
import { isKimiCodeSessionMissingError } from "./kimiCodeSessionRecovery";

export type OfficialArchiveResult = { success: true; data: void } | { success: false; error: string };

export function getOfficialArchiveSessionId(session: Session) {
  if (session.longTask?.executorSessionId) return session.longTask.executorSessionId;
  return session.runtimeSessionId ?? session.officialSessionId ?? (session.id.startsWith("local-") ? null : session.id);
}

export function getRelatedArchiveSessionIds(sessions: Session[], target: Session): string[] {
  const targetIds = new Set([
    target.id,
    target.runtimeSessionId,
    target.officialSessionId,
    target.longTask?.executorSessionId,
    target.longTask?.reviewerSessionId,
  ].filter((id): id is string => Boolean(id)));
  return sessions.filter((session) => [
    session.id,
    session.runtimeSessionId,
    session.officialSessionId,
    session.longTask?.executorSessionId,
    session.longTask?.reviewerSessionId,
  ].some((id) => Boolean(id && targetIds.has(id)))).map((session) => session.id);
}

export async function archiveSessionOfficialFirst(
  session: Session,
  archiveOfficial: (sessionId: string) => Promise<OfficialArchiveResult>,
  archiveLocal: (sessionId: string) => void,
): Promise<{ success: true } | { success: false; error: string }> {
  if (session.engine === "kimi-code") {
    const officialSessionId = getOfficialArchiveSessionId(session);
    if (!officialSessionId) return { success: false, error: "没有可归档的官方会话" };
    try {
      const result = await archiveOfficial(officialSessionId);
      if (!result.success) {
        if (isKimiCodeSessionMissingError(result.error)) {
          archiveLocal(session.id);
          return { success: true };
        }
        return result;
      }
    } catch (error) {
      if (isKimiCodeSessionMissingError(error)) {
        archiveLocal(session.id);
        return { success: true };
      }
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  archiveLocal(session.id);
  return { success: true };
}
