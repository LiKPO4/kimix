import type { TimelineEvent } from "@/types/ui";
import { reliableAssistantDurationMs } from "./duration";

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
  return events.flatMap((event) => {
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
      content: `/skill:${activation.name}${activation.args ? ` ${activation.args}` : ""}`,
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

export function settleInactiveEvents(events: TimelineEvent[]): TimelineEvent[] {
  const settledAt = Date.now();
  const settled = events.flatMap((event) => {
    if (event.type === "subagent") {
      return event.status === "running" ? [{ ...event, status: "completed" as const }] : [event];
    }
    if (event.type !== "assistant_message" || event.isComplete) return [event];
    const hasContent = event.content.trim().length > 0;
    const hasThinking = Boolean(
      event.thinking?.trim() ||
      event.thinkingParts?.some((part) => part.text.trim().length > 0)
    );
    if (!hasContent && !hasThinking) return [];
    return [{ ...event, isComplete: true, isThinking: false, durationMs: reliableAssistantDurationMs(event.durationMs) }];
  });
  return closeOpenCompaction(settled);
}

export function closeOpenCompaction(events: TimelineEvent[]): TimelineEvent[] {
  const lastCompaction = [...events].reverse().find((event) => event.type === "compaction");
  if (!lastCompaction || lastCompaction.type !== "compaction" || lastCompaction.phase !== "begin") {
    return events;
  }
  return [
    ...events,
    {
      id: Math.random().toString(36).substring(2, 11),
      type: "compaction",
      timestamp: Date.now(),
      phase: "end",
    },
  ];
}
