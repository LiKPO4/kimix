import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/utils/hash";

describe("sha256Hex", () => {
  it("returns a 64-character hex string for non-empty input", async () => {
    const hash = await sha256Hex("hello");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("returns different hashes for different inputs", async () => {
    const a = await sha256Hex("a");
    const b = await sha256Hex("b");
    expect(a).not.toBe(b);
  });

  it("returns the same hash for the same input", async () => {
    const a = await sha256Hex("same");
    const b = await sha256Hex("same");
    expect(a).toBe(b);
  });
});
