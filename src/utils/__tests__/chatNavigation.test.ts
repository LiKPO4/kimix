import { describe, expect, it } from "vitest";
import type { RenderItem } from "@/types/chatRender";
import type { TimelineEvent } from "@/types/ui";
import {
  buildChatNavigationItems,
  buildChatNavigationMarkers,
  chatNavigationGroupHeight,
  chatNavigationMarkerGap,
  chatNavigationPreviewPosition,
  chatNavigationPreviewOpenDelay,
  chatNavigationReadingLine,
  CHAT_NAVIGATION_PREVIEW_INITIAL_DELAY_MS,
  CHAT_NAVIGATION_PREVIEW_SWITCH_DELAY_MS,
  compactChatNavigationText,
  CHAT_NAVIGATION_MARKER_GAP_MAX,
  CHAT_NAVIGATION_MARKER_GAP_MIN,
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
    expect(items[0]).toMatchObject({ title: "用户消息", preview: "你好", fileLabels: [] });
    expect(items[1]).toMatchObject({ title: "Agent 回复", preview: "回答", fileLabels: [] });
    expect(items[2]).toMatchObject({ title: "工具过程 1 项" });
    expect(items[3]).toMatchObject({ title: "文件变更 0 项" });
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

  it("keeps the marker gap within a compact min/max range", () => {
    expect(CHAT_NAVIGATION_MARKER_GAP_MAX).toBe(14);
    expect(CHAT_NAVIGATION_MARKER_GAP_MIN).toBe(6);
    expect(chatNavigationMarkerGap(20, 400)).toBe(14);
    expect(chatNavigationMarkerGap(40, 400)).toBe(10);
    expect(chatNavigationMarkerGap(100, 400)).toBe(6);
    expect(chatNavigationMarkerGap(0, 0)).toBe(14);
    expect(chatNavigationGroupHeight(0)).toBe(0);
    expect(chatNavigationGroupHeight(3)).toBe(42);
    expect(chatNavigationGroupHeight(40, 10)).toBe(400);
  });

  it("builds bounded plain-text previews without scanning unbounded content", () => {
    expect(compactChatNavigationText("  第一行\n\n第二行  ")).toBe("第一行 第二行");
    expect(compactChatNavigationText("a".repeat(300), 12)).toBe("aaaaaaaaaaa…");
  });

  it("clamps the preview inside the viewport near right and bottom edges", () => {
    expect(chatNavigationPreviewPosition({
      anchorRight: 790,
      anchorCenterY: 590,
      viewportWidth: 800,
      viewportHeight: 600,
      previewWidth: 340,
      previewHeight: 180,
    })).toEqual({ left: 448, top: 408, width: 340 });
  });

  it("opens cautiously once, then follows adjacent markers within one frame", () => {
    expect(chatNavigationPreviewOpenDelay(false)).toBe(CHAT_NAVIGATION_PREVIEW_INITIAL_DELAY_MS);
    expect(chatNavigationPreviewOpenDelay(true)).toBe(CHAT_NAVIGATION_PREVIEW_SWITCH_DELAY_MS);
    expect(CHAT_NAVIGATION_PREVIEW_INITIAL_DELAY_MS).toBe(110);
    expect(CHAT_NAVIGATION_PREVIEW_SWITCH_DELAY_MS).toBe(16);
  });

  it("uses the viewport center for the active marker and click alignment", () => {
    expect(chatNavigationReadingLine(0)).toBe(0);
    expect(chatNavigationReadingLine(600)).toBe(300);
  });

  it("pins the first and last marker at the physical scroll edges", () => {
    const items = buildChatNavigationItems([
      eventItem({ id: "user-1", type: "user_message", timestamp: 1, content: "第一条" }),
      eventItem({ id: "assistant-1", type: "assistant_message", timestamp: 2, content: "中间", isThinking: false, isComplete: true }),
      eventItem({ id: "user-2", type: "user_message", timestamp: 3, content: "最后一条" }),
    ]);
    const geometry = [
      { key: "user-1", bottom: 80 },
      { key: "assistant-1", bottom: 320 },
      { key: "user-2", bottom: 560 },
    ];

    expect(buildChatNavigationMarkers(items, geometry, 300, { atTop: true, atBottom: false })
      .find((marker) => marker.active)?.key).toBe("user-1");
    expect(buildChatNavigationMarkers(items, geometry, 300, { atTop: false, atBottom: true })
      .find((marker) => marker.active)?.key).toBe("user-2");
  });
});
