export const DEFAULT_THINKING_TRANSLATION_INTERVAL_MS = 2500;
export const MAX_THINKING_TRANSLATION_CHUNK_CHARS = 4000;

export type ThinkingTranslationChunk = {
  sourceText: string;
  sourceEnd: number;
  protectedText: string;
  placeholders: string[];
};

const CODE_PLACEHOLDER_PREFIX = "\uE000KIMIX_CODE_";
const CODE_PLACEHOLDER_SUFFIX = "\uE001";

function lastSafeBoundary(text: string): number {
  let last = 0;
  const boundary = /(?:\r?\n+|[.!?。！？]+["'”’）)\]]*\s+)/gu;
  for (const match of text.matchAll(boundary)) {
    last = (match.index ?? 0) + match[0].length;
  }
  return last;
}

function boundedChunkEnd(text: string, limit: number): number {
  if (text.length <= limit) return text.length;
  const candidate = text.slice(0, limit);
  const safe = Math.max(
    candidate.lastIndexOf("\n"),
    candidate.lastIndexOf(" "),
    candidate.lastIndexOf("。") + 1,
    candidate.lastIndexOf(".") + 1,
  );
  return safe >= Math.floor(limit * 0.6) ? safe : limit;
}

export function protectThinkingCode(text: string): { protectedText: string; placeholders: string[] } {
  const placeholders: string[] = [];
  const replace = (value: string) => {
    const index = placeholders.push(value) - 1;
    return `${CODE_PLACEHOLDER_PREFIX}${index}${CODE_PLACEHOLDER_SUFFIX}`;
  };
  const protectedText = text
    .replace(/```[\s\S]*?```/gu, replace)
    .replace(/`[^`\r\n]+`/gu, replace);
  return { protectedText, placeholders };
}

export function restoreThinkingCode(text: string, placeholders: readonly string[]): string {
  let restored = text;
  placeholders.forEach((value, index) => {
    const token = `${CODE_PLACEHOLDER_PREFIX}${index}${CODE_PLACEHOLDER_SUFFIX}`;
    if (restored.split(token).length !== 2) {
      throw new Error("翻译服务未完整保留代码占位符。");
    }
    restored = restored.split(token).join(value);
  });
  return restored;
}

export function isMostlyChineseThinking(text: string): boolean {
  const prose = text
    .replace(/```[\s\S]*?```/gu, "")
    .replace(/`[^`\r\n]+`/gu, "");
  const han = prose.match(/\p{Script=Han}/gu)?.length ?? 0;
  const latin = prose.match(/[A-Za-z]/gu)?.length ?? 0;
  return han >= 8 && han >= latin * 0.8;
}

export function buildThinkingTranslationChunk(
  source: string,
  sourceOffset: number,
  final: boolean,
  maxChars = MAX_THINKING_TRANSLATION_CHUNK_CHARS,
): ThinkingTranslationChunk | null {
  const safeOffset = Math.max(0, Math.min(source.length, sourceOffset));
  const remaining = source.slice(safeOffset);
  if (!remaining.trim()) return null;

  const boundedEnd = boundedChunkEnd(remaining, maxChars);
  const bounded = remaining.slice(0, boundedEnd);
  const relativeEnd = final || boundedEnd < remaining.length
    ? boundedEnd
    : lastSafeBoundary(bounded);
  if (relativeEnd <= 0) return null;

  const sourceText = remaining.slice(0, relativeEnd);
  const { protectedText, placeholders } = protectThinkingCode(sourceText);
  return {
    sourceText,
    sourceEnd: safeOffset + relativeEnd,
    protectedText,
    placeholders,
  };
}

export function thinkingTranslationJoinSeparator(sourceChunk: string): "\n" | " " {
  return /\r?\n+\s*$/u.test(sourceChunk) ? "\n" : " ";
}

export function joinThinkingTranslations(previous: string, next: string, separator = "\n"): string {
  const left = previous.trimEnd();
  const right = next.trimStart();
  if (!left) return right;
  if (!right) return left;
  return `${left}${separator}${right}`;
}
