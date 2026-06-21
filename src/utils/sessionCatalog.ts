import type { Session } from "@/types/ui";
import { truncateSessionTitle } from "@/utils/sessionTitle";

export interface OfficialSessionCatalogItem {
  id: string;
  workDir: string;
  updatedAt: number;
  brief?: string;
}

function normalizeProjectPath(projectPath: string | undefined) {
  return (projectPath ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function belongsToOfficialSession(session: Session, officialId: string) {
  return session.id === officialId ||
    session.officialSessionId === officialId ||
    session.runtimeSessionId === officialId ||
    session.longTask?.executorSessionId === officialId ||
    session.longTask?.reviewerSessionId === officialId;
}

function catalogTitle(item: OfficialSessionCatalogItem) {
  return truncateSessionTitle(item.brief?.trim() || "新会话") || "新会话";
}

/**
 * Reconcile the lightweight official session catalog into Kimix's local mirror.
 * Message bodies remain lazy-loaded when the user opens a discovered session.
 */
export function reconcileOfficialSessionCatalog(
  sessions: Session[],
  officialSessions: OfficialSessionCatalogItem[],
  projectPath: string,
): Session[] {
  const normalizedProjectPath = normalizeProjectPath(projectPath);
  let changed = false;
  let next = sessions;

  for (const official of officialSessions) {
    if (!official.id || normalizeProjectPath(official.workDir || projectPath) !== normalizedProjectPath) continue;
    const existingIndex = next.findIndex((session) => belongsToOfficialSession(session, official.id));
    if (existingIndex >= 0) {
      const existing = next[existingIndex];
      if (existing.archivedAt) continue;
      const updatedAt = Math.max(existing.updatedAt, official.updatedAt || 0);
      const officialSessionId = existing.officialSessionId ?? official.id;
      const engine = existing.engine ?? "kimi-code";
      if (updatedAt === existing.updatedAt && officialSessionId === existing.officialSessionId && engine === existing.engine) continue;
      if (next === sessions) next = [...sessions];
      next[existingIndex] = { ...existing, engine, officialSessionId, updatedAt };
      changed = true;
      continue;
    }

    if (next === sessions) next = [...sessions];
    next.push({
      id: official.id,
      engine: "kimi-code",
      officialSessionId: official.id,
      model: null,
      title: catalogTitle(official),
      projectPath,
      createdAt: official.updatedAt || Date.now(),
      updatedAt: official.updatedAt || Date.now(),
      events: [],
      isLoading: false,
    });
    changed = true;
  }

  if (!changed) return sessions;
  return next.sort((left, right) => right.updatedAt - left.updatedAt);
}
