import type { TimelineEvent } from "@/types/ui";

const TITLE_LIMIT = 30;

function cleanTitleText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[[^\]]+]\([^)]*\)/g, " ")
    .replace(/^#+\s*/gm, "")
    .replace(/^[\s>*\-.•\d、.)]+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstMeaningfulLine(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map(cleanTitleText)
    .filter((line) => line.length >= 4);
  return lines[0] ?? cleanTitleText(text);
}

export function truncateSessionTitle(text: string): string {
  const cleaned = firstMeaningfulLine(text);
  if (cleaned.length <= TITLE_LIMIT) return cleaned;
  return `${cleaned.slice(0, TITLE_LIMIT)}...`;
}

export function deriveSessionTitle(events: TimelineEvent[], fallback = "新会话"): string {
  const assistant = events.find((event) =>
    event.type === "assistant_message" &&
    typeof event.content === "string" &&
    event.content.trim().length >= 4
  );
  if (assistant?.type === "assistant_message") {
    const title = truncateSessionTitle(assistant.content);
    if (title) return title;
  }

  return fallback;
}
