import { describe, expect, it } from "vitest";
import { activeProcessPhaseStartedAt } from "../processTiming";

describe("activeProcessPhaseStartedAt", () => {
  it("starts waiting time from the latest link status instead of the whole turn", () => {
    expect(activeProcessPhaseStartedAt({
      eventTimestamp: 1_000,
      statusTimestamp: 12_000,
      hasContent: false,
    })).toBe(12_000);
  });

  it("uses the active tool or subagent start time", () => {
    expect(activeProcessPhaseStartedAt({
      eventTimestamp: 1_000,
      statusTimestamp: 12_000,
      runningToolTimestamps: [20_000, 18_000],
      runningSubagentTimestamps: [24_000],
      hasContent: true,
    })).toBe(24_000);
  });

  it("starts thinking at the first thinking event and output near the last one", () => {
    const base = {
      eventTimestamp: 1_000,
      statusTimestamp: 12_000,
      thinkingTimestamps: [16_000, 19_000],
    };
    expect(activeProcessPhaseStartedAt({ ...base, hasContent: false })).toBe(16_000);
    expect(activeProcessPhaseStartedAt({ ...base, hasContent: true })).toBe(19_000);
  });
});
