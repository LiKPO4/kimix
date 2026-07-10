import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export function useDialogFocus<T extends HTMLElement = HTMLDivElement>(open: boolean) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!open) return;
    const container = ref.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const firstFocusable = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstFocusable ?? container).focus();

    return () => {
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [open]);

  return ref;
}
