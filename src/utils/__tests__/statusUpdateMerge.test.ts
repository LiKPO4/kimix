import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "@/types/ui";
import { mergeEvents } from "@/utils/eventMapper";

describe("mergeEvents status usage", () => {
  it("preserves final usage when a later status snapshot omits token fields", () => {
    const usage: TimelineEvent = {
      id: "usage",
      type: "status_update",
      timestamp: 10,
      message: "模型：kimi-for-coding",
      inputTokenCount: 21_860,
      tokenCount: 22,
      contextSize: 21_882,
      contextLimit: 262_144,
    };
    const completedSnapshot: TimelineEvent = {
      id: "completed",
      type: "status_update",
      timestamp: 11,
      message: undefined,
      inputTokenCount: undefined,
      tokenCount: undefined,
      contextSize: undefined,
      contextLimit: undefined,
    };

    expect(mergeEvents([usage], completedSnapshot)).toEqual([{
      ...completedSnapshot,
      message: usage.message,
      inputTokenCount: usage.inputTokenCount,
      tokenCount: usage.tokenCount,
      contextSize: usage.contextSize,
      contextLimit: usage.contextLimit,
    }]);
  });

  it("allows a later concrete usage snapshot to replace earlier values", () => {
    const first: TimelineEvent = {
      id: "first",
      type: "status_update",
      timestamp: 10,
      inputTokenCount: 10,
      tokenCount: 2,
    };
    const final: TimelineEvent = {
      id: "final",
      type: "status_update",
      timestamp: 11,
      inputTokenCount: 20,
      tokenCount: 4,
    };

    expect(mergeEvents([first], final)).toEqual([final]);
  });
});
