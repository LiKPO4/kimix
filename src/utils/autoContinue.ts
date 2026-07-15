import type { PermissionMode, Session, TimelineEvent } from "@/types/ui";
import { getRoomAgent, getRoomAgentEvents } from "@/utils/collaborationRooms";

export interface AutoContinueCheckInput {
  session: Session;
  roomAgentId?: string;
  appPermissionMode: PermissionMode;
  autoContinuedTurnKeys: ReadonlySet<string>;
}

export interface AutoContinueCheckResult {
  shouldContinue: boolean;
  turnKey: string;
}

/**
 * 检测当前 turn 是否在完成工具/子代理后却没有生成任何助手正文。
 * 用于在自动/完全访问权限下自动发送“继续”，避免用户手动再发一条消息。
 *
 * 触发条件（全部满足）：
 * 1. 权限模式为 auto 或 yolo（manual 模式下不自动推进，保留用户控制）。
 * 2. 不是长程任务会话。
 * 3. 当前 turn 内存在已完成的 tool_call 或 subagent。
 * 4. 当前 turn 内没有仍在运行的 tool_call / subagent。
 * 5. 当前 turn 内没有已产生的 assistant_message 正文或思考。
 * 6. 当前 turn 内没有待审批或待回答的交互事件。
 * 7. 本 turn 没有被自动继续过。
 */
export function checkAutoContinueAfterEmptyTurn(input: AutoContinueCheckInput): AutoContinueCheckResult {
  const { session, roomAgentId, appPermissionMode, autoContinuedTurnKeys } = input;

  const permissionMode: PermissionMode = roomAgentId
    ? getRoomAgent(session, roomAgentId)?.permissionMode ?? session.permissionMode ?? appPermissionMode
    : session.permissionMode ?? appPermissionMode;

  const turnKey = `${session.id}:${roomAgentId ?? "primary"}:last-user-turn`;

  if (permissionMode === "manual") {
    return { shouldContinue: false, turnKey };
  }
  if (session.longTask) {
    return { shouldContinue: false, turnKey };
  }
  if (session.engine && session.engine !== "kimi-code") {
    return { shouldContinue: false, turnKey };
  }
  if (autoContinuedTurnKeys.has(turnKey)) {
    return { shouldContinue: false, turnKey };
  }

  const events = roomAgentId ? getRoomAgentEvents(session, roomAgentId) : session.events;

  // 找到最后一个用户/引导消息作为 turn 起点
  const lastUserIndex = events.findLastIndex(
    (event) => event.type === "user_message" || event.type === "steer_message"
  );
  if (lastUserIndex === -1) {
    return { shouldContinue: false, turnKey };
  }

  const turnEvents = events.slice(lastUserIndex + 1);

  const hasCompletedWork = turnEvents.some((event) => {
    if (event.type === "tool_call") return event.status === "success" || event.status === "error";
    if (event.type === "subagent") return event.status === "completed" || event.status === "error";
    return false;
  });

  const hasRunningWork = turnEvents.some((event) => {
    if (event.type === "tool_call") return event.status === "running";
    if (event.type === "subagent") {
      return event.status === "queued" || event.status === "running" || event.status === "suspended";
    }
    return false;
  });

  const hasAssistantOutput = turnEvents.some((event) => {
    if (event.type !== "assistant_message") return false;
    if (event.content.trim().length > 0) return true;
    if (event.thinking?.trim().length) return true;
    if (event.thinkingParts?.some((part) => part.text.trim().length > 0)) return true;
    return false;
  });

  const hasPendingInteraction = turnEvents.some((event) => {
    if (event.type === "approval_request" || event.type === "question_request") {
      return event.status === "pending";
    }
    return false;
  });

  const shouldContinue =
    hasCompletedWork &&
    !hasRunningWork &&
    !hasAssistantOutput &&
    !hasPendingInteraction;

  return { shouldContinue, turnKey };
}
