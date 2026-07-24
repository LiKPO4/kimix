import type {
  CollaborationState,
  PermissionMode,
  RoomAgent,
  RoomAgentActivity,
  RoomAgentDelivery,
  RoomAgentDeliveryStatus,
  RoomUserMessage,
  Session,
  TimelineEvent,
} from "@/types/ui";

export const COLLABORATION_ROOMS_DEV_ENABLED = false;
export const COLLABORATION_ROOM_SCHEMA_VERSION = 1 as const;
export const MAX_ROOM_AGENTS = 4;

const ROOM_AGENT_DELIVERY_STATUSES = new Set<RoomAgentDeliveryStatus>([
  "queued",
  "sending",
  "accepted",
  "running",
  "waiting_approval",
  "waiting_question",
  "completed",
  "failed",
  "indeterminate",
  "cancelled",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPermissionMode(value: unknown): value is PermissionMode {
  return value === "manual" || value === "auto" || value === "yolo";
}

function isTimelineEventLike(value: unknown): value is TimelineEvent {
  return isRecord(value) &&
    typeof value.id === "string" && Boolean(value.id.trim()) &&
    typeof value.type === "string" && Boolean(value.type.trim()) &&
    isFiniteNumber(value.timestamp);
}

function isUserMessageImageLike(value: unknown): boolean {
  return isRecord(value) && typeof value.name === "string";
}

function normalizeRoomAgent(value: unknown): RoomAgent | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const displayName = typeof value.displayName === "string" ? value.displayName.trim() : "";
  const mentionName = typeof value.mentionName === "string" ? value.mentionName.trim() : "";
  if (!id || !displayName || !mentionName || !isPermissionMode(value.permissionMode) || !isFiniteNumber(value.createdAt)) {
    return null;
  }
  if (value.modelAlias !== null && typeof value.modelAlias !== "string") return null;
  if (value.planMode !== undefined && typeof value.planMode !== "boolean") return null;
  if (value.provisioningError !== undefined && (typeof value.provisioningError !== "string" || !value.provisioningError.trim())) return null;
  const recoveryIssue = value.recoveryIssue;
  if (recoveryIssue !== undefined && (
    !isRecord(recoveryIssue) ||
    (recoveryIssue.status !== "error" && recoveryIssue.status !== "unavailable") ||
    typeof recoveryIssue.message !== "string" ||
    !recoveryIssue.message.trim() ||
    !isFiniteNumber(recoveryIssue.updatedAt)
  )) return null;
  const lifecycleIssue = value.lifecycleIssue;
  if (lifecycleIssue !== undefined && (
    !isRecord(lifecycleIssue) ||
    (lifecycleIssue.operation !== "archive" && lifecycleIssue.operation !== "restore") ||
    typeof lifecycleIssue.message !== "string" ||
    !lifecycleIssue.message.trim() ||
    !isFiniteNumber(lifecycleIssue.updatedAt)
  )) return null;
  if (value.archivedAt !== undefined && !isFiniteNumber(value.archivedAt)) return null;
  if (value.contextBridgeId !== undefined && (typeof value.contextBridgeId !== "string" || !value.contextBridgeId.trim())) return null;
  return {
    ...(value as unknown as RoomAgent),
    id,
    displayName,
    mentionName,
    modelAlias: value.modelAlias as string | null,
    provisioningError: value.provisioningError as string | undefined,
    permissionMode: value.permissionMode,
    planMode: value.planMode as boolean | undefined,
    createdAt: value.createdAt,
    recoveryIssue: recoveryIssue as RoomAgent["recoveryIssue"],
    archivedAt: value.archivedAt as number | undefined,
    lifecycleIssue: lifecycleIssue as RoomAgent["lifecycleIssue"],
    contextBridgeId: typeof value.contextBridgeId === "string" && value.contextBridgeId.trim()
      ? value.contextBridgeId.trim()
      : `room-context:${id}`,
  };
}

function normalizeRoomMessage(
  value: unknown,
  agentIds: ReadonlySet<string>,
): RoomUserMessage | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!id || typeof value.content !== "string" || !isFiniteNumber(value.timestamp)) return null;
  if (value.outboundContent !== undefined && typeof value.outboundContent !== "string") return null;
  if (!Array.isArray(value.recipientAgentIds) || !isRecord(value.deliveries)) return null;
  if (value.images !== undefined && (!Array.isArray(value.images) || !value.images.every(isUserMessageImageLike))) return null;

  const recipientAgentIds = Array.from(new Set(value.recipientAgentIds.filter((agentId): agentId is string => (
    typeof agentId === "string" && agentIds.has(agentId)
  ))));
  if (recipientAgentIds.length === 0) return null;

  const deliveries: RoomUserMessage["deliveries"] = {};
  for (const [agentId, rawDelivery] of Object.entries(value.deliveries)) {
    if (!agentIds.has(agentId) || !isRecord(rawDelivery)) continue;
    const status = rawDelivery.status;
    const agentTurnId = typeof rawDelivery.agentTurnId === "string" ? rawDelivery.agentTurnId.trim() : "";
    if (!ROOM_AGENT_DELIVERY_STATUSES.has(status as RoomAgentDeliveryStatus) || !agentTurnId) continue;
    const dispatchAttemptId = rawDelivery.dispatchAttemptId === undefined
      ? undefined
      : typeof rawDelivery.dispatchAttemptId === "string" && rawDelivery.dispatchAttemptId.trim()
        ? rawDelivery.dispatchAttemptId.trim()
        : null;
    if (dispatchAttemptId === null) continue;
    const previousAttempts = rawDelivery.previousAttempts;
    if (previousAttempts !== undefined && (!Array.isArray(previousAttempts) || previousAttempts.some((attempt) => (
      !isRecord(attempt) ||
      typeof attempt.dispatchAttemptId !== "string" || !attempt.dispatchAttemptId.trim() ||
      typeof attempt.agentTurnId !== "string" || !attempt.agentTurnId.trim() ||
      !ROOM_AGENT_DELIVERY_STATUSES.has(attempt.status as RoomAgentDeliveryStatus) ||
      !isFiniteNumber(attempt.createdAt) ||
      !isFiniteNumber(attempt.updatedAt)
    )))) continue;
    const contextShare = rawDelivery.contextShare;
    if (contextShare !== undefined && (
      !isRecord(contextShare) ||
      !["last", "recent3", "selected", "all", "none"].includes(String(contextShare.mode)) ||
      typeof contextShare.bridgeId !== "string" || !contextShare.bridgeId.trim() ||
      !Array.isArray(contextShare.entryIds) || contextShare.entryIds.some((entryId) => typeof entryId !== "string" || !entryId.trim()) ||
      typeof contextShare.content !== "string" || !contextShare.content.trim() ||
      !isFiniteNumber(contextShare.contentChars) ||
      !isFiniteNumber(contextShare.createdAt)
    )) continue;
    deliveries[agentId] = {
      ...(rawDelivery as unknown as RoomUserMessage["deliveries"][string]),
      status: status as RoomAgentDeliveryStatus,
      agentTurnId,
      dispatchAttemptId,
      previousAttempts: previousAttempts as RoomUserMessage["deliveries"][string]["previousAttempts"],
      contextShare: contextShare as RoomUserMessage["deliveries"][string]["contextShare"],
    };
  }
  if (recipientAgentIds.some((agentId) => !deliveries[agentId])) return null;

  return {
    ...(value as unknown as RoomUserMessage),
    id,
    content: value.content,
    outboundContent: value.outboundContent as string | undefined,
    recipientAgentIds,
    deliveries,
    timestamp: value.timestamp,
  };
}

function normalizeCollaborationState(
  session: Session,
  raw: Record<string, unknown>,
): CollaborationState | null {
  if (raw.schemaVersion !== COLLABORATION_ROOM_SCHEMA_VERSION || !Array.isArray(raw.agents)) return null;
  const agents = raw.agents.map(normalizeRoomAgent);
  if (agents.length === 0 || agents.some((agent) => !agent)) return null;
  const normalizedAgents = agents as RoomAgent[];
  const agentIds = new Set(normalizedAgents.map((agent) => agent.id));
  if (agentIds.size !== normalizedAgents.length) return null;

  const primaryAgentId = typeof raw.primaryAgentId === "string" ? raw.primaryAgentId : "";
  if (!agentIds.has(primaryAgentId) || !Array.isArray(raw.messages) || !isRecord(raw.agentEvents)) return null;

  const messages = raw.messages.map((message) => normalizeRoomMessage(message, agentIds));
  if (messages.some((message) => !message)) return null;

  const agentEvents: Record<string, TimelineEvent[]> = {};
  for (const [agentId, rawEvents] of Object.entries(raw.agentEvents)) {
    if (!Array.isArray(rawEvents) || !rawEvents.every(isTimelineEventLike)) return null;
    agentEvents[agentId] = rawEvents.map((event) => scopeEventToRoomAgent(event, agentId));
  }
  if (normalizedAgents.some((agent) => !agentEvents[agent.id])) return null;

  const defaultRecipientIds = Array.isArray(raw.defaultRecipientIds)
    ? Array.from(new Set(raw.defaultRecipientIds.filter((agentId): agentId is string => (
      typeof agentId === "string" && agentIds.has(agentId)
    ))))
    : [];
  const focusedAgentId = typeof raw.focusedAgentId === "string" && agentIds.has(raw.focusedAgentId)
    ? raw.focusedAgentId
    : undefined;

  return {
    ...(raw as unknown as CollaborationState),
    schemaVersion: COLLABORATION_ROOM_SCHEMA_VERSION,
    primaryMirrorUpdatedAt: isFiniteNumber(raw.primaryMirrorUpdatedAt)
      ? raw.primaryMirrorUpdatedAt
      : session.updatedAt,
    primaryAgentId,
    defaultRecipientIds: defaultRecipientIds.length > 0 ? defaultRecipientIds : [primaryAgentId],
    focusedAgentId,
    agents: normalizedAgents,
    messages: messages as RoomUserMessage[],
    agentEvents,
  };
}

export interface RoomRuntimeOwner {
  roomId: string;
  roomAgentId: string;
  session: Session;
  agent: RoomAgent;
}

const ACTIVE_RUNTIME_OWNER_STATUSES = new Set<RoomAgentActivity["status"]>([
  "creating",
  "queued",
  "sending",
  "accepted",
  "running",
  "waiting_approval",
  "waiting_question",
]);

export function roomAgentActivityKey(roomId: string, roomAgentId: string): string {
  return JSON.stringify([roomId, roomAgentId]);
}

export function selectRoomAgent(session: Session, roomAgentId?: string): Session {
  if (!session.collaboration || !roomAgentId) return session;
  const agent = getRoomAgent(session, roomAgentId);
  if (!agent || agent.removedAt || agent.archivedAt) return session;
  if (
    session.collaboration.focusedAgentId === roomAgentId &&
    session.collaboration.defaultRecipientIds.length === 1 &&
    session.collaboration.defaultRecipientIds[0] === roomAgentId
  ) return session;
  return {
    ...session,
    collaboration: {
      ...session.collaboration,
      defaultRecipientIds: [roomAgentId],
      focusedAgentId: roomAgentId,
    },
  };
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
  const id = getSyntheticPrimaryAgentId(session.id);
  return {
    id,
    displayName,
    mentionName: displayName.replace(/\s+/g, "-") || "Kimi",
    modelAlias: session.model ?? null,
    permissionMode: session.permissionMode ?? permissionMode,
    planMode: session.planMode,
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
    contextBridgeId: `room-context:${id}`,
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

export function isPrimaryRoomAgent(session: Session, roomAgentId: string): boolean {
  return getPrimaryRoomAgent(session).id === roomAgentId;
}

export function getRoomAgentEvents(session: Session, roomAgentId: string): TimelineEvent[] {
  if (!session.collaboration) return session.events;
  return session.collaboration.agentEvents[roomAgentId] ?? [];
}

export function updateRoomAgent(
  session: Session,
  roomAgentId: string,
  updater: (agent: RoomAgent) => RoomAgent,
): Session {
  if (!session.collaboration) return session;
  const next: Session = {
    ...session,
    collaboration: {
      ...session.collaboration,
      agents: session.collaboration.agents.map((agent) => (
        agent.id === roomAgentId ? updater(agent) : agent
      )),
    },
  };
  return isPrimaryRoomAgent(next, roomAgentId) ? mirrorPrimaryAgentToLegacySession(next) : next;
}

export function replaceRoomAgentEvents(
  session: Session,
  roomAgentId: string,
  events: TimelineEvent[],
): Session {
  if (!session.collaboration) return { ...session, events };
  const next: Session = {
    ...session,
    collaboration: {
      ...session.collaboration,
      agentEvents: {
        ...session.collaboration.agentEvents,
        [roomAgentId]: events,
      },
    },
  };
  return isPrimaryRoomAgent(next, roomAgentId) ? mirrorPrimaryAgentToLegacySession(next) : next;
}

export function updateRoomAgentEvents(
  session: Session,
  roomAgentId: string,
  updater: (events: TimelineEvent[]) => TimelineEvent[],
): Session {
  return replaceRoomAgentEvents(session, roomAgentId, updater(getRoomAgentEvents(session, roomAgentId)));
}

export function getRoomAgentSessionView(session: Session, roomAgentId: string): Session {
  if (!session.collaboration) return session;
  const agent = getRoomAgent(session, roomAgentId);
  if (!agent) return session;
  return {
    ...session,
    runtimeSessionId: agent.runtimeSessionId,
    officialSessionId: agent.officialSessionId,
    skillRegistrySyncedAt: agent.skillRegistrySyncedAt,
    skillForkParentSessionId: agent.skillForkParentSessionId,
    kimiHistoryCacheVersion: agent.kimiHistoryCacheVersion,
    officialCatalogConfirmedAt: agent.officialCatalogConfirmedAt,
    swarmModeLockedAt: agent.swarmModeLockedAt,
    swarmMode: agent.swarmMode,
    swarmModeDesired: agent.swarmModeDesired,
    model: agent.modelAlias,
    permissionMode: agent.permissionMode,
    planMode: agent.planMode,
    modelSwitchedAt: agent.modelSwitchedAt,
    switchedToModel: agent.switchedToModel,
    officialGoal: agent.officialGoal,
    btwRounds: agent.btwRounds,
    events: getRoomAgentEvents(session, roomAgentId),
  };
}

export function scopeEventToRoomAgent<T extends TimelineEvent>(
  event: T,
  roomAgentId: string,
): T {
  if (event.roomAgentId === roomAgentId) return event;
  return { ...event, roomAgentId };
}

export function findRoomRuntimeOwners(
  sessions: Session[],
  runtimeSessionId: string,
  officialSessionId?: string | null,
): RoomRuntimeOwner[] {
  const identities = new Set(
    [runtimeSessionId, officialSessionId ?? undefined].filter((value): value is string => Boolean(value)),
  );
  const owners: RoomRuntimeOwner[] = [];

  for (const session of sessions) {
    if (session.archivedAt || session.longTask) continue;
    const agents = getRoomAgents(session);
    for (const agent of agents) {
      if (agent.removedAt || agent.archivedAt) continue;
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
      owners.push({
        roomId: session.id,
        roomAgentId: agent.id,
        session,
        agent,
      });
    }
  }
  return owners;
}

export function resolveRoomRuntimeOwner(
  sessions: Session[],
  runtimeSessionId: string,
  officialSessionId?: string | null,
  activities?: Readonly<Record<string, RoomAgentActivity>>,
): RoomRuntimeOwner | null {
  const owners = findRoomRuntimeOwners(sessions, runtimeSessionId, officialSessionId);
  if (owners.length === 1) return owners[0];
  if (owners.length === 0 || !activities) return null;
  const activeOwners = owners.filter((owner) => {
    const activity = activities[roomAgentActivityKey(owner.roomId, owner.roomAgentId)];
    return Boolean(
      activity &&
      ACTIVE_RUNTIME_OWNER_STATUSES.has(activity.status) &&
      (!activity.runtimeSessionId || activity.runtimeSessionId === runtimeSessionId),
    );
  });
  return activeOwners.length === 1 ? activeOwners[0] : null;
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

function createLegacyRoomMessages(
  session: Session,
  primaryAgentId: string,
  existingMessages?: ReadonlyMap<string, RoomUserMessage>,
): RoomUserMessage[] {
  return session.events.flatMap((event, index) => {
    if (event.type !== "user_message") return [];
    const roomMessageId = event.roomMessageId ?? `room-message:${event.id}`;
    const currentDelivery = existingMessages?.get(roomMessageId)?.deliveries[primaryAgentId];
    const agentTurnId = event.agentTurnId ?? currentDelivery?.agentTurnId ?? `agent-turn:${primaryAgentId}:${event.id}`;
    return [{
      id: roomMessageId,
      content: event.content,
      images: event.images,
      recipientAgentIds: [primaryAgentId],
      deliveries: {
        [primaryAgentId]: {
          status: inferDeliveryStatus(session.events, index),
          agentTurnId,
          ...(event.dispatchAttemptId ? { dispatchAttemptId: event.dispatchAttemptId } : {}),
          officialUserEventId: event.id,
        },
      },
      timestamp: event.timestamp,
    }];
  });
}

function mergeLegacyPrimaryDelivery(
  current: RoomAgentDelivery | undefined,
  legacy: RoomAgentDelivery,
): RoomAgentDelivery {
  if (!current) return legacy;
  const previousAttempts = current.previousAttempts;
  if (current.agentTurnId !== legacy.agentTurnId) {
    return previousAttempts?.length ? { ...legacy, previousAttempts } : legacy;
  }
  if (
    current.dispatchAttemptId &&
    legacy.dispatchAttemptId &&
    current.dispatchAttemptId !== legacy.dispatchAttemptId
  ) return previousAttempts?.length ? { ...legacy, previousAttempts } : legacy;
  const merged: RoomAgentDelivery = {
    ...current,
    ...legacy,
  };
  if (!["failed", "indeterminate", "cancelled"].includes(merged.status)) delete merged.error;
  return merged;
}

type RoomDeliveryAttemptIndexes = {
  deliveryAttemptOwnership: Map<string, Set<string>>;
  eventAttemptIdentities: Map<string, Set<string>>;
  agentEventsByIdentity: Map<string, TimelineEvent[]>;
};

function buildRoomDeliveryAttemptIndexes(collaboration: CollaborationState): RoomDeliveryAttemptIndexes {
  const deliveryAttemptOwnership = new Map<string, Set<string>>();
  const eventAttemptIdentities = new Map<string, Set<string>>();
  const agentEventsByIdentity = new Map<string, TimelineEvent[]>();

  for (const message of collaboration.messages) {
    const messageId = message.id;
    for (const [agentId, delivery] of Object.entries(message.deliveries)) {
      const ownershipKey = `${messageId}:${agentId}`;
      if (delivery.dispatchAttemptId) {
        const set = deliveryAttemptOwnership.get(delivery.dispatchAttemptId) ?? new Set<string>();
        set.add(ownershipKey);
        deliveryAttemptOwnership.set(delivery.dispatchAttemptId, set);
      }
      for (const attempt of delivery.previousAttempts ?? []) {
        if (!attempt.dispatchAttemptId) continue;
        const set = deliveryAttemptOwnership.get(attempt.dispatchAttemptId) ?? new Set<string>();
        set.add(ownershipKey);
        deliveryAttemptOwnership.set(attempt.dispatchAttemptId, set);
      }
    }
  }

  for (const [agentId, events] of Object.entries(collaboration.agentEvents)) {
    for (const event of events) {
      const identityKey = `${agentId}:${event.roomMessageId ?? ""}:${event.agentTurnId ?? ""}`;
      if (event.type === "user_message") {
        const list = agentEventsByIdentity.get(identityKey) ?? [];
        list.push(event);
        agentEventsByIdentity.set(identityKey, list);
      }
      if (!event.dispatchAttemptId) continue;
      const set = eventAttemptIdentities.get(event.dispatchAttemptId) ?? new Set<string>();
      set.add(identityKey);
      eventAttemptIdentities.set(event.dispatchAttemptId, set);
    }
  }

  return { deliveryAttemptOwnership, eventAttemptIdentities, agentEventsByIdentity };
}

export function repairMissingRoomDeliveryAttemptIds(collaboration: CollaborationState): CollaborationState {
  const { deliveryAttemptOwnership, eventAttemptIdentities, agentEventsByIdentity } = buildRoomDeliveryAttemptIndexes(collaboration);
  let changed = false;
  const messages = collaboration.messages.map((message) => {
    let deliveriesChanged = false;
    const deliveries = { ...message.deliveries };

    for (const roomAgentId of message.recipientAgentIds) {
      const delivery = deliveries[roomAgentId];
      if (!delivery || delivery.dispatchAttemptId) continue;
      const identityKey = `${roomAgentId}:${message.id}:${delivery.agentTurnId}`;
      const matchingEvents = agentEventsByIdentity.get(identityKey) ?? [];
      const attemptIds = Array.from(new Set(matchingEvents.flatMap((event) => (
        event.dispatchAttemptId ? [event.dispatchAttemptId] : []
      ))));
      if (attemptIds.length !== 1) continue;
      const candidateAttemptId = attemptIds[0];
      const occupiedElsewhere = deliveryAttemptOwnership.has(candidateAttemptId);
      const identities = eventAttemptIdentities.get(candidateAttemptId);
      const eventIdentityOccupiedElsewhere = identities ? Array.from(identities).some((identity) => identity !== identityKey) : false;
      if (occupiedElsewhere || eventIdentityOccupiedElsewhere) continue;
      deliveries[roomAgentId] = { ...delivery, dispatchAttemptId: candidateAttemptId };
      deliveriesChanged = true;
      changed = true;
    }

    return deliveriesChanged ? { ...message, deliveries } : message;
  });
  return changed ? { ...collaboration, messages } : collaboration;
}

function reconcileLegacyPrimaryWrite(session: Session, collaboration: CollaborationState): CollaborationState {
  const primaryIndex = collaboration.agents.findIndex((agent) => agent.id === collaboration.primaryAgentId);
  if (primaryIndex < 0) return collaboration;
  const currentPrimary = collaboration.agents[primaryIndex];
  const legacyPrimary = createSyntheticPrimaryAgent(session, currentPrimary.permissionMode);
  const nextPrimary: RoomAgent = {
    ...currentPrimary,
    runtimeSessionId: legacyPrimary.runtimeSessionId,
    officialSessionId: legacyPrimary.officialSessionId,
    skillRegistrySyncedAt: legacyPrimary.skillRegistrySyncedAt,
    skillForkParentSessionId: legacyPrimary.skillForkParentSessionId,
    kimiHistoryCacheVersion: legacyPrimary.kimiHistoryCacheVersion,
    officialCatalogConfirmedAt: legacyPrimary.officialCatalogConfirmedAt,
    swarmModeLockedAt: legacyPrimary.swarmModeLockedAt,
    swarmMode: legacyPrimary.swarmMode,
    swarmModeDesired: legacyPrimary.swarmModeDesired,
    modelAlias: legacyPrimary.modelAlias,
    permissionMode: legacyPrimary.permissionMode,
    planMode: legacyPrimary.planMode,
    modelSwitchedAt: legacyPrimary.modelSwitchedAt,
    switchedToModel: legacyPrimary.switchedToModel,
    officialGoal: legacyPrimary.officialGoal,
    btwRounds: legacyPrimary.btwRounds,
  };

  const currentByMessageId = new Map(collaboration.messages.map((message) => [message.id, message]));
  const legacyByMessageId = new Map(
    createLegacyRoomMessages(session, currentPrimary.id, currentByMessageId).map((message) => [message.id, message]),
  );
  const messages = collaboration.messages.flatMap((message): RoomUserMessage[] => {
    const legacyMessage = legacyByMessageId.get(message.id);
    if (legacyMessage) {
      legacyByMessageId.delete(message.id);
      const legacyDelivery = legacyMessage.deliveries[currentPrimary.id];
      return [{
        ...message,
        recipientAgentIds: Array.from(new Set([...message.recipientAgentIds, currentPrimary.id])),
        deliveries: {
          ...message.deliveries,
          [currentPrimary.id]: mergeLegacyPrimaryDelivery(
            message.deliveries[currentPrimary.id],
            legacyDelivery,
          ),
        },
      }];
    }

    if (!message.recipientAgentIds.includes(currentPrimary.id) && !message.deliveries[currentPrimary.id]) {
      return [message];
    }
    const recipientAgentIds = message.recipientAgentIds.filter((agentId) => agentId !== currentPrimary.id);
    const deliveries = { ...message.deliveries };
    delete deliveries[currentPrimary.id];
    return recipientAgentIds.length > 0 ? [{ ...message, recipientAgentIds, deliveries }] : [];
  });
  messages.push(...legacyByMessageId.values());

  const agents = [...collaboration.agents];
  agents[primaryIndex] = nextPrimary;
  return {
    ...collaboration,
    primaryMirrorUpdatedAt: session.updatedAt,
    agents,
    messages: messages.sort((left, right) => left.timestamp - right.timestamp),
    agentEvents: {
      ...collaboration.agentEvents,
      [currentPrimary.id]: session.events.map((event) => scopeEventToRoomAgent(event, currentPrimary.id)),
    },
  };
}

export function normalizeLoadedSessionCollaboration(session: Session): Session {
  const raw = (session as Session & { collaboration?: unknown }).collaboration;
  if (raw === undefined || raw === null) {
    if (!session.unsupportedCollaboration) return session;
    const { unsupportedCollaboration: _unsupported, ...rest } = session;
    return rest;
  }
  const schemaVersion = isRecord(raw) && isFiniteNumber(raw.schemaVersion) ? raw.schemaVersion : undefined;
  if (!isRecord(raw) || schemaVersion !== COLLABORATION_ROOM_SCHEMA_VERSION) {
    return {
      ...session,
      collaboration: undefined,
      unsupportedCollaboration: {
        reason: "unsupported-schema",
        schemaVersion,
        raw,
      },
    };
  }
  const hadPrimaryMirrorMarker = isFiniteNumber(raw.primaryMirrorUpdatedAt);
  const normalized = normalizeCollaborationState(session, raw);
  if (!normalized) {
    return {
      ...session,
      collaboration: undefined,
      unsupportedCollaboration: {
        reason: "invalid-schema",
        schemaVersion,
        raw,
      },
    };
  }
  const reconciled = hadPrimaryMirrorMarker && session.updatedAt > normalized.primaryMirrorUpdatedAt
    ? reconcileLegacyPrimaryWrite(session, normalized)
    : normalized;
  const collaboration = repairMissingRoomDeliveryAttemptIds(reconciled);
  const { unsupportedCollaboration: _unsupported, ...rest } = session;
  return { ...rest, collaboration };
}

export function synchronizeCollaborationPrimaryMirror(session: Session): Session {
  if (!session.collaboration) return session;
  const mirrored = mirrorPrimaryAgentToLegacySession(session);
  return {
    ...mirrored,
    collaboration: {
      ...mirrored.collaboration!,
      primaryMirrorUpdatedAt: mirrored.updatedAt,
    },
  };
}

export function createCollaborationStateFromSession(
  session: Session,
  permissionMode: PermissionMode = "manual",
): CollaborationState {
  if (session.collaboration) return session.collaboration;
  if (session.unsupportedCollaboration) {
    throw new Error("当前会话包含此版本无法安全修改的协同数据，请升级 Kimix 后重试。");
  }
  const primary = createSyntheticPrimaryAgent(session, permissionMode);
  return {
    schemaVersion: COLLABORATION_ROOM_SCHEMA_VERSION,
    primaryMirrorUpdatedAt: session.updatedAt,
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
    permissionMode: primary.permissionMode,
    planMode: primary.planMode,
    modelSwitchedAt: primary.modelSwitchedAt,
    switchedToModel: primary.switchedToModel,
    officialGoal: primary.officialGoal,
    btwRounds: primary.btwRounds,
    events: session.collaboration.agentEvents[primary.id] ?? session.events,
  };
}
