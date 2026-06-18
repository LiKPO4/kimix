import { describe, expect, it } from "vitest";
import { serverStatusToAgentEvent } from "../../../electron/kimiCodeHost";

describe("Kimi Server session status adapter", () => {
  it("maps official context fields to the existing SDK status event", () => {
    expect(serverStatusToAgentEvent({
      status: "idle",
      model: "kimi-code/kimi-for-coding",
      thinking_level: "high",
      permission: "manual",
      plan_mode: true,
      swarm_mode: false,
      context_tokens: 64000,
      max_context_tokens: 256000,
      context_usage: 0.25,
    })).toEqual({
      type: "agent.status.updated",
      model: "kimi-code/kimi-for-coding",
      thinkingLevel: "high",
      permission: "manual",
      planMode: true,
      swarmMode: false,
      contextTokens: 64000,
      maxContextTokens: 256000,
      contextUsage: 0.25,
    });
  });
});
