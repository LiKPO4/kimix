import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KimiCodeListSessionsRequest, KimiCodeListSessionsResponse } from "../../../electron/types/ipc";
import type { dedupeListKimiCodeSessions as DedupeFn } from "../listKimiCodeSessionsDedupe";

function okResponse(workDir: string): KimiCodeListSessionsResponse {
  return {
    success: true,
    data: [{
      id: "session-1",
      workDir,
      sessionDir: `${workDir}/.kimix/sessions/session-1`,
      createdAt: 1,
      updatedAt: 1,
    }],
    source: "sdk",
  };
}

describe("dedupeListKimiCodeSessions", () => {
  // 模块持有按 workDir 的缓存 Map（in-flight + TTL），跨用例会互相污染；
  // 每个用例重新加载模块实例，保证缓存状态隔离。
  let dedupe: typeof DedupeFn;
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    ({ dedupeListKimiCodeSessions: dedupe } = await import("../listKimiCodeSessionsDedupe"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shares one in-flight scan for concurrent calls on the same workDir", async () => {
    const fetcher = vi.fn(async (req: KimiCodeListSessionsRequest) => okResponse(req.workDir ?? "?"));
    const first = dedupe({ workDir: "D:/a" }, fetcher);
    const second = dedupe({ workDir: "D:/a" }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const firstResult = await first;
    const secondResult = await second;
    expect(secondResult).toBe(firstResult);
  });

  it("serves the cached result within the TTL window without re-scanning", async () => {
    const fetcher = vi.fn(async (req: KimiCodeListSessionsRequest) => okResponse(req.workDir ?? "?"));
    const first = await dedupe({ workDir: "D:/a" }, fetcher);
    const second = await dedupe({ workDir: "D:/a" }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("re-scans after the TTL window expires", async () => {
    const fetcher = vi.fn(async (req: KimiCodeListSessionsRequest) => okResponse(req.workDir ?? "?"));
    await dedupe({ workDir: "D:/a" }, fetcher);
    await vi.advanceTimersByTimeAsync(5_001);
    await dedupe({ workDir: "D:/a" }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not cache failed scans so later calls retry", async () => {
    const fetcher = vi.fn(async (): Promise<KimiCodeListSessionsResponse> => ({ success: false, error: "boom" }));
    await dedupe({ workDir: "D:/a" }, fetcher);
    await dedupe({ workDir: "D:/a" }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not share results across different workDirs", async () => {
    const fetcher = vi.fn(async (req: KimiCodeListSessionsRequest) => okResponse(req.workDir ?? "?"));
    await dedupe({ workDir: "D:/a" }, fetcher);
    await dedupe({ workDir: "D:/b" }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
