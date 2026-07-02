import { describe, expect, it } from "vitest";
import type { Session } from "@/types/ui";
import { lastSessionPrompt, searchSessions } from "../sessionSearch";

function session(overrides: Partial<Session>): Session {
  return {
    id: "session-1",
    title: "实现模型搜索",
    projectPath: "D:/work/kimix",
    createdAt: 1,
    updatedAt: 2,
    events: [],
    isLoading: false,
    ...overrides,
  };
}

describe("session search", () => {
  it("uses the latest user prompt and matches title, workspace, or prompt", () => {
    const item = session({ events: [
      { id: "u1", type: "user_message", content: "旧问题", timestamp: 1 },
      { id: "a1", type: "assistant_message", content: "回答", timestamp: 2 },
      { id: "u2", type: "steer_message", content: "  最近的   提示词  ", timestamp: 3 },
    ] });
    expect(lastSessionPrompt(item)).toBe("最近的 提示词");
    expect(searchSessions([item], "最近")).toHaveLength(1);
    expect(searchSessions([item], "KIMIX")).toHaveLength(1);
    expect(searchSessions([item], "模型搜索")).toHaveLength(1);
  });

  it("sorts recent sessions first and excludes archived sessions", () => {
    const recent = session({ id: "recent", updatedAt: 5 });
    const old = session({ id: "old", updatedAt: 3 });
    const archived = session({ id: "archived", updatedAt: 9, archivedAt: 10 });
    expect(searchSessions([old, archived, recent], "").map((entry) => entry.session.id)).toEqual(["recent", "old"]);
  });
});
