import { describe, expect, it } from "vitest";
import type { RoomAgent, Session, TimelineEvent } from "@/types/ui";
import { createCollaborationStateFromSession } from "../collaborationRooms";
import { projectCollaborationTimeline } from "../collaborationTimeline";

function baseSession(): Session {
  return {
    id: "room-1",
    engine: "kimi-code",
    runtimeSessionId: "runtime-a",
    officialSessionId: "official-a",
    title: "Room",
    projectPath: "D:/WORKS/test",
    createdAt: 1,
    updatedAt: 1,
    events: [],
    isLoading: false,
  };
}

function secondaryAgent(): RoomAgent {
  return {
    id: "agent-b",
    displayName: "GPT-5",
    mentionName: "gpt5",
    modelAlias: "openai/gpt-5",
    permissionMode: "manual",
    runtimeSessionId: "runtime-b",
    officialSessionId: "official-b",
    createdAt: 2,
  };
}

describe("projectCollaborationTimeline", () => {
  it("shows one room user message followed by stable Agent turns in recipient order", () => {
    const session = baseSession();
    const collaboration = createCollaborationStateFromSession(session);
    const primary = collaboration.agents[0];
    const secondary = secondaryAgent();
    const primaryEvents: TimelineEvent[] = [
      { id: "official-user-a", type: "user_message", timestamp: 10, content: "Review" },
      { id: "assistant-a", type: "assistant_message", timestamp: 11, content: "A result", isThinking: false, isComplete: true },
    ];
    const secondaryEvents: TimelineEvent[] = [
      { id: "official-user-b", type: "user_message", timestamp: 10, content: "Review" },
      { id: "assistant-b", type: "assistant_message", timestamp: 12, content: "B result", isThinking: false, isComplete: true },
    ];
    const room: Session = {
      ...session,
      collaboration: {
        ...collaboration,
        agents: [primary, secondary],
        messages: [{
          id: "message-1",
          content: "Review",
          recipientAgentIds: [secondary.id, primary.id],
          deliveries: {
            [primary.id]: { status: "completed", agentTurnId: "turn-a", officialUserEventId: "official-user-a" },
            [secondary.id]: { status: "completed", agentTurnId: "turn-b", officialUserEventId: "official-user-b" },
          },
          timestamp: 10,
        }],
        agentEvents: { [primary.id]: primaryEvents, [secondary.id]: secondaryEvents },
      },
    };

    const projected = projectCollaborationTimeline(room);
    expect(projected.filter((event) => event.type === "user_message")).toHaveLength(1);
    expect(projected.map((event) => event.id)).toEqual(["message-1", "assistant-b", "assistant-a"]);
    expect(projected[1]).toMatchObject({ roomAgentId: secondary.id, roomMessageId: "message-1", agentTurnId: "turn-b" });
    expect(projected[2]).toMatchObject({ roomAgentId: primary.id, roomMessageId: "message-1", agentTurnId: "turn-a" });
  });

  it("creates a stable placeholder before the first runtime event arrives", () => {
    const session = baseSession();
    const collaboration = createCollaborationStateFromSession(session);
    const primary = collaboration.agents[0];
    const room: Session = {
      ...session,
      collaboration: {
        ...collaboration,
        messages: [{
          id: "message-pending",
          content: "Wait",
          recipientAgentIds: [primary.id],
          deliveries: {
            [primary.id]: { status: "sending", agentTurnId: "turn-pending" },
          },
          timestamp: 20,
        }],
        agentEvents: { [primary.id]: [] },
      },
    };

    const first = projectCollaborationTimeline(room);
    const second = projectCollaborationTimeline(room);
    expect(first[1]).toMatchObject({
      id: "assistant:turn-pending",
      type: "assistant_message",
      agentTurnId: "turn-pending",
      isComplete: false,
    });
    expect(second[1].id).toBe(first[1].id);
  });

  it("claims every user-event alias with the same stable room delivery identity", () => {
    const session = baseSession();
    const collaboration = createCollaborationStateFromSession(session);
    const primary = collaboration.agents[0];
    const room: Session = {
      ...session,
      collaboration: {
        ...collaboration,
        messages: [{
          id: "message-stable",
          content: "发一版 release 吧",
          recipientAgentIds: [primary.id],
          deliveries: {
            [primary.id]: {
              status: "running",
              dispatchAttemptId: "attempt-stable",
              agentTurnId: "turn-stable",
              officialUserEventId: "canonical-user-latest",
            },
          },
          timestamp: 20,
        }],
        agentEvents: {
          [primary.id]: [
            {
              id: "live-user",
              type: "user_message",
              timestamp: 20,
              content: "发一版 release 吧",
              roomMessageId: "message-stable",
              agentTurnId: "turn-stable",
              dispatchAttemptId: "attempt-stable",
            },
            {
              id: "canonical-user-old",
              type: "user_message",
              timestamp: 40,
              content: "发一版 release 吧",
              roomMessageId: "message-stable",
              agentTurnId: "turn-stable",
              dispatchAttemptId: "attempt-stable",
            },
            {
              id: "canonical-user-latest",
              type: "user_message",
              timestamp: 60,
              content: "发一版 release 吧",
              roomMessageId: "message-stable",
              agentTurnId: "turn-stable",
              dispatchAttemptId: "attempt-stable",
            },
            {
              id: "assistant-live",
              type: "assistant_message",
              timestamp: 61,
              content: "处理中",
              isThinking: false,
              isComplete: false,
              roomMessageId: "message-stable",
              agentTurnId: "turn-stable",
            },
          ],
        },
      },
    };

    const projected = projectCollaborationTimeline(room);
    expect(projected.filter((event) => event.type === "user_message")).toEqual([
      expect.objectContaining({ id: "message-stable" }),
    ]);
    expect(projected.find((event) => event.id === "assistant-live")).toBeDefined();
  });

  it("claims the canonical user event when a persisted delivery lost only its attempt id", () => {
    const session = baseSession();
    const collaboration = createCollaborationStateFromSession(session);
    const primary = collaboration.agents[0];
    const room: Session = {
      ...session,
      collaboration: {
        ...collaboration,
        messages: [{
          id: "message-damaged",
          content: "只发送一次",
          recipientAgentIds: [primary.id],
          deliveries: {
            [primary.id]: {
              status: "completed",
              agentTurnId: "turn-damaged",
              officialUserEventId: "canonical-user-damaged",
            },
          },
          timestamp: 20,
        }],
        agentEvents: {
          [primary.id]: [
            {
              id: "canonical-user-damaged",
              type: "user_message",
              timestamp: 20,
              content: "只发送一次",
              roomMessageId: "message-damaged",
              agentTurnId: "turn-damaged",
              dispatchAttemptId: "attempt-damaged",
            },
            {
              id: "assistant-damaged",
              type: "assistant_message",
              timestamp: 21,
              content: "收到",
              isThinking: false,
              isComplete: true,
              roomMessageId: "message-damaged",
              agentTurnId: "turn-damaged",
            },
          ],
        },
      },
    };

    const projected = projectCollaborationTimeline(room);
    expect(projected.filter((event) => event.type === "user_message").map((event) => event.id))
      .toEqual(["message-damaged"]);
    expect(projected.find((event) => event.id === "assistant-damaged")).toMatchObject({
      roomMessageId: "message-damaged",
      agentTurnId: "turn-damaged",
    });
  });

  it("keeps an explicitly conflicting attempt visible instead of swallowing it", () => {
    const session = baseSession();
    const collaboration = createCollaborationStateFromSession(session);
    const primary = collaboration.agents[0];
    const room: Session = {
      ...session,
      collaboration: {
        ...collaboration,
        messages: [{
          id: "message-safe",
          content: "Safe",
          recipientAgentIds: [primary.id],
          deliveries: {
            [primary.id]: {
              status: "completed",
              agentTurnId: "turn-safe",
              dispatchAttemptId: "attempt-current",
              officialUserEventId: "canonical-conflict",
            },
          },
          timestamp: 20,
        }],
        agentEvents: {
          [primary.id]: [
            {
              id: "live-partial",
              type: "user_message",
              timestamp: 20,
              content: "Safe",
              roomMessageId: "message-safe",
              agentTurnId: "turn-safe",
            },
            {
              id: "canonical-conflict",
              type: "user_message",
              timestamp: 21,
              content: "Safe",
              roomMessageId: "message-safe",
              agentTurnId: "turn-safe",
              dispatchAttemptId: "attempt-other",
            },
            {
              id: "assistant-conflict",
              type: "assistant_message",
              timestamp: 22,
              content: "Other attempt result",
              isThinking: false,
              isComplete: true,
              roomMessageId: "message-safe",
              agentTurnId: "turn-safe",
              dispatchAttemptId: "attempt-other",
            },
          ],
        },
      },
    };

    expect(projectCollaborationTimeline(room)
      .filter((event) => event.type === "user_message")
      .map((event) => event.id))
      .toEqual(["message-safe", "live-partial", "canonical-conflict"]);
    const projectedIds = projectCollaborationTimeline(room).map((event) => event.id);
    expect(projectedIds.indexOf("assistant-conflict"))
      .toBe(projectedIds.indexOf("canonical-conflict") + 1);
  });

  it("does not guess when a damaged delivery maps to multiple explicit attempts", () => {
    const session = baseSession();
    const collaboration = createCollaborationStateFromSession(session);
    const primary = collaboration.agents[0];
    const room: Session = {
      ...session,
      collaboration: {
        ...collaboration,
        messages: [{
          id: "message-ambiguous",
          content: "Repeat",
          recipientAgentIds: [primary.id],
          deliveries: {
            [primary.id]: { status: "completed", agentTurnId: "turn-ambiguous" },
          },
          timestamp: 20,
        }],
        agentEvents: {
          [primary.id]: [
            {
              id: "canonical-attempt-a",
              type: "user_message",
              timestamp: 21,
              content: "Repeat",
              roomMessageId: "message-ambiguous",
              agentTurnId: "turn-ambiguous",
              dispatchAttemptId: "attempt-a",
            },
            {
              id: "canonical-attempt-b",
              type: "user_message",
              timestamp: 22,
              content: "Repeat",
              roomMessageId: "message-ambiguous",
              agentTurnId: "turn-ambiguous",
              dispatchAttemptId: "attempt-b",
            },
          ],
        },
      },
    };

    expect(projectCollaborationTimeline(room)
      .filter((event) => event.type === "user_message")
      .map((event) => event.id))
      .toEqual(["message-ambiguous", "canonical-attempt-a", "canonical-attempt-b"]);
  });

  it("does not let two deliveries compete for one identity-less official event id", () => {
    const session = baseSession();
    const collaboration = createCollaborationStateFromSession(session);
    const primary = collaboration.agents[0];
    const room: Session = {
      ...session,
      collaboration: {
        ...collaboration,
        messages: [
          {
            id: "message-first",
            content: "First",
            recipientAgentIds: [primary.id],
            deliveries: {
              [primary.id]: {
                status: "completed",
                agentTurnId: "turn-first",
                officialUserEventId: "canonical-shared",
              },
            },
            timestamp: 20,
          },
          {
            id: "message-second",
            content: "Second",
            recipientAgentIds: [primary.id],
            deliveries: {
              [primary.id]: {
                status: "completed",
                agentTurnId: "turn-second",
                officialUserEventId: "canonical-shared",
              },
            },
            timestamp: 21,
          },
        ],
        agentEvents: {
          [primary.id]: [
            { id: "canonical-shared", type: "user_message", timestamp: 22, content: "First" },
            { id: "canonical-result", type: "assistant_message", timestamp: 23, content: "Result", isThinking: false, isComplete: true },
          ],
        },
      },
    };

    const projected = projectCollaborationTimeline(room);
    expect(projected.filter((event) => event.type === "user_message").map((event) => event.id))
      .toEqual(["message-first", "message-second", "canonical-shared"]);
    expect(projected.find((event) => event.id === "canonical-result")?.agentTurnId)
      .not.toBe("turn-first");
    expect(projected.find((event) => event.id === "canonical-result")?.agentTurnId)
      .not.toBe("turn-second");
  });

  it("requires an exact Agent turn for every identity-bearing user event", () => {
    const session = baseSession();
    const collaboration = createCollaborationStateFromSession(session);
    const primary = collaboration.agents[0];
    const room: Session = {
      ...session,
      collaboration: {
        ...collaboration,
        messages: [{
          id: "message-partial",
          content: "Partial",
          recipientAgentIds: [primary.id],
          deliveries: {
            [primary.id]: {
              status: "completed",
              agentTurnId: "turn-partial",
              officialUserEventId: "canonical-partial",
            },
          },
          timestamp: 20,
        }],
        agentEvents: {
          [primary.id]: [{
            id: "canonical-partial",
            type: "user_message",
            timestamp: 21,
            content: "Partial",
            roomMessageId: "message-partial",
            dispatchAttemptId: "attempt-partial",
          }],
        },
      },
    };

    expect(projectCollaborationTimeline(room)
      .filter((event) => event.type === "user_message")
      .map((event) => event.id))
      .toEqual(["message-partial", "canonical-partial"]);
  });

  it("scopes claimed event ids per Agent partition", () => {
    const session = baseSession();
    const collaboration = createCollaborationStateFromSession(session);
    const primary = collaboration.agents[0];
    const secondary = secondaryAgent();
    const eventFor = (roomAgentId: string, turnId: string, result: string): TimelineEvent[] => [
      {
        id: "shared-user-id",
        type: "user_message",
        timestamp: 20,
        content: "Review",
        roomAgentId,
        roomMessageId: "message-shared",
        agentTurnId: turnId,
        dispatchAttemptId: `attempt-${turnId}`,
      },
      {
        id: "shared-assistant-id",
        type: "assistant_message",
        timestamp: 21,
        content: result,
        isThinking: false,
        isComplete: true,
        roomAgentId,
        roomMessageId: "message-shared",
        agentTurnId: turnId,
      },
    ];
    const room: Session = {
      ...session,
      collaboration: {
        ...collaboration,
        agents: [primary, secondary],
        messages: [{
          id: "message-shared",
          content: "Review",
          recipientAgentIds: [primary.id, secondary.id],
          deliveries: {
            [primary.id]: { status: "completed", agentTurnId: "turn-a", dispatchAttemptId: "attempt-turn-a" },
            [secondary.id]: { status: "completed", agentTurnId: "turn-b", dispatchAttemptId: "attempt-turn-b" },
          },
          timestamp: 20,
        }],
        agentEvents: {
          [primary.id]: eventFor(primary.id, "turn-a", "A result"),
          [secondary.id]: eventFor(secondary.id, "turn-b", "B result"),
        },
      },
    };

    expect(projectCollaborationTimeline(room)
      .filter((event) => event.type === "assistant_message")
      .map((event) => event.content))
      .toEqual(["A result", "B result"]);
  });

  it("keeps a stale identity-less official alias visible when a transaction match exists", () => {
    const session = baseSession();
    const collaboration = createCollaborationStateFromSession(session);
    const primary = collaboration.agents[0];
    const room: Session = {
      ...session,
      collaboration: {
        ...collaboration,
        messages: [{
          id: "message-transaction",
          content: "Transaction",
          recipientAgentIds: [primary.id],
          deliveries: {
            [primary.id]: {
              status: "completed",
              agentTurnId: "turn-transaction",
              dispatchAttemptId: "attempt-transaction",
              officialUserEventId: "stale-identityless",
            },
          },
          timestamp: 20,
        }],
        agentEvents: {
          [primary.id]: [
            { id: "stale-identityless", type: "user_message", timestamp: 19, content: "Old alias" },
            {
              id: "canonical-transaction",
              type: "user_message",
              timestamp: 20,
              content: "Transaction",
              roomMessageId: "message-transaction",
              agentTurnId: "turn-transaction",
              dispatchAttemptId: "attempt-transaction",
            },
          ],
        },
      },
    };

    expect(projectCollaborationTimeline(room)
      .filter((event) => event.type === "user_message")
      .map((event) => event.id))
      .toEqual(["stale-identityless", "message-transaction"]);
  });

  it("keeps an unselected Agent history separate instead of attaching it to the room message", () => {
    const session = baseSession();
    const collaboration = createCollaborationStateFromSession(session);
    const primary = collaboration.agents[0];
    const secondary = secondaryAgent();
    const room: Session = {
      ...session,
      collaboration: {
        ...collaboration,
        agents: [primary, secondary],
        messages: [{
          id: "message-primary",
          content: "Only A",
          recipientAgentIds: [primary.id],
          deliveries: {
            [primary.id]: { status: "completed", agentTurnId: "turn-primary", officialUserEventId: "user-a" },
          },
          timestamp: 30,
        }],
        agentEvents: {
          [primary.id]: [
            { id: "user-a", type: "user_message", timestamp: 30, content: "Only A" },
            { id: "assistant-a", type: "assistant_message", timestamp: 31, content: "A", isThinking: false, isComplete: true },
          ],
          [secondary.id]: [
            { id: "user-b", type: "user_message", timestamp: 30, content: "Hidden" },
            { id: "assistant-b", type: "assistant_message", timestamp: 31, content: "B", isThinking: false, isComplete: true },
          ],
        },
      },
    };

    expect(projectCollaborationTimeline(room).map((event) => event.id)).toEqual([
      "message-primary",
      "assistant-a",
      "user-b",
      "assistant-b",
    ]);
    expect(projectCollaborationTimeline(room).find((event) => event.id === "assistant-b")).toMatchObject({
      roomAgentId: secondary.id,
      agentTurnId: `unmatched-turn:${secondary.id}:user-b`,
    });
  });

  it("keeps ambiguous repeated history visible without attaching it to the room delivery", () => {
    const session = baseSession();
    const collaboration = createCollaborationStateFromSession(session);
    const primary = collaboration.agents[0];
    const room: Session = {
      ...session,
      collaboration: {
        ...collaboration,
        messages: [{
          id: "message-repeat",
          content: "Repeat",
          recipientAgentIds: [primary.id],
          deliveries: {
            [primary.id]: {
              status: "completed",
              agentTurnId: "turn-room",
              officialUserEventId: "missing-old-id",
            },
          },
          timestamp: 100,
        }],
        agentEvents: {
          [primary.id]: [
            { id: "canonical-user-1", type: "user_message", timestamp: 101, content: "Repeat" },
            { id: "canonical-assistant-1", type: "assistant_message", timestamp: 102, content: "First", isThinking: false, isComplete: true },
            { id: "canonical-user-2", type: "user_message", timestamp: 103, content: "Repeat" },
            { id: "canonical-assistant-2", type: "assistant_message", timestamp: 104, content: "Second", isThinking: false, isComplete: true },
          ],
        },
      },
    };

    const projected = projectCollaborationTimeline(room);
    expect(projected.map((event) => event.id)).toEqual([
      "message-repeat",
      "canonical-user-1",
      "canonical-assistant-1",
      "canonical-user-2",
      "canonical-assistant-2",
    ]);
    expect(projected.find((event) => event.id === "canonical-assistant-1")?.agentTurnId).not.toBe("turn-room");
    expect(projected.find((event) => event.id === "canonical-assistant-2")?.agentTurnId).not.toBe("turn-room");
  });

  it("keeps projected event object identity across flushes for untouched history (A4)", () => {
    const session = baseSession();
    const collaboration = createCollaborationStateFromSession(session);
    const primary = collaboration.agents[0];
    const primaryEvents: TimelineEvent[] = [
      { id: "official-user-a", type: "user_message", timestamp: 10, content: "Review" },
      { id: "assistant-a", type: "assistant_message", timestamp: 11, content: "A result", isThinking: false, isComplete: true },
      { id: "tool-a", type: "tool_call", timestamp: 12, toolCallId: "tc-1", toolName: "Bash", status: "completed", arguments: {}, rawArguments: "{}" },
    ];
    const roomMessage = {
      id: "message-1",
      content: "Review",
      recipientAgentIds: [primary.id],
      deliveries: {
        [primary.id]: { status: "completed" as const, agentTurnId: "turn-a", officialUserEventId: "official-user-a" },
      },
      timestamp: 10,
    };
    const room: Session = {
      ...session,
      collaboration: {
        ...collaboration,
        messages: [roomMessage],
        agentEvents: { [primary.id]: primaryEvents },
      },
    };

    const first = projectCollaborationTimeline(room);
    const second = projectCollaborationTimeline(room);
    expect(second).toHaveLength(first.length);
    for (let index = 0; index < first.length; index += 1) {
      expect(second[index]).toBe(first[index]);
    }
    expect(first[0]).toMatchObject({ type: "user_message", id: "message-1" });
    expect(first.find((event) => event.id === "assistant-a")).toMatchObject({
      roomAgentId: primary.id,
      roomMessageId: "message-1",
      agentTurnId: "turn-a",
    });
  });

  it("does not reuse projected identity when the same source is stamped for a different room message", () => {
    const session = baseSession();
    const collaboration = createCollaborationStateFromSession(session);
    const primary = collaboration.agents[0];
    const sharedAssistant: TimelineEvent = {
      id: "assistant-shared",
      type: "assistant_message",
      timestamp: 20,
      content: "Shared",
      isThinking: false,
      isComplete: true,
    };
    const room: Session = {
      ...session,
      collaboration: {
        ...collaboration,
        messages: [
          {
            id: "message-1",
            content: "One",
            recipientAgentIds: [primary.id],
            deliveries: {
              [primary.id]: { status: "completed", agentTurnId: "turn-1", officialUserEventId: "user-1" },
            },
            timestamp: 10,
          },
          {
            id: "message-2",
            content: "Two",
            recipientAgentIds: [primary.id],
            deliveries: {
              [primary.id]: { status: "completed", agentTurnId: "turn-2", officialUserEventId: "user-2" },
            },
            timestamp: 30,
          },
        ],
        agentEvents: {
          [primary.id]: [
            { id: "user-1", type: "user_message", timestamp: 10, content: "One" },
            { ...sharedAssistant, agentTurnId: "turn-1" },
            { id: "user-2", type: "user_message", timestamp: 30, content: "Two" },
            { ...sharedAssistant, id: "assistant-shared-2", agentTurnId: "turn-2", timestamp: 31 },
          ],
        },
      },
    };

    const projected = projectCollaborationTimeline(room);
    const firstAssistant = projected.find((event) => event.id === "assistant-shared");
    const secondAssistant = projected.find((event) => event.id === "assistant-shared-2");
    expect(firstAssistant).toBeDefined();
    expect(secondAssistant).toBeDefined();
    expect(firstAssistant).not.toBe(secondAssistant);
    expect(firstAssistant).toMatchObject({ roomMessageId: "message-1", agentTurnId: "turn-1" });
    expect(secondAssistant).toMatchObject({ roomMessageId: "message-2", agentTurnId: "turn-2" });
  });

  it("invalidates projected identity when the source event object is replaced", () => {
    const session = baseSession();
    const collaboration = createCollaborationStateFromSession(session);
    const primary = collaboration.agents[0];
    const originalAssistant: TimelineEvent = {
      id: "assistant-a",
      type: "assistant_message",
      timestamp: 11,
      content: "A",
      isThinking: false,
      isComplete: true,
    };
    const roomMessage = {
      id: "message-1",
      content: "Review",
      recipientAgentIds: [primary.id],
      deliveries: {
        [primary.id]: { status: "completed" as const, agentTurnId: "turn-a", officialUserEventId: "official-user-a" },
      },
      timestamp: 10,
    };
    const firstRoom: Session = {
      ...session,
      collaboration: {
        ...collaboration,
        messages: [roomMessage],
        agentEvents: {
          [primary.id]: [
            { id: "official-user-a", type: "user_message", timestamp: 10, content: "Review" },
            originalAssistant,
          ],
        },
      },
    };
    const first = projectCollaborationTimeline(firstRoom);
    const updatedAssistant: TimelineEvent = { ...originalAssistant, content: "A updated" };
    const secondRoom: Session = {
      ...firstRoom,
      collaboration: {
        ...firstRoom.collaboration!,
        agentEvents: {
          [primary.id]: [
            firstRoom.collaboration!.agentEvents[primary.id][0],
            updatedAssistant,
          ],
        },
      },
    };
    const second = projectCollaborationTimeline(secondRoom);
    const firstProjected = first.find((event) => event.id === "assistant-a");
    const secondProjected = second.find((event) => event.id === "assistant-a");
    expect(firstProjected).toBeDefined();
    expect(secondProjected).toBeDefined();
    expect(secondProjected).not.toBe(firstProjected);
    expect(secondProjected).toMatchObject({ content: "A updated" });
  });
});
