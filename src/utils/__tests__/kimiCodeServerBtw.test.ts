import { describe, expect, it } from "vitest";
import { consumeBtwEvent, type BtwRun } from "../../../electron/kimiCodeHost";

describe("Kimi Server BTW event isolation", () => {
  it("collects the matching BTW agent without consuming main-agent events", () => {
    const run: BtwRun = {
      agentId: "agent-btw",
      parts: [],
      thinkingParts: [],
      ended: false,
    };
    const runs = new Map([[run.agentId, run]]);

    expect(consumeBtwEvent(runs, { type: "thinking.delta", agentId: "agent-btw", delta: "分析" })).toBe(true);
    expect(consumeBtwEvent(runs, { type: "assistant.delta", agentId: "agent-btw", delta: "答案" })).toBe(true);
    expect(consumeBtwEvent(runs, { type: "assistant.delta", agentId: "main", delta: "主对话" })).toBe(false);
    expect(consumeBtwEvent(runs, { type: "turn.ended", agentId: "agent-btw", reason: "completed" })).toBe(true);

    expect(run).toMatchObject({
      parts: ["答案"],
      thinkingParts: ["分析"],
      ended: true,
      endReason: "completed",
    });
  });

  it("keeps the official BTW failure reason for the panel", () => {
    const run: BtwRun = {
      agentId: "agent-btw",
      parts: [],
      thinkingParts: [],
      ended: false,
    };

    expect(consumeBtwEvent(new Map([[run.agentId, run]]), {
      type: "turn.ended",
      agentId: "agent-btw",
      reason: "failed",
      error: { code: "MODEL_ERROR", message: "upstream failed" },
    })).toBe(true);
    expect(run.ended).toBe(true);
    expect(run.error).toBe("MODEL_ERROR: upstream failed");
  });
});
