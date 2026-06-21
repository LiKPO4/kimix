import { describe, expect, it } from "vitest";
import { shouldDeferLocalPendingDispatch } from "../promptQueue";

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

  it("官方队列为空时允许本地队列派发", () => {
    expect(shouldDeferLocalPendingDispatch({
      supported: true,
      activeId: null,
      activeStatus: null,
      queuedIds: [],
    })).toBe(false);
  });
});
