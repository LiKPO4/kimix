export const CHAT_PROCESS_COLLAPSE_VIEWPORT_EVENT = "kimix:process-collapse-viewport";

export type ChatProcessCollapseViewportDetail = {
  phase: "before" | "after";
  transactionId: string;
  sessionId: string;
  eventId: string;
  agentTurnId?: string;
  roomAgentId?: string;
  summaryAnchor?: HTMLElement | null;
  contentAnchor?: HTMLElement | null;
  collapsingNode?: HTMLElement | null;
};

export function isProcessCollapseAnchorUnstable({
  anchor,
  scrollNode,
  streamNode,
  collapsingNode,
}: {
  anchor: HTMLElement | null;
  scrollNode: HTMLElement;
  streamNode: HTMLElement | null;
  collapsingNode: HTMLElement | null;
}) {
  return !anchor ||
    anchor === scrollNode ||
    anchor === streamNode ||
    Boolean(collapsingNode && (
      collapsingNode.contains(anchor) ||
      anchor.contains(collapsingNode)
    ));
}

export function requiredViewportTailCompensation({
  minimumScrollHeight,
  naturalScrollHeight,
}: {
  minimumScrollHeight: number;
  naturalScrollHeight: number;
}) {
  return Math.max(0, minimumScrollHeight - naturalScrollHeight);
}

export function planDetachedViewportRestore({
  previousScrollTop,
  previousAnchorViewportTop,
  currentScrollTop,
  currentAnchorViewportTop,
  naturalScrollHeight,
  clientHeight,
}: {
  previousScrollTop: number;
  previousAnchorViewportTop?: number;
  currentScrollTop: number;
  currentAnchorViewportTop?: number;
  naturalScrollHeight: number;
  clientHeight: number;
}) {
  const hasStableAnchor = Number.isFinite(previousAnchorViewportTop) && Number.isFinite(currentAnchorViewportTop);
  const targetScrollTop = Math.max(0, hasStableAnchor
    ? currentScrollTop + currentAnchorViewportTop! - previousAnchorViewportTop!
    : previousScrollTop);
  const minimumScrollHeight = targetScrollTop + Math.max(0, clientHeight);

  return {
    targetScrollTop,
    minimumScrollHeight,
    tailCompensation: requiredViewportTailCompensation({
      minimumScrollHeight,
      naturalScrollHeight,
    }),
  };
}

export function isViewportAnchorGenerationCurrent({
  capturedGeneration,
  currentGeneration,
}: {
  capturedGeneration: number;
  currentGeneration: number;
}) {
  return capturedGeneration === currentGeneration;
}

export function canReleaseViewportTailCompensation({
  tailCompensation,
  scrollTop,
  naturalScrollHeight,
  clientHeight,
}: {
  tailCompensation: number;
  scrollTop: number;
  naturalScrollHeight: number;
  clientHeight: number;
}) {
  if (tailCompensation <= 0) return false;
  const naturalMaximumScrollTop = Math.max(0, naturalScrollHeight - clientHeight);
  return scrollTop <= naturalMaximumScrollTop + 0.01;
}
