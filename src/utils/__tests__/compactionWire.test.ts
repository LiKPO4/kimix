import { describe, expect, it } from "vitest";
import { findOfficialCompactionTerminal } from "../../../electron/compactionWire";

describe("official compaction wire terminal", () => {
  it("finds the newest completion after the current request", () => {
    const content = [
      JSON.stringify({ type: "full_compaction.complete", time: 100 }),
      JSON.stringify({ type: "full_compaction.begin", source: "manual", time: 200 }),
      JSON.stringify({ type: "full_compaction.complete", time: 300 }),
    ].join("\n");

    expect(findOfficialCompactionTerminal(content, 200)).toEqual({
      type: "full_compaction.complete",
      time: 300,
    });
  });

  it("preserves cancellation and ignores older terminal records", () => {
    const content = [
      JSON.stringify({ type: "full_compaction.cancel", time: 100 }),
      "{broken",
      JSON.stringify({ type: "full_compaction.cancel", time: 400, reason: "aborted" }),
    ].join("\n");

    expect(findOfficialCompactionTerminal(content, 350)).toEqual({
      type: "full_compaction.cancel",
      time: 400,
      reason: "aborted",
    });
    expect(findOfficialCompactionTerminal(content, 500)).toBeNull();
  });
});
