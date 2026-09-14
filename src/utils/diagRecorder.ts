/**
 * 设置 → 诊断 →「日志录制」的渲染层采集器。
 *
 * 录制期间收集：长帧卡顿（rAF 帧间隔）、周期采样（帧数/最大帧间隔/JS 堆）、
 * console 与 longtask（经 useRendererLagDetector 转发）、以及主进程侧并入的
 * diag.log 行与心跳摘要。批量经 IPC 交给主进程串行落盘，默认 5 分钟自动停止。
 */

export const DIAG_RECORDING_DEFAULT_DURATION_MS = 5 * 60 * 1000;
export const FRAME_GAP_THRESHOLD_MS = 100;
const SAMPLE_INTERVAL_MS = 10_000;
const FLUSH_INTERVAL_MS = 1_000;
const FLUSH_MAX_LINES = 40;

export type DiagRecorderPhase = "idle" | "recording" | "saved";

export type DiagRecorderState = {
  phase: DiagRecorderPhase;
  startedAt: number | null;
  endsAt: number | null;
  durationMs: number;
  lineCount: number;
  filePath: string | null;
  lastError: string | null;
};

const EMPTY_STATE: DiagRecorderState = {
  phase: "idle",
  startedAt: null,
  endsAt: null,
  durationMs: DIAG_RECORDING_DEFAULT_DURATION_MS,
  lineCount: 0,
  filePath: null,
  lastError: null,
};

let state: DiagRecorderState = { ...EMPTY_STATE };
const listeners = new Set<(next: DiagRecorderState) => void>();

let buffer: string[] = [];
let flushTimer: number | null = null;
let autoStopTimer: number | null = null;
let sampleTimer: number | null = null;
let rafHandle: number | null = null;
let frameStats = { frames: 0, maxGapMs: 0, lastFrameAt: 0 };

// ---------- 纯函数（可单测） ----------

export function shouldRecordFrameGap(gapMs: number, thresholdMs = FRAME_GAP_THRESHOLD_MS) {
  return Number.isFinite(gapMs) && gapMs > thresholdMs;
}

export function formatDiagRecorderLine(message: string, data?: unknown) {
  const dataPart = data === undefined ? "" : ` ${safeStringify(data)}`;
  return `[${new Date().toISOString()}] ${message}${dataPart}`;
}

export function formatFrameGapLine(gapMs: number) {
  return formatDiagRecorderLine(`[frame] gap ${Math.round(gapMs)}ms`);
}

export function formatFrameSampleLine(
  stats: { frames: number; maxGapMs: number },
  heapMb: number,
  visibilityState: string,
) {
  return formatDiagRecorderLine(
    `[frame] sample frames=${stats.frames} maxGapMs=${Math.round(stats.maxGapMs)} heapMB=${heapMb} visible=${visibilityState}`,
  );
}

export function formatRemainingLabel(remainingMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ---------- 状态与订阅 ----------

export function getDiagRecorderState(): DiagRecorderState {
  return state;
}

export function subscribeDiagRecorder(listener: (next: DiagRecorderState) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setState(patch: Partial<DiagRecorderState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener(state);
}

// ---------- 采集与落盘 ----------

function enqueueLine(line: string) {
  buffer.push(line);
  if (buffer.length >= FLUSH_MAX_LINES) {
    void flushBuffer();
    return;
  }
  if (flushTimer === null) {
    flushTimer = window.setTimeout(() => {
      flushTimer = null;
      void flushBuffer();
    }, FLUSH_INTERVAL_MS);
  }
}

async function flushBuffer() {
  if (buffer.length === 0) return;
  const lines = buffer;
  buffer = [];
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  try {
    const res = await window.api?.appendDiagRecording?.({ lines });
    if (res && !res.success) {
      setState({ lastError: res.error });
      return;
    }
    setState({ lineCount: state.lineCount + lines.length });
  } catch (error) {
    setState({ lastError: error instanceof Error ? error.message : String(error) });
  }
}

/** 供 console/longtask 等模块转发：非录制期零开销。 */
export function recordDiagLine(message: string, data?: unknown) {
  if (state.phase !== "recording") return;
  enqueueLine(formatDiagRecorderLine(message, data));
}

function collectFrameSample() {
  if (state.phase !== "recording") return;
  const memory = (performance as Performance & {
    memory?: { usedJSHeapSize?: number };
  }).memory;
  const heapMb = memory?.usedJSHeapSize !== undefined ? Math.round(memory.usedJSHeapSize / 1024 / 1024) : -1;
  enqueueLine(formatFrameSampleLine(frameStats, heapMb, document.visibilityState));
  frameStats = { frames: 0, maxGapMs: 0, lastFrameAt: performance.now() };
}

function startFrameSampler() {
  if (rafHandle !== null || typeof requestAnimationFrame !== "function") return;
  frameStats = { frames: 0, maxGapMs: 0, lastFrameAt: performance.now() };
  const tick = () => {
    const now = performance.now();
    const gapMs = now - frameStats.lastFrameAt;
    frameStats.lastFrameAt = now;
    frameStats.frames += 1;
    if (shouldRecordFrameGap(gapMs)) {
      frameStats.maxGapMs = Math.max(frameStats.maxGapMs, gapMs);
      enqueueLine(formatFrameGapLine(gapMs));
    }
    rafHandle = requestAnimationFrame(tick);
  };
  rafHandle = requestAnimationFrame(tick);
}

function stopFrameSampler() {
  if (rafHandle !== null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(rafHandle);
  }
  rafHandle = null;
}

function startCollectors() {
  startFrameSampler();
  if (sampleTimer === null) {
    sampleTimer = window.setInterval(collectFrameSample, SAMPLE_INTERVAL_MS);
  }
  collectFrameSample();
}

function stopCollectors() {
  stopFrameSampler();
  if (sampleTimer !== null) {
    window.clearInterval(sampleTimer);
    sampleTimer = null;
  }
}

function armAutoStop(endsAt: number) {
  if (autoStopTimer !== null) window.clearTimeout(autoStopTimer);
  autoStopTimer = window.setTimeout(() => {
    autoStopTimer = null;
    void stopDiagRecording("timeout");
  }, Math.max(0, endsAt - Date.now()) + 250);
}

// ---------- 对外动作 ----------

export async function startDiagRecording(durationMs = DIAG_RECORDING_DEFAULT_DURATION_MS) {
  if (state.phase === "recording") return;
  try {
    const res = await window.api?.startDiagRecording?.({ durationMs });
    if (!res || !res.success) {
      setState({ lastError: res?.error ?? "无法开始录制" });
      return;
    }
    setState({
      phase: "recording",
      startedAt: res.data.startedAt,
      endsAt: res.data.endsAt,
      durationMs: res.data.durationMs,
      lineCount: 0,
      filePath: res.data.filePath,
      lastError: null,
    });
    buffer = [];
    startCollectors();
    armAutoStop(res.data.endsAt);
  } catch (error) {
    setState({ lastError: error instanceof Error ? error.message : String(error) });
  }
}

export async function stopDiagRecording(reason = "manual") {
  if (state.phase !== "recording") return;
  stopCollectors();
  if (autoStopTimer !== null) {
    window.clearTimeout(autoStopTimer);
    autoStopTimer = null;
  }
  await flushBuffer();
  try {
    const res = await window.api?.stopDiagRecording?.({ reason });
    if (!res || !res.success) {
      setState({ phase: "saved", endsAt: null, lastError: res?.error ?? "停止录制失败" });
      return;
    }
    setState({
      phase: "saved",
      endsAt: null,
      filePath: res.data.filePath,
      lineCount: res.data.lineCount,
      lastError: null,
    });
  } catch (error) {
    setState({ phase: "saved", endsAt: null, lastError: error instanceof Error ? error.message : String(error) });
  }
}

/** 设置页挂载时与主进程对账：渲染层重载后仍在录制时要能恢复显示与采集。 */
export async function syncDiagRecorderFromMain() {
  if (state.phase === "recording") return;
  try {
    const res = await window.api?.getDiagRecordingStatus?.();
    if (!res || !res.success) return;
    const data = res.data;
    if (data.active && data.startedAt !== null && data.endsAt !== null) {
      setState({
        phase: "recording",
        startedAt: data.startedAt,
        endsAt: data.endsAt,
        durationMs: Math.max(0, data.endsAt - data.startedAt),
        lineCount: data.lineCount,
        filePath: data.filePath,
        lastError: null,
      });
      startCollectors();
      armAutoStop(data.endsAt);
      return;
    }
    if (data.filePath) {
      setState({ phase: "saved", filePath: data.filePath, lineCount: data.lineCount, endsAt: null });
    }
  } catch {
    // 对账失败保持现状；下次挂载或操作会重试。
  }
}

export function resetDiagRecorderForTests() {
  state = { ...EMPTY_STATE };
  buffer = [];
  listeners.clear();
}
