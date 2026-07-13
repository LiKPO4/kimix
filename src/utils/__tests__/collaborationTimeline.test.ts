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
});
