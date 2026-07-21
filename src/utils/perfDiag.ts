import { isPerfDiagEnabled } from "@/utils/perfFlags";

export type ScrollTopWriteSource =
  | "anchor-restore"
  | "auto-follow"
  | "resize"
  | "bottom-preserve"
  | "settle-raf"
  | "other";

const scrollTopWrites: Record<ScrollTopWriteSource, number> = {
  "anchor-restore": 0,
  "auto-follow": 0,
  resize: 0,
  "bottom-preserve": 0,
  "settle-raf": 0,
  other: 0,
};

let renderTurnBodyRuns = 0;
let renderTurnBodyCacheHits = 0;

export function noteScrollTopWrite(source: ScrollTopWriteSource) {
  if (!isPerfDiagEnabled()) return;
  scrollTopWrites[source] += 1;
}

type TimingBucket = { count: number; totalMs: number; maxMs: number };

const timings: Record<string, TimingBucket> = {};

/**
 * Measure a synchronous hot-path section. Near-zero cost when the diag flag is
 * off (one flag read). Accumulates count/total/max into the diag snapshot.
 */
export function timeSync<T>(label: string, fn: () => T): T {
  if (!isPerfDiagEnabled()) return fn();
  const start = performance.now();
  try {
    return fn();
  } finally {
    const elapsed = performance.now() - start;
    const bucket = timings[label] ?? (timings[label] = { count: 0, totalMs: 0, maxMs: 0 });
    bucket.count += 1;
    bucket.totalMs += elapsed;
    bucket.maxMs = Math.max(bucket.maxMs, elapsed);
  }
}

export function noteProfilerCommit(label: string, actualDuration: number) {
  if (!isPerfDiagEnabled()) return;
  const bucket = timings[label] ?? (timings[label] = { count: 0, totalMs: 0, maxMs: 0 });
  bucket.count += 1;
  bucket.totalMs += actualDuration;
  bucket.maxMs = Math.max(bucket.maxMs, actualDuration);
}

const longTaskStats = { count: 0, maxMs: 0, totalMs: 0 };
let longTaskObserverStarted = false;

/** Start a PerformanceObserver for long tasks (attribution-free but catches anything missed). */
export function ensureLongTaskObserver() {
  if (longTaskObserverStarted || typeof PerformanceObserver === "undefined") return;
  if (!isPerfDiagEnabled()) return;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTaskStats.count += 1;
        longTaskStats.totalMs += entry.duration;
        longTaskStats.maxMs = Math.max(longTaskStats.maxMs, entry.duration);
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
    longTaskObserverStarted = true;
  } catch {
    // longtask entry type unsupported; skip silently.
  }
}

export function noteRenderTurnBodyRun(hitCache: boolean) {
  if (!isPerfDiagEnabled()) return;
  renderTurnBodyRuns += 1;
  if (hitCache) renderTurnBodyCacheHits += 1;
}

export function getPerfDiagSnapshot() {
  return {
    scrollTopWrites: { ...scrollTopWrites },
    renderTurnBodyRuns,
    renderTurnBodyCacheHits,
    timings: Object.fromEntries(Object.entries(timings).map(([label, bucket]) => [label, { ...bucket }])),
    longTasks: { ...longTaskStats },
  };
}

/** Reset counters; the periodic reporter calls this after each flush. */
export function resetPerfDiagCounters() {
  for (const key of Object.keys(scrollTopWrites) as ScrollTopWriteSource[]) {
    scrollTopWrites[key] = 0;
  }
  renderTurnBodyRuns = 0;
  renderTurnBodyCacheHits = 0;
  for (const key of Object.keys(timings)) delete timings[key];
  longTaskStats.count = 0;
  longTaskStats.maxMs = 0;
  longTaskStats.totalMs = 0;
}

export function resetPerfDiagForTests() {
  for (const key of Object.keys(scrollTopWrites) as ScrollTopWriteSource[]) {
    scrollTopWrites[key] = 0;
  }
  renderTurnBodyRuns = 0;
  renderTurnBodyCacheHits = 0;
}
