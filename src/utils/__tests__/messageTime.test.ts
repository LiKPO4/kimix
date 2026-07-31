import { describe, expect, it } from "vitest";
import { formatMessageTime, formatMessageTimeTitle, formatRelativeTime } from "../messageTime";

describe("messageTime", () => {
  it("formats every message as YY/M/D HH:mm", () => {
    expect(formatMessageTime(new Date(2026, 6, 30, 15, 9).getTime())).toBe("26/7/30 15:09");
    expect(formatMessageTime(new Date(2025, 11, 8, 7, 4).getTime())).toBe("25/12/8 07:04");
  });

  it("provides an exact local timestamp for the hover title", () => {
    expect(formatMessageTimeTitle(new Date(2026, 6, 29, 21, 20, 7).getTime())).toBe("2026年7月29日 21:20:07");
  });
});

describe("formatRelativeTime", () => {
  it("returns an empty string for non-finite or non-positive timestamps", () => {
    expect(formatRelativeTime(Number.NaN)).toBe("");
    expect(formatRelativeTime(Number.POSITIVE_INFINITY)).toBe("");
    expect(formatRelativeTime(0)).toBe("");
    expect(formatRelativeTime(-1000)).toBe("");
  });

  it("treats future timestamps as just-now instead of producing negative values", () => {
    expect(formatRelativeTime(Date.now() + 10 * 60_000)).toBe("刚刚");
  });

  it("still formats the regular relative buckets", () => {
    const now = Date.now();
    expect(formatRelativeTime(now - 30_000)).toBe("刚刚");
    expect(formatRelativeTime(now - 5 * 60_000)).toBe("5 分");
    expect(formatRelativeTime(now - 3 * 3_600_000)).toBe("3 小时");
    expect(formatRelativeTime(now - 2 * 86_400_000)).toBe("2 天");
    expect(formatRelativeTime(now - 3 * 604_800_000)).toBe("3 周");
  });
});
