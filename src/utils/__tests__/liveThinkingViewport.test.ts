import { describe, expect, it } from "vitest";
import {
  canLiveThinkingViewportConsumeWheel,
  LIVE_THINKING_MAX_HEIGHT_PX,
  shouldCollapseKimiWebProcessOnFinalContent,
  shouldFollowLiveThinkingViewport,
  shouldUseLiveThinkingViewport,
} from "../liveThinkingViewport";

describe("liveThinkingViewport", () => {
  it("uses a six-line viewport based on the Kimi Web line height", () => {
    expect(LIVE_THINKING_MAX_HEIGHT_PX).toBe(144);
  });

  it("consumes wheel input only while the inner viewport can move", () => {
    expect(canLiveThinkingViewportConsumeWheel({
      scrollTop: 40,
      scrollHeight: 300,
      clientHeight: 144,
    }, -20)).toBe(true);
    expect(canLiveThinkingViewportConsumeWheel({
      scrollTop: 0,
      scrollHeight: 300,
      clientHeight: 144,
    }, -20)).toBe(false);
    expect(canLiveThinkingViewportConsumeWheel({
      scrollTop: 156,
      scrollHeight: 300,
      clientHeight: 144,
    }, 20)).toBe(false);
  });

  it("pauses following away from the bottom and resumes near it", () => {
    expect(shouldFollowLiveThinkingViewport({
      scrollTop: 100,
      scrollHeight: 300,
      clientHeight: 144,
    })).toBe(false);
    expect(shouldFollowLiveThinkingViewport({
      scrollTop: 146,
      scrollHeight: 300,
      clientHeight: 144,
    })).toBe(true);
  });

  it("limits only the active final thinking group before final output", () => {
    const base = {
      groupIndex: 2,
      groupCount: 3,
      isThinkingGroup: true,
      isActiveAssistant: true,
      hasFinalContent: false,
    };
    expect(shouldUseLiveThinkingViewport(base)).toBe(true);
    expect(shouldUseLiveThinkingViewport({ ...base, groupIndex: 1 })).toBe(false);
    expect(shouldUseLiveThinkingViewport({ ...base, isActiveAssistant: false })).toBe(false);
    expect(shouldUseLiveThinkingViewport({ ...base, hasFinalContent: true })).toBe(false);
  });

  it("collapses the Kimi Web process exactly when final output starts", () => {
    const base = {
      previousHasFinalContent: false,
      hasFinalContent: true,
      isKimiWeb: true,
      expanded: true,
    };
    expect(shouldCollapseKimiWebProcessOnFinalContent(base)).toBe(true);
    expect(shouldCollapseKimiWebProcessOnFinalContent({
      ...base,
      previousHasFinalContent: true,
    })).toBe(false);
    expect(shouldCollapseKimiWebProcessOnFinalContent({
      ...base,
      isKimiWeb: false,
    })).toBe(false);
  });
});
