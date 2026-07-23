import { describe, expect, it } from "vitest";
import { loadSessionHistoryWithFallback, mergeHistoryStatusEventsByTime } from "../../../electron/sessionHistoryFallback";

const event = { type: "TurnBegin", payload: { user_input: "hello" } };

describe("session history fallback", () => {
  it("uses local wire history when the Server snapshot is empty", async () => {
    await expect(loadSessionHistoryWithFallback(
      async () => ({ events: [], source: "server" }),
      async () => [event],
    )).resolves.toEqual({ events: [event], source: "local" });
  });

  it("keeps a non-empty Server snapshot authoritative", async () => {
    await expect(loadSessionHistoryWithFallback(
      async () => ({ events: [event], source: "server" }),
      async () => [],
    )).resolves.toEqual({ events: [event], source: "server" });
  });

  it("falls back when the Server snapshot times out", async () => {
    await expect(loadSessionHistoryWithFallback(
      () => new Promise(() => undefined),
      async () => [event],
      1,
    )).resolves.toEqual({ events: [event], source: "local" });
  });

  it("prefers the full local wire mirror when the Server snapshot is a truncated window", async () => {
    await expect(loadSessionHistoryWithFallback(
      async () => ({ events: [event], source: "server", truncated: true }),
      async () => [event, event],
    )).resolves.toEqual({ events: [event, event], source: "local" });
  });

  it("keeps the truncated Server window when the local mirror is empty", async () => {
    await expect(loadSessionHistoryWithFallback(
      async () => ({ events: [event], source: "server", truncated: true }),
      async () => [],
    )).resolves.toEqual({ events: [event], source: "server", truncated: true });
  });
});

describe("mergeHistoryStatusEventsByTime", () => {
  const usageStatus = (time: number, output: number) => ({
    type: "StatusUpdate",
    payload: { token_usage: { output, input_other: 10, input_cache_read: 5, input_cache_creation: 0 }, model: "kimi-code/kimi-for-coding" },
    time,
  });

  it("inserts wire usage statuses in timestamp order without mutating inputs", () => {
    const serverEvents = [
      { type: "TurnBegin", payload: { user_input: "第一轮" }, time: "2026-07-22T10:23:19.000Z" },
      { type: "ContentPart", payload: { text: "回复一" }, time: "2026-07-22T10:23:20.000Z" },
      { type: "TurnBegin", payload: { user_input: "第二轮" }, time: "2026-07-22T10:24:22.000Z" },
      { type: "ContentPart", payload: { text: "回复二" }, time: "2026-07-22T10:26:07.000Z" },
    ];
    const statuses = [
      usageStatus(1784715979118, 510), // 第二轮结束
      usageStatus(1784715802368, 54), // 第一轮结束
    ];
    const merged = mergeHistoryStatusEventsByTime(serverEvents, statuses);
    expect(merged).toHaveLength(6);
    expect(merged.map((item) => item.type)).toEqual([
      "TurnBegin", "ContentPart", "StatusUpdate",
      "TurnBegin", "ContentPart", "StatusUpdate",
    ]);
    // 输入未被修改
    expect(serverEvents).toHaveLength(4);
    expect(statuses).toHaveLength(2);
  });

  it("skips statuses already present in the base events", () => {
    const existing = [
      { type: "TurnBegin", payload: { user_input: "第一轮" }, time: 100 },
      usageStatus(200, 54),
    ];
    const merged = mergeHistoryStatusEventsByTime(existing, [usageStatus(200, 54), usageStatus(300, 262)]);
    expect(merged).toHaveLength(3);
    expect(merged.filter((item) => item.type === "StatusUpdate")).toHaveLength(2);
  });

  it("returns the base events untouched when there is nothing to merge", () => {
    const base = [{ type: "TurnBegin", payload: { user_input: "hi" }, time: 1 }];
    expect(mergeHistoryStatusEventsByTime(base, [])).toBe(base);
  });
});
