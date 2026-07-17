export const LIVE_THINKING_LINE_HEIGHT_PX = 24;
export const LIVE_THINKING_MAX_LINES = 6;
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
  groupIndex,
  groupCount,
  isThinkingGroup,
  isActiveAssistant,
  hasFinalContent,
  preserveDuringFinalTransition = false,
}: {
  groupIndex: number;
  groupCount: number;
  isThinkingGroup: boolean;
  isActiveAssistant: boolean;
  hasFinalContent: boolean;
  preserveDuringFinalTransition?: boolean;
}) {
  return (preserveDuringFinalTransition || (isActiveAssistant && !hasFinalContent)) &&
    isThinkingGroup &&
    groupIndex === groupCount - 1;
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
