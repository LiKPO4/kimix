import type { TimelineEvent } from "@/types/ui";
import { reliableAssistantDurationMs } from "./duration";
import { STALE_TIMELINE_WORK_MS } from "./sessionActivity";

export function isLegacyKimiWorkDirError(message: string) {
  return /unknown option\s+['"]?--work-dir['"]?/i.test(message);
}

export function parseKimiSkillActivation(content: string): { name: string; args: string; trigger: string } | null {
  const marker = content.match(/<kimi-skill-loaded\b([^>]*)>/i);
  if (!marker) return null;
  const readAttribute = (name: string) => marker[1].match(new RegExp(`\\b${name}="([^"]*)"`, "i"))?.[1] ?? "";
  const skillName = readAttribute("name").trim();
  if (!skillName) return null;
  return {
    name: skillName,
    args: readAttribute("args").trim(),
    trigger: readAttribute("trigger").trim().toLowerCase(),
  };
}

const BUILTIN_SKILL_COMMAND_NAMES = new Set(["custom-theme", "import-from-cc-codex", "mcp-config"]);

export function formatKimiSkillActivationCommand(name: string, args = "") {
  const normalizedName = name.trim();
  const command = BUILTIN_SKILL_COMMAND_NAMES.has(normalizedName.toLowerCase())
    ? `/${normalizedName}`
    : `/skill:${normalizedName}`;
  return `${command}${args.trim() ? ` ${args.trim()}` : ""}`;
}

export function sanitizeKimiSkillActivationTitle(title: string) {
  const match = title.match(/^User activated the skill\s+["“]([^"”]+)["”]/i);
  return match ? `使用 ${match[1]}` : title;
}

function hasUnclosedStrongEmphasisLine(content: string) {
  let insideFence = false;
  for (const line of content.split(/\r?\n/)) {
    const fenceCount = line.match(/```/g)?.length ?? 0;
    const visibleLine = insideFence ? "" : line.replace(/```[\s\S]*$/, "");
    if (visibleLine) {
      const asteriskPairs = visibleLine.match(/\*\*/g)?.length ?? 0;
      const underscorePairs = visibleLine.match(/__/g)?.length ?? 0;
      if (asteriskPairs % 2 === 1 || underscorePairs % 2 === 1) return true;
    }
    if (fenceCount % 2 === 1) insideFence = !insideFence;
  }
  return false;
}

export function hasMalformedAssistantMarkdown(events: TimelineEvent[]) {
  return events.some((event) => (
    event.type === "assistant_message" && hasUnclosedStrongEmphasisLine(event.content)
  ));
}

export function sanitizePersistedEvents(events: TimelineEvent[]): TimelineEvent[] {
  return events.flatMap<TimelineEvent>((event) => {
    if (event.type === "error" && isLegacyKimiWorkDirError(event.message)) return [];
    if (event.type !== "user_message") return [event];
    const activation = parseKimiSkillActivation(event.content);
    if (!activation) return [event];
    if (activation.trigger === "model-tool") {
      return [{
        id: event.id,
        type: "status_update" as const,
        timestamp: event.timestamp,
        message: `已调用 Skill：${activation.name}`,
        source: "skill",
        tone: "info" as const,
      }];
    }
    return [{
      ...event,
      content: formatKimiSkillActivationCommand(activation.name, activation.args),
    }];
  });
}

export function latestAssistantContent(events: TimelineEvent[]) {
  return [...events].reverse().find((event): event is Extract<TimelineEvent, { type: "assistant_message" }> => (
    event.type === "assistant_message" && event.content.trim().length > 0
  ))?.content.trim() ?? "";
}

export function latestAssistantVisibleOrThinkingContent(events: TimelineEvent[]) {
  const content = latestAssistantContent(events);
  if (content) return content;
  const assistant = [...settleInactiveEvents(events)].reverse().find((event): event is Extract<TimelineEvent, { type: "assistant_message" }> => (
    event.type === "assistant_message" &&
    (Boolean(event.thinking?.trim()) || Boolean(event.thinkingParts?.some((part) => part.text.trim().length > 0)))
  ));
  if (!assistant) return "";
  const parts = assistant.thinkingParts?.map((part) => part.text).join("").trim();
  return parts || assistant.thinking?.trim() || "";
}

function isEmptyAssistantEvent(event: Extract<TimelineEvent, { type: "assistant_message" }>) {
  return !event.content.trim() &&
    !event.thinking?.trim() &&
    !event.thinkingParts?.some((part) => part.text.trim());
}

function isLocalSendStatus(event: Extract<TimelineEvent, { type: "status_update" }>) {
  const message = event.message?.trim() ?? "";
  return event.source === "ipc" ||
    /消息(?:发送中|处理中|处理失败|发送失败)/.test(message);
}

function isRealTurnOutput(event: TimelineEvent) {
  return event.type === "tool_call" ||
    event.type === "tool_result" ||
    event.type === "subagent" ||
    event.type === "hook" ||
    event.type === "approval_request" ||
    event.type === "question_request" ||
    event.type === "change_summary" ||
    event.type === "diff" ||
    event.type === "file_artifact" ||
    event.type === "session_recommendation" ||
    event.type === "todo" ||
    event.type === "compaction";
}

export function hasLocalFailedSendAttempt(events: TimelineEvent[], userEventId: string): boolean {
  const userIndex = events.findIndex((event) => event.type === "user_message" && event.id === userEventId);
  if (userIndex === -1) return false;

  let sawLocalSendMarker = false;
  for (let index = userIndex + 1; index < events.length; index += 1) {
    const event = events[index];
    if (event.type === "user_message" || event.type === "steer_message") break;
    if (event.type === "status_update") {
      if (event.parentEventId === userEventId || (!event.parentEventId && isLocalSendStatus(event))) {
        sawLocalSendMarker = true;
      }
      continue;
    }
    if (event.type === "assistant_message") {
      if (isEmptyAssistantEvent(event)) continue;
      return false;
    }
    if (event.type === "error") return true;
    if (isRealTurnOutput(event)) return false;
  }
  return sawLocalSendMarker;
}

export function hasLocalOrphanUserSendAttempt(events: TimelineEvent[], userEventId: string): boolean {
  const userIndex = events.findIndex((event) => event.type === "user_message" && event.id === userEventId);
  if (userIndex === -1) return false;

  for (let index = userIndex + 1; index < events.length; index += 1) {
    const event = events[index];
    if (event.type === "user_message" || event.type === "steer_message") return false;
    if (event.type === "status_update") continue;
    if (event.type === "assistant_message") {
      if (isEmptyAssistantEvent(event)) continue;
      return false;
    }
    if (event.type === "error") return true;
    if (isRealTurnOutput(event)) return false;
  }
  return true;
}

export function isLatestUserInputEvent(events: TimelineEvent[], userEventId: string): boolean {
  const latestUserInput = events.findLast((event) => event.type === "user_message" || event.type === "steer_message");
  return latestUserInput?.type === "user_message" && latestUserInput.id === userEventId;
}

export function hasOfficialTurnEvidenceAfterUser(events: TimelineEvent[], userEventId: string): boolean {
  const userIndex = events.findIndex((event) => event.type === "user_message" && event.id === userEventId);
  if (userIndex === -1) return false;
  for (let index = userIndex + 1; index < events.length; index += 1) {
    const event = events[index];
    if (event.type === "user_message" || event.type === "steer_message") break;
    if (event.type === "assistant_message") {
      if (!isEmptyAssistantEvent(event)) return true;
      continue;
    }
    if (event.type === "error") {
      if (event.source === "sdk") return true;
      continue;
    }
    if (event.type === "status_update") {
      if (event.source === "runtime") return true;
      continue;
    }
    if (isRealTurnOutput(event)) return true;
  }
  return false;
}

export function truncateLatestUserTurn(events: TimelineEvent[], userEventId: string): TimelineEvent[] {
  if (!isLatestUserInputEvent(events, userEventId)) return events;
  const userIndex = events.findIndex((event) => event.type === "user_message" && event.id === userEventId);
  if (userIndex === -1) return events;
  return events.slice(0, userIndex);
}

export function removeLocalUserSendAttempt(events: TimelineEvent[], userEventId: string): TimelineEvent[] {
  const userIndex = events.findIndex((event) => event.type === "user_message" && event.id === userEventId);
  if (userIndex === -1) return events;

  const removeIds = new Set<string>([userEventId]);
  for (let index = userIndex + 1; index < events.length; index += 1) {
    const event = events[index];
    if (event.type === "user_message" || event.type === "steer_message") break;
    if (event.type === "status_update") {
      if (event.parentEventId === userEventId || (!event.parentEventId && isLocalSendStatus(event))) {
        removeIds.add(event.id);
        continue;
      }
      continue;
    }
    if (event.type === "assistant_message") {
      if (isEmptyAssistantEvent(event)) {
        removeIds.add(event.id);
        continue;
      }
      break;
    }
    if (event.type === "error") {
      removeIds.add(event.id);
      continue;
    }
    if (isRealTurnOutput(event)) {
      break;
    }
  }
  return events.filter((event) => !removeIds.has(event.id));
}

/**
 * Whether the latest user turn (events after the last user_message) has
 * received any displayable Assistant body, thinking, tool, subagent, or error
 * event. Used by the terminal-status polling path to detect a premature
 * terminal report: 0.27 Server may report idle/completed before the assistant
 * body streams. A turn that never received body must not be settled, or the
 * empty optimistic placeholder is deleted and the message header disappears
 * leaving only a status bubble. status_update events (e.g. "Context: X%")
 * do not count as body.
 */
export function hasTurnReceivedBody(events: TimelineEvent[]): boolean {
  const latestUserIndex = events.findLastIndex((event) => event.type === "user_message");
  if (latestUserIndex < 0) return false;
  return events.slice(latestUserIndex + 1).some((event) => (
    (event.type === "assistant_message" && (
      event.content.trim() ||
      Boolean(event.thinking?.trim()) ||
      Boolean(event.thinkingParts?.some((part) => part.text.trim()))
    )) ||
    event.type === "tool_call" ||
    event.type === "tool_result" ||
    event.type === "subagent" ||
    event.type === "error"
  ));
}

function isStaleRunningEvent(event: TimelineEvent, settledAt: number) {
  return settledAt - event.timestamp > STALE_TIMELINE_WORK_MS;
}

/**
 * Guarded settle for non-authoritative paths (status polling, one-shot
 * hydration queries, persistence). A transient terminal report must not
 * force-complete a turn that is still producing events: when any event in the
 * timeline is younger than the stale-work window, open assistants stay open
 * and empty placeholders are preserved. Once the whole timeline has been
 * silent past the window, guarded mode settles exactly like the immediate
 * path. Authoritative completions (prompt.completed status events) keep the
 * immediate behavior.
 */
export function settleInactiveEvents(events: TimelineEvent[], settledAt = Date.now(), preserveEmptyAssistant = false, guardRecentActivity = false): TimelineEvent[] {
  const hasRecentActivity = guardRecentActivity && events.some((event) => (
    settledAt - event.timestamp <= STALE_TIMELINE_WORK_MS
  ));
  const settled = events.flatMap<TimelineEvent>((event) => {
    if (event.type === "subagent") {
      if (event.status === "running" && isStaleRunningEvent(event, settledAt)) {
        return [{ ...event, status: "completed" as const }];
      }
      return [event];
    }
    if (event.type === "tool_call") {
      if (event.status === "running" && isStaleRunningEvent(event, settledAt)) {
        return [{
          ...event,
          status: "error" as const,
          result: event.result ?? "工具执行已中断，未收到完成结果。",
          durationMs: undefined,
        }];
      }
      return [event];
    }
    if (event.type !== "assistant_message" || event.isComplete) return [event];
    const hasContent = event.content.trim().length > 0;
    const hasThinking = Boolean(
      event.thinking?.trim() ||
      event.thinkingParts?.some((part) => part.text.trim().length > 0)
    );
    if (!hasContent && !hasThinking) {
      // A turn that never received body may be a premature terminal report
      // (0.27 Server can report idle before the body streams). When
      // preserveEmptyAssistant is set, keep the placeholder as isComplete=false
      // so the message header stays visible and the turn is not settled; the
      // real body can still arrive and fill it. Without this flag the empty
      // placeholder is deleted (genuinely failed/orphaned turns). Guarded
      // settles never delete placeholders while the timeline is still active.
      return (preserveEmptyAssistant || hasRecentActivity) ? [event] : [];
    }
    if (hasRecentActivity) return [event];
    return [{ ...event, isComplete: true, isThinking: false, durationMs: reliableAssistantDurationMs(event.durationMs) }];
  });
  return closeOpenCompaction(settled);
}

export function settleFailedEvents(
  events: TimelineEvent[],
  message = "当前轮执行失败。",
  settledAt = Date.now(),
): TimelineEvent[] {
  const settled = events.flatMap<TimelineEvent>((event) => {
    if (event.type === "subagent" && ["queued", "running", "suspended"].includes(event.status)) {
      return [{ ...event, status: "error" as const, error: event.error ?? message }];
    }
    if (event.type === "tool_call" && event.status === "running") {
      return [{
        ...event,
        status: "error" as const,
        result: event.result ?? message,
        durationMs: Math.max(0, settledAt - event.timestamp),
      }];
    }
    if (event.type !== "assistant_message" || event.isComplete) return [event];
    const hasContent = event.content.trim().length > 0;
    const hasThinking = Boolean(
      event.thinking?.trim() ||
      event.thinkingParts?.some((part) => part.text.trim().length > 0)
    );
    if (!hasContent && !hasThinking) return [];
    return [{
      ...event,
      isThinking: false,
      isComplete: true,
      durationMs: reliableAssistantDurationMs(event.durationMs ?? Math.max(0, settledAt - event.timestamp)),
    }];
  });
  return closeOpenCompaction(settled);
}

export function findUnmatchedCompactionBeginIndex(events: TimelineEvent[]): number {
  let endCount = 0;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== "compaction") continue;
    if (event.phase === "end") {
      endCount += 1;
    } else if (event.phase === "begin") {
      if (endCount === 0) return index;
      endCount -= 1;
    }
  }
  return -1;
}

export function closeOpenCompaction(events: TimelineEvent[]): TimelineEvent[] {
  const beginIndex = findUnmatchedCompactionBeginIndex(events);
  if (beginIndex === -1) return events;
  const endEvent: TimelineEvent = {
    id: Math.random().toString(36).substring(2, 11),
    type: "compaction",
    timestamp: Date.now(),
    phase: "end",
  };
  return [...events.slice(0, beginIndex + 1), endEvent, ...events.slice(beginIndex + 1)];
}
