/**
 * Module-level user-scroll activity signal shared by the viewport layer and
 * the event-stream flush scheduler. One visible ChatThread at a time.
 */

const USER_SCROLL_ACTIVE_WINDOW_MS = 350;

let lastActivityAt = 0;

export function noteUserScrollActivity(now = Date.now()) {
  lastActivityAt = now;
}

export function isUserScrollActive(now = Date.now()) {
  return lastActivityAt > 0 && now - lastActivityAt < USER_SCROLL_ACTIVE_WINDOW_MS;
}

export function clearUserScrollActivity() {
  lastActivityAt = 0;
}

export function getUserScrollActivityAgeMs(now = Date.now()) {
  if (lastActivityAt <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, now - lastActivityAt);
}

/** Test-only: reset module state between cases. */
export function resetUserScrollActivityForTests() {
  lastActivityAt = 0;
}
