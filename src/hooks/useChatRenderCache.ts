import { useRef } from "react";
import type { CompletedTurnRenderCacheEntry } from "@/types/chatRender";

/**
 * Stable cache for completed turn render items.
 *
 * Rebuilding render items during streaming invalidates the active turn, but
 * completed turns should keep the same object identity so React can reuse their
 * DOM. This ref-backed cache is scoped to the current session and cleared when
 * the session changes.
 */
export function useChatRenderCache(sessionId: string | undefined) {
  const cacheRef = useRef(new Map<string, CompletedTurnRenderCacheEntry>());
  const cacheSessionIdRef = useRef<string | undefined>(undefined);

  // Synchronous session change detection: clear the cache before the render
  // that consumes it, matching the previous inline behavior in ChatThread.
  if (cacheSessionIdRef.current !== sessionId) {
    cacheRef.current.clear();
    cacheSessionIdRef.current = sessionId;
  }

  return cacheRef;
}
