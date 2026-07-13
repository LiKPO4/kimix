import type { RoomAgent, Session } from "@/types/ui";

const ROOM_MENTION_PATTERN = /(^|[\s([{（【])@([\p{L}\p{N}._-]{1,32})(?=$|[\s,，.。!！?？;；:：)\]}）】])/gu;

export interface ResolvedRoomPromptRoute {
  recipientAgentIds: string[];
  outboundContent: string;
  source: "mention" | "default";
  matchedMentionNames: string[];
}

function availableRoomAgents(session: Session): RoomAgent[] {
  return session.collaboration?.agents.filter((agent) => !agent.removedAt && !agent.archivedAt) ?? [];
}

function normalizeRecipientIds(agents: readonly RoomAgent[], ids: readonly string[]) {
  const available = new Set(agents.map((agent) => agent.id));
  return Array.from(new Set(ids.filter((id) => available.has(id))));
}

function stripMentionRanges(content: string, ranges: Array<{ start: number; end: number }>) {
  let next = content;
  for (const range of [...ranges].sort((left, right) => right.start - left.start)) {
    next = next.slice(0, range.start) + next.slice(range.end);
  }
  return next
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,，.。!！?？;；:：])/g, "$1")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function resolveRoomPromptRoute(
  session: Session,
  content: string,
  fallbackRecipientIds?: readonly string[],
): ResolvedRoomPromptRoute {
  if (!session.collaboration) throw new Error("当前会话不是多 Agent 房间");
  const agents = availableRoomAgents(session);
  const byMention = new Map(agents.map((agent) => [agent.mentionName.toLocaleLowerCase(), agent]));
  const mentionedAgentIds: string[] = [];
  const matchedMentionNames: string[] = [];
  const ranges: Array<{ start: number; end: number }> = [];
  for (const match of content.matchAll(ROOM_MENTION_PATTERN)) {
    const rawName = match[2];
    const agent = byMention.get(rawName.toLocaleLowerCase());
    if (!agent || match.index === undefined) continue;
    if (!mentionedAgentIds.includes(agent.id)) {
      mentionedAgentIds.push(agent.id);
      matchedMentionNames.push(agent.mentionName);
    }
    const prefixLength = match[1].length;
    ranges.push({
      start: match.index + prefixLength,
      end: match.index + prefixLength + rawName.length + 1,
    });
  }
  const defaults = fallbackRecipientIds
    ?? session.collaboration.defaultRecipientIds
    ?? [session.collaboration.primaryAgentId];
  const recipientAgentIds = mentionedAgentIds.length > 0
    ? mentionedAgentIds
    : normalizeRecipientIds(agents, defaults);
  if (recipientAgentIds.length === 0) throw new Error("至少选择一个可用 Agent");
  return {
    recipientAgentIds,
    outboundContent: mentionedAgentIds.length > 0 ? stripMentionRanges(content, ranges) : content,
    source: mentionedAgentIds.length > 0 ? "mention" : "default",
    matchedMentionNames,
  };
}
