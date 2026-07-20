import { useRef, useCallback, useLayoutEffect } from "react";
import { logError } from "@/utils/reportError";
import { isViewportAnchorGenerationCurrent } from "@/utils/chatViewportTransaction";
import { noteScrollTopWrite } from "@/utils/perfDiag";
import { isScrollYieldEnabled } from "@/utils/perfFlags";
import { noteUserScrollActivity, isUserScrollActive, clearUserScrollActivity } from "@/utils/userScrollActivity";
import {
  MAX_RESIZE_ANCHOR_RESTORE_PX,
  SCROLL_ANCHOR_IDLE_CAPTURE_MS,
  USER_SCROLL_ANCHOR_RESTORE_SUPPRESS_MS,
} from "./constants";
import type { ViewportAnchor, ResizeViewportAnchor } from "./types";

export interface UseScrollAnchorOptions {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  updateShowScrollToBottom: (value: boolean) => void;
  sessionId?: string;
  runtimeSessionId?: string | null;
  runningSessionId?: string | null;
  /** Shared mutable timing ref; owned by the parent hook because resize/input handlers also touch it. */
  intentionalResizeRestoreUntilRef: React.MutableRefObject<number>;
  /** Shared mutable token ref; owned by the parent hook because prepare helpers also bump it. */
  scrollTokenRef: React.MutableRefObject<number>;
  /** Shared mutable timing ref; owned by the parent hook because the auto-follow logic also uses it. */
  ignoreScrollUntilRef: React.MutableRefObject<number>;
  /** Shared mutable timing ref; owned by the parent hook because the resize observer also reads it. */
  lastUserScrollAtRef: React.MutableRefObject<number>;
  contentVersion: string;
  autoFollowRef: React.MutableRefObject<boolean>;
  userScrollRef: React.MutableRefObject<boolean>;
  isAutoFollowRef: React.MutableRefObject<boolean>;
  naturalDistanceFromBottom: (node: HTMLElement) => number;
}

export interface UseScrollAnchorResult {
  resizeScrollAnchorRef: React.MutableRefObject<ResizeViewportAnchor | null>;
  pendingOlderItemsScrollAnchorRef: React.MutableRefObject<ViewportAnchor | null>;
  pendingTailExpandScrollAnchorRef: React.MutableRefObject<ViewportAnchor | null>;
  captureResizeAnchor: () => void;
  restoreResizeAnchor: (maxDelta?: number) => boolean;
  restoreManualScrollAnchor: (reason: string) => boolean;
  scheduleAnchorCapture: () => void;
  scheduleIdleAnchorCapture: () => void;
  cancelPendingAnchorCapture: () => void;
  recordExplicitUserScrollIntent: () => void;
  clearResizeAnchor: () => void;
  prepareInitialTailExpand: () => void;
  prepareOlderItemsExpand: () => void;
  prepareOlderItemsExpandToEnd: () => void;
  resetForNewSession: () => void;
}

export function useScrollAnchor(options: UseScrollAnchorOptions): UseScrollAnchorResult {
  const {
    scrollRef,
    updateShowScrollToBottom,
    sessionId,
    runtimeSessionId,
    runningSessionId,
    intentionalResizeRestoreUntilRef,
    scrollTokenRef,
    ignoreScrollUntilRef,
    lastUserScrollAtRef,
    contentVersion,
    autoFollowRef,
    userScrollRef,
    isAutoFollowRef,
    naturalDistanceFromBottom,
  } = options;

  const userScrollGenerationRef = useRef(0);
  const resizeScrollAnchorRef = useRef<ResizeViewportAnchor | null>(null);
  const pendingOlderItemsScrollAnchorRef = useRef<ViewportAnchor | null>(null);
  const pendingTailExpandScrollAnchorRef = useRef<ViewportAnchor | null>(null);
  const anchorCaptureFrameRef = useRef(0);
  const anchorCaptureIdleTimerRef = useRef<number | null>(null);
  const lastManualAnchorRestoreAtRef = useRef(0);

  const captureResizeScrollAnchor = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const containerRect = node.getBoundingClientRect();
    const anchorTop = containerRect.top + Math.min(Math.max(node.clientHeight * 0.24, 96), 220);
    const items = Array.from(node.querySelectorAll<HTMLElement>("[data-kimix-render-key]"));
    const anchor = items.find((item) => item.getBoundingClientRect().bottom >= anchorTop) ?? items[0] ?? null;
    if (!anchor) {
      resizeScrollAnchorRef.current = null;
      return;
    }
    resizeScrollAnchorRef.current = {
      key: anchor.dataset.kimixRenderKey ?? "",
      offsetTop: anchor.getBoundingClientRect().top - containerRect.top,
      userScrollGeneration: userScrollGenerationRef.current,
    };
  }, [scrollRef]);

  const restoreResizeScrollAnchor = useCallback((maxDelta = MAX_RESIZE_ANCHOR_RESTORE_PX) => {
    const node = scrollRef.current;
    const anchor = resizeScrollAnchorRef.current;
    if (!node || !anchor?.key) return false;
    if (!isViewportAnchorGenerationCurrent({
      capturedGeneration: anchor.userScrollGeneration,
      currentGeneration: userScrollGenerationRef.current,
    })) return false;
    const escaped = globalThis.CSS?.escape ? globalThis.CSS.escape(anchor.key) : anchor.key.replace(/["\\]/g, "\\$&");
    const target = node.querySelector<HTMLElement>(`[data-kimix-render-key="${escaped}"]`);
    if (!target) return false;
    const containerRect = node.getBoundingClientRect();
    const nextOffsetTop = target.getBoundingClientRect().top - containerRect.top;
    const delta = nextOffsetTop - anchor.offsetTop;
    if (Math.abs(delta) <= 0.5) {
      return true;
    }
    if (Math.abs(delta) <= maxDelta) {
      node.scrollTop += delta;
      noteScrollTopWrite("resize");
      return true;
    }
    return false;
  }, [scrollRef]);

  const restoreManualScrollAnchor = useCallback((reason: string) => {
    const node = scrollRef.current;
    if (!node || !userScrollRef.current) return false;
    const anchor = resizeScrollAnchorRef.current;
    const hasCurrentAnchor = Boolean(anchor && isViewportAnchorGenerationCurrent({
      capturedGeneration: anchor.userScrollGeneration,
      currentGeneration: userScrollGenerationRef.current,
    }));
    const beforeScrollTop = node.scrollTop;
    const beforeDistance = node.scrollHeight - node.scrollTop - node.clientHeight;
    const target = hasCurrentAnchor && anchor?.key
      ? node.querySelector<HTMLElement>(`[data-kimix-render-key="${globalThis.CSS?.escape ? globalThis.CSS.escape(anchor.key) : anchor.key.replace(/["\\]/g, "\\$&")}"]`)
      : null;
    const containerRect = node.getBoundingClientRect();
    const targetOffsetTop = target ? target.getBoundingClientRect().top - containerRect.top : undefined;
    const delta = target && anchor ? targetOffsetTop! - anchor.offsetTop : undefined;
    const restored = restoreResizeScrollAnchor(Number.POSITIVE_INFINITY);
    const afterScrollTop = node.scrollTop;
    const afterDistance = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (restored) {
      noteScrollTopWrite("anchor-restore");
      updateShowScrollToBottom(afterDistance > 80);
      scheduleAnchorCapture();
    }
    if (beforeScrollTop <= 8 || Math.abs(afterScrollTop - beforeScrollTop) > 0.5 || (!restored && anchor?.key)) {
      window.api?.writeDiag?.({
        message: "[useScrollAnchor] restoreManualScrollAnchor",
        data: {
          reason,
          restored,
          beforeScrollTop,
          afterScrollTop,
          beforeDistance,
          afterDistance,
          delta,
          targetOffsetTop,
          anchorOffsetTop: anchor?.offsetTop,
          skippedByDefaultMax: typeof delta === "number" ? Math.abs(delta) > MAX_RESIZE_ANCHOR_RESTORE_PX : undefined,
          sessionId,
          runtimeSessionId,
          runningSessionId,
          anchorKey: anchor?.key,
          anchorGeneration: anchor?.userScrollGeneration,
          userScrollGeneration: userScrollGenerationRef.current,
          hasCurrentAnchor,
          targetFound: Boolean(target),
          userScroll: userScrollRef.current,
          autoFollow: autoFollowRef.current,
        },
      }).catch(logError("writeDiag"));
    }
    return restored;
  }, [restoreResizeScrollAnchor, sessionId, runtimeSessionId, runningSessionId, updateShowScrollToBottom, scrollRef, autoFollowRef, userScrollRef]);

  const scheduleAnchorCapture = useCallback(() => {
    if (anchorCaptureFrameRef.current) return;
    anchorCaptureFrameRef.current = window.requestAnimationFrame(() => {
      anchorCaptureFrameRef.current = 0;
      captureResizeScrollAnchor();
    });
  }, [captureResizeScrollAnchor]);

  const scheduleIdleAnchorCapture = useCallback(() => {
    if (anchorCaptureIdleTimerRef.current !== null) {
      window.clearTimeout(anchorCaptureIdleTimerRef.current);
    }
    anchorCaptureIdleTimerRef.current = window.setTimeout(() => {
      anchorCaptureIdleTimerRef.current = null;
      scheduleAnchorCapture();
    }, SCROLL_ANCHOR_IDLE_CAPTURE_MS);
  }, [scheduleAnchorCapture]);

  const cancelPendingAnchorCapture = useCallback(() => {
    if (anchorCaptureIdleTimerRef.current !== null) {
      window.clearTimeout(anchorCaptureIdleTimerRef.current);
      anchorCaptureIdleTimerRef.current = null;
    }
    if (anchorCaptureFrameRef.current) {
      window.cancelAnimationFrame(anchorCaptureFrameRef.current);
      anchorCaptureFrameRef.current = 0;
    }
  }, []);

  const recordExplicitUserScrollIntent = useCallback(() => {
    userScrollGenerationRef.current += 1;
    resizeScrollAnchorRef.current = null;
    lastUserScrollAtRef.current = Date.now();
    noteUserScrollActivity();
    scheduleIdleAnchorCapture();
  }, [lastUserScrollAtRef, scheduleIdleAnchorCapture]);

  const clearResizeAnchor = useCallback(() => {
    resizeScrollAnchorRef.current = null;
  }, []);

  const captureTopAnchor = useCallback((): ViewportAnchor | null => {
    const node = scrollRef.current;
    if (!node) return null;
    const containerRect = node.getBoundingClientRect();
    const items = Array.from(node.querySelectorAll<HTMLElement>("[data-kimix-render-key]"));
    const anchor = items.find((item) => item.getBoundingClientRect().bottom >= containerRect.top + 1) ?? items[0];
    return anchor
      ? {
          key: anchor.dataset.kimixRenderKey ?? "",
          offsetTop: anchor.getBoundingClientRect().top - containerRect.top,
        }
      : null;
  }, [scrollRef]);

  const prepareInitialTailExpand = useCallback(() => {
    pendingTailExpandScrollAnchorRef.current = captureTopAnchor();
  }, [captureTopAnchor]);

  const prepareOlderItemsExpand = useCallback(() => {
    pendingOlderItemsScrollAnchorRef.current = captureTopAnchor();
    scrollTokenRef.current += 1;
    ignoreScrollUntilRef.current = Date.now() + 240;
    intentionalResizeRestoreUntilRef.current = Date.now() + 240;
  }, [captureTopAnchor, scrollTokenRef, ignoreScrollUntilRef, intentionalResizeRestoreUntilRef]);

  const prepareOlderItemsExpandToEnd = useCallback(() => {
    pendingOlderItemsScrollAnchorRef.current = captureTopAnchor();
    scrollTokenRef.current += 1;
    ignoreScrollUntilRef.current = Date.now() + 240;
    intentionalResizeRestoreUntilRef.current = Date.now() + 240;
  }, [captureTopAnchor, scrollTokenRef, ignoreScrollUntilRef, intentionalResizeRestoreUntilRef]);

  const resetForNewSession = useCallback(() => {
    pendingOlderItemsScrollAnchorRef.current = null;
    pendingTailExpandScrollAnchorRef.current = null;
    resizeScrollAnchorRef.current = null;
    userScrollGenerationRef.current = 0;
    lastUserScrollAtRef.current = 0;
    clearUserScrollActivity();
    cancelPendingAnchorCapture();
  }, [cancelPendingAnchorCapture, lastUserScrollAtRef]);

  // On content changes, try to restore the manual scroll anchor for a user-scrolled viewport.
  useLayoutEffect(() => {
    if (isAutoFollowRef.current) return;
    const node = scrollRef.current;
    if (!node) return;
    if (Date.now() < intentionalResizeRestoreUntilRef.current) {
      updateShowScrollToBottom(naturalDistanceFromBottom(node) > 80);
      return;
    }
    // Scroll yield: while the user is actively scrolling, never fight the wheel.
    if (isScrollYieldEnabled() && isUserScrollActive()) {
      updateShowScrollToBottom(naturalDistanceFromBottom(node) > 80);
      return;
    }
    if (userScrollRef.current) {
      const isRecentUserScroll = Date.now() - lastUserScrollAtRef.current < USER_SCROLL_ANCHOR_RESTORE_SUPPRESS_MS;
      if (isRecentUserScroll) {
        const distance = naturalDistanceFromBottom(node);
        updateShowScrollToBottom(distance > 80);
        return;
      }
      const now = Date.now();
      if (now - lastManualAnchorRestoreAtRef.current < 350) {
        const distance = naturalDistanceFromBottom(node);
        updateShowScrollToBottom(distance > 80);
        return;
      }
      lastManualAnchorRestoreAtRef.current = now;
      if (restoreManualScrollAnchor("contentVersion:user-scroll")) {
        return;
      }
    }
    const distance = naturalDistanceFromBottom(node);
    updateShowScrollToBottom(distance > 80);
  }, [contentVersion, naturalDistanceFromBottom, restoreManualScrollAnchor, updateShowScrollToBottom]);

  return {
    resizeScrollAnchorRef,
    pendingOlderItemsScrollAnchorRef,
    pendingTailExpandScrollAnchorRef,
    captureResizeAnchor: captureResizeScrollAnchor,
    restoreResizeAnchor: restoreResizeScrollAnchor,
    restoreManualScrollAnchor,
    scheduleAnchorCapture,
    scheduleIdleAnchorCapture,
    cancelPendingAnchorCapture,
    recordExplicitUserScrollIntent,
    clearResizeAnchor,
    prepareInitialTailExpand,
    prepareOlderItemsExpand,
    prepareOlderItemsExpandToEnd,
    resetForNewSession,
  };
}
