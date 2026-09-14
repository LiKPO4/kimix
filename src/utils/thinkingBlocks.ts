import type { ThinkingPart } from "@/types/ui";
import { longestSuffixPrefixOverlap, stripNormalizedPrefix } from "./textOverlap";

const THINKING_PART_OVERLAP_MIN_CHARS = 16;

/** 与归一化匹配口径一致的空白折叠（不 trim），供增量累积归一化视图使用。 */
function collapseForOverlap(text: string): string {
  return text.replace(/\s+/g, " ");
}

/** 把新一段的折叠文本并入累计视图：跨边界的空白运行整体只折叠成一个空格。 */
function appendCollapsedNormalized(current: string, addition: string): string {
  if (!current) return addition;
  if (!addition) return current;
  if (current.endsWith(" ") && addition.startsWith(" ")) return current + addition.slice(1);
  return current + addition;
}

export type ThinkingBlock = {
  id: string;
  timestamp: number;
  text: string;
  summary: string;
};

function isKimixSyntheticThinking(text: string) {
  const trimmed = text.trim();
  return trimmed.startsWith("【实时状态】") ||
    trimmed.includes("当前 prompt-mode 尚未实时写出思考正文") ||
    trimmed.includes("Kimix 会继续回放");
}

function compactTitle(text: string, maxLength = 220) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const firstSentence = normalized.match(/^(.{1,180}?[。！？?!])(?:\s|$)/)?.[1];
  const candidate = firstSentence ?? normalized;
  if (candidate.length <= maxLength) return candidate || "思考内容";
  return `${candidate.slice(0, maxLength).trimEnd()}...`;
}

function summarizeThinkingText(text: string) {
  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return compactTitle(paragraphs.at(-1) ?? text);
}

function splitLegacyThinking(text: string, timestamp: number): ThinkingBlock[] {
  if (isKimixSyntheticThinking(text)) return [];
  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const source = paragraphs.length > 1
    ? paragraphs
    : text.match(/[^。！？?!]+[。！？?!]?/g)?.map((part) => part.trim()).filter(Boolean) ?? [text.trim()];
  const blocks: ThinkingBlock[] = [];
  let buffer = "";
  source.forEach((part) => {
    const next = buffer ? `${buffer}\n\n${part}` : part;
    if (next.length < 520) {
      buffer = next;
      return;
    }
    if (buffer) {
      blocks.push({
        id: `thinking-${timestamp}-${blocks.length}`,
        timestamp: timestamp + blocks.length,
        text: buffer,
        summary: summarizeThinkingText(buffer),
      });
    }
    buffer = part;
  });
  if (buffer) {
    blocks.push({
      id: `thinking-${timestamp}-${blocks.length}`,
      timestamp: timestamp + blocks.length,
      text: buffer,
      summary: summarizeThinkingText(buffer),
    });
  }
  return blocks;
}

export function buildThinkingBlocks(input: {
  thinking?: string;
  thinkingParts?: ThinkingPart[];
  timestamp: number;
  boundaryTimestamps?: number[];
}): ThinkingBlock[] {
  const parts = input.thinkingParts?.filter((part) => {
    const text = part.text.trim();
    return text && !isKimixSyntheticThinking(text);
  }) ?? [];
  if (parts.length === 0) {
    return input.thinking && !isKimixSyntheticThinking(input.thinking)
      ? splitLegacyThinking(input.thinking, input.timestamp)
      : [];
  }

  const boundaries = [...new Set(input.boundaryTimestamps ?? [])].sort((a, b) => a - b);
  const groups: { firstPart: ThinkingPart; text: string }[] = [];
  let boundaryIndex = 0;
  let current: { firstPart: ThinkingPart; text: string } | null = null;
  // 增量维护「累计思考文本的归一化视图」（等价于对整体 collapse+trim，见
  // appendCollapsedNormalized）：旧实现对每一段都重新归一化并 KMP 全量累计文本，
  // O(段数 × 总长)——实机 26.5 万字 / 约两千段时单次超 1 秒，是切换会话卡顿的根因。
  let currentNorm = "";
  for (const part of parts) {
    // Official history gives the final think part and its following tool call the
    // same timestamp. Only a later think part starts the next process phase.
    while (boundaryIndex < boundaries.length && part.timestamp > boundaries[boundaryIndex]) {
      if (current) groups.push(current);
      current = null;
      currentNorm = "";
      boundaryIndex += 1;
    }
    if (!current) {
      current = { firstPart: part, text: "" };
      currentNorm = "";
    }
    const partNormRaw = collapseForOverlap(part.text);
    const partNorm = partNormRaw.trim();
    // When adjacent parts share a mid-stream overlap (reconnect replay /
    // resync boundary), concatenating them duplicates the tail of the previous
    // part as the head of the next. Strip the matching prefix from the new
    // part before appending so the joined text stays clean.
    if (current.text) {
      // 重叠长度不可能超过 next 的长度：只取累计文本的尾部窗口做 KMP，结果与
      // 全量扫描完全一致。
      const left = currentNorm.trim();
      const windowSize = Math.max(partNorm.length, THINKING_PART_OVERLAP_MIN_CHARS);
      const leftWindow = left.length > windowSize ? left.slice(-windowSize) : left;
      const overlap = longestSuffixPrefixOverlap(leftWindow, partNorm, THINKING_PART_OVERLAP_MIN_CHARS);
      if (overlap > 0) {
        const trimmed = stripNormalizedPrefix(part.text, overlap);
        // 剥空即整段重复（完整重放），不追加；与 mergeAssistantThinkingText 的
        // 剥空处理对齐，避免 next 全文已是前文后缀时静默产出重复文本。
        if (trimmed.trim()) {
          current.text += trimmed;
          currentNorm = appendCollapsedNormalized(currentNorm, collapseForOverlap(trimmed));
        }
      } else {
        current.text += part.text;
        currentNorm = appendCollapsedNormalized(currentNorm, partNormRaw);
      }
    } else {
      current.text += part.text;
      currentNorm = appendCollapsedNormalized(currentNorm, partNormRaw);
    }
  }
  if (current) groups.push(current);

  return groups
    .map((group, index) => {
      const text = group.text.trim();
      return {
        id: `thinking-${group.firstPart.id}-${index}`,
        timestamp: group.firstPart.timestamp,
        text,
        summary: summarizeThinkingText(text),
      };
    })
    .filter((block) => block.text.length > 0);
}

export const SETTLED_THINKING_FOLD_MAX_LINES = 5;
export const SETTLED_THINKING_FOLD_MAX_CHARS = 200;

/**
 * Fold rule for settled (completed) thinking in kimi-web mode. Official
 * kimi-web folds multi-paragraph blocks to their LAST paragraph. Streamed
 * thinking often lands as one long single-paragraph block (single \n breaks
 * or none); the old paragraph-only predicate then rendered the whole block
 * as a fixed, non-clickable wall. Long blocks fold even without blank-line
 * breaks — the teaser is the last non-empty line — and the full text stays
 * one click away. Exception: when the teaser already covers the whole text
 * (single unbroken long line is the main case), folding would render the
 * same content twice with nothing extra on expand, so the block stays fully
 * visible and is not foldable.
 */
export function resolveSettledThinkingFold(text: string): {
  foldable: boolean;
  teaser: string;
} {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (paragraphs.length > 1) {
    // The teaser is the LAST paragraph; blank-line breaks are trimmed away,
    // so it can never cover the whole text here.
    return { foldable: true, teaser: paragraphs.at(-1) ?? text };
  }
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const foldable =
    lines.length > SETTLED_THINKING_FOLD_MAX_LINES ||
    text.length > SETTLED_THINKING_FOLD_MAX_CHARS;
  const teaser = lines.at(-1) ?? text;
  // A fold is only useful when expanding reveals MORE than the teaser. If
  // the teaser covers the whole text, both states render identical content
  // and the expand affordance is pure noise — keep the block non-foldable.
  if (teaser.trim() === text.trim()) {
    return { foldable: false, teaser };
  }
  return { foldable, teaser };
}
