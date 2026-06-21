import { describe, expect, it } from "vitest";
import type { Session } from "@/types/ui";
import { reconcileOfficialSessionCatalog } from "../sessionCatalog";

function localSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "local-1",
    engine: "kimi-code",
    title: "本地标题",
    projectPath: "D:\\work\\demo",
    createdAt: 10,
    updatedAt: 20,
    events: [],
    isLoading: false,
    ...overrides,
  };
}

describe("reconcileOfficialSessionCatalog", () => {
  it("把全部官方非归档目录项补成本地轻量会话", () => {
    const result = reconcileOfficialSessionCatalog([], [
      { id: "official-1", workDir: "D:\\work\\demo", updatedAt: 200, brief: "第一条" },
      { id: "official-2", workDir: "D:\\work\\demo", updatedAt: 100, brief: "第二条" },
    ], "D:\\work\\demo");

    expect(result.map((session) => session.id)).toEqual(["official-1", "official-2"]);
    expect(result[0]).toMatchObject({ officialSessionId: "official-1", title: "第一条", events: [] });
  });

  it("按官方 id 对账且保留本地正文和标题", () => {
    const existing = localSession({
      officialSessionId: "official-1",
      events: [{ id: "user-1", type: "user_message", timestamp: 10, content: "正文" }],
    });
    const result = reconcileOfficialSessionCatalog([existing], [
      { id: "official-1", workDir: "d:/work/demo/", updatedAt: 200, brief: "官方标题" },
    ], "D:\\work\\demo");

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("本地标题");
    expect(result[0].events).toEqual(existing.events);
    expect(result[0].updatedAt).toBe(200);
  });

  it("不复活已归档的本地会话", () => {
    const archived = localSession({ id: "official-1", archivedAt: 30 });
    const result = reconcileOfficialSessionCatalog([archived], [
      { id: "official-1", workDir: "D:\\work\\demo", updatedAt: 200, brief: "不应恢复" },
    ], "D:\\work\\demo");

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(archived);
    expect(result[0].archivedAt).toBe(30);
  });

  it("忽略其他项目的目录项", () => {
    const result = reconcileOfficialSessionCatalog([], [
      { id: "other", workDir: "D:\\work\\other", updatedAt: 200, brief: "其他项目" },
    ], "D:\\work\\demo");

    expect(result).toEqual([]);
  });
});
