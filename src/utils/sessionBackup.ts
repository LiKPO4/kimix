import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { PendingMessage } from "@/stores/sessionStore";
import type {
  CollaborationState,
  Project,
  RoomAgentActivity,
  RoomAgentDelivery,
  RoomAgentDeliveryAttempt,
  RoomUserMessage,
  Session,
  TimelineEvent,
  UserMessageImage,
} from "@/types/ui";
import { isHiddenInternalSession } from "@/utils/internalSessions";
import {
  normalizeLoadedSessionCollaboration,
  roomAgentActivityKey,
  scopeEventToRoomAgent,
  synchronizeCollaborationPrimaryMirror,
} from "@/utils/collaborationRooms";
import {
  LOCAL_ACTIVE_CONTEXT_KEY,
  LOCAL_ARCHIVED_SESSION_TOMBSTONES_KEY,
  getArchivedSessionTombstones,
  getHiddenHandoffSessionIds,
  persistLocalConversationState,
} from "@/utils/persistence";
import type { ArchivedSessionTombstone } from "@/utils/persistence";
import type { SessionBackupSnapshot } from "../../electron/types/ipc";

const LEGACY_SESSION_BACKUP_SCHEMA_VERSION = 1;
const SESSION_BACKUP_SCHEMA_VERSION = 2;
const HIDDEN_HANDOFF_SESSION_KEY = "kimix_hidden_handoff_sessions";
const MAX_ARCHIVED_TOMBSTONES = 500;

export type SessionBackupImportStats = {
  importedSessions: number;
  addedSessions: number;
  updatedSessions: number;
  skippedSessions: number;
  forkedSessions: number;
  mergedEvents: number;
  importedArchivedSessions: number;
  importedArchivedTombstones: number;
  archivedTombstones: number;
  addedProjects: number;
  updatedProjects: number;
  skippedProjects: number;
  addedPendingMessages: number;
  skippedPendingMessages: number;
  importedRoomAgentActivities: number;
  hiddenHandoffSessionIds: number;
};

export type SessionBackupImportPlan = {
  snapshot: SessionBackupSnapshot;
  sessions: Session[];
  pendingMessages: PendingMessage[];
  roomAgentActivities: Record<string, RoomAgentActivity>;
  projects: Project[];
  projectsToPersist: Project[];
  archivedTombstones: ArchivedSessionTombstone[];
  hiddenHandoffSessionIds: string[];
  stats: SessionBackupImportStats;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizePathForBackup(value: string | undefined) {
  return (value ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function uniqueStrings(values: Array<string | undefined | null>) {
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))));
}

function sessionIdentityKeys(session: Session) {
  return uniqueStrings([
    session.id,
    session.runtimeSessionId,
    session.officialSessionId,
    session.longTask?.executorSessionId,
    session.longTask?.reviewerSessionId,
    ...(session.collaboration?.agents.flatMap((agent) => [agent.runtimeSessionId, agent.officialSessionId]) ?? []),
  ]);
}

function makeArchivedTombstone(session: Session): ArchivedSessionTombstone | null {
  const ids = sessionIdentityKeys(session);
  const archivedAt = session.archivedAt;
  if (!archivedAt || ids.length === 0 || !session.projectPath) return null;
  return {
    ids,
    projectPath: session.projectPath,
    title: session.title,
    archivedAt,
  };
}

function normalizeArchivedTombstone(value: unknown): ArchivedSessionTombstone | null {
  if (!isRecord(value)) return null;
  const ids = Array.isArray(value.ids)
    ? uniqueStrings(value.ids.map((item) => (typeof item === "string" ? item : undefined)))
    : [];
  const projectPath = stringValue(value.projectPath);
  const archivedAt = optionalNumber(value.archivedAt);
  if (ids.length === 0 || !projectPath || !archivedAt) return null;
  return {
    ids,
    projectPath,
    title: optionalString(value.title),
    archivedAt,
  };
}

function mergeArchivedTombstones(tombstones: ArchivedSessionTombstone[]) {
  const merged: ArchivedSessionTombstone[] = [];
  for (const tombstone of tombstones) {
    const normalized = normalizeArchivedTombstone(tombstone);
    if (!normalized) continue;
    const projectKey = normalizePathForBackup(normalized.projectPath);
    const index = merged.findIndex((item) => (
      normalizePathForBackup(item.projectPath) === projectKey &&
      item.ids.some((id) => normalized.ids.includes(id))
    ));
    if (index < 0) {
      merged.push(normalized);
      continue;
    }
    const current = merged[index];
    merged[index] = {
      ids: uniqueStrings([...current.ids, ...normalized.ids]),
      projectPath: current.projectPath || normalized.projectPath,
      title: current.title || normalized.title,
      archivedAt: Math.max(current.archivedAt, normalized.archivedAt),
    };
  }
  return merged.slice(-MAX_ARCHIVED_TOMBSTONES);
}

function readJsonFromLocalStorage(key: string, fallback: unknown) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function timelineEventKey(event: TimelineEvent) {
  const record = event as unknown as Record<string, unknown>;
  const id = optionalString(record.id);
  if (id) return `id:${id}`;
  const type = optionalString(record.type) ?? "unknown";
  const timestamp = numberValue(record.timestamp, 0);
  const toolCallId = optionalString(record.toolCallId);
  const content = typeof record.content === "string" ? record.content.slice(0, 120) : "";
  return `sig:${type}:${timestamp}:${toolCallId ?? ""}:${content}`;
}

function mergeTimelineEvents(localEvents: TimelineEvent[], importedEvents: TimelineEvent[]) {
  const byKey = new Map<string, TimelineEvent>();
  for (const event of localEvents) byKey.set(timelineEventKey(event), event);
  let added = 0;
  for (const event of importedEvents) {
    const key = timelineEventKey(event);
    if (!byKey.has(key)) {
      added += 1;
      byKey.set(key, event);
    }
  }
  const events = Array.from(byKey.values()).sort((a, b) => numberValue(a.timestamp, 0) - numberValue(b.timestamp, 0));
  return { events, added };
}

function sameStringSet(left: string[], right: string[]) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function roomTopologiesMatch(local: CollaborationState, imported: CollaborationState) {
  return local.primaryAgentId === imported.primaryAgentId &&
    sameStringSet(local.agents.map((agent) => agent.id), imported.agents.map((agent) => agent.id));
}

function sessionContentKeys(session: Session) {
  if (!session.collaboration) {
    return session.events.map((event) => `event:${timelineEventKey(event)}`);
  }
  return [
    ...session.collaboration.agents.flatMap((agent) => (
      (session.collaboration?.agentEvents[agent.id] ?? []).map((event) => `event:${agent.id}:${timelineEventKey(event)}`)
    )),
    ...session.collaboration.messages.map((message) => (
      `message:${message.id}:${message.timestamp}:${message.content}:${message.recipientAgentIds.join(",")}`
    )),
  ];
}

function shouldForkImportedSession(local: Session, imported: Session) {
  if (local.collaboration && imported.collaboration && !roomTopologiesMatch(local.collaboration, imported.collaboration)) {
    return true;
  }
  const compareLegacyMirror = Boolean(local.collaboration) !== Boolean(imported.collaboration);
  const localKeys = compareLegacyMirror
    ? local.events.map((event) => `event:${timelineEventKey(event)}`)
    : sessionContentKeys(local);
  const importedKeys = compareLegacyMirror
    ? imported.events.map((event) => `event:${timelineEventKey(event)}`)
    : sessionContentKeys(imported);
  if (localKeys.length === 0 || importedKeys.length === 0) return false;
  const localSet = new Set(localKeys);
  const importedSet = new Set(importedKeys);
  return localKeys.some((key) => !importedSet.has(key)) && importedKeys.some((key) => !localSet.has(key));
}

type SessionImportIdentityMap = {
  targetSessionId: string;
  roomAgentIds: Map<string, string>;
  roomMessageIds: Map<string, string>;
  agentTurnIds: Map<string, string>;
  dispatchAttemptIds: Map<string, string>;
};

function rawCollaborationReferencesAreConsistent(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.agents) || !Array.isArray(value.messages) || !isRecord(value.agentEvents)) {
    return false;
  }
  const agentIds = new Set(value.agents.flatMap((agent) => (
    isRecord(agent) && typeof agent.id === "string" && agent.id.trim() ? [agent.id.trim()] : []
  )));
  if (agentIds.size !== value.agents.length || !sameStringSet(Object.keys(value.agentEvents), [...agentIds])) return false;
  const validateRawEvent = (event: unknown, roomAgentId: string): boolean => {
    if (!isRecord(event)) return false;
    if (event.roomAgentId !== undefined && event.roomAgentId !== roomAgentId) return false;
    if (event.recipientAgentIds !== undefined && (
      !Array.isArray(event.recipientAgentIds) ||
      event.recipientAgentIds.some((id) => typeof id !== "string" || !agentIds.has(id))
    )) return false;
    return event.type !== "subagent" || (
      Array.isArray(event.events) && event.events.every((nested) => validateRawEvent(nested, roomAgentId))
    );
  };
  for (const [roomAgentId, events] of Object.entries(value.agentEvents)) {
    if (!Array.isArray(events) || !events.every((event) => validateRawEvent(event, roomAgentId))) return false;
  }
  for (const message of value.messages) {
    if (!isRecord(message) || !Array.isArray(message.recipientAgentIds) || !isRecord(message.deliveries)) return false;
    if (message.recipientAgentIds.some((id) => typeof id !== "string" || !agentIds.has(id))) return false;
    const recipients = message.recipientAgentIds as string[];
    if (new Set(recipients).size !== recipients.length || !sameStringSet(recipients, Object.keys(message.deliveries))) return false;
  }
  return true;
}

function optionalNonEmptyString(value: unknown) {
  return value === undefined || (typeof value === "string" && Boolean(value.trim()));
}

function validateDeliveryShape(delivery: RoomAgentDelivery): boolean {
  if (!optionalNonEmptyString(delivery.dispatchAttemptId) ||
    !optionalNonEmptyString(delivery.officialPromptId) ||
    !optionalNonEmptyString(delivery.officialUserEventId) ||
    !optionalNonEmptyString(delivery.error) ||
    (delivery.createdAt !== undefined && !Number.isFinite(delivery.createdAt)) ||
    (delivery.updatedAt !== undefined && !Number.isFinite(delivery.updatedAt))) return false;
  if (delivery.contextShare && (
    !["last", "recent3", "selected", "all", "none"].includes(delivery.contextShare.mode) ||
    !delivery.contextShare.bridgeId.trim() ||
    delivery.contextShare.entryIds.some((entryId) => !entryId.trim()) ||
    !delivery.contextShare.content.trim() ||
    !Number.isFinite(delivery.contextShare.contentChars) ||
    !Number.isFinite(delivery.contextShare.createdAt)
  )) return false;
  return (delivery.previousAttempts ?? []).every((attempt) => (
    Boolean(attempt.dispatchAttemptId.trim()) &&
    Boolean(attempt.agentTurnId.trim()) &&
    Number.isFinite(attempt.createdAt) &&
    Number.isFinite(attempt.updatedAt) &&
    optionalNonEmptyString(attempt.officialPromptId) &&
    optionalNonEmptyString(attempt.officialUserEventId) &&
    optionalNonEmptyString(attempt.error)
  ));
}

function validateCollaborationReferences(collaboration: CollaborationState): boolean {
  const agentIds = new Set(collaboration.agents.map((agent) => agent.id));
  if (agentIds.size !== collaboration.agents.length) return false;
  if (!agentIds.has(collaboration.primaryAgentId)) return false;
  if (collaboration.focusedAgentId && !agentIds.has(collaboration.focusedAgentId)) return false;
  if (collaboration.defaultRecipientIds.length === 0 || collaboration.defaultRecipientIds.some((id) => !agentIds.has(id))) return false;
  if (!sameStringSet(Object.keys(collaboration.agentEvents), [...agentIds])) return false;

  const messagesById = new Map<string, RoomUserMessage>();
  const turnOwners = new Map<string, { roomAgentId: string; roomMessageId: string }>();
  const attemptIds = new Set<string>();
  const attemptOwners = new Map<string, { roomAgentId: string; roomMessageId: string }>();
  for (const message of collaboration.messages) {
    if (messagesById.has(message.id)) return false;
    messagesById.set(message.id, message);
    const deliveryAgentIds = Object.keys(message.deliveries);
    if (!sameStringSet(message.recipientAgentIds, deliveryAgentIds)) return false;
    if (message.recipientAgentIds.some((id) => !agentIds.has(id))) return false;
    for (const roomAgentId of message.recipientAgentIds) {
      const delivery = message.deliveries[roomAgentId];
      if (!delivery || !validateDeliveryShape(delivery)) return false;
      const attempts = [delivery, ...(delivery.previousAttempts ?? [])];
      for (const attempt of attempts) {
        if (turnOwners.has(attempt.agentTurnId)) return false;
        turnOwners.set(attempt.agentTurnId, { roomAgentId, roomMessageId: message.id });
        const attemptId = attempt.dispatchAttemptId;
        if (attemptId) {
          if (attemptIds.has(attemptId)) return false;
          attemptIds.add(attemptId);
          attemptOwners.set(attemptId, { roomAgentId, roomMessageId: message.id });
        }
      }
    }
  }

  const validateEvent = (event: TimelineEvent, roomAgentId: string): boolean => {
    if (event.roomAgentId && event.roomAgentId !== roomAgentId) return false;
    if (event.recipientAgentIds?.some((id) => !agentIds.has(id))) return false;
    const message = event.roomMessageId ? messagesById.get(event.roomMessageId) : undefined;
    if (event.roomMessageId && (!message || !message.recipientAgentIds.includes(roomAgentId))) return false;
    const turnOwner = event.agentTurnId ? turnOwners.get(event.agentTurnId) : undefined;
    if (event.agentTurnId && (!turnOwner || turnOwner.roomAgentId !== roomAgentId)) return false;
    const attemptOwner = event.dispatchAttemptId ? attemptOwners.get(event.dispatchAttemptId) : undefined;
    if (event.dispatchAttemptId && (!attemptOwner || attemptOwner.roomAgentId !== roomAgentId)) return false;
    if (message && turnOwner && turnOwner.roomMessageId !== message.id) return false;
    if (message && attemptOwner && attemptOwner.roomMessageId !== message.id) return false;
    if (message && event.recipientAgentIds && !sameStringSet(message.recipientAgentIds, event.recipientAgentIds)) return false;
    return event.type !== "subagent" || event.events.every((nested) => validateEvent(nested, roomAgentId));
  };
  return collaboration.agents.every((agent) => (
    collaboration.agentEvents[agent.id].every((event) => validateEvent(event, agent.id))
  ));
}

function createIdentityMap(imported: Session, targetSessionId: string): SessionImportIdentityMap {
  const collaboration = imported.collaboration;
  return {
    targetSessionId,
    roomAgentIds: new Map(collaboration?.agents.map((agent) => [agent.id, agent.id]) ?? []),
    roomMessageIds: new Map(collaboration?.messages.map((message) => [message.id, message.id]) ?? []),
    agentTurnIds: new Map(collaboration?.messages.flatMap((message) => Object.values(message.deliveries).flatMap((delivery) => [
      [delivery.agentTurnId, delivery.agentTurnId] as const,
      ...(delivery.previousAttempts ?? []).map((attempt) => [attempt.agentTurnId, attempt.agentTurnId] as const),
    ])) ?? []),
    dispatchAttemptIds: new Map(collaboration?.messages.flatMap((message) => Object.values(message.deliveries).flatMap((delivery) => [
      ...(delivery.dispatchAttemptId ? [[delivery.dispatchAttemptId, delivery.dispatchAttemptId] as const] : []),
      ...(delivery.previousAttempts ?? []).flatMap((attempt) => (
        attempt.dispatchAttemptId ? [[attempt.dispatchAttemptId, attempt.dispatchAttemptId] as const] : []
      )),
    ])) ?? []),
  };
}

function remapTimelineEvent(
  event: TimelineEvent,
  roomAgentIds: ReadonlyMap<string, string>,
  roomMessageIds: ReadonlyMap<string, string>,
  agentTurnIds: ReadonlyMap<string, string>,
  dispatchAttemptIds: ReadonlyMap<string, string>,
): TimelineEvent {
  const roomAgentId = event.roomAgentId ? roomAgentIds.get(event.roomAgentId) : undefined;
  const roomMessageId = event.roomMessageId ? roomMessageIds.get(event.roomMessageId) : undefined;
  const agentTurnId = event.agentTurnId ? agentTurnIds.get(event.agentTurnId) : undefined;
  const dispatchAttemptId = event.dispatchAttemptId ? dispatchAttemptIds.get(event.dispatchAttemptId) : undefined;
  if (event.roomAgentId && !roomAgentId) throw new Error(`房间事件引用未知 Agent：${event.roomAgentId}`);
  if (event.roomMessageId && !roomMessageId) throw new Error(`房间事件引用未知消息：${event.roomMessageId}`);
  if (event.agentTurnId && !agentTurnId) throw new Error(`房间事件引用未知 turn：${event.agentTurnId}`);
  if (event.dispatchAttemptId && !dispatchAttemptId) throw new Error(`房间事件引用未知投递尝试：${event.dispatchAttemptId}`);
  const recipientAgentIds = event.recipientAgentIds?.map((id) => {
    const mapped = roomAgentIds.get(id);
    if (!mapped) throw new Error(`房间事件引用未知接收者：${id}`);
    return mapped;
  });
  return {
    ...event,
    roomAgentId,
    roomMessageId,
    agentTurnId,
    dispatchAttemptId,
    recipientAgentIds,
    ...(event.type === "subagent" ? {
      events: event.events.map((nested) => remapTimelineEvent(nested, roomAgentIds, roomMessageIds, agentTurnIds, dispatchAttemptIds)),
    } : {}),
  } as TimelineEvent;
}

function remapCollaborationForImportedCopy(collaboration: CollaborationState, roomId: string) {
  const roomAgentIds = new Map<string, string>();
  for (const agent of collaboration.agents) {
    roomAgentIds.set(agent.id, agent.id === collaboration.primaryAgentId
      ? `room-agent:${roomId}`
      : `room-agent:${crypto.randomUUID()}`);
  }
  const roomMessageIds = new Map(collaboration.messages.map((message) => [
    message.id,
    `room-message:${crypto.randomUUID()}`,
  ]));
  const agentTurnIds = new Map<string, string>();
  const dispatchAttemptIds = new Map<string, string>();
  for (const message of collaboration.messages) {
    for (const [roomAgentId, delivery] of Object.entries(message.deliveries)) {
      const mappedAgentId = roomAgentIds.get(roomAgentId);
      if (!mappedAgentId) throw new Error(`delivery 引用未知 Agent：${roomAgentId}`);
      for (const attempt of [delivery, ...(delivery.previousAttempts ?? [])]) {
        agentTurnIds.set(attempt.agentTurnId, `agent-turn:${mappedAgentId}:${crypto.randomUUID()}`);
        if (attempt.dispatchAttemptId) {
          dispatchAttemptIds.set(attempt.dispatchAttemptId, `dispatch-attempt:${mappedAgentId}:${crypto.randomUUID()}`);
        }
      }
    }
  }
  const remapAttempt = <T extends RoomAgentDelivery | RoomAgentDeliveryAttempt>(attempt: T): T => ({
    ...attempt,
    agentTurnId: agentTurnIds.get(attempt.agentTurnId)!,
    dispatchAttemptId: attempt.dispatchAttemptId
      ? dispatchAttemptIds.get(attempt.dispatchAttemptId)
      : undefined,
  } as T);
  const messages = collaboration.messages.map((message): RoomUserMessage => ({
    ...message,
    id: roomMessageIds.get(message.id)!,
    recipientAgentIds: message.recipientAgentIds.map((id) => roomAgentIds.get(id)!),
    deliveries: Object.fromEntries(Object.entries(message.deliveries).map(([roomAgentId, delivery]) => {
      const mappedAgentId = roomAgentIds.get(roomAgentId)!;
      return [mappedAgentId, {
        ...remapAttempt(delivery),
        contextShare: delivery.contextShare ? {
          ...delivery.contextShare,
          bridgeId: `room-context:${mappedAgentId}`,
          entryIds: delivery.contextShare.entryIds.map((entryId) => {
            if (!entryId.startsWith("user:")) return entryId;
            const sourceId = entryId.slice("user:".length);
            return `user:${roomMessageIds.get(sourceId) ?? sourceId}`;
          }),
        } : undefined,
        previousAttempts: delivery.previousAttempts?.map((attempt) => remapAttempt(attempt)),
      }];
    })),
  }));
  const agents = collaboration.agents.map((agent) => ({
    ...agent,
    id: roomAgentIds.get(agent.id)!,
    runtimeSessionId: undefined,
    officialSessionId: undefined,
    skillRegistrySyncedAt: undefined,
    skillForkParentSessionId: undefined,
    officialCatalogConfirmedAt: undefined,
    swarmModeLockedAt: undefined,
    swarmMode: undefined,
    swarmModeDesired: undefined,
    subagentRoutingDesired: agent.subagentRoutingDesired ?? (
      agent.subagentModelAlias || agent.subagentThinkingEffort
        ? {
            modelAlias: agent.subagentModelAlias ?? null,
            thinkingEffort: agent.subagentThinkingEffort ?? null,
          }
        : undefined
    ),
    modelSwitchedAt: undefined,
    switchedToModel: undefined,
    officialGoal: undefined,
    missingSince: undefined,
    recoveryIssue: undefined,
    lifecycleIssue: undefined,
    contextBridgeId: `room-context:${roomAgentIds.get(agent.id)!}`,
  }));
  const remapped: CollaborationState = {
    ...collaboration,
    primaryMirrorUpdatedAt: Date.now(),
    primaryAgentId: roomAgentIds.get(collaboration.primaryAgentId)!,
    defaultRecipientIds: collaboration.defaultRecipientIds.map((id) => roomAgentIds.get(id)!),
    focusedAgentId: collaboration.focusedAgentId ? roomAgentIds.get(collaboration.focusedAgentId) : undefined,
    agents,
    messages,
    agentEvents: Object.fromEntries(Object.entries(collaboration.agentEvents).map(([roomAgentId, events]) => [
      roomAgentIds.get(roomAgentId)!,
      events.map((event) => remapTimelineEvent(event, roomAgentIds, roomMessageIds, agentTurnIds, dispatchAttemptIds)),
    ])),
  };
  if (!validateCollaborationReferences(remapped)) throw new Error("导入副本的房间身份重映射结果无效");
  return { collaboration: remapped, roomAgentIds, roomMessageIds, agentTurnIds, dispatchAttemptIds };
}

function createImportedSessionCopy(imported: Session, existingIds: Set<string>) {
  let id = `kimix-import-${crypto.randomUUID()}`;
  while (existingIds.has(id)) id = `kimix-import-${crypto.randomUUID()}`;
  existingIds.add(id);
  const remapped = imported.collaboration ? remapCollaborationForImportedCopy(imported.collaboration, id) : null;
  let session: Session = {
    ...imported,
    id,
    runtimeSessionId: undefined,
    officialSessionId: undefined,
    skillRegistrySyncedAt: undefined,
    skillForkParentSessionId: undefined,
    officialCatalogConfirmedAt: undefined,
    swarmModeLockedAt: undefined,
    swarmMode: undefined,
    swarmModeDesired: undefined,
    subagentRoutingDesired: imported.subagentRoutingDesired ?? (
      imported.subagentModelAlias || imported.subagentThinkingEffort
        ? {
            modelAlias: imported.subagentModelAlias ?? null,
            thinkingEffort: imported.subagentThinkingEffort ?? null,
          }
        : undefined
    ),
    modelSwitchedAt: undefined,
    switchedToModel: undefined,
    longTask: undefined,
    officialGoal: undefined,
    collaboration: remapped?.collaboration,
    unsupportedCollaboration: undefined,
    title: imported.title.endsWith("（导入副本）") ? imported.title : `${imported.title}（导入副本）`,
    isLoading: false,
  };
  if (session.collaboration) session = synchronizeCollaborationPrimaryMirror(session);
  return {
    session,
    identityMap: remapped ? {
      targetSessionId: id,
      roomAgentIds: remapped.roomAgentIds,
      roomMessageIds: remapped.roomMessageIds,
      agentTurnIds: remapped.agentTurnIds,
      dispatchAttemptIds: remapped.dispatchAttemptIds,
    } satisfies SessionImportIdentityMap : {
      targetSessionId: id,
      roomAgentIds: new Map(),
      roomMessageIds: new Map(),
      agentTurnIds: new Map(),
      dispatchAttemptIds: new Map(),
    } satisfies SessionImportIdentityMap,
  };
}

function hasString(record: Record<string, unknown>, key: string) {
  return typeof record[key] === "string";
}

function hasArray(record: Record<string, unknown>, key: string) {
  return Array.isArray(record[key]);
}

function isValidTimelineEvent(event: Record<string, unknown>): boolean {
  if (!hasString(event, "id") || typeof event.timestamp !== "number") return false;
  const type = event.type;
  if (typeof type !== "string") return false;
  switch (type) {
    case "user_message":
      return hasString(event, "content");
    case "steer_message":
      return hasString(event, "content") && ["sending", "accepted", "sent", "failed"].includes(event.status as string);
    case "assistant_message":
      return hasString(event, "content") && typeof event.isThinking === "boolean" && typeof event.isComplete === "boolean";
    case "tool_call":
      return hasString(event, "toolCallId") && hasString(event, "toolName") && ["running", "success", "error"].includes(event.status as string) && isRecord(event.arguments);
    case "tool_result":
      return hasString(event, "toolCallId") && hasString(event, "toolName") && "result" in event;
    case "approval_request":
      return hasString(event, "requestId") && hasString(event, "toolName") && hasString(event, "description") && hasString(event, "details") && ["low", "medium", "high"].includes(event.riskLevel as string) && ["pending", "approved", "rejected"].includes(event.status as string);
    case "question_request":
      return hasString(event, "requestId") && hasString(event, "rpcRequestId") && hasString(event, "toolCallId") && hasArray(event, "questions");
    case "file_artifact":
      return hasString(event, "filePath");
    case "change_summary":
      return hasArray(event, "files") && typeof event.additions === "number" && typeof event.deletions === "number";
    case "session_recommendation":
      return hasString(event, "reason") && typeof event.turnCount === "number" && typeof event.turnLimit === "number";
    case "subagent":
      return hasString(event, "agentName") && ["queued", "running", "suspended", "completed", "error"].includes(event.status as string) && hasArray(event, "events");
    case "compaction":
      return ["begin", "end"].includes(event.phase as string);
    case "error":
      return hasString(event, "message");
    case "diff":
      return hasString(event, "filePath") && hasString(event, "oldText") && hasString(event, "newText");
    case "todo":
      return hasArray(event, "items");
    case "hook":
      return ["triggered", "resolved"].includes(event.phase as string) && hasString(event, "eventName") && hasString(event, "target");
    case "status_update":
      return true;
    default:
      // 未知事件类型：保留，但要求有 id 和 timestamp 这一层最基础字段
      return true;
  }
}

function normalizeTimelineEvents(value: unknown): TimelineEvent[] {
  if (!Array.isArray(value)) return [];
  return value.filter((event): event is TimelineEvent => (
    isRecord(event) && isValidTimelineEvent(event)
  ));
}

function normalizeImportedSession(value: unknown, schemaVersion: number): Session | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const title = stringValue(value.title, "新会话");
  const projectPath = stringValue(value.projectPath);
  if (!id || !projectPath) return null;
  const createdAt = numberValue(value.createdAt, Date.now());
  const updatedAt = numberValue(value.updatedAt, createdAt);
  const engine = value.engine === "prompt" || value.engine === "kimi-code" ? value.engine : undefined;
  const base = value as Partial<Session>;
  const normalized: Session = {
    ...base,
    id,
    engine,
    runtimeSessionId: optionalString(value.runtimeSessionId),
    officialSessionId: optionalString(value.officialSessionId),
    titleLocked: value.titleLocked === true ? true : undefined,
    model: typeof value.model === "string" || value.model === null ? value.model : undefined,
    permissionMode: value.permissionMode === "manual" || value.permissionMode === "auto" || value.permissionMode === "yolo"
      ? value.permissionMode
      : undefined,
    planMode: typeof value.planMode === "boolean" ? value.planMode : undefined,
    longTask: isRecord(value.longTask) ? value.longTask as unknown as Session["longTask"] : undefined,
    title,
    projectPath,
    createdAt,
    updatedAt,
    archivedAt: optionalNumber(value.archivedAt),
    btwRounds: Array.isArray(value.btwRounds) ? value.btwRounds as Session["btwRounds"] : undefined,
    officialGoal: isRecord(value.officialGoal) ? value.officialGoal as unknown as Session["officialGoal"] : undefined,
    collaboration: undefined,
    unsupportedCollaboration: undefined,
    events: normalizeTimelineEvents(value.events),
    isLoading: false,
  };
  if (schemaVersion === LEGACY_SESSION_BACKUP_SCHEMA_VERSION || value.collaboration === undefined) return normalized;
  if (value.unsupportedCollaboration !== undefined) return null;
  if (!rawCollaborationReferencesAreConsistent(value.collaboration)) return null;
  const withCollaboration = normalizeLoadedSessionCollaboration({
    ...normalized,
    collaboration: value.collaboration as Session["collaboration"],
  });
  if (!withCollaboration.collaboration || withCollaboration.unsupportedCollaboration) return null;
  return validateCollaborationReferences(withCollaboration.collaboration) ? withCollaboration : null;
}

function normalizePendingMessage(value: unknown): PendingMessage | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const sessionId = stringValue(value.sessionId);
  const content = typeof value.content === "string" ? value.content : "";
  const createdAt = optionalNumber(value.createdAt);
  if (!id || !sessionId || !createdAt) return null;
  const images = Array.isArray(value.images)
    ? value.images.filter((image): image is UserMessageImage => isRecord(image) && typeof image.name === "string")
    : undefined;
  return {
    id,
    sessionId,
    content,
    createdAt,
    images,
    roomAgentId: optionalString(value.roomAgentId),
    roomMessageId: optionalString(value.roomMessageId),
    agentTurnId: optionalString(value.agentTurnId),
    recipientAgentIds: Array.isArray(value.recipientAgentIds)
      ? uniqueStrings(value.recipientAgentIds.map((id) => typeof id === "string" ? id : undefined))
      : undefined,
  };
}

const ROOM_AGENT_ACTIVITY_STATUSES = new Set<RoomAgentActivity["status"]>([
  "idle",
  "creating",
  "queued",
  "sending",
  "running",
  "waiting_approval",
  "waiting_question",
  "completed",
  "interrupted",
  "error",
]);

function normalizeRoomAgentActivity(value: unknown): RoomAgentActivity | null {
  if (!isRecord(value)) return null;
  const roomId = stringValue(value.roomId);
  const roomAgentId = stringValue(value.roomAgentId);
  const updatedAt = optionalNumber(value.updatedAt);
  if (!roomId || !roomAgentId || !updatedAt || !ROOM_AGENT_ACTIVITY_STATUSES.has(value.status as RoomAgentActivity["status"])) {
    return null;
  }
  return {
    roomId,
    roomAgentId,
    runtimeSessionId: optionalString(value.runtimeSessionId),
    status: value.status as RoomAgentActivity["status"],
    roomMessageId: optionalString(value.roomMessageId),
    activeTurnId: optionalString(value.activeTurnId),
    startedAt: optionalNumber(value.startedAt),
    updatedAt,
  };
}

function normalizeProject(value: unknown): Project | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const name = stringValue(value.name);
  const projectPath = stringValue(value.path);
  const lastOpenedAt = optionalNumber(value.lastOpenedAt);
  if (!id || !name || !projectPath || !lastOpenedAt) return null;
  return {
    id,
    name,
    path: projectPath,
    lastOpenedAt,
    gitBranch: optionalString(value.gitBranch),
    pinned: value.pinned === true ? true : undefined,
    sortOrder: optionalNumber(value.sortOrder),
  };
}

function normalizeSnapshot(snapshot: SessionBackupSnapshot): SessionBackupSnapshot {
  const schemaVersion = numberValue(snapshot.schemaVersion, LEGACY_SESSION_BACKUP_SCHEMA_VERSION);
  if (schemaVersion !== LEGACY_SESSION_BACKUP_SCHEMA_VERSION && schemaVersion !== SESSION_BACKUP_SCHEMA_VERSION) {
    throw new Error(`当前 Kimix 不支持会话备份 schema ${schemaVersion}`);
  }
  return {
    schemaVersion,
    appVersion: optionalString(snapshot.appVersion),
    exportedAt: optionalString(snapshot.exportedAt),
    source: optionalString(snapshot.source),
    sessions: Array.isArray(snapshot.sessions) ? snapshot.sessions : [],
    pendingMessages: Array.isArray(snapshot.pendingMessages) ? snapshot.pendingMessages : [],
    projects: Array.isArray(snapshot.projects) ? snapshot.projects : [],
    archivedTombstones: Array.isArray(snapshot.archivedTombstones) ? snapshot.archivedTombstones : [],
    hiddenHandoffSessionIds: Array.isArray(snapshot.hiddenHandoffSessionIds)
      ? uniqueStrings(snapshot.hiddenHandoffSessionIds.map((id) => (typeof id === "string" ? id : undefined)))
      : [],
    roomAgentActivities: schemaVersion === SESSION_BACKUP_SCHEMA_VERSION && Array.isArray(snapshot.roomAgentActivities)
      ? snapshot.roomAgentActivities
      : [],
    activeContext: snapshot.activeContext,
  };
}

export function buildSessionBackupSnapshot(appVersion: string): SessionBackupSnapshot {
  const sessionState = useSessionStore.getState();
  const appState = useAppStore.getState();
  const sessions = sessionState.sessions
    .filter((session) => !isHiddenInternalSession(session))
    .map((session) => {
      if (session.unsupportedCollaboration) {
        throw new Error(`会话“${session.title}”包含当前版本无法安全导出的协同结构`);
      }
      const prepared = session.collaboration ? synchronizeCollaborationPrimaryMirror(session) : session;
      if (prepared.collaboration && !validateCollaborationReferences(prepared.collaboration)) {
        throw new Error(`会话“${session.title}”的协同引用关系损坏，已停止导出`);
      }
      return { ...prepared, isLoading: false };
    });
  const exportedSessionIds = new Set(sessions.map((session) => session.id));
  const generatedTombstones = sessions
    .map((session) => makeArchivedTombstone(session))
    .filter((item): item is ArchivedSessionTombstone => Boolean(item));
  return {
    schemaVersion: SESSION_BACKUP_SCHEMA_VERSION,
    appVersion,
    exportedAt: new Date().toISOString(),
    source: "Kimix",
    sessions,
    pendingMessages: sessionState.pendingMessages,
    projects: sessionState.recentProjects,
    archivedTombstones: mergeArchivedTombstones([...getArchivedSessionTombstones(), ...generatedTombstones]),
    hiddenHandoffSessionIds: getHiddenHandoffSessionIds(),
    roomAgentActivities: Object.values(appState.roomAgentActivities).filter((activity) => exportedSessionIds.has(activity.roomId)),
    activeContext: readJsonFromLocalStorage(LOCAL_ACTIVE_CONTEXT_KEY, null),
  };
}

function mergeCollaborationStates(
  local: CollaborationState,
  imported: CollaborationState,
  importedNewer: boolean,
) {
  const agentEvents: Record<string, TimelineEvent[]> = {};
  let addedEvents = 0;
  for (const agent of local.agents) {
    const merged = mergeTimelineEvents(local.agentEvents[agent.id], imported.agentEvents[agent.id]);
    agentEvents[agent.id] = merged.events.map((event) => scopeEventToRoomAgent(event, agent.id));
    addedEvents += merged.added;
  }
  const messageIds = new Set<string>();
  const messages: RoomUserMessage[] = [];
  const preferredMessages = importedNewer
    ? [...imported.messages, ...local.messages]
    : [...local.messages, ...imported.messages];
  for (const message of preferredMessages) {
    if (messageIds.has(message.id)) continue;
    messageIds.add(message.id);
    messages.push(message);
  }
  messages.sort((left, right) => left.timestamp - right.timestamp);
  const preferred = importedNewer ? imported : local;
  const agents = local.agents.map((localAgent) => {
    const importedAgent = imported.agents.find((agent) => agent.id === localAgent.id)!;
    const base = importedNewer ? importedAgent : localAgent;
    return {
      ...base,
      runtimeSessionId: localAgent.runtimeSessionId ?? importedAgent.runtimeSessionId,
      officialSessionId: localAgent.officialSessionId ?? importedAgent.officialSessionId,
      officialCatalogConfirmedAt: localAgent.officialCatalogConfirmedAt ?? importedAgent.officialCatalogConfirmedAt,
      missingSince: localAgent.missingSince ?? importedAgent.missingSince,
      recoveryIssue: localAgent.recoveryIssue ?? importedAgent.recoveryIssue,
      contextBridgeId: localAgent.contextBridgeId ?? importedAgent.contextBridgeId,
    };
  });
  return {
    collaboration: {
      ...preferred,
      primaryMirrorUpdatedAt: Math.max(local.primaryMirrorUpdatedAt, imported.primaryMirrorUpdatedAt),
      agents,
      messages,
      agentEvents,
    } satisfies CollaborationState,
    addedEvents,
    changed: addedEvents > 0 || messages.length !== local.messages.length || importedNewer,
  };
}

function mergeSession(local: Session, imported: Session) {
  const eventMerge = mergeTimelineEvents(local.events, imported.events);
  const importedNewer = imported.updatedAt > local.updatedAt;
  const localLooksLikePlaceholder = local.events.length === 0 && local.updatedAt <= imported.updatedAt;
  const archivedAt = local.archivedAt
    ? (imported.archivedAt ? Math.max(local.archivedAt, imported.archivedAt) : local.archivedAt)
    : (imported.archivedAt && localLooksLikePlaceholder ? imported.archivedAt : undefined);
  let merged: Session = {
    ...local,
    engine: local.engine ?? imported.engine,
    runtimeSessionId: local.runtimeSessionId ?? imported.runtimeSessionId,
    officialSessionId: local.officialSessionId ?? imported.officialSessionId,
    titleLocked: local.titleLocked ?? imported.titleLocked,
    model: local.model ?? imported.model,
    permissionMode: importedNewer ? (imported.permissionMode ?? local.permissionMode) : (local.permissionMode ?? imported.permissionMode),
    planMode: importedNewer ? (imported.planMode ?? local.planMode) : (local.planMode ?? imported.planMode),
    longTask: local.longTask ?? imported.longTask,
    btwRounds: local.btwRounds ?? imported.btwRounds,
    officialGoal: importedNewer ? (imported.officialGoal ?? local.officialGoal) : (local.officialGoal ?? imported.officialGoal),
    title: local.titleLocked || (!importedNewer && local.title.trim()) ? local.title : imported.title,
    projectPath: local.projectPath || imported.projectPath,
    createdAt: Math.min(local.createdAt, imported.createdAt),
    updatedAt: Math.max(local.updatedAt, imported.updatedAt),
    archivedAt,
    events: eventMerge.events,
    isLoading: false,
  };
  let addedEvents = eventMerge.added;
  let collaborationChanged = false;
  if (local.collaboration && imported.collaboration) {
    const collaborationMerge = mergeCollaborationStates(local.collaboration, imported.collaboration, importedNewer);
    merged = { ...merged, collaboration: collaborationMerge.collaboration };
    addedEvents = collaborationMerge.addedEvents;
    collaborationChanged = collaborationMerge.changed;
  } else if (local.collaboration || imported.collaboration) {
    const collaboration = local.collaboration ?? imported.collaboration!;
    merged = {
      ...merged,
      collaboration: {
        ...collaboration,
        agentEvents: {
          ...collaboration.agentEvents,
          [collaboration.primaryAgentId]: eventMerge.events.map((event) => scopeEventToRoomAgent(event, collaboration.primaryAgentId)),
        },
      },
    };
    collaborationChanged = Boolean(imported.collaboration && !local.collaboration);
  }
  if (merged.collaboration) merged = synchronizeCollaborationPrimaryMirror(merged);
  const changed =
    addedEvents > 0 ||
    collaborationChanged ||
    importedNewer ||
    (!local.runtimeSessionId && Boolean(imported.runtimeSessionId)) ||
    (!local.officialSessionId && Boolean(imported.officialSessionId)) ||
    local.archivedAt !== merged.archivedAt;
  return { session: merged, changed, addedEvents };
}

function mergeProjects(localProjects: Project[], importedProjects: Project[]) {
  const next = [...localProjects];
  const projectsToPersist: Project[] = [];
  const stats = { addedProjects: 0, updatedProjects: 0, skippedProjects: 0 };
  const findIndex = (project: Project) => {
    const pathKey = normalizePathForBackup(project.path);
    return next.findIndex((item) => item.id === project.id || normalizePathForBackup(item.path) === pathKey);
  };
  for (const project of importedProjects) {
    const index = findIndex(project);
    if (index < 0) {
      next.push(project);
      projectsToPersist.push(project);
      stats.addedProjects += 1;
      continue;
    }
    const current = next[index];
    if (project.lastOpenedAt > current.lastOpenedAt) {
      const merged = {
        ...current,
        ...project,
        pinned: current.pinned ?? project.pinned,
        sortOrder: current.sortOrder ?? project.sortOrder,
      };
      next[index] = merged;
      projectsToPersist.push(merged);
      stats.updatedProjects += 1;
    } else {
      stats.skippedProjects += 1;
    }
  }
  return { projects: next, projectsToPersist, stats };
}

function mergePendingMessages(
  localPending: PendingMessage[],
  importedPending: PendingMessage[],
  validSessionIds: Set<string>,
  identityMaps: Map<string, SessionImportIdentityMap>,
) {
  const next = [...localPending];
  let addedPendingMessages = 0;
  let skippedPendingMessages = 0;
  const ids = new Set(next.map((message) => message.id));
  const signatures = new Set(next.map((message) => `${message.sessionId}\n${message.createdAt}\n${message.content}`));
  for (const message of importedPending) {
    const identityMap = identityMaps.get(message.sessionId);
    const targetSessionId = identityMap?.targetSessionId ?? message.sessionId;
    if (!validSessionIds.has(targetSessionId)) {
      skippedPendingMessages += 1;
      continue;
    }
    const mapReference = (value: string | undefined, map: ReadonlyMap<string, string>) => {
      if (!value) return undefined;
      return map.get(value);
    };
    const roomAgentId = mapReference(message.roomAgentId, identityMap?.roomAgentIds ?? new Map());
    const roomMessageId = mapReference(message.roomMessageId, identityMap?.roomMessageIds ?? new Map());
    const agentTurnId = mapReference(message.agentTurnId, identityMap?.agentTurnIds ?? new Map());
    const recipientAgentIds = message.recipientAgentIds?.map((id) => identityMap?.roomAgentIds.get(id)).filter((id): id is string => Boolean(id));
    if (
      (message.roomAgentId && !roomAgentId) ||
      (message.roomMessageId && !roomMessageId) ||
      (message.agentTurnId && !agentTurnId) ||
      (message.recipientAgentIds && recipientAgentIds?.length !== message.recipientAgentIds.length)
    ) {
      skippedPendingMessages += 1;
      continue;
    }
    let id = message.id;
    if (ids.has(id) && targetSessionId !== message.sessionId) {
      id = `pending:${crypto.randomUUID()}`;
      while (ids.has(id)) id = `pending:${crypto.randomUUID()}`;
    }
    const normalizedMessage: PendingMessage = {
      ...message,
      id,
      sessionId: targetSessionId,
      roomAgentId,
      roomMessageId,
      agentTurnId,
      recipientAgentIds,
    };
    const signature = `${normalizedMessage.sessionId}\n${normalizedMessage.createdAt}\n${normalizedMessage.content}`;
    if (ids.has(normalizedMessage.id) || signatures.has(signature)) {
      skippedPendingMessages += 1;
      continue;
    }
    next.push(normalizedMessage);
    ids.add(normalizedMessage.id);
    signatures.add(signature);
    addedPendingMessages += 1;
  }
  return { pendingMessages: next, addedPendingMessages, skippedPendingMessages };
}

function mergeRoomAgentActivities(
  localActivities: Record<string, RoomAgentActivity>,
  importedActivities: RoomAgentActivity[],
  identityMaps: ReadonlyMap<string, SessionImportIdentityMap>,
  sessions: Session[],
) {
  const next = { ...localActivities };
  let imported = 0;
  const activeStatuses = new Set<RoomAgentActivity["status"]>([
    "creating",
    "queued",
    "sending",
    "running",
    "waiting_approval",
    "waiting_question",
  ]);
  for (const activity of importedActivities) {
    const identityMap = identityMaps.get(activity.roomId);
    if (!identityMap) continue;
    const roomAgentId = identityMap.roomAgentIds.get(activity.roomAgentId);
    const roomMessageId = activity.roomMessageId
      ? identityMap.roomMessageIds.get(activity.roomMessageId)
      : undefined;
    const activeTurnId = activity.activeTurnId
      ? identityMap.agentTurnIds.get(activity.activeTurnId)
      : undefined;
    if (!roomAgentId || (activity.roomMessageId && !roomMessageId) || (activity.activeTurnId && !activeTurnId)) continue;
    const target = sessions.find((session) => session.id === identityMap.targetSessionId);
    if (!target?.collaboration?.agents.some((agent) => agent.id === roomAgentId)) continue;
    const key = roomAgentActivityKey(target.id, roomAgentId);
    if (next[key]) continue;
    next[key] = {
      ...activity,
      roomId: target.id,
      roomAgentId,
      runtimeSessionId: undefined,
      status: activeStatuses.has(activity.status) ? "interrupted" : activity.status,
      roomMessageId,
      activeTurnId,
    };
    imported += 1;
  }
  return { roomAgentActivities: next, imported };
}

export function createSessionBackupImportPlan(rawSnapshot: SessionBackupSnapshot): SessionBackupImportPlan {
  const snapshot = normalizeSnapshot(rawSnapshot);
  const importedSessions = snapshot.sessions.flatMap((rawSession): Session[] => {
    const session = normalizeImportedSession(rawSession, snapshot.schemaVersion);
    if (!session) {
      if (snapshot.schemaVersion === SESSION_BACKUP_SCHEMA_VERSION && isRecord(rawSession) && rawSession.collaboration !== undefined) {
        throw new Error(`协同房间备份损坏或引用关系无效：${stringValue(rawSession.title, stringValue(rawSession.id, "未知会话"))}`);
      }
      return [];
    }
    return isHiddenInternalSession(session) ? [] : [session];
  });
  const importedPending = snapshot.pendingMessages
    .map(normalizePendingMessage)
    .filter((message): message is PendingMessage => Boolean(message));
  const importedProjects = snapshot.projects
    .map(normalizeProject)
    .filter((project): project is Project => Boolean(project));
  const importedTombstones = snapshot.archivedTombstones
    .map(normalizeArchivedTombstone)
    .filter((tombstone): tombstone is ArchivedSessionTombstone => Boolean(tombstone));
  const importedActivities = (snapshot.roomAgentActivities ?? [])
    .map(normalizeRoomAgentActivity)
    .filter((activity): activity is RoomAgentActivity => Boolean(activity));

  const currentState = useSessionStore.getState();
  const currentAppState = useAppStore.getState();
  const hiddenCurrentSessions = currentState.sessions.filter((session) => isHiddenInternalSession(session));
  const nextSessions = currentState.sessions.filter((session) => !isHiddenInternalSession(session));
  const identityMaps = new Map<string, SessionImportIdentityMap>();
  const sourceIdentityMaps = new Map<string, SessionImportIdentityMap>();
  const rememberIdentityMap = (session: Session, identityMap: SessionImportIdentityMap) => {
    identityMaps.set(session.id, identityMap);
    for (const key of sessionIdentityKeys(session)) sourceIdentityMaps.set(key, identityMap);
  };
  const existingSessionIds = new Set(nextSessions.map((session) => session.id));
  const lookup = new Map<string, number>();
  const rememberSessionIndex = (session: Session, index: number) => {
    for (const key of sessionIdentityKeys(session)) lookup.set(key, index);
  };
  nextSessions.forEach(rememberSessionIndex);

  const stats: SessionBackupImportStats = {
    importedSessions: importedSessions.length,
    addedSessions: 0,
    updatedSessions: 0,
    skippedSessions: 0,
    forkedSessions: 0,
    mergedEvents: 0,
    importedArchivedSessions: importedSessions.filter((session) => session.archivedAt).length,
    importedArchivedTombstones: 0,
    archivedTombstones: 0,
    addedProjects: 0,
    updatedProjects: 0,
    skippedProjects: 0,
    addedPendingMessages: 0,
    skippedPendingMessages: 0,
    importedRoomAgentActivities: 0,
    hiddenHandoffSessionIds: 0,
  };

  for (const imported of importedSessions) {
    const matchIndex = sessionIdentityKeys(imported)
      .map((key) => lookup.get(key))
      .find((index): index is number => typeof index === "number");
    if (matchIndex === undefined) {
      const index = nextSessions.length;
      nextSessions.push(imported);
      rememberSessionIndex(imported, index);
      existingSessionIds.add(imported.id);
      rememberIdentityMap(imported, createIdentityMap(imported, imported.id));
      stats.addedSessions += 1;
      continue;
    }
    if (shouldForkImportedSession(nextSessions[matchIndex], imported)) {
      const copy = createImportedSessionCopy(imported, existingSessionIds);
      nextSessions.push(copy.session);
      rememberIdentityMap(imported, copy.identityMap);
      stats.addedSessions += 1;
      stats.forkedSessions += 1;
      continue;
    }
    const merged = mergeSession(nextSessions[matchIndex], imported);
    nextSessions[matchIndex] = merged.session;
    rememberSessionIndex(merged.session, matchIndex);
    rememberIdentityMap(imported, createIdentityMap(imported, merged.session.id));
    stats.mergedEvents += merged.addedEvents;
    if (merged.changed) stats.updatedSessions += 1;
    else stats.skippedSessions += 1;
  }

  const sortedVisibleSessions = [...nextSessions].sort((a, b) => b.updatedAt - a.updatedAt);
  const finalSessions = [...sortedVisibleSessions, ...hiddenCurrentSessions];
  const projectMerge = mergeProjects(currentState.recentProjects, importedProjects);
  stats.addedProjects = projectMerge.stats.addedProjects;
  stats.updatedProjects = projectMerge.stats.updatedProjects;
  stats.skippedProjects = projectMerge.stats.skippedProjects;

  const validSessionIds = new Set(finalSessions.map((session) => session.id));
  const pendingMerge = mergePendingMessages(currentState.pendingMessages, importedPending, validSessionIds, identityMaps);
  stats.addedPendingMessages = pendingMerge.addedPendingMessages;
  stats.skippedPendingMessages = pendingMerge.skippedPendingMessages;
  const activityMerge = mergeRoomAgentActivities(
    currentAppState.roomAgentActivities,
    importedActivities,
    identityMaps,
    finalSessions,
  );
  stats.importedRoomAgentActivities = activityMerge.imported;

  const activeIdentityKeys = new Set(finalSessions
    .filter((session) => !session.archivedAt)
    .flatMap((session) => sessionIdentityKeys(session)));
  const safeImportedTombstones = importedTombstones.filter((tombstone) => (
    !tombstone.ids.some((id) => activeIdentityKeys.has(id))
  ));
  stats.importedArchivedTombstones = safeImportedTombstones.length;
  const generatedTombstones = finalSessions
    .map((session) => makeArchivedTombstone(session))
    .filter((item): item is ArchivedSessionTombstone => Boolean(item));
  const archivedTombstones = mergeArchivedTombstones([
    ...getArchivedSessionTombstones(),
    ...safeImportedTombstones,
    ...generatedTombstones,
  ]);
  stats.archivedTombstones = archivedTombstones.length;

  const hiddenHandoffSessionIds = uniqueStrings([
    ...getHiddenHandoffSessionIds(),
    ...snapshot.hiddenHandoffSessionIds.map((id) => sourceIdentityMaps.get(id)?.targetSessionId ?? id),
  ]).slice(-200);
  stats.hiddenHandoffSessionIds = hiddenHandoffSessionIds.length;
  const activeContext = isRecord(snapshot.activeContext) && typeof snapshot.activeContext.sessionId === "string"
    ? {
      ...snapshot.activeContext,
      sessionId: sourceIdentityMaps.get(snapshot.activeContext.sessionId)?.targetSessionId ?? snapshot.activeContext.sessionId,
    }
    : snapshot.activeContext;

  return {
    snapshot: { ...snapshot, activeContext },
    sessions: finalSessions,
    pendingMessages: pendingMerge.pendingMessages,
    roomAgentActivities: activityMerge.roomAgentActivities,
    projects: projectMerge.projects,
    projectsToPersist: projectMerge.projectsToPersist,
    archivedTombstones,
    hiddenHandoffSessionIds,
    stats,
  };
}

export function hasSessionBackupImportChanges(stats: SessionBackupImportStats) {
  return (
    stats.addedSessions > 0 ||
    stats.updatedSessions > 0 ||
    stats.forkedSessions > 0 ||
    stats.addedProjects > 0 ||
    stats.updatedProjects > 0 ||
    stats.addedPendingMessages > 0 ||
    stats.importedRoomAgentActivities > 0 ||
    stats.importedArchivedTombstones > 0 ||
    stats.archivedTombstones > getArchivedSessionTombstones().length ||
    stats.hiddenHandoffSessionIds > getHiddenHandoffSessionIds().length
  );
}

export function formatSessionBackupImportSummary(plan: SessionBackupImportPlan) {
  const { stats, snapshot } = plan;
  const exportedAt = snapshot.exportedAt ? `\n导出时间：${snapshot.exportedAt}` : "";
  return [
    "将以去重合并方式导入 Kimix 会话快照：",
    exportedAt,
    `新增会话：${stats.addedSessions}`,
    `更新会话：${stats.updatedSessions}`,
    `分叉副本：${stats.forkedSessions}`,
    `跳过重复会话：${stats.skippedSessions}`,
    `合并新增消息事件：${stats.mergedEvents}`,
    `归档会话保持归档：${stats.importedArchivedSessions}`,
    `导入归档屏蔽记录：${stats.importedArchivedTombstones}`,
    `合并后归档屏蔽记录：${stats.archivedTombstones}`,
    `新增/更新项目：${stats.addedProjects + stats.updatedProjects}`,
    `新增待发送队列：${stats.addedPendingMessages}`,
    `恢复 Agent 活动引用：${stats.importedRoomAgentActivities}`,
    "",
    "本地已有且更新的内容会优先保留。继续导入吗？",
  ].filter(Boolean).join("\n");
}

export async function applySessionBackupImportPlan(plan: SessionBackupImportPlan) {
  localStorage.setItem(LOCAL_ARCHIVED_SESSION_TOMBSTONES_KEY, JSON.stringify(plan.archivedTombstones.slice(-MAX_ARCHIVED_TOMBSTONES)));
  localStorage.setItem(HIDDEN_HANDOFF_SESSION_KEY, JSON.stringify(plan.hiddenHandoffSessionIds.slice(-200)));
  if (plan.snapshot.activeContext && !localStorage.getItem(LOCAL_ACTIVE_CONTEXT_KEY)) {
    localStorage.setItem(LOCAL_ACTIVE_CONTEXT_KEY, JSON.stringify(plan.snapshot.activeContext));
  }

  useSessionStore.setState({
    sessions: plan.sessions,
    pendingMessages: plan.pendingMessages,
    recentProjects: plan.projects,
  });
  useAppStore.setState({ roomAgentActivities: plan.roomAgentActivities });

  const currentSession = useAppStore.getState().currentSession;
  if (currentSession) {
    const currentKeys = sessionIdentityKeys(currentSession);
    const updatedCurrent = plan.sessions.find((session) => sessionIdentityKeys(session).some((key) => currentKeys.includes(key)));
    if (updatedCurrent) useAppStore.getState().setCurrentSession(updatedCurrent);
  }

  for (const project of plan.projectsToPersist) {
    await window.api.addRecentProject(project).catch(() => undefined);
  }
  await persistLocalConversationState();
}
