import { useEffect, useRef, useState, type ReactNode } from "react";
import { ClipboardList, ListOrdered, PanelRightClose, SquareTerminal, Users, X } from "lucide-react";
import type { KimiCodeBackgroundTaskInfo } from "@electron/types/ipc";
import type { TodoItem } from "@/types/ui";
import { backgroundTaskDurationLabel, backgroundTaskKindLabel, backgroundTaskSummary, backgroundTaskTone } from "@/utils/backgroundTasks";
import { TodoListItems, todoCounts } from "./TodoPanel";

/**
 * 输入区 dock 胶囊行（对齐官方 kimi-web ChatDock 的 dock work chips）：
 * 「后台 Bash (N)」「子 Agent (N)」「待办 (done/total)」「队列 (N)」小胶囊，
 * 点击向上展开半透明面板；单面板互斥、点外部关闭、数据清空自动关闭。
 * 替代原 TodoPanel 卡片与排队消息浮动面板（重量级实心卡，遮挡聊天内容）。
 */

export type ComposerDockPanelId = "bash" | "subagent" | "todo" | "queue";

type ComposerDockBarProps = {
  bashTasks: KimiCodeBackgroundTaskInfo[];
  subagentTasks: KimiCodeBackgroundTaskInfo[];
  /** 已被「收起到侧栏」时由调用方传空数组。 */
  todoItems: TodoItem[];
  /** 已被「收起到侧栏」时由调用方传 0。 */
  queueCount: number;
  /** 排队消息列表（拖拽排序/引导/删除交互复杂，由 Composer 组装后注入）。 */
  queueBody: ReactNode;
  onHideTodo?: () => void;
  onHideQueue?: () => void;
};

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

export function ComposerDockBar({
  bashTasks,
  subagentTasks,
  todoItems,
  queueCount,
  queueBody,
  onHideTodo,
  onHideQueue,
}: ComposerDockBarProps) {
  const [openPanel, setOpenPanel] = useState<ComposerDockPanelId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const { doneCount } = todoCounts(todoItems);
  const capsules: { id: ComposerDockPanelId; label: string; count: string; icon: ReactNode }[] = [];
  if (bashTasks.length > 0) capsules.push({ id: "bash", label: "后台 Bash", count: String(bashTasks.length), icon: <SquareTerminal size={13} /> });
  if (subagentTasks.length > 0) capsules.push({ id: "subagent", label: "子 Agent", count: String(subagentTasks.length), icon: <Users size={13} /> });
  if (todoItems.length > 0) capsules.push({ id: "todo", label: "待办", count: `${doneCount}/${todoItems.length}`, icon: <ClipboardList size={13} /> });
  if (queueCount > 0) capsules.push({ id: "queue", label: "队列", count: String(queueCount), icon: <ListOrdered size={13} /> });

  // 数据清空自动关闭对应面板（官方 watch(hasDockWork) 同款语义）。
  useEffect(() => {
    if (openPanel === "bash" && bashTasks.length === 0) setOpenPanel(null);
    if (openPanel === "subagent" && subagentTasks.length === 0) setOpenPanel(null);
    if (openPanel === "todo" && todoItems.length === 0) setOpenPanel(null);
    if (openPanel === "queue" && queueCount === 0) setOpenPanel(null);
  }, [openPanel, bashTasks.length, subagentTasks.length, todoItems.length, queueCount]);

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
      title: `后台 Bash · ${bashTasks.length} 个任务`,
      body: <BackgroundTaskListItems tasks={bashTasks} />,
    },
    subagent: {
      title: `子 Agent · ${subagentTasks.length} 个任务`,
      body: <BackgroundTaskListItems tasks={subagentTasks} />,
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
  };
  const active = openPanel ? panelConfig[openPanel] : null;

  return (
    // 脱离文档流悬浮在聊天内容之上：不占 footer 高度，不形成实色背景带遮挡消息。
    <div ref={rootRef} style={{ position: "absolute", left: 0, right: 0, bottom: "100%", marginBottom: 8, zIndex: 20 }}>
      {active && (
        <div
          className="kimix-dock-panel flex flex-col overflow-hidden"
          style={{ position: "absolute", left: 0, right: 0, bottom: "100%", marginBottom: 8, maxHeight: "min(300px, 42vh)", zIndex: 30 }}
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
            <span className="kimix-dock-capsule-count">({capsule.count})</span>
          </button>
        ))}
      </div>
    </div>
  );
}
