import { useState, useRef, useEffect, useMemo } from "react";
import { useAppStore } from "@/stores/appStore";
import { useLiveSession } from "@/hooks/useLiveSession";
import { getSessionContextUsages, getSessionRecommendationMetrics } from "@/utils/sessionMetrics";
import { getRuntimeSessionId } from "@/utils/runtimeSession";
import { isSessionRuntimeRunning } from "@/utils/sessionActivity";

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
  const [compactStatus, setCompactStatus] = useState<"idle" | "pending" | "sent" | "failed">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const compactStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentSession = useAppStore((s) => s.currentSession);
  const runningSessionId = useAppStore((s) => s.runningSessionId);
  const sessionRecommendationEnabled = useAppStore((s) => s.sessionRecommendationEnabled);
  const sessionRecommendationTurnLimit = useAppStore((s) => s.sessionRecommendationTurnLimit);
  const session = useLiveSession(currentSession?.id);

  const contextUsages = useMemo(() => getSessionContextUsages(session), [session]);
  const primaryContextUsage = contextUsages.find((usage) => usage.isPrimary) ?? contextUsages[0];

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

  const hasContextStatus = primaryContextUsage?.hasContext ?? false;
  const percent = primaryContextUsage?.percent ?? 0;
  const recommendation = getSessionRecommendationMetrics(session, sessionRecommendationTurnLimit);
  const isCurrentSessionRunning = isSessionRuntimeRunning(currentSession, runningSessionId);
  const compactRequestPending = compactStatus === "pending";
  const canCompact = Boolean(currentSession && hasContextStatus && !isCurrentSessionRunning && !isCompacting && !compactRequestPending);
  const compactingDots = useAnimatedDots(isCompacting || compactRequestPending);

  const handleEnter = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setShowTooltip(true);
  };

  const handleLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setShowTooltip(false), 150);
  };

  const handleCompact = async () => {
    if (!currentSession || isCurrentSessionRunning || isCompacting || compactRequestPending) return;
    const runtimeSessionId = getRuntimeSessionId(currentSession);
    if (!runtimeSessionId) return;
    try {
      if (compactStatusTimerRef.current) clearTimeout(compactStatusTimerRef.current);
      setCompactStatus("pending");
      const res = await window.api.compactKimiCodeSession({
        sessionId: runtimeSessionId,
      });
      if (!res.success) throw new Error(res.error);
      setCompactStatus("sent");
      compactStatusTimerRef.current = setTimeout(() => setCompactStatus("idle"), 2200);
    } catch (err) {
      console.error("Compact failed:", err);
      setCompactStatus("failed");
      compactStatusTimerRef.current = setTimeout(() => setCompactStatus("idle"), 3200);
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (compactStatusTimerRef.current) clearTimeout(compactStatusTimerRef.current);
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
        className="kimix-inline-icon-action is-roomy rounded-xl text-text-muted hover:bg-surface-hover hover:text-text-primary"
        aria-label="上下文使用情况"
      >
        <CircularProgress percent={percent} size={18} strokeWidth={2.5} />
      </button>
      {showTooltip && (
        <div
          className="absolute bottom-full right-0 z-[90] rounded-xl border border-border-subtle bg-surface-elevated shadow-floating-token"
          style={{ width: 320, marginBottom: 8, padding: "18px 20px" }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span className="text-[13px] text-text-muted">背景信息窗口：</span>
            <button
              type="button"
              onClick={handleCompact}
              disabled={!canCompact}
              className="shrink-0 rounded-md text-[13px] transition-colors disabled:cursor-not-allowed"
              style={{
                padding: "2px 8px",
                color: isCompacting || compactRequestPending ? "var(--accent-warning)" : compactStatus === "failed" ? "var(--accent-danger)" : canCompact || compactStatus === "sent" ? "var(--accent-primary)" : "var(--text-muted)",
              }}
            >
              {isCompacting || compactRequestPending ? (
                <>
                  压缩中
                  <span className="inline-block w-[1.5em] text-left">{compactingDots}</span>
                </>
              ) : compactStatus === "sent" ? "已请求" : compactStatus === "failed" ? "压缩失败" : "压缩"}
            </button>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              marginTop: 14,
            }}
          >
            {contextUsages.map((usage) => (
              <div
                key={usage.agentId}
                className="rounded-lg border border-border-subtle bg-surface-secondary"
                style={{ padding: "10px 16px" }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <div className="min-w-0 truncate text-[13px] font-medium text-text-primary" title={`${usage.agentName} · ${usage.modelLabel}`}>
                    {usage.agentName}
                    <span className="font-normal text-text-muted"> · {usage.modelLabel}</span>
                  </div>
                  <span className="kimix-tabular-nums shrink-0 text-[13px] text-text-secondary">
                    {usage.hasContext ? `${usage.percent.toFixed(0)}%` : "--"}
                  </span>
                </div>
                <div className="kimix-tabular-nums text-[12.5px] text-text-muted" style={{ marginTop: 6 }}>
                  {usage.hasContext
                    ? `已用 ${formatK(usage.used)} 标记，共 ${formatK(usage.limit)}`
                    : "等待上下文数据"}
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover" style={{ marginTop: 8 }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${usage.percent}%`,
                      backgroundColor: usage.percent >= 90 ? "var(--accent-danger)" : usage.percent >= 70 ? "var(--accent-warning)" : "var(--accent-primary)",
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
              </div>
            ))}
            {contextUsages.length === 0 && (
              <div className="text-[13px] text-text-muted" style={{ padding: "8px 0" }}>
                暂无可用 Agent。
              </div>
            )}
          </div>
          {sessionRecommendationEnabled && (
            <div className="border-t border-border-subtle" style={{ marginTop: 16, paddingTop: 14 }}>
              <div className="flex items-center justify-between" style={{ gap: 12, marginBottom: 7 }}>
                <span className="text-[13px] text-text-muted">推荐会话长度：</span>
                <span className={`kimix-tabular-nums shrink-0 text-[13px] ${recommendation.remainingTurns === 0 ? "text-accent-warning" : "text-text-secondary"}`}>
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
              <div className="kimix-tabular-nums mt-2 text-[12.5px] leading-5 text-text-muted">
                已进行 {recommendation.turnCount} 轮，达到上限后会在每轮末尾提示开启新对话。
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
