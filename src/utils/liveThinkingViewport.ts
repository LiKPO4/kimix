export const LIVE_THINKING_LINE_HEIGHT_PX = 24;
export const LIVE_THINKING_MAX_LINES = 5;
export const LIVE_THINKING_MAX_HEIGHT_PX = LIVE_THINKING_LINE_HEIGHT_PX * LIVE_THINKING_MAX_LINES;

type ScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

const SCROLL_EDGE_EPSILON_PX = 1;
const LIVE_THINKING_FOLLOW_THRESHOLD_PX = 12;

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
  // Every reasoning phase in the running turn keeps a bounded five-line
  // viewport. A text/tool block may follow the latest thinking phase before
  // the turn completes; tying this to "last group" or "no body yet" would
  // expand that reasoning back into the outer chat and stop its live scroll.
  return (preserveDuringFinalTransition || isActiveAssistant) && isThinkingGroup;
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
