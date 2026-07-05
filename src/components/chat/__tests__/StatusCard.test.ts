import { describe, expect, it } from "vitest";
import { shouldDisplayStatusContext } from "../StatusCard";

describe("shouldDisplayStatusContext", () => {
  it("hides missing and legacy zero context while keeping current positive usage", () => {
    expect(shouldDisplayStatusContext({ id: "missing", type: "status_update", timestamp: 1 })).toBe(false);
    expect(shouldDisplayStatusContext({ id: "legacy-zero", type: "status_update", timestamp: 2, contextSize: 0, contextLimit: 256000 })).toBe(false);
    expect(shouldDisplayStatusContext({ id: "current", type: "status_update", timestamp: 3, contextSize: 1200, contextLimit: 256000 })).toBe(true);
  });
});
