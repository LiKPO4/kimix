import { useRef } from "react";
import type { CompletedTurnRenderCacheEntry } from "@/types/chatRender";

/**
 * Stable cache for completed turn render items.
 *
 * Rebuilding render items during streaming invalidates the active turn, but
 * completed turns should keep the same object identity so React can reuse their
 * DOM. This ref-backed cache is scoped to the current session and cleared when
 * the session changes.
 */
// 跨会话保留：此前实现是「切换会话即清空」——重会话（单轮 95 assistant / 26.5 万字
// 思考，合并一次约 2 秒）来回切换时缓存永远是冷的，每切一次重付全额合并开销
//（v2.21.213 录制归因：perfDiag counts 全空 = 缓存条目从未存活到命中）。
// cacheKey 形如 `${roomAgentId}:${agentTurnId}:${segmentOrdinal}:${turnStartedAt}`，
// agentTurnId/事件 id 全局唯一，天然按会话隔离，跨会话保留不会串数据。
// 容量上限由 ChatThread 的写入侧负责（Map 插入序淘汰最旧）。sessionId 保留在签名里
// 供调用方按当前会话传参；缓存本身不再按会话清空。
export function useChatRenderCache(_sessionId: string | undefined) {
  const cacheRef = useRef(new Map<string, CompletedTurnRenderCacheEntry>());
  return cacheRef;
}
