import { describe, expect, it } from "vitest";
import { parseManagedUsagePayload } from "../../../electron/kimiUsage";

describe("Kimi managed usage parser", () => {
  it("fills refreshAt fallback for SDK managed usage rows", () => {
    const now = Date.parse("2026-07-07T03:34:47.000Z");
    const usage = parseManagedUsagePayload({
      kind: "ok",
      limits: [
        { label: "5h", used: 2, limit: 100 },
      ],
      summary: { label: "weekly", used: 4, limit: 100 },
    }, now);

    expect(usage.periods[0]).toMatchObject({
      label: "5小时",
      used: 2,
      limit: 100,
      refreshAt: now + 5 * 60 * 60 * 1000,
    });
    expect(usage.periods[1].refreshAt).toBe(new Date(2026, 6, 13, 0, 0, 0, 0).getTime());
  });

  it("uses explicit SDK refresh timestamps before fallback values", () => {
    const now = Date.parse("2026-07-07T03:34:47.000Z");
    const fiveHourReset = Date.parse("2026-07-07T04:38:47.000Z");
    const weeklyReset = Date.parse("2026-07-13T02:30:00.000Z");
    const usage = parseManagedUsagePayload({
      kind: "ok",
      limits: [
        { label: "5小时", used: 2, limit: 100, resetTime: fiveHourReset },
      ],
      summary: { label: "本周", used: 4, limit: 100, nextResetTime: weeklyReset },
    }, now);

    expect(usage.periods[0].refreshAt).toBe(fiveHourReset);
    expect(usage.periods[1].refreshAt).toBe(weeklyReset);
  });
});
