import { useEffect, useRef } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { ThemeProvider } from "@/components/common/ThemeProvider";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { PendingMessage } from "@/stores/sessionStore";
import type { Session, TimelineEvent } from "@/types/ui";
import { mapHistoryEvents, mapStreamEvent, mergeEvents } from "@/utils/eventMapper";
import { deriveSessionTitle } from "@/utils/sessionTitle";
import { countUserTurns, shouldRecommendNewSession } from "@/utils/sessionMetrics";
import { getLongTaskRoleForRuntime, getRuntimeSessionId } from "@/utils/runtimeSession";

const HANDOFF_PROMPT = `请查看agent文档，给出用于交接下一个agent的提示词，注意回复内容中应该仅仅包含这段提示词。如果没有agent.md文档，请根据以下形式总结并给出提示词
- 项目背景
- 当前目标
- 已完成
- 未完成
- 阻塞
- 关键文件/命令
- 下一步最小行动`;
const LOCAL_SESSIONS_KEY = "kimix_sessions";
const LOCAL_PENDING_KEY = "kimix_pending";
const LOCAL_PERSIST_DEBOUNCE_MS = 900;
const FREEZE_REPORTS_KEY = "kimix_freeze_reports";
const STREAM_EVENT_FLUSH_MS = 80;

interface HandoffJob {
  sourceSessionId: string;
  runtimeSessionId: string;
  projectPath: string;
  recommendationEventId: string;
  events: TimelineEvent[];
}

interface StartHandoffDetail {
  sourceSessionId: string;
  projectPath: string;
  recommendationEventId: string;
}

function recordRendererLag(lagMs: number) {
  const report = {
    at: new Date().toISOString(),
    lagMs: Math.round(lagMs),
    sessionId: useAppStore.getState().currentSession?.id ?? null,
    runningSessionId: useAppStore.getState().runningSessionId,
  };
  console.warn("[Kimix] renderer event loop lag detected", report);
  try {
    const parsed = JSON.parse(localStorage.getItem(FREEZE_REPORTS_KEY) ?? "[]");
    const reports = Array.isArray(parsed) ? parsed : [];
    reports.push(report);
    localStorage.setItem(FREEZE_REPORTS_KEY, JSON.stringify(reports.slice(-20)));
  } catch {
    localStorage.setItem(FREEZE_REPORTS_KEY, JSON.stringify([report]));
  }
}

function settleInactiveEvents(events: TimelineEvent[]): TimelineEvent[] {
  const settledAt = Date.now();
  const settled = events.flatMap((event) => {
    if (event.type === "subagent") {
      return event.status === "running" ? [{ ...event, status: "completed" as const }] : [event];
    }
    if (event.type !== "assistant_message" || event.isComplete) return [event];
    const hasContent = event.content.trim().length > 0;
    const hasThinking = Boolean(event.thinking?.trim());
    if (!hasContent && !hasThinking) return [];
    return [{ ...event, isComplete: true, isThinking: false, durationMs: event.durationMs ?? Math.max(0, settledAt - event.timestamp) }];
  });
  return closeOpenCompaction(settled);
}

function closeOpenCompaction(events: TimelineEvent[]): TimelineEvent[] {
  const lastCompaction = [...events].reverse().find((event) => event.type === "compaction");
  if (!lastCompaction || lastCompaction.type !== "compaction" || lastCompaction.phase !== "begin") {
    return events;
  }
  return [
    ...events,
    {
      id: Math.random().toString(36).substring(2, 11),
      type: "compaction",
      timestamp: Date.now(),
      phase: "end",
    },
  ];
}

function findLocalSessionForRuntime(historySessionId: string, runtimeSessionId?: string): Session | undefined {
  const ids = new Set([historySessionId, runtimeSessionId].filter((id): id is string => Boolean(id)));
  return useSessionStore.getState().sessions.find((session) => (
    ids.has(session.id) ||
    Boolean(session.runtimeSessionId && ids.has(session.runtimeSessionId)) ||
    Boolean(session.longTask?.executorSessionId && ids.has(session.longTask.executorSessionId)) ||
    Boolean(session.longTask?.reviewerSessionId && ids.has(session.longTask.reviewerSessionId))
  ));
}

function persistLocalConversationState() {
  try {
    const state = useSessionStore.getState();
    const runningSessionId = useAppStore.getState().runningSessionId;
    localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(state.sessions.map((session) => ({
      ...session,
      events: session.id === runningSessionId ? session.events : settleInactiveEvents(session.events),
      isLoading: false,
    }))));
    localStorage.setItem(LOCAL_PENDING_KEY, JSON.stringify(state.pendingMessages));
  } catch (err) {
    console.warn("Persist local conversation state failed:", err);
  }
}

function appendSessionRecommendationIfNeeded(events: TimelineEvent[], enabled: boolean, turnLimit: number): TimelineEvent[] {
  const sessionLike = {
    id: "",
    title: "",
    projectPath: "",
    createdAt: 0,
    updatedAt: 0,
    events,
    isLoading: false,
  };
  if (!shouldRecommendNewSession(sessionLike, enabled, turnLimit)) return events;
  const turnCount = countUserTurns(events);
  const latest = events.at(-1);
  if (
    latest?.type === "session_recommendation" &&
    latest.reason === "turn_limit" &&
    latest.turnCount === turnCount &&
    latest.turnLimit === turnLimit
  ) {
    return events;
  }
  return [
    ...events,
    {
      id: crypto.randomUUID(),
      type: "session_recommendation",
      timestamp: Date.now(),
      reason: "turn_limit",
      turnCount,
      turnLimit,
    },
  ];
}

function updateRecommendationEvent(sessionId: string, eventId: string, patch: Partial<Extract<TimelineEvent, { type: "session_recommendation" }>>) {
  useSessionStore.getState().updateSession(sessionId, (session) => ({
    ...session,
    events: session.events.map((event) => (
      event.type === "session_recommendation" && event.id === eventId
        ? { ...event, ...patch }
        : event
    )),
    updatedAt: Date.now(),
  }));
}

function extractAssistantContent(events: TimelineEvent[]): string {
  const assistant = [...settleInactiveEvents(events)]
    .reverse()
    .find((event): event is Extract<TimelineEvent, { type: "assistant_message" }> => event.type === "assistant_message" && event.content.trim().length > 0);
  return assistant?.content.trim() ?? "";
}

function getHiddenHandoffSessionIds(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem("kimix_hidden_handoff_sessions") ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function rememberHiddenHandoffSession(sessionId: string) {
  const ids = Array.from(new Set([...getHiddenHandoffSessionIds(), sessionId]));
  localStorage.setItem("kimix_hidden_handoff_sessions", JSON.stringify(ids.slice(-50)));
}

function eventToHandoffLine(event: TimelineEvent): string | null {
  if (event.type === "user_message") return `用户：${event.content || "[图片]"}`;
  if (event.type === "steer_message") return `用户引导：${event.content}`;
  if (event.type === "assistant_message") return event.content.trim() ? `助手：${event.content.trim()}` : null;
  if (event.type === "tool_call") return `执行命令：${event.toolName} ${event.rawArguments ?? JSON.stringify(event.arguments)}`;
  if (event.type === "change_summary") {
    const files = event.files.map((file) => `${file.path} (+${file.additions ?? 0}/-${file.deletions ?? 0})`).join("；");
    return `文件变更：${files}`;
  }
  if (event.type === "file_artifact") return `文件：${event.filePath}`;
  if (event.type === "todo") return `TodoList：${event.items.map((item) => `${item.status} ${item.content}`).join("；")}`;
  if (event.type === "error") return `错误：${event.message}`;
  return null;
}

function buildHandoffPrompt(sourceSession: Session | undefined): string {
  const visibleHistory = sourceSession?.events
    .map(eventToHandoffLine)
    .filter((line): line is string => Boolean(line?.trim()))
    .slice(-80)
    .join("\n\n") || "当前没有可用的可见聊天记录。";
  return `${HANDOFF_PROMPT}

下面是 Kimix 当前窗口中可见的会话记录。请只基于这些记录生成交接提示词，不要把这次交接生成任务本身写进交接内容，不要输出解释。

会话标题：${sourceSession?.title ?? "未知会话"}
工作目录：${sourceSession?.projectPath ?? "未知目录"}

--- 可见会话记录开始 ---
${visibleHistory}
--- 可见会话记录结束 ---`;
}

function resolveUiSessionId(sessionId: string): string {
  const owner = useSessionStore.getState().sessions.find((session) => (
    session.runtimeSessionId === sessionId ||
    session.longTask?.executorSessionId === sessionId ||
    session.longTask?.reviewerSessionId === sessionId
  ));
  return owner?.id ?? sessionId;
}

function resolveRuntimeSessionId(sessionId: string): string {
  const owner = useSessionStore.getState().sessions.find((session) => session.id === sessionId);
  return getRuntimeSessionId(owner) ?? sessionId;
}

function markLongTaskRuntimeActivity(uiSessionId: string, runtimeSessionId: string, status?: "running" | "error" | "interrupted" | "completed") {
  const store = useSessionStore.getState();
  const target = store.sessions.find((session) => session.id === uiSessionId);
  const role = getLongTaskRoleForRuntime(target, runtimeSessionId);
  if (!target?.longTask || !role) return;

  store.updateSession(uiSessionId, (session) => {
    if (!session.longTask) return session;
    let stage = session.longTask.stage;
    if (status === "interrupted" || status === "error") {
      stage = "paused";
    } else if (status === "running" && role === "reviewer") {
      stage = "reviewing";
    } else if (status === "running" && role === "executor" && stage === "reviewing") {
      stage = "running";
    }
    return {
      ...session,
      longTask: {
        ...session.longTask,
        activeAgent: role,
        stage,
      },
      updatedAt: Date.now(),
    };
  });
  const latest = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
  if (latest?.longTask) {
    void window.api.updateLongTaskState({
      projectPath: latest.projectPath,
      taskId: latest.longTask.taskId,
      patch: {
        activeAgent: latest.longTask.activeAgent,
        stage: latest.longTask.stage,
        currentStep: latest.longTask.currentStep,
        targetStep: latest.longTask.targetStep,
        reviewedReviewItems: latest.longTask.reviewedReviewItems ?? [],
      },
    }).catch(() => {});
  }

  const active = useAppStore.getState().currentSession;
  if (active?.id === uiSessionId) {
    if (latest) useAppStore.getState().setCurrentSession(latest);
  }
}

function hasPendingQuestion(events: TimelineEvent[]) {
  return events.some((event) => event.type === "question_request" && event.status === "pending");
}

function latestAssistantContent(events: TimelineEvent[]) {
  return [...events].reverse().find((event): event is Extract<TimelineEvent, { type: "assistant_message" }> => (
    event.type === "assistant_message" && event.content.trim().length > 0
  ))?.content.trim() ?? "";
}

function extractLongTaskStepNumbers(content: string) {
  const numbers: number[] = [];
  const patterns = [
    /当前步骤[：:\s]*(\d+)/gi,
    /Step\s*(\d+)/gi,
    /step\s*(\d+)/gi,
    /rounds\/step(\d+)\.md/gi,
  ];
  patterns.forEach((pattern) => {
    for (const match of content.matchAll(pattern)) {
      const value = Number(match[1]);
      if (Number.isInteger(value) && value > 0) numbers.push(value);
    }
  });
  return numbers;
}

function extractLongTaskCurrentStep(content: string) {
  const patterns = [
    /当前步骤[：:\s]*(\d+)/gi,
    /Step\s*(\d+)\s*(?:执行完成|完成|已完成|已修复|修复完成|交给审查|交给审查\s*agent)/gi,
    /rounds\/step(\d+)\.md/gi,
  ];
  const numbers: number[] = [];
  patterns.forEach((pattern) => {
    for (const match of content.matchAll(pattern)) {
      const value = Number(match[1]);
      if (Number.isInteger(value) && value > 0) numbers.push(value);
    }
  });
  return numbers.length > 0 ? Math.max(...numbers) : null;
}

function inferLongTaskProgressPatch(session: Session, runtimeSessionId: string) {
  const meta = session.longTask;
  if (!meta || meta.executorSessionId !== runtimeSessionId) return null;
  const content = latestAssistantContent(session.events);
  if (!content) return null;

  const stepNumbers = extractLongTaskStepNumbers(content);
  const maxStep = stepNumbers.length > 0 ? Math.max(...stepNumbers) : null;
  const currentStep = extractLongTaskCurrentStep(content);
  const asksForPlanConfirmation = /请确认|是否同意|确认后.*开始执行|进入执行阶段|开始执行\s*Step/i.test(content) &&
    /计划|BIGPLAN|Step\s*\d+/i.test(content);
  const executionProgress = /执行完成|已写入执行记录|rounds\/step\d+\.md|待审查|交给审查\s*agent|当前步骤[：:\s]*\d+/i.test(content);

  const patch: Partial<NonNullable<Session["longTask"]>> = {};
  if (asksForPlanConfirmation) {
    patch.stage = "ready";
    if (maxStep && !meta.targetStep) patch.targetStep = maxStep;
  }
  if (executionProgress) {
    patch.stage = "running";
    if (currentStep) patch.currentStep = currentStep;
    if (maxStep && !meta.targetStep) patch.targetStep = maxStep;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function applyLongTaskProgressFromLatestOutput(uiSessionId: string, runtimeSessionId: string) {
  const current = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
  if (!current?.longTask) return current;
  const patch = inferLongTaskProgressPatch(current, runtimeSessionId);
  if (!patch) return current;

  useSessionStore.getState().updateSession(uiSessionId, (session) => {
    if (!session.longTask) return session;
    return {
      ...session,
      longTask: {
        ...session.longTask,
        ...patch,
      },
      updatedAt: Date.now(),
    };
  });

  const latest = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
  if (latest?.longTask) {
    void window.api.updateLongTaskState({
      projectPath: latest.projectPath,
      taskId: latest.longTask.taskId,
      patch: {
        activeAgent: latest.longTask.activeAgent,
        stage: latest.longTask.stage,
        currentStep: latest.longTask.currentStep,
        targetStep: latest.longTask.targetStep,
        reviewedReviewItems: latest.longTask.reviewedReviewItems ?? [],
      },
    }).catch(() => {});
    const active = useAppStore.getState().currentSession;
    if (active?.id === uiSessionId) useAppStore.getState().setCurrentSession(latest);
  }
  return latest ?? current;
}

function isExecutionReviewHandoff(content: string) {
  const asksReview = /审查\s*agent|reviewer\s*agent|审查意见|交给.*审查/i.test(content);
  const executionEvidence = /执行完成|已写入执行记录|rounds\/step\d+\.md|待审查|当前步骤[：:\s]*\d+|Step\s*\d+.*执行完成/i.test(content);
  return asksReview && executionEvidence;
}

function normalizeLongTaskPlanningSession<T extends Session>(session: T): T {
  if (!session.longTask || !["drafting", "planning", "ready"].includes(session.longTask.stage)) return session;
  if (session.longTask.activeAgent === "executor" && session.runtimeSessionId === session.longTask.executorSessionId) return session;
  return {
    ...session,
    runtimeSessionId: session.longTask.executorSessionId,
    longTask: {
      ...session.longTask,
      activeAgent: "executor",
    },
  };
}

function hydrateLongTaskProgressFromHistory<T extends Session>(session: T): T {
  const normalized = normalizeLongTaskPlanningSession(session);
  if (!normalized.longTask) return normalized;
  const patch = inferLongTaskProgressPatch(normalized, normalized.longTask.executorSessionId);
  if (!patch) return normalized;
  return {
    ...normalized,
    runtimeSessionId: patch.stage === "reviewing" ? normalized.longTask.reviewerSessionId : normalized.longTask.executorSessionId,
    longTask: {
      ...normalized.longTask,
      ...patch,
    },
  };
}

function shouldStartLongTaskReview(session: Session, runtimeSessionId: string) {
  if (!session.longTask) return false;
  if (session.longTask.executorSessionId !== runtimeSessionId) return false;
  if (session.longTask.stage === "reviewing" || session.longTask.activeAgent === "reviewer") return false;
  if (session.longTask.stage !== "running") return false;
  if (hasPendingQuestion(session.events)) return false;
  const content = latestAssistantContent(session.events);
  return isExecutionReviewHandoff(content);
}

function buildLongTaskReviewPrompt(session: Session) {
  const meta = session.longTask;
  if (!meta) return "";
  const executorOutput = latestAssistantContent(session.events);
  return `【Kimix 长程任务：请审查执行 agent 的本轮执行结果】
你正在作为 Kimix 长程任务的审查 agent 工作。

请先阅读：
- ${meta.reviewQueuePath}
- ${meta.bigPlanPath}

审查目标：
1. 检查本轮执行结果是否符合 BIGPLAN.md 中当前步骤的目标、范围和验收标准。
2. 如果计划不可执行或步骤过大，请给出需修复的问题，后续由 Kimix 交回执行 agent 修复。
3. 暂时无法自动确认的问题，请写入 ${meta.reviewQueuePath}。
4. 不要直接执行代码修改；本轮只做执行结果审查。

执行 agent 最近输出：
${executorOutput || "暂无可用输出，请直接读取 BIGPLAN.md 审查。"}`;
}

type LongTaskReviewConclusion = "pass" | "needs_fix" | "manual_review" | "unknown";

function inferLongTaskReviewConclusion(content: string): LongTaskReviewConclusion {
  const conclusionLine = content.match(/结论[：:\s]*([^\n\r]+)/i)?.[1]?.trim() ?? "";
  const target = conclusionLine || content.slice(0, 1200);
  if (/需修复|需要修复|不通过|未通过|阻塞|问题必须先修复/i.test(target)) return "needs_fix";
  if (/待人工审查|人工审查|需要用户|无法自动确认|无法自动审查/i.test(target)) return "manual_review";
  if (/通过|审查通过|可以继续|进入下一步/i.test(target)) return "pass";
  return "unknown";
}

function longTaskConclusionLabel(conclusion: LongTaskReviewConclusion) {
  const labels: Record<LongTaskReviewConclusion, string> = {
    pass: "通过",
    needs_fix: "需修复",
    manual_review: "待人工审查",
    unknown: "未知",
  };
  return labels[conclusion];
}

function buildLongTaskExecutorPromptFromReview(session: Session, conclusion: LongTaskReviewConclusion) {
  const meta = session.longTask;
  if (!meta) return "";
  const reviewerOutput = latestAssistantContent(session.events);
  const step = meta.currentStep || 1;
  if (conclusion === "needs_fix") {
    return `【Kimix 长程任务：审查发现问题，请先修复】
审查 agent 对 Step ${step} 的结论是“需修复”。

请你作为执行 agent：
1. 先阅读 ${meta.bigPlanPath} 和审查意见。
2. 只修复审查指出的问题，不进入下一步。
3. 修复完成后更新必要文件，并把本轮修复、验证证据、残余风险写入 rounds/ 对应记录。
4. 结束时明确写出“Step ${step} 修复完成，交给审查 agent 审查”。

审查意见：
${reviewerOutput || "审查 agent 未给出可用正文，请读取任务文件后修复。"}`
  }

  const nextStep = step + 1;
  const reviewLabel = conclusion === "manual_review"
    ? "审查 agent 已留下待人工审查项，但本轮从计划推进角度可以继续"
    : "审查 agent 已通过";
  return `【Kimix 长程任务：审查可继续，请执行下一步】
${reviewLabel} Step ${step}。现在请继续执行 Step ${nextStep}。

请你作为执行 agent：
1. 先阅读 ${meta.bigPlanPath}，只执行 Step ${nextStep} 这一轮。
2. 不要把后续多个 Step 合并执行。
3. 完成后更新必要文件，并把本轮产出、验证证据、残余风险写入 rounds/ 对应记录。
4. 结束时明确写出“Step ${nextStep} 执行完成，交给审查 agent 审查”。

审查 agent 对上一轮的意见：
${reviewerOutput || "审查 agent 未给出可用正文，请按 BIGPLAN.md 继续。"}`
}

async function createSessionAndSendPrompt(projectPath: string, content: string) {
  const appState = useAppStore.getState();
  const sessionStore = useSessionStore.getState();
  const sessionRes = await window.api.startSession({
    workDir: projectPath,
    model: "kimi-code/kimi-for-coding",
    thinking: appState.defaultThinking,
    yoloMode: appState.permissionMode === "yolo",
  });
  if (!sessionRes.success) throw new Error(sessionRes.error);

  const session = {
    id: sessionRes.data.sessionId,
    title: "交接新会话",
    projectPath,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    events: [] as TimelineEvent[],
    isLoading: false,
  };
  sessionStore.addSession(session);
  appState.setCurrentSession(session);

  const userEvent: TimelineEvent = {
    id: crypto.randomUUID(),
    type: "user_message",
    timestamp: Date.now(),
    content,
  };
  const responsePlaceholder: TimelineEvent = {
    id: crypto.randomUUID(),
    type: "assistant_message",
    timestamp: Date.now(),
    content: "",
    isThinking: appState.defaultThinking,
    isComplete: false,
  };
  useSessionStore.getState().updateSession(session.id, (current) => ({
    ...current,
    events: [userEvent, responsePlaceholder],
    updatedAt: Date.now(),
  }));
  useAppStore.getState().setRunningSessionId(session.id);
  await window.api.sendPrompt({
    sessionId: session.id,
    content,
    thinking: appState.defaultThinking,
    yoloMode: appState.permissionMode === "yolo",
  });
}

function App() {
  const setTheme = useAppStore((s) => s.setTheme);
  const setPermissionMode = useAppStore((s) => s.setPermissionMode);
  const setDefaultThinking = useAppStore((s) => s.setDefaultThinking);
  const setDetailedContext = useAppStore((s) => s.setDetailedContext);
  const setStatusUpdateDisplay = useAppStore((s) => s.setStatusUpdateDisplay);
  const setSessionRecommendationEnabled = useAppStore((s) => s.setSessionRecommendationEnabled);
  const setSessionRecommendationTurnLimit = useAppStore((s) => s.setSessionRecommendationTurnLimit);
  const setVoiceShortcut = useAppStore((s) => s.setVoiceShortcut);
  const setClarificationToolMode = useAppStore((s) => s.setClarificationToolMode);
  const setHandoffSessionId = useAppStore((s) => s.setHandoffSessionId);
  const setRunningSessionId = useAppStore((s) => s.setRunningSessionId);
  const defaultThinking = useAppStore((s) => s.defaultThinking);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const triggerFocusInput = useAppStore((s) => s.triggerFocusInput);
  const updateSession = useSessionStore((s) => s.updateSession);
  const setRecentProjects = useSessionStore((s) => s.setRecentProjects);
  const currentSession = useAppStore((s) => s.currentSession);
  const currentSessionRef = useRef(currentSession);
  currentSessionRef.current = currentSession;
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const persistenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamBatchRef = useRef<Map<string, TimelineEvent[]>>(new Map());
  const streamFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootstrapDoneRef = useRef(false);
  const handoffJobRef = useRef<HandoffJob | null>(null);
  const longTaskReviewDispatchRef = useRef<Set<string>>(new Set());
  const longTaskRoundAppendRef = useRef<Set<string>>(new Set());

  const syncCurrentSessionFromStore = (uiSessionId: string) => {
    const latest = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
    if (!latest) return;
    const active = useAppStore.getState().currentSession;
    if (active?.id === uiSessionId) {
      useAppStore.getState().setCurrentSession(latest);
    }
  };

  const persistLongTaskMeta = (session: Session | undefined) => {
    if (!session?.longTask) return;
    void window.api.updateLongTaskState({
      projectPath: session.projectPath,
      taskId: session.longTask.taskId,
      patch: {
        activeAgent: session.longTask.activeAgent,
        stage: session.longTask.stage,
        currentStep: session.longTask.currentStep,
        targetStep: session.longTask.targetStep,
        reviewedReviewItems: session.longTask.reviewedReviewItems ?? [],
      },
    }).catch(() => {});
  };

  const appendLongTaskRoundOnce = (
    session: Session,
    payload: {
      step: number;
      role: "executor" | "reviewer";
      phase: "execution" | "review" | "fix" | "handoff" | "complete";
      conclusion?: string;
      content: string;
    },
  ) => {
    if (!session.longTask) return;
    const key = [
      session.longTask.taskId,
      payload.step,
      payload.role,
      payload.phase,
      session.events.length,
      payload.conclusion ?? "",
    ].join(":");
    if (longTaskRoundAppendRef.current.has(key)) return;
    longTaskRoundAppendRef.current.add(key);
    void window.api.appendLongTaskRound({
      projectPath: session.projectPath,
      taskId: session.longTask.taskId,
      ...payload,
    }).catch(() => {});
  };

  const dispatchLongTaskReview = (uiSessionId: string, runtimeSessionId: string) => {
    const latestSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
    const reviewKey = `${uiSessionId}:${runtimeSessionId}:${latestSession?.events.length ?? 0}`;
    if (!latestSession?.longTask || !shouldStartLongTaskReview(latestSession, runtimeSessionId) || longTaskReviewDispatchRef.current.has(reviewKey)) {
      return false;
    }
    longTaskReviewDispatchRef.current.add(reviewKey);
    appendLongTaskRoundOnce(latestSession, {
      step: latestSession.longTask.currentStep || 1,
      role: "executor",
      phase: "execution",
      content: latestAssistantContent(latestSession.events),
    });
    updateSession(uiSessionId, (session) => session.longTask ? {
      ...session,
      runtimeSessionId: session.longTask.reviewerSessionId,
      longTask: {
        ...session.longTask,
        activeAgent: "reviewer",
        stage: "reviewing",
      },
      events: [
        ...session.events,
        {
          id: crypto.randomUUID(),
          type: "assistant_message" as const,
          timestamp: Date.now(),
          content: "",
          isThinking: true,
          isComplete: false,
        },
      ],
      updatedAt: Date.now(),
    } : session);
    syncCurrentSessionFromStore(uiSessionId);
    const latestForPrompt = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId) ?? latestSession;
    if (latestForPrompt.longTask) {
      void window.api.updateLongTaskState({
        projectPath: latestForPrompt.projectPath,
        taskId: latestForPrompt.longTask.taskId,
        patch: {
          activeAgent: latestForPrompt.longTask.activeAgent,
          stage: latestForPrompt.longTask.stage,
          currentStep: latestForPrompt.longTask.currentStep,
          targetStep: latestForPrompt.longTask.targetStep,
          reviewedReviewItems: latestForPrompt.longTask.reviewedReviewItems ?? [],
        },
      }).catch(() => {});
    }
    setRunningSessionId(uiSessionId);
    void window.api.sendPrompt({
      sessionId: latestSession.longTask.reviewerSessionId,
      content: buildLongTaskReviewPrompt(latestForPrompt),
      thinking: defaultThinking,
      yoloMode: permissionMode === "yolo",
    }).then((res) => {
      if (res.success) return;
      throw new Error(res.error);
    }).catch((err: unknown) => {
      let failedSession: Session | undefined;
      updateSession(uiSessionId, (session) => ({
        ...session,
        longTask: session.longTask ? {
          ...session.longTask,
          activeAgent: "reviewer",
          stage: "paused",
        } : session.longTask,
        events: [
          ...session.events.filter((event) => !(event.type === "assistant_message" && !event.isComplete && !event.content.trim())),
          {
            id: crypto.randomUUID(),
            type: "error" as const,
            timestamp: Date.now(),
            message: `启动审查 agent 失败：${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        updatedAt: Date.now(),
      }));
      failedSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
      if (failedSession?.longTask) {
        void window.api.updateLongTaskState({
          projectPath: failedSession.projectPath,
          taskId: failedSession.longTask.taskId,
          patch: {
            activeAgent: failedSession.longTask.activeAgent,
            stage: failedSession.longTask.stage,
            currentStep: failedSession.longTask.currentStep,
            targetStep: failedSession.longTask.targetStep,
            reviewedReviewItems: failedSession.longTask.reviewedReviewItems ?? [],
          },
        }).catch(() => {});
      }
      setRunningSessionId(null);
    });
    return true;
  };

  const dispatchLongTaskExecutorFromReview = (uiSessionId: string, runtimeSessionId: string) => {
    const latestSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
    if (!latestSession?.longTask) return false;
    if (latestSession.longTask.reviewerSessionId !== runtimeSessionId) return false;
    if (latestSession.longTask.stage !== "reviewing" && latestSession.longTask.activeAgent !== "reviewer") return false;
    if (hasPendingQuestion(latestSession.events)) return false;

    const conclusion = inferLongTaskReviewConclusion(latestAssistantContent(latestSession.events));
    if (conclusion === "unknown") return false;

    const currentStep = latestSession.longTask.currentStep || 1;
    const targetStep = latestSession.longTask.targetStep;
    appendLongTaskRoundOnce(latestSession, {
      step: currentStep,
      role: "reviewer",
      phase: "review",
      conclusion: longTaskConclusionLabel(conclusion),
      content: latestAssistantContent(latestSession.events),
    });
    if ((conclusion === "pass" || conclusion === "manual_review") && targetStep && currentStep >= targetStep) {
      updateSession(uiSessionId, (session) => session.longTask ? {
        ...session,
        runtimeSessionId: session.longTask.executorSessionId,
        longTask: {
          ...session.longTask,
          activeAgent: "executor",
          stage: "completed",
        },
        updatedAt: Date.now(),
      } : session);
      syncCurrentSessionFromStore(uiSessionId);
      persistLongTaskMeta(useSessionStore.getState().sessions.find((session) => session.id === uiSessionId));
      appendLongTaskRoundOnce(latestSession, {
        step: currentStep,
        role: "reviewer",
        phase: "complete",
        conclusion: longTaskConclusionLabel(conclusion),
        content: `目标 Step ${targetStep} 已达到，长程任务本轮执行范围完成。`,
      });
      return true;
    }

    const prompt = buildLongTaskExecutorPromptFromReview(latestSession, conclusion);
    const nextStep = conclusion === "needs_fix" ? currentStep : currentStep + 1;
    appendLongTaskRoundOnce(latestSession, {
      step: nextStep,
      role: "executor",
      phase: conclusion === "needs_fix" ? "fix" : "handoff",
      conclusion: longTaskConclusionLabel(conclusion),
      content: prompt,
    });
    updateSession(uiSessionId, (session) => session.longTask ? {
      ...session,
      runtimeSessionId: session.longTask.executorSessionId,
      longTask: {
        ...session.longTask,
        activeAgent: "executor",
        stage: "running",
        currentStep: nextStep,
      },
      events: [
        ...session.events,
        {
          id: crypto.randomUUID(),
          type: "assistant_message" as const,
          timestamp: Date.now(),
          content: "",
          isThinking: true,
          isComplete: false,
        },
      ],
      updatedAt: Date.now(),
    } : session);
    syncCurrentSessionFromStore(uiSessionId);
    persistLongTaskMeta(useSessionStore.getState().sessions.find((session) => session.id === uiSessionId));
    setRunningSessionId(uiSessionId);
    void window.api.sendPrompt({
      sessionId: latestSession.longTask.executorSessionId,
      content: prompt,
      thinking: defaultThinking,
      yoloMode: permissionMode === "yolo",
    }).then((res) => {
      if (res.success) return;
      throw new Error(res.error);
    }).catch((err: unknown) => {
      updateSession(uiSessionId, (session) => ({
        ...session,
        longTask: session.longTask ? {
          ...session.longTask,
          activeAgent: "executor",
          stage: "paused",
        } : session.longTask,
        events: [
          ...session.events.filter((event) => !(event.type === "assistant_message" && !event.isComplete && !event.content.trim())),
          {
            id: crypto.randomUUID(),
            type: "error" as const,
            timestamp: Date.now(),
            message: `启动执行 agent 失败：${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        updatedAt: Date.now(),
      }));
      syncCurrentSessionFromStore(uiSessionId);
      persistLongTaskMeta(useSessionStore.getState().sessions.find((session) => session.id === uiSessionId));
      setRunningSessionId(null);
    });
    return true;
  };

  useEffect(() => {
    let lastTick = performance.now();
    const lagTimer = window.setInterval(() => {
      const now = performance.now();
      const lagMs = now - lastTick - 1000;
      lastTick = now;
      if (lagMs > 2500) recordRendererLag(lagMs);
    }, 1000);

    window.api.getSettings().then((res) => {
      if (res.success) {
        setTheme(res.data.theme);
        setPermissionMode(res.data.defaultPermissionMode);
        setDefaultThinking(res.data.defaultThinking);
        setDetailedContext(res.data.detailedContext);
        setStatusUpdateDisplay(res.data.statusUpdateDisplay);
        setSessionRecommendationEnabled(res.data.sessionRecommendationEnabled);
        setSessionRecommendationTurnLimit(res.data.sessionRecommendationTurnLimit);
        setVoiceShortcut(res.data.voiceShortcut);
        setClarificationToolMode(res.data.clarificationToolMode);
      }
    }).catch(() => {});

    window.api.listRecentProjects().then((res) => {
      if (res.success) {
        setRecentProjects(res.data);
        if (!useAppStore.getState().currentProject && res.data[0]) {
          useAppStore.setState({ currentProject: res.data[0] });
        }
      }
    }).catch(() => {});

    const unsubscribeBootstrap = window.api.onBootstrap((payload) => {
      if (bootstrapDoneRef.current) return;
      bootstrapDoneRef.current = true;
      useAppStore.setState({ currentProject: payload.project });

      window.api.listRecentProjects().then((res) => {
        if (res.success) setRecentProjects(res.data);
      }).catch(() => {});

      window.api.listSessions({ workDir: payload.project.path }).then(async (res) => {
        if (!res.success) return;
        const hiddenHandoffSessionIds = new Set(getHiddenHandoffSessionIds());
        const latest = res.data.find((session) => !hiddenHandoffSessionIds.has(session.id));
        const startRes = await window.api.startSession({
          workDir: payload.project.path,
          sessionId: latest?.id,
          thinking: useAppStore.getState().defaultThinking,
          yoloMode: useAppStore.getState().permissionMode === "yolo",
        });
        if (!startRes.success || !latest) return;
        const runtimeOwner = findLocalSessionForRuntime(latest.id, startRes.data.sessionId);
        if (runtimeOwner && runtimeOwner.events.length > 0) {
          const session = hydrateLongTaskProgressFromHistory({
            ...runtimeOwner,
            runtimeSessionId: startRes.data.sessionId,
            events: settleInactiveEvents(runtimeOwner.events),
            isLoading: false,
          });
          useSessionStore.setState((state) => ({
            sessions: state.sessions.map((item) => (item.id === session.id ? session : item)),
          }));
          useAppStore.setState({ currentSession: session });
          setRunningSessionId(null);
          return;
        }

        const loaded = await window.api.loadSession({
          workDir: payload.project.path,
          sessionId: latest.id,
        });
        if (!loaded.success) return;
        const events = settleInactiveEvents(mapHistoryEvents(Array.isArray(loaded.data.events) ? loaded.data.events : []));

        const session = {
          id: startRes.data.sessionId,
          title: deriveSessionTitle(events, latest.brief || "新会话"),
          projectPath: payload.project.path,
          createdAt: latest.updatedAt,
          updatedAt: latest.updatedAt,
          events,
          isLoading: false,
        };

        useSessionStore.setState((state) => ({
          sessions: state.sessions.some((item) => item.id === session.id)
            ? state.sessions.map((item) => (item.id === session.id ? session : item))
            : [session, ...state.sessions],
        }));
        useAppStore.setState({ currentSession: session });
        setRunningSessionId(null);
      }).catch(() => {});
    });

    const storedSessions = localStorage.getItem(LOCAL_SESSIONS_KEY);
    if (storedSessions) {
      try {
        const parsed = JSON.parse(storedSessions);
        if (Array.isArray(parsed)) {
          useSessionStore.setState({
            sessions: parsed.map((session) => hydrateLongTaskProgressFromHistory({
              ...session,
              events: Array.isArray(session.events) ? settleInactiveEvents(session.events) : [],
              isLoading: false,
            })),
          });
        }
      } catch {
        // ignore parse error
      }
    }

    const storedPending = localStorage.getItem(LOCAL_PENDING_KEY);
    if (storedPending) {
      try {
        const parsed = JSON.parse(storedPending);
        if (Array.isArray(parsed)) {
          const pendingMessages = parsed
            .map((item) => {
              if (typeof item === "string") {
                return { id: crypto.randomUUID(), content: item, createdAt: Date.now() };
              }
              if (item && typeof item === "object" && typeof item.id === "string" && typeof item.content === "string" && typeof item.createdAt === "number") {
                return item;
              }
              return null;
            })
            .filter((item): item is PendingMessage => item !== null);
          useSessionStore.setState({ pendingMessages });
        }
      } catch {
        // ignore
      }
    }

    const flushLocalConversationState = () => {
      if (persistenceTimerRef.current) {
        clearTimeout(persistenceTimerRef.current);
        persistenceTimerRef.current = null;
      }
      persistLocalConversationState();
    };
    const scheduleLocalConversationPersist = () => {
      if (persistenceTimerRef.current) clearTimeout(persistenceTimerRef.current);
      persistenceTimerRef.current = setTimeout(() => {
        persistenceTimerRef.current = null;
        persistLocalConversationState();
      }, LOCAL_PERSIST_DEBOUNCE_MS);
    };
    const unsubscribeSessionPersistence = useSessionStore.subscribe((state, prev) => {
      if (state.sessions === prev.sessions && state.pendingMessages === prev.pendingMessages) return;
      scheduleLocalConversationPersist();
    });
    const handleBeforeUnload = flushLocalConversationState;
    window.addEventListener("beforeunload", handleBeforeUnload);

    const flushStreamEvents = () => {
      streamFlushTimerRef.current = null;
      const batches = streamBatchRef.current;
      if (batches.size === 0) return;
      streamBatchRef.current = new Map();
      batches.forEach((items, uiSessionId) => {
        updateSession(uiSessionId, (session) => {
          let events = session.events;
          for (const item of items) {
            events = mergeEvents(events, item);
          }
          const title = deriveSessionTitle(events, session.title);
          return { ...session, events, title, updatedAt: Date.now() };
        });
      });
    };

    const enqueueStreamEvent = (uiSessionId: string, event: TimelineEvent) => {
      const current = streamBatchRef.current.get(uiSessionId) ?? [];
      current.push(event);
      streamBatchRef.current.set(uiSessionId, current);
      if (!streamFlushTimerRef.current) {
        streamFlushTimerRef.current = setTimeout(flushStreamEvents, STREAM_EVENT_FLUSH_MS);
      }
    };

    const finishHandoffJob = async (job: HandoffJob, status: "completed" | "error" | "interrupted") => {
      handoffJobRef.current = null;
      void window.api.closeSession({ sessionId: job.runtimeSessionId }).catch(() => {});
      if (status !== "completed") {
        setHandoffSessionId(null);
        setRunningSessionId(null);
        updateRecommendationEvent(job.sourceSessionId, job.recommendationEventId, {
          handoffStatus: "error",
          handoffError: status === "interrupted" ? "交接生成被中断" : "交接生成失败",
        });
        return;
      }
      const content = extractAssistantContent(job.events);
      if (!content) {
        setHandoffSessionId(null);
        setRunningSessionId(null);
        updateRecommendationEvent(job.sourceSessionId, job.recommendationEventId, {
          handoffStatus: "error",
          handoffError: "未生成可用交接内容",
        });
        return;
      }
      try {
        await createSessionAndSendPrompt(job.projectPath, content);
        setHandoffSessionId(null);
        updateRecommendationEvent(job.sourceSessionId, job.recommendationEventId, { handoffStatus: "completed" });
      } catch (err) {
        setHandoffSessionId(null);
        setRunningSessionId(null);
        updateRecommendationEvent(job.sourceSessionId, job.recommendationEventId, {
          handoffStatus: "error",
          handoffError: err instanceof Error ? err.message : String(err),
        });
      }
    };

    const handleStartHandoff = (event: Event) => {
      const detail = (event as CustomEvent<StartHandoffDetail>).detail;
      if (!detail?.sourceSessionId || !detail.projectPath || !detail.recommendationEventId) return;
      if (handoffJobRef.current) return;
      setHandoffSessionId(detail.sourceSessionId);
      setRunningSessionId(detail.sourceSessionId);
      updateRecommendationEvent(detail.sourceSessionId, detail.recommendationEventId, {
        handoffStatus: "running",
        handoffError: undefined,
      });
      const sourceSession = useSessionStore.getState().sessions.find((session) => session.id === detail.sourceSessionId);
      void (async () => {
        const startRes = await window.api.startSession({
          workDir: detail.projectPath,
          model: "kimi-code/kimi-for-coding",
          thinking: useAppStore.getState().defaultThinking,
          yoloMode: useAppStore.getState().permissionMode === "yolo",
        });
        if (!startRes.success) throw new Error(startRes.error);
        rememberHiddenHandoffSession(startRes.data.sessionId);
        handoffJobRef.current = {
          sourceSessionId: detail.sourceSessionId,
          runtimeSessionId: startRes.data.sessionId,
          projectPath: detail.projectPath,
          recommendationEventId: detail.recommendationEventId,
          events: [],
        };
        const prompt = buildHandoffPrompt(sourceSession);
        const sendRes = await window.api.sendPrompt({
          sessionId: startRes.data.sessionId,
          content: prompt,
          thinking: useAppStore.getState().defaultThinking,
          yoloMode: useAppStore.getState().permissionMode === "yolo",
        });
        if (!sendRes.success) throw new Error(sendRes.error);
      })().catch((err) => {
        const job = handoffJobRef.current;
        handoffJobRef.current = null;
        setHandoffSessionId(null);
        setRunningSessionId(null);
        if (job?.runtimeSessionId) void window.api.closeSession({ sessionId: job.runtimeSessionId }).catch(() => {});
        updateRecommendationEvent(detail.sourceSessionId, detail.recommendationEventId, {
          handoffStatus: "error",
          handoffError: err instanceof Error ? err.message : String(err),
        });
      });
    };
    window.addEventListener("kimix:startHandoff", handleStartHandoff);

    const unsubscribeEvent = window.api.onKimiEvent((payload) => {
      if (!payload.event) return;
      const mapped = mapStreamEvent(payload.event);
      if (mapped) {
        const handoffJob = handoffJobRef.current;
        if (handoffJob?.runtimeSessionId === payload.sessionId) {
          handoffJob.events = mergeEvents(handoffJob.events, mapped);
          return;
        }
        const uiSessionId = resolveUiSessionId(payload.sessionId);
        markLongTaskRuntimeActivity(uiSessionId, payload.sessionId);
        enqueueStreamEvent(uiSessionId, mapped);
        if (mapped.type === "question_request") {
          flushStreamEvents();
          persistLocalConversationState();
        }
      }
    });

    const unsubscribeStatus = window.api.onKimiStatus((payload) => {
      const handoffJob = handoffJobRef.current;
      if (handoffJob?.runtimeSessionId === payload.sessionId) {
        if (payload.status === "running") {
          setRunningSessionId(handoffJob.sourceSessionId);
          return;
        }
        if (["completed", "error", "interrupted"].includes(payload.status)) {
          void finishHandoffJob(handoffJob, payload.status as "completed" | "error" | "interrupted");
          return;
        }
      }

      if (payload.status === "running") {
        const uiSessionId = resolveUiSessionId(payload.sessionId);
        markLongTaskRuntimeActivity(uiSessionId, payload.sessionId, "running");
        setRunningSessionId(uiSessionId);
        return;
      }

      if (!["completed", "error", "interrupted"].includes(payload.status)) {
        return;
      }

      const uiSessionId = resolveUiSessionId(payload.sessionId);
      const terminalStatus = payload.status as "completed" | "error" | "interrupted";
      flushStreamEvents();
      markLongTaskRuntimeActivity(uiSessionId, payload.sessionId, terminalStatus);
      if (useAppStore.getState().runningSessionId === uiSessionId) {
        setRunningSessionId(null);
      }

      if (payload.status === "error" || payload.status === "interrupted") {
        updateSession(uiSessionId, (session) => ({
          ...session,
          events: closeOpenCompaction(session.events.filter((event) => !(event.type === "assistant_message" && !event.isComplete))),
          updatedAt: Date.now(),
        }));
      }

      if (payload.status === "completed") {
        updateSession(uiSessionId, (session) => ({
          ...session,
          events: appendSessionRecommendationIfNeeded(
            settleInactiveEvents(session.events),
            useAppStore.getState().sessionRecommendationEnabled,
            useAppStore.getState().sessionRecommendationTurnLimit,
          ),
          updatedAt: Date.now(),
        }));

        applyLongTaskProgressFromLatestOutput(uiSessionId, payload.sessionId);
        if (dispatchLongTaskReview(uiSessionId, payload.sessionId)) {
          return;
        }
        if (dispatchLongTaskExecutorFromReview(uiSessionId, payload.sessionId)) {
          return;
        }

        const next = useSessionStore.getState().shiftPendingMessage();
        if (next) {
          const userEventId = Math.random().toString(36).substring(2, 11);
          const placeholderId = Math.random().toString(36).substring(2, 11);
          updateSession(uiSessionId, (session) => ({
            ...session,
            events: [
              ...session.events,
              {
                id: userEventId,
                type: "user_message" as const,
                timestamp: Date.now(),
                content: next.content,
              },
              {
                id: placeholderId,
                type: "assistant_message" as const,
                timestamp: Date.now(),
                content: "",
                isThinking: defaultThinking,
                isComplete: false,
              },
            ],
            updatedAt: Date.now(),
          }));
          setRunningSessionId(uiSessionId);
          const timer = setTimeout(() => {
            const runtimeSessionId = resolveRuntimeSessionId(uiSessionId);
            window.api.sendPrompt({
              sessionId: runtimeSessionId,
              content: next.content,
              thinking: defaultThinking,
              yoloMode: permissionMode === "yolo",
            }).then((res) => {
              if (res.success) return;
              throw new Error(res.error);
            }).catch(() => {
              updateSession(uiSessionId, (session) => ({
                ...session,
                events: session.events.filter((event) => event.id !== placeholderId && event.id !== userEventId),
                updatedAt: Date.now(),
              }));
              setRunningSessionId(null);
            });
          }, 300);
          timersRef.current.push(timer);
        }
      }
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.querySelector('[aria-modal="true"]')) return;

      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      const isMod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape") {
        const sessionId = useAppStore.getState().runningSessionId ?? currentSessionRef.current?.id;
        if (sessionId) {
          setRunningSessionId(null);
          window.api.stopTurn({ sessionId: resolveRuntimeSessionId(sessionId) }).catch(() => {});
        }
        return;
      }
      if (isMod && e.key === "b") {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      if (isMod && e.key === "k") {
        e.preventDefault();
        triggerFocusInput();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    const unsubSettings = useAppStore.subscribe((state, prev) => {
      if (
        state.theme !== prev.theme ||
        state.permissionMode !== prev.permissionMode ||
        state.defaultThinking !== prev.defaultThinking ||
        state.detailedContext !== prev.detailedContext ||
        state.statusUpdateDisplay !== prev.statusUpdateDisplay ||
        state.sessionRecommendationEnabled !== prev.sessionRecommendationEnabled ||
        state.sessionRecommendationTurnLimit !== prev.sessionRecommendationTurnLimit ||
        state.voiceShortcut !== prev.voiceShortcut ||
        state.clarificationToolMode !== prev.clarificationToolMode
      ) {
        window.api.saveSettings({
          theme: state.theme,
          defaultPermissionMode: state.permissionMode,
          defaultThinking: state.defaultThinking,
          detailedContext: state.detailedContext,
          statusUpdateDisplay: state.statusUpdateDisplay,
          sessionRecommendationEnabled: state.sessionRecommendationEnabled,
          sessionRecommendationTurnLimit: state.sessionRecommendationTurnLimit,
          voiceShortcut: state.voiceShortcut,
          clarificationToolMode: state.clarificationToolMode,
        }).catch(() => {});
      }
    });

    return () => {
      unsubscribeEvent();
      unsubscribeStatus();
      unsubscribeBootstrap();
      unsubscribeSessionPersistence();
      window.removeEventListener("kimix:startHandoff", handleStartHandoff);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.clearInterval(lagTimer);
      if (streamFlushTimerRef.current) {
        clearTimeout(streamFlushTimerRef.current);
        streamFlushTimerRef.current = null;
      }
      flushStreamEvents();
      unsubSettings();
      flushLocalConversationState();
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [setTheme, setPermissionMode, setDefaultThinking, setDetailedContext, setStatusUpdateDisplay, setSessionRecommendationEnabled, setSessionRecommendationTurnLimit, setVoiceShortcut, setClarificationToolMode, setHandoffSessionId, setRunningSessionId, toggleSidebar, triggerFocusInput, updateSession, setRecentProjects, defaultThinking, permissionMode]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (useAppStore.getState().runningSessionId) return;
      const sessions = useSessionStore.getState().sessions;
      for (const session of sessions) {
        if (!session.longTask) continue;
        const hydrated = hydrateLongTaskProgressFromHistory(session);
        if (hydrated.longTask && (
          hydrated.longTask.stage !== session.longTask.stage ||
          hydrated.longTask.currentStep !== session.longTask.currentStep ||
          hydrated.longTask.targetStep !== session.longTask.targetStep ||
          hydrated.longTask.activeAgent !== session.longTask.activeAgent
        )) {
          updateSession(session.id, () => hydrated);
          const active = useAppStore.getState().currentSession;
          if (active?.id === session.id) useAppStore.getState().setCurrentSession(hydrated);
        }
        if (dispatchLongTaskReview(session.id, session.longTask.executorSessionId)) break;
        if (dispatchLongTaskExecutorFromReview(session.id, session.longTask.reviewerSessionId)) break;
      }
    }, 1400);
    return () => clearTimeout(timer);
  }, [defaultThinking, permissionMode, updateSession]);

  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}

export default App;
