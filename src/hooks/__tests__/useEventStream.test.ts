import { describe, expect, it, beforeEach } from "vitest";
import type { TimelineEvent } from "@/types/ui";
import {
  applyActiveTurnDraftDelta,
  getActiveTurnDraft,
  makeActiveTurnDraftKey,
  resetActiveTurnDraftStoreForTests,
} from "@/utils/activeTurnDraftStore";
import { coalesceStreamEventBatch, commitActiveTurnDraftsToBatch } from "../useEventStream";

function assistant(content: string, patch: Partial<Extract<TimelineEvent, { type: "assistant_message" }>> = {}): TimelineEvent {
  return {
    id: patch.id ?? crypto.randomUUID(),
    type: "assistant_message",
    timestamp: patch.timestamp ?? Date.now(),
    content,
    thinking: patch.thinking,
    thinkingParts: patch.thinkingParts,
    isThinking: patch.isThinking ?? false,
    isComplete: patch.isComplete ?? false,
    agentTurnId: patch.agentTurnId ?? "turn-1",
    roomAgentId: patch.roomAgentId ?? "agent-1",
    ...patch,
  };
}

describe("coalesceStreamEventBatch", () => {
  it("combines adjacent assistant text and thinking deltas", () => {
    const result = coalesceStreamEventBatch([
      assistant("第一段", { thinking: "先想" }),
      assistant("第二段", { thinking: "再想" }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "assistant_message",
      content: "第一段第二段",
      thinking: "先想再想",
      isComplete: false,
    });
  });

  it("never coalesces history replay from different stable snapshot messages", () => {
    const result = coalesceStreamEventBatch([
      assistant("第一条官方回复", {
        snapshotMessageId: "msg-000048",
        snapshotMessageIdStable: true,
      }),
      assistant("第二条官方回复", {
        snapshotMessageId: "msg-000051",
        snapshotMessageIdStable: true,
      }),
    ]);

    expect(result).toHaveLength(2);
    expect(result).toEqual([
      expect.objectContaining({ content: "第一条官方回复", snapshotMessageId: "msg-000048" }),
      expect.objectContaining({ content: "第二条官方回复", snapshotMessageId: "msg-000051" }),
    ]);
  });

  it("keeps terminal, tool-boundary, and different-turn events independent", () => {
    const tool: TimelineEvent = {
      id: "tool-1",
      type: "tool_call",
      timestamp: 3,
      toolCallId: "call-1",
      toolName: "Shell",
      status: "running",
      arguments: {},
      roomAgentId: "agent-1",
      agentTurnId: "turn-1",
    };
    const result = coalesceStreamEventBatch([
      assistant("A", { timestamp: 1 }),
      assistant("", { timestamp: 2, isComplete: true }),
      tool,
      assistant("B", { timestamp: 4 }),
      assistant("C", { timestamp: 5, agentTurnId: "turn-2" }),
    ]);

    expect(result).toHaveLength(5);
    expect(result.map((event) => event.type)).toEqual([
      "assistant_message",
      "assistant_message",
      "tool_call",
      "assistant_message",
      "assistant_message",
    ]);
  });
});

describe("commitActiveTurnDraftsToBatch", () => {
  beforeEach(() => {
    resetActiveTurnDraftStoreForTests();
  });

  it("materializes draft text ahead of a boundary event", () => {
    const key = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");
    applyActiveTurnDraftDelta(key, assistant("流式正文", { agentTurnId: "turn-1", roomAgentId: "agent-1" }) as Extract<TimelineEvent, { type: "assistant_message" }>);
    const batches = new Map<string, { roomId: string; roomAgentId: string; items: TimelineEvent[] }>();
    commitActiveTurnDraftsToBatch(batches, {
      sessionId: "session-1",
      roomAgentId: "agent-1",
      agentTurnId: "turn-1",
    });

    const batch = batches.get(JSON.stringify(["session-1", "agent-1"]));
    expect(batch?.items).toHaveLength(1);
    expect(batch?.items[0]).toMatchObject({
      type: "assistant_message",
      content: "流式正文",
      isComplete: false,
      agentTurnId: "turn-1",
    });
    expect(getActiveTurnDraft(key)).toBeNull();
  });
});
