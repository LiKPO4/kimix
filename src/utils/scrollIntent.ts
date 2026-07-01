export const USER_SCROLL_INTENT_MS = 1_500;

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
