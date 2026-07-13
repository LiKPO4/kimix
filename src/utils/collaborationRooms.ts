import type {
  CollaborationState,
  PermissionMode,
  RoomAgent,
  RoomAgentDeliveryStatus,
  RoomUserMessage,
  Session,
  TimelineEvent,
} from "@/types/ui";

export const COLLABORATION_ROOMS_DEV_ENABLED = false;
export const COLLABORATION_ROOM_SCHEMA_VERSION = 1 as const;
export const MAX_ROOM_AGENTS = 4;

export interface RoomRuntimeOwner {
  roomId: string;
  roomAgentId: string;
  session: Session;
  agent: RoomAgent;
}

export function getSyntheticPrimaryAgentId(sessionId: string): string {
  return `room-agent:${sessionId}`;
}

function compactAgentName(model: string | null | undefined): string {
  const normalized = model?.trim();
  if (!normalized) return "Kimi";
  const parts = normalized.split("/");
  return parts[parts.length - 1]?.trim() || "Kimi";
}

export function createSyntheticPrimaryAgent(
  session: Session,
  permissionMode: PermissionMode = "manual",
): RoomAgent {
  const displayName = compactAgentName(session.model);
  return {
    id: getSyntheticPrimaryAgentId(session.id),
    displayName,
    mentionName: displayName.replace(/\s+/g, "-") || "Kimi",
    modelAlias: session.model ?? null,
    permissionMode,
    runtimeSessionId: session.runtimeSessionId,
    officialSessionId: session.officialSessionId,
    skillRegistrySyncedAt: session.skillRegistrySyncedAt,
    skillForkParentSessionId: session.skillForkParentSessionId,
    kimiHistoryCacheVersion: session.kimiHistoryCacheVersion,
    officialCatalogConfirmedAt: session.officialCatalogConfirmedAt,
    swarmModeLockedAt: session.swarmModeLockedAt,
    swarmMode: session.swarmMode,
    swarmModeDesired: session.swarmModeDesired,
    modelSwitchedAt: session.modelSwitchedAt,
    switchedToModel: session.switchedToModel,
    officialGoal: session.officialGoal,
    btwRounds: session.btwRounds,
    createdAt: session.createdAt,
  };
}

export function getRoomAgents(
  session: Session,
  permissionMode: PermissionMode = "manual",
): RoomAgent[] {
  if (session.collaboration?.agents.length) return session.collaboration.agents;
  return [createSyntheticPrimaryAgent(session, permissionMode)];
}

export function getPrimaryRoomAgent(
  session: Session,
  permissionMode: PermissionMode = "manual",
): RoomAgent {
  const agents = getRoomAgents(session, permissionMode);
  const primaryId = session.collaboration?.primaryAgentId;
  return agents.find((agent) => agent.id === primaryId) ?? agents[0];
}

export function getRoomAgent(
  session: Session,
  roomAgentId: string,
  permissionMode: PermissionMode = "manual",
): RoomAgent | null {
  return getRoomAgents(session, permissionMode).find((agent) => agent.id === roomAgentId) ?? null;
}

export function hasMultipleRoomAgents(session: Session): boolean {
  return (session.collaboration?.agents.filter((agent) => !agent.removedAt).length ?? 0) > 1;
}

export function getRoomAgentRuntimeId(session: Session, roomAgentId: string): string | null {
  const agent = getRoomAgent(session, roomAgentId);
  if (!agent) return null;
  if (agent.runtimeSessionId) return agent.runtimeSessionId;
  if (agent.officialSessionId) return agent.officialSessionId;
  const primary = getPrimaryRoomAgent(session);
  return primary.id === agent.id ? session.runtimeSessionId ?? session.id : null;
}

export function getEventRoomAgentId(session: Session, event: TimelineEvent): string {
  return event.roomAgentId ?? getPrimaryRoomAgent(session).id;
}

export function scopeEventToRoomAgent<T extends TimelineEvent>(
  event: T,
  roomAgentId: string,
): T {
  if (event.roomAgentId === roomAgentId) return event;
  return { ...event, roomAgentId };
}

export function resolveRoomRuntimeOwner(
  sessions: Session[],
  runtimeSessionId: string,
  officialSessionId?: string | null,
): RoomRuntimeOwner | null {
  const identities = new Set(
    [runtimeSessionId, officialSessionId ?? undefined].filter((value): value is string => Boolean(value)),
  );

  for (const session of sessions) {
    if (session.archivedAt || session.longTask) continue;
    const agents = getRoomAgents(session);
    for (const agent of agents) {
      const matchesAgent = identities.has(agent.id)
        || Boolean(agent.runtimeSessionId && identities.has(agent.runtimeSessionId))
        || Boolean(agent.officialSessionId && identities.has(agent.officialSessionId));
      const primary = getPrimaryRoomAgent(session);
      const matchesLegacyPrimary = primary.id === agent.id && (
        identities.has(session.id)
        || Boolean(session.runtimeSessionId && identities.has(session.runtimeSessionId))
        || Boolean(session.officialSessionId && identities.has(session.officialSessionId))
      );
      if (!matchesAgent && !matchesLegacyPrimary) continue;
      return {
        roomId: session.id,
        roomAgentId: agent.id,
        session,
        agent,
      };
    }
  }
  return null;
}

function inferDeliveryStatus(events: TimelineEvent[], userEventIndex: number): RoomAgentDeliveryStatus {
  const nextUserIndex = events.findIndex((event, index) => index > userEventIndex && event.type === "user_message");
  const upperBound = nextUserIndex < 0 ? events.length : nextUserIndex;
  const turnEvents = events.slice(userEventIndex + 1, upperBound);
  if (turnEvents.some((event) => event.type === "approval_request" && event.status === "pending")) return "waiting_approval";
  if (turnEvents.some((event) => event.type === "question_request" && event.status === "pending")) return "waiting_question";
  if (turnEvents.some((event) => event.type === "error")) return "failed";
  if (turnEvents.some((event) => event.type === "assistant_message" && !event.isComplete)) return "running";
  if (turnEvents.some((event) => event.type === "assistant_message" && event.isComplete)) return "completed";
  return "accepted";
}

function createLegacyRoomMessages(session: Session, primaryAgentId: string): RoomUserMessage[] {
  return session.events.flatMap((event, index) => {
    if (event.type !== "user_message") return [];
    const roomMessageId = event.roomMessageId ?? `room-message:${event.id}`;
    const agentTurnId = event.agentTurnId ?? `agent-turn:${primaryAgentId}:${event.id}`;
    return [{
      id: roomMessageId,
      content: event.content,
      images: event.images,
      recipientAgentIds: [primaryAgentId],
      deliveries: {
        [primaryAgentId]: {
          status: inferDeliveryStatus(session.events, index),
          agentTurnId,
          officialUserEventId: event.id,
        },
      },
      timestamp: event.timestamp,
    }];
  });
}

export function createCollaborationStateFromSession(
  session: Session,
  permissionMode: PermissionMode = "manual",
): CollaborationState {
  if (session.collaboration) return session.collaboration;
  const primary = createSyntheticPrimaryAgent(session, permissionMode);
  return {
    schemaVersion: COLLABORATION_ROOM_SCHEMA_VERSION,
    primaryAgentId: primary.id,
    defaultRecipientIds: [primary.id],
    focusedAgentId: primary.id,
    agents: [primary],
    messages: createLegacyRoomMessages(session, primary.id),
    agentEvents: {
      [primary.id]: session.events.map((event) => scopeEventToRoomAgent(event, primary.id)),
    },
  };
}

export function mirrorPrimaryAgentToLegacySession(session: Session): Session {
  if (!session.collaboration) return session;
  const primary = getPrimaryRoomAgent(session);
  return {
    ...session,
    runtimeSessionId: primary.runtimeSessionId,
    officialSessionId: primary.officialSessionId,
    skillRegistrySyncedAt: primary.skillRegistrySyncedAt,
    skillForkParentSessionId: primary.skillForkParentSessionId,
    kimiHistoryCacheVersion: primary.kimiHistoryCacheVersion,
    officialCatalogConfirmedAt: primary.officialCatalogConfirmedAt,
    swarmModeLockedAt: primary.swarmModeLockedAt,
    swarmMode: primary.swarmMode,
    swarmModeDesired: primary.swarmModeDesired,
    model: primary.modelAlias,
    modelSwitchedAt: primary.modelSwitchedAt,
    switchedToModel: primary.switchedToModel,
    officialGoal: primary.officialGoal,
    btwRounds: primary.btwRounds,
    events: session.collaboration.agentEvents[primary.id] ?? session.events,
  };
}
