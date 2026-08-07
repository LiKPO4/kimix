import { describe, expect, it, beforeEach } from "vitest";
import {
  classifyLiveStreamFrame,
  noteStreamAnchorDecision,
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

  it("evicts the oldest anchor diag keys once the per-map FIFO cap is exceeded", () => {
    type DiagReq = { message?: string; data?: Record<string, unknown> };
    const calls: DiagReq[] = [];
    const originalWindow = (globalThis as Record<string, unknown>).window;
    (globalThis as Record<string, unknown>).window = {
      api: {
        writeDiag: (req: DiagReq) => {
          calls.push(req);
          return Promise.resolve();
        },
      },
    };
    try {
      // 灌入超过 FIFO key 上限（200）的 key 数；soft cap（1200 行/key）内全部留痕
      for (let i = 0; i < 250; i += 1) {
        noteStreamAnchorDecision({
          key: `fifo-${i}`, kind: "body", offset: i, deltaLen: 1, accLen: 1,
          anchorBefore: 0, anchorAfter: 0, accepted: true,
        });
      }
      expect(calls).toHaveLength(250);
      // 最旧 key 已被 FIFO 淘汰：重新出现时行号与 prevOffset 都从零开始
      //（无淘汰时 rows 会延续为 2、prevOffset 为旧值 0，可区分）
      calls.length = 0;
      noteStreamAnchorDecision({
        key: "fifo-0", kind: "body", offset: 999, deltaLen: 1, accLen: 1,
        anchorBefore: 0, anchorAfter: 0, accepted: true,
      });
      expect(calls).toHaveLength(1);
      expect(calls[0].data?.row).toBe(1);
      expect(calls[0].data?.prevOffset).toBeNull();
      // 从未出现过的 key 不受影响，行号同样从 1 开始
      calls.length = 0;
      noteStreamAnchorDecision({
        key: "fifo-new", kind: "body", offset: 1, deltaLen: 1, accLen: 1,
        anchorBefore: 0, anchorAfter: 0, accepted: true,
      });
      expect(calls).toHaveLength(1);
      expect(calls[0].data?.row).toBe(1);
    } finally {
      if (originalWindow === undefined) delete (globalThis as Record<string, unknown>).window;
      else (globalThis as Record<string, unknown>).window = originalWindow;
    }
  });
});
