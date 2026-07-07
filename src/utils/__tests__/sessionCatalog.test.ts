import { describe, expect, it } from "vitest";
import type { Session } from "@/types/ui";
import { isUnconfirmedOfficialSessionPlaceholder, reconcileOfficialSessionCatalog, shouldHideOfficialSessionPlaceholder } from "../sessionCatalog";

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
    expect(result[0].officialCatalogConfirmedAt).toBeTypeOf("number");
  });

  it("首屏隐藏尚未被官方目录确认的旧空占位", () => {
    const stale = localSession({
      id: "official-stale",
      officialSessionId: "official-stale",
      title: "New Session",
      createdAt: Date.now() - 10 * 60 * 1000,
      events: [],
    });
    const confirmed = { ...stale, officialCatalogConfirmedAt: Date.now() };

    expect(isUnconfirmedOfficialSessionPlaceholder(stale)).toBe(true);
    expect(isUnconfirmedOfficialSessionPlaceholder(confirmed)).toBe(false);
  });

  it("首屏不隐藏有正文或刚创建的会话", () => {
    const withContent = localSession({
      id: "official-content",
      officialSessionId: "official-content",
      createdAt: Date.now() - 10 * 60 * 1000,
      events: [{ id: "user-1", type: "user_message", timestamp: 1, content: "正文" }],
    });
    const recent = localSession({
      id: "official-recent",
      officialSessionId: "official-recent",
      createdAt: Date.now(),
      events: [],
    });

    expect(isUnconfirmedOfficialSessionPlaceholder(withContent)).toBe(false);
    expect(isUnconfirmedOfficialSessionPlaceholder(recent)).toBe(false);
  });

  it("首屏隐藏曾确认但已经过期的默认标题空占位", () => {
    const staleConfirmed = localSession({
      id: "official-stale-confirmed",
      officialSessionId: "official-stale-confirmed",
      officialCatalogConfirmedAt: Date.now() - 60_000,
      title: "New Session",
      createdAt: Date.now() - 10 * 60 * 1000,
      events: [],
    });
    const realConversation = {
      ...staleConfirmed,
      events: [{ id: "user-1", type: "user_message", timestamp: 1, content: "正文" }],
    } satisfies Session;

    expect(isUnconfirmedOfficialSessionPlaceholder(staleConfirmed)).toBe(false);
    expect(shouldHideOfficialSessionPlaceholder(staleConfirmed)).toBe(true);
    expect(shouldHideOfficialSessionPlaceholder(realConversation)).toBe(false);
  });

  it("官方 Server 目录项使用 title 或 lastPrompt 生成占位标题", () => {
    const result = reconcileOfficialSessionCatalog([], [
      { id: "official-title", workDir: "D:\\work\\demo", updatedAt: 200, title: "官方标题", source: "server" },
      { id: "official-prompt", workDir: "D:\\work\\demo", updatedAt: 100, lastPrompt: "上一条用户消息", source: "server" },
    ], "D:\\work\\demo", { source: "server" });

    expect(result.map((session) => session.title)).toEqual(["官方标题", "上一条用户消息"]);
  });

  it("目录确认时优先使用官方生成标题", () => {
    const existing = localSession({
      id: "official-brief",
      officialSessionId: "official-brief",
      title: "New Session",
    });
    const result = reconcileOfficialSessionCatalog([existing], [{
      id: "official-brief",
      workDir: "D:\\work\\demo",
      updatedAt: 200,
      title: "你好呀",
      lastPrompt: "最后一条消息",
      brief: "暂时没有，你感觉怎么样",
      source: "sdk",
    }], "D:\\work\\demo", { source: "sdk" });

    expect(result[0].title).toBe("你好呀");
  });

  it("官方标题仍为默认值时回退到第一条有效提示", () => {
    const result = reconcileOfficialSessionCatalog([], [
      {
        id: "official-default-title",
        workDir: "D:\\work\\demo",
        updatedAt: 200,
        title: "New Session",
        lastPrompt: "最后一条消息",
        brief: "第一条有效提示",
        source: "sdk",
      },
      {
        id: "skill-default-title",
        workDir: "D:\\work\\demo",
        updatedAt: 100,
        title: "新会话",
        lastPrompt: "介绍一下你有什么功能",
        isCustomTitle: true,
        source: "sdk",
      },
    ], "D:\\work\\demo", { source: "sdk" });

    expect(result[0].title).toBe("第一条有效提示");
    expect(result[1].title).toBe("介绍一下你有什么功能");
  });

  it("保留用户锁定标题和官方自定义标题", () => {
    const locked = localSession({
      id: "official-locked",
      officialSessionId: "official-locked",
      title: "我的标题",
      titleLocked: true,
    });
    const custom = localSession({
      id: "official-custom",
      officialSessionId: "official-custom",
      title: "New Session",
    });
    const result = reconcileOfficialSessionCatalog([locked, custom], [
      {
        id: "official-locked",
        workDir: "D:\\work\\demo",
        updatedAt: 200,
        brief: "不应覆盖",
        source: "sdk",
      },
      {
        id: "official-custom",
        workDir: "D:\\work\\demo",
        updatedAt: 190,
        title: "/skill:game-development 使用该skill",
        lastPrompt: "你好",
        brief: "其他提示",
        isCustomTitle: true,
        source: "sdk",
      },
    ], "D:\\work\\demo", { source: "sdk" });

    expect(result.find((session) => session.id === "official-locked")?.title).toBe("我的标题");
    expect(result.find((session) => session.id === "official-custom")?.title).toBe("/skill:game-development 使用该ski...");
  });

  it("按官方 id 对账、保留本地正文并更新未锁定标题", () => {
    const existing = localSession({
      officialSessionId: "official-1",
      events: [{ id: "user-1", type: "user_message", timestamp: 10, content: "正文" }],
    });
    const result = reconcileOfficialSessionCatalog([existing], [
      { id: "official-1", workDir: "d:/work/demo/", updatedAt: 200, brief: "官方标题" },
    ], "D:\\work\\demo");

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("官方标题");
    expect(result[0].events).toEqual(existing.events);
    expect(result[0].updatedAt).toBe(200);
  });

  it("把 Kimix Skill 注册表刷新产生的 fork 链折叠到同一个本地会话", () => {
    const parent = localSession({
      id: "local-conversation",
      officialSessionId: "session-parent",
      runtimeSessionId: "session-parent",
      events: [{ id: "user-1", type: "user_message", timestamp: 10, content: "原对话" }],
    });
    const duplicateParent = localSession({
      id: "session-parent",
      officialSessionId: "session-parent",
      title: "重复父会话",
      events: [{ id: "user-2", type: "user_message", timestamp: 11, content: "重复镜像" }],
    });
    const result = reconcileOfficialSessionCatalog([parent, duplicateParent], [
      { id: "session-parent", workDir: "D:\\work\\demo", updatedAt: 100, title: "同一对话", source: "sdk" },
      {
        id: "skill-child",
        workDir: "D:\\work\\demo",
        updatedAt: 200,
        title: "同一对话",
        source: "sdk",
        metadata: { source: "kimix-fork", forkedFrom: "session-parent" },
      },
      {
        id: "skill-leaf",
        workDir: "D:\\work\\demo",
        updatedAt: 300,
        title: "同一对话",
        source: "sdk",
        metadata: { source: "kimix-fork", forkedFrom: "skill-child" },
      },
    ], "D:\\work\\demo", { source: "sdk" });

    const visible = result.filter((session) => !session.archivedAt);
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({
      id: "local-conversation",
      officialSessionId: "skill-leaf",
      runtimeSessionId: "skill-leaf",
    });
    expect(visible[0].events).toEqual(parent.events);
    expect(result.find((session) => session.id === "session-parent")?.archivedAt).toBeTypeOf("number");
  });

  it("metadata 丢失时仍把 skill-* 刷新 fork 折叠到原本地会话", () => {
    const parent = localSession({
      id: "local-conversation",
      officialSessionId: "session-parent",
      runtimeSessionId: "session-parent",
      title: "不对，我是说之前...",
      events: [{ id: "user-1", type: "user_message", timestamp: 10, content: "原对话" }],
    });
    const result = reconcileOfficialSessionCatalog([parent], [
      { id: "session-parent", workDir: "D:\\work\\demo", updatedAt: 100, title: "不对，我是说之前...", source: "sdk" },
      { id: "skill-e19fe630-af18-439b-9ccf-b17fb747bdd1", workDir: "D:\\work\\demo", updatedAt: 200, title: "不对，我是说之前...", source: "sdk" },
    ], "D:\\work\\demo", { source: "sdk" });

    const visible = result.filter((session) => !session.archivedAt);
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({
      id: "local-conversation",
      officialSessionId: "skill-e19fe630-af18-439b-9ccf-b17fb747bdd1",
      runtimeSessionId: "skill-e19fe630-af18-439b-9ccf-b17fb747bdd1",
      skillForkParentSessionId: "session-parent",
    });
    expect(visible[0].events).toEqual(parent.events);
  });

  it("官方目录只剩 skill-* 时也能用本地父会话折叠", () => {
    const parent = localSession({
      id: "session-parent",
      officialSessionId: "session-parent",
      runtimeSessionId: "session-parent",
      title: "不对，我是说之前...",
      updatedAt: 100,
      events: [{ id: "user-1", type: "user_message", timestamp: 10, content: "原对话" }],
    });
    const result = reconcileOfficialSessionCatalog([parent], [
      { id: "skill-e19fe630-af18-439b-9ccf-b17fb747bdd1", workDir: "D:\\work\\demo", updatedAt: 200, title: "不对，我是说之前...", source: "sdk" },
    ], "D:\\work\\demo", { source: "sdk" });

    const visible = result.filter((session) => !session.archivedAt);
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({
      id: "session-parent",
      officialSessionId: "skill-e19fe630-af18-439b-9ccf-b17fb747bdd1",
      runtimeSessionId: "skill-e19fe630-af18-439b-9ccf-b17fb747bdd1",
      skillForkParentSessionId: "session-parent",
    });
  });

  it("不按标题合并真正独立的同名会话或用户手动分支", () => {
    const result = reconcileOfficialSessionCatalog([], [
      { id: "session-a", workDir: "D:\\work\\demo", updatedAt: 300, title: "同名", source: "server" },
      { id: "session-b", workDir: "D:\\work\\demo", updatedAt: 200, title: "同名", source: "server" },
      {
        id: "fork-manual",
        workDir: "D:\\work\\demo",
        updatedAt: 100,
        title: "同名",
        source: "server",
        metadata: { source: "kimix-fork", forkedFrom: "session-a" },
      },
    ], "D:\\work\\demo", { source: "server" });

    expect(result.filter((session) => !session.archivedAt).map((session) => session.id)).toEqual([
      "session-a",
      "session-b",
      "fork-manual",
    ]);
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

  it("官方 Server 明确恢复归档会话时同步取消本地归档", () => {
    const archived = localSession({ id: "official-1", officialSessionId: "official-1", archivedAt: 30, updatedAt: 30 });
    const result = reconcileOfficialSessionCatalog([archived], [
      { id: "official-1", workDir: "D:\\work\\demo", updatedAt: 200, brief: "已恢复", source: "server" },
    ], "D:\\work\\demo", { source: "server" });

    expect(result).toHaveLength(1);
    expect(result[0].archivedAt).toBeUndefined();
    expect(result[0].title).toBe("已恢复");
    expect(result[0].updatedAt).toBe(200);
  });

  it("忽略其他项目的目录项", () => {
    const result = reconcileOfficialSessionCatalog([], [
      { id: "other", workDir: "D:\\work\\other", updatedAt: 200, brief: "其他项目" },
    ], "D:\\work\\demo");

    expect(result).toEqual([]);
  });

  it("官方 Server 列表缺失的同项目镜像会被本地归档", () => {
    const vanished = localSession({ id: "official-1", officialSessionId: "official-1", updatedAt: 100 });
    const visible = localSession({ id: "official-2", officialSessionId: "official-2", updatedAt: 90 });
    const result = reconcileOfficialSessionCatalog([vanished, visible], [
      { id: "official-2", workDir: "D:\\work\\demo", updatedAt: 200, brief: "仍可见", source: "server" },
    ], "D:\\work\\demo", { source: "server" });

    const archived = result.find((session) => session.id === "official-1");
    expect(archived?.archivedAt).toBeTypeOf("number");
    expect(result.find((session) => session.id === "official-2")?.archivedAt).toBeUndefined();
  });

  it("官方 Server 空列表也会隐藏同项目旧镜像", () => {
    const vanished = localSession({ id: "official-1", officialSessionId: "official-1" });
    const result = reconcileOfficialSessionCatalog([vanished], [], "D:\\work\\demo", { source: "server" });

    expect(result[0].archivedAt).toBeTypeOf("number");
  });

  it("SDK 明确返回已归档时归档带正文的本地镜像", () => {
    const local = localSession({
      id: "official-archived",
      officialSessionId: "official-archived",
      events: [{ id: "user-1", type: "user_message", timestamp: 10, content: "正文" }],
    });
    const result = reconcileOfficialSessionCatalog([local], [{
      id: "official-archived",
      workDir: "D:\\work\\demo",
      updatedAt: 200,
      archived: true,
      source: "sdk",
    }], "D:\\work\\demo", { source: "sdk" });

    expect(result[0].archivedAt).toBeTypeOf("number");
  });

  it("不为只存在于官方归档目录的会话创建新镜像", () => {
    const result = reconcileOfficialSessionCatalog([], [{
      id: "official-archived",
      workDir: "D:\\work\\demo",
      updatedAt: 200,
      archived: true,
      source: "sdk",
    }], "D:\\work\\demo", { source: "sdk" });

    expect(result).toEqual([]);
  });

  it("SDK 来源列表不隐藏缺失的本地镜像", () => {
    const existing = localSession({
      id: "official-1",
      officialSessionId: "official-1",
      events: [{ id: "user-1", type: "user_message", timestamp: 10, content: "已有正文" }],
    });
    const result = reconcileOfficialSessionCatalog([existing], [], "D:\\work\\demo", { source: "sdk" });

    expect(result[0]).toBe(existing);
    expect(result[0].archivedAt).toBeUndefined();
  });

  it("SDK 目录省略空会话时会归档任意标题的遗留空镜像", () => {
    const empty = localSession({
      id: "empty-1",
      officialSessionId: "empty-1",
      title: "P3 Child",
      createdAt: Date.now() - 10 * 60 * 1000,
      events: [],
    });
    const result = reconcileOfficialSessionCatalog([empty], [], "D:\\work\\demo", { source: "sdk" });

    expect(result[0].archivedAt).toBeTypeOf("number");
  });

  it("保留刚创建且尚未输入的空会话", () => {
    const recent = localSession({
      id: "empty-recent",
      officialSessionId: "empty-recent",
      title: "New Session",
      createdAt: Date.now(),
      events: [],
    });
    const result = reconcileOfficialSessionCatalog([recent], [], "D:\\work\\demo", { source: "sdk" });

    expect(result[0]).toBe(recent);
    expect(result[0].archivedAt).toBeUndefined();
  });

  it("不因官方缺失隐藏本地-only、长程任务或其他项目会话", () => {
    const localOnly = localSession({ id: "local-abc", officialSessionId: undefined, runtimeSessionId: undefined });
    const longTask = localSession({
      id: "official-long",
      officialSessionId: "official-long",
      longTask: {
        taskId: "task-1",
        title: "长程任务",
        stage: "running",
        activeAgent: "executor",
        executorSessionId: "official-long",
        reviewerSessionId: "official-review",
        bigPlanPath: "big.md",
        reviewQueuePath: "review.md",
        currentStep: 1,
        targetStep: null,
      },
    });
    const otherProject = localSession({ id: "official-other", officialSessionId: "official-other", projectPath: "D:\\work\\other" });
    const result = reconcileOfficialSessionCatalog([localOnly, longTask, otherProject], [], "D:\\work\\demo", { source: "server" });

    expect(result.map((session) => session.archivedAt)).toEqual([undefined, undefined, undefined]);
  });
});
