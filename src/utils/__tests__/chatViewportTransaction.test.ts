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

  it("releases tail compensation only after the user returns to the natural range", () => {
    expect(canReleaseViewportTailCompensation({
      tailCompensation: 120,
      scrollTop: 1400,
      naturalScrollHeight: 1880,
      clientHeight: 600,
    })).toBe(false);
    expect(canReleaseViewportTailCompensation({
      tailCompensation: 120,
      scrollTop: 1200,
      naturalScrollHeight: 1880,
      clientHeight: 600,
    })).toBe(true);
  });
});
