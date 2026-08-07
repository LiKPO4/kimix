import { describe, expect, it } from "vitest";
import { mcpStatusLabel, mcpStatusTone } from "../mcpServerStatus";

describe("mcpServerStatus", () => {
  it("maps every upstream 0.34 status to a Chinese label", () => {
    expect(mcpStatusLabel("connected")).toBe("已连接");
    expect(mcpStatusLabel("pending")).toBe("连接中");
    expect(mcpStatusLabel("connecting")).toBe("连接中");
    expect(mcpStatusLabel("failed")).toBe("连接失败");
    expect(mcpStatusLabel("error")).toBe("连接失败");
    expect(mcpStatusLabel("disabled")).toBe("已禁用");
    expect(mcpStatusLabel("needs-auth")).toBe("需要授权");
    expect(mcpStatusLabel("removed")).toBe("已移除");
  });

  it("falls back to the raw string for unknown statuses", () => {
    expect(mcpStatusLabel("something-else")).toBe("something-else");
  });

  it("colors failures and auth requests with the danger tone", () => {
    expect(mcpStatusTone("connected")).toBe("text-accent-success");
    for (const status of ["failed", "error", "needs-auth"]) {
      expect(mcpStatusTone(status)).toBe("text-accent-danger");
    }
    for (const status of ["pending", "connecting", "disabled", "removed", "unknown"]) {
      expect(mcpStatusTone(status)).toBe("text-[var(--kimix-panel-text-muted)]");
    }
  });
});
