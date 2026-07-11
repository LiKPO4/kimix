/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Project, Session } from "@/types/ui";

const commitStateMock = vi.fn();
const getAllImageIdsMock = vi.fn().mockResolvedValue([]);
const deleteImagesMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/utils/stateStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/stateStorage")>();
  return {
    ...actual,
    commitState: (...args: Parameters<typeof actual.commitState>) => commitStateMock(...args),
    getAllImageIds: () => getAllImageIdsMock(),
    deleteImages: (...args: Parameters<typeof actual.deleteImages>) => deleteImagesMock(...args),
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
    useAppStore.setState({ currentProject: null, currentSession: null, runningSessionId: null });
    useSessionStore.setState({ sessions: [], recentProjects: [], pendingMessages: [] });
    commitStateMock.mockReset();
    getAllImageIdsMock.mockReset().mockResolvedValue([]);
    deleteImagesMock.mockReset().mockResolvedValue(undefined);
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
});
