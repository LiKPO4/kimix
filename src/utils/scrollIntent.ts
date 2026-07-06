export const USER_SCROLL_INTENT_MS = 1_500;

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
