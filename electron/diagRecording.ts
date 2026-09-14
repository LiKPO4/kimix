import fs from "node:fs";
import path from "node:path";

/** 用户主动触发的限时诊断录制：落盘到 userData/diagnostics，便于事后排查卡顿与状态异常。 */
export const DIAG_RECORDING_DEFAULT_DURATION_MS = 5 * 60 * 1000;
export const DIAG_RECORDING_MIN_DURATION_MS = 30 * 1000;
export const DIAG_RECORDING_MAX_DURATION_MS = 30 * 60 * 1000;
export const DIAG_RECORDING_SAMPLE_INTERVAL_MS = 10 * 1000;
export const DIAG_RECORDING_MAX_BYTES = 16 * 1024 * 1024;

export type DiagRecordingStatus = {
  active: boolean;
  filePath: string | null;
  startedAt: number | null;
  endsAt: number | null;
  remainingMs: number;
  lineCount: number;
  bytes: number;
};

export type DiagRecordingStopResult = {
  filePath: string;
  startedAt: number;
  stoppedAt: number;
  durationMs: number;
  lineCount: number;
  bytes: number;
  reason: string;
};

export function normalizeDiagRecordingDuration(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DIAG_RECORDING_DEFAULT_DURATION_MS;
  return Math.min(DIAG_RECORDING_MAX_DURATION_MS, Math.max(DIAG_RECORDING_MIN_DURATION_MS, Math.round(value)));
}

export function formatDiagRecordingFileName(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `kimix-record-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.log`;
}

type DiagRecordingSession = {
  filePath: string;
  startedAt: number;
  endsAt: number;
  durationMs: number;
  lineCount: number;
  bytes: number;
  closed: boolean;
  sampleTimer: NodeJS.Timeout | null;
  stopTimer: NodeJS.Timeout | null;
};

export type DiagRecordingControllerOptions = {
  baseDir: string;
  /** 文件头附加行（版本、平台、脱敏状态等），由调用方提供避免本模块依赖 Electron。 */
  headerProvider?: () => string[];
  /** 主进程侧周期采样行（进程内存/CPU 等）；返回 null 表示跳过本次采样。 */
  sampleProvider?: () => string | null;
  now?: () => number;
  sampleIntervalMs?: number;
  maxBytes?: number;
};

/** 文件写入统一走串行队列，避免并发 append 交错；所有写操作异步，不阻塞主进程事件循环。 */
export function createDiagRecordingController(options: DiagRecordingControllerOptions) {
  const now = options.now ?? Date.now;
  const sampleIntervalMs = options.sampleIntervalMs ?? DIAG_RECORDING_SAMPLE_INTERVAL_MS;
  const maxBytes = options.maxBytes ?? DIAG_RECORDING_MAX_BYTES;

  let session: DiagRecordingSession | null = null;
  let lastStop: DiagRecordingStopResult | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task);
    queue = run.catch(() => undefined);
    return run;
  }

  async function writeLines(filePath: string, lines: string[]): Promise<number> {
    if (lines.length === 0) return 0;
    const payload = lines.map((line) => (line.endsWith("\n") ? line : `${line}\n`)).join("");
    await fs.promises.appendFile(filePath, payload, "utf8");
    return Buffer.byteLength(payload, "utf8");
  }

  function clearTimers(target: DiagRecordingSession) {
    if (target.sampleTimer) clearInterval(target.sampleTimer);
    if (target.stopTimer) clearTimeout(target.stopTimer);
    target.sampleTimer = null;
    target.stopTimer = null;
  }

  /** 同步收尾（清定时器、标记结束、更新 lastStop）；footer 由调用方写。 */
  function closeSession(target: DiagRecordingSession, reason: string): DiagRecordingStopResult {
    clearTimers(target);
    target.closed = true;
    if (session === target) session = null;
    const stoppedAt = now();
    const result: DiagRecordingStopResult = {
      filePath: target.filePath,
      startedAt: target.startedAt,
      stoppedAt,
      durationMs: Math.max(0, stoppedAt - target.startedAt),
      lineCount: target.lineCount,
      bytes: target.bytes,
      reason,
    };
    lastStop = result;
    return result;
  }

  function footerLine(result: DiagRecordingStopResult) {
    return `# stopped=${new Date(result.stoppedAt).toISOString()} reason=${result.reason} lines=${result.lineCount} bytes=${result.bytes} durationMs=${result.durationMs}`;
  }

  function appendRaw(target: DiagRecordingSession, lines: string[]) {
    enqueue(async () => {
      // 收尾后到达的迟到行丢弃；stop() 之前入队的行仍按序落盘。
      if (target.closed) return;
      const written = await writeLines(target.filePath, lines);
      if (target.closed) return;
      target.lineCount += lines.length;
      target.bytes += written;
      if (target.bytes >= maxBytes) {
        const result = closeSession(target, "size-cap");
        await writeLines(target.filePath, [footerLine(result)]);
      }
    });
  }

  async function start(durationMs?: unknown) {
    if (session) {
      return {
        ok: true as const,
        filePath: session.filePath,
        startedAt: session.startedAt,
        endsAt: session.endsAt,
        durationMs: session.durationMs,
        lineCount: session.lineCount,
        bytes: session.bytes,
      };
    }
    const duration = normalizeDiagRecordingDuration(durationMs);
    const startedAt = now();
    const endsAt = startedAt + duration;
    const filePath = path.join(options.baseDir, formatDiagRecordingFileName(new Date(startedAt)));
    const headerLines = [
      "# Kimix 诊断录制",
      `# started=${new Date(startedAt).toISOString()} ends=${new Date(endsAt).toISOString()} durationMs=${duration}`,
      ...(options.headerProvider?.() ?? []),
    ];
    try {
      await fs.promises.mkdir(options.baseDir, { recursive: true });
      await fs.promises.writeFile(filePath, headerLines.map((line) => `${line}\n`).join(""), "utf8");
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
    }
    const created: DiagRecordingSession = {
      filePath,
      startedAt,
      endsAt,
      durationMs: duration,
      lineCount: 0,
      bytes: Buffer.byteLength(headerLines.map((line) => `${line}\n`).join(""), "utf8"),
      closed: false,
      sampleTimer: null,
      stopTimer: null,
    };
    session = created;
    const firstSample = options.sampleProvider?.();
    if (firstSample) appendRaw(created, [firstSample]);
    created.sampleTimer = setInterval(() => {
      const line = options.sampleProvider?.();
      if (line) appendRaw(created, [line]);
    }, sampleIntervalMs);
    created.stopTimer = setTimeout(() => {
      void stop("timeout");
    }, Math.max(0, endsAt - now()));
    return {
      ok: true as const,
      filePath,
      startedAt,
      endsAt,
      durationMs: duration,
      lineCount: 0,
      bytes: created.bytes,
    };
  }

  /** 渲染层批量行（调用方自带时间戳）；文件内逐字落盘。 */
  function append(lines: string[]) {
    if (!session || lines.length === 0) return { ok: true as const };
    appendRaw(session, lines);
    return { ok: true as const };
  }

  /** 已带时间戳的单行（diag.log 行、心跳摘要行）直接落盘。 */
  function captureLine(line: string | null | undefined) {
    if (!session || !line) return;
    appendRaw(session, [line]);
  }

  async function stop(reason = "manual") {
    const target = session;
    if (!target) {
      if (lastStop) return { ok: true as const, ...lastStop };
      return { ok: false as const, error: "没有进行中的录制" };
    }
    // 收尾任务排在此前入队的写任务之后，保证 footer 永远在内容之后。
    const result = await enqueue(async () => {
      const closed = closeSession(target, reason);
      await writeLines(target.filePath, [footerLine(closed)]);
      return closed;
    });
    return { ok: true as const, ...result };
  }

  function status(): DiagRecordingStatus {
    const current = session;
    return {
      active: Boolean(current),
      filePath: current?.filePath ?? lastStop?.filePath ?? null,
      startedAt: current?.startedAt ?? lastStop?.startedAt ?? null,
      endsAt: current?.endsAt ?? null,
      remainingMs: current ? Math.max(0, current.endsAt - now()) : 0,
      lineCount: current?.lineCount ?? lastStop?.lineCount ?? 0,
      bytes: current?.bytes ?? lastStop?.bytes ?? 0,
    };
  }

  return { start, append, captureLine, stop, status, flush: () => queue.then(() => undefined) };
}

export type DiagRecordingController = ReturnType<typeof createDiagRecordingController>;
