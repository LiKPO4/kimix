import type {
  RoomAgentDelivery,
  RoomAgentDeliveryAttempt,
  RoomAgentDeliveryStatus,
  RoomAgentActivity,
  RoomUserMessage,
  Session,
  UserMessageImage,
} from "@/types/ui";
import { getRoomAgent, getRoomAgentEvents } from "@/utils/collaborationRooms";

type DeliveryIdentityFactory = (kind: "message" | "attempt" | "turn", roomAgentId?: string) => string;

export interface CreateRoomMessageInput {
  content: string;
  outboundContent?: string;
  images?: UserMessageImage[];
  recipientAgentIds: string[];
  timestamp?: number;
  createId?: DeliveryIdentityFactory;
}

export type RoomDeliveryOfficialEvidence = {
  accepted: true;
  officialPromptId?: string;
  officialUserEventId?: string;
} | {
  accepted: false;
  error?: string;
};

export type RoomDeliverySendResult = {
  success: true;
  officialPromptId?: string;
  officialUserEventId?: string;
} | {
  success: false;
  certainty: "not-sent" | "unknown";
  error: string;
};

export type RoomDeliveryPersistResult = { success: true } | { success: false; error: string };

function defaultCreateId(kind: "message" | "attempt" | "turn", roomAgentId?: string): string {
  return kind + ":" + (roomAgentId ? roomAgentId + ":" : "") + crypto.randomUUID();
}

function updateDelivery(
  session: Session,
  roomMessageId: string,
  roomAgentId: string,
  updater: (delivery: RoomAgentDelivery) => RoomAgentDelivery,
  updatedAt = Date.now(),
): Session {
  if (!session.collaboration) return session;
  const messageIndex = session.collaboration.messages.findIndex((message) => message.id === roomMessageId);
  if (messageIndex < 0) return session;
  const message = session.collaboration.messages[messageIndex];
  const delivery = message.deliveries[roomAgentId];
  if (!delivery) return session;
  const messages = [...session.collaboration.messages];
  messages[messageIndex] = {
    ...message,
    deliveries: {
      ...message.deliveries,
      [roomAgentId]: updater(delivery),
    },
  };
  return {
    ...session,
    collaboration: { ...session.collaboration, messages },
    updatedAt,
  };
}

function attemptSnapshot(delivery: RoomAgentDelivery, now: number): RoomAgentDeliveryAttempt {
  return {
    dispatchAttemptId: delivery.dispatchAttemptId ?? "legacy:" + delivery.agentTurnId,
    agentTurnId: delivery.agentTurnId,
    status: delivery.status,
    officialPromptId: delivery.officialPromptId,
    officialUserEventId: delivery.officialUserEventId,
    error: delivery.error,
    createdAt: delivery.createdAt ?? now,
    updatedAt: delivery.updatedAt ?? now,
  };
}

const DELIVERY_TRANSITIONS: Record<RoomAgentDeliveryStatus, ReadonlySet<RoomAgentDeliveryStatus>> = {
  queued: new Set(["queued", "sending", "failed", "cancelled"]),
  sending: new Set(["queued", "sending", "accepted", "running", "failed", "indeterminate", "cancelled"]),
  accepted: new Set(["accepted", "running", "waiting_approval", "waiting_question", "completed", "failed", "cancelled"]),
  running: new Set(["running", "waiting_approval", "waiting_question", "completed", "failed", "cancelled"]),
  waiting_approval: new Set(["waiting_approval", "running", "completed", "failed", "cancelled"]),
  waiting_question: new Set(["waiting_question", "running", "completed", "failed", "cancelled"]),
  completed: new Set(["completed"]),
  failed: new Set(["failed"]),
  indeterminate: new Set(["indeterminate"]),
  cancelled: new Set(["cancelled"]),
};

export function createRoomMessageDispatch(
  session: Session,
  input: CreateRoomMessageInput,
): { session: Session; message: RoomUserMessage } {
  if (!session.collaboration) throw new Error("当前会话尚未升级为多 Agent 房间");
  const recipientAgentIds = Array.from(new Set(input.recipientAgentIds));
  if (recipientAgentIds.length === 0) throw new Error("至少选择一个 Agent");
  for (const roomAgentId of recipientAgentIds) {
    const agent = getRoomAgent(session, roomAgentId);
    if (!agent || agent.removedAt || agent.archivedAt) throw new Error("Agent " + roomAgentId + " 不存在、已移出或已归档");
  }
  const createId = input.createId ?? defaultCreateId;
  const timestamp = input.timestamp ?? Date.now();
  const message: RoomUserMessage = {
    id: createId("message"),
    content: input.content,
    outboundContent: input.outboundContent,
    images: input.images,
    recipientAgentIds,
    deliveries: Object.fromEntries(recipientAgentIds.map((roomAgentId) => [
      roomAgentId,
      {
        status: "queued" as const,
        dispatchAttemptId: createId("attempt", roomAgentId),
        agentTurnId: createId("turn", roomAgentId),
        createdAt: timestamp,
        updatedAt: timestamp,
        previousAttempts: [],
      },
    ])),
    timestamp,
  };
  return {
    message,
    session: {
      ...session,
      collaboration: {
        ...session.collaboration,
        messages: [...session.collaboration.messages, message],
      },
      updatedAt: timestamp,
    },
  };
}

const AGENT_RUNTIME_BLOCKING_STATUSES = new Set<RoomAgentActivity["status"]>([
  "creating",
  "sending",
  "accepted",
  "running",
  "waiting_approval",
  "waiting_question",
]);

const DELIVERY_DISPATCH_BLOCKING_STATUSES = new Set<RoomAgentDeliveryStatus>([
  "sending",
  "accepted",
  "running",
  "waiting_approval",
  "waiting_question",
  "indeterminate",
]);

export interface DispatchableRoomDelivery {
  roomMessageId: string;
  roomAgentId: string;
}

export function getDispatchableRoomDeliveries(
  session: Session,
  activities: Iterable<RoomAgentActivity> = [],
): DispatchableRoomDelivery[] {
  if (!session.collaboration) return [];
  const activeByAgent = new Map<string, RoomAgentActivity>();
  for (const activity of activities) {
    if (activity.roomId === session.id) activeByAgent.set(activity.roomAgentId, activity);
  }
  const dispatchable: DispatchableRoomDelivery[] = [];
  for (const agent of session.collaboration.agents) {
    if (agent.removedAt || agent.archivedAt || agent.provisioningError || agent.recoveryIssue) continue;
    const activity = activeByAgent.get(agent.id);
    if (activity && AGENT_RUNTIME_BLOCKING_STATUSES.has(activity.status)) continue;
    const agentDeliveries = session.collaboration.messages.flatMap((message) => {
      const delivery = message.deliveries[agent.id];
      return delivery ? [{ message, delivery }] : [];
    });
    if (agentDeliveries.some(({ delivery }) => DELIVERY_DISPATCH_BLOCKING_STATUSES.has(delivery.status))) continue;
    const queued = agentDeliveries.find(({ delivery }) => delivery.status === "queued");
    if (queued) dispatchable.push({ roomMessageId: queued.message.id, roomAgentId: agent.id });
  }
  return dispatchable;
}

export function setRoomDeliveryStatus(
  session: Session,
  roomMessageId: string,
  roomAgentId: string,
  status: RoomAgentDeliveryStatus,
  patch: Partial<RoomAgentDelivery> = {},
  now = Date.now(),
): Session {
  return updateDelivery(session, roomMessageId, roomAgentId, (delivery) => {
    if (!DELIVERY_TRANSITIONS[delivery.status].has(status)) {
      throw new Error("非法投递状态转换：" + delivery.status + " -> " + status);
    }
    return {
      ...delivery,
      ...patch,
      status,
      updatedAt: now,
    };
  }, now);
}

export function applyRoomDeliveryRuntimeStatus(
  session: Session,
  roomMessageId: string | undefined,
  roomAgentId: string,
  runtimeStatus: "running" | "waiting_approval" | "waiting_question" | "completed" | "error" | "interrupted",
  now = Date.now(),
): Session {
  if (!roomMessageId || !session.collaboration) return session;
  const message = session.collaboration.messages.find((candidate) => candidate.id === roomMessageId);
  const delivery = message?.deliveries[roomAgentId];
  if (!message || !delivery) return session;
  const status: RoomAgentDeliveryStatus = runtimeStatus === "error"
    ? "failed"
    : runtimeStatus === "interrupted"
      ? "cancelled"
      : runtimeStatus;
  if (delivery.status === status) return session;
  if (!DELIVERY_TRANSITIONS[delivery.status].has(status)) return session;
  return setRoomDeliveryStatus(session, roomMessageId, roomAgentId, status, {
    error: runtimeStatus === "error"
      ? delivery.error ?? "当前 Agent 执行失败。"
      : runtimeStatus === "interrupted"
        ? delivery.error ?? "当前 Agent 已停止。"
        : undefined,
  }, now);
}

export function recoverInterruptedRoomDeliveries(
  session: Session,
  evidenceByAttempt: ReadonlyMap<string, RoomDeliveryOfficialEvidence> = new Map(),
  now = Date.now(),
  roomAgentIds?: ReadonlySet<string>,
): Session {
  if (!session.collaboration) return session;
  let next = session;
  for (const message of session.collaboration.messages) {
    for (const roomAgentId of message.recipientAgentIds) {
      if (roomAgentIds && !roomAgentIds.has(roomAgentId)) continue;
      const delivery = message.deliveries[roomAgentId];
      if (!delivery || delivery.status !== "sending") continue;
      const evidence = delivery.dispatchAttemptId
        ? evidenceByAttempt.get(delivery.dispatchAttemptId)
        : undefined;
      next = evidence?.accepted
        ? setRoomDeliveryStatus(next, message.id, roomAgentId, "accepted", {
          officialPromptId: evidence.officialPromptId,
          officialUserEventId: evidence.officialUserEventId,
          error: undefined,
        }, now)
        : setRoomDeliveryStatus(next, message.id, roomAgentId, "indeterminate", {
          error: evidence && !evidence.accepted && evidence.error
            ? evidence.error
            : "应用退出前未能确认官方是否已接收；为避免重复执行，Kimix 未自动重发。",
        }, now);
    }
  }
  return next;
}

export function collectRoomDeliveryEvidenceFromHistory(
  session: Session,
  roomAgentId: string,
): Map<string, RoomDeliveryOfficialEvidence> {
  const evidence = new Map<string, RoomDeliveryOfficialEvidence>();
  if (!session.collaboration) return evidence;
  const events = getRoomAgentEvents(session, roomAgentId);
  for (const message of session.collaboration.messages) {
    const delivery = message.deliveries[roomAgentId];
    if (!delivery?.dispatchAttemptId || delivery.status !== "sending") continue;
    if (delivery.officialPromptId || delivery.officialUserEventId) {
      evidence.set(delivery.dispatchAttemptId, {
        accepted: true,
        officialPromptId: delivery.officialPromptId,
        officialUserEventId: delivery.officialUserEventId,
      });
      continue;
    }
    const officialUser = events.find((event) => (
      event.type === "user_message" && (
        event.roomMessageId === message.id ||
        event.agentTurnId === delivery.agentTurnId
      )
    ));
    if (officialUser) {
      evidence.set(delivery.dispatchAttemptId, {
        accepted: true,
        officialUserEventId: officialUser.id,
      });
    }
  }
  return evidence;
}

export function retryRoomDelivery(
  session: Session,
  roomMessageId: string,
  roomAgentId: string,
  options: { createId?: DeliveryIdentityFactory; now?: number } = {},
): Session {
  const createId = options.createId ?? defaultCreateId;
  const now = options.now ?? Date.now();
  return updateDelivery(session, roomMessageId, roomAgentId, (delivery) => {
    if (delivery.status !== "indeterminate" && delivery.status !== "failed" && delivery.status !== "cancelled") {
      throw new Error("只有不确定、失败或已取消的投递可以显式重试");
    }
    return {
      status: "queued",
      dispatchAttemptId: createId("attempt", roomAgentId),
      agentTurnId: createId("turn", roomAgentId),
      createdAt: now,
      updatedAt: now,
      previousAttempts: [...(delivery.previousAttempts ?? []), attemptSnapshot(delivery, now)],
    };
  }, now);
}

export async function dispatchQueuedRoomDelivery(input: {
  roomMessageId: string;
  roomAgentId: string;
  getSession: () => Session;
  setSession: (session: Session) => void;
  persist: () => Promise<RoomDeliveryPersistResult>;
  send: (context: {
    session: Session;
    message: RoomUserMessage;
    delivery: RoomAgentDelivery;
  }) => Promise<RoomDeliverySendResult>;
}): Promise<RoomDeliverySendResult> {
  const initial = input.getSession();
  const message = initial.collaboration?.messages.find((candidate) => candidate.id === input.roomMessageId);
  const delivery = message?.deliveries[input.roomAgentId];
  if (!message || !delivery) {
    return { success: false, certainty: "not-sent", error: "投递记录不存在" };
  }
  if (delivery.status !== "queued") {
    return { success: false, certainty: "not-sent", error: "投递当前不在 queued 状态" };
  }
  const queuedPersist = await input.persist();
  if (!queuedPersist.success) {
    return { success: false, certainty: "not-sent", error: "queued 状态保存失败：" + queuedPersist.error };
  }
  input.setSession(setRoomDeliveryStatus(input.getSession(), input.roomMessageId, input.roomAgentId, "sending"));
  const sendingPersist = await input.persist();
  if (!sendingPersist.success) {
    input.setSession(setRoomDeliveryStatus(input.getSession(), input.roomMessageId, input.roomAgentId, "queued", {
      error: "sending 状态保存失败：" + sendingPersist.error,
    }));
    return { success: false, certainty: "not-sent", error: "sending 状态保存失败：" + sendingPersist.error };
  }
  const current = input.getSession();
  const currentMessage = current.collaboration?.messages.find((candidate) => candidate.id === input.roomMessageId);
  const currentDelivery = currentMessage?.deliveries[input.roomAgentId];
  if (!currentMessage || !currentDelivery || currentDelivery.status !== "sending") {
    return { success: false, certainty: "not-sent", error: "发送前投递状态已变化" };
  }
  let result: RoomDeliverySendResult;
  try {
    result = await input.send({ session: current, message: currentMessage, delivery: currentDelivery });
  } catch (error) {
    result = {
      success: false,
      certainty: "unknown",
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (result.success) {
    const latestDelivery = input.getSession().collaboration?.messages
      .find((candidate) => candidate.id === input.roomMessageId)
      ?.deliveries[input.roomAgentId];
    if (!latestDelivery) {
      return { success: false, certainty: "unknown", error: "官方已接收，但本地投递记录已丢失" };
    }
    const confirmedStatus = latestDelivery.status === "sending" ? "accepted" : latestDelivery.status;
    input.setSession(setRoomDeliveryStatus(input.getSession(), input.roomMessageId, input.roomAgentId, confirmedStatus, {
      officialPromptId: result.officialPromptId,
      officialUserEventId: result.officialUserEventId,
      error: undefined,
    }));
    await input.persist();
    return result;
  }
  input.setSession(setRoomDeliveryStatus(
    input.getSession(),
    input.roomMessageId,
    input.roomAgentId,
    result.certainty === "unknown" ? "indeterminate" : "failed",
    { error: result.error },
  ));
  await input.persist();
  return result;
}
