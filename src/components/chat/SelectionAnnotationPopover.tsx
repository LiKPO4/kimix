import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquareQuote, PenLine, X } from "lucide-react";

import {
  formatSelectionQuote,
  isSelectionAnnotatable,
  normalizeSelectedText,
} from "@/utils/selectionQuote";

const POPOVER_WIDTH = 260;
const POPOVER_GAP = 10;

type PopoverState = {
  x: number;
  y: number;
  selectedText: string;
};

function dispatchQuote(selectedText: string, comment?: string) {
  const text = formatSelectionQuote(selectedText, comment);
  if (!text) return;
  window.dispatchEvent(new CustomEvent("kimix:composer-insert-quote", { detail: { text } }));
}

/**
 * 选区标注浮层：在标注区域（[data-kimix-annotatable]，当前为对话消息流与
 * 右侧文件预览/Diff 面板）选中文字后，在选择区上方弹出「引用到对话 / 评论」，
 * 对齐官方 Kimi Code 0.41 web 的 selection annotation。
 */
export function SelectionAnnotationPopover() {
  const [state, setState] = useState<PopoverState | null>(null);
  const [commentMode, setCommentMode] = useState(false);
  const [comment, setComment] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);

  const hide = useCallback(() => {
    setState(null);
    setCommentMode(false);
    setComment("");
  }, []);

  useEffect(() => {
    const showForSelection = () => {
      const selection = window.getSelection();
      if (!selection || !isSelectionAnnotatable(selection)) return;
      const text = normalizeSelectedText(selection.toString());
      if (!text) return;
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      const x = Math.min(
        Math.max(rect.left + rect.width / 2 - POPOVER_WIDTH / 2, 8),
        window.innerWidth - POPOVER_WIDTH - 8,
      );
      const y = Math.max(rect.top - POPOVER_GAP, 48);
      setState((prev) => {
        // 评论输入中用户点击浮层内部也会触发 selection 变化，此时不得重定位/重置
        if (prev && commentModeRef.current) return prev;
        return { x, y, selectedText: text };
      });
    };
    const onMouseUp = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      // 等浏览器完成选区更新
      window.requestAnimationFrame(showForSelection);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!event.shiftKey && event.key !== "Shift") return;
      showForSelection();
    };
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const commentModeRef = useRef(commentMode);
  commentModeRef.current = commentMode;

  useEffect(() => {
    if (!state) return;
    const onMouseDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      hide();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    const onScroll = () => hide();
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [state, hide]);

  useEffect(() => {
    if (commentMode) commentRef.current?.focus();
  }, [commentMode]);

  if (!state) return null;

  const finish = (withComment: boolean) => {
    dispatchQuote(state.selectedText, withComment ? comment : undefined);
    window.getSelection()?.removeAllRanges();
    hide();
  };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="选区标注"
      data-kimix-annotatable-exclude
      className="kimix-menu-panel fixed z-[90]"
      style={{
        left: state.x,
        width: POPOVER_WIDTH,
        transform: "translateY(-100%)",
        top: state.y,
        padding: 8,
      }}
    >
      {commentMode ? (
        <div className="flex flex-col" style={{ gap: 8 }}>
          <textarea
            ref={commentRef}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                finish(true);
              }
            }}
            placeholder="对选中内容的评论…"
            rows={3}
            className="kimix-settings-input w-full resize-none text-[13px] leading-5"
            style={{ padding: "8px 10px" }}
          />
          <div className="flex items-center justify-end" style={{ gap: 8 }}>
            <button
              type="button"
              className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover"
              onClick={() => setCommentMode(false)}
            >
              <X size={14} />
              返回
            </button>
            <button
              type="button"
              className="kimix-icon-text-button is-compact bg-accent-primary text-white"
              onClick={() => finish(true)}
            >
              引用并评论
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center" style={{ gap: 6 }}>
          <button
            type="button"
            className="kimix-icon-text-button is-compact flex-1 justify-center text-text-secondary hover:bg-surface-hover"
            onClick={() => finish(false)}
            title="把选中文字作为引用插入输入框"
          >
            <MessageSquareQuote size={14} />
            引用到对话
          </button>
          <button
            type="button"
            className="kimix-icon-text-button is-compact flex-1 justify-center text-text-secondary hover:bg-surface-hover"
            onClick={() => setCommentMode(true)}
            title="选中文字加一条评论后插入输入框"
          >
            <PenLine size={14} />
            评论
          </button>
        </div>
      )}
    </div>
  );
}
