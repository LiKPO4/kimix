import { describe, expect, it } from "vitest";
import { formatMessageTime, formatMessageTimeTitle } from "../messageTime";

describe("messageTime", () => {
  it("formats every message as YY/M/D HH:mm", () => {
    expect(formatMessageTime(new Date(2026, 6, 30, 15, 9).getTime())).toBe("26/7/30 15:09");
    expect(formatMessageTime(new Date(2025, 11, 8, 7, 4).getTime())).toBe("25/12/8 07:04");
  });

  it("provides an exact local timestamp for the hover title", () => {
    expect(formatMessageTimeTitle(new Date(2026, 6, 29, 21, 20, 7).getTime())).toBe("2026年7月29日 21:20:07");
  });
});
