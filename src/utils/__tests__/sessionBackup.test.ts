import { beforeEach, describe, expect, it } from "vitest";
import { useSessionStore } from "../../stores/sessionStore";
import type { Session, TimelineEvent } from "../../types/ui";
import type { SessionBackupSnapshot } from "@electron/types/ipc";
import { createSessionBackupImportPlan } from "../sessionBackup";

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

function snapshot(sessions: Session[]): SessionBackupSnapshot {
  return {
    schemaVersion: 1,
    source: "Kimix",
    exportedAt: "2026-06-15T00:00:00.000Z",
    sessions,
    pendingMessages: [],
    projects: [],
    archivedTombstones: [],
    hiddenHandoffSessionIds: [],
    activeContext: null,
  };
}

describe("createSessionBackupImportPlan", () => {
  beforeEach(() => {
    localStorage.clear();
    useSessionStore.setState({
      sessions: [],
      pendingMessages: [],
      recentProjects: [],
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
});
