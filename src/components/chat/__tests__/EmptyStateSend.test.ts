// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import { sendKimiCodePromptWithRetry } from "@/utils/kimiCodeSendRetry";
import { EmptyState } from "../EmptyState";

vi.mock("@/utils/kimiCodeSendRetry", () => ({
  sendKimiCodePromptWithRetry: vi.fn(async () => ({ success: true, data: { route: "server" } })),
  isKimiActiveTurnError: () => false,
}));

function stubWindowApi(defaultModel: string) {
  (window as unknown as { api: Record<string, unknown> }).api = {
    getKimiModelConfig: async () => ({ success: true, data: { defaultModel } }),
    createKimiCodeSession: async () => ({ success: true, data: { sessionId: "runtime-1" } }),
    swarmKimiCode: vi.fn(async () => ({ success: true, data: {} })),
  };
}

async function clickFirstSuggestion(container: HTMLDivElement) {
  const button = Array.from(container.querySelectorAll("button")).find((item) =>
    item.textContent?.includes("快速全面了解一下当前的项目"),
  );
  expect(button).toBeTruthy();
  await act(async () => {
    button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  // handleSuggestion 全链为微任务（mock 立即 resolve），跨一个宏任务确保全部 drain。
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("EmptyState 推荐发送的模型携带", () => {
  let container: HTMLDivElement;
  let root: Root;

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
      runningSessionId: null,
      pendingNewSessionModel: "kimi/k3",
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    vi.clearAllMocks();
  });

  it("欢迎屏选了 k3 再点推荐：发送携带 k3（而非 config 默认），并一次性消费 pending 模型", async () => {
    act(() => {
      root.render(createElement(EmptyState));
    });
    await clickFirstSuggestion(container);

    expect(sendKimiCodePromptWithRetry).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendKimiCodePromptWithRetry).mock.calls[0][0]).toMatchObject({
      sessionId: "runtime-1",
      model: "kimi/k3",
    });
    const session = useSessionStore.getState().sessions[0];
    expect(session.model).toBe("kimi/k3");
    expect(session.switchedToModel).toBe("kimi/k3");
    expect(useAppStore.getState().pendingNewSessionModel).toBeNull();
  });

  it("无 pending 模型时回落 config 默认模型", async () => {
    useAppStore.setState({ pendingNewSessionModel: null });
    act(() => {
      root.render(createElement(EmptyState));
    });
    await clickFirstSuggestion(container);

    expect(sendKimiCodePromptWithRetry).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendKimiCodePromptWithRetry).mock.calls[0][0]).toMatchObject({
      model: "deepseek-chat",
    });
  });

  it("其他会话后台运行时，当前新会话的快捷任务仍可发送", async () => {
    useAppStore.setState({ runningSessionId: "another-runtime" });
    act(() => {
      root.render(createElement(EmptyState));
    });

    const button = Array.from(container.querySelectorAll("button")).find((item) =>
      item.textContent?.includes("快速全面了解一下当前的项目"),
    );
    expect(button).toBeTruthy();
    expect(button).toBeInstanceOf(HTMLButtonElement);
    expect((button as HTMLButtonElement).disabled).toBe(false);
    await clickFirstSuggestion(container);
    expect(sendKimiCodePromptWithRetry).toHaveBeenCalledTimes(1);
  });

  it("快捷任务首次创建 runtime 后应用本地保存的 Swarm 意图", async () => {
    const draftSession = {
      id: "draft-1",
      engine: "kimi-code" as const,
      model: "kimi/k3",
      title: "新会话",
      projectPath: "/tmp/proj",
      createdAt: 1,
      updatedAt: 1,
      events: [],
      isLoading: false,
      swarmModeDesired: true,
    };
    useSessionStore.setState({ sessions: [draftSession] });
    useAppStore.setState({ currentSession: draftSession, runningSessionId: null });
    act(() => {
      root.render(createElement(EmptyState));
    });
    await clickFirstSuggestion(container);

    expect(window.api.swarmKimiCode).toHaveBeenCalledWith({
      sessionId: "runtime-1",
      enabled: true,
      trigger: "manual",
    });
    const updated = useSessionStore.getState().sessions[0];
    expect(updated.swarmMode).toBe(true);
    expect(updated.swarmModeDesired).toBeUndefined();
  });
});
