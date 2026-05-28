import { useEffect } from "react";

export function useKeyboardShortcuts(
  toggleSidebar: () => void,
  triggerFocusInput: () => void,
  onEscape: () => void,
) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.querySelector('[aria-modal="true"]')) return;

      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      const isMod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape") {
        onEscape();
        return;
      }
      if (isMod && e.key === "b") {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      if (isMod && e.key === "k") {
        e.preventDefault();
        triggerFocusInput();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [toggleSidebar, triggerFocusInput, onEscape]);
}
