import { describe, expect, it } from "vitest";
import type { RenderItem } from "@/types/chatRender";
import type { TimelineEvent } from "@/types/ui";
import {
  buildChatNavigationItems,
  buildChatNavigationMarkers,
  chatNavigationGroupHeight,
  CHAT_NAVIGATION_MARKER_GAP,
} from "../chatNavigation";

function eventItem(event: Record<string, unknown>): RenderItem {
  return { type: "event", event: event as unknown as TimelineEvent };
}

describe("chat navigation", () => {
  it("derives semantic kinds and stable focus ids from render items", () => {
    const items = buildChatNavigationItems([
      eventItem({ id: "user-1", type: "user_message", timestamp: 1, content: "你好" }),
      eventItem({ id: "assistant-1", type: "assistant_message", timestamp: 2, content: "回答", isThinking: false, isComplete: true }),
      { type: "tool_group", id: "tools-1", tools: [{ id: "tool-1" } as never] },
      { type: "change_group", id: "changes-1", changes: [] },
    ]);

    expect(items.map(({ key, eventId, kind }) => ({ key, eventId, kind }))).toEqual([
      { key: "user-1", eventId: "user-1", kind: "user" },
      { key: "assistant-1", eventId: "assistant-1", kind: "assistant" },
      { key: "tools-1", eventId: "tool-1", kind: "tool" },
      { key: "changes-1", eventId: "changes-1", kind: "change" },
    ]);
  });

  it("omits high-frequency or non-rendering events from the rail", () => {
    const items = buildChatNavigationItems([
      eventItem({ id: "status-1", type: "status_update", timestamp: 1, message: "处理中" }),
      eventItem({ id: "hook-1", type: "hook", timestamp: 2, phase: "resolved", eventName: "test", target: "test" }),
      eventItem({ id: "user-1", type: "user_message", timestamp: 3, content: "保留" }),
    ]);

    expect(items.map((item) => item.key)).toEqual(["user-1"]);
  });

  it("spaces markers evenly while selecting the reading-line item", () => {
    const items = buildChatNavigationItems([
      eventItem({ id: "user-1", type: "user_message", timestamp: 1, content: "你好" }),
      eventItem({ id: "assistant-1", type: "assistant_message", timestamp: 2, content: "回答", isThinking: false, isComplete: true }),
    ]);
    const markers = buildChatNavigationMarkers(items, [
      { key: "user-1", bottom: 80 },
      { key: "assistant-1", bottom: 520 },
    ], 120);

    expect(markers.map(({ key, active }) => ({ key, active }))).toEqual([
      { key: "user-1", active: false },
      { key: "assistant-1", active: true },
    ]);
  });

  it("uses a fixed marker gap instead of stretching to the viewport height", () => {
    expect(CHAT_NAVIGATION_MARKER_GAP).toBe(14);
    expect(chatNavigationGroupHeight(0)).toBe(0);
    expect(chatNavigationGroupHeight(3)).toBe(42);
  });
});
