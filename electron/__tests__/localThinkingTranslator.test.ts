import { describe, expect, it, vi } from "vitest";
import path from "node:path";

vi.mock("electron", () => ({
  utilityProcess: { fork: vi.fn() },
}));

import { isPathInside } from "../localThinkingTranslator";
import { normalizeThinkingTranslationProvider } from "../settingsService";

describe("本地思考翻译边界", () => {
  it("只允许删除模型根目录内部的明确子目录", () => {
    const root = path.resolve("kimix-test-data", "models");
    expect(isPathInside(root, path.join(root, "opus-mt-en-zh"))).toBe(true);
    expect(isPathInside(root, root)).toBe(false);
    expect(isPathInside(root, path.resolve(root, "..", "other"))).toBe(false);
  });

  it("把旧版已开启布尔值迁移为 Azure，并优先保留新版互斥提供方", () => {
    expect(normalizeThinkingTranslationProvider(undefined, true)).toBe("azure");
    expect(normalizeThinkingTranslationProvider(undefined, false)).toBe("off");
    expect(normalizeThinkingTranslationProvider("local", true)).toBe("local");
    expect(normalizeThinkingTranslationProvider("invalid", true)).toBe("azure");
  });
});
