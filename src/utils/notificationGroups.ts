import type { RenderItem } from "@/types/chatRender";
import type { TimelineEvent } from "@/types/ui";

type StatusUpdateEvent = Extract<TimelineEvent, { type: "status_update" }>;

/** 连续多少条通知才聚合成分组卡（官方行为：1-2 条逐条详情卡，≥3 条折叠成「N 条通知」）。 */
export const NOTIFICATION_GROUP_MIN_SIZE = 3;

function isNotificationEventItem(item: RenderItem): item is RenderItem & { type: "event"; event: StatusUpdateEvent } {
  return item.type === "event" && item.event.type === "status_update" && Boolean((item.event as StatusUpdateEvent).notification);
}

/**
 * 渲染项后处理：把连续 ≥3 条的通知 status_update 事件项折叠为一个
 * notification_group 渲染项；1-2 条保持独立项（逐条详情卡）。
 * 纯渲染层聚合，不改事件流；分组 id 由成员事件 id 派生，保证 key 稳定。
 */
export function groupNotificationRenderItems(items: RenderItem[]): RenderItem[] {
  const result: RenderItem[] = [];
  let run: Array<RenderItem & { type: "event"; event: StatusUpdateEvent }> = [];

  const flush = () => {
    if (run.length >= NOTIFICATION_GROUP_MIN_SIZE) {
      result.push({
        type: "notification_group",
        id: `notification-group:${run.map((item) => item.event.id).join(":")}`,
        events: run.map((item) => item.event),
      });
    } else {
      result.push(...run);
    }
    run = [];
  };

  for (const item of items) {
    if (isNotificationEventItem(item)) {
      run.push(item);
    } else {
      flush();
      result.push(item);
    }
  }
  flush();
  return result;
}
