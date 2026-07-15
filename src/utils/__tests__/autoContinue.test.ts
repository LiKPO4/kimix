import { describe, expect, it } from "vitest";
import { checkAutoContinueAfterEmptyTurn } from "@/utils/autoContinue";
import type { Session, TimelineEvent } from "@/types/ui";

function toolCallEvent(overrides: Partial<Extract<TimelineEvent, { type: "tool_call" }>> = {}): Extract<TimelineEvent, { type: "tool_call" }> {
  return {
    id: "t1",
    type: "tool_call",
    timestamp: 2,
    toolCallId: "tc1",
    toolName: "read",
    status: "success",
    arguments: {},
    rawArguments: "{}",
    ...overrides,
  } as Extract<TimelineEvent, { type: "tool_call" }>;
}

function baseSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    title: "Test",
    engine: "kimi-code",
    events: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  } as Session;
}

describe("checkAutoContinueAfterEmptyTurn", () => {
  it("does not continue in manual permission mode", () => {
    const events: TimelineEvent[] = [
      { id: "u1", type: "user_message", timestamp: 1, content: "hello" },
      toolCallEvent(),
    ];
    const session = baseSession({ events, permissionMode: "manual" });
    const result = checkAutoContinueAfterEmptyTurn({
      session,
      appPermissionMode: "auto",
      autoContinuedTurnKeys: new Set(),
    });
    expect(result.shouldContinue).toBe(false);
  });

  it("does not continue when there is assistant content", () => {
    const events: TimelineEvent[] = [
      { id: "u1", type: "user_message", timestamp: 1, content: "hello" },
      toolCallEvent(),
      { id: "a1", type: "assistant_message", timestamp: 3, content: "done", isThinking: false, isComplete: true },
    ];
    const session = baseSession({ events, permissionMode: "auto" });
    const result = checkAutoContinueAfterEmptyTurn({
      session,
      appPermissionMode: "auto",
      autoContinuedTurnKeys: new Set(),
    });
    expect(result.shouldContinue).toBe(false);
  });

  it("does not continue while a tool is still running", () => {
    const events: TimelineEvent[] = [
      { id: "u1", type: "user_message", timestamp: 1, content: "hello" },
      toolCallEvent({ status: "running" }),
    ];
    const session = baseSession({ events, permissionMode: "auto" });
    const result = checkAutoContinueAfterEmptyTurn({
      session,
      appPermissionMode: "auto",
      autoContinuedTurnKeys: new Set(),
    });
    expect(result.shouldContinue).toBe(false);
  });

  it("continues when a tool completed but no assistant output was produced", () => {
    const events: TimelineEvent[] = [
      { id: "u1", type: "user_message", timestamp: 1, content: "hello" },
      toolCallEvent(),
    ];
    const session = baseSession({ events, permissionMode: "auto" });
    const result = checkAutoContinueAfterEmptyTurn({
      session,
      appPermissionMode: "auto",
      autoContinuedTurnKeys: new Set(),
    });
    expect(result.shouldContinue).toBe(true);
  });

  it("continues when a subagent completed but no assistant output was produced", () => {
    const events: TimelineEvent[] = [
      { id: "u1", type: "user_message", timestamp: 1, content: "hello" },
      {
        id: "s1",
        type: "subagent",
        timestamp: 2,
        agentId: "agent-1",
        agentName: "coder",
        status: "completed",
        events: [],
      },
    ];
    const session = baseSession({ events, permissionMode: "auto" });
    const result = checkAutoContinueAfterEmptyTurn({
      session,
      appPermissionMode: "auto",
      autoContinuedTurnKeys: new Set(),
    });
    expect(result.shouldContinue).toBe(true);
  });

  it("does not continue the same turn twice", () => {
    const events: TimelineEvent[] = [
      { id: "u1", type: "user_message", timestamp: 1, content: "hello" },
      toolCallEvent(),
    ];
    const session = baseSession({ events, permissionMode: "auto" });
    const turnKey = `${session.id}:primary:last-user-turn`;
    const result = checkAutoContinueAfterEmptyTurn({
      session,
      appPermissionMode: "auto",
      autoContinuedTurnKeys: new Set([turnKey]),
    });
    expect(result.shouldContinue).toBe(false);
  });

  it("does not continue when waiting for approval", () => {
    const events: TimelineEvent[] = [
      { id: "u1", type: "user_message", timestamp: 1, content: "hello" },
      toolCallEvent(),
      { id: "a1", type: "approval_request", timestamp: 3, requestId: "r1", status: "pending", toolName: "write", description: "write file", details: "", riskLevel: "high" },
    ];
    const session = baseSession({ events, permissionMode: "auto" });
    const result = checkAutoContinueAfterEmptyTurn({
      session,
      appPermissionMode: "auto",
      autoContinuedTurnKeys: new Set(),
    });
    expect(result.shouldContinue).toBe(false);
  });

  it("does not continue long task sessions", () => {
    const events: TimelineEvent[] = [
      { id: "u1", type: "user_message", timestamp: 1, content: "hello" },
      toolCallEvent(),
    ];
    const session = baseSession({
      events,
      permissionMode: "auto",
      longTask: {
        taskId: "task-1",
        title: "Task",
        stage: "running",
        activeAgent: "executor",
        currentStep: 1,
        targetStep: 5,
        executorSessionId: "exec-1",
        reviewerSessionId: "rev-1",
        bigPlanPath: "/tmp/bigplan.md",
        reviewQueuePath: "/tmp/review.md",
        reviewedReviewItems: [],
        recovery: null,
      },
    });
    const result = checkAutoContinueAfterEmptyTurn({
      session,
      appPermissionMode: "auto",
      autoContinuedTurnKeys: new Set(),
    });
    expect(result.shouldContinue).toBe(false);
  });

  it("does not continue non-kimi-code sessions", () => {
    const events: TimelineEvent[] = [
      { id: "u1", type: "user_message", timestamp: 1, content: "hello" },
      toolCallEvent(),
    ];
    const session = baseSession({ events, permissionMode: "auto", engine: "prompt" });
    const result = checkAutoContinueAfterEmptyTurn({
      session,
      appPermissionMode: "auto",
      autoContinuedTurnKeys: new Set(),
    });
    expect(result.shouldContinue).toBe(false);
  });
});
