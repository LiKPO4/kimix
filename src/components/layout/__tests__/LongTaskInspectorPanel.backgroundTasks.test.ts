import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LongTaskSessionMeta } from "@/types/ui";
import { LongTaskInspectorPanel, type LongTaskBackgroundTaskView } from "../LongTaskInspectorPanel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type PanelProps = ComponentProps<typeof LongTaskInspectorPanel>;

const longTaskMetaFixture: LongTaskSessionMeta = {
  taskId: "task-1",
  title: "测试长程任务",
  stage: "running",
  activeAgent: "executor",
  executorSessionId: "exec-1",
  reviewerSessionId: "review-1",
  bigPlanPath: "D:/proj/BIGPLAN.md",
  reviewQueuePath: "D:/proj/REVIEW.md",
  currentStep: 1,
  targetStep: null,
  recovery: null,
};

function makeTask(overrides: Partial<LongTaskBackgroundTaskView>): LongTaskBackgroundTaskView {
  return {
    taskId: "task-x",
    command: "",
    description: "",
    status: "running",
    pid: 1234,
    exitCode: null,
    startedAt: Date.now() - 5000,
    endedAt: null,
    transport: "server",
    runtimeSessionId: "runtime-1",
    role: "executor",
    ...overrides,
  };
}

function createPanelProps(overrides: Partial<PanelProps> = {}): PanelProps {
  return {
    panelOpen: true,
    width: 320,
    title: "会话",
    subtitle: "",
    longTaskMeta: undefined,
    longTaskDetail: null,
    longTaskDetailLoading: false,
    longTaskDetailError: null,
    parsedLongTaskDetail: null,
    pendingReviewItems: [],
    completedReviewItems: [],
    targetStepDraft: "",
    targetStepBusy: false,
    longTaskControlBusy: false,
    runningSessionId: null,
    totalLongTaskSteps: 1,
    sessionLongTasksLoading: false,
    shutdownAfterLongTaskId: null,
    sessionPlanState: { loading: false, path: null, content: "", updatedAt: null, error: null },
    sessionPlanPath: null,
    liveCurrentSession: null,
    currentProject: null,
    hiddenComposerCardEntries: [],
    composerCardSessionId: "session-1",
    visibleSessionLongTasks: [],
    backgroundTasks: [],
    backgroundTasksLoading: false,
    backgroundTasksError: null,
    bashTasks: [],
    subagentTasks: [],
    sessionDiffs: [],
    btwState: { input: "", loading: false, error: null, rounds: [] },
    btwDisabled: true,
    defaultPlanMode: false,
    officialGoal: null,
    onClose: vi.fn(),
    onPatchLongTaskMeta: vi.fn(async () => undefined),
    onApplyTargetStep: vi.fn(async () => undefined),
    onSetReviewItemChecked: vi.fn(),
    onCopyNextLongTaskPrompt: vi.fn(async () => undefined),
    onRefreshLongTaskDetail: vi.fn(),
    onRefreshSessionPlan: vi.fn(),
    onRefreshSessionLongTasks: vi.fn(),
    onRefreshBackgroundTasks: vi.fn(),
    onCopyBackgroundTaskOutput: vi.fn(async () => undefined),
    onStopBackgroundTask: vi.fn(async () => undefined),
    onSetTargetStepDraft: vi.fn(),
    onSetShutdownAfterLongTaskId: vi.fn(),
    onSetComposerCardHidden: vi.fn(),
    onSetBtwInput: vi.fn(),
    onAskBtw: vi.fn(async () => undefined),
    onClearBtw: vi.fn(),
    onRefreshOfficialGoal: vi.fn(async () => undefined),
    onCreateOfficialGoal: vi.fn(async () => undefined),
    onPauseOfficialGoal: vi.fn(async () => undefined),
    onResumeOfficialGoal: vi.fn(async () => undefined),
    onCancelOfficialGoal: vi.fn(async () => undefined),
    showToast: vi.fn(),
    copyToClipboard: vi.fn(async () => undefined),
    ...overrides,
  };
}

const mountedRoots: Root[] = [];

async function renderPanel(props: PanelProps) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  await act(async () => root.render(createElement(LongTaskInspectorPanel, props)));
  return container;
}

function cardSection(container: HTMLElement, cardId: string) {
  return container.querySelector(`[data-right-sidebar-card-id="${cardId}"]`);
}

beforeEach(() => {
  // 面板挂载即触发健康检查/模型目录等 IPC，全部 mock 为失败即可（组件内部均有兜底）
  (window as unknown as { api: unknown }).api = new Proxy({}, {
    get: () => async () => ({ success: false as const, error: "mock" }),
  });
});

afterEach(async () => {
  for (const root of mountedRoots.splice(0)) {
    await act(async () => root.unmount());
  }
  document.body.innerHTML = "";
  Reflect.deleteProperty(window, "api");
  vi.restoreAllMocks();
});

describe("LongTaskInspectorPanel 会话级后台任务卡", () => {
  it("普通会话模式渲染「后台 Bash」「子 Agent」两个任务卡并按 kind 分流", async () => {
    const bashTask = makeTask({ taskId: "bash-1", description: "拉取日志", status: "running", subagentType: "bash" });
    const subTask = makeTask({
      taskId: "sub-1",
      description: "调研竞品",
      status: "completed",
      subagentType: "subagent",
      startedAt: 100000,
      endedAt: 112000,
      exitCode: 0,
    });
    const container = await renderPanel(createPanelProps({
      backgroundTasks: [bashTask, subTask],
      bashTasks: [bashTask],
      subagentTasks: [subTask],
    }));

    const bashCard = cardSection(container, "background");
    const subagentCard = cardSection(container, "subagentTasks");
    expect(bashCard).not.toBeNull();
    expect(subagentCard).not.toBeNull();
    expect(bashCard?.textContent).toContain("后台 Bash");
    expect(bashCard?.textContent).toContain("拉取日志");
    expect(bashCard?.textContent).toContain("运行中");
    expect(bashCard?.textContent).toContain("停止");
    expect(bashCard?.textContent).not.toContain("调研竞品");
    expect(subagentCard?.textContent).toContain("子 Agent");
    expect(subagentCard?.textContent).toContain("调研竞品");
    expect(subagentCard?.textContent).toContain("subagent");
    expect(subagentCard?.textContent).toContain("已完成 · 12 s");
    expect(subagentCard?.textContent).toContain("输出");
    expect(subagentCard?.textContent).not.toContain("停止");
    // 模型路由配置卡改名，避免与「子 Agent」任务卡同名
    expect(cardSection(container, "subagent")?.textContent).toContain("子 Agent / Swarm 模型");
  });

  it("普通会话模式没有任务时自动隐藏两个任务卡", async () => {
    const container = await renderPanel(createPanelProps());
    // 空态自动隐藏：无后台 bash / 子代理任务时两卡均不渲染
    expect(cardSection(container, "background")).toBeNull();
    expect(cardSection(container, "subagentTasks")).toBeNull();
  });

  it("长程任务模式保持「Kimi 后台任务」卡现状（不拆分、不渲染新卡）", async () => {
    const bashTask = makeTask({ taskId: "bash-1", description: "编译项目", status: "running", subagentType: "bash" });
    const subTask = makeTask({ taskId: "sub-1", description: "审查子任务", status: "running", subagentType: "subagent" });
    const container = await renderPanel(createPanelProps({
      longTaskMeta: longTaskMetaFixture,
      backgroundTasks: [bashTask, subTask],
      bashTasks: [bashTask],
      subagentTasks: [subTask],
    }));

    const backgroundCard = cardSection(container, "background");
    expect(backgroundCard?.textContent).toContain("Kimi 后台任务");
    expect(backgroundCard?.textContent).toContain("编译项目");
    expect(backgroundCard?.textContent).toContain("审查子任务");
    expect(backgroundCard?.textContent).toContain("执行 agent");
    expect(cardSection(container, "subagentTasks")).toBeNull();
  });
});
