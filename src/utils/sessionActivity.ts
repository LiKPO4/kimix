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

const STALE_TIMELINE_WORK_MS = 2 * 60 * 1000;

export function isTerminalKimiCodeEngineStatus(status: KimiCodeEngineStatus | undefined) {
  return status === "completed" || status === "interrupted" || status === "error" || status === "idle";
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

export function hasActiveTimelineWorkEvents(events: TimelineEvent[], now = Date.now()) {
  return events.some((event) => isTimelineEventActive(event, now));
}

export function hasActiveTimelineWork(session: Session, now = Date.now()) {
  return hasActiveTimelineWorkEvents(session.events, now);
}

export function isSessionRuntimeRunning(session: Session | undefined, runningSessionId: string | null, now = Date.now()) {
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
  return (session.isLoading && session.id === currentSessionId) ||
    isSessionRuntimeRunning(session, runningSessionId, now);
}
