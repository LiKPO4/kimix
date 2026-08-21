import { describe, expect, it } from "vitest";
import { buildThinkingBlocks, resolveSettledThinkingFold } from "../thinkingBlocks";

describe("buildThinkingBlocks", () => {
  it("keeps the complete live reasoning text available to the scroll viewport", () => {
    const fullText = Array.from({ length: 80 }, (_, index) => `第 ${index + 1} 行思考内容`).join("\n");
    const blocks = buildThinkingBlocks({
      thinkingParts: [{ id: "live-full", timestamp: 1, text: fullText }],
      timestamp: 1,
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.text).toBe(fullText);
  });

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

describe("buildThinkingBlocks", () => {
  it("treats a mid-part full occurrence as contained, not overlap (KMP regression)", () => {
    // 语义 A：part2 完整出现在 part1 中段但 part1 不以 part2 结尾 → 重叠为 0，
    // part2 不得被剥空。
    const phrase = "接下来我需要逐条核对接口返回的字段";
    const blocks = buildThinkingBlocks({
      timestamp: 1,
      thinkingParts: [
        { id: "p1", timestamp: 1, text: `先说结论${phrase}然后我去做了别的` },
        { id: "p2", timestamp: 2, text: phrase },
      ],
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.text).toBe(`先说结论${phrase}然后我去做了别的${phrase}`);
  });

  it("skips a following part that is exactly the accumulated text suffix", () => {
    // 真后缀重叠（完整重放）：next 全文 = 前文已累积文本的后缀 → 剥空，守卫
    // 跳过追加，文本不重复。
    const phrase = "这是一个足够长的重复后缀短语内容";
    const blocks = buildThinkingBlocks({
      timestamp: 1,
      thinkingParts: [
        { id: "p1", timestamp: 1, text: `前半部分内容${phrase}` },
        { id: "p2", timestamp: 2, text: phrase },
      ],
    });
    expect(blocks[0]?.text).toBe(`前半部分内容${phrase}`);
  });
});

describe("resolveSettledThinkingFold", () => {
  it("folds multi-paragraph thinking to the last paragraph", () => {
    const result = resolveSettledThinkingFold("第一段思考。\n\n第二段收尾。");
    expect(result).toEqual({ foldable: true, teaser: "第二段收尾。" });
  });

  it("folds a long single-paragraph stream and teasers the last line", () => {
    const text = Array.from({ length: 80 }, (_, index) => `第 ${index + 1} 行思考内容`).join("\n");
    const result = resolveSettledThinkingFold(text);
    expect(result.foldable).toBe(true);
    expect(result.teaser).toBe("第 80 行思考内容");
  });

  it("does NOT fold a single unbroken long line (teaser covers the whole text)", () => {
    // 对旧实现的证伪：旧实现按「长度 > 200」判定 foldable=true，但该行是
    // 唯一一行，teaser 即全文，折叠态与展开态内容完全相同；修复后不可折叠，
    // 直接全量显示（走静态非折叠分支）。
    const text = "很长的思考".repeat(50);
    const result = resolveSettledThinkingFold(text);
    expect(result.foldable).toBe(false);
    expect(result.teaser).toBe(text);
  });

  it("does not fold when the teaser equals the trimmed full text even with surrounding blank lines", () => {
    // 通用判定：teaser（trim 后）覆盖全文即不可折叠，不限于纯单行输入。
    const inner = "很长的思考".repeat(50);
    const text = `  ${inner}\n  `;
    const result = resolveSettledThinkingFold(text);
    expect(result.teaser.trim()).toBe(inner);
    expect(result.teaser.trim()).toBe(text.trim());
    expect(result.foldable).toBe(false);
  });

  it("still folds long multi-paragraph text to its last paragraph", () => {
    const paragraph = "很长的思考".repeat(30);
    const text = Array.from({ length: 8 }, (_, index) => `第 ${index + 1} 段 ${paragraph}`).join("\n\n");
    const result = resolveSettledThinkingFold(text);
    expect(result.foldable).toBe(true);
    expect(result.teaser).toBe(`第 8 段 ${paragraph}`);
  });

  it("keeps short single-paragraph thinking fully visible", () => {
    const result = resolveSettledThinkingFold("简短的一句思考。");
    expect(result).toEqual({ foldable: false, teaser: "简短的一句思考。" });
  });
});
