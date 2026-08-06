import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KimiCodeBackgroundTaskInfo } from "@electron/types/ipc";
import type { TodoItem } from "@/types/ui";
import { ComposerDockBar } from "../ComposerDockBar";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type DockProps = ComponentProps<typeof ComposerDockBar>;

function makeTask(overrides: Partial<KimiCodeBackgroundTaskInfo> = {}): KimiCodeBackgroundTaskInfo {
  return {
    taskId: "task-1",
    command: "pnpm test",
    description: "跑测试",
    status: "running",
    pid: 1234,
    exitCode: null,
    startedAt: Date.now() - 5000,
    endedAt: null,
    transport: "server",
    ...overrides,
  };
}

const todoFixture: TodoItem[] = [
  { id: "t1", content: "整理代码", status: "done" },
  { id: "t2", content: "跑测试", status: "in_progress" },
  { id: "t3", content: "提交", status: "pending" },
];

function makeProps(overrides: Partial<DockProps> = {}): DockProps {
  return {
    bashTasks: [],
    subagentTasks: [],
    todoItems: [],
    queueCount: 0,
    queueBody: null,
    ...overrides,
  };
}

describe("ComposerDockBar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(props: DockProps) {
    act(() => {
      root.render(createElement(ComposerDockBar, props));
    });
  }

  function capsuleLabels(): string[] {
    return Array.from(container.querySelectorAll<HTMLButtonElement>(".kimix-dock-capsule")).map(
      (el) => el.textContent ?? "",
    );
  }

  function clickCapsule(index: number) {
    const capsule = container.querySelectorAll<HTMLButtonElement>(".kimix-dock-capsule")[index];
    act(() => {
      capsule.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("所有数据源为空时不渲染任何内容", () => {
    render(makeProps());
    expect(container.innerHTML).toBe("");
  });

  it("按数据显隐四类胶囊并展示计数", () => {
    render(
      makeProps({
        bashTasks: [makeTask(), makeTask({ taskId: "task-2" })],
        subagentTasks: [makeTask({ taskId: "sub-1", subagentType: "subagent" })],
        todoItems: todoFixture,
        queueCount: 3,
      }),
    );
    const labels = capsuleLabels();
    expect(labels).toHaveLength(4);
    expect(labels[0]).toContain("后台 Bash");
    expect(labels[0]).toContain("(2)");
    expect(labels[1]).toContain("子 Agent");
    expect(labels[1]).toContain("(1)");
    expect(labels[2]).toContain("待办");
    expect(labels[2]).toContain("(1/3)");
    expect(labels[3]).toContain("队列");
    expect(labels[3]).toContain("(3)");
  });

  it("点击胶囊展开面板，再点关闭，面板互斥切换", () => {
    render(makeProps({ bashTasks: [makeTask()], todoItems: todoFixture }));
    expect(container.querySelector(".kimix-dock-panel")).toBeNull();

    clickCapsule(0);
    expect(container.querySelector(".kimix-dock-panel")).not.toBeNull();
    expect(container.querySelector(".kimix-dock-panel")?.textContent).toContain("后台 Bash · 1 个任务");
    expect(container.querySelector(".kimix-dock-panel")?.textContent).toContain("跑测试");

    clickCapsule(1);
    expect(container.querySelector(".kimix-dock-panel")?.textContent).toContain("待办 · 1/3 已完成");
    expect(container.querySelector(".kimix-dock-panel")?.textContent).toContain("整理代码");

    clickCapsule(1);
    expect(container.querySelector(".kimix-dock-panel")).toBeNull();
  });

  it("点击组件外部关闭面板", () => {
    render(makeProps({ bashTasks: [makeTask()] }));
    clickCapsule(0);
    expect(container.querySelector(".kimix-dock-panel")).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(container.querySelector(".kimix-dock-panel")).toBeNull();
  });

  it("数据清空后自动关闭对应面板", () => {
    render(makeProps({ bashTasks: [makeTask()] }));
    clickCapsule(0);
    expect(container.querySelector(".kimix-dock-panel")).not.toBeNull();
    render(makeProps({ bashTasks: [] }));
    expect(container.innerHTML).toBe("");
  });

  it("队列面板渲染注入的列表体；X 只关面板，收起按钮才收起到侧栏", () => {
    const onHideQueue = vi.fn();
    render(makeProps({ queueCount: 2, queueBody: createElement("div", { "data-testid": "queue-body" }, "排队消息列表"), onHideQueue }));
    clickCapsule(0);
    expect(container.querySelector("[data-testid='queue-body']")?.textContent).toBe("排队消息列表");

    // X 语义 = 关闭浮窗（同点击胶囊），不触发收起
    const closeButton = container.querySelector<HTMLButtonElement>(".kimix-dock-panel button[aria-label='关闭面板']");
    expect(closeButton).not.toBeNull();
    act(() => {
      closeButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector(".kimix-dock-panel")).toBeNull();
    expect(onHideQueue).not.toHaveBeenCalled();

    // 收起按钮语义 = 收起到侧栏，同时关闭浮窗
    clickCapsule(0);
    const hideButton = container.querySelector<HTMLButtonElement>(".kimix-dock-panel button[aria-label='收起到侧栏']");
    expect(hideButton).not.toBeNull();
    act(() => {
      hideButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onHideQueue).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".kimix-dock-panel")).toBeNull();
  });

  it("待办/队列面板有收起到侧栏按钮，后台任务面板只有关闭按钮（侧栏由旧后台任务块展示）", () => {
    render(
      makeProps({
        bashTasks: [makeTask()],
        subagentTasks: [makeTask({ taskId: "sub-1", subagentType: "subagent" })],
        todoItems: todoFixture,
        queueCount: 1,
        onHideTodo: vi.fn(),
        onHideQueue: vi.fn(),
      }),
    );
    // bash / subagent：只有 X 关闭，无收起到侧栏
    for (const index of [0, 1]) {
      clickCapsule(index);
      expect(container.querySelector(".kimix-dock-panel button[aria-label='关闭面板']")).not.toBeNull();
      expect(container.querySelector(".kimix-dock-panel button[aria-label='收起到侧栏']")).toBeNull();
    }
    // todo / queue：X 关闭 + 收起到侧栏 都有
    for (const index of [2, 3]) {
      clickCapsule(index);
      expect(container.querySelector(".kimix-dock-panel button[aria-label='收起到侧栏']")).not.toBeNull();
      expect(container.querySelector(".kimix-dock-panel button[aria-label='关闭面板']")).not.toBeNull();
    }
  });
});
