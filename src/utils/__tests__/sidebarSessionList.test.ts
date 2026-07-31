import { describe, expect, it } from "vitest";
import { resolveSidebarSessionListWindow, SIDEBAR_SESSION_LIST_COLLAPSE_COUNT } from "../sidebarSessionList";

function makeSessions(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `s${index + 1}` }));
}

describe("resolveSidebarSessionListWindow", () => {
  it("不超阈值时不折叠、不显示入口", () => {
    const window = resolveSidebarSessionListWindow(makeSessions(4), undefined, false);
    expect(window.collapsed).toBe(false);
    expect(window.shownSessions.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(window.hiddenCount).toBe(0);
    expect(window.showToggle).toBe(false);
  });

  it("默认只展示最近 5 个，折叠其余并显示展开入口", () => {
    const window = resolveSidebarSessionListWindow(makeSessions(8), undefined, false);
    expect(window.collapsed).toBe(true);
    expect(window.shownSessions.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    expect(window.hiddenCount).toBe(3);
    expect(window.showToggle).toBe(true);
  });

  it("手动展开后显示全部，并允许收起", () => {
    const window = resolveSidebarSessionListWindow(makeSessions(8), undefined, true);
    expect(window.collapsed).toBe(false);
    expect(window.shownSessions).toHaveLength(8);
    expect(window.showToggle).toBe(true);
  });

  it("当前打开会话在折叠区外时自动展开，且不显示收起入口", () => {
    const window = resolveSidebarSessionListWindow(makeSessions(8), "s7", false);
    expect(window.currentOutsideFirst).toBe(true);
    expect(window.collapsed).toBe(false);
    expect(window.shownSessions).toHaveLength(8);
    // 当前会话保护展开时不提供收起，避免把打开的会话重新藏进折叠区
    expect(window.showToggle).toBe(false);
  });

  it("当前打开会话在前 5 个之内时仍按默认折叠", () => {
    const window = resolveSidebarSessionListWindow(makeSessions(8), "s2", false);
    expect(window.currentOutsideFirst).toBe(false);
    expect(window.collapsed).toBe(true);
    expect(window.shownSessions).toHaveLength(SIDEBAR_SESSION_LIST_COLLAPSE_COUNT);
  });
});
