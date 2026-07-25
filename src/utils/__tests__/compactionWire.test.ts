import { describe, expect, it } from "vitest";
import { findOfficialCompactionResult } from "../../../electron/compactionWire";

describe("official compaction wire terminal", () => {
  it("finds the newest completion after the current request", () => {
    const content = [
      JSON.stringify({ type: "full_compaction.complete", time: 100 }),
      JSON.stringify({ type: "full_compaction.begin", source: "manual", time: 200 }),
      JSON.stringify({ type: "full_compaction.complete", time: 300 }),
    ].join("\n");

    expect(findOfficialCompactionResult(content, 200)).toEqual({
      terminal: {
        type: "full_compaction.complete",
        time: 300,
      },
    });
  });

  it("preserves cancellation and ignores older terminal records", () => {
    const content = [
      JSON.stringify({ type: "full_compaction.cancel", time: 100 }),
      "{broken",
      JSON.stringify({ type: "full_compaction.cancel", time: 400, reason: "aborted" }),
    ].join("\n");

    expect(findOfficialCompactionResult(content, 350)).toEqual({
      terminal: {
        type: "full_compaction.cancel",
        time: 400,
        reason: "aborted",
      },
    });
    expect(findOfficialCompactionResult(content, 500)).toBeNull();
  });

  it("returns the session usage written immediately before completion", () => {
    const usage = {
      type: "usage.record",
      model: "kimi-code/k3",
      usageScope: "session",
      usage: { inputOther: 5_879, inputCacheRead: 19_200, output: 1_294 },
      time: 290,
    };
    const content = [
      JSON.stringify({ type: "full_compaction.begin", time: 200 }),
      JSON.stringify(usage),
      JSON.stringify({ type: "full_compaction.complete", time: 300 }),
    ].join("\n");

    expect(findOfficialCompactionResult(content, 200)).toEqual({
      terminal: { type: "full_compaction.complete", time: 300 },
      usage,
    });
  });
});
