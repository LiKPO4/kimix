import { describe, expect, it } from "vitest";
import {
  canLiveThinkingViewportConsumeWheel,
  LIVE_THINKING_MAX_HEIGHT_PX,
  resolveHasFinalProcessContent,
  shouldCollapseKimiWebProcessOnFinalContent,
  shouldFollowLiveThinkingViewport,
  shouldSubscribeActiveTurnDraft,
  shouldUseLiveThinkingViewport,
} from "../liveThinkingViewport";

describe("liveThinkingViewport", () => {
  it("uses a five-line viewport based on the Kimi Web line height", () => {
    expect(LIVE_THINKING_MAX_HEIGHT_PX).toBe(120);
  });

  it("consumes wheel input only while the inner viewport can move", () => {
    expect(canLiveThinkingViewportConsumeWheel({
      scrollTop: 40,
      scrollHeight: 300,
      clientHeight: 120,
    }, -20)).toBe(true);
    expect(canLiveThinkingViewportConsumeWheel({
      scrollTop: 0,
      scrollHeight: 300,
      clientHeight: 120,
    }, -20)).toBe(false);
    expect(canLiveThinkingViewportConsumeWheel({
      scrollTop: 180,
      scrollHeight: 300,
      clientHeight: 120,
    }, 20)).toBe(false);
  });

  it("pauses following away from the bottom and resumes near it", () => {
    expect(shouldFollowLiveThinkingViewport({
      scrollTop: 100,
      scrollHeight: 300,
      clientHeight: 120,
    })).toBe(false);
    expect(shouldFollowLiveThinkingViewport({
      scrollTop: 170,
      scrollHeight: 300,
      clientHeight: 120,
    })).toBe(true);
  });

  it("limits every thinking group for the whole active turn", () => {
    const base = {
      groupIndex: 2,
      groupCount: 3,
      isThinkingGroup: true,
      isActiveAssistant: true,
      hasFinalContent: false,
    };
    expect(shouldUseLiveThinkingViewport(base)).toBe(true);
    expect(shouldUseLiveThinkingViewport({ ...base, groupIndex: 1 })).toBe(true);
    expect(shouldUseLiveThinkingViewport({ ...base, isActiveAssistant: false })).toBe(false);
    expect(shouldUseLiveThinkingViewport({ ...base, hasFinalContent: true })).toBe(true);
    expect(shouldUseLiveThinkingViewport({
      ...base,
      isActiveAssistant: false,
      hasFinalContent: true,
      preserveDuringFinalTransition: true,
    })).toBe(true);
  });

  it("collapses the Kimi Web process exactly when final output starts", () => {
    const base = {
      previousHasFinalContent: false,
      hasFinalContent: true,
      isKimiWeb: true,
      expanded: true,
      manuallyExpanded: false,
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
    expect(shouldCollapseKimiWebProcessOnFinalContent({
      ...base,
      manuallyExpanded: true,
    })).toBe(false);
  });

  it("treats only a completed turn with body content as final content", () => {
    // 运行中任何流式内容（思考/预告段）都不算最终内容——
    // 否则第一个字到达就会误触发自动折叠，「未勾选运行中折叠时全程展开」失效。
    expect(resolveHasFinalProcessContent(false, true)).toBe(false);
    expect(resolveHasFinalProcessContent(false, false)).toBe(false);
    expect(resolveHasFinalProcessContent(true, false)).toBe(false);
    expect(resolveHasFinalProcessContent(true, true)).toBe(true);
    expect(resolveHasFinalProcessContent(true, true, true)).toBe(false);
  });

  it("keeps the active draft subscription independent from intermediate step completion", () => {
    expect(shouldSubscribeActiveTurnDraft({
      enabled: true,
      isActiveAssistant: true,
      sessionId: "session-1",
      turnId: "turn-1",
    })).toBe(true);
    expect(shouldSubscribeActiveTurnDraft({
      enabled: true,
      isActiveAssistant: false,
      sessionId: "session-1",
      turnId: "turn-1",
    })).toBe(false);
  });
});
