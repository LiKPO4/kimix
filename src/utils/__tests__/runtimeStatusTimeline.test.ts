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
          isThinking: false,
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

  it("does not let another running room Agent keep an inactive Agent snapshot alive", () => {
    expect(shouldAppendRuntimeStatusToTimeline({
      rawType: "agent.status.updated",
      mappedEvent: status,
      session: {
        ...baseSession,
        events: [{
          id: "assistant-reviewer",
          type: "assistant_message",
          timestamp: 1,
          content: "REVIEWER_OK",
          isThinking: false,
          isComplete: true,
        }],
      },
      runtimeSessionId: "reviewer-runtime",
      runningSessionId: "ui-1",
      runtimeActive: false,
    })).toBe(false);
  });
  it("lets a late realtime metric frame through right after settle so the usage card completes", () => {
    const now = Date.now();
    expect(shouldAppendRuntimeStatusToTimeline({
      rawType: "agent.status.updated",
      mappedEvent: status,
      session: {
        ...baseSession,
        events: [{
          id: "assistant-1",
          type: "assistant_message",
          timestamp: now - 30_000,
          content: "done",
          isThinking: false,
          isComplete: true,
        }],
      },
      runtimeSessionId: "runtime-1",
      runningSessionId: null,
    })).toBe(true);
  });

  it("drops tagged snapshot frames even when fresh and carrying context metrics", () => {
    const now = Date.now();
    expect(shouldAppendRuntimeStatusToTimeline({
      rawType: "agent.status.updated",
      mappedEvent: { ...status, source: "status_refresh" },
      session: {
        ...baseSession,
        events: [{
          id: "assistant-1",
          type: "assistant_message",
          timestamp: now - 1_000,
          content: "done",
          isThinking: false,
          isComplete: true,
        }],
      },
      runtimeSessionId: "runtime-1",
      runningSessionId: null,
    })).toBe(false);
  });

  it("drops realtime frames without turn metrics after settle", () => {
    const now = Date.now();
    expect(shouldAppendRuntimeStatusToTimeline({
      rawType: "agent.status.updated",
      mappedEvent: { id: "status-bare", type: "status_update", timestamp: now - 1_000 },
      session: {
        ...baseSession,
        events: [{
          id: "assistant-1",
          type: "assistant_message",
          timestamp: now - 1_000,
          content: "done",
          isThinking: false,
          isComplete: true,
        }],
      },
      runtimeSessionId: "runtime-1",
      runningSessionId: null,
    })).toBe(false);
  });

  it("drops late metric frames when the session's latest event is stale", () => {
    const now = Date.now();
    expect(shouldAppendRuntimeStatusToTimeline({
      rawType: "agent.status.updated",
      mappedEvent: status,
      session: {
        ...baseSession,
        events: [{
          id: "assistant-1",
          type: "assistant_message",
          timestamp: now - 130_000,
          content: "done",
          isThinking: false,
          isComplete: true,
        }],
      },
      runtimeSessionId: "runtime-1",
      runningSessionId: null,
    })).toBe(false);
  });
});
