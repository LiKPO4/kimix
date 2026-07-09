import { describe, expect, it } from "vitest";
import { parseKimiUsagePayload, parseManagedUsagePayload } from "../../../electron/kimiUsage";

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

  it("parses resetHint from managed SDK rows", () => {
    const now = Date.parse("2026-07-07T03:34:47.000Z");
    const usage = parseManagedUsagePayload({
      kind: "ok",
      limits: [
        { label: "5h", used: 2, limit: 100, resetHint: "resets in 3h" },
      ],
      summary: { label: "weekly", used: 4, limit: 100, resetHint: "resets in 4d 8h" },
    }, now);

    expect(usage.periods[0].refreshAt).toBe(now + 3 * 60 * 60 * 1000);
    expect(usage.periods[1].refreshAt).toBe(now + (4 * 24 + 8) * 60 * 60 * 1000);
  });
});

describe("Kimi direct usage parser", () => {
  it("parses reset_in seconds and actual window duration", () => {
    const now = Date.parse("2026-07-07T03:34:47.000Z");
    const usage = parseKimiUsagePayload({
      limits: [
        {
          detail: { limit: 100, used: 23, reset_in: 10800 },
          window: { duration: 300, timeUnit: "MINUTE" },
        },
      ],
      usage: { limit: 700, used: 161, reset_in: 345600 },
    }, now);

    expect(usage.periods[0]).toMatchObject({
      label: "5小时",
      refreshAt: now + 10800 * 1000,
      windowMs: 300 * 60 * 1000,
    });
    expect(usage.periods[1]).toMatchObject({
      label: "本周",
      refreshAt: now + 345600 * 1000,
    });
  });
});
