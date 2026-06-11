import { describe, it, expect } from "vitest";
import {
  countUserTurns,
  getLatestStatus,
  isEmptyStatusUpdate,
  getLatestMetricStatus,
  getLatestMeaningfulStatus,
  getSessionRecommendationMetrics,
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
