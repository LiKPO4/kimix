import type { HTMLAttributes, ReactNode } from "react";

export type ComposerToolbarPopoverAlign = "start" | "end";

const COMPOSER_TOOLBAR_POPOVER_GAP = 8;
const COMPOSER_TOOLBAR_POPOVER_PADDING = 16;
const COMPOSER_TOOLBAR_POPOVER_RADIUS = 16;

export function ComposerToolbarPopover({
  align,
  width,
  padding = COMPOSER_TOOLBAR_POPOVER_PADDING,
  children,
  className = "",
  style,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  align: ComposerToolbarPopoverAlign;
  width: number;
  padding?: number;
  children: ReactNode;
}) {
  return (
    <div
      {...props}
      className={`kimix-floating-panel ${className}`.trim()}
      data-composer-toolbar-popover={align}
      style={{
        ...style,
        position: "absolute",
        bottom: "100%",
        left: align === "start" ? 0 : "auto",
        right: align === "end" ? 0 : "auto",
        zIndex: 50,
        boxSizing: "border-box",
        width,
        maxWidth: "calc(100vw - 40px)",
        marginBottom: COMPOSER_TOOLBAR_POPOVER_GAP,
        padding,
        borderRadius: COMPOSER_TOOLBAR_POPOVER_RADIUS,
      }}
    >
      {children}
    </div>
  );
}
