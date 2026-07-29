import { describe, expect, it } from "vitest";
import { getStatusCardDetailTexts, getStatusCardToneClass, shouldDisplayStatusContext } from "../StatusCard";

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

describe("getStatusCardToneClass", () => {
  it("keeps genuine informational notices blue", () => {
    expect(getStatusCardToneClass({
      id: "notice",
      type: "status_update",
      timestamp: 1,
      message: "正在同步配置",
      source: "runtime",
      tone: "info",
    })).toBe("bg-accent-primary-light text-accent-primary");
  });

  it("renders usage metrics neutrally even when legacy data carries a semantic tone", () => {
    expect(getStatusCardToneClass({
      id: "legacy-usage",
      type: "status_update",
      timestamp: 2,
      message: "模型：kimi-code/k3",
      inputTokenCount: 622_188,
      tokenCount: 140,
      source: "runtime",
      tone: "info",
    })).toBe("bg-surface-hover text-text-muted");
    expect(getStatusCardToneClass({
      id: "legacy-success-usage",
      type: "status_update",
      timestamp: 3,
      message: "模型：kimi-code/k3",
      inputTokenCount: 620_802,
      tokenCount: 113,
      source: "runtime",
      tone: "success",
    })).toBe("bg-surface-hover text-text-muted");
  });
});
