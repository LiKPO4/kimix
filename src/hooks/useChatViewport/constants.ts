export const SESSION_OPEN_BOTTOM_MAX_WAIT_MS = 3_500;
export const USER_SUBMIT_BOTTOM_MAX_WAIT_MS = 6_000;
/** Poll interval while waiting for post-submit layout to settle at bottom.
 *  Was 80ms and never early-exited → ~12.5 scroll/IPC cycles/s for up to 6s. */
export const SESSION_LAYOUT_STABLE_MS = 200;
export const SCROLL_ANCHOR_IDLE_CAPTURE_MS = 140;
export const USER_SCROLL_RESIZE_RESTORE_SUPPRESS_MS = 260;
export const USER_SCROLL_ANCHOR_RESTORE_SUPPRESS_MS = 700;
export const MAX_RESIZE_ANCHOR_RESTORE_PX = 300;
