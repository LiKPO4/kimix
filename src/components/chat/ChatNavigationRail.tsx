import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RenderItem } from "@/types/chatRender";
import {
  buildChatNavigationItems,
  buildChatNavigationMarkers,
  chatNavigationGroupHeight,
  CHAT_NAVIGATION_MARKER_GAP,
  type ChatNavigationMarker,
} from "@/utils/chatNavigation";

interface ChatNavigationRailProps {
  items: RenderItem[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
  onNavigate: (eventId: string, kind: ChatNavigationMarker["kind"]) => boolean;
}

function markersEqual(previous: ChatNavigationMarker[], next: ChatNavigationMarker[]) {
  return previous.length === next.length && previous.every((marker, index) => {
    const candidate = next[index];
    return candidate?.key === marker.key &&
      candidate.active === marker.active;
  });
}

export function ChatNavigationRail({ items, scrollRef, contentRef, onNavigate }: ChatNavigationRailProps) {
  const navigationItems = useMemo(() => buildChatNavigationItems(items), [items]);
  const navigationItemsRef = useRef(navigationItems);
  navigationItemsRef.current = navigationItems;
  const [markers, setMarkers] = useState<ChatNavigationMarker[]>([]);
  const frameRef = useRef<number | null>(null);

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
    const readingLine = Math.min(Math.max(scrollNode.clientHeight * 0.24, 96), 220);
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
    );
    setMarkers((current) => markersEqual(current, next) ? current : next);
  }, [contentRef, scrollRef]);

  const scheduleMeasure = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      measure();
    });
  }, [measure]);

  useLayoutEffect(() => {
    scheduleMeasure();
  });

  useEffect(() => {
    const scrollNode = scrollRef.current;
    const contentNode = contentRef.current;
    if (!scrollNode || !contentNode) return;

    scrollNode.addEventListener("scroll", scheduleMeasure, { passive: true });
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleMeasure);
    observer?.observe(scrollNode);
    observer?.observe(contentNode);

    return () => {
      scrollNode.removeEventListener("scroll", scheduleMeasure);
      observer?.disconnect();
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [contentRef, scheduleMeasure, scrollRef]);

  if (markers.length < 2) return null;
  const groupHeight = chatNavigationGroupHeight(markers.length);

  return (
    <nav
      aria-label="对话导航"
      className="absolute"
      style={{
        left: -40,
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
            title={marker.label}
            onClick={() => onNavigate(marker.eventId, marker.kind)}
            style={{
              top: index * CHAT_NAVIGATION_MARKER_GAP,
              height: CHAT_NAVIGATION_MARKER_GAP,
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
    </nav>
  );
}
