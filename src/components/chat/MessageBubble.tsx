import { useState, useRef, useEffect } from "react";
import { ChevronDown, ChevronRight, ChevronUp, Copy, Check, RotateCcw, Image as ImageIcon, X, SquareTerminal } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { TimelineEvent } from "@/types/ui";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { FileCard } from "./FileCard";

interface MessageBubbleProps {
  event: Extract<TimelineEvent, { type: "user_message" | "steer_message" | "assistant_message" }>;
  leadingTools?: Extract<TimelineEvent, { type: "tool_call" }>[];
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
            style={{ minWidth: 64, paddingLeft: 15, paddingRight: 15, paddingTop: 8, paddingBottom: 8 }}
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

function AssistantToolSummary({ tools }: { tools: Extract<TimelineEvent, { type: "tool_call" }>[] }) {
  const [expanded, setExpanded] = useState(false);
  if (tools.length === 0) return null;
  const completed = tools.filter((tool) => tool.status === "success").length;
  const running = tools.filter((tool) => tool.status === "running").length;
  const failed = tools.filter((tool) => tool.status === "error").length;
  const summary = [
    completed > 0 ? `已运行 ${completed} 条命令` : "",
    running > 0 ? `正在运行 ${running} 条命令` : "",
    failed > 0 ? `${failed} 条失败` : "",
  ].filter(Boolean).join("，") || `已运行 ${tools.length} 条命令`;

  const describeTool = (tool: Extract<TimelineEvent, { type: "tool_call" }>) => {
    const command = typeof tool.arguments.command === "string"
      ? tool.arguments.command
      : typeof tool.arguments.cmd === "string"
        ? tool.arguments.cmd
        : tool.rawArguments || tool.toolName || "工具调用";
    return command.replace(/\s+/g, " ").slice(0, 220);
  };

  return (
    <div className="w-full border-b border-[#efebe3]" style={{ paddingBottom: expanded ? 10 : 12 }}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex h-8 items-center rounded-lg text-[14.5px] leading-none text-[#8a847a] transition-colors hover:bg-[#f3f1ec] hover:text-[#625d55]"
        style={{ gap: 8, paddingLeft: 4, paddingRight: 12 }}
      >
        {expanded ? <ChevronDown size={15} className="shrink-0" /> : <ChevronRight size={15} className="shrink-0" />}
        <SquareTerminal size={15} className="shrink-0" />
        <span>{summary}</span>
      </button>
      {expanded && (
        <div className="mt-2 rounded-xl border border-[#e8e3da] bg-[#fbfaf7]" style={{ padding: 8 }}>
          {tools.map((tool) => (
            <div
              key={tool.id}
              className="flex min-h-9 items-center rounded-lg text-[13.5px] text-[#706b63]"
              style={{ gap: 8, paddingLeft: 10, paddingRight: 10 }}
            >
              <SquareTerminal size={14} className="shrink-0 text-[#9a948b]" />
              <span className="min-w-0 flex-1 truncate">{describeTool(tool)}</span>
              {tool.durationMs !== undefined && <span className="shrink-0 text-[#aaa49a]">{Math.max(0, Math.round(tool.durationMs / 1000))}s</span>}
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tool.status === "error" ? "bg-[#d83b01]" : tool.status === "running" ? "bg-[#d6a100]" : "bg-[#1a8f3a]"}`} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AssistantMessageBubble({ event, leadingTools = [] }: { event: Extract<TimelineEvent, { type: "assistant_message" }>; leadingTools?: Extract<TimelineEvent, { type: "tool_call" }>[] }) {
  const [showThinking, setShowThinking] = useState(false);
  const { copied, trigger } = useCopyTimeout();
  const currentSession = useAppStore((s) => s.currentSession);
  const runningSessionId = useAppStore((s) => s.runningSessionId);
  const hasContent = event.content.trim().length > 0;
  const hasThinking = Boolean(event.thinking?.trim());
  const mdArtifacts = Array.from(new Set(
    event.content.match(/(?:[\w.-]+\/)*[\w.-]+\.md\b/gi) ?? []
  )).slice(0, 3);
  const isActivelyThinking = Boolean(currentSession?.id && runningSessionId === currentSession.id && event.isThinking && !event.isComplete);
  const elapsed = useElapsed(event.timestamp, isActivelyThinking);
  const durationLabel = event.isComplete
    ? formatDuration(event.durationMs ?? elapsed)
    : formatDuration(elapsed);

  return (
    <div className="group flex justify-start">
      <div className="w-full" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {(event.isThinking || event.isComplete || !hasContent) && (
          <div
            className="border-b border-[#ece8df] text-[15px] leading-7 text-[#8a847a]"
            style={{ paddingTop: 2, paddingBottom: 14 }}
          >
            {event.isComplete
              ? `已处理 ${durationLabel}`
              : isActivelyThinking
                ? `正在思考 ${durationLabel}`
                : `已处理 ${durationLabel}`}
          </div>
        )}

        {hasThinking && (
          <div>
            <button
              onClick={() => setShowThinking(!showThinking)}
              className="flex h-8 items-center rounded-lg text-[14.5px] leading-none text-[#8a847a] transition-colors hover:bg-[#f3f1ec] hover:text-[#625d55]"
              style={{ gap: 7, paddingLeft: 4, paddingRight: 10 }}
            >
              {showThinking ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              <span>{showThinking ? "收起思考" : "显示思考"}</span>
            </button>
            {showThinking && (
              <div
                className="mt-3 rounded-xl border border-[#e5e1d8] bg-[#faf8f4] text-[15px] text-[#706b63]"
                style={{ paddingLeft: 36, paddingRight: 36, paddingTop: 24, paddingBottom: 24 }}
              >
                <pre className="min-w-0 whitespace-pre-wrap break-words font-mono leading-8">{event.thinking}</pre>
              </div>
            )}
          </div>
        )}

        <AssistantToolSummary tools={leadingTools} />

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

export function MessageBubble({ event, leadingTools }: MessageBubbleProps) {
  if (event.type === "user_message") {
    return <UserMessageBubble event={event} />;
  }
  if (event.type === "steer_message") {
    return <SteerMessageBubble event={event} />;
  }
  return <AssistantMessageBubble event={event} leadingTools={leadingTools} />;
}
