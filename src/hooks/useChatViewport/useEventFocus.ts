import { useRef, useCallback, useEffect } from "react";
import { logError } from "@/utils/reportError";
import type { RenderItem } from "@/components/chat/ChatThread";

export interface UseEventFocusOptions {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  sessionId?: string;
  renderItems: RenderItem[];
  hasMoreOlderItems: boolean;
  onExpandOlderItemsToEnd: () => void;
  onHighlightEvent?: (eventId: string | null) => void;
  autoFollowRef: React.MutableRefObject<boolean>;
  userScrollRef: React.MutableRefObject<boolean>;
  updateAutoFollow: (value: boolean) => void;
  scrollTokenRef: React.MutableRefObject<number>;
  cancelSessionAutoBottom: () => void;
}

export type UseEventFocusResult = {
  focusTimelineEvent: (eventId: string, searchText?: string) => boolean;
  resetForNewSession: (nextSessionId?: string) => void;
};

const MAX_FOCUS_RECURSIVE_ATTEMPTS = 10;
const MAX_FOCUS_DURATION_MS = 2_000;

export function useEventFocus(options: UseEventFocusOptions): UseEventFocusResult {
  const {
    scrollRef,
    sessionId,
    renderItems,
    hasMoreOlderItems,
    onExpandOlderItemsToEnd,
    onHighlightEvent,
    autoFollowRef,
    userScrollRef,
    updateAutoFollow,
    scrollTokenRef,
    cancelSessionAutoBottom,
  } = options;

  const pendingFocusEventRef = useRef<{ sessionId: string; eventId: string; searchText?: string } | null>(null);
  const focusTimelineEventStateRef = useRef<{ eventId: string; attemptCount: number; startTime: number } | null>(null);

  const findRenderedEventNode = useCallback((eventId: string): HTMLElement | null => {
    const node = scrollRef.current;
    if (!node) return null;
    const escaped = globalThis.CSS?.escape ? globalThis.CSS.escape(eventId) : eventId.replace(/["\\]/g, "\\$&");
    const direct = node.querySelector<HTMLElement>(`[data-kimix-event-id="${escaped}"]`);
    if (direct) return direct;
    return Array.from(node.querySelectorAll<HTMLElement>("[data-kimix-event-ids]"))
      .find((item) => (item.dataset.kimixEventIds ?? "").split(" ").includes(eventId)) ?? null;
  }, [scrollRef]);

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
  }, [scrollRef]);

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
        message: "[useEventFocus] focusTimelineEvent aborted",
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
  }, [cancelSessionAutoBottom, findRenderedEventNode, hasMoreOlderItems, onExpandOlderItemsToEnd, onHighlightEvent, selectTextInNode, autoFollowRef, userScrollRef, updateAutoFollow, scrollTokenRef]);

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
    const pending = pendingFocusEventRef.current;
    if (!pending || !sessionId || pending.sessionId !== sessionId) return;
    window.requestAnimationFrame(() => {
      if (focusTimelineEvent(pending.eventId, pending.searchText)) {
        pendingFocusEventRef.current = null;
      }
    });
  }, [sessionId, renderItems.length, focusTimelineEvent]);

  const resetForNewSession = useCallback((nextSessionId?: string) => {
    if (pendingFocusEventRef.current?.sessionId !== nextSessionId) {
      pendingFocusEventRef.current = null;
    }
    focusTimelineEventStateRef.current = null;
  }, []);

  return { focusTimelineEvent, resetForNewSession };
}
