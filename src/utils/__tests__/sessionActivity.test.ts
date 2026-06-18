import { describe, expect, it } from "vitest";
import type { Session, TimelineEvent } from "@/types/ui";
import { hasActiveTimelineWorkEvents, isSessionRuntimeRunning, isTerminalKimiCodeEngineStatus, isTimelineEventActive } from "../sessionActivity";

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
});
