import { useEffect } from "react";
import { useAppStore } from "@/stores/appStore";

const FREEZE_REPORTS_KEY = "kimix_freeze_reports";
const MAX_FREEZE_REPORTS_RAW_LENGTH = 64 * 1024;

function recordRendererLag(lagMs: number) {
  const report = {
    at: new Date().toISOString(),
    lagMs: Math.round(lagMs),
    sessionId: useAppStore.getState().currentSession?.id ?? null,
    runningSessionId: useAppStore.getState().runningSessionId,
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
    let lastTick = performance.now();
    const lagTimer = window.setInterval(() => {
      const now = performance.now();
      const lagMs = now - lastTick - 1000;
      lastTick = now;
      if (lagMs > 2500) recordRendererLag(lagMs);
    }, 1000);

    return () => {
      window.clearInterval(lagTimer);
    };
  }, []);
}
