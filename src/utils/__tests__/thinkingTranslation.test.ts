import { describe, expect, it } from "vitest";
import {
  buildThinkingTranslationChunk,
  isMostlyChineseThinking,
  joinThinkingTranslations,
  protectThinkingCode,
  restoreThinkingCode,
} from "../thinkingTranslation";

describe("thinkingTranslation", () => {
  it("流式阶段只提交完整句段并保留未闭合尾巴", () => {
    const source = "First sentence. Second sentence is still growing";
    const chunk = buildThinkingTranslationChunk(source, 0, false);
    expect(chunk?.sourceText).toBe("First sentence. ");
    expect(chunk?.sourceEnd).toBe("First sentence. ".length);
  });

  it("结束阶段会补译剩余尾巴", () => {
    const source = "First sentence. unfinished tail";
    const offset = "First sentence. ".length;
    expect(buildThinkingTranslationChunk(source, offset, true)?.sourceText).toBe("unfinished tail");
  });

  it("长文本即使没有句号也会被限制为有界请求", () => {
    const source = `${"word ".repeat(40)}tail`;
    const chunk = buildThinkingTranslationChunk(source, 0, false, 80);
    expect(chunk).not.toBeNull();
    expect(chunk!.sourceText.length).toBeLessThanOrEqual(80);
  });

  it("保护并恢复围栏代码和行内代码", () => {
    const source = "Run `pnpm test` first.\n```ts\nconst answer = 42;\n```";
    const protectedValue = protectThinkingCode(source);
    expect(protectedValue.protectedText).not.toContain("pnpm test");
    expect(protectedValue.protectedText).not.toContain("const answer");
    expect(restoreThinkingCode(protectedValue.protectedText, protectedValue.placeholders)).toBe(source);
    expect(() => restoreThinkingCode(protectedValue.protectedText.replace("KIMIX_CODE_0", "KIMIX CODE 0"), protectedValue.placeholders))
      .toThrow("未完整保留代码占位符");
  });

  it("中文判断忽略代码内容", () => {
    expect(isMostlyChineseThinking("先检查现有实现，然后补充测试。 `const englishIdentifier = true`")) .toBe(true);
    expect(isMostlyChineseThinking("Inspect the existing implementation and add focused tests.")) .toBe(false);
  });

  it("增量译文之间使用稳定换行", () => {
    expect(joinThinkingTranslations("第一句。\n", " 第二句。")) .toBe("第一句。\n第二句。");
  });
});
