import { useEffect, useRef, useState, type ReactNode } from "react";
import { Eye, List, ListChecks, ListOrdered, LogOut, PanelRightClose, Pause, PenLine, Play, RadioTower, RefreshCw, SquareTerminal, Target, Users, X } from "lucide-react";
import type { KimiCodeBackgroundTaskInfo } from "@electron/types/ipc";
import type { OfficialGoalSnapshot, TodoItem } from "@/types/ui";
import { isTerminalGoalStatus } from "@/utils/officialGoalState";
import { backgroundTaskDurationLabel, backgroundTaskKindLabel, backgroundTaskSummary, backgroundTaskTone, isBackgroundTaskTerminalStatus } from "@/utils/backgroundTasks";
import { TodoListItems, todoCounts } from "./TodoPanel";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { towerStatusLabel, type TowerSnapshotView } from "@/utils/tower";

/**
 * 输入区 dock 胶囊行（对齐官方 kimi-web ChatDock 的 dock work chips）：
 * 「目标」「计划」「后台 Bash/后台任务」「子 Agent」「Tower」「当前进度」及「队列」小胶囊，
 * 点击向上展开半透明面板；单面板互斥、点外部关闭、数据清空自动关闭。
 * 替代原 TodoPanel 卡片与排队消息浮动面板（重量级实心卡，遮挡聊天内容）。
 */

export type ComposerDockPanelId = "bash" | "subagent" | "tower" | "todo" | "queue" | "goal" | "plan";

type ComposerDockBarProps = {
  bashTasks: KimiCodeBackgroundTaskInfo[];
  subagentTasks: KimiCodeBackgroundTaskInfo[];
  /** 已被「收起到侧栏」时由调用方传空数组。 */
  todoItems: TodoItem[];
  /** 已被「收起到侧栏」时由调用方传 0。 */
  queueCount: number;
  /** 排队消息列表（拖拽排序/引导/删除交互复杂，由 Composer 组装后注入）。 */
  queueBody: ReactNode;
  /** 官方 Goal 快照；null 或终态（完成/取消）时不显示目标胶囊。 */
  goal?: OfficialGoalSnapshot | null;
  /** Plan 模式开关；开启或已有计划内容时显示计划胶囊（对齐官方 dock 的 plan chip）。 */
  planMode?: boolean;
  planContent?: string | null;
  planPath?: string | null;
  towerMode?: boolean;
  towerPending?: boolean;
  towerSnapshot?: TowerSnapshotView | null;
  towerBusy?: boolean;
  onPauseGoal?: () => void | Promise<void>;
  onResumeGoal?: () => void | Promise<void>;
  onCancelGoal?: () => void | Promise<void>;
  onRefreshGoal?: () => void | Promise<void>;
  onRefreshTower?: () => void | Promise<void>;
  onOpenTowerInspector?: () => void;
  onExitTower?: () => void | Promise<void>;
  onHideBash?: () => void;
  onHideSubagent?: () => void;
  onHideTodo?: () => void;
  onHideQueue?: () => void;
};

type TowerAgentFilter = "recent" | "active" | "completed" | "all";

const TOWER_AGENT_FILTERS: Array<{ id: TowerAgentFilter; label: string }> = [
  { id: "recent", label: "最近" },
  { id: "active", label: "进行中" },
  { id: "completed", label: "已完成" },
  { id: "all", label: "全部" },
];

function towerAgentIsCompleted(status?: string) {
  return status === "completed" || status === "merged" || status === "abandoned";
}

function TowerPanelBody({ towerMode, towerPending, snapshot, busy, onRefresh, onOpenInspector, onExit }: {
  towerMode: boolean;
  towerPending: boolean;
  snapshot?: TowerSnapshotView | null;
  busy?: boolean;
  onRefresh?: () => void | Promise<void>;
  onOpenInspector?: () => void;
  onExit?: () => void | Promise<void>;
}) {
  const [filter, setFilter] = useState<TowerAgentFilter>("recent");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const agents = snapshot?.agents ?? [];
  const activeCount = agents.filter((agent) => !towerAgentIsCompleted(agent.status)).length;
  const orderedAgents = [...agents].sort((left, right) => (right.spawnedAt ?? "").localeCompare(left.spawnedAt ?? ""));
  const visibleAgents = filter === "recent"
    ? orderedAgents.slice(0, 6)
    : filter === "active"
      ? orderedAgents.filter((agent) => !towerAgentIsCompleted(agent.status))
      : filter === "completed"
        ? orderedAgents.filter((agent) => towerAgentIsCompleted(agent.status))
        : orderedAgents;
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const selectedMission = selectedAgent?.mission
    ? snapshot?.missions.find((mission) => mission.id === selectedAgent.mission)
    : undefined;
  return (
    <div className="flex flex-col" style={{ gap: 12, padding: "8px 16px 10px" }}>
      {towerPending ? (
        <div className="text-[13px] leading-6 text-[var(--kimix-panel-text-muted)]">将在创建官方会话后、发送首条目标前开启 Tower。</div>
      ) : snapshot ? (
        <>
          <div className="flex flex-wrap items-center justify-between" style={{ gap: 10 }}>
            <div className="flex items-center text-[13px] leading-5 text-[var(--kimix-panel-text)]" style={{ gap: 7 }}>
              <Users size={14} />
              <span>后台 Agent</span>
              <span className="text-[var(--kimix-panel-text-muted)]">{activeCount} 运行中</span>
            </div>
            <div className="flex flex-wrap items-center" style={{ gap: 4 }} role="tablist" aria-label="筛选 Tower Agent">
              {TOWER_AGENT_FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === item.id}
                  onClick={() => setFilter(item.id)}
                  className={`kimix-icon-text-button is-compact text-[12px] ${filter === item.id ? "kimix-state-button" : "text-text-muted"}`}
                  style={{ minHeight: 32, height: 32, paddingLeft: 12, paddingRight: 12 }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(168px, 1fr))", gap: 8 }}>
            {visibleAgents.length > 0 ? visibleAgents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                aria-label={`查看 ${agent.name ?? agent.id} 详情`}
                aria-pressed={selectedAgentId === agent.id}
                onClick={() => setSelectedAgentId((current) => current === agent.id ? null : agent.id)}
                className={`kimix-style-exempt min-w-0 rounded-lg text-left ${selectedAgentId === agent.id ? "bg-[var(--ui-selection-background)]" : "bg-[var(--kimix-panel-soft-bg)] hover:bg-surface-hover"}`}
                style={{ minHeight: 72, padding: "10px 12px" }}
              >
                <div className="truncate text-[13px] font-medium leading-5 text-[var(--kimix-panel-text)]">{String(Math.max(agents.findIndex((item) => item.id === agent.id) + 1, 1)).padStart(2, "0")} {agent.name ?? agent.id}</div>
                <div className="flex min-w-0 items-center justify-between text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ gap: 8, marginTop: 6 }}>
                  <span className={agent.status === "blocked" ? "text-accent-danger" : towerAgentIsCompleted(agent.status) ? "text-accent-success" : "text-accent-primary"}>{towerStatusLabel(agent.status ?? "active")}</span>
                  <span className="truncate">{agent.mission ?? agent.kind}</span>
                </div>
              </button>
            )) : <div className="text-[13px] leading-6 text-[var(--kimix-panel-text-muted)]">当前筛选下没有 Agent。</div>}
          </div>
          {selectedAgent && (
            <div className="grid border-t border-[var(--kimix-panel-divider)] text-[12.5px] leading-5" style={{ gridTemplateColumns: "88px minmax(0, 1fr)", rowGap: 6, columnGap: 12, paddingTop: 10 }} aria-live="polite">
              <span className="text-[var(--kimix-panel-text-muted)]">Agent</span><span className="truncate text-[var(--kimix-panel-text)]">{selectedAgent.name ?? selectedAgent.id}</span>
              <span className="text-[var(--kimix-panel-text-muted)]">任务</span><span className="truncate text-[var(--kimix-panel-text)]">{selectedMission?.title ?? selectedAgent.mission ?? "未分配"}</span>
              <span className="text-[var(--kimix-panel-text-muted)]">分支</span><span className="truncate text-[var(--kimix-panel-text)]">{selectedAgent.branch ?? selectedMission?.branch ?? "未创建"}</span>
              <span className="text-[var(--kimix-panel-text-muted)]">会话</span><span className="truncate text-[var(--kimix-panel-text)]">{selectedAgent.sessionId ?? "未记录"}</span>
            </div>
          )}
        </>
      ) : (
        <div className="text-[13px] leading-6 text-[var(--kimix-panel-text-muted)]">正在同步官方 Tower 状态...</div>
      )}
      <div className="flex flex-wrap items-center border-t border-[var(--kimix-panel-divider)]" style={{ gap: 8, paddingTop: 10 }}>
        <button type="button" disabled={busy || !towerMode} onClick={() => void onRefresh?.()} className="kimix-icon-text-button text-text-muted disabled:cursor-not-allowed disabled:opacity-55">
          <RefreshCw size={13} className={busy ? "animate-spin" : ""} />刷新
        </button>
        <button type="button" disabled={!onOpenInspector} onClick={onOpenInspector} className="kimix-icon-text-button text-text-muted disabled:cursor-not-allowed disabled:opacity-55">
          <Eye size={13} />完整详情
        </button>
        <div style={{ flex: 1 }} />
        {(towerMode || towerPending) && (
          <button type="button" disabled={busy} onClick={() => void onExit?.()} className="kimix-icon-text-button text-text-muted disabled:cursor-not-allowed disabled:opacity-55">
            <LogOut size={13} />{towerPending ? "取消待开启" : "退出 Tower"}
          </button>
        )}
      </div>
    </div>
  );
}

const TONE_CLASS: Record<string, string> = {
  success: "text-accent-success",
  danger: "text-accent-red",
  warning: "text-accent-warning",
  primary: "text-accent-primary",
};

function BackgroundTaskListItems({ tasks }: { tasks: KimiCodeBackgroundTaskInfo[] }) {
  return (
    <div className="flex flex-col" style={{ gap: 2 }}>
      {tasks.map((task) => {
        const tone = backgroundTaskTone(task);
        const duration = backgroundTaskDurationLabel(task);
        return (
          <div
            key={task.taskId}
            className="flex min-h-[40px] min-w-0 items-center text-[13.5px] leading-5"
            style={{ gap: 12, paddingLeft: 14, paddingRight: 14 }}
          >
            <span className={`flex h-2 w-2 shrink-0 rounded-full bg-current ${TONE_CLASS[tone] ?? TONE_CLASS.primary}`} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[var(--kimix-panel-text)]">{task.description || task.command || "后台任务"}</div>
              <div className="truncate text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]">{backgroundTaskSummary(task)}</div>
            </div>
            <span className="shrink-0 text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]">
              {backgroundTaskKindLabel(task)}{duration ? ` · ${duration}` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function goalCapsuleStatusLabel(status: string) {
  const normalized = status.trim().toLowerCase();
  if (normalized === "active") return "进行中";
  if (normalized === "paused") return "已暂停";
  if (normalized === "blocked") return "受阻";
  return status;
}

function GoalPanelBody({ goal, onPauseGoal, onResumeGoal, onCancelGoal, onRefreshGoal }: {
  goal: OfficialGoalSnapshot;
  onPauseGoal?: () => void | Promise<void>;
  onResumeGoal?: () => void | Promise<void>;
  onCancelGoal?: () => void | Promise<void>;
  onRefreshGoal?: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = (key: string, handler?: () => void | Promise<void>) => {
    if (!handler || busy) return;
    setBusy(key);
    // 同步调用 handler（点击反馈即时）；仅用 Promise 包装返回值以便异步 busy 收尾。
    void Promise.resolve(handler()).finally(() => setBusy(null));
  };
  const status = goal.status.trim().toLowerCase();
  const pausable = status === "active";
  const resumable = status === "paused" || status === "blocked";
  const meta = [`状态：${goalCapsuleStatusLabel(goal.status)}`];
  if (typeof goal.turnsUsed === "number" && goal.turnsUsed > 0) meta.push(`${goal.turnsUsed} 轮`);
  if (typeof goal.tokensUsed === "number" && goal.tokensUsed > 0) meta.push(`${goal.tokensUsed} tokens`);
  return (
    <div className="flex flex-col" style={{ gap: 10, paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 10 }}>
      <div className="text-[13px] leading-6 text-[var(--kimix-panel-text)]" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{goal.objective}</div>
      {goal.completionCriterion ? (
        <div className="text-[12.5px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>完成判据：{goal.completionCriterion}</div>
      ) : null}
      <div className="text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]">{meta.join(" · ")}</div>
      <div className="flex items-center" style={{ gap: 8, marginTop: 2 }}>
        {pausable && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run("pause", onPauseGoal)}
            className="kimix-icon-text-button text-accent-primary disabled:cursor-not-allowed disabled:opacity-55"
          >
            <Pause size={13} />
            暂停
          </button>
        )}
        {resumable && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run("resume", onResumeGoal)}
            className="kimix-icon-text-button text-accent-primary disabled:cursor-not-allowed disabled:opacity-55"
          >
            <Play size={13} />
            继续
          </button>
        )}
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => run("cancel", onCancelGoal)}
          className="kimix-icon-text-button text-accent-red disabled:cursor-not-allowed disabled:opacity-55"
        >
          <X size={13} />
          取消
        </button>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => run("refresh", onRefreshGoal)}
          className="kimix-muted-action flex h-7 w-7 shrink-0 items-center justify-center rounded-lg disabled:cursor-not-allowed disabled:opacity-55"
          title="刷新目标状态"
          aria-label="刷新目标状态"
        >
          <RefreshCw size={13} className={busy === "refresh" ? "animate-spin" : ""} />
        </button>
      </div>
    </div>
  );
}

export function ComposerDockBar({
  bashTasks,
  subagentTasks,
  todoItems,
  queueCount,
  queueBody,
  goal,
  planMode,
  planContent,
  planPath,
  towerMode = false,
  towerPending = false,
  towerSnapshot,
  towerBusy,
  onPauseGoal,
  onResumeGoal,
  onCancelGoal,
  onRefreshGoal,
  onRefreshTower,
  onOpenTowerInspector,
  onExitTower,
  onHideBash,
  onHideSubagent,
  onHideTodo,
  onHideQueue,
}: ComposerDockBarProps) {
  const [openPanel, setOpenPanel] = useState<ComposerDockPanelId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const { doneCount } = todoCounts(todoItems);
  const runningOf = (tasks: KimiCodeBackgroundTaskInfo[]) => tasks.filter((task) => !isBackgroundTaskTerminalStatus(task.status)).length;
  const bashLabel = bashTasks.some((task) => task.subagentType === "tool") ? "后台任务" : "后台 Bash";
  const capsules: { id: ComposerDockPanelId; label: string; count: string; running: number; icon: ReactNode }[] = [];
  const goalVisible = Boolean(goal && !isTerminalGoalStatus(goal.status));
  const planVisible = Boolean(planMode) || Boolean(planPath) || Boolean(planContent && planContent.trim());
  const towerVisible = towerMode || towerPending;
  if (goalVisible && goal) capsules.push({ id: "goal", label: "目标", count: goalCapsuleStatusLabel(goal.status), running: 0, icon: <Target size={13} /> });
  // 对齐官方 0.36 dock：planMode 或已捕获计划文件时显示计划胶囊。
  if (planVisible) capsules.push({ id: "plan", label: "计划", count: "", running: 0, icon: <PenLine size={13} /> });
  if (bashTasks.length > 0) capsules.push({ id: "bash", label: bashLabel, count: String(bashTasks.length), running: runningOf(bashTasks), icon: <SquareTerminal size={13} /> });
  if (subagentTasks.length > 0) capsules.push({ id: "subagent", label: "子 Agent", count: String(subagentTasks.length), running: runningOf(subagentTasks), icon: <Users size={13} /> });
  if (towerVisible) capsules.push({
    id: "tower",
    label: "Tower Agent",
    count: towerPending ? "待开启" : towerSnapshot && towerSnapshot.totalCount > 0 ? `${towerSnapshot.mergedCount}/${towerSnapshot.totalCount}` : "运行中",
    running: 0,
    icon: <RadioTower size={13} />,
  });
  // 对齐官方文案：待办胶囊叫「当前进度 done/total」，全部完成时换 check-list 图标。
  if (todoItems.length > 0) capsules.push({ id: "todo", label: "当前进度", count: `${doneCount}/${todoItems.length}`, running: 0, icon: doneCount >= todoItems.length ? <ListChecks size={13} /> : <List size={13} /> });
  if (queueCount > 0) capsules.push({ id: "queue", label: "队列", count: String(queueCount), running: 0, icon: <ListOrdered size={13} /> });

  // 数据清空自动关闭对应面板（官方 watch(hasDockWork) 同款语义）。
  useEffect(() => {
    if (openPanel === "bash" && bashTasks.length === 0) setOpenPanel(null);
    if (openPanel === "subagent" && subagentTasks.length === 0) setOpenPanel(null);
    if (openPanel === "tower" && !towerVisible) setOpenPanel(null);
    if (openPanel === "todo" && todoItems.length === 0) setOpenPanel(null);
    if (openPanel === "queue" && queueCount === 0) setOpenPanel(null);
    if (openPanel === "goal" && !goalVisible) setOpenPanel(null);
    if (openPanel === "plan" && !planVisible) setOpenPanel(null);
  }, [openPanel, bashTasks.length, subagentTasks.length, todoItems.length, queueCount, goalVisible, planVisible, towerVisible]);

  // 点面板/胶囊行以外任意处关闭（capture 阶段，面板内部交互不触发）。
  useEffect(() => {
    if (!openPanel) return;
    const handlePointerDown = (event: MouseEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) {
        setOpenPanel(null);
      }
    };
    document.addEventListener("mousedown", handlePointerDown, true);
    return () => document.removeEventListener("mousedown", handlePointerDown, true);
  }, [openPanel]);

  if (capsules.length === 0) return null;

  const panelConfig: Record<ComposerDockPanelId, { title: string; body: ReactNode; onHide?: () => void }> = {
    bash: {
      title: `${bashLabel} · ${bashTasks.length} 个任务`,
      body: <BackgroundTaskListItems tasks={bashTasks} />,
      onHide: onHideBash,
    },
    subagent: {
      title: `子 Agent · ${subagentTasks.length} 个任务`,
      body: <BackgroundTaskListItems tasks={subagentTasks} />,
      onHide: onHideSubagent,
    },
    tower: {
      title: towerPending ? "Tower · 待首轮开启" : `Tower · ${towerSnapshot?.base ?? "官方运行时"}`,
      body: (
        <TowerPanelBody
          towerMode={towerMode}
          towerPending={towerPending}
          snapshot={towerSnapshot}
          busy={towerBusy}
          onRefresh={onRefreshTower}
          onOpenInspector={onOpenTowerInspector}
          onExit={onExitTower}
        />
      ),
    },
    todo: {
      title: `待办 · ${doneCount}/${todoItems.length} 已完成`,
      body: <TodoListItems items={todoItems} />,
      onHide: onHideTodo,
    },
    queue: {
      title: `队列 · ${queueCount} 条消息正在排队`,
      body: queueBody,
      onHide: onHideQueue,
    },
    plan: {
      title: "计划",
      body: (
        <div className="flex flex-col" style={{ gap: 8, paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 10 }}>
          {planPath ? (
            <div className="truncate text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]" title={planPath}>{planPath}</div>
          ) : null}
          {planContent && planContent.trim() ? (
            <div className="text-[13px] leading-6 text-[var(--kimix-panel-text)]" style={{ wordBreak: "break-word" }}>
              <MarkdownRenderer content={planContent} wrapLongLines />
            </div>
          ) : (
            <div className="text-[13px] leading-6 text-[var(--kimix-panel-text-muted)]">Plan 模式已开启，等待生成计划文件。</div>
          )}
        </div>
      ),
    },
    goal: {
      title: `目标 · ${goal ? goalCapsuleStatusLabel(goal.status) : ""}`,
      body: goal ? (
        <GoalPanelBody
          goal={goal}
          onPauseGoal={onPauseGoal}
          onResumeGoal={onResumeGoal}
          onCancelGoal={onCancelGoal}
          onRefreshGoal={onRefreshGoal}
        />
      ) : null,
    },
  };
  const active = openPanel ? panelConfig[openPanel] : null;

  return (
    // 脱离文档流悬浮在聊天内容之上：不占 footer 高度，不形成实色背景带遮挡消息。
    <div ref={rootRef} style={{ position: "absolute", left: 0, right: 0, bottom: "100%", marginBottom: 0, zIndex: 20 }}>
      {active && (
        <div
          className="kimix-dock-panel flex flex-col overflow-hidden"
          // 面板 bottom:100% 向上展开；矮窗口（视口 <500px）时原 min(300px, 42vh)
          // 可能超出锚点上方可用空间，顶部溢出被裁。改用视口约束：
          // 预留 ≈ 胶囊行 40 + 输入区 140 + footer 34 + 面板间距 8 ≈ 220px，
          // 超高部分由面板内部 overflow-y-auto 滚动。
          style={{ position: "absolute", left: 0, right: 0, bottom: "100%", marginBottom: 8, maxHeight: "min(342px, calc(100vh - 220px))", zIndex: 30 }}
          role="dialog"
          aria-label={active.title}
        >
          <div
            className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--kimix-panel-divider)] text-[13px] text-[var(--kimix-panel-text-secondary)]"
            style={{ gap: 12, paddingLeft: 16, paddingRight: 12 }}
          >
            <span className="min-w-0 truncate">{active.title}</span>
            <div className="flex shrink-0 items-center" style={{ gap: 4 }}>
              {active.onHide && (
                <button
                  type="button"
                  onClick={() => {
                    active.onHide?.();
                    setOpenPanel(null);
                  }}
                  className="kimix-muted-action flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                  title="收起到侧栏"
                  aria-label="收起到侧栏"
                >
                  <PanelRightClose size={13} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpenPanel(null)}
                className="kimix-muted-action flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                title="关闭面板"
                aria-label="关闭面板"
              >
                <X size={13} />
              </button>
            </div>
          </div>
          <div className="overflow-y-auto" style={{ paddingTop: 6, paddingBottom: 6 }}>
            {active.body}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center" style={{ gap: 6 }}>
        {capsules.map((capsule) => (
          <button
            key={capsule.id}
            type="button"
            className="kimix-dock-capsule"
            aria-expanded={openPanel === capsule.id}
            onClick={() => setOpenPanel((current) => (current === capsule.id ? null : capsule.id))}
          >
            {capsule.icon}
            <span>{capsule.label}</span>
            {capsule.running > 0 && (
              <span className="flex items-center text-accent-primary" style={{ gap: 4 }}>
                <RefreshCw size={11} className="animate-spin" />
                {capsule.running}
              </span>
            )}
            {capsule.count && <span className="kimix-dock-capsule-count">({capsule.count})</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
