interface TailWindowOptions<T> {
  minItems?: number;
  maxItems?: number;
  minCompletedAssistants?: number;
  isCompletedAssistant: (item: T) => boolean;
}

export function shouldUseInitialChatTail(
  sessionId: string | undefined,
  explicitlyExpandedSessionId: string | null,
): boolean {
  return Boolean(sessionId && explicitlyExpandedSessionId !== sessionId);
}

export function hasExpandableChatHistory(
  hasMoreOlderItems: boolean,
  isInitialTailOnly: boolean,
): boolean {
  return hasMoreOlderItems || isInitialTailOnly;
}

export function selectInitialChatTail<T>(items: T[], options: TailWindowOptions<T>): T[] {
  const minItems = Math.max(1, options.minItems ?? 4);
  const maxItems = Math.max(minItems, options.maxItems ?? 12);
  const minCompletedAssistants = Math.max(0, options.minCompletedAssistants ?? 2);
  let start = Math.max(0, items.length - minItems);
  const earliestStart = Math.max(0, items.length - maxItems);
  let completedAssistants = items.slice(start).filter(options.isCompletedAssistant).length;

  while (start > earliestStart && completedAssistants < minCompletedAssistants) {
    start -= 1;
    if (options.isCompletedAssistant(items[start])) completedAssistants += 1;
  }

  return items.slice(start);
}
