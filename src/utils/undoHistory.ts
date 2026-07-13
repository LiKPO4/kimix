import type { TimelineEvent } from "@/types/ui";
import { preserveLocalUserMediaInCanonicalHistory } from "./eventMapper";

/** Official undo is authoritative even when its history is shorter or empty. */
export function applyCanonicalUndoHistory(
  localEvents: TimelineEvent[],
  canonicalEvents: TimelineEvent[],
): TimelineEvent[] {
  return preserveLocalUserMediaInCanonicalHistory(localEvents, canonicalEvents);
}
