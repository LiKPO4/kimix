import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KimiCodeBackgroundTaskInfo } from "@electron/types/ipc";
import type { TimelineEvent, TodoItem } from "@/types/ui";
import type { TowerSnapshotView } from "@/utils/tower";
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

const towerFixture: TowerSnapshotView = {
  enabled: true,
  base: "master",
  owner: "session-main",
  mergedCount: 1,
  totalCount: 2,
  blockedCount: 0,
  missions: [
    { id: "M1", title: "实现设置入口", status: "active", branch: "feat/settings", owner: "worker-a" },
    { id: "M2", title: "补充回归测试", status: "merged", branch: "feat/tests", owner: "worker-b" },
  ],
  agents: [
    { id: "agent-a", name: "worker-a", sessionId: "session-a", kind: "worker", mission: "M1", branch: "feat/settings", status: "active", spawnedAt: "2026-08-28T10:00:00Z" },
    { id: "agent-b", name: "worker-b", sessionId: "session-b", kind: "worker", mission: "M2", branch: "feat/tests", status: "merged", spawnedAt: "2026-08-28T09:00:00Z" },
  ],
  activity: [],
};

const towerTasksFixture: KimiCodeBackgroundTaskInfo[] = [
  makeTask({
    taskId: "tower-task-a",
    description: "tower worker worker-a: 实现设置入口",
    agentId: "agent-a",
    subagentType: "tower-worker",
    status: "running",
    startedAt: Date.now() - 65_000,
  }),
  makeTask({
    taskId: "tower-task-b",
    description: "tower worker worker-b: 补充回归测试",
    agentId: "agent-b",
    subagentType: "tower-worker",
    status: "completed",
    startedAt: Date.now() - 125_000,
    endedAt: Date.now(),
  }),
];

const towerSubagentsFixture: Extract<TimelineEvent, { type: "subagent" }>[] = [{
  id: "subagent-a",
  type: "subagent",
  timestamp: Date.now() - 65_000,
  agentId: "agent-a",
  agentName: "worker-a",
  description: "实现设置入口",
  status: "running",
  events: [{
    id: "agent-a-output",
    type: "assistant_message",
    timestamp: Date.now() - 5_000,
    agentId: "agent-a",
    content: "正在核对官方 Tower 事件流",
    isThinking: false,
    isComplete: true,
  }],
}];

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
    expect(labels[2]).toContain("当前进度");
    expect(labels[2]).toContain("(1/3)");
    expect(labels[3]).toContain("队列");
    expect(labels[3]).toContain("(3)");
  });

  it("完整覆盖官方五类工作胶囊，并把队列放在最后", () => {
    render(
      makeProps({
        goal: { objective: "完成当前目标", status: "active" },
        planContent: "# 实施计划",
        bashTasks: [makeTask()],
        subagentTasks: [makeTask({ taskId: "sub-1", subagentType: "subagent" })],
        todoItems: todoFixture,
        queueCount: 1,
      }),
    );
    const labels = capsuleLabels();
    expect(labels).toHaveLength(6);
    expect(labels[0]).toContain("目标");
    expect(labels[1]).toContain("计划");
    expect(labels[2]).toContain("后台 Bash");
    expect(labels[3]).toContain("子 Agent");
    expect(labels[4]).toContain("当前进度");
    expect(labels[5]).toContain("队列");
  });

  it("计划路径本身也会显示计划胶囊", () => {
    render(makeProps({ planPath: "C:\\.kimi\\plans\\current.md" }));
    expect(capsuleLabels()).toHaveLength(1);
    expect(capsuleLabels()[0]).toContain("计划");
    clickCapsule(0);
    expect(container.querySelector(".kimix-dock-panel")?.textContent).toContain("current.md");
  });

  it("计划面板使用 Markdown 渲染官方正文", () => {
    render(makeProps({ planContent: "# 实施计划\n\n- 第一步" }));
    clickCapsule(0);
    const panel = container.querySelector(".kimix-dock-panel");
    expect(panel?.querySelector("h1")?.textContent).toBe("实施计划");
    expect(panel?.querySelector("li")?.textContent).toContain("第一步");
  });

  it("Tower 使用后台 Agent 胶囊，展开后可筛选并点开 Agent 卡片", () => {
    render(makeProps({
      towerMode: true,
      towerSnapshot: towerFixture,
      towerTasks: towerTasksFixture,
      towerSubagents: towerSubagentsFixture,
    }));
    expect(capsuleLabels()).toHaveLength(1);
    expect(capsuleLabels()[0]).toContain("后台 Agent");
    expect(capsuleLabels()[0]).not.toContain("(1/2)");

    clickCapsule(0);
    const panel = container.querySelector(".kimix-dock-panel");
    expect(panel?.textContent).toContain("后台 Agent");
    expect(panel?.textContent).toContain("1 运行中");
    expect(panel?.querySelectorAll("[role='tab']")).toHaveLength(4);
    expect(panel?.textContent).toContain("tower worker worker-a: 实现设置入口");
    expect(panel?.textContent).toContain("2分5秒");

    const agentCard = panel?.querySelector<HTMLButtonElement>('button[aria-label="查看 worker-a 详情"]');
    act(() => agentCard?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(panel?.textContent).toContain("正在核对官方 Tower 事件流");
    expect(panel?.textContent).toContain("feat/settings");

    const completedTab = Array.from(panel!.querySelectorAll<HTMLButtonElement>("[role='tab']")).find((item) => item.textContent === "已完成");
    act(() => completedTab?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(panel?.textContent).not.toContain("正在核对官方 Tower 事件流");
    expect(panel?.textContent).toContain("tower worker worker-b: 补充回归测试");
  });

  it("官方 tool 类后台任务使用后台任务文案", () => {
    render(makeProps({ bashTasks: [makeTask({ subagentType: "tool" })] }));
    expect(capsuleLabels()[0]).toContain("后台任务");
    expect(capsuleLabels()[0]).not.toContain("后台 Bash");
    clickCapsule(0);
    expect(container.querySelector(".kimix-dock-panel")?.textContent).toContain("后台任务 · 1 个任务");
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

  it("进行中的官方 Goal 显示目标胶囊并排第一，面板可暂停/取消", async () => {
    const onPauseGoal = vi.fn();
    const onCancelGoal = vi.fn();
    render(
      makeProps({
        bashTasks: [makeTask()],
        goal: { objective: "按 review 清单完成修复批次", completionCriterion: "全量测试通过", status: "active", turnsUsed: 3, tokensUsed: 12000 },
        onPauseGoal,
        onCancelGoal,
      }),
    );
    const labels = capsuleLabels();
    expect(labels).toHaveLength(2);
    expect(labels[0]).toContain("目标");
    expect(labels[0]).toContain("(进行中)");
    expect(labels[1]).toContain("后台 Bash");

    clickCapsule(0);
    const panel = container.querySelector(".kimix-dock-panel");
    expect(panel?.textContent).toContain("目标 · 进行中");
    expect(panel?.textContent).toContain("按 review 清单完成修复批次");
    expect(panel?.textContent).toContain("完成判据：全量测试通过");
    expect(panel?.textContent).toContain("3 轮");

    const pauseButton = Array.from(panel!.querySelectorAll("button")).find((el) => el.textContent?.includes("暂停"));
    act(() => {
      pauseButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onPauseGoal).toHaveBeenCalledTimes(1);

    // 等 busy 收尾（finally 微任务）后再点下一个操作，与真实用户连点间隔一致
    await act(async () => {});
    const cancelButton = Array.from(panel!.querySelectorAll("button")).find((el) => el.textContent?.includes("取消"));
    act(() => {
      cancelButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onCancelGoal).toHaveBeenCalledTimes(1);
  });

  it("终态（完成/取消）的 Goal 不渲染目标胶囊", () => {
    render(makeProps({ goal: { objective: "已完成的目标", status: "complete" } }));
    expect(container.innerHTML).toBe("");
    render(makeProps({ goal: { objective: "已取消的目标", status: "cancelled" } }));
    expect(container.innerHTML).toBe("");
  });

  it("已暂停的 Goal 提供继续按钮；Goal 消失后自动关闭面板", () => {
    const onResumeGoal = vi.fn();
    render(makeProps({ goal: { objective: "暂停中的目标", status: "paused" }, onResumeGoal }));
    clickCapsule(0);
    const panel = container.querySelector(".kimix-dock-panel");
    expect(panel?.textContent).toContain("目标 · 已暂停");
    const resumeButton = Array.from(panel!.querySelectorAll("button")).find((el) => el.textContent?.includes("继续"));
    act(() => {
      resumeButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onResumeGoal).toHaveBeenCalledTimes(1);

    render(makeProps({ goal: null }));
    expect(container.innerHTML).toBe("");
  });

  it("四类面板都提供收起到侧栏按钮", () => {
    render(
      makeProps({
        bashTasks: [makeTask()],
        subagentTasks: [makeTask({ taskId: "sub-1", subagentType: "subagent" })],
        todoItems: todoFixture,
        queueCount: 1,
        onHideBash: vi.fn(),
        onHideSubagent: vi.fn(),
        onHideTodo: vi.fn(),
        onHideQueue: vi.fn(),
      }),
    );
    for (let index = 0; index < 4; index += 1) {
      clickCapsule(index);
      expect(container.querySelector(".kimix-dock-panel button[aria-label='收起到侧栏']")).not.toBeNull();
      expect(container.querySelector(".kimix-dock-panel button[aria-label='关闭面板']")).not.toBeNull();
    }
  });
});
