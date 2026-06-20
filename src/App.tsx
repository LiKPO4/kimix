import { useEffect, useRef, useCallback } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { ThemeProvider } from "@/components/common/ThemeProvider";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { PendingMessage } from "@/stores/sessionStore";
import type { Session, TimelineEvent, UserMessageImage } from "@/types/ui";
import { mapHistoryEvents, mapStreamEvent, mergeEvents } from "@/utils/eventMapper";
import { mapKimiCodeApprovalRequest, mapKimiCodeEvent, mapKimiCodeQuestionRequest } from "@/utils/kimiCodeEventMapper";
import { deriveSessionTitle, truncateSessionTitle } from "@/utils/sessionTitle";
import { countUserTurns, shouldRecommendNewSession } from "@/utils/sessionMetrics";
import { getLongTaskRoleForRuntime, getRuntimeSessionId } from "@/utils/runtimeSession";
import { isHiddenInternalSession } from "@/utils/internalSessions";
import { isKimiActiveTurnError, sendKimiCodePromptWithRetry } from "@/utils/kimiCodeSendRetry";
import { shouldSkipKimiCodeSnapshotReplay } from "@/utils/kimiCodeSnapshotReplay";
import { isKimiCodeSessionMissingError, removeStaleKimiCodeStartupErrors } from "@/utils/kimiCodeSessionRecovery";
import { isTerminalKimiCodeEngineStatus } from "@/utils/sessionActivity";
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
  isArchivedSessionTombstoned,
  rememberHiddenHandoffSession,
  rememberArchivedSessionTombstone,
  persistLocalConversationState,
  readLocalActiveContext,
  resetStaleSessionRecommendationEvents,
  LOCAL_SESSIONS_KEY,
  LOCAL_PENDING_KEY,
} from "@/utils/persistence";
import { useRendererLagDetector } from "@/hooks/useRendererLagDetector";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useSettingsSync } from "@/hooks/useSettingsSync";
import { useStatePersistence } from "@/hooks/useStatePersistence";
import { useEventStream } from "@/hooks/useEventStream";
import { useBootstrap } from "@/hooks/useBootstrap";

function promptImages(attachments: UserMessageImage[] = []) {
  return attachments
    .filter((image): image is UserMessageImage & { dataUrl: string } => Boolean(image.dataUrl))
    .map((image) => ({ name: image.name, dataUrl: image.dataUrl }));
}

function contentWithFileAttachments(content: string, attachments: UserMessageImage[] = []) {
  const files = attachments.filter((image) => image.kind === "file" || Boolean(image.filePath));
  if (files.length === 0) return content;
  const fileLines = files.map((file, index) => {
    const filePath = file.filePath?.trim();
    return `${index + 1}. ${file.name}${filePath ? `\n   绝对路径：${filePath}` : "\n   绝对路径：未能从系统拖拽事件读取，请提示用户重新选择文件"}`;
  });
  return [
    content.trim(),
    "附件文件：",
    ...fileLines,
    "",
    "请直接使用上述绝对路径读取附件内容，不要只按文件名搜索。",
  ].filter(Boolean).join("\n");
}

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
const HANDOFF_TIMEOUT_MS = 180_000;
const KIMI_RUNTIME_PREWARM_DELAY_MS = 3_000;
const KIMI_RUNTIME_PREWARM_RETRY_COOLDOWN_MS = 30_000;
let rendererWindowFocusedHint = typeof document !== "undefined" ? document.hasFocus() : false;

interface HandoffJob {
  sourceSessionId: string;
  runtimeSessionId: string;
  projectPath: string;
  recommendationEventId: string;
  events: TimelineEvent[];
  timeoutId: ReturnType<typeof window.setTimeout>;
}

interface StartHandoffDetail {
  sourceSessionId: string;
  projectPath: string;
  recommendationEventId: string;
}

function findLocalSessionForRuntime(historySessionId: string, runtimeSessionId?: string, officialSessionId?: string | null): Session | undefined {
  const ids = new Set([historySessionId, runtimeSessionId, officialSessionId ?? undefined].filter((id): id is string => Boolean(id)));
  return useSessionStore.getState().sessions.find((session) => !session.archivedAt && (
    ids.has(session.id) ||
    Boolean(session.officialSessionId && ids.has(session.officialSessionId)) ||
    Boolean(session.runtimeSessionId && ids.has(session.runtimeSessionId)) ||
    Boolean(session.longTask?.executorSessionId && ids.has(session.longTask.executorSessionId)) ||
    Boolean(session.longTask?.reviewerSessionId && ids.has(session.longTask.reviewerSessionId))
  ));
}

function hasArchivedLocalSessionForRuntime(historySessionId: string, runtimeSessionId?: string, officialSessionId?: string | null, projectPath?: string): boolean {
  const ids = new Set([historySessionId, runtimeSessionId, officialSessionId ?? undefined].filter((id): id is string => Boolean(id)));
  if (isArchivedSessionTombstoned([...ids], projectPath)) return true;
  return useSessionStore.getState().sessions.some((session) => (
    Boolean(session.archivedAt) &&
    (!projectPath || isSameLocalProjectPath(session.projectPath, projectPath)) &&
    (
      ids.has(session.id) ||
      Boolean(session.officialSessionId && ids.has(session.officialSessionId)) ||
      Boolean(session.runtimeSessionId && ids.has(session.runtimeSessionId)) ||
      Boolean(session.longTask?.executorSessionId && ids.has(session.longTask.executorSessionId)) ||
      Boolean(session.longTask?.reviewerSessionId && ids.has(session.longTask.reviewerSessionId))
    )
  ));
}

function normalizeLocalProjectPath(projectPath: string | undefined) {
  return (projectPath ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function isSameLocalProjectPath(a: string | undefined, b: string | undefined) {
  const left = normalizeLocalProjectPath(a);
  const right = normalizeLocalProjectPath(b);
  return Boolean(left && right && left === right);
}

function assistantBodySize(events: TimelineEvent[]) {
  return events
    .filter((event): event is Extract<TimelineEvent, { type: "assistant_message" }> => event.type === "assistant_message")
    .reduce((sum, event) => sum + event.content.trim().length, 0);
}

function displayableUserImageCount(events: TimelineEvent[]) {
  return events
    .filter((event): event is Extract<TimelineEvent, { type: "user_message" | "steer_message" }> => (
      event.type === "user_message" || event.type === "steer_message"
    ))
    .reduce((sum, event) => sum + (event.images ?? []).filter((image) => (
      typeof image.dataUrl === "string" && image.dataUrl.startsWith("data:image/")
    )).length, 0);
}

function hasPossiblyLostUserImages(events: TimelineEvent[]) {
  return events.some((event) => {
    if (event.type !== "user_message" && event.type !== "steer_message") return false;
    return (event.images ?? []).some((image) => (
      !image.filePath &&
      !(typeof image.dataUrl === "string" && image.dataUrl.startsWith("data:image/"))
    ));
  });
}

function needsKimiCodeHistoryRepair(session: Session) {
  return session.engine === "kimi-code" &&
    !session.longTask &&
    !session.archivedAt &&
    Boolean(session.projectPath) &&
    (
      session.events.some((event) => (
        event.type === "assistant_message" &&
        event.isComplete &&
        event.content.trim().length === 0
      )) ||
      hasPossiblyLostUserImages(session.events)
    );
}

function getKimiHistorySessionIds(session: Session) {
  return Array.from(new Set([
    session.runtimeSessionId,
    session.officialSessionId,
    session.id.startsWith("local-") ? undefined : session.id,
  ].filter((id): id is string => Boolean(id))));
}

function extractOfficialSessionTitle(event: unknown): string | null {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const record = event as Record<string, unknown>;
  if (record.type !== "session.meta.updated" || typeof record.title !== "string") return null;
  const title = truncateSessionTitle(record.title);
  return title && title !== "New Session" ? title : null;
}

async function repairKimiCodeHistoryBodies(sessions: Session[]) {
  const candidates = sessions.filter(needsKimiCodeHistoryRepair).slice(0, 12);
  for (const session of candidates) {
    const sessionIds = getKimiHistorySessionIds(session);
    if (sessionIds.length === 0 || !session.projectPath) continue;
    for (const sessionId of sessionIds) {
      const loaded = await window.api.loadKimiCodeSession({ workDir: session.projectPath, sessionId }).catch(() => null);
      if (!loaded?.success) continue;
      const eventsSource =
        loaded.data && typeof loaded.data === "object" && Array.isArray(loaded.data.events)
          ? loaded.data.events
          : [];
      const historyEvents = settleInactiveEvents(mapHistoryEvents(eventsSource));
      const hasMoreAssistantBody = assistantBodySize(historyEvents) > assistantBodySize(session.events);
      const hasMoreDisplayableImages = displayableUserImageCount(historyEvents) > displayableUserImageCount(session.events);
      if (!hasMoreAssistantBody && !hasMoreDisplayableImages) continue;
      const updatedAt = Date.now();
      useSessionStore.setState((state) => ({
        sessions: state.sessions.map((item) => item.id === session.id
          ? {
              ...item,
              events: historyEvents,
              title: item.titleLocked ? item.title : deriveSessionTitle(historyEvents, item.title),
              isLoading: false,
              updatedAt,
            }
          : item
        ),
      }));
      const current = useAppStore.getState().currentSession;
      if (current?.id === session.id) {
        useAppStore.setState({
          currentSession: {
            ...current,
            events: historyEvents,
            title: current.titleLocked ? current.title : deriveSessionTitle(historyEvents, current.title),
            isLoading: false,
            updatedAt,
          },
        });
      }
      persistLocalConversationState();
      break;
    }
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

function getHandoffTerminalStatus(event: unknown): "completed" | "error" | "interrupted" | null {
  const type = event && typeof event === "object" ? (event as { type?: unknown }).type : undefined;
  if (type === "turn.ended") {
    const reason = (event as { reason?: unknown }).reason;
    if (reason === "cancelled" || reason === "interrupted") return "interrupted";
    if (reason === "failed" || reason === "error") return "error";
    return "completed";
  }
  if (type === "error") return "error";
  return null;
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
  const roleLabel = role === "reviewer" ? "用户审查流程" : "长程任务";
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
  return Boolean(
    session?.longTask &&
    session.longTask.reviewerSessionId !== session.longTask.executorSessionId &&
    session.longTask.reviewerSessionId === runtimeSessionId
  );
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

type LongTaskStatusBlock = {
  role?: "executor" | "reviewer";
  status?: string;
  conclusion?: string;
  step?: number;
  totalSteps?: number;
};

function normalizeLongTaskRole(value: unknown): LongTaskStatusBlock["role"] {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "executor" || normalized === "执行" || normalized === "执行 agent") return "executor";
  if (normalized === "reviewer" || normalized === "审查" || normalized === "审核" || normalized === "审查 agent") return "reviewer";
  return undefined;
}

function normalizeLongTaskPositiveInt(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  return Number.isInteger(number) && number >= 0 ? number : undefined;
}

function extractLongTaskStatusBlock(content: string): LongTaskStatusBlock | null {
  const blocks: string[] = [];
  const fenceRegex = /```(?:kimix-long-task-status|kimix_long_task_status)\s*([\s\S]*?)```/gi;
  for (const match of content.matchAll(fenceRegex)) {
    if (match[1]?.trim()) blocks.push(match[1].trim());
  }
  const inlineRegex = /KIMIX_LONG_TASK_STATUS\s*({[\s\S]*?})/gi;
  for (const match of content.matchAll(inlineRegex)) {
    if (match[1]?.trim()) blocks.push(match[1].trim());
  }
  for (const raw of blocks.reverse()) {
    try {
      const parsed = JSON.parse(raw.replace(/^json\s*/i, "").trim()) as Record<string, unknown>;
      return {
        role: normalizeLongTaskRole(parsed.role ?? parsed.agent),
        status: typeof parsed.status === "string" ? parsed.status.trim() : typeof parsed.state === "string" ? parsed.state.trim() : undefined,
        conclusion: typeof parsed.conclusion === "string" ? parsed.conclusion.trim() : undefined,
        step: normalizeLongTaskPositiveInt(parsed.step ?? parsed.currentStep),
        totalSteps: normalizeLongTaskPositiveInt(parsed.totalSteps ?? parsed.targetStep ?? parsed.steps),
      };
    } catch {
      // Ignore malformed machine blocks and fall back to human-readable parsing below.
    }
  }
  return null;
}

function normalizeLongTaskExecutorStatus(value: string | undefined) {
  const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, "_") ?? "";
  if (["planning", "clarifying", "needs_clarification", "drafting"].includes(normalized)) return "planning";
  if (["ready", "planning_ready", "waiting_user", "awaiting_confirmation", "ready_for_execution"].includes(normalized)) return "ready";
  if (["ready_for_review", "needs_review", "review", "handoff_to_reviewer", "awaiting_review"].includes(normalized)) return "ready_for_review";
  if (["blocked", "manual_review", "paused", "needs_user"].includes(normalized)) return "blocked";
  if (["running", "executing"].includes(normalized)) return "running";
  if (["completed", "complete", "done"].includes(normalized)) return "completed";
  return null;
}

function inferLongTaskProgressPatch(session: Session, runtimeSessionId: string) {
  const meta = session.longTask;
  if (!meta || meta.executorSessionId !== runtimeSessionId) return null;
  const content = latestAssistantContent(session.events);
  if (!content) return null;

  const machineStatus = extractLongTaskStatusBlock(content);
  const executorStatus = machineStatus?.role === "reviewer" ? null : normalizeLongTaskExecutorStatus(machineStatus?.status);
  if (executorStatus) {
    const patch: Partial<NonNullable<Session["longTask"]>> = {};
    if (executorStatus === "planning") patch.stage = "planning";
    if (executorStatus === "ready") patch.stage = "ready";
    if (executorStatus === "ready_for_review" || executorStatus === "running") patch.stage = "running";
    if (executorStatus === "blocked") patch.stage = "paused";
    if (machineStatus?.step && machineStatus.step > 0) patch.currentStep = machineStatus.step;
    if (machineStatus?.totalSteps && machineStatus.totalSteps > 0 && !meta.targetStep) patch.targetStep = machineStatus.totalSteps;
    if (Object.keys(patch).length > 0) return patch;
  }

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

function isLongTaskExecutorTurnComplete(content: string) {
  const machineStatus = extractLongTaskStatusBlock(content);
  const executorStatus = machineStatus?.role === "reviewer" ? null : normalizeLongTaskExecutorStatus(machineStatus?.status);
  if (executorStatus === "ready_for_review") return true;
  return /执行完成|长程任务执行完成|已写入执行记录|rounds\/step\d+\.md|Step\s*\d+.*(?:完成|已完成|执行完成)|下一步状态[：:\s]*(?:继续下一步|全部完成)|交给.*审查/i.test(content);
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
    runtimeSessionId: normalized.longTask.executorSessionId,
    longTask: {
      ...normalized.longTask,
      ...patch,
      activeAgent: "executor",
    },
  };
}

function shouldContinueLongTaskExecution(session: Session, runtimeSessionId: string) {
  if (!session.longTask) return false;
  if (session.longTask.executorSessionId !== runtimeSessionId) return false;
  if (session.longTask.stage !== "running") return false;
  if (hasPendingQuestion(session.events)) return false;
  const content = latestAssistantContent(session.events);
  return isLongTaskExecutorTurnComplete(content);
}

function buildLongTaskReviewPrompt(session: Session) {
  const meta = session.longTask;
  if (!meta) return "";
  const executorOutput = latestAssistantContent(session.events);
  return `【Kimix 长程任务：请审查本轮执行结果】
你正在处理 Kimix 长程任务的用户审查流程。

请先阅读：
- ${meta.reviewQueuePath}
- ${meta.bigPlanPath}

审查目标：
1. 检查本轮执行结果是否符合 BIGPLAN.md 中当前步骤的目标、范围和验收标准，必须引用当前 Step 编号和验收标准。
2. 检查本轮是否提供实际验证证据；不能仅凭自述放行。
3. 如果计划不可执行、步骤过大、缺少必要验证或存在必须先处理的问题，请给出需修复的问题，后续由 Kimix 交回任务执行流程修复。
4. 暂时无法自动确认但不阻塞继续的事项，请写入 ${meta.reviewQueuePath}，并仍使用“结论：通过”。
5. 只有无法安全继续、必须等用户或外部环境确认时，才使用“结论：待人工审查”；该结论会让 Kimix 暂停长程任务。
6. 不要直接执行代码修改；本轮只做执行结果审查。
7. 不要询问用户是否继续下一步；如本轮可继续，请明确写出“结论：通过”，Kimix 会自动调度任务进入下一步。
8. 你的最终正文第一行必须且只能是“结论：通过”或“结论：需修复”或“结论：待人工审查”，不要只把结论写在思考过程里。

本轮最近输出：
${executorOutput || "暂无可用输出，请直接读取 BIGPLAN.md 审查。"}`;
}

type LongTaskReviewConclusion = "pass" | "needs_fix" | "manual_review" | "unknown";

function inferLongTaskReviewConclusion(content: string): LongTaskReviewConclusion {
  const machineStatus = extractLongTaskStatusBlock(content);
  const machineConclusion = (machineStatus?.conclusion || machineStatus?.status || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["pass", "passed", "approved", "通过", "审查通过"].includes(machineConclusion)) return "pass";
  if (["needs_fix", "fix", "failed", "fail", "reject", "rejected", "需修复", "需要修复", "不通过", "未通过"].includes(machineConclusion)) return "needs_fix";
  if (["manual_review", "needs_user", "blocked", "人工审查", "待人工审查", "需要用户"].includes(machineConclusion)) return "manual_review";

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
    return `【Kimix 长程任务：用户审查发现问题，请先修复】
用户审查流程对 Step ${step} 的结论是“需修复”。

请按以下规则执行：
1. 先阅读 ${meta.bigPlanPath} 和下面的审查意见。
2. 先提取审查问题清单，再逐项修复；只处理审查指出的问题，不进入下一步。
3. 修复完成后更新必要文件，并把本轮修复、验证证据、残余风险写入 rounds/ 对应记录。
4. 如无法修复，请明确写出阻塞原因和需要用户提供的信息。
5. 结束时明确写出“Step ${step} 修复完成，继续下一步”。

审查意见：
${reviewerOutput || "用户审查流程未给出可用正文，请读取任务文件后修复。"}`
  }

  if (conclusion === "manual_review") {
    return `【Kimix 长程任务：待人工审查，暂停继续执行】
用户审查流程对 Step ${step} 的结论是“待人工审查”。

请不要进入下一步。需要用户或外部环境确认后，才能继续调度任务。

审查意见：
${reviewerOutput || "用户审查流程未给出可用正文，请读取任务文件后等待人工确认。"}`
  }

  const nextStep = step + 1;
    return `【Kimix 长程任务：用户审查可继续，请执行下一步】
用户审查流程已通过 Step ${step}。现在请继续执行 Step ${nextStep}。

请按以下规则执行：
1. 这是 Kimix 内部调度指令，不要询问用户是否继续；除非缺少执行 Step ${nextStep} 的必要信息或遇到阻塞，否则直接开始执行。
2. 先阅读 ${meta.bigPlanPath}，确认当前 Step ${step} 已通过、下一步确实是 Step ${nextStep}。
3. 只执行 Step ${nextStep} 这一轮，不要把后续多个 Step 合并执行。
4. 完成 Step ${nextStep} 后必须停止本轮，不能自行继续 Step ${nextStep + 1}。
5. 完成后更新必要文件，并把本轮产出、验证证据、残余风险写入 rounds/ 对应记录。
6. 结束时明确写出“Step ${nextStep} 执行完成，继续下一步”。

用户审查流程对上一轮的意见：
${reviewerOutput || "用户审查流程未给出可用正文，请按 BIGPLAN.md 继续。"}`
}

function buildLongTaskExecutorNextPrompt(session: Session, nextStep: number) {
  const meta = session.longTask;
  if (!meta) return "";
  const targetStep = meta.targetStep ?? nextStep;
  const isFinalStep = nextStep >= targetStep;
  return `【Kimix 长程任务：继续执行 Step ${nextStep}】
本任务按 BIGPLAN 自动自推进。

请按以下规则执行：
1. 先阅读 ${meta.bigPlanPath}，确认当前进度和 Step ${nextStep} 的目标、范围、验收标准、验证方式。
2. 只执行 Step ${nextStep} 这一轮，不要合并后续多个 Step。
3. 完成后更新必要文件，并把本轮产出、验证证据、残余风险写入 rounds/ 对应记录。
4. 不要启动、模拟或等待额外审查流程；不要输出 \`kimix-long-task-status\` 或任何机器状态代码块。
${isFinalStep
  ? "5. 这是目标范围内最后一个 Step。完成后必须输出“最终结果”和“建议用户全盘审查的内容”，并明确写出“长程任务执行完成”。"
  : `5. 完成后必须明确写出“Step ${nextStep} 执行完成，继续下一步”，然后停止本轮输出，等待 Kimix 自动调度 Step ${nextStep + 1}。`}

如果发现必须由用户确认或外部环境处理的问题，请写入 ${meta.reviewQueuePath}，并明确说明阻塞原因。`;
}

async function createSessionAndSendPrompt(projectPath: string, content: string) {
  const appState = useAppStore.getState();
  const sessionStore = useSessionStore.getState();
  const sessionRes = await window.api.startKimiCodeRuntime({
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
  await window.api.sendKimiCodePrompt({
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
  const setThemePalette = useAppStore((s) => s.setThemePalette);
  const setCustomThemePalette = useAppStore((s) => s.setCustomThemePalette);
  const setKimiThemePalettes = useAppStore((s) => s.setKimiThemePalettes);
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
  const setFilePreviewExtensions = useAppStore((s) => s.setFilePreviewExtensions);
  const setHandoffSessionId = useAppStore((s) => s.setHandoffSessionId);
  const setRunningSessionId = useAppStore((s) => s.setRunningSessionId);
  const defaultThinking = useAppStore((s) => s.defaultThinking);
  const defaultPlanMode = useAppStore((s) => s.defaultPlanMode);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const runningSessionId = useAppStore((s) => s.runningSessionId);
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
  const runtimePrewarmInFlightRef = useRef<Set<string>>(new Set());
  const runtimePrewarmRetryAfterRef = useRef<Map<string, number>>(new Map());
  const runtimePrewarmLastOkRef = useRef<Map<string, string>>(new Map());
  const runtimeTerminalPollRef = useRef<Map<string, number>>(new Map());

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
    setThemePalette,
    setCustomThemePalette,
    setKimiThemePalettes,
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
    setFilePreviewExtensions,
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

  useEffect(() => {
    const session = currentSession;
    if (!session || session.engine !== "kimi-code") return;
    if (!session.projectPath || session.archivedAt || session.longTask) return;
    if (runningSessionId === session.id || Boolean(runningSessionId && runningSessionId === session.officialSessionId)) return;
    if (session.events.some((event) => event.type === "assistant_message" && !event.isComplete)) return;

    const retryAfter = runtimePrewarmRetryAfterRef.current.get(session.id) ?? 0;
    if (runtimePrewarmInFlightRef.current.has(session.id) || retryAfter > Date.now()) return;
    const runtimeCandidate = session.runtimeSessionId ?? session.officialSessionId ?? null;
    const lastOkKey = runtimeCandidate ? `${runtimeCandidate}:${permissionMode}:${defaultPlanMode}` : "";
    if (lastOkKey) {
      const lastOk = runtimePrewarmLastOkRef.current.get(session.id);
      if (lastOk === lastOkKey) return;
    }

    const timer = window.setTimeout(async () => {
      const latest = useSessionStore.getState().sessions.find((item) => item.id === session.id);
      if (!latest || latest.archivedAt || latest.longTask) return;
      if (latest.events.some((event) => event.type === "assistant_message" && !event.isComplete)) return;
      const active = useAppStore.getState().currentSession;
      if (active?.id !== latest.id) return;
      const activeRunningSessionId = useAppStore.getState().runningSessionId;
      if (activeRunningSessionId === latest.id || Boolean(activeRunningSessionId && activeRunningSessionId === latest.officialSessionId)) return;

      runtimePrewarmInFlightRef.current.add(latest.id);
      try {
        let prewarmRes: Awaited<ReturnType<typeof window.api.createKimiCodeSession>> | null = null;
        const existingRuntimeId = latest.runtimeSessionId ?? latest.officialSessionId;
        if (existingRuntimeId) {
          const resumeRes = await window.api.resumeKimiCodeSession({ sessionId: existingRuntimeId });
          if (resumeRes.success && (!latest.projectPath || isSameLocalProjectPath(resumeRes.data.workDir, latest.projectPath))) {
            prewarmRes = resumeRes;
          } else if (!resumeRes.success && isKimiCodeSessionMissingError(resumeRes.error)) {
            useSessionStore.getState().updateSession(latest.id, (item) => ({
              ...item,
              runtimeSessionId: undefined,
              officialSessionId: undefined,
              updatedAt: Date.now(),
            }));
            syncCurrentSessionFromStore(latest.id);
          }
        }
        if (!prewarmRes) {
          prewarmRes = await window.api.createKimiCodeSession({
            workDir: latest.projectPath,
            permission: useAppStore.getState().permissionMode,
            planMode: useAppStore.getState().defaultPlanMode,
          });
        }
        if (!prewarmRes.success) throw new Error(prewarmRes.error);

        const runtimeSessionId = prewarmRes.data.sessionId;
        useSessionStore.getState().updateSession(latest.id, (item) => {
          if (item.events.some((event) => event.type === "assistant_message" && !event.isComplete)) return item;
          return {
            ...item,
            engine: "kimi-code",
            runtimeSessionId,
            officialSessionId: item.officialSessionId ?? runtimeSessionId,
            updatedAt: Date.now(),
          };
        });
        syncCurrentSessionFromStore(latest.id);
        runtimePrewarmRetryAfterRef.current.delete(latest.id);
        runtimePrewarmLastOkRef.current.set(latest.id, `${runtimeSessionId}:${useAppStore.getState().permissionMode}:${useAppStore.getState().defaultPlanMode}`);

        const latestPermission = useAppStore.getState().permissionMode;
        const latestPlanMode = useAppStore.getState().defaultPlanMode;
        void window.api.setKimiCodePermission({ sessionId: runtimeSessionId, mode: latestPermission }).catch((err) => {
          console.warn("[App] setKimiCodePermission failed:", err);
        });
        void window.api.setKimiCodePlanMode({ sessionId: runtimeSessionId, enabled: latestPlanMode }).catch((err) => {
          console.warn("[App] setKimiCodePlanMode failed:", err);
        });
      } catch (err) {
        runtimePrewarmRetryAfterRef.current.set(latest.id, Date.now() + KIMI_RUNTIME_PREWARM_RETRY_COOLDOWN_MS);
        console.warn("Kimi Code runtime prewarm failed:", err);
      } finally {
        runtimePrewarmInFlightRef.current.delete(latest.id);
      }
    }, KIMI_RUNTIME_PREWARM_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [currentSession, runningSessionId, permissionMode, defaultPlanMode]);

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
    return isKimiCodeSessionMissingError(err);
  };

  const recoverLongTaskReviewerSession = async (uiSessionId: string, failedReviewerSessionId: string, prompt: string) => {
    const snapshot = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
    if (!snapshot?.longTask) throw new Error("当前长程任务不存在，无法恢复用户审查流程");

    const startRes = await window.api.startKimiCodeRuntime({
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

    const sendRes = await window.api.sendKimiCodePrompt({
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

  const dispatchLongTaskExecutorNext = (uiSessionId: string, runtimeSessionId: string) => {
    const latestSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
    if (!latestSession?.longTask || !shouldContinueLongTaskExecution(latestSession, runtimeSessionId)) {
      return false;
    }

    const currentStep = Math.max(latestSession.longTask.currentStep || 1, 1);
    const targetStep = latestSession.longTask.targetStep;
    if (!targetStep) return false;
    const executorOutput = latestAssistantContent(latestSession.events);
    appendLongTaskRoundOnce(latestSession, {
      step: currentStep,
      role: "executor",
      phase: "execution",
      content: executorOutput,
    });

    if (targetStep && currentStep >= targetStep) {
      updateSession(uiSessionId, (session) => session.longTask ? {
        ...session,
        runtimeSessionId: session.longTask.executorSessionId,
        longTask: {
          ...session.longTask,
          activeAgent: "executor",
          stage: "completed",
          recovery: null,
        },
        updatedAt: Date.now(),
      } : session);
      syncCurrentSessionFromStore(uiSessionId);
      persistLongTaskMeta(useSessionStore.getState().sessions.find((session) => session.id === uiSessionId));
      appendLongTaskRoundOnce(latestSession, {
        step: currentStep,
        role: "executor",
        phase: "complete",
        conclusion: "完成",
        content: `目标 Step ${targetStep} 已达到。请用户根据最终输出和 ${latestSession.longTask.reviewQueuePath} 做全盘审查。`,
      });
      return true;
    }

    const nextStep = currentStep + 1;
    const prompt = buildLongTaskExecutorNextPrompt(latestSession, nextStep);
    appendLongTaskRoundOnce(latestSession, {
      step: nextStep,
      role: "executor",
      phase: "handoff",
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
        recovery: null,
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
    void window.api.sendKimiCodePrompt({
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
          recovery: buildLongTaskRecovery("executor", "error", `启动下一步执行失败：${err instanceof Error ? err.message : String(err)}`),
        } : session.longTask,
        events: [
          ...session.events.filter((event) => !(event.type === "assistant_message" && !event.isComplete && !event.content.trim())),
          {
            id: crypto.randomUUID(),
            type: "error" as const,
            timestamp: Date.now(),
            message: `启动下一步执行失败：${err instanceof Error ? err.message : String(err)}`,
            canDismiss: false,
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

  const dispatchLongTaskReview = (uiSessionId: string, runtimeSessionId: string) => {
    const latestSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
    const reviewKey = `${uiSessionId}:${runtimeSessionId}:${latestSession?.events.length ?? 0}`;
    if (!latestSession?.longTask || !shouldContinueLongTaskExecution(latestSession, runtimeSessionId) || longTaskReviewDispatchRef.current.has(reviewKey)) {
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
    void window.api.sendKimiCodePrompt({
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
          recovery: buildLongTaskRecovery("reviewer", "error", `启动用户审查流程失败：${err instanceof Error ? err.message : String(err)}`),
        } : session.longTask,
        events: [
          ...session.events.filter((event) => !(event.type === "assistant_message" && !event.isComplete && !event.content.trim())),
          {
            id: crypto.randomUUID(),
            type: "error" as const,
            timestamp: Date.now(),
            message: `启动用户审查流程失败：${err instanceof Error ? err.message : String(err)}`,
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
        content: contentWithFileAttachments(next.content, next.images),
        images: promptImages(next.images),
      }).then((res) => {
        if (res.success) return;
        throw new Error(res.error);
      }).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        useSessionStore.getState().addPendingMessage(uiSessionId, next.content, next.images);
        if (isKimiActiveTurnError(message)) {
          updateSession(uiSessionId, (session) => {
            const filteredEvents = session.events.filter((event) => event.id !== placeholderId && event.id !== userEventId);
            console.log("[App pending dispatch active-turn]", {
              uiSessionId,
              placeholderId,
              userEventId,
              beforeCount: session.events.length,
              afterCount: filteredEvents.length,
            });
            return {
              ...session,
              events: filteredEvents,
              updatedAt: Date.now(),
            };
          });
          setRunningSessionId(uiSessionId);
          return;
        }
        updateSession(uiSessionId, (session) => ({
          ...session,
          events: [
            ...session.events.filter((event) => event.id !== placeholderId && event.id !== userEventId),
            {
              id: crypto.randomUUID(),
              type: "error" as const,
              timestamp: Date.now(),
              message,
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
          recovery: buildLongTaskRecovery("reviewer", "paused", "用户审查流程标记为待人工审查，需要人工确认后再继续。"),
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
    void window.api.sendKimiCodePrompt({
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
            message: `启动长程任务失败：${err instanceof Error ? err.message : String(err)}`,
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
      const activeContext = readLocalActiveContext();
      const localSessions = useSessionStore.getState().sessions;
      const latestLocalSession = [...localSessions]
        .filter((session) => !session.archivedAt && !isHiddenInternalSession(session))
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
      const activeLocalSession = activeContext?.sessionId
        ? localSessions.find((session) => session.id === activeContext.sessionId && !session.archivedAt && !isHiddenInternalSession(session))
        : latestLocalSession;

      window.api.listRecentProjects().then(async (projectsRes) => {
        const recentProjects = projectsRes.success ? projectsRes.data : [payload.project];
        if (projectsRes.success) setRecentProjects(projectsRes.data);
        const activeProject = activeLocalSession
          ? recentProjects.find((project) => isSameLocalProjectPath(project.path, activeLocalSession.projectPath)) ?? activeContext?.project ?? payload.project
          : activeContext?.project
            ? recentProjects.find((project) => isSameLocalProjectPath(project.path, activeContext.project?.path)) ?? activeContext.project
            : payload.project;
        useAppStore.setState({
          currentProject: activeProject,
          currentSession: activeLocalSession ?? useAppStore.getState().currentSession,
        });

        window.setTimeout(() => {
          void (async () => {
            try {
              const hiddenHandoffSessionIds = new Set(getHiddenHandoffSessionIds());
              const activeRuntimeIds = new Set([
                activeLocalSession?.id,
                activeLocalSession?.officialSessionId,
                activeLocalSession?.runtimeSessionId,
                activeLocalSession?.longTask?.executorSessionId,
                activeLocalSession?.longTask?.reviewerSessionId,
              ].filter((id): id is string => Boolean(id)));
              const isUsableHistorySession = (session: { id: string; title?: string; lastPrompt?: string }) => (
                !hiddenHandoffSessionIds.has(session.id) &&
                !isHiddenInternalSession(session) &&
                !hasArchivedLocalSessionForRuntime(session.id, undefined, undefined, activeProject.path)
              );

              const res = await window.api.listKimiCodeHistorySessions({ workDir: activeProject.path });
              if (!res.success) return;
              const activeSummaries = res.data.filter(isUsableHistorySession);
              const latest = (activeRuntimeIds.size > 0
                ? activeSummaries.find((summary) => activeRuntimeIds.has(summary.id))
                : undefined) ?? activeSummaries[0];
              const sessionIdToStart = latest?.id ?? activeLocalSession?.officialSessionId ?? activeLocalSession?.runtimeSessionId;
              if (!latest && !sessionIdToStart) return;

              const startOptions = {
                workDir: activeProject.path,
                sessionId: sessionIdToStart,
                thinking: useAppStore.getState().defaultThinking,
                yoloMode: useAppStore.getState().permissionMode === "yolo",
                autoMode: useAppStore.getState().permissionMode === "auto",
                planMode: useAppStore.getState().defaultPlanMode,
              };
              let startRes = await window.api.startKimiCodeRuntime(startOptions);
              if (!startRes.success && isKimiCodeSessionMissingError(startRes.error)) {
                console.warn(`[Kimi Code] startup session ${sessionIdToStart} is missing; creating a fresh runtime`);
                startRes = await window.api.startKimiCodeRuntime({
                  ...startOptions,
                  sessionId: undefined,
                });
              }
              if (!startRes.success) {
                if (isKimiCodeSessionMissingError(startRes.error)) {
                  console.warn("[Kimi Code] fresh startup runtime was not found; leaving recovery to background prewarm");
                  setRunningSessionId(null);
                  return;
                }
                if (activeLocalSession) {
                  const errorSession = {
                    ...activeLocalSession,
                    events: [
                      ...activeLocalSession.events,
                      {
                        id: crypto.randomUUID(),
                        type: "error" as const,
                        timestamp: Date.now(),
                        message: `恢复上次 Kimi Code 会话失败：${startRes.error}`,
                        canDismiss: false,
                      },
                    ],
                    isLoading: false,
                    updatedAt: Date.now(),
                  };
                  useSessionStore.setState((state) => ({
                    sessions: state.sessions.map((item) => (item.id === errorSession.id ? errorSession : item)),
                  }));
                  useAppStore.setState({ currentProject: activeProject, currentSession: errorSession });
                  setRunningSessionId(null);
                } else {
                  window.dispatchEvent(new CustomEvent("kimix:toast", { detail: `恢复 Kimi Code 会话失败：${startRes.error}` }));
                }
                return;
              }
              const historySessionId = latest?.id ?? sessionIdToStart ?? startRes.data.sessionId;
              if (hasArchivedLocalSessionForRuntime(historySessionId, startRes.data.sessionId, latest?.id, activeProject.path)) {
                setRunningSessionId(null);
                return;
              }
              const runtimeOwner = findLocalSessionForRuntime(historySessionId, startRes.data.sessionId, latest?.id);
              const loaded = await window.api.loadKimiCodeSession({
                workDir: activeProject.path,
                sessionId: historySessionId,
              });
              if (!loaded.success) {
                if (activeLocalSession) {
                  const errorSession = {
                    ...activeLocalSession,
                    runtimeSessionId: startRes.data.sessionId,
                    events: [
                      ...activeLocalSession.events,
                      {
                        id: crypto.randomUUID(),
                        type: "error" as const,
                        timestamp: Date.now(),
                        message: `读取上次 Kimi Code 历史失败：${loaded.error}`,
                        canDismiss: false,
                      },
                    ],
                    isLoading: false,
                    updatedAt: Date.now(),
                  };
                  useSessionStore.setState((state) => ({
                    sessions: state.sessions.map((item) => (item.id === errorSession.id ? errorSession : item)),
                  }));
                  useAppStore.setState({ currentProject: activeProject, currentSession: errorSession });
                  setRunningSessionId(null);
                }
                return;
              }
              const events = settleInactiveEvents(mapHistoryEvents(Array.isArray(loaded.data.events) ? loaded.data.events : []));

              if (runtimeOwner) {
                const session = hydrateLongTaskProgressFromHistory({
                  ...runtimeOwner,
                  runtimeSessionId: startRes.data.sessionId,
                  officialSessionId: runtimeOwner.officialSessionId ?? historySessionId,
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

              const longTasksRes = await window.api.listLongTasks({ projectPath: activeProject.path });
              const matchedLongTask = longTasksRes.success
                ? longTasksRes.data.find((task) => (
                  task.executorSessionId === historySessionId ||
                  task.reviewerSessionId === historySessionId ||
                  task.executorSessionId === startRes.data.sessionId ||
                  task.reviewerSessionId === startRes.data.sessionId
                ))
                : undefined;

              const session = hydrateLongTaskProgressFromHistory({
                id: startRes.data.sessionId,
                model: startRes.data.model ?? null,
                title: deriveSessionTitle(events, latest?.brief || activeLocalSession?.title || "新会话"),
                projectPath: activeProject.path,
                createdAt: latest?.updatedAt ?? activeLocalSession?.createdAt ?? Date.now(),
                updatedAt: latest?.updatedAt ?? activeLocalSession?.updatedAt ?? Date.now(),
                runtimeSessionId: startRes.data.sessionId,
                officialSessionId: historySessionId,
                longTask: matchedLongTask ? toLongTaskMeta(matchedLongTask) : undefined,
                events,
              isLoading: false,
            });

            useSessionStore.setState((state) => {
                const existing = state.sessions.find((item) => item.id === session.id);
                if (existing?.archivedAt) {
                  // Preserve local archive state; do not resurrect an archived session just because
                  // its history was rediscovered from the SDK store.
                  return state;
                }
                return {
                  sessions: existing
                    ? state.sessions.map((item) => (item.id === session.id ? session : item))
                    : [session, ...state.sessions],
                };
              });
              useAppStore.setState({ currentSession: session });
              setRunningSessionId(null);
            } catch {
              setRunningSessionId(null);
            }
          })();
        }, 1_200);
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
              events: removeStaleKimiCodeStartupErrors(resetStaleSessionRecommendationEvents(sanitizePersistedEvents(Array.isArray(session.events) ? session.events : []))),
            }));
          if (JSON.stringify(visibleSessions) !== storedSessions) {
            localStorage.setItem(LOCAL_SESSIONS_KEY, JSON.stringify(visibleSessions));
          }
          const restoredSessions = visibleSessions.map((session) => {
            const rawEngine = (session as { engine?: unknown }).engine;
            const knownEngine = rawEngine === "prompt" || rawEngine === "kimi-code";
            return hydrateLongTaskProgressFromHistory({
              ...session,
              engine: knownEngine ? rawEngine : "kimi-code",
              runtimeSessionId: knownEngine ? session.runtimeSessionId : undefined,
              events: removeStaleKimiCodeStartupErrors(resetStaleSessionRecommendationEvents(sanitizePersistedEvents(Array.isArray(session.events) ? settleInactiveEvents(session.events) : []))),
              isLoading: false,
            });
          });
          useSessionStore.setState({ sessions: restoredSessions });
          restoredSessions.filter((session) => session.archivedAt).forEach(rememberArchivedSessionTombstone);
          void repairKimiCodeHistoryBodies(restoredSessions);
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
                  ? (item as { images: unknown[] }).images.filter((image): image is UserMessageImage => {
                      if (!image || typeof image !== "object") return false;
                      const record = image as { name?: unknown; dataUrl?: unknown; filePath?: unknown; kind?: unknown };
                      if (typeof record.name !== "string") return false;
                      const hasDataUrl = typeof record.dataUrl === "string" && record.dataUrl.length > 0;
                      const hasFilePath = typeof record.filePath === "string" && record.filePath.length > 0;
                      const validKind = record.kind === undefined || record.kind === "image" || record.kind === "file";
                      return validKind && (hasDataUrl || hasFilePath);
                    })
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
      window.clearTimeout(job.timeoutId);
      void window.api.closeKimiCodeSession({ sessionId: job.runtimeSessionId }).catch(() => {});
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
        const startRes = await window.api.startKimiCodeRuntime({
          workDir: detail.projectPath,
          thinking: useAppStore.getState().defaultThinking,
          yoloMode: useAppStore.getState().permissionMode === "yolo",
          autoMode: useAppStore.getState().permissionMode === "auto",
        });
        if (!startRes.success) throw new Error(startRes.error);
        rememberHiddenHandoffSession(startRes.data.sessionId);
        const timeoutId = window.setTimeout(() => {
          const job = handoffJobRef.current;
          if (!job || job.runtimeSessionId !== startRes.data.sessionId) return;
          void finishHandoffJob(job, "error");
        }, HANDOFF_TIMEOUT_MS);
        handoffJobRef.current = {
          sourceSessionId: detail.sourceSessionId,
          runtimeSessionId: startRes.data.sessionId,
          projectPath: detail.projectPath,
          recommendationEventId: detail.recommendationEventId,
          events: [],
          timeoutId,
        };
        const prompt = buildHandoffPrompt(sourceSession);
        const sendRes = await window.api.sendKimiCodePrompt({
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
        if (job?.timeoutId) window.clearTimeout(job.timeoutId);
        setHandoffSessionId(null);
        setRunningSessionId(null);
        if (job?.runtimeSessionId) void window.api.closeKimiCodeSession({ sessionId: job.runtimeSessionId }).catch(() => {});
        updateRecommendationEvent(detail.sourceSessionId, detail.recommendationEventId, {
          handoffStatus: "error",
          handoffError: err instanceof Error ? err.message : String(err),
        });
      });
    };
    window.addEventListener("kimix:startHandoff", handleStartHandoff);

    const unsubscribeKimiCodeEvent = window.api.onKimiCodeEvent((payload) => {
      const currentHandoffJob = handoffJobRef.current;
      if (currentHandoffJob?.runtimeSessionId === payload.sessionId) {
        const mapped = mapStreamEvent(payload.event);
        if (mapped) currentHandoffJob.events = mergeEvents(currentHandoffJob.events, mapped);
        const terminalStatus = getHandoffTerminalStatus(payload.event);
        if (terminalStatus) void finishHandoffJob(currentHandoffJob, terminalStatus);
        return;
      }
      const uiSessionId = resolveUiSessionId(payload.sessionId);
      const targetSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
      if (targetSession?.engine && targetSession.engine !== "kimi-code" && !targetSession.longTask) return;
      const rawEvent = payload.event && typeof payload.event === "object" && !Array.isArray(payload.event)
        ? payload.event as Record<string, unknown>
        : null;
      const officialTitle = extractOfficialSessionTitle(rawEvent);
      if (officialTitle && !targetSession?.titleLocked) {
        updateSession(uiSessionId, (session) => ({
          ...session,
          title: officialTitle,
          updatedAt: Date.now(),
        }));
        syncCurrentSessionFromStore(uiSessionId);
      }
      if (shouldSkipKimiCodeSnapshotReplay(rawEvent, targetSession?.events)) return;
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
      const uiSessionId = resolveUiSessionId(payload.sessionId);
      const targetSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
      if (targetSession?.engine && targetSession.engine !== "kimi-code" && !targetSession.longTask) return;

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
          settleInactiveEvents(session.events),
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

    const unsubscribeLongTaskStatus = window.api.onKimiCodeStatus((payload) => {
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
        if (
          runningSession?.longTask?.reviewerSessionId !== runningSession?.longTask?.executorSessionId &&
          runningSession?.longTask?.reviewerSessionId === payload.sessionId
        ) {
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
      const isReviewerTerminal = Boolean(
        terminalSession?.longTask &&
        terminalSession.longTask.reviewerSessionId !== terminalSession.longTask.executorSessionId &&
        terminalSession.longTask.reviewerSessionId === payload.sessionId
      );
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
            settleInactiveEvents(session.events),
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
        if (dispatchLongTaskExecutorNext(uiSessionId, payload.sessionId)) {
          return;
        }
        if (isReviewerTerminal) {
          const reviewerOutput = getHiddenLongTaskAssistantContent(payload.sessionId);
          pauseLongTaskReviewerWithError(
            uiSessionId,
            reviewerOutput.trim().length > 0
              ? "用户审查流程已结束，但没有给出明确结论（通过 / 需修复 / 待人工审查），已暂停当前长程任务。"
              : "用户审查流程已结束，但没有返回可用结果，已暂停当前长程任务。",
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
            const runtimeSessionId = resolveRuntimeSessionId(uiSessionId);
            const latestForQueue = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
            const sendPromise = sendKimiCodePromptWithRetry({
              sessionId: runtimeSessionId,
              content: contentWithFileAttachments(next.content, next.images),
              images: promptImages(next.images),
            });
            sendPromise.then((res) => {
              if (res.success) return;
              throw new Error(res.error);
            }).catch((err) => {
              const message = err instanceof Error ? err.message : String(err);
              useSessionStore.getState().addPendingMessage(uiSessionId, next.content, next.images);
              if (isKimiActiveTurnError(message)) {
                updateSession(uiSessionId, (session) => {
                  const filteredEvents = session.events.filter((event) => event.id !== placeholderId && event.id !== userEventId);
                  console.log("[App queue dispatch active-turn]", {
                    uiSessionId,
                    placeholderId,
                    userEventId,
                    beforeCount: session.events.length,
                    afterCount: filteredEvents.length,
                  });
                  return {
                    ...session,
                    events: filteredEvents,
                    updatedAt: Date.now(),
                  };
                });
                setRunningSessionId(uiSessionId);
                return;
              }
              updateSession(uiSessionId, (session) => ({
                ...session,
                events: [
                  ...session.events.filter((event) => event.id !== placeholderId && event.id !== userEventId),
                  {
                    id: crypto.randomUUID(),
                    type: "error" as const,
                    timestamp: Date.now(),
                    message,
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
      unsubscribeLongTaskStatus();
      unsubscribeKimiCodeEvent();
      unsubscribeKimiCodeStatus();
      unsubscribeBootstrap();
      window.removeEventListener("kimix:startHandoff", handleStartHandoff);
      window.removeEventListener("focus", markRendererWindowFocused);
      window.removeEventListener("blur", markRendererWindowBlurred);
      document.removeEventListener("pointerdown", markRendererWindowFocused, true);
      document.removeEventListener("keydown", markRendererWindowFocused, true);
      if (handoffJobRef.current) {
        window.clearTimeout(handoffJobRef.current.timeoutId);
        handoffJobRef.current = null;
      }
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      goalRefreshTimersRef.current.forEach(clearTimeout);
      goalRefreshTimersRef.current.clear();
      goalLastRefreshRef.current.clear();
    };
  }, [setHandoffSessionId, setRunningSessionId, updateSession, setRecentProjects, defaultThinking, defaultPlanMode, permissionMode, enqueueStreamEvent, flushStreamEvents]);

  useEffect(() => {
    if (!runningSessionId) return;
    let disposed = false;
    let checking = false;
    const reconciliationStartedAt = Date.now();

    const reconcileRuntimeStatus = async () => {
      if (disposed || checking) return;
      const activeRunningId = useAppStore.getState().runningSessionId;
      if (!activeRunningId || activeRunningId !== runningSessionId) return;
      const session = useSessionStore.getState().sessions.find((item) => (
        item.id === activeRunningId || item.runtimeSessionId === activeRunningId || item.officialSessionId === activeRunningId
      ));
      if (!session || session.longTask) return;
      const runtimeSessionId = getRuntimeSessionId(session);
      if (!runtimeSessionId) return;

      checking = true;
      try {
        const response = await window.api.getKimiCodeStatus({ sessionId: runtimeSessionId });
        if (disposed || !response.success) return;
        if (!isTerminalKimiCodeEngineStatus(response.data.engineStatus)) {
          runtimeTerminalPollRef.current.delete(runtimeSessionId);
          return;
        }
        if (Date.now() - reconciliationStartedAt < 2500) return;

        const terminalPolls = (runtimeTerminalPollRef.current.get(runtimeSessionId) ?? 0) + 1;
        runtimeTerminalPollRef.current.set(runtimeSessionId, terminalPolls);
        if (terminalPolls < 2) return;
        runtimeTerminalPollRef.current.delete(runtimeSessionId);

        const latestRunningId = useAppStore.getState().runningSessionId;
        if (latestRunningId !== session.id && latestRunningId !== runtimeSessionId) return;
        flushStreamEvents();
        updateSession(session.id, (item) => ({
          ...item,
          events: settleInactiveEvents(item.events),
          updatedAt: Date.now(),
        }));
        syncCurrentSessionFromStore(session.id);
        setRunningSessionId(null);
        if (response.data.engineStatus === "completed" || response.data.engineStatus === "idle") {
          dispatchNextPendingKimiMessage(session.id, runtimeSessionId);
        }
      } finally {
        checking = false;
      }
    };

    const firstCheck = window.setTimeout(() => void reconcileRuntimeStatus(), 1200);
    const timer = window.setInterval(() => void reconcileRuntimeStatus(), 1500);
    const syncNow = () => void reconcileRuntimeStatus();
    window.addEventListener("focus", syncNow);
    document.addEventListener("visibilitychange", syncNow);
    return () => {
      disposed = true;
      window.clearTimeout(firstCheck);
      window.clearInterval(timer);
      window.removeEventListener("focus", syncNow);
      document.removeEventListener("visibilitychange", syncNow);
    };
  }, [runningSessionId, setRunningSessionId, updateSession, flushStreamEvents]);

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
        if (dispatchLongTaskExecutorNext(session.id, session.longTask.executorSessionId)) break;
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
