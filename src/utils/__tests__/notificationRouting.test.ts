import { describe, expect, it } from "vitest";
import type { Session, TimelineEvent } from "@/types/ui";
import { approvalRequestNotificationKey, findNotificationSession, summarizeApprovalRequest } from "../notificationRouting";

function session(id: string, runtimeSessionId?: string, officialSessionId?: string): Session {
  return {
    id,
    runtimeSessionId,
    officialSessionId,
    title: id,
    projectPath: "D:\\work",
    createdAt: 1,
    updatedAt: 1,
    events: [],
    isLoading: false,
  };
}

describe("notification routing", () => {
  it("finds a visible session from local, runtime, or official identity", () => {
    const sessions = [session("local", "runtime", "official")];
    expect(findNotificationSession(sessions, "local")?.id).toBe("local");
    expect(findNotificationSession(sessions, "runtime")?.id).toBe("local");
    expect(findNotificationSession(sessions, "official")?.id).toBe("local");
    expect(findNotificationSession(sessions, "missing")).toBeUndefined();
  });

  it("uses the stable official request id for approval deduplication", () => {
    const approval = {
      id: "event-1",
      type: "approval_request" as const,
      timestamp: 1,
      requestId: "request-1",
      toolName: "Shell",
      description: "运行命令",
      details: "pnpm test",
      riskLevel: "medium" as const,
      status: "pending" as const,
    } satisfies TimelineEvent;
    expect(approvalRequestNotificationKey(approval)).toBe("request-1");
    expect(summarizeApprovalRequest(approval)).toBe("运行命令");
  });
});
