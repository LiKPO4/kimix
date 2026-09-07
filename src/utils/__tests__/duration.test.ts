import { describe, expect, it } from "vitest";
import { formatAssistantTurnDuration } from "../duration";

describe("formatAssistantTurnDuration", () => {
  it("formats elapsed time with Chinese units", () => {
    expect(formatAssistantTurnDuration(1_000)).toBe("1秒");
    expect(formatAssistantTurnDuration(65_000)).toBe("1分5秒");
    expect(formatAssistantTurnDuration(120_000)).toBe("2分0秒");
    // 60 分台保持分秒格式，61 分钟起改用 小时/分/秒
    expect(formatAssistantTurnDuration(3_599_000)).toBe("59分59秒");
    expect(formatAssistantTurnDuration(3_622_000)).toBe("60分22秒");
    expect(formatAssistantTurnDuration(3_660_000)).toBe("1小时1分0秒");
    expect(formatAssistantTurnDuration(3_682_000)).toBe("1小时1分22秒");
    expect(formatAssistantTurnDuration(21_122_000)).toBe("5小时52分2秒");
  });
});
