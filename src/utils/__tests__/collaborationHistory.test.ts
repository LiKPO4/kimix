import { describe, expect, it } from "vitest";
import type { RoomAgent, Session, TimelineEvent } from "@/types/ui";
import { createCollaborationStateFromSession } from "../collaborationRooms";
import { markAgentKimiHistoryCacheCurrent, reconcileAgentCanonicalHistory } from "../collaborationHistory";
import { KIMI_HISTORY_CACHE_VERSION } from "../kimiHistoryCache";
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
  it("does not mark an unaccepted canonical candidate as a migrated cache", () => {
    const current = room();
    current.session.collaboration!.agents[0].kimiHistoryCacheVersion = KIMI_HISTORY_CACHE_VERSION - 1;
    const result = reconcileAgentCanonicalHistory({
      session: current.session,
      roomAgentId: current.primaryId,
      expectedRuntimeSessionId: "runtime-a",
      canonicalEvents: [{ id: "canonical", type: "user_message", timestamp: 20, content: "Canonical" }],
      reason: "startup",
    });

    expect(result.applied).toBe(true);
    expect(result.session.collaboration?.agents.find((agent) => agent.id === current.primaryId)?.kimiHistoryCacheVersion)
      .toBe(KIMI_HISTORY_CACHE_VERSION - 1);
  });

  it("marks only the adopted Agent cache as current", () => {
    const current = room();
    const marked = markAgentKimiHistoryCacheCurrent(current.session, current.primaryId);

    expect(marked.collaboration?.agents.find((agent) => agent.id === current.primaryId)?.kimiHistoryCacheVersion)
      .toBe(KIMI_HISTORY_CACHE_VERSION);
    expect(marked.collaboration?.agents.find((agent) => agent.id === current.secondaryId)?.kimiHistoryCacheVersion)
      .toBeUndefined();
  });

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

  it("migrates an identity-less legacy room delivery from one unique canonical user event", () => {
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

  it("binds repeated text by stable delivery identity without guessing", () => {
    const current = room();
    current.session.collaboration!.messages = [{
      id: "room-message-first",
      content: "Repeat",
      outboundContent: "Repeat",
      recipientAgentIds: [current.primaryId],
      deliveries: {
        [current.primaryId]: {
          status: "completed",
          dispatchAttemptId: "attempt-first",
          agentTurnId: "turn-first",
        },
      },
      timestamp: 100,
    }, {
      id: "room-message-second",
      content: "Repeat",
      outboundContent: "Repeat",
      recipientAgentIds: [current.primaryId],
      deliveries: {
        [current.primaryId]: {
          status: "completed",
          dispatchAttemptId: "attempt-second",
          agentTurnId: "turn-second",
        },
      },
      timestamp: 101,
    }];

    const result = reconcileAgentCanonicalHistory({
      session: current.session,
      roomAgentId: current.primaryId,
      expectedRuntimeSessionId: "runtime-a",
      canonicalEvents: [
        {
          id: "canonical-user-first",
          type: "user_message",
          timestamp: 102,
          content: "Repeat",
          roomMessageId: "room-message-first",
          agentTurnId: "turn-first",
          dispatchAttemptId: "attempt-first",
        },
        { id: "assistant-first", type: "assistant_message", timestamp: 103, content: "First", isThinking: false, isComplete: true },
        {
          id: "canonical-user-second",
          type: "user_message",
          timestamp: 104,
          content: "Repeat",
          roomMessageId: "room-message-second",
          agentTurnId: "turn-second",
          dispatchAttemptId: "attempt-second",
        },
        { id: "assistant-second", type: "assistant_message", timestamp: 105, content: "Second", isThinking: false, isComplete: true },
      ],
      reason: "startup",
    });

    expect(result.session.collaboration?.messages.map((message) => (
      message.deliveries[current.primaryId].officialUserEventId
    ))).toEqual(["canonical-user-first", "canonical-user-second"]);
    expect(projectCollaborationTimeline(result.session).filter((event) => event.type === "user_message").map((event) => event.id))
      .toEqual(["b-old", "room-message-first", "room-message-second"]);
  });

  it("restores a missing attempt id from the matching canonical delivery identity", () => {
    const current = room();
    current.session.collaboration!.messages = [{
      id: "room-message-damaged",
      content: "Only once",
      recipientAgentIds: [current.primaryId],
      deliveries: {
        [current.primaryId]: {
          status: "completed",
          agentTurnId: "turn-damaged",
          officialUserEventId: "live-user-alias",
        },
      },
      timestamp: 100,
    }];

    const result = reconcileAgentCanonicalHistory({
      session: current.session,
      roomAgentId: current.primaryId,
      expectedRuntimeSessionId: "runtime-a",
      canonicalEvents: [
        {
          id: "live-user-alias",
          type: "user_message",
          timestamp: 100,
          content: "Only once",
          roomMessageId: "room-message-damaged",
          agentTurnId: "turn-damaged",
        },
        {
          id: "canonical-user-damaged",
          type: "user_message",
          timestamp: 101,
          content: "Only once",
          roomMessageId: "room-message-damaged",
          agentTurnId: "turn-damaged",
          dispatchAttemptId: "attempt-damaged",
        },
      ],
      reason: "startup",
    });

    expect(result.session.collaboration?.messages[0].deliveries[current.primaryId]).toMatchObject({
      dispatchAttemptId: "attempt-damaged",
      officialUserEventId: "canonical-user-damaged",
    });
    expect(projectCollaborationTimeline(result.session)
      .filter((event) => event.type === "user_message")
      .map((event) => event.id))
      .toEqual(["b-old", "room-message-damaged"]);
  });

  it("does not bind one identity-less official event id to either competing delivery", () => {
    const current = room();
    current.session.collaboration!.messages = [
      {
        id: "room-message-first",
        content: "First",
        recipientAgentIds: [current.primaryId],
        deliveries: {
          [current.primaryId]: {
            status: "completed",
            agentTurnId: "turn-first",
            officialUserEventId: "canonical-shared",
          },
        },
        timestamp: 100,
      },
      {
        id: "room-message-second",
        content: "Second",
        recipientAgentIds: [current.primaryId],
        deliveries: {
          [current.primaryId]: {
            status: "completed",
            agentTurnId: "turn-second",
            officialUserEventId: "canonical-shared",
          },
        },
        timestamp: 101,
      },
    ];

    const result = reconcileAgentCanonicalHistory({
      session: current.session,
      roomAgentId: current.primaryId,
      expectedRuntimeSessionId: "runtime-a",
      canonicalEvents: [
        { id: "canonical-shared", type: "user_message", timestamp: 102, content: "First" },
        { id: "canonical-result", type: "assistant_message", timestamp: 103, content: "Result", isThinking: false, isComplete: true },
      ],
      reason: "startup",
    });

    expect(result.events.every((event) => event.roomMessageId === undefined && event.agentTurnId === undefined))
      .toBe(true);
    expect(projectCollaborationTimeline(result.session)
      .filter((event) => event.type === "user_message")
      .map((event) => event.id))
      .toEqual(["b-old", "room-message-first", "room-message-second", "canonical-shared"]);
  });

  it("keeps two real repeated prompts distinct while repairing both missing attempts", () => {
    const current = room();
    current.session.collaboration!.messages = [
      {
        id: "room-message-first",
        content: "Repeat",
        recipientAgentIds: [current.primaryId],
        deliveries: {
          [current.primaryId]: { status: "completed", agentTurnId: "turn-first" },
        },
        timestamp: 100,
      },
      {
        id: "room-message-second",
        content: "Repeat",
        recipientAgentIds: [current.primaryId],
        deliveries: {
          [current.primaryId]: { status: "completed", agentTurnId: "turn-second" },
        },
        timestamp: 101,
      },
    ];

    const result = reconcileAgentCanonicalHistory({
      session: current.session,
      roomAgentId: current.primaryId,
      expectedRuntimeSessionId: "runtime-a",
      canonicalEvents: [
        {
          id: "canonical-first",
          type: "user_message",
          timestamp: 102,
          content: "Repeat",
          roomMessageId: "room-message-first",
          agentTurnId: "turn-first",
          dispatchAttemptId: "attempt-first",
        },
        {
          id: "canonical-second",
          type: "user_message",
          timestamp: 103,
          content: "Repeat",
          roomMessageId: "room-message-second",
          agentTurnId: "turn-second",
          dispatchAttemptId: "attempt-second",
        },
      ],
      reason: "startup",
    });

    expect(result.session.collaboration?.messages.map((message) => (
      message.deliveries[current.primaryId].dispatchAttemptId
    ))).toEqual(["attempt-first", "attempt-second"]);
    expect(projectCollaborationTimeline(result.session)
      .filter((event) => event.type === "user_message")
      .map((event) => event.id))
      .toEqual(["b-old", "room-message-first", "room-message-second"]);
  });

  it("does not recover a canonical attempt already owned by another delivery", () => {
    const current = room();
    current.session.collaboration!.messages = [
      {
        id: "room-message-target",
        content: "Target",
        recipientAgentIds: [current.primaryId],
        deliveries: {
          [current.primaryId]: { status: "completed", agentTurnId: "turn-target" },
        },
        timestamp: 100,
      },
      {
        id: "room-message-owner",
        content: "Owner",
        recipientAgentIds: [current.secondaryId],
        deliveries: {
          [current.secondaryId]: {
            status: "completed",
            agentTurnId: "turn-owner",
            dispatchAttemptId: "attempt-owned",
          },
        },
        timestamp: 101,
      },
    ];

    const result = reconcileAgentCanonicalHistory({
      session: current.session,
      roomAgentId: current.primaryId,
      expectedRuntimeSessionId: "runtime-a",
      canonicalEvents: [{
        id: "canonical-target",
        type: "user_message",
        timestamp: 102,
        content: "Target",
        roomMessageId: "room-message-target",
        agentTurnId: "turn-target",
        dispatchAttemptId: "attempt-owned",
      }],
      reason: "startup",
    });

    expect(result.session.collaboration?.messages[0].deliveries[current.primaryId].dispatchAttemptId)
      .toBeUndefined();
    expect(result.session.collaboration?.messages[0].deliveries[current.primaryId].officialUserEventId)
      .toBe("canonical-target");
  });

  it("does not downgrade an explicit attempt conflict to text and time matching", () => {
    const current = room();
    current.session.collaboration!.messages = [{
      id: "room-message-conflict",
      content: "Same request",
      recipientAgentIds: [current.primaryId],
      deliveries: {
        [current.primaryId]: {
          status: "completed",
          agentTurnId: "turn-conflict",
          dispatchAttemptId: "attempt-current",
          officialUserEventId: "legacy-missing",
        },
      },
      timestamp: 100,
    }];

    const result = reconcileAgentCanonicalHistory({
      session: current.session,
      roomAgentId: current.primaryId,
      expectedRuntimeSessionId: "runtime-a",
      canonicalEvents: [
        { id: "canonical-identityless", type: "user_message", timestamp: 101, content: "Same request" },
        {
          id: "canonical-conflict",
          type: "user_message",
          timestamp: 102,
          content: "Same request",
          roomMessageId: "room-message-conflict",
          agentTurnId: "turn-conflict",
          dispatchAttemptId: "attempt-other",
        },
      ],
      reason: "startup",
    });

    expect(result.events[0]).not.toHaveProperty("roomMessageId");
    expect(result.events[0]).not.toHaveProperty("agentTurnId");
    expect(result.session.collaboration?.messages[0].deliveries[current.primaryId].officialUserEventId)
      .toBe("legacy-missing");
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

  it("does not let a stale official event ID override mismatched delivery identity", () => {
    const current = room();
    current.session.collaboration!.messages = [{
      id: "room-message-safe",
      content: "Safe",
      recipientAgentIds: [current.primaryId],
      deliveries: {
        [current.primaryId]: {
          status: "completed",
          dispatchAttemptId: "attempt-safe",
          agentTurnId: "turn-safe",
          officialUserEventId: "canonical-user-stale",
        },
      },
      timestamp: 100,
    }];

    const result = reconcileAgentCanonicalHistory({
      session: current.session,
      roomAgentId: current.primaryId,
      expectedRuntimeSessionId: "runtime-a",
      canonicalEvents: [{
        id: "canonical-user-stale",
        type: "user_message",
        timestamp: 101,
        content: "Safe",
        roomMessageId: "another-message",
        agentTurnId: "another-turn",
        dispatchAttemptId: "another-attempt",
      }],
      reason: "startup",
    });

    expect(result.events[0]).not.toHaveProperty("agentTurnId", "turn-safe");
    expect(result.session.collaboration?.messages[0].deliveries[current.primaryId].officialUserEventId)
      .toBe("canonical-user-stale");
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
