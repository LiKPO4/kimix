import { describe, expect, it } from "vitest";
import type { RoomAgentActivity, Session, TimelineEvent } from "@/types/ui";
import { createCollaborationStateFromSession } from "../collaborationRooms";
import {
  appendRoomAgentSteerEvent,
  getRoomAgentControlTargets,
  getPersistedRoomAgentControlTargets,
  getRoomAgentReconciliationTargets,
  isRoomAgentReconciliationStatus,
  resolveRoomAgentControlTarget,
  settleStoppedRoomAgent,
  settleTerminalRoomAgent,
} from "../roomAgentControl";

function roomFixture(): Session {
  const primaryEvents: TimelineEvent[] = [{
    id: "primary-user",
    type: "user_message",
    timestamp: 1,
    content: "Primary",
  }];
  const session: Session = {
    id: "room-1",
    engine: "kimi-code",
    runtimeSessionId: "runtime-primary",
    officialSessionId: "official-primary",
    model: "kimi-code/kimi-for-coding",
    title: "Room",
    projectPath: "D:/WORKS/test",
    createdAt: 1,
    updatedAt: 2,
    events: primaryEvents,
    isLoading: false,
  };
  const collaboration = createCollaborationStateFromSession(session);
  const primary = collaboration.agents[0];
  const secondaryEvents: TimelineEvent[] = [{
    id: "secondary-assistant",
    type: "assistant_message",
    timestamp: 10,
    content: "Working",
    isThinking: false,
    isComplete: false,
    roomAgentId: "agent-secondary",
    roomMessageId: "message-secondary",
    agentTurnId: "turn-secondary",
  }, {
    id: "secondary-question",
    type: "question_request",
    timestamp: 11,
    requestId: "question-request",
    rpcRequestId: "question-rpc",
    toolCallId: "question-tool",
    questions: [{ question: "Continue?", options: [{ label: "Yes" }] }],
    status: "pending",
    roomAgentId: "agent-secondary",
  }, {
    id: "secondary-approval",
    type: "approval_request",
    timestamp: 12,
    requestId: "approval-request",
    toolName: "Write",
    description: "Write file",
    details: "{}",
    riskLevel: "medium",
    status: "pending",
    roomAgentId: "agent-secondary",
  }, {
    id: "secondary-steer",
    type: "steer_message",
    timestamp: 13,
    content: "Also inspect tests",
    status: "accepted",
    roomAgentId: "agent-secondary",
  }];
  return {
    ...session,
    collaboration: {
      ...collaboration,
      agents: [primary, {
        id: "agent-secondary",
        displayName: "Reviewer",
        mentionName: "reviewer",
        modelAlias: "openai/gpt-5",
        permissionMode: "manual",
        runtimeSessionId: "runtime-secondary",
        officialSessionId: "official-secondary",
        createdAt: 3,
      }],
      messages: [{
        id: "message-primary",
        content: "Primary task",
        recipientAgentIds: [primary.id],
        deliveries: {
          [primary.id]: { status: "running", agentTurnId: "turn-primary" },
        },
        timestamp: 4,
      }, {
        id: "message-secondary",
        content: "Review task",
        recipientAgentIds: ["agent-secondary"],
        deliveries: {
          "agent-secondary": { status: "running", agentTurnId: "turn-secondary" },
        },
        timestamp: 5,
      }],
      agentEvents: {
        [primary.id]: primaryEvents.map((event) => ({ ...event, roomAgentId: primary.id })),
        "agent-secondary": secondaryEvents,
      },
    },
  };
}

function activities(room: Session): RoomAgentActivity[] {
  const primaryId = room.collaboration!.primaryAgentId;
  return [{
    roomId: room.id,
    roomAgentId: primaryId,
    runtimeSessionId: "runtime-primary",
    status: "running",
    roomMessageId: "message-primary",
    activeTurnId: "turn-primary",
    updatedAt: 10,
  }, {
    roomId: room.id,
    roomAgentId: "agent-secondary",
    runtimeSessionId: "runtime-secondary",
    status: "running",
    roomMessageId: "message-secondary",
    activeTurnId: "turn-secondary",
    updatedAt: 11,
  }];
}

describe("roomAgentControl", () => {
  it("returns controllable Agents in room member order and requires an explicit target when several run", () => {
    const room = roomFixture();
    const targets = getRoomAgentControlTargets(room, activities(room), "stop");
    expect(targets.map((target) => target.displayName)).toEqual([
      room.collaboration!.agents[0].displayName,
      "Reviewer",
    ]);
    expect(() => resolveRoomAgentControlTarget(room, activities(room), "stop")).toThrow("请明确选择目标");
    expect(resolveRoomAgentControlTarget(room, activities(room), "stop", "agent-secondary")).toMatchObject({
      runtimeSessionId: "runtime-secondary",
      roomMessageId: "message-secondary",
      activeTurnId: "turn-secondary",
    });
  });

  it("uses persisted delivery evidence when an activity entry is temporarily absent", () => {
    const room = roomFixture();
    const targets = getRoomAgentControlTargets(room, [], "steer");
    expect(targets.map((target) => target.roomAgentId)).toEqual([
      room.collaboration!.primaryAgentId,
      "agent-secondary",
    ]);
    expect(targets[1]).toMatchObject({
      runtimeSessionId: "runtime-secondary",
      roomMessageId: "message-secondary",
      activeTurnId: "turn-secondary",
    });
  });

  it("prefers explicit activity status over stale delivery evidence", () => {
    const room = roomFixture();
    const waitingActivities = activities(room).map((activity) => (
      activity.roomAgentId === "agent-secondary"
        ? { ...activity, status: "waiting_approval" as const }
        : activity
    ));

    expect(getRoomAgentControlTargets(room, waitingActivities, "stop").map((target) => target.roomAgentId)).toContain("agent-secondary");
    expect(getRoomAgentControlTargets(room, waitingActivities, "steer").map((target) => target.roomAgentId)).not.toContain("agent-secondary");
  });

  it("appends steer messages only to the selected Agent partition and keeps turn scope", () => {
    const room = roomFixture();
    const target = resolveRoomAgentControlTarget(room, activities(room), "steer", "agent-secondary");
    const next = appendRoomAgentSteerEvent(room, target, {
      id: "steer-secondary",
      type: "steer_message",
      timestamp: 20,
      content: "Check tests too",
      status: "sending",
    });

    expect(next.events).toEqual(room.events);
    expect(next.collaboration?.agentEvents[room.collaboration!.primaryAgentId]).toEqual(
      room.collaboration?.agentEvents[room.collaboration!.primaryAgentId],
    );
    expect(next.collaboration?.agentEvents["agent-secondary"]?.at(-1)).toMatchObject({
      id: "steer-secondary",
      roomAgentId: "agent-secondary",
      roomMessageId: "message-secondary",
      agentTurnId: "turn-secondary",
    });
  });

  it("settles only the stopped Agent and cancels only its delivery", () => {
    const room = roomFixture();
    const target = resolveRoomAgentControlTarget(room, activities(room), "stop", "agent-secondary");
    const next = settleStoppedRoomAgent(room, target, 100);

    expect(next.events).toEqual(room.events);
    expect(next.collaboration?.messages[0].deliveries[room.collaboration!.primaryAgentId].status).toBe("running");
    expect(next.collaboration?.messages[1].deliveries["agent-secondary"].status).toBe("cancelled");
    expect(next.collaboration?.agentEvents["agent-secondary"]?.[0]).toMatchObject({
      id: "secondary-assistant",
      isComplete: true,
      isThinking: false,
    });
    expect(next.collaboration?.agentEvents["agent-secondary"]?.[1]).toMatchObject({
      id: "secondary-question",
      status: "skipped",
    });
    expect(next.collaboration?.agentEvents["agent-secondary"]?.[2]).toMatchObject({
      id: "secondary-approval",
      status: "rejected",
    });
    expect(next.collaboration?.agentEvents["agent-secondary"]?.[3]).toMatchObject({
      id: "secondary-steer",
      status: "failed",
    });
  });

  it("discovers persisted active deliveries without an in-memory activity registry", () => {
    const room = roomFixture();

    expect(getPersistedRoomAgentControlTargets([room], "stop")).toEqual([
      expect.objectContaining({
        roomId: room.id,
        roomAgentId: room.collaboration?.primaryAgentId,
        roomMessageId: "message-primary",
        status: "running",
      }),
      expect.objectContaining({
        roomId: room.id,
        roomAgentId: "agent-secondary",
        roomMessageId: "message-secondary",
        status: "running",
      }),
    ]);
  });

  it("reconciles queued and indeterminate deliveries that are not user-stoppable yet", () => {
    const room = roomFixture();
    room.collaboration!.messages[0].deliveries[room.collaboration!.primaryAgentId].status = "queued";
    room.collaboration!.messages[1].deliveries["agent-secondary"].status = "indeterminate";

    expect(getRoomAgentReconciliationTargets(room, []).map((target) => target.status))
      .toEqual(["queued", "indeterminate"]);
  });

  it("reconciles a creating activity after the Agent already has an official runtime", () => {
    const room = roomFixture();
    const creatingActivity: RoomAgentActivity = {
      roomId: room.id,
      roomAgentId: "agent-secondary",
      status: "creating",
      updatedAt: 10,
    };

    expect(getRoomAgentReconciliationTargets(room, [creatingActivity])
      .find((target) => target.roomAgentId === "agent-secondary"))
      .toMatchObject({
        roomAgentId: "agent-secondary",
        runtimeSessionId: "runtime-secondary",
        status: "creating",
      });
    expect(isRoomAgentReconciliationStatus("creating")).toBe(true);
  });

  it("settles the persisted delivery when the official runtime is terminal", () => {
    const room = roomFixture();
    const target = getRoomAgentReconciliationTargets(room, [])
      .find((candidate) => candidate.roomAgentId === "agent-secondary")!;
    const next = settleTerminalRoomAgent(room, target, "completed", 100);

    expect(next.collaboration?.messages[1].deliveries["agent-secondary"].status).toBe("completed");
    expect(next.collaboration?.agentEvents["agent-secondary"]?.[0]).toMatchObject({
      id: "secondary-assistant",
      isComplete: true,
    });
  });
});
