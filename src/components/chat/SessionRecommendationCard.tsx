import { useEffect, useState } from "react";
import { ArrowRight, FileText, MessageSquarePlus } from "lucide-react";
import { useCreateProjectSession } from "@/hooks/useCreateProjectSession";
import { useAppStore } from "@/stores/appStore";
import type { TimelineEvent } from "@/types/ui";

function useAnimatedDots(active: boolean) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!active) {
      setCount(0);
      return;
    }
    const timer = window.setInterval(() => setCount((value) => (value + 1) % 4), 450);
    return () => window.clearInterval(timer);
  }, [active]);
  return ".".repeat(count);
}

export function SessionRecommendationCard({ event }: { event: Extract<TimelineEvent, { type: "session_recommendation" }> }) {
  const { createSession, creating } = useCreateProjectSession();
  const currentSession = useAppStore((s) => s.currentSession);
  const handoffSessionId = useAppStore((s) => s.handoffSessionId);
  const isHandoffRunning = event.handoffStatus === "running" || Boolean(currentSession?.id && handoffSessionId === currentSession.id);
  const dots = useAnimatedDots(isHandoffRunning);
  const disabled = creating || isHandoffRunning;

  const startHandoff = () => {
    if (!currentSession || disabled) return;
    window.dispatchEvent(new CustomEvent("kimix:startHandoff", {
      detail: {
        sourceSessionId: currentSession.id,
        projectPath: currentSession.projectPath,
        recommendationEventId: event.id,
      },
    }));
  };

  return (
    <div className="flex justify-center">
      <div
        className="w-full max-w-[860px] rounded-xl border border-[#d8e6f5] bg-[#f7fbff] text-[14.5px] leading-6 text-[#4f5963]"
        style={{ padding: "16px 20px" }}
      >
        <div className="flex items-start" style={{ gap: 14 }}>
          <span className="flex h-6 w-6 shrink-0 items-center justify-center text-[#2f79bd]" style={{ marginTop: 1 }}>
            <MessageSquarePlus size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="leading-6">
              当前会话已进行 {event.turnCount} 轮，达到推荐上限 {event.turnLimit} 轮。建议开启新对话，减少旧上下文和无用信息干扰。
              {event.handoffStatus === "error" && event.handoffError && (
                <span className="ml-2 text-[#b54708]">交接失败：{event.handoffError}</span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center" style={{ gap: 8 }}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => void createSession()}
                className="inline-flex h-8 items-center rounded-lg text-[14px] font-medium text-[#1f73c9] transition-colors hover:bg-[#e8f2fd] disabled:cursor-wait disabled:text-[#8aa9c8]"
                style={{ gap: 6, paddingLeft: 10, paddingRight: 12 }}
              >
                <span>{creating ? "正在开启" : "开启新对话"}</span>
                <ArrowRight size={15} />
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={startHandoff}
                className="inline-flex h-8 items-center rounded-lg text-[14px] font-medium text-[#1f73c9] transition-colors hover:bg-[#e8f2fd] disabled:cursor-wait disabled:text-[#8aa9c8]"
                style={{ gap: 6, paddingLeft: 10, paddingRight: 12 }}
              >
                <span>{isHandoffRunning ? `交接中${dots}` : "携带交接内容开启新对话"}</span>
                <FileText size={15} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
