import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Project, Session, TimelineEvent } from "@/types/ui";
import { isHiddenInternalSession } from "@/utils/internalSessions";
import { sanitizePersistedEvents, settleInactiveEvents } from "./eventHelpers";

export const LOCAL_SESSIONS_KEY = "kimix_sessions";
export const LOCAL_PENDING_KEY = "kimix_pending";
export const LOCAL_ACTIVE_CONTEXT_KEY = "kimix_active_context";
export const LOCAL_ARCHIVED_SESSION_TOMBSTONES_KEY = "kimix_archived_session_tombstones";
export const LOCAL_PERSIST_DEBOUNCE_MS = 900;

export type LocalActiveContext = {
  project: Project | null;
  sessionId: string | null;
  updatedAt: number;
};

export type ArchivedSessionTombstone = {
  ids: string[];
  projectPath: string;
  title?: string;
  archivedAt: number;
};

function normalizePathForArchive(value: string | undefined) {
  return (value ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function sessionArchiveIds(session: Pick<Session, "id" | "runtimeSessionId" | "officialSessionId" | "longTask">) {
  return Array.from(new Set([
    session.id,
    session.runtimeSessionId,
    session.officialSessionId,
    session.longTask?.executorSessionId,
    session.longTask?.reviewerSessionId,
  ].filter((id): id is string => Boolean(id))));
}

export function getArchivedSessionTombstones(): ArchivedSessionTombstone[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_ARCHIVED_SESSION_TOMBSTONES_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): ArchivedSessionTombstone[] => {
      if (!item || typeof item !== "object") return [];
      const ids = Array.isArray((item as { ids?: unknown }).ids)
        ? (item as { ids: unknown[] }).ids.filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
        : [];
      const projectPath = typeof (item as { projectPath?: unknown }).projectPath === "string"
        ? (item as { projectPath: string }).projectPath
        : "";
      const archivedAt = typeof (item as { archivedAt?: unknown }).archivedAt === "number"
        ? (item as { archivedAt: number }).archivedAt
        : 0;
      if (ids.length === 0 || !projectPath || !archivedAt) return [];
      return [{
        ids,
        projectPath,
        title: typeof (item as { title?: unknown }).title === "string" ? (item as { title: string }).title : undefined,
        archivedAt,
      }];
    });
  } catch {
    return [];
  }
}

function writeArchivedSessionTombstones(tombstones: ArchivedSessionTombstone[]) {
  localStorage.setItem(LOCAL_ARCHIVED_SESSION_TOMBSTONES_KEY, JSON.stringify(tombstones.slice(-500)));
}

export function rememberArchivedSessionTombstone(session: Session) {
  const ids = sessionArchiveIds(session);
  if (ids.length === 0 || !session.projectPath) return;
  const projectPath = session.projectPath;
  const archivedAt = session.archivedAt ?? Date.now();
  const next: ArchivedSessionTombstone = {
    ids,
    projectPath,
    title: session.title,
    archivedAt,
  };
  const existing = getArchivedSessionTombstones().filter((item) => {
    if (normalizePathForArchive(item.projectPath) !== normalizePathForArchive(projectPath)) return true;
    return !item.ids.some((id) => ids.includes(id));
  });
  writeArchivedSessionTombstones([...existing, next]);
}

export function forgetArchivedSessionTombstone(session: Session) {
  const ids = sessionArchiveIds(session);
  if (ids.length === 0) return;
  writeArchivedSessionTombstones(getArchivedSessionTombstones().filter((item) => !item.ids.some((id) => ids.includes(id))));
}

export function isArchivedSessionTombstoned(ids: Array<string | undefined | null>, projectPath?: string) {
  const normalizedIds = new Set(ids.filter((id): id is string => typeof id === "string" && Boolean(id.trim())));
  if (normalizedIds.size === 0) return false;
  const normalizedProjectPath = normalizePathForArchive(projectPath);
  return getArchivedSessionTombstones().some((item) => {
    if (normalizedProjectPath && normalizePathForArchive(item.projectPath) !== normalizedProjectPath) return false;
    return item.ids.some((id) => normalizedIds.has(id));
  });
}

export function persistLocalConversationState() {
  try {
    const state = useSessionStore.getState();
    const runningSessionId = useAppStore.getState().runningSessionId;
    localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(state.sessions.map((session) => ({
      ...session,
      events: sanitizePersistedEvents(session.id === runningSessionId ? session.events : settleInactiveEvents(session.events)),
      isLoading: false,
    }))));
    localStorage.setItem(LOCAL_PENDING_KEY, JSON.stringify(state.pendingMessages));
  } catch (err) {
    console.warn("Persist local conversation state failed:", err);
  }
}

export function persistLocalActiveContext() {
  try {
    const appState = useAppStore.getState();
    const currentSession = appState.currentSession;
    const sessionId = currentSession && !currentSession.archivedAt && !isHiddenInternalSession(currentSession)
      ? currentSession.id
      : null;
    const payload: LocalActiveContext = {
      project: appState.currentProject,
      sessionId,
      updatedAt: Date.now(),
    };
    localStorage.setItem(LOCAL_ACTIVE_CONTEXT_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn("Persist local active context failed:", err);
  }
}

export function readLocalActiveContext(): LocalActiveContext | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_ACTIVE_CONTEXT_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return null;
    const project = (parsed as { project?: unknown }).project;
    const validProject = project && typeof project === "object" &&
      typeof (project as { id?: unknown }).id === "string" &&
      typeof (project as { path?: unknown }).path === "string" &&
      typeof (project as { name?: unknown }).name === "string" &&
      typeof (project as { lastOpenedAt?: unknown }).lastOpenedAt === "number"
      ? project as Project
      : null;
    const sessionId = typeof (parsed as { sessionId?: unknown }).sessionId === "string"
      ? (parsed as { sessionId: string }).sessionId
      : null;
    const updatedAt = typeof (parsed as { updatedAt?: unknown }).updatedAt === "number"
      ? (parsed as { updatedAt: number }).updatedAt
      : 0;
    return { project: validProject, sessionId, updatedAt };
  } catch {
    return null;
  }
}

export function getHiddenHandoffSessionIds(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem("kimix_hidden_handoff_sessions") ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function rememberHiddenHandoffSession(sessionId: string) {
  const ids = Array.from(new Set([...getHiddenHandoffSessionIds(), sessionId]));
  localStorage.setItem("kimix_hidden_handoff_sessions", JSON.stringify(ids.slice(-50)));
}
