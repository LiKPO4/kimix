import { describe, expect, it } from "vitest";
import { formatMessageTime, formatMessageTimeTitle } from "../messageTime";

describe("messageTime", () => {
  it("uses a compact time for today and includes the date for older messages", () => {
    const now = new Date(2026, 6, 30, 12, 0).getTime();

    expect(formatMessageTime(new Date(2026, 6, 30, 9, 5).getTime(), now)).toBe("09:05");
    expect(formatMessageTime(new Date(2026, 6, 29, 21, 20).getTime(), now)).toBe("7.29 21:20");
    expect(formatMessageTime(new Date(2025, 11, 8, 7, 4).getTime(), now)).toBe("2025.12.8 07:04");
  });

  it("provides an exact local timestamp for the hover title", () => {
    expect(formatMessageTimeTitle(new Date(2026, 6, 29, 21, 20, 7).getTime())).toBe("2026年7月29日 21:20:07");
  });
});
