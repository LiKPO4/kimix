import { useRef, useCallback, useEffect } from "react";
import { logError } from "@/utils/reportError";
import type { RenderItem } from "@/types/chatRender";

export interface UseEventFocusOptions {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  sessionId?: string;
  renderItems: RenderItem[];
  hasMoreOlderItems: boolean;
  onExpandOlderItemsToEnd: () => void;
  onHighlightEvent?: (eventId: string | null) => void;
  pauseAutoFollowForUser: () => void;
}

export type UseEventFocusResult = {
  focusTimelineEvent: (eventId: string, searchText?: string, alignment?: TimelineFocusAlignment) => boolean;
  resetForNewSession: (nextSessionId?: string) => void;
};

export type TimelineFocusAlignment = "center" | "start-center";

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
    pauseAutoFollowForUser,
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
      node.scrollTo({ top: Math.max(0, targetTop), behavior: "auto" });
    } else {
      target.scrollIntoView({ behavior: "auto", block: "center" });
    }
    return true;
  }, [scrollRef]);

  const focusTimelineEvent = useCallback((eventId: string, searchText?: string, alignment: TimelineFocusAlignment = "center"): boolean => {
    const now = Date.now();
    const state = focusTimelineEventStateRef.current;
    if (!state || state.eventId !== eventId) {
      focusTimelineEventStateRef.current = { eventId, attemptCount: 1, startTime: now };
      // Navigation is an explicit detached-mode transaction. This atomically
      // cancels tail following, invalidates the pre-navigation anchor, and
      // suppresses restoration until the new anchor has been captured.
      pauseAutoFollowForUser();
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
          window.requestAnimationFrame(() => focusTimelineEvent(eventId, searchText, alignment));
        });
      }
      return false;
    }

    focusTimelineEventStateRef.current = null;
    const didSelectText = selectTextInNode(target, searchText);
    if (!didSelectText) {
      const scrollNode = scrollRef.current;
      if (alignment === "start-center" && scrollNode) {
        const scrollRect = scrollNode.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const targetTop = scrollNode.scrollTop + targetRect.top - scrollRect.top - scrollNode.clientHeight / 2;
        scrollNode.scrollTo({ top: Math.max(0, targetTop), behavior: "auto" });
      } else {
        target.scrollIntoView({ behavior: "auto", block: "center" });
      }
    }
    onHighlightEvent?.(eventId);
    window.setTimeout(() => {
      onHighlightEvent?.(null);
    }, 2200);
    return true;
  }, [findRenderedEventNode, hasMoreOlderItems, onExpandOlderItemsToEnd, onHighlightEvent, pauseAutoFollowForUser, selectTextInNode, scrollRef]);

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
