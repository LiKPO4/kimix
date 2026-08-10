import type { PointerEvent as ReactPointerEvent } from "react";

interface ResizeHandleProps {
  ariaLabel: string;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  withPanelGap?: boolean;
}

export function ResizeHandle({ ariaLabel, onPointerDown, withPanelGap = false }: ResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      className={`kimix-layout-resizer${withPanelGap ? " has-panel-gap" : ""}`}
      onPointerDown={onPointerDown}
    />
  );
}
