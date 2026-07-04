import type { Session, TimelineEvent } from "@/types/ui";
import { getRuntimeSessionId } from "./runtimeSession";

function hasOpenRuntimeWork(session: Session | undefined): boolean {
  return Boolean(session?.events.some((event) => {
    if (event.type === "assistant_message") return !event.isComplete;
    if (event.type === "tool_call") return event.status === "running";
    if (event.type === "subagent") return event.status === "queued" || event.status === "running" || event.status === "suspended";
    return false;
  }));
}

export function shouldAppendRuntimeStatusToTimeline(input: {
  rawType?: string;
  mappedEvent: TimelineEvent;
  session?: Session;
  runtimeSessionId: string;
  runningSessionId: string | null;
}): boolean {
  if (input.mappedEvent.type !== "status_update") return true;
  if (input.rawType !== "agent.status.updated") return true;
  if (!input.session) return true;
  const sessionRuntimeId = getRuntimeSessionId(input.session);
  const isActiveRuntime = Boolean(input.runningSessionId && (
    input.runningSessionId === input.session.id ||
    input.runningSessionId === input.runtimeSessionId ||
    Boolean(sessionRuntimeId && input.runningSessionId === sessionRuntimeId)
  ));
  return isActiveRuntime || hasOpenRuntimeWork(input.session);
}
