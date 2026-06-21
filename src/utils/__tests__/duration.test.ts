import { describe, expect, it } from "vitest";
import { formatAssistantTurnDuration } from "../duration";

describe("formatAssistantTurnDuration", () => {
  it("formats elapsed time with Chinese units", () => {
    expect(formatAssistantTurnDuration(1_000)).toBe("1秒");
    expect(formatAssistantTurnDuration(65_000)).toBe("1分5秒");
    expect(formatAssistantTurnDuration(120_000)).toBe("2分0秒");
  });
});
