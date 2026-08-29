import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useAppStore } from "@/stores/appStore";
import { SettingsWorkspaceSidebar } from "../SettingsWorkspaceSidebar";
import { SETTINGS_FOCUS_SECTION_EVENT } from "../settingsNavigation";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: ReturnType<typeof createRoot>[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => act(async () => root.unmount())));
  document.body.innerHTML = "";
  localStorage.clear();
  useAppStore.setState({
    workspaceView: "chat",
    activeSettingsPageId: "general",
    sidebarOpen: true,
  });
});

async function renderSidebar() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(createElement(SettingsWorkspaceSidebar, {
    width: 320,
    collapsed: false,
  })));
  return container;
}

function buttonByText(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === text);
}

describe("SettingsWorkspaceSidebar", () => {
  it("用设置分类接管主侧栏并持久化活动页面", async () => {
    useAppStore.setState({ workspaceView: "settings", activeSettingsPageId: "general" });
    const container = await renderSidebar();

    expect(container.textContent).toContain("返回对话");
    expect(container.textContent).toContain("模型与供应商");
    expect(container.textContent).not.toContain("新对话");
    expect(container.textContent).not.toContain("项目");

    // 底部按钮与对话页「设置」同位置同结构（含右侧版本号），用 aria-label 定位。
    const backButton = container.querySelector<HTMLButtonElement>('button[aria-label="返回对话"]');
    expect(backButton?.className).toContain("kimix-settings-entry");
    await act(async () => backButton?.click());
    expect(useAppStore.getState().workspaceView).toBe("chat");

    await act(async () => buttonByText(container, "模型与供应商")?.click());

    expect(useAppStore.getState().activeSettingsPageId).toBe("models");
    expect(localStorage.getItem("kimix_settings_active_page")).toBe("models");
  });

  it("从主侧栏搜索结果跳转并通知正文聚焦目标分区", async () => {
    useAppStore.setState({ workspaceView: "settings", activeSettingsPageId: "general" });
    const container = await renderSidebar();
    const receivedSections: string[] = [];
    const handleFocus = (event: Event) => {
      const sectionId = (event as CustomEvent<{ sectionId: string }>).detail.sectionId;
      receivedSections.push(sectionId);
    };
    window.addEventListener(SETTINGS_FOCUS_SECTION_EVENT, handleFocus);

    const input = container.querySelector('input[aria-label="搜索设置"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "API Key");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const resultButton = container.querySelector(".kimix-settings-search-result") as HTMLButtonElement;
    await act(async () => resultButton.click());

    expect(useAppStore.getState().activeSettingsPageId).toBe("models");
    expect(receivedSections).toEqual(["model"]);
    window.removeEventListener(SETTINGS_FOCUS_SECTION_EVENT, handleFocus);
  });
});
