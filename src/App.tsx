import { useEffect, useRef, useCallback } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { ThemeProvider } from "@/components/common/ThemeProvider";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { PendingMessage } from "@/stores/sessionStore";
import type { Session, TimelineEvent } from "@/types/ui";
import { mapHistoryEvents, mapStreamEvent, mergeEvents } from "@/utils/eventMapper";
import { mapKimiCodeApprovalRequest, mapKimiCodeEvent, mapKimiCodeQuestionRequest } from "@/utils/kimiCodeEventMapper";
import { deriveSessionTitle } from "@/utils/sessionTitle";
import { countUserTurns, shouldRecommendNewSession } from "@/utils/sessionMetrics";
import { getLongTaskRoleForRuntime, getRuntimeSessionId } from "@/utils/runtimeSession";
import { isHiddenInternalSession } from "@/utils/internalSessions";
import { sendKimiCodePromptWithRetry } from "@/utils/kimiCodeSendRetry";
import { inferTerminalGoalFromEvent, reconcileOfficialGoalSnapshot } from "@/utils/officialGoalState";
import {
  settleInactiveEvents,
  sanitizePersistedEvents,
  closeOpenCompaction,
  latestAssistantContent,
  latestAssistantVisibleOrThinkingContent,
} from "@/utils/eventHelpers";
import {
  getHiddenHandoffSessionIds,
  rememberHiddenHandoffSession,
  persistLocalConversationState,
  LOCAL_SESSIONS_KEY,
  LOCAL_PENDING_KEY,
} from "@/utils/persistence";
import { useRendererLagDetector } from "@/hooks/useRendererLagDetector";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useSettingsSync } from "@/hooks/useSettingsSync";
import { useStatePersistence } from "@/hooks/useStatePersistence";
import { useEventStream } from "@/hooks/useEventStream";
import { useBootstrap } from "@/hooks/useBootstrap";

const HANDOFF_PROMPT = `请阅读项目规则，优先参考 AGENTS.md，然后生成可直接交给下一个 agent 的交接提示词。
只输出一个 Markdown 代码块，不要输出解释。

交接内容必须包含：
- 项目背景
- 当前目标
- 已完成
- 未完成
- 阻塞
- 关键文件/命令
- 下一步最小行动`;
let rendererWindowFocusedHint = typeof document !== "undefined" ? document.hasFocus() : false;

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

function findLocalSessionForRuntime(historySessionId: string, runtimeSessionId?: string, officialSessionId?: string | null): Session | undefined {
  const ids = new Set([historySessionId, runtimeSessionId, officialSessionId ?? undefined].filter((id): id is string => Boolean(id)));
  return useSessionStore.getState().sessions.find((session) => (
    ids.has(session.id) ||
    Boolean(session.officialSessionId && ids.has(session.officialSessionId)) ||
    Boolean(session.runtimeSessionId && ids.has(session.runtimeSessionId)) ||
    Boolean(session.longTask?.executorSessionId && ids.has(session.longTask.executorSessionId)) ||
    Boolean(session.longTask?.reviewerSessionId && ids.has(session.longTask.reviewerSessionId))
  ));
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

function settlePendingSteerMessages(events: TimelineEvent[], status: "sent" | "failed", error?: string): TimelineEvent[] {
  if (!events.some((event) => event.type === "steer_message" && (event.status === "sending" || event.status === "accepted"))) return events;
  return events.map((event) => (
    event.type === "steer_message" && (event.status === "sending" || event.status === "accepted")
      ? { ...event, status, error: status === "failed" ? error : undefined }
      : event
  ));
}

function normalizeSteerContent(content: string): string {
  return content.trim().replace(/\s+/g, " ");
}

function isMatchingSteerContent(existing: string, incoming: string): boolean {
  const existingContent = normalizeSteerContent(existing);
  const incomingContent = normalizeSteerContent(incoming);
  if (!existingContent || !incomingContent) return false;
  return existingContent === incomingContent ||
    existingContent.startsWith(incomingContent) ||
    incomingContent.startsWith(existingContent);
}

function extractSteerInputTexts(events: unknown[]): string[] {
  return events.flatMap((event) => {
    if (!event || typeof event !== "object") return [];
    const item = event as { type?: unknown; payload?: { user_input?: unknown; input?: unknown; text?: unknown } };
    if (item.type !== "SteerInput") return [];
    const value = item.payload?.user_input ?? item.payload?.input ?? item.payload?.text;
    return typeof value === "string" && value.trim() ? [value] : [];
  });
}

function removeMatchingPendingSteerMessage(uiSessionId: string, content: string) {
  if (!normalizeSteerContent(content)) return;
  useSessionStore.setState((state) => {
    const match = state.pendingMessages.find((msg) => (
      msg.sessionId === uiSessionId && isMatchingSteerContent(msg.content, content)
    ));
    if (!match) return state;
    return { pendingMessages: state.pendingMessages.filter((msg) => msg.id !== match.id) };
  });
}

function summarizeNotificationBody(content: string): string {
  const normalized = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[#>*_`~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  return normalized.length > 120 ? `${normalized.slice(0, 118)}...` : normalized;
}

function extractAssistantContentForTurn(
  events: TimelineEvent[],
  start?: { eventStartIndex: number; openAssistantIds: Set<string> },
): string {
  const settled = settleInactiveEvents(events);
  const eventStartIndex = Math.max(0, Math.min(start?.eventStartIndex ?? 0, settled.length));
  const openAssistantIds = start?.openAssistantIds ?? new Set<string>();
  const assistant = settled
    .map((event, index) => ({ event, index }))
    .reverse()
    .find((entry): entry is { event: Extract<TimelineEvent, { type: "assistant_message" }>; index: number } => (
      entry.event.type === "assistant_message" &&
      entry.event.content.trim().length > 0 &&
      (entry.index >= eventStartIndex || openAssistantIds.has(entry.event.id))
    ));
  return assistant?.event.content.trim() ?? "";
}

function notifyTurnComplete(uiSessionId: string, runtimeSessionId: string, label?: string, assistantContent?: string) {
  const session = useSessionStore.getState().sessions.find((item) => item.id === uiSessionId);
  const sessionTitle = session?.title?.trim() || "当前会话";
  const summary = summarizeNotificationBody(assistantContent ?? "");
  const suffix = label ? `（${label}）` : "";
  void window.api.notifyTurnComplete({
    title: `Kimix 本轮已完成${suffix}`,
    body: summary || `「${sessionTitle}」已处理完成，可以回来查看结果。`,
    windowFocused: document.hasFocus() || rendererWindowFocusedHint,
    pageVisible: document.visibilityState === "visible",
  }).catch((err) => {
    console.warn("Notify turn complete failed:", err, { uiSessionId, runtimeSessionId });
  });
}

function notifyClarificationNeeded(uiSessionId: string, runtimeSessionId: string, questionContent?: string) {
  const session = useSessionStore.getState().sessions.find((item) => item.id === uiSessionId);
  const sessionTitle = session?.title?.trim() || "当前会话";
  const summary = summarizeNotificationBody(questionContent ?? "");
  void window.api.notifyTurnComplete({
    title: "Kimix 需要你回复需求澄清",
    body: summary || `「${sessionTitle}」正在等待你的澄清回复。`,
    windowFocused: document.hasFocus() || rendererWindowFocusedHint,
    pageVisible: document.visibilityState === "visible",
  }).catch((err) => {
    console.warn("Notify clarification needed failed:", err, { uiSessionId, runtimeSessionId });
  });
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

下面是 Kimix 当前窗口中可见的会话记录。请只基于这些记录生成交接提示词，不要编造，不要把这次交接生成任务本身写进交接内容，不要输出解释。

会话标题：${sourceSession?.title ?? "未知会话"}
工作目录：${sourceSession?.projectPath ?? "未知目录"}

--- 可见会话记录开始 ---
${visibleHistory}
--- 可见会话记录结束 ---`;
}

function resolveUiSessionId(sessionId: string, officialSessionId?: string | null): string {
  const ids = new Set([sessionId, officialSessionId ?? undefined].filter((id): id is string => Boolean(id)));
  const owner = useSessionStore.getState().sessions.find((session) => (
    ids.has(session.id) ||
    Boolean(session.runtimeSessionId && ids.has(session.runtimeSessionId)) ||
    Boolean(session.officialSessionId && ids.has(session.officialSessionId)) ||
    Boolean(session.longTask?.executorSessionId && ids.has(session.longTask.executorSessionId)) ||
    Boolean(session.longTask?.reviewerSessionId && ids.has(session.longTask.reviewerSessionId))
  ));
  return owner?.id ?? sessionId;
}

function resolveRuntimeSessionId(sessionId: string): string {
  const owner = useSessionStore.getState().sessions.find((session) => session.id === sessionId);
  return getRuntimeSessionId(owner) ?? sessionId;
}

function buildLongTaskRecovery(
  role: "executor" | "reviewer",
  status: "error" | "interrupted" | "paused",
  reason?: string,
): NonNullable<Session["longTask"]>["recovery"] {
  const roleLabel = role === "reviewer" ? "审查 agent" : "执行 agent";
  if (status === "error") {
    return {
      status: "failed",
      reason: reason || `${roleLabel} 运行失败`,
      suggestedAction: `查看本轮错误后点击继续，Kimix 会从${roleLabel}继续；必要时先复制下一步 prompt 手动调整。`,
      updatedAt: Date.now(),
    };
  }
  if (status === "interrupted") {
    return {
      status: "interrupted",
      reason: reason || `${roleLabel} 被中断`,
      suggestedAction: `确认中断原因后点击继续，Kimix 会从${roleLabel}恢复当前 Step。`,
      updatedAt: Date.now(),
    };
  }
  return {
    status: "paused",
    reason: reason || "用户暂停了长程任务",
    suggestedAction: "确认当前状态后点击继续，或复制下一步 prompt 手动恢复。",
    updatedAt: Date.now(),
  };
}

function markLongTaskRuntimeActivity(uiSessionId: string, runtimeSessionId: string, status?: "running" | "error" | "interrupted" | "completed") {
  const store = useSessionStore.getState();
  const target = store.sessions.find((session) => session.id === uiSessionId);
  const role = getLongTaskRoleForRuntime(target, runtimeSessionId);
  if (!target?.longTask || !role) return;

  store.updateSession(uiSessionId, (session) => {
    if (!session.longTask) return session;
    let stage = session.longTask.stage;
    let recovery = session.longTask.recovery ?? null;
    if (status === "interrupted" || status === "error") {
      stage = "paused";
      recovery = buildLongTaskRecovery(role, status);
    } else if (status === "running" && role === "reviewer") {
      stage = "reviewing";
      recovery = null;
    } else if (status === "running" && role === "executor" && stage === "reviewing") {
      stage = "running";
      recovery = null;
    } else if (status === "running" || status === "completed") {
      recovery = null;
    }
    return {
      ...session,
      longTask: {
        ...session.longTask,
        activeAgent: role,
        stage,
        recovery,
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
        recovery: latest.longTask.recovery ?? null,
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

function questionRequestNotificationKey(event: Extract<TimelineEvent, { type: "question_request" }>) {
  return event.rpcRequestId || event.requestId || event.toolCallId || event.id;
}

function summarizeQuestionRequest(event: Extract<TimelineEvent, { type: "question_request" }>) {
  return event.questions.map((question) => question.question).filter(Boolean).join(" / ");
}

function settlePendingQuestions(events: TimelineEvent[], status: "skipped" | "answered" = "skipped"): TimelineEvent[] {
  if (!events.some((event) => event.type === "question_request" && event.status === "pending")) return events;
  return events.map((event) => (
    event.type === "question_request" && event.status === "pending"
      ? { ...event, status, answers: event.answers ?? {} }
      : event
  ));
}

function isLongTaskRuntimeHiddenFromChat(session: Session | undefined, runtimeSessionId: string) {
  return Boolean(session?.longTask && session.longTask.reviewerSessionId === runtimeSessionId);
}

function shouldMirrorHiddenLongTaskEvent(event: TimelineEvent) {
  return ["approval_request", "question_request", "error"].includes(event.type);
}

function attachLongTaskAgentRole(event: TimelineEvent, role: "executor" | "reviewer" | null): TimelineEvent {
  if (!role) return event;
  if (event.type === "assistant_message" || event.type === "status_update") {
    return { ...event, agentRole: role };
  }
  return event;
}

function toLongTaskMeta(summary: {
  id: string;
  title: string;
  stage: Session["longTask"] extends infer T ? T extends object ? T["stage"] : never : never;
  activeAgent: Session["longTask"] extends infer T ? T extends object ? T["activeAgent"] : never : never;
  executorSessionId: string;
  reviewerSessionId: string;
  bigPlanPath: string;
  reviewQueuePath: string;
  reviewedReviewItems?: string[];
  currentStep: number;
  targetStep: number | null;
}): NonNullable<Session["longTask"]> {
  return {
    taskId: summary.id,
    title: summary.title,
    stage: summary.stage,
    activeAgent: summary.activeAgent,
    executorSessionId: summary.executorSessionId,
    reviewerSessionId: summary.reviewerSessionId,
    bigPlanPath: summary.bigPlanPath,
    reviewQueuePath: summary.reviewQueuePath,
    reviewedReviewItems: summary.reviewedReviewItems ?? [],
    currentStep: summary.currentStep,
    targetStep: summary.targetStep,
  };
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
        recovery: latest.longTask.recovery ?? null,
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
1. 检查本轮执行结果是否符合 BIGPLAN.md 中当前步骤的目标、范围和验收标准，必须引用当前 Step 编号和验收标准。
2. 检查执行 agent 是否提供实际验证证据；不能仅凭执行 agent 自述放行。
3. 如果计划不可执行、步骤过大、缺少必要验证或存在必须先处理的问题，请给出需修复的问题，后续由 Kimix 交回执行 agent 修复。
4. 暂时无法自动确认但不阻塞继续的事项，请写入 ${meta.reviewQueuePath}，并仍使用“结论：通过”。
5. 只有无法安全继续、必须等用户或外部环境确认时，才使用“结论：待人工审查”；该结论会让 Kimix 暂停长程任务。
6. 不要直接执行代码修改；本轮只做执行结果审查。
7. 不要询问用户是否继续下一步；如本轮可继续，请明确写出“结论：通过”，Kimix 会自动调度执行 agent 进入下一步。
8. 你的最终正文第一行必须且只能是“结论：通过”或“结论：需修复”或“结论：待人工审查”，不要只把结论写在思考过程里。

执行 agent 最近输出：
${executorOutput || "暂无可用输出，请直接读取 BIGPLAN.md 审查。"}`;
}

type LongTaskReviewConclusion = "pass" | "needs_fix" | "manual_review" | "unknown";

function inferLongTaskReviewConclusion(content: string): LongTaskReviewConclusion {
  const conclusionLine = content.match(/结论[：:\s]*([^\n\r]+)/i)?.[1]?.trim() ?? "";
  const target = conclusionLine || content.slice(0, 1200);
  if (/需修复|需要修复|不通过|未通过|阻塞|问题必须先修复/i.test(target)) return "needs_fix";
  if (/待人工审查|人工审查|需要用户|无法自动确认|无法自动审查/i.test(target)) return "manual_review";
  if (/通过|审查通过|审核通过|可以继续|可继续|进入下一步|下一步|符合预期|执行吧|继续执行|继续\s*Step|继续\s*执行|无阻塞|未发现问题|没有发现问题/i.test(target)) return "pass";
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

function buildLongTaskExecutorPromptFromReview(session: Session, conclusion: LongTaskReviewConclusion, reviewerOutputOverride?: string) {
  const meta = session.longTask;
  if (!meta) return "";
  const reviewerOutput = reviewerOutputOverride ?? latestAssistantContent(session.events);
  const step = meta.currentStep || 1;
  if (conclusion === "needs_fix") {
    return `【Kimix 长程任务：审查发现问题，请先修复】
审查 agent 对 Step ${step} 的结论是“需修复”。

请你作为执行 agent：
1. 先阅读 ${meta.bigPlanPath} 和下面的审查意见。
2. 先提取审查问题清单，再逐项修复；只处理审查指出的问题，不进入下一步。
3. 修复完成后更新必要文件，并把本轮修复、验证证据、残余风险写入 rounds/ 对应记录。
4. 如无法修复，请明确写出阻塞原因和需要用户提供的信息。
5. 结束时明确写出“Step ${step} 修复完成，交给审查 agent 审查”。

审查意见：
${reviewerOutput || "审查 agent 未给出可用正文，请读取任务文件后修复。"}`
  }

  if (conclusion === "manual_review") {
    return `【Kimix 长程任务：待人工审查，暂停继续执行】
审查 agent 对 Step ${step} 的结论是“待人工审查”。

请不要进入下一步。需要用户或外部环境确认后，才能继续调度执行 agent。

审查意见：
${reviewerOutput || "审查 agent 未给出可用正文，请读取任务文件后等待人工确认。"}`
  }

  const nextStep = step + 1;
  return `【Kimix 长程任务：审查可继续，请执行下一步】
审查 agent 已通过 Step ${step}。现在请继续执行 Step ${nextStep}。

请你作为执行 agent：
1. 这是 Kimix 内部调度指令，不要询问用户是否继续；除非缺少执行 Step ${nextStep} 的必要信息或遇到阻塞，否则直接开始执行。
2. 先阅读 ${meta.bigPlanPath}，确认当前 Step ${step} 已通过、下一步确实是 Step ${nextStep}。
3. 只执行 Step ${nextStep} 这一轮，不要把后续多个 Step 合并执行。
4. 完成 Step ${nextStep} 后必须停止本轮，不能自行继续 Step ${nextStep + 1}。
5. 完成后更新必要文件，并把本轮产出、验证证据、残余风险写入 rounds/ 对应记录。
6. 结束时明确写出“Step ${nextStep} 执行完成，交给审查 agent 审查”。

审查 agent 对上一轮的意见：
${reviewerOutput || "审查 agent 未给出可用正文，请按 BIGPLAN.md 继续。"}`
}

async function createSessionAndSendPrompt(projectPath: string, content: string) {
  const appState = useAppStore.getState();
  const sessionStore = useSessionStore.getState();
  const sessionRes = await window.api.startSession({
    workDir: projectPath,
    thinking: appState.defaultThinking,
    yoloMode: appState.permissionMode === "yolo",
    autoMode: appState.permissionMode === "auto",
    planMode: appState.defaultPlanMode,
  });
  if (!sessionRes.success) throw new Error(sessionRes.error);

  const session = {
    id: sessionRes.data.sessionId,
    model: sessionRes.data.model ?? null,
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
    autoMode: appState.permissionMode === "auto",
    planMode: appState.defaultPlanMode,
  });
}

function App() {
  const setTheme = useAppStore((s) => s.setTheme);
  const setPermissionMode = useAppStore((s) => s.setPermissionMode);
  const setDefaultThinking = useAppStore((s) => s.setDefaultThinking);
  const setDefaultPlanMode = useAppStore((s) => s.setDefaultPlanMode);
  const setAdditionalWorkDirs = useAppStore((s) => s.setAdditionalWorkDirs);
  const setDetailedContext = useAppStore((s) => s.setDetailedContext);
  const setStatusUpdateDisplay = useAppStore((s) => s.setStatusUpdateDisplay);
  const setSessionRecommendationEnabled = useAppStore((s) => s.setSessionRecommendationEnabled);
  const setSessionRecommendationTurnLimit = useAppStore((s) => s.setSessionRecommendationTurnLimit);
  const setVoiceShortcut = useAppStore((s) => s.setVoiceShortcut);
  const setNotificationMode = useAppStore((s) => s.setNotificationMode);
  const setClarificationToolMode = useAppStore((s) => s.setClarificationToolMode);
  const setHandoffSessionId = useAppStore((s) => s.setHandoffSessionId);
  const setRunningSessionId = useAppStore((s) => s.setRunningSessionId);
  const defaultThinking = useAppStore((s) => s.defaultThinking);
  const defaultPlanMode = useAppStore((s) => s.defaultPlanMode);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const triggerFocusInput = useAppStore((s) => s.triggerFocusInput);
  const updateSession = useSessionStore((s) => s.updateSession);
  const setRecentProjects = useSessionStore((s) => s.setRecentProjects);
  const currentSession = useAppStore((s) => s.currentSession);
  const currentSessionRef = useRef(currentSession);
  currentSessionRef.current = currentSession;
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const bootstrapDoneRef = useRef(false);
  const handoffJobRef = useRef<HandoffJob | null>(null);
  const longTaskReviewDispatchRef = useRef<Set<string>>(new Set());
  const longTaskRoundAppendRef = useRef<Set<string>>(new Set());
  const hiddenLongTaskEventsRef = useRef<Map<string, TimelineEvent[]>>(new Map());
  const runtimeTurnStartRef = useRef<Map<string, { eventStartIndex: number; openAssistantIds: Set<string> }>>(new Map());
  const goalRefreshTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const goalLastRefreshRef = useRef<Map<string, number>>(new Map());
  const pendingQueueDispatchRef = useRef<Set<string>>(new Set());
  const notifiedQuestionRequestRef = useRef<Set<string>>(new Set());

  useRendererLagDetector();
  useSettingsSync();
  useStatePersistence();
  const { enqueueStreamEvent, flushStreamEvents } = useEventStream();

  const handleEscape = useCallback(() => {
    const sessionId = useAppStore.getState().runningSessionId ?? useAppStore.getState().currentSession?.id;
    if (sessionId) {
      setRunningSessionId(null);
      const session = useSessionStore.getState().sessions.find((item) => item.id === sessionId || item.runtimeSessionId === sessionId);
      const runtimeSessionId = resolveRuntimeSessionId(sessionId);
      window.api.cancelKimiCodeTurn({ sessionId: runtimeSessionId }).catch(() => {});
    }
  }, [setRunningSessionId]);

  useKeyboardShortcuts(toggleSidebar, triggerFocusInput, handleEscape);
  useBootstrap({
    setTheme,
    setPermissionMode,
    setDefaultThinking,
    setDefaultPlanMode,
    setAdditionalWorkDirs,
    setDetailedContext,
    setStatusUpdateDisplay,
    setSessionRecommendationEnabled,
    setSessionRecommendationTurnLimit,
    setVoiceShortcut,
    setNotificationMode,
    setClarificationToolMode,
    setRecentProjects,
  });

  const syncCurrentSessionFromStore = (uiSessionId: string) => {
    const latest = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
    if (!latest) return;
    const active = useAppStore.getState().currentSession;
    if (active?.id === uiSessionId) {
      useAppStore.getState().setCurrentSession(latest);
    }
  };

  const refreshOfficialGoalState = async (uiSessionId: string, runtimeSessionId: string) => {
    const target = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
    if (!target?.officialGoal) return;
    try {
      const res = await window.api.getKimiCodeGoal({ sessionId: runtimeSessionId });
      useSessionStore.getState().updateSession(uiSessionId, (session) => ({
        ...session,
        officialGoal: {
          goal: res.success ? reconcileOfficialGoalSnapshot(res.data.goal, session.officialGoal?.goal) : session.officialGoal?.goal ?? null,
          error: res.success ? null : res.error,
          updatedAt: Date.now(),
        },
        updatedAt: Date.now(),
      }));
      syncCurrentSessionFromStore(uiSessionId);
    } catch (err) {
      useSessionStore.getState().updateSession(uiSessionId, (session) => ({
        ...session,
        officialGoal: {
          goal: session.officialGoal?.goal ?? null,
          error: err instanceof Error ? err.message : String(err),
          updatedAt: Date.now(),
        },
        updatedAt: Date.now(),
      }));
      syncCurrentSessionFromStore(uiSessionId);
    }
  };

  const scheduleOfficialGoalRefresh = (uiSessionId: string, runtimeSessionId: string) => {
    const target = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
    if (!target?.officialGoal?.goal) return;
    const key = `${uiSessionId}:${runtimeSessionId}`;
    if (goalRefreshTimersRef.current.has(key)) return;
    const elapsed = Date.now() - (goalLastRefreshRef.current.get(key) ?? 0);
    const delay = Math.max(0, 1200 - elapsed);
    const timer = window.setTimeout(() => {
      goalRefreshTimersRef.current.delete(key);
      goalLastRefreshRef.current.set(key, Date.now());
      void refreshOfficialGoalState(uiSessionId, runtimeSessionId);
    }, delay);
    goalRefreshTimersRef.current.set(key, timer);
  };

  const persistLongTaskMeta = (session: Session | undefined) => {
    if (!session?.longTask) return;
    void window.api.updateLongTaskState({
      projectPath: session.projectPath,
      taskId: session.longTask.taskId,
      patch: {
        activeAgent: session.longTask.activeAgent,
        stage: session.longTask.stage,
        recovery: session.longTask.recovery ?? null,
        currentStep: session.longTask.currentStep,
        targetStep: session.longTask.targetStep,
        reviewedReviewItems: session.longTask.reviewedReviewItems ?? [],
        executorSessionId: session.longTask.executorSessionId,
        reviewerSessionId: session.longTask.reviewerSessionId,
      },
    }).catch(() => {});
  };

  const isMissingRuntimeSessionError = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    return /session not found|unknown session|会话不存在|session.*missing/i.test(message);
  };

  const recoverLongTaskReviewerSession = async (uiSessionId: string, failedReviewerSessionId: string, prompt: string) => {
    const snapshot = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
    if (!snapshot?.longTask) throw new Error("当前长程任务不存在，无法恢复审查 agent");

    const startRes = await window.api.startSession({
      workDir: snapshot.projectPath,
      thinking: defaultThinking,
      yoloMode: permissionMode === "yolo",
      autoMode: permissionMode === "auto",
    });
    if (!startRes.success) throw new Error(startRes.error);

    hiddenLongTaskEventsRef.current.delete(failedReviewerSessionId);
    hiddenLongTaskEventsRef.current.set(startRes.data.sessionId, []);

    updateSession(uiSessionId, (session) => {
      if (!session.longTask) return session;
      return {
        ...session,
        runtimeSessionId: startRes.data.sessionId,
        model: session.model ?? startRes.data.model ?? null,
        longTask: {
          ...session.longTask,
          reviewerSessionId: startRes.data.sessionId,
          activeAgent: "reviewer",
          stage: "reviewing",
        },
        events: session.events.filter((event) => !(event.type === "assistant_message" && !event.isComplete && !event.content.trim())),
        updatedAt: Date.now(),
      };
    });
    const latest = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
    syncCurrentSessionFromStore(uiSessionId);
    persistLongTaskMeta(latest);
    upsertLongTaskAgentProxyMessage(uiSessionId, "reviewer", "running");

    const sendRes = await window.api.sendPrompt({
      sessionId: startRes.data.sessionId,
      content: prompt,
      thinking: defaultThinking,
      yoloMode: permissionMode === "yolo",
      autoMode: permissionMode === "auto",
    });
    if (!sendRes.success) throw new Error(sendRes.error);
  };

  const upsertLongTaskAgentProxyMessage = (
    uiSessionId: string,
    role: "executor" | "reviewer",
    status: "running" | "completed" | "error" | "interrupted",
    detailContent?: string,
  ) => {
    updateSession(uiSessionId, (session) => {
      const events = [...session.events];
      const detail = detailContent?.trim();
      const latestProxyIndex = events.findLastIndex((event) => {
        if (event.type !== "assistant_message" || event.agentRole !== role) return false;
        if (status === "running") return !event.isComplete;
        if (detail) return true;
        return !event.content.trim() && !event.thinking?.trim();
      });

      if (status === "running") {
        const existing = latestProxyIndex >= 0 ? events[latestProxyIndex] : null;
        if (existing?.type === "assistant_message" && !existing.isComplete) {
          return session;
        }
        return {
          ...session,
          events: [
            ...events,
            {
              id: crypto.randomUUID(),
              type: "assistant_message" as const,
              timestamp: Date.now(),
              agentRole: role,
              content: "",
              isThinking: true,
              isComplete: false,
            },
          ],
          updatedAt: Date.now(),
        };
      }

      if (latestProxyIndex === -1) {
        if (!detail || status === "running") return session;
        return {
          ...session,
          events: [
            ...events,
            {
              id: crypto.randomUUID(),
              type: "assistant_message" as const,
              timestamp: Date.now(),
              agentRole: role,
              content: detail,
              thinkingParts: [
                {
                  id: crypto.randomUUID(),
                  timestamp: Date.now(),
                  text: detail,
                },
              ],
              isThinking: false,
              isComplete: true,
            },
          ],
          updatedAt: Date.now(),
        };
      }
      const latestProxy = events[latestProxyIndex];
      if (latestProxy.type !== "assistant_message") return session;
      if (latestProxy.isComplete && !detailContent?.trim()) return session;
      const detailPart = detail
        ? {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            text: detail,
          }
        : null;
      events[latestProxyIndex] = {
        ...latestProxy,
        content: detail || latestProxy.content,
        thinkingParts: detailPart ? [detailPart] : latestProxy.thinkingParts,
        isThinking: false,
        isComplete: true,
        durationMs: latestProxy.durationMs ?? Math.max(0, Date.now() - latestProxy.timestamp),
      };
      return {
        ...session,
        events,
        updatedAt: Date.now(),
      };
    });
    syncCurrentSessionFromStore(uiSessionId);
  };

  const pauseLongTaskReviewerWithError = (uiSessionId: string, message: string) => {
    updateSession(uiSessionId, (session) => {
      if (!session.longTask) return session;
      const latestError = [...session.events].reverse().find((event): event is Extract<TimelineEvent, { type: "error" }> => event.type === "error");
      const nextEvents = session.events.filter((event) => !(event.type === "assistant_message" && !event.isComplete && !event.content.trim()));
      return {
        ...session,
        longTask: {
          ...session.longTask,
          activeAgent: "reviewer",
          stage: "paused",
        },
        events: latestError?.message === message
          ? nextEvents
          : [
            ...nextEvents,
            {
              id: crypto.randomUUID(),
              type: "error" as const,
              timestamp: Date.now(),
              message,
              canDismiss: false,
            },
          ],
        updatedAt: Date.now(),
      };
    });
    const latest = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
    syncCurrentSessionFromStore(uiSessionId);
    persistLongTaskMeta(latest);
    setRunningSessionId(null);
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

  const mergeHiddenLongTaskEvent = (runtimeSessionId: string, event: TimelineEvent) => {
    const current = hiddenLongTaskEventsRef.current.get(runtimeSessionId) ?? [];
    hiddenLongTaskEventsRef.current.set(runtimeSessionId, mergeEvents(current, event));
  };

  const getHiddenLongTaskAssistantContent = (runtimeSessionId: string) => {
    return latestAssistantVisibleOrThinkingContent(hiddenLongTaskEventsRef.current.get(runtimeSessionId) ?? []);
  };

  const dispatchLongTaskReview = (uiSessionId: string, runtimeSessionId: string) => {
    const latestSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
    const reviewKey = `${uiSessionId}:${runtimeSessionId}:${latestSession?.events.length ?? 0}`;
    if (!latestSession?.longTask || !shouldStartLongTaskReview(latestSession, runtimeSessionId) || longTaskReviewDispatchRef.current.has(reviewKey)) {
      return false;
    }
    longTaskReviewDispatchRef.current.add(reviewKey);
    hiddenLongTaskEventsRef.current.set(latestSession.longTask.reviewerSessionId, []);
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
        recovery: null,
      },
      updatedAt: Date.now(),
    } : session);
    syncCurrentSessionFromStore(uiSessionId);
    upsertLongTaskAgentProxyMessage(uiSessionId, "reviewer", "running");
    const latestForPrompt = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId) ?? latestSession;
    if (latestForPrompt.longTask) {
      void window.api.updateLongTaskState({
        projectPath: latestForPrompt.projectPath,
        taskId: latestForPrompt.longTask.taskId,
        patch: {
          activeAgent: latestForPrompt.longTask.activeAgent,
          stage: latestForPrompt.longTask.stage,
          recovery: latestForPrompt.longTask.recovery ?? null,
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
      autoMode: permissionMode === "auto",
    }).then((res) => {
      if (res.success) return;
      throw new Error(res.error);
    }).catch(async (err: unknown) => {
      if (isMissingRuntimeSessionError(err)) {
        try {
          await recoverLongTaskReviewerSession(
            uiSessionId,
            latestSession.longTask.reviewerSessionId,
            buildLongTaskReviewPrompt(useSessionStore.getState().sessions.find((session) => session.id === uiSessionId) ?? latestForPrompt),
          );
          return;
        } catch (recoveryErr) {
          err = recoveryErr;
        }
      }
      let failedSession: Session | undefined;
      upsertLongTaskAgentProxyMessage(uiSessionId, "reviewer", "error");
      updateSession(uiSessionId, (session) => ({
        ...session,
        longTask: session.longTask ? {
          ...session.longTask,
          activeAgent: "reviewer",
          stage: "paused",
          recovery: buildLongTaskRecovery("reviewer", "error", `启动审查 agent 失败：${err instanceof Error ? err.message : String(err)}`),
        } : session.longTask,
        events: [
          ...session.events.filter((event) => !(event.type === "assistant_message" && !event.isComplete && !event.content.trim())),
          {
            id: crypto.randomUUID(),
            type: "error" as const,
            timestamp: Date.now(),
            message: `启动审查 agent 失败：${err instanceof Error ? err.message : String(err)}`,
            canDismiss: false,
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
            recovery: failedSession.longTask.recovery ?? null,
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

  const dispatchNextPendingKimiMessage = (uiSessionId: string, runtimeSessionId: string) => {
    if (pendingQueueDispatchRef.current.has(uiSessionId)) return false;
    const latestSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
    if (latestSession && hasPendingQuestion(latestSession.events)) {
      persistLocalConversationState();
      return false;
    }
    const next = useSessionStore.getState().shiftPendingMessage(uiSessionId);
    if (!next) return false;

    pendingQueueDispatchRef.current.add(uiSessionId);
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
          images: next.images,
        },
        {
          id: placeholderId,
          type: "assistant_message" as const,
          timestamp: Date.now(),
          content: "",
          isThinking: useAppStore.getState().defaultThinking,
          isComplete: false,
        },
      ],
      updatedAt: Date.now(),
    }));
    setRunningSessionId(uiSessionId);
    const timer = setTimeout(() => {
      sendKimiCodePromptWithRetry({
        sessionId: runtimeSessionId,
        content: next.content,
        images: next.images?.map((image) => ({ name: image.name, dataUrl: image.dataUrl ?? "" })).filter((image) => image.dataUrl),
      }).then((res) => {
        if (res.success) return;
        throw new Error(res.error);
      }).catch((err) => {
        useSessionStore.getState().addPendingMessage(uiSessionId, next.content, next.images);
        updateSession(uiSessionId, (session) => ({
          ...session,
          events: [
            ...session.events.filter((event) => event.id !== placeholderId && event.id !== userEventId),
            {
              id: crypto.randomUUID(),
              type: "error" as const,
              timestamp: Date.now(),
              message: err instanceof Error ? err.message : String(err),
              source: "ipc" as const,
            },
          ],
          updatedAt: Date.now(),
        }));
        setRunningSessionId(null);
      }).finally(() => {
        pendingQueueDispatchRef.current.delete(uiSessionId);
      });
    }, 300);
    timersRef.current.push(timer);
    return true;
  };

  const dispatchLongTaskExecutorFromReview = (uiSessionId: string, runtimeSessionId: string) => {
    const latestSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
    if (!latestSession?.longTask) return false;
    if (latestSession.longTask.reviewerSessionId !== runtimeSessionId) return false;
    if (latestSession.longTask.stage !== "reviewing" && latestSession.longTask.activeAgent !== "reviewer") return false;
    if (hasPendingQuestion(latestSession.events)) return false;

    const reviewerOutput = getHiddenLongTaskAssistantContent(runtimeSessionId);
    const conclusion = inferLongTaskReviewConclusion(reviewerOutput);
    if (conclusion === "unknown") return false;
    upsertLongTaskAgentProxyMessage(uiSessionId, "reviewer", "completed", reviewerOutput);

    const currentStep = latestSession.longTask.currentStep || 1;
    const targetStep = latestSession.longTask.targetStep;
    appendLongTaskRoundOnce(latestSession, {
      step: currentStep,
      role: "reviewer",
      phase: "review",
      conclusion: longTaskConclusionLabel(conclusion),
      content: reviewerOutput,
    });
    if (conclusion === "manual_review") {
      updateSession(uiSessionId, (session) => session.longTask ? {
        ...session,
        runtimeSessionId: session.longTask.reviewerSessionId,
        longTask: {
          ...session.longTask,
          activeAgent: "reviewer",
          stage: "paused",
          recovery: buildLongTaskRecovery("reviewer", "paused", "审查 agent 标记为待人工审查，需要人工确认后再继续。"),
        },
        updatedAt: Date.now(),
      } : session);
      syncCurrentSessionFromStore(uiSessionId);
      persistLongTaskMeta(useSessionStore.getState().sessions.find((session) => session.id === uiSessionId));
      setRunningSessionId(null);
      return true;
    }

    if (conclusion === "pass" && targetStep && currentStep >= targetStep) {
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

    const prompt = buildLongTaskExecutorPromptFromReview(latestSession, conclusion, reviewerOutput);
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
      autoMode: permissionMode === "auto",
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
        const latest = res.data.find((session) => !hiddenHandoffSessionIds.has(session.id) && !isHiddenInternalSession(session));
        const startRes = await window.api.startSession({
          workDir: payload.project.path,
          sessionId: latest?.id,
          thinking: useAppStore.getState().defaultThinking,
          yoloMode: useAppStore.getState().permissionMode === "yolo",
          autoMode: useAppStore.getState().permissionMode === "auto",
          planMode: useAppStore.getState().defaultPlanMode,
        });
        if (!startRes.success || !latest) return;
        const runtimeOwner = findLocalSessionForRuntime(latest.id, startRes.data.sessionId);
        const loaded = await window.api.loadSession({
          workDir: payload.project.path,
          sessionId: latest.id,
        });
        if (!loaded.success) return;
        const events = settleInactiveEvents(mapHistoryEvents(Array.isArray(loaded.data.events) ? loaded.data.events : []));

        if (runtimeOwner) {
          const session = hydrateLongTaskProgressFromHistory({
            ...runtimeOwner,
            runtimeSessionId: startRes.data.sessionId,
            model: runtimeOwner.model ?? startRes.data.model ?? null,
            events: runtimeOwner.events.length > 0 ? settleInactiveEvents(runtimeOwner.events) : events,
            isLoading: false,
          });
          useSessionStore.setState((state) => ({
            sessions: state.sessions.map((item) => (item.id === session.id ? session : item)),
          }));
          useAppStore.setState({ currentSession: session });
          setRunningSessionId(null);
          return;
        }

        const longTasksRes = await window.api.listLongTasks({ projectPath: payload.project.path });
        const matchedLongTask = longTasksRes.success
          ? longTasksRes.data.find((task) => (
            task.executorSessionId === latest.id ||
            task.reviewerSessionId === latest.id ||
            task.executorSessionId === startRes.data.sessionId ||
            task.reviewerSessionId === startRes.data.sessionId
          ))
          : undefined;

        const session = hydrateLongTaskProgressFromHistory({
          id: startRes.data.sessionId,
          model: startRes.data.model ?? null,
          title: deriveSessionTitle(events, latest.brief || "新会话"),
          projectPath: payload.project.path,
          createdAt: latest.updatedAt,
          updatedAt: latest.updatedAt,
          runtimeSessionId: startRes.data.sessionId,
          longTask: matchedLongTask ? toLongTaskMeta(matchedLongTask) : undefined,
          events,
          isLoading: false,
        });

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
          const visibleSessions = parsed
            .filter((session) => !isHiddenInternalSession(session))
            .map((session) => ({
              ...session,
              events: sanitizePersistedEvents(Array.isArray(session.events) ? session.events : []),
            }));
          if (JSON.stringify(visibleSessions) !== storedSessions) {
            localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(visibleSessions));
          }
          useSessionStore.setState({
            sessions: visibleSessions.map((session) => {
              const rawEngine = (session as { engine?: unknown }).engine;
              const knownEngine = rawEngine === "prompt" || rawEngine === "kimi-code";
              return hydrateLongTaskProgressFromHistory({
                ...session,
                engine: knownEngine ? rawEngine : "kimi-code",
                runtimeSessionId: knownEngine ? session.runtimeSessionId : undefined,
                events: sanitizePersistedEvents(Array.isArray(session.events) ? settleInactiveEvents(session.events) : []),
                isLoading: false,
              });
            }),
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
              // 排队消息现按会话隔离：缺少 sessionId 的旧持久化数据无法归属任何会话，丢弃。
              if (item && typeof item === "object" && typeof item.id === "string" && typeof item.sessionId === "string" && typeof item.content === "string" && typeof item.createdAt === "number") {
                const images = Array.isArray((item as { images?: unknown }).images)
                  ? (item as { images: unknown[] }).images.filter((image): image is { id?: string; name: string; dataUrl?: string } => (
                      image &&
                      typeof image === "object" &&
                      typeof (image as { name?: unknown }).name === "string" &&
                      (
                        typeof (image as { dataUrl?: unknown }).dataUrl === "undefined" ||
                        typeof (image as { dataUrl?: unknown }).dataUrl === "string"
                      )
                    ))
                  : undefined;
                return { ...item, images };
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

    const markRendererWindowFocused = () => {
      rendererWindowFocusedHint = true;
    };
    const markRendererWindowBlurred = () => {
      rendererWindowFocusedHint = false;
    };
    window.addEventListener("focus", markRendererWindowFocused);
    window.addEventListener("blur", markRendererWindowBlurred);
    document.addEventListener("pointerdown", markRendererWindowFocused, true);
    document.addEventListener("keydown", markRendererWindowFocused, true);

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
        notifyTurnComplete(job.sourceSessionId, job.runtimeSessionId, "交接");
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
          thinking: useAppStore.getState().defaultThinking,
          yoloMode: useAppStore.getState().permissionMode === "yolo",
          autoMode: useAppStore.getState().permissionMode === "auto",
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
          autoMode: useAppStore.getState().permissionMode === "auto",
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
        const targetSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
        const longTaskRole = getLongTaskRoleForRuntime(targetSession, payload.sessionId);
        const mappedWithRole = attachLongTaskAgentRole(mapped, longTaskRole);
        markLongTaskRuntimeActivity(uiSessionId, payload.sessionId);
        if (mappedWithRole.type === "question_request" && mappedWithRole.status === "pending") {
          const notifyKey = `${payload.sessionId}:${questionRequestNotificationKey(mappedWithRole)}`;
          if (!notifiedQuestionRequestRef.current.has(notifyKey)) {
            notifiedQuestionRequestRef.current.add(notifyKey);
            notifyClarificationNeeded(uiSessionId, payload.sessionId, summarizeQuestionRequest(mappedWithRole));
          }
        }
        if (isLongTaskRuntimeHiddenFromChat(targetSession, payload.sessionId)) {
          mergeHiddenLongTaskEvent(payload.sessionId, mappedWithRole);
          if (shouldMirrorHiddenLongTaskEvent(mappedWithRole)) {
            enqueueStreamEvent(uiSessionId, mappedWithRole);
          }
          if (mappedWithRole.type === "error" || mappedWithRole.type === "question_request") {
            flushStreamEvents();
            persistLocalConversationState();
          }
          return;
        }
        enqueueStreamEvent(uiSessionId, mappedWithRole);
        if (mappedWithRole.type === "question_request") {
          flushStreamEvents();
          persistLocalConversationState();
        }
      }
    });

    const unsubscribeKimiCodeEvent = window.api.onKimiCodeEvent((payload) => {
      const uiSessionId = resolveUiSessionId(payload.sessionId);
      const targetSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
      if (targetSession?.engine !== "kimi-code" && !targetSession?.longTask) return;
      const rawEvent = payload.event && typeof payload.event === "object" && !Array.isArray(payload.event)
        ? payload.event as Record<string, unknown>
        : null;
      const mapped = rawEvent?.type === "kimix.approval.request"
        ? mapKimiCodeApprovalRequest({
            ...(rawEvent.request && typeof rawEvent.request === "object" && !Array.isArray(rawEvent.request) ? rawEvent.request as Record<string, unknown> : {}),
            toolCallId: typeof rawEvent.requestId === "string" ? rawEvent.requestId : undefined,
          })
        : rawEvent?.type === "kimix.question.request"
          ? mapKimiCodeQuestionRequest({
              ...(rawEvent.request && typeof rawEvent.request === "object" && !Array.isArray(rawEvent.request) ? rawEvent.request as Record<string, unknown> : {}),
              toolCallId: typeof rawEvent.requestId === "string" ? rawEvent.requestId : undefined,
          })
        : mapKimiCodeEvent(payload.event);
      if (!mapped) return;
      const longTaskRole = getLongTaskRoleForRuntime(targetSession, payload.sessionId);
      const mappedWithRole = attachLongTaskAgentRole(mapped, longTaskRole);
      markLongTaskRuntimeActivity(uiSessionId, payload.sessionId);
      if (mappedWithRole.type === "question_request" && mappedWithRole.status === "pending") {
        const notifyKey = `${payload.sessionId}:${questionRequestNotificationKey(mappedWithRole)}`;
        if (!notifiedQuestionRequestRef.current.has(notifyKey)) {
          notifiedQuestionRequestRef.current.add(notifyKey);
          notifyClarificationNeeded(uiSessionId, payload.sessionId, summarizeQuestionRequest(mappedWithRole));
        }
      }
      if (isLongTaskRuntimeHiddenFromChat(targetSession, payload.sessionId)) {
        mergeHiddenLongTaskEvent(payload.sessionId, mappedWithRole);
        if (shouldMirrorHiddenLongTaskEvent(mappedWithRole)) {
          enqueueStreamEvent(uiSessionId, mappedWithRole);
        }
        if (mappedWithRole.type === "question_request" || mappedWithRole.type === "approval_request" || mappedWithRole.type === "error") {
          flushStreamEvents();
          persistLocalConversationState();
        }
        return;
      }
      enqueueStreamEvent(uiSessionId, mappedWithRole);
      scheduleOfficialGoalRefresh(uiSessionId, payload.sessionId);
      if (mappedWithRole.type === "tool_call" || mappedWithRole.type === "tool_result") {
        updateSession(uiSessionId, (session) => {
          const terminalGoal = inferTerminalGoalFromEvent(mappedWithRole, session.officialGoal?.goal);
          if (!terminalGoal) return session;
          return {
            ...session,
            officialGoal: {
              goal: terminalGoal,
              error: null,
              updatedAt: Date.now(),
            },
            updatedAt: Date.now(),
          };
        });
        syncCurrentSessionFromStore(uiSessionId);
      }
      if (mappedWithRole.type === "question_request" || mappedWithRole.type === "approval_request" || mappedWithRole.type === "error") {
        flushStreamEvents();
        persistLocalConversationState();
      }
    });

    const unsubscribeKimiCodeStatus = window.api.onKimiCodeStatus((payload) => {
      const uiSessionId = resolveUiSessionId(payload.sessionId);
      const targetSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
      if (targetSession?.engine !== "kimi-code" && !targetSession?.longTask) return;

      if (payload.status === "running") {
        const runningSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
        runtimeTurnStartRef.current.set(payload.sessionId, {
          eventStartIndex: runningSession?.events.length ?? 0,
          openAssistantIds: new Set((runningSession?.events ?? []).flatMap((event) => (
            event.type === "assistant_message" && !event.isComplete ? [event.id] : []
          ))),
        });
        setRunningSessionId(uiSessionId);
        return;
      }

      if (!["completed", "error", "interrupted"].includes(payload.status)) return;

      flushStreamEvents();
      void refreshOfficialGoalState(uiSessionId, payload.sessionId);
      goalLastRefreshRef.current.set(`${uiSessionId}:${payload.sessionId}`, Date.now());
      const activeRunningSessionId = useAppStore.getState().runningSessionId;
      if (activeRunningSessionId === uiSessionId || activeRunningSessionId === payload.sessionId) {
        setRunningSessionId(null);
      }

      if (payload.status === "error" || payload.status === "interrupted") {
        runtimeTurnStartRef.current.delete(payload.sessionId);
        updateSession(uiSessionId, (session) => ({
          ...session,
          events: settlePendingSteerMessages(
            settlePendingQuestions(closeOpenCompaction(session.events.filter((event) => !(event.type === "assistant_message" && !event.isComplete)))),
            "failed",
            payload.status === "interrupted" ? "引导未完成，当前轮已中断。" : "引导未完成，当前轮执行失败。",
          ),
          updatedAt: Date.now(),
        }));
        return;
      }

      const turnStart = runtimeTurnStartRef.current.get(payload.sessionId);
      updateSession(uiSessionId, (session) => ({
        ...session,
        events: appendSessionRecommendationIfNeeded(
          settlePendingSteerMessages(settleInactiveEvents(session.events), "sent"),
          useAppStore.getState().sessionRecommendationEnabled,
          useAppStore.getState().sessionRecommendationTurnLimit,
        ),
        updatedAt: Date.now(),
      }));
      const completedSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
      const assistantContent = extractAssistantContentForTurn(completedSession?.events ?? [], turnStart);
      notifyTurnComplete(uiSessionId, payload.sessionId, undefined, assistantContent);
      runtimeTurnStartRef.current.delete(payload.sessionId);

      dispatchNextPendingKimiMessage(uiSessionId, payload.sessionId);
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

      const statusUiSessionId = resolveUiSessionId(payload.sessionId);
      const statusSession = useSessionStore.getState().sessions.find((session) => session.id === statusUiSessionId);
      if (statusSession?.engine === "kimi-code" && !statusSession.longTask) {
        return;
      }

      if (payload.status === "running") {
        const uiSessionId = statusUiSessionId;
        const runningSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
        runtimeTurnStartRef.current.set(payload.sessionId, {
          eventStartIndex: runningSession?.events.length ?? 0,
          openAssistantIds: new Set((runningSession?.events ?? []).flatMap((event) => (
            event.type === "assistant_message" && !event.isComplete ? [event.id] : []
          ))),
        });
        markLongTaskRuntimeActivity(uiSessionId, payload.sessionId, "running");
        if (runningSession?.longTask?.reviewerSessionId === payload.sessionId) {
          upsertLongTaskAgentProxyMessage(uiSessionId, "reviewer", "running");
        }
        setRunningSessionId(uiSessionId);
        return;
      }

      if (!["completed", "error", "interrupted"].includes(payload.status)) {
        return;
      }

      const uiSessionId = statusUiSessionId;
      const terminalStatus = payload.status as "completed" | "error" | "interrupted";
      const terminalSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
      const isReviewerTerminal = terminalSession?.longTask?.reviewerSessionId === payload.sessionId;
      flushStreamEvents();
      markLongTaskRuntimeActivity(uiSessionId, payload.sessionId, terminalStatus);
      if (isReviewerTerminal && terminalStatus !== "completed") {
        upsertLongTaskAgentProxyMessage(uiSessionId, "reviewer", terminalStatus);
      }
      const activeRunningSessionId = useAppStore.getState().runningSessionId;
      if (activeRunningSessionId === uiSessionId || activeRunningSessionId === payload.sessionId) {
        setRunningSessionId(null);
      }

      if (payload.status === "error" || payload.status === "interrupted") {
        runtimeTurnStartRef.current.delete(payload.sessionId);
        updateSession(uiSessionId, (session) => ({
          ...session,
          events: settlePendingSteerMessages(
            settlePendingQuestions(closeOpenCompaction(session.events.filter((event) => !(event.type === "assistant_message" && !event.isComplete)))),
            "failed",
            payload.status === "interrupted" ? "引导未完成，当前轮已中断。" : "引导未完成，当前轮执行失败。",
          ),
          updatedAt: Date.now(),
        }));
      }

      if (payload.status === "completed") {
        const turnStart = runtimeTurnStartRef.current.get(payload.sessionId);
        updateSession(uiSessionId, (session) => ({
          ...session,
          events: appendSessionRecommendationIfNeeded(
            settlePendingSteerMessages(settleInactiveEvents(session.events), "sent"),
            useAppStore.getState().sessionRecommendationEnabled,
            useAppStore.getState().sessionRecommendationTurnLimit,
          ),
          updatedAt: Date.now(),
        }));
        const completedRole = getLongTaskRoleForRuntime(
          useSessionStore.getState().sessions.find((session) => session.id === uiSessionId),
          payload.sessionId,
        );
        const completedSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
        const assistantContent = extractAssistantContentForTurn(completedSession?.events ?? [], turnStart);
        notifyTurnComplete(uiSessionId, payload.sessionId, completedRole === "executor" ? "执行" : completedRole === "reviewer" ? "审核" : undefined, assistantContent);
        runtimeTurnStartRef.current.delete(payload.sessionId);

        applyLongTaskProgressFromLatestOutput(uiSessionId, payload.sessionId);
        if (dispatchLongTaskReview(uiSessionId, payload.sessionId)) {
          return;
        }
        if (dispatchLongTaskExecutorFromReview(uiSessionId, payload.sessionId)) {
          return;
        }
        if (isReviewerTerminal) {
          const reviewerOutput = getHiddenLongTaskAssistantContent(payload.sessionId);
          pauseLongTaskReviewerWithError(
            uiSessionId,
            reviewerOutput.trim().length > 0
              ? "审查 agent 已结束，但没有给出明确结论（通过 / 需修复 / 待人工审查），已暂停当前长程任务。"
              : "审查 agent 已结束，但没有返回可用结果，已暂停当前长程任务。",
          );
          return;
        }

        const latestSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
        if (latestSession && hasPendingQuestion(latestSession.events)) {
          persistLocalConversationState();
          return;
        }

        const next = useSessionStore.getState().shiftPendingMessage(uiSessionId);
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
                isThinking: useAppStore.getState().defaultThinking,
                isComplete: false,
              },
            ],
            updatedAt: Date.now(),
          }));
          setRunningSessionId(uiSessionId);
          const timer = setTimeout(() => {
            const runtimeSessionId = resolveRuntimeSessionId(uiSessionId);
            const latestForQueue = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
            const sendPromise = sendKimiCodePromptWithRetry({
              sessionId: runtimeSessionId,
              content: next.content,
              images: next.images?.map((image) => ({ name: image.name, dataUrl: image.dataUrl ?? "" })).filter((image) => image.dataUrl),
            });
            sendPromise.then((res) => {
              if (res.success) return;
              throw new Error(res.error);
            }).catch((err) => {
              useSessionStore.getState().addPendingMessage(uiSessionId, next.content, next.images);
              updateSession(uiSessionId, (session) => ({
                ...session,
                events: [
                  ...session.events.filter((event) => event.id !== placeholderId && event.id !== userEventId),
                  {
                    id: crypto.randomUUID(),
                    type: "error" as const,
                    timestamp: Date.now(),
                    message: err instanceof Error ? err.message : String(err),
                    source: "ipc" as const,
                  },
                ],
                updatedAt: Date.now(),
              }));
              setRunningSessionId(null);
            });
          }, 300);
          timersRef.current.push(timer);
        }
      }
    });

    return () => {
      unsubscribeEvent();
      unsubscribeStatus();
      unsubscribeKimiCodeEvent();
      unsubscribeKimiCodeStatus();
      unsubscribeBootstrap();
      window.removeEventListener("kimix:startHandoff", handleStartHandoff);
      window.removeEventListener("focus", markRendererWindowFocused);
      window.removeEventListener("blur", markRendererWindowBlurred);
      document.removeEventListener("pointerdown", markRendererWindowFocused, true);
      document.removeEventListener("keydown", markRendererWindowFocused, true);
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      goalRefreshTimersRef.current.forEach(clearTimeout);
      goalRefreshTimersRef.current.clear();
      goalLastRefreshRef.current.clear();
    };
  }, [setHandoffSessionId, setRunningSessionId, updateSession, setRecentProjects, defaultThinking, defaultPlanMode, permissionMode, enqueueStreamEvent, flushStreamEvents]);

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
  }, [defaultThinking, defaultPlanMode, permissionMode, updateSession]);

  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}

export default App;
