import type { TimelineEvent } from "@/types/ui";
import { mergeEvents, preserveLocalUserMediaInCanonicalHistory } from "./eventMapper";

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function snapshotText(rawEvent: Record<string, unknown>): string {
  return isString(rawEvent.snapshotMessageText) ? normalizeText(rawEvent.snapshotMessageText) : "";
}

function hasPendingLocalPromptPlaceholder(events: readonly TimelineEvent[]): boolean {
  const assistantIndex = events.findLastIndex((event) => event.type === "assistant_message" && !event.isComplete);
  if (assistantIndex === -1) return false;
  const assistant = events[assistantIndex];
  if (assistant.type !== "assistant_message" || assistant.content.trim() || assistant.thinking?.trim()) return false;
  const linkedStatus = events.slice(0, assistantIndex).findLast((event) => (
    event.type === "status_update" && event.source === "ipc" && Boolean(event.parentEventId)
  ));
  if (linkedStatus?.type !== "status_update" || !linkedStatus.parentEventId) return false;
  return events.slice(0, assistantIndex).some((event) => (
    event.type === "user_message" && event.id === linkedStatus.parentEventId
  ));
}

export function shouldSkipKimiCodeSnapshotReplay(
  rawEvent: Record<string, unknown> | null,
  events: readonly TimelineEvent[] = [],
  runtimeActive = false,
): boolean {
  if (rawEvent?.snapshotReplay !== "history") return false;
  const rawType = isString(rawEvent.type) ? rawEvent.type : "";
  if (
    (rawType === "turn.ended" || rawType === "TurnEnd") &&
    (runtimeActive || hasPendingLocalPromptPlaceholder(events))
  ) {
    return true;
  }
  const text = snapshotText(rawEvent);
  if (!text) return false;

  if (rawEvent.snapshotRole === "tool") {
    const toolCallId = isString(rawEvent.toolCallId) ? rawEvent.toolCallId : "";
    return events.some((event) => {
      if (event.type !== "tool_result") return false;
      if (toolCallId && event.toolCallId !== toolCallId) return false;
      return normalizeText(String(event.result ?? "")).includes(text);
    });
  }

  return events.some((event) => {
    if (event.type !== "assistant_message") return false;
    const content = normalizeText([event.thinking, event.content].filter(isString).join("\n"));
    return content.includes(text);
  });
}

/**
 * Running history is an additive progress sample. Merge it into the live
 * timeline so mounted rows keep their local identities and interaction state.
 */
export function reconcileRunningKimiSnapshot(
  localEvents: TimelineEvent[],
  canonicalEvents: TimelineEvent[],
): TimelineEvent[] {
  const snapshotEvents = preserveLocalUserMediaInCanonicalHistory(localEvents, canonicalEvents);
  // Kimi Code 0.24+（agent-core-v2）会把进行中轮次已提交的内容作为 isComplete: true 的
  // 助手带回快照。只要本地还有未完成助手，当前轮次（最后一条用户消息之后）的 canonical
  // 助手一律按未完成合并：完成态只能由真实 turn 结束事件授予，否则活助手会被反复提前
  // 关闭（“输出完成”假象、过程折叠、后续工具期彻底没有消息头）。
  const lastLocalUserTs = localEvents.reduce((max, event) => (
    event.type === "user_message" ? Math.max(max, event.timestamp) : max
  ), 0);
  const hasOpenLocalAssistant = localEvents.some((event) => event.type === "assistant_message" && !event.isComplete);
  return snapshotEvents.reduce((events, rawEvent) => {
    const event = hasOpenLocalAssistant &&
      rawEvent.type === "assistant_message" && rawEvent.isComplete && rawEvent.timestamp >= lastLocalUserTs
      ? { ...rawEvent, isComplete: false as const }
      : rawEvent;
    const alreadyMounted = events.some((local) => {
      if (local.type !== event.type) return false;
      if (local.type === "user_message" && event.type === "user_message") {
        // Snapshot user ids are deterministic (snapshot:<messageId>:user:<n>),
        // so an identical id is a hard duplicate. A local optimistic send and
        // its official snapshot echo share content within seconds. Without
        // this branch every replay re-appended the full user history — after a
        // few restarts the duplicated users flooded the render window and
        // pushed every assistant reply out of view.
        if (local.id === event.id) return true;
        const localText = normalizeText(local.content ?? "");
        const eventText = normalizeText(event.content ?? "");
        return eventText.length > 0 && localText === eventText &&
          Math.abs(local.timestamp - event.timestamp) <= 10_000;
      }
      if (local.type === "assistant_message" && event.type === "assistant_message") {
        if (local.isComplete === event.isComplete &&
          local.content === event.content &&
          (local.thinking ?? "") === (event.thinking ?? "")) return true;
        // A locally complete assistant that already contains the canonical body
        // (e.g. a streamed opening followed by the same summary) must not let
        // the replay re-append the clean copy elsewhere.
        if (local.isComplete && event.isComplete && event.content.trim().length > 0 &&
          local.content.includes(event.content)) return true;
        // 内容已被本地覆盖的 canonical 助手（同文不同完成态）同样视为已挂载，跳过合并。
        if (!local.isComplete) {
          const localText = normalizeText([local.thinking ?? "", local.content].filter(Boolean).join("\n"));
          const eventText = normalizeText([event.thinking ?? "", event.content].filter(Boolean).join("\n"));
          if (eventText.length > 0 && localText.includes(eventText)) return true;
        }
        return false;
      }
      if (local.type === "tool_call" && event.type === "tool_call") {
        return Boolean(local.toolCallId) && local.toolCallId === event.toolCallId && local.status === event.status;
      }
      return false;
    });
    // Older-turn assistants must never go through mergeEvents: its streaming
    // merge would append them into the current turn's open placeholder,
    // polluting it with unrelated older content. They are appended as
    // independent history entries instead.
    if (!alreadyMounted && event.type === "assistant_message" && event.timestamp < lastLocalUserTs) {
      return [...events, event];
    }
    return alreadyMounted ? events : mergeEvents(events, event);
  }, [...localEvents]);
}
