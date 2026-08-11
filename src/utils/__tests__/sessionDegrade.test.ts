import { describe, expect, it } from "vitest";
import type { RoomAgent, Session, TimelineEvent } from "@/types/ui";
import { createCollaborationStateFromSession } from "../collaborationRooms";
import { degradeSingleAgentRoomSession } from "../sessionDegrade";
import { projectCollaborationTimeline } from "../collaborationTimeline";

function legacySession(events: TimelineEvent[] = []): Session {
  return {
    id: "room-1",
    engine: "kimi-code",
    runtimeSessionId: "runtime-primary",
    officialSessionId: "official-primary",
    model: "kimi-code/kimi-for-coding",
    title: "Legacy",
    projectPath: "D:/WORKS/test",
    createdAt: 10,
    updatedAt: 20,
    events,
    isLoading: false,
  };
}

function secondaryAgent(): RoomAgent {
  return {
    id: "agent-secondary",
    displayName: "GPT-5",
    mentionName: "gpt5",
    modelAlias: "openai/gpt-5",
    permissionMode: "manual",
    runtimeSessionId: "runtime-secondary",
    officialSessionId: "official-secondary",
    createdAt: 30,
  };
}

describe("degradeSingleAgentRoomSession", () => {
  it("返回同引用：无 collaboration 的普通 session 不需要降级", () => {
    const session = legacySession([
      { id: "user-1", type: "user_message", timestamp: 100, content: "Hello" },
    ]);

    expect(degradeSingleAgentRoomSession(session)).toBe(session);
  });

  it("返回同引用：primary + secondary 多 Agent 房间不降级", () => {
    const session = legacySession();
    const collaboration = createCollaborationStateFromSession(session);
    const secondary = secondaryAgent();
    const room: Session = {
      ...session,
      collaboration: {
        ...collaboration,
        agents: [...collaboration.agents, secondary],
        agentEvents: {
          ...collaboration.agentEvents,
          [secondary.id]: [],
        },
      },
    };

    expect(degradeSingleAgentRoomSession(room)).toBe(room);
  });

  it("单 Agent 残留态：合并历史后移除 collaboration，queued 占位被过滤", () => {
    const session = legacySession([
      { id: "user-1", type: "user_message", timestamp: 100, content: "Review this" },
    ]);
    const collaboration = createCollaborationStateFromSession(session);
    const primary = collaboration.primaryAgentId;
    const room: Session = {
      ...session,
      collaboration: {
        ...collaboration,
        messages: [
          ...collaboration.messages,
          {
            id: "message-2",
            content: "Next request",
            recipientAgentIds: [primary],
            deliveries: {
              [primary]: { status: "queued", agentTurnId: "turn-2" },
            },
            timestamp: 200,
          },
        ],
        agentEvents: {
          ...collaboration.agentEvents,
          [primary]: [
            ...(collaboration.agentEvents[primary] ?? []),
            {
              id: "assistant-2",
              type: "assistant_message",
              timestamp: 210,
              content: "Working",
              isThinking: false,
              isComplete: false,
              roomAgentId: primary,
            },
          ],
        },
      },
    };

    const degraded = degradeSingleAgentRoomSession(room);

    expect(degraded).not.toBe(room);
    expect(degraded.collaboration).toBeUndefined();
    // 房间 user 消息以原 id 投影进 events
    expect(degraded.events.some((event) => (
      event.type === "user_message" && event.id === "message-2"
    ))).toBe(true);
    // primary 的 assistant 事件保留
    expect(degraded.events.some((event) => (
      event.type === "assistant_message" &&
      event.id === "assistant-2" &&
      event.roomAgentId === primary
    ))).toBe(true);
    // queued 投递的占位（assistant_message + roomDeliveryStatus）被过滤
    expect(degraded.events.some((event) => (
      event.type === "assistant_message" && event.roomDeliveryStatus !== undefined
    ))).toBe(false);
  });

  it("幂等：对已降级 session 再次调用返回同引用", () => {
    const session = legacySession();
    const collaboration = createCollaborationStateFromSession(session);
    const primary = collaboration.primaryAgentId;
    const room: Session = {
      ...session,
      collaboration: {
        ...collaboration,
        messages: [
          ...collaboration.messages,
          {
            id: "message-1",
            content: "Solo",
            recipientAgentIds: [primary],
            deliveries: {
              [primary]: { status: "queued", agentTurnId: "turn-1" },
            },
            timestamp: 200,
          },
        ],
      },
    };
    const degraded = degradeSingleAgentRoomSession(room);

    expect(degraded.collaboration).toBeUndefined();
    expect(degradeSingleAgentRoomSession(degraded)).toBe(degraded);
  });

  it("闭环：降级后普通发送的 user_message 在 projectCollaborationTimeline 可见", () => {
    const session = legacySession();
    const collaboration = createCollaborationStateFromSession(session);
    const primary = collaboration.primaryAgentId;
    const room: Session = {
      ...session,
      collaboration: {
        ...collaboration,
        messages: [
          ...collaboration.messages,
          {
            id: "message-1",
            content: "Solo",
            recipientAgentIds: [primary],
            deliveries: {
              [primary]: { status: "queued", agentTurnId: "turn-1" },
            },
            timestamp: 200,
          },
        ],
      },
    };
    const degraded = degradeSingleAgentRoomSession(room);
    // 模拟普通发送路径：events 追加一条房间身份字段的 user_message
    const next: Session = {
      ...degraded,
      events: [
        ...degraded.events,
        {
          id: "user-new",
          type: "user_message",
          timestamp: 300,
          content: "Next",
          roomAgentId: primary,
          roomMessageId: "user-new",
          agentTurnId: "turn-new",
          recipientAgentIds: [primary],
        },
      ],
    };

    const projected = projectCollaborationTimeline(next);
    expect(projected.some((event) => (
      event.type === "user_message" && event.id === "user-new"
    ))).toBe(true);
  });
});
