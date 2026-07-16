import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TimelineEvent } from "@/types/ui";
import * as reportError from "@/utils/reportError";
import { shouldReplaceWithCanonicalKimiHistory } from "../kimiHistoryReconciliation";

const userMessage: TimelineEvent = {
  id: "user-1",
  type: "user_message",
  timestamp: 1,
  content: "hello",
};

function assistant(content: string, overrides: Partial<Extract<TimelineEvent, { type: "assistant_message" }>> = {}): TimelineEvent {
  return {
    id: `assistant-${content.slice(0, 8)}`,
    type: "assistant_message",
    timestamp: 2,
    content,
    isThinking: false,
    isComplete: true,
    ...overrides,
  };
}

function subagentWithContent(content: string, status: Extract<TimelineEvent, { type: "subagent" }>["status"] = "completed"): TimelineEvent {
  return {
    id: "sub-1",
    type: "subagent",
    timestamp: 2,
    agentId: "agent-1",
    agentName: "coder",
    status,
    events: [assistant(content)],
  };
}

function toolCall(name = "ReadFile"): TimelineEvent {
  return {
    id: "tool-1",
    type: "tool_call",
    timestamp: 2,
    toolCallId: "call-1",
    toolName: name,
    status: "success",
    arguments: {},
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("shouldReplaceWithCanonicalKimiHistory", () => {
  it("replaces when canonical has more assistant body text", () => {
    const local = [userMessage, assistant("short")];
    const canonical = [userMessage, assistant("much longer body text here")];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(true);
  });

  it("does not replace when canonical has less assistant body text", () => {
    const local = [userMessage, assistant("local has more content here")];
    const canonical = [userMessage, assistant("short")];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(false);
  });

  it("replaces when body text differs and canonical is longer", () => {
    const local = [userMessage, assistant("local body")];
    const canonical = [userMessage, assistant("canonical body text")];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(true);
  });

  it("does not replace when body text differs but canonical is shorter", () => {
    const local = [userMessage, assistant("local body text")];
    const canonical = [userMessage, assistant("short")];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(false);
  });

  it("does not replace when canonical is empty", () => {
    const local = [userMessage, assistant("local body")];
    const canonical: TimelineEvent[] = [];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(false);
  });

  it("replaces when canonical has more process events", () => {
    const local = [userMessage, assistant("body")];
    const canonical = [userMessage, toolCall(), assistant("body")];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(true);
  });

  it("does not replace when canonical has fewer process events", () => {
    const local = [userMessage, toolCall(), assistant("body")];
    const canonical = [userMessage, assistant("body")];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(false);
  });

  it("replaces when canonical has subagent content that local lacks", () => {
    const local = [userMessage, assistant("")];
    const canonical = [userMessage, subagentWithContent("subagent body")];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(true);
  });

  it("does not replace when local has subagent content but canonical lacks it", () => {
    const local = [userMessage, subagentWithContent("subagent body")];
    const canonical = [userMessage, assistant("")];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(false);
  });

  it("does not replace when canonical has fewer process events even if body text exists", () => {
    // Local has a real tool call; canonical only has body text. Replacing would lose the tool.
    const local = [userMessage, toolCall(), assistant("body")];
    const canonical = [userMessage, assistant("canonical body")];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(false);
  });

  it("replaces when canonical has more displayable user images", () => {
    const local = [userMessage, assistant("body")];
    const canonical: TimelineEvent[] = [{
      id: "user-2",
      type: "user_message",
      timestamp: 1,
      content: "with image",
      images: [{ name: "img.png", dataUrl: "data:image/png;base64,abc" }],
    }, assistant("body")];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(true);
  });

  it("replaces when canonical has different thinking", () => {
    const local = [userMessage, assistant("body", { thinking: "local thought" })];
    const canonical = [userMessage, assistant("body", { thinking: "canonical thought" })];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(true);
  });

  it("does not replace when canonical has different but shorter thinking", () => {
    const local = [userMessage, assistant("body", { thinking: "a much longer local thought here" })];
    const canonical = [userMessage, assistant("body", { thinking: "short" })];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(false);
  });

  it("does not replace when canonical is identical", () => {
    const events = [userMessage, assistant("same body")];
    expect(shouldReplaceWithCanonicalKimiHistory(events, events)).toBe(false);
  });
});

describe("shouldReplaceWithCanonicalKimiHistory instrumentation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("logs accepted reconciliation with context", () => {
    const logEventSpy = vi.spyOn(reportError, "logEvent").mockImplementation(() => {});
    const context = { sessionId: "s-1", roomAgentId: "agent-a", reason: "history-load" };
    const local = [userMessage, assistant("short")];
    const canonical = [userMessage, assistant("much longer canonical body text")];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical, context)).toBe(true);
    expect(logEventSpy).toHaveBeenCalledTimes(1);
    expect(logEventSpy).toHaveBeenCalledWith(
      "kimiHistoryReconciliation.accepted",
      expect.objectContaining({
        sessionId: "s-1",
        roomAgentId: "agent-a",
        reason: "history-load",
        localSize: "short".length,
        canonicalSize: "much longer canonical body text".length,
      }),
    );
  });

  it("logs rejected reconciliation when canonical has fewer process events", () => {
    const logEventSpy = vi.spyOn(reportError, "logEvent").mockImplementation(() => {});
    const context = { sessionId: "s-1", roomAgentId: "agent-a" };
    const local = [userMessage, toolCall(), assistant("body")];
    const canonical = [userMessage, assistant("body")];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical, context)).toBe(false);
    expect(logEventSpy).toHaveBeenCalledTimes(1);
    expect(logEventSpy).toHaveBeenCalledWith(
      "kimiHistoryReconciliation.rejected",
      expect.objectContaining({
        sessionId: "s-1",
        roomAgentId: "agent-a",
        reason: "process-history-regression",
        localProcessEvents: 1,
        canonicalProcessEvents: 0,
      }),
    );
  });

  it("does not log when no decision is made", () => {
    const logEventSpy = vi.spyOn(reportError, "logEvent").mockImplementation(() => {});
    const events = [userMessage, assistant("same body")];
    expect(shouldReplaceWithCanonicalKimiHistory(events, events)).toBe(false);
    expect(logEventSpy).not.toHaveBeenCalled();
  });
});
