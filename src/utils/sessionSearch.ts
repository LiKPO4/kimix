import type { RoomAgent, Session, TimelineEvent } from "@/types/ui";
import { getRoomAgentEvents } from "@/utils/collaborationRooms";

export type LocalSessionSearchMatch = {
  session: Session;
  kind: string;
  text: string;
  timestamp: number;
  eventId?: string;
  searchText?: string;
  roomAgentId?: string;
  agentName?: string;
  modelLabel?: string;
  roomAgentCount?: number;
};

function eventText(event: TimelineEvent): { kind: string; text: string }[] {
  if (event.type === "user_message") return [{ kind: "用户消息", text: event.content }];
  if (event.type === "steer_message") return [{ kind: "引导消息", text: event.content }];
  if (event.type === "assistant_message") {
    return [
      { kind: "回复", text: event.content },
      { kind: "思考", text: event.thinking ?? "" },
    ];
  }
  if (event.type === "tool_call") return [{ kind: "工具", text: `${event.toolName} ${event.rawArguments ?? JSON.stringify(event.arguments)}` }];
  if (event.type === "status_update") return [{ kind: "状态", text: event.message ?? "" }];
  if (event.type === "error") return [{ kind: "错误", text: event.message }];
  if (event.type === "todo") return [{ kind: "Todo", text: event.items.map((item) => item.content).join("\n") }];
  if (event.type === "diff") return [{ kind: "变更", text: `${event.filePath}\n${event.oldText}\n${event.newText}` }];
  return [];
}

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function agentModelLabel(agent: RoomAgent) {
  return agent.modelLabelSnapshot?.trim() || agent.modelAlias?.trim() || "模型未知";
}

export function buildLocalSessionSearchMatches(
  sessions: readonly Session[],
  query: string,
  limit = 24,
): LocalSessionSearchMatch[] {
  const normalizedQuery = query.trim();
  const q = normalizedQuery.toLowerCase();
  const all: LocalSessionSearchMatch[] = [];
  for (const session of sessions) {
    const roomAgentCount = session.collaboration?.agents.filter((agent) => !agent.removedAt).length;
    if (!q) {
      all.push({ session, kind: "最近对话", text: session.title, timestamp: session.updatedAt, roomAgentCount });
      continue;
    }
    if (session.title.toLowerCase().includes(q)) {
      all.push({ session, kind: "标题", text: session.title, timestamp: session.updatedAt, roomAgentCount });
    }
    const sources = session.collaboration
      ? session.collaboration.agents.map((agent) => ({ agent, events: getRoomAgentEvents(session, agent.id) }))
      : [{ agent: undefined, events: session.events }];
    for (const source of sources) {
      for (const event of source.events) {
        for (const item of eventText(event)) {
          const text = compact(item.text);
          if (!text || !text.toLowerCase().includes(q)) continue;
          all.push({
            session,
            kind: item.kind,
            text,
            timestamp: event.timestamp,
            eventId: event.id,
            searchText: normalizedQuery,
            roomAgentId: source.agent?.id,
            agentName: source.agent?.displayName,
            modelLabel: source.agent ? agentModelLabel(source.agent) : session.model ?? undefined,
            roomAgentCount,
          });
        }
      }
    }
  }
  return all.slice(0, limit);
}
