import { projectCollaborationTimeline } from "@/utils/collaborationTimeline";
import { hasMultipleRoomAgents } from "@/utils/collaborationRooms";
import type { Session, TimelineEvent } from "@/types/ui";

/**
 * 单 Agent 残留态会话一次性降级为普通会话（方案 A）。
 *
 * 背景：会话曾开启多 Agent 房间，之后 Agent 被全部移出，只剩 primary。
 * 此时 collaboration 仍存在，但 `hasMultipleRoomAgents` 为 false，发送入口
 * 会改走普通发送路径；而普通路径只写 session.events，回流时
 * `replaceRoomAgentEvents` 又用 agentEvents[primary] 整体替换 session.events，
 * 导致 userEvent 被覆盖丢失。降级后下游全部走纯普通逻辑。
 *
 * 行为分支：
 * 1. session.collaboration 不存在 → 返回原引用，调用方无需更新；
 * 2. 仍有多个房间 Agent → 返回原引用，不做降级；
 * 3. 单 Agent 残留态 → 用 collaboration.messages + agentEvents 投影出完整
 *    时间线（含未认领段，unclaimed 中带 removedAt/archivedAt Agent 的事件
 *    有意保留），移除未完成的空投递占位事件，清除 collaboration /
 *    unsupportedCollaboration 字段并刷新 updatedAt，返回新对象。
 */
export function degradeSingleAgentRoomSession(session: Session, now = Date.now()): Session {
  if (!session.collaboration) return session;
  if (hasMultipleRoomAgents(session)) return session;

  const projected = projectCollaborationTimeline(session);
  const filtered = projected.filter((event: TimelineEvent) => !(
    event.type === "assistant_message" &&
    event.roomDeliveryStatus !== undefined &&
    !event.isComplete &&
    !event.content.trim()
  ));

  return {
    ...session,
    events: filtered,
    collaboration: undefined,
    unsupportedCollaboration: undefined,
    updatedAt: now,
  };
}
