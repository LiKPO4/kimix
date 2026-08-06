import { describe, expect, it } from "vitest";
import { hasRecentDuplicatePendingMessage, shouldDeferLocalPendingDispatch } from "../promptQueue";

describe("shouldDeferLocalPendingDispatch", () => {
  it("官方 Server 仍有 active 或 queued prompt 时延后本地队列", () => {
    expect(shouldDeferLocalPendingDispatch({
      supported: true,
      activeId: "active-1",
      activeStatus: "running",
      queuedIds: [],
    })).toBe(true);
    expect(shouldDeferLocalPendingDispatch({
      supported: true,
      activeId: null,
      activeStatus: null,
      queuedIds: ["queued-1"],
    })).toBe(true);
  });

  it("SDK 不支持官方队列或查询失败时不阻断本地队列", () => {
    expect(shouldDeferLocalPendingDispatch({
      supported: false,
      activeId: null,
      activeStatus: null,
      queuedIds: [],
    })).toBe(false);
    expect(shouldDeferLocalPendingDispatch(null)).toBe(false);
  });

  it("官方 active 处于终态时不拦截本地队列（终态残留防永卡）", () => {
    for (const status of ["completed", "error", "interrupted", "cancelled", "failed", "aborted"]) {
      expect(shouldDeferLocalPendingDispatch({
        supported: true,
        activeId: "active-1",
        activeStatus: status,
        queuedIds: [],
      })).toBe(false);
    }
  });

  it("官方 active 状态未知时仍保守拦截", () => {
    expect(shouldDeferLocalPendingDispatch({
      supported: true,
      activeId: "active-1",
      activeStatus: null,
      queuedIds: [],
    })).toBe(true);
  });

  it("官方队列为空时允许本地队列派发", () => {
    expect(shouldDeferLocalPendingDispatch({
      supported: true,
      activeId: null,
      activeStatus: null,
      queuedIds: [],
    })).toBe(false);
  });
});

describe("hasRecentDuplicatePendingMessage", () => {
  const candidate = { sessionId: "s1", content: "同一条消息" };

  it("发送期间已有同会话同内容消息入队时判定为重复", () => {
    expect(hasRecentDuplicatePendingMessage([
      { sessionId: "s1", content: "同一条消息", createdAt: 1100 },
    ], candidate, 1000)).toBe(true);
  });

  it("发送开始之前入队的旧消息不算重复", () => {
    expect(hasRecentDuplicatePendingMessage([
      { sessionId: "s1", content: "同一条消息", createdAt: 900 },
    ], candidate, 1000)).toBe(false);
  });

  it("不同会话或不同内容不算重复", () => {
    expect(hasRecentDuplicatePendingMessage([
      { sessionId: "s2", content: "同一条消息", createdAt: 1100 },
      { sessionId: "s1", content: "另一条消息", createdAt: 1100 },
    ], candidate, 1000)).toBe(false);
  });

  it("空队列不算重复", () => {
    expect(hasRecentDuplicatePendingMessage([], candidate, 1000)).toBe(false);
  });
});
