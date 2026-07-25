/**
 * @vitest-environment jsdom
 *
 * 待使用模型（pendingNewSessionModel）测试：
 * 欢迎屏切换模型只影响下一个新会话，不写官方默认配置；
 * 新会话创建消费后清除（一次性）。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { useAppStore } from "@/stores/appStore";

const STORAGE_KEY = "kimix_pending_new_session_model";

describe("pendingNewSessionModel", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.getState().setPendingNewSessionModel(null);
  });

  it("starts as null when nothing is stored", () => {
    expect(useAppStore.getState().pendingNewSessionModel).toBeNull();
  });

  it("persists the selected model to localStorage", () => {
    useAppStore.getState().setPendingNewSessionModel("deepseek/deepseek-v4-flash");
    expect(useAppStore.getState().pendingNewSessionModel).toBe("deepseek/deepseek-v4-flash");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("deepseek/deepseek-v4-flash");
  });

  it("clears the value and removes the localStorage entry when consumed", () => {
    useAppStore.getState().setPendingNewSessionModel("deepseek/deepseek-v4-flash");
    useAppStore.getState().setPendingNewSessionModel(null);
    expect(useAppStore.getState().pendingNewSessionModel).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("trims whitespace and treats blank input as null", () => {
    useAppStore.getState().setPendingNewSessionModel("  grok-4.5  ");
    expect(useAppStore.getState().pendingNewSessionModel).toBe("grok-4.5");
    useAppStore.getState().setPendingNewSessionModel("   ");
    expect(useAppStore.getState().pendingNewSessionModel).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
