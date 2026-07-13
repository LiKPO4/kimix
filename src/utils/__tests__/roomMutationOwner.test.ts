import { describe, expect, it } from "vitest";
import type { Session, TimelineEvent } from "@/types/ui";
import { createCollaborationStateFromSession } from "../collaborationRooms";
import {
  appendRoomMutationEvent,
  resolveRoomMutationOwner,
  updateRoomMutationOwner,
} from "../roomMutationOwner";

function legacySession(): Session {
  return {
    id: "room-1",
    engine: "kimi-code",
    runtimeSessionId: "runtime-primary",
    officialSessionId: "official-primary",
    model: "kimi-code/k2.5",
    permissionMode: "auto",
    planMode: false,
    title: "Room",
    projectPath: "D:/WORKS/test",
    createdAt: 1,
    updatedAt: 2,
    events: [],
    isLoading: false,
  };
}

function roomFixture() {
  const session = legacySession();
  const collaboration = createCollaborationStateFromSession(session);
  const secondary = {
    id: "agent-secondary",
    displayName: "Reviewer",
    mentionName: "reviewer",
    modelAlias: "openai/gpt-5",
    permissionMode: "manual" as const,
    planMode: true,
    runtimeSessionId: "runtime-secondary",
    officialSessionId: "official-secondary",
    createdAt: 3,
  };
  return {
    ...session,
    collaboration: {
      ...collaboration,
      defaultRecipientIds: [secondary.id],
      focusedAgentId: secondary.id,
      agents: [...collaboration.agents, secondary],
      agentEvents: { ...collaboration.agentEvents, [secondary.id]: [] },
    },
  } satisfies Session;
}

describe("roomMutationOwner", () => {
  it("keeps an ordinary session on its synthetic primary owner", () => {
    const owner = resolveRoomMutationOwner(legacySession());
    expect(owner).toMatchObject({
      runtimeSessionId: "runtime-primary",
      isPrimary: true,
      agent: { permissionMode: "auto", planMode: false },
    });
  });

  it("resolves the single selected secondary Agent with its own session view", () => {
    const room = roomFixture();
    const owner = resolveRoomMutationOwner(room);
    expect(owner).toMatchObject({
      roomAgentId: "agent-secondary",
      runtimeSessionId: "runtime-secondary",
      isPrimary: false,
      sessionView: {
        runtimeSessionId: "runtime-secondary",
        model: "openai/gpt-5",
        permissionMode: "manual",
        planMode: true,
      },
    });
  });

  it("rejects ambiguous multi-Agent mutation targets", () => {
    const room = roomFixture();
    expect(() => resolveRoomMutationOwner(room, [room.collaboration!.primaryAgentId, "agent-secondary"]))
      .toThrow("只能作用于一个 Agent");
  });

  it("rejects an empty explicit mutation target instead of falling back to primary", () => {
    const room = roomFixture();
    expect(() => resolveRoomMutationOwner(room, [])).toThrow("请先选择一个 Agent");
  });

  it("keeps the current legacy permission fallback during unrelated mutations", () => {
    const session = { ...legacySession(), permissionMode: undefined };
    const owner = resolveRoomMutationOwner(session, undefined, "auto");
    const updated = updateRoomMutationOwner(session, owner.roomAgentId, (agent) => ({
      ...agent,
      planMode: true,
    }), "auto");

    expect(updated.permissionMode).toBe("auto");
    expect(updated.planMode).toBe(true);
  });

  it("updates and appends only inside the selected Agent partition", () => {
    const room = roomFixture();
    const owner = resolveRoomMutationOwner(room);
    const updated = updateRoomMutationOwner(room, owner.roomAgentId, (agent) => ({
      ...agent,
      permissionMode: "yolo",
      planMode: false,
    }));
    const event: TimelineEvent = {
      id: "secondary-status",
      type: "status_update",
      timestamp: 10,
      message: "Plan 模式已关闭",
    };
    const appended = appendRoomMutationEvent(updated, owner.roomAgentId, event);

    expect(appended.permissionMode).toBe("auto");
    expect(appended.planMode).toBe(false);
    expect(appended.collaboration?.agents.find((agent) => agent.id === owner.roomAgentId)).toMatchObject({
      permissionMode: "yolo",
      planMode: false,
    });
    expect(appended.events).toEqual([]);
    expect(appended.collaboration?.agentEvents[owner.roomAgentId]).toEqual([
      expect.objectContaining({ id: "secondary-status", roomAgentId: owner.roomAgentId }),
    ]);
  });
});
