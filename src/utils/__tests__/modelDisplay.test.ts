import { describe, expect, it } from "vitest";
import { compactModelDisplayName, compactModelText, extractModelFromStatusMessage, getLastUsedModelFromEvents, getLastUsedModelFromEventsAfter, getSessionModelForDisplay, resolveAuthoritativeSessionModel, resolveResumedSessionModel } from "../modelDisplay";

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

  it("keeps the authoritative session model even when a later replay carries an older turn model", () => {
    expect(getSessionModelForDisplay({
      sessionModel: "deepseek-v4-pro",
      events: [{ type: "assistant_message", timestamp: 100, model: "deepseek-v4-flash" }],
    })).toBe("deepseek-v4-pro");
  });

  it("falls back to the latest turn model only when the session has no authoritative model", () => {
    expect(getSessionModelForDisplay({
      events: [{ type: "assistant_message", timestamp: 100, model: "deepseek-v4-flash" }],
    })).toBe("deepseek-v4-flash");
  });

  it("uses the official runtime profile to repair stale local and history models", () => {
    expect(resolveAuthoritativeSessionModel({
      runtimeModel: "opencode-go/deepseek-v4-pro",
      sessionModel: "opencode-go/deepseek-v4-flash",
      historyModel: "opencode-go/deepseek-v4-flash",
    })).toBe("opencode-go/deepseek-v4-pro");
  });

  it("uses local session state before historical turn metadata when runtime status is unavailable", () => {
    expect(resolveAuthoritativeSessionModel({
      sessionModel: "opencode-go/deepseek-v4-pro",
      historyModel: "opencode-go/deepseek-v4-flash",
    })).toBe("opencode-go/deepseek-v4-pro");
  });

  it("keeps a pending manual model switch visible until a new assistant confirms it", () => {
    const events = [{ type: "assistant_message", timestamp: 100, model: "deepseek-v4-flash" }];
    expect(getSessionModelForDisplay({ sessionModel: "kimi-for-coding", modelSwitchedAt: 200, events }))
      .toBe("kimi-for-coding");
    expect(getSessionModelForDisplay({
      sessionModel: "kimi-for-coding",
      modelSwitchedAt: 200,
      events: [...events, { type: "assistant_message", timestamp: 300, model: "kimi-for-coding" }],
    })).toBe("kimi-for-coding");
  });

  it("ignores model evidence from before a manual switch", () => {
    const events = [
      { type: "assistant_message", timestamp: 100, model: "old-model" },
      { type: "assistant_message", timestamp: 300, model: "new-model" },
    ];
    expect(getLastUsedModelFromEventsAfter(events, 200)).toBe("new-model");
    expect(getLastUsedModelFromEventsAfter(events.slice(0, 1), 200)).toBeNull();
  });

  it("does not let stale resume metadata override a manual model switch", () => {
    expect(resolveResumedSessionModel({
      resumedModel: "old-model",
      sessionModel: "new-model",
      switchedToModel: "new-model",
      modelSwitchedAt: 200,
    })).toBe("new-model");
  });

  it("uses the resumed official model when only an old switch timestamp remains", () => {
    expect(resolveResumedSessionModel({
      resumedModel: "opencode-go/deepseek-v4-pro",
      sessionModel: "opencode-go/deepseek-v4-flash",
      modelSwitchedAt: 200,
    })).toBe("opencode-go/deepseek-v4-pro");
  });
});
