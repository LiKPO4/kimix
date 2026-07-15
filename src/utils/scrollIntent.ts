export const USER_SCROLL_INTENT_MS = 1_500;
export const BOTTOM_FOLLOW_THRESHOLD_PX = 32;

export function distanceFromBottom({
  scrollHeight,
  scrollTop,
  clientHeight,
}: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}) {
  return Math.max(0, scrollHeight - scrollTop - clientHeight);
}

export function bottomScrollTop({ scrollHeight, clientHeight }: { scrollHeight: number; clientHeight: number }) {
  return Math.max(0, scrollHeight - clientHeight);
}

export function shouldResumeAutoFollowAtBottom({
  distance,
  autoFollow,
  userScroll,
  bottomIntentUntil,
  suppressUntil = 0,
  now,
  threshold = BOTTOM_FOLLOW_THRESHOLD_PX,
}: {
  distance: number;
  autoFollow: boolean;
  userScroll: boolean;
  bottomIntentUntil: number;
  suppressUntil?: number;
  now: number;
  threshold?: number;
}) {
  if (now < suppressUntil) return false;
  if (distance > threshold) return false;
  if (autoFollow && !userScroll) return true;
  return bottomIntentUntil >= now;
}

export function scrollTopPreservingBottomDistance({
  previousScrollHeight,
  previousScrollTop,
  previousClientHeight,
  nextScrollHeight,
  nextClientHeight,
}: {
  previousScrollHeight: number;
  previousScrollTop: number;
  previousClientHeight: number;
  nextScrollHeight: number;
  nextClientHeight: number;
}) {
  const bottomDistance = Math.max(0, previousScrollHeight - previousScrollTop - previousClientHeight);
  return Math.max(0, Math.min(
    nextScrollHeight - nextClientHeight,
    nextScrollHeight - nextClientHeight - bottomDistance,
  ));
}

export function shouldPauseAutoFollowForScroll({
  previousScrollTop,
  currentScrollTop,
  autoFollow,
  intentUntil,
  now,
}: {
  previousScrollTop: number | null;
  currentScrollTop: number;
  autoFollow: boolean;
  intentUntil: number;
  now: number;
}) {
  return autoFollow &&
    previousScrollTop !== null &&
    currentScrollTop < previousScrollTop - 0.5 &&
    now <= intentUntil;
}
