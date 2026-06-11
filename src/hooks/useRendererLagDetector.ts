import { useEffect } from "react";
import { useAppStore } from "@/stores/appStore";

const FREEZE_REPORTS_KEY = "kimix_freeze_reports";
const MAX_FREEZE_REPORTS_RAW_LENGTH = 64 * 1024;
const MAX_RECENT_CONSOLE_LOGS = 60;
const MAX_RECENT_LONG_TASKS = 30;
const MAX_SERIALIZED_ARG_LENGTH = 1200;
const HEARTBEAT_INTERVAL_MS = 2000;

type RendererConsoleLog = {
  at: string;
  level: "log" | "info" | "warn" | "error";
  message: string;
};

type RendererLongTaskEntry = {
  at: string;
  startTime: number;
  duration: number;
  name?: string;
  entryType?: string;
};

const recentConsoleLogs: RendererConsoleLog[] = [];
const recentLongTasks: RendererLongTaskEntry[] = [];
let consoleCaptureInstalled = false;
let longTaskObserverInstalled = false;
let longTaskObserver: PerformanceObserver | null = null;
const originalConsoleMethods: Partial<Record<RendererConsoleLog["level"], typeof console.log>> = {};

function truncate(value: string, maxLength = MAX_SERIALIZED_ARG_LENGTH) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function serializeConsoleArg(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ""}`.trim();
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function pushConsoleLog(level: RendererConsoleLog["level"], args: unknown[]) {
  recentConsoleLogs.push({
    at: new Date().toISOString(),
    level,
    message: truncate(args.map(serializeConsoleArg).join(" ")),
  });
  recentConsoleLogs.splice(0, Math.max(0, recentConsoleLogs.length - MAX_RECENT_CONSOLE_LOGS));
}

function installConsoleCapture() {
  if (consoleCaptureInstalled) return;
  consoleCaptureInstalled = true;
  (["log", "info", "warn", "error"] as const).forEach((level) => {
    const original = console[level].bind(console);
    originalConsoleMethods[level] = original;
    console[level] = (...args: unknown[]) => {
      pushConsoleLog(level, args);
      original(...args);
    };
  });
}

function uninstallConsoleCapture() {
  if (!consoleCaptureInstalled) return;
  (["log", "info", "warn", "error"] as const).forEach((level) => {
    const original = originalConsoleMethods[level];
    if (original) console[level] = original;
    delete originalConsoleMethods[level];
  });
  consoleCaptureInstalled = false;
}

function installLongTaskObserver() {
  if (longTaskObserverInstalled || typeof PerformanceObserver === "undefined") return;
  longTaskObserverInstalled = true;
  try {
    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        recentLongTasks.push({
          at: new Date(performance.timeOrigin + entry.startTime).toISOString(),
          startTime: Math.round(entry.startTime),
          duration: Math.round(entry.duration),
          name: entry.name,
          entryType: entry.entryType,
        });
      });
      recentLongTasks.splice(0, Math.max(0, recentLongTasks.length - MAX_RECENT_LONG_TASKS));
    });
    observer.observe({ entryTypes: ["longtask"] });
    longTaskObserver = observer;
  } catch {
    longTaskObserverInstalled = false;
    // Some Electron/Chromium builds do not expose the longtask entry type.
  }
}

function uninstallLongTaskObserver() {
  longTaskObserver?.disconnect();
  longTaskObserver = null;
  longTaskObserverInstalled = false;
}

function getPerformanceMemory() {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number } }).memory;
  if (!memory) return null;
  return {
    usedJSHeapSize: memory.usedJSHeapSize,
    totalJSHeapSize: memory.totalJSHeapSize,
    jsHeapSizeLimit: memory.jsHeapSizeLimit,
  };
}

function buildRendererHeartbeatPayload() {
  const state = useAppStore.getState();
  const session = state.currentSession;
  const lastEvent = session?.events.at(-1);
  return {
    at: new Date().toISOString(),
    performanceNow: Math.round(performance.now()),
    visibilityState: document.visibilityState,
    focused: document.hasFocus(),
    url: window.location.href,
    runningSessionId: state.runningSessionId,
    currentProject: state.currentProject ? {
      id: state.currentProject.id,
      name: state.currentProject.name,
      path: state.currentProject.path,
    } : null,
    currentSession: session ? {
      id: session.id,
      title: session.title,
      engine: session.engine,
      runtimeSessionId: session.runtimeSessionId,
      officialSessionId: session.officialSessionId,
      projectPath: session.projectPath,
      eventCount: session.events.length,
      isLoading: session.isLoading,
      updatedAt: session.updatedAt,
      lastEventType: lastEvent?.type,
      lastEventTimestamp: lastEvent?.timestamp,
    } : null,
    panels: {
      workspaceView: state.workspaceView,
      settingsOpen: state.settingsOpen,
      searchOpen: state.searchOpen,
      longTasksOpen: state.longTasksOpen,
      longTaskInspectorOpen: state.longTaskInspectorOpen,
      diffPanelOpen: state.diffPanelOpen,
    },
    memory: getPerformanceMemory(),
  };
}

function reportRendererHeartbeat() {
  try {
    window.api.reportRendererHeartbeat?.(buildRendererHeartbeatPayload());
  } catch {
    // Heartbeat is best-effort and must never affect the UI thread.
  }
}

function recordRendererLag(lagMs: number) {
  const state = useAppStore.getState();
  const session = state.currentSession;
  const report = {
    at: new Date().toISOString(),
    lagMs: Math.round(lagMs),
    sessionId: session?.id ?? null,
    runningSessionId: state.runningSessionId,
    snapshot: {
      url: window.location.href,
      visibilityState: document.visibilityState,
      focused: document.hasFocus(),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      },
      performance: {
        now: Math.round(performance.now()),
        timeOrigin: performance.timeOrigin,
        memory: getPerformanceMemory(),
      },
      app: {
        workspaceView: state.workspaceView,
        sidebarOpen: state.sidebarOpen,
        settingsOpen: state.settingsOpen,
        searchOpen: state.searchOpen,
        longTasksOpen: state.longTasksOpen,
        longTaskInspectorOpen: state.longTaskInspectorOpen,
        diffPanelOpen: state.diffPanelOpen,
        permissionMode: state.permissionMode,
        statusUpdateDisplay: state.statusUpdateDisplay,
      },
      project: state.currentProject ? {
        id: state.currentProject.id,
        name: state.currentProject.name,
        path: state.currentProject.path,
        gitBranch: state.currentProject.gitBranch,
      } : null,
      session: session ? {
        id: session.id,
        title: session.title,
        engine: session.engine,
        runtimeSessionId: session.runtimeSessionId,
        officialSessionId: session.officialSessionId,
        projectPath: session.projectPath,
        eventCount: session.events.length,
        isLoading: session.isLoading,
        updatedAt: session.updatedAt,
        lastEvent: session.events.length > 0 ? {
          type: session.events[session.events.length - 1]?.type,
          timestamp: session.events[session.events.length - 1]?.timestamp,
        } : null,
      } : null,
    },
    recentConsole: recentConsoleLogs.slice(-30),
    recentLongTasks: recentLongTasks.slice(-20),
  };
  console.warn("[Kimix] renderer event loop lag detected", report);
  try {
    const raw = localStorage.getItem(FREEZE_REPORTS_KEY);
    const parsed = raw && raw.length <= MAX_FREEZE_REPORTS_RAW_LENGTH ? JSON.parse(raw) : [];
    const reports = Array.isArray(parsed) ? parsed : [];
    reports.push(report);
    localStorage.setItem(FREEZE_REPORTS_KEY, JSON.stringify(reports.slice(-20)));
  } catch {
    localStorage.setItem(FREEZE_REPORTS_KEY, JSON.stringify([report]));
  }
}

export function useRendererLagDetector() {
  useEffect(() => {
    installConsoleCapture();
    installLongTaskObserver();
    let lastTick = performance.now();
    const resetTick = () => {
      lastTick = performance.now();
    };
    const lagTimer = window.setInterval(() => {
      const now = performance.now();
      const lagMs = now - lastTick - 1000;
      lastTick = now;
      if (lagMs > 2500) recordRendererLag(lagMs);
    }, 1000);
    reportRendererHeartbeat();
    const heartbeatTimer = window.setInterval(reportRendererHeartbeat, HEARTBEAT_INTERVAL_MS);
    document.addEventListener("visibilitychange", resetTick);
    window.addEventListener("focus", resetTick);

    return () => {
      window.clearInterval(lagTimer);
      window.clearInterval(heartbeatTimer);
      document.removeEventListener("visibilitychange", resetTick);
      window.removeEventListener("focus", resetTick);
      uninstallLongTaskObserver();
      uninstallConsoleCapture();
    };
  }, []);
}
