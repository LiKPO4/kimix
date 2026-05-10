import { useState, useRef, useEffect } from "react";
import { Brain, ChevronDown, ChevronRight, Copy, Check, RotateCcw, Image as ImageIcon, X, SquareTerminal } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { TimelineEvent } from "@/types/ui";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { FileCard } from "./FileCard";

interface MessageBubbleProps {
  event: Extract<TimelineEvent, { type: "user_message" | "steer_message" | "assistant_message" }>;
  leadingTools?: Extract<TimelineEvent, { type: "tool_call" }>[];
  changedFiles?: string[];
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
  const currentSession = useAppStore((s) => s.currentSession);
  const runningSessionId = useAppStore((s) => s.runningSessionId);
  const defaultThinking = useAppStore((s) => s.defaultThinking);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const setRunningSessionId = useAppStore((s) => s.setRunningSessionId);
  const updateSession = useSessionStore((s) => s.updateSession);
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
    try {
      await window.api.sendPrompt({
        sessionId: currentSession.id,
        content: event.content,
        images: images
          .filter((image) => Boolean(image.dataUrl))
          .map((image) => ({ name: image.name, dataUrl: image.dataUrl as string })),
        thinking: defaultThinking,
        yoloMode: permissionMode === "yolo",
      });
    } catch (err) {
      console.error("Resend failed:", err);
      setRunningSessionId(null);
    }
  };

  const handleCopyPreviewImage = async (event: React.MouseEvent, dataUrl: string) => {
    event.preventDefault();
    event.stopPropagation();
    const res = await window.api.copyImage({ dataUrl });
    if (!res.success) return;
    setImageCopied(true);
    window.setTimeout(() => setImageCopied(false), 1200);
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
                  className="h-24 w-24 overflow-hidden rounded-[14px] border border-[#ded8cf] bg-[#f7f5f1] shadow-[0_1px_3px_rgba(25,23,20,0.06)] transition-colors hover:border-[#cfc8bc]"
                  title="点击查看图片"
                  aria-label={`查看图片 ${image.name}`}
                >
                  <img src={image.dataUrl} alt={image.name} className="h-full w-full object-cover" />
                </button>
              ) : (
                <div
                  key={image.id ?? `${image.name}-${index}`}
                  className="flex h-24 w-24 flex-col items-center justify-center rounded-[14px] border border-[#ded8cf] bg-[#f7f5f1] text-[#8f887e]"
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
            className="rounded-[16px] bg-[#f3f3f3] text-[14.5px] leading-[1.45] text-[#24211d] shadow-[0_1px_0_rgba(25,23,20,0.02)]"
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
            {copied ? <Check size={13} className="text-accent-green" /> : <Copy size={13} />}
          </button>
          <button
            onClick={handleResend}
            disabled={currentSession ? runningSessionId === currentSession.id : false}
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
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/72"
          onClick={() => setPreviewImage(null)}
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
        >
          <button
            type="button"
            onClick={() => setPreviewImage(null)}
            className="absolute right-6 top-6 flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#24211d] shadow-[0_8px_24px_rgba(0,0,0,0.22)] transition-colors hover:bg-[#f3f1ec]"
            title="关闭"
            aria-label="关闭图片预览"
          >
            <X size={20} />
          </button>
          <img
            src={previewImage.dataUrl}
            alt={previewImage.name}
            className="max-h-[82vh] max-w-[86vw] rounded-xl bg-white object-contain shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
            onClick={(clickEvent) => clickEvent.stopPropagation()}
            onContextMenu={(contextEvent) => previewImage.dataUrl && void handleCopyPreviewImage(contextEvent, previewImage.dataUrl)}
          />
          {imageCopied && (
            <div className="absolute bottom-8 rounded-full bg-white text-[14px] text-[#24211d] shadow-[0_8px_24px_rgba(0,0,0,0.2)]" style={{ padding: "8px 16px" }}>
              已复制图片
            </div>
          )}
        </div>
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
      <div
        className={`text-[15px] leading-7 ${event.status === "failed" ? "text-accent-red" : "text-[#8a847a]"}`}
        style={{ paddingTop: 2, paddingBottom: 12 }}
      >
        {label}
      </div>
      <div className="flex justify-end">
        <div className="max-w-[58%]">
          <div className="mb-1 flex justify-end">
            <span className={`text-[13px] leading-5 ${event.status === "failed" ? "text-accent-red" : "text-[#8a847a]"}`}>
              {label}
            </span>
          </div>
          <div
            style={{ minWidth: 64, paddingLeft: 15, paddingRight: 15, paddingTop: 8, paddingBottom: 8 }}
            className="rounded-[16px] bg-[#f3f3f3] text-[14.5px] leading-[1.45] text-[#24211d] shadow-[0_1px_0_rgba(25,23,20,0.02)]"
          >
            {event.content}
          </div>
          {event.error && <div className="mt-1 text-right text-[12.5px] text-accent-red">{event.error}</div>}
        </div>
      </div>
    </div>
  );
}

type ToolEvent = Extract<TimelineEvent, { type: "tool_call" }>;
type AssistantEvent = Extract<TimelineEvent, { type: "assistant_message" }>;

type ThinkingBlock = {
  id: string;
  timestamp: number;
  text: string;
};

type ProcessItem =
  | { type: "thinking"; block: ThinkingBlock }
  | { type: "tool"; tool: ToolEvent };

function firstThinkingSentence(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = normalized.match(/^(.{1,160}?[。！？.!?])(?:\s|$)/);
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

function splitLegacyThinking(text: string, timestamp: number): ThinkingBlock[] {
  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const source = paragraphs.length > 1 ? paragraphs : text.match(/[^。！？.!?]+[。！？.!?]?/g)?.map((part) => part.trim()).filter(Boolean) ?? [text.trim()];
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
    const shouldFlush = current.length > 620 || (current.length > 120 && /[。！？.!?]\s*$/.test(current));
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
  return (
    <div className="rounded-xl border border-[#e8e3da] bg-[#fbfaf7]" style={{ padding: "10px 14px" }}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center rounded-lg text-left text-[14px] leading-6 text-[#706b63] transition-colors hover:bg-[#f3f1ec]"
        style={{ gap: 8, padding: "4px 6px" }}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[#9a948b]">
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[#9a948b]">
          <Brain size={15} />
        </span>
        <span className="min-w-0 flex-1">{firstThinkingSentence(block.text)}</span>
      </button>
      {expanded && (
        <pre className="mt-2 min-w-0 whitespace-pre-wrap break-words rounded-lg bg-[#f6f3ed] font-mono text-[13.5px] leading-7 text-[#625d55]" style={{ padding: "14px 16px" }}>
          {block.text}
        </pre>
      )}
    </div>
  );
}

function ToolProcessItem({ tool }: { tool: ToolEvent }) {
  return (
    <div className="flex min-h-10 items-center rounded-xl border border-[#e8e3da] bg-white text-[13.5px] text-[#706b63]" style={{ gap: 9, paddingLeft: 14, paddingRight: 14 }}>
      <SquareTerminal size={14} className="shrink-0 text-[#9a948b]" />
      <span className="shrink-0 text-[#8a847a]">{tool.status === "running" ? "正在运行" : tool.status === "error" ? "命令失败" : "已运行"}</span>
      <span className="min-w-0 flex-1 truncate">{describeTool(tool)}</span>
      {tool.durationMs !== undefined && <span className="shrink-0 text-[#aaa49a]">{Math.max(0, Math.round(tool.durationMs / 1000))}s</span>}
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tool.status === "error" ? "bg-[#d83b01]" : tool.status === "running" ? "bg-[#d6a100]" : "bg-[#1a8f3a]"}`} />
    </div>
  );
}

function AssistantProcessSummary({ event, tools, label }: { event: AssistantEvent; tools: ToolEvent[]; label: string }) {
  const [expanded, setExpanded] = useState(false);
  const thinkingBlocks = getThinkingBlocks(event);
  const items: ProcessItem[] = [
    ...thinkingBlocks.map((block): ProcessItem => ({ type: "thinking", block })),
    ...tools.map((tool): ProcessItem => ({ type: "tool", tool })),
  ].sort((a, b) => (
    (a.type === "thinking" ? a.block.timestamp : a.tool.timestamp) -
    (b.type === "thinking" ? b.block.timestamp : b.tool.timestamp)
  ));
  const hasDetails = items.length > 0;

  return (
    <div className="w-full border-b border-[#ece8df]" style={{ paddingBottom: expanded && hasDetails ? 14 : 12 }}>
      <button
        type="button"
        onClick={() => hasDetails && setExpanded((value) => !value)}
        disabled={!hasDetails}
        className="flex h-8 items-center rounded-lg text-[15px] leading-none text-[#8a847a] transition-colors hover:bg-[#f3f1ec] hover:text-[#625d55] disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-[#8a847a]"
        style={{ gap: 8, paddingLeft: 4, paddingRight: 12 }}
      >
        {hasDetails ? (expanded ? <ChevronDown size={15} className="shrink-0" /> : <ChevronRight size={15} className="shrink-0" />) : <span className="w-[15px]" />}
        <span>{label}</span>
        {hasDetails && (
          <span className="text-[13px] text-[#aaa49a]">
            {thinkingBlocks.length > 0 ? `${thinkingBlocks.length} 段思考` : ""}
            {thinkingBlocks.length > 0 && tools.length > 0 ? " · " : ""}
            {tools.length > 0 ? `${tools.length} 条命令` : ""}
          </span>
        )}
      </button>
      {expanded && hasDetails && (
        <div className="mt-2 flex flex-col rounded-xl border border-[#eee9e1] bg-[#fffdfa]" style={{ gap: 10, padding: "12px 14px" }}>
          {items.map((item, index) => (
            item.type === "thinking"
              ? <ThinkingProcessItem key={item.block.id || `thinking-${index}`} block={item.block} />
              : <ToolProcessItem key={item.tool.id} tool={item.tool} />
          ))}
        </div>
      )}
    </div>
  );
}

function AssistantMessageBubble({ event, leadingTools = [], changedFiles = [] }: { event: Extract<TimelineEvent, { type: "assistant_message" }>; leadingTools?: Extract<TimelineEvent, { type: "tool_call" }>[]; changedFiles?: string[] }) {
  const { copied, trigger } = useCopyTimeout();
  const currentSession = useAppStore((s) => s.currentSession);
  const runningSessionId = useAppStore((s) => s.runningSessionId);
  const hasContent = event.content.trim().length > 0;
  const changedSet = new Set(changedFiles.map((f) => f.toLowerCase()));
  const mdArtifacts = Array.from(new Set(
    event.content.match(/(?:[\w.-]+\/)*[\w.-]+\.md\b/gi) ?? []
  )).filter((path) => changedSet.has(path.toLowerCase())).slice(0, 3);
  const isActivelyThinking = Boolean(currentSession?.id && runningSessionId === currentSession.id && event.isThinking && !event.isComplete);
  const elapsed = useElapsed(event.timestamp, isActivelyThinking);
  const durationLabel = event.isComplete
    ? formatDuration(event.durationMs ?? elapsed)
    : formatDuration(elapsed);
  const processLabel = event.isComplete
    ? `已处理 ${durationLabel}`
    : isActivelyThinking
      ? `正在思考 ${durationLabel}`
      : `已处理 ${durationLabel}`;

  return (
    <div className="group flex justify-start">
      <div className="w-full" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {(event.isThinking || event.isComplete || !hasContent) && (
          <AssistantProcessSummary event={event} tools={leadingTools} label={processLabel} />
        )}

        {hasContent && (
          <>
            <div className="relative w-full text-[15px] leading-[1.68] text-[#24211d]">
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

        {hasContent && (
          <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={() => trigger(event.content)}
              className="rounded-md p-1 text-text-muted transition-colors hover:bg-bg-hover"
              title="复制"
              aria-label="复制"
            >
              {copied ? <Check size={13} className="text-accent-green" /> : <Copy size={13} />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function MessageBubble({ event, leadingTools, changedFiles }: MessageBubbleProps) {
  if (event.type === "user_message") {
    return <UserMessageBubble event={event} />;
  }
  if (event.type === "steer_message") {
    return <SteerMessageBubble event={event} />;
  }
  return <AssistantMessageBubble event={event} leadingTools={leadingTools} changedFiles={changedFiles} />;
}
