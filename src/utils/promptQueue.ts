export interface OfficialPromptQueueState {
  supported: boolean;
  activeId: string | null;
  activeStatus: string | null;
  queuedIds: string[];
}

// 官方 active prompt 处于终态时不再拦截本地派发：0.33 实测活跃项为 running，
// 若快照拿到的是终态残留（已完成但 active 未清），只看 activeId 会让本地队列永卡。
const NON_BLOCKING_ACTIVE_STATUSES = new Set(["completed", "error", "interrupted", "cancelled", "failed", "aborted"]);

export function shouldDeferLocalPendingDispatch(state: OfficialPromptQueueState | null | undefined) {
  if (!state?.supported) return false;
  if (state.queuedIds.length > 0) return true;
  return Boolean(state.activeId && !NON_BLOCKING_ACTIVE_STATUSES.has(state.activeStatus ?? ""));
}

type PendingMessageLike = { sessionId: string; content: string; createdAt: number };

// 发送失败回补队列前的去重判定：若本次发送期间（since 之后）已有同会话同内容的消息
// 重新入队（例如 active-turn 失败分支已回补），则不再重复回补。
export function hasRecentDuplicatePendingMessage(
  pendingMessages: PendingMessageLike[],
  candidate: { sessionId: string; content: string },
  since: number,
) {
  return pendingMessages.some(
    (msg) => msg.sessionId === candidate.sessionId && msg.content === candidate.content && msg.createdAt >= since,
  );
}
