import { memo, useState, useRef, useEffect, useLayoutEffect, useMemo, type CSSProperties, type ReactNode } from "react";
import { Bot, Brain, ChevronDown, ChevronRight, ChevronUp, Copy, Check, GitBranch, Loader2, RotateCcw, ShieldCheck, SquareTerminal, Webhook, FileText, Trash2, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { TimelineEvent, UserMessageImage, ProcessDisplayMode } from "@/types/ui";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { FileCard } from "./FileCard";
import { StatusCard, STATUS_CARD_TEXT_STYLE } from "./StatusCard";
import { ChangeCard } from "./ChangeCard";
import { getRuntimeSessionId } from "@/utils/runtimeSession";
import { ImagePreviewOverlay, type PreviewImage } from "./ImagePreviewOverlay";
import { formatAssistantTurnDuration, reliableAssistantDurationMs } from "@/utils/duration";
import { formatFullToolArgumentsForDisplay, formatFullToolResultForDisplay, formatToolArgumentsForDisplay, formatToolResultForDisplay, toolArgumentPreview } from "@/utils/toolDisplay";
import { assistantTurnStartedAt } from "@/utils/processTiming";
import { shouldShowInlineStatusUpdate } from "@/utils/sessionMetrics";
import { compactModelDisplayName } from "@/utils/modelDisplay";
import { StateIconSwap } from "@/components/common/StateIconSwap";
import { buildThinkingBlocks, type ThinkingBlock } from "@/utils/thinkingBlocks";
import { hasOfficialTurnEvidenceAfterUser, isLatestUserInputEvent, truncateLatestUserTurn } from "@/utils/eventHelpers";
import { normalizePathForComparison } from "@/utils/pathCase";
import { mapHistoryEvents } from "@/utils/eventMapper";
import {
  getPrimaryRoomAgent,
  getRoomAgent,
  getRoomAgentEvents,
  getRoomAgentRuntimeId,
  roomAgentActivityKey,
  scopeEventToRoomAgent,
  updateRoomAgentEvents,
} from "@/utils/collaborationRooms";
import { markAgentKimiHistoryCacheCurrent, reconcileAgentCanonicalHistory } from "@/utils/collaborationHistory";
import { projectCollaborationTimeline } from "@/utils/collaborationTimeline";
import { isRoomDeliveryWaitingBehindAgentWork } from "@/utils/roomDelivery";
import {
  canLiveThinkingViewportConsumeWheel,
  LIVE_THINKING_MAX_HEIGHT_PX,
  shouldCollapseKimiWebProcessOnFinalContent,
  shouldFollowLiveThinkingViewport,
  shouldUseLiveThinkingViewport,
} from "@/utils/liveThinkingViewport";
import {
  CHAT_PROCESS_COLLAPSE_VIEWPORT_EVENT,
  type ChatProcessCollapseViewportDetail,
} from "@/utils/chatViewportTransaction";
import {
  makeActiveTurnDraftKey,
  pickDraftText,
  useActiveTurnDraft,
} from "@/utils/activeTurnDraftStore";
import { getProcessManualExpand, noteProcessManualExpand, processManualExpandTurnKey } from "@/utils/processManualExpand";
import { isActiveTurnDraftEnabled } from "@/utils/perfFlags";

interface MessageBubbleProps {
  event: Extract<TimelineEvent, { type: "user_message" | "steer_message" | "assistant_message" }>;
  sessionId?: string;
  runtimeSessionId?: string;
  turnStartedAt?: number;
  isAssistantActive?: boolean;
  leadingTools?: Extract<TimelineEvent, { type: "tool_call" }>[];
  leadingSubagents?: Extract<TimelineEvent, { type: "subagent" }>[];
  leadingHooks?: Extract<TimelineEvent, { type: "hook" }>[];
  leadingApprovals?: Extract<TimelineEvent, { type: "approval_request" }>[];
  attachedSteers?: Extract<TimelineEvent, { type: "steer_message" }>[];
  activeStatus?: Extract<TimelineEvent, { type: "status_update" }>;
  changedFiles?: string[];
  changeSummary?: Extract<TimelineEvent, { type: "change_summary" }>;
  trailingStatuses?: Extract<TimelineEvent, { type: "status_update" }>[];
  hideProcessSummary?: boolean;
  expandProcessByDefault?: boolean;
  eagerMarkdown?: boolean;
  onDeleteUserMessage?: (eventId: string) => void;
}

const timelineEventMemoKeyCache = new WeakMap<TimelineEvent, string>();

export function timelineEventMemoKey(event: TimelineEvent): string {
  const cached = timelineEventMemoKeyCache.get(event);
  if (cached) return cached;
  const key = computeTimelineEventMemoKey(event);
  timelineEventMemoKeyCache.set(event, key);
  return key;
}

function computeTimelineEventMemoKey(event: TimelineEvent): string {
  switch (event.type) {
    case "assistant_message":
      return [
        event.id,
        event.type,
        event.timestamp,
        event.content,
        event.thinking ?? "",
        event.thinkingParts?.map((part) => `${part.timestamp}:${part.text}`).join("\u001f") ?? "",
        event.isThinking ? 1 : 0,
        event.isComplete ? 1 : 0,
        event.durationMs ?? "",
        event.agentRole ?? "",
        event.model ?? "",
        event.roomAgentId ?? "",
        event.roomMessageId ?? "",
        event.agentTurnId ?? "",
      ].join("\u001e");
    case "user_message":
      return [
        event.id,
        event.type,
        event.timestamp,
        event.content,
        event.images?.map((image) => `${image.id ?? ""}:${image.name}:${image.filePath ?? ""}:${image.dataUrl?.length ?? 0}`).join("\u001f") ?? "",
      ].join("\u001e");
    case "steer_message":
      return [
        event.id,
        event.type,
        event.timestamp,
        event.content,
        event.status ?? "",
        event.images?.map((image) => `${image.id ?? ""}:${image.name}:${image.filePath ?? ""}:${image.dataUrl?.length ?? 0}`).join("\u001f") ?? "",
      ].join("\u001e");
    case "tool_call":
      return [
        event.id,
        event.type,
        event.timestamp,
        event.toolCallId,
        event.toolName,
        event.status,
        event.rawArguments ?? "",
        event.result === undefined ? "" : JSON.stringify(event.result),
      ].join("\u001e");
    case "subagent":
      return [
        event.id,
        event.type,
        event.timestamp,
        event.agentId,
        event.parentToolCallId ?? "",
        event.swarmIndex ?? "",
        event.description ?? "",
        event.agentName,
        event.status,
        event.resultSummary ?? "",
        event.error ?? "",
        event.events.map(timelineEventMemoKey).join("\u001f"),
      ].join("\u001e");
    case "hook":
      return [
        event.id,
        event.type,
        event.timestamp,
        event.eventName,
        event.target,
        event.phase,
        event.action ?? "",
        event.reason ?? "",
      ].join("\u001e");
    case "approval_request":
      return [
        event.id,
        event.type,
        event.timestamp,
        event.requestId,
        event.status,
        event.toolName,
        event.description,
        event.details,
        event.riskLevel,
      ].join("\u001e");
    case "status_update":
      return [
        event.id,
        event.type,
        event.timestamp,
        event.message ?? "",
        event.level ?? "",
        event.step ?? "",
        event.totalSteps ?? "",
        event.inputTokenCount ?? "",
        event.tokenCount ?? "",
        event.contextSize ?? "",
        event.contextLimit ?? "",
        event.planMode === undefined ? "" : event.planMode ? 1 : 0,
        event.swarmMode === undefined ? "" : event.swarmMode ? 1 : 0,
        event.source ?? "",
        event.tone ?? "",
        event.parentEventId ?? "",
        event.roomAgentId ?? "",
        event.roomMessageId ?? "",
        event.agentTurnId ?? "",
      ].join("\u001e");
    case "change_summary":
      return [
        event.id,
        event.type,
        event.timestamp,
        event.files.map((file) => `${file.path}:${file.additions ?? ""}:${file.deletions ?? ""}`).join("\u001f"),
        event.additions ?? "",
        event.deletions ?? "",
      ].join("\u001e");
    default:
      return `${event.id}:${event.type}:${event.timestamp}`;
  }
}

function eventArrayMemoEqual<T extends TimelineEvent>(a?: T[], b?: T[]) {
  if (a === b) return true;
  if (!a || !b) return (a?.length ?? 0) === (b?.length ?? 0);
  if (a.length !== b.length) return false;
  return a.every((event, index) => event === b[index] || timelineEventMemoKey(event) === timelineEventMemoKey(b[index]));
}

function stringArrayMemoEqual(a?: string[], b?: string[]) {
  if (a === b) return true;
  if (!a || !b) return (a?.length ?? 0) === (b?.length ?? 0);
  if (a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

function messageBubblePropsEqual(prev: MessageBubbleProps, next: MessageBubbleProps) {
  if (
    prev.sessionId !== next.sessionId ||
    prev.runtimeSessionId !== next.runtimeSessionId ||
    prev.onDeleteUserMessage !== next.onDeleteUserMessage ||
    prev.turnStartedAt !== next.turnStartedAt ||
    prev.isAssistantActive !== next.isAssistantActive ||
    prev.hideProcessSummary !== next.hideProcessSummary ||
    prev.expandProcessByDefault !== next.expandProcessByDefault ||
    prev.eagerMarkdown !== next.eagerMarkdown
  ) {
    return false;
  }
  if (prev.event !== next.event && timelineEventMemoKey(prev.event) !== timelineEventMemoKey(next.event)) {
    return false;
  }
  return eventArrayMemoEqual(prev.leadingTools, next.leadingTools) &&
    eventArrayMemoEqual(prev.leadingSubagents, next.leadingSubagents) &&
    eventArrayMemoEqual(prev.leadingHooks, next.leadingHooks) &&
    eventArrayMemoEqual(prev.leadingApprovals, next.leadingApprovals) &&
    eventArrayMemoEqual(prev.attachedSteers, next.attachedSteers) &&
    (
      prev.activeStatus === next.activeStatus ||
      (!prev.activeStatus && !next.activeStatus) ||
      (Boolean(prev.activeStatus && next.activeStatus) && timelineEventMemoKey(prev.activeStatus as TimelineEvent) === timelineEventMemoKey(next.activeStatus as TimelineEvent))
    ) &&
    eventArrayMemoEqual(prev.trailingStatuses, next.trailingStatuses) &&
    stringArrayMemoEqual(prev.changedFiles, next.changedFiles) &&
    (
      prev.changeSummary === next.changeSummary ||
      (!prev.changeSummary && !next.changeSummary) ||
      (Boolean(prev.changeSummary && next.changeSummary) && timelineEventMemoKey(prev.changeSummary as TimelineEvent) === timelineEventMemoKey(next.changeSummary as TimelineEvent))
    );
}

// Horizontal breathing room for message content. The assistant body is indented
// from the left so its start aligns just right of the process-summary collapse
// icon (which keeps hanging at the column edge); user/steer bubbles get the same
// gap from the right edge so left/right whitespace stays symmetric.
const MESSAGE_SIDE_INDENT = 28;
const PROCESS_DETAIL_RENDER_LIMIT = 120;

function useCopyTimeout() {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const trigger = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 2000);
  };

  return { copied, trigger };
}

function useElapsed(start: number, active: boolean) {
  const [elapsed, setElapsed] = useState(() => Math.max(0, Date.now() - start));

  useEffect(() => {
    if (!active) return;
    let timer: number | null = null;
    const update = () => {
      const nextElapsed = Math.max(0, Date.now() - start);
      setElapsed(nextElapsed);
      // The UI only displays second-level precision. Align the next refresh to
      // the following second instead of keeping a 60fps animation loop alive.
      const delay = Math.max(16, 1000 - (Date.now() % 1000) + 4);
      timer = window.setTimeout(update, delay);
    };
    const forceUpdate = () => {
      const nextElapsed = Math.max(0, Date.now() - start);
      setElapsed(nextElapsed);
    };
    update();
    window.addEventListener("focus", forceUpdate);
    document.addEventListener("visibilitychange", forceUpdate);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("focus", forceUpdate);
      document.removeEventListener("visibilitychange", forceUpdate);
    };
  }, [active, start]);

  return elapsed;
}

function isInterruptedStatus(event: Extract<TimelineEvent, { type: "status_update" }>) {
  return Boolean(event.message && /中断|打断|cancelled|canceled|interrupted/i.test(event.message));
}

function buildAssistantFullCopyText(event: Extract<TimelineEvent, { type: "assistant_message" }>) {
  const thinkingText = buildThinkingBlocks(event).map((block) => block.text.trim()).filter(Boolean).join("\n\n");
  const content = event.content.trim();
  return [
    thinkingText ? `## 思考\n\n${thinkingText}` : "",
    content ? `## 回复\n\n${content}` : "",
  ].filter(Boolean).join("\n\n");
}

function attachmentCopyText(images: UserMessageImage[] = []) {
  return images.map((image) => {
    if (image.dataUrl) return `[图片: ${image.name}]`;
    return `[附件: ${image.name}${image.filePath ? ` | ${image.filePath}` : ""}]`;
  }).join("\n");
}

function AttachmentThumb({
  image,
  index,
  onPreview,
}: {
  image: UserMessageImage;
  index: number;
  onPreview: (image: PreviewImage) => void;
}) {
  if (image.dataUrl) {
    const dataUrl = image.dataUrl;
    return (
      <button
        key={image.id ?? `${image.name}-${index}`}
        type="button"
        onClick={() => onPreview({ id: image.id, name: image.name, dataUrl })}
        className="kimix-media-thumb h-24 w-24 overflow-hidden rounded-[var(--radius-md)] transition-colors"
        title="点击查看图片"
        aria-label={`查看图片 ${image.name}`}
      >
        <img src={dataUrl} alt={image.name} className="h-full w-full object-cover" />
      </button>
    );
  }
  return (
    <div
      key={image.id ?? `${image.name}-${index}`}
      className="kimix-media-thumb flex h-24 w-[196px] flex-col justify-center rounded-[14px] text-[var(--kimix-panel-text-muted)]"
      title={image.filePath || image.name}
      style={{ gap: 7, paddingLeft: 14, paddingRight: 14 }}
    >
      <div className="flex min-w-0 items-center" style={{ gap: 8 }}>
        <FileText size={18} className="shrink-0 text-[var(--kimix-panel-text-secondary)]" />
        <span className="min-w-0 truncate text-[13px] font-medium text-[var(--kimix-panel-text)]">{image.name || "附件文件"}</span>
      </div>
      <span className="truncate text-[12.5px]">{image.filePath || "未读取到绝对路径"}</span>
    </div>
  );
}

function getPreviewImages(images: UserMessageImage[]): PreviewImage[] {
  return images
    .filter((image): image is UserMessageImage & { dataUrl: string } => Boolean(image.dataUrl))
    .map((image) => ({ id: image.id, name: image.name, dataUrl: image.dataUrl }));
}

const UserMessageBubble = memo(function UserMessageBubble({ event, onDelete }: { event: Extract<TimelineEvent, { type: "user_message" }>; onDelete?: (eventId: string) => void }) {
  const { copied, trigger } = useCopyTimeout();
  const [previewImage, setPreviewImage] = useState<PreviewImage | null>(null);
  const [resending, setResending] = useState(false);
  const { isCurrentSessionRunning, isLatestUserMessage } = useAppStore(useShallow((s) => {
    const currentSession = s.currentSession;
    const currentRuntimeSessionId = currentSession ? getRuntimeSessionId(currentSession) : undefined;
    return {
      isCurrentSessionRunning: Boolean(currentSession && (
        s.runningSessionId === currentSession.id ||
        Boolean(currentRuntimeSessionId && s.runningSessionId === currentRuntimeSessionId)
      )),
      isLatestUserMessage: Boolean(currentSession && currentSession.events.findLast((e) => e.type === "user_message")?.id === event.id),
    };
  }));
  const images = event.images ?? [];
  const previewImages = getPreviewImages(images);
  const hasText = event.content.trim().length > 0;
  const copyText = hasText ? [event.content, attachmentCopyText(images)].filter(Boolean).join("\n\n") : attachmentCopyText(images);

  const handleResend = async () => {
    if (resending) return;
    const appState = useAppStore.getState();
    const activeSession = appState.currentSession
      ? useSessionStore.getState().sessions.find((session) => session.id === appState.currentSession?.id) ?? appState.currentSession
      : null;
    if (!activeSession || !isLatestUserInputEvent(projectCollaborationTimeline(activeSession), event.id)) return;
    const roomMessage = activeSession.collaboration?.messages.find((message) => (
      message.id === (event.roomMessageId ?? event.id)
    ));
    if (activeSession.collaboration && (!roomMessage || roomMessage.recipientAgentIds.length !== 1)) {
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: "多 Agent 消息暂不支持整组撤回，请先对单个 Agent 发送后再撤回。",
      }));
      return;
    }
    const roomAgentId = roomMessage?.recipientAgentIds[0] ?? getPrimaryRoomAgent(activeSession).id;
    const delivery = roomMessage?.deliveries[roomAgentId];
    const runtimeSessionId = getRoomAgentRuntimeId(activeSession, roomAgentId);
    const activity = appState.roomAgentActivities[roomAgentActivityKey(activeSession.id, roomAgentId)];
    const isPrimaryAgent = getPrimaryRoomAgent(activeSession).id === roomAgentId;
    const isSessionRunning = Boolean(activity && ["creating", "queued", "sending", "running", "waiting_approval", "waiting_question"].includes(activity.status)) ||
      (isPrimaryAgent && (
        appState.runningSessionId === activeSession.id ||
        Boolean(runtimeSessionId && appState.runningSessionId === runtimeSessionId)
      ));
    if (isSessionRunning) return;
    const agentEvents = getRoomAgentEvents(activeSession, roomAgentId);
    const targetUserEventId = delivery?.officialUserEventId
      ?? agentEvents.find((candidate) => (
        candidate.type === "user_message" && candidate.roomMessageId === (event.roomMessageId ?? event.id)
      ))?.id
      ?? event.id;

    const syncCurrentSession = () => {
      const latest = useSessionStore.getState().sessions.find((session) => session.id === activeSession.id);
      if (latest && useAppStore.getState().currentSession?.id === activeSession.id) {
        appState.setCurrentSession(latest);
      }
    };
    const appendError = (message: string) => {
      const failedAt = Date.now();
      useSessionStore.getState().updateSession(activeSession.id, (session) => {
        const next = updateRoomAgentEvents(session, roomAgentId, (events) => [
          ...events,
          scopeEventToRoomAgent({
            id: crypto.randomUUID(),
            type: "error",
            timestamp: failedAt,
            message,
            source: "ipc",
          }, roomAgentId),
        ]);
        return { ...next, updatedAt: failedAt };
      });
      syncCurrentSession();
    };
    if (!runtimeSessionId) {
      appendError("当前会话没有可用的运行时 session");
      return;
    }

    setResending(true);
    try {
      const needsOfficialUndo = hasOfficialTurnEvidenceAfterUser(agentEvents, targetUserEventId);
      if (needsOfficialUndo) {
        const undoRes = await window.api.undoKimiCodeHistory({ sessionId: runtimeSessionId, count: 1 });
        if (!undoRes.success) throw new Error(`撤回上一轮官方历史失败：${undoRes.error}`);

        const loaded = await window.api.loadKimiCodeSession({ workDir: activeSession.projectPath, sessionId: runtimeSessionId });
        if (!loaded.success) throw new Error(`官方撤回成功，但刷新官方历史失败：${loaded.error}`);
        const canonicalEvents = mapHistoryEvents(Array.isArray(loaded.data.events) ? loaded.data.events : []);
        useSessionStore.getState().updateSession(activeSession.id, (session) => {
          const reconciliation = reconcileAgentCanonicalHistory({
            session,
            roomAgentId,
            expectedRuntimeSessionId: runtimeSessionId,
            canonicalEvents,
            reason: "undo",
          });
          if (!reconciliation.applied) {
            throw new Error("官方撤回完成后会话运行时已变化，请重新打开会话确认历史。");
          }
          return markAgentKimiHistoryCacheCurrent(reconciliation.session, roomAgentId);
        });
      } else {
        const withdrawnAt = Date.now();
        useSessionStore.getState().updateSession(activeSession.id, (session) => {
          let next = updateRoomAgentEvents(session, roomAgentId, (events) => (
            truncateLatestUserTurn(events, targetUserEventId)
          ));
          if (next.collaboration && roomMessage) {
            next = {
              ...next,
              collaboration: {
                ...next.collaboration,
                messages: next.collaboration.messages.filter((message) => message.id !== roomMessage.id),
              },
            };
          }
          return { ...next, updatedAt: withdrawnAt };
        });
      }
      syncCurrentSession();
      window.dispatchEvent(new CustomEvent("kimix:restore-composer-draft", {
        detail: {
          sessionId: activeSession.id,
          content: event.content,
          images: event.images ?? [],
        },
      }));
    } catch (err) {
      console.error("Withdraw to composer failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      appendError(message);
    } finally {
      setResending(false);
    }
  };

  const handleSaveDrawingBoard = (image: { name: string; dataUrl: string }) => {
    window.dispatchEvent(new CustomEvent("kimix:addDrawingImage", { detail: image }));
    setPreviewImage(null);
  };

  return (
    <div className="group flex justify-end" style={{ paddingRight: MESSAGE_SIDE_INDENT }}>
      <div className="flex max-w-[58%] flex-col items-end">
        {images.length > 0 && (
          <div
            className="flex max-w-full flex-wrap justify-end"
            style={{ gap: 8, marginBottom: hasText ? 12 : 0 }}
          >
            {images.map((image, index) => (
              <AttachmentThumb key={image.id ?? `${image.name}-${index}`} image={image} index={index} onPreview={setPreviewImage} />
            ))}
          </div>
        )}
        {hasText && (
          <div
            style={{ minWidth: 64, paddingLeft: 15, paddingRight: 15, paddingTop: 8, paddingBottom: 8, whiteSpace: "pre-wrap" }}
            className="kimix-user-bubble rounded-[var(--radius-md)] text-[14.5px] leading-[1.45]"
          >
            {event.content}
          </div>
        )}
        <div className="mt-1.5 flex justify-end opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" style={{ gap: 4 }}>
          <button
            onClick={() => trigger(copyText)}
            className="kimix-inline-icon-action text-text-muted hover:bg-bg-hover hover:text-text-primary"
            title="复制"
            aria-label="复制"
          >
            <StateIconSwap
              active={copied}
              activeIcon={<Check size={13} className="text-accent-success" />}
              inactiveIcon={<Copy size={13} />}
            />
          </button>
          <button
            onClick={handleResend}
            disabled={resending || !isLatestUserMessage || isCurrentSessionRunning}
            className="kimix-inline-icon-action text-text-muted hover:bg-bg-hover hover:text-text-primary disabled:opacity-30"
            title={isLatestUserMessage ? "撤回到输入框" : "当前仅支持撤回最新一轮"}
            aria-label={isLatestUserMessage ? "撤回到输入框" : "当前仅支持撤回最新一轮"}
          >
            {resending ? <Loader2 size={13} className="kimix-spin" /> : <RotateCcw size={13} />}
          </button>
          {onDelete && (
            <button
              onClick={() => onDelete(event.id)}
              className="kimix-inline-icon-action text-text-muted hover:bg-accent-danger/10 hover:text-accent-danger"
              title="删除本地消息"
              aria-label="删除本地消息"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
      {previewImage?.dataUrl && (
        <ImagePreviewOverlay
          image={previewImage}
          images={previewImages}
          onNavigate={setPreviewImage}
          onClose={() => setPreviewImage(null)}
          onSaveDrawing={handleSaveDrawingBoard}
        />
      )}
    </div>
  );
});

const SteerMessageBubble = memo(function SteerMessageBubble({ event, embedded = false }: { event: Extract<TimelineEvent, { type: "steer_message" }>; embedded?: boolean }) {
  const [previewImage, setPreviewImage] = useState<PreviewImage | null>(null);
  const images = event.images ?? [];
  const previewImages = getPreviewImages(images);
  const hasText = event.content.trim().length > 0 && event.content.trim() !== "[图片]";
  const label = event.status === "sending"
    ? "引导发送中"
    : event.status === "accepted"
      ? "等待官方写入"
    : event.status === "failed"
      ? "引导失败"
      : "引导已写入当前轮";
  const handleSaveDrawingBoard = (image: { name: string; dataUrl: string }) => {
    window.dispatchEvent(new CustomEvent("kimix:addDrawingImage", { detail: image }));
    setPreviewImage(null);
  };

  return (
    <div className="group w-full" style={{ paddingRight: embedded ? 0 : MESSAGE_SIDE_INDENT }}>
      <div className="flex justify-end">
        <div className="flex max-w-[58%] flex-col items-end">
          {images.length > 0 && (
            <div
              className="flex max-w-full flex-wrap justify-end"
              style={{ gap: 8, marginBottom: hasText ? 12 : 0 }}
            >
              {images.map((image, index) => (
                <AttachmentThumb key={image.id ?? `${image.name}-${index}`} image={image} index={index} onPreview={setPreviewImage} />
              ))}
            </div>
          )}
          {hasText && (
            <div
              style={{ minWidth: 64, paddingLeft: 15, paddingRight: 15, paddingTop: 8, paddingBottom: 8, whiteSpace: "pre-wrap" }}
              className="kimix-user-bubble rounded-[var(--radius-md)] text-[14.5px] leading-[1.45]"
            >
              {event.content}
            </div>
          )}
          <div className={`mt-1.5 text-right text-[13px] leading-5 ${event.status === "failed" ? "text-accent-danger" : "text-[var(--kimix-panel-text-secondary)]"}`}>
            {label}
          </div>
          {event.error && <div className="mt-1 text-right text-[12.5px] text-accent-danger">{event.error}</div>}
        </div>
      </div>
      {previewImage?.dataUrl && (
        <ImagePreviewOverlay
          image={previewImage}
          images={previewImages}
          onNavigate={setPreviewImage}
          onClose={() => setPreviewImage(null)}
          onSaveDrawing={handleSaveDrawingBoard}
        />
      )}
    </div>
  );
});

type ToolEvent = Extract<TimelineEvent, { type: "tool_call" }>;
type SubagentEvent = Extract<TimelineEvent, { type: "subagent" }>;
type ApprovalEvent = Extract<TimelineEvent, { type: "approval_request" }>;
type AssistantEvent = Extract<TimelineEvent, { type: "assistant_message" }>;

type ProcessItem =
  | { type: "thinking"; block: ThinkingBlock }
  | { type: "tool"; tool: ToolEvent }
  | { type: "subagent"; subagent: SubagentEvent }
  | { type: "approval"; approval: ApprovalEvent };

function normalizeThinkingMarkdown(text: string) {
  return text
    .replace(/([^\n])(\d+\.[^\d\s])/g, "$1\n$2")
    .replace(/([^\n])(\d+\.\s)/g, "$1\n$2");
}

function describeTool(tool: ToolEvent) {
  return toolArgumentPreview(tool) || tool.toolName || "工具调用";
}

function ThinkingProcessItem({ block }: { block: ThinkingBlock }) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = block.text.trim().length > 0;
  const rowContent = (
    <>
      <span className="flex h-5 w-[18px] shrink-0 items-center justify-center text-[var(--kimix-process-muted)]">
        <Brain size={15} />
      </span>
      <span className="min-w-0 flex-1 truncate leading-5">{block.summary}</span>
      {canExpand && (
        <span className="flex h-5 w-[18px] shrink-0 items-center justify-center text-[var(--kimix-process-muted)]">
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>
      )}
    </>
  );
  return (
    <div className="kimix-soft-card overflow-hidden rounded-xl">
      {canExpand ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="kimix-chat-process-row grid w-full grid-cols-[18px_minmax(0,1fr)_18px] items-center text-left text-[14px] text-[var(--kimix-process-text)] transition-colors hover:bg-[var(--kimix-panel-hover)]"
          style={{ gap: 9 }}
        >
          {rowContent}
        </button>
      ) : (
        <div
          className="kimix-chat-process-row grid w-full grid-cols-[18px_minmax(0,1fr)_18px] items-center text-left text-[14px] text-[var(--kimix-process-text)]"
          style={{ gap: 9 }}
        >
          {rowContent}
        </div>
      )}
      {expanded && (
        <div className="kimix-thinking-detail kimix-soft-card-strong mt-1 min-w-0 rounded-lg text-[13.5px] leading-7" style={{ padding: "14px 16px" }}>
          <MarkdownRenderer content={normalizeThinkingMarkdown(block.text)} wrapLongLines />
        </div>
      )}
    </div>
  );
}

function ToolProcessItem({ tool }: { tool: ToolEvent }) {
  const [expanded, setExpanded] = useState(false);
  const argumentText = formatToolArgumentsForDisplay(tool).trim();
  const resultText = formatToolResultForDisplay(tool.result);
  const detailText = [
    `工具：${tool.toolName || "未知工具"}`,
    argumentText ? `参数：\n${argumentText}` : "",
    resultText ? `结果：\n${resultText}` : "",
  ].filter(Boolean).join("\n\n");
  const canExpand = detailText.trim().length > 0;
  const rowContent = (
    <>
      <span className="flex h-5 w-[18px] items-center justify-center text-[var(--kimix-process-muted)]">
        <SquareTerminal size={14} />
      </span>
      <span className="shrink-0 leading-5 text-[var(--kimix-panel-text-secondary)]">{tool.status === "running" ? "正在运行" : tool.status === "error" ? "命令失败" : "已完成"}</span>
      <span className="min-w-0 flex-1 truncate leading-5">{describeTool(tool)}</span>
      <span className="kimix-tabular-nums w-8 shrink-0 text-right leading-5 text-[var(--kimix-panel-text-muted)]">{tool.durationMs !== undefined ? `${Math.max(0, Math.round(tool.durationMs / 1000))}s` : ""}</span>
      <span className="flex h-5 w-[18px] shrink-0 items-center justify-center">
        <span className={`h-1.5 w-1.5 rounded-full ${tool.status === "error" ? "bg-accent-danger" : tool.status === "running" ? "bg-accent-warning" : "bg-accent-success"}`} />
      </span>
      <span className="flex h-5 w-[18px] shrink-0 items-center justify-center text-[var(--kimix-process-muted)]">
        {canExpand ? (expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />) : null}
      </span>
    </>
  );
  return (
    <div className="kimix-soft-card overflow-hidden rounded-xl text-[13.5px]">
      {canExpand ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="kimix-chat-process-row grid w-full grid-cols-[18px_auto_minmax(0,1fr)_auto_18px_18px] items-center text-left transition-colors hover:bg-[var(--kimix-panel-hover)]"
          style={{ gap: 9 }}
        >
          {rowContent}
        </button>
      ) : (
        <div
          className="kimix-chat-process-row grid w-full grid-cols-[18px_auto_minmax(0,1fr)_auto_18px_18px] items-center text-left"
          style={{ gap: 9 }}
        >
          {rowContent}
        </div>
      )}
      {expanded && (
        <pre className="kimix-soft-card-strong mt-1 min-w-0 whitespace-pre-wrap break-words rounded-lg font-mono text-[13px] leading-6" style={{ padding: "12px 14px" }}>
          {detailText}
        </pre>
      )}
    </div>
  );
}

function ApprovalProcessItem({ approval }: { approval: ApprovalEvent }) {
  const [expanded, setExpanded] = useState(false);
  const approved = approval.status === "approved";
  const decisionLabel = approved ? "已批准" : "已拒绝";
  const detailText = [
    `工具：${approval.toolName || "未知工具"}`,
    approval.description ? `请求：${approval.description}` : "",
    approval.details?.trim() ? `详情：\n${approval.details.trim()}` : "",
  ].filter(Boolean).join("\n\n");
  const canExpand = detailText.trim().length > 0;
  const rowContent = (
    <>
      <span className="flex h-5 w-[18px] items-center justify-center text-[var(--kimix-process-muted)]">
        <ShieldCheck size={14} />
      </span>
      <span className="shrink-0 leading-5 text-[var(--kimix-panel-text-secondary)]">工具请求</span>
      <span className="min-w-0 flex-1 truncate leading-5">{approval.description || approval.toolName || "工具请求"}</span>
      <span className={`shrink-0 rounded-full text-[12px] leading-5 ${approved ? "text-accent-success" : "text-accent-danger"}`} style={{ paddingLeft: 8, paddingRight: 8 }}>
        {decisionLabel}
      </span>
      <span className="flex h-5 w-[18px] shrink-0 items-center justify-center text-[var(--kimix-process-muted)]">
        {canExpand ? (expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />) : null}
      </span>
    </>
  );
  return (
    <div className="kimix-soft-card overflow-hidden rounded-xl text-[13.5px]">
      {canExpand ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="kimix-chat-process-row grid w-full grid-cols-[18px_auto_minmax(0,1fr)_auto_18px] items-center text-left transition-colors hover:bg-[var(--kimix-panel-hover)]"
          style={{ gap: 9 }}
        >
          {rowContent}
        </button>
      ) : (
        <div
          className="kimix-chat-process-row grid w-full grid-cols-[18px_auto_minmax(0,1fr)_auto_18px] items-center text-left"
          style={{ gap: 9 }}
        >
          {rowContent}
        </div>
      )}
      {expanded && (
        <pre className="kimix-soft-card-strong mt-1 min-w-0 whitespace-pre-wrap break-words rounded-lg font-mono text-[13px] leading-6" style={{ padding: "12px 14px" }}>
          {detailText}
        </pre>
      )}
    </div>
  );
}

function SubagentProcessItem({ subagent }: { subagent: SubagentEvent }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = subagent.status === "queued" || subagent.status === "running" || subagent.status === "suspended";
  const isError = subagent.status === "error";
  const statusText = subagent.status === "queued"
    ? "排队"
    : subagent.status === "suspended"
      ? "限流等待"
      : subagent.status === "running"
        ? "运行中"
        : isError ? "运行失败" : "已完成";
  const childSummary = subagent.events.length > 0
    ? `${subagent.events.length} 条子事件`
    : "暂无子事件详情";
  const detailText = [
    `子代理：${subagent.agentName || "subagent"}`,
    `状态：${statusText}`,
    `详情：${childSummary}`,
  ].join("\n");
  return (
    <div className="kimix-soft-card overflow-hidden rounded-xl text-[13.5px]">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="kimix-chat-process-row grid w-full items-center text-left transition-colors hover:bg-[var(--kimix-panel-hover)]"
        style={{ gridTemplateColumns: "18px auto minmax(0, 1fr) minmax(52px, auto) 18px 18px", columnGap: 9 }}
      >
        <span className="flex h-5 w-[18px] items-center justify-center text-[var(--kimix-process-muted)]">
          {isRunning ? (
            <Loader2 size={14} className="kimix-spin" />
          ) : (
            <Bot size={14} />
          )}
        </span>
        <span className="shrink-0 leading-5 text-[var(--kimix-panel-text-secondary)]">{statusText}</span>
        <span className="min-w-0 flex-1 truncate leading-5">{subagent.agentName || "子代理"}</span>
        <span className="shrink-0 whitespace-nowrap text-right leading-5 text-[var(--kimix-panel-text-muted)]">{subagent.events.length > 0 ? `${subagent.events.length} 条` : ""}</span>
        <span className="flex h-5 w-[18px] shrink-0 items-center justify-center">
          <span className={`h-1.5 w-1.5 rounded-full ${isError ? "bg-accent-danger" : isRunning ? "bg-accent-warning" : "bg-accent-success"}`} />
        </span>
        <span className="flex h-5 w-[18px] shrink-0 items-center justify-center text-[var(--kimix-process-muted)]">
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>
      </button>
      {expanded && (
        <pre className="kimix-soft-card-strong mt-1 min-w-0 whitespace-pre-wrap break-words rounded-lg font-mono text-[13px] leading-6" style={{ padding: "12px 14px" }}>
          {detailText}
        </pre>
      )}
    </div>
  );
}

function joinSummaryParts(parts: string[]) {
  return parts.filter(Boolean).join(" · ");
}

function formatAgentRole(role?: "executor" | "reviewer") {
  if (role === "executor") return "执行";
  if (role === "reviewer") return "审核";
  return null;
}

function renderProcessItem(item: ProcessItem, index: number) {
  return item.type === "thinking"
    ? <ThinkingProcessItem key={item.block.id || `thinking-${index}`} block={item.block} />
    : item.type === "tool"
      ? <ToolProcessItem key={item.tool.id} tool={item.tool} />
      : item.type === "approval"
        ? <ApprovalProcessItem key={item.approval.id} approval={item.approval} />
        : <SubagentProcessItem key={item.subagent.id} subagent={item.subagent} />;
}

const ProcessDetailList = memo(function ProcessDetailList({ items }: { items: ProcessItem[] }) {
  const [showAll, setShowAll] = useState(false);
  const previousLengthRef = useRef(items.length);
  const shouldLimit = !showAll && items.length > PROCESS_DETAIL_RENDER_LIMIT;
  const hiddenCount = shouldLimit ? items.length - PROCESS_DETAIL_RENDER_LIMIT : 0;
  const visibleItems = shouldLimit ? items.slice(-PROCESS_DETAIL_RENDER_LIMIT) : items;

  useEffect(() => {
    if (previousLengthRef.current === items.length) return;
    previousLengthRef.current = items.length;
    setShowAll(false);
  }, [items.length]);

  return (
    <>
      {hiddenCount > 0 && (
        <div
          className="kimix-soft-card-strong rounded-lg text-[13px] leading-6 text-[var(--kimix-panel-text-secondary)]"
          style={{ padding: "10px 12px" }}
        >
          <div className="flex min-w-0 items-center justify-between" style={{ gap: 12 }}>
            <span className="min-w-0 truncate">已暂收起较早 {hiddenCount} 条过程，保持长对话滚动流畅。</span>
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="kimix-icon-text-button kimix-muted-action is-compact shrink-0"
              style={{ minHeight: 30, paddingLeft: 10, paddingRight: 10 }}
            >
              显示全部
            </button>
          </div>
        </div>
      )}
      {visibleItems.map(renderProcessItem)}
    </>
  );
});

function AssistantProcessLabel({
  event,
  isActiveAssistant,
  isInterrupted,
  activeProcessLabel,
  elapsedStartAt,
}: {
  event: AssistantEvent;
  isActiveAssistant: boolean;
  isInterrupted: boolean;
  activeProcessLabel?: string;
  elapsedStartAt?: number;
}) {
  const isActivelyThinking = Boolean(isActiveAssistant && event.isThinking);
  const elapsed = useElapsed(elapsedStartAt ?? event.timestamp, isActiveAssistant);
  const completedDuration = reliableAssistantDurationMs(event.durationMs);
  const hasVisibleOutput = Boolean(
    event.content.trim() ||
    event.thinking?.trim() ||
    event.thinkingParts?.some((part) => part.text.trim().length > 0)
  );
  const isSettledForDisplay = !isActiveAssistant && (event.isComplete || hasVisibleOutput);
  const durationLabel = isSettledForDisplay
    ? (completedDuration !== undefined ? formatAssistantTurnDuration(completedDuration) : "")
    : isActiveAssistant && elapsed >= 1000
      ? formatAssistantTurnDuration(elapsed)
      : "";
  const roleLabel = formatAgentRole(event.agentRole);
  const completeLabel = isInterrupted ? "（输出打断）" : "（输出完成）";
  if (activeProcessLabel) {
    return durationLabel
      ? <>{activeProcessLabel}{roleLabel ? `（${roleLabel}）` : ""} {durationLabel}</>
      : <>{activeProcessLabel}{roleLabel ? `（${roleLabel}）` : ""}</>;
  }
  if (isSettledForDisplay) {
    return durationLabel
      ? <>{completeLabel}本轮总耗时{roleLabel ? `（${roleLabel}）` : ""} {durationLabel}</>
      : <>{completeLabel}{roleLabel ? `（${roleLabel}）` : ""}</>;
  }
  return isActivelyThinking
    ? <>正在思考{roleLabel ? `（${roleLabel}）` : ""} {durationLabel}</>
    : <>执行中{roleLabel ? `（${roleLabel}）` : ""} {durationLabel}</>;
}

function getHookBadgeEvents(hooks: Extract<TimelineEvent, { type: "hook" }>[]) {
  const settled = hooks.filter((hook) => hook.phase === "resolved");
  const source = settled.length > 0 ? settled : hooks.filter((hook) => hook.phase === "triggered");
  const seen = new Set<string>();
  return source.filter((hook) => {
    const key = `${hook.eventName}:${hook.target}:${hook.phase}:${hook.action ?? ""}:${hook.reason ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function processItemTimestamp(item: ProcessItem) {
  switch (item.type) {
    case "thinking": return item.block.timestamp;
    case "tool": return item.tool.timestamp;
    case "subagent": return item.subagent.timestamp;
    case "approval": return item.approval.timestamp;
  }
}

function processItemPriority(item: ProcessItem) {
  switch (item.type) {
    case "thinking": return 0;
    case "tool": return 1;
    case "subagent": return 2;
    case "approval": return 3;
  }
}

type ProcessGroup =
  | { type: "thinking"; blocks: ThinkingBlock[] }
  | { type: "tool"; tools: ToolEvent[] }
  | { type: "subagent"; subagents: SubagentEvent[] }
  | { type: "approval"; approvals: ApprovalEvent[] };

function removeToolOmissionMarkers(value: string) {
  return value.replace(/\n?\.\.\.（已省略[^）]*）/g, "");
}

function groupProcessItems(items: ProcessItem[]): ProcessGroup[] {
  const groups: ProcessGroup[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (item.type === "thinking") {
      if (last?.type === "thinking") {
        last.blocks.push(item.block);
      } else {
        groups.push({ type: "thinking", blocks: [item.block] });
      }
    } else if (item.type === "tool") {
      if (last?.type === "tool") {
        last.tools.push(item.tool);
      } else {
        groups.push({ type: "tool", tools: [item.tool] });
      }
    } else if (item.type === "subagent") {
      if (last?.type === "subagent") {
        last.subagents.push(item.subagent);
      } else {
        groups.push({ type: "subagent", subagents: [item.subagent] });
      }
    } else if (item.type === "approval") {
      if (last?.type === "approval") {
        last.approvals.push(item.approval);
      } else {
        groups.push({ type: "approval", approvals: [item.approval] });
      }
    }
  }
  return groups;
}

function kimiWebGroupStatusText(group: ProcessGroup) {
  if (group.type === "thinking") return "";
  if (group.type === "approval") {
    const pending = group.approvals.some((a) => a.status === "pending");
    const allApproved = group.approvals.every((a) => a.status === "approved");
    if (pending) return "待审批";
    return allApproved ? "已批准" : "已处理";
  }
  const isRunning = group.type === "tool"
    ? group.tools.some((t) => t.status === "running")
    : group.subagents.some((s) => s.status === "queued" || s.status === "running" || s.status === "suspended");
  const hasError = group.type === "tool"
    ? group.tools.some((t) => t.status === "error")
    : group.subagents.some((s) => s.status === "error");
  if (isRunning) return "运行中";
  if (hasError) return "失败";
  return "已完成";
}

function kimiWebGroupSummary(group: ProcessGroup) {
  if (group.type === "thinking") return `${group.blocks.length} 段思考`;
  if (group.type === "tool") return `${group.tools.length} 个工具调用`;
  if (group.type === "subagent") return `${group.subagents.length} 个子代理`;
  return `${group.approvals.length} 个工具请求`;
}

const KIMI_WEB_THINKING_SUMMARY_STYLE: CSSProperties = {
  fontSize: "14.5px",
  lineHeight: "24px",
  fontFamily: "var(--font-sans)",
  fontWeight: 400,
  letterSpacing: 0,
  whiteSpace: "pre-wrap",
};

function KimiWebThinkingItem({ block, isLive }: { block: ThinkingBlock; isLive: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const paragraphs = useMemo(() =>
    block.text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0),
    [block.text]
  );
  // Match the official kimi-web ThinkingBlock.vue behavior:
  // single-paragraph thinking is shown straight; multi-paragraph thinking
  // is folded to its last paragraph and expands inline on click.
  const isFoldable = paragraphs.length > 1;
  const teaser = paragraphs.at(-1) ?? block.text;
  if (isLive) {
    return (
      <div
        className="text-left text-[14.5px] leading-6 text-[var(--kimix-panel-text-secondary)]"
        style={KIMI_WEB_THINKING_SUMMARY_STYLE}
      >
        {block.text}
      </div>
    );
  }
  return (
    <div className="flex flex-col" style={{ gap: expanded && isFoldable ? 8 : 0 }}>
      {isFoldable ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="kimix-kimi-web-foldable-summary text-left text-[14.5px] leading-6 text-[var(--kimix-panel-text-secondary)] transition-colors hover:text-[var(--kimix-panel-text)]"
          style={KIMI_WEB_THINKING_SUMMARY_STYLE}
        >
          {teaser}
        </button>
      ) : (
        <div
          className="kimix-kimi-web-inline-summary text-left text-[14.5px] leading-6 text-[var(--kimix-panel-text-secondary)]"
          style={KIMI_WEB_THINKING_SUMMARY_STYLE}
        >
          {block.text}
        </div>
      )}
      {expanded && isFoldable && (
        <div
          className="text-[13.5px] leading-6 text-[var(--kimix-panel-text-muted)]"
          style={{ whiteSpace: "pre-wrap" }}
        >
          {block.text}
        </div>
      )}
    </div>
  );
}

function KimiWebThinkingBlock({ blocks, isLive }: { blocks: ThinkingBlock[]; isLive: boolean }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const dedupedBlocks = useMemo(() => {
    const result: ThinkingBlock[] = [];
    for (const block of blocks) {
      const last = result.at(-1);
      if (last && block.text.startsWith(last.text)) {
        // The later block is a superset of (or identical to) the previous one,
        // which happens when a tool boundary splits a single streaming thought
        // into repeated parts. Keep the more complete version.
        result[result.length - 1] = block;
      } else {
        result.push(block);
      }
    }
    return result;
  }, [blocks]);
  const contentVersion = useMemo(
    () => dedupedBlocks.map((block) => `${block.id}:${block.text.length}`).join("|"),
    [dedupedBlocks],
  );

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!isLive || !viewport) return;
    followLatestRef.current = true;
    viewport.scrollTop = viewport.scrollHeight;
  }, [isLive]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!isLive || !viewport || !followLatestRef.current) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [contentVersion, isLive]);

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (canLiveThinkingViewportConsumeWheel(event.currentTarget, event.deltaY)) {
      event.stopPropagation();
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const deltaY = ["ArrowUp", "PageUp", "Home"].includes(event.key)
      ? -1
      : ["ArrowDown", "PageDown", "End"].includes(event.key)
        ? 1
        : 0;
    if (deltaY && canLiveThinkingViewportConsumeWheel(event.currentTarget, deltaY)) {
      event.stopPropagation();
    }
  };

  return (
    <div
      ref={viewportRef}
      className={`flex min-w-0 flex-col ${isLive ? "kimix-live-thinking-scroll" : ""}`}
      style={{
        gap: 8,
        ...(isLive ? {
          maxHeight: LIVE_THINKING_MAX_HEIGHT_PX,
          overflowX: "hidden",
          overflowY: "auto",
          scrollbarGutter: "stable",
        } : {}),
      }}
      role={isLive ? "region" : undefined}
      aria-label={isLive ? "正在生成的思考过程" : undefined}
      tabIndex={isLive ? 0 : undefined}
      onScroll={isLive ? (event) => {
        followLatestRef.current = shouldFollowLiveThinkingViewport(event.currentTarget);
      } : undefined}
      onWheel={isLive ? handleWheel : undefined}
      onKeyDown={isLive ? handleKeyDown : undefined}
      onTouchStart={isLive ? (event) => event.stopPropagation() : undefined}
      onTouchMove={isLive ? (event) => event.stopPropagation() : undefined}
    >
      {dedupedBlocks.map((block) => (
        <KimiWebThinkingItem key={block.id} block={block} isLive={isLive} />
      ))}
    </div>
  );
}

function KimiWebToolRow({ tool, isLast }: { tool: ToolEvent; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [showFullDetails, setShowFullDetails] = useState(false);
  const {
    displayTarget,
    lineCount,
    detailText,
    fullDetailText,
    omittedCharacters,
    hasDetail,
  } = useMemo(() => {
    const argumentPreview = toolArgumentPreview(tool) || tool.toolName || "工具调用";
    const officialDescription = tool.description || tool.display?.description || "";
    const command = typeof tool.arguments?.command === "string"
      ? tool.arguments.command
      : typeof tool.arguments?.cmd === "string"
        ? tool.arguments.cmd
        : typeof tool.display?.command === "string"
          ? tool.display.command
          : "";
    const path = typeof tool.arguments?.path === "string"
      ? tool.arguments.path
      : typeof tool.arguments?.file_path === "string"
        ? tool.arguments.file_path
        : "";
    const displayTarget = officialDescription || command || path || argumentPreview;
    const lineCount = typeof tool.result === "string"
      ? tool.result.split(/\r?\n/).length
      : 0;
    const argumentText = formatToolArgumentsForDisplay(tool).trim();
    const resultText = formatToolResultForDisplay(tool.result);
    const detailText = [
      `工具：${tool.toolName || "未知工具"}`,
      officialDescription ? `展示：${officialDescription}` : "",
      argumentText ? `参数：\n${argumentText}` : "",
      resultText ? `结果：\n${resultText}` : "",
    ].filter(Boolean).join("\n\n");
    const fullArgumentText = formatFullToolArgumentsForDisplay(tool).trim();
    const fullResultText = formatFullToolResultForDisplay(tool.result);
    const fullDetailText = [
      `工具：${tool.toolName || "未知工具"}`,
      officialDescription ? `展示：${officialDescription}` : "",
      fullArgumentText ? `参数：\n${fullArgumentText}` : "",
      fullResultText ? `结果：\n${fullResultText}` : "",
    ].filter(Boolean).join("\n\n");
    const previewDetailText = removeToolOmissionMarkers(detailText);
    const hasDetail = previewDetailText.trim().length > 0;
    return {
      displayTarget,
      lineCount,
      detailText: previewDetailText,
      fullDetailText,
      omittedCharacters: Math.max(0, fullDetailText.length - previewDetailText.length),
      hasDetail,
    };
  }, [tool]);
  const rowContent = (
    <>
      <span className="flex h-5 items-center justify-center text-[var(--kimix-process-muted)]">
        <SquareTerminal size={14} />
      </span>
      <span className="flex min-w-0 items-center overflow-hidden">
        <span className="truncate leading-6">{displayTarget}</span>
      </span>
      <span className="flex h-5 items-center" style={{ gap: 8 }}>
        {lineCount > 0 && <span className="kimix-tabular-nums text-[12px] leading-none text-[var(--kimix-panel-text-muted)]">{lineCount} 行</span>}
        {tool.status === "success" && <Check size={14} className="text-accent-success" />}
        {tool.status === "error" && <span className="h-1.5 w-1.5 rounded-full bg-accent-danger" />}
        {tool.status === "running" && <Loader2 size={14} className="kimix-spin text-accent-warning" />}
      </span>
      <span className="flex h-5 items-center justify-center text-[var(--kimix-process-muted)]">
        {hasDetail ? (expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
      </span>
    </>
  );

  return (
    <div
      className="flex flex-col"
      style={{ borderBottom: isLast ? "none" : "1px solid var(--kimix-panel-divider)" }}
    >
      {hasDetail ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="grid w-full items-center text-left text-[14.5px] text-[var(--kimix-panel-text-secondary)] transition-colors hover:bg-[var(--kimix-panel-hover)]"
          style={{ gridTemplateColumns: "18px 1fr auto 18px", gap: 8, minHeight: 34, paddingLeft: 12, paddingRight: 12 }}
        >
          {rowContent}
        </button>
      ) : (
        <div
          className="grid w-full items-center text-left text-[14.5px] text-[var(--kimix-panel-text-secondary)]"
          style={{ gridTemplateColumns: "18px 1fr auto 18px", gap: 8, minHeight: 34, paddingLeft: 12, paddingRight: 12 }}
        >
          {rowContent}
        </div>
      )}
      {expanded && (
        <div>
          <pre className="min-w-0 whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-[var(--kimix-panel-text-secondary)]" style={{ padding: "0 12px 6px 38px" }}>
            {showFullDetails ? fullDetailText : detailText}
          </pre>
          {omittedCharacters > 0 && (
            <button
              type="button"
              onClick={() => setShowFullDetails((value) => !value)}
              className="kimix-icon-text-button ml-[38px] text-[12px] text-[var(--kimix-panel-text-muted)] hover:bg-[var(--kimix-panel-hover)] hover:text-[var(--kimix-panel-text-secondary)]"
              style={{ marginBottom: 8 }}
            >
              {showFullDetails ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span>{showFullDetails ? "收起工具完整内容" : `已折叠 ${omittedCharacters.toLocaleString()} 字，点击展开查看`}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function KimiWebToolGroupCard({ tools }: { tools: ToolEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  const statusText = kimiWebGroupStatusText({ type: "tool", tools });
  const allDone = tools.every((t) => t.status === "success");
  return (
    <div className="kimix-soft-card overflow-hidden rounded-xl">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center text-left text-[13.5px] leading-none text-[var(--kimix-panel-text-secondary)] transition-colors hover:bg-[var(--kimix-panel-hover)]"
        style={{ gap: 9, padding: "8px 12px" }}
      >
        <span className="flex h-5 w-[18px] shrink-0 items-center justify-center text-[var(--kimix-process-muted)]">
          <SquareTerminal size={14} />
        </span>
        <span className="flex h-5 min-w-0 flex-1 items-center">
          <span className="truncate">{kimiWebGroupSummary({ type: "tool", tools })}</span>
        </span>
        <span className="flex h-5 shrink-0 items-center" style={{ gap: 8 }}>
          {statusText && <span className="text-[12px] leading-none text-[var(--kimix-panel-text-muted)]">{statusText}</span>}
          {allDone && <Check size={14} className="text-accent-success" />}
        </span>
        <span className="flex h-5 w-[18px] shrink-0 items-center justify-center text-[var(--kimix-process-muted)]">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-[var(--kimix-panel-divider)] flex flex-col">
          {tools.map((tool, index) => <KimiWebToolRow key={tool.id} tool={tool} isLast={index === tools.length - 1} />)}
        </div>
      )}
    </div>
  );
}

const KIMI_WEB_SUBAGENT_DETAIL_LIMIT = 8;

type KimiWebSubagentDetailItem = {
  id: string;
  timestamp: number;
  kind: "assistant" | "thinking" | "tool" | "status" | "error";
  label: string;
  detail?: string;
  tone?: "default" | "success" | "warning" | "danger";
};

function compactSubagentText(value: string, maxLength = 120) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function subagentToolTarget(event: Extract<TimelineEvent, { type: "tool_call" | "tool_result" }>) {
  if (event.type === "tool_result") return "";
  const directKeys = ["command", "cmd", "path", "filePath", "file_path", "pattern", "query", "content", "description"];
  for (const key of directKeys) {
    const value = event.arguments[key];
    if (typeof value === "string" && value.trim()) return compactSubagentText(value, 88);
  }
  return compactSubagentText(toolArgumentPreview(event) || "", 88);
}

function buildKimiWebSubagentDetails(subagent: SubagentEvent): KimiWebSubagentDetailItem[] {
  const details: KimiWebSubagentDetailItem[] = [];
  const toolItems = new Map<string, KimiWebSubagentDetailItem>();

  const upsertTool = (event: Extract<TimelineEvent, { type: "tool_call" | "tool_result" }>) => {
    const key = event.toolCallId || event.id;
    const existing = toolItems.get(key);
    const target = subagentToolTarget(event);
    const result = event.type === "tool_result"
      ? formatToolResultForDisplay(event.result)
      : formatToolResultForDisplay(event.result);
    const status = event.type === "tool_call" ? event.status : "success";
    const label = `${status === "running" ? "正在使用" : status === "error" ? "工具失败" : "工具完成"} ${event.toolName || "工具"}`;
    const next: KimiWebSubagentDetailItem = {
      id: existing?.id ?? `tool-${key}`,
      timestamp: existing?.timestamp ?? event.timestamp,
      kind: "tool",
      label,
      detail: compactSubagentText([target, result].filter(Boolean).join(" · "), 160),
      tone: status === "error" ? "danger" : status === "running" ? "warning" : "success",
    };
    if (!existing) {
      details.push(next);
    } else {
      const index = details.findIndex((item) => item.id === existing.id);
      if (index >= 0) details[index] = next;
    }
    toolItems.set(key, next);
  };

  subagent.events.forEach((event) => {
    if (event.type === "tool_call" || event.type === "tool_result") {
      upsertTool(event);
      return;
    }
    if (event.type === "assistant_message") {
      const text = event.content || event.thinking || "";
      if (!text.trim()) return;
      details.push({
        id: event.id,
        timestamp: event.timestamp,
        kind: event.thinking && !event.content ? "thinking" : "assistant",
        label: event.thinking && !event.content ? "思考" : "输出",
        detail: compactSubagentText(text, 180),
      });
      return;
    }
    if (event.type === "status_update" && event.message) {
      details.push({
        id: event.id,
        timestamp: event.timestamp,
        kind: "status",
        label: "状态",
        detail: compactSubagentText(event.message, 160),
        tone: event.tone === "danger" ? "danger" : event.tone === "warning" ? "warning" : event.tone === "success" ? "success" : "default",
      });
      return;
    }
    if (event.type === "error") {
      details.push({
        id: event.id,
        timestamp: event.timestamp,
        kind: "error",
        label: "错误",
        detail: compactSubagentText(event.message, 160),
        tone: "danger",
      });
    }
  });

  return details.sort((left, right) => left.timestamp - right.timestamp);
}

function KimiWebSubagentDetailIcon({ item }: { item: KimiWebSubagentDetailItem }) {
  const className = item.tone === "danger"
    ? "text-accent-danger"
    : item.tone === "warning"
      ? "text-accent-warning"
      : item.tone === "success"
        ? "text-accent-success"
        : "text-[var(--kimix-process-muted)]";
  if (item.kind === "tool") return <SquareTerminal size={12} className={className} />;
  if (item.kind === "thinking") return <Brain size={12} className={className} />;
  if (item.kind === "error") return <FileText size={12} className={className} />;
  if (item.kind === "status") return <FileText size={12} className={className} />;
  return <Bot size={12} className={className} />;
}

function KimiWebSubagentDetails({ subagent }: { subagent: SubagentEvent }) {
  const [showAll, setShowAll] = useState(false);
  const details = useMemo(() => buildKimiWebSubagentDetails(subagent), [subagent]);
  const visibleDetails = showAll ? details : details.slice(-KIMI_WEB_SUBAGENT_DETAIL_LIMIT);
  const hiddenCount = Math.max(0, details.length - visibleDetails.length);
  if (details.length === 0) {
    return (
      <div className="text-[12.5px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ padding: "0 12px 10px 26px" }}>
        暂无可展示的子事件详情。
      </div>
    );
  }
  return (
    <div style={{ padding: "0 12px 10px 26px" }}>
      <div
        className="min-w-0"
        style={{ paddingLeft: 12 }}
      >
        <div className="flex flex-col" style={{ gap: 6 }}>
          {visibleDetails.map((item) => (
            <div
              key={item.id}
              className="grid min-w-0 items-start text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]"
              style={{ gridTemplateColumns: "16px 104px minmax(0, 1fr)", columnGap: 8 }}
            >
              <span className="flex h-5 items-center justify-center">
                <KimiWebSubagentDetailIcon item={item} />
              </span>
              <span className="min-w-0 truncate whitespace-nowrap text-[var(--kimix-panel-text-muted)]" title={item.label}>{item.label}</span>
              <span className="min-w-0 break-words">{item.detail || "无详情"}</span>
            </div>
          ))}
        </div>
        {details.length > KIMI_WEB_SUBAGENT_DETAIL_LIMIT && (
          <button
            type="button"
            onClick={() => setShowAll((value) => !value)}
            className="kimix-muted-action rounded-md text-[12.5px]"
            style={{ minHeight: 28, marginTop: 8, paddingLeft: 8, paddingRight: 8 }}
          >
            {showAll ? "收起部分子事件" : `显示全部 ${details.length} 条子事件（还有 ${hiddenCount} 条）`}
          </button>
        )}
      </div>
    </div>
  );
}

function KimiWebSubagentRow({ subagent, isLast }: { subagent: SubagentEvent; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = subagent.status === "queued" || subagent.status === "running" || subagent.status === "suspended";
  const canExpand = subagent.events.length > 0;
  const taskName = subagent.description?.trim() || subagent.agentName || "子任务";
  const roleName = subagent.description && subagent.agentName ? subagent.agentName : "";
  const indexedTaskName = typeof subagent.swarmIndex === "number" ? `${taskName} #${subagent.swarmIndex}` : taskName;
  const statusText = subagent.status === "queued"
    ? "排队中"
    : subagent.status === "suspended"
      ? "已暂停"
      : subagent.status === "running"
        ? "运行中"
        : subagent.status === "error"
          ? "失败"
          : "已完成";
  useEffect(() => {
    if (!canExpand && expanded) setExpanded(false);
  }, [canExpand, expanded]);
  const rowContent = (
    <>
      <span className="flex h-5 items-center justify-center text-[var(--kimix-process-muted)]">
        {isRunning ? <Loader2 size={13} className="kimix-spin" /> : <Bot size={13} />}
      </span>
      <span className="flex min-w-0 items-center overflow-hidden">
        <span className="truncate leading-[20px]" title={[indexedTaskName, roleName].filter(Boolean).join(" ")}>
          {indexedTaskName}{roleName && <span className="text-[var(--kimix-panel-text-muted)]"> ({roleName})</span>}
        </span>
      </span>
      <span className="flex h-5 items-center" style={{ gap: 8 }}>
        <span className={subagent.status === "error" ? "text-accent-danger" : isRunning ? "text-accent-primary" : "text-[var(--kimix-panel-text-muted)]"}>{statusText}</span>
        {subagent.status === "error" && <X size={13} className="text-accent-danger" />}
        {subagent.status === "completed" && <Check size={13} className="text-accent-success" />}
      </span>
      <span className="flex h-5 items-center justify-center text-[var(--kimix-process-muted)]">
        {canExpand ? (expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />) : null}
      </span>
    </>
  );
  return (
    <div
      className="flex flex-col text-[13px] text-[var(--kimix-panel-text-secondary)]"
      style={{ borderBottom: isLast ? "none" : "1px solid var(--kimix-panel-divider)" }}
    >
      {canExpand ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="grid w-full items-center text-left transition-colors hover:bg-[var(--kimix-panel-hover)]"
          style={{ gridTemplateColumns: "18px minmax(0, 1fr) auto 18px", gap: 8, minHeight: 42, paddingLeft: 16, paddingRight: 16 }}
          title={expanded ? "收起子事件" : "展开子事件"}
        >
          {rowContent}
        </button>
      ) : (
        <div
          className="grid w-full items-center text-left"
          style={{ gridTemplateColumns: "18px minmax(0, 1fr) auto 18px", gap: 8, minHeight: 42, paddingLeft: 16, paddingRight: 16 }}
        >
          {rowContent}
        </div>
      )}
      {expanded && <KimiWebSubagentDetails subagent={subagent} />}
    </div>
  );
}

function KimiWebSubagentGroupCard({ subagents }: { subagents: SubagentEvent[] }) {
  const activeCount = subagents.filter((subagent) => subagent.status === "queued" || subagent.status === "running" || subagent.status === "suspended").length;
  const completedCount = subagents.filter((subagent) => subagent.status === "completed").length;
  const failedCount = subagents.filter((subagent) => subagent.status === "error").length;
  const totalCount = subagents.length;
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const descriptions = Array.from(new Set(subagents.map((subagent) => subagent.description?.trim()).filter(Boolean)));
  const title = descriptions.length === 1 ? descriptions[0] : `${totalCount} 个并行任务`;
  const [expanded, setExpanded] = useState(activeCount > 0);
  return (
    <div className="kimix-soft-card overflow-hidden rounded-lg">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center text-left text-[13.5px] leading-none text-[var(--kimix-panel-text-secondary)] transition-colors hover:bg-[var(--kimix-panel-hover)]"
        style={{ gap: 9, minHeight: 42, padding: "9px 16px" }}
      >
        <span className="flex h-5 w-[18px] shrink-0 items-center justify-center text-[var(--kimix-process-muted)]">
          <GitBranch size={14} />
        </span>
        <span className="flex h-5 min-w-0 flex-1 items-center">
          <span className="truncate"><strong className="font-medium text-[var(--kimix-panel-text)]">Swarm</strong><span className="text-[var(--kimix-panel-text-muted)]"> · </span>{title}</span>
        </span>
        <span className="flex h-5 shrink-0 items-center" style={{ gap: 8 }}>
          <span className={`h-1.5 w-1.5 rounded-full ${activeCount > 0 ? "bg-accent-primary" : failedCount > 0 ? "bg-accent-danger" : "bg-accent-success"}`} />
          <span className="kimix-tabular-nums text-[12px] leading-none text-[var(--kimix-panel-text-muted)]">{completedCount} / {totalCount}</span>
        </span>
        <span className="flex h-5 w-[18px] shrink-0 items-center justify-center text-[var(--kimix-process-muted)]">
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>
      </button>
      {expanded && (
        <div style={{ borderTop: "1px solid var(--kimix-panel-divider)" }}>
          <div style={{ padding: "11px 16px 12px" }}>
            <div className="flex items-center text-[13px] text-[var(--kimix-panel-text-secondary)]" style={{ gap: 8 }}>
              <span className="kimix-tabular-nums font-medium text-[var(--kimix-panel-text)]">{completedCount} / {totalCount}</span>
              <span>{activeCount > 0 ? `${activeCount} 个进行中` : failedCount > 0 ? `${failedCount} 个失败` : "全部完成"}</span>
            </div>
            <div
              className="overflow-hidden rounded-full bg-[var(--kimix-panel-divider)]"
              style={{ height: 4, marginTop: 10 }}
              aria-label={`Swarm 已完成 ${completedCount} / ${totalCount}`}
            >
              <div
                className="h-full rounded-full bg-accent-primary transition-[width] duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          <div style={{ borderTop: "1px solid var(--kimix-panel-divider)" }}>
            {subagents.map((subagent, index) => <KimiWebSubagentRow key={subagent.id} subagent={subagent} isLast={index === subagents.length - 1} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function KimiWebApprovalRow({ approval, isLast }: { approval: ApprovalEvent; isLast: boolean }) {
  const approved = approval.status === "approved";
  return (
    <div
      className="text-[13px] text-[var(--kimix-panel-text-secondary)]"
      style={{ borderBottom: isLast ? "none" : "1px solid var(--kimix-panel-divider)" }}
    >
      <div
        className="grid w-full items-center"
        style={{ gridTemplateColumns: "18px 1fr auto", gap: 8, height: 42 }}
      >
        <span className="flex h-5 items-center justify-center text-[var(--kimix-process-muted)]">
          <ShieldCheck size={13} />
        </span>
        <span className="flex min-w-0 items-center overflow-hidden">
          <span className="truncate leading-[20px]">{approval.description || approval.toolName || "工具请求"}</span>
        </span>
        <span className="flex h-5 items-center" style={{ gap: 8 }}>
          {approved && <Check size={13} className="text-accent-success" />}
          {approval.status === "rejected" && <span className="h-1.5 w-1.5 rounded-full bg-accent-danger" />}
          {approval.status === "pending" && <span className="h-1.5 w-1.5 rounded-full bg-accent-warning" />}
        </span>
      </div>
    </div>
  );
}

function KimiWebApprovalGroupCard({ approvals }: { approvals: ApprovalEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  const statusText = kimiWebGroupStatusText({ type: "approval", approvals });
  return (
    <div className="kimix-soft-card overflow-hidden rounded-xl">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center text-left text-[13.5px] leading-none text-[var(--kimix-panel-text-secondary)] transition-colors hover:bg-[var(--kimix-panel-hover)]"
        style={{ gap: 9, padding: "8px 12px" }}
      >
        <span className="flex h-5 w-[18px] shrink-0 items-center justify-center text-[var(--kimix-process-muted)]">
          <ShieldCheck size={14} />
        </span>
        <span className="flex h-5 min-w-0 flex-1 items-center">
          <span className="truncate">{kimiWebGroupSummary({ type: "approval", approvals })}</span>
        </span>
        <span className="flex h-5 shrink-0 items-center" style={{ gap: 8 }}>
          {statusText && <span className="text-[12px] leading-none text-[var(--kimix-panel-text-muted)]">{statusText}</span>}
        </span>
        <span className="flex h-5 w-[18px] shrink-0 items-center justify-center text-[var(--kimix-process-muted)]">
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>
      </button>
      {expanded && (
        <div style={{ padding: "5px 12px" }}>
          {approvals.map((approval, index) => <KimiWebApprovalRow key={approval.id} approval={approval} isLast={index === approvals.length - 1} />)}
        </div>
      )}
    </div>
  );
}

function KimiWebProcessGroup({ group, isLive }: { group: ProcessGroup; isLive: boolean }) {
  switch (group.type) {
    case "thinking":
      return <KimiWebThinkingBlock blocks={group.blocks} isLive={isLive} />;
    case "tool":
      return <KimiWebToolGroupCard tools={group.tools} />;
    case "subagent":
      return <KimiWebSubagentGroupCard subagents={group.subagents} />;
    case "approval":
      return <KimiWebApprovalGroupCard approvals={group.approvals} />;
  }
}

function KimiWebProcessList({ items, isActiveAssistant, hasFinalContent, preserveDuringFinalTransition = false }: { items: ProcessItem[]; isActiveAssistant: boolean; hasFinalContent: boolean; preserveDuringFinalTransition?: boolean }) {
  const groups = useMemo(() => groupProcessItems(items), [items]);
  return (
    <div className="flex flex-col" style={{ gap: 10 }}>
      {groups.map((group, index) => (
        <KimiWebProcessGroup
          key={`${group.type}-${index}`}
          group={group}
          isLive={shouldUseLiveThinkingViewport({
            groupIndex: index,
            groupCount: groups.length,
            isThinkingGroup: group.type === "thinking",
            isActiveAssistant,
            hasFinalContent,
            preserveDuringFinalTransition,
          })}
        />
      ))}
    </div>
  );
}

function AssistantProcessSummary({ event, sessionId, tools, subagents, approvals, label, displayMode = "kimix", expandByDefault = false, isActiveAssistant = false, hasFinalContent = false, collapseWhileRunning = true }: { event: AssistantEvent; sessionId?: string; tools: ToolEvent[]; subagents: SubagentEvent[]; approvals: ApprovalEvent[]; label: ReactNode; displayMode?: ProcessDisplayMode; expandByDefault?: boolean; isActiveAssistant?: boolean; hasFinalContent?: boolean; collapseWhileRunning?: boolean }) {
  const isKimiWeb = displayMode === "kimi-web";
  // B3: while the turn is actively running, keep process details collapsed by
  // default (one summary row). Users can still expand manually.
  const defaultExpanded = isKimiWeb && expandByDefault && !hasFinalContent && !(isActiveAssistant && collapseWhileRunning);
  // The assistant bubble can remount mid-turn (pending placeholder swap,
  // merged-id fallback). Restore the user's last manual expand/collapse
  // choice after a remount instead of falling back to the default.
  const manualExpandTurnKey = processManualExpandTurnKey({
    sessionId,
    agentTurnId: event.agentTurnId,
    roomMessageId: event.roomMessageId,
    eventId: event.id,
  });
  const manualExpandOverride = getProcessManualExpand(manualExpandTurnKey);
  const [expanded, setExpanded] = useState(() => manualExpandOverride ?? defaultExpanded);
  const previousHasFinalContentRef = useRef(hasFinalContent);
  const manuallyExpandedRef = useRef(false);
  const summaryAnchorRef = useRef<HTMLButtonElement>(null);
  const contentAnchorRef = useRef<HTMLSpanElement>(null);
  const processDetailRef = useRef<HTMLDivElement>(null);
  const pendingAutoCollapseTransactionRef = useRef<string | null>(null);
  const pendingToggleAnchorRef = useRef<{
    scrollNode: HTMLElement;
    viewportTop: number;
    anchor: "summary" | "content";
  } | null>(null);
  const thinkingBlocks = useMemo(() => buildThinkingBlocks({
    ...event,
    boundaryTimestamps: tools.map((tool) => tool.timestamp),
  }), [event.thinking, event.thinkingParts, event.timestamp, tools]);
  const items: ProcessItem[] = useMemo(() => [
    ...thinkingBlocks.map((block): ProcessItem => ({ type: "thinking", block })),
    ...tools.map((tool): ProcessItem => ({ type: "tool", tool })),
    ...subagents.map((subagent): ProcessItem => ({ type: "subagent", subagent })),
    ...approvals.map((approval): ProcessItem => ({ type: "approval", approval })),
  ].sort((a, b) => (
    processItemTimestamp(a) - processItemTimestamp(b) || processItemPriority(a) - processItemPriority(b)
  )), [thinkingBlocks, tools, subagents, approvals]);
  const hasDetails = items.length > 0;
  const detailUnit = event.agentRole ? "内容" : "思考";
  const summary = useMemo(() => joinSummaryParts([
    thinkingBlocks.length > 0 ? `${thinkingBlocks.length} 段${detailUnit}` : "",
    tools.length > 0 ? `${tools.length} 条命令` : "",
    subagents.length > 0 ? `${subagents.length} 个子代理` : "",
    approvals.length > 0 ? `${approvals.length} 个工具请求` : "",
  ]), [approvals.length, detailUnit, subagents.length, thinkingBlocks.length, tools.length]);
  const isFinalContentTransition = shouldCollapseKimiWebProcessOnFinalContent({
    previousHasFinalContent: previousHasFinalContentRef.current,
    hasFinalContent,
    isKimiWeb,
    expanded,
    manuallyExpanded: manuallyExpandedRef.current || manualExpandOverride === true,
  });

  const dispatchProcessCollapseViewport = (
    phase: ChatProcessCollapseViewportDetail["phase"],
    transactionId: string,
  ) => {
    window.dispatchEvent(new CustomEvent<ChatProcessCollapseViewportDetail>(CHAT_PROCESS_COLLAPSE_VIEWPORT_EVENT, {
      detail: {
        phase,
        transactionId,
        sessionId: sessionId ?? "",
        eventId: event.id,
        agentTurnId: event.agentTurnId,
        roomAgentId: event.roomAgentId,
        summaryAnchor: summaryAnchorRef.current,
        contentAnchor: contentAnchorRef.current,
        collapsingNode: processDetailRef.current,
      },
    }));
  };

  useLayoutEffect(() => {
    previousHasFinalContentRef.current = hasFinalContent;
    if (!isFinalContentTransition) return;

    // Keep the live viewport mounted for this commit, snapshot the outer chat,
    // then remove the whole process detail in one protected layout transaction.
    const transactionId = `${sessionId ?? "unknown"}:${event.roomAgentId ?? "single"}:${event.agentTurnId ?? event.id}:${event.id}:final-content`;
    pendingAutoCollapseTransactionRef.current = transactionId;
    dispatchProcessCollapseViewport("before", transactionId);
    setExpanded(false);
  }, [event.agentTurnId, event.id, event.roomAgentId, hasFinalContent, isFinalContentTransition, sessionId]);

  useLayoutEffect(() => {
    const transactionId = pendingAutoCollapseTransactionRef.current;
    if (expanded || !transactionId) return;
    pendingAutoCollapseTransactionRef.current = null;
    dispatchProcessCollapseViewport("after", transactionId);
  }, [expanded]);

  const toggleWithStableAnchor = (nextExpanded: boolean, anchorKind: "summary" | "content") => {
    manuallyExpandedRef.current = nextExpanded;
    noteProcessManualExpand(manualExpandTurnKey, nextExpanded);
    const anchor = anchorKind === "summary" ? summaryAnchorRef.current : contentAnchorRef.current;
    const scrollNode = anchor?.closest<HTMLElement>(".kimix-chat-scroll-area");
    if (anchor && scrollNode) {
      pendingToggleAnchorRef.current = {
        scrollNode,
        viewportTop: anchor.getBoundingClientRect().top,
        anchor: anchorKind,
      };
      window.dispatchEvent(new CustomEvent("kimix:intentional-chat-resize", {
        detail: { preserveViewport: true },
      }));
    }
    setExpanded(nextExpanded);
  };

  useLayoutEffect(() => {
    const pending = pendingToggleAnchorRef.current;
    const anchor = pending?.anchor === "summary" ? summaryAnchorRef.current : contentAnchorRef.current;
    if (!pending || !anchor) return;

    const restoreAnchor = () => {
      if (!anchor.isConnected || !pending.scrollNode.isConnected) return;
      const delta = anchor.getBoundingClientRect().top - pending.viewportTop;
      if (Math.abs(delta) > 0.5) pending.scrollNode.scrollTop += delta;
    };

    restoreAnchor();
    const frame = window.requestAnimationFrame(() => {
      restoreAnchor();
      pendingToggleAnchorRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expanded]);

  const summaryContent = (
    <>
      {hasDetails ? (expanded ? <ChevronDown size={15} className="shrink-0" /> : <ChevronRight size={15} className="shrink-0" />) : <span className="w-[15px]" />}
      <span className="kimix-tabular-nums shrink-0">{label}</span>
      {hasDetails && !isKimiWeb && (
        <span className="min-w-0 truncate text-[13px] text-[var(--kimix-panel-text-muted)]">
          {summary}
        </span>
      )}
    </>
  );

  return (
    <div className={`w-full ${isKimiWeb ? "" : "border-b border-[var(--kimix-panel-divider)]"}`} style={{ paddingBottom: isKimiWeb ? 6 : expanded && hasDetails ? 8 : 12 }}>
      {hasDetails ? (
        <button
          ref={summaryAnchorRef}
          type="button"
          onClick={() => toggleWithStableAnchor(!expanded, "summary")}
          className="kimix-chat-collapse-row max-w-full text-[15px] leading-none text-[var(--kimix-panel-text-secondary)] hover:bg-[var(--kimix-panel-hover)] hover:text-[var(--kimix-panel-text-secondary)]"
        >
          {summaryContent}
        </button>
      ) : (
        <div className="kimix-chat-collapse-row max-w-full text-[15px] leading-none text-[var(--kimix-panel-text-secondary)]">
          {summaryContent}
        </div>
      )}
      {isKimiWeb && (
        <div className="w-full border-b border-[var(--kimix-panel-divider)]" style={{ paddingBottom: 8 }} />
      )}
      {expanded && hasDetails && (
        <div ref={processDetailRef} className="flex flex-col" style={{ gap: 10, paddingTop: isKimiWeb ? 8 : 12, paddingBottom: isKimiWeb ? 12 : 0 }}>
          {isKimiWeb ? (
            <KimiWebProcessList
              items={items}
              isActiveAssistant={isActiveAssistant}
              hasFinalContent={hasFinalContent}
              preserveDuringFinalTransition={isFinalContentTransition}
            />
          ) : <ProcessDetailList items={items} />}
          {!isKimiWeb && (
            <button
              type="button"
              onClick={() => toggleWithStableAnchor(false, "content")}
              className="kimix-icon-text-button kimix-muted-action is-compact self-end"
              style={{ marginTop: 2, paddingLeft: 12, paddingRight: 12 }}
            >
              <ChevronUp size={14} />
              <span>收起本轮内容</span>
            </button>
          )}
        </div>
      )}
      <span ref={contentAnchorRef} aria-hidden="true" className="block h-0" />
    </div>
  );
}

function AssistantMessageFooter({
  statuses,
  fallbackLabel,
  onCopy,
  onCopyAll,
  copied,
  copiedAll,
  hookBadgeEvents,
  showActions,
}: {
  statuses: Extract<TimelineEvent, { type: "status_update" }>[];
  fallbackLabel: string;
  onCopy: () => void;
  onCopyAll: () => void;
  copied: boolean;
  copiedAll: boolean;
  hookBadgeEvents: Extract<TimelineEvent, { type: "hook" }>[];
  showActions: boolean;
}) {
  const visibleStatuses = statuses.filter(shouldShowInlineStatusUpdate);
  const hasVisibleStatuses = visibleStatuses.length > 0;
  return (
    <div
      className="relative flex min-h-[28px] min-w-0 items-center justify-center"
      style={{
        marginTop: 3,
      }}
    >
      <div
        className="absolute left-0 top-1/2 flex -translate-y-1/2 items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        style={{ gap: 6 }}
      >
        {showActions && (
          <>
            <button
              onClick={onCopy}
              className="kimix-inline-icon-action is-roomy text-text-muted hover:bg-bg-hover hover:text-text-primary"
              title="复制"
              aria-label="复制"
            >
              <StateIconSwap
                active={copied}
                activeIcon={<Check size={13} className="text-accent-success" />}
                inactiveIcon={<Copy size={13} />}
              />
            </button>
            <button
              onClick={onCopyAll}
              className="kimix-muted-action flex h-8 items-center rounded-md text-text-muted"
              style={{ gap: 5, paddingLeft: 9, paddingRight: 9, ...STATUS_CARD_TEXT_STYLE }}
              title="全部复制（含思考）"
              aria-label="全部复制（含思考）"
            >
              <StateIconSwap
                active={copiedAll}
                activeIcon={<Check size={13} className="text-accent-success" />}
                inactiveIcon={<Copy size={13} />}
              />
              <span>全部</span>
            </button>
          </>
        )}
      </div>
      {showActions && hookBadgeEvents.length > 0 && (
        <div className="absolute right-0 top-1/2 flex -translate-y-1/2 items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            className="kimix-muted-action flex h-8 items-center rounded-md text-text-muted"
            style={{ gap: 5, paddingLeft: 9, paddingRight: 9, ...STATUS_CARD_TEXT_STYLE }}
            title={hookBadgeEvents.map((hook) => `${hook.eventName} ${hook.phase === "resolved" ? hook.action ?? "allow" : "运行"}${hook.reason ? `：${hook.reason}` : ""}`).join("\n")}
            aria-label="Hook 命中"
          >
            <Webhook size={13} />
            <span>钩子 {hookBadgeEvents.length}</span>
          </button>
        </div>
      )}
      {hasVisibleStatuses ? (
        <div className="flex min-w-0 max-w-full items-center justify-center" style={{ gap: 8, paddingLeft: 86, paddingRight: 86 }}>
          {visibleStatuses.map((status) => (
            <StatusCard key={status.id} event={status} inline allowModelOnly />
          ))}
        </div>
      ) : (
        <div className="flex min-w-0 max-w-full items-center justify-center" style={{ paddingLeft: 86, paddingRight: 86 }}>
          <div
            className="inline-flex max-w-full items-center rounded-full bg-surface-hover text-[13px] leading-[18px] text-text-muted"
            style={{ paddingLeft: 13, paddingRight: 13, paddingTop: 5, paddingBottom: 5 }}
          >
            <span className="kimix-tabular-nums truncate">{fallbackLabel}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function assistantFooterFallbackLabel(event: Extract<TimelineEvent, { type: "assistant_message" }>, isActiveAssistant: boolean): string {
  if (isActiveAssistant) return "消息处理中";
  if (event.roomAgentId) {
    if (!event.isComplete) return "消息处理中";
    const model = compactModelDisplayName(event.model);
    return model ? `模型：${model}` : "已完成";
  }
  const duration = reliableAssistantDurationMs(event.durationMs);
  if (duration !== undefined) return `已完成 · 用时 ${formatAssistantTurnDuration(duration)}`;
  return event.isComplete ? "已完成" : "消息处理中";
}

type AssistantProcessBlockProps = {
  event: AssistantEvent;
  sessionId?: string;
  roomAgentDisplayName?: string;
  tools: ToolEvent[];
  subagents: SubagentEvent[];
  approvals: ApprovalEvent[];
  displayMode: ProcessDisplayMode;
  expandByDefault: boolean;
  isActiveAssistant: boolean;
  hasFinalContent: boolean;
  isInterrupted: boolean;
  collapseWhileRunning: boolean;
  turnStartedAt?: number;
  activeStatusMessage?: string;
};

function assistantProcessBlockEqual(prev: AssistantProcessBlockProps, next: AssistantProcessBlockProps) {
  return prev.sessionId === next.sessionId &&
    prev.roomAgentDisplayName === next.roomAgentDisplayName &&
    prev.displayMode === next.displayMode &&
    prev.expandByDefault === next.expandByDefault &&
    prev.isActiveAssistant === next.isActiveAssistant &&
    prev.hasFinalContent === next.hasFinalContent &&
    prev.isInterrupted === next.isInterrupted &&
    prev.collapseWhileRunning === next.collapseWhileRunning &&
    prev.turnStartedAt === next.turnStartedAt &&
    prev.activeStatusMessage === next.activeStatusMessage &&
    (
      prev.event === next.event ||
      (
        prev.event.id === next.event.id &&
        prev.event.timestamp === next.event.timestamp &&
        prev.event.isThinking === next.event.isThinking &&
        prev.event.isComplete === next.event.isComplete &&
        prev.event.durationMs === next.event.durationMs &&
        prev.event.model === next.event.model &&
        prev.event.agentRole === next.event.agentRole &&
        prev.event.thinking === next.event.thinking &&
        prev.event.thinkingParts === next.event.thinkingParts
      )
    ) &&
    eventArrayMemoEqual(prev.tools, next.tools) &&
    eventArrayMemoEqual(prev.subagents, next.subagents) &&
    eventArrayMemoEqual(prev.approvals, next.approvals);
}

const AssistantProcessBlock = memo(function AssistantProcessBlock({
  event,
  sessionId,
  roomAgentDisplayName,
  tools,
  subagents,
  approvals,
  displayMode,
  expandByDefault,
  isActiveAssistant,
  hasFinalContent,
  isInterrupted,
  collapseWhileRunning,
  turnStartedAt,
  activeStatusMessage,
}: AssistantProcessBlockProps) {
  const hasActualThinking = Boolean(
    event.thinking?.trim() ||
    event.thinkingParts?.some((part) => part.text.trim().length > 0)
  );
  const elapsedStartAt = assistantTurnStartedAt({
    turnStartedAt,
    eventTimestamp: event.timestamp,
  });
  const activeProcessLabel = isActiveAssistant && subagents.some((subagent) => subagent.status === "queued" || subagent.status === "running" || subagent.status === "suspended")
    ? "子代理运行中"
    : isActiveAssistant && tools.some((tool) => tool.status === "running")
      ? "命令运行中"
      : isActiveAssistant && hasFinalContent
        ? "正在输出"
        : isActiveAssistant && !hasActualThinking
          ? activeStatusMessage?.trim().replace(/…$/u, "") || "等待首个模型事件"
          : undefined;
  const processLabel = (
    <span className="inline-flex min-w-0 items-center" style={{ gap: 6 }}>
      {roomAgentDisplayName && <span className="shrink-0 font-medium text-[var(--kimix-panel-text)]">{roomAgentDisplayName}</span>}
      {roomAgentDisplayName && <span className="shrink-0 text-[var(--kimix-panel-text-muted)]">·</span>}
      <AssistantProcessLabel event={event} isActiveAssistant={isActiveAssistant} isInterrupted={isInterrupted} activeProcessLabel={activeProcessLabel} elapsedStartAt={elapsedStartAt} />
    </span>
  );
  return (
    <AssistantProcessSummary
      event={event}
      sessionId={sessionId}
      tools={tools}
      subagents={subagents}
      approvals={approvals}
      displayMode={displayMode}
      expandByDefault={expandByDefault}
      isActiveAssistant={isActiveAssistant}
      hasFinalContent={hasFinalContent}
      collapseWhileRunning={collapseWhileRunning}
      label={processLabel}
    />
  );
}, assistantProcessBlockEqual);

type AssistantBodyBlockProps = {
  content: string;
  thinking?: string;
  thinkingParts?: AssistantEvent["thinkingParts"];
  timestamp: number;
  isActiveAssistant: boolean;
  isComplete: boolean;
  eagerMarkdown: boolean;
  changedFiles: string[];
  changeSummary?: Extract<TimelineEvent, { type: "change_summary" }>;
  trailingStatuses: Extract<TimelineEvent, { type: "status_update" }>[];
  hookBadgeEvents: Extract<TimelineEvent, { type: "hook" }>[];
  footerFallbackLabel: string;
};

function assistantBodyBlockEqual(prev: AssistantBodyBlockProps, next: AssistantBodyBlockProps) {
  return prev.content === next.content &&
    prev.thinking === next.thinking &&
    prev.thinkingParts === next.thinkingParts &&
    prev.timestamp === next.timestamp &&
    prev.isActiveAssistant === next.isActiveAssistant &&
    prev.isComplete === next.isComplete &&
    prev.eagerMarkdown === next.eagerMarkdown &&
    prev.footerFallbackLabel === next.footerFallbackLabel &&
    stringArrayMemoEqual(prev.changedFiles, next.changedFiles) &&
    eventArrayMemoEqual(prev.trailingStatuses, next.trailingStatuses) &&
    eventArrayMemoEqual(prev.hookBadgeEvents, next.hookBadgeEvents) &&
    (
      prev.changeSummary === next.changeSummary ||
      (!prev.changeSummary && !next.changeSummary) ||
      (Boolean(prev.changeSummary && next.changeSummary) && timelineEventMemoKey(prev.changeSummary as TimelineEvent) === timelineEventMemoKey(next.changeSummary as TimelineEvent))
    );
}

const AssistantBodyBlock = memo(function AssistantBodyBlock({
  content,
  thinking,
  thinkingParts,
  timestamp,
  isActiveAssistant,
  isComplete,
  eagerMarkdown,
  changedFiles,
  changeSummary,
  trailingStatuses,
  hookBadgeEvents,
  footerFallbackLabel,
}: AssistantBodyBlockProps) {
  const { copied, trigger } = useCopyTimeout();
  const { copied: copiedAll, trigger: triggerAll } = useCopyTimeout();
  const hasContent = content.trim().length > 0;
  const changedFilesSignature = changedFiles.join("\u001f");
  const mdArtifacts = useMemo(() => {
    if (!isComplete) return [];
    const changedSet = new Set(changedFiles.map((filePath) => normalizePathForComparison(filePath)));
    return Array.from(new Set(
      content.match(/(?:[\w.-]+\/)*[\w.-]+\.md\b/gi) ?? []
    )).filter((filePath) => changedSet.has(normalizePathForComparison(filePath))).slice(0, 3);
  }, [changedFilesSignature, content, isComplete]);
  const fullCopyText = useMemo(
    () => buildAssistantFullCopyText({ content, thinking, thinkingParts, timestamp } as AssistantEvent),
    [content, thinking, thinkingParts, timestamp],
  );
  const shouldShowBodyFooter = hasContent || changeSummary || trailingStatuses.length > 0 || isComplete || isActiveAssistant;
  if (!shouldShowBodyFooter) return null;
  return (
    <div className="flex flex-col" style={{ gap: 15, paddingLeft: MESSAGE_SIDE_INDENT, paddingRight: MESSAGE_SIDE_INDENT }}>
      {hasContent && (
        <>
          <div className="relative w-full text-[15px] leading-[1.68] text-[var(--kimix-panel-text)]">
            <MarkdownRenderer
              content={content}
              streaming={isActiveAssistant}
              normalizeAssistantProgress
              deferOffscreen={!eagerMarkdown && !isActiveAssistant && isComplete && content.length > 1200}
            />
          </div>
          {mdArtifacts.length > 0 && (
            <div className="flex flex-col" style={{ gap: 12 }}>
              {mdArtifacts.map((filePath) => (
                <FileCard key={filePath} filePath={filePath} fileType="文档 · MD" />
              ))}
            </div>
          )}
        </>
      )}
      {changeSummary && <ChangeCard event={changeSummary} />}
      <AssistantMessageFooter
        statuses={trailingStatuses}
        fallbackLabel={footerFallbackLabel}
        onCopy={() => void trigger(content)}
        onCopyAll={() => void triggerAll(fullCopyText || content)}
        copied={copied}
        copiedAll={copiedAll}
        hookBadgeEvents={hookBadgeEvents}
        showActions={hasContent}
      />
    </div>
  );
}, assistantBodyBlockEqual);

function AssistantMessageBubble({ event, sessionId, turnStartedAt, isAssistantActive, leadingTools = [], leadingSubagents = [], leadingHooks = [], leadingApprovals = [], attachedSteers = [], activeStatus, changedFiles = [], changeSummary, trailingStatuses = [], hideProcessSummary = false, expandProcessByDefault = false, eagerMarkdown = false }: { event: Extract<TimelineEvent, { type: "assistant_message" }>; sessionId?: string; turnStartedAt?: number; isAssistantActive?: boolean; leadingTools?: Extract<TimelineEvent, { type: "tool_call" }>[]; leadingSubagents?: Extract<TimelineEvent, { type: "subagent" }>[]; leadingHooks?: Extract<TimelineEvent, { type: "hook" }>[]; leadingApprovals?: Extract<TimelineEvent, { type: "approval_request" }>[]; attachedSteers?: Extract<TimelineEvent, { type: "steer_message" }>[]; activeStatus?: Extract<TimelineEvent, { type: "status_update" }>; changedFiles?: string[]; changeSummary?: Extract<TimelineEvent, { type: "change_summary" }>; trailingStatuses?: Extract<TimelineEvent, { type: "status_update" }>[]; hideProcessSummary?: boolean; expandProcessByDefault?: boolean; eagerMarkdown?: boolean }) {
  const processDisplayMode = useAppStore((s) => s.processDisplayMode);
  const collapseProcessWhileRunning = useAppStore((s) => s.collapseProcessWhileRunning);
  const roomAgentActivities = useAppStore((s) => s.roomAgentActivities);
  const roomSession = useSessionStore((state) => sessionId ? state.sessions.find((session) => session.id === sessionId) : undefined);
  const roomAgent = roomSession && event.roomAgentId ? getRoomAgent(roomSession, event.roomAgentId) : undefined;
  const roomDelivery = roomSession?.collaboration?.messages
    .find((message) => message.id === event.roomMessageId)
    ?.deliveries[event.roomAgentId ?? ""];
  const roomDeliveryStatus = event.roomDeliveryStatus ?? roomDelivery?.status;
  const isWaitingBehindAgentWork = Boolean(
    roomSession && event.roomAgentId && event.roomMessageId &&
    isRoomDeliveryWaitingBehindAgentWork(
      roomSession,
      event.roomMessageId,
      event.roomAgentId,
      Object.values(roomAgentActivities),
    )
  );
  const isActiveAssistant = Boolean(isAssistantActive);
  const draftKey = (
    isActiveTurnDraftEnabled() &&
    isActiveAssistant &&
    !event.isComplete &&
    sessionId &&
    event.agentTurnId
  ) ? makeActiveTurnDraftKey(sessionId, event.roomAgentId, event.agentTurnId) : null;
  const activeDraft = useActiveTurnDraft(draftKey);
  const displayContent = pickDraftText(activeDraft?.content, event.content);
  const displayThinking = pickDraftText(activeDraft?.thinking, event.thinking);
  const displayThinkingParts = (
    activeDraft?.thinkingParts &&
    (activeDraft.thinkingParts?.length ?? 0) >= (event.thinkingParts?.length ?? 0)
  ) ? activeDraft.thinkingParts : event.thinkingParts;
  const processEvent = useMemo(() => {
    if (
      displayThinking === (event.thinking ?? "") &&
      displayThinkingParts === event.thinkingParts
    ) {
      return event;
    }
    return {
      ...event,
      thinking: displayThinking || undefined,
      thinkingParts: displayThinkingParts,
    };
  }, [event, displayThinking, displayThinkingParts]);
  const hasContent = displayContent.trim().length > 0;
  const hookBadgeEvents = getHookBadgeEvents(leadingHooks);
  const isInterrupted = event.isComplete && trailingStatuses.some(isInterruptedStatus);
  const shouldShowBodyFooter = hasContent || changeSummary || trailingStatuses.length > 0 || event.isComplete || isActiveAssistant;
  const footerFallbackLabel = isInterrupted
    ? "输出打断"
    : assistantFooterFallbackLabel(event, isActiveAssistant);
  const processToBodyGap = processDisplayMode === "kimi-web" && !hideProcessSummary && shouldShowBodyFooter ? 12 : 20;

  if (roomDeliveryStatus === "queued" && isWaitingBehindAgentWork && event.roomAgentId && event.roomMessageId) {
    return (
      <div className="group flex justify-start" style={{ paddingLeft: MESSAGE_SIDE_INDENT, paddingRight: MESSAGE_SIDE_INDENT }}>
        <div
          className="kimix-soft-card grid w-full items-center rounded-xl text-[13px] text-[var(--kimix-panel-text-secondary)]"
          style={{ gridTemplateColumns: "30px minmax(0, 1fr) auto", gap: 10, minHeight: 50, padding: "9px 12px 9px 14px" }}
        >
          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-[var(--kimix-panel-bg)] text-[var(--kimix-panel-text-secondary)]">
            <Bot size={15} />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium text-[var(--kimix-panel-text)]">{roomAgent?.displayName ?? "Agent"}</span>
            <span className="block truncate text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]">等待该 Agent 当前任务结束后自动发送</span>
          </span>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("kimix:room-delivery-action", {
              detail: { action: "cancel", sessionId, roomMessageId: event.roomMessageId, roomAgentId: event.roomAgentId },
            }))}
            className="kimix-icon-text-button kimix-muted-action is-compact shrink-0"
            style={{ height: 32, paddingLeft: 12, paddingRight: 12 }}
          >
            取消排队
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex justify-start">
      <div className="w-full" style={{ display: "flex", flexDirection: "column", gap: processToBodyGap }}>
        {!hideProcessSummary && (
          <AssistantProcessBlock
            event={processEvent}
            sessionId={sessionId}
            roomAgentDisplayName={roomAgent?.displayName}
            tools={leadingTools}
            subagents={leadingSubagents}
            approvals={leadingApprovals}
            displayMode={processDisplayMode}
            expandByDefault={expandProcessByDefault}
            isActiveAssistant={isActiveAssistant}
            hasFinalContent={hasContent}
            isInterrupted={Boolean(isInterrupted)}
            collapseWhileRunning={collapseProcessWhileRunning}
            turnStartedAt={turnStartedAt}
            activeStatusMessage={activeStatus?.message}
          />
        )}

        {attachedSteers.length > 0 && (
          <div className="flex flex-col" style={{ gap: 10, paddingRight: MESSAGE_SIDE_INDENT }}>
            {attachedSteers.map((steer) => <SteerMessageBubble key={steer.id} event={steer} embedded />)}
          </div>
        )}

        {shouldShowBodyFooter && (
          <AssistantBodyBlock
            content={displayContent}
            thinking={displayThinking || undefined}
            thinkingParts={displayThinkingParts}
            timestamp={event.timestamp}
            isActiveAssistant={isActiveAssistant}
            isComplete={event.isComplete}
            eagerMarkdown={eagerMarkdown}
            changedFiles={changedFiles}
            changeSummary={changeSummary}
            trailingStatuses={trailingStatuses}
            hookBadgeEvents={hookBadgeEvents}
            footerFallbackLabel={footerFallbackLabel}
          />
        )}
      </div>
    </div>
  );
}

export const MessageBubble = memo(function MessageBubble({ event, sessionId, turnStartedAt, isAssistantActive, leadingTools, leadingSubagents, leadingHooks, leadingApprovals, attachedSteers, activeStatus, changedFiles, changeSummary, trailingStatuses, hideProcessSummary, expandProcessByDefault, eagerMarkdown, onDeleteUserMessage }: MessageBubbleProps) {
  if (event.type === "user_message") {
    return <UserMessageBubble event={event} onDelete={onDeleteUserMessage} />;
  }
  if (event.type === "steer_message") {
    return <SteerMessageBubble event={event} />;
  }
  return <AssistantMessageBubble event={event} sessionId={sessionId} turnStartedAt={turnStartedAt} isAssistantActive={isAssistantActive} leadingTools={leadingTools} leadingSubagents={leadingSubagents} leadingHooks={leadingHooks} leadingApprovals={leadingApprovals} attachedSteers={attachedSteers} activeStatus={activeStatus} changedFiles={changedFiles} changeSummary={changeSummary} trailingStatuses={trailingStatuses} hideProcessSummary={hideProcessSummary} expandProcessByDefault={expandProcessByDefault} eagerMarkdown={eagerMarkdown} />;
}, messageBubblePropsEqual);
