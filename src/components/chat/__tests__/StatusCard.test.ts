import { describe, expect, it } from "vitest";
import { getStatusCardDetailTexts, shouldDisplayStatusContext } from "../StatusCard";

describe("shouldDisplayStatusContext", () => {
  it("hides missing and legacy zero context while keeping current positive usage", () => {
    expect(shouldDisplayStatusContext({ id: "missing", type: "status_update", timestamp: 1 })).toBe(false);
    expect(shouldDisplayStatusContext({ id: "legacy-zero", type: "status_update", timestamp: 2, contextSize: 0, contextLimit: 256000 })).toBe(false);
    expect(shouldDisplayStatusContext({ id: "current", type: "status_update", timestamp: 3, contextSize: 1200, contextLimit: 256000 })).toBe(true);
  });
});

describe("getStatusCardDetailTexts", () => {
  it("labels input and output separately without exposing the event timestamp", () => {
    const details = getStatusCardDetailTexts({
      id: "usage",
      type: "status_update",
      timestamp: new Date("2026-07-13T11:37:21+08:00").getTime(),
      message: "模型：kimi-code/kimi-for-coding-highspeed",
      inputTokenCount: 128,
      tokenCount: 72,
    }, false);

    expect(details).toEqual(["模型：kimi-for-coding-highspeed", "输入: 128", "输出: 72"]);
    expect(details.join(" ")).not.toContain("2026-07-13");
  });
});
