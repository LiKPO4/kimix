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
  // 用户滚到自然内容底部（补偿空间内）→ 释放。
  if (scrollTop <= naturalMaximumScrollTop + 0.01) return true;
  // 用户滚到补偿撑出的滚动容器视觉底部 → 释放并贴自然底。旧实现只认自然
  // 范围：用户滚到视觉底部时 scrollTop = 自然最大 + 补偿 > 自然最大，补偿
  // 永不释放，尾部空白残留且滚不掉（完成后自动折叠的典型残留路径）。
  const compensatedMaximumScrollTop = Math.max(
    0,
    naturalScrollHeight + tailCompensation - clientHeight,
  );
  return scrollTop >= compensatedMaximumScrollTop - 0.01;
}
