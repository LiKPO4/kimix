import { describe, expect, it } from "vitest";
import { shouldAppendRuntimeStatusToTimeline } from "../runtimeStatusTimeline";
import type { Session, TimelineEvent } from "@/types/ui";

const baseSession: Session = {
  id: "ui-1",
  title: "Demo",
  projectPath: "D:/demo",
  engine: "kimi-code",
  runtimeSessionId: "runtime-1",
  events: [],
  createdAt: 1,
  updatedAt: 1,
};

const status: TimelineEvent = {
  id: "status-1",
  type: "status_update",
  timestamp: 2,
  message: "模型：kimi-for-coding",
  tokenCount: 12,
  contextSize: 120,
  contextLimit: 1000,
};

describe("shouldAppendRuntimeStatusToTimeline", () => {
  it("drops idle agent status snapshots so permission changes do not rewrite assistant footers", () => {
    expect(shouldAppendRuntimeStatusToTimeline({
      rawType: "agent.status.updated",
      mappedEvent: status,
      session: {
        ...baseSession,
        events: [{
          id: "assistant-1",
          type: "assistant_message",
          timestamp: 1,
          content: "done",
          isComplete: true,
        }],
      },
      runtimeSessionId: "runtime-1",
      runningSessionId: null,
    })).toBe(false);
  });

  it("keeps live agent statuses and final usage records", () => {
    expect(shouldAppendRuntimeStatusToTimeline({
      rawType: "agent.status.updated",
      mappedEvent: status,
      session: baseSession,
      runtimeSessionId: "runtime-1",
      runningSessionId: "ui-1",
    })).toBe(true);

    expect(shouldAppendRuntimeStatusToTimeline({
      rawType: "usage.record",
      mappedEvent: status,
      session: baseSession,
      runtimeSessionId: "runtime-1",
      runningSessionId: null,
    })).toBe(true);
  });
});
