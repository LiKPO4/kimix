import { describe, expect, it } from "vitest";
import { buildThinkingBlocks } from "../thinkingBlocks";

describe("buildThinkingBlocks", () => {
  it("uses the final summary paragraph as the title before a tool boundary", () => {
    const blocks = buildThinkingBlocks({
      timestamp: 1_000,
      boundaryTimestamps: [3_000],
      thinkingParts: [
        { id: "detail-1", timestamp: 1_000, text: "User wants a careful re-analysis.\n\nWe need to inspect how storylets are triggered." },
        { id: "summary-1", timestamp: 2_000, text: "\n\nLet's explore the event presentation flow." },
        { id: "detail-2", timestamp: 4_000, text: "The first search was incomplete.\n\nSearch all storylet usages." },
      ],
    });

    expect(blocks).toHaveLength(2);
    expect(blocks[0].summary).toBe("Let's explore the event presentation flow.");
    expect(blocks[0].text).toContain("User wants a careful re-analysis.");
    expect(blocks[0].text).toContain("Let's explore the event presentation flow.");
    expect(blocks[1].summary).toBe("Search all storylet usages.");
  });

  it("keeps a thinking phase together when there is no tool boundary", () => {
    const blocks = buildThinkingBlocks({
      timestamp: 1_000,
      thinkingParts: [
        { id: "part-1", timestamp: 1_000, text: "First detailed paragraph." },
        { id: "part-2", timestamp: 1_100, text: "\n\nConcise summary." },
      ],
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0].summary).toBe("Concise summary.");
  });

  it("uses only the last paragraph of the real blind-versus-miasma thought as summary", () => {
    const text = "The user is asking about the logical difference between 盲目 (blind) and 瘴气 (miasma) in the game.\n\nLet me think about this:\n\n1. 玩家身上的盲目。\n2. 敌人身上的盲目。\n3. 玩家身上的瘴气。\n\nSo the key differences:\n- 概率不同\n- 影响范围不同\n\nSince the user asked about the logical difference, let me give a clear comparison.";
    const blocks = buildThinkingBlocks({
      timestamp: 1_000,
      thinkingParts: [{ id: "blind-miasma", timestamp: 1_000, text }],
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0].summary).toBe("Since the user asked about the logical difference, let me give a clear comparison.");
    expect(blocks[0].text).toBe(text);
  });

  it("restores the official think and tool step boundaries when timestamps match", () => {
    const blocks = buildThinkingBlocks({
      timestamp: 1_782_047_971_173,
      boundaryTimestamps: [
        1_782_047_971_173,
        1_782_047_974_931,
        1_782_047_978_947,
      ],
      thinkingParts: [
        {
          id: "step-1",
          timestamp: 1_782_047_971_173,
          text: "User wants a careful re-analysis.\n\nLet's explore the event presentation flow.",
        },
        {
          id: "step-2",
          timestamp: 1_782_047_974_930,
          text: "Need find event storylet flow. Search for EventDefinition usage in run_page.",
        },
        {
          id: "step-3",
          timestamp: 1_782_047_978_947,
          text: "Read around line 4380-4420 for event panel.",
        },
        {
          id: "step-4",
          timestamp: 1_782_047_984_605,
          text: "Events are displayed directly with title/body; no intro storylet automatically.",
        },
      ],
    });

    expect(blocks.map((block) => ({ timestamp: block.timestamp, summary: block.summary }))).toEqual([
      {
        timestamp: 1_782_047_971_173,
        summary: "Let's explore the event presentation flow.",
      },
      {
        timestamp: 1_782_047_974_930,
        summary: "Need find event storylet flow. Search for EventDefinition usage in run_page.",
      },
      {
        timestamp: 1_782_047_978_947,
        summary: "Read around line 4380-4420 for event panel.",
      },
      {
        timestamp: 1_782_047_984_605,
        summary: "Events are displayed directly with title/body; no intro storylet automatically.",
      },
    ]);
  });
});
