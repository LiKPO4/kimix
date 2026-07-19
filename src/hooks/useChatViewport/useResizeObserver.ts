import { useRef, useLayoutEffect, useCallback } from "react";
import { USER_SCROLL_RESIZE_RESTORE_SUPPRESS_MS } from "./constants";

export interface UseResizeObserverOptions {
  enabled?: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  streamContentRef: React.RefObject<HTMLDivElement | null>;
  sessionId?: string;
  olderItemsPage: number;
  autoFollowRef: React.MutableRefObject<boolean>;
  userScrollRef: React.MutableRefObject<boolean>;
  intentionalResizeRestoreUntilRef: React.MutableRefObject<number>;
  lastUserScrollAtRef: React.MutableRefObject<number>;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  reconcileDetachedViewportCompensation: (node: HTMLElement) => void;
  scheduleAnchorCapture: () => void;
  restoreResizeScrollAnchor: (maxDelta?: number) => boolean;
  naturalDistanceFromBottom: (node: HTMLElement) => number;
  updateShowScrollToBottom: (value: boolean) => void;
}

export function useResizeObserver(options: UseResizeObserverOptions): void {
  const {
    enabled = true,
    scrollRef,
    streamContentRef,
    sessionId,
    olderItemsPage,
    autoFollowRef,
    userScrollRef,
    intentionalResizeRestoreUntilRef,
    lastUserScrollAtRef,
    scrollToBottom,
    reconcileDetachedViewportCompensation,
    scheduleAnchorCapture,
    restoreResizeScrollAnchor,
    naturalDistanceFromBottom,
    updateShowScrollToBottom,
  } = options;

  const lastScrollSizeRef = useRef<{ width: number; height: number; scrollHeight: number } | null>(null);

  const readScrollSize = useCallback((node: HTMLElement) => ({
    width: node.clientWidth,
    height: node.clientHeight,
    scrollHeight: node.scrollHeight,
  }), []);

  useLayoutEffect(() => {
    if (!enabled) return;
    const node = scrollRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    let resizeFrame = 0;
    lastScrollSizeRef.current = readScrollSize(node);
    scheduleAnchorCapture();

    const processResize = () => {
      resizeFrame = 0;
      const current = scrollRef.current;
      if (!current) return;
      const previousSize = lastScrollSizeRef.current;
      reconcileDetachedViewportCompensation(current);
      const nextSize = readScrollSize(current);
      lastScrollSizeRef.current = nextSize;
      if (
        !previousSize ||
        (
          previousSize.width === nextSize.width &&
          previousSize.height === nextSize.height &&
          previousSize.scrollHeight === nextSize.scrollHeight
        )
      ) {
        return;
      }
      const shouldStickToBottom = autoFollowRef.current && !userScrollRef.current;
      if (Date.now() < intentionalResizeRestoreUntilRef.current) {
        if (shouldStickToBottom) scrollToBottom("auto");
        scheduleAnchorCapture();
        const activeNode = scrollRef.current;
        if (activeNode) {
          const distance = naturalDistanceFromBottom(activeNode);
          updateShowScrollToBottom(distance > 80);
        }
        return;
      }
      if (shouldStickToBottom) {
        scrollToBottom("auto");
        return;
      }
      if (userScrollRef.current) {
        const isRecentUserScroll = Date.now() - lastUserScrollAtRef.current < USER_SCROLL_RESIZE_RESTORE_SUPPRESS_MS;
        if (!isRecentUserScroll) {
          restoreResizeScrollAnchor();
          scheduleAnchorCapture();
        }
        const activeNode = scrollRef.current;
        if (activeNode) {
          const distance = naturalDistanceFromBottom(activeNode);
          updateShowScrollToBottom(distance > 80);
        }
        return;
      }
      restoreResizeScrollAnchor();
      scheduleAnchorCapture();
      const nodeAfterRestore = scrollRef.current;
      if (!nodeAfterRestore) return;
      const distance = naturalDistanceFromBottom(nodeAfterRestore);
      updateShowScrollToBottom(distance > 80);
    };

    const scheduleResizeProcess = () => {
      if (resizeFrame) return;
      resizeFrame = window.requestAnimationFrame(processResize);
    };

    const observer = new ResizeObserver(scheduleResizeProcess);
    const contentNode = streamContentRef.current;
    observer.observe(node);
    if (contentNode && contentNode !== node) observer.observe(contentNode);
    window.addEventListener("resize", scheduleResizeProcess);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleResizeProcess);
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
    };
  }, [
    scrollRef,
    streamContentRef,
    enabled,
    sessionId,
    olderItemsPage,
    readScrollSize,
    reconcileDetachedViewportCompensation,
    scheduleAnchorCapture,
    restoreResizeScrollAnchor,
    scrollToBottom,
    autoFollowRef,
    userScrollRef,
    intentionalResizeRestoreUntilRef,
    lastUserScrollAtRef,
    naturalDistanceFromBottom,
    updateShowScrollToBottom,
  ]);
}
