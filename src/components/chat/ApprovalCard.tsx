import { AlertTriangle, Check, X, ShieldCheck } from "lucide-react";
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
        sessionId: currentSession.runtimeSessionId ?? currentSession.id,
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
        sessionId: currentSession.runtimeSessionId ?? currentSession.id,
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

  const isPending = event.status === "pending";

  return (
    <div className="flex justify-center">
      <div className="max-w-[90%] w-full rounded-2xl border border-border-default bg-bg-secondary px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <AlertTriangle size={16} className="text-accent-orange shrink-0" />
          <span>工具请求: {event.description}</span>
        </div>

        {event.details && (
          <pre className="mt-2 text-xs text-text-secondary bg-bg-primary rounded-xl p-3 overflow-x-auto border border-border-subtle font-mono leading-relaxed">
            {event.details}
          </pre>
        )}

        {isPending ? (
          <div className="mt-3 flex flex-wrap gap-2.5">
            <button
              onClick={() => handleApprove("once")}
              className="kimix-icon-text-button bg-accent-green text-white text-sm hover:opacity-90"
            >
              <Check size={14} />
              <span>允许一次</span>
            </button>
            <button
              onClick={() => handleApprove("session")}
              className="kimix-icon-text-button bg-accent-blue text-white text-sm hover:opacity-90"
            >
              <ShieldCheck size={14} />
              <span>本会话允许</span>
            </button>
            <button
              onClick={handleReject}
              className="kimix-icon-text-button bg-bg-hover text-text-primary text-sm hover:bg-bg-tertiary"
            >
              <X size={14} />
              <span>拒绝</span>
            </button>
          </div>
        ) : (
          <div className="mt-2 text-sm text-text-muted">
            {event.status === "approved" ? (
              <span className="flex items-center gap-1 text-accent-green">
                <Check size={14} /> 已批准
              </span>
            ) : (
              <span className="flex items-center gap-1 text-accent-red">
                <X size={14} /> 已拒绝
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
