/**
 * 会话关闭/删除时的按会话作用域状态清理（纯逻辑，不依赖 electron，便于单测）。
 *
 * 背景：kimiCodeHost 内按 sessionId 键控的模块级表（snapshot 重放指纹、增量重放
 * 起点、server 审批/问题请求）在会话关闭/删除时不做清理，会话反复开关会无限增长，
 * 且每次快照帧都会读到死会话的残留指纹。清理只在「会话确实消失」的路径调用
 * （closeSession / archiveSession / 中途失败迁移）；同 id 迁移（server↔SDK）会话仍
 * 存活，不得调用——否则重放去重状态被清空后，下一次 snapshot 会全量重放历史帧。
 */

/** host 内按 sessionId 键控、会话关闭后应清理的状态表。 */
export type SessionScopedState = {
  /** sessionId -> 最近一次 snapshot 重放指纹（同指纹不重放历史帧）。 */
  fingerprintBySession: Map<string, string>;
  /** sessionId -> 最近一次 snapshot 最新消息 id（增量重放起点）。 */
  latestMessageIdBySession: Map<string, string>;
  /** `${sessionId}:${requestId}` 前缀的 server 审批请求表。 */
  approvalKeys: Set<string>;
  /** `${sessionId}:${requestId}` 前缀的 server 问题请求表。 */
  questionKeys: Set<string>;
  /** `${sessionId}:${requestId}` -> 问题请求负载。 */
  questionRequests: Map<string, unknown>;
};

/** 删除该会话的全部按会话作用域状态；对不存在的会话幂等。 */
export function forgetSessionState(state: SessionScopedState, sessionId: string): void {
  state.fingerprintBySession.delete(sessionId);
  state.latestMessageIdBySession.delete(sessionId);
  const prefix = `${sessionId}:`;
  for (const key of [...state.approvalKeys]) {
    if (key.startsWith(prefix)) state.approvalKeys.delete(key);
  }
  for (const key of [...state.questionKeys]) {
    if (key.startsWith(prefix)) state.questionKeys.delete(key);
  }
  for (const key of [...state.questionRequests.keys()]) {
    if (key.startsWith(prefix)) state.questionRequests.delete(key);
  }
}
