import { describe, expect, it, beforeEach } from "vitest";
import {
  classifyLiveStreamFrame,
  resetLiveTurnDiagStateForTests,
  resolveLiveDisplayMode,
  shouldLogDisplayModeChange,
  shouldLogStreamAnchorDecision,
  summarizeLiveTurn,
} from "../liveTurnDiag";

describe("liveTurnDiag", () => {
  beforeEach(() => {
    resetLiveTurnDiagStateForTests();
  });

  it("resolveLiveDisplayMode matches MessageBubble settled rule", () => {
    expect(resolveLiveDisplayMode({
      isActiveAssistant: true,
      isComplete: false,
      hasVisibleOutput: true,
      isThinking: true,
    })).toBe("thinking");

    // 关键：非 active + 仅有可见输出 → 会显示「输出完成」（假完成窗口）
    expect(resolveLiveDisplayMode({
      isActiveAssistant: false,
      isComplete: false,
      hasVisibleOutput: true,
    })).toBe("settled_visible");

    expect(resolveLiveDisplayMode({
      isActiveAssistant: false,
      isComplete: true,
      hasVisibleOutput: true,
    })).toBe("settled_complete");
  });

  it("shouldLogDisplayModeChange only on transition", () => {
    expect(shouldLogDisplayModeChange(undefined, "thinking")).toBe(true);
    expect(shouldLogDisplayModeChange("thinking", "thinking")).toBe(false);
    expect(shouldLogDisplayModeChange("thinking", "settled_visible")).toBe(true);
  });

  it("summarizeLiveTurn counts open body and tools", () => {
    const snap = summarizeLiveTurn([
      { type: "user_message" },
      { type: "assistant_message", content: "预告", isComplete: false, timestamp: 100, durationMs: 5000 },
      { type: "tool_call", status: "running" },
      { type: "tool_call", status: "success" },
    ]);
    expect(snap.openAssistants).toBe(1);
    expect(snap.completeAssistants).toBe(0);
    expect(snap.latestBodyLen).toBe(2);
    expect(snap.latestIsComplete).toBe(false);
    expect(snap.latestDurationMs).toBe(5000);
    expect(snap.toolRunning).toBe(1);
    expect(snap.toolDone).toBe(1);
  });

  it("classifyLiveStreamFrame separates body/think/terminal", () => {
    expect(classifyLiveStreamFrame("assistant.delta")).toBe("body");
    expect(classifyLiveStreamFrame("thinking.delta")).toBe("think");
    expect(classifyLiveStreamFrame("prompt.completed")).toBe("terminal");
    expect(classifyLiveStreamFrame("tool.call.started")).toBe("tool");
  });

  // offset 锚定诊断必须不抽样才能区分「offset 归 0」与「offset 按 step 计」，
  // 两者在 2s 抽样的 [live] stream 下观测等价。上限只截掉稳态追加行，
  // 关键信号（拒绝、offset 回退）在软上限之后仍必须留痕。
  it("shouldLogStreamAnchorDecision records every row under the soft cap", () => {
    expect(shouldLogStreamAnchorDecision({ rows: 0, accepted: true, isOffsetRegression: false })).toBe(true);
    expect(shouldLogStreamAnchorDecision({ rows: 1199, accepted: true, isOffsetRegression: false })).toBe(true);
  });

  it("shouldLogStreamAnchorDecision keeps only key signals past the soft cap", () => {
    expect(shouldLogStreamAnchorDecision({ rows: 1200, accepted: true, isOffsetRegression: false })).toBe(false);
    expect(shouldLogStreamAnchorDecision({ rows: 1200, accepted: false, isOffsetRegression: false })).toBe(true);
    expect(shouldLogStreamAnchorDecision({ rows: 1200, accepted: true, isOffsetRegression: true })).toBe(true);
  });

  it("shouldLogStreamAnchorDecision stops at the hard cap even for key signals", () => {
    expect(shouldLogStreamAnchorDecision({ rows: 2000, accepted: false, isOffsetRegression: true })).toBe(false);
  });
});
