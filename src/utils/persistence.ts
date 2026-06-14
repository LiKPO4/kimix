import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Project, Session, TimelineEvent } from "@/types/ui";
import { isHiddenInternalSession } from "@/utils/internalSessions";
import { sanitizePersistedEvents, settleInactiveEvents } from "./eventHelpers";

export const LOCAL_SESSIONS_KEY = "kimix_sessions";
export const LOCAL_PENDING_KEY = "kimix_pending";
export const LOCAL_ACTIVE_CONTEXT_KEY = "kimix_active_context";
export const LOCAL_ARCHIVED_SESSION_TOMBSTONES_KEY = "kimix_archived_session_tombstones";
export const LOCAL_SESSION_STATE_UPDATED_AT_KEY = "kimix_session_state_updated_at";
export const LOCAL_PERSIST_DEBOUNCE_MS = 3500;

export type MainSessionPersistenceState = {
  updatedAt: number;
  sessions: unknown[];
  pendingMessages: unknown[];
  activeContext: unknown;
  archivedTombstones: unknown[];
  hiddenHandoffSessionIds: string[];
};

let sessionPersistenceInitialized = false;
let pushSessionStateTimer: ReturnType<typeof setTimeout> | null = null;
let pushActiveContextTimer: ReturnType<typeof setTimeout> | null = null;
let suppressLocalConversationPersistUntil = 0;
let queuedSessionStateForMain: MainSessionPersistenceState | null = null;

function getRecordNumber(value: unknown, key: string) {
  return value && typeof value === "object" && typeof (value as Record<string, unknown>)[key] === "number"
    ? (value as Record<string, number>)[key]
    : 0;
}

function getRecordString(value: unknown, key: string) {
  return value && typeof value === "object" && typeof (value as Record<string, unknown>)[key] === "string"
    ? (value as Record<string, string>)[key]
    : "";
}

function eventCount(value: unknown) {
  return value && typeof value === "object" && Array.isArray((value as { events?: unknown }).events)
    ? (value as { events: unknown[] }).events.length
    : 0;
}

function pickRicherRecord(current: unknown, incoming: unknown) {
  const incomingUpdatedAt = getRecordNumber(incoming, "updatedAt");
  const currentUpdatedAt = getRecordNumber(current, "updatedAt");
  const incomingEvents = eventCount(incoming);
  const currentEvents = eventCount(current);
  if (incomingEvents > currentEvents) return incoming;
  if (incomingEvents < currentEvents) return current;
  return incomingUpdatedAt >= currentUpdatedAt ? incoming : current;
}

function mergeObjectArraysById(left: unknown[], right: unknown[]) {
  const byId = new Map<string, unknown>();
  const append = (item: unknown) => {
    const id = getRecordString(item, "id");
    if (!id) return;
    const existing = byId.get(id);
    byId.set(id, existing ? pickRicherRecord(existing, item) : item);
  };
  left.forEach(append);
  right.forEach(append);
  return Array.from(byId.values()).sort((a, b) => getRecordNumber(b, "updatedAt") - getRecordNumber(a, "updatedAt"));
}

function mergeStringArrays(left: string[], right: string[]) {
  return Array.from(new Set([...left, ...right].filter(Boolean))).slice(-1000);
}

function stateCollectionSignature(items: unknown[]) {
  return items.map((item) => {
    const id = getRecordString(item, "id");
    const updatedAt = getRecordNumber(item, "updatedAt");
    const archivedAt = getRecordNumber(item, "archivedAt");
    return `${id}:${updatedAt}:${archivedAt}:${eventCount(item)}`;
  }).join("|");
}

function shallowStateSignature(state: MainSessionPersistenceState) {
  const activeUpdatedAt = getRecordNumber(state.activeContext, "updatedAt");
  return [
    stateCollectionSignature(state.sessions),
    stateCollectionSignature(state.pendingMessages),
    activeUpdatedAt,
    stateCollectionSignature(state.archivedTombstones),
    state.hiddenHandoffSessionIds.join("|"),
  ].join("\n");
}

function normalizeLocalState(value: Partial<MainSessionPersistenceState>): MainSessionPersistenceState {
  return {
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
    sessions: Array.isArray(value.sessions) ? value.sessions : [],
    pendingMessages: Array.isArray(value.pendingMessages) ? value.pendingMessages : [],
    activeContext: value.activeContext ?? null,
    archivedTombstones: Array.isArray(value.archivedTombstones) ? value.archivedTombstones : [],
    hiddenHandoffSessionIds: Array.isArray(value.hiddenHandoffSessionIds)
      ? value.hiddenHandoffSessionIds.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function mergeSessionPersistenceStates(mainState: MainSessionPersistenceState, localState: MainSessionPersistenceState): MainSessionPersistenceState {
  const mainActiveUpdatedAt = getRecordNumber(mainState.activeContext, "updatedAt");
  const localActiveUpdatedAt = getRecordNumber(localState.activeContext, "updatedAt");
  return {
    updatedAt: Math.max(mainState.updatedAt, localState.updatedAt, Date.now()),
    sessions: mergeObjectArraysById(mainState.sessions, localState.sessions),
    pendingMessages: mergeObjectArraysById(mainState.pendingMessages, localState.pendingMessages),
    activeContext: localActiveUpdatedAt >= mainActiveUpdatedAt ? localState.activeContext : mainState.activeContext,
    archivedTombstones: mergeObjectArraysById(mainState.archivedTombstones, localState.archivedTombstones),
    hiddenHandoffSessionIds: mergeStringArrays(mainState.hiddenHandoffSessionIds, localState.hiddenHandoffSessionIds),
  };
}

function writeLocalSessionState(state: MainSessionPersistenceState) {
  const totalEvents = state.sessions.reduce((sum, session) => sum + eventCount(session), 0);
  if (totalEvents <= 500) {
    localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(state.sessions));
  } else {
    localStorage.removeItem(LOCAL_SESSIONS_KEY);
  }
  localStorage.setItem(LOCAL_PENDING_KEY, JSON.stringify(state.pendingMessages));
  localStorage.setItem(LOCAL_ACTIVE_CONTEXT_KEY, JSON.stringify(state.activeContext));
  localStorage.setItem(LOCAL_ARCHIVED_SESSION_TOMBSTONES_KEY, JSON.stringify(state.archivedTombstones));
  localStorage.setItem("kimix_hidden_handoff_sessions", JSON.stringify(state.hiddenHandoffSessionIds));
  localStorage.setItem(LOCAL_SESSION_STATE_UPDATED_AT_KEY, String(state.updatedAt));
}

export function suppressNextLocalConversationPersist(ms = 1800) {
  suppressLocalConversationPersistUntil = Math.max(suppressLocalConversationPersistUntil, Date.now() + ms);
}

export function shouldSuppressLocalConversationPersist() {
  return Date.now() < suppressLocalConversationPersistUntil;
}

function safeParse<T>(raw: string | null, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function readLocalSessionStateForPush(): MainSessionPersistenceState {
  return {
    updatedAt: Date.now(),
    sessions: safeParse<unknown[]>(localStorage.getItem(LOCAL_SESSIONS_KEY), []),
    pendingMessages: safeParse<unknown[]>(localStorage.getItem(LOCAL_PENDING_KEY), []),
    activeContext: safeParse<unknown>(localStorage.getItem(LOCAL_ACTIVE_CONTEXT_KEY), null),
    archivedTombstones: safeParse<unknown[]>(localStorage.getItem(LOCAL_ARCHIVED_SESSION_TOMBSTONES_KEY), []),
    hiddenHandoffSessionIds: safeParse<string[]>(localStorage.getItem("kimix_hidden_handoff_sessions"), []),
  };
}

export async function pushSessionStateToMain(stateOverride?: MainSessionPersistenceState): Promise<void> {
  if (typeof window === "undefined" || !window.api?.setSessionPersistence) return;
  try {
    const localState = normalizeLocalState(stateOverride ?? readLocalSessionStateForPush());
    const mainRes = window.api.getSessionPersistence ? await window.api.getSessionPersistence() : null;
    const state = mainRes?.success
      ? mergeSessionPersistenceStates(mainRes.data, localState)
      : localState;
    const res = await window.api.setSessionPersistence(state);
    if (res.success) {
      writeLocalSessionState(state);
    }
  } catch (err) {
    console.warn("Push session state to main failed:", err);
  }
}

export function schedulePushSessionStateToMain(state?: MainSessionPersistenceState): void {
  if (!sessionPersistenceInitialized) return;
  if (state) {
    queuedSessionStateForMain = queuedSessionStateForMain
      ? mergeSessionPersistenceStates(queuedSessionStateForMain, state)
      : normalizeLocalState(state);
  }
  if (pushSessionStateTimer) clearTimeout(pushSessionStateTimer);
  pushSessionStateTimer = setTimeout(() => {
    pushSessionStateTimer = null;
    const queued = queuedSessionStateForMain;
    queuedSessionStateForMain = null;
    void pushSessionStateToMain(queued ?? undefined);
  }, 500);
}

async function pushActiveContextToMain(): Promise<void> {
  if (typeof window === "undefined" || !window.api?.setSessionPersistence) return;
  try {
    const activeContext = safeParse<unknown>(localStorage.getItem(LOCAL_ACTIVE_CONTEXT_KEY), null);
    await window.api.setSessionPersistence({
      updatedAt: Date.now(),
      sessions: [],
      pendingMessages: [],
      activeContext,
      archivedTombstones: [],
      hiddenHandoffSessionIds: [],
    });
  } catch (err) {
    console.warn("Push active session context to main failed:", err);
  }
}

export function schedulePushActiveContextToMain(): void {
  // Keep active context in localStorage only. Writing it into the shared session
  // state rewrites the large session JSON and causes a visible pause on selection.
  if (pushActiveContextTimer) clearTimeout(pushActiveContextTimer);
  pushActiveContextTimer = null;
}

async function pullSessionStateFromMainInternal(): Promise<{ changed: boolean; state: MainSessionPersistenceState | null }> {
  if (typeof window === "undefined" || !window.api?.getSessionPersistence) {
    sessionPersistenceInitialized = true;
    return { changed: false, state: null };
  }
  try {
    const usesSummary = Boolean(window.api.getSessionPersistenceSummary);
    const res = usesSummary
      ? await window.api.getSessionPersistenceSummary()
      : await window.api.getSessionPersistence();
    sessionPersistenceInitialized = true;
    if (!res.success) return { changed: false, state: null };

    const mainState = normalizeLocalState(res.data);
    const localState = normalizeLocalState({
      ...readLocalSessionStateForPush(),
      updatedAt: Number(localStorage.getItem(LOCAL_SESSION_STATE_UPDATED_AT_KEY) || "0"),
    });
    const mergedState = mergeSessionPersistenceStates(mainState, localState);
    const changed = shallowStateSignature(mergedState) !== shallowStateSignature(localState);

    if (changed) {
      suppressNextLocalConversationPersist();
      writeLocalSessionState(mergedState);
      if (!usesSummary) await window.api.setSessionPersistence(mergedState);
      return { changed: true, state: mergedState };
    }

    if (!usesSummary && mainState.updatedAt < mergedState.updatedAt) {
      await window.api.setSessionPersistence(mergedState);
    }
    return { changed: false, state: mergedState };
  } catch (err) {
    console.warn("Pull session state from main failed:", err);
    sessionPersistenceInitialized = true;
    return { changed: false, state: null };
  }
}

export async function pullSessionStateFromMain(): Promise<boolean> {
  return (await pullSessionStateFromMainInternal()).changed;
}

export async function pullSessionStateSnapshotFromMain(): Promise<MainSessionPersistenceState | null> {
  return (await pullSessionStateFromMainInternal()).state;
}

export async function loadPersistedSessionFromMain<T = unknown>(id: string): Promise<T | null> {
  if (typeof window === "undefined" || !window.api?.getPersistedSession) return null;
  try {
    const res = await window.api.getPersistedSession({ id });
    return res.success ? (res.data as T | null) : null;
  } catch (err) {
    console.warn("Load persisted session from main failed:", err);
    return null;
  }
}

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

export function resetStaleSessionRecommendationEvents(events: TimelineEvent[]) {
  let changed = false;
  const nextEvents = events.map((event) => {
    if (event.type !== "session_recommendation" || event.handoffStatus !== "running") return event;
    changed = true;
    const { handoffStatus: _handoffStatus, handoffError: _handoffError, ...rest } = event;
    return rest;
  });
  return changed ? nextEvents : events;
}

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
  schedulePushSessionStateToMain();
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

function serializeSessionForPersistence(session: Session, runningSessionId: string | null) {
  return {
    ...session,
    events: resetStaleSessionRecommendationEvents(sanitizePersistedEvents(session.id === runningSessionId ? session.events : settleInactiveEvents(session.events))),
    isLoading: false,
  };
}

export function persistLocalConversationState(sessionIds?: Iterable<string>) {
  try {
    const state = useSessionStore.getState();
    const runningSessionId = useAppStore.getState().runningSessionId;
    const selectedIds = sessionIds ? new Set(sessionIds) : null;
    const sessions = selectedIds
      ? state.sessions.filter((session) => selectedIds.has(session.id))
      : state.sessions;
    const serializedSessions = sessions.map((session) => serializeSessionForPersistence(session, runningSessionId));
    if (!selectedIds && serializedSessions.reduce((sum, session) => sum + eventCount(session), 0) <= 500) {
      localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(serializedSessions));
    } else if (!selectedIds) {
      localStorage.removeItem(LOCAL_SESSIONS_KEY);
    }
    localStorage.setItem(LOCAL_PENDING_KEY, JSON.stringify(state.pendingMessages));
    schedulePushSessionStateToMain({
      updatedAt: Date.now(),
      sessions: serializedSessions,
      pendingMessages: state.pendingMessages,
      activeContext: safeParse<unknown>(localStorage.getItem(LOCAL_ACTIVE_CONTEXT_KEY), null),
      archivedTombstones: getArchivedSessionTombstones(),
      hiddenHandoffSessionIds: getHiddenHandoffSessionIds(),
    });
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
    schedulePushActiveContextToMain();
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
  schedulePushSessionStateToMain();
}
