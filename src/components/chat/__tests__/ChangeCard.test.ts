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
    await act(async () => root.unmount());
  });
});
