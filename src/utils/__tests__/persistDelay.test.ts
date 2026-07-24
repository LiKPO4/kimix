import { describe, expect, it } from "vitest";
import { resolvePersistDelayMs } from "../persistence";

describe("resolvePersistDelayMs", () => {
  it("debounces idle updates to 900ms with a 5s ceiling", () => {
    expect(resolvePersistDelayMs({ streaming: false, elapsedSincePersistMs: 0, startupWindowActive: false })).toBe(900);
    expect(resolvePersistDelayMs({ streaming: false, elapsedSincePersistMs: 4_600, startupWindowActive: false })).toBe(400);
    expect(resolvePersistDelayMs({ streaming: false, elapsedSincePersistMs: 6_000, startupWindowActive: false })).toBe(0);
  });

  it("stretches streaming persists to at most once per minute", () => {
    expect(resolvePersistDelayMs({ streaming: true, elapsedSincePersistMs: 0, startupWindowActive: false })).toBe(5_000);
    expect(resolvePersistDelayMs({ streaming: true, elapsedSincePersistMs: 58_000, startupWindowActive: false })).toBe(2_000);
    expect(resolvePersistDelayMs({ streaming: true, elapsedSincePersistMs: 61_000, startupWindowActive: false })).toBe(0);
  });

  it("stretches idle persists during the startup window to coalesce the setState storm", () => {
    expect(resolvePersistDelayMs({ streaming: false, elapsedSincePersistMs: 0, startupWindowActive: true })).toBe(10_000);
    expect(resolvePersistDelayMs({ streaming: false, elapsedSincePersistMs: 25_000, startupWindowActive: true })).toBe(5_000);
    expect(resolvePersistDelayMs({ streaming: false, elapsedSincePersistMs: 31_000, startupWindowActive: true })).toBe(0);
  });

  it("keeps the streaming cadence ahead of the startup window tier", () => {
    expect(resolvePersistDelayMs({ streaming: true, elapsedSincePersistMs: 0, startupWindowActive: true })).toBe(5_000);
    expect(resolvePersistDelayMs({ streaming: true, elapsedSincePersistMs: 58_000, startupWindowActive: true })).toBe(2_000);
    expect(resolvePersistDelayMs({ streaming: true, elapsedSincePersistMs: 61_000, startupWindowActive: true })).toBe(0);
  });
});
