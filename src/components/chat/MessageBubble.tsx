import { useState } from "react";
import { Loader2, ChevronDown, ChevronUp, User, Bot } from "lucide-react";
import type { TimelineEvent } from "@/types/ui";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface MessageBubbleProps {
  event: Extract<TimelineEvent, { type: "user_message" | "assistant_message" }>;
}

export function MessageBubble({ event }: MessageBubbleProps) {
  const [showThinking, setShowThinking] = useState(false);

  if (event.type === "user_message") {
    return (
      <div className="flex justify-end group">
        <div className="flex items-start gap-2.5 max-w-[85%]">
          <div className="rounded-2xl rounded-tr-sm bg-accent-blue text-white px-5 py-3 text-[15px] leading-relaxed shadow-sm">
            {event.content}
          </div>
          <div className="w-7 h-7 rounded-full bg-accent-blue/10 flex items-center justify-center shrink-0 mt-1">
            <User size={14} className="text-accent-blue" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start group">
      <div className="flex items-start gap-2.5 max-w-[85%]">
        <div className="w-7 h-7 rounded-full bg-bg-tertiary flex items-center justify-center shrink-0 mt-1 border border-border-default">
          <Bot size={14} className="text-text-secondary" />
        </div>
        <div className="space-y-1.5">
          {/* Thinking placeholder */}
          {event.isThinking && !event.content && !event.thinking && (
            <div className="rounded-2xl rounded-tl-sm bg-bg-elevated border border-border-default px-5 py-3 shadow-sm">
              <div className="flex items-center gap-2 text-text-muted text-sm">
                <Loader2 size={14} className="animate-spin" />
                <span>思考中...</span>
              </div>
            </div>
          )}

          {/* Content */}
          {(event.content || (!event.isThinking && event.thinking)) && (
            <div className="rounded-2xl rounded-tl-sm bg-bg-elevated border border-border-default px-5 py-3 text-[15px] leading-relaxed text-text-primary shadow-sm">
              <MarkdownRenderer content={event.content} />
            </div>
          )}

          {/* Thinking block */}
          {event.thinking && (
            <div className="ml-1">
              <button
                onClick={() => setShowThinking(!showThinking)}
                className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary transition-colors px-2 py-1 rounded-md hover:bg-bg-tertiary"
              >
                {showThinking ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                <span>{showThinking ? "收起思考" : "显示思考"}</span>
              </button>
              {showThinking && (
                <div className="mt-1 text-xs text-text-secondary bg-bg-secondary rounded-xl px-4 py-3 border border-border-default">
                  <pre className="whitespace-pre-wrap font-mono leading-relaxed">{event.thinking}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
