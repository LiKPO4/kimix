import { describe, expect, it } from "vitest";
import { resolvePersistDelayMs } from "../persistence";

describe("resolvePersistDelayMs", () => {
  it("debounces idle updates to 900ms with a 5s ceiling", () => {
    expect(resolvePersistDelayMs({ streaming: false, elapsedSincePersistMs: 0 })).toBe(900);
    expect(resolvePersistDelayMs({ streaming: false, elapsedSincePersistMs: 4_600 })).toBe(400);
    expect(resolvePersistDelayMs({ streaming: false, elapsedSincePersistMs: 6_000 })).toBe(0);
  });

  it("stretches streaming persists to at most once per minute", () => {
    expect(resolvePersistDelayMs({ streaming: true, elapsedSincePersistMs: 0 })).toBe(5_000);
    expect(resolvePersistDelayMs({ streaming: true, elapsedSincePersistMs: 58_000 })).toBe(2_000);
    expect(resolvePersistDelayMs({ streaming: true, elapsedSincePersistMs: 61_000 })).toBe(0);
  });
});
