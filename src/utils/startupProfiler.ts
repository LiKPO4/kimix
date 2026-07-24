/**
 * Startup Profiler — always-on timing for the first 30 seconds after launch.
 *
 * Unlike perfDiag (which requires localStorage flag), this module captures
 * startup-critical metrics unconditionally, then auto-disables.
 *
 * Usage:
 *   window.KIMIX_PERF() — prints the startup profile to console.
 */

const STARTUP_WINDOW_MS = 30_000;
const appStartTime = performance.now();

interface PhaseRecord {
  label: string;
  startMs: number;
  endMs?: number;
}

interface LongTaskRecord {
  startTime: number;
  duration: number;
}

const phases: PhaseRecord[] = [];
const longTasks: LongTaskRecord[] = [];
let renderCycles = 0;
let layoutEffectCycles = 0;
let stateSetCalls = 0;
let scrollTopWriteCount = 0;

function isActive(): boolean {
  return performance.now() - appStartTime < STARTUP_WINDOW_MS;
}

/** Mark the start of a named phase. Returns a function to mark its end. */
export function startPhase(label: string): () => void {
  if (!isActive()) return () => {};
  const record: PhaseRecord = { label, startMs: performance.now() - appStartTime };
  phases.push(record);
  return () => {
    record.endMs = performance.now() - appStartTime;
  };
}

/** Record a synchronous operation's timing. */
export function measureSync<T>(label: string, fn: () => T): T {
  if (!isActive()) return fn();
  const start = performance.now();
  try {
    return fn();
  } finally {
    const elapsed = performance.now() - start;
    phases.push({
      label: `${label} (${elapsed.toFixed(1)}ms)`,
      startMs: start - appStartTime,
      endMs: performance.now() - appStartTime,
    });
  }
}

export function noteStartupRenderCycle() {
  if (isActive()) renderCycles++;
}

export function noteStartupLayoutEffect() {
  if (isActive()) layoutEffectCycles++;
}

export function noteStartupStateSet() {
  if (isActive()) stateSetCalls++;
}

export function noteStartupScrollTopWrite() {
  if (isActive()) scrollTopWriteCount++;
}

/** Install a PerformanceObserver for longtask entries (always-on for 30s). */
export function installStartupLongTaskObserver() {
  if (typeof PerformanceObserver === "undefined") return;
  try {
    const observer = new PerformanceObserver((list) => {
      if (!isActive()) {
        observer.disconnect();
        return;
      }
      for (const entry of list.getEntries()) {
        longTasks.push({ startTime: entry.startTime, duration: entry.duration });
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
    // Auto-disconnect after the profiling window.
    setTimeout(() => observer.disconnect(), STARTUP_WINDOW_MS + 1000);
  } catch {
    // longtask not supported; ignore.
  }
}

export function getStartupProfile() {
  const elapsed = performance.now() - appStartTime;
  const totalLongTaskMs = longTasks.reduce((sum, t) => sum + t.duration, 0);
  const maxLongTaskMs = longTasks.reduce((max, t) => Math.max(max, t.duration), 0);
  return {
    elapsedSinceStartMs: Math.round(elapsed),
    longTasks: {
      count: longTasks.length,
      totalMs: Math.round(totalLongTaskMs),
      maxMs: Math.round(maxLongTaskMs),
      entries: longTasks.slice(0, 20).map((t) => ({
        startTime: Math.round(t.startTime),
        duration: Math.round(t.duration),
      })),
    },
    renderCycles,
    layoutEffectCycles,
    stateSetCalls,
    scrollTopWriteCount,
    phases: phases.map((p) => ({
      label: p.label,
      startMs: Math.round(p.startMs),
      durationMs: p.endMs != null ? Math.round(p.endMs - p.startMs) : undefined,
    })),
  };
}
