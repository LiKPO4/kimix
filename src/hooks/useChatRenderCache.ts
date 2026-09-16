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
// 跨会话/跨挂载保留：缓存必须驻留模块级。两层原因（v2.21.214/215 录制归因）：
// ① 此前「切换会话即清空」让来回切换永远冷缓存；
// ② 修复为 useRef 保留后依然无效——AppShell 用 {chatWorkspaceActive && <ChatThread/>}
//   条件渲染，进出设置页/插件页时 ChatThread 卸载重挂载，useRef 随组件实例重建。
// cacheKey 形如 `${roomAgentId}:${agentTurnId}:${segmentOrdinal}:${turnStartedAt}`，
// agentTurnId/事件 id 全局唯一，天然按会话隔离，跨实例保留不会串数据。
// 容量上限由 ChatThread 的写入侧负责（Map 插入序淘汰最旧）。sessionId 保留在签名里
// 供调用方按当前会话传参。
const globalCompletedTurnRenderCache = new Map<string, CompletedTurnRenderCacheEntry>();

export function useChatRenderCache(_sessionId: string | undefined) {
  const cacheRef = useRef(globalCompletedTurnRenderCache);
  return cacheRef;
}
