import { memo, useState, useRef, useEffect, useLayoutEffect, useMemo, type ReactNode } from "react";
import { Bot, Brain, ChevronDown, ChevronRight, ChevronUp, Copy, Check, Loader2, RotateCcw, ShieldCheck, SquareTerminal, Webhook, FileText } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { TimelineEvent, UserMessageImage } from "@/types/ui";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { restoreAssistantProgressParagraphs } from "@/utils/assistantParagraphs";
import { FileCard } from "./FileCard";
import { StatusCard } from "./StatusCard";
import { ChangeCard } from "./ChangeCard";
import { getRuntimeSessionId } from "@/utils/runtimeSession";
import { ImagePreviewOverlay, type PreviewImage } from "./ImagePreviewOverlay";
import { reliableAssistantDurationMs } from "@/utils/duration";
import { hasActiveTimelineWorkEvents } from "@/utils/sessionActivity";
import { formatToolArgumentsForDisplay, formatToolResultForDisplay, toolArgumentPreview } from "@/utils/toolDisplay";
import { activeProcessPhaseStartedAt } from "@/utils/processTiming";

interface MessageBubbleProps {
  event: Extract<TimelineEvent, { type: "user_message" | "steer_message" | "assistant_message" }>;
  sessionId?: string;
  runtimeSessionId?: string;
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
}

function timelineEventMemoKey(event: TimelineEvent) {
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
  return timelineEventMemoKey(prev.event) === timelineEventMemoKey(next.event) &&
    prev.sessionId === next.sessionId &&
    prev.runtimeSessionId === next.runtimeSessionId &&
    prev.hideProcessSummary === next.hideProcessSummary &&
    eventArrayMemoEqual(prev.leadingTools, next.leadingTools) &&
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

function formatDuration(ms: number): string {
  const seconds = ms > 0 ? Math.max(1, Math.round(ms / 1000)) : 0;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function useElapsed(start: number, active: boolean) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [active, start]);

  return Math.max(0, now - start);
}

function isInterruptedStatus(event: Extract<TimelineEvent, { type: "status_update" }>) {
  return Boolean(event.message && /中断|打断|cancelled|canceled|interrupted/i.test(event.message));
}

function buildAssistantFullCopyText(event: Extract<TimelineEvent, { type: "assistant_message" }>) {
  const thinkingText = getThinkingBlocks(event).map((block) => block.text.trim()).filter(Boolean).join("\n\n");
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

function promptImages(images: UserMessageImage[] = []) {
  return images
    .filter((image): image is UserMessageImage & { dataUrl: string } => Boolean(image.dataUrl))
    .map((image) => ({ name: image.name, dataUrl: image.dataUrl }));
}

function contentWithFileAttachments(content: string, images: UserMessageImage[] = []) {
  const files = images.filter((image) => image.kind === "file" || Boolean(image.filePath));
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
    return (
      <button
        key={image.id ?? `${image.name}-${index}`}
        type="button"
        onClick={() => onPreview({ id: image.id, name: image.name, dataUrl: image.dataUrl })}
        className="kimix-media-thumb h-24 w-24 overflow-hidden rounded-[var(--radius-md)] transition-colors"
        title="点击查看图片"
        aria-label={`查看图片 ${image.name}`}
      >
        <img src={image.dataUrl} alt={image.name} className="h-full w-full object-cover" />
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

const UserMessageBubble = memo(function UserMessageBubble({ event }: { event: Extract<TimelineEvent, { type: "user_message" }> }) {
  const { copied, trigger } = useCopyTimeout();
  const [previewImage, setPreviewImage] = useState<PreviewImage | null>(null);
  const { currentSessionId, runningSessionId, isLatestUserMessage, isLongTaskMessage } = useAppStore(useShallow((s) => {
    const currentSession = s.currentSession;
    return {
      currentSessionId: currentSession?.id ?? null,
      runningSessionId: s.runningSessionId,
      isLatestUserMessage: Boolean(currentSession && currentSession.events.findLast((e) => e.type === "user_message")?.id === event.id),
      isLongTaskMessage: Boolean(currentSession?.longTask),
    };
  }));
  const images = event.images ?? [];
  const hasText = event.content.trim().length > 0;
  const copyText = hasText ? [event.content, attachmentCopyText(images)].filter(Boolean).join("\n\n") : attachmentCopyText(images);

  const handleResend = async () => {
    const appState = useAppStore.getState();
    const activeSession = appState.currentSession
      ? useSessionStore.getState().sessions.find((session) => session.id === appState.currentSession?.id) ?? appState.currentSession
      : null;
    if (!activeSession || appState.runningSessionId === activeSession.id) return;
    const responsePlaceholder: TimelineEvent = {
      id: Math.random().toString(36).substring(2, 11),
      type: "assistant_message",
      timestamp: Date.now(),
      content: "",
      isThinking: appState.defaultThinking,
      isComplete: false,
    };
    useSessionStore.getState().updateSession(activeSession.id, (session) => ({
      ...session,
      events: [...session.events, responsePlaceholder],
      updatedAt: Date.now(),
    }));
    appState.setRunningSessionId(activeSession.id);
    const runtimeSessionId = getRuntimeSessionId(activeSession);
    if (!runtimeSessionId) {
      appState.setRunningSessionId(null);
      return;
    }
    try {
      const res = await window.api.sendPrompt({
        sessionId: runtimeSessionId,
        content: contentWithFileAttachments(event.content, images),
        images: promptImages(images),
        thinking: appState.defaultThinking,
        yoloMode: appState.permissionMode === "yolo",
        autoMode: appState.permissionMode === "auto",
        planMode: appState.defaultPlanMode,
      });
      if (!res.success) throw new Error(res.error);
    } catch (err) {
      console.error("Resend failed:", err);
      appState.setRunningSessionId(null);
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
        <div className="mt-2.5 flex justify-end opacity-0 transition-opacity group-hover:opacity-100" style={{ gap: 10 }}>
          <button
            onClick={() => trigger(copyText)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover"
            title="复制"
            aria-label="复制"
          >
            {copied ? <Check size={13} className="text-accent-success" /> : <Copy size={13} />}
          </button>
          <button
            onClick={handleResend}
            disabled={currentSessionId ? runningSessionId === currentSessionId || (isLongTaskMessage && !isLatestUserMessage) : false}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover disabled:opacity-30"
            title="重新发送"
            aria-label="重新发送"
          >
            <RotateCcw size={13} />
          </button>
        </div>
      </div>
      {previewImage?.dataUrl && (
        <ImagePreviewOverlay
          image={previewImage}
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

type ThinkingBlock = {
  id: string;
  timestamp: number;
  text: string;
};

type ProcessItem =
  | { type: "thinking"; block: ThinkingBlock }
  | { type: "tool"; tool: ToolEvent }
  | { type: "subagent"; subagent: SubagentEvent }
  | { type: "approval"; approval: ApprovalEvent };

function firstThinkingSentence(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = normalized.match(/^(.{1,160}?[。！？?!])(?:\s|$)/);
  const first = match?.[1] ?? normalized.slice(0, 120);
  return normalized.length > first.length ? `${first}...` : first || "思考内容";
}

function normalizeThinkingMarkdown(text: string) {
  return text
    .replace(/([^\n])(\d+\.[^\d\s])/g, "$1\n$2")
    .replace(/([^\n])(\d+\.\s)/g, "$1\n$2");
}

function describeTool(tool: ToolEvent) {
  return toolArgumentPreview(tool) || tool.toolName || "工具调用";
}

function splitLegacyThinking(text: string, timestamp: number): ThinkingBlock[] {
  if (isKimixSyntheticThinking(text)) return [];
  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const source = paragraphs.length > 1 ? paragraphs : text.match(/[^。！？?!]+[。！？?!]?/g)?.map((part) => part.trim()).filter(Boolean) ?? [text.trim()];
  const blocks: ThinkingBlock[] = [];
  let buffer = "";
  source.forEach((part) => {
    const next = buffer ? `${buffer}\n\n${part}` : part;
    if (next.length < 520) {
      buffer = next;
      return;
    }
    if (buffer) blocks.push({ id: `thinking-${timestamp}-${blocks.length}`, timestamp: timestamp + blocks.length, text: buffer });
    buffer = part;
  });
  if (buffer) blocks.push({ id: `thinking-${timestamp}-${blocks.length}`, timestamp: timestamp + blocks.length, text: buffer });
  return blocks;
}

function findThinkingSplitIndex(text: string, minIndex: number) {
  const candidates = [
    ...Array.from(text.matchAll(/[。！？?!]\s+/g)).map((match) => (match.index ?? -1) + match[0].length),
    ...Array.from(text.matchAll(/\n\s*\n+/g)).map((match) => (match.index ?? -1) + match[0].length),
    ...Array.from(text.matchAll(/\n\s*[-*•]\s+/g)).map((match) => match.index ?? -1),
  ].filter((index) => index >= minIndex);
  return candidates.length > 0 ? Math.max(...candidates) : -1;
}

function getThinkingBlocks(event: AssistantEvent): ThinkingBlock[] {
  const parts = event.thinkingParts?.filter((part) => {
    const text = part.text.trim();
    return text && !isKimixSyntheticThinking(text);
  }) ?? [];
  if (parts.length === 0) return event.thinking && !isKimixSyntheticThinking(event.thinking) ? splitLegacyThinking(event.thinking, event.timestamp) : [];

  const blocks: ThinkingBlock[] = [];
  let current = "";
  let currentTimestamp = parts[0]?.timestamp ?? event.timestamp;
  parts.forEach((part) => {
    if (!current) currentTimestamp = part.timestamp;
    current += part.text;
    if (current.length > 120 && /[。！？?!]\s*$/.test(current)) {
      blocks.push({ id: `thinking-${part.id}`, timestamp: currentTimestamp, text: current.trim() });
      current = "";
      return;
    }
    if (current.length > 900) {
      const splitIndex = findThinkingSplitIndex(current, 520);
      if (splitIndex > 0) {
        const head = current.slice(0, splitIndex).trim();
        const tail = current.slice(splitIndex);
        if (head) blocks.push({ id: `thinking-${part.id}`, timestamp: currentTimestamp, text: head });
        current = tail;
        currentTimestamp = part.timestamp;
      }
    }
  });
  if (current.trim()) {
    blocks.push({ id: `thinking-tail-${blocks.length}`, timestamp: currentTimestamp, text: current.trim() });
  }
  return blocks;
}

function isKimixSyntheticThinking(text: string) {
  const trimmed = text.trim();
  return trimmed.startsWith("【实时状态】") ||
    trimmed.includes("当前 prompt-mode 尚未实时写出思考正文") ||
    trimmed.includes("Kimix 会继续回放");
}

function ThinkingProcessItem({ block }: { block: ThinkingBlock }) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = block.text.trim().length > 0;
  return (
    <div className="kimix-soft-card overflow-hidden rounded-xl">
      <button
        type="button"
        onClick={() => canExpand && setExpanded((value) => !value)}
        disabled={!canExpand}
        className="grid w-full grid-cols-[18px_minmax(0,1fr)_18px] items-center text-left text-[14px] text-[var(--kimix-process-text)] transition-colors hover:bg-[var(--kimix-panel-hover)] disabled:cursor-default disabled:hover:bg-transparent"
        style={{ minHeight: 42, gap: 9, paddingLeft: 14, paddingRight: 14, paddingTop: 3, paddingBottom: 3 }}
      >
        <span className="flex h-5 w-[18px] shrink-0 items-center justify-center text-[var(--kimix-process-muted)]">
          <Brain size={15} />
        </span>
        <span className="min-w-0 flex-1 truncate leading-5">{firstThinkingSentence(block.text)}</span>
        {canExpand && (
          <span className="flex h-5 w-[18px] shrink-0 items-center justify-center text-[var(--kimix-process-muted)]">
            {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </span>
        )}
      </button>
      {expanded && (
        <div className="kimix-soft-card-strong mt-1 min-w-0 rounded-lg text-[13.5px] leading-7" style={{ padding: "14px 16px" }}>
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
  return (
    <div className="kimix-soft-card overflow-hidden rounded-xl text-[13.5px]">
      <button
        type="button"
        onClick={() => canExpand && setExpanded((value) => !value)}
        disabled={!canExpand}
        className="grid w-full grid-cols-[18px_auto_minmax(0,1fr)_auto_18px_18px] items-center text-left transition-colors hover:bg-[var(--kimix-panel-hover)] disabled:cursor-default disabled:hover:bg-transparent"
        style={{ minHeight: 42, gap: 9, paddingLeft: 14, paddingRight: 14, paddingTop: 3, paddingBottom: 3 }}
      >
        <span className="flex h-5 w-[18px] items-center justify-center text-[var(--kimix-process-muted)]">
          <SquareTerminal size={14} />
        </span>
        <span className="shrink-0 leading-5 text-[var(--kimix-panel-text-secondary)]">{tool.status === "running" ? "正在运行" : tool.status === "error" ? "命令失败" : "已完成"}</span>
        <span className="min-w-0 flex-1 truncate leading-5">{describeTool(tool)}</span>
        <span className="w-8 shrink-0 text-right leading-5 text-[var(--kimix-panel-text-muted)]">{tool.durationMs !== undefined ? `${Math.max(0, Math.round(tool.durationMs / 1000))}s` : ""}</span>
        <span className="flex h-5 w-[18px] shrink-0 items-center justify-center">
          <span className={`h-1.5 w-1.5 rounded-full ${tool.status === "error" ? "bg-accent-danger" : tool.status === "running" ? "bg-accent-warning" : "bg-accent-success"}`} />
        </span>
        <span className="flex h-5 w-[18px] shrink-0 items-center justify-center text-[var(--kimix-process-muted)]">
          {canExpand ? (expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />) : null}
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
  return (
    <div className="kimix-soft-card overflow-hidden rounded-xl text-[13.5px]">
      <button
        type="button"
        onClick={() => canExpand && setExpanded((value) => !value)}
        disabled={!canExpand}
        className="grid w-full grid-cols-[18px_auto_minmax(0,1fr)_auto_18px] items-center text-left transition-colors hover:bg-[var(--kimix-panel-hover)] disabled:cursor-default disabled:hover:bg-transparent"
        style={{ minHeight: 42, gap: 9, paddingLeft: 14, paddingRight: 14, paddingTop: 3, paddingBottom: 3 }}
      >
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
      </button>
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
        className="grid w-full items-center text-left transition-colors hover:bg-[var(--kimix-panel-hover)]"
        style={{ minHeight: 42, gridTemplateColumns: "18px auto minmax(0, 1fr) minmax(52px, auto) 18px 18px", columnGap: 9, paddingLeft: 14, paddingRight: 14, paddingTop: 3, paddingBottom: 3 }}
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
    ? (completedDuration !== undefined ? formatDuration(completedDuration) : "")
    : isActiveAssistant && elapsed >= 1000
      ? formatDuration(elapsed)
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

function AssistantProcessSummary({ event, tools, subagents, approvals, label }: { event: AssistantEvent; tools: ToolEvent[]; subagents: SubagentEvent[]; approvals: ApprovalEvent[]; label: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const contentAnchorRef = useRef<HTMLSpanElement>(null);
  const pendingCollapseAnchorRef = useRef<{ scrollNode: HTMLElement; viewportTop: number } | null>(null);
  const thinkingBlocks = useMemo(() => getThinkingBlocks(event), [event.thinking, event.thinkingParts, event.timestamp]);
  const items: ProcessItem[] = useMemo(() => [
    ...thinkingBlocks.map((block): ProcessItem => ({ type: "thinking", block })),
    ...tools.map((tool): ProcessItem => ({ type: "tool", tool })),
    ...subagents.map((subagent): ProcessItem => ({ type: "subagent", subagent })),
    ...approvals.map((approval): ProcessItem => ({ type: "approval", approval })),
  ].sort((a, b) => processItemTimestamp(a) - processItemTimestamp(b)), [thinkingBlocks, tools, subagents, approvals]);
  const hasDetails = items.length > 0;
  const detailUnit = event.agentRole ? "内容" : "思考";
  const summary = useMemo(() => joinSummaryParts([
    thinkingBlocks.length > 0 ? `${thinkingBlocks.length} 段${detailUnit}` : "",
    tools.length > 0 ? `${tools.length} 条命令` : "",
    subagents.length > 0 ? `${subagents.length} 个子代理` : "",
    approvals.length > 0 ? `${approvals.length} 个工具请求` : "",
  ]), [approvals.length, detailUnit, subagents.length, thinkingBlocks.length, tools.length]);

  const collapseWithStableAnchor = () => {
    const anchor = contentAnchorRef.current;
    const scrollNode = anchor?.closest<HTMLElement>(".kimix-chat-scroll-area");
    if (anchor && scrollNode) {
      pendingCollapseAnchorRef.current = {
        scrollNode,
        viewportTop: anchor.getBoundingClientRect().top,
      };
      window.dispatchEvent(new CustomEvent("kimix:intentional-chat-resize"));
    }
    setExpanded(false);
  };

  useLayoutEffect(() => {
    if (expanded) return;
    const pending = pendingCollapseAnchorRef.current;
    const anchor = contentAnchorRef.current;
    if (!pending || !anchor) return;

    const restoreAnchor = () => {
      if (!anchor.isConnected || !pending.scrollNode.isConnected) return;
      const delta = anchor.getBoundingClientRect().top - pending.viewportTop;
      if (Math.abs(delta) > 0.5) pending.scrollNode.scrollTop += delta;
    };

    restoreAnchor();
    const frame = window.requestAnimationFrame(() => {
      restoreAnchor();
      pendingCollapseAnchorRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expanded]);

  return (
    <div className="w-full border-b border-[var(--kimix-panel-divider)]" style={{ paddingBottom: expanded && hasDetails ? 8 : 12 }}>
      <button
        type="button"
        onClick={() => {
          if (!hasDetails) return;
          if (expanded) collapseWithStableAnchor();
          else setExpanded(true);
        }}
        disabled={!hasDetails}
        className="flex h-8 max-w-full items-center rounded-lg text-[15px] leading-none text-[var(--kimix-panel-text-secondary)] transition-colors hover:bg-[var(--kimix-panel-hover)] hover:text-[var(--kimix-panel-text-secondary)] disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-[var(--kimix-panel-text-secondary)]"
        style={{ gap: 8, paddingLeft: 4, paddingRight: 12 }}
      >
        {hasDetails ? (expanded ? <ChevronDown size={15} className="shrink-0" /> : <ChevronRight size={15} className="shrink-0" />) : <span className="w-[15px]" />}
        <span className="shrink-0">{label}</span>
        {hasDetails && (
          <span className="min-w-0 truncate text-[13px] text-[var(--kimix-panel-text-muted)]">
            {summary}
          </span>
        )}
      </button>
      {expanded && hasDetails && (
        <div className="kimix-soft-card mt-3 flex flex-col rounded-xl" style={{ gap: 12, padding: "14px 14px" }}>
          <ProcessDetailList items={items} />
          <button
            type="button"
            onClick={collapseWithStableAnchor}
            className="kimix-icon-text-button kimix-muted-action is-compact self-end"
            style={{ marginTop: 2, paddingLeft: 12, paddingRight: 12 }}
          >
            <ChevronUp size={14} />
            <span>收起本轮内容</span>
          </button>
        </div>
      )}
      <span ref={contentAnchorRef} aria-hidden="true" className="block h-0" />
    </div>
  );
}

function AssistantMessageFooter({
  statuses,
  onCopy,
  onCopyAll,
  copied,
  copiedAll,
  hookBadgeEvents,
  showActions,
}: {
  statuses: Extract<TimelineEvent, { type: "status_update" }>[];
  onCopy: () => void;
  onCopyAll: () => void;
  copied: boolean;
  copiedAll: boolean;
  hookBadgeEvents: Extract<TimelineEvent, { type: "hook" }>[];
  showActions: boolean;
}) {
  return (
    <div
      className="relative flex min-h-[28px] min-w-0 items-center justify-center"
      style={{
        marginTop: 3,
      }}
    >
      <div
        className="absolute left-0 top-1/2 flex -translate-y-1/2 items-center opacity-0 transition-opacity group-hover:opacity-100"
        style={{ gap: 4 }}
      >
        {showActions && (
          <>
            <button
              onClick={onCopy}
              className="rounded-md p-1 text-text-muted transition-colors hover:bg-bg-hover"
              title="复制"
              aria-label="复制"
            >
              {copied ? <Check size={13} className="text-accent-success" /> : <Copy size={13} />}
            </button>
            <button
              onClick={onCopyAll}
              className="flex h-6 items-center rounded-md text-[12px] text-text-muted transition-colors hover:bg-bg-hover"
              style={{ gap: 4, paddingLeft: 7, paddingRight: 7 }}
              title="全部复制（含思考）"
              aria-label="全部复制（含思考）"
            >
              {copiedAll ? <Check size={13} className="text-accent-success" /> : <Copy size={13} />}
              <span>全部</span>
            </button>
          </>
        )}
        {showActions && hookBadgeEvents.length > 0 && (
          <button
            type="button"
            className="flex h-6 items-center rounded-md text-[12px] text-text-muted transition-colors hover:bg-bg-hover"
            style={{ gap: 4, paddingLeft: 7, paddingRight: 7 }}
            title={hookBadgeEvents.map((hook) => `${hook.eventName} ${hook.phase === "resolved" ? hook.action ?? "allow" : "运行"}${hook.reason ? `：${hook.reason}` : ""}`).join("\n")}
            aria-label="Hook 命中"
          >
            <Webhook size={13} />
            <span>钩子 {hookBadgeEvents.length}</span>
          </button>
        )}
      </div>
      {statuses.length > 0 ? (
        <div className="flex min-w-0 max-w-full items-center justify-center" style={{ gap: 8, paddingLeft: 86, paddingRight: 86 }}>
          {statuses.map((status) => (
            <StatusCard key={status.id} event={status} inline />
          ))}
        </div>
      ) : (
        <span className="min-w-0" />
      )}
    </div>
  );
}

function AssistantMessageBubble({ event, sessionId, runtimeSessionId, leadingTools = [], leadingSubagents = [], leadingHooks = [], leadingApprovals = [], attachedSteers = [], activeStatus, changedFiles = [], changeSummary, trailingStatuses = [], hideProcessSummary = false }: { event: Extract<TimelineEvent, { type: "assistant_message" }>; sessionId?: string; runtimeSessionId?: string; leadingTools?: Extract<TimelineEvent, { type: "tool_call" }>[]; leadingSubagents?: Extract<TimelineEvent, { type: "subagent" }>[]; leadingHooks?: Extract<TimelineEvent, { type: "hook" }>[]; leadingApprovals?: Extract<TimelineEvent, { type: "approval_request" }>[]; attachedSteers?: Extract<TimelineEvent, { type: "steer_message" }>[]; activeStatus?: Extract<TimelineEvent, { type: "status_update" }>; changedFiles?: string[]; changeSummary?: Extract<TimelineEvent, { type: "change_summary" }>; trailingStatuses?: Extract<TimelineEvent, { type: "status_update" }>[]; hideProcessSummary?: boolean }) {
  const { copied, trigger } = useCopyTimeout();
  const { copied: copiedAll, trigger: triggerAll } = useCopyTimeout();
  const runningSessionId = useAppStore((s) => s.runningSessionId);
  const displayContent = restoreAssistantProgressParagraphs(event.content);
  const hasContent = displayContent.trim().length > 0;
  const changedSet = new Set(changedFiles.map((f) => f.toLowerCase()));
  const mdArtifacts = Array.from(new Set(
    displayContent.match(/(?:[\w.-]+\/)*[\w.-]+\.md\b/gi) ?? []
  )).filter((path) => changedSet.has(path.toLowerCase())).slice(0, 3);
  const isRunningThisSession = Boolean(sessionId && (
    runningSessionId === sessionId ||
    Boolean(runtimeSessionId && runningSessionId === runtimeSessionId)
  ));
  const hasRunningProcess = leadingTools.some((tool) => tool.status === "running") ||
    leadingSubagents.some((subagent) => subagent.status === "queued" || subagent.status === "running" || subagent.status === "suspended");
  const hasRecentTimelineActivity = hasActiveTimelineWorkEvents([event, ...leadingTools, ...leadingSubagents]);
  const isActiveAssistant = Boolean((isRunningThisSession || hasRecentTimelineActivity) && (!event.isComplete || hasRunningProcess));
  const hasActualThinking = Boolean(
    event.thinking?.trim() ||
    event.thinkingParts?.some((part) => part.text.trim().length > 0)
  );
  const elapsedStartAt = activeProcessPhaseStartedAt({
    eventTimestamp: event.timestamp,
    statusTimestamp: activeStatus?.timestamp,
    thinkingTimestamps: event.thinkingParts?.filter((part) => part.text.trim()).map((part) => part.timestamp),
    runningToolTimestamps: leadingTools.filter((tool) => tool.status === "running").map((tool) => tool.timestamp),
    runningSubagentTimestamps: leadingSubagents
      .filter((subagent) => subagent.status === "queued" || subagent.status === "running" || subagent.status === "suspended")
      .map((subagent) => subagent.timestamp),
    hasContent,
  });
  const activeProcessLabel = isActiveAssistant && leadingSubagents.some((subagent) => subagent.status === "queued" || subagent.status === "running" || subagent.status === "suspended")
    ? "子代理运行中"
    : isActiveAssistant && leadingTools.some((tool) => tool.status === "running")
      ? "命令运行中"
      : isActiveAssistant && hasContent
        ? "正在输出"
        : isActiveAssistant && !hasActualThinking
          ? activeStatus?.message?.trim().replace(/…$/u, "") || "等待首个模型事件"
          : undefined;
  const hookBadgeEvents = getHookBadgeEvents(leadingHooks);
  const isInterrupted = event.isComplete && trailingStatuses.some(isInterruptedStatus);
  const fullCopyText = useMemo(() => buildAssistantFullCopyText(event), [event.content, event.thinking, event.thinkingParts, event.timestamp]);

  return (
    <div className="group flex justify-start">
      <div className="w-full" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {!hideProcessSummary && (
          <AssistantProcessSummary
            event={event}
            tools={leadingTools}
            subagents={leadingSubagents}
            approvals={leadingApprovals}
            label={<AssistantProcessLabel event={event} isActiveAssistant={isActiveAssistant} isInterrupted={isInterrupted} activeProcessLabel={activeProcessLabel} elapsedStartAt={elapsedStartAt} />}
          />
        )}

        {attachedSteers.length > 0 && (
          <div className="flex flex-col" style={{ gap: 10, paddingRight: MESSAGE_SIDE_INDENT }}>
            {attachedSteers.map((steer) => <SteerMessageBubble key={steer.id} event={steer} embedded />)}
          </div>
        )}

        {(hasContent || changeSummary || trailingStatuses.length > 0) && (
          <div className="flex flex-col" style={{ gap: 15, paddingLeft: MESSAGE_SIDE_INDENT, paddingRight: MESSAGE_SIDE_INDENT }}>
            {hasContent && (
              <>
                <div className="relative w-full text-[15px] leading-[1.68] text-[var(--kimix-panel-text)]">
                  <MarkdownRenderer content={displayContent} deferOffscreen={!isActiveAssistant && event.isComplete && displayContent.length > 1200} />
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

            {(hasContent || changeSummary || trailingStatuses.length > 0) && (
              <AssistantMessageFooter
                statuses={trailingStatuses}
                onCopy={() => void trigger(event.content)}
                onCopyAll={() => void triggerAll(fullCopyText || event.content)}
                copied={copied}
                copiedAll={copiedAll}
                hookBadgeEvents={hookBadgeEvents}
                showActions={hasContent}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export const MessageBubble = memo(function MessageBubble({ event, sessionId, runtimeSessionId, leadingTools, leadingSubagents, leadingHooks, leadingApprovals, attachedSteers, activeStatus, changedFiles, changeSummary, trailingStatuses, hideProcessSummary }: MessageBubbleProps) {
  if (event.type === "user_message") {
    return <UserMessageBubble event={event} />;
  }
  if (event.type === "steer_message") {
    return <SteerMessageBubble event={event} />;
  }
  return <AssistantMessageBubble event={event} sessionId={sessionId} runtimeSessionId={runtimeSessionId} leadingTools={leadingTools} leadingSubagents={leadingSubagents} leadingHooks={leadingHooks} leadingApprovals={leadingApprovals} attachedSteers={attachedSteers} activeStatus={activeStatus} changedFiles={changedFiles} changeSummary={changeSummary} trailingStatuses={trailingStatuses} hideProcessSummary={hideProcessSummary} />;
}, messageBubblePropsEqual);
