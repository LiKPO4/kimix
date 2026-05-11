import { useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, Clock, FileText, FolderOpen, Loader2, MessageSquareText, Plus, SearchCheck, X } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Project, Session } from "@/types/ui";
import type { TimelineEvent } from "@/types/ui";
import type { LongTaskSummary } from "@electron/types/ipc";
import { mapHistoryEvents } from "@/utils/eventMapper";

const stageLabels: Record<LongTaskSummary["stage"], string> = {
  drafting: "需求澄清",
  planning: "计划设计",
  ready: "等待执行",
  running: "执行中",
  reviewing: "审查中",
  paused: "已暂停",
  completed: "已完成",
};

const agentLabels: Record<LongTaskSummary["activeAgent"], string> = {
  executor: "执行 agent",
  reviewer: "审查 agent",
};

function formatTime(ts: number) {
  return new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function defaultTitleFromRequest(value: string) {
  return value.trim().split(/\r?\n/)[0]?.slice(0, 42) ?? "";
}

function buildPlanningKickoffPrompt(task: LongTaskSummary) {
  return `【Kimix 长程任务：澄清与规划启动】
你正在作为 Kimix 长程任务的执行 agent 工作。

请先阅读以下长程任务专属文件：
- ${task.executorPromptPath}
- ${task.bigPlanPath}

然后基于用户初始需求开始澄清与规划阶段。你需要先判断是否还需要澄清；如果需要，请向用户提出 1-3 个关键问题。不要直接开始执行代码。
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
  const permissionMode = useAppStore((s) => s.permissionMode);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const setRunningSessionId = useAppStore((s) => s.setRunningSessionId);
  const addSession = useSessionStore((s) => s.addSession);
  const sessions = useSessionStore((s) => s.sessions);

  const [selectedProject, setSelectedProject] = useState<Project | null>(currentProject);
  const [tasks, setTasks] = useState<LongTaskSummary[]>([]);
  const [initialRequest, setInitialRequest] = useState("");
  const [title, setTitle] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [openingTaskId, setOpeningTaskId] = useState<string | null>(null);

  const inferredTitle = useMemo(() => title.trim() || defaultTitleFromRequest(initialRequest) || "新的长程任务", [title, initialRequest]);

  const refreshTasks = async (projectPath: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await window.api.listLongTasks({ projectPath });
      if (!res.success) throw new Error(res.error);
      setTasks(res.data);
      setSelectedTaskId((current) => current ?? res.data[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setTasks([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    if (currentProject && (!selectedProject || selectedProject.path !== currentProject.path)) {
      setSelectedProject(currentProject);
    }
  }, [open, currentProject, selectedProject]);

  useEffect(() => {
    if (!open || !selectedProject) return;
    void refreshTasks(selectedProject.path);
  }, [open, selectedProject?.path]);

  const selectOtherProject = async () => {
    const res = await window.api.openProject();
    if (!res.success) {
      setError(res.error);
      return;
    }
    if (!res.data) return;
    setSelectedProject(res.data);
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
      });
      if (!res.success) throw new Error(res.error);
      setTasks((prev) => [res.data, ...prev.filter((task) => task.id !== res.data.id)]);
      setSelectedTaskId(res.data.id);
      setInitialRequest("");
      setTitle("");
      const session = sessionFromTask(res.data, [initialUserEvent(res.data), assistantPlaceholder(defaultThinking)]);
      addSession(session);
      setCurrentProject(selectedProject);
      setCurrentSession(session);
      setRunningSessionId(session.id);
      const kickoff = await window.api.sendPrompt({
        sessionId: res.data.executorSessionId,
        content: buildPlanningKickoffPrompt(res.data),
        thinking: defaultThinking,
        yoloMode: permissionMode === "yolo",
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

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? tasks[0] ?? null;

  const openTaskInMain = async (task: LongTaskSummary) => {
    if (openingTaskId) return;
    const existing = sessions.find((session) => session.longTask?.taskId === task.id);
    const project = projectFromTask(task);
    if (existing) {
      setCurrentProject(project);
      setCurrentSession(existing);
      setOpen(false);
      return;
    }

    setOpeningTaskId(task.id);
    setError(null);
    try {
      const executor = await window.api.startSession({
        workDir: task.projectPath,
        sessionId: task.executorSessionId,
        model: "kimi-code/kimi-for-coding",
        thinking: defaultThinking,
        yoloMode: permissionMode === "yolo",
      });
      if (!executor.success) throw new Error(executor.error);
      const reviewer = await window.api.startSession({
        workDir: task.projectPath,
        sessionId: task.reviewerSessionId,
        model: "kimi-code/kimi-for-coding",
        thinking: defaultThinking,
        yoloMode: permissionMode === "yolo",
      });
      if (!reviewer.success) throw new Error(reviewer.error);
      const loadedExecutor = await window.api.loadSession({
        workDir: task.projectPath,
        sessionId: task.executorSessionId,
      });
      const loadedReviewer = await window.api.loadSession({
        workDir: task.projectPath,
        sessionId: task.reviewerSessionId,
      });
      const executorEvents = loadedExecutor.success
        ? mapHistoryEvents(Array.isArray(loadedExecutor.data.events) ? loadedExecutor.data.events : [])
        : [];
      const reviewerEvents = loadedReviewer.success
        ? mapHistoryEvents(Array.isArray(loadedReviewer.data.events) ? loadedReviewer.data.events : [])
        : [];
      const events = [...executorEvents, ...reviewerEvents];
      const visibleEvents = events.length > 0 ? events : [initialUserEvent(task)];
      const session = sessionFromTask(task, visibleEvents);
      addSession(session);
      setCurrentProject(project);
      setCurrentSession(session);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOpeningTaskId(null);
    }
  };

  const openTaskDir = (task: LongTaskSummary) => {
    void window.api.openProjectPath({ path: task.taskDir });
  };

  const openBigPlan = (task: LongTaskSummary) => {
    void window.api.openFile({ projectPath: task.projectPath, filePath: task.bigPlanPath });
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
        className="flex max-h-[84vh] w-full max-w-[760px] flex-col overflow-hidden rounded-[18px] border border-[#dedad2] bg-white shadow-[0_28px_90px_rgba(25,23,20,0.22)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#ebe7df]" style={{ padding: "18px 22px" }}>
          <div className="flex min-w-0 items-center gap-2.5">
            <Clock size={18} className="shrink-0 text-[#8f887e]" />
            <div className="min-w-0">
              <h2 id="long-tasks-title" className="text-[18px] font-semibold leading-6 text-[#24211d]">长程任务</h2>
              <div className="mt-0.5 truncate text-[13px] leading-5 text-[#8f887e]">
                {selectedProject ? selectedProject.name : "未选择项目"}
              </div>
            </div>
          </div>
          <button className="flex h-8 w-8 items-center justify-center rounded-lg text-[#8f887e] hover:bg-[#f1eee8] hover:text-[#24211d]" onClick={() => setOpen(false)} aria-label="关闭长程任务">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto" style={{ padding: 22 }}>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center rounded-xl border border-[#e7e2d8] bg-[#fbfaf7]" style={{ gap: 14, padding: "14px 16px" }}>
            <div className="min-w-0">
              <div className="text-[14.5px] font-medium leading-5 text-[#302d28]">项目</div>
              <div className="mt-1 truncate text-[13px] leading-5 text-[#7c756c]">{selectedProject?.path ?? "选择一个项目来创建长程任务"}</div>
            </div>
            <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
              {currentProject && (
                <button type="button" onClick={() => setSelectedProject(currentProject)} className="kimix-icon-text-button is-compact text-[#625d55] hover:bg-[#eeeae3]">
                  <FolderOpen size={14} />
                  <span>当前项目</span>
                </button>
              )}
              <button type="button" onClick={selectOtherProject} className="kimix-icon-text-button is-compact text-[#625d55] hover:bg-[#eeeae3]">
                <Plus size={14} />
                <span>选择项目</span>
              </button>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-[#e7e2d8] bg-white" style={{ padding: "18px 18px 16px" }}>
            <div className="flex items-center gap-2 text-[15px] font-medium leading-6 text-[#302d28]">
              <MessageSquareText size={16} className="text-[#706b63]" />
              <span>创建长程任务</span>
            </div>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="任务标题（可选）"
              className="mt-4 h-10 w-full rounded-xl border border-[#e3ded6] bg-[#fbfaf7] text-[14px] outline-none placeholder:text-[#aaa49a] focus:border-[#cfc8bc] focus:bg-white"
              style={{ paddingLeft: 14, paddingRight: 14 }}
            />
            <textarea
              value={initialRequest}
              onChange={(event) => setInitialRequest(event.target.value)}
              placeholder="输入长程任务的初始需求，后续会进入多轮澄清和计划设计"
              className="mt-3 min-h-[112px] w-full resize-none rounded-xl border border-[#e3ded6] bg-[#fbfaf7] text-[14px] leading-6 outline-none placeholder:text-[#aaa49a] focus:border-[#cfc8bc] focus:bg-white"
              style={{ padding: "12px 14px" }}
            />
            <div className="mt-4 flex flex-wrap items-center justify-between" style={{ gap: 12 }}>
              <div className="flex min-w-0 items-center gap-2 text-[13px] leading-5 text-[#8f887e]">
                <Bot size={14} />
                <span className="truncate">创建后会启动执行 agent 和审查 agent 两个独立 session</span>
              </div>
              <button
                type="button"
                disabled={!selectedProject || !initialRequest.trim() || isCreating}
                onClick={() => void createTask()}
                className="kimix-icon-text-button bg-[#339af0] text-white hover:bg-[#228be6] disabled:cursor-not-allowed disabled:opacity-50"
                style={{ paddingLeft: 16, paddingRight: 16 }}
              >
                {isCreating ? <Loader2 size={14} className="kimix-spin" /> : <Plus size={14} />}
                <span>{isCreating ? "创建中" : "创建任务"}</span>
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-[#f0d7b8] bg-[#fff8ef] text-[13.5px] leading-5 text-[#8b5a24]" style={{ padding: "12px 14px" }}>
              {error}
            </div>
          )}

          <div className="mt-5 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[15px] font-medium leading-6 text-[#302d28]">
              <SearchCheck size={16} className="text-[#706b63]" />
              <span>任务列表</span>
            </div>
            {isLoading && <Loader2 size={15} className="kimix-spin text-[#8f887e]" />}
          </div>

          <div className="mt-3 flex flex-col" style={{ gap: 12 }}>
            {tasks.map((task) => {
              const isSelected = selectedTask?.id === task.id;
              const taskSession = sessions.find((session) => session.longTask?.taskId === task.id);
              const isOpenInMain = Boolean(taskSession);
              const isOpening = openingTaskId === task.id;
              return (
              <div
                key={task.id}
                onClick={() => setSelectedTaskId(task.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") setSelectedTaskId(task.id);
                }}
                className={`w-full cursor-pointer rounded-xl border bg-white text-left transition-colors ${isSelected ? "border-[#b7d9f7] bg-[#f4f9ff]" : "border-[#e7e2d8] hover:bg-[#fbfaf7]"}`}
                style={{ padding: "16px 18px" }}
              >
                <div className="flex items-start justify-between" style={{ gap: 14 }}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-medium leading-6 text-[#302d28]">{task.title}</div>
                    <div className="mt-1 truncate text-[13px] leading-5 text-[#8f887e]">{task.initialRequest}</div>
                  </div>
                  <span className="shrink-0 rounded-full bg-[#eef7ff] text-[12px] leading-5 text-[#2f83cc]" style={{ padding: "4px 10px" }}>
                    {isOpenInMain ? "主对话中" : stageLabels[task.stage]}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 text-[13px] leading-5 text-[#706b63]" style={{ gap: 10 }}>
                  <div className="flex min-w-0 items-center gap-2">
                    <Bot size={14} className="shrink-0 text-[#8f887e]" />
                    <span className="truncate">当前：{agentLabels[task.activeAgent]}</span>
                  </div>
                  <div className="flex min-w-0 items-center gap-2">
                    <CheckCircle2 size={14} className="shrink-0 text-[#8f887e]" />
                    <span className="truncate">步骤：{task.currentStep}{task.targetStep ? ` / ${task.targetStep}` : " / 未设置"}</span>
                  </div>
                  <div className="truncate">执行 session：{task.executorSessionId}</div>
                  <div className="truncate">审查 session：{task.reviewerSessionId}</div>
                  <div className="col-span-2 truncate">更新：{formatTime(task.updatedAt)}</div>
                </div>
                <div className="mt-4 flex flex-wrap items-center" style={{ gap: 10 }}>
                  <button type="button" onClick={(event) => { event.stopPropagation(); openBigPlan(task); }} className="kimix-icon-text-button is-compact text-[#625d55] hover:bg-[#f1eee8]">
                    <FileText size={14} />
                    <span>打开 BIGPLAN</span>
                  </button>
                  <button type="button" onClick={(event) => { event.stopPropagation(); openTaskDir(task); }} className="kimix-icon-text-button is-compact text-[#625d55] hover:bg-[#f1eee8]">
                    <FolderOpen size={14} />
                    <span>任务目录</span>
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(openingTaskId)}
                    onClick={(event) => {
                      event.stopPropagation();
                      void openTaskInMain(task);
                    }}
                    className="kimix-icon-text-button is-compact text-[#2f6fad] hover:bg-[#eef7ff] disabled:cursor-wait disabled:opacity-60"
                  >
                    {isOpening ? <Loader2 size={14} className="kimix-spin" /> : <MessageSquareText size={14} />}
                    <span>{isOpenInMain ? "回到主对话" : "打开主对话"}</span>
                  </button>
                </div>
              </div>
              );
            })}

            {!isLoading && tasks.length === 0 && (
              <div className="rounded-xl border border-dashed border-[#e0dbd2] bg-[#fbfaf7] text-center text-[13.5px] leading-6 text-[#8f887e]" style={{ padding: "24px 18px" }}>
                当前项目还没有长程任务
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
