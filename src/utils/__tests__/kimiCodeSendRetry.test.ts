import { afterEach, describe, expect, it, vi } from "vitest";
import { isKimiActiveTurnError, sendKimiCodePromptWithRetry } from "../kimiCodeSendRetry";

describe("kimiCodeSendRetry", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("recognizes official active turn errors", () => {
    expect(isKimiActiveTurnError("Cannot launch a new turn while another turn (ID 5) is active")).toBe(true);
    expect(isKimiActiveTurnError("network unavailable")).toBe(false);
  });

  it("does not cancel an active turn after retrying", async () => {
    vi.useFakeTimers();
    const sendKimiCodePrompt = vi.fn().mockResolvedValue({
      success: false,
      error: "Cannot launch a new turn while another turn (ID 5) is active",
    });
    const cancelKimiCodeTurn = vi.fn().mockResolvedValue({ success: true });

    vi.stubGlobal("window", {
      setTimeout,
      api: {
        sendKimiCodePrompt,
        cancelKimiCodeTurn,
      },
    });

    const resultPromise = sendKimiCodePromptWithRetry({
      sessionId: "runtime-1",
      content: "hello",
      images: [],
    });

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(sendKimiCodePrompt).toHaveBeenCalledTimes(5);
    expect(cancelKimiCodeTurn).not.toHaveBeenCalled();
  });
});
