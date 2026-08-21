import { describe, expect, it } from "vitest";
import { longestSuffixPrefixOverlap, stripNormalizedPrefix } from "../textOverlap";

describe("longestSuffixPrefixOverlap", () => {
  it("returns 0 for empty inputs", () => {
    expect(longestSuffixPrefixOverlap("", "abc", 1)).toBe(0);
    expect(longestSuffixPrefixOverlap("abc", "", 1)).toBe(0);
    expect(longestSuffixPrefixOverlap("", "", 1)).toBe(0);
  });

  it("respects minLength at the boundary", () => {
    expect(longestSuffixPrefixOverlap("前缀abcd", "abcd", 4)).toBe(4);
    expect(longestSuffixPrefixOverlap("前缀abc", "abc", 4)).toBe(0);
  });

  it("returns the full length when both strings are identical", () => {
    expect(longestSuffixPrefixOverlap("好的我现在来分析", "好的我现在来分析", 1)).toBe(8);
    expect(longestSuffixPrefixOverlap("a", "a", 1)).toBe(1);
  });

  it("handles single characters", () => {
    expect(longestSuffixPrefixOverlap("xa", "a", 1)).toBe(1);
    expect(longestSuffixPrefixOverlap("ea", "b", 1)).toBe(0);
    expect(longestSuffixPrefixOverlap("ab", "b", 1)).toBe(1);
  });

  it("treats a mid-string full occurrence as contained, not suffix overlap", () => {
    // KMP 回归：right 完整出现在 left 中间但 left 不以 right 结尾 → 0
    // （修复前提前 break 返回 right 长度，调用方会误判为重叠并整段剥空）。
    expect(longestSuffixPrefixOverlap("先说结论好的我现在来分析然后我去做了别的", "好的我现在来分析", 4)).toBe(0);
    const phrase = "接下来我需要逐条核对接口返回的字段并与预期结果做对比验证";
    expect(longestSuffixPrefixOverlap(`前置说明${phrase}然后我做了另外一件事`, phrase, 16)).toBe(0);
  });

  it("detects real suffix-prefix overlap", () => {
    expect(longestSuffixPrefixOverlap("前言好的我现在来分析", "好的我现在来分析", 4)).toBe(8);
    // right 连续出现两次且以 right 结尾
    expect(longestSuffixPrefixOverlap("甲乙好的我现在来分析丙好的我现在来分析", "好的我现在来分析", 4)).toBe(8);
    // left 是 right 的前缀：left 整体构成重叠
    expect(longestSuffixPrefixOverlap("abc", "abcXYZ", 3)).toBe(3);
    // right 是 left 的前缀但不是后缀 → 0（重叠只认 left 后缀）
    expect(longestSuffixPrefixOverlap("abcXYZ", "abc", 3)).toBe(0);
    // 完全无关
    expect(longestSuffixPrefixOverlap("今天天气不错出门散步", "明天要下雨记得带伞", 4)).toBe(0);
  });

  it("measures overlap on the raw characters passed in", () => {
    expect(longestSuffixPrefixOverlap("先看 A", "A 后看", 1)).toBe(1);
  });
});

describe("stripNormalizedPrefix", () => {
  it("removes the first N normalized characters", () => {
    expect(stripNormalizedPrefix("abcd", 2)).toBe("cd");
    expect(stripNormalizedPrefix("a  b c", 2)).toBe(" b c");
  });

  it("handles empty, zero, and overflowing overlap", () => {
    expect(stripNormalizedPrefix("", 1)).toBe("");
    expect(stripNormalizedPrefix("abc", 0)).toBe("abc");
    expect(stripNormalizedPrefix("abc", 3)).toBe("");
    expect(stripNormalizedPrefix("abc", 99)).toBe("");
  });

  it("counts a whitespace run as one normalized character", () => {
    expect(stripNormalizedPrefix("a\n\nb", 1)).toBe("\n\nb");
    // 第 2 个归一化字符是空白串：按起始位置切分，空白串的剩余字符留在输出中
    expect(stripNormalizedPrefix("a\n\nb", 2)).toBe("\nb");
    expect(stripNormalizedPrefix(" \n a", 1)).toBe("\n a");
  });
});
