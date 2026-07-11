import type { Session, TimelineEvent } from "@/types/ui";

type ApprovalRequest = Extract<TimelineEvent, { type: "approval_request" }>;

export function findNotificationSession(sessions: Session[], sessionId: string) {
  return sessions.find((session) => (
    session.id === sessionId || session.runtimeSessionId === sessionId || session.officialSessionId === sessionId
  ));
}

export function approvalRequestNotificationKey(event: ApprovalRequest) {
  return event.requestId || event.id;
}

export function summarizeApprovalRequest(event: ApprovalRequest) {
  return event.display?.title || event.description || event.details || event.toolName || "工具操作等待审批";
}
