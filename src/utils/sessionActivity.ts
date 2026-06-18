import type { Session, TimelineEvent } from "@/types/ui";
import type { KimiCodeEngineStatus } from "@electron/types/ipc";
import { getRuntimeSessionId } from "./runtimeSession";

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
