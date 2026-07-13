import { describe, expect, it } from "vitest";
import type { RoomAgent, Session, TimelineEvent } from "@/types/ui";
import {
  createCollaborationStateFromSession,
  getEventRoomAgentId,
  getPrimaryRoomAgent,
  getRoomAgentRuntimeId,
  getRoomAgents,
  getSyntheticPrimaryAgentId,
  mirrorPrimaryAgentToLegacySession,
  resolveRoomRuntimeOwner,
  scopeEventToRoomAgent,
} from "../collaborationRooms";
import { getRuntimeSessionId } from "../runtimeSession";

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
    expect(collaboration.messages).toEqual([expect.objectContaining({
      content: "Review this",
      recipientAgentIds: [collaboration.primaryAgentId],
    })]);
    expect(collaboration.agentEvents[collaboration.primaryAgentId]).toEqual([
      expect.objectContaining({ id: "user-1", roomAgentId: collaboration.primaryAgentId }),
      expect.objectContaining({ id: "assistant-1", roomAgentId: collaboration.primaryAgentId }),
    ]);
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
});
