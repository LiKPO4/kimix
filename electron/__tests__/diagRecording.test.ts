import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DIAG_RECORDING_DEFAULT_DURATION_MS,
  DIAG_RECORDING_MAX_DURATION_MS,
  createDiagRecordingController,
  formatDiagRecordingFileName,
  normalizeDiagRecordingDuration,
  readDiagRecordingAutoArm,
  writeDiagRecordingAutoArm,
} from "../diagRecording";

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kimix-diag-recording-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.useRealTimers();
});

function readLog(filePath: string) {
  return fs.readFileSync(filePath, "utf8");
}

describe("diagRecording helpers", () => {
  it("文件名按本地时间零填充", () => {
    expect(formatDiagRecordingFileName(new Date(2026, 8, 13, 9, 5, 7)))
      .toBe("kimix-record-20260913-090507.log");
  });

  it("启动自动录制标记可写入、读取与清除", async () => {
    expect(await readDiagRecordingAutoArm(tempDir)).toBe(false);
    await writeDiagRecordingAutoArm(tempDir, true);
    expect(await readDiagRecordingAutoArm(tempDir)).toBe(true);
    await writeDiagRecordingAutoArm(tempDir, false);
    expect(await readDiagRecordingAutoArm(tempDir)).toBe(false);
  });

  it("收尾后触发 onSessionEnd 回调（含停止原因与路径）", async () => {
    const onSessionEnd = vi.fn();
    const controller = createDiagRecordingController({ baseDir: tempDir, onSessionEnd });
    const started = await controller.start(60_000);
    expect(started.ok).toBe(true);
    await controller.stop("manual");
    expect(onSessionEnd).toHaveBeenCalledTimes(1);
    const result = onSessionEnd.mock.calls[0][0] as { reason: string; filePath: string };
    expect(result.reason).toBe("manual");
    if (started.ok) expect(result.filePath).toBe(started.filePath);
  });

  it("时长归一化：非法值回退默认，越界收敛到 30s~30min", () => {
    expect(normalizeDiagRecordingDuration(undefined)).toBe(DIAG_RECORDING_DEFAULT_DURATION_MS);
    expect(normalizeDiagRecordingDuration(Number.NaN)).toBe(DIAG_RECORDING_DEFAULT_DURATION_MS);
    expect(normalizeDiagRecordingDuration(1_000)).toBe(30_000);
    expect(normalizeDiagRecordingDuration(60 * 60 * 1000)).toBe(DIAG_RECORDING_MAX_DURATION_MS);
    expect(normalizeDiagRecordingDuration(60_000)).toBe(60_000);
  });
});

describe("createDiagRecordingController", () => {
  it("启停闭环：文件头、追加行与尾部汇总都落盘", async () => {
    const controller = createDiagRecordingController({
      baseDir: tempDir,
      headerProvider: () => ["# app=test"],
    });
    const started = await controller.start(60_000);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(controller.status().active).toBe(true);
    expect(controller.status().remainingMs).toBeLessThanOrEqual(60_000);

    controller.append(["[2026-01-01T00:00:00.000Z] frame-gap 180ms"]);
    controller.captureLine("[2026-01-01T00:00:01.000Z] [live] settle");
    await controller.flush();

    const content = readLog(started.filePath);
    expect(content).toContain("# Kimix 诊断录制");
    expect(content).toContain("# app=test");
    expect(content).toContain("frame-gap 180ms");
    expect(content).toContain("[live] settle");

    const stopped = await controller.stop("manual");
    expect(stopped.ok).toBe(true);
    if (!stopped.ok) return;
    expect(stopped.reason).toBe("manual");
    expect(stopped.filePath).toBe(started.filePath);
    expect(controller.status().active).toBe(false);
    expect(readLog(started.filePath)).toContain("reason=manual");
  });

  it("未录制时 append/captureLine 不落盘也不报错", async () => {
    const controller = createDiagRecordingController({ baseDir: tempDir });
    expect(() => controller.append(["x"])).not.toThrow();
    expect(() => controller.captureLine("[x] y")).not.toThrow();
    await controller.flush();
    expect(fs.readdirSync(tempDir)).toEqual([]);
    expect(controller.status().active).toBe(false);
  });

  it("到时自动停止并写明 timeout 原因", async () => {
    let fakeNow = 1_000_000;
    vi.useFakeTimers();
    const controller = createDiagRecordingController({ baseDir: tempDir, now: () => fakeNow });
    const started = await controller.start(60_000);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    fakeNow += 60_000;
    await vi.advanceTimersByTimeAsync(60_000);
    await controller.flush();

    expect(controller.status().active).toBe(false);
    expect(readLog(started.filePath)).toContain("reason=timeout");
  });

  it("超过大小上限自动停止并写明 size-cap", async () => {
    const controller = createDiagRecordingController({ baseDir: tempDir, maxBytes: 256 });
    const started = await controller.start(60_000);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    controller.append(Array.from({ length: 60 }, (_, index) => `line-${index}-${"x".repeat(32)}`));
    await controller.flush();

    expect(controller.status().active).toBe(false);
    expect(readLog(started.filePath)).toContain("reason=size-cap");
  });

  it("重复 stop 幂等返回最后一次结果；重复 start 返回进行中的会话", async () => {
    const controller = createDiagRecordingController({ baseDir: tempDir });
    const first = await controller.start(60_000);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = await controller.start(60_000);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.filePath).toBe(first.filePath);

    const stopped = await controller.stop("manual");
    const stoppedAgain = await controller.stop("manual");
    expect(stopped.ok && stoppedAgain.ok).toBe(true);
    if (!stopped.ok || !stoppedAgain.ok) return;
    expect(stoppedAgain.filePath).toBe(stopped.filePath);
    expect(stoppedAgain.reason).toBe(stopped.reason);
  });

  it("采样行随 start 立即记录一次并周期追加", async () => {
    let fakeNow = 2_000_000;
    vi.useFakeTimers();
    const controller = createDiagRecordingController({
      baseDir: tempDir,
      now: () => fakeNow,
      sampleIntervalMs: 10_000,
      sampleProvider: () => `[main] sample rss=${process.memoryUsage().rss > 0 ? "ok" : "none"}`,
    });
    const started = await controller.start(60_000);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    fakeNow += 20_000;
    await vi.advanceTimersByTimeAsync(20_000);
    await controller.flush();

    const content = readLog(started.filePath);
    const sampleCount = content.split("[main] sample rss=ok").length - 1;
    expect(sampleCount).toBeGreaterThanOrEqual(3);
  });
});
