/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { PendingMessage } from "@/stores/sessionStore";
import type { Project, RoomAgent, Session, TimelineEvent, UserMessageImage } from "@/types/ui";
import { createCollaborationStateFromSession, roomAgentActivityKey } from "@/utils/collaborationRooms";
import { projectCollaborationTimeline } from "@/utils/collaborationTimeline";
import { LOCAL_SESSION_PREFIX, LOCAL_SESSIONS_KEY } from "@/utils/persistence";

// Helpers to find session data in commitState entries (supports both old
// single-key and new per-session key formats).
function firstSessionEntry(entries: Array<{ key: string; value: unknown }>): unknown {
  const sessionEntry = entries.find((entry) => entry.key.startsWith(LOCAL_SESSION_PREFIX));
  if (sessionEntry) return sessionEntry.value;
  const oldEntry = entries.find((entry) => entry.key === LOCAL_SESSIONS_KEY);
  return oldEntry ? (oldEntry.value as unknown[])[0] : undefined;
}

function sessionEntryById(entries: Array<{ key: string; value: unknown }>, id: string): unknown {
  const sessionEntry = entries.find((entry) => entry.key === `${LOCAL_SESSION_PREFIX}${id}`);
  if (sessionEntry) return sessionEntry.value;
  const oldEntry = entries.find((entry) => entry.key === LOCAL_SESSIONS_KEY);
  if (oldEntry) {
    const arr = oldEntry.value as unknown[];
    return arr.find((s: unknown) => (s as { id?: string }).id === id);
  }
  return undefined;
}

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
      const firstSession = firstSessionEntry(entries) as { title?: string } | undefined;
      const title = firstSession?.title;
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
    const second = persistLocalConversationState();

    releaseFirstWrite?.();
    expect((await first).success).toBe(false);
    expect((await second).success).toBe(false);

    useAppStore.setState({ currentSession: withTitle("C") });
    useSessionStore.setState({ sessions: [withTitle("C")] });
    expect((await persistLocalConversationState()).success).toBe(true);

    expect(persistedTitles).toEqual(["A", "C"]);
    expect(calls).toBe(2);
  });

  it("waits for a coalesced snapshot to become durable before resolving concurrent callers", async () => {
    let releaseFirstWrite: (() => void) | undefined;
    const firstWriteGate = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const persistedTitles: string[] = [];
    let calls = 0;
    commitStateMock.mockImplementation(async (entries: Array<{ key: string; value: unknown }>) => {
      calls += 1;
      const firstSession = firstSessionEntry(entries) as { title?: string } | undefined;
      const title = firstSession?.title;
      if (title) persistedTitles.push(title);
      if (calls === 1) await firstWriteGate;
    });

    const { persistLocalConversationState } = await import("@/utils/persistence");
    const withTitle = (title: string): Session => ({ ...session, title });

    useAppStore.setState({ currentProject: project, currentSession: withTitle("A") });
    useSessionStore.setState({ sessions: [withTitle("A")], pendingMessages: [] });
    const first = persistLocalConversationState();
    await vi.waitFor(() => expect(commitStateMock).toHaveBeenCalledTimes(1));

    useAppStore.setState({ currentSession: withTitle("B") });
    useSessionStore.setState({ sessions: [withTitle("B")] });
    let secondSettled = false;
    const second = persistLocalConversationState().then((result) => {
      secondSettled = true;
      return result;
    });
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    releaseFirstWrite?.();
    expect((await first).success).toBe(true);
    expect((await second).success).toBe(true);
    expect(persistedTitles).toEqual(["A", "B"]);
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
    const ordinaryStored = firstSessionEntry(ordinaryEntries) as Session;
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
    const storedRoom = firstSessionEntry(roomEntries) as Session;
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
    const storedRoom = firstSessionEntry(entries) as Session;
    const storedSessions = [storedRoom];
    const messageRef = (storedRoom.collaboration!.messages[0].images![0] as typeof image & { imageRef: string }).imageRef;
    const primaryRef = (storedRoom.collaboration!.agentEvents[primary.id][0] as Extract<TimelineEvent, { type: "user_message" }>).images![0] as typeof image & { imageRef: string };
    const secondaryRef = (storedRoom.collaboration!.agentEvents[secondary.id][0] as Extract<TimelineEvent, { type: "user_message" }>).images![0] as typeof image & { imageRef: string };
    expect(messageRef).toBeTruthy();
    expect(primaryRef.imageRef).toBeTruthy();
    expect(secondaryRef.imageRef).toBeTruthy();
    expect(storedImages.every((storedImage) => storedImage.dataUrl === dataUrl)).toBe(true);

    getStateItemMock.mockImplementation((key) => {
      if (key === 'kimix_local_sessions_index') return Promise.resolve(null);
      if (key === 'kimix_sessions') return Promise.resolve(storedSessions);
      return Promise.resolve(null);
    });
    loadImagesMock.mockImplementation(async (ids: string[]) => new Map(ids.map((id) => [id, dataUrl])));
    const loaded = (await loadLocalSessions())[0];
    expect(loaded.collaboration?.messages[0].images?.[0].dataUrl).toBe(dataUrl);
    expect((loaded.collaboration?.agentEvents[primary.id][0] as Extract<TimelineEvent, { type: "user_message" }>).images?.[0].dataUrl).toBe(dataUrl);
    expect((loaded.collaboration?.agentEvents[secondary.id][0] as Extract<TimelineEvent, { type: "user_message" }>).images?.[0].dataUrl).toBe(dataUrl);
    expect(loaded.events).toEqual(loaded.collaboration?.agentEvents[primary.id]);
  });

  it("persists video bytes and restores their playback metadata", async () => {
    const dataUrl = "data:video/mp4;base64,AAEC";
    const video = {
      name: "review.mp4",
      kind: "video" as const,
      dataUrl,
      fileId: "file-video",
      mediaType: "video/mp4",
    };
    const videoSession: Session = {
      ...session,
      events: [{
        id: "user-video",
        type: "user_message",
        timestamp: 100,
        content: "",
        images: [video],
      }],
    };
    useSessionStore.setState({ sessions: [videoSession], pendingMessages: [] });
    const { loadLocalSessions, persistLocalConversationState } = await import("@/utils/persistence");
    await persistLocalConversationState();

    const [entries, storedImages] = commitStateMock.mock.calls.at(-1) as [Array<{ key: string; value: unknown }>, Array<{ id: string; dataUrl: string; kind?: string; fileId?: string; mediaType?: string }>];
    const storedSession = firstSessionEntry(entries) as Session;
    expect(storedImages[0]).toMatchObject({ dataUrl, kind: "video", fileId: "file-video", mediaType: "video/mp4" });

    // For loadLocalSessions fallback path, mock returns an array for old key.
    getStateItemMock.mockImplementation((key) => {
      if (key === 'kimix_local_sessions_index') return Promise.resolve(null);
      if (key === 'kimix_sessions') return Promise.resolve([storedSession]);
      return Promise.resolve(null);
    });
    loadImagesMock.mockResolvedValue(new Map([[storedImages[0].id, dataUrl]]));
    const loadedVideo = (await loadLocalSessions())[0].events[0] as Extract<TimelineEvent, { type: "user_message" }>;
    expect(loadedVideo.images?.[0]).toMatchObject(video);
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
      status: "sent",
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
    getStateItemMock.mockImplementation((key) => {
      if (key === 'kimix_local_sessions_index') return Promise.resolve(null);
      if (key === 'kimix_sessions') return Promise.resolve([stored]);
      return Promise.resolve(null);
    });

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
      roomMessageId: "guard-message",
      agentTurnId: "guard-turn",
      dispatchAttemptId: "guard-attempt",
    };
    const guardedBase: Session = {
      ...session,
      id: "guard-room",
      events: [primaryEvent],
      updatedAt: 10,
    };
    const guardedCollaboration = createCollaborationStateFromSession(guardedBase);
    const guardedPrimaryId = guardedCollaboration.primaryAgentId;
    const damagedDelivery = { ...guardedCollaboration.messages[0].deliveries[guardedPrimaryId] };
    delete damagedDelivery.dispatchAttemptId;
    const guardedRoom: Session = {
      ...guardedBase,
      collaboration: {
        ...guardedCollaboration,
        messages: guardedCollaboration.messages.map((message) => ({
          ...message,
          deliveries: { ...message.deliveries, [guardedPrimaryId]: damagedDelivery },
        })),
      },
    };
    getStateItemMock.mockImplementation((key) => {
      if (key === 'kimix_local_sessions_index') return Promise.resolve(null);
      if (key === 'kimix_sessions') return Promise.resolve([guardedRoom]);
      return Promise.resolve(null);
    });
    const { loadLocalSessions, persistLocalConversationState } = await import("@/utils/persistence");
    const loaded = (await loadLocalSessions())[0];
    expect(loaded.collaboration?.messages[0].deliveries[guardedPrimaryId].dispatchAttemptId)
      .toBe("guard-attempt");
    expect(projectCollaborationTimeline(loaded)
      .filter((event) => event.type === "user_message")
      .map((event) => event.id))
      .toEqual(["guard-message"]);

    const newPrimaryEvent: TimelineEvent = {
      id: "guard-user-new",
      type: "user_message",
      timestamp: 20,
      content: "刷新后的主 Agent 消息",
      roomMessageId: "guard-message",
      agentTurnId: "guard-turn",
      dispatchAttemptId: "guard-attempt",
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
    const stored = sessionEntryById(entries, "guard-room") as Session;
    const primaryId = stored.collaboration?.primaryAgentId ?? "";
    expect(stored.collaboration?.agents).toHaveLength(1);
    expect(stored.collaboration?.agentEvents[primaryId]).toEqual([
      expect.objectContaining({ id: "guard-user-new", content: "刷新后的主 Agent 消息" }),
    ]);
    expect(stored.collaboration?.messages[0].deliveries[primaryId].dispatchAttemptId).toBe("guard-attempt");
    expect(projectCollaborationTimeline(stored)
      .filter((event) => event.type === "user_message")
      .map((event) => event.id))
      .toEqual(["guard-message"]);
    const current = useAppStore.getState().currentSession;
    expect(current?.collaboration?.messages[0].deliveries[primaryId].dispatchAttemptId).toBe("guard-attempt");
    expect(projectCollaborationTimeline(current!)
      .filter((event) => event.type === "user_message")
      .map((event) => event.id))
      .toEqual(["guard-message"]);
  });

  it("preserves an unknown future collaboration payload byte-for-byte on the next save", async () => {
    const futureRaw = { schemaVersion: 2, agents: [{ id: "future-agent" }], opaque: { keep: true } };
    getStateItemMock.mockImplementation((key) => {
      if (key === 'kimix_local_sessions_index') return Promise.resolve(null);
      if (key === 'kimix_sessions') return Promise.resolve([{ ...session, collaboration: futureRaw }]);
      return Promise.resolve(null);
    });
    const { loadLocalSessions, persistLocalConversationState } = await import("@/utils/persistence");
    const loaded = (await loadLocalSessions())[0];
    expect(loaded.collaboration).toBeUndefined();
    expect(loaded.unsupportedCollaboration?.raw).toEqual(futureRaw);

    useSessionStore.setState({ sessions: [loaded], pendingMessages: [] });
    // Force a real session change to trigger per-session write (incremental
    // persist skips unchanged sessions after hydration populates the cache).
    useSessionStore.setState((prev) => ({
      sessions: prev.sessions.map((s) => s.id === loaded.id ? { ...s, title: "持久化验证" } : s),
    }));
    await persistLocalConversationState();
    const entries = commitStateMock.mock.calls.at(-1)?.[0] as Array<{ key: string; value: unknown }>;
    const stored = sessionEntryById(entries, loaded.id) as Record<string, unknown>;
    expect(stored.collaboration).toEqual(futureRaw);
    expect(stored.unsupportedCollaboration).toBeUndefined();
  });
});

describe("persistLocalConversationState reference guard", () => {
  // Use a dedicated session id so the module-level remembered-collaboration
  // map populated by earlier tests never rewrites these arrays mid-test.
  const guardSession: Session = { ...session, id: "ref-guard-session" };

  beforeEach(() => {
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

  it("skips the write when the marked references are still current", async () => {
    const { markConversationStatePersisted, persistLocalConversationState } = await import("@/utils/persistence");
    const sessions = [{ ...guardSession }];
    const pendingMessages: PendingMessage[] = [];
    useSessionStore.setState({ sessions, pendingMessages });
    markConversationStatePersisted(sessions, pendingMessages);

    const result = await persistLocalConversationState();
    expect(result.success).toBe(true);
    expect(commitStateMock).not.toHaveBeenCalled();
  });

  it("skips an unchanged persist after a successful save", async () => {
    const { persistLocalConversationState } = await import("@/utils/persistence");
    useSessionStore.setState({ sessions: [{ ...guardSession }], pendingMessages: [] });

    expect((await persistLocalConversationState()).success).toBe(true);
    expect(commitStateMock).toHaveBeenCalledTimes(1);

    expect((await persistLocalConversationState()).success).toBe(true);
    expect(commitStateMock).toHaveBeenCalledTimes(1);
  });

  it("persists normally once the store references change", async () => {
    const { persistLocalConversationState } = await import("@/utils/persistence");
    useSessionStore.setState({ sessions: [{ ...guardSession }], pendingMessages: [] });
    expect((await persistLocalConversationState()).success).toBe(true);
    expect(commitStateMock).toHaveBeenCalledTimes(1);

    useSessionStore.setState({ sessions: [{ ...guardSession, title: "更新后的标题" }] });
    expect((await persistLocalConversationState()).success).toBe(true);
    expect(commitStateMock).toHaveBeenCalledTimes(2);
    const entries = commitStateMock.mock.calls.at(-1)?.[0] as Array<{ key: string; value: unknown }>;
    const stored = sessionEntryById(entries, guardSession.id) as Session;
    expect(stored.title).toBe("更新后的标题");
  });

  it("still persists archive and deletion changes after a successful save", async () => {
    const { persistLocalConversationState } = await import("@/utils/persistence");
    useSessionStore.setState({ sessions: [{ ...guardSession }], pendingMessages: [] });
    expect((await persistLocalConversationState()).success).toBe(true);
    expect(commitStateMock).toHaveBeenCalledTimes(1);

    const archived: Session = { ...guardSession, archivedAt: 123456 };
    useSessionStore.setState({ sessions: [archived] });
    expect((await persistLocalConversationState()).success).toBe(true);
    expect(commitStateMock).toHaveBeenCalledTimes(2);
    let entries = commitStateMock.mock.calls.at(-1)?.[0] as Array<{ key: string; value: unknown }>;
    expect((sessionEntryById(entries, guardSession.id) as Session).archivedAt).toBe(123456);

    useSessionStore.setState({ sessions: [] });
    expect((await persistLocalConversationState()).success).toBe(true);
    expect(commitStateMock).toHaveBeenCalledTimes(3);
    entries = commitStateMock.mock.calls.at(-1)?.[0] as Array<{ key: string; value: unknown }>;
    // Deleted sessions produce a removeStateItem call; the index entry also changes.
    // The per-session key should have been removed; verify by checking index presence.
    const lastSessionKeys = entries.filter((entry) => entry.key.startsWith(LOCAL_SESSION_PREFIX));
    expect(lastSessionKeys.length).toBe(0);
  });

  it("skips the startup hydration flush when the pre-load pending reference is marked too", async () => {
    const { markConversationStatePersisted, persistLocalConversationState } = await import("@/utils/persistence");
    // Mirror the App.tsx hydration order: mark the restored sessions together
    // with the store's current (still pre-load) pendingMessages reference,
    // then apply the 0→N sessions setState that triggers the immediate flush.
    const sessions = [{ ...guardSession }];
    markConversationStatePersisted(sessions, useSessionStore.getState().pendingMessages);
    useSessionStore.setState({ sessions });

    expect((await persistLocalConversationState()).success).toBe(true);
    expect(commitStateMock).not.toHaveBeenCalled();

    // The pending load completes afterwards: mark the loaded array, setState,
    // and the debounced persist is skipped as well.
    const loadedPending: PendingMessage[] = [{
      id: "pending-1",
      sessionId: guardSession.id,
      content: "未发送草稿",
      createdAt: 100,
    }];
    markConversationStatePersisted(undefined, loadedPending);
    useSessionStore.setState({ pendingMessages: loadedPending });
    expect((await persistLocalConversationState()).success).toBe(true);
    expect(commitStateMock).not.toHaveBeenCalled();

    // Any real change (new sessions reference) still persists normally.
    useSessionStore.setState({ sessions: [{ ...guardSession, title: "真实变更" }] });
    expect((await persistLocalConversationState()).success).toBe(true);
    expect(commitStateMock).toHaveBeenCalledTimes(1);
    const entries = commitStateMock.mock.calls.at(-1)?.[0] as Array<{ key: string; value: unknown }>;
    const stored = sessionEntryById(entries, guardSession.id) as Session;
    expect(stored.title).toBe("真实变更");
  });

  it("marks hydrated sessions in per-session cache so the first real change skips unchanged sessions", async () => {
    // Simulate App.tsx hydration flow: loadLocalSessions produces session
    // references; App.tsx maps them through visibility filtering (new array,
    // same elements), then calls markConversationStatePersisted with the
    // final store references before setState.
    const { markConversationStatePersisted, persistLocalConversationState } = await import("@/utils/persistence");
    const loaded = { ...guardSession };
    const restoredSessions = [loaded]; // App.tsx visibleSessions.map(...)
    markConversationStatePersisted(restoredSessions, useSessionStore.getState().pendingMessages);
    useSessionStore.setState({ sessions: restoredSessions });

    // First persist should skip: all store references match the cache.
    expect((await persistLocalConversationState()).success).toBe(true);
    expect(commitStateMock).not.toHaveBeenCalled();

    // A real change (new title) still persists normally and writes only the
    // changed session, not the full array.
    useSessionStore.setState({ sessions: [{ ...loaded, title: "真实变更" }] });
    expect((await persistLocalConversationState()).success).toBe(true);
    expect(commitStateMock).toHaveBeenCalledTimes(1);
    const entries = commitStateMock.mock.calls.at(-1)?.[0] as Array<{ key: string; value: unknown }>;
    const sessionKeys = entries.filter((e) => e.key.startsWith("kimix_local_session_"));
    expect(sessionKeys).toHaveLength(1);
    const stored = sessionEntryById(entries, loaded.id) as Session;
    expect(stored.title).toBe("真实变更");
  });

  it("repairs stable assistant order on hydration even when event count is unchanged", async () => {
    // Regression: the hydration `changed` check used to compare lengths, but
    // repairStableAssistantOrder swaps events in place (same length), so the
    // repair was silently dropped. Now reference-compared.
    const { loadLocalSessions } = await import("@/utils/persistence");
    const user = { id: "u-1", type: "user_message" as const, timestamp: 1000, content: "问", images: [] };
    const preview = { id: "a-8", type: "assistant_message" as const, timestamp: 1010, content: "预告", isComplete: true, snapshotMessageId: "snap_000008", snapshotMessageIdStable: true };
    const summary = { id: "a-10", type: "assistant_message" as const, timestamp: 1020, content: "汇总", isComplete: true, snapshotMessageId: "snap_000010", snapshotMessageIdStable: true };
    // Persisted in the broken order: summary (seq 10) before preview (seq 8),
    // same length after repair — the old length check would have discarded it.
    const disordered = { ...guardSession, id: "order-session", events: [user, summary, preview] as Session["events"] };
    getStateItemMock.mockImplementation((key: string) => {
      if (key === "kimix_local_sessions_index") return Promise.resolve(null);
      if (key === "kimix_sessions") return Promise.resolve([disordered]);
      return Promise.resolve(null);
    });

    const loaded = await loadLocalSessions();
    const bodies = loaded[0].events.map((e) => (e.type === "assistant_message" || e.type === "user_message" ? e.content : e.type));
    expect(bodies).toEqual(["问", "预告", "汇总"]);
  });

  it("does not delete images referenced by unchanged sessions (P1-c GC regression)", async () => {
    const { markConversationStatePersisted, persistLocalConversationState } = await import("@/utils/persistence");

    // Session A: unchanged, has an image with imageRef.
    const imageRef = "img-in-use";
    const sessionA: Session = {
      ...guardSession, id: "session-a",
      events: [{
        id: "user-a", type: "user_message" as const, timestamp: 1, content: "A",
        images: [{ name: "a.png", kind: "image" as const, imageRef }] as unknown as UserMessageImage[],
      }],
    };
    // Session B: will change, has no image.
    const sessionB: Session = { ...guardSession, id: "session-b", events: [] };

    // Simulate hydration: mark with final store references.
    markConversationStatePersisted([sessionA, sessionB], []);
    useSessionStore.setState({ sessions: [sessionA, sessionB] });

    // Mock IDB to report the in-use image id.
    getAllImageIdsMock.mockResolvedValue([imageRef]);
    deleteImagesMock.mockReset();

    // Change sessionB only (new title → new store reference). SessionA unchanged.
    useSessionStore.setState((prev) => ({
      sessions: prev.sessions.map((s) => s.id === "session-b" ? { ...s, title: "B 更新" } : s),
    }));

    expect((await persistLocalConversationState()).success).toBe(true);

    // The unchanged session A's image ref must still be in referencedRefs,
    // so deleteImages should NOT receive "img-in-use".
    const deleteArgs = deleteImagesMock.mock.calls.flatMap((call) => call[0] as string[]);
    expect(deleteArgs).not.toContain(imageRef);

    // Second persist: sessionA still unchanged, verify cache persists.
    deleteImagesMock.mockReset();
    useSessionStore.setState((prev) => ({
      sessions: prev.sessions.map((s) => s.id === "session-b" ? { ...s, title: "B 再更新" } : s),
    }));
    expect((await persistLocalConversationState()).success).toBe(true);
    const deleteArgs2 = deleteImagesMock.mock.calls.flatMap((call) => call[0] as string[]);
    expect(deleteArgs2).not.toContain(imageRef);
  });
});
