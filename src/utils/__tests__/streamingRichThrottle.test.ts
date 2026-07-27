import { describe, expect, it } from "vitest";
import { nextStreamingRichTickDelay, STREAMING_RICH_INTERVAL_MS, STREAMING_RICH_SCROLL_RECHECK_MS } from "../streamingRichThrottle";

describe("nextStreamingRichTickDelay", () => {
  it("advances immediately when the interval has elapsed", () => {
    expect(nextStreamingRichTickDelay({ now: 1000, lastTickAt: 0, scrollActive: false })).toBe(0);
  });

  it("returns the remaining slice inside the interval", () => {
    expect(nextStreamingRichTickDelay({ now: 100, lastTickAt: 0, scrollActive: false })).toBe(STREAMING_RICH_INTERVAL_MS - 100);
  });

  it("never advances while the user is scrolling", () => {
    expect(nextStreamingRichTickDelay({ now: 1000, lastTickAt: 0, scrollActive: true })).toBe(STREAMING_RICH_SCROLL_RECHECK_MS);
  });
});
