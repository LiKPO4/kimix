import type { Session } from "@/types/ui";
import { truncateSessionTitle } from "@/utils/sessionTitle";

const EMPTY_SESSION_CREATION_GRACE_MS = 5 * 60 * 1000;

export interface OfficialSessionCatalogItem {
  id: string;
  workDir: string;
  updatedAt: number;
  brief?: string;
  title?: string;
  lastPrompt?: string;
  isCustomTitle?: boolean;
  archived?: boolean;
  source?: "server" | "sdk";
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

function catalogTitle(item: OfficialSessionCatalogItem): string | undefined {
  const source = item.isCustomTitle === true
    ? item.title?.trim()
    : item.brief?.trim() || item.lastPrompt?.trim() || item.title?.trim();
  return source ? truncateSessionTitle(source) || undefined : undefined;
}

function isOfficialMirrorSession(session: Session, projectPath: string) {
  return session.engine === "kimi-code" &&
    !session.longTask &&
    !session.archivedAt &&
    normalizeProjectPath(session.projectPath) === normalizeProjectPath(projectPath) &&
    Boolean(session.officialSessionId || session.runtimeSessionId || !session.id.startsWith("local-"));
}

function officialSessionIds(session: Session) {
  return [
    session.id,
    session.officialSessionId,
    session.runtimeSessionId,
  ].filter((id): id is string => Boolean(id));
}

function isAbandonedEmptyMirror(session: Session, projectPath: string) {
  return session.engine === "kimi-code" &&
    !session.longTask &&
    !session.archivedAt &&
    normalizeProjectPath(session.projectPath) === normalizeProjectPath(projectPath) &&
    session.events.every((event) => event.type !== "user_message" && event.type !== "steer_message") &&
    Date.now() - session.createdAt >= EMPTY_SESSION_CREATION_GRACE_MS;
}

export function isUnconfirmedOfficialSessionPlaceholder(session: Session) {
  return session.engine === "kimi-code" &&
    !session.longTask &&
    !session.archivedAt &&
    !session.officialCatalogConfirmedAt &&
    Boolean(session.officialSessionId || session.runtimeSessionId || !session.id.startsWith("local-")) &&
    session.events.every((event) => event.type !== "user_message" && event.type !== "steer_message") &&
    Date.now() - session.createdAt >= EMPTY_SESSION_CREATION_GRACE_MS;
}

/**
 * Reconcile the lightweight official session catalog into Kimix's local mirror.
 * Message bodies remain lazy-loaded when the user opens a discovered session.
 */
export function reconcileOfficialSessionCatalog(
  sessions: Session[],
  officialSessions: OfficialSessionCatalogItem[],
  projectPath: string,
  options: { source?: "server" | "sdk" } = {},
): Session[] {
  const normalizedProjectPath = normalizeProjectPath(projectPath);
  const serverAuthoritative = options.source === "server" || officialSessions.some((session) => session.source === "server");
  const visibleOfficialIds = new Set(
    officialSessions
      .filter((official) => official.archived !== true && normalizeProjectPath(official.workDir || projectPath) === normalizedProjectPath)
      .map((official) => official.id)
      .filter(Boolean),
  );
  const archivedOfficialIds = new Set(
    officialSessions
      .filter((official) => official.archived === true && normalizeProjectPath(official.workDir || projectPath) === normalizedProjectPath)
      .map((official) => official.id)
      .filter(Boolean),
  );
  const catalogConfirmedAt = Date.now();
  let changed = false;
  let next = sessions;

  for (const official of officialSessions) {
    if (!official.id || normalizeProjectPath(official.workDir || projectPath) !== normalizedProjectPath) continue;
    if (official.archived === true) continue;
    const existingIndex = next.findIndex((session) => belongsToOfficialSession(session, official.id));
    if (existingIndex >= 0) {
      const existing = next[existingIndex];
      if (existing.archivedAt) continue;
      const updatedAt = Math.max(existing.updatedAt, official.updatedAt || 0);
      const officialSessionId = existing.officialSessionId ?? official.id;
      const engine = existing.engine ?? "kimi-code";
      const title = existing.titleLocked ? existing.title : catalogTitle(official) ?? existing.title;
      if (
        updatedAt === existing.updatedAt &&
        officialSessionId === existing.officialSessionId &&
        engine === existing.engine &&
        title === existing.title &&
        existing.officialCatalogConfirmedAt
      ) continue;
      if (next === sessions) next = [...sessions];
      next[existingIndex] = { ...existing, engine, officialSessionId, title, updatedAt, officialCatalogConfirmedAt: catalogConfirmedAt };
      changed = true;
      continue;
    }

    if (next === sessions) next = [...sessions];
    next.push({
      id: official.id,
      engine: "kimi-code",
      officialSessionId: official.id,
      officialCatalogConfirmedAt: catalogConfirmedAt,
      model: null,
      title: catalogTitle(official) ?? "新会话",
      projectPath,
      createdAt: official.updatedAt || Date.now(),
      updatedAt: official.updatedAt || Date.now(),
      events: [],
      isLoading: false,
    });
    changed = true;
  }

  if (serverAuthoritative || archivedOfficialIds.size > 0 || next.some((session) => isAbandonedEmptyMirror(session, projectPath))) {
    const archivedAt = Date.now();
    next.forEach((session, index) => {
      if (!isOfficialMirrorSession(session, projectPath)) return;
      if (officialSessionIds(session).some((id) => visibleOfficialIds.has(id))) return;
      const explicitlyArchived = officialSessionIds(session).some((id) => archivedOfficialIds.has(id));
      if (!serverAuthoritative && !explicitlyArchived && !isAbandonedEmptyMirror(session, projectPath)) return;
      if (next === sessions) next = [...sessions];
      next[index] = { ...session, archivedAt, updatedAt: Math.max(session.updatedAt, archivedAt) };
      changed = true;
    });
  }

  if (!changed) return sessions;
  return next.sort((left, right) => right.updatedAt - left.updatedAt);
}
