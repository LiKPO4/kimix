import { describe, expect, it } from "vitest";
import { assistantTurnStartedAt } from "../processTiming";

describe("assistantTurnStartedAt", () => {
  it("keeps the user turn start across process phase changes", () => {
    expect(assistantTurnStartedAt({
      turnStartedAt: 1_000,
      eventTimestamp: 12_000,
    })).toBe(1_000);
  });

  it("falls back to the first assistant event for legacy turns", () => {
    expect(assistantTurnStartedAt({ eventTimestamp: 12_000 })).toBe(12_000);
  });
});
