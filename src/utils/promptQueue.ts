export interface OfficialPromptQueueState {
  supported: boolean;
  activeId: string | null;
  activeStatus: string | null;
  queuedIds: string[];
}

export function shouldDeferLocalPendingDispatch(state: OfficialPromptQueueState | null | undefined) {
  return Boolean(state?.supported && (state.activeId || state.queuedIds.length > 0));
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
