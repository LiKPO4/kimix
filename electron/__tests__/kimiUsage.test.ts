import { describe, expect, it } from "vitest";
import { parseManagedUsagePayload, parseServerUsagePayload } from "../kimiUsage";

// 0.43.x kap-server 实测响应（2026-09-15 抓包）
const NEW_SERVER_PAYLOAD = {
  code: 0,
  msg: "success",
  data: {
    kind: "ok",
    quota: {
      usages: {
        limit5h: { usedRatio: 0.233841, resetAt: "2026-09-15T15:22:57Z" },
        limit7d: { usedRatio: 0.127345, resetAt: "2026-09-21T14:22:57Z" },
      },
      extraUsage: null,
    },
  },
  request_id: "01M2JF6B2FNKPXK49GM99A1K1R",
};

// 0.43.x SDK getManagedUsage 透传形态：{ kind:"ok", quota: <服务器 quota> }
const NEW_SDK_PAYLOAD = {
  kind: "ok",
  quota: {
    usages: {
      limit5h: { usedRatio: 0.5, resetAt: "2026-09-15T20:00:00Z" },
      limit7d: { usedRatio: 0.75, resetAt: "2026-09-22T00:00:00Z" },
    },
    extraUsage: null,
  },
};

// 旧结构（limits 数组 + summary）
const OLD_PAYLOAD = {
  kind: "ok",
  limits: [
    { label: "5h", limit: 100, used: 40, window: { duration: 5, unit: "HOUR" } },
    { label: "weekly", limit: 500, used: 100 },
    { label: "monthly", limit: 2000, used: 1340 },
  ],
  summary: { limit: 500, used: 100 },
};

const NOW = Date.parse("2026-09-15T12:00:00Z");

describe("parseServerUsagePayload", () => {
  it("解析 0.43.x 新结构（quota.usages.limit5h/limit7d）", () => {
    const data = parseServerUsagePayload(NEW_SERVER_PAYLOAD.data, NOW);
    expect(data.available).toBe(true);
    expect(data.periods).toHaveLength(2);
    const fiveHour = data.periods[0];
    expect(fiveHour.label).toBe("5小时");
    expect(fiveHour.available).toBe(true);
    expect(fiveHour.percent).toBeCloseTo(23.38, 1);
    expect(fiveHour.refreshAt).toBe(Date.parse("2026-09-15T15:22:57Z"));
    const weekly = data.periods[1];
    expect(weekly.label).toBe("本周");
    expect(weekly.available).toBe(true);
    expect(weekly.percent).toBeCloseTo(12.73, 1);
    expect(weekly.refreshAt).toBe(Date.parse("2026-09-21T14:22:57Z"));
  });

  it("旧 limits/summary 结构仍兼容", () => {
    const data = parseServerUsagePayload(OLD_PAYLOAD, NOW);
    const fiveHour = data.periods.find((p) => p.label === "5小时");
    expect(fiveHour?.available).toBe(true);
    expect(fiveHour?.percent).toBeCloseTo(40, 1);
    const weekly = data.periods.find((p) => p.label === "本周");
    expect(weekly?.available).toBe(true);
    expect(weekly?.percent).toBeCloseTo(20, 1);
  });

  it("kind=error 抛错", () => {
    expect(() => parseServerUsagePayload({ kind: "error", message: "HTTP 503" }, NOW)).toThrow();
  });
});

describe("parseManagedUsagePayload", () => {
  it("解析 0.43.x SDK 透传新结构", () => {
    const data = parseManagedUsagePayload(NEW_SDK_PAYLOAD, NOW);
    expect(data.available).toBe(true);
    expect(data.periods[0].percent).toBeCloseTo(50, 1);
    expect(data.periods[1].percent).toBeCloseTo(75, 1);
    expect(data.periods[1].refreshAt).toBe(Date.parse("2026-09-22T00:00:00Z"));
  });

  it("旧结构仍兼容", () => {
    const data = parseManagedUsagePayload(OLD_PAYLOAD, NOW);
    expect(data.periods[0].percent).toBeCloseTo(40, 1);
  });
});
