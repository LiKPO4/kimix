import { useState, useRef, useEffect } from "react";
import { Bot, Brain, Cable, ChevronDown, ChevronRight, ChevronUp, Copy, Check, Loader2, RotateCcw, Image as ImageIcon, X, SquareTerminal } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { TimelineEvent } from "@/types/ui";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { FileCard } from "./FileCard";
import { StatusCard } from "./StatusCard";
import { getRuntimeSessionId } from "@/utils/runtimeSession";
import { DrawingBoard, type DrawingBoardRequest } from "./DrawingBoard";

interface MessageBubbleProps {
  event: Extract<TimelineEvent, { type: "user_message" | "steer_message" | "assistant_message" }>;
  leadingTools?: Extract<TimelineEvent, { type: "tool_call" }>[];
  leadingSubagents?: Extract<TimelineEvent, { type: "subagent" }>[];
  leadingHooks?: Extract<TimelineEvent, { type: "hook" }>[];
  changedFiles?: string[];
  trailingStatuses?: Extract<TimelineEvent, { type: "status_update" }>[];
  hideProcessSummary?: boolean;
}

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
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function useElapsed(start: number, active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return Math.max(0, now - start);
}

function UserMessageBubble({ event }: { event: Extract<TimelineEvent, { type: "user_message" }> }) {
  const { copied, trigger } = useCopyTimeout();
  const [imageCopied, setImageCopied] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ name: string; dataUrl?: string } | null>(null);
  const [drawingBoardRequest, setDrawingBoardRequest] = useState<DrawingBoardRequest | null>(null);
  const currentSession = useAppStore((s) => s.currentSession);
  const runningSessionId = useAppStore((s) => s.runningSessionId);
  const defaultThinking = useAppStore((s) => s.defaultThinking);
  const defaultPlanMode = useAppStore((s) => s.defaultPlanMode);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const setRunningSessionId = useAppStore((s) => s.setRunningSessionId);
  const updateSession = useSessionStore((s) => s.updateSession);
  const isLatestUserMessage = Boolean(currentSession && currentSession.events.findLast((e) => e.type === "user_message")?.id === event.id);
  const isLongTaskMessage = Boolean(currentSession?.longTask);
  const images = event.images ?? [];
  const hasText = event.content.trim().length > 0;
  const copyText = hasText ? event.content : images.map((image) => `[图片: ${image.name}]`).join("\n");

  const handleResend = async () => {
    if (!currentSession || runningSessionId === currentSession.id) return;
    const responsePlaceholder: TimelineEvent = {
      id: Math.random().toString(36).substring(2, 11),
      type: "assistant_message",
      timestamp: Date.now(),
      content: "",
      isThinking: defaultThinking,
      isComplete: false,
    };
    updateSession(currentSession.id, (session) => ({
      ...session,
      events: [...session.events, responsePlaceholder],
      updatedAt: Date.now(),
    }));
    setRunningSessionId(currentSession.id);
    const runtimeSessionId = getRuntimeSessionId(currentSession);
    if (!runtimeSessionId) {
      setRunningSessionId(null);
      return;
    }
    try {
      const res = await window.api.sendPrompt({
        sessionId: runtimeSessionId,
        content: event.content,
        images: images
          .filter((image) => Boolean(image.dataUrl))
        .map((image) => ({ name: image.name, dataUrl: image.dataUrl as string })),
        thinking: defaultThinking,
        yoloMode: permissionMode === "yolo",
        autoMode: permissionMode === "auto",
        planMode: defaultPlanMode,
      });
      if (!res.success) throw new Error(res.error);
    } catch (err) {
      console.error("Resend failed:", err);
      setRunningSessionId(null);
    }
  };

  const handleCopyPreviewImage = async (clickEvent: React.MouseEvent, dataUrl: string) => {
    clickEvent.preventDefault();
    clickEvent.stopPropagation();
    const res = await window.api.copyImage({ dataUrl });
    if (!res.success) return;
    setImageCopied(true);
    window.setTimeout(() => setImageCopied(false), 1200);
  };

  const handleSaveDrawingBoard = (image: { name: string; dataUrl: string }) => {
    window.dispatchEvent(new CustomEvent("kimix:addDrawingImage", { detail: image }));
    setDrawingBoardRequest(null);
    setPreviewImage(null);
  };

  return (
    <div className="group flex justify-end">
      <div className="flex max-w-[58%] flex-col items-end">
        {images.length > 0 && (
          <div
            className="flex max-w-full flex-wrap justify-end"
            style={{ gap: 8, marginBottom: hasText ? 12 : 0 }}
          >
            {images.map((image, index) => (
              image.dataUrl ? (
                <button
                  key={image.id ?? `${image.name}-${index}`}
                  type="button"
                  onClick={() => setPreviewImage(image)}
                  className="kimix-media-thumb h-24 w-24 overflow-hidden rounded-[var(--radius-md)] transition-colors"
                  title="点击查看图片"
                  aria-label={`查看图片 ${image.name}`}
                >
                  <img src={image.dataUrl} alt={image.name} className="h-full w-full object-cover" />
                </button>
              ) : (
                <div
                  key={image.id ?? `${image.name}-${index}`}
                  className="kimix-media-thumb flex h-24 w-24 flex-col items-center justify-center rounded-[14px] text-[var(--kimix-panel-text-muted)]"
                  style={{ gap: 7, paddingLeft: 10, paddingRight: 10 }}
                >
                  <ImageIcon size={20} />
                  <span className="max-w-full truncate text-[12.5px]">{image.name || "图片"}</span>
                </div>
              )
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
            disabled={currentSession ? runningSessionId === currentSession.id || (isLongTaskMessage && !isLatestUserMessage) : false}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover disabled:opacity-30"
            title="重新发送"
            aria-label="重新发送"
          >
            <RotateCcw size={13} />
          </button>
        </div>
      </div>
      {previewImage?.dataUrl && (
        <div
          className="kimix-preview-overlay fixed inset-0 z-[80] flex items-center justify-center"
          onClick={() => setPreviewImage(null)}
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
        >
          <button
            type="button"
            onClick={() => setPreviewImage(null)}
            className="kimix-preview-close absolute right-6 top-6 flex h-10 w-10 items-center justify-center rounded-full shadow-[0_8px_24px_rgba(0,0,0,0.22)] transition-colors"
            title="关闭"
            aria-label="关闭图片预览"
          >
            <X size={20} />
          </button>
          <img
            src={previewImage.dataUrl}
            alt={previewImage.name}
            className="kimix-preview-image max-h-[82vh] max-w-[86vw] rounded-xl object-contain shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
            onClick={(clickEvent) => clickEvent.stopPropagation()}
            onContextMenu={(contextEvent) => previewImage.dataUrl && void handleCopyPreviewImage(contextEvent, previewImage.dataUrl)}
          />
          <button
            type="button"
            onClick={(clickEvent) => {
              clickEvent.stopPropagation();
              if (!previewImage.dataUrl) return;
              setDrawingBoardRequest({
                ratio: "1:1",
                source: {
                  id: previewImage.name,
                  name: previewImage.name,
                  dataUrl: previewImage.dataUrl,
                },
              });
            }}
            className="kimix-icon-text-button absolute bottom-8 rounded-xl bg-accent-primary text-white shadow-elevated-token hover:bg-accent-primary-dark"
            style={{ paddingLeft: 16, paddingRight: 16 }}
          >
            画板
          </button>
          {imageCopied && (
            <div className="kimix-preview-toast absolute bottom-8 rounded-full text-[14px] shadow-[0_8px_24px_rgba(0,0,0,0.2)]" style={{ padding: "8px 16px" }}>
              已复制图片
            </div>
          )}
        </div>
      )}
      {drawingBoardRequest && (
        <DrawingBoard
          request={drawingBoardRequest}
          onClose={() => setDrawingBoardRequest(null)}
          onSave={handleSaveDrawingBoard}
        />
      )}
    </div>
  );
}

function SteerMessageBubble({ event }: { event: Extract<TimelineEvent, { type: "steer_message" }> }) {
  const label = event.status === "sending"
    ? "正在引导对话"
    : event.status === "failed"
      ? "引导失败"
      : "已引导对话";

  return (
    <div className="group w-full">
      <div className="flex justify-end">
        <div className="max-w-[58%]">
          <div
            style={{ minWidth: 64, paddingLeft: 15, paddingRight: 15, paddingTop: 8, paddingBottom: 8 }}
            className="kimix-user-bubble rounded-[var(--radius-md)] text-[14.5px] leading-[1.45]"
          >
            {event.content}
          </div>
          <div className={`mt-1.5 text-right text-[13px] leading-5 ${event.status === "failed" ? "text-accent-danger" : "text-[var(--kimix-panel-text-secondary)]"}`}>
            {label}
          </div>
          {event.error && <div className="mt-1 text-right text-[12.5px] text-accent-danger">{event.error}</div>}
        </div>
      </div>
    </div>
  );
}

type ToolEvent = Extract<TimelineEvent, { type: "tool_call" }>;
type SubagentEvent = Extract<TimelineEvent, { type: "subagent" }>;
type AssistantEvent = Extract<TimelineEvent, { type: "assistant_message" }>;

type ThinkingBlock = {
  id: string;
  timestamp: number;
  text: string;
};

type ProcessItem =
  | { type: "thinking"; block: ThinkingBlock }
  | { type: "tool"; tool: ToolEvent }
  | { type: "subagent"; subagent: SubagentEvent };

function firstThinkingSentence(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = normalized.match(/^(.{1,160}?[。！？?!])(?:\s|$)/);
  const first = match?.[1] ?? normalized.slice(0, 120);
  return normalized.length > first.length ? `${first}...` : first || "思考内容";
}

function describeTool(tool: ToolEvent) {
  const command = typeof tool.arguments.command === "string"
    ? tool.arguments.command
    : typeof tool.arguments.cmd === "string"
      ? tool.arguments.cmd
      : tool.rawArguments || tool.toolName || "工具调用";
  return command.replace(/\s+/g, " ").slice(0, 220);
}

function stringifyToolDetail(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function splitLegacyThinking(text: string, timestamp: number): ThinkingBlock[] {
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

function getThinkingBlocks(event: AssistantEvent): ThinkingBlock[] {
  const parts = event.thinkingParts?.filter((part) => part.text.trim()) ?? [];
  if (parts.length === 0) return event.thinking ? splitLegacyThinking(event.thinking, event.timestamp) : [];

  const blocks: ThinkingBlock[] = [];
  let current = "";
  let currentTimestamp = parts[0]?.timestamp ?? event.timestamp;
  parts.forEach((part) => {
    if (!current) currentTimestamp = part.timestamp;
    current += part.text;
    const shouldFlush = current.length > 620 || (current.length > 120 && /[。！？?!]\s*$/.test(current));
    if (shouldFlush) {
      blocks.push({ id: `thinking-${part.id}`, timestamp: currentTimestamp, text: current.trim() });
      current = "";
    }
  });
  if (current.trim()) {
    blocks.push({ id: `thinking-tail-${blocks.length}`, timestamp: currentTimestamp, text: current.trim() });
  }
  return blocks;
}

function ThinkingProcessItem({ block }: { block: ThinkingBlock }) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = block.text.trim().length > 140 || /\n/.test(block.text);
  return (
    <div className="kimix-soft-card overflow-hidden rounded-xl">
      <button
        type="button"
        onClick={() => canExpand && setExpanded((value) => !value)}
        disabled={!canExpand}
        className="grid h-10 w-full grid-cols-[18px_minmax(0,1fr)_18px] items-center text-left text-[14px] leading-none text-[var(--kimix-process-text)] transition-colors hover:bg-[var(--kimix-panel-hover)] disabled:cursor-default disabled:hover:bg-transparent"
        style={{ gap: 9, paddingLeft: 14, paddingRight: 14 }}
      >
        <span className="flex h-5 w-[18px] shrink-0 items-center justify-center text-[var(--kimix-process-muted)]">
          <Brain size={15} />
        </span>
        <span className="min-w-0 flex-1 truncate">{firstThinkingSentence(block.text)}</span>
        {canExpand && (
          <span className="flex h-5 w-[18px] shrink-0 items-center justify-center text-[var(--kimix-process-muted)]">
            {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </span>
        )}
      </button>
      {expanded && (
        <pre className="kimix-soft-card-strong mt-1 min-w-0 whitespace-pre-wrap break-words rounded-lg font-mono text-[13.5px] leading-7" style={{ padding: "14px 16px" }}>
          {block.text}
        </pre>
      )}
    </div>
  );
}

function ToolProcessItem({ tool }: { tool: ToolEvent }) {
  const [expanded, setExpanded] = useState(false);
  const argumentText = tool.rawArguments?.trim() || stringifyToolDetail(tool.arguments);
  const resultText = stringifyToolDetail(tool.result).trim();
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
        className="grid h-10 w-full grid-cols-[18px_auto_minmax(0,1fr)_auto_18px_18px] items-center text-left transition-colors hover:bg-[var(--kimix-panel-hover)] disabled:cursor-default disabled:hover:bg-transparent"
        style={{ gap: 9, paddingLeft: 14, paddingRight: 14 }}
      >
        <span className="flex h-5 w-[18px] items-center justify-center text-[var(--kimix-process-muted)]">
          <SquareTerminal size={14} />
        </span>
        <span className="shrink-0 text-[var(--kimix-panel-text-secondary)]">{tool.status === "running" ? "正在运行" : tool.status === "error" ? "命令失败" : "已完成"}</span>
        <span className="min-w-0 flex-1 truncate">{describeTool(tool)}</span>
        <span className="w-8 shrink-0 text-right text-[var(--kimix-panel-text-muted)]">{tool.durationMs !== undefined ? `${Math.max(0, Math.round(tool.durationMs / 1000))}s` : ""}</span>
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

function SubagentProcessItem({ subagent }: { subagent: SubagentEvent }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = subagent.status === "running";
  const isError = subagent.status === "error";
  const childSummary = subagent.events.length > 0
    ? `${subagent.events.length} 条子事件`
    : "暂无子事件详情";
  const detailText = [
    `子代理：${subagent.agentName || "subagent"}`,
    `状态：${isRunning ? "运行中" : isError ? "运行失败" : "已完成"}`,
    `详情：${childSummary}`,
  ].join("\n");
  return (
    <div className="kimix-soft-card overflow-hidden rounded-xl text-[13.5px]">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="grid h-10 w-full grid-cols-[18px_auto_minmax(0,1fr)_auto_18px_18px] items-center text-left transition-colors hover:bg-[var(--kimix-panel-hover)]"
        style={{ gap: 9, paddingLeft: 14, paddingRight: 14 }}
      >
        <span className="flex h-5 w-[18px] items-center justify-center text-[var(--kimix-process-muted)]">
          {isRunning ? (
            <Loader2 size={14} className="kimix-spin" />
          ) : (
            <Bot size={14} />
          )}
        </span>
        <span className="shrink-0 text-[var(--kimix-panel-text-secondary)]">{isRunning ? "运行中" : isError ? "运行失败" : "已完成"}</span>
        <span className="min-w-0 flex-1 truncate">{subagent.agentName || "子代理"}</span>
        <span className="w-8 shrink-0 text-right text-[var(--kimix-panel-text-muted)]">{subagent.events.length > 0 ? `${subagent.events.length}条` : ""}</span>
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

function AssistantProcessSummary({ event, tools, subagents, label }: { event: AssistantEvent; tools: ToolEvent[]; subagents: SubagentEvent[]; label: string }) {
  const [expanded, setExpanded] = useState(false);
  const thinkingBlocks = getThinkingBlocks(event);
  const items: ProcessItem[] = [
    ...thinkingBlocks.map((block): ProcessItem => ({ type: "thinking", block })),
    ...tools.map((tool): ProcessItem => ({ type: "tool", tool })),
    ...subagents.map((subagent): ProcessItem => ({ type: "subagent", subagent })),
  ].sort((a, b) => (
    (a.type === "thinking" ? a.block.timestamp : a.type === "tool" ? a.tool.timestamp : a.subagent.timestamp) -
    (b.type === "thinking" ? b.block.timestamp : b.type === "tool" ? b.tool.timestamp : b.subagent.timestamp)
  ));
  const hasDetails = items.length > 0;
  const detailUnit = event.agentRole ? "内容" : "思考";
  const summary = joinSummaryParts([
    thinkingBlocks.length > 0 ? `${thinkingBlocks.length} 段${detailUnit}` : "",
    tools.length > 0 ? `${tools.length} 条命令` : "",
    subagents.length > 0 ? `${subagents.length} 个子代理` : "",
  ]);

  return (
    <div className="w-full border-b border-[var(--kimix-panel-divider)]" style={{ paddingBottom: expanded && hasDetails ? 8 : 12 }}>
      <button
        type="button"
        onClick={() => hasDetails && setExpanded((value) => !value)}
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
          {items.map((item, index) => (
            item.type === "thinking"
              ? <ThinkingProcessItem key={item.block.id || `thinking-${index}`} block={item.block} />
              : item.type === "tool"
                ? <ToolProcessItem key={item.tool.id} tool={item.tool} />
                : <SubagentProcessItem key={item.subagent.id} subagent={item.subagent} />
          ))}
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="kimix-icon-text-button kimix-muted-action is-compact self-end"
            style={{ marginTop: 2, paddingLeft: 12, paddingRight: 12 }}
          >
            <ChevronUp size={14} />
            <span>收起本轮内容</span>
          </button>
        </div>
      )}
    </div>
  );
}

function AssistantMessageBubble({ event, leadingTools = [], leadingSubagents = [], leadingHooks = [], changedFiles = [], trailingStatuses = [], hideProcessSummary = false }: { event: Extract<TimelineEvent, { type: "assistant_message" }>; leadingTools?: Extract<TimelineEvent, { type: "tool_call" }>[]; leadingSubagents?: Extract<TimelineEvent, { type: "subagent" }>[]; leadingHooks?: Extract<TimelineEvent, { type: "hook" }>[]; changedFiles?: string[]; trailingStatuses?: Extract<TimelineEvent, { type: "status_update" }>[]; hideProcessSummary?: boolean }) {
  const { copied, trigger } = useCopyTimeout();
  const currentSession = useAppStore((s) => s.currentSession);
  const runningSessionId = useAppStore((s) => s.runningSessionId);
  const hasContent = event.content.trim().length > 0;
  const changedSet = new Set(changedFiles.map((f) => f.toLowerCase()));
  const mdArtifacts = Array.from(new Set(
    event.content.match(/(?:[\w.-]+\/)*[\w.-]+\.md\b/gi) ?? []
  )).filter((path) => changedSet.has(path.toLowerCase())).slice(0, 3);
  const isActiveAssistant = Boolean(currentSession?.id && runningSessionId === currentSession.id && !event.isComplete);
  const isActivelyThinking = Boolean(isActiveAssistant && event.isThinking);
  const elapsed = useElapsed(event.timestamp, isActiveAssistant);
  const hasThinkingDetails = Boolean(event.thinking?.trim() || event.thinkingParts?.some((part) => part.text.trim().length > 0));
  const hasProcessDetails = Boolean(hasThinkingDetails || leadingTools.length > 0 || leadingSubagents.length > 0 || changedFiles.length > 0 || trailingStatuses.length > 0);
  const shouldShowNoContentHint = !hasContent && !hasProcessDetails && (event.isComplete || (isActiveAssistant && elapsed >= 8000));
  const durationLabel = event.isComplete
    ? formatDuration(event.durationMs && event.durationMs > 0 ? event.durationMs : elapsed)
    : isActiveAssistant && elapsed >= 1000
      ? formatDuration(elapsed)
      : "";
  const roleLabel = formatAgentRole(event.agentRole);
  const hookBadgeEvents = getHookBadgeEvents(leadingHooks);
  const displayProcessLabel = event.isComplete
    ? `已处理${roleLabel ? `（${roleLabel}）` : ""} ${durationLabel}`
    : isActivelyThinking
      ? `正在思考${roleLabel ? `（${roleLabel}）` : ""} ${durationLabel}`
      : `执行中${roleLabel ? `（${roleLabel}）` : ""} ${durationLabel}`;

  return (
    <div className="group flex justify-start">
      <div className="w-full" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {!hideProcessSummary && (event.isThinking || event.isComplete || !hasContent) && (
          <AssistantProcessSummary event={event} tools={leadingTools} subagents={leadingSubagents} label={displayProcessLabel} />
        )}

        {shouldShowNoContentHint && (
          <div
            className="rounded-xl border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-soft-bg)] text-[13.5px] leading-6 text-[var(--kimix-panel-text-secondary)]"
            style={{ padding: "12px 14px" }}
          >
            {event.isComplete
              ? "本轮没有生成正文内容，Kimi 只返回了思考过程、命令执行或文件变更。"
              : "Kimi 还没有生成正文内容，当前仍在思考或执行命令。"}
          </div>
        )}

        {hasContent && (
          <>
            <div className="relative w-full text-[15px] leading-[1.68] text-[var(--kimix-panel-text)]">
              <MarkdownRenderer content={event.content} />
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

        {trailingStatuses.length > 0 && (
          <div className="flex flex-col" style={{ gap: 8 }}>
            {trailingStatuses.map((status) => (
              <StatusCard key={status.id} event={status} />
            ))}
          </div>
        )}

        {hasContent && (
          <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={() => trigger(event.content)}
              className="rounded-md p-1 text-text-muted transition-colors hover:bg-bg-hover"
              title="复制"
              aria-label="复制"
            >
              {copied ? <Check size={13} className="text-accent-success" /> : <Copy size={13} />}
            </button>
            {hookBadgeEvents.length > 0 && (
              <button
                type="button"
                className="flex h-6 items-center rounded-md text-[12px] text-text-muted transition-colors hover:bg-bg-hover"
                style={{ gap: 4, paddingLeft: 7, paddingRight: 7 }}
                title={hookBadgeEvents.map((hook) => `${hook.eventName} ${hook.phase === "resolved" ? hook.action ?? "allow" : "运行"}${hook.reason ? `：${hook.reason}` : ""}`).join("\n")}
                aria-label="Hook 命中"
              >
                <Cable size={13} />
                <span>钩子 {hookBadgeEvents.length}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function MessageBubble({ event, leadingTools, leadingSubagents, leadingHooks, changedFiles, trailingStatuses, hideProcessSummary }: MessageBubbleProps) {
  if (event.type === "user_message") {
    return <UserMessageBubble event={event} />;
  }
  if (event.type === "steer_message") {
    return <SteerMessageBubble event={event} />;
  }
  return <AssistantMessageBubble event={event} leadingTools={leadingTools} leadingSubagents={leadingSubagents} leadingHooks={leadingHooks} changedFiles={changedFiles} trailingStatuses={trailingStatuses} hideProcessSummary={hideProcessSummary} />;
}
