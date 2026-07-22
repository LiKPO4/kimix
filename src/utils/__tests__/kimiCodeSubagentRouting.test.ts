import { describe, expect, it, vi } from "vitest";
import { applySubagentRoutingAtomic } from "../../../electron/kimiCodeHost";

describe("applySubagentRoutingAtomic", () => {
  it("applies model and thinking effort and returns the refreshed status", async () => {
    let model = "";
    let effort = "";
    const session = {
      getStatus: vi.fn(async () => ({ subagentModel: model || undefined, subagentThinkingEffort: effort || undefined })),
      setSubagentModel: vi.fn(async (value: string) => { model = value; }),
      setSubagentThinkingEffort: vi.fn(async (value: string) => { effort = value; }),
    };

    await expect(applySubagentRoutingAtomic(session, {
      modelAlias: "  glm-5.2 ",
      thinkingEffort: " high ",
    })).resolves.toMatchObject({
      subagentModel: "glm-5.2",
      subagentThinkingEffort: "high",
    });
    expect(session.setSubagentModel).toHaveBeenCalledWith("glm-5.2");
    expect(session.setSubagentThinkingEffort).toHaveBeenCalledWith("high");
  });

  it("rolls both values back when the second mutation fails", async () => {
    let model = "old-model";
    let effort = "medium";
    let effortCalls = 0;
    const session = {
      getStatus: vi.fn(async () => ({ subagentModel: model, subagentThinkingEffort: effort })),
      setSubagentModel: vi.fn(async (value: string) => { model = value; }),
      setSubagentThinkingEffort: vi.fn(async (value: string) => {
        effortCalls += 1;
        if (effortCalls === 1) throw new Error("effort rejected");
        effort = value;
      }),
    };

    await expect(applySubagentRoutingAtomic(session, {
      modelAlias: "new-model",
      thinkingEffort: "high",
    })).rejects.toThrow("effort rejected");
    expect(model).toBe("old-model");
    expect(effort).toBe("medium");
  });

  it("uses empty strings to clear inherited overrides", async () => {
    const session = {
      getStatus: vi.fn(async () => ({})),
      setSubagentModel: vi.fn(async () => undefined),
      setSubagentThinkingEffort: vi.fn(async () => undefined),
    };

    await applySubagentRoutingAtomic(session, {});
    expect(session.setSubagentModel).toHaveBeenCalledWith("");
    expect(session.setSubagentThinkingEffort).toHaveBeenCalledWith("");
  });
});
