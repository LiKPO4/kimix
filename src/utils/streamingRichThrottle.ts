/**
 * Cadence gate for the rich streaming markdown path. The block-memoized
 * renderer already avoids re-rendering finished blocks; the remaining cost is
 * the whole-content lex/normalize pass and the growing tail block. Advancing
 * the visible content at a bounded interval (and pausing while the user
 * scrolls) keeps that work at a few Hz instead of per-token.
 */
export const STREAMING_RICH_INTERVAL_MS = 300;
export const STREAMING_RICH_SCROLL_RECHECK_MS = 150;

/**
 * Milliseconds until the next visible-content advance.
 * - scrollActive: do not advance while the user is scrolling; re-check soon.
 * - otherwise: the remaining slice of the interval, 0 when overdue.
 */
export function nextStreamingRichTickDelay({
  now,
  lastTickAt,
  scrollActive,
  intervalMs = STREAMING_RICH_INTERVAL_MS,
}: {
  now: number;
  lastTickAt: number;
  scrollActive: boolean;
  intervalMs?: number;
}): number {
  if (scrollActive) return STREAMING_RICH_SCROLL_RECHECK_MS;
  return Math.max(0, intervalMs - (now - lastTickAt));
}
