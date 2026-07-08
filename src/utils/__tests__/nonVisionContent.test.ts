import { describe, expect, it } from "vitest";
import { rewriteOpenAIContentForNonVision } from "../../../electron/nonVisionContent";

describe("rewriteOpenAIContentForNonVision", () => {
  it("rewrites SDK serialized snake_case image_url content", () => {
    expect(rewriteOpenAIContentForNonVision([
      { type: "text", text: "分析图片" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AA==", id: "shot.png" } },
    ])).toBe("分析图片\n[图片: shot.png]");
  });

  it("keeps compatibility with camelCase imageUrl content", () => {
    expect(rewriteOpenAIContentForNonVision([
      { type: "image_url", imageUrl: { url: "data:image/png;base64,AA==", id: "legacy.png" } },
    ])).toBe("[图片: legacy.png]");
  });
});
