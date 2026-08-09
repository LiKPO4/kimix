import { describe, expect, it } from "vitest";
import {
  buildThinkingEffortOptions,
  resolveModelDefaultThinkingEffort,
  resolveThinkingEffort,
  thinkingEffortLabel,
  thinkingEffortMenuLabel,
} from "../thinkingEffort";

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

  it("shows the exact wire value only inside the effort menu label", () => {
    expect(thinkingEffortMenuLabel("xhigh")).toBe("超高（xhigh）");
    expect(thinkingEffortMenuLabel("max")).toBe("最高（max）");
    expect(thinkingEffortLabel("max")).toBe("最高");
  });

  it("resets a model switch to the new model's declared default", () => {
    expect(resolveModelDefaultThinkingEffort(["low", "medium", "high"], "medium")).toBe("medium");
  });

  it("delegates to the runtime when the new model has no trustworthy default", () => {
    expect(resolveModelDefaultThinkingEffort(["low", "high"], null)).toBe("on");
    expect(resolveModelDefaultThinkingEffort(["low", "high"], "max")).toBe("on");
    expect(resolveModelDefaultThinkingEffort([], "high")).toBe("on");
  });
});
