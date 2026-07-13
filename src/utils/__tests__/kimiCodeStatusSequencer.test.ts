import { afterEach, describe, expect, it, vi } from "vitest";
import { KimiCodeStatusSequencer } from "../../../electron/kimiCodeStatusSequencer";

describe("KimiCodeStatusSequencer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("forwards final turn usage before broadcasting completed", () => {
    vi.useFakeTimers();
    const emitted: string[] = [];
    const sequencer = new KimiCodeStatusSequencer((sessionId, status) => {
      emitted.push(`${sessionId}:${status}`);
    });

    sequencer.handle("reviewer", {
      type: "context.append_loop_event",
      event: { type: "step.end", finishReason: "end_turn" },
    });
    expect(emitted).toEqual([]);

    sequencer.handle("reviewer", {
      type: "usage.record",
      usageScope: "turn",
      usage: { inputOther: 264, inputCacheRead: 21_504, output: 20 },
    });
    expect(emitted).toEqual(["reviewer:completed"]);
  });

  it("falls back to completed when a provider omits final usage", () => {
    vi.useFakeTimers();
    const emitted: string[] = [];
    const sequencer = new KimiCodeStatusSequencer((sessionId, status) => {
      emitted.push(`${sessionId}:${status}`);
    }, 120);

    sequencer.handle("agent-a", {
      type: "context.append_loop_event",
      event: { type: "step.end", finishReason: "end_turn" },
    });
    vi.advanceTimersByTime(119);
    expect(emitted).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(emitted).toEqual(["agent-a:completed"]);
  });

  it("keeps terminal sequencing isolated per concurrent Agent", () => {
    vi.useFakeTimers();
    const emitted: string[] = [];
    const sequencer = new KimiCodeStatusSequencer((sessionId, status) => {
      emitted.push(`${sessionId}:${status}`);
    });
    const endTurn = {
      type: "context.append_loop_event",
      event: { type: "step.end", finishReason: "end_turn" },
    };

    sequencer.handle("reviewer", endTurn);
    sequencer.handle("primary", endTurn);
    sequencer.handle("reviewer", { type: "usage.record", usageScope: "turn" });
    expect(emitted).toEqual(["reviewer:completed"]);
    vi.advanceTimersByTime(120);
    expect(emitted).toEqual(["reviewer:completed", "primary:completed"]);
  });

  it("does not delay failed or interrupted terminal states", () => {
    const emitted: string[] = [];
    const sequencer = new KimiCodeStatusSequencer((sessionId, status) => {
      emitted.push(`${sessionId}:${status}`);
    });

    sequencer.handle("failed", { type: "turn.ended", reason: "failed" });
    sequencer.handle("cancelled", { type: "turn.ended", reason: "cancelled" });
    expect(emitted).toEqual(["failed:error", "cancelled:interrupted"]);
  });
});
