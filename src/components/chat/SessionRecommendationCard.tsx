import { useEffect, useState } from "react";
import { ArrowRight, FileText, MessageSquarePlus } from "lucide-react";
import { useCreateProjectSession } from "@/hooks/useCreateProjectSession";
import { useAppStore } from "@/stores/appStore";
import type { TimelineEvent } from "@/types/ui";

function projectNameFromPath(projectPath: string): string {
  return projectPath.split(/[\\/]/).filter(Boolean).at(-1) || "项目";
}

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

export function SessionRecommendationCard({ event, sourceSessionId, projectPath }: { event: Extract<TimelineEvent, { type: "session_recommendation" }>; sourceSessionId: string; projectPath: string }) {
  const { createSession, creating } = useCreateProjectSession();
  const handoffSessionId = useAppStore((s) => s.handoffSessionId);
  const isHandoffRunning = event.handoffStatus === "running" || handoffSessionId === sourceSessionId;
  const dots = useAnimatedDots(isHandoffRunning);
  const disabled = creating || isHandoffRunning || !sourceSessionId || !projectPath;

  const startHandoff = () => {
    if (disabled) return;
    window.dispatchEvent(new CustomEvent("kimix:startHandoff", {
      detail: {
        sourceSessionId,
        projectPath,
        recommendationEventId: event.id,
      },
    }));
  };

  const startFreshSession = () => {
    if (disabled) return;
    void createSession({
      id: crypto.randomUUID(),
      name: projectNameFromPath(projectPath),
      path: projectPath,
      lastOpenedAt: Date.now(),
    });
  };

  return (
    <div className="flex justify-center">
      <div
        className="w-full max-w-[860px] rounded-xl border border-accent-primary-soft bg-accent-primary-light text-[14.5px] leading-6 text-text-secondary"
        style={{ padding: "16px 20px" }}
      >
        <div className="flex items-start" style={{ gap: 14 }}>
          <span className="flex h-6 w-6 shrink-0 items-center justify-center text-accent-primary" style={{ marginTop: 1 }}>
            <MessageSquarePlus size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="leading-6">
              当前会话已进行 {event.turnCount} 轮，达到推荐上限 {event.turnLimit} 轮。建议开启新对话，减少旧上下文和无用信息干扰。
              {event.handoffStatus === "error" && event.handoffError && (
                <span className="ml-2 text-accent-warning">交接失败：{event.handoffError}</span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center" style={{ gap: 8 }}>
              <button
                type="button"
                disabled={disabled}
                onClick={startFreshSession}
                className="inline-flex h-8 items-center rounded-lg text-[14px] font-medium text-accent-primary transition-colors hover:bg-accent-primary/10 disabled:cursor-wait disabled:text-text-muted"
                style={{ gap: 6, paddingLeft: 10, paddingRight: 12 }}
              >
                <span>{creating ? "正在开启" : "开启新对话"}</span>
                <ArrowRight size={15} />
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={startHandoff}
                className="inline-flex h-8 items-center rounded-lg text-[14px] font-medium text-accent-primary transition-colors hover:bg-accent-primary/10 disabled:cursor-wait disabled:text-text-muted"
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
