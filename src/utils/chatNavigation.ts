import type { RenderItem } from "@/types/chatRender";

export type ChatNavigationKind = "user" | "assistant" | "tool" | "change" | "system";

export interface ChatNavigationItem {
  key: string;
  eventId: string;
  kind: ChatNavigationKind;
  label: string;
}

export interface ChatNavigationGeometry {
  key: string;
  bottom: number;
}

export interface ChatNavigationMarker extends ChatNavigationItem {
  active: boolean;
}

export const CHAT_NAVIGATION_MARKER_GAP = 14;

export function chatNavigationTargetId(item: RenderItem): string {
  if (item.type === "event") return item.event.id;
  if (item.type === "tool_group") return item.tools[0]?.id ?? item.id;
  return item.id;
}

export function chatNavigationContainsEventId(item: RenderItem, eventId: string | null) {
  if (!eventId) return false;
  if (item.type === "event") return item.event.id === eventId;
  if (item.type === "tool_group") return item.tools.some((tool) => tool.id === eventId);
  return item.id === eventId;
}

function chatNavigationKind(item: RenderItem): ChatNavigationKind {
  if (item.type === "tool_group") return "tool";
  if (item.type === "change_group") return "change";
  if (item.type === "plan_preview") return "system";

  switch (item.event.type) {
    case "user_message":
    case "steer_message":
      return "user";
    case "assistant_message":
      return "assistant";
    case "tool_call":
      return "tool";
    case "file_artifact":
    case "change_summary":
    case "diff":
      return "change";
    default:
      return "system";
  }
}

function chatNavigationLabel(kind: ChatNavigationKind) {
  switch (kind) {
    case "user":
      return "用户消息";
    case "assistant":
      return "助手回复";
    case "tool":
      return "工具过程";
    case "change":
      return "文件变更";
    case "system":
      return "会话节点";
  }
}

export function buildChatNavigationItems(items: RenderItem[]): ChatNavigationItem[] {
  return items.flatMap((item) => {
    if (item.type === "event" && (
      item.event.type === "tool_result" ||
      item.event.type === "status_update" ||
      item.event.type === "todo" ||
      item.event.type === "hook"
    )) return [];
    const kind = chatNavigationKind(item);
    return [{
      key: item.type === "event" ? item.event.id : item.id,
      eventId: chatNavigationTargetId(item),
      kind,
      label: chatNavigationLabel(kind),
    }];
  });
}

export function buildChatNavigationMarkers(
  items: ChatNavigationItem[],
  geometry: ChatNavigationGeometry[],
  readingLine: number,
): ChatNavigationMarker[] {
  const geometryByKey = new Map(geometry.map((entry) => [entry.key, entry]));
  const activeGeometry = geometry.find((entry) => entry.bottom >= readingLine) ?? geometry.at(-1);
  const renderedItems = items.filter((item) => geometryByKey.has(item.key));

  return renderedItems.map((item) => {
    return {
      ...item,
      active: item.key === activeGeometry?.key,
    };
  });
}

export function chatNavigationGroupHeight(markerCount: number) {
  return Math.max(0, markerCount) * CHAT_NAVIGATION_MARKER_GAP;
}
