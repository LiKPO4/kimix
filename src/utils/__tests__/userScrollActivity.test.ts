import { afterEach, describe, expect, it } from "vitest";
import {
  clearUserScrollActivity,
  isUserScrollActive,
  noteUserScrollActivity,
  resetUserScrollActivityForTests,
} from "../userScrollActivity";

describe("userScrollActivity", () => {
  afterEach(() => {
    resetUserScrollActivityForTests();
  });

  it("is active within the yield window", () => {
    const now = 1_000_000;
    noteUserScrollActivity(now);
    expect(isUserScrollActive(now + 100)).toBe(true);
    expect(isUserScrollActive(now + 400)).toBe(false);
  });

  it("clears immediately", () => {
    noteUserScrollActivity(1_000_000);
    clearUserScrollActivity();
    expect(isUserScrollActive(1_000_001)).toBe(false);
  });
});
