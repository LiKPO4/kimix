import { useEffect, useMemo, useState } from "react";
import { Bot, Clock, FolderOpen, Loader2, MessageSquareText, Plus, X } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Project, Session, TimelineEvent } from "@/types/ui";
import type { LongTaskSummary } from "@electron/types/ipc";

function defaultTitleFromRequest(value: string) {
  return value.trim().split(/\r?\n/)[0]?.slice(0, 42) ?? "";
}

function buildPlanningKickoffPrompt(task: LongTaskSummary) {
  return `【Kimix 长程任务：澄清与规划启动】
你正在作为 Kimix 长程任务的执行 agent 工作。

请先阅读以下长程任务专属文件：
- ${task.executorPromptPath}
- ${task.bigPlanPath}

然后基于用户初始需求开始澄清与规划阶段。你需要先判断是否还需要澄清；如果需要，必须调用官方 AskUserQuestion/需求澄清工具提出 1-3 个关键问题，让界面显示结构化澄清卡片；不要用普通正文罗列问题替代需求澄清工具。可以多轮澄清，直到目标、范围、验收标准和风险边界足够明确。不要直接开始执行代码。
规划阶段只和用户澄清并完善 BIGPLAN，不要交给审查 agent。进入执行阶段后，每轮执行完成需要审查时，只说明交给审查 agent 审查；不要自己调用 subagent、Reviewer 或其它子代理来模拟审查，Kimix 会用独立 reviewer session 接棒。

用户初始需求：
${task.initialRequest}`;
}

function projectFromTask(task: LongTaskSummary): Project {
  return {
    id: task.projectPath,
    name: task.projectName,
    path: task.projectPath,
    lastOpenedAt: Date.now(),
  };
}

function sessionFromTask(task: LongTaskSummary, events: TimelineEvent[]): Session {
  const planningStage = ["drafting", "planning", "ready"].includes(task.stage);
  return {
    id: task.id,
    runtimeSessionId: planningStage || task.activeAgent === "executor" ? task.executorSessionId : task.reviewerSessionId,
    longTask: {
      taskId: task.id,
      title: task.title,
      stage: task.stage,
      activeAgent: planningStage ? "executor" : task.activeAgent,
      executorSessionId: task.executorSessionId,
      reviewerSessionId: task.reviewerSessionId,
      bigPlanPath: task.bigPlanPath,
      reviewQueuePath: task.reviewQueuePath,
      reviewedReviewItems: task.reviewedReviewItems ?? [],
      currentStep: task.currentStep,
      targetStep: task.targetStep,
    },
    title: `长程任务：${task.title}`,
    projectPath: task.projectPath,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    events,
    isLoading: false,
  };
}

function initialUserEvent(task: LongTaskSummary): TimelineEvent {
  return {
    id: crypto.randomUUID(),
    type: "user_message",
    timestamp: task.createdAt,
    content: task.initialRequest,
  };
}

function assistantPlaceholder(thinking: boolean): TimelineEvent {
  return {
    id: crypto.randomUUID(),
    type: "assistant_message",
    timestamp: Date.now(),
    content: "",
    isThinking: thinking,
    isComplete: false,
  };
}

export function LongTasksPanel() {
  const open = useAppStore((s) => s.longTasksOpen);
  const setOpen = useAppStore((s) => s.setLongTasksOpen);
  const currentProject = useAppStore((s) => s.currentProject);
  const defaultThinking = useAppStore((s) => s.defaultThinking);
  const defaultAfkMode = useAppStore((s) => s.defaultAfkMode);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const setRunningSessionId = useAppStore((s) => s.setRunningSessionId);
  const addSession = useSessionStore((s) => s.addSession);

  const [selectedProject, setSelectedProject] = useState<Project | null>(currentProject);
  const [initialRequest, setInitialRequest] = useState("");
  const [title, setTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inferredTitle = useMemo(() => title.trim() || defaultTitleFromRequest(initialRequest) || "新的长程任务", [title, initialRequest]);

  useEffect(() => {
    if (!open) return;
    if (currentProject && (!selectedProject || selectedProject.path !== currentProject.path)) {
      setSelectedProject(currentProject);
    }
  }, [open, currentProject, selectedProject]);

  const selectOtherProject = async () => {
    const res = await window.api.openProject();
    if (!res.success) {
      setError(res.error);
      return;
    }
    if (!res.data) return;
    setSelectedProject(res.data);
    setError(null);
  };

  const createTask = async () => {
    if (!selectedProject || !initialRequest.trim() || isCreating) return;
    setIsCreating(true);
    setError(null);
    try {
      const res = await window.api.createLongTask({
        project: selectedProject,
        title: inferredTitle,
        initialRequest: initialRequest.trim(),
        thinking: defaultThinking,
        yoloMode: permissionMode === "yolo",
        afkMode: defaultAfkMode,
      });
      if (!res.success) throw new Error(res.error);

      setInitialRequest("");
      setTitle("");

      const session = sessionFromTask(res.data, [initialUserEvent(res.data), assistantPlaceholder(defaultThinking)]);
      addSession(session);
      setCurrentProject(projectFromTask(res.data));
      setCurrentSession(session);
      setRunningSessionId(session.id);

      const kickoff = await window.api.sendPrompt({
        sessionId: res.data.executorSessionId,
        content: buildPlanningKickoffPrompt(res.data),
        thinking: defaultThinking,
        yoloMode: permissionMode === "yolo",
        afkMode: defaultAfkMode,
      });
      if (!kickoff.success) {
        setRunningSessionId(null);
        throw new Error(kickoff.error);
      }
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setOpen(true);
    } finally {
      setIsCreating(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 backdrop-blur-sm"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="long-tasks-title"
    >
      <div
        className="flex max-h-[84vh] w-full max-w-[780px] flex-col overflow-hidden rounded-[18px] border border-border-default bg-surface-elevated shadow-floating-token"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-subtle" style={{ padding: "20px 24px" }}>
          <div className="flex min-w-0 items-center gap-2.5">
            <Clock size={18} className="shrink-0 text-text-muted" />
            <div className="min-w-0">
              <h2 id="long-tasks-title" className="text-[18px] font-semibold leading-6 text-text-primary">长程任务</h2>
              <div className="mt-0.5 truncate text-[13px] leading-5 text-text-muted">
                {selectedProject ? selectedProject.name : "未选择项目"}
              </div>
            </div>
          </div>
          <button className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-surface-hover hover:text-text-primary" onClick={() => setOpen(false)} aria-label="关闭长程任务">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto" style={{ padding: 28 }}>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center rounded-xl border border-border-default bg-surface-base" style={{ gap: 16, padding: "18px 18px" }}>
            <div className="min-w-0">
              <div className="text-[14.5px] font-medium leading-5 text-text-primary">项目</div>
              <div className="mt-1 truncate text-[13px] leading-5 text-text-secondary">{selectedProject?.path ?? "选择一个项目来创建长程任务"}</div>
            </div>
            <div className="flex shrink-0 items-center" style={{ gap: 10 }}>
              {currentProject && (
                <button type="button" onClick={() => setSelectedProject(currentProject)} className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover">
                  <FolderOpen size={14} />
                  <span>当前项目</span>
                </button>
              )}
              <button type="button" onClick={selectOtherProject} className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover">
                <Plus size={14} />
                <span>选择项目</span>
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-border-default bg-surface-elevated" style={{ marginTop: 24, padding: "24px 20px 22px" }}>
            <div className="flex items-center gap-2 text-[15px] font-medium leading-6 text-text-primary">
              <MessageSquareText size={16} className="text-text-secondary" />
              <span>创建长程任务</span>
            </div>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="任务标题（可选）"
              className="h-10 w-full rounded-xl border border-border-default bg-surface-base text-[14px] outline-none placeholder:text-text-muted focus:border-border-strong focus:bg-surface-elevated"
              style={{ marginTop: 20, paddingLeft: 16, paddingRight: 16 }}
            />
            <textarea
              value={initialRequest}
              onChange={(event) => setInitialRequest(event.target.value)}
              placeholder="输入长程任务的初始需求，后续会进入多轮澄清和计划设计"
              className="min-h-[120px] w-full resize-none rounded-xl border border-border-default bg-surface-base text-[14px] leading-6 outline-none placeholder:text-text-muted focus:border-border-strong focus:bg-surface-elevated"
              style={{ marginTop: 16, padding: "14px 16px" }}
            />
            <div className="flex flex-wrap items-center justify-between" style={{ marginTop: 20, gap: 14 }}>
              <div className="flex min-w-0 items-center gap-2 text-[13px] leading-5 text-text-muted">
                <Bot size={14} />
                <span className="truncate">创建后会启动执行 agent 和审查 agent 两个独立 session</span>
              </div>
              <button
                type="button"
                disabled={!selectedProject || !initialRequest.trim() || isCreating}
                onClick={() => void createTask()}
                className="kimix-icon-text-button bg-accent-primary text-white hover:bg-accent-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
                style={{ paddingLeft: 16, paddingRight: 16 }}
              >
                {isCreating ? <Loader2 size={14} className="kimix-spin" /> : <Plus size={14} />}
                <span>{isCreating ? "创建中" : "创建任务"}</span>
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-accent-warning/30 bg-accent-warning-light text-[13.5px] leading-5 text-accent-warning" style={{ padding: "12px 14px" }}>
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
