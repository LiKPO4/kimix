/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
  canReleaseViewportTailCompensation,
  isProcessCollapseAnchorUnstable,
  isViewportAnchorGenerationCurrent,
  planDetachedViewportRestore,
  requiredViewportTailCompensation,
} from "../chatViewportTransaction";

describe("chat viewport transaction", () => {
  it("restores a visible anchor even after the browser clamps a shrinking scroll range", () => {
    expect(planDetachedViewportRestore({
      previousScrollTop: 1400,
      previousAnchorViewportTop: 100,
      currentScrollTop: 1280,
      currentAnchorViewportTop: 220,
      naturalScrollHeight: 1880,
      clientHeight: 600,
    })).toEqual({
      targetScrollTop: 1400,
      minimumScrollHeight: 2000,
      tailCompensation: 120,
    });
  });

  it("does not add tail space when the collapsing content was above the visible anchor", () => {
    expect(planDetachedViewportRestore({
      previousScrollTop: 1400,
      previousAnchorViewportTop: 100,
      currentScrollTop: 1280,
      currentAnchorViewportTop: 100,
      naturalScrollHeight: 1880,
      clientHeight: 600,
    })).toEqual({
      targetScrollTop: 1280,
      minimumScrollHeight: 1880,
      tailCompensation: 0,
    });
  });

  it("falls back to the pre-transaction scroll position when the sampled element disappears", () => {
    expect(planDetachedViewportRestore({
      previousScrollTop: 900,
      currentScrollTop: 820,
      naturalScrollHeight: 1360,
      clientHeight: 540,
    })).toEqual({
      targetScrollTop: 900,
      minimumScrollHeight: 1440,
      tailCompensation: 80,
    });
  });

  it("consumes temporary tail compensation as real final content grows", () => {
    expect(requiredViewportTailCompensation({
      minimumScrollHeight: 2000,
      naturalScrollHeight: 1960,
    })).toBe(40);
    expect(requiredViewportTailCompensation({
      minimumScrollHeight: 2000,
      naturalScrollHeight: 2000,
    })).toBe(0);
  });

  it("replaces prior compensation when a second Agent process collapses", () => {
    expect(planDetachedViewportRestore({
      previousScrollTop: 1400,
      previousAnchorViewportTop: 100,
      currentScrollTop: 1320,
      currentAnchorViewportTop: 180,
      naturalScrollHeight: 1800,
      clientHeight: 600,
    })).toEqual({
      targetScrollTop: 1400,
      minimumScrollHeight: 2000,
      tailCompensation: 200,
    });
  });

  it("rejects an anchor captured before a newer explicit user scroll", () => {
    expect(isViewportAnchorGenerationCurrent({
      capturedGeneration: 4,
      currentGeneration: 5,
    })).toBe(false);
    expect(isViewportAnchorGenerationCurrent({
      capturedGeneration: 5,
      currentGeneration: 5,
    })).toBe(true);
  });

  it("rejects an Assistant ancestor as a process-collapse anchor", () => {
    const scrollNode = document.createElement("div");
    const streamNode = document.createElement("div");
    const assistantNode = document.createElement("div");
    const collapsingNode = document.createElement("div");
    scrollNode.append(streamNode);
    streamNode.append(assistantNode);
    assistantNode.append(collapsingNode);

    expect(isProcessCollapseAnchorUnstable({
      anchor: assistantNode,
      scrollNode,
      streamNode,
      collapsingNode,
    })).toBe(true);
  });

  it("releases tail compensation after the user returns to the natural range or reaches the compensated visual bottom", () => {
    // 自然最大滚动 = 1880 - 600 = 1280；补偿 120 → 视觉底部 = 1400。
    // 停在自然范围内（1200）→ 释放。
    expect(canReleaseViewportTailCompensation({
      tailCompensation: 120,
      scrollTop: 1200,
      naturalScrollHeight: 1880,
      clientHeight: 600,
    })).toBe(true);
    // 停在补偿空间内部（1300：自然最大 1280 与视觉底部 1400 之间）→ 不释放，
    // 阅读位置仍受保护（旧实现也如此）。
    expect(canReleaseViewportTailCompensation({
      tailCompensation: 120,
      scrollTop: 1300,
      naturalScrollHeight: 1880,
      clientHeight: 600,
    })).toBe(false);
    // 滚到补偿撑出的视觉底部（1400）→ 释放并贴自然底。旧实现只认自然范围，
    // 该位置永不释放，尾部空白残留且滚不掉（完成后自动折叠的典型残留路径）。
    expect(canReleaseViewportTailCompensation({
      tailCompensation: 120,
      scrollTop: 1400,
      naturalScrollHeight: 1880,
      clientHeight: 600,
    })).toBe(true);
  });
});
