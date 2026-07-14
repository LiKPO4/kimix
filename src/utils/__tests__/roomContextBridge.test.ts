import { describe, expect, it } from "vitest";
import type { RoomAgent, Session, TimelineEvent } from "@/types/ui";
import { createCollaborationStateFromSession, getPrimaryRoomAgent, normalizeLoadedSessionCollaboration } from "@/utils/collaborationRooms";
import { createRoomMessageDispatch, setRoomDeliveryStatus } from "@/utils/roomDelivery";
import {
  buildRoomContextSharePlan,
  buildRoomDeliveryPrompt,
  getRoomContextTurns,
  stripRoomContextFromPrompt,
} from "@/utils/roomContextBridge";

function completedTurn(index: number, timestamp: number): TimelineEvent[] {
  return [
    { id: `u${index}`, type: "user_message", timestamp, content: `用户问题 ${index}` },
    { id: `a${index}`, type: "assistant_message", timestamp: timestamp + 1, content: `Agent 正文 ${index}`, isThinking: false, isComplete: true },
  ];
}

function roomWithHistory(turnCount = 1): Session {
  const events = Array.from({ length: turnCount }, (_, index) => completedTurn(index + 1, 100 + index * 10)).flat();
  const base: Session = {
    id: "room-1",
    engine: "kimi-code",
    runtimeSessionId: "primary-session",
    officialSessionId: "primary-session",
    model: "kimi-code/k2.5",
    title: "Room",
    projectPath: "D:/work/demo",
    createdAt: 1,
    updatedAt: 200,
    events,
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
    runtimeSessionId: "secondary-session",
    contextBridgeId: "room-context:agent-2",
    createdAt: 201,
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

describe("roomContextBridge", () => {
  it("新 Agent 默认只收到上一轮用户消息和其他 Agent 最终正文", () => {
    const room = roomWithHistory(2);
    const primary = getPrimaryRoomAgent(room);
    const plan = buildRoomContextSharePlan(room, "agent-2", { mode: "last" }, 300);
    expect(plan?.entryIds).toEqual(["user:room-message:u2", "assistant:a2"]);
    expect(plan?.content).toContain("用户问题 2");
    expect(plan?.content).toContain("Agent 正文 2");
    expect(buildRoomContextSharePlan(room, primary.id, { mode: "last" }, 300)).toBeUndefined();
  });

  it("最近三轮、选择消息和全部范围都按可见正文确定投影", () => {
    const room = roomWithHistory(4);
    expect(buildRoomContextSharePlan(room, "agent-2", { mode: "recent3" })?.entryIds).toHaveLength(6);
    expect(buildRoomContextSharePlan(room, "agent-2", {
      mode: "selected",
      selectedEntryIds: ["assistant:a2"],
    })?.entryIds).toEqual(["assistant:a2"]);
    expect(buildRoomContextSharePlan(room, "agent-2", { mode: "all" })?.entryIds).toHaveLength(8);
    expect(() => buildRoomContextSharePlan(room, "agent-2", { mode: "selected", selectedEntryIds: [] }))
      .toThrow("请先选择");
  });

  it("目标 Agent 已确认收到的桥接条目不会在后续投递中重复", () => {
    const room = roomWithHistory(1);
    const created = createRoomMessageDispatch(room, {
      content: "请审查",
      recipientAgentIds: ["agent-2"],
      contextShareSelection: { mode: "last" },
      timestamp: 300,
      createId: (kind) => `${kind}:1`,
    });
    const accepted = setRoomDeliveryStatus(
      setRoomDeliveryStatus(created.session, created.message.id, "agent-2", "sending"),
      created.message.id,
      "agent-2",
      "accepted",
    );
    expect(buildRoomContextSharePlan(accepted, "agent-2", { mode: "all" })).toBeUndefined();
    const restored = normalizeLoadedSessionCollaboration(JSON.parse(JSON.stringify(accepted)) as Session);
    expect(restored.collaboration?.agents.find((agent) => agent.id === "agent-2")?.contextBridgeId).toBe("room-context:agent-2");
    expect(restored.collaboration?.messages.at(-1)?.deliveries["agent-2"].contextShare?.entryIds)
      .toEqual(["user:room-message:u1", "assistant:a1"]);
  });

  it("其他 Agent 的新正文会在下一次路由时补给原 Agent", () => {
    const room = roomWithHistory(1);
    const primary = getPrimaryRoomAgent(room);
    const reviewMessage = createRoomMessageDispatch(room, {
      content: "请审查",
      recipientAgentIds: ["agent-2"],
      contextShareSelection: { mode: "none" },
      timestamp: 300,
      createId: (kind) => `${kind}:review`,
    });
    let next = setRoomDeliveryStatus(reviewMessage.session, reviewMessage.message.id, "agent-2", "sending");
    next = setRoomDeliveryStatus(next, reviewMessage.message.id, "agent-2", "accepted");
    next = setRoomDeliveryStatus(next, reviewMessage.message.id, "agent-2", "completed");
    next = {
      ...next,
      collaboration: {
        ...next.collaboration!,
        agentEvents: {
          ...next.collaboration!.agentEvents,
          "agent-2": [
            { id: "review-user", type: "user_message", timestamp: 300, content: "请审查", roomAgentId: "agent-2", roomMessageId: reviewMessage.message.id },
            { id: "review-body", type: "assistant_message", timestamp: 301, content: "发现一个问题", isThinking: false, isComplete: true, roomAgentId: "agent-2", roomMessageId: reviewMessage.message.id, agentTurnId: reviewMessage.message.deliveries["agent-2"].agentTurnId },
          ],
        },
      },
    };
    const plan = buildRoomContextSharePlan(next, primary.id, { mode: "last" });
    expect(plan?.content).toContain("请审查");
    expect(plan?.content).toContain("发现一个问题");
    expect(plan?.content).not.toContain("Agent 正文 1");
  });

  it("发送包裹只影响模型输入，能够还原当前用户消息", () => {
    const room = roomWithHistory(1);
    const plan = buildRoomContextSharePlan(room, "agent-2", { mode: "last" })!;
    const prompt = buildRoomDeliveryPrompt("检查最新改动", plan);
    expect(prompt).toContain("Agent 正文 1");
    expect(stripRoomContextFromPrompt(prompt)).toBe("检查最新改动");
    expect(stripRoomContextFromPrompt(buildRoomDeliveryPrompt("当前任务", {
      ...plan,
      content: `历史正文${"\n\n【Kimix 当前消息】\n"}不是当前任务`,
      contentChars: 30,
    }))).toBe("当前任务");
    expect(getRoomContextTurns(room)).toHaveLength(1);
  });

  it("正文超过安全上限时明确拒绝而不是静默截断", () => {
    const room = roomWithHistory(1);
    room.collaboration!.agentEvents[room.collaboration!.primaryAgentId] = [
      { id: "u-large", type: "user_message", timestamp: 500, content: "大型任务", roomAgentId: room.collaboration!.primaryAgentId },
      { id: "a-large", type: "assistant_message", timestamp: 501, content: "x".repeat(48_100), isThinking: false, isComplete: true, roomAgentId: room.collaboration!.primaryAgentId },
    ];
    room.collaboration!.messages = [];
    expect(() => buildRoomContextSharePlan(room, "agent-2", { mode: "all" })).toThrow("安全上限");
  });
});
