import { describe, expect, it } from "vitest";
import { buildThinkingEffortOptions, resolveThinkingEffort, thinkingEffortLabel } from "../thinkingEffort";

describe("thinking effort options", () => {
  it("uses exactly the effort levels declared by the current model", () => {
    expect(buildThinkingEffortOptions(["low", "medium", "high"]).map((option) => option.value))
      .toEqual(["low", "medium", "high"]);
  });

  it("does not invent an off option for an always-thinking model", () => {
    const options = buildThinkingEffortOptions(["medium", "high"]);
    expect(resolveThinkingEffort("off", options, "high")).toBe("high");
  });

  it("keeps the legacy off/on selector when the model declares no levels", () => {
    expect(buildThinkingEffortOptions([]).map((option) => option.value)).toEqual(["off", "on"]);
  });

  it("maps standard effort names to concise Chinese labels", () => {
    expect(thinkingEffortLabel("max")).toBe("最高");
    expect(thinkingEffortLabel("off")).toBe("关闭");
  });
});
