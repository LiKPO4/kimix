import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RenderItem } from "@/types/chatRender";
import {
  buildChatNavigationItems,
  buildChatNavigationMarkers,
  chatNavigationGroupHeight,
  chatNavigationMarkerGap,
  chatNavigationPreviewOpenDelay,
  chatNavigationReadingLine,
  CHAT_NAVIGATION_MARKER_GAP_MAX,
  type ChatNavigationMarker,
} from "@/utils/chatNavigation";
import { isScrollYieldEnabled } from "@/utils/perfFlags";
import { isUserScrollActive } from "@/utils/userScrollActivity";
import { ChatNavigationPreview, type ChatNavigationPreviewAnchor } from "./ChatNavigationPreview";

interface ChatNavigationRailProps {
  items: RenderItem[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
  onNavigate: (eventId: string, kind: ChatNavigationMarker["kind"]) => boolean;
}

interface NavigationPreviewState {
  itemKey: string;
  anchor: ChatNavigationPreviewAnchor;
}

const PREVIEW_CLOSE_DELAY_MS = 90;
const PREVIEW_EXIT_DURATION_MS = 140;
const SCROLL_EDGE_THRESHOLD_PX = 3;
const RAIL_VERTICAL_INSET_PX = 24;
const RAIL_LEFT_OFFSET_PX = -46;

function markersEqual(previous: ChatNavigationMarker[], next: ChatNavigationMarker[]) {
  return previous.length === next.length && previous.every((marker, index) => {
    const candidate = next[index];
    return candidate?.key === marker.key &&
      candidate.active === marker.active &&
      candidate.title === marker.title &&
      candidate.preview === marker.preview &&
      candidate.fileLabels.join("\n") === marker.fileLabels.join("\n");
  });
}

export function ChatNavigationRail({ items, scrollRef, contentRef, onNavigate }: ChatNavigationRailProps) {
  const navigationItems = useMemo(() => buildChatNavigationItems(items), [items]);
  const navigationItemsRef = useRef(navigationItems);
  navigationItemsRef.current = navigationItems;
  const [markers, setMarkers] = useState<ChatNavigationMarker[]>([]);
  const [markerGap, setMarkerGap] = useState(CHAT_NAVIGATION_MARKER_GAP_MAX);
  const [preview, setPreview] = useState<NavigationPreviewState | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const previewRef = useRef(preview);
  const previewVisibleRef = useRef(previewVisible);
  previewRef.current = preview;
  previewVisibleRef.current = previewVisible;
  const frameRef = useRef<number | null>(null);
  const previewOpenTimerRef = useRef<number | null>(null);
  const previewCloseTimerRef = useRef<number | null>(null);
  const previewDisposeTimerRef = useRef<number | null>(null);
  const previewFrameRef = useRef<number | null>(null);

  const measure = useCallback(() => {
    const scrollNode = scrollRef.current;
    const contentNode = contentRef.current;
    const currentItems = navigationItemsRef.current;
    if (!scrollNode || !contentNode || currentItems.length < 2) {
      setMarkers((current) => current.length > 0 ? [] : current);
      return;
    }

    const nodesByKey = new Map(
      Array.from(contentNode.querySelectorAll<HTMLElement>("[data-kimix-render-key]"))
        .map((node) => [node.dataset.kimixRenderKey ?? "", node] as const),
    );
    const scrollTop = scrollNode.getBoundingClientRect().top;
    const readingLine = chatNavigationReadingLine(scrollNode.clientHeight);
    const distanceFromBottom = scrollNode.scrollHeight - scrollNode.clientHeight - scrollNode.scrollTop;
    const edges = {
      atTop: scrollNode.scrollTop <= SCROLL_EDGE_THRESHOLD_PX,
      atBottom: distanceFromBottom <= SCROLL_EDGE_THRESHOLD_PX,
    };
    const geometry = currentItems.flatMap((item) => {
      const node = nodesByKey.get(item.key);
      if (!node) return [];
      const rect = node.getBoundingClientRect();
      return [{
        key: item.key,
        bottom: rect.bottom - scrollTop,
      }];
    });
    const next = buildChatNavigationMarkers(
      currentItems,
      geometry,
      readingLine,
      edges,
    );
    setMarkers((current) => markersEqual(current, next) ? current : next);
    const availableRailHeight = Math.max(0, scrollNode.clientHeight - RAIL_VERTICAL_INSET_PX * 2);
    const nextMarkerGap = chatNavigationMarkerGap(next.length, availableRailHeight);
    setMarkerGap((current) => current === nextMarkerGap ? current : nextMarkerGap);
  }, [contentRef, scrollRef]);

  const lastScrollMeasureAtRef = useRef(0);
  const scheduleMeasure = useCallback((force = false) => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const now = Date.now();
      // While the user is scrolling, throttle expensive marker geometry work.
      if (!force && isScrollYieldEnabled() && isUserScrollActive() && now - lastScrollMeasureAtRef.current < 200) {
        return;
      }
      lastScrollMeasureAtRef.current = now;
      measure();
    });
  }, [measure]);

  useLayoutEffect(() => {
    scheduleMeasure(true);
  }, [items, scheduleMeasure]);

  useEffect(() => {
    const scrollNode = scrollRef.current;
    const contentNode = contentRef.current;
    if (!scrollNode || !contentNode) return;

    const onScroll = () => scheduleMeasure(false);
    scrollNode.addEventListener("scroll", onScroll, { passive: true });
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => scheduleMeasure(true));
    observer?.observe(scrollNode);
    observer?.observe(contentNode);

    return () => {
      scrollNode.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [contentRef, scheduleMeasure, scrollRef]);

  const clearPreviewTimers = useCallback(() => {
    if (previewOpenTimerRef.current !== null) window.clearTimeout(previewOpenTimerRef.current);
    if (previewCloseTimerRef.current !== null) window.clearTimeout(previewCloseTimerRef.current);
    if (previewDisposeTimerRef.current !== null) window.clearTimeout(previewDisposeTimerRef.current);
    if (previewFrameRef.current !== null) window.cancelAnimationFrame(previewFrameRef.current);
    previewOpenTimerRef.current = null;
    previewCloseTimerRef.current = null;
    previewDisposeTimerRef.current = null;
    previewFrameRef.current = null;
  }, []);

  useEffect(() => clearPreviewTimers, [clearPreviewTimers]);

  const keepPreviewOpen = useCallback(() => {
    if (previewCloseTimerRef.current !== null) window.clearTimeout(previewCloseTimerRef.current);
    if (previewDisposeTimerRef.current !== null) window.clearTimeout(previewDisposeTimerRef.current);
    previewCloseTimerRef.current = null;
    previewDisposeTimerRef.current = null;
  }, []);

  const schedulePreviewClose = useCallback(() => {
    if (previewOpenTimerRef.current !== null) window.clearTimeout(previewOpenTimerRef.current);
    if (previewCloseTimerRef.current !== null) window.clearTimeout(previewCloseTimerRef.current);
    previewOpenTimerRef.current = null;
    previewCloseTimerRef.current = window.setTimeout(() => {
      setPreviewVisible(false);
      previewDisposeTimerRef.current = window.setTimeout(() => {
        setPreview(null);
        previewDisposeTimerRef.current = null;
      }, PREVIEW_EXIT_DURATION_MS);
      previewCloseTimerRef.current = null;
    }, PREVIEW_CLOSE_DELAY_MS);
  }, []);

  const schedulePreviewOpen = useCallback((item: ChatNavigationMarker, target: HTMLElement) => {
    clearPreviewTimers();
    const rect = target.getBoundingClientRect();
    const anchor = { right: rect.right, centerY: rect.top + rect.height / 2 };
    const hasVisiblePreview = previewVisibleRef.current && previewRef.current !== null;
    if (hasVisiblePreview && previewRef.current?.itemKey === item.key) {
      setPreview({ itemKey: item.key, anchor });
      return;
    }
    previewOpenTimerRef.current = window.setTimeout(() => {
      setPreview({ itemKey: item.key, anchor });
      if (hasVisiblePreview) {
        setPreviewVisible(true);
      } else {
        setPreviewVisible(false);
        previewFrameRef.current = window.requestAnimationFrame(() => {
          setPreviewVisible(true);
          previewFrameRef.current = null;
        });
      }
      previewOpenTimerRef.current = null;
    }, chatNavigationPreviewOpenDelay(hasVisiblePreview));
  }, [clearPreviewTimers]);

  if (markers.length < 2) return null;
  const groupHeight = chatNavigationGroupHeight(markers.length, markerGap);
  const previewItem = preview ? markers.find((marker) => marker.key === preview.itemKey) : null;

  return (
    <nav
      aria-label="对话导航"
      className="absolute"
      style={{
        left: RAIL_LEFT_OFFSET_PX,
        top: "50%",
        width: 40,
        height: groupHeight,
        pointerEvents: "auto",
        transform: "translateY(-50%)",
      }}
    >
      {markers.map((marker, index) => {
        return (
          <button
            key={marker.key}
            type="button"
            className="kimix-chat-navigation-hit absolute right-0"
            data-active={marker.active ? "true" : "false"}
            data-kind={marker.kind}
            aria-label={`${marker.label}，跳转到第 ${index + 1} 个对话节点`}
            aria-current={marker.active ? "location" : undefined}
            aria-describedby={preview?.itemKey === marker.key ? `kimix-chat-navigation-preview-${marker.key}` : undefined}
            onPointerEnter={(event) => schedulePreviewOpen(marker, event.currentTarget)}
            onPointerLeave={schedulePreviewClose}
            onFocus={(event) => schedulePreviewOpen(marker, event.currentTarget)}
            onBlur={schedulePreviewClose}
            onClick={() => {
              schedulePreviewClose();
              onNavigate(marker.eventId, marker.kind);
            }}
            style={{
              top: index * markerGap,
              height: markerGap,
              width: 40,
            }}
          >
            <span
              className="kimix-chat-navigation-mark absolute"
              style={{ top: "50%", right: 8 }}
            />
          </button>
        );
      })}
      {preview && previewItem && (
        <ChatNavigationPreview
          item={previewItem}
          anchor={preview.anchor}
          visible={previewVisible}
          onPointerEnter={keepPreviewOpen}
          onPointerLeave={schedulePreviewClose}
        />
      )}
    </nav>
  );
}
