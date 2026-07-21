/**
 * Manual process-summary expand/collapse intent, keyed by turn identity.
 *
 * The process summary's expanded state lives in component state, but the
 * assistant bubble can legitimately remount mid-turn (the render-only pending
 * placeholder is swapped for the real merged assistant event, or the merged
 * event id falls back to a changing underlying event id). A remount resets
 * both `expanded` and the `manuallyExpanded` ref, after which the
 * final-content auto-collapse fires and the user's manual expansion is lost.
 * Persisting the last manual choice per turn lets a remounted summary restore
 * the user's intent instead of the default.
 */

const PROCESS_MANUAL_EXPAND_LIMIT = 200;

const processManualExpandByTurn = new Map<string, boolean>();

export function processManualExpandTurnKey(parts: {
  sessionId?: string;
  agentTurnId?: string;
  roomMessageId?: string;
  eventId: string;
}): string {
  return [
    parts.sessionId ?? "",
    parts.agentTurnId ?? parts.roomMessageId ?? parts.eventId,
  ].join("");
}

export function noteProcessManualExpand(turnKey: string, expanded: boolean): void {
  // Refresh LRU position, then bound the map.
  processManualExpandByTurn.delete(turnKey);
  processManualExpandByTurn.set(turnKey, expanded);
  while (processManualExpandByTurn.size > PROCESS_MANUAL_EXPAND_LIMIT) {
    const oldest = processManualExpandByTurn.keys().next().value;
    if (oldest === undefined) break;
    processManualExpandByTurn.delete(oldest);
  }
}

export function getProcessManualExpand(turnKey: string): boolean | undefined {
  return processManualExpandByTurn.get(turnKey);
}

/** Test-only: reset module state between cases. */
export function resetProcessManualExpandForTests(): void {
  processManualExpandByTurn.clear();
}
