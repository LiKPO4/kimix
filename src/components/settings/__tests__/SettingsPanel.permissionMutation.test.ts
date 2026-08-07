import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "../SettingsPanel";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Session } from "@/types/ui";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    engine: "kimi-code",
    runtimeSessionId: "runtime-1",
    model: "kimi-for-coding",
    title: "测试会话",
    projectPath: "D:/proj",
    createdAt: 1000,
    updatedAt: 1000,
    events: [],
    ...overrides,
  };
}

const mountedRoots: Root[] = [];
let unhandledSpy: ((reason: unknown) => void) | null = null;

beforeEach(() => {
  useAppStore.setState({
    currentSession: makeSession(),
    permissionMode: "manual",
  });
  useSessionStore.setState({ sessions: [makeSession()] });
  // 默认 IPC 全部失败兜底；setKimiCodePermission 单独 mock 为 reject，
  // 复现「异常路径不复位并发守卫」：第二次点击应仍能发起切换。
  const setPermissionMock = vi.fn().mockRejectedValue(new Error("ipc down"));
  (window as unknown as { api: unknown }).api = new Proxy({}, {
    get: (_target, prop) => {
      if (prop === "setKimiCodePermission") return setPermissionMock;
      return async () => ({ success: false as const, error: "mock" });
    },
  });
  // IPC reject 直达组件内部（组件不 catch），测试吃掉该 unhandled rejection
  unhandledSpy = (reason: unknown) => {
    void reason;
  };
  process.on("unhandledRejection", unhandledSpy);
});

afterEach(async () => {
  for (const root of mountedRoots.splice(0)) {
    await act(async () => root.unmount());
  }
  document.body.innerHTML = "";
  Reflect.deleteProperty(window, "api");
  useAppStore.setState({ currentSession: null, permissionMode: "manual" });
  useSessionStore.setState({ sessions: [] });
  if (unhandledSpy) process.off("unhandledRejection", unhandledSpy);
  unhandledSpy = null;
  vi.restoreAllMocks();
});

async function renderSettings() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  await act(async () => {
    root.render(createElement(SettingsPanel, { variant: "workspace" }));
  });
  return container;
}

async function clickPermission(container: HTMLElement, label: string) {
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>(".kimix-settings-permission"));
  const target = buttons.find((button) => button.textContent?.includes(label));
  expect(target, `权限按钮「${label}」应存在`).toBeTruthy();
  await act(async () => {
    target!.click();
    // 让 IPC reject 的微任务链（await → finally 复位）跑完
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("SettingsPanel 权限切换并发守卫", () => {
  it("IPC 异常路径后并发守卫复位：异常后再次点击仍会发起切换", async () => {
    const container = await renderSettings();
    const api = window.api as unknown as { setKimiCodePermission: ReturnType<typeof vi.fn> };
    const setPermissionMock = api.setKimiCodePermission;

    await clickPermission(container, "完全自主");
    expect(setPermissionMock).toHaveBeenCalledTimes(1);

    // 修复前：异常后 ref 卡在 true，第二次点击被守卫静默吞掉（仍是 1 次）；
    // 修复后：finally 复位，第二次点击正常发起（2 次）。
    await clickPermission(container, "逐条确认");
    expect(setPermissionMock).toHaveBeenCalledTimes(2);
  });
});
