import {
  useRef,
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
} from "react";
import { logError } from "@/utils/reportError";
import {
  distanceFromBottom,
  scrollTopPreservingBottomDistance,
  shouldResumeAutoFollowAtBottom,
  USER_SCROLL_INTENT_MS,
} from "@/utils/scrollIntent";
import type { RenderItem } from "@/types/chatRender";
import {
  canReleaseViewportTailCompensation,
  CHAT_PROCESS_COLLAPSE_VIEWPORT_EVENT,
  isProcessCollapseAnchorUnstable,
  planDetachedViewportRestore,
  type ChatProcessCollapseViewportDetail,
} from "@/utils/chatViewportTransaction";
import { SESSION_OPEN_BOTTOM_MAX_WAIT_MS } from "./useChatViewport/constants";
import type {
  ViewportAnchor,
  ResizeViewportAnchor,
  ProcessCollapseViewportSnapshot,
} from "./useChatViewport/types";
import { useViewportTailCompensation } from "./useChatViewport/useViewportTailCompensation";
import { useScrollAnchor } from "./useChatViewport/useScrollAnchor";
import { useAutoFollow } from "./useChatViewport/useAutoFollow";
import { useEventFocus } from "./useChatViewport/useEventFocus";
import type { TimelineFocusAlignment } from "./useChatViewport/useEventFocus";
import { useResizeObserver } from "./useChatViewport/useResizeObserver";

export type { ViewportAnchor, ResizeViewportAnchor, ProcessCollapseViewportSnapshot };

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
  focusTimelineEvent: (eventId: string, searchText?: string, alignment?: TimelineFocusAlignment) => boolean;
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
  const scrollToBottomButtonRef = useRef<HTMLButtonElement>(null);

  // Shared mutable state is owned here and passed explicitly to sub-hooks so
  // they can read/write it without hidden cross-module coupling.
  const autoFollowRef = useRef(true);
  const userScrollRef = useRef(false);
  const isAutoFollowRef = useRef(true);
  const ignoreScrollUntilRef = useRef(0);
  const scrollTokenRef = useRef(0);
  const sessionAutoBottomUntilRef = useRef(0);
  const userBottomIntentUntilRef = useRef(0);
  const lastScrollTopRef = useRef<number | null>(null);
  const lastScrollHeightRef = useRef<number | null>(null);
  const lastUserScrollAtRef = useRef(0);

  const touchStartYRef = useRef<number | null>(null);
  const userInputLockUntilRef = useRef(0);
  const scrollbarPointerActiveRef = useRef(false);
  const intentionalResizeRestoreUntilRef = useRef(0);
  const processCollapseViewportSnapshotsRef = useRef(new Map<string, ProcessCollapseViewportSnapshot>());
  const contentResizeSnapshotRef = useRef<{
    sessionId?: string;
    contentVersion: string;
    scrollHeight: number;
    scrollTop: number;
    clientHeight: number;
    autoFollow: boolean;
    userScroll: boolean;
  } | null>(null);
  const contentVersionRef = useRef("");
  const lastScrollDiagRef = useRef(0);

  const [userHasScrolled, setUserHasScrolled] = useState(false);
  const [primedSessionId, setPrimedSessionId] = useState<string | null>(null);

  contentVersionRef.current = contentVersion;

  const isInitialTailOnly = Boolean(sessionId && expandedInitialTailSessionId !== sessionId && !userHasScrolled);

  const showScrollToBottomRef = useRef(false);

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

  const {
    getDetachedTailCompensation,
    setDetachedTailCompensation,
    clearDetachedViewportCompensation,
    reconcileDetachedViewportCompensation,
    naturalDistanceFromBottom,
  } = useViewportTailCompensation(streamContentRef);

  const {
    pendingOlderItemsScrollAnchorRef,
    pendingTailExpandScrollAnchorRef,
    captureResizeAnchor,
    restoreResizeAnchor,
    restoreManualScrollAnchor,
    scheduleAnchorCapture,
    cancelPendingAnchorCapture,
    recordExplicitUserScrollIntent,
    clearResizeAnchor,
    prepareInitialTailExpand,
    prepareOlderItemsExpand,
    prepareOlderItemsExpandToEnd,
    resetForNewSession: resetScrollAnchor,
  } = useScrollAnchor({
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
  });

  const {
    updateAutoFollow,
    scrollToBottom,
    settleSessionAtBottom,
    settleUserSubmittedMessageAtBottom,
    enableAutoFollow,
    pauseAutoFollowForUser,
    cancelSessionAutoBottom,
  } = useAutoFollow({
    scrollRef,
    autoFollowRef,
    userScrollRef,
    isAutoFollowRef,
    ignoreScrollUntilRef,
    scrollTokenRef,
    sessionAutoBottomUntilRef,
    userBottomIntentUntilRef,
    userInputLockUntilRef,
    updateShowScrollToBottom,
    clearDetachedViewportCompensation,
    cancelPendingAnchorCapture,
    clearResizeAnchor,
    recordExplicitUserScrollIntent,
    setUserHasScrolled,
    userHasScrolled,
  });

  const {
    focusTimelineEvent,
    resetForNewSession: resetEventFocus,
  } = useEventFocus({
    scrollRef,
    sessionId,
    renderItems,
    hasMoreOlderItems,
    onExpandOlderItemsToEnd,
    onHighlightEvent,
    pauseAutoFollowForUser,
  });

  useResizeObserver({
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
    restoreResizeScrollAnchor: restoreResizeAnchor,
    naturalDistanceFromBottom,
    updateShowScrollToBottom,
  });

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

  const handleScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const previousScrollTop = lastScrollTopRef.current;
    const previousScrollHeight = lastScrollHeightRef.current;
    lastScrollTopRef.current = node.scrollTop;
    lastScrollHeightRef.current = node.scrollHeight;
    const tailCompensation = getDetachedTailCompensation();
    if (canReleaseViewportTailCompensation({
      tailCompensation,
      scrollTop: node.scrollTop,
      naturalScrollHeight: Math.max(0, node.scrollHeight - tailCompensation),
      clientHeight: node.clientHeight,
    })) {
      clearDetachedViewportCompensation();
    }
    const geometricDistance = distanceFromBottom(node);
    const distance = tailCompensation > 0
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
      clearResizeAnchor();
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
  }, [
    scrollRef,
    getDetachedTailCompensation,
    clearDetachedViewportCompensation,
    naturalDistanceFromBottom,
    autoFollowRef,
    userScrollRef,
    userBottomIntentUntilRef,
    ignoreScrollUntilRef,
    lastUserScrollAtRef,
    cancelPendingAnchorCapture,
    clearResizeAnchor,
    updateAutoFollow,
    updateShowScrollToBottom,
    sessionId,
    runtimeSessionId,
    runningSessionId,
    olderItemsPage,
    primedSessionId,
    expandedInitialTailSessionId,
    userHasScrolled,
  ]);

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
  }, [scrollRef, streamContentRef, naturalDistanceFromBottom, autoFollowRef, userScrollRef, isAutoFollowRef, ignoreScrollUntilRef, sessionAutoBottomUntilRef]);

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
      recordExplicitUserScrollIntent();
      ignoreScrollUntilRef.current = Date.now() + 240;
      updateAutoFollow(false);
    };
    window.addEventListener("kimix:intentional-chat-resize", handleIntentionalResize);
    return () => window.removeEventListener("kimix:intentional-chat-resize", handleIntentionalResize);
  }, [cancelSessionAutoBottom, scrollTokenRef, autoFollowRef, userScrollRef, recordExplicitUserScrollIntent, ignoreScrollUntilRef, updateAutoFollow]);

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
      const tailCompensation = getDetachedTailCompensation();
      const naturalScrollHeight = Math.max(0, node.scrollHeight - tailCompensation);
      const plan = planDetachedViewportRestore({
        previousScrollTop: snapshot.scrollTop,
        previousAnchorViewportTop: snapshot.anchorViewportTop,
        currentScrollTop: node.scrollTop,
        currentAnchorViewportTop,
        naturalScrollHeight,
        clientHeight: node.clientHeight,
      });

      setDetachedTailCompensation(plan.tailCompensation, plan.minimumScrollHeight);
      const compensatedScrollHeight = node.scrollHeight;
      ignoreScrollUntilRef.current = Date.now() + 240;
      node.scrollTop = plan.targetScrollTop;
      clearResizeAnchor();
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
  }, [
    sessionId,
    scrollRef,
    streamContentRef,
    autoFollowRef,
    userScrollRef,
    userBottomIntentUntilRef,
    getDetachedTailCompensation,
    clearDetachedViewportCompensation,
    scrollToBottom,
    setDetachedTailCompensation,
    clearResizeAnchor,
    cancelPendingAnchorCapture,
    scheduleAnchorCapture,
    naturalDistanceFromBottom,
    updateShowScrollToBottom,
  ]);

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
  }, [contentVersion, sessionId, autoFollowRef, userScrollRef, ignoreScrollUntilRef]);

  useLayoutEffect(() => {
    setPrimedSessionId(null);
    cancelSessionAutoBottom();
    autoFollowRef.current = true;
    userScrollRef.current = false;
    setUserHasScrolled(false);
    resetScrollAnchor();
    resetEventFocus(sessionId);
    processCollapseViewportSnapshotsRef.current.clear();
    clearDetachedViewportCompensation();
    lastScrollTopRef.current = null;
    lastScrollHeightRef.current = null;
    touchStartYRef.current = null;
    userInputLockUntilRef.current = 0;
    userBottomIntentUntilRef.current = 0;
    lastUserScrollAtRef.current = 0;
    scrollbarPointerActiveRef.current = false;
    cancelPendingAnchorCapture();
    updateAutoFollow(true);
    updateShowScrollToBottom(false);
    if (sessionId) {
      sessionAutoBottomUntilRef.current = Date.now() + SESSION_OPEN_BOTTOM_MAX_WAIT_MS;
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
  }, [
    sessionId,
    cancelSessionAutoBottom,
    cancelPendingAnchorCapture,
    resetScrollAnchor,
    resetEventFocus,
    clearDetachedViewportCompensation,
    settleSessionAtBottom,
    updateAutoFollow,
    updateShowScrollToBottom,
  ]);

  useLayoutEffect(() => {
    if (primedSessionId) {
      settleSessionAtBottom();
    }
  }, [primedSessionId, settleSessionAtBottom]);

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
  }, [expandedInitialTailSessionId, sessionId, scrollToBottom, autoFollowRef, userScrollRef, pendingTailExpandScrollAnchorRef, updateShowScrollToBottom, scrollRef]);

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
  }, [olderItemsPage, renderItems.length, updateAutoFollow, updateShowScrollToBottom, autoFollowRef, userScrollRef, pendingOlderItemsScrollAnchorRef, scrollRef]);

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
    restoreResizeAnchor: restoreManualScrollAnchor,
    getScrollDiagSnapshot,
  };
}
