import type { TuiSemanticEvent } from "@electron/types/ipc";
import type { TimelineEvent } from "@/types/ui";
import { mapStreamEvent, mergeEvents } from "./eventMapper";

export interface TuiSemanticReduceResult {
  events: TimelineEvent[];
  shouldFinish: boolean;
  wasCancelled: boolean;
  hasRunningSemantic: boolean;
}

export function reduceTuiSemanticEvents(
  events: TimelineEvent[],
  semanticEvents: TuiSemanticEvent[],
  options: { now?: number; idFactory?: () => string } = {},
): TuiSemanticReduceResult {
  let nextEvents = events;
  let shouldFinish = false;
  let wasCancelled = false;
  let hasRunningSemantic = false;
  const now = options.now ?? Date.now();
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());

  for (const semanticEvent of semanticEvents) {
    if (semanticEvent.type === "TurnCancel") {
      wasCancelled = true;
      nextEvents = appendTuiInterruptedStatus(
        nextEvents.map((event) => (
          event.type === "assistant_message" && !event.isComplete
            ? { ...event, isComplete: true, isThinking: false, durationMs: event.durationMs ?? Math.max(0, now - event.timestamp) }
            : event
        )),
        now,
        idFactory,
      );
      continue;
    }

    if (semanticEvent.type === "TurnEnd") shouldFinish = true;
    if (semanticEvent.type === "TurnBegin" || semanticEvent.type === "ContentPart" || semanticEvent.type === "ToolCall") {
      hasRunningSemantic = true;
    }

    const mapped = mapStreamEvent(semanticEvent);
    if (mapped) nextEvents = mergeEvents(nextEvents, mapped);
  }

  return { events: nextEvents, shouldFinish, wasCancelled, hasRunningSemantic };
}

export function appendTuiInterruptedStatus(
  events: TimelineEvent[],
  now = Date.now(),
  idFactory: () => string = () => crypto.randomUUID(),
) {
  if (events.some((event) => event.type === "status_update" && event.message === "TUI 已停止生成。")) {
    return events;
  }
  return [
    ...events,
    {
      id: idFactory(),
      type: "status_update" as const,
      timestamp: now,
      message: "TUI 已停止生成。",
    },
  ];
}
