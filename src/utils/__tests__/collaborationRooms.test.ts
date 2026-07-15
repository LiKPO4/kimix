import { describe, expect, it } from "vitest";
import type { RoomAgent, Session, TimelineEvent } from "@/types/ui";
import {
  createCollaborationStateFromSession,
  getEventRoomAgentId,
  getPrimaryRoomAgent,
  getRoomAgentRuntimeId,
  getRoomAgentSessionView,
  getRoomAgents,
  getSyntheticPrimaryAgentId,
  mirrorPrimaryAgentToLegacySession,
  normalizeLoadedSessionCollaboration,
  replaceRoomAgentEvents,
  resolveRoomRuntimeOwner,
  scopeEventToRoomAgent,
} from "../collaborationRooms";
import { getRuntimeSessionId } from "../runtimeSession";
import { mergeEvents } from "../eventMapper";

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

describe("collaborationRooms", () => {
  it("maps an old Session to one stable synthetic primary Agent without persisting a room", () => {
    const session = legacySession();
    const agents = getRoomAgents(session);

    expect(session.collaboration).toBeUndefined();
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      id: getSyntheticPrimaryAgentId(session.id),
      runtimeSessionId: "runtime-primary",
      officialSessionId: "official-primary",
      modelAlias: "kimi-code/kimi-for-coding",
    });
    expect(getRuntimeSessionId(session)).toBe("runtime-primary");
  });

  it("creates an idempotent collaboration snapshot with primary-scoped legacy history", () => {
    const user: TimelineEvent = { id: "user-1", type: "user_message", timestamp: 100, content: "Review this" };
    const assistant: TimelineEvent = {
      id: "assistant-1",
      type: "assistant_message",
      timestamp: 110,
      content: "Done",
      isThinking: false,
      isComplete: true,
    };
    const session = legacySession([user, assistant]);
    const collaboration = createCollaborationStateFromSession(session, "auto");
    const persisted = { ...session, collaboration };

    expect(createCollaborationStateFromSession(persisted)).toBe(collaboration);
    expect(collaboration.primaryMirrorUpdatedAt).toBe(session.updatedAt);
    expect(collaboration.messages).toEqual([expect.objectContaining({
      content: "Review this",
      recipientAgentIds: [collaboration.primaryAgentId],
    })]);
    expect(collaboration.agentEvents[collaboration.primaryAgentId]).toEqual([
      expect.objectContaining({ id: "user-1", roomAgentId: collaboration.primaryAgentId }),
      expect.objectContaining({ id: "assistant-1", roomAgentId: collaboration.primaryAgentId }),
    ]);
  });

  it("reconciles a newer legacy primary write without changing secondary history", () => {
    const oldPrimary: TimelineEvent = { id: "user-old", type: "user_message", timestamp: 100, content: "Old" };
    const session = legacySession([oldPrimary]);
    const collaboration = createCollaborationStateFromSession(session);
    const primary = collaboration.agents[0];
    const secondary = secondaryAgent();
    const room: Session = {
      ...session,
      model: "kimi-code/k2.5",
      updatedAt: 500,
      events: [{ id: "user-new", type: "user_message", timestamp: 400, content: "New primary" }],
      collaboration: {
        ...collaboration,
        primaryMirrorUpdatedAt: 200,
        agents: [primary, secondary],
        messages: collaboration.messages.map((message) => ({
          ...message,
          recipientAgentIds: [primary.id, secondary.id],
          deliveries: {
            ...message.deliveries,
            [secondary.id]: {
              status: "completed",
              agentTurnId: "turn-secondary-old",
              officialUserEventId: "user-secondary-old",
            },
          },
        })),
        agentEvents: {
          ...collaboration.agentEvents,
          [secondary.id]: [{
            id: "secondary-history",
            type: "user_message",
            timestamp: 105,
            content: "Secondary stays",
            roomAgentId: secondary.id,
          }],
        },
      },
    };

    const normalized = normalizeLoadedSessionCollaboration(room);
    expect(normalized.unsupportedCollaboration).toBeUndefined();
    expect(normalized.collaboration?.primaryMirrorUpdatedAt).toBe(500);
    expect(normalized.collaboration?.agents.find((agent) => agent.id === primary.id)?.modelAlias).toBe("kimi-code/k2.5");
    expect(normalized.collaboration?.agentEvents[primary.id].map((event) => event.id)).toEqual(["user-new"]);
    expect(normalized.collaboration?.agentEvents[secondary.id].map((event) => event.id)).toEqual(["secondary-history"]);
    expect(normalized.collaboration?.messages).toEqual([
      expect.objectContaining({ id: "room-message:user-old", recipientAgentIds: [secondary.id] }),
      expect.objectContaining({ id: "room-message:user-new", recipientAgentIds: [primary.id] }),
    ]);
  });

  it("preserves the primary delivery transaction when a newer legacy mirror has the same turn", () => {
    const primaryEvent: TimelineEvent = {
      id: "canonical-old",
      type: "user_message",
      timestamp: 100,
      content: "Review",
      roomMessageId: "message-stable",
      agentTurnId: "turn-stable",
      dispatchAttemptId: "attempt-stable",
    };
    const session = legacySession([primaryEvent]);
    const collaboration = createCollaborationStateFromSession(session);
    const primary = collaboration.agents[0];
    const secondary = secondaryAgent();
    const originalMessage = collaboration.messages[0];
    const room: Session = {
      ...session,
      updatedAt: 500,
      events: [{ ...primaryEvent, id: "canonical-latest", timestamp: 400 }],
      collaboration: {
        ...collaboration,
        primaryMirrorUpdatedAt: 200,
        agents: [primary, secondary],
        messages: [{
          ...originalMessage,
          outboundContent: "Review",
          recipientAgentIds: [secondary.id, primary.id],
          deliveries: {
            [secondary.id]: {
              status: "completed",
              agentTurnId: "turn-secondary",
              officialUserEventId: "secondary-user",
            },
            [primary.id]: {
              status: "running",
              agentTurnId: "turn-stable",
              dispatchAttemptId: "attempt-stable",
              officialPromptId: "prompt-stable",
              officialUserEventId: "canonical-old",
              createdAt: 101,
              updatedAt: 102,
              previousAttempts: [{
                dispatchAttemptId: "attempt-previous",
                agentTurnId: "turn-previous",
                status: "failed",
                createdAt: 90,
                updatedAt: 91,
              }],
              contextShare: {
                mode: "last",
                bridgeId: "bridge-stable",
                entryIds: ["entry-1"],
                content: "Context",
                contentChars: 7,
                createdAt: 99,
              },
            },
          },
        }],
        agentEvents: {
          [primary.id]: [primaryEvent],
          [secondary.id]: [{
            id: "secondary-user",
            type: "user_message",
            timestamp: 100,
            content: "Review",
            roomAgentId: secondary.id,
          }],
        },
      },
    };

    const normalized = normalizeLoadedSessionCollaboration(room);
    const message = normalized.collaboration?.messages[0];
    expect(message?.recipientAgentIds).toEqual([secondary.id, primary.id]);
    expect(message?.outboundContent).toBe("Review");
    expect(message?.deliveries[primary.id]).toMatchObject({
      status: "accepted",
      agentTurnId: "turn-stable",
      dispatchAttemptId: "attempt-stable",
      officialPromptId: "prompt-stable",
      officialUserEventId: "canonical-latest",
      createdAt: 101,
      updatedAt: 102,
      previousAttempts: [expect.objectContaining({ dispatchAttemptId: "attempt-previous" })],
      contextShare: expect.objectContaining({ bridgeId: "bridge-stable" }),
    });
    expect(message?.deliveries[secondary.id]).toMatchObject({ agentTurnId: "turn-secondary" });
  });

  it("repairs only one unambiguous attempt id and leaves conflicting attempts untouched", () => {
    const primaryEvent: TimelineEvent = {
      id: "canonical-user",
      type: "user_message",
      timestamp: 100,
      content: "Repair",
      roomMessageId: "message-repair",
      agentTurnId: "turn-repair",
      dispatchAttemptId: "attempt-repair",
    };
    const session = legacySession([primaryEvent]);
    const collaboration = createCollaborationStateFromSession(session);
    const primary = collaboration.agents[0];
    const damagedMessage = {
      ...collaboration.messages[0],
      deliveries: {
        [primary.id]: {
          status: "completed" as const,
          agentTurnId: "turn-repair",
          officialUserEventId: "canonical-user",
        },
      },
    };
    const repaired = normalizeLoadedSessionCollaboration({
      ...session,
      collaboration: {
        ...collaboration,
        messages: [damagedMessage],
        agentEvents: {
          [primary.id]: [
            primaryEvent,
            { ...primaryEvent, id: "canonical-same-attempt-alias" },
          ],
        },
      },
    });
    expect(repaired.collaboration?.messages[0].deliveries[primary.id].dispatchAttemptId)
      .toBe("attempt-repair");

    const conflicting = normalizeLoadedSessionCollaboration({
      ...session,
      collaboration: {
        ...collaboration,
        messages: [damagedMessage],
        agentEvents: {
          [primary.id]: [
            primaryEvent,
            { ...primaryEvent, id: "canonical-same-attempt-alias" },
            { ...primaryEvent, id: "canonical-alias", dispatchAttemptId: "attempt-conflict" },
          ],
        },
      },
    });
    expect(conflicting.collaboration?.messages[0].deliveries[primary.id].dispatchAttemptId)
      .toBeUndefined();
  });

  it("does not carry attempt-specific metadata across an explicit attempt change", () => {
    const oldEvent: TimelineEvent = {
      id: "canonical-old-attempt",
      type: "user_message",
      timestamp: 100,
      content: "Retry",
      roomMessageId: "message-retry",
      agentTurnId: "turn-retry",
      dispatchAttemptId: "attempt-old",
    };
    const session = legacySession([oldEvent]);
    const collaboration = createCollaborationStateFromSession(session);
    const primary = collaboration.agents[0];
    const room: Session = {
      ...session,
      updatedAt: 500,
      events: [{ ...oldEvent, id: "canonical-new-attempt", dispatchAttemptId: "attempt-new" }],
      collaboration: {
        ...collaboration,
        primaryMirrorUpdatedAt: 200,
        messages: collaboration.messages.map((message) => ({
          ...message,
          deliveries: {
            [primary.id]: {
              ...message.deliveries[primary.id],
              officialPromptId: "prompt-old",
              error: "old attempt failed",
              previousAttempts: [{
                dispatchAttemptId: "attempt-previous",
                agentTurnId: "turn-previous",
                status: "failed",
                createdAt: 90,
                updatedAt: 91,
              }],
            },
          },
        })),
      },
    };

    expect(normalizeLoadedSessionCollaboration(room).collaboration?.messages[0].deliveries[primary.id])
      .toEqual({
        status: "accepted",
        agentTurnId: "turn-retry",
        dispatchAttemptId: "attempt-new",
        officialUserEventId: "canonical-new-attempt",
        previousAttempts: [{
          dispatchAttemptId: "attempt-previous",
          agentTurnId: "turn-previous",
          status: "failed",
          createdAt: 90,
          updatedAt: 91,
        }],
      });
  });

  it("keeps future and invalid collaboration payloads opaque instead of downgrading them", () => {
    const session = legacySession();
    const futureRaw = { schemaVersion: 2, futureAgents: [{ id: "future" }] };
    const future = normalizeLoadedSessionCollaboration({
      ...session,
      collaboration: futureRaw as unknown as Session["collaboration"],
    });
    expect(future.collaboration).toBeUndefined();
    expect(future.unsupportedCollaboration).toEqual({
      reason: "unsupported-schema",
      schemaVersion: 2,
      raw: futureRaw,
    });
    expect(() => createCollaborationStateFromSession(future)).toThrow("无法安全修改");

    const invalidRaw = { schemaVersion: 1, agents: [], messages: [], agentEvents: {} };
    const invalid = normalizeLoadedSessionCollaboration({
      ...session,
      collaboration: invalidRaw as unknown as Session["collaboration"],
    });
    expect(invalid.collaboration).toBeUndefined();
    expect(invalid.unsupportedCollaboration).toEqual({
      reason: "invalid-schema",
      schemaVersion: 1,
      raw: invalidRaw,
    });

    const collaboration = createCollaborationStateFromSession(session);
    const invalidRecovery = normalizeLoadedSessionCollaboration({
      ...session,
      collaboration: {
        ...collaboration,
        agents: collaboration.agents.map((agent) => ({
          ...agent,
          recoveryIssue: { status: "unknown", message: "", updatedAt: "bad" },
        })) as unknown as RoomAgent[],
      },
    });
    expect(invalidRecovery.collaboration).toBeUndefined();
    expect(invalidRecovery.unsupportedCollaboration?.reason).toBe("invalid-schema");
  });

  it("resolves two runtime identities to different owners in the same room", () => {
    const session = legacySession();
    const collaboration = createCollaborationStateFromSession(session);
    const primary = collaboration.agents[0];
    const room: Session = {
      ...session,
      collaboration: {
        ...collaboration,
        agents: [primary, secondaryAgent()],
        agentEvents: { ...collaboration.agentEvents, "agent-secondary": [] },
      },
    };

    expect(resolveRoomRuntimeOwner([room], "runtime-primary")).toMatchObject({
      roomId: room.id,
      roomAgentId: primary.id,
    });
    expect(resolveRoomRuntimeOwner([room], "runtime-secondary")).toMatchObject({
      roomId: room.id,
      roomAgentId: "agent-secondary",
    });
    expect(getRoomAgentRuntimeId(room, "agent-secondary")).toBe("runtime-secondary");
  });

  it("treats unscoped events as primary and does not overwrite an explicit owner", () => {
    const session = legacySession();
    const primary = getPrimaryRoomAgent(session);
    const event: TimelineEvent = { id: "user-1", type: "user_message", timestamp: 1, content: "Hello" };
    const scoped = scopeEventToRoomAgent(event, "agent-secondary");

    expect(getEventRoomAgentId(session, event)).toBe(primary.id);
    expect(scoped.roomAgentId).toBe("agent-secondary");
    expect(scopeEventToRoomAgent(scoped, "agent-secondary")).toBe(scoped);
  });

  it("mirrors only the primary Agent into legacy Session fields", () => {
    const session = legacySession();
    const collaboration = createCollaborationStateFromSession(session);
    const primary = { ...collaboration.agents[0], runtimeSessionId: "runtime-primary-next", modelAlias: "kimi-code/k2.5" };
    const room: Session = {
      ...session,
      collaboration: {
        ...collaboration,
        agents: [primary, secondaryAgent()],
        agentEvents: {
          ...collaboration.agentEvents,
          [primary.id]: [{ id: "user-next", type: "user_message", timestamp: 200, content: "Next", roomAgentId: primary.id }],
          "agent-secondary": [{ id: "user-other", type: "user_message", timestamp: 210, content: "Other", roomAgentId: "agent-secondary" }],
        },
      },
    };

    const mirrored = mirrorPrimaryAgentToLegacySession(room);
    expect(mirrored.runtimeSessionId).toBe("runtime-primary-next");
    expect(mirrored.model).toBe("kimi-code/k2.5");
    expect(mirrored.events.map((event) => event.id)).toEqual(["user-next"]);
  });

  it("replaces only the selected Agent event partition", () => {
    const session = legacySession([{ id: "primary-old", type: "user_message", timestamp: 1, content: "Primary" }]);
    const collaboration = createCollaborationStateFromSession(session);
    const primary = collaboration.agents[0];
    const room: Session = {
      ...session,
      collaboration: {
        ...collaboration,
        agents: [primary, secondaryAgent()],
        agentEvents: {
          ...collaboration.agentEvents,
          "agent-secondary": [{ id: "secondary-old", type: "user_message", timestamp: 2, content: "Secondary", roomAgentId: "agent-secondary" }],
        },
      },
    };
    const nextSecondaryEvents: TimelineEvent[] = [
      { id: "secondary-next", type: "user_message", timestamp: 3, content: "Next", roomAgentId: "agent-secondary" },
    ];

    const next = replaceRoomAgentEvents(room, "agent-secondary", nextSecondaryEvents);
    expect(next.events.map((event) => event.id)).toEqual(["primary-old"]);
    expect(next.collaboration?.agentEvents[primary.id].map((event) => event.id)).toEqual(["primary-old"]);
    expect(next.collaboration?.agentEvents["agent-secondary"]).toBe(nextSecondaryEvents);
    expect(getRoomAgentSessionView(next, "agent-secondary")).toMatchObject({
      runtimeSessionId: "runtime-secondary",
      model: "openai/gpt-5",
      events: nextSecondaryEvents,
    });
  });

  it("keeps identical tool and Assistant identities isolated by Agent partition", () => {
    const session = legacySession();
    const collaboration = createCollaborationStateFromSession(session);
    const primary = collaboration.agents[0];
    const secondary = secondaryAgent();
    let room: Session = {
      ...session,
      collaboration: {
        ...collaboration,
        agents: [primary, secondary],
        agentEvents: { [primary.id]: [], [secondary.id]: [] },
      },
    };
    const primaryAssistant: TimelineEvent = {
      id: "assistant-shared",
      type: "assistant_message",
      timestamp: 1,
      content: "A",
      isThinking: false,
      isComplete: false,
      roomAgentId: primary.id,
    };
    const secondaryAssistant: TimelineEvent = {
      ...primaryAssistant,
      content: "B",
      roomAgentId: secondary.id,
    };
    const primaryTool: TimelineEvent = {
      id: "tool-a",
      type: "tool_call",
      timestamp: 2,
      toolCallId: "call-shared",
      toolName: "Read",
      status: "running",
      arguments: {},
      roomAgentId: primary.id,
    };
    const secondaryTool: TimelineEvent = { ...primaryTool, id: "tool-b", roomAgentId: secondary.id };

    room = replaceRoomAgentEvents(room, primary.id, mergeEvents([], primaryAssistant));
    room = replaceRoomAgentEvents(room, secondary.id, mergeEvents([], secondaryAssistant));
    room = replaceRoomAgentEvents(room, primary.id, mergeEvents(room.collaboration?.agentEvents[primary.id] ?? [], primaryTool));
    room = replaceRoomAgentEvents(room, secondary.id, mergeEvents(room.collaboration?.agentEvents[secondary.id] ?? [], secondaryTool));
    room = replaceRoomAgentEvents(room, primary.id, mergeEvents(room.collaboration?.agentEvents[primary.id] ?? [], {
      id: "result-a",
      type: "tool_result",
      timestamp: 3,
      toolCallId: "call-shared",
      toolName: "Read",
      result: "A done",
      roomAgentId: primary.id,
    }));

    const primaryEvents = room.collaboration?.agentEvents[primary.id] ?? [];
    const secondaryEvents = room.collaboration?.agentEvents[secondary.id] ?? [];
    expect(primaryEvents.find((event) => event.type === "assistant_message")).toMatchObject({ content: "A" });
    expect(secondaryEvents.find((event) => event.type === "assistant_message")).toMatchObject({ content: "B" });
    expect(primaryEvents.find((event) => event.type === "tool_call")).toMatchObject({ status: "success", result: "A done" });
    expect(secondaryEvents.find((event) => event.type === "tool_call")).toMatchObject({ status: "running" });
  });
});
