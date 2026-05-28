import { useMemo } from "react";
import { collectSessionDiffs } from "@/utils/diff";
import type { SessionDiffEntry } from "@/utils/diff";
import type { TimelineEvent } from "@/types/ui";

/**
 * Computes structured diff entries from a session's events.
 * Memoized so downstream components only re-render when diffs actually change.
 */
export function useSessionDiffs(events: TimelineEvent[] | undefined): SessionDiffEntry[] {
  return useMemo(() => collectSessionDiffs(events ?? []), [events]);
}
