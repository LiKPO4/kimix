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

  it("does not complete a prompt-scoped Server run at intermediate turn boundaries", () => {
    vi.useFakeTimers();
    const emitted: string[] = [];
    const sequencer = new KimiCodeStatusSequencer((sessionId, status) => {
      emitted.push(`${sessionId}:${status}`);
    });

    sequencer.handle("server", { type: "turn.started" }, "prompt");
    sequencer.handle("server", { type: "turn.ended", reason: "completed" }, "prompt");
    sequencer.handle("server", { type: "usage.record", usageScope: "turn" }, "prompt");
    vi.advanceTimersByTime(1_000);

    expect(emitted).toEqual(["server:running"]);
  });
});


describe("subagent-scoped frames never drive session status", () => {
  it("ignores a subagent turn.ended(failed) instead of emitting error for the main session", () => {
    const emitted: string[] = [];
    const sequencer = new KimiCodeStatusSequencer((sessionId, status) => {
      emitted.push(`${sessionId}:${status}`);
    });

    sequencer.handle("sess", { type: "turn.ended", reason: "failed", agentId: "agent-37" }, "prompt");
    expect(emitted).toEqual([]);
  });

  it("ignores subagent turn.ended(cancelled) and turn.started", () => {
    const emitted: string[] = [];
    const sequencer = new KimiCodeStatusSequencer((sessionId, status) => {
      emitted.push(`${sessionId}:${status}`);
    });

    sequencer.handle("sess", { type: "turn.started", agentId: "agent-37" }, "prompt");
    sequencer.handle("sess", { type: "turn.ended", reason: "cancelled", agentId: "agent-37" }, "prompt");
    expect(emitted).toEqual([]);
  });

  it("still emits error for main-agent failures (absent or explicit main agentId)", () => {
    const emitted: string[] = [];
    const sequencer = new KimiCodeStatusSequencer((sessionId, status) => {
      emitted.push(`${sessionId}:${status}`);
    });

    sequencer.handle("sess", { type: "turn.ended", reason: "failed" }, "prompt");
    sequencer.handle("sess", { type: "turn.ended", reason: "failed", agentId: "main" }, "prompt");
    expect(emitted).toEqual(["sess:error", "sess:error"]);
  });
});
