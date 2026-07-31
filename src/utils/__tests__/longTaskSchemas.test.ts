import { describe, expect, it } from "vitest";
import { UpdateLongTaskStateSchema } from "../../../electron/longTaskSchemas";

const base = {
  projectPath: "D:/project",
  taskId: "lt-20260101-abcd1234",
};

describe("UpdateLongTaskStateSchema", () => {
  it("接受携带 recovery 对象的 patch", () => {
    const parsed = UpdateLongTaskStateSchema.safeParse({
      ...base,
      patch: {
        stage: "running",
        recovery: {
          status: "interrupted",
          reason: "进程退出",
          suggestedAction: "恢复执行",
          updatedAt: 1720000000000,
        },
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("接受 recovery 为 null 的 patch", () => {
    const parsed = UpdateLongTaskStateSchema.safeParse({
      ...base,
      patch: { recovery: null, currentStep: 2, targetStep: 5 },
    });
    expect(parsed.success).toBe(true);
  });

  it("接受省略 recovery 的 patch", () => {
    const parsed = UpdateLongTaskStateSchema.safeParse({
      ...base,
      patch: { stage: "paused" },
    });
    expect(parsed.success).toBe(true);
  });

  it("拒绝携带未知字段的 patch（strict）", () => {
    const parsed = UpdateLongTaskStateSchema.safeParse({
      ...base,
      patch: { unknownField: 1 },
    });
    expect(parsed.success).toBe(false);
  });

  it("拒绝 status 非法的 recovery", () => {
    const parsed = UpdateLongTaskStateSchema.safeParse({
      ...base,
      patch: {
        recovery: {
          status: "boom",
          reason: "x",
          suggestedAction: "y",
          updatedAt: 1,
        },
      },
    });
    expect(parsed.success).toBe(false);
  });
});
