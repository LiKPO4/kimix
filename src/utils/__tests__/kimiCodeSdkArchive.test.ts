import { describe, expect, it, vi } from "vitest";
import { archiveSdkSession } from "../../../electron/kimiCodeHost";

describe("Kimi Code SDK archive", () => {
  it("通过官方 SDK Harness 归档指定会话", async () => {
    const archiveSession = vi.fn(async () => undefined);

    await archiveSdkSession({ archiveSession }, "session-official");

    expect(archiveSession).toHaveBeenCalledWith({ sessionId: "session-official" });
  });

  it("SDK 缺少归档能力时显式报错", async () => {
    await expect(archiveSdkSession({}, "session-old-sdk"))
      .rejects.toThrow("当前官方 SDK 不支持归档会话。");
  });
});
