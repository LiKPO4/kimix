import { describe, expect, it } from "vitest";
import { bottomScrollTop, distanceFromBottom, scrollTopPreservingBottomDistance, shouldPauseAutoFollowForScroll, shouldResumeAutoFollowAtBottom } from "../scrollIntent";

describe("scroll intent", () => {
  it("preserves the viewport when streaming content shrinks", () => {
    expect(scrollTopPreservingBottomDistance({
      previousScrollHeight: 2000,
      previousScrollTop: 1400,
      previousClientHeight: 600,
      nextScrollHeight: 1880,
      nextClientHeight: 600,
    })).toBe(1280);
    expect(scrollTopPreservingBottomDistance({
      previousScrollHeight: 2000,
      previousScrollTop: 1200,
      previousClientHeight: 600,
      nextScrollHeight: 1880,
      nextClientHeight: 600,
    })).toBe(1080);
  });

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

  it("keeps a following viewport pinned through content growth and footer growth", () => {
    expect(bottomScrollTop({ scrollHeight: 2200, clientHeight: 600 })).toBe(1600);
    expect(bottomScrollTop({ scrollHeight: 2000, clientHeight: 500 })).toBe(1500);
  });

  it("measures the geometric distance from the canonical bottom", () => {
    expect(distanceFromBottom({ scrollHeight: 2000, scrollTop: 1368, clientHeight: 600 })).toBe(32);
    expect(distanceFromBottom({ scrollHeight: 2000, scrollTop: 1500, clientHeight: 600 })).toBe(0);
  });

  it("rejoins auto-follow only when explicit downward intent reaches the bottom", () => {
    expect(shouldResumeAutoFollowAtBottom({
      distance: 20,
      autoFollow: false,
      userScroll: true,
      bottomIntentUntil: 2500,
      now: 2000,
    })).toBe(true);
    expect(shouldResumeAutoFollowAtBottom({
      distance: 0,
      autoFollow: false,
      userScroll: true,
      bottomIntentUntil: 1500,
      now: 2000,
    })).toBe(false);
  });

  it("does not treat a programmatic layout restore as reaching the bottom", () => {
    expect(shouldResumeAutoFollowAtBottom({
      distance: 0,
      autoFollow: false,
      userScroll: true,
      bottomIntentUntil: 2500,
      suppressUntil: 2300,
      now: 2000,
    })).toBe(false);
  });
});
