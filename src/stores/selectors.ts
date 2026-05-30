import type { AppStore } from "./appStore";
import type { SessionStore } from "./sessionStore";
import type { Session } from "@/types/ui";

// ── AppStore selectors ──

/** Stable reference to all default settings that affect prompt sending */
export const selectDefaultSettings = (s: AppStore) => ({
  thinking: s.defaultThinking,
  planMode: s.defaultPlanMode,
  permissionMode: s.permissionMode,
});

/** Right-panel open states */
export const selectLongTaskPanelOpen = (s: AppStore) => ({
  inspector: s.longTaskInspectorOpen,
  diff: s.diffPanelOpen,
});

/** Current session id only (prevents re-renders when session object mutates) */
export const selectCurrentSessionId = (s: AppStore) => s.currentSession?.id ?? null;

/** Current project path only */
export const selectCurrentProjectPath = (s: AppStore) => s.currentProject?.path ?? null;

// ── SessionStore selectors ──

/** Curried selector: find a session by id from the sessions array */
export const selectSessionById = (id: string | null | undefined) => (s: SessionStore): Session | undefined => {
  if (!id) return undefined;
  return s.sessions.find((session) => session.id === id);
};

/** Curried selector: active (non-archived) sessions for a given project path */
export const selectActiveSessionsForProject = (path: string | null | undefined) => (s: SessionStore): Session[] => {
  if (!path) return s.sessions.filter((session) => !session.archivedAt);
  return s.sessions.filter((session) => !session.archivedAt && session.projectPath === path);
};

/** Selector: all non-archived sessions */
export const selectActiveSessions = (s: SessionStore): Session[] =>
  s.sessions.filter((session) => !session.archivedAt);
