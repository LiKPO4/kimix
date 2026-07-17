import type {
  RoomAgentActivity,
  RoomAgentActivityStatus,
  RoomAgentDeliveryStatus,
  Session,
  TimelineEvent,
} from "@/types/ui";
import {
  getRoomAgentRuntimeId,
  updateRoomAgentEvents,
} from "@/utils/collaborationRooms";
import { settleFailedEvents, settleInactiveEvents } from "@/utils/eventHelpers";
import { applyRoomDeliveryRuntimeStatus } from "@/utils/roomDelivery";

export type RoomAgentControlAction = "stop" | "steer";

export interface RoomAgentControlTarget {
  roomAgentId: string;
  displayName: string;
  runtimeSessionId?: string;
  status: RoomAgentActivityStatus | RoomAgentDeliveryStatus;
  roomMessageId?: string;
  activeTurnId?: string;
}

export interface PersistedRoomAgentControlTarget extends RoomAgentControlTarget {
  roomId: string;
}

const STOPPABLE_STATUSES = new Set<RoomAgentActivityStatus | RoomAgentDeliveryStatus>([
  "accepted",
  "running",
  "waiting_approval",
  "waiting_question",
]);

const STEERABLE_STATUSES = new Set<RoomAgentActivityStatus | RoomAgentDeliveryStatus>([
  "accepted",
  "running",
]);

const RECONCILABLE_STATUSES = new Set<RoomAgentActivityStatus | RoomAgentDeliveryStatus>([
  "queued",
  "sending",
  "accepted",
  "running",
  "waiting_approval",
  "waiting_question",
  "indeterminate",
]);

function actionStatuses(action: RoomAgentControlAction) {
  return action === "stop" ? STOPPABLE_STATUSES : STEERABLE_STATUSES;
}

function latestControllableDelivery(
  session: Session,
  roomAgentId: string,
  statuses: ReadonlySet<RoomAgentActivityStatus | RoomAgentDeliveryStatus>,
) {
  for (let index = (session.collaboration?.messages.length ?? 0) - 1; index >= 0; index -= 1) {
    const message = session.collaboration?.messages[index];
    const delivery = message?.deliveries[roomAgentId];
    if (delivery && statuses.has(delivery.status)) {
      return { message, delivery };
    }
  }
  return null;
}

function getRoomAgentTargets(
  session: Session,
  activities: Iterable<RoomAgentActivity>,
  statuses: ReadonlySet<RoomAgentActivityStatus | RoomAgentDeliveryStatus>,
  fallbackWhenActivityDoesNotMatch = false,
): RoomAgentControlTarget[] {
  if (!session.collaboration) return [];
  const activitiesByAgent = new Map<string, RoomAgentActivity>();
  for (const activity of activities) {
    if (activity.roomId === session.id) activitiesByAgent.set(activity.roomAgentId, activity);
  }

  return session.collaboration.agents.flatMap((agent): RoomAgentControlTarget[] => {
    if (agent.removedAt || agent.archivedAt) return [];
    const activity = activitiesByAgent.get(agent.id);
    const activityMatches = Boolean(activity && statuses.has(activity.status));
    const fallback = activityMatches || (activity && !fallbackWhenActivityDoesNotMatch)
      ? null
      : latestControllableDelivery(session, agent.id, statuses);
    if (!activityMatches && !fallback) return [];
    return [{
      roomAgentId: agent.id,
      displayName: agent.displayName,
      runtimeSessionId: activity?.runtimeSessionId ?? getRoomAgentRuntimeId(session, agent.id) ?? undefined,
      status: activityMatches ? activity!.status : fallback!.delivery.status,
      roomMessageId: activityMatches ? activity?.roomMessageId : fallback?.message.id,
      activeTurnId: activityMatches ? activity?.activeTurnId : fallback?.delivery.agentTurnId,
    }];
  });
}

export function getRoomAgentControlTargets(
  session: Session,
  activities: Iterable<RoomAgentActivity>,
  action: RoomAgentControlAction,
): RoomAgentControlTarget[] {
  const statuses = actionStatuses(action);
  return getRoomAgentTargets(session, activities, statuses);
}

export function getRoomAgentReconciliationTargets(
  session: Session,
  activities: Iterable<RoomAgentActivity>,
) {
  return getRoomAgentTargets(session, activities, RECONCILABLE_STATUSES, true);
}

export function getPersistedRoomAgentControlTargets(
  sessions: Session[],
  action: RoomAgentControlAction,
): PersistedRoomAgentControlTarget[] {
  return sessions.flatMap((session) => getRoomAgentControlTargets(session, [], action).map((target) => ({
    ...target,
    roomId: session.id,
  })));
}

export function resolveRoomAgentControlTarget(
  session: Session,
  activities: Iterable<RoomAgentActivity>,
  action: RoomAgentControlAction,
  roomAgentId?: string,
): RoomAgentControlTarget {
  const targets = getRoomAgentControlTargets(session, activities, action);
  const target = roomAgentId
    ? targets.find((candidate) => candidate.roomAgentId === roomAgentId)
    : targets.length === 1
      ? targets[0]
      : undefined;
  if (!target) {
    if (!roomAgentId && targets.length > 1) {
      throw new Error(`有 ${targets.length} 个 Agent 可${action === "stop" ? "停止" : "引导"}，请明确选择目标。`);
    }
    throw new Error(`当前没有可${action === "stop" ? "停止" : "引导"}的 Agent。`);
  }
  if (!target.runtimeSessionId) {
    throw new Error(`Agent“${target.displayName}”的运行会话尚未就绪。`);
  }
  return target;
}

export function appendRoomAgentSteerEvent(
  session: Session,
  target: Pick<RoomAgentControlTarget, "roomAgentId" | "roomMessageId" | "activeTurnId">,
  event: Extract<TimelineEvent, { type: "steer_message" }>,
): Session {
  return updateRoomAgentEvents(session, target.roomAgentId, (events) => [...events, {
    ...event,
    roomAgentId: target.roomAgentId,
    roomMessageId: target.roomMessageId,
    agentTurnId: target.activeTurnId,
  }]);
}

export function settleStoppedRoomAgent(
  session: Session,
  target: Pick<RoomAgentControlTarget, "roomAgentId" | "roomMessageId">,
  now = Date.now(),
): Session {
  let next = updateRoomAgentEvents(session, target.roomAgentId, (events) => settleFailedEvents(events, "当前轮已中断。", now).map((event) => {
    if (event.type === "question_request" && event.status === "pending") {
      return { ...event, status: "skipped" as const, answers: event.answers ?? {} };
    }
    if (event.type === "approval_request" && event.status === "pending") {
      return { ...event, status: "rejected" as const };
    }
    if (event.type === "steer_message" && (event.status === "sending" || event.status === "accepted")) {
      return { ...event, status: "failed" as const, error: "引导未完成，当前轮已中断。" };
    }
    return event;
  }));
  next = applyRoomDeliveryRuntimeStatus(next, target.roomMessageId, target.roomAgentId, "interrupted", now);
  return { ...next, updatedAt: now };
}

export function settleTerminalRoomAgent(
  session: Session,
  target: Pick<RoomAgentControlTarget, "roomAgentId" | "roomMessageId">,
  status: "completed" | "interrupted" | "error" | "idle",
  now = Date.now(),
): Session {
  let next = updateRoomAgentEvents(session, target.roomAgentId, (events) => settleInactiveEvents(events, now));
  next = applyRoomDeliveryRuntimeStatus(
    next,
    target.roomMessageId,
    target.roomAgentId,
    status === "idle" ? "completed" : status,
    now,
  );
  return { ...next, updatedAt: now };
}
