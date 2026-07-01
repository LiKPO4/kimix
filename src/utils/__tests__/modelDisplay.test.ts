import { describe, expect, it } from "vitest";
import { compactModelDisplayName, compactModelText, extractModelFromStatusMessage, getLastUsedModelFromEvents } from "../modelDisplay";

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

  it("extracts model from status message", () => {
    expect(extractModelFromStatusMessage("模型：deepseek-v4-flash")).toBe("deepseek-v4-flash");
    expect(extractModelFromStatusMessage("模型:kimi-for-coding")).toBe("kimi-for-coding");
    expect(extractModelFromStatusMessage("kimi-for-coding")).toBeNull();
    expect(extractModelFromStatusMessage("")).toBeNull();
    expect(extractModelFromStatusMessage(undefined)).toBeNull();
  });

  it("finds the latest model from status_update events", () => {
    const events = [
      { type: "status_update", message: "模型：kimi-for-coding" },
      { type: "user_message" },
      { type: "status_update", message: "模型：deepseek-v4-flash" },
      { type: "status_update", message: "消息发送中" },
    ];
    expect(getLastUsedModelFromEvents(events)).toBe("deepseek-v4-flash");
  });

  it("returns null when no status_update contains a model", () => {
    const events = [
      { type: "status_update", message: "消息发送中" },
      { type: "user_message" },
    ];
    expect(getLastUsedModelFromEvents(events)).toBeNull();
  });
});
