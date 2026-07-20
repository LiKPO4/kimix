import { useRef } from "react";
import type { Session, TimelineEvent } from "@/types/ui";
import { projectCollaborationTimeline } from "@/utils/collaborationTimeline";

type ProjectionInputs = {
  agentEvents: Session["collaboration"] extends infer C
    ? C extends { agentEvents: infer A } ? A : undefined
    : undefined;
  messages: Session["collaboration"] extends infer C
    ? C extends { messages: infer M } ? M : undefined
    : undefined;
  events: TimelineEvent[] | undefined;
  result: TimelineEvent[];
};

/**
 * A5: only re-run collaboration projection when the actual timeline inputs change
 * by reference (agentEvents / messages / events). Metadata-only session updates
 * (updatedAt, title, …) reuse the previous projected array.
 */
export function useProjectedTimeline(session: Session | null | undefined): TimelineEvent[] {
  const cacheRef = useRef<ProjectionInputs | null>(null);
  if (!session) {
    cacheRef.current = null;
    return [];
  }

  const agentEvents = session.collaboration?.agentEvents;
  const messages = session.collaboration?.messages;
  const events = session.events;
  const cached = cacheRef.current;
  if (
    cached &&
    cached.agentEvents === agentEvents &&
    cached.messages === messages &&
    cached.events === events
  ) {
    return cached.result;
  }

  const result = projectCollaborationTimeline(session);
  cacheRef.current = { agentEvents, messages, events, result };
  return result;
}
