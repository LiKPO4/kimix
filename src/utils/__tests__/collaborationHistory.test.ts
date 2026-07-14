import { describe, expect, it } from "vitest";
import type { RoomAgent, Session, TimelineEvent } from "@/types/ui";
import { createCollaborationStateFromSession } from "../collaborationRooms";
import { reconcileAgentCanonicalHistory } from "../collaborationHistory";
import { projectCollaborationTimeline } from "../collaborationTimeline";

function room(): { session: Session; primaryId: string; secondaryId: string } {
  const base: Session = {
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
  const collaboration = createCollaborationStateFromSession(base);
  const primary = collaboration.agents[0];
  const secondary: RoomAgent = {
    id: "agent-b",
    displayName: "GPT-5",
    mentionName: "gpt5",
    modelAlias: "openai/gpt-5",
    permissionMode: "manual",
    runtimeSessionId: "runtime-b",
    officialSessionId: "official-b",
    createdAt: 2,
  };
  const event = (id: string, content: string, roomAgentId: string): TimelineEvent => ({
    id,
    type: "user_message",
    timestamp: 10,
    content,
    roomAgentId,
  });
  return {
    primaryId: primary.id,
    secondaryId: secondary.id,
    session: {
      ...base,
      collaboration: {
        ...collaboration,
        agents: [primary, secondary],
        agentEvents: {
          [primary.id]: [event("a-old", "A old", primary.id)],
          [secondary.id]: [event("b-old", "B old", secondary.id)],
        },
      },
    },
  };
}

describe("reconcileAgentCanonicalHistory", () => {
  it("lets an authoritative undo shorten only one Agent history", () => {
    const current = room();
    const result = reconcileAgentCanonicalHistory({
      session: current.session,
      roomAgentId: current.primaryId,
      expectedRuntimeSessionId: "runtime-a",
      canonicalEvents: [],
      reason: "undo",
    });

    expect(result.applied).toBe(true);
    expect(result.session.collaboration?.agentEvents[current.primaryId]).toEqual([]);
    expect(result.session.collaboration?.agentEvents[current.secondaryId].map((event) => event.id)).toEqual(["b-old"]);
  });

  it("discards a late snapshot after the Agent runtime identity changed", () => {
    const current = room();
    const result = reconcileAgentCanonicalHistory({
      session: current.session,
      roomAgentId: current.secondaryId,
      expectedRuntimeSessionId: "runtime-b-old",
      canonicalEvents: [{ id: "late", type: "user_message", timestamp: 20, content: "Late" }],
      reason: "running-sample",
    });

    expect(result.applied).toBe(false);
    expect(result.discardedReason).toBe("runtime-changed");
    expect(result.session).toBe(current.session);
  });

  it("scopes repaired canonical events to the target Agent", () => {
    const current = room();
    const result = reconcileAgentCanonicalHistory({
      session: current.session,
      roomAgentId: current.secondaryId,
      expectedRuntimeSessionId: "runtime-b",
      canonicalEvents: [{ id: "b-next", type: "user_message", timestamp: 20, content: "B next" }],
      reason: "repair",
    });

    expect(result.events).toEqual([expect.objectContaining({ id: "b-next", roomAgentId: current.secondaryId })]);
    expect(result.session.collaboration?.agentEvents[current.primaryId].map((event) => event.id)).toEqual(["a-old"]);
  });

  it("rebinds a legacy delivery only when the canonical user match is unique", () => {
    const current = room();
    current.session.collaboration!.messages = [{
      id: "room-message-a",
      content: "Same request",
      recipientAgentIds: [current.primaryId],
      deliveries: {
        [current.primaryId]: {
          status: "completed",
          agentTurnId: "turn-a",
          officialUserEventId: "legacy-user-a",
        },
      },
      timestamp: 100,
    }];

    const result = reconcileAgentCanonicalHistory({
      session: current.session,
      roomAgentId: current.primaryId,
      expectedRuntimeSessionId: "runtime-a",
      canonicalEvents: [
        { id: "canonical-user-a", type: "user_message", timestamp: 110, content: "Same request" },
        { id: "canonical-assistant-a", type: "assistant_message", timestamp: 120, content: "Done", isThinking: false, isComplete: true },
      ],
      reason: "startup",
    });

    expect(result.session.collaboration?.messages[0].deliveries[current.primaryId].officialUserEventId).toBe("canonical-user-a");
    expect(result.events).toEqual([
      expect.objectContaining({ id: "canonical-user-a", roomMessageId: "room-message-a", agentTurnId: "turn-a" }),
      expect.objectContaining({ id: "canonical-assistant-a", roomMessageId: "room-message-a", agentTurnId: "turn-a" }),
    ]);
  });

  it("binds a new room delivery to one unique canonical user event", () => {
    const current = room();
    current.session.collaboration!.messages = [{
      id: "room-message-new",
      content: "@mimo Review the changes",
      outboundContent: "Review the changes",
      recipientAgentIds: [current.primaryId],
      deliveries: {
        [current.primaryId]: {
          status: "completed",
          agentTurnId: "turn-new",
        },
      },
      timestamp: 100,
    }];

    const result = reconcileAgentCanonicalHistory({
      session: current.session,
      roomAgentId: current.primaryId,
      expectedRuntimeSessionId: "runtime-a",
      canonicalEvents: [
        { id: "canonical-user-new", type: "user_message", timestamp: 101, content: "Review the changes" },
        { id: "canonical-assistant-new", type: "assistant_message", timestamp: 102, content: "Done", isThinking: false, isComplete: true },
      ],
      reason: "startup",
    });

    expect(result.session.collaboration?.messages[0].deliveries[current.primaryId].officialUserEventId).toBe("canonical-user-new");
    expect(result.events).toEqual([
      expect.objectContaining({ id: "canonical-user-new", roomMessageId: "room-message-new", agentTurnId: "turn-new" }),
      expect.objectContaining({ id: "canonical-assistant-new", roomMessageId: "room-message-new", agentTurnId: "turn-new" }),
    ]);
    expect(projectCollaborationTimeline(result.session).filter((event) => (
      event.type === "user_message" && event.roomMessageId === "room-message-new"
    ))).toEqual([
      expect.objectContaining({ id: "room-message-new", content: "@mimo Review the changes" }),
    ]);
  });

  it("does not guess between repeated canonical user messages", () => {
    const current = room();
    current.session.collaboration!.messages = [{
      id: "room-message-a",
      content: "Repeat",
      recipientAgentIds: [current.primaryId],
      deliveries: {
        [current.primaryId]: {
          status: "completed",
          agentTurnId: "turn-a",
          officialUserEventId: "legacy-user-a",
        },
      },
      timestamp: 100,
    }];

    const result = reconcileAgentCanonicalHistory({
      session: current.session,
      roomAgentId: current.primaryId,
      expectedRuntimeSessionId: "runtime-a",
      canonicalEvents: [
        { id: "canonical-user-1", type: "user_message", timestamp: 105, content: "Repeat" },
        { id: "canonical-user-2", type: "user_message", timestamp: 110, content: "Repeat" },
      ],
      reason: "startup",
    });

    expect(result.session.collaboration?.messages[0].deliveries[current.primaryId].officialUserEventId).toBe("legacy-user-a");
    expect(result.events.every((event) => event.roomMessageId === undefined && event.agentTurnId === undefined)).toBe(true);
  });

  it("removes only the target single-recipient room message after official undo", () => {
    const current = room();
    current.session.collaboration!.messages = [{
      id: "message-a",
      content: "A latest",
      recipientAgentIds: [current.primaryId],
      deliveries: {
        [current.primaryId]: {
          status: "completed",
          agentTurnId: "turn-a",
          officialUserEventId: "user-a-latest",
        },
      },
      timestamp: 100,
    }, {
      id: "message-b",
      content: "B stays",
      recipientAgentIds: [current.secondaryId],
      deliveries: {
        [current.secondaryId]: {
          status: "completed",
          agentTurnId: "turn-b",
          officialUserEventId: "user-b",
        },
      },
      timestamp: 101,
    }];

    const result = reconcileAgentCanonicalHistory({
      session: current.session,
      roomAgentId: current.primaryId,
      expectedRuntimeSessionId: "runtime-a",
      canonicalEvents: [],
      reason: "undo",
    });

    expect(result.session.collaboration?.messages.map((message) => message.id)).toEqual(["message-b"]);
    expect(result.session.collaboration?.agentEvents[current.secondaryId].map((event) => event.id)).toEqual(["b-old"]);
  });
});
