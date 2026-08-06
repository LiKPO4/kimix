export const LIVE_THINKING_LINE_HEIGHT_PX = 24;
export const LIVE_THINKING_MAX_LINES = 5;
export const LIVE_THINKING_MAX_HEIGHT_PX = LIVE_THINKING_LINE_HEIGHT_PX * LIVE_THINKING_MAX_LINES;

type ScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

const SCROLL_EDGE_EPSILON_PX = 1;
// Official kimi-web behavior: follow the live viewport only while the user is
// within 24px of the bottom; scrolling further up hands control back to them.
const LIVE_THINKING_FOLLOW_THRESHOLD_PX = 24;

export function canLiveThinkingViewportConsumeWheel(
  { scrollTop, scrollHeight, clientHeight }: ScrollMetrics,
  deltaY: number,
) {
  if (deltaY < 0) return scrollTop > SCROLL_EDGE_EPSILON_PX;
  if (deltaY > 0) {
    return scrollTop + clientHeight < scrollHeight - SCROLL_EDGE_EPSILON_PX;
  }
  return false;
}

export function shouldFollowLiveThinkingViewport({
  scrollTop,
  scrollHeight,
  clientHeight,
}: ScrollMetrics) {
  return scrollHeight - scrollTop - clientHeight <= LIVE_THINKING_FOLLOW_THRESHOLD_PX;
}

export function shouldUseLiveThinkingViewport({
  groupIndex,
  groupCount,
  isThinkingGroup,
  isActiveAssistant,
  preserveDuringFinalTransition = false,
}: {
  groupIndex: number;
  groupCount: number;
  isThinkingGroup: boolean;
  isActiveAssistant: boolean;
  hasFinalContent: boolean;
  preserveDuringFinalTransition?: boolean;
}) {
  // Only the TRAILING (still-growing) thinking phase keeps the bounded
  // five-line live viewport. Once a text/tool/subagent/approval block follows
  // a phase, that phase is finished and must settle into the foldable teaser
  // (official kimi-web behavior); keeping every phase in a live scroll box
  // leaves permanent scrollbars on completed reasoning.
  return (preserveDuringFinalTransition || isActiveAssistant) && isThinkingGroup && groupIndex === groupCount - 1;
}

export function shouldSubscribeActiveTurnDraft({
  enabled,
  isActiveAssistant,
  sessionId,
  turnId,
}: {
  enabled: boolean;
  isActiveAssistant: boolean;
  sessionId?: string;
  turnId?: string;
}) {
  // Server v2 may mark an intermediate Assistant step complete while the
  // session keeps running. Completion belongs to the step, not the active
  // draft subscription; only runtime activity controls that subscription.
  return enabled && isActiveAssistant && Boolean(sessionId && turnId);
}

/**
 * React group key shared by the appended live thinking block and the formal
 * thinking group produced when the same draft segment later commits. Must stay
 * in sync with turnBlocks' `thinking:${event.id}` and the draft segment id
 * (`active-draft:${draftKey}:${materializationId}`) so the live→formal swap
 * reuses the same DOM node instead of unmounting it (completion flicker).
 */
export function resolveLiveThinkingBlockKey(
  draftKey: string | null,
  materializationId?: string,
): string | undefined {
  if (!draftKey || !materializationId) return undefined;
  return `thinking:active-draft:${draftKey}:${materializationId}`;
}

/** Text-block counterpart of resolveLiveThinkingBlockKey (turnBlocks' text:<event.id>). */
export function resolveLiveTextBlockKey(
  draftKey: string | null,
  materializationId?: string,
): string | undefined {
  if (!draftKey || !materializationId) return undefined;
  return `text:active-draft:${draftKey}:${materializationId}`;
}

export function shouldCollapseKimiWebProcessOnFinalContent({
  previousHasFinalContent,
  hasFinalContent,
  isKimiWeb,
  expanded,
  manuallyExpanded,
}: {
  previousHasFinalContent: boolean;
  hasFinalContent: boolean;
  isKimiWeb: boolean;
  expanded: boolean;
  manuallyExpanded: boolean;
}) {
  return isKimiWeb && expanded && !manuallyExpanded && !previousHasFinalContent && hasFinalContent;
}

/**
 * 判定一轮是否有「最终内容」（触发 Kimi Web 过程自动折叠的唯一条件）。
 * 必须是「轮次完成且有正文」——运行中任何流式内容（思考、预告段）都不算，
 * 否则第一个字到达就会误触发自动折叠，使「未勾选运行中折叠时全程展开」失效。
 */
export function resolveHasFinalProcessContent(
  isComplete: boolean,
  hasBodyContent: boolean,
  isActiveAssistant = false,
): boolean {
  return isComplete && !isActiveAssistant && hasBodyContent;
}
