import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { chatNavigationPreviewPosition, type ChatNavigationItem } from "@/utils/chatNavigation";

export interface ChatNavigationPreviewAnchor {
  right: number;
  centerY: number;
}

interface ChatNavigationPreviewProps {
  item: ChatNavigationItem;
  anchor: ChatNavigationPreviewAnchor;
  visible: boolean;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

const PREVIEW_WIDTH = 340;
const VIEWPORT_MARGIN = 12;
const ANCHOR_GAP = 12;

export function ChatNavigationPreview({ item, anchor, visible, onPointerEnter, onPointerLeave }: ChatNavigationPreviewProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: VIEWPORT_MARGIN, top: VIEWPORT_MARGIN, width: PREVIEW_WIDTH, ready: false });
  const itemLayoutVersion = `${item.key}:${item.title}:${item.preview}:${item.fileLabels.join("|")}`;

  const updatePosition = useCallback(() => {
    const height = cardRef.current?.offsetHeight ?? 150;
    const next = chatNavigationPreviewPosition({
      anchorRight: anchor.right,
      anchorCenterY: anchor.centerY,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      previewWidth: PREVIEW_WIDTH,
      previewHeight: height,
      margin: VIEWPORT_MARGIN,
      gap: ANCHOR_GAP,
    });
    setPosition({ ...next, ready: true });
  }, [anchor.centerY, anchor.right]);

  useLayoutEffect(() => {
    setPosition((current) => ({ ...current, ready: false }));
    updatePosition();
  }, [itemLayoutVersion, updatePosition]);

  useEffect(() => {
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [updatePosition]);

  return createPortal(
    <div
      id={`kimix-chat-navigation-preview-${item.key}`}
      ref={cardRef}
      role="tooltip"
      className="kimix-chat-navigation-preview fixed"
      data-visible={visible && position.ready ? "true" : "false"}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{
        left: position.left,
        top: position.top,
        width: position.width,
        pointerEvents: visible ? "auto" : "none",
        zIndex: 90,
      }}
    >
      <div className="flex items-center" style={{ gap: 9 }}>
        <span
          aria-hidden="true"
          className="shrink-0 rounded-full"
          style={{
            width: 7,
            height: 7,
            background: item.kind === "user" ? "var(--accent-primary)" : "var(--text-primary)",
          }}
        />
        <div className="min-w-0 truncate font-medium text-text-primary" style={{ fontSize: 14, lineHeight: "20px" }}>
          {item.title}
        </div>
      </div>
      <div
        className="kimix-chat-navigation-preview-text text-text-secondary"
        style={{ marginTop: 10, fontSize: 13, lineHeight: "20px" }}
      >
        {item.preview}
      </div>
      {item.fileLabels.length > 0 && (
        <div className="flex flex-wrap" style={{ gap: 8, marginTop: 12 }}>
          {item.fileLabels.map((label) => (
            <span
              key={label}
              className="max-w-[150px] truncate rounded-md bg-surface-hover text-text-muted"
              style={{ paddingLeft: 9, paddingRight: 9, paddingTop: 4, paddingBottom: 4, fontSize: 11.5, lineHeight: "16px" }}
              title={label}
            >
              {label}
            </span>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
