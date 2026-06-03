import { useState, useRef, useEffect, useMemo } from "react";
import { useAppStore } from "@/stores/appStore";
import { useLiveSession } from "@/hooks/useLiveSession";
import { getSessionRecommendationMetrics, getLatestMeaningfulStatus } from "@/utils/sessionMetrics";
import { getRuntimeSessionId } from "@/utils/runtimeSession";

function formatK(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}

function CircularProgress({ percent, size = 18, strokeWidth = 2.5 }: { percent: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, percent)) / 100) * circumference;
  const color = percent >= 90 ? "#d83b01" : percent >= 70 ? "#d6a100" : "#339af0";

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--border-default)"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 0.3s ease" }}
      />
    </svg>
  );
}

function useAnimatedDots(active: boolean) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!active) {
      setCount(0);
      return;
    }
    const timer = window.setInterval(() => {
      setCount((value) => (value + 1) % 4);
    }, 450);
    return () => window.clearInterval(timer);
  }, [active]);

  return ".".repeat(count);
}

const COMPACTION_STALE_MS = 5 * 60 * 1000;

export function ContextRing() {
  const [showTooltip, setShowTooltip] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentSession = useAppStore((s) => s.currentSession);
  const runningSessionId = useAppStore((s) => s.runningSessionId);
  const sessionRecommendationEnabled = useAppStore((s) => s.sessionRecommendationEnabled);
  const sessionRecommendationTurnLimit = useAppStore((s) => s.sessionRecommendationTurnLimit);
  const session = useLiveSession(currentSession?.id);

  const latestStatus = getLatestMeaningfulStatus(session?.events ?? []);

  // 从事件流中判断是否在压缩中：最近一个 compaction 事件是 begin 且后面没有 end
  const isCompacting = useMemo(() => {
    if (!session?.events) return false;
    let hasBegin = false;
    for (let i = session.events.length - 1; i >= 0; i--) {
      const e = session.events[i];
      if (e.type === "compaction") {
        if (e.phase === "end") return false;
        if (e.phase === "begin") {
          hasBegin = Date.now() - e.timestamp < COMPACTION_STALE_MS;
          break;
        }
      }
    }
    return hasBegin;
  }, [session?.events]);

  const hasContextStatus = Boolean(latestStatus);
  const contextSize = latestStatus?.contextSize ?? 0;
  const contextLimit = latestStatus?.contextLimit ?? 256000;
  const used = contextSize <= 1 ? contextSize * contextLimit : contextSize;
  const percent = contextLimit > 0 ? Math.min(100, (used / contextLimit) * 100) : 0;
  const remaining = Math.max(0, 100 - percent);
  const recommendation = getSessionRecommendationMetrics(session, sessionRecommendationTurnLimit);
  const isCurrentSessionRunning = Boolean(currentSession && runningSessionId === currentSession.id);
  const canCompact = Boolean(currentSession && hasContextStatus && !isCurrentSessionRunning && !isCompacting);
  const compactingDots = useAnimatedDots(isCompacting);

  const handleEnter = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setShowTooltip(true);
  };

  const handleLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setShowTooltip(false), 150);
  };

  const handleCompact = async () => {
    if (!currentSession || isCurrentSessionRunning || isCompacting) return;
    const runtimeSessionId = getRuntimeSessionId(currentSession);
    if (!runtimeSessionId) return;
    try {
      await window.api.sendPrompt({
        sessionId: runtimeSessionId,
        content: "/compact",
      });
    } catch (err) {
      console.error("Compact failed:", err);
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!currentSession) return null;

  return (
    <div
      className="relative flex items-center"
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
    >
      <button
        type="button"
        className="flex h-8 w-8 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
        aria-label="上下文使用情况"
      >
        <CircularProgress percent={percent} size={18} strokeWidth={2.5} />
      </button>
      {showTooltip && (
        <div
          className="absolute bottom-full right-0 z-[90] mb-2 w-[248px] rounded-xl border border-border-subtle bg-surface-elevated shadow-floating-token"
          style={{ padding: "18px 20px" }}
        >
          <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
            <span className="text-[13px] text-text-muted">背景信息窗口：</span>
            <button
              type="button"
              onClick={handleCompact}
              disabled={!canCompact}
              className="shrink-0 rounded-md text-[13px] transition-colors disabled:cursor-not-allowed"
              style={{
                padding: "2px 8px",
                color: isCompacting ? "var(--accent-warning)" : canCompact ? "var(--accent-primary)" : "var(--text-muted)",
              }}
            >
              {isCompacting ? (
                <>
                  压缩中
                  <span className="inline-block w-[1.5em] text-left">{compactingDots}</span>
                </>
              ) : "压缩"}
            </button>
          </div>
          {hasContextStatus ? (
            <>
              <div className="text-[14px] font-medium text-text-primary">
                {percent.toFixed(0)}% 已用（剩余 {remaining.toFixed(0)}%）
              </div>
              <div className="text-[13px] text-text-muted" style={{ marginTop: 4 }}>
                已用 {formatK(used)} 标记，共 {formatK(contextLimit)}
              </div>
            </>
          ) : (
            <>
              <div className="text-[14px] font-medium text-text-primary">暂无上下文用量</div>
              <div className="text-[13px] text-text-muted" style={{ marginTop: 4 }}>
                发送消息后会显示 Tokens 和 Context。
              </div>
            </>
          )}
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
            <div
              className="h-full rounded-full"
              style={{
                width: `${percent}%`,
                backgroundColor: percent >= 90 ? "var(--accent-danger)" : percent >= 70 ? "var(--accent-warning)" : "var(--accent-primary)",
                transition: "width 0.3s ease",
              }}
            />
          </div>
          {sessionRecommendationEnabled && (
            <div className="mt-4 border-t border-border-subtle" style={{ paddingTop: 14 }}>
              <div className="flex items-center justify-between" style={{ gap: 12, marginBottom: 7 }}>
                <span className="text-[13px] text-text-muted">推荐会话长度：</span>
                <span className={`shrink-0 text-[13px] ${recommendation.remainingTurns === 0 ? "text-accent-warning" : "text-text-secondary"}`}>
                  剩余 {recommendation.remainingTurns}/{recommendation.turnLimit} 轮
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${recommendation.turnPercent}%`,
                    backgroundColor: recommendation.turnPercent >= 100 ? "var(--accent-warning)" : "var(--accent-primary)",
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
              <div className="mt-2 text-[12.5px] leading-5 text-text-muted">
                已进行 {recommendation.turnCount} 轮，达到上限后会在每轮末尾提示开启新对话。
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
