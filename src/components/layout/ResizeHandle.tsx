import type { PointerEvent as ReactPointerEvent } from "react";

interface ResizeHandleProps {
  ariaLabel: string;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

export function ResizeHandle({ ariaLabel, onPointerDown }: ResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      className="kimix-layout-resizer"
      onPointerDown={onPointerDown}
    />
  );
}
