import { describe, expect, it } from "vitest";
import { makeActiveTurnDraftKey } from "../activeTurnDraftStore";
import { buildTurnBlocks } from "../turnBlocks";
import {
  canLiveThinkingViewportConsumeWheel,
  LIVE_THINKING_MAX_HEIGHT_PX,
  resolveHasFinalProcessContent,
  resolveLiveTextBlockKey,
  resolveLiveThinkingBlockKey,
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
  it("follows within 24px of the bottom and pauses beyond it (official threshold)", () => {
    // 距底恰好 24px：仍跟随；距底 25px：停止跟随（用户上翻后不抢滚动）。
    expect(shouldFollowLiveThinkingViewport({
      scrollTop: 156,
      scrollHeight: 300,
      clientHeight: 120,
    })).toBe(true);
    expect(shouldFollowLiveThinkingViewport({
      scrollTop: 155,
      scrollHeight: 300,
      clientHeight: 120,
    })).toBe(false);
  });


  it("limits only the trailing thinking group while the turn is active", () => {
    const base = {
      groupIndex: 2,
      groupCount: 3,
      isThinkingGroup: true,
      isActiveAssistant: true,
      hasFinalContent: false,
    };
    expect(shouldUseLiveThinkingViewport(base)).toBe(true);
    // 已走完的思考阶段（后面已有正文/工具）落盘为可折叠摘要，不再挂实时滚动区。
    expect(shouldUseLiveThinkingViewport({ ...base, groupIndex: 1 })).toBe(false);
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

describe("resolveLiveThinkingBlockKey", () => {
  it("matches the formal thinking group key of the committed draft segment", () => {
    const draftKey = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");
    const materializationId = "mat-1";
    const liveKey = resolveLiveThinkingBlockKey(draftKey, materializationId);
    const segmentEvent = {
      id: `active-draft:${draftKey}:${materializationId}`,
      type: "assistant_message",
      timestamp: 1,
      content: "",
      thinking: "思考",
      isThinking: true,
      isComplete: false,
    } as unknown as Parameters<typeof buildTurnBlocks>[0][number];
    const blocks = buildTurnBlocks([segmentEvent]);
    expect(blocks[0]?.kind).toBe("thinking");
    expect(blocks[0]?.key).toBe(liveKey);
  });

  it("returns undefined without a draft key or materialization", () => {
    expect(resolveLiveThinkingBlockKey(null, "mat-1")).toBeUndefined();
    expect(resolveLiveThinkingBlockKey("key", undefined)).toBeUndefined();
  });
});

describe("resolveLiveTextBlockKey", () => {
  it("matches the formal text block key of the committed draft segment", () => {
    const draftKey = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");
    const materializationId = "mat-1";
    const liveKey = resolveLiveTextBlockKey(draftKey, materializationId);
    const segmentEvent = {
      id: `active-draft:${draftKey}:${materializationId}`,
      type: "assistant_message",
      timestamp: 1,
      content: "正文",
      isThinking: false,
      isComplete: false,
    } as unknown as Parameters<typeof buildTurnBlocks>[0][number];
    const blocks = buildTurnBlocks([segmentEvent]);
    expect(blocks[0]?.kind).toBe("text");
    expect(blocks[0]?.key).toBe(liveKey);
  });
});
