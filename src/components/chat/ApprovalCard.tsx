import { AlertTriangle } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { TimelineEvent } from "@/types/ui";

interface ApprovalCardProps {
  event: Extract<TimelineEvent, { type: "approval_request" }>;
}

export function ApprovalCard({ event }: ApprovalCardProps) {
  const currentSession = useAppStore((s) => s.currentSession);
  const updateSession = useSessionStore((s) => s.updateSession);

  const handleApprove = async (scope?: "once" | "session") => {
    if (!currentSession) return;
    try {
      await window.api.approveRequest({
        sessionId: currentSession.id,
        requestId: event.requestId,
        approved: true,
        scope,
      });
      updateSession(currentSession.id, (session) => ({
        ...session,
        events: session.events.map((e) =>
          e.id === event.id && e.type === "approval_request"
            ? { ...e, status: "approved" as const }
            : e
        ),
      }));
    } catch (err) {
      console.error("Approve failed:", err);
    }
  };

  const handleReject = async () => {
    if (!currentSession) return;
    try {
      await window.api.approveRequest({
        sessionId: currentSession.id,
        requestId: event.requestId,
        approved: false,
      });
      updateSession(currentSession.id, (session) => ({
        ...session,
        events: session.events.map((e) =>
          e.id === event.id && e.type === "approval_request"
            ? { ...e, status: "rejected" as const }
            : e
        ),
      }));
    } catch (err) {
      console.error("Reject failed:", err);
    }
  };

  const riskColors = {
    low: "text-accent-green",
    medium: "text-accent-yellow",
    high: "text-accent-red",
  };

  const isPending = event.status === "pending";

  return (
    <div className="flex justify-center">
      <div className="max-w-[90%] w-full rounded-xl border border-accent-orange/30 bg-accent-orange/5 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <AlertTriangle size={16} className="text-accent-orange" />
          <span>工具请求: {event.description}</span>
        </div>

        {event.details && (
          <pre className="mt-2 text-xs text-text-secondary bg-bg-primary rounded-lg p-2 overflow-x-auto border border-border-subtle">
            {event.details}
          </pre>
        )}

        <div className="mt-2 flex items-center gap-2 text-xs">
          <span className="text-text-muted">风险等级:</span>
          <span className={`font-medium ${riskColors[event.riskLevel]}`}>
            {event.riskLevel === "low" ? "低" : event.riskLevel === "medium" ? "中" : "高"}
          </span>
        </div>

        {isPending ? (
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => handleApprove("once")}
              className="px-3 py-1.5 rounded-lg bg-accent-green text-white text-sm hover:opacity-90 transition-opacity"
            >
              允许一次
            </button>
            <button
              onClick={() => handleApprove("session")}
              className="px-3 py-1.5 rounded-lg bg-accent-blue text-white text-sm hover:opacity-90 transition-opacity"
            >
              本会话允许
            </button>
            <button
              onClick={handleReject}
              className="px-3 py-1.5 rounded-lg bg-bg-tertiary text-text-primary text-sm hover:bg-bg-primary transition-colors"
            >
              拒绝
            </button>
          </div>
        ) : (
          <div className="mt-2 text-sm text-text-muted">
            {event.status === "approved" ? "✅ 已批准" : "❌ 已拒绝"}
          </div>
        )}
      </div>
    </div>
  );
}
