import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChangeCard } from "../ChangeCard";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Project, Session, TimelineEvent } from "@/types/ui";

const project: Project = { id: "project", name: "Project", path: "D:/Project", lastOpenedAt: 1 };

afterEach(() => {
  document.body.innerHTML = "";
  Reflect.deleteProperty(window, "api");
  vi.restoreAllMocks();
});

describe("ChangeCard", () => {
  it("uses the same control role for the file-name and preview triggers", async () => {
    useAppStore.setState({ currentProject: project, currentSession: null });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => root.render(createElement(ChangeCard, {
      changes: [{ path: "src/example.ts", oldText: "before", newText: "after" }],
    })));

    const fileNameButton = container.querySelector<HTMLButtonElement>('button[title^="预览 "]');
    const previewButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "预览");
    expect(fileNameButton?.classList.contains("kimix-control-button")).toBe(true);
    expect(previewButton?.classList.contains("kimix-control-button")).toBe(true);
    expect(fileNameButton?.classList.contains("kimix-muted-action")).toBe(false);
    expect(previewButton?.classList.contains("kimix-muted-action")).toBe(false);

    await act(async () => root.unmount());
  });

  it("does not render a terminal divider on the collapsed overflow action", async () => {
    useAppStore.setState({ currentProject: project, currentSession: null });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => root.render(createElement(ChangeCard, {
      changes: Array.from({ length: 4 }, (_, index) => ({
        path: `src/example-${index}.ts`,
        oldText: "before",
        newText: "after",
      })),
    })));

    const overflowAction = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("再显示 1 个文件"));
    expect(overflowAction).toBeDefined();
    expect(overflowAction?.classList.contains("border-b")).toBe(false);
    expect(overflowAction?.classList.contains("hover:border-b-transparent")).toBe(false);

    await act(async () => root.unmount());
  });

  it("loads and expands an immutable commit preview when the file row is clicked", async () => {
    const event: Extract<TimelineEvent, { type: "change_summary" }> = {
      id: "change",
      type: "change_summary",
      timestamp: 100,
      projectPath: project.path,
      files: [{ path: "storylets.json" }],
      additions: 0,
      deletions: 0,
    };
    const session: Session = {
      id: "session",
      engine: "kimi-code",
      title: "test",
      projectPath: project.path,
      createdAt: 1,
      updatedAt: 1,
      events: [event],
    };
    useAppStore.setState({ currentProject: project, currentSession: session });
    useSessionStore.setState({ sessions: [session] });
    const getChangePreview = vi.fn().mockResolvedValue({
      success: true,
      data: {
        source: "commit",
        patch: "@@ -1 +1 @@\n-before\n+after",
        additions: 1,
        deletions: 1,
        commitSha: "2933405b640dd425f714b585a3717ee37438ea66",
      },
    });
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { getChangePreview },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => root.render(createElement(ChangeCard, { event })));
    expect(container.textContent).toContain("统计待恢复");
    const previewButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "预览");
    expect(previewButton).toBeDefined();
    await act(async () => previewButton?.click());

    expect(getChangePreview).toHaveBeenCalledWith({
      projectPath: project.path,
      filePath: "storylets.json",
      eventTimestamp: 100,
      commitSha: undefined,
    });
    expect(container.textContent).toContain("提交 2933405");
    expect(container.textContent).toContain("+1");
    expect(container.textContent).toContain("-1");
    expect(container.textContent).toContain("-before");
    expect(container.textContent).toContain("+after");
    const previewSurface = container.querySelector('[data-change-preview-surface="patch"]');
    expect(previewSurface).not.toBeNull();
    expect(previewSurface?.parentElement?.style.padding).toBe("");
    expect(previewSurface?.classList.contains("border-t")).toBe(true);
    await act(async () => root.unmount());
  });

  it("renders a structured two-column diff as a full-width file surface", async () => {
    useAppStore.setState({ currentProject: project, currentSession: null });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => root.render(createElement(ChangeCard, {
      changes: [{
        path: "src/example.ts",
        oldText: "const value = 1;",
        newText: "const value = 2;",
      }],
    })));
    const previewButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "预览");
    expect(previewButton).toBeDefined();
    await act(async () => previewButton?.click());

    const previewSurface = container.querySelector('[data-change-preview-surface="structured"]');
    expect(previewSurface).not.toBeNull();
    expect(previewSurface?.parentElement?.style.padding).toBe("");
    expect(previewSurface?.classList.contains("border-t")).toBe(true);
    expect(previewSurface?.children).toHaveLength(2);
    expect(container.textContent).toContain("修改前");
    expect(container.textContent).toContain("修改后");
    await act(async () => root.unmount());
  });

  it("treats an unavailable preview message as an expanded and collapsible row", async () => {
    const event: Extract<TimelineEvent, { type: "change_summary" }> = {
      id: "change-unavailable",
      type: "change_summary",
      timestamp: 100,
      projectPath: project.path,
      files: [{ path: ".reasonix/desktop-topic-title-sources.json", additions: 4, deletions: 0 }],
      additions: 4,
      deletions: 0,
    };
    const session: Session = {
      id: "session-unavailable",
      engine: "kimi-code",
      title: "test",
      projectPath: project.path,
      createdAt: 1,
      updatedAt: 1,
      events: [event],
    };
    useAppStore.setState({ currentProject: project, currentSession: session });
    useSessionStore.setState({ sessions: [session] });
    Object.defineProperty(window, "api", {
      configurable: true,
      value: {
        getChangePreview: vi.fn().mockResolvedValue({
          success: true,
          data: { source: "unavailable", patch: "" },
        }),
      },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => root.render(createElement(ChangeCard, { event })));
    const previewButton = () => Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "预览" || button.textContent?.trim() === "收起");
    await act(async () => previewButton()?.click());

    expect(container.textContent).toContain("未找到可确认属于本轮的差异。");
    expect(previewButton()?.textContent?.trim()).toBe("收起");
    expect(previewButton()?.getAttribute("aria-expanded")).toBe("true");

    await act(async () => previewButton()?.click());
    expect(container.textContent).not.toContain("未找到可确认属于本轮的差异。");
    expect(previewButton()?.textContent?.trim()).toBe("预览");
    expect(previewButton()?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => root.unmount());
  });
});
