/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Project, RoomAgent, Session, TimelineEvent } from "@/types/ui";
import { createCollaborationStateFromSession, roomAgentActivityKey } from "@/utils/collaborationRooms";

const commitStateMock = vi.fn();
const getAllImageIdsMock = vi.fn().mockResolvedValue([]);
const deleteImagesMock = vi.fn().mockResolvedValue(undefined);
const getStateItemMock = vi.fn().mockResolvedValue(null);
const loadImagesMock = vi.fn().mockResolvedValue(new Map());

vi.mock("@/utils/stateStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/stateStorage")>();
  return {
    ...actual,
    commitState: (...args: Parameters<typeof actual.commitState>) => commitStateMock(...args),
    getAllImageIds: () => getAllImageIdsMock(),
    deleteImages: (...args: Parameters<typeof actual.deleteImages>) => deleteImagesMock(...args),
    getStateItem: (key: string) => getStateItemMock(key),
    loadImages: (ids: string[]) => loadImagesMock(ids),
  };
});

const project: Project = {
  id: "project-1",
  name: "Project",
  path: "D:/WORKS/project",
  lastOpenedAt: 100,
};

const session: Session = {
  id: "session-1",
  engine: "kimi-code",
  title: "Session",
  projectPath: project.path,
  createdAt: 100,
  updatedAt: 200,
  events: [],
  isLoading: false,
};

describe("persistLocalConversationState", () => {
  beforeEach(async () => {
    localStorage.clear();
    useAppStore.setState({ currentProject: null, currentSession: null, runningSessionId: null, roomAgentActivities: {} });
    useSessionStore.setState({ sessions: [], recentProjects: [], pendingMessages: [] });
    commitStateMock.mockReset();
    getAllImageIdsMock.mockReset().mockResolvedValue([]);
    deleteImagesMock.mockReset().mockResolvedValue(undefined);
    getStateItemMock.mockReset().mockResolvedValue(null);
    loadImagesMock.mockReset().mockResolvedValue(new Map());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("retries the latest snapshot after a commit failure instead of dropping it", async () => {
    let calls = 0;
    commitStateMock.mockImplementation(async () => {
      calls++;
      if (calls === 1) {
        throw new Error("IndexedDB simulated failure");
      }
    });

    const { persistLocalConversationState } = await import("@/utils/persistence");

    useAppStore.setState({ currentProject: project, currentSession: session });
    useSessionStore.setState({ sessions: [session], pendingMessages: [] });

    const first = await persistLocalConversationState();
    expect(first.success).toBe(false);

    const second = await persistLocalConversationState();
    expect(second.success).toBe(true);
    expect(calls).toBe(2);
  });

  it("never writes an older queued snapshot after a failed save and newer retry", async () => {
    let releaseFirstWrite: (() => void) | undefined;
    const firstWriteStarted = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const persistedTitles: string[] = [];
    let calls = 0;
    commitStateMock.mockImplementation(async (entries: Array<{ key: string; value: unknown }>) => {
      calls++;
      const sessionsEntry = entries.find((entry) => entry.key === "kimix_sessions");
      const title = Array.isArray(sessionsEntry?.value)
        ? (sessionsEntry.value[0] as { title?: string } | undefined)?.title
        : undefined;
      if (title) persistedTitles.push(title);
      if (calls === 1) {
        await firstWriteStarted;
        throw new Error("IndexedDB simulated failure");
      }
    });

    const { persistLocalConversationState } = await import("@/utils/persistence");
    const withTitle = (title: string): Session => ({ ...session, title });

    useAppStore.setState({ currentProject: project, currentSession: withTitle("A") });
    useSessionStore.setState({ sessions: [withTitle("A")], pendingMessages: [] });
    const first = persistLocalConversationState();
    await vi.waitFor(() => expect(commitStateMock).toHaveBeenCalledTimes(1));

    useAppStore.setState({ currentSession: withTitle("B") });
    useSessionStore.setState({ sessions: [withTitle("B")] });
    await persistLocalConversationState();

    releaseFirstWrite?.();
    expect((await first).success).toBe(false);

    useAppStore.setState({ currentSession: withTitle("C") });
    useSessionStore.setState({ sessions: [withTitle("C")] });
    expect((await persistLocalConversationState()).success).toBe(true);

    expect(persistedTitles).toEqual(["A", "C"]);
    expect(calls).toBe(2);
  });

  it("keeps ordinary sessions lazy and settles collaboration partitions per Agent activity", async () => {
    const { persistLocalConversationState } = await import("@/utils/persistence");
    const primaryAssistant: TimelineEvent = {
      id: "assistant-primary",
      type: "assistant_message",
      timestamp: 1,
      content: "Primary partial",
      isThinking: false,
      isComplete: false,
    };
    useSessionStore.setState({ sessions: [{ ...session, events: [primaryAssistant] }], pendingMessages: [] });
    useAppStore.setState({ runningSessionId: session.id });
    await persistLocalConversationState();
    const ordinaryEntries = commitStateMock.mock.calls.at(-1)?.[0] as Array<{ key: string; value: unknown }>;
    const ordinaryStored = (ordinaryEntries.find((entry) => entry.key === "kimix_sessions")?.value as Session[])[0];
    expect(ordinaryStored.collaboration).toBeUndefined();
    expect((ordinaryStored.events[0] as Extract<TimelineEvent, { type: "assistant_message" }>).isComplete).toBe(false);

    const secondaryAssistant: TimelineEvent = {
      ...primaryAssistant,
      id: "assistant-secondary",
      content: "Secondary partial",
    };
    const collaboration = createCollaborationStateFromSession({ ...session, events: [primaryAssistant] });
    const primary = collaboration.agents[0];
    const secondary: RoomAgent = {
      id: "agent-secondary",
      displayName: "Reviewer",
      mentionName: "reviewer",
      modelAlias: "openai/gpt-5",
      permissionMode: "manual",
      runtimeSessionId: "runtime-secondary",
      createdAt: 300,
    };
    const room: Session = {
      ...session,
      events: [primaryAssistant],
      collaboration: {
        ...collaboration,
        agents: [primary, secondary],
        agentEvents: {
          [primary.id]: [primaryAssistant],
          [secondary.id]: [secondaryAssistant],
        },
      },
    };
    useSessionStore.setState({ sessions: [room] });
    useAppStore.setState({
      runningSessionId: null,
      roomAgentActivities: {
        [roomAgentActivityKey(room.id, secondary.id)]: {
          roomId: room.id,
          roomAgentId: secondary.id,
          runtimeSessionId: secondary.runtimeSessionId,
          status: "running",
          updatedAt: 400,
        },
      },
    });
    await persistLocalConversationState();

    const roomEntries = commitStateMock.mock.calls.at(-1)?.[0] as Array<{ key: string; value: unknown }>;
    const storedRoom = (roomEntries.find((entry) => entry.key === "kimix_sessions")?.value as Session[])[0];
    const storedPrimary = storedRoom.collaboration!.agentEvents[primary.id][0] as Extract<TimelineEvent, { type: "assistant_message" }>;
    const storedSecondary = storedRoom.collaboration!.agentEvents[secondary.id][0] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(storedPrimary.isComplete).toBe(true);
    expect(storedSecondary.isComplete).toBe(false);
    expect(storedRoom.events).toEqual(storedRoom.collaboration!.agentEvents[primary.id]);
    expect(storedRoom.collaboration?.primaryMirrorUpdatedAt).toBe(room.updatedAt);
    expect(storedPrimary.roomAgentId).toBe(primary.id);
    expect(storedSecondary.roomAgentId).toBe(secondary.id);
  });

  it("extracts and restores images in room messages and every Agent partition", async () => {
    const dataUrl = "data:image/png;base64,QUJDRA==";
    const image = { name: "review.png", kind: "image" as const, dataUrl };
    const userEvent: TimelineEvent = {
      id: "user-image",
      type: "user_message",
      timestamp: 100,
      content: "Check",
      images: [image],
    };
    const collaboration = createCollaborationStateFromSession({ ...session, events: [userEvent] });
    const primary = collaboration.agents[0];
    const secondary: RoomAgent = {
      id: "agent-secondary",
      displayName: "Reviewer",
      mentionName: "reviewer",
      modelAlias: "openai/gpt-5",
      permissionMode: "manual",
      createdAt: 300,
    };
    const room: Session = {
      ...session,
      events: [userEvent],
      collaboration: {
        ...collaboration,
        agents: [primary, secondary],
        messages: collaboration.messages.map((message) => ({
          ...message,
          recipientAgentIds: [primary.id, secondary.id],
          deliveries: {
            ...message.deliveries,
            [secondary.id]: { status: "accepted", agentTurnId: "turn-secondary" },
          },
        })),
        agentEvents: {
          [primary.id]: [userEvent],
          [secondary.id]: [{ ...userEvent, id: "user-image-secondary", roomAgentId: secondary.id }],
        },
      },
    };
    useSessionStore.setState({ sessions: [room], pendingMessages: [] });
    const { loadLocalSessions, persistLocalConversationState } = await import("@/utils/persistence");
    await persistLocalConversationState();

    const [entries, storedImages] = commitStateMock.mock.calls.at(-1) as [Array<{ key: string; value: unknown }>, Array<{ id: string; dataUrl: string }>];
    const storedSessions = entries.find((entry) => entry.key === "kimix_sessions")?.value as Session[];
    const storedRoom = storedSessions[0];
    const messageRef = (storedRoom.collaboration!.messages[0].images![0] as typeof image & { imageRef: string }).imageRef;
    const primaryRef = (storedRoom.collaboration!.agentEvents[primary.id][0] as Extract<TimelineEvent, { type: "user_message" }>).images![0] as typeof image & { imageRef: string };
    const secondaryRef = (storedRoom.collaboration!.agentEvents[secondary.id][0] as Extract<TimelineEvent, { type: "user_message" }>).images![0] as typeof image & { imageRef: string };
    expect(messageRef).toBeTruthy();
    expect(primaryRef.imageRef).toBeTruthy();
    expect(secondaryRef.imageRef).toBeTruthy();
    expect(storedImages.every((storedImage) => storedImage.dataUrl === dataUrl)).toBe(true);

    getStateItemMock.mockResolvedValue(storedSessions);
    loadImagesMock.mockImplementation(async (ids: string[]) => new Map(ids.map((id) => [id, dataUrl])));
    const loaded = (await loadLocalSessions())[0];
    expect(loaded.collaboration?.messages[0].images?.[0].dataUrl).toBe(dataUrl);
    expect((loaded.collaboration?.agentEvents[primary.id][0] as Extract<TimelineEvent, { type: "user_message" }>).images?.[0].dataUrl).toBe(dataUrl);
    expect((loaded.collaboration?.agentEvents[secondary.id][0] as Extract<TimelineEvent, { type: "user_message" }>).images?.[0].dataUrl).toBe(dataUrl);
    expect(loaded.events).toEqual(loaded.collaboration?.agentEvents[primary.id]);
  });

  it("restores user text from the retired clarification wrapper while hydrating local sessions", async () => {
    const wrapped = [
      "【Kimix 需求澄清：自动判断】",
      "这段旧指令不应再显示。",
      "",
      "用户原始需求：",
      "他说的你看懂了吗",
    ].join("\n");
    const wrappedEvent: TimelineEvent = {
      id: "wrapped-user",
      type: "user_message",
      timestamp: 100,
      content: wrapped,
    };
    const steerEvent: TimelineEvent = {
      id: "wrapped-steer",
      type: "steer_message",
      timestamp: 101,
      content: wrapped,
    };
    const collaboration = createCollaborationStateFromSession({
      ...session,
      events: [wrappedEvent, steerEvent],
    });
    const primary = collaboration.agents[0];
    const stored: Session = {
      ...session,
      events: [wrappedEvent, steerEvent],
      collaboration: {
        ...collaboration,
        messages: collaboration.messages.map((message) => ({
          ...message,
          content: wrapped,
          outboundContent: wrapped,
        })),
        agentEvents: {
          [primary.id]: [wrappedEvent, steerEvent],
        },
      },
    };
    getStateItemMock.mockResolvedValue([stored]);

    const { loadLocalSessions } = await import("@/utils/persistence");
    const loaded = (await loadLocalSessions())[0];

    expect((loaded.events[0] as Extract<TimelineEvent, { type: "user_message" }>).content).toBe("他说的你看懂了吗");
    expect((loaded.events[1] as Extract<TimelineEvent, { type: "steer_message" }>).content).toBe(wrapped);
    expect(loaded.collaboration?.messages[0].content).toBe("他说的你看懂了吗");
    expect(loaded.collaboration?.messages[0].outboundContent).toBe("他说的你看懂了吗");
    expect((loaded.collaboration?.agentEvents[primary.id][0] as Extract<TimelineEvent, { type: "user_message" }>).content)
      .toBe("他说的你看懂了吗");
  });

  it("prevents a known collaboration room from being persisted as an ordinary session", async () => {
    const primaryEvent: TimelineEvent = {
      id: "guard-user-old",
      type: "user_message",
      timestamp: 1,
      content: "旧房间消息",
    };
    const guardedBase: Session = {
      ...session,
      id: "guard-room",
      events: [primaryEvent],
      updatedAt: 10,
    };
    const guardedRoom: Session = {
      ...guardedBase,
      collaboration: createCollaborationStateFromSession(guardedBase),
    };
    getStateItemMock.mockResolvedValue([guardedRoom]);
    const { loadLocalSessions, persistLocalConversationState } = await import("@/utils/persistence");
    await loadLocalSessions();

    const newPrimaryEvent: TimelineEvent = {
      id: "guard-user-new",
      type: "user_message",
      timestamp: 20,
      content: "刷新后的主 Agent 消息",
    };
    const downgraded: Session = {
      ...guardedBase,
      events: [newPrimaryEvent],
      updatedAt: 20,
      collaboration: undefined,
    };
    useSessionStore.setState({ sessions: [downgraded] });
    useAppStore.setState({ currentSession: downgraded });

    expect((await persistLocalConversationState()).success).toBe(true);
    const entries = commitStateMock.mock.calls.at(-1)?.[0] as Array<{ key: string; value: unknown }>;
    const stored = (entries.find((entry) => entry.key === "kimix_sessions")?.value as Session[])[0];
    const primaryId = stored.collaboration?.primaryAgentId ?? "";
    expect(stored.collaboration?.agents).toHaveLength(1);
    expect(stored.collaboration?.agentEvents[primaryId]).toEqual([
      expect.objectContaining({ id: "guard-user-new", content: "刷新后的主 Agent 消息" }),
    ]);
    expect(useAppStore.getState().currentSession?.collaboration).toBeTruthy();
  });

  it("preserves an unknown future collaboration payload byte-for-byte on the next save", async () => {
    const futureRaw = { schemaVersion: 2, agents: [{ id: "future-agent" }], opaque: { keep: true } };
    getStateItemMock.mockResolvedValue([{ ...session, collaboration: futureRaw }]);
    const { loadLocalSessions, persistLocalConversationState } = await import("@/utils/persistence");
    const loaded = (await loadLocalSessions())[0];
    expect(loaded.collaboration).toBeUndefined();
    expect(loaded.unsupportedCollaboration?.raw).toEqual(futureRaw);

    useSessionStore.setState({ sessions: [loaded], pendingMessages: [] });
    await persistLocalConversationState();
    const entries = commitStateMock.mock.calls.at(-1)?.[0] as Array<{ key: string; value: unknown }>;
    const stored = (entries.find((entry) => entry.key === "kimix_sessions")?.value as Array<Record<string, unknown>>)[0];
    expect(stored.collaboration).toEqual(futureRaw);
    expect(stored.unsupportedCollaboration).toBeUndefined();
  });
});
