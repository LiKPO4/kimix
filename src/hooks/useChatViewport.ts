import { useRef, useState, useEffect, useLayoutEffect, useCallback } from "react";
import { logError } from "@/utils/reportError";
import {
  bottomScrollTop,
  distanceFromBottom,
  scrollTopPreservingBottomDistance,
  shouldResumeAutoFollowAtBottom,
  USER_SCROLL_INTENT_MS,
} from "@/utils/scrollIntent";
import type { RenderItem } from "@/components/chat/ChatThread";
import {
  canReleaseViewportTailCompensation,
  CHAT_PROCESS_COLLAPSE_VIEWPORT_EVENT,
  isProcessCollapseAnchorUnstable,
  isViewportAnchorGenerationCurrent,
  planDetachedViewportRestore,
  requiredViewportTailCompensation,
  type ChatProcessCollapseViewportDetail,
} from "@/utils/chatViewportTransaction";

export type ViewportAnchor = { key: string; offsetTop: number };
export type ResizeViewportAnchor = ViewportAnchor & { userScrollGeneration: number };
export type ProcessCollapseViewportSnapshot = {
  anchorElement: HTMLElement | null;
  anchorViewportTop?: number;
  scrollTop: number;
  autoFollow: boolean;
  userScroll: boolean;
};

const SESSION_OPEN_BOTTOM_MAX_WAIT_MS = 3_500;
const USER_SUBMIT_BOTTOM_MAX_WAIT_MS = 6_000;
const SESSION_LAYOUT_STABLE_MS = 80;
const SCROLL_ANCHOR_IDLE_CAPTURE_MS = 140;
const USER_SCROLL_RESIZE_RESTORE_SUPPRESS_MS = 260;
const USER_SCROLL_ANCHOR_RESTORE_SUPPRESS_MS = 700;
const MAX_RESIZE_ANCHOR_RESTORE_PX = 300;

export interface UseChatViewportOptions {
  sessionId: string | undefined;
  runtimeSessionId?: string | null;
  runningSessionId?: string | null;
  contentVersion: string;
  renderItems: RenderItem[];
  olderItemsPage: number;
  expandedInitialTailSessionId: string | null;
  hasMoreOlderItems: boolean;
  onExpandInitialTail: () => void;
  onExpandOlderItemsToEnd: () => void;
  onHighlightEvent?: (eventId: string | null) => void;
}

export interface UseChatViewportResult {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  streamContentRef: React.RefObject<HTMLDivElement | null>;
  scrollToBottomButtonRef: React.RefObject<HTMLButtonElement | null>;
  handlers: {
    onScroll: React.UIEventHandler<HTMLDivElement>;
    onPointerDown: React.PointerEventHandler<HTMLDivElement>;
    onPointerMove: React.PointerEventHandler<HTMLDivElement>;
    onPointerUp: React.PointerEventHandler<HTMLDivElement>;
    onPointerCancel: React.PointerEventHandler<HTMLDivElement>;
    onLostPointerCapture: React.PointerEventHandler<HTMLDivElement>;
    onWheel: React.WheelEventHandler<HTMLDivElement>;
    onTouchStart: React.TouchEventHandler<HTMLDivElement>;
    onTouchMove: React.TouchEventHandler<HTMLDivElement>;
    onKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
  };
  userHasScrolled: boolean;
  isSessionScrollPrimed: boolean;
  eagerMarkdown: boolean;
  enableAutoFollow: () => void;
  pauseAutoFollowForUser: () => void;
  focusTimelineEvent: (eventId: string, searchText?: string) => boolean;
  prepareInitialTailExpand: () => void;
  prepareOlderItemsExpand: () => void;
  prepareOlderItemsExpandToEnd: () => void;
  captureResizeAnchor: () => void;
  restoreResizeAnchor: (reason: string) => boolean;
  getScrollDiagSnapshot: () => {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
    distance: number;
    autoFollow: boolean;
    userScroll: boolean;
    isAutoFollow: boolean;
    showScrollToBottom: boolean;
    ignoreScrollRemaining: number;
    sessionAutoBottomRemaining: number;
    contentVersionLength: number;
    lastScrollTop: number | null;
    lastScrollHeight: number | null;
    contentOffsetHeight: number;
    contentScrollHeight: number;
  };
}

export function useChatViewport(options: UseChatViewportOptions): UseChatViewportResult {
  const {
    sessionId,
    runtimeSessionId,
    runningSessionId,
    contentVersion,
    renderItems,
    olderItemsPage,
    expandedInitialTailSessionId,
    hasMoreOlderItems,
    onExpandInitialTail,
    onExpandOlderItemsToEnd,
    onHighlightEvent,
  } = options;

  const scrollRef = useRef<HTMLDivElement>(null);
  const streamContentRef = useRef<HTMLDivElement>(null);
  const autoFollowRef = useRef(true);
  const userScrollRef = useRef(false);
  const ignoreScrollUntilRef = useRef(0);
  const scrollTokenRef = useRef(0);
  const isAutoFollowRef = useRef(true);
  const showScrollToBottomRef = useRef(false);
  const scrollToBottomButtonRef = useRef<HTMLButtonElement>(null);
  const sessionAutoBottomUntilRef = useRef(0);
  const sessionAutoBottomTimerRef = useRef<number | null>(null);
  const sessionAutoBottomStableRef = useRef<{ scrollHeight: number; clientHeight: number; count: number } | null>(null);
  const pendingOlderItemsScrollAnchorRef = useRef<ViewportAnchor | null>(null);
  const pendingTailExpandScrollAnchorRef = useRef<ViewportAnchor | null>(null);
  const pendingFocusEventRef = useRef<{ sessionId: string; eventId: string; searchText?: string } | null>(null);
  const focusTimelineEventStateRef = useRef<{ eventId: string; attemptCount: number; startTime: number } | null>(null);
  const resizeScrollAnchorRef = useRef<ResizeViewportAnchor | null>(null);
  const lastScrollSizeRef = useRef<{ width: number; height: number; scrollHeight: number } | null>(null);
  const lastScrollTopRef = useRef<number | null>(null);
  const lastScrollHeightRef = useRef<number | null>(null);
  const contentVersionRef = useRef("");
  const contentResizeSnapshotRef = useRef<{
    sessionId?: string;
    contentVersion: string;
    scrollHeight: number;
    scrollTop: number;
    clientHeight: number;
    autoFollow: boolean;
    userScroll: boolean;
  } | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const userInputLockUntilRef = useRef(0);
  const userBottomIntentUntilRef = useRef(0);
  const userScrollGenerationRef = useRef(0);
  const scrollbarPointerActiveRef = useRef(false);
  const lastUserScrollAtRef = useRef(0);
  const lastScrollDiagRef = useRef(0);
  const lastManualAnchorRestoreAtRef = useRef(0);
  const intentionalResizeRestoreUntilRef = useRef(0);
  const processCollapseViewportSnapshotsRef = useRef(new Map<string, ProcessCollapseViewportSnapshot>());
  const detachedViewportMinimumScrollHeightRef = useRef<number | null>(null);
  const detachedTailCompensationRef = useRef(0);
  const anchorCaptureFrameRef = useRef(0);
  const anchorCaptureIdleTimerRef = useRef<number | null>(null);

  const [userHasScrolled, setUserHasScrolled] = useState(false);
  const [primedSessionId, setPrimedSessionId] = useState<string | null>(null);

  contentVersionRef.current = contentVersion;

  const isInitialTailOnly = Boolean(sessionId && expandedInitialTailSessionId !== sessionId && !userHasScrolled);

  const updateAutoFollow = useCallback((value: boolean) => {
    if (isAutoFollowRef.current === value) return;
    isAutoFollowRef.current = value;
  }, []);

  const updateShowScrollToBottom = useCallback((value: boolean) => {
    if (showScrollToBottomRef.current === value) return;
    showScrollToBottomRef.current = value;
    const button = scrollToBottomButtonRef.current;
    if (!button) return;
    button.style.opacity = value ? "1" : "0";
    button.style.transform = value ? "translateY(0) scale(1)" : "translateY(6px) scale(0.96)";
    button.style.pointerEvents = value ? "auto" : "none";
    button.tabIndex = value ? 0 : -1;
    button.setAttribute("aria-hidden", value ? "false" : "true");
  }, []);

  const setDetachedTailCompensation = useCallback((value: number) => {
    const nextValue = Math.max(0, value);
    if (Math.abs(detachedTailCompensationRef.current - nextValue) <= 0.01) return;
    detachedTailCompensationRef.current = nextValue;
    streamContentRef.current?.style.setProperty(
      "--kimix-detached-tail-compensation",
      `${nextValue}px`,
    );
  }, []);

  const clearDetachedViewportCompensation = useCallback(() => {
    detachedViewportMinimumScrollHeightRef.current = null;
    setDetachedTailCompensation(0);
  }, [setDetachedTailCompensation]);

  const reconcileDetachedViewportCompensation = useCallback((node: HTMLElement) => {
    const minimumScrollHeight = detachedViewportMinimumScrollHeightRef.current;
    if (minimumScrollHeight === null) return;
    const naturalScrollHeight = Math.max(0, node.scrollHeight - detachedTailCompensationRef.current);
    const nextCompensation = requiredViewportTailCompensation({
      minimumScrollHeight,
      naturalScrollHeight,
    });
    setDetachedTailCompensation(nextCompensation);
    if (nextCompensation <= 0.01) {
      detachedViewportMinimumScrollHeightRef.current = null;
    }
  }, [setDetachedTailCompensation]);

  const naturalDistanceFromBottom = useCallback((node: HTMLElement) => Math.max(
    0,
    node.scrollHeight - detachedTailCompensationRef.current - node.scrollTop - node.clientHeight,
  ), []);

  const clearSessionAutoBottomTimer = useCallback(() => {
    if (sessionAutoBottomTimerRef.current === null) return;
    window.clearTimeout(sessionAutoBottomTimerRef.current);
    sessionAutoBottomTimerRef.current = null;
  }, []);

  const cancelSessionAutoBottom = useCallback(() => {
    sessionAutoBottomUntilRef.current = 0;
    sessionAutoBottomStableRef.current = null;
    clearSessionAutoBottomTimer();
  }, [clearSessionAutoBottomTimer]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const node = scrollRef.current;
    if (!node) return;
    if (autoFollowRef.current && !userScrollRef.current) {
      clearDetachedViewportCompensation();
    }
    const locked = Date.now() < userInputLockUntilRef.current;
    const beforeScrollTop = node.scrollTop;
    const beforeScrollHeight = node.scrollHeight;
    const targetTop = bottomScrollTop(node);
    window.api?.writeDiag?.({
      message: "[useChatViewport] scrollToBottom",
      data: {
        behavior,
        autoFollow: autoFollowRef.current,
        userScroll: userScrollRef.current,
        locked,
        beforeScrollTop,
        beforeScrollHeight,
        targetTop,
      },
    }).catch(logError("writeDiag"));
    if (locked) return;
    const token = ++scrollTokenRef.current;
    ignoreScrollUntilRef.current = Date.now() + 420;
    if (behavior === "auto") {
      node.scrollTop = targetTop;
    } else {
      node.scrollTo({ top: targetTop, behavior });
    }
    window.setTimeout(() => {
      if (token !== scrollTokenRef.current || !autoFollowRef.current) return;
      const current = scrollRef.current;
      if (!current) return;
      const distance = current.scrollHeight - current.scrollTop - current.clientHeight;
      updateShowScrollToBottom(distance > 80);
      window.api?.writeDiag?.({
        message: "[useChatViewport] scrollToBottomAfter",
        data: {
          token,
          targetTop,
          afterScrollTop: current.scrollTop,
          afterScrollHeight: current.scrollHeight,
          afterClientHeight: current.clientHeight,
          distance,
        },
      }).catch(logError("writeDiag"));
    }, 60);
  }, [clearDetachedViewportCompensation, updateShowScrollToBottom]);

  const settleSessionAtBottom = useCallback(() => {
    const node = scrollRef.current;
    if (!node || !autoFollowRef.current || userScrollRef.current) {
      cancelSessionAutoBottom();
      return;
    }
    scrollToBottom("auto");
    const remaining = sessionAutoBottomUntilRef.current - Date.now();
    window.api?.writeDiag?.({
      message: "[useChatViewport] settleSessionAtBottom",
      data: {
        remaining,
        scrollHeight: node.scrollHeight,
        scrollTop: node.scrollTop,
        clientHeight: node.clientHeight,
        autoFollow: autoFollowRef.current,
        userScroll: userScrollRef.current,
      },
    }).catch(logError("writeDiag"));
    if (remaining <= 0) {
      cancelSessionAutoBottom();
      return;
    }
    clearSessionAutoBottomTimer();
    sessionAutoBottomTimerRef.current = window.setTimeout(() => {
      sessionAutoBottomTimerRef.current = null;
      if (!autoFollowRef.current || userScrollRef.current) {
        cancelSessionAutoBottom();
        return;
      }
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (!autoFollowRef.current || userScrollRef.current) {
            cancelSessionAutoBottom();
            return;
          }
          scrollToBottom("auto");
          settleSessionAtBottom();
        });
      });
    }, Math.min(SESSION_LAYOUT_STABLE_MS, remaining));
  }, [cancelSessionAutoBottom, clearSessionAutoBottomTimer, scrollToBottom]);

  const enableAutoFollow = useCallback(() => {
    cancelPendingAnchorCapture();
    resizeScrollAnchorRef.current = null;
    userBottomIntentUntilRef.current = 0;
    autoFollowRef.current = true;
    userScrollRef.current = false;
    updateAutoFollow(true);
    updateShowScrollToBottom(false);
    scrollToBottom("smooth");
  }, [scrollToBottom, updateAutoFollow, updateShowScrollToBottom]);

  const settleUserSubmittedMessageAtBottom = useCallback(() => {
    autoFollowRef.current = true;
    userScrollRef.current = false;
    sessionAutoBottomUntilRef.current = Date.now() + USER_SUBMIT_BOTTOM_MAX_WAIT_MS;
    sessionAutoBottomStableRef.current = null;
    updateAutoFollow(true);
    updateShowScrollToBottom(false);
    scrollToBottom("auto");
    window.requestAnimationFrame(() => {
      scrollToBottom("auto");
      settleSessionAtBottom();
    });
  }, [scrollToBottom, settleSessionAtBottom, updateAutoFollow, updateShowScrollToBottom]);

  const recordExplicitUserScrollIntent = useCallback(() => {
    userScrollGenerationRef.current += 1;
    resizeScrollAnchorRef.current = null;
    lastUserScrollAtRef.current = Date.now();
    scheduleIdleAnchorCapture();
  }, []);

  const pauseAutoFollowForUser = useCallback(() => {
    cancelSessionAutoBottom();
    recordExplicitUserScrollIntent();
    userBottomIntentUntilRef.current = 0;
    userScrollRef.current = true;
    scrollTokenRef.current += 1;
    if (!userHasScrolled) {
      setUserHasScrolled(true);
    }
    if (autoFollowRef.current) {
      autoFollowRef.current = false;
      updateAutoFollow(false);
    }
  }, [cancelSessionAutoBottom, recordExplicitUserScrollIntent, updateAutoFollow, userHasScrolled]);

  const lockScrollForUserInput = useCallback(() => {
    userInputLockUntilRef.current = Date.now() + 200;
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.button === 1 || event.clientX >= rect.right - 20) {
      scrollbarPointerActiveRef.current = true;
      lockScrollForUserInput();
      pauseAutoFollowForUser();
      userBottomIntentUntilRef.current = Date.now() + USER_SCROLL_INTENT_MS;
    }
  }, [lockScrollForUserInput, pauseAutoFollowForUser]);

  const handlePointerMove = useCallback(() => {
    if (!scrollbarPointerActiveRef.current) return;
    lockScrollForUserInput();
    recordExplicitUserScrollIntent();
  }, [lockScrollForUserInput, recordExplicitUserScrollIntent]);

  const handlePointerEnd = useCallback(() => {
    if (!scrollbarPointerActiveRef.current) return;
    scrollbarPointerActiveRef.current = false;
    recordExplicitUserScrollIntent();
  }, [recordExplicitUserScrollIntent]);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (event.deltaY < 0) {
      lockScrollForUserInput();
      pauseAutoFollowForUser();
      if (isInitialTailOnly) onExpandInitialTail();
    } else if (event.deltaY > 0) {
      recordExplicitUserScrollIntent();
      userBottomIntentUntilRef.current = Date.now() + USER_SCROLL_INTENT_MS;
    }
  }, [isInitialTailOnly, lockScrollForUserInput, onExpandInitialTail, pauseAutoFollowForUser, recordExplicitUserScrollIntent]);

  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    touchStartYRef.current = event.touches[0]?.clientY ?? null;
  }, []);

  const handleTouchMove = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const startY = touchStartYRef.current;
    if (startY === null) return;
    const currentY = event.touches[0]?.clientY ?? startY;
    if (currentY - startY > 10) {
      lockScrollForUserInput();
      pauseAutoFollowForUser();
    } else if (startY - currentY > 10) {
      recordExplicitUserScrollIntent();
      userBottomIntentUntilRef.current = Date.now() + USER_SCROLL_INTENT_MS;
    }
  }, [lockScrollForUserInput, pauseAutoFollowForUser, recordExplicitUserScrollIntent]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (["PageUp", "ArrowUp", "Home"].includes(event.key)) {
      lockScrollForUserInput();
      pauseAutoFollowForUser();
    } else if (["PageDown", "ArrowDown", "End"].includes(event.key)) {
      recordExplicitUserScrollIntent();
      userBottomIntentUntilRef.current = Date.now() + USER_SCROLL_INTENT_MS;
    }
  }, [lockScrollForUserInput, pauseAutoFollowForUser, recordExplicitUserScrollIntent]);

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
  }, []);

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
      return true;
    }
    return false;
  }, []);

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
      updateShowScrollToBottom(afterDistance > 80);
      scheduleAnchorCapture();
    }
    if (beforeScrollTop <= 8 || Math.abs(afterScrollTop - beforeScrollTop) > 0.5 || (!restored && anchor?.key)) {
      window.api?.writeDiag?.({
        message: "[useChatViewport] restoreManualScrollAnchor",
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
  }, [restoreResizeScrollAnchor, sessionId, runtimeSessionId, runningSessionId, updateShowScrollToBottom]);

  const readScrollSize = useCallback((node: HTMLElement) => ({
    width: node.clientWidth,
    height: node.clientHeight,
    scrollHeight: node.scrollHeight,
  }), []);

  const findRenderedEventNode = useCallback((eventId: string): HTMLElement | null => {
    const node = scrollRef.current;
    if (!node) return null;
    const escaped = globalThis.CSS?.escape ? globalThis.CSS.escape(eventId) : eventId.replace(/["\\]/g, "\\$&");
    const direct = node.querySelector<HTMLElement>(`[data-kimix-event-id="${escaped}"]`);
    if (direct) return direct;
    return Array.from(node.querySelectorAll<HTMLElement>("[data-kimix-event-ids]"))
      .find((item) => (item.dataset.kimixEventIds ?? "").split(" ").includes(eventId)) ?? null;
  }, []);

  const selectTextInNode = useCallback((target: HTMLElement, searchText?: string): boolean => {
    const needle = searchText?.trim();
    if (!needle) return false;
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let textNode = walker.nextNode() as Text | null;
    const lowerNeedle = needle.toLowerCase();
    while (textNode) {
      textNodes.push(textNode);
      textNode = walker.nextNode() as Text | null;
    }
    const fullText = textNodes.map((node) => node.nodeValue ?? "").join("");
    const index = fullText.toLowerCase().indexOf(lowerNeedle);
    if (index < 0) return false;
    const endIndex = index + needle.length;
    let cursor = 0;
    let startNode: Text | null = null;
    let endNode: Text | null = null;
    let startOffset = 0;
    let endOffset = 0;
    for (const node of textNodes) {
      const length = node.nodeValue?.length ?? 0;
      const next = cursor + length;
      if (!startNode && index >= cursor && index <= next) {
        startNode = node;
        startOffset = index - cursor;
      }
      if (!endNode && endIndex >= cursor && endIndex <= next) {
        endNode = node;
        endOffset = endIndex - cursor;
        break;
      }
      cursor = next;
    }
    if (!startNode || !endNode) return false;
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const node = scrollRef.current;
    const rect = range.getBoundingClientRect();
    if (node && rect.height > 0) {
      const containerRect = node.getBoundingClientRect();
      const targetTop = node.scrollTop + rect.top - containerRect.top - Math.max(80, node.clientHeight * 0.28);
      node.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    } else {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return true;
  }, []);

  const MAX_FOCUS_RECURSIVE_ATTEMPTS = 10;
  const MAX_FOCUS_DURATION_MS = 2_000;

  const focusTimelineEvent = useCallback((eventId: string, searchText?: string): boolean => {
    cancelSessionAutoBottom();
    const now = Date.now();
    const state = focusTimelineEventStateRef.current;
    if (!state || state.eventId !== eventId) {
      focusTimelineEventStateRef.current = { eventId, attemptCount: 1, startTime: now };
    } else {
      state.attemptCount += 1;
    }
    const currentState = focusTimelineEventStateRef.current!;
    const shouldAbort = currentState.attemptCount > MAX_FOCUS_RECURSIVE_ATTEMPTS ||
      (now - currentState.startTime) > MAX_FOCUS_DURATION_MS;
    if (shouldAbort) {
      window.api?.writeDiag?.({
        message: "[useChatViewport] focusTimelineEvent aborted",
        data: {
          eventId,
          attemptCount: currentState.attemptCount,
          elapsedMs: now - currentState.startTime,
          hasMoreOlderItems,
        },
      }).catch(logError("writeDiag"));
      focusTimelineEventStateRef.current = null;
      return false;
    }

    const target = findRenderedEventNode(eventId);
    if (!target) {
      if (hasMoreOlderItems) {
        onExpandOlderItemsToEnd();
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => focusTimelineEvent(eventId, searchText));
        });
      }
      return false;
    }

    focusTimelineEventStateRef.current = null;
    scrollTokenRef.current += 1;
    autoFollowRef.current = false;
    userScrollRef.current = true;
    updateAutoFollow(false);
    const didSelectText = selectTextInNode(target, searchText);
    if (!didSelectText) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    onHighlightEvent?.(eventId);
    window.setTimeout(() => {
      onHighlightEvent?.(null);
    }, 2200);
    return true;
  }, [cancelSessionAutoBottom, findRenderedEventNode, hasMoreOlderItems, onExpandOlderItemsToEnd, onHighlightEvent, selectTextInNode, updateAutoFollow]);

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

  const handleScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const previousScrollTop = lastScrollTopRef.current;
    const previousScrollHeight = lastScrollHeightRef.current;
    lastScrollTopRef.current = node.scrollTop;
    lastScrollHeightRef.current = node.scrollHeight;
    if (canReleaseViewportTailCompensation({
      tailCompensation: detachedTailCompensationRef.current,
      scrollTop: node.scrollTop,
      naturalScrollHeight: Math.max(0, node.scrollHeight - detachedTailCompensationRef.current),
      clientHeight: node.clientHeight,
    })) {
      clearDetachedViewportCompensation();
    }
    const geometricDistance = distanceFromBottom(node);
    const distance = detachedTailCompensationRef.current > 0
      ? naturalDistanceFromBottom(node)
      : geometricDistance;
    const now = Date.now();
    if (shouldResumeAutoFollowAtBottom({
      distance,
      autoFollow: autoFollowRef.current,
      userScroll: userScrollRef.current,
      bottomIntentUntil: userBottomIntentUntilRef.current,
      suppressUntil: ignoreScrollUntilRef.current,
      now,
    })) {
      userScrollRef.current = false;
      autoFollowRef.current = true;
      userBottomIntentUntilRef.current = 0;
      lastUserScrollAtRef.current = 0;
      cancelPendingAnchorCapture();
      resizeScrollAnchorRef.current = null;
      clearDetachedViewportCompensation();
      lastScrollTopRef.current = node.scrollTop;
      lastScrollHeightRef.current = node.scrollHeight;
      updateAutoFollow(true);
    }
    updateShowScrollToBottom(distance > 80);
    if (
      previousScrollTop !== null &&
      previousScrollTop > Math.max(160, node.clientHeight * 0.5) &&
      node.scrollTop <= 8
    ) {
      window.api?.writeDiag?.({
        message: "[useChatViewport] scrollJumpNearTop",
        data: {
          previousScrollTop,
          previousScrollHeight,
          nextScrollTop: node.scrollTop,
          nextScrollHeight: node.scrollHeight,
          clientHeight: node.clientHeight,
          distance,
          sessionId,
          runtimeSessionId,
          runningSessionId,
          autoFollow: autoFollowRef.current,
          userScroll: userScrollRef.current,
          isAutoFollow: isAutoFollowRef.current,
          ignoreScrollRemaining: Math.max(0, ignoreScrollUntilRef.current - now),
          sessionAutoBottomRemaining: Math.max(0, sessionAutoBottomUntilRef.current - now),
          olderItemsPage,
          primedSessionId,
          expandedInitialTailSessionId,
          userHasScrolled,
          contentVersionLength: contentVersionRef.current.length,
        },
      }).catch(logError("writeDiag"));
    }
    if (now - lastScrollDiagRef.current > 500) {
      lastScrollDiagRef.current = now;
      window.api?.writeDiag?.({
        message: "[useChatViewport] handleScroll",
        data: {
          scrollTop: node.scrollTop,
          scrollHeight: node.scrollHeight,
          clientHeight: node.clientHeight,
          distance,
          autoFollow: autoFollowRef.current,
          userScroll: userScrollRef.current,
        },
      }).catch(logError("writeDiag"));
    }
  }, [clearDetachedViewportCompensation, updateAutoFollow, updateShowScrollToBottom, sessionId, runtimeSessionId, runningSessionId, olderItemsPage, primedSessionId, expandedInitialTailSessionId, userHasScrolled, cancelPendingAnchorCapture, naturalDistanceFromBottom]);

  const prepareOlderItemsExpand = useCallback(() => {
    const node = scrollRef.current;
    if (node) {
      const containerRect = node.getBoundingClientRect();
      const items = Array.from(node.querySelectorAll<HTMLElement>("[data-kimix-render-key]"));
      const anchor = items.find((item) => item.getBoundingClientRect().bottom >= containerRect.top + 1) ?? items[0];
      pendingOlderItemsScrollAnchorRef.current = anchor ? {
        key: anchor.dataset.kimixRenderKey ?? "",
        offsetTop: anchor.getBoundingClientRect().top - containerRect.top,
      } : null;
      scrollTokenRef.current += 1;
      ignoreScrollUntilRef.current = Date.now() + 240;
      intentionalResizeRestoreUntilRef.current = Date.now() + 240;
    }
  }, []);

  const prepareOlderItemsExpandToEnd = useCallback(() => {
    const node = scrollRef.current;
    if (node) {
      const containerRect = node.getBoundingClientRect();
      const items = Array.from(node.querySelectorAll<HTMLElement>("[data-kimix-render-key]"));
      const anchor = items.find((item) => item.getBoundingClientRect().bottom >= containerRect.top + 1) ?? items[0];
      pendingOlderItemsScrollAnchorRef.current = anchor ? {
        key: anchor.dataset.kimixRenderKey ?? "",
        offsetTop: anchor.getBoundingClientRect().top - containerRect.top,
      } : null;
      scrollTokenRef.current += 1;
      ignoreScrollUntilRef.current = Date.now() + 240;
      intentionalResizeRestoreUntilRef.current = Date.now() + 240;
    }
  }, []);

  const prepareInitialTailExpand = useCallback(() => {
    const node = scrollRef.current;
    if (node) {
      const containerRect = node.getBoundingClientRect();
      const items = Array.from(node.querySelectorAll<HTMLElement>("[data-kimix-render-key]"));
      const anchor = items.find((item) => item.getBoundingClientRect().bottom >= containerRect.top + 1) ?? items[0];
      pendingTailExpandScrollAnchorRef.current = anchor ? {
        key: anchor.dataset.kimixRenderKey ?? "",
        offsetTop: anchor.getBoundingClientRect().top - containerRect.top,
      } : null;
    }
  }, []);

  const captureResizeAnchor = useCallback(() => {
    captureResizeScrollAnchor();
  }, [captureResizeScrollAnchor]);

  const restoreResizeAnchor = useCallback((reason: string) => {
    return restoreManualScrollAnchor(reason);
  }, [restoreManualScrollAnchor]);

  const getScrollDiagSnapshot = useCallback(() => {
    const node = scrollRef.current;
    const contentNode = streamContentRef.current;
    const now = Date.now();
    const contentOffsetHeight = contentNode?.offsetHeight ?? 0;
    const contentScrollHeight = contentNode?.scrollHeight ?? 0;
    return {
      scrollTop: node?.scrollTop ?? 0,
      scrollHeight: node?.scrollHeight ?? 0,
      clientHeight: node?.clientHeight ?? 0,
      distance: node ? naturalDistanceFromBottom(node) : 0,
      autoFollow: autoFollowRef.current,
      userScroll: userScrollRef.current,
      isAutoFollow: isAutoFollowRef.current,
      showScrollToBottom: showScrollToBottomRef.current,
      ignoreScrollRemaining: Math.max(0, ignoreScrollUntilRef.current - now),
      sessionAutoBottomRemaining: Math.max(0, sessionAutoBottomUntilRef.current - now),
      contentVersionLength: contentVersionRef.current.length,
      lastScrollTop: lastScrollTopRef.current,
      lastScrollHeight: lastScrollHeightRef.current,
      contentOffsetHeight,
      contentScrollHeight,
    };
  }, [naturalDistanceFromBottom]);

  // Effects
  useEffect(() => {
    const handleIntentionalResize = (event: Event) => {
      const detail = (event as CustomEvent<{ preserveViewport?: boolean }>).detail;
      intentionalResizeRestoreUntilRef.current = Date.now() + 240;
      if (!detail?.preserveViewport) return;
      cancelSessionAutoBottom();
      scrollTokenRef.current += 1;
      autoFollowRef.current = false;
      userScrollRef.current = true;
      userScrollGenerationRef.current += 1;
      resizeScrollAnchorRef.current = null;
      lastUserScrollAtRef.current = Date.now();
      ignoreScrollUntilRef.current = Date.now() + 240;
      updateAutoFollow(false);
    };
    window.addEventListener("kimix:intentional-chat-resize", handleIntentionalResize);
    return () => window.removeEventListener("kimix:intentional-chat-resize", handleIntentionalResize);
  }, [cancelSessionAutoBottom, updateAutoFollow]);

  useEffect(() => {
    const clearScrollbarPointer = () => {
      scrollbarPointerActiveRef.current = false;
    };
    window.addEventListener("pointerup", clearScrollbarPointer);
    window.addEventListener("pointercancel", clearScrollbarPointer);
    window.addEventListener("blur", clearScrollbarPointer);
    return () => {
      window.removeEventListener("pointerup", clearScrollbarPointer);
      window.removeEventListener("pointercancel", clearScrollbarPointer);
      window.removeEventListener("blur", clearScrollbarPointer);
    };
  }, []);

  useEffect(() => {
    const selectStableAnchor = (
      node: HTMLElement,
      detail: ChatProcessCollapseViewportDetail,
    ) => {
      const containerRect = node.getBoundingClientRect();
      const sampleY = containerRect.top + Math.min(Math.max(node.clientHeight * 0.24, 96), 220);
      const sampleX = containerRect.left + Math.max(1, Math.min(containerRect.width - 1, containerRect.width * 0.5));
      const contentAnchor = detail.contentAnchor?.isConnected && node.contains(detail.contentAnchor)
        ? detail.contentAnchor
        : null;
      if (contentAnchor && contentAnchor.getBoundingClientRect().top <= sampleY + 0.5) {
        return contentAnchor;
      }
      const hit = typeof document.elementFromPoint === "function"
        ? document.elementFromPoint(sampleX, sampleY)
        : null;
      let anchor = hit instanceof HTMLElement ? hit : hit?.parentElement ?? null;
      const isUnstableAnchor = isProcessCollapseAnchorUnstable({
        anchor,
        scrollNode: node,
        streamNode: streamContentRef.current,
        collapsingNode: detail.collapsingNode ?? null,
      });

      if (isUnstableAnchor) {
        const summaryAnchor = detail.summaryAnchor?.isConnected && node.contains(detail.summaryAnchor)
          ? detail.summaryAnchor
          : null;
        if (summaryAnchor && summaryAnchor.getBoundingClientRect().top <= sampleY + 0.5) {
          anchor = summaryAnchor;
        } else {
          anchor = null;
        }
      }

      return anchor && node.contains(anchor) ? anchor : null;
    };

    const handleProcessCollapseViewport = (event: Event) => {
      const detail = (event as CustomEvent<ChatProcessCollapseViewportDetail>).detail;
      if (!detail?.transactionId || detail.sessionId !== sessionId) return;
      const node = scrollRef.current;
      if (!node) return;
      intentionalResizeRestoreUntilRef.current = Date.now() + 600;

      if (detail.phase === "before") {
        const isDetached = userScrollRef.current || !autoFollowRef.current;
        if (isDetached) userBottomIntentUntilRef.current = 0;
        const anchorElement = isDetached ? selectStableAnchor(node, detail) : null;
        processCollapseViewportSnapshotsRef.current.set(detail.transactionId, {
          anchorElement,
          anchorViewportTop: anchorElement?.getBoundingClientRect().top,
          scrollTop: node.scrollTop,
          autoFollow: autoFollowRef.current,
          userScroll: userScrollRef.current,
        });
        return;
      }

      const snapshot = processCollapseViewportSnapshotsRef.current.get(detail.transactionId);
      processCollapseViewportSnapshotsRef.current.delete(detail.transactionId);
      if (!snapshot) return;

      if (snapshot.autoFollow && !snapshot.userScroll && autoFollowRef.current && !userScrollRef.current) {
        clearDetachedViewportCompensation();
        scrollToBottom("auto");
        return;
      }

      const currentAnchorViewportTop = snapshot.anchorElement?.isConnected && node.contains(snapshot.anchorElement)
        ? snapshot.anchorElement.getBoundingClientRect().top
        : undefined;
      const naturalScrollHeight = Math.max(0, node.scrollHeight - detachedTailCompensationRef.current);
      const plan = planDetachedViewportRestore({
        previousScrollTop: snapshot.scrollTop,
        previousAnchorViewportTop: snapshot.anchorViewportTop,
        currentScrollTop: node.scrollTop,
        currentAnchorViewportTop,
        naturalScrollHeight,
        clientHeight: node.clientHeight,
      });

      detachedViewportMinimumScrollHeightRef.current = plan.tailCompensation > 0.01
        ? plan.minimumScrollHeight
        : null;
      setDetachedTailCompensation(plan.tailCompensation);
      const compensatedScrollHeight = node.scrollHeight;
      ignoreScrollUntilRef.current = Date.now() + 240;
      node.scrollTop = plan.targetScrollTop;
      resizeScrollAnchorRef.current = null;
      cancelPendingAnchorCapture();
      scheduleAnchorCapture();
      updateShowScrollToBottom(naturalDistanceFromBottom(node) > 80);
      window.api?.writeDiag?.({
        message: "[useChatViewport] processCollapseViewport",
        data: {
          transactionId: detail.transactionId,
          eventId: detail.eventId,
          agentTurnId: detail.agentTurnId,
          roomAgentId: detail.roomAgentId,
          previousScrollTop: snapshot.scrollTop,
          nextScrollTop: node.scrollTop,
          targetScrollTop: plan.targetScrollTop,
          naturalScrollHeight,
          compensatedScrollHeight,
          tailCompensation: plan.tailCompensation,
          anchorSurvived: currentAnchorViewportTop !== undefined,
        },
      }).catch(logError("writeDiag"));
    };

    window.addEventListener(CHAT_PROCESS_COLLAPSE_VIEWPORT_EVENT, handleProcessCollapseViewport);
    return () => window.removeEventListener(CHAT_PROCESS_COLLAPSE_VIEWPORT_EVENT, handleProcessCollapseViewport);
  }, [sessionId, clearDetachedViewportCompensation, scrollToBottom, setDetachedTailCompensation, cancelPendingAnchorCapture, scheduleAnchorCapture, naturalDistanceFromBottom, updateShowScrollToBottom]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string; eventId?: string; searchText?: string }>).detail;
      if (!detail?.sessionId || !detail.eventId) return;
      pendingFocusEventRef.current = { sessionId: detail.sessionId, eventId: detail.eventId, searchText: detail.searchText };
      if (sessionId === detail.sessionId) {
        const eventId = detail.eventId;
        window.requestAnimationFrame(() => {
          if (focusTimelineEvent(eventId, detail.searchText)) {
            pendingFocusEventRef.current = null;
          }
        });
      }
    };
    window.addEventListener("kimix:focus-timeline-event", handler);
    return () => window.removeEventListener("kimix:focus-timeline-event", handler);
  }, [sessionId, focusTimelineEvent]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (!detail?.sessionId || detail.sessionId !== sessionId) return;
      settleUserSubmittedMessageAtBottom();
    };
    window.addEventListener("kimix:user-message-submitted", handler);
    return () => window.removeEventListener("kimix:user-message-submitted", handler);
  }, [sessionId, settleUserSubmittedMessageAtBottom]);

  useLayoutEffect(() => {
    setPrimedSessionId(null);
    cancelSessionAutoBottom();
    autoFollowRef.current = true;
    userScrollRef.current = false;
    setUserHasScrolled(false);
    pendingOlderItemsScrollAnchorRef.current = null;
    pendingTailExpandScrollAnchorRef.current = null;
    pendingFocusEventRef.current = null;
    focusTimelineEventStateRef.current = null;
    resizeScrollAnchorRef.current = null;
    processCollapseViewportSnapshotsRef.current.clear();
    clearDetachedViewportCompensation();
    lastScrollSizeRef.current = null;
    lastScrollTopRef.current = null;
    lastScrollHeightRef.current = null;
    touchStartYRef.current = null;
    userInputLockUntilRef.current = 0;
    userBottomIntentUntilRef.current = 0;
    userScrollGenerationRef.current = 0;
    scrollbarPointerActiveRef.current = false;
    lastUserScrollAtRef.current = 0;
    cancelPendingAnchorCapture();
    updateAutoFollow(true);
    updateShowScrollToBottom(false);
    if (sessionId) {
      sessionAutoBottomUntilRef.current = Date.now() + SESSION_OPEN_BOTTOM_MAX_WAIT_MS;
      sessionAutoBottomStableRef.current = null;
      const node = scrollRef.current;
      if (node) {
        node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
      }
      settleSessionAtBottom();
      const primingSessionId = sessionId;
      window.requestAnimationFrame(() => {
        settleSessionAtBottom();
        window.api?.writeDiag?.({
          message: "[useChatViewport] rAF setPrimedSessionId",
          data: {
            primingSessionId,
            currentSessionId: sessionId,
            matches: sessionId === primingSessionId,
          },
        }).catch(logError("writeDiag"));
        setPrimedSessionId(primingSessionId);
        window.requestAnimationFrame(settleSessionAtBottom);
      });
    }
    return () => {
      cancelSessionAutoBottom();
      cancelPendingAnchorCapture();
    };
  }, [sessionId, cancelSessionAutoBottom, cancelPendingAnchorCapture, clearDetachedViewportCompensation, settleSessionAtBottom, updateAutoFollow, updateShowScrollToBottom]);

  useLayoutEffect(() => {
    if (primedSessionId) {
      settleSessionAtBottom();
    }
  }, [primedSessionId, settleSessionAtBottom]);

  useLayoutEffect(() => {
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
  }, [sessionId, olderItemsPage, readScrollSize, reconcileDetachedViewportCompensation, scheduleAnchorCapture, restoreResizeScrollAnchor, scrollToBottom, naturalDistanceFromBottom, updateShowScrollToBottom]);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    const snapshot = contentResizeSnapshotRef.current;
    if (
      node &&
      snapshot &&
      snapshot.sessionId === sessionId &&
      snapshot.autoFollow &&
      !snapshot.userScroll &&
      node.scrollHeight < snapshot.scrollHeight
    ) {
      ignoreScrollUntilRef.current = Date.now() + 120;
      node.scrollTop = scrollTopPreservingBottomDistance({
        previousScrollHeight: snapshot.scrollHeight,
        previousScrollTop: snapshot.scrollTop,
        previousClientHeight: snapshot.clientHeight,
        nextScrollHeight: node.scrollHeight,
        nextClientHeight: node.clientHeight,
      });
    }
    contentResizeSnapshotRef.current = node ? {
      sessionId,
      contentVersion,
      scrollHeight: node.scrollHeight,
      scrollTop: node.scrollTop,
      clientHeight: node.clientHeight,
      autoFollow: autoFollowRef.current,
      userScroll: userScrollRef.current,
    } : null;
  }, [contentVersion, sessionId]);

  useLayoutEffect(() => {
    if (isAutoFollowRef.current) return;
    const node = scrollRef.current;
    if (!node) return;
    if (Date.now() < intentionalResizeRestoreUntilRef.current) {
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

  useEffect(() => {
    const pending = pendingFocusEventRef.current;
    if (!pending || !sessionId || pending.sessionId !== sessionId) return;
    window.requestAnimationFrame(() => {
      if (focusTimelineEvent(pending.eventId, pending.searchText)) {
        pendingFocusEventRef.current = null;
      }
    });
  }, [sessionId, renderItems.length, focusTimelineEvent]);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node || !sessionId) return;
    const anchor = pendingTailExpandScrollAnchorRef.current;
    if (anchor?.key) {
      pendingTailExpandScrollAnchorRef.current = null;
      const escaped = globalThis.CSS?.escape ? globalThis.CSS.escape(anchor.key) : anchor.key.replace(/["\\]/g, "\\$&");
      const target = node.querySelector<HTMLElement>(`[data-kimix-render-key="${escaped}"]`);
      if (target) {
        const containerRect = node.getBoundingClientRect();
        const nextOffsetTop = target.getBoundingClientRect().top - containerRect.top;
        node.scrollTop += nextOffsetTop - anchor.offsetTop;
      }
      const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
      updateShowScrollToBottom(distance > 80);
      return;
    }
    if (autoFollowRef.current && !userScrollRef.current) {
      scrollToBottom("auto");
    }
  }, [expandedInitialTailSessionId, sessionId, scrollToBottom, updateShowScrollToBottom]);

  useLayoutEffect(() => {
    const anchor = pendingOlderItemsScrollAnchorRef.current;
    const node = scrollRef.current;
    if (!anchor || !node || olderItemsPage === 0) return;
    pendingOlderItemsScrollAnchorRef.current = null;
    const escaped = globalThis.CSS?.escape ? globalThis.CSS.escape(anchor.key) : anchor.key.replace(/["\\]/g, "\\$&");
    const target = node.querySelector<HTMLElement>(`[data-kimix-render-key="${escaped}"]`);
    if (target) {
      const containerRect = node.getBoundingClientRect();
      const nextOffsetTop = target.getBoundingClientRect().top - containerRect.top;
      node.scrollTop += nextOffsetTop - anchor.offsetTop;
    }
    autoFollowRef.current = false;
    userScrollRef.current = true;
    updateAutoFollow(false);
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    updateShowScrollToBottom(distance > 80);
  }, [olderItemsPage, renderItems.length, updateAutoFollow, updateShowScrollToBottom]);

  const isSessionScrollPrimed = !sessionId || primedSessionId === sessionId;
  const eagerMarkdown = Boolean(sessionId && (
    Date.now() < sessionAutoBottomUntilRef.current || userHasScrolled
  ));

  return {
    scrollRef,
    streamContentRef,
    scrollToBottomButtonRef,
    handlers: {
      onScroll: handleScroll,
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerEnd,
      onPointerCancel: handlePointerEnd,
      onLostPointerCapture: handlePointerEnd,
      onWheel: handleWheel,
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onKeyDown: handleKeyDown,
    },
    userHasScrolled,
    isSessionScrollPrimed,
    eagerMarkdown,
    enableAutoFollow,
    pauseAutoFollowForUser,
    focusTimelineEvent,
    prepareInitialTailExpand,
    prepareOlderItemsExpand,
    prepareOlderItemsExpandToEnd,
    captureResizeAnchor,
    restoreResizeAnchor,
    getScrollDiagSnapshot,
  };
}
