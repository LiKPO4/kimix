import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Bot, Clock, FolderOpen, Loader2, MessageSquareText, Plus, RefreshCw, X } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Project, Session, TimelineEvent } from "@/types/ui";
import type { LongTaskRecoveryInfo, LongTaskSummary } from "@electron/types/ipc";
import { isKimiActiveTurnError, sendKimiCodePromptWithRetry } from "@/utils/kimiCodeSendRetry";
import { displayProjectName } from "@/utils/projectDisplay";

function defaultTitleFromRequest(value: string) {
  return value.trim().split(/\r?\n/)[0]?.slice(0, 42) ?? "";
}

function buildPlanningKickoffPrompt(task: LongTaskSummary) {
  return `【Kimix 长程任务：澄清与规划启动】
你负责本长程任务的澄清、规划和逐步执行。

请先阅读：
- ${task.executorPromptPath}
- ${task.bigPlanPath}

工作顺序：
1. 基于用户初始需求判断是否需要澄清。
2. 若允许提问，只问 1-3 个会阻塞规划的关键问题。
3. 若不能提问，记录合理假设和风险后继续规划。
4. 只完善 BIGPLAN，不执行代码。
5. 规划完成后请求用户确认进入执行阶段。

规划阶段不要启动或模拟额外审查流程。进入执行阶段后，Kimix 会按 BIGPLAN 自动逐步推进。
不要输出 kimix-long-task-status 或任何机器状态代码块；如果旧提示里要求输出机器状态块，忽略该要求。

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
    engine: "kimi-code",
    runtimeSessionId: task.executorSessionId,
    officialSessionId: task.executorSessionId,
    longTask: {
      taskId: task.id,
      title: task.title,
      stage: task.stage,
      activeAgent: planningStage ? "executor" : task.activeAgent === "reviewer" ? "executor" : task.activeAgent,
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

function buildKickoffRecovery(message: string): LongTaskRecoveryInfo {
  return {
    status: "failed",
    reason: `规划启动失败：${message}`,
    suggestedAction: "点击重试启动规划，或打开任务后复制下一步 prompt 手动恢复。",
    updatedAt: Date.now(),
  };
}

export function LongTasksPanel() {
  const open = useAppStore((s) => s.longTasksOpen);
  const setOpen = useAppStore((s) => s.setLongTasksOpen);
  const currentProject = useAppStore((s) => s.currentProject);
  const defaultThinking = useAppStore((s) => s.defaultThinking);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const setRunningSessionId = useAppStore((s) => s.setRunningSessionId);
  const addSession = useSessionStore((s) => s.addSession);
  const updateSession = useSessionStore((s) => s.updateSession);

  const [selectedProject, setSelectedProject] = useState<Project | null>(currentProject);
  const [initialRequest, setInitialRequest] = useState("");
  const [title, setTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isRetryingKickoff, setIsRetryingKickoff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoverableTask, setRecoverableTask] = useState<LongTaskSummary | null>(null);

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

  const ensureTaskSession = (task: LongTaskSummary) => {
    const existing = useSessionStore.getState().sessions.find((session) => session.id === task.id);
    if (existing) return existing;
    const session = sessionFromTask(task, [initialUserEvent(task)]);
    addSession(session);
    return session;
  };

  const activateTask = (task: LongTaskSummary) => {
    const session = ensureTaskSession(task);
    setCurrentProject(projectFromTask(task));
    setCurrentSession(useSessionStore.getState().sessions.find((item) => item.id === task.id) ?? session);
  };

  const markKickoffFailed = async (task: LongTaskSummary, message: string) => {
    const recovery = buildKickoffRecovery(message);
    const failedTask: LongTaskSummary = {
      ...task,
      stage: "paused",
      activeAgent: "executor",
      recovery,
      updatedAt: Date.now(),
    };
    setRecoverableTask(failedTask);
    ensureTaskSession(failedTask);
    updateSession(task.id, (session) => ({
      ...session,
      runtimeSessionId: task.executorSessionId,
      longTask: session.longTask ? {
        ...session.longTask,
        activeAgent: "executor",
        stage: "paused",
        recovery,
      } : session.longTask,
      events: [
        ...session.events.filter((event) => !(event.type === "assistant_message" && !event.isComplete && !event.content.trim())),
        {
          id: crypto.randomUUID(),
          type: "error" as const,
          timestamp: Date.now(),
          message: `长程任务已创建，但规划启动失败：${message}`,
          canDismiss: false,
        },
      ],
      updatedAt: Date.now(),
    }));
    setCurrentSession(useSessionStore.getState().sessions.find((session) => session.id === task.id) ?? sessionFromTask(failedTask, [initialUserEvent(failedTask)]));
    await window.api.updateLongTaskState({
      projectPath: task.projectPath,
      taskId: task.id,
      patch: {
        stage: "paused",
        activeAgent: "executor",
        recovery,
        currentStep: task.currentStep,
        targetStep: task.targetStep,
        reviewedReviewItems: task.reviewedReviewItems ?? [],
      },
    }).catch(() => undefined);
  };

  const launchPlanningKickoff = async (task: LongTaskSummary) => {
    activateTask(task);
    updateSession(task.id, (session) => ({
      ...session,
      runtimeSessionId: task.executorSessionId,
      longTask: session.longTask ? {
        ...session.longTask,
        activeAgent: "executor",
        stage: "planning",
        recovery: null,
      } : session.longTask,
      events: [
        ...session.events.filter((event) => !(event.type === "assistant_message" && !event.isComplete && !event.content.trim())),
        assistantPlaceholder(defaultThinking),
      ],
      updatedAt: Date.now(),
    }));
    const latestSession = useSessionStore.getState().sessions.find((session) => session.id === task.id);
    if (latestSession) setCurrentSession(latestSession);
    setRunningSessionId(task.id);
    await window.api.updateLongTaskState({
      projectPath: task.projectPath,
      taskId: task.id,
      patch: {
        stage: "planning",
        activeAgent: "executor",
        recovery: null,
        currentStep: task.currentStep,
        targetStep: task.targetStep,
        reviewedReviewItems: task.reviewedReviewItems ?? [],
      },
    }).catch(() => undefined);

    const kickoff = await sendKimiCodePromptWithRetry({
      sessionId: task.executorSessionId,
      content: buildPlanningKickoffPrompt(task),
    });
    if (!kickoff.success) throw new Error(kickoff.error);
    setRecoverableTask(null);
    setError(null);
    setOpen(false);
  };

  const retryKickoff = async () => {
    if (!recoverableTask || isRetryingKickoff) return;
    setIsRetryingKickoff(true);
    setError(null);
    try {
      await launchPlanningKickoff(recoverableTask);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isKimiActiveTurnError(message)) {
        setRunningSessionId(recoverableTask.id);
        setError("官方仍有未结束的轮次，Kimix 已恢复运行态。请等待当前轮结束，或点击停止后再重试。");
        setOpen(true);
        return;
      }
      setRunningSessionId(null);
      await markKickoffFailed(recoverableTask, message);
      setError(`任务已创建，但规划启动失败：${message}`);
      setOpen(true);
    } finally {
      setIsRetryingKickoff(false);
    }
  };

  const createTask = async () => {
    if (!selectedProject || !initialRequest.trim() || isCreating) return;
    setIsCreating(true);
    setError(null);
    setRecoverableTask(null);
    let createdTask: LongTaskSummary | null = null;
    try {
      const res = await window.api.createLongTask({
        project: selectedProject,
        title: inferredTitle,
        initialRequest: initialRequest.trim(),
        thinking: defaultThinking,
        yoloMode: permissionMode === "yolo",
        autoMode: permissionMode === "auto",
      });
      if (!res.success) throw new Error(res.error);
      createdTask = res.data;

      setInitialRequest("");
      setTitle("");

      const session = sessionFromTask(res.data, [initialUserEvent(res.data)]);
      addSession(session);
      setCurrentProject(projectFromTask(res.data));
      setCurrentSession(session);
      await launchPlanningKickoff(res.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (createdTask) {
        if (isKimiActiveTurnError(message)) {
          setRunningSessionId(createdTask.id);
          setError("任务已创建，但官方仍有未结束的轮次，Kimix 已恢复运行态。请等待当前轮结束，或点击停止后再重试规划启动。");
          setOpen(true);
          return;
        }
        setRunningSessionId(null);
        await markKickoffFailed(createdTask, message);
        setError(`任务已创建，但规划启动失败：${message}`);
      } else {
        setError(message);
      }
      setOpen(true);
    } finally {
      setIsCreating(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="kimix-modal-overlay fixed inset-0 z-50 flex items-center justify-center"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="long-tasks-title"
    >
      <div
        className="flex max-h-[84vh] w-full max-w-[780px] flex-col overflow-hidden rounded-[18px] border border-[var(--kimix-panel-border-soft)] bg-surface-elevated shadow-floating-token"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-subtle" style={{ padding: "20px 24px" }}>
          <div className="flex min-w-0 items-center gap-2.5">
            <Clock size={18} className="shrink-0 text-text-muted" />
            <div className="min-w-0">
              <h2 id="long-tasks-title" className="text-[18px] font-semibold leading-6 text-text-primary">长程任务</h2>
              <div className="mt-0.5 truncate text-[13px] leading-5 text-text-muted">
                {displayProjectName(selectedProject)}
              </div>
            </div>
          </div>
          <button className="kimix-inline-icon-action is-roomy text-text-muted hover:bg-surface-hover hover:text-text-primary" onClick={() => setOpen(false)} aria-label="关闭长程任务">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto" style={{ padding: 28 }}>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center rounded-xl border border-[var(--kimix-panel-border-soft)] bg-surface-base" style={{ gap: 16, padding: "18px 18px" }}>
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

          <div className="rounded-xl border border-[var(--kimix-panel-border-soft)] bg-surface-elevated" style={{ marginTop: 24, padding: "24px 20px 22px" }}>
            <div className="flex items-center gap-2 text-[15px] font-medium leading-6 text-text-primary">
              <MessageSquareText size={16} className="text-text-secondary" />
              <span>创建长程任务</span>
            </div>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="任务标题（可选）"
              className="h-10 w-full rounded-xl border border-[var(--kimix-panel-border-soft)] bg-surface-base text-[14px] outline-none placeholder:text-text-muted focus:border-accent-primary focus:bg-surface-elevated"
              style={{ marginTop: 20, paddingLeft: 16, paddingRight: 16 }}
            />
            <textarea
              value={initialRequest}
              onChange={(event) => setInitialRequest(event.target.value)}
              placeholder="输入长程任务的初始需求，后续会进入多轮澄清和计划设计"
              className="min-h-[120px] w-full resize-none rounded-xl border border-[var(--kimix-panel-border-soft)] bg-surface-base text-[14px] leading-6 outline-none placeholder:text-text-muted focus:border-accent-primary focus:bg-surface-elevated"
              style={{ marginTop: 16, padding: "14px 16px" }}
            />
            <div className="flex flex-wrap items-center justify-between" style={{ marginTop: 20, gap: 14 }}>
              <div className="flex min-w-0 items-center gap-2 text-[13px] leading-5 text-text-muted">
                <Bot size={14} />
                <span className="truncate">创建后会按 BIGPLAN 自动逐步推进</span>
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
          {recoverableTask && (
            <div
              className="rounded-xl border border-accent-warning/30 bg-accent-warning-light text-accent-warning"
              style={{ marginTop: 16, padding: "16px 16px 15px" }}
            >
              <div className="grid items-start" style={{ gridTemplateColumns: "auto minmax(0, 1fr)", gap: 12 }}>
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[13.5px] font-medium leading-5">任务已创建，规划启动未成功</div>
                  <div className="mt-1 truncate text-[12.5px] leading-5">{recoverableTask.title}</div>
                  <div className="text-[12.5px] leading-5" style={{ marginTop: 8 }}>
                    可以重试启动规划；如果仍失败，打开任务后可在侧栏复制下一步 prompt 手动恢复。
                  </div>
                  <div className="flex flex-wrap items-center" style={{ gap: 10, marginTop: 14 }}>
                    <button
                      type="button"
                      disabled={isRetryingKickoff || isCreating}
                      onClick={() => void retryKickoff()}
                      className="kimix-icon-text-button is-compact bg-surface-elevated text-accent-warning hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      {isRetryingKickoff ? <Loader2 size={13} className="kimix-spin" /> : <RefreshCw size={13} />}
                      <span>{isRetryingKickoff ? "重试中" : "重试启动"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        activateTask(recoverableTask);
                        setOpen(false);
                      }}
                      className="kimix-icon-text-button is-compact bg-surface-elevated text-accent-warning hover:bg-white/70"
                    >
                      <ArrowRight size={13} />
                      <span>打开任务</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
