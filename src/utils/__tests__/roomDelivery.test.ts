import { describe, expect, it, vi } from "vitest";
import type { RoomAgent, Session } from "@/types/ui";
import {
  createCollaborationStateFromSession,
  getPrimaryRoomAgent,
  normalizeLoadedSessionCollaboration,
  synchronizeCollaborationPrimaryMirror,
} from "@/utils/collaborationRooms";
import {
  applyRoomDeliveryRuntimeStatus,
  collectRoomDeliveryEvidenceFromHistory,
  createRoomMessageDispatch,
  dispatchQueuedRoomDelivery,
  recoverInterruptedRoomDeliveries,
  retryRoomDelivery,
  setRoomDeliveryStatus,
} from "@/utils/roomDelivery";
import { projectCollaborationTimeline } from "@/utils/collaborationTimeline";

function room(): Session {
  const base: Session = {
    id: "room-1",
    engine: "kimi-code",
    runtimeSessionId: "primary-session",
    officialSessionId: "primary-session",
    model: "kimi-code/k2.5",
    title: "Room",
    projectPath: "D:/work/demo",
    createdAt: 1,
    updatedAt: 2,
    events: [],
    isLoading: false,
  };
  const collaboration = createCollaborationStateFromSession(base);
  const secondary: RoomAgent = {
    id: "agent-2",
    displayName: "Reviewer",
    mentionName: "reviewer",
    modelAlias: "openai/gpt-5",
    permissionMode: "manual",
    officialSessionId: "secondary-session",
    createdAt: 3,
  };
  return {
    ...base,
    collaboration: {
      ...collaboration,
      agents: [...collaboration.agents, secondary],
      agentEvents: { ...collaboration.agentEvents, [secondary.id]: [] },
    },
  };
}

function deterministicIds() {
  let index = 0;
  return (kind: "message" | "attempt" | "turn", roomAgentId?: string) => {
    index += 1;
    return kind + ":" + (roomAgentId ?? "room") + ":" + index;
  };
}

describe("roomDelivery", () => {
  it("在网络前创建稳定 room message、接收者顺序和逐 Agent attempt", () => {
    const session = room();
    const primary = getPrimaryRoomAgent(session);
    const created = createRoomMessageDispatch(session, {
      content: "请分别检查",
      recipientAgentIds: ["agent-2", primary.id, "agent-2"],
      timestamp: 100,
      createId: deterministicIds(),
    });

    expect(created.message.recipientAgentIds).toEqual(["agent-2", primary.id]);
    expect(created.message.deliveries["agent-2"]).toMatchObject({
      status: "queued",
      dispatchAttemptId: "attempt:agent-2:2",
      agentTurnId: "turn:agent-2:3",
      createdAt: 100,
    });
    expect(created.message.deliveries[primary.id]).toMatchObject({
      status: "queued",
      dispatchAttemptId: "attempt:" + primary.id + ":4",
      agentTurnId: "turn:" + primary.id + ":5",
    });
  });

  it("queued 和 sending 都持久化后才调用网络，并记录官方身份", async () => {
    const primary = getPrimaryRoomAgent(room());
    let state = createRoomMessageDispatch(room(), {
      content: "执行",
      recipientAgentIds: [primary.id],
      createId: deterministicIds(),
    }).session;
    const messageId = state.collaboration!.messages[0].id;
    const observedStatuses: string[] = [];
    const send = vi.fn().mockImplementation(async () => {
      observedStatuses.push("network");
      return { success: true as const, officialPromptId: "prompt-1", officialUserEventId: "user-1" };
    });
    const result = await dispatchQueuedRoomDelivery({
      roomMessageId: messageId,
      roomAgentId: primary.id,
      getSession: () => state,
      setSession: (next) => { state = next; },
      persist: async () => {
        observedStatuses.push(state.collaboration!.messages[0].deliveries[primary.id].status);
        return { success: true };
      },
      send,
    });

    expect(observedStatuses.slice(0, 3)).toEqual(["queued", "sending", "network"]);
    expect(result.success).toBe(true);
    expect(state.collaboration!.messages[0].deliveries[primary.id]).toMatchObject({
      status: "accepted",
      officialPromptId: "prompt-1",
      officialUserEventId: "user-1",
    });
  });

  it("runtime 先进入 running 时，官方确认只补身份且不把 delivery 回退到 accepted", async () => {
    const primary = getPrimaryRoomAgent(room());
    let state = createRoomMessageDispatch(room(), {
      content: "执行",
      recipientAgentIds: [primary.id],
      createId: deterministicIds(),
    }).session;
    const messageId = state.collaboration!.messages[0].id;
    const result = await dispatchQueuedRoomDelivery({
      roomMessageId: messageId,
      roomAgentId: primary.id,
      getSession: () => state,
      setSession: (next) => { state = next; },
      persist: async () => ({ success: true }),
      send: async () => {
        state = applyRoomDeliveryRuntimeStatus(state, messageId, primary.id, "running", 120);
        return { success: true, officialPromptId: "prompt-fast" };
      },
    });

    expect(result.success).toBe(true);
    expect(state.collaboration!.messages[0].deliveries[primary.id]).toMatchObject({
      status: "running",
      officialPromptId: "prompt-fast",
    });
  });

  it("sending 持久化失败时禁止调用网络并退回 queued", async () => {
    const primary = getPrimaryRoomAgent(room());
    let state = createRoomMessageDispatch(room(), {
      content: "执行",
      recipientAgentIds: [primary.id],
      createId: deterministicIds(),
    }).session;
    const messageId = state.collaboration!.messages[0].id;
    const send = vi.fn();
    let persistCount = 0;
    const result = await dispatchQueuedRoomDelivery({
      roomMessageId: messageId,
      roomAgentId: primary.id,
      getSession: () => state,
      setSession: (next) => { state = next; },
      persist: async () => {
        persistCount += 1;
        return persistCount === 1 ? { success: true } : { success: false, error: "disk full" };
      },
      send,
    });

    expect(result).toMatchObject({ success: false, certainty: "not-sent" });
    expect(send).not.toHaveBeenCalled();
    expect(state.collaboration!.messages[0].deliveries[primary.id].status).toBe("queued");
  });

  it("网络结果不确定或抛错时进入 indeterminate，绝不自动重发", async () => {
    const primary = getPrimaryRoomAgent(room());
    let state = createRoomMessageDispatch(room(), {
      content: "执行",
      recipientAgentIds: [primary.id],
      createId: deterministicIds(),
    }).session;
    const messageId = state.collaboration!.messages[0].id;
    const send = vi.fn().mockRejectedValue(new Error("connection reset"));
    const result = await dispatchQueuedRoomDelivery({
      roomMessageId: messageId,
      roomAgentId: primary.id,
      getSession: () => state,
      setSession: (next) => { state = next; },
      persist: async () => ({ success: true }),
      send,
    });

    expect(result).toEqual({ success: false, certainty: "unknown", error: "connection reset" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(state.collaboration!.messages[0].deliveries[primary.id]).toMatchObject({
      status: "indeterminate",
      error: "connection reset",
    });
  });

  it("重启只用官方证据确认 sending；无证据则转 indeterminate", () => {
    const session = room();
    const primary = getPrimaryRoomAgent(session);
    const created = createRoomMessageDispatch(session, {
      content: "检查",
      recipientAgentIds: [primary.id, "agent-2"],
      timestamp: 100,
      createId: deterministicIds(),
    });
    let sending = created.session;
    const message = sending.collaboration!.messages[0];
    sending = {
      ...sending,
      collaboration: {
        ...sending.collaboration!,
        messages: [{
          ...message,
          deliveries: Object.fromEntries(Object.entries(message.deliveries).map(([agentId, delivery]) => [
            agentId,
            { ...delivery, status: "sending" as const },
          ])),
        }],
      },
    };
    const primaryAttempt = sending.collaboration!.messages[0].deliveries[primary.id].dispatchAttemptId!;
    const recovered = recoverInterruptedRoomDeliveries(sending, new Map([[
      primaryAttempt,
      { accepted: true, officialPromptId: "prompt-1", officialUserEventId: "user-1" },
    ]]), 200);

    expect(recovered.collaboration!.messages[0].deliveries[primary.id]).toMatchObject({
      status: "accepted",
      officialPromptId: "prompt-1",
    });
    expect(recovered.collaboration!.messages[0].deliveries["agent-2"].status).toBe("indeterminate");
  });

  it("canonical history 中的稳定 room/turn 身份可作为官方接受证据", () => {
    const session = room();
    const primary = getPrimaryRoomAgent(session);
    const created = createRoomMessageDispatch(session, {
      content: "检查",
      recipientAgentIds: [primary.id],
      createId: deterministicIds(),
    });
    const message = created.message;
    const sending: Session = {
      ...created.session,
      collaboration: {
        ...created.session.collaboration!,
        messages: [{
          ...message,
          deliveries: {
            [primary.id]: { ...message.deliveries[primary.id], status: "sending" },
          },
        }],
        agentEvents: {
          ...created.session.collaboration!.agentEvents,
          [primary.id]: [{
            id: "official-user-1",
            type: "user_message",
            timestamp: 120,
            content: "检查",
            roomAgentId: primary.id,
            roomMessageId: message.id,
            agentTurnId: message.deliveries[primary.id].agentTurnId,
          }],
        },
      },
    };
    const evidence = collectRoomDeliveryEvidenceFromHistory(sending, primary.id);
    const recovered = recoverInterruptedRoomDeliveries(sending, evidence, 200, new Set([primary.id]));

    expect(recovered.collaboration!.messages[0].deliveries[primary.id]).toMatchObject({
      status: "accepted",
      officialUserEventId: "official-user-1",
    });
  });

  it("只有用户显式重试才创建新 attempt/turn，并保留旧尝试审计", () => {
    const primary = getPrimaryRoomAgent(room());
    const created = createRoomMessageDispatch(room(), {
      content: "执行",
      recipientAgentIds: [primary.id],
      timestamp: 100,
      createId: deterministicIds(),
    });
    const messageId = created.message.id;
    const interrupted = recoverInterruptedRoomDeliveries({
      ...created.session,
      collaboration: {
        ...created.session.collaboration!,
        messages: [{
          ...created.message,
          deliveries: {
            [primary.id]: { ...created.message.deliveries[primary.id], status: "sending" },
          },
        }],
      },
    }, new Map(), 150);
    const retried = retryRoomDelivery(interrupted, messageId, primary.id, {
      createId: deterministicIds(),
      now: 200,
    });
    const delivery = retried.collaboration!.messages[0].deliveries[primary.id];

    expect(delivery.status).toBe("queued");
    expect(delivery.previousAttempts).toHaveLength(1);
    expect(delivery.previousAttempts![0]).toMatchObject({
      status: "indeterminate",
      agentTurnId: created.message.deliveries[primary.id].agentTurnId,
    });
    expect(delivery.agentTurnId).not.toBe(created.message.deliveries[primary.id].agentTurnId);
    const persisted = synchronizeCollaborationPrimaryMirror(retried);
    const normalized = normalizeLoadedSessionCollaboration(JSON.parse(JSON.stringify(persisted)) as Session);
    expect(normalized.unsupportedCollaboration).toBeUndefined();
    expect(normalized.collaboration!.messages[0].deliveries[primary.id].previousAttempts).toEqual(delivery.previousAttempts);
  });

  it("indeterminate 在时间线显示明确错误，不伪装为仍在运行", () => {
    const primary = getPrimaryRoomAgent(room());
    const created = createRoomMessageDispatch(room(), {
      content: "执行",
      recipientAgentIds: [primary.id],
      createId: deterministicIds(),
    });
    const recovered = recoverInterruptedRoomDeliveries({
      ...created.session,
      collaboration: {
        ...created.session.collaboration!,
        messages: [{
          ...created.message,
          deliveries: {
            [primary.id]: { ...created.message.deliveries[primary.id], status: "sending" },
          },
        }],
      },
    });
    const projected = projectCollaborationTimeline(recovered);

    expect(projected.at(-1)).toMatchObject({
      type: "error",
      roomMessageId: created.message.id,
      agentTurnId: created.message.deliveries[primary.id].agentTurnId,
    });
  });

  it("拒绝从终态回退到发送态", () => {
    const primary = getPrimaryRoomAgent(room());
    const created = createRoomMessageDispatch(room(), {
      content: "执行",
      recipientAgentIds: [primary.id],
      createId: deterministicIds(),
    });
    const sending = setRoomDeliveryStatus(created.session, created.message.id, primary.id, "sending");
    const accepted = setRoomDeliveryStatus(sending, created.message.id, primary.id, "accepted");
    const terminal = setRoomDeliveryStatus(accepted, created.message.id, primary.id, "completed");
    expect(() => setRoomDeliveryStatus(terminal, created.message.id, primary.id, "sending"))
      .toThrow("非法投递状态转换");
  });

  it("runtime 状态只结算对应 Agent delivery，终态后不再保持房间繁忙", () => {
    const primary = getPrimaryRoomAgent(room());
    const created = createRoomMessageDispatch(room(), {
      content: "执行",
      recipientAgentIds: [primary.id],
      createId: deterministicIds(),
    });
    const messageId = created.message.id;
    let next = setRoomDeliveryStatus(created.session, messageId, primary.id, "sending", {}, 100);
    next = setRoomDeliveryStatus(next, messageId, primary.id, "accepted", {}, 110);
    next = applyRoomDeliveryRuntimeStatus(next, messageId, primary.id, "running", 120);
    expect(next.collaboration?.messages[0].deliveries[primary.id].status).toBe("running");
    next = applyRoomDeliveryRuntimeStatus(next, messageId, primary.id, "waiting_approval", 130);
    expect(next.collaboration?.messages[0].deliveries[primary.id].status).toBe("waiting_approval");
    next = applyRoomDeliveryRuntimeStatus(next, messageId, primary.id, "completed", 140);
    expect(next.collaboration?.messages[0].deliveries[primary.id].status).toBe("completed");
    expect(applyRoomDeliveryRuntimeStatus(next, messageId, primary.id, "running", 150)).toBe(next);
  });
});
