import { describe, it, expect } from "vitest";
import {
  countUserTurns,
  getLatestStatus,
  isEmptyStatusUpdate,
  getLatestMetricStatus,
  getLatestMeaningfulStatus,
  getSessionContextUsages,
  getSessionRecommendationMetrics,
  shouldShowInlineStatusUpdate,
  shouldRenderStandaloneStatusUpdate,
  shouldRecommendNewSession,
} from "../sessionMetrics";
import type { Session, TimelineEvent } from "@/types/ui";

function makeSession(events: TimelineEvent[]): Session {
  return {
    id: "s1",
    title: "Test",
    projectPath: "/tmp",
    createdAt: 1,
    updatedAt: 1,
    events,
    isLoading: false,
  };
}

describe("countUserTurns", () => {
  it("counts user_message events", () => {
    const events: TimelineEvent[] = [
      { id: "1", type: "user_message", timestamp: 1, content: "a" },
      { id: "2", type: "assistant_message", timestamp: 2, content: "b", isThinking: false, isComplete: true },
      { id: "3", type: "user_message", timestamp: 3, content: "c" },
    ];
    expect(countUserTurns(events)).toBe(2);
  });

  it("returns 0 for empty events", () => {
    expect(countUserTurns([])).toBe(0);
  });
});

describe("getLatestStatus", () => {
  it("returns the last status_update", () => {
    const events: TimelineEvent[] = [
      { id: "1", type: "status_update", timestamp: 1, tokenCount: 10, inputTokenCount: 5, contextSize: 100, contextLimit: 256000 },
      { id: "2", type: "status_update", timestamp: 2, tokenCount: 20, inputTokenCount: 10, contextSize: 200, contextLimit: 256000 },
    ];
    expect(getLatestStatus(events)?.tokenCount).toBe(20);
  });

  it("returns undefined when no status updates", () => {
    expect(getLatestStatus([])).toBeUndefined();
  });
});

describe("isEmptyStatusUpdate", () => {
  it("returns true for all-zero status", () => {
    expect(
      isEmptyStatusUpdate({ id: "1", type: "status_update", timestamp: 1, tokenCount: 0, inputTokenCount: 0, contextSize: 0, contextLimit: 256000 }),
    ).toBe(true);
  });

  it("returns false when any metric is non-zero", () => {
    expect(
      isEmptyStatusUpdate({ id: "1", type: "status_update", timestamp: 1, tokenCount: 1, inputTokenCount: 0, contextSize: 0, contextLimit: 256000 }),
    ).toBe(false);
  });

  it("returns false when status only has a message", () => {
    expect(
      isEmptyStatusUpdate({ id: "1", type: "status_update", timestamp: 1, message: "已接收本地指令：/goal status", source: "slash" }),
    ).toBe(false);
  });

  it("treats model-only zero status as empty", () => {
    expect(
      isEmptyStatusUpdate({ id: "1", type: "status_update", timestamp: 1, message: "模型：kimi-for-coding", tokenCount: 0, inputTokenCount: 0, contextSize: 0, contextLimit: 256000 }),
    ).toBe(true);
  });

  it("treats internal step-only statuses as empty", () => {
    expect(
      isEmptyStatusUpdate({ id: "1", type: "status_update", timestamp: 1, step: 2, message: "步骤 2中断：已中断" }),
    ).toBe(true);
    expect(
      isEmptyStatusUpdate({ id: "2", type: "status_update", timestamp: 2, step: 2, message: "输出打断" }),
    ).toBe(true);
  });
});

describe("getLatestMeaningfulStatus", () => {
  it("skips empty statuses", () => {
    const events: TimelineEvent[] = [
      { id: "1", type: "status_update", timestamp: 1, tokenCount: 0, inputTokenCount: 0, contextSize: 0, contextLimit: 256000 },
      { id: "2", type: "status_update", timestamp: 2, tokenCount: 5, inputTokenCount: 0, contextSize: 0, contextLimit: 256000 },
    ];
    expect(getLatestMeaningfulStatus(events)?.tokenCount).toBe(5);
  });

  it("returns undefined when all empty", () => {
    const events: TimelineEvent[] = [
      { id: "1", type: "status_update", timestamp: 1, tokenCount: 0, inputTokenCount: 0, contextSize: 0, contextLimit: 256000 },
    ];
    expect(getLatestMeaningfulStatus(events)).toBeUndefined();
  });
});

describe("getLatestMetricStatus", () => {
  it("skips message-only statuses so context metrics do not reset to zero", () => {
    const events: TimelineEvent[] = [
      { id: "1", type: "status_update", timestamp: 1, tokenCount: 20, inputTokenCount: 10, contextSize: 1200, contextLimit: 256000 },
      { id: "2", type: "status_update", timestamp: 2, message: "模型：kimi-for-coding" },
    ];
    expect(getLatestMetricStatus(events)?.contextSize).toBe(1200);
  });
});

describe("shouldShowInlineStatusUpdate", () => {
  it("keeps model-only statuses available for assistant footer bubbles", () => {
    const status: Extract<TimelineEvent, { type: "status_update" }> = {
      id: "1",
      type: "status_update",
      timestamp: 1,
      message: "模型：kimi-for-coding",
    };

    expect(isEmptyStatusUpdate(status)).toBe(true);
    expect(shouldShowInlineStatusUpdate(status)).toBe(true);
  });

  it("keeps zero metric statuses visible for assistant footer bubbles", () => {
    expect(
      shouldShowInlineStatusUpdate({ id: "1", type: "status_update", timestamp: 1, tokenCount: 0, inputTokenCount: 0, contextSize: 0, contextLimit: 256000 }),
    ).toBe(true);
  });

  it("keeps timestamp-only statuses visible for assistant footer bubbles", () => {
    expect(
      shouldShowInlineStatusUpdate({ id: "1", type: "status_update", timestamp: 1 }),
    ).toBe(true);
  });

  it("still hides transient retry and interrupted statuses in footer bubbles", () => {
    expect(
      shouldShowInlineStatusUpdate({ id: "1", type: "status_update", timestamp: 1, step: 2, message: "输出打断" }),
    ).toBe(false);
  });
});

describe("shouldRenderStandaloneStatusUpdate", () => {
  it("hides prompt-link ipc statuses from the standalone message stream", () => {
    expect(
      shouldRenderStandaloneStatusUpdate({
        id: "1",
        type: "status_update",
        timestamp: 1,
        message: "消息发送中",
        source: "ipc",
        parentEventId: "user-1",
      }),
    ).toBe(false);
  });

  it("keeps normal statuses eligible for standalone rendering", () => {
    expect(
      shouldRenderStandaloneStatusUpdate({
        id: "1",
        type: "status_update",
        timestamp: 1,
        message: "已接收本地指令：/status",
        source: "slash",
      }),
    ).toBe(true);
  });
});

describe("getSessionRecommendationMetrics", () => {
  it("computes metrics correctly", () => {
    const events: TimelineEvent[] = [
      { id: "1", type: "user_message", timestamp: 1, content: "a" },
      { id: "2", type: "assistant_message", timestamp: 2, content: "b", isThinking: false, isComplete: true },
    ];
    const metrics = getSessionRecommendationMetrics(makeSession(events), 10);
    expect(metrics.turnCount).toBe(1);
    expect(metrics.turnLimit).toBe(10);
    expect(metrics.remainingTurns).toBe(9);
    expect(metrics.turnPercent).toBe(10);
  });

  it("caps turnPercent at 100", () => {
    const events: TimelineEvent[] = Array.from({ length: 15 }, (_, i) => ({
      id: String(i),
      type: "user_message" as const,
      timestamp: i,
      content: "x",
    }));
    const metrics = getSessionRecommendationMetrics(makeSession(events), 10);
    expect(metrics.turnPercent).toBe(100);
  });

  it("defaults limit to 1 when given 0", () => {
    const metrics = getSessionRecommendationMetrics(makeSession([]), 0);
    expect(metrics.turnLimit).toBe(1);
  });
});

describe("getSessionContextUsages", () => {
  it("returns independent context usage for every active room agent", () => {
    const session: Session = {
      ...makeSession([]),
      collaboration: {
        schemaVersion: 1,
        primaryMirrorUpdatedAt: 1,
        primaryAgentId: "agent-a",
        defaultRecipientIds: ["agent-a", "agent-b"],
        messages: [],
        agents: [
          { id: "agent-a", displayName: "审查", mentionName: "review", modelAlias: "model-a", modelLabelSnapshot: "Model A", permissionMode: "manual", createdAt: 1 },
          { id: "agent-b", displayName: "实现", mentionName: "build", modelAlias: "model-b", modelLabelSnapshot: "Model B", permissionMode: "manual", createdAt: 2 },
          { id: "agent-removed", displayName: "旧 Agent", mentionName: "old", modelAlias: "model-old", permissionMode: "manual", createdAt: 3, removedAt: 4 },
        ],
        agentEvents: {
          "agent-a": [{ id: "a-status", type: "status_update", timestamp: 2, contextSize: 0.25, contextLimit: 200000 }],
          "agent-b": [{ id: "b-status", type: "status_update", timestamp: 3, contextSize: 90000, contextLimit: 300000 }],
          "agent-removed": [{ id: "old-status", type: "status_update", timestamp: 4, contextSize: 1000, contextLimit: 10000 }],
        },
      },
    };

    expect(getSessionContextUsages(session)).toEqual([
      expect.objectContaining({ agentId: "agent-a", modelLabel: "Model A", isPrimary: true, used: 50000, limit: 200000, percent: 25 }),
      expect.objectContaining({ agentId: "agent-b", modelLabel: "Model B", isPrimary: false, used: 90000, limit: 300000, percent: 30 }),
    ]);
  });

  it("does not report missing room context metrics as zero percent usage", () => {
    const session: Session = {
      ...makeSession([]),
      model: "model-a",
      events: [{ id: "status", type: "status_update", timestamp: 1, tokenCount: 12, contextSize: 0, contextLimit: 256000 }],
    };

    expect(getSessionContextUsages(session)[0]).toEqual(expect.objectContaining({
      modelLabel: "model-a",
      hasContext: false,
      used: 0,
      percent: 0,
    }));
  });
});

describe("shouldRecommendNewSession", () => {
  it("returns false when disabled", () => {
    expect(shouldRecommendNewSession(makeSession([]), false, 10)).toBe(false);
  });

  it("returns false when under limit", () => {
    const session = makeSession([
      { id: "1", type: "user_message", timestamp: 1, content: "a" },
    ]);
    expect(shouldRecommendNewSession(session, true, 10)).toBe(false);
  });

  it("returns true when at limit", () => {
    const session = makeSession([
      { id: "1", type: "user_message", timestamp: 1, content: "a" },
      { id: "2", type: "user_message", timestamp: 2, content: "b" },
    ]);
    expect(shouldRecommendNewSession(session, true, 2)).toBe(true);
  });
});
