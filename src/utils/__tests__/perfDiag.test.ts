/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PERF_DIAG_KEY } from "@/utils/perfFlags";
import { getPerfDiagSnapshot, resetPerfDiagCounters, timeAsync, timeSync } from "@/utils/perfDiag";

describe("timeAsync", () => {
  beforeEach(() => {
    localStorage.setItem(PERF_DIAG_KEY, "1");
    resetPerfDiagCounters();
  });

  afterEach(() => {
    localStorage.clear();
    resetPerfDiagCounters();
  });

  it("accumulates the awaited time into the labeled bucket", async () => {
    const result = await timeAsync("test.asyncSection", async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return "done";
    });
    expect(result).toBe("done");

    const bucket = getPerfDiagSnapshot().timings["test.asyncSection"];
    expect(bucket.count).toBe(1);
    // Timer slack applies, but a 20ms awaited sleep must be visible.
    expect(bucket.totalMs).toBeGreaterThanOrEqual(15);
    expect(bucket.maxMs).toBe(bucket.totalMs);

    await timeAsync("test.asyncSection", async () => undefined);
    const updated = getPerfDiagSnapshot().timings["test.asyncSection"];
    expect(updated.count).toBe(2);
    expect(updated.totalMs).toBeGreaterThanOrEqual(bucket.totalMs);
    expect(updated.maxMs).toBeGreaterThanOrEqual(bucket.maxMs);
  });

  it("shares the bucket table with timeSync", async () => {
    timeSync("test.shared", () => 1);
    await timeAsync("test.shared", async () => 2);
    const bucket = getPerfDiagSnapshot().timings["test.shared"];
    expect(bucket.count).toBe(2);
  });

  it("skips measurement when the diag flag is off", async () => {
    localStorage.setItem(PERF_DIAG_KEY, "0");
    const result = await timeAsync("test.ungated", async () => "value");
    expect(result).toBe("value");
    expect(getPerfDiagSnapshot().timings["test.ungated"]).toBeUndefined();
  });
});
