import { describe, expect, it } from "vitest";
import type { Session, TimelineEvent } from "@/types/ui";
import { compareSessionsByRecentConversation, getSessionConversationActivityAt, hasActiveTimelineWorkEvents, hasOpenTimelineWorkEvents, isActiveKimiCodeEngineStatus, isSessionRuntimeRunning, isSessionSidebarBusy, isTerminalKimiCodeEngineStatus, isTimelineEventActive } from "../sessionActivity";

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
  });

  it("recognizes official states that must keep a restored session busy", () => {
    expect(isActiveKimiCodeEngineStatus("running")).toBe(true);
    expect(isActiveKimiCodeEngineStatus("waiting_approval")).toBe(true);
    expect(isActiveKimiCodeEngineStatus("waiting_question")).toBe(true);
    expect(isActiveKimiCodeEngineStatus("completed")).toBe(false);
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

    expect(isSessionSidebarBusy(loading, null, "other-session", 1)).toBe(false);
    expect(isSessionSidebarBusy(loading, null, loading.id, 1)).toBe(true);
    expect(isSessionSidebarBusy({ ...loading, isLoading: false }, loading.runtimeSessionId ?? null, "other-session", 1)).toBe(true);
  });
});
