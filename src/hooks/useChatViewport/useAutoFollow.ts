import { useRef, useCallback } from "react";
import { logError } from "@/utils/reportError";
import { bottomScrollTop } from "@/utils/scrollIntent";
import {
  USER_SUBMIT_BOTTOM_MAX_WAIT_MS,
  SESSION_LAYOUT_STABLE_MS,
} from "./constants";

export interface UseAutoFollowOptions {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Shared mutable refs are owned by the parent hook so multiple sub-hooks can read them explicitly. */
  autoFollowRef: React.MutableRefObject<boolean>;
  userScrollRef: React.MutableRefObject<boolean>;
  isAutoFollowRef: React.MutableRefObject<boolean>;
  ignoreScrollUntilRef: React.MutableRefObject<number>;
  scrollTokenRef: React.MutableRefObject<number>;
  sessionAutoBottomUntilRef: React.MutableRefObject<number>;
  userBottomIntentUntilRef: React.MutableRefObject<number>;
  userInputLockUntilRef: React.MutableRefObject<number>;
  updateShowScrollToBottom: (value: boolean) => void;
  clearDetachedViewportCompensation: () => void;
  cancelPendingAnchorCapture: () => void;
  clearResizeAnchor: () => void;
  recordExplicitUserScrollIntent: () => void;
  setUserHasScrolled: (value: boolean) => void;
  userHasScrolled: boolean;
}

export interface UseAutoFollowResult {
  updateAutoFollow: (value: boolean) => void;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  settleSessionAtBottom: () => void;
  settleUserSubmittedMessageAtBottom: () => void;
  enableAutoFollow: () => void;
  pauseAutoFollowForUser: () => void;
  cancelSessionAutoBottom: () => void;
}

export function useAutoFollow(options: UseAutoFollowOptions): UseAutoFollowResult {
  const {
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
  } = options;

  const sessionAutoBottomTimerRef = useRef<number | null>(null);
  const sessionAutoBottomStableRef = useRef<{ scrollHeight: number; clientHeight: number; count: number } | null>(null);

  const updateAutoFollow = useCallback((value: boolean) => {
    if (isAutoFollowRef.current === value) return;
    isAutoFollowRef.current = value;
  }, [isAutoFollowRef]);

  const clearSessionAutoBottomTimer = useCallback(() => {
    if (sessionAutoBottomTimerRef.current === null) return;
    window.clearTimeout(sessionAutoBottomTimerRef.current);
    sessionAutoBottomTimerRef.current = null;
  }, []);

  const cancelSessionAutoBottom = useCallback(() => {
    sessionAutoBottomUntilRef.current = 0;
    sessionAutoBottomStableRef.current = null;
    clearSessionAutoBottomTimer();
  }, [sessionAutoBottomUntilRef, clearSessionAutoBottomTimer]);

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
      message: "[useAutoFollow] scrollToBottom",
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
        message: "[useAutoFollow] scrollToBottomAfter",
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
  }, [scrollRef, autoFollowRef, userScrollRef, userInputLockUntilRef, scrollTokenRef, ignoreScrollUntilRef, clearDetachedViewportCompensation, updateShowScrollToBottom]);

  const settleSessionAtBottom = useCallback(() => {
    const node = scrollRef.current;
    if (!node || !autoFollowRef.current || userScrollRef.current) {
      cancelSessionAutoBottom();
      return;
    }
    scrollToBottom("auto");
    const remaining = sessionAutoBottomUntilRef.current - Date.now();
    window.api?.writeDiag?.({
      message: "[useAutoFollow] settleSessionAtBottom",
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
  }, [scrollRef, autoFollowRef, userScrollRef, sessionAutoBottomUntilRef, scrollToBottom, cancelSessionAutoBottom, clearSessionAutoBottomTimer]);

  const enableAutoFollow = useCallback(() => {
    cancelPendingAnchorCapture();
    clearResizeAnchor();
    userBottomIntentUntilRef.current = 0;
    autoFollowRef.current = true;
    userScrollRef.current = false;
    updateAutoFollow(true);
    updateShowScrollToBottom(false);
    scrollToBottom("smooth");
  }, [cancelPendingAnchorCapture, clearResizeAnchor, userBottomIntentUntilRef, autoFollowRef, userScrollRef, updateAutoFollow, updateShowScrollToBottom, scrollToBottom]);

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
  }, [autoFollowRef, userScrollRef, sessionAutoBottomUntilRef, updateAutoFollow, updateShowScrollToBottom, scrollToBottom, settleSessionAtBottom]);

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
  }, [cancelSessionAutoBottom, recordExplicitUserScrollIntent, userBottomIntentUntilRef, userScrollRef, scrollTokenRef, userHasScrolled, setUserHasScrolled, autoFollowRef, updateAutoFollow]);

  return {
    updateAutoFollow,
    scrollToBottom,
    settleSessionAtBottom,
    settleUserSubmittedMessageAtBottom,
    enableAutoFollow,
    pauseAutoFollowForUser,
    cancelSessionAutoBottom,
  };
}
