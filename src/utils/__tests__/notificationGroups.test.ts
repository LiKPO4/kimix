import { describe, expect, it } from "vitest";
import type { RenderItem } from "@/types/chatRender";
import type { StatusNotificationDetail, TimelineEvent } from "@/types/ui";
import { groupNotificationRenderItems, NOTIFICATION_GROUP_MIN_SIZE } from "@/utils/notificationGroups";

type StatusUpdateEvent = Extract<TimelineEvent, { type: "status_update" }>;

function notificationDetail(overrides: Partial<StatusNotificationDetail> = {}): StatusNotificationDetail {
  return {
    kind: "notification",
    type: "task.completed",
    sourceKind: "background_task",
    sourceId: "bash-1",
    title: "Background process completed",
    severity: "info",
    body: "跑测试 completed.",
    raw: "<notification>...</notification>",
    ...overrides,
  };
}

function notificationItem(id: string, timestamp: number): RenderItem {
  const event: StatusUpdateEvent = {
    id,
    type: "status_update",
    timestamp,
    message: "后台任务已完成：跑测试",
    source: "runtime",
    tone: "success",
    notification: notificationDetail(),
  };
  return { type: "event", event };
}

function userItem(id: string): RenderItem {
  return { type: "event", event: { id, type: "user_message", timestamp: 1, content: "问" } as TimelineEvent };
}

describe("groupNotificationRenderItems", () => {
  it("连续 ≥3 条通知折叠为一个 notification_group，成员顺序保持", () => {
    const items = [
      notificationItem("n1", 1),
      notificationItem("n2", 2),
      notificationItem("n3", 3),
      notificationItem("n4", 4),
    ];
    const grouped = groupNotificationRenderItems(items);
    expect(grouped).toHaveLength(1);
    const group = grouped[0];
    expect(group.type).toBe("notification_group");
    if (group.type !== "notification_group") return;
    expect(group.events.map((event) => event.id)).toEqual(["n1", "n2", "n3", "n4"]);
    expect(group.id).toBe("notification-group:n1:n2:n3:n4");
  });

  it(`${NOTIFICATION_GROUP_MIN_SIZE - 1} 条及以下保持独立事件项（逐条详情卡）`, () => {
    const items = [notificationItem("n1", 1), notificationItem("n2", 2)];
    const grouped = groupNotificationRenderItems(items);
    expect(grouped).toHaveLength(2);
    expect(grouped.every((item) => item.type === "event")).toBe(true);
  });

  it("非通知项打断连续段：两段各自按长度判定", () => {
    const items = [
      notificationItem("n1", 1),
      notificationItem("n2", 2),
      userItem("u1"),
      notificationItem("n3", 3),
      notificationItem("n4", 4),
      notificationItem("n5", 5),
    ];
    const grouped = groupNotificationRenderItems(items);
    expect(grouped.map((item) => item.type)).toEqual(["event", "event", "event", "notification_group"]);
    const group = grouped[3];
    if (group.type !== "notification_group") throw new Error("expect group");
    expect(group.events.map((event) => event.id)).toEqual(["n3", "n4", "n5"]);
  });

  it("普通 status_update（无 notification 字段）不参与分组", () => {
    const plain: RenderItem = {
      type: "event",
      event: { id: "s1", type: "status_update", timestamp: 1, message: "模型：k3", tokenCount: 10 } as StatusUpdateEvent,
    };
    const items = [notificationItem("n1", 1), plain, notificationItem("n2", 2)];
    const grouped = groupNotificationRenderItems(items);
    expect(grouped).toHaveLength(3);
    expect(grouped.every((item) => item.type === "event")).toBe(true);
  });

  it("空输入原样返回", () => {
    expect(groupNotificationRenderItems([])).toEqual([]);
  });
});
