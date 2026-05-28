import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { TimelineEvent } from "@/types/ui";
import { settleInactiveEvents } from "./eventHelpers";

export const LOCAL_SESSIONS_KEY = "kimix_sessions";
export const LOCAL_PENDING_KEY = "kimix_pending";
export const LOCAL_PERSIST_DEBOUNCE_MS = 900;

export function persistLocalConversationState() {
  try {
    const state = useSessionStore.getState();
    const runningSessionId = useAppStore.getState().runningSessionId;
    localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(state.sessions.map((session) => ({
      ...session,
      events: session.id === runningSessionId ? session.events : settleInactiveEvents(session.events),
      isLoading: false,
    }))));
    localStorage.setItem(LOCAL_PENDING_KEY, JSON.stringify(state.pendingMessages));
  } catch (err) {
    console.warn("Persist local conversation state failed:", err);
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
