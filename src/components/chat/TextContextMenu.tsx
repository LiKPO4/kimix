import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, ExternalLink, TextSelect } from "lucide-react";

type MenuState = {
  x: number;
  y: number;
  selectedText: string;
  linkUrl: string | null;
  selectAllTarget: Element | null;
};

const URL_RE = /^https?:\/\/[^\s]{4,}$/;

/** Walk up from `el` and return the nearest meaningful text container. */
function findSelectAllTarget(el: Element | null): Element | null {
  let node = el;
  while (node && node !== document.body) {
    if (
      node.classList.contains("markdown-body") ||
      node.classList.contains("kimix-user-bubble") ||
      node.hasAttribute("data-kimix-render-key")
    ) return node;
    node = node.parentElement;
  }
  return null;
}

export function TextContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    const dismiss = () => setMenu(null);

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };

    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // Let the browser handle native editable elements.
      if (target.closest("input, textarea, [contenteditable]")) return;

      const selection = window.getSelection();
      const selectedText = selection?.toString().trim() ?? "";

      // Detect link: either the element itself is inside an <a>, or the
      // selected text is a bare URL.
      const linkEl = target.closest<HTMLAnchorElement>("a[href]");
      const href = linkEl?.href ?? null;
      const linkUrl: string | null =
        href ?? (URL_RE.test(selectedText) ? selectedText : null);

      // Nothing to show — fall back to default browser behavior.
      if (!selectedText && !linkUrl) return;

      event.preventDefault();

      const itemCount = (selectedText ? 1 : 0) + 1 + (linkUrl ? 1 : 0);
      const menuH = itemCount * 34 + 14;  // 14px = 2 × 7px padding
      const menuW = 164;

      setMenu({
        x: Math.max(12, Math.min(event.clientX, window.innerWidth - menuW - 12)),
        y: Math.max(12, Math.min(event.clientY, window.innerHeight - menuH - 12)),
        selectedText,
        linkUrl,
        selectAllTarget: findSelectAllTarget(target),
      });
    };

    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("click", dismiss);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("click", dismiss);
      document.removeEventListener("keydown", handleKey);
    };
  }, []);

  if (!menu) return null;

  const handleCopy = async () => {
    setMenu(null);
    if (menu.selectedText) {
      await navigator.clipboard.writeText(menu.selectedText);
    }
  };

  const handleSelectAll = () => {
    setMenu(null);
    const container = menu.selectAllTarget;
    if (container) {
      const range = document.createRange();
      range.selectNodeContents(container);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    } else {
      document.execCommand("selectAll");
    }
  };

  const handleOpen = () => {
    setMenu(null);
    if (menu.linkUrl) window.open(menu.linkUrl, "_blank", "noopener,noreferrer");
  };

  return createPortal(
    <div
      role="menu"
      aria-label="文字操作"
      className="fixed z-[200] rounded-lg border border-border bg-surface-elevated shadow-elevated-token"
      style={{ left: menu.x, top: menu.y, width: 164, padding: 7 }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {menu.selectedText && (
        <button
          type="button"
          role="menuitem"
          autoFocus
          onClick={() => void handleCopy()}
          className="kimix-icon-text-button w-full justify-start rounded-md text-text-primary hover:bg-surface-hover"
          style={{ minHeight: 34, paddingLeft: 12, paddingRight: 12 }}
        >
          <Copy size={15} />
          <span>复制</span>
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        onClick={handleSelectAll}
        className="kimix-icon-text-button w-full justify-start rounded-md text-text-primary hover:bg-surface-hover"
        style={{ minHeight: 34, paddingLeft: 12, paddingRight: 12 }}
      >
        <TextSelect size={15} />
        <span>全选</span>
      </button>
      {menu.linkUrl && (
        <button
          type="button"
          role="menuitem"
          onClick={handleOpen}
          className="kimix-icon-text-button w-full justify-start rounded-md text-text-primary hover:bg-surface-hover"
          style={{ minHeight: 34, paddingLeft: 12, paddingRight: 12 }}
        >
          <ExternalLink size={15} />
          <span>打开链接</span>
        </button>
      )}
    </div>,
    document.body,
  );
}
