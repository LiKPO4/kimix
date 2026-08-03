import { describe, expect, it } from "vitest";
import { parseKimiUsagePayload, parseManagedUsagePayload, parseServerUsagePayload } from "../../../electron/kimiUsage";

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

  it("preserves normalized Extra Usage returned by the official SDK", () => {
    const usage = parseManagedUsagePayload({
      kind: "ok",
      summary: null,
      limits: [],
      extraUsage: {
        balanceCents: 10000,
        totalCents: 20000,
        monthlyChargeLimitEnabled: true,
        monthlyChargeLimitCents: 20000,
        monthlyUsedCents: 5000,
        currency: "usd",
      },
    });

    expect(usage.available).toBe(true);
    expect(usage.extraUsage).toEqual({
      balanceCents: 10000,
      totalCents: 20000,
      monthlyChargeLimitEnabled: true,
      monthlyChargeLimitCents: 20000,
      monthlyUsedCents: 5000,
      currency: "USD",
    });
  });

  it("ignores invalid normalized Extra Usage", () => {
    const usage = parseManagedUsagePayload({ kind: "ok", summary: null, limits: [], extraUsage: { totalCents: 0 } });
    expect(usage.extraUsage).toBeUndefined();
    expect(usage.available).toBe(false);
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

  it("parses the raw booster wallet when the SDK fallback is unavailable", () => {
    const usage = parseKimiUsagePayload({
      boosterWallet: {
        balance: { type: "BOOSTER", amount: "20000000000", amountLeft: "10000000000" },
        monthlyChargeLimitEnabled: false,
        monthlyUsed: { currency: "CNY", priceInCents: "1250" },
      },
    });

    expect(usage.extraUsage).toEqual({
      balanceCents: 10000,
      totalCents: 20000,
      monthlyChargeLimitEnabled: false,
      monthlyChargeLimitCents: 0,
      monthlyUsedCents: 1250,
      currency: "CNY",
    });
  });
});

describe("Kimi server usage parser (official /api/v1/oauth/usage)", () => {
  it("parses the server usage payload shape (summary.window + limits[].window, no label)", () => {
    const usage = parseServerUsagePayload({
      kind: "ok",
      summary: {
        window: { duration: 1, unit: "week" },
        used: 98,
        limit: 100,
        reset_at: "2026-08-05T08:36:42.880059Z",
      },
      limits: [
        { window: { duration: 5, unit: "hour" }, used: 11, limit: 100, reset_at: "2026-08-03T02:36:42.880059Z" },
      ],
      extra_usage: null,
    }, Date.parse("2026-08-03T02:40:00.000Z"));

    expect(usage.available).toBe(true);
    expect(usage.periods).toHaveLength(2);
    const fiveHour = usage.periods.find((period) => period.label === "5小时");
    const weekly = usage.periods.find((period) => period.label === "本周");
    expect(fiveHour).toMatchObject({ used: 11, limit: 100, percent: 11 });
    expect(weekly).toMatchObject({ used: 98, limit: 100, percent: 98 });
    expect(usage.source).toContain("Server");
  });

  it("parses a server usage payload with no windows as unavailable", () => {
    const usage = parseServerUsagePayload({ kind: "ok", summary: null, limits: [], extra_usage: null });
    expect(usage.available).toBe(false);
  });

  it("throws on kind=error payloads with a friendly message", () => {
    expect(() => parseServerUsagePayload({ kind: "error", message: "HTTP 502 gateway timeout" }))
      .toThrow("暂时不可用");
  });
});
