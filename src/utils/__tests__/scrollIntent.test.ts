import { describe, expect, it } from "vitest";
import { shouldPauseAutoFollowForScroll } from "../scrollIntent";

describe("scroll intent", () => {
  it("does not treat browser clamp after content shrink as user scrolling", () => {
    expect(shouldPauseAutoFollowForScroll({
      previousScrollTop: 4051,
      currentScrollTop: 3010,
      autoFollow: true,
      intentUntil: 0,
      now: 2000,
    })).toBe(false);
  });

  it("pauses auto-follow when an upward scroll follows explicit user input", () => {
    expect(shouldPauseAutoFollowForScroll({
      previousScrollTop: 4051,
      currentScrollTop: 3900,
      autoFollow: true,
      intentUntil: 2500,
      now: 2000,
    })).toBe(true);
  });

  it("ignores expired intent and downward movement", () => {
    expect(shouldPauseAutoFollowForScroll({
      previousScrollTop: 100,
      currentScrollTop: 80,
      autoFollow: true,
      intentUntil: 1500,
      now: 2000,
    })).toBe(false);
    expect(shouldPauseAutoFollowForScroll({
      previousScrollTop: 100,
      currentScrollTop: 120,
      autoFollow: true,
      intentUntil: 2500,
      now: 2000,
    })).toBe(false);
  });
});
