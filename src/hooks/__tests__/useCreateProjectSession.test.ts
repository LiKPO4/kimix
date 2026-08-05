// @vitest-environment jsdom

/**
 * useCreateProjectSession 的 pending 模型消费测试（不变量 100）：
 * 欢迎屏切换的待使用模型必须被新会话创建入口优先消费并一次性清除，
 * 否则出现「显示 k3 却以 config 默认模型执行」。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useCreateProjectSession } from "../useCreateProjectSession";

function stubWindowApi(defaultModel: string) {
  (window as unknown as { api: Record<string, unknown> }).api = {
    getKimiModelConfig: async () => ({ success: true, data: { defaultModel } }),
  };
}

describe("useCreateProjectSession 的 pending 模型消费", () => {
  let container: HTMLDivElement;
  let root: Root;
  let createSession: () => Promise<void>;

  function Probe() {
    createSession = useCreateProjectSession().createSession;
    return null;
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    localStorage.clear();
    stubWindowApi("deepseek-chat");
    useSessionStore.setState({ sessions: [] });
    useAppStore.setState({
      currentProject: { id: "p1", name: "proj", path: "/tmp/proj", lastOpenedAt: 0 },
      currentSession: null,
      creatingSessionProjectPath: null,
      pendingNewSessionModel: "kimi/k3",
    });
    act(() => {
      root.render(createElement(Probe));
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("有 pending 模型时：新会话携带 pending（而非 config 默认）并一次性消费", async () => {
    await act(async () => {
      await createSession();
    });

    const session = useSessionStore.getState().sessions[0];
    expect(session).toBeTruthy();
    expect(session.model).toBe("kimi/k3");
    expect(useAppStore.getState().pendingNewSessionModel).toBeNull();
  });

  it("无 pending 模型时回落 config 默认模型", async () => {
    useAppStore.setState({ pendingNewSessionModel: null });
    await act(async () => {
      await createSession();
    });

    const session = useSessionStore.getState().sessions[0];
    expect(session.model).toBe("deepseek-chat");
  });
});
