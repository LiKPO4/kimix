import { describe, expect, it } from "vitest";
import { capLiveThinkingRenderText, LIVE_THINKING_RENDER_MAX_CHARS } from "../thinkingBlocks";

describe("capLiveThinkingRenderText", () => {
  it("keeps short text unchanged", () => {
    expect(capLiveThinkingRenderText("短思考")).toBe("短思考");
  });

  it("keeps only the tail of long text", () => {
    const text = "x".repeat(LIVE_THINKING_RENDER_MAX_CHARS + 500);
    const capped = capLiveThinkingRenderText(text);
    expect(capped.length).toBe(LIVE_THINKING_RENDER_MAX_CHARS + 1);
    expect(capped.startsWith("…")).toBe(true);
    expect(capped.endsWith("x".repeat(500))).toBe(true);
  });
});
