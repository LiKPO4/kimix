import type { RoomAgentActivity, RoomAgentActivityStatus, Session, TimelineEvent } from "@/types/ui";
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

const SIDEBAR_ACTIVE_ACTIVITY_STATUSES = new Set<RoomAgentActivityStatus>([
  "creating",
  "queued",
  "sending",
  "accepted",
  "running",
  "waiting_approval",
  "waiting_question",
]);

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

export function getNextTimelineWorkExpiryAt(events: TimelineEvent[], now = Date.now()): number | null {
  let nextExpiryAt: number | null = null;
  for (const event of events) {
    if (!isTimelineEventOpen(event)) continue;
    const expiryAt = event.timestamp + STALE_TIMELINE_WORK_MS;
    if (expiryAt <= now) continue;
    if (nextExpiryAt === null || expiryAt < nextExpiryAt) nextExpiryAt = expiryAt;
  }
  return nextExpiryAt;
}

export function isSessionRuntimeRunning(session: Session | null | undefined, runningSessionId: string | null, now = Date.now()) {
  if (!session) return false;
  const runtimeSessionId = getRuntimeSessionId(session);
  return runningSessionId === session.id ||
    Boolean(runtimeSessionId && runningSessionId === runtimeSessionId) ||
    hasActiveTimelineWork(session, now);
}

export function isSessionRuntimeTracked(session: Session | null | undefined, runningSessionId: string | null) {
  if (!session || !runningSessionId) return false;
  const runtimeSessionId = getRuntimeSessionId(session);
  return runningSessionId === session.id ||
    Boolean(runtimeSessionId && runningSessionId === runtimeSessionId);
}

interface SessionSidebarBusyOptions {
  runningSessionId: string | null;
  currentSessionId?: string;
  activities?: Iterable<RoomAgentActivity>;
  now?: number;
}

export function isSessionSidebarBusy(
  session: Session,
  {
    runningSessionId,
    currentSessionId,
    activities = [],
    now = Date.now(),
  }: SessionSidebarBusyOptions,
) {
  if (session.isLoading && session.id === currentSessionId) return true;
  if (isSessionRuntimeTracked(session, runningSessionId)) return true;

  let hasAuthoritativeActivity = false;
  for (const activity of activities) {
    if (activity.roomId !== session.id) continue;
    hasAuthoritativeActivity = true;
    if (SIDEBAR_ACTIVE_ACTIVITY_STATUSES.has(activity.status)) return true;
  }
  // Once a runtime status has been observed for this session, its terminal
  // state is authoritative. An incomplete local assistant/tool/subagent may
  // remain open to accept late stream frames, but it must not spin forever.
  if (hasAuthoritativeActivity) return false;

  // Before the first runtime status frame arrives, recent timeline work keeps
  // the row responsive. The bounded fallback expires automatically instead of
  // treating stale render residue as proof that the runtime is still active.
  return hasActiveTimelineWork(session, now);
}
