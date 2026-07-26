import type { ThinkingPart } from "@/types/ui";

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
  for (const part of parts) {
    // Official history gives the final think part and its following tool call the
    // same timestamp. Only a later think part starts the next process phase.
    while (boundaryIndex < boundaries.length && part.timestamp > boundaries[boundaryIndex]) {
      if (current) groups.push(current);
      current = null;
      boundaryIndex += 1;
    }
    if (!current) current = { firstPart: part, text: "" };
    current.text += part.text;
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
