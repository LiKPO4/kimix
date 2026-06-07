import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Project, TimelineEvent } from "@/types/ui";
import { isHiddenInternalSession } from "@/utils/internalSessions";
import { sanitizePersistedEvents, settleInactiveEvents } from "./eventHelpers";

export const LOCAL_SESSIONS_KEY = "kimix_sessions";
export const LOCAL_PENDING_KEY = "kimix_pending";
export const LOCAL_ACTIVE_CONTEXT_KEY = "kimix_active_context";
export const LOCAL_PERSIST_DEBOUNCE_MS = 900;

export type LocalActiveContext = {
  project: Project | null;
  sessionId: string | null;
  updatedAt: number;
};

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
