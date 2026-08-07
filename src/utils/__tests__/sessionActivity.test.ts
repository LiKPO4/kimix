import { describe, expect, it } from "vitest";
import type { Session, TimelineEvent } from "@/types/ui";
import { compareSessionsByRecentConversation, getNextTimelineWorkExpiryAt, getSessionConversationActivityAt, hasActiveTimelineWorkEvents, hasOpenTimelineWorkEvents, isActiveKimiCodeEngineStatus, isOfficialTerminalLastTurnReason, isSessionOfficialFailed, isSessionRuntimeRunning, isSessionRuntimeTracked, isSessionSidebarBusy, isTerminalKimiCodeEngineStatus, isTimelineEventActive, normalizeOfficialLastTurnReason } from "../sessionActivity";

function session(events: TimelineEvent[] = []): Session {
  return {
    id: "ui-1",
    title: "Test",
    projectPath: "D:/WORKS/test",
    createdAt: 1,
    updatedAt: 1,
    events,
    engine: "kimi-code",
    runtimeSessionId: "runtime-1",
  };
}

describe("sessionActivity", () => {
  it("recognizes runtime states that must clear a stale running UI", () => {
    expect(isTerminalKimiCodeEngineStatus("completed")).toBe(true);
    expect(isTerminalKimiCodeEngineStatus("idle")).toBe(true);
    expect(isTerminalKimiCodeEngineStatus("running")).toBe(false);
    expect(isTerminalKimiCodeEngineStatus("waiting_question")).toBe(false);
    expect(isTerminalKimiCodeEngineStatus("unknown")).toBe(false);
  });

  it("recognizes official states that must keep a restored session busy", () => {
    expect(isActiveKimiCodeEngineStatus("running")).toBe(true);
    expect(isActiveKimiCodeEngineStatus("waiting_approval")).toBe(true);
    expect(isActiveKimiCodeEngineStatus("waiting_question")).toBe(true);
    expect(isActiveKimiCodeEngineStatus("completed")).toBe(false);
    expect(isActiveKimiCodeEngineStatus("unknown")).toBe(false);
    expect(isActiveKimiCodeEngineStatus(undefined)).toBe(false);
  });

  it("treats running tool work as active timeline work", () => {
    expect(hasActiveTimelineWorkEvents([
      { id: "tool-1", type: "tool_call", timestamp: 1, toolCallId: "call-1", toolName: "Bash", status: "running", arguments: {} },
    ], 1)).toBe(true);
  });

  it("uses runtime id and timeline activity for the shared running state", () => {
    expect(isSessionRuntimeRunning(session(), "runtime-1")).toBe(true);
    expect(isSessionRuntimeRunning(session([
      { id: "assistant-1", type: "assistant_message", timestamp: 1, content: "", isThinking: false, isComplete: false },
    ]), null, 1)).toBe(true);
    expect(isSessionRuntimeRunning(session(), null)).toBe(false);
  });

  it("does not treat timeline residue as an authoritative tracked runtime", () => {
    const withResidue = session([
      { id: "assistant-residue", type: "assistant_message", timestamp: 1, content: "Done", isThinking: false, isComplete: false },
    ]);

    expect(isSessionRuntimeTracked(withResidue, null)).toBe(false);
    expect(isSessionRuntimeTracked(withResidue, "ui-1")).toBe(true);
    expect(isSessionRuntimeTracked(withResidue, "runtime-1")).toBe(true);
  });

  it("does not keep stale timeline residue running forever", () => {
    const staleAssistant: TimelineEvent = {
      id: "assistant-stale",
      type: "assistant_message",
      timestamp: 1,
      content: "Done",
      isThinking: true,
      isComplete: false,
    };

    expect(isTimelineEventActive(staleAssistant, 1)).toBe(true);
    expect(isTimelineEventActive(staleAssistant, 1 + 3 * 60 * 1000)).toBe(false);
    expect(isSessionRuntimeRunning(session([staleAssistant]), null, 1 + 3 * 60 * 1000)).toBe(false);
  });

  it("can distinguish open work from recent active work for long swarm turns", () => {
    const longRunningSubagent: TimelineEvent = {
      id: "subagent-1",
      type: "subagent",
      timestamp: 1,
      agentId: "agent-1",
      agentName: "agent-1",
      status: "running",
      events: [],
    };

    expect(hasActiveTimelineWorkEvents([longRunningSubagent], 1 + 3 * 60 * 1000)).toBe(false);
    expect(hasOpenTimelineWorkEvents([longRunningSubagent])).toBe(true);
  });

  it("uses the latest message time instead of runtime metadata updates", () => {
    const restored = {
      ...session([
        { id: "user-1", type: "user_message", timestamp: 100, content: "Hello" },
        { id: "tool-1", type: "tool_call", timestamp: 900, toolCallId: "call-1", toolName: "Read", status: "completed", arguments: {} },
        { id: "assistant-1", type: "assistant_message", timestamp: 200, content: "Done", isThinking: false, isComplete: true },
      ]),
      updatedAt: 1_000,
    } satisfies Session;

    expect(getSessionConversationActivityAt(restored)).toBe(200);
  });

  it("moves recency forward after a new conversational message", () => {
    const active = session([
      { id: "assistant-1", type: "assistant_message", timestamp: 200, content: "Done", isThinking: false, isComplete: true },
      { id: "user-2", type: "user_message", timestamp: 500, content: "Continue" },
    ]);

    expect(getSessionConversationActivityAt(active)).toBe(500);
    expect(getSessionConversationActivityAt({ ...active, events: [], updatedAt: 700 })).toBe(700);
  });

  it("sorts by real conversation activity before metadata updatedAt", () => {
    const recentlyMessaged = {
      ...session([{ id: "user-recent", type: "user_message", timestamp: 900, content: "Recent" }]),
      id: "recent",
      updatedAt: 1_000,
    };
    const metadataOnlyNewer = {
      ...session([{ id: "user-old", type: "user_message", timestamp: 200, content: "Old" }]),
      id: "metadata",
      updatedAt: 2_000,
    };

    expect([metadataOnlyNewer, recentlyMessaged].sort(compareSessionsByRecentConversation).map((item) => item.id))
      .toEqual(["recent", "metadata"]);
  });

  it("shows transient loading only on the current session row", () => {
    const loading = { ...session(), isLoading: true };

    expect(isSessionSidebarBusy(loading, { runningSessionId: null, currentSessionId: "other-session", now: 1 })).toBe(false);
    expect(isSessionSidebarBusy(loading, { runningSessionId: null, currentSessionId: loading.id, now: 1 })).toBe(true);
    expect(isSessionSidebarBusy({ ...loading, isLoading: false }, {
      runningSessionId: loading.runtimeSessionId ?? null,
      currentSessionId: "other-session",
      now: 1,
    })).toBe(true);
  });

  it("does not keep the sidebar busy from stale local timeline residue", () => {
    const longRunning = session([
      { id: "assistant-1", type: "assistant_message", timestamp: 1, content: "", isThinking: false, isComplete: false },
    ]);
    const staleNow = 1 + 3 * 60 * 1000;

    expect(isSessionRuntimeRunning(longRunning, null, staleNow)).toBe(false);
    expect(isSessionSidebarBusy(longRunning, { runningSessionId: null, now: staleNow })).toBe(false);
  });

  it("keeps a genuinely long-running session busy from authoritative activity", () => {
    const longRunning = session([
      { id: "assistant-1", type: "assistant_message", timestamp: 1, content: "", isThinking: false, isComplete: false },
    ]);
    const staleNow = 1 + 3 * 60 * 1000;

    expect(isSessionSidebarBusy(longRunning, {
      runningSessionId: null,
      activities: [{
        roomId: longRunning.id,
        roomAgentId: "primary",
        status: "running",
        updatedAt: staleNow,
      }],
      now: staleNow,
    })).toBe(true);
  });

  it("lets an authoritative terminal status override incomplete local events immediately", () => {
    const residue = session([
      { id: "assistant-1", type: "assistant_message", timestamp: 100, content: "Done", isThinking: false, isComplete: false },
    ]);

    expect(isSessionSidebarBusy(residue, {
      runningSessionId: null,
      activities: [{
        roomId: residue.id,
        roomAgentId: "primary",
        status: "idle",
        updatedAt: 110,
      }],
      now: 120,
    })).toBe(false);
  });

  it("reports the next bounded fallback expiry so the sidebar can re-evaluate on time", () => {
    const events: TimelineEvent[] = [
      { id: "assistant-1", type: "assistant_message", timestamp: 100, content: "", isThinking: false, isComplete: false },
      { id: "tool-1", type: "tool_call", timestamp: 200, toolCallId: "call-1", toolName: "Read", status: "running", arguments: {} },
    ];

    expect(getNextTimelineWorkExpiryAt(events, 150)).toBe(100 + 2 * 60 * 1000);
    expect(getNextTimelineWorkExpiryAt(events, 100 + 2 * 60 * 1000)).toBe(200 + 2 * 60 * 1000);
    expect(getNextTimelineWorkExpiryAt(events, 200 + 2 * 60 * 1000)).toBeNull();
  });

  it("normalizes official last_turn_reason to the three known terminal values", () => {
    expect(normalizeOfficialLastTurnReason("completed")).toBe("completed");
    expect(normalizeOfficialLastTurnReason("cancelled")).toBe("cancelled");
    expect(normalizeOfficialLastTurnReason("failed")).toBe("failed");
    expect(normalizeOfficialLastTurnReason("running")).toBeUndefined();
    expect(normalizeOfficialLastTurnReason("")).toBeUndefined();
    expect(normalizeOfficialLastTurnReason(undefined)).toBeUndefined();
    expect(normalizeOfficialLastTurnReason(null)).toBeUndefined();
  });

  it("recognizes any official terminal last_turn_reason as terminal evidence", () => {
    expect(isOfficialTerminalLastTurnReason("completed")).toBe(true);
    expect(isOfficialTerminalLastTurnReason("cancelled")).toBe(true);
    expect(isOfficialTerminalLastTurnReason("failed")).toBe(true);
    expect(isOfficialTerminalLastTurnReason(undefined)).toBe(false);
  });

  it("marks only failed sessions with an official failure flag", () => {
    expect(isSessionOfficialFailed({ ...session(), officialLastTurnReason: "failed" })).toBe(true);
    expect(isSessionOfficialFailed({ ...session(), officialLastTurnReason: "cancelled" })).toBe(false);
    expect(isSessionOfficialFailed({ ...session(), officialLastTurnReason: "completed" })).toBe(false);
    expect(isSessionOfficialFailed(session())).toBe(false);
  });

  it("skips the timeline fallback when the official terminal reason is present", () => {
    const activeLocalEvent = session([
      { id: "assistant-1", type: "assistant_message", timestamp: 1, content: "", isThinking: false, isComplete: false },
    ]);

    // 时间窗内本地事件仍活跃，但官方终态字段直接判不 busy。
    expect(isSessionSidebarBusy(
      { ...activeLocalEvent, officialLastTurnReason: "completed" },
      { runningSessionId: null, now: 1 },
    )).toBe(false);
    expect(isSessionSidebarBusy(
      { ...activeLocalEvent, officialLastTurnReason: "cancelled" },
      { runningSessionId: null, now: 1 },
    )).toBe(false);
    expect(isSessionSidebarBusy(
      { ...activeLocalEvent, officialLastTurnReason: "failed" },
      { runningSessionId: null, now: 1 },
    )).toBe(false);
  });

  it("keeps the original timeline heuristic when the official reason is missing", () => {
    const activeLocalEvent = session([
      { id: "assistant-1", type: "assistant_message", timestamp: 1, content: "", isThinking: false, isComplete: false },
    ]);

    expect(isSessionSidebarBusy(activeLocalEvent, { runningSessionId: null, now: 1 })).toBe(true);
    expect(isSessionSidebarBusy(activeLocalEvent, { runningSessionId: null, now: 1 + 3 * 60 * 1000 })).toBe(false);
  });

  it("does not let the official terminal reason override an authoritative running runtime", () => {
    const sessionWithReason = {
      ...session([
        { id: "assistant-1", type: "assistant_message", timestamp: 1, content: "", isThinking: false, isComplete: false },
      ]),
      officialLastTurnReason: "completed" as const,
    };

    expect(isSessionSidebarBusy(sessionWithReason, {
      runningSessionId: sessionWithReason.runtimeSessionId ?? null,
      now: 1,
    })).toBe(true);
    expect(isSessionSidebarBusy(sessionWithReason, {
      runningSessionId: null,
      activities: [{
        roomId: sessionWithReason.id,
        roomAgentId: "primary",
        status: "running",
        updatedAt: 1,
      }],
      now: 1,
    })).toBe(true);
  });
});
