import { describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Session, TimelineEvent } from "@/types/ui";
import { createCollaborationStateFromSession } from "@/utils/collaborationRooms";
import { useProjectedTimeline } from "../useProjectedTimeline";

function renderHook<T, P>(callback: (props: P) => T, options: { initialProps: P }) {
  const result = { current: null as T };
  let props = options.initialProps;
  function Wrapper() {
    result.current = callback(props);
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(Wrapper));
  });
  return {
    result,
    rerender(nextProps?: P) {
      if (arguments.length > 0) props = nextProps as P;
      act(() => {
        root.render(React.createElement(Wrapper));
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe("useProjectedTimeline", () => {
  it("reuses the previous projection when only session metadata changes (A5)", () => {
    const base = {
      id: "room-1",
      engine: "kimi-code" as const,
      runtimeSessionId: "runtime-a",
      officialSessionId: "official-a",
      title: "Room",
      projectPath: "D:/WORKS/test",
      createdAt: 1,
      updatedAt: 1,
      events: [] as TimelineEvent[],
      isLoading: false,
    };
    const collaboration = createCollaborationStateFromSession(base);
    const primary = collaboration.agents[0];
    const session: Session = {
      ...base,
      collaboration: {
        ...collaboration,
        messages: [{
          id: "message-1",
          content: "Hi",
          recipientAgentIds: [primary.id],
          deliveries: {
            [primary.id]: { status: "completed", agentTurnId: "turn-a", officialUserEventId: "user-a" },
          },
          timestamp: 10,
        }],
        agentEvents: {
          [primary.id]: [
            { id: "user-a", type: "user_message", timestamp: 10, content: "Hi" },
            { id: "assistant-a", type: "assistant_message", timestamp: 11, content: "Hello", isThinking: false, isComplete: true },
          ],
        },
      },
    };

    const { result, rerender, unmount } = renderHook(
      (current: Session) => useProjectedTimeline(current),
      { initialProps: session },
    );
    const first = result.current;

    rerender({
      ...session,
      title: "Renamed",
      updatedAt: session.updatedAt + 1,
      isLoading: true,
    });
    expect(result.current).toBe(first);

    const nextEvents = [
      ...session.collaboration!.agentEvents[primary.id],
      { id: "assistant-b", type: "assistant_message" as const, timestamp: 12, content: "More", isThinking: false, isComplete: true },
    ];
    rerender({
      ...session,
      collaboration: {
        ...session.collaboration!,
        agentEvents: { [primary.id]: nextEvents },
      },
    });
    expect(result.current).not.toBe(first);
    expect(result.current.map((event) => event.id)).toContain("assistant-b");
    unmount();
  });
});
