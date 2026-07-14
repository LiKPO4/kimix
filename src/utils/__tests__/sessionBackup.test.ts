import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../stores/appStore";
import { useSessionStore } from "../../stores/sessionStore";
import type { RoomAgent, Session, TimelineEvent } from "../../types/ui";
import type { SessionBackupSnapshot } from "@electron/types/ipc";
import {
  buildSessionBackupSnapshot,
  createSessionBackupImportPlan,
} from "../sessionBackup";
import {
  createCollaborationStateFromSession,
  synchronizeCollaborationPrimaryMirror,
} from "../collaborationRooms";

function userEvent(id: string, timestamp: number, content: string): TimelineEvent {
  return {
    id,
    type: "user_message",
    timestamp,
    content,
  };
}

function session(overrides: Partial<Session> & Pick<Session, "id">): Session {
  return {
    title: "测试会话",
    projectPath: "D:/project",
    createdAt: 1,
    updatedAt: 1,
    events: [],
    isLoading: false,
    ...overrides,
  };
}

function snapshot(
  sessions: Session[],
  options: Partial<SessionBackupSnapshot> = {},
): SessionBackupSnapshot {
  return {
    schemaVersion: 2,
    source: "Kimix",
    exportedAt: "2026-06-15T00:00:00.000Z",
    sessions,
    pendingMessages: [],
    projects: [],
    archivedTombstones: [],
    hiddenHandoffSessionIds: [],
    roomAgentActivities: [],
    activeContext: null,
    ...options,
  };
}

function roomSession(): Session {
  const base = session({
    id: "room-source",
    engine: "kimi-code",
    runtimeSessionId: "runtime-primary",
    officialSessionId: "official-primary",
    title: "协同房间",
    updatedAt: 100,
  });
  const initial = createCollaborationStateFromSession(base);
  const primary = {
    ...initial.agents[0],
    runtimeSessionId: "runtime-primary",
    officialSessionId: "official-primary",
  };
  const secondary: RoomAgent = {
    id: "agent-secondary",
    displayName: "Reviewer",
    mentionName: "reviewer",
    modelAlias: "openai/gpt-5",
    permissionMode: "manual",
    runtimeSessionId: "runtime-secondary",
    officialSessionId: "official-secondary",
    officialCatalogConfirmedAt: 90,
    missingSince: 95,
    recoveryIssue: { status: "error", message: "旧错误", updatedAt: 96 },
    createdAt: 2,
  };
  const messageId = "room-message-source";
  const primaryTurnId = "turn-primary";
  const secondaryTurnId = "turn-secondary";
  const room: Session = {
    ...base,
    collaboration: {
      ...initial,
      primaryAgentId: primary.id,
      defaultRecipientIds: [primary.id],
      focusedAgentId: secondary.id,
      agents: [primary, secondary],
      messages: [{
        id: messageId,
        content: "一起检查",
        recipientAgentIds: [primary.id, secondary.id],
        deliveries: {
          [primary.id]: {
            status: "completed",
            dispatchAttemptId: "attempt-primary",
            agentTurnId: primaryTurnId,
            createdAt: 10,
            updatedAt: 20,
          },
          [secondary.id]: {
            status: "completed",
            dispatchAttemptId: "attempt-secondary-next",
            agentTurnId: secondaryTurnId,
            createdAt: 30,
            updatedAt: 40,
            previousAttempts: [{
              status: "failed",
              dispatchAttemptId: "attempt-secondary-old",
              agentTurnId: "turn-secondary-old",
              error: "旧失败",
              createdAt: 10,
              updatedAt: 20,
            }],
          },
        },
        timestamp: 10,
      }],
      agentEvents: {
        [primary.id]: [{
          id: "primary-user",
          type: "user_message",
          timestamp: 10,
          content: "一起检查",
          roomAgentId: primary.id,
          roomMessageId: messageId,
          agentTurnId: primaryTurnId,
          dispatchAttemptId: "attempt-primary",
          recipientAgentIds: [primary.id, secondary.id],
        }],
        [secondary.id]: [{
          id: "secondary-user",
          type: "user_message",
          timestamp: 10,
          content: "一起检查",
          roomAgentId: secondary.id,
          roomMessageId: messageId,
          agentTurnId: secondaryTurnId,
          dispatchAttemptId: "attempt-secondary-next",
          recipientAgentIds: [primary.id, secondary.id],
        }],
      },
    },
  };
  return synchronizeCollaborationPrimaryMirror(room);
}

describe("createSessionBackupImportPlan", () => {
  beforeEach(() => {
    localStorage.clear();
    useSessionStore.setState({
      sessions: [],
      pendingMessages: [],
      recentProjects: [],
    });
    useAppStore.setState({
      currentSession: null,
      roomAgentActivities: {},
      runningSessionId: null,
      isRunning: false,
    });
  });

  it("keeps local hidden internal sessions while importing visible sessions", () => {
    useSessionStore.setState({
      sessions: [
        session({
          id: "local-visible",
          title: "本机普通会话",
          updatedAt: 10,
        }),
        session({
          id: "kimix-hidden-hooks-local",
          title: "Hooks 内部会话",
          updatedAt: 20,
        }),
      ],
      pendingMessages: [],
      recentProjects: [],
    });

    const plan = createSessionBackupImportPlan(snapshot([
      session({
        id: "imported-visible",
        title: "导入普通会话",
        updatedAt: 30,
      }),
    ]));

    expect(plan.sessions.map((item) => item.id)).toEqual([
      "imported-visible",
      "local-visible",
      "kimix-hidden-hooks-local",
    ]);
    expect(plan.stats.addedSessions).toBe(1);
  });

  it("forks sessions when both sides added different events to the same identity", () => {
    useSessionStore.setState({
      sessions: [
        session({
          id: "local-session",
          officialSessionId: "official-1",
          updatedAt: 20,
          events: [userEvent("local-event", 20, "本机继续聊")],
        }),
      ],
      pendingMessages: [],
      recentProjects: [],
    });

    const plan = createSessionBackupImportPlan(snapshot([
      session({
        id: "imported-session",
        officialSessionId: "official-1",
        updatedAt: 30,
        events: [userEvent("imported-event", 30, "另一台机器继续聊")],
      }),
    ]));

    expect(plan.stats.forkedSessions).toBe(1);
    expect(plan.sessions).toHaveLength(2);
    expect(plan.sessions.some((item) => item.id === "local-session")).toBe(true);
    expect(plan.sessions.some((item) => item.id.startsWith("kimix-import-") && item.title.endsWith("（导入副本）"))).toBe(true);
  });

  it("exports schema 2 with complete collaboration and scoped activity references", () => {
    const room = roomSession();
    const secondary = room.collaboration!.agents[1];
    useSessionStore.setState({ sessions: [room], pendingMessages: [], recentProjects: [] });
    useAppStore.setState({
      roomAgentActivities: {
        secondary: {
          roomId: room.id,
          roomAgentId: secondary.id,
          runtimeSessionId: secondary.runtimeSessionId,
          status: "running",
          roomMessageId: room.collaboration!.messages[0].id,
          activeTurnId: room.collaboration!.messages[0].deliveries[secondary.id].agentTurnId,
          updatedAt: 100,
        },
      },
    });

    const exported = buildSessionBackupSnapshot("2.15.21");

    expect(exported.schemaVersion).toBe(2);
    expect((exported.sessions[0] as Session).collaboration).toEqual(room.collaboration);
    expect(exported.roomAgentActivities).toEqual([expect.objectContaining({ roomAgentId: secondary.id })]);
  });

  it("imports schema 1 as a single Agent session even if it contains a collaboration-shaped field", () => {
    const room = roomSession();
    const plan = createSessionBackupImportPlan(snapshot([room], {
      schemaVersion: 1,
      roomAgentActivities: undefined,
    }));

    expect(plan.sessions).toHaveLength(1);
    expect(plan.sessions[0].collaboration).toBeUndefined();
    expect(plan.sessions[0].events.map((event) => event.id)).toEqual(["primary-user"]);
  });

  it("imports a valid schema 2 room without dropping secondary history", () => {
    const room = roomSession();
    const plan = createSessionBackupImportPlan(snapshot([room]));
    const imported = plan.sessions[0];

    expect(imported.collaboration?.agents.map((agent) => agent.id)).toEqual([
      room.collaboration!.primaryAgentId,
      "agent-secondary",
    ]);
    expect(imported.collaboration?.agentEvents["agent-secondary"].map((event) => event.id)).toEqual(["secondary-user"]);
    expect(imported.collaboration?.messages[0].recipientAgentIds).toEqual([
      room.collaboration!.primaryAgentId,
      "agent-secondary",
    ]);
  });

  it("rejects damaged collaboration references and unknown future backup schemas", () => {
    const room = roomSession();
    const damaged = structuredClone(room);
    damaged.collaboration!.agentEvents["agent-secondary"][0].roomMessageId = "missing-message";
    const misowned = structuredClone(room);
    misowned.collaboration!.agentEvents["agent-secondary"][0].roomAgentId = misowned.collaboration!.primaryAgentId;
    const malformedDelivery = structuredClone(room);
    (malformedDelivery.collaboration!.messages[0].deliveries["agent-secondary"] as unknown as Record<string, unknown>).officialPromptId = 42;

    expect(() => createSessionBackupImportPlan(snapshot([damaged])))
      .toThrow("协同房间备份损坏或引用关系无效");
    expect(() => createSessionBackupImportPlan(snapshot([misowned])))
      .toThrow("协同房间备份损坏或引用关系无效");
    expect(() => createSessionBackupImportPlan(snapshot([malformedDelivery])))
      .toThrow("协同房间备份损坏或引用关系无效");
    expect(() => createSessionBackupImportPlan(snapshot([], { schemaVersion: 3 })))
      .toThrow("不支持会话备份 schema 3");
  });

  it("remaps every room identity and detaches official bindings for a forked imported copy", () => {
    const room = roomSession();
    const primary = room.collaboration!.agents[0];
    const secondary = room.collaboration!.agents[1];
    useSessionStore.setState({
      sessions: [session({
        id: "local-session",
        runtimeSessionId: primary.runtimeSessionId,
        officialSessionId: primary.officialSessionId,
        updatedAt: 200,
        events: [userEvent("local-event", 200, "本机分支")],
      })],
      pendingMessages: [],
      recentProjects: [],
    });
    const sourceMessage = room.collaboration!.messages[0];
    const plan = createSessionBackupImportPlan(snapshot([room], {
      pendingMessages: [{
        id: "pending-source",
        sessionId: room.id,
        content: "继续审查",
        createdAt: 300,
        roomAgentId: secondary.id,
        roomMessageId: sourceMessage.id,
        agentTurnId: sourceMessage.deliveries[secondary.id].agentTurnId,
        recipientAgentIds: [secondary.id],
      }],
      roomAgentActivities: [{
        roomId: room.id,
        roomAgentId: secondary.id,
        runtimeSessionId: secondary.runtimeSessionId,
        status: "running",
        roomMessageId: sourceMessage.id,
        activeTurnId: sourceMessage.deliveries[secondary.id].agentTurnId,
        updatedAt: 300,
      }],
      hiddenHandoffSessionIds: [room.id],
      activeContext: { project: null, sessionId: room.id, updatedAt: 300 },
    }));
    const copy = plan.sessions.find((item) => item.id.startsWith("kimix-import-"))!;
    const copiedCollaboration = copy.collaboration!;
    const copiedSecondary = copiedCollaboration.agents.find((agent) => agent.id !== copiedCollaboration.primaryAgentId)!;
    const copiedMessage = copiedCollaboration.messages[0];
    const copiedDelivery = copiedMessage.deliveries[copiedSecondary.id];

    expect(copy.runtimeSessionId).toBeUndefined();
    expect(copy.officialSessionId).toBeUndefined();
    expect(copiedCollaboration.primaryAgentId).toBe(`room-agent:${copy.id}`);
    expect(copiedCollaboration.agents.every((agent) => (
      !agent.runtimeSessionId && !agent.officialSessionId && !agent.officialCatalogConfirmedAt && !agent.missingSince && !agent.recoveryIssue
    ))).toBe(true);
    expect(copiedSecondary.id).not.toBe(secondary.id);
    expect(copiedMessage.id).not.toBe(sourceMessage.id);
    expect(copiedMessage.recipientAgentIds).toEqual(Object.keys(copiedMessage.deliveries));
    expect(copiedDelivery.agentTurnId).not.toBe(sourceMessage.deliveries[secondary.id].agentTurnId);
    expect(copiedDelivery.dispatchAttemptId).not.toBe(sourceMessage.deliveries[secondary.id].dispatchAttemptId);
    expect(copiedDelivery.previousAttempts?.[0].agentTurnId).not.toBe("turn-secondary-old");
    expect(copiedCollaboration.agentEvents[copiedSecondary.id][0]).toMatchObject({
      roomAgentId: copiedSecondary.id,
      roomMessageId: copiedMessage.id,
      agentTurnId: copiedDelivery.agentTurnId,
      dispatchAttemptId: copiedDelivery.dispatchAttemptId,
    });
    expect(plan.pendingMessages[0]).toMatchObject({
      sessionId: copy.id,
      roomAgentId: copiedSecondary.id,
      roomMessageId: copiedMessage.id,
      agentTurnId: copiedDelivery.agentTurnId,
      recipientAgentIds: [copiedSecondary.id],
    });
    const copiedActivity = Object.values(plan.roomAgentActivities)[0];
    expect(copiedActivity).toMatchObject({
      roomId: copy.id,
      roomAgentId: copiedSecondary.id,
      status: "interrupted",
      roomMessageId: copiedMessage.id,
      activeTurnId: copiedDelivery.agentTurnId,
    });
    expect(copiedActivity.runtimeSessionId).toBeUndefined();
    expect(plan.hiddenHandoffSessionIds).toContain(copy.id);
    expect(plan.snapshot.activeContext).toMatchObject({ sessionId: copy.id });
  });

  it("upgrades a matching schema 1 mirror to schema 2 without creating a fork", () => {
    const room = roomSession();
    useSessionStore.setState({
      sessions: [session({
        id: "legacy-local",
        runtimeSessionId: room.runtimeSessionId,
        officialSessionId: room.officialSessionId,
        updatedAt: 90,
        events: room.events,
      })],
      pendingMessages: [],
      recentProjects: [],
    });

    const plan = createSessionBackupImportPlan(snapshot([room]));

    expect(plan.stats.forkedSessions).toBe(0);
    expect(plan.sessions).toHaveLength(1);
    expect(plan.sessions[0].id).toBe("legacy-local");
    expect(plan.sessions[0].collaboration?.agents).toHaveLength(2);
    expect(plan.sessions[0].collaboration?.agentEvents["agent-secondary"]).toHaveLength(1);
  });

  it("collects every room Agent runtime identity into archived tombstones", () => {
    const room = { ...roomSession(), archivedAt: 500 };
    useSessionStore.setState({ sessions: [room], pendingMessages: [], recentProjects: [] });

    const exported = buildSessionBackupSnapshot("2.15.21");
    const tombstone = (exported.archivedTombstones as Array<{ ids: string[] }>).find((item) => item.ids.includes(room.id));

    expect(tombstone?.ids).toEqual(expect.arrayContaining([
      "runtime-primary",
      "official-primary",
      "runtime-secondary",
      "official-secondary",
    ]));
  });

  it("does not fork or duplicate a room when the same schema 2 snapshot is imported twice", () => {
    const room = roomSession();
    const first = createSessionBackupImportPlan(snapshot([room]));
    useSessionStore.setState({ sessions: first.sessions, pendingMessages: first.pendingMessages, recentProjects: [] });

    const second = createSessionBackupImportPlan(snapshot([room]));

    expect(second.stats.forkedSessions).toBe(0);
    expect(second.stats.addedSessions).toBe(0);
    expect(second.sessions).toHaveLength(1);
    expect(second.sessions[0].collaboration?.agents).toHaveLength(2);
  });
});
