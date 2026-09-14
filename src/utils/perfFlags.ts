/** localStorage performance feature flags (default ON unless set to "0"). */

export const STREAMING_PLAIN_MARKDOWN_KEY = "kimix_streaming_plain_markdown";
export const STREAMING_RICH_MARKDOWN_KEY = "kimix_streaming_rich_markdown";
export const SCROLL_YIELD_KEY = "kimix_scroll_yield";
export const ACTIVE_TURN_DRAFT_KEY = "kimix_active_turn_draft";
export const PERF_DIAG_KEY = "kimix_perf_diag";

function readEnabledFlag(key: string, defaultEnabled = true): boolean {
  try {
    const value = localStorage.getItem(key);
    if (value === null) return defaultEnabled;
    return value !== "0";
  } catch {
    return defaultEnabled;
  }
}

export function isStreamingPlainMarkdownEnabled() {
  return readEnabledFlag(STREAMING_PLAIN_MARKDOWN_KEY, true);
}

export function isStreamingRichMarkdownEnabled() {
  return readEnabledFlag(STREAMING_RICH_MARKDOWN_KEY, true);
}

/**
 * Rich block-memoized rendering is the default streaming path (official-like,
 * interval-throttled). The plain-text fallback applies only when the user
 * explicitly opts in (plain="1") or explicitly disables rich (rich="0").
 */
export function shouldUsePlainStreamingMarkdown() {
  try {
    if (localStorage.getItem(STREAMING_RICH_MARKDOWN_KEY) === "0") return true;
    return localStorage.getItem(STREAMING_PLAIN_MARKDOWN_KEY) === "1";
  } catch {
    return false;
  }
}

export function isScrollYieldEnabled() {
  return readEnabledFlag(SCROLL_YIELD_KEY, true);
}

export function isActiveTurnDraftEnabled() {
  return readEnabledFlag(ACTIVE_TURN_DRAFT_KEY, true);
}

let perfDiagRuntimeOverride: boolean | null = null;

/** 日志录制期间强制开启性能桶；null 表示恢复用户设置。 */
export function setPerfDiagRuntimeOverride(enabled: boolean | null) {
  perfDiagRuntimeOverride = enabled;
}

export function isPerfDiagEnabled() {
  if (perfDiagRuntimeOverride !== null) return perfDiagRuntimeOverride;
  return readEnabledFlag(PERF_DIAG_KEY, false);
}
