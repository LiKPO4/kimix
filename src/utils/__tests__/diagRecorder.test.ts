import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatDiagRecorderLine,
  formatFrameGapLine,
  formatFrameSampleLine,
  formatRemainingLabel,
  getDiagRecorderState,
  recordDiagLine,
  resetDiagRecorderForTests,
  setDiagRecordingAutoArm,
  shouldRecordFrameGap,
  startDiagRecording,
  stopDiagRecording,
  syncDiagRecorderFromMain,
} from "../diagRecorder";

const FLUSH_TRIGGER_LINES = 40;

function installMockApi(overrides: Partial<Record<string, unknown>> = {}) {
  const api = {
    startDiagRecording: vi.fn(async () => ({
      success: true,
      data: {
        filePath: "C:/tmp/kimix-record-20260913-101010.log",
        startedAt: 1_000,
        endsAt: 1_000 + 300_000,
        durationMs: 300_000,
        lineCount: 0,
        bytes: 0,
      },
    })),
    appendDiagRecording: vi.fn(async () => ({ success: true })),
    stopDiagRecording: vi.fn(async () => ({
      success: true,
      data: {
        filePath: "C:/tmp/kimix-record-20260913-101010.log",
        startedAt: 1_000,
        stoppedAt: 2_000,
        durationMs: 1_000,
        lineCount: 2,
        bytes: 64,
        reason: "manual",
      },
    })),
    getDiagRecordingStatus: vi.fn(async () => ({
      success: true,
      data: {
        active: false,
        filePath: null,
        startedAt: null,
        endsAt: null,
        remainingMs: 0,
        lineCount: 0,
        bytes: 0,
        autoArm: false,
      },
    })),
    setDiagRecordingAutoArm: vi.fn(async (req: { armed: boolean }) => ({
      success: true,
      data: { autoArm: req.armed },
    })),
    ...overrides,
  };
  (window as unknown as { api: unknown }).api = api;
  return api;
}

beforeEach(() => {
  resetDiagRecorderForTests();
});

afterEach(() => {
  resetDiagRecorderForTests();
  vi.useRealTimers();
  delete (window as unknown as { api?: unknown }).api;
});

describe("diagRecorder 纯函数", () => {
  it("帧间隔超阈值才算卡顿", () => {
    expect(shouldRecordFrameGap(100)).toBe(false);
    expect(shouldRecordFrameGap(100.5)).toBe(true);
    expect(shouldRecordFrameGap(Number.NaN)).toBe(false);
  });

  it("格式化行带 ISO 时间戳与可选 JSON 数据", () => {
    const line = formatDiagRecorderLine("[console] warn: 卡顿", { lagMs: 300 });
    expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2}T/);
    expect(line).toContain("[console] warn: 卡顿");
    expect(line).toContain('{"lagMs":300}');
    expect(formatFrameGapLine(233.6)).toContain("[frame] gap 234ms");
    expect(formatFrameSampleLine({ frames: 120, maxGapMs: 210 }, 88, "visible"))
      .toContain("[frame] sample frames=120 maxGapMs=210 heapMB=88 visible=visible");
  });

  it("剩余时间显示为 m:ss", () => {
    expect(formatRemainingLabel(300_000)).toBe("5:00");
    expect(formatRemainingLabel(65_000)).toBe("1:05");
    expect(formatRemainingLabel(0)).toBe("0:00");
    expect(formatRemainingLabel(-10)).toBe("0:00");
  });
});

describe("diagRecorder 录制流程", () => {
  it("非录制期 recordDiagLine 零开销", () => {
    const api = installMockApi();
    recordDiagLine("hello");
    expect(api.appendDiagRecording).not.toHaveBeenCalled();
    expect(getDiagRecorderState().lineCount).toBe(0);
  });

  it("start 后批量落盘，stop 后进入已保存态", async () => {
    const api = installMockApi();
    await startDiagRecording();
    expect(getDiagRecorderState().phase).toBe("recording");
    expect(api.startDiagRecording).toHaveBeenCalledWith({ durationMs: 300_000 });

    for (let index = 0; index < FLUSH_TRIGGER_LINES; index += 1) recordDiagLine(`line-${index}`);
    await vi.waitFor(() => expect(api.appendDiagRecording).toHaveBeenCalled());
    const firstBatch = (api.appendDiagRecording as ReturnType<typeof vi.fn>).mock.calls[0][0] as { lines: string[] };
    expect(firstBatch.lines.some((line) => line.includes("line-0"))).toBe(true);
    await vi.waitFor(() => expect(getDiagRecorderState().lineCount).toBe(FLUSH_TRIGGER_LINES));

    await stopDiagRecording("manual");
    expect(getDiagRecorderState().phase).toBe("saved");
    expect(api.stopDiagRecording).toHaveBeenCalledWith({ reason: "manual" });
    expect(getDiagRecorderState().filePath).toContain("kimix-record-");
    expect(getDiagRecorderState().lineCount).toBe(2);
  });

  it("1 秒节流后刷新缓冲", async () => {
    vi.useFakeTimers();
    const api = installMockApi();
    await startDiagRecording();
    recordDiagLine("throttled-line");
    expect(api.appendDiagRecording).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.appendDiagRecording).toHaveBeenCalledTimes(1);
    const batch = (api.appendDiagRecording as ReturnType<typeof vi.fn>).mock.calls[0][0] as { lines: string[] };
    expect(batch.lines.some((line) => line.includes("throttled-line"))).toBe(true);
  });

  it("渲染层重载后可从主进程对账恢复录制状态", async () => {
    const endsAt = Date.now() + 120_000;
    installMockApi({
      getDiagRecordingStatus: vi.fn(async () => ({
        success: true,
        data: {
          active: true,
          filePath: "C:/tmp/kimix-record-live.log",
          startedAt: endsAt - 120_000,
          endsAt,
          remainingMs: 120_000,
          lineCount: 7,
          bytes: 512,
        },
      })),
    });
    await syncDiagRecorderFromMain();
    const state = getDiagRecorderState();
    expect(state.phase).toBe("recording");
    expect(state.filePath).toBe("C:/tmp/kimix-record-live.log");
    expect(state.lineCount).toBe(7);

    resetDiagRecorderForTests();
    installMockApi({
      getDiagRecordingStatus: vi.fn(async () => ({
        success: true,
        data: {
          active: false,
          filePath: "C:/tmp/kimix-record-last.log",
          startedAt: 1,
          endsAt: null,
          remainingMs: 0,
          lineCount: 9,
          bytes: 600,
        },
      })),
    });
    await syncDiagRecorderFromMain();
    expect(getDiagRecorderState().phase).toBe("saved");
    expect(getDiagRecorderState().filePath).toBe("C:/tmp/kimix-record-last.log");
  });
});

describe("diagRecorder 启动自动录制开关", () => {
  it("开关写入主进程并回读状态", async () => {
    const api = installMockApi();
    await setDiagRecordingAutoArm(true);
    expect(api.setDiagRecordingAutoArm).toHaveBeenCalledWith({ armed: true });
    expect(getDiagRecorderState().autoArm).toBe(true);

    await setDiagRecordingAutoArm(false);
    expect(getDiagRecorderState().autoArm).toBe(false);
  });

  it("对账采纳主进程的已开启状态", async () => {
    installMockApi({
      getDiagRecordingStatus: vi.fn(async () => ({
        success: true,
        data: {
          active: false,
          filePath: null,
          startedAt: null,
          endsAt: null,
          remainingMs: 0,
          lineCount: 0,
          bytes: 0,
          autoArm: true,
        },
      })),
    });
    await syncDiagRecorderFromMain();
    expect(getDiagRecorderState().autoArm).toBe(true);
  });
});
