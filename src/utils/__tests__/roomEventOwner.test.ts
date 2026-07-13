import { describe, expect, it } from "vitest";
import type { RoomAgent, Session, TimelineEvent } from "@/types/ui";
import { createCollaborationStateFromSession } from "../collaborationRooms";
import { resolveRoomEventOwner, updateRoomEventForOwner } from "../roomEventOwner";

function legacySession(events: TimelineEvent[] = []): Session {
  return {
    id: "room-1",
    engine: "kimi-code",
    runtimeSessionId: "runtime-primary",
    officialSessionId: "official-primary",
    model: "kimi-code/kimi-for-coding",
    title: "Room",
    projectPath: "D:/WORKS/test",
    createdAt: 10,
    updatedAt: 20,
    events,
    isLoading: false,
  };
}

function secondaryAgent(overrides: Partial<RoomAgent> = {}): RoomAgent {
  return {
    id: "agent-secondary",
    displayName: "Reviewer",
    mentionName: "reviewer",
    modelAlias: "openai/gpt-5",
    permissionMode: "manual",
    runtimeSessionId: "runtime-secondary",
    officialSessionId: "official-secondary",
    createdAt: 30,
    ...overrides,
  };
}

function roomWithSecondary(primaryEvents: TimelineEvent[], secondaryEvents: TimelineEvent[] = []): Session {
  const session = legacySession(primaryEvents);
  const collaboration = createCollaborationStateFromSession(session);
  const secondary = secondaryAgent();
  return {
    ...session,
    collaboration: {
      ...collaboration,
      agents: [...collaboration.agents, secondary],
      agentEvents: {
        ...collaboration.agentEvents,
        [secondary.id]: secondaryEvents,
      },
    },
  };
}

describe("roomEventOwner", () => {
  it("keeps ordinary single-Agent approvals on the legacy primary runtime", () => {
    const approval: TimelineEvent = {
      id: "approval-primary",
      type: "approval_request",
      timestamp: 100,
      requestId: "request-primary",
      toolName: "Write",
      description: "Write file",
      details: "{}",
      riskLevel: "medium",
      status: "pending",
    };

    expect(resolveRoomEventOwner(legacySession([approval]), approval)).toMatchObject({
      runtimeSessionId: "runtime-primary",
    });
  });

  it("routes secondary approvals to the secondary runtime", () => {
    const approval: TimelineEvent = {
      id: "approval-secondary",
      type: "approval_request",
      timestamp: 100,
      requestId: "request-secondary",
      toolName: "Write",
      description: "Write file",
      details: "{}",
      riskLevel: "medium",
      status: "pending",
      roomAgentId: "agent-secondary",
    };
    const room = roomWithSecondary([], [approval]);

    expect(resolveRoomEventOwner(room, approval)).toEqual({
      roomAgentId: "agent-secondary",
      runtimeSessionId: "runtime-secondary",
      displayName: "Reviewer",
    });
  });

  it("settles a secondary question without modifying primary history", () => {
    const primaryEvent: TimelineEvent = {
      id: "primary-user",
      type: "user_message",
      timestamp: 90,
      content: "Primary history",
    };
    const question: TimelineEvent = {
      id: "question-secondary",
      type: "question_request",
      timestamp: 100,
      requestId: "request-secondary",
      rpcRequestId: "rpc-secondary",
      toolCallId: "tool-secondary",
      questions: [{ question: "Continue?", options: [{ label: "Yes" }] }],
      status: "pending",
      roomAgentId: "agent-secondary",
    };
    const room = roomWithSecondary([primaryEvent], [question]);
    const next = updateRoomEventForOwner(room, "agent-secondary", question.id, (event) => (
      event.type === "question_request"
        ? { ...event, status: "answered", answers: { "Continue?": "Yes" } }
        : event
    ));

    expect(next.events).toEqual([primaryEvent]);
    expect(next.collaboration?.agentEvents[next.collaboration.primaryAgentId]).toEqual([
      expect.objectContaining({ id: "primary-user" }),
    ]);
    expect(next.collaboration?.agentEvents["agent-secondary"]).toEqual([
      expect.objectContaining({ id: "question-secondary", status: "answered" }),
    ]);
  });

  it("rejects missing owners, removed Agents, and unavailable runtimes", () => {
    const unownedQuestion: TimelineEvent = {
      id: "question-unowned",
      type: "question_request",
      timestamp: 100,
      requestId: "request-unowned",
      rpcRequestId: "rpc-unowned",
      toolCallId: "tool-unowned",
      questions: [{ question: "Continue?", options: [{ label: "Yes" }] }],
      status: "pending",
    };
    const room = roomWithSecondary([], []);
    expect(() => resolveRoomEventOwner(room, unownedQuestion)).toThrow("缺少 Agent 所有者");

    const ownedQuestion = { ...unownedQuestion, roomAgentId: "agent-secondary" };
    const removedRoom: Session = {
      ...room,
      collaboration: {
        ...room.collaboration!,
        agents: room.collaboration!.agents.map((agent) => (
          agent.id === "agent-secondary" ? { ...agent, removedAt: 200 } : agent
        )),
      },
    };
    expect(() => resolveRoomEventOwner(removedRoom, ownedQuestion)).toThrow("已移出房间");

    const unavailableRoom: Session = {
      ...room,
      collaboration: {
        ...room.collaboration!,
        agents: room.collaboration!.agents.map((agent) => (
          agent.id === "agent-secondary"
            ? secondaryAgent({ runtimeSessionId: undefined, officialSessionId: undefined })
            : agent
        )),
      },
    };
    expect(() => resolveRoomEventOwner(unavailableRoom, ownedQuestion)).toThrow("运行会话尚未就绪");
  });
});
