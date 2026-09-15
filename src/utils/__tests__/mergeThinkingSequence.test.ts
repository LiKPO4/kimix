import { describe, expect, it } from "vitest";
import { mergeAssistantThinkingText, mergeAssistantThinkingTextSequence } from "../eventMapper";

// 简易确定性 PRNG
function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const WORDS = ["分析", "代码", "结构", "调用", "边界", "重叠", "测试", "修复", "快照", "回放", "子代理", "思考", "内容", "片段", "流式"];
const SEPS = ["", " ", "\n", "  ", "\n\n", "\t"];

function makeText(rng: () => number, len: number): string {
  let out = "";
  while (out.length < len) {
    out += WORDS[Math.floor(rng() * WORDS.length)];
    out += SEPS[Math.floor(rng() * SEPS.length)];
  }
  return out.slice(0, len);
}

describe("mergeAssistantThinkingTextSequence 差分对拍", () => {
  it("500 轮随机形态与 reduce(mergeAssistantThinkingText) 零差异", () => {
    const rng = makeRng(20260915);
    for (let round = 0; round < 500; round++) {
      const kind = Math.floor(rng() * 8);
      const base = makeText(rng, 10 + Math.floor(rng() * 400));
      let texts: (string | undefined)[];
      switch (kind) {
        case 0: // 互不相关
          texts = [base, makeText(rng, 20 + Math.floor(rng() * 300)), makeText(rng, 15)];
          break;
        case 1: { // 后缀-前缀重叠（重放形态）
          const tail = base.slice(-(20 + Math.floor(rng() * 100)));
          const ext = makeText(rng, 60);
          texts = [base, tail + ext, ext.slice(0, 10)];
          break;
        }
        case 2: // 包含关系
          texts = [base, base.slice(5, 60), base];
          break;
        case 3: // 被包含关系（right 更大）
          texts = [base.slice(5, 60), base, makeText(rng, 30)];
          break;
        case 4: { // 空白差异（同文本不同空白）
          const spaced = base.split("").join(" ");
          texts = [base, spaced.slice(0, Math.min(spaced.length, base.length + 30)), makeText(rng, 25)];
          break;
        }
        case 5: // 完全重复 + 空/undefined 混合
          texts = [base, "", undefined, base, "   ", base.slice(0, 5)];
          break;
        case 6: { // 前缀重叠（right 以 left 开头）
          texts = [base.slice(0, 40), base, makeText(rng, 50)];
          break;
        }
        default: { // 多段随机序列
          const count = 2 + Math.floor(rng() * 6);
          texts = [];
          for (let i = 0; i < count; i++) {
            texts.push(rng() < 0.15 ? undefined : makeText(rng, 5 + Math.floor(rng() * 250)));
          }
          break;
        }
      }
      const expected = texts.reduce<string | undefined>(
        (merged, t) => mergeAssistantThinkingText(merged, t),
        undefined,
      );
      const actual = mergeAssistantThinkingTextSequence(texts);
      expect(actual).toBe(expected);
    }
  });

  it("单元素/空数组/全空", () => {
    expect(mergeAssistantThinkingTextSequence([])).toBeUndefined();
    expect(mergeAssistantThinkingTextSequence([undefined, ""])).toBeUndefined();
    expect(mergeAssistantThinkingTextSequence(["hello"])).toBe("hello");
    expect(mergeAssistantThinkingTextSequence([undefined, "a", "b"])).toBe(
      ["a", "b"].reduce<string | undefined>((m, t) => mergeAssistantThinkingText(m, t), undefined),
    );
  });
});
