import type { Session, TimelineEvent } from "@/types/ui";
import type { KimiCodeEngineStatus } from "@electron/types/ipc";
import { getRuntimeSessionId } from "./runtimeSession";

const CONVERSATION_ACTIVITY_TYPES = new Set<TimelineEvent["type"]>([
  "user_message",
  "steer_message",
  "assistant_message",
]);

export function getSessionConversationActivityAt(session: Session): number {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index];
    if (CONVERSATION_ACTIVITY_TYPES.has(event.type) && Number.isFinite(event.timestamp)) {
      return event.timestamp;
    }
  }
  return session.updatedAt;
}

export function compareSessionsByRecentConversation(left: Session, right: Session): number {
  return getSessionConversationActivityAt(right) - getSessionConversationActivityAt(left) ||
    right.updatedAt - left.updatedAt ||
    right.createdAt - left.createdAt ||
    left.id.localeCompare(right.id);
}

export const STALE_TIMELINE_WORK_MS = 2 * 60 * 1000;

type TerminalKimiCodeEngineStatus = Extract<KimiCodeEngineStatus, "completed" | "interrupted" | "error" | "idle">;
type ActiveKimiCodeEngineStatus = Extract<KimiCodeEngineStatus, "running" | "waiting_approval" | "waiting_question">;

export function isTerminalKimiCodeEngineStatus(
  status: KimiCodeEngineStatus | undefined,
): status is TerminalKimiCodeEngineStatus {
  return status === "completed" || status === "interrupted" || status === "error" || status === "idle";
}

export function isActiveKimiCodeEngineStatus(
  status: KimiCodeEngineStatus | undefined,
): status is ActiveKimiCodeEngineStatus {
  return status === "running" || status === "waiting_approval" || status === "waiting_question";
}

export function isTimelineEventActive(event: TimelineEvent, now = Date.now()) {
  if (now - event.timestamp > STALE_TIMELINE_WORK_MS) return false;
  switch (event.type) {
    case "assistant_message":
      return !event.isComplete;
    case "tool_call":
      return event.status === "running";
    case "steer_message":
      return event.status === "sending" || event.status === "accepted";
    case "subagent":
      return event.status === "queued" || event.status === "running" || event.status === "suspended";
    default:
      return false;
  }
}

export function isTimelineEventOpen(event: TimelineEvent) {
  switch (event.type) {
    case "assistant_message":
      return !event.isComplete;
    case "tool_call":
      return event.status === "running";
    case "steer_message":
      return event.status === "sending" || event.status === "accepted";
    case "subagent":
      return event.status === "queued" || event.status === "running" || event.status === "suspended";
    default:
      return false;
  }
}

export function hasOpenTimelineWorkEvents(events: TimelineEvent[]) {
  return events.some(isTimelineEventOpen);
}

export function hasOpenTimelineWork(session: Session) {
  return hasOpenTimelineWorkEvents(session.events);
}

export function hasActiveTimelineWorkEvents(events: TimelineEvent[], now = Date.now()) {
  return events.some((event) => isTimelineEventActive(event, now));
}

export function hasActiveTimelineWork(session: Session, now = Date.now()) {
  return hasActiveTimelineWorkEvents(session.events, now);
}

export function isSessionRuntimeRunning(session: Session | null | undefined, runningSessionId: string | null, now = Date.now()) {
  if (!session) return false;
  const runtimeSessionId = getRuntimeSessionId(session);
  return runningSessionId === session.id ||
    Boolean(runtimeSessionId && runningSessionId === runtimeSessionId) ||
    hasActiveTimelineWork(session, now);
}

export function isSessionSidebarBusy(
  session: Session,
  runningSessionId: string | null,
  currentSessionId?: string,
  now = Date.now(),
) {
  // Sidebar spinner must stay visible for any session with open timeline work,
  // not just the single session tracked by runningSessionId. The active-work
  // check used elsewhere has a 2-minute stale timeout, which causes long turns
  // in concurrently running sessions to briefly lose their loading indicator.
  return (session.isLoading && session.id === currentSessionId) ||
    isSessionRuntimeRunning(session, runningSessionId, now) ||
    hasOpenTimelineWork(session);
}
