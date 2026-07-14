import { describe, expect, it, vi } from "vitest";
import { createStartupHydrationGate } from "@/utils/startupHydration";

describe("startup hydration gate", () => {
  it("does not run bootstrap continuation until local sessions are hydrated", async () => {
    const gate = createStartupHydrationGate();
    const continueBootstrap = vi.fn();
    const pending = gate.wait().then(continueBootstrap);

    await Promise.resolve();
    expect(continueBootstrap).not.toHaveBeenCalled();

    gate.markReady();
    await pending;
    expect(continueBootstrap).toHaveBeenCalledOnce();
  });

  it("allows later bootstrap listeners through immediately and tolerates duplicate completion", async () => {
    const gate = createStartupHydrationGate();
    gate.markReady();
    gate.markReady();

    await expect(gate.wait()).resolves.toBeUndefined();
  });
});
