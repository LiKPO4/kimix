/**
 * loadSessionHistoryParallel 定向测试。
 *
 * 覆盖目标：
 * - server 已启用 / 冷启动成功：仍优先 server 快照并做本地 StatusUpdate 水合（行为不变）；
 * - server 未就绪（超时或失败）：本地镜像直接返回，不被冷启动串行阻塞；
 * - 本地 wire 镜像只解析一次：水合与回退均复用同一结果（消除双读）。
 */
import { describe, expect, it, vi } from "vitest";
import {
  loadSessionHistoryParallel,
  type LoadSessionParallelDeps,
  type SessionHistoryEvent,
} from "../sessionHistory";
import type { SessionHistoryResult } from "../sessionHistoryFallback";

const serverEvents: SessionHistoryEvent[] = [
  { type: "TurnBegin", payload: { user_input: "hi" }, time: 100 },
  { type: "TurnEnd", payload: { finishReason: "end_turn" }, time: 300 },
];

const localEvents: SessionHistoryEvent[] = [
  { type: "TurnBegin", payload: { user_input: "hi" }, time: 100 },
  { type: "StatusUpdate", payload: { token_usage: { output: 10 }, model: "kimi" }, time: 200 },
  { type: "TurnEnd", payload: { finishReason: "end_turn" }, time: 300 },
];

function serverResult(events: SessionHistoryEvent[] = serverEvents): SessionHistoryResult {
  return { events, source: "server" };
}

function baseDeps(overrides: Partial<LoadSessionParallelDeps>): LoadSessionParallelDeps {
  return {
    isServerEnabled: () => false,
    startServer: vi.fn(async () => undefined),
    loadLocal: vi.fn(async () => localEvents),
    loadServer: vi.fn(async () => serverResult()),
    ...overrides,
  };
}

describe("loadSessionHistoryParallel", () => {
  it("server 已启用：走 server 快照并按时间水合本地 StatusUpdate，本地只解析一次", async () => {
    const loadLocal = vi.fn(async () => localEvents);
    const result = await loadSessionHistoryParallel(
      baseDeps({
        isServerEnabled: () => true,
        loadLocal,
      }),
    );
    expect(result.source).toBe("server");
    expect(result.events).toEqual([
      { type: "TurnBegin", payload: { user_input: "hi" }, time: 100 },
      { type: "StatusUpdate", payload: { token_usage: { output: 10 }, model: "kimi" }, time: 200 },
      { type: "TurnEnd", payload: { finishReason: "end_turn" }, time: 300 },
    ]);
    // 水合复用同一解析结果，本地镜像不得二次解析
    expect(loadLocal).toHaveBeenCalledTimes(1);
  });

  it("server 冷启动成功：本地解析与启动并行开始，最终仍走 server 路径", async () => {
    const callOrder: string[] = [];
    const loadLocal = vi.fn(async () => {
      callOrder.push("local");
      return localEvents;
    });
    const startServer = vi.fn(() => {
      callOrder.push("start");
      return Promise.resolve();
    });
    const isServerEnabled = vi
      .fn()
      .mockReturnValueOnce(false) // 进入前：尚未启用，需要冷启动
      .mockReturnValue(true); // 启动后：已切到 server 模式
    const result = await loadSessionHistoryParallel(
      baseDeps({ isServerEnabled, startServer, loadLocal }),
    );
    expect(callOrder).toEqual(["local", "start"]);
    expect(result.source).toBe("server");
    expect(loadLocal).toHaveBeenCalledTimes(1);
  });

  it("server 冷启动失败：回退本地镜像", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const loadLocal = vi.fn(async () => localEvents);
      const result = await loadSessionHistoryParallel(
        baseDeps({
          isServerEnabled: () => false,
          startServer: vi.fn(async () => {
            throw new Error("startup failed");
          }),
          loadLocal,
        }),
      );
      expect(result).toEqual({ events: localEvents, source: "local" });
      expect(loadLocal).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("server 冷启动未就绪：超过等待上限即返回本地，不被挂起的启动阻塞", async () => {
    vi.useFakeTimers();
    try {
      let serverEnabled = false;
      let releaseStartup: (() => void) | undefined;
      const startServer = vi.fn(() => new Promise<void>((resolve) => {
        releaseStartup = resolve;
      }));
      const loadLocal = vi.fn(async () => localEvents);
      const loadServer = vi.fn();
      const promise = loadSessionHistoryParallel(
        baseDeps({ isServerEnabled: () => serverEnabled, startServer, loadLocal, loadServer }),
        { startupWaitMs: 100 },
      );
      // 推进超过 startupWaitMs，但 startServer 仍未 resolve
      await vi.advanceTimersByTimeAsync(150);
      const result = await promise;
      expect(result).toEqual({ events: localEvents, source: "local" });
      expect(loadLocal).toHaveBeenCalledTimes(1);
      expect(loadServer).not.toHaveBeenCalled();
      expect(releaseStartup).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("server 快照加载失败：loadSessionHistoryWithFallback 回退本地镜像，仍只解析一次", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const loadLocal = vi.fn(async () => localEvents);
      const result = await loadSessionHistoryParallel(
        baseDeps({
          isServerEnabled: () => true,
          loadLocal,
          loadServer: vi.fn(async () => {
            throw new Error("snapshot unavailable");
          }),
        }),
        { serverTimeoutMs: 50 },
      );
      expect(result).toEqual({ events: localEvents, source: "local" });
      expect(loadLocal).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("本地水合失败：返回未合并的 server 快照，不向调用方抛错", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await loadSessionHistoryParallel(
        baseDeps({
          isServerEnabled: () => true,
          loadLocal: vi.fn(async () => {
            throw new Error("wire locked");
          }),
        }),
      );
      expect(result.source).toBe("server");
      expect(result.events).toEqual(serverEvents);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("wire hydration failed"),
        expect.anything(),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
