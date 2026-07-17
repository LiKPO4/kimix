import type { RenderItem } from "@/types/chatRender";

export type ChatNavigationKind = "user" | "assistant" | "tool" | "change" | "system";

export interface ChatNavigationItem {
  key: string;
  eventId: string;
  kind: ChatNavigationKind;
  label: string;
  title: string;
  preview: string;
  fileLabels: string[];
}

export interface ChatNavigationGeometry {
  key: string;
  bottom: number;
}

export interface ChatNavigationViewportEdges {
  atTop: boolean;
  atBottom: boolean;
}

export interface ChatNavigationMarker extends ChatNavigationItem {
  active: boolean;
}

export const CHAT_NAVIGATION_MARKER_GAP_MIN = 6;
export const CHAT_NAVIGATION_MARKER_GAP_MAX = 14;
export const CHAT_NAVIGATION_PREVIEW_INITIAL_DELAY_MS = 110;
export const CHAT_NAVIGATION_PREVIEW_SWITCH_DELAY_MS = 16;

export function chatNavigationReadingLine(clientHeight: number) {
  return Math.max(0, clientHeight / 2);
}

export function chatNavigationPreviewOpenDelay(hasVisiblePreview: boolean) {
  return hasVisiblePreview
    ? CHAT_NAVIGATION_PREVIEW_SWITCH_DELAY_MS
    : CHAT_NAVIGATION_PREVIEW_INITIAL_DELAY_MS;
}

export interface ChatNavigationPreviewPositionOptions {
  anchorRight: number;
  anchorCenterY: number;
  viewportWidth: number;
  viewportHeight: number;
  previewWidth: number;
  previewHeight: number;
  margin?: number;
  gap?: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function chatNavigationPreviewPosition(options: ChatNavigationPreviewPositionOptions) {
  const margin = options.margin ?? 12;
  const gap = options.gap ?? 12;
  const width = Math.max(0, Math.min(options.previewWidth, options.viewportWidth - margin * 2));
  const left = clamp(
    options.anchorRight + gap,
    margin,
    Math.max(margin, options.viewportWidth - width - margin),
  );
  const top = clamp(
    options.anchorCenterY - options.previewHeight / 2,
    margin,
    Math.max(margin, options.viewportHeight - options.previewHeight - margin),
  );
  return { left, top, width };
}

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

export function compactChatNavigationText(text: string, maxLength = 180) {
  const compact = text
    .slice(0, Math.max(maxLength * 4, maxLength))
    .replace(/\s+/g, " ")
    .trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function uniqueFileLabels(labels: Array<string | undefined>) {
  return Array.from(new Set(labels.filter((label): label is string => Boolean(label?.trim())))).slice(0, 3);
}

function eventNavigationContent(item: Extract<RenderItem, { type: "event" }>) {
  const event = item.event;
  switch (event.type) {
    case "user_message":
    case "steer_message":
      return {
        title: "用户消息",
        preview: compactChatNavigationText(event.content) || (event.images?.length ? `发送了 ${event.images.length} 个附件` : "空消息"),
        fileLabels: uniqueFileLabels(event.images?.map((image) => image.name) ?? []),
      };
    case "assistant_message":
      return {
        title: "Agent 回复",
        preview: compactChatNavigationText(event.content || event.thinking || (event.isComplete ? "暂无正文" : "正在思考…")),
        fileLabels: uniqueFileLabels([
          ...(item.changedFiles ?? []),
          ...(item.changeSummary?.files.map((file) => file.path) ?? []),
        ]),
      };
    case "tool_call":
      return {
        title: event.description || event.display?.description || event.toolName || "工具过程",
        preview: compactChatNavigationText(event.display?.command || event.rawArguments || event.toolName || "正在运行工具"),
        fileLabels: uniqueFileLabels([event.display?.diff?.path]),
      };
    case "approval_request":
      return {
        title: "需要确认",
        preview: compactChatNavigationText(event.description || event.details || event.toolName),
        fileLabels: uniqueFileLabels([event.display?.path, ...(item.approvalDiffs?.map((diff) => diff.path) ?? [])]),
      };
    case "question_request":
      return {
        title: "需要回答",
        preview: compactChatNavigationText(event.questions[0]?.question || "Agent 正在等待回答"),
        fileLabels: [],
      };
    case "file_artifact":
      return { title: "生成文件", preview: event.filePath, fileLabels: [event.filePath] };
    case "change_summary":
      return {
        title: `文件变更 ${event.files.length} 项`,
        preview: compactChatNavigationText(event.files.map((file) => file.path).join("、")),
        fileLabels: uniqueFileLabels(event.files.map((file) => file.path)),
      };
    case "diff":
      return { title: "文件变更", preview: event.filePath, fileLabels: [event.filePath] };
    case "session_recommendation":
      return { title: "会话建议", preview: "当前会话较长，建议创建新会话继续工作。", fileLabels: [] };
    case "subagent":
      return {
        title: event.agentName || "子代理",
        preview: compactChatNavigationText(event.resultSummary || event.description || event.error || `状态：${event.status}`),
        fileLabels: [],
      };
    case "compaction":
      return {
        title: "上下文压缩",
        preview: compactChatNavigationText(event.summary || (event.phase === "begin" ? "正在压缩上下文…" : "上下文压缩完成")),
        fileLabels: [],
      };
    case "error":
      return { title: "运行错误", preview: compactChatNavigationText(event.message), fileLabels: [] };
    default:
      return { title: chatNavigationLabel(chatNavigationKind(item)), preview: "会话过程节点", fileLabels: [] };
  }
}

function renderItemNavigationContent(item: RenderItem) {
  if (item.type === "event") return eventNavigationContent(item);
  if (item.type === "tool_group") {
    return {
      title: `工具过程 ${item.tools.length} 项`,
      preview: compactChatNavigationText(item.tools
        .slice(0, 3)
        .map((tool) => tool.description || tool.display?.description || tool.toolName)
        .filter(Boolean)
        .join("、") || "运行了一组工具"),
      fileLabels: uniqueFileLabels(item.tools.map((tool) => tool.display?.diff?.path)),
    };
  }
  if (item.type === "change_group") {
    return {
      title: `文件变更 ${item.changes.length} 项`,
      preview: compactChatNavigationText(item.changes.map((change) => change.path).join("、") || "文件发生变更"),
      fileLabels: uniqueFileLabels(item.changes.map((change) => change.path)),
    };
  }
  return {
    title: "待确认的 Plan",
    preview: compactChatNavigationText(item.path),
    fileLabels: uniqueFileLabels([item.path]),
  };
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
    const content = renderItemNavigationContent(item);
    return [{
      key: item.type === "event" ? item.event.id : item.id,
      eventId: chatNavigationTargetId(item),
      kind,
      label: chatNavigationLabel(kind),
      ...content,
    }];
  });
}

export function buildChatNavigationMarkers(
  items: ChatNavigationItem[],
  geometry: ChatNavigationGeometry[],
  readingLine: number,
  edges?: ChatNavigationViewportEdges,
): ChatNavigationMarker[] {
  const geometryByKey = new Map(geometry.map((entry) => [entry.key, entry]));
  const activeGeometry = edges?.atTop && !edges.atBottom
    ? geometry[0]
    : edges?.atBottom && !edges.atTop
      ? geometry.at(-1)
      : geometry.find((entry) => entry.bottom >= readingLine) ?? geometry.at(-1);
  const renderedItems = items.filter((item) => geometryByKey.has(item.key));

  return renderedItems.map((item) => {
    return {
      ...item,
      active: item.key === activeGeometry?.key,
    };
  });
}

export function chatNavigationMarkerGap(markerCount: number, availableHeight: number) {
  if (markerCount <= 0) return CHAT_NAVIGATION_MARKER_GAP_MAX;
  return Math.min(
    CHAT_NAVIGATION_MARKER_GAP_MAX,
    Math.max(CHAT_NAVIGATION_MARKER_GAP_MIN, availableHeight / markerCount),
  );
}

export function chatNavigationGroupHeight(markerCount: number, markerGap = CHAT_NAVIGATION_MARKER_GAP_MAX) {
  return Math.max(0, markerCount) * markerGap;
}
