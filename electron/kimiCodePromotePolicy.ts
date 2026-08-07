/**
 * SDK → Server 空闲会话 promote 的故障分级与退避策略（纯逻辑，不依赖 electron，便于单测）。
 *
 * 背景（v2.20.262 修复）：此前 promote 失败只要非 404 就调 markServerRuntimeFailure，
 * 单个损坏会话（daemon 活着但 getSession 持续 500）会让 10s 巡检每轮都杀一次整个
 * daemon 并把全部空闲会话迁回 SDK，自维持循环还会打断其他会话运行中的轮次。
 * 原则：只有明确的网络/守护进程级信号才升级全局故障；其余一律按会话级处理——
 * 跳过该会话并指数退避，等会话自愈或用户干预。daemon 真死时，发送路径与 WS 帧
 * 错误会走各自的 onRuntimeFailure，不靠 promote 兜底。
 */

/** 明确的 daemon/网络级故障信号；匹配不到的一律视为会话级。 */
const DAEMON_LEVEL_RE = /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up|WebSocket 尚未连接|WebSocket 重连探针超时|Kimi Server 尚未就绪/i;

/** true = 该错误指向 daemon 整体不可用，允许升级 markServerRuntimeFailure。 */
export function isDaemonLevelPromoteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return DAEMON_LEVEL_RE.test(message);
}

/**
 * 会话级 promote 失败的指数退避。失败会话不再每 10s 重试，
 * 按 base 4 倍递增、封顶 max；成功 promote 或会话消失时清零。
 */
export class PromoteFailureBackoff {
  private readonly failures = new Map<string, { count: number; nextRetryAt: number }>();

  constructor(
    private readonly baseMs = 60_000,
    private readonly maxMs = 1_800_000,
  ) {}

  /** 当前是否处于退避窗口内（应跳过本次 promote）。 */
  isActive(sessionId: string, now = Date.now()): boolean {
    const failure = this.failures.get(sessionId);
    return failure !== undefined && now < failure.nextRetryAt;
  }

  /** 记录一次失败，返回下次允许重试的时间戳。 */
  noteFailure(sessionId: string, now = Date.now()): number {
    const prev = this.failures.get(sessionId);
    const count = (prev?.count ?? 0) + 1;
    const delay = Math.min(this.baseMs * 4 ** (count - 1), this.maxMs);
    const nextRetryAt = now + delay;
    this.failures.set(sessionId, { count, nextRetryAt });
    return nextRetryAt;
  }

  clear(sessionId: string): void {
    this.failures.delete(sessionId);
  }
}
