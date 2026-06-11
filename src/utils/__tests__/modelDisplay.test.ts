import { describe, expect, it } from "vitest";
import { compactModelDisplayName, compactModelText } from "../modelDisplay";

describe("modelDisplay", () => {
  it("shows only the segment after the final slash", () => {
    expect(compactModelDisplayName("kimi-code/kimi-for-coding")).toBe("kimi-for-coding");
    expect(compactModelDisplayName("deepseek/deepseek-v4-flash")).toBe("deepseek-v4-flash");
  });

  it("keeps names without slash unchanged", () => {
    expect(compactModelDisplayName("kimi-for-coding")).toBe("kimi-for-coding");
  });

  it("compacts model names inside status text", () => {
    expect(compactModelText("模型：kimi-code/kimi-for-coding")).toBe("模型：kimi-for-coding");
    expect(compactModelText("模型：kimi-for-coding")).toBe("模型：kimi-for-coding");
  });
});
