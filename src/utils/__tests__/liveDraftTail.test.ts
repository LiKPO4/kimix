import { describe, expect, it } from "vitest";
import { buildThinkingBlocks, resolveSettledThinkingFold } from "../thinkingBlocks";
import { draftThinkingText, pickDraftThinkingParts, type ActiveTurnDraft } from "../activeTurnDraftStore";

/**
 * 流式思考叶子（LiveDraftTail）的可测纯逻辑：
 * - draftThinkingText：live 阶段思考的纯文本来源（整段 thinking 优先，分片拼接兜底）。
 * - pickDraftThinkingParts：draft/正式 thinkingParts 的选择规则。
 *
 * 关键语义：live 叶子每 delta 只产出「原始全文纯文本」，不做 buildThinkingBlocks
 * 的段落切块、不做 resolveSettledThinkingFold 的 teaser 折叠——旧实现在每帧对
 * 全量思考跑切块 + 每段 summarize（O(n) 且产出新数组引用，破坏 memo）。
 */

function draft(overrides: Partial<ActiveTurnDraft>): ActiveTurnDraft {
  return {
    materializationId: "mat-1",
    content: "",
    revision: 1,
    timestamp: 1,
    ...overrides,
  };
}

describe("draftThinkingText", () => {
  it("prefers the full thinking text over fragmented parts", () => {
    const text = "第一段思考。\n\n第二段思考内容。";
    const result = draftThinkingText(draft({
      thinking: text,
      thinkingParts: [{ id: "p1", timestamp: 1, text: "只有片段" }],
    }));
    expect(result).toBe(text);
  });

  it("joins thinking parts when no whole thinking text exists", () => {
    const result = draftThinkingText(draft({
      thinkingParts: [
        { id: "p1", timestamp: 1, text: "片段一" },
        { id: "p2", timestamp: 2, text: "片段二" },
      ],
    }));
    expect(result).toBe("片段一\n\n片段二");
  });

  it("filters blank parts and returns empty for an empty draft", () => {
    expect(draftThinkingText(draft({
      thinking: "  \n ",
      thinkingParts: [{ id: "p1", timestamp: 1, text: "  " }],
    }))).toBe("");
    expect(draftThinkingText(draft({}))).toBe("");
  });

  it("keeps the FULL raw thinking text instead of summarizing or splitting it", () => {
    // 多行长流式思考（无空行段落）：settle 折叠会 teaser 到最后一行并截断，
    // 切块路径会把 >520 字的段拆成多块；live 叶子必须原样返回全文。
    const longThinking = Array.from({ length: 400 }, (_, index) => `这是第 ${index} 个分句，没有段落分隔。`).join("\n");
    expect(longThinking.length).toBeGreaterThan(5000);

    const liveText = draftThinkingText(draft({ thinking: longThinking }));
    expect(liveText).toBe(longThinking);

    const blocks = buildThinkingBlocks({ thinking: longThinking, timestamp: 1 });
    expect(blocks.length).toBeGreaterThan(1);
    const folded = resolveSettledThinkingFold(longThinking);
    expect(folded.foldable).toBe(true);
    expect(folded.teaser.length).toBeLessThan(longThinking.length);
    // 折叠 teaser / 切块都不是 live 叶子的输出——live 输出必须信息无损。
    expect(folded.teaser).not.toBe(liveText);
  });
});

describe("pickDraftThinkingParts", () => {
  it("prefers the draft parts when they cover at least as many segments as the event", () => {
    const draftParts = [{ id: "p1", timestamp: 1, text: "a" }, { id: "p2", timestamp: 2, text: "b" }];
    const eventParts = [{ id: "p3", timestamp: 3, text: "c" }];
    expect(pickDraftThinkingParts(draftParts, eventParts)).toBe(draftParts);
  });

  it("falls back to the event parts when the draft has fewer segments", () => {
    const draftParts = [{ id: "p1", timestamp: 1, text: "a" }];
    const eventParts = [{ id: "p2", timestamp: 2, text: "b" }, { id: "p3", timestamp: 3, text: "c" }];
    expect(pickDraftThinkingParts(draftParts, eventParts)).toBe(eventParts);
  });

  it("falls back when the draft carries no parts", () => {
    const eventParts = [{ id: "p1", timestamp: 1, text: "a" }];
    expect(pickDraftThinkingParts(undefined, eventParts)).toBe(eventParts);
    expect(pickDraftThinkingParts(undefined, undefined)).toBeUndefined();
  });
});
