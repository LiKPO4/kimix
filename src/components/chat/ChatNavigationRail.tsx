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
  /** 会话身份；切换会话时同步丢弃旧节点几何和刻度状态。 */
  sessionKey?: string;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
  onNavigate: (eventId: string, kind: ChatNavigationMarker["kind"]) => boolean;
  /** 刻度条贴附侧，默认 left。 */
  side?: "left" | "right";
  /** 单条刻度线长度（px），默认 11。 */
  markWidth?: number;
}

interface NavigationPreviewState {
  itemKey: string;
  anchor: ChatNavigationPreviewAnchor;
}

const PREVIEW_CLOSE_DELAY_MS = 90;
const PREVIEW_EXIT_DURATION_MS = 140;
const SCROLL_EDGE_THRESHOLD_PX = 80;
const RAIL_VERTICAL_INSET_PX = 24;
/** Chat viewport left inset for the rail hit-box; marks sit on the left of the hit-box. */
const RAIL_LEFT_OFFSET_PX = 8;

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

export function ChatNavigationRail({ items, sessionKey = "", scrollRef, contentRef, onNavigate, side = "left", markWidth = 11 }: ChatNavigationRailProps) {
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
  /** 渲染节点列表缓存：避免每次滚动都全量 querySelectorAll。 */
  const nodeCacheRef = useRef<HTMLElement[] | null>(null);
  const nodeCacheRefreshFrameRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    nodeCacheRef.current = null;
    setMarkers([]);
    setPreview(null);
    setPreviewVisible(false);
    previewRef.current = null;
    previewVisibleRef.current = false;
  }, [sessionKey]);

  const collectRenderNodes = useCallback((): HTMLElement[] => {
    const contentNode = contentRef.current;
    if (!contentNode) return [];
    return Array.from(contentNode.querySelectorAll<HTMLElement>("[data-kimix-render-key]"));
  }, [contentRef]);

  const refreshNodeCache = useCallback(() => {
    nodeCacheRef.current = collectRenderNodes();
  }, [collectRenderNodes]);

  const measure = useCallback(() => {
    const scrollNode = scrollRef.current;
    const contentNode = contentRef.current;
    const currentItems = navigationItemsRef.current;
    if (!scrollNode || !contentNode || currentItems.length < 2) {
      setMarkers((current) => current.length > 0 ? [] : current);
      return;
    }

    // 优先用缓存的节点列表；缓存缺失或节点已从 DOM 移除（长会话虚拟滚动）时
    // 回退到全量 querySelectorAll 并重建缓存。
    let nodes = nodeCacheRef.current;
    if (!nodes || nodes.some((node) => !node.isConnected)) {
      nodes = collectRenderNodes();
      nodeCacheRef.current = nodes;
    }
    const nodesByKey = new Map(
      nodes.map((node) => [node.dataset.kimixRenderKey ?? "", node] as const),
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
        top: rect.top - scrollTop,
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
  }, [collectRenderNodes, contentRef, scrollRef]);

  const lastScrollMeasureAtRef = useRef(0);
  const trailingMeasureTimerRef = useRef<number | null>(null);
  const scheduleMeasure = useCallback((force = false) => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const now = Date.now();
      // While the user is scrolling, throttle expensive marker geometry work.
      if (!force && isScrollYieldEnabled() && isUserScrollActive() && now - lastScrollMeasureAtRef.current < 200) {
        // Trailing measure: guarantee one final measurement after the scroll
        // burst settles so markers never stay stale at a mid-scroll position.
        if (trailingMeasureTimerRef.current === null) {
          trailingMeasureTimerRef.current = window.setTimeout(() => {
            trailingMeasureTimerRef.current = null;
            if (Date.now() - lastScrollMeasureAtRef.current < 200) return;
            lastScrollMeasureAtRef.current = Date.now();
            measure();
          }, 200);
        }
        return;
      }
      lastScrollMeasureAtRef.current = now;
      measure();
    });
  }, [measure]);

  useEffect(() => () => {
    if (trailingMeasureTimerRef.current !== null) {
      window.clearTimeout(trailingMeasureTimerRef.current);
      trailingMeasureTimerRef.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    // items 变化即内容 DOM 变化：先刷新节点缓存，再做强制 measure。
    refreshNodeCache();
    scheduleMeasure(true);
  }, [items, refreshNodeCache, scheduleMeasure]);

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
    // DOM 子树增删节点时刷新节点缓存；rAF 合并，避免流式输出期间密集
    // mutation 触发大量全量收集。
    const mutationObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(() => {
        if (nodeCacheRefreshFrameRef.current !== null) return;
        nodeCacheRefreshFrameRef.current = window.requestAnimationFrame(() => {
          nodeCacheRefreshFrameRef.current = null;
          refreshNodeCache();
        });
      });
    mutationObserver?.observe(contentNode, { subtree: true, childList: true });

    return () => {
      scrollNode.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      mutationObserver?.disconnect();
      if (nodeCacheRefreshFrameRef.current !== null) {
        window.cancelAnimationFrame(nodeCacheRefreshFrameRef.current);
        nodeCacheRefreshFrameRef.current = null;
      }
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [contentRef, refreshNodeCache, scheduleMeasure, scrollRef]);

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
    const anchor = { right: side === "right" ? rect.left : rect.right, centerY: rect.top + rect.height / 2, side };
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
  }, [clearPreviewTimers, side]);

  if (markers.length < 2) return null;
  const groupHeight = chatNavigationGroupHeight(markers.length, markerGap);
  const previewItem = preview ? markers.find((marker) => marker.key === preview.itemKey) : null;

  return (
    <nav
      aria-label="对话导航"
      className="absolute"
      style={{
        ...(side === "right" ? { right: RAIL_LEFT_OFFSET_PX } : { left: RAIL_LEFT_OFFSET_PX }),
        top: "50%",
        // Wide hit target extends right into the gutter; ticks render on the left edge.
        width: 28,
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
            className="kimix-style-exempt kimix-chat-navigation-hit absolute left-0"
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
              width: 28,
            }}
          >
            <span
              className="kimix-chat-navigation-mark absolute"
              style={{ top: "50%", ...(side === "right" ? { right: 4 } : { left: 4 }), width: markWidth }}
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
