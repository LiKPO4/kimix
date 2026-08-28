import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Clock3, List, ListChecks, ListOrdered, PanelRightClose, Pause, PenLine, Play, RadioTower, RefreshCw, SquareTerminal, Target, Users, X } from "lucide-react";
import type { KimiCodeBackgroundTaskInfo } from "@electron/types/ipc";
import type { OfficialGoalSnapshot, TimelineEvent, TodoItem } from "@/types/ui";
import { isTerminalGoalStatus } from "@/utils/officialGoalState";
import { backgroundTaskDurationLabel, backgroundTaskKindLabel, backgroundTaskSummary, backgroundTaskTone, isBackgroundTaskTerminalStatus } from "@/utils/backgroundTasks";
import { TodoListItems, todoCounts } from "./TodoPanel";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { KimiWebSubagentDetails } from "./MessageBubble";
import { towerStatusLabel, type TowerAgentView, type TowerMissionView, type TowerSnapshotView } from "@/utils/tower";

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
  towerTasks?: KimiCodeBackgroundTaskInfo[];
  towerSubagents?: Extract<TimelineEvent, { type: "subagent" }>[];
  towerBusy?: boolean;
  onPauseGoal?: () => void | Promise<void>;
  onResumeGoal?: () => void | Promise<void>;
  onCancelGoal?: () => void | Promise<void>;
  onRefreshGoal?: () => void | Promise<void>;
  onExitTower?: () => void | Promise<void>;
  onHideBash?: () => void;
  onHideSubagent?: () => void;
  onHideTodo?: () => void;
  onHideQueue?: () => void;
};

type TowerAgentFilter = "recent" | "active" | "completed" | "all";
type TowerSubagentEvent = Extract<TimelineEvent, { type: "subagent" }>;

type TowerAgentRecord = {
  agent: TowerAgentView;
  mission?: TowerMissionView;
  task?: KimiCodeBackgroundTaskInfo;
  subagent?: TowerSubagentEvent;
  status: string;
  startedAt: number;
  endedAt: number | null;
};

const TOWER_AGENT_FILTERS: Array<{ id: TowerAgentFilter; label: string }> = [
  { id: "recent", label: "最近" },
  { id: "active", label: "进行中" },
  { id: "completed", label: "已完成" },
  { id: "all", label: "全部" },
];

const TOWER_AGENT_TERMINAL_STATUSES = new Set([
  "completed", "complete", "finished", "success", "done", "terminated", "merged", "abandoned", "failed", "error", "timed_out", "killed", "lost", "cancelled", "stopped", "exited",
]);

function towerAgentIsCompleted(status?: string) {
  return Boolean(status && TOWER_AGENT_TERMINAL_STATUSES.has(status.trim().toLowerCase()));
}

function towerAgentStatusLabel(status: string) {
  const normalized = status.trim().toLowerCase();
  if (["completed", "complete", "finished", "success", "done", "merged"].includes(normalized)) return "完成";
  if (["running", "active"].includes(normalized)) return "运行中";
  if (normalized === "queued") return "排队中";
  if (normalized === "suspended") return "已暂停";
  if (normalized === "blocked") return "受阻";
  if (normalized === "awaiting_approval") return "待确认";
  if (["failed", "error"].includes(normalized)) return "失败";
  if (["timed_out", "lost"].includes(normalized)) return "异常结束";
  if (["killed", "cancelled", "stopped", "exited", "terminated", "abandoned"].includes(normalized)) return "已停止";
  return towerStatusLabel(normalized);
}

function towerAgentDurationLabel(startedAt: number, endedAt: number | null, now: number) {
  if (!startedAt) return null;
  const totalSeconds = Math.max(0, Math.round(((endedAt ?? now) - startedAt) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}时${minutes}分`;
  if (minutes > 0) return `${minutes}分${seconds}秒`;
  return `${seconds}秒`;
}

function towerAgentRecord(
  agent: TowerAgentView,
  snapshot: TowerSnapshotView,
  tasks: KimiCodeBackgroundTaskInfo[],
  subagents: TowerSubagentEvent[],
): TowerAgentRecord {
  const task = tasks.find((candidate) => candidate.agentId === agent.id);
  const subagent = subagents.find((candidate) => candidate.agentId === agent.id);
  const mission = agent.mission ? snapshot.missions.find((candidate) => candidate.id === agent.mission) : undefined;
  const statusCandidates = [task?.status, subagent?.status, agent.status, mission?.status]
    .filter((candidate): candidate is string => Boolean(candidate?.trim()));
  // 任务列表可能短暂滞后于官方 Tower roster/事件；明确终态优先，避免已结束 worker 被显示为运行中。
  const status = statusCandidates.find((candidate) => towerAgentIsCompleted(candidate))
    ?? statusCandidates[0]
    ?? "active";
  const subagentEndedAt = towerAgentIsCompleted(status)
    ? subagent?.events.at(-1)?.timestamp ?? subagent?.timestamp ?? null
    : null;
  return {
    agent,
    mission,
    task,
    subagent,
    status,
    startedAt: task?.startedAt ?? (Date.parse(agent.spawnedAt ?? "") || 0),
    endedAt: task?.endedAt ?? subagentEndedAt,
  };
}

function TowerPanelBody({ towerPending, snapshot, tasks, subagents, busy, onExit }: {
  towerPending: boolean;
  snapshot?: TowerSnapshotView | null;
  tasks: KimiCodeBackgroundTaskInfo[];
  subagents: TowerSubagentEvent[];
  busy?: boolean;
  onExit?: () => void | Promise<void>;
}) {
  const [filter, setFilter] = useState<TowerAgentFilter>("recent");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const records = snapshot ? snapshot.agents.map((agent) => towerAgentRecord(agent, snapshot, tasks, subagents)) : [];
  const activeCount = records.filter((record) => !towerAgentIsCompleted(record.status)).length;
  const orderedAgents = [...records].sort((left, right) => (
    (right.endedAt ?? right.startedAt) - (left.endedAt ?? left.startedAt)
  ));
  const recentCompletedAgents = orderedAgents.filter((record) => towerAgentIsCompleted(record.status)).slice(0, 6);
  const recentAgents = [
    ...orderedAgents.filter((record) => !towerAgentIsCompleted(record.status)),
    ...recentCompletedAgents,
  ];
  const visibleAgents = filter === "recent"
    ? recentAgents
    : filter === "active"
      ? orderedAgents.filter((record) => !towerAgentIsCompleted(record.status))
      : filter === "completed"
        ? orderedAgents.filter((record) => towerAgentIsCompleted(record.status))
        : orderedAgents;
  const selectedRecord = records.find((record) => record.agent.id === selectedAgentId);

  useEffect(() => {
    if (activeCount === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeCount]);

  return (
    <div className="flex flex-col" style={{ gap: 14, minHeight: 230, padding: "10px 16px 12px" }}>
      {towerPending ? (
        <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 16, padding: "10px 0" }}>
          <div>
            <div className="text-[13px] font-medium leading-5 text-[var(--kimix-panel-text)]">Tower 待开启</div>
            <div className="text-[12.5px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ marginTop: 6 }}>将在创建官方会话后、发送首条目标前开启。</div>
          </div>
          <button type="button" disabled={busy} onClick={() => void onExit?.()} className="kimix-icon-text-button text-text-muted disabled:cursor-not-allowed disabled:opacity-55">
            取消
          </button>
        </div>
      ) : snapshot ? (
        <>
          <div className="flex flex-wrap items-center justify-between" style={{ gap: 10 }}>
            <div className="flex items-center text-[13px] leading-5 text-[var(--kimix-panel-text)]" style={{ gap: 7 }}>
              <Users size={14} />
              <span>后台 Agent</span>
              <span className="text-[var(--kimix-panel-text-muted)]">{activeCount} 运行中</span>
            </div>
            <div className="flex flex-wrap items-center" style={{ gap: 4 }} role="tablist" aria-label="筛选后台 Agent">
              {TOWER_AGENT_FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === item.id}
                  onClick={() => {
                    setFilter(item.id);
                    setSelectedAgentId(null);
                  }}
                  className={`kimix-icon-text-button is-compact text-[12px] ${filter === item.id ? "kimix-state-button" : "text-text-muted"}`}
                  style={{
                    minHeight: 32,
                    height: 32,
                    paddingLeft: 12,
                    paddingRight: 12,
                    borderRadius: "var(--ui-role-navigation-item-radius, var(--radius-sm))",
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
            {visibleAgents.length > 0 ? visibleAgents.map((record) => {
              const { agent, mission, task, status, startedAt, endedAt } = record;
              const title = task?.description || mission?.title || agent.name || agent.id;
              const duration = towerAgentDurationLabel(startedAt, endedAt, now);
              const terminal = towerAgentIsCompleted(status);
              return (
              <button
                key={agent.id}
                type="button"
                aria-label={`查看 ${agent.name ?? agent.id} 详情`}
                aria-pressed={selectedAgentId === agent.id}
                onClick={() => setSelectedAgentId((current) => current === agent.id ? null : agent.id)}
                className={`kimix-style-exempt min-w-0 rounded-lg text-left ${selectedAgentId === agent.id ? "bg-[var(--ui-selection-background)]" : "bg-[var(--kimix-panel-soft-bg)] hover:bg-surface-hover"}`}
                style={{ minHeight: 72, padding: "10px 16px" }}
              >
                <div className="truncate text-[13px] font-medium leading-5 text-[var(--kimix-panel-text)]" title={title}>{String(Math.max((snapshot?.agents ?? []).findIndex((item) => item.id === agent.id) + 1, 1)).padStart(2, "0")} {title}</div>
                <div className="flex min-w-0 items-center justify-between text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ gap: 8, marginTop: 6 }}>
                  <span className={`flex min-w-0 items-center ${status === "blocked" || status === "failed" || status === "error" ? "text-accent-danger" : terminal ? "text-accent-success" : "text-accent-primary"}`} style={{ gap: 5 }}>
                    {terminal ? <CheckCircle2 size={12} /> : <span className="h-2 w-2 shrink-0 rounded-full bg-current" />}
                    {towerAgentStatusLabel(status)}
                  </span>
                  {duration && <span className="flex shrink-0 items-center" style={{ gap: 5 }}><Clock3 size={12} />{duration}</span>}
                </div>
              </button>
              );
            }) : <div className="text-[13px] leading-6 text-[var(--kimix-panel-text-muted)]">当前筛选下没有 Agent。</div>}
          </div>
          {selectedRecord && (
            <div className="rounded-lg bg-[var(--kimix-panel-soft-bg)]" style={{ padding: "12px 16px" }} aria-live="polite">
              <div className="grid text-[12.5px] leading-5" style={{ gridTemplateColumns: "72px minmax(0, 1fr)", rowGap: 6, columnGap: 12 }}>
                <span className="text-[var(--kimix-panel-text-muted)]">Agent</span><span className="truncate text-[var(--kimix-panel-text)]">{selectedRecord.agent.name ?? selectedRecord.agent.id}</span>
                <span className="text-[var(--kimix-panel-text-muted)]">任务</span><span className="truncate text-[var(--kimix-panel-text)]">{selectedRecord.task?.description ?? selectedRecord.mission?.title ?? selectedRecord.agent.mission ?? "未分配"}</span>
                <span className="text-[var(--kimix-panel-text-muted)]">分支</span><span className="truncate text-[var(--kimix-panel-text)]">{selectedRecord.agent.branch ?? selectedRecord.mission?.branch ?? "未创建"}</span>
              </div>
              <div className="border-t border-[var(--kimix-panel-divider)]" style={{ marginTop: 10, paddingTop: 10 }}>
                {selectedRecord.subagent ? (
                  <KimiWebSubagentDetails subagent={selectedRecord.subagent} />
                ) : (
                  <div className="text-[12.5px] leading-5 text-[var(--kimix-panel-text-muted)]">该 Agent 的事件详情尚未进入本地会话记录。</div>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-[13px] leading-6 text-[var(--kimix-panel-text-muted)]">正在同步官方 Tower 状态...</div>
      )}
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
  towerTasks = [],
  towerSubagents = [],
  towerBusy,
  onPauseGoal,
  onResumeGoal,
  onCancelGoal,
  onRefreshGoal,
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
    label: "后台 Agent",
    count: towerPending ? "待开启" : "",
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

  const panelConfig: Record<ComposerDockPanelId, { title: string; body: ReactNode; onHide?: () => void; hideHeader?: boolean }> = {
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
      title: towerPending ? "Tower 待开启" : "后台 Agent",
      hideHeader: true,
      body: (
        <TowerPanelBody
          towerPending={towerPending}
          snapshot={towerSnapshot}
          tasks={towerTasks}
          subagents={towerSubagents}
          busy={towerBusy}
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
          {!active.hideHeader && (
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
          )}
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
