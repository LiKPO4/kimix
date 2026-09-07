// 选区标注（selection annotation）的纯逻辑：从 DOM 选区提取可引用文本、
// 格式化为 Markdown 引用块注入 Composer。DOM 相关判断保留在这里以便单测。

export const ANNOTATABLE_ATTR = "data-kimix-annotatable";
export const ANNOTATABLE_EXCLUDE_ATTR = "data-kimix-annotatable-exclude";

/** 规范选区文本：统一换行、去行尾空白、压缩 3+ 连续空行、整体去首尾空白。 */
export function normalizeSelectedText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 格式化为注入 Composer 的文本：逐行 `> ` 引用块；带评论时引用块后空一行接评论。
 * 空选区返回空串，调用方不应注入。
 */
export function formatSelectionQuote(selectedText: string, comment?: string): string {
  const normalized = normalizeSelectedText(selectedText);
  if (!normalized) return "";
  const quote = normalized
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
  const trimmedComment = comment?.trim() ?? "";
  return trimmedComment ? `${quote}\n\n${trimmedComment}` : quote;
}

/** 引用 chip 的一行摘要：取首个非空行、压缩连续空白、按字符截断。 */
export function formatQuoteChipLabel(quote: string, maxLength = 24): string {
  const firstLine = quote.split("\n").find((line) => line.trim()) ?? "";
  const compact = firstLine.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}…` : compact;
}

/** 把新引用片段合并进现有草稿：草稿非空时先空两行分隔。 */
export function mergeQuoteIntoDraft(draft: string, quote: string): string {
  if (!quote) return draft;
  return draft.trim() ? `${draft.trimEnd()}\n\n${quote}` : quote;
}

function elementOf(node: Node | null): HTMLElement | null {
  if (!node) return null;
  return node instanceof HTMLElement ? node : node.parentElement;
}

/**
 * 判断选区是否落在可标注区域内。两端（anchor/focus）都必须在同一个
 * [data-kimix-annotatable] 容器内，且不经过 [data-kimix-annotatable-exclude]
 * 排除区（按钮、工具行等）——否则选的是 UI 铬件文字，不提供标注。
 */
export function isSelectionAnnotatable(selection: Selection): boolean {
  if (selection.isCollapsed || selection.rangeCount === 0) return false;
  const anchor = elementOf(selection.anchorNode);
  const focus = elementOf(selection.focusNode);
  if (!anchor || !focus) return false;
  const container = anchor.closest(`[${ANNOTATABLE_ATTR}]`);
  if (!container || !container.contains(focus)) return false;
  if (anchor.closest(`[${ANNOTATABLE_EXCLUDE_ATTR}]`)) return false;
  if (focus.closest(`[${ANNOTATABLE_EXCLUDE_ATTR}]`)) return false;
  return true;
}
