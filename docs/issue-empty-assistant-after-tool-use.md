# Issue：工具调用/子代理完成后助手正文缺失，需手动发送“继续”

**状态**：已修复（v2.16.8 子代理正文提升到主时间线）  
**严重度**：P1（功能丢失/用户体验）  
**创建日期**：2026-07-15  
**代码基线**：`2dc80ac7`（v2.16.6+）  
**相关模块**：Kimi Code SDK 桥接、事件映射、房间/子代理调度  

---

## 1. 现象

用户发送一条普通请求（如“分析一下当前项目，并告诉我最应该先处理什么”）后：

1. Agent 正常执行若干工具调用（`git status`、文件读取等）。
2. 可能还启动了一个 Swarm 子代理。
3. 工具/子代理全部显示“已完成”。
4. **但助手没有输出任何正文**，界面直接进入“等待用户输入”状态。
5. 用户再手动发送一条“继续”后，助手才输出本应一次性给出的总结正文（如“剩余小债务”）。

实际上 Kimi 已经生成了正文，但当前会话的 UI 没有把它渲染出来。重新打开软件（或官方历史同步后），同一段正文会正常显示。

---

## 2. 根因分析

这是 **子代理输出被挂到子代理内部事件流，主时间线没有把它提升到 UI** 导致的渲染缺失。

### 2.1 正文实际存在，但不在主时间线

用户重新打开软件后正文能正常显示，说明 Kimi 已经生成了内容并且已经持久化。问题出在当前会话的渲染层：主时间线（`session.events` 或房间投影后的时间线）里找不到这段 `assistant_message` content，因此 `ChatThread.tsx` 的 `mergeAssistantProcessEvents` 返回 `undefined`，最终只渲染了“子代理已完成”的占位卡片。

### 2.2 子代理事件归属

`src/utils/eventMapper.ts:597-610` 的 `attachScopedEventToSubagent` 会把带 `agentId` 的事件挂到对应 `subagent` 的 `events` 数组里：

```ts
function attachScopedEventToSubagent(existing: TimelineEvent[], incoming: TimelineEvent): TimelineEvent[] | null {
  const agentId = scopedAgentId(incoming);
  if (!agentId || incoming.type === "subagent") return null;
  const subagentIndex = existing.findLastIndex((event) => event.type === "subagent" && event.agentId === agentId);
  // ...
  result[subagentIndex] = {
    ...subagent,
    events: mergeEvents(subagent.events, stripAgentScope(incoming)),
  };
  return result;
}
```

在 Swarm 或某些工具链场景下，Agent 的最终总结输出可能被打上子代理的 `agentId`，从而被吞进 `subagent.events`。主时间线只剩一个空的 `TurnEnd`，`ChatThread.tsx` 便认为本轮没有正文。

### 2.3 重新打开后为什么能显示

重新打开软件时会从本地持久化 + 官方历史重新构建/投影时间线。官方历史里的正文通常不带子代理 `agentId`，因此能被正确归位到主时间线；或者 `projectCollaborationTimeline` 在冷启动时的投影路径与流式事件路径不同，从而把正文暴露出来。

---

## 3. 触发条件

- 本轮包含子代理（尤其是 Swarm 子代理）。
- 子代理的 `events` 数组里存在 `assistant_message` content。
- 主时间线在同一 turn 内没有产生独立的 `assistant_message` content（只有空的 `TurnEnd` 或没有主 agent 正文）。
- 渲染时走到 `createSubagentOnlyAssistantEvent`，生成空的占位卡片。

---

## 4. 已排除的假设

| 假设 | 结论 | 依据 |
|------|------|------|
| `MarkdownRenderer` 延迟渲染导致正文不显示 | 排除 | 重新打开软件后同一段正文能显示，说明不是渲染器本身的问题 |
| `mergeAssistantProcessEvents` 合并丢失 content | 排除 | 主时间线确实没有 contentful `assistant_message`；合并逻辑只会保留已有的内容 |
| SDK/模型没有输出正文 | 排除 | 用户确认 Kimi 已输出正文；重开后可见 |
| 需要自动继续 prompt | 排除 | 不是 turn 真的结束为空，而是正文被挂在子代理 scope 里 |
| UI 状态判断错误（把运行中误判为完成） | 排除 | 第一张图中 `assistantFooterFallbackLabel` 显示“模型：...”，说明 `event.isComplete=true` 且 `roomAgentId` 存在，状态判断正确 |

---

## 5. 验证方法（复现前必须做）

1. 打开主进程调试日志，抓取第一轮结束时的 SSE 事件序列。
2. 重点确认：
   - 在最后一个 `tool.result` 或子代理 `completed` 之后，**是否出现过 `assistant.delta`/`ContentPart`**。
   - 是否直接就是 `TurnEnd`。
   - 如果有 `assistant.delta`，其内容是否为空字符串。
3. 同时导出该会话的 `events` 数组快照，确认 UI 侧收到的 `assistant_message` content 确实为空。
4. 对比实验：关闭 Swarm 模式后使用相同提示词，观察是否仍复现。若不再复现，则偏向子代理归属问题；若仍复现，则偏向 SDK/模型行为。

---

## 6. 修复候选方案

### 方案 A：在 Kimix 侧加兜底自动继续（已实施 v2.16.8）

在 `src/utils/chatRenderItems.ts` 的 `createSubagentOnlyAssistantEvent` 中，当主时间线没有正文、但子代理 `events` 里存在 `assistant_message` 时，把 content/thinking 提升到生成的占位卡片里：

```ts
function collectSubagentAssistantOutput(subagents: SubagentEvent[]): { content: string; thinking?: string } {
  const contents: string[] = [];
  const thinkings: string[] = [];
  for (const subagent of subagents) {
    for (const event of subagent.events) {
      if (event.type !== "assistant_message") continue;
      const content = event.content?.trim();
      const thinking = event.thinking?.trim();
      if (content) contents.push(content);
      if (thinking) thinkings.push(thinking);
    }
  }
  return {
    content: contents.join("\n\n"),
    thinking: thinkings.join("") || undefined,
  };
}
```

这样用户无需展开子代理也能在主时间线看到实际输出。该改动只影响渲染层，不改变事件持久化或子代理归属逻辑。

### 方案 B：修复子代理归属逻辑（未实施）

在 `attachScopedEventToSubagent` 中更严格地区分“子代理内部事件”和“主 Agent 总结输出”，避免把最终 `assistant_message` 挂到子代理里。这是更上游的根因修复，但需要确认 SDK `agentId` 的语义才能安全改动。

### 方案 C：UI 明确提示用户展开子代理（未实施）

如果认为子代理输出就应当待在子代理内部，可以在主时间线显示提示“子代理已返回结果，点击展开查看”。但这没有解决用户期望在主流程看到总结的问题。

---

## 7. 关键代码清单

| 文件 | 作用 |
|------|------|
| `src/utils/chatRenderItems.ts` | `createSubagentOnlyAssistantEvent`，子代理正文提升到主时间线 |
| `src/utils/__tests__/chatRenderItems.test.ts` | 渲染项单元测试 |
| `src/utils/eventMapper.ts:845-855` | `assistant.delta` → `assistant_message` |
| `src/utils/eventMapper.ts:982-1010` | `ContentPart` → `assistant_message` |
| `src/utils/eventMapper.ts:1257-1267` | `TurnEnd` → 空 `assistant_message` |
| `src/utils/eventMapper.ts:597-610` | `attachScopedEventToSubagent`，子代理事件归属 |
| `src/utils/eventMapper.ts:1298-1390` | `mergeEvents`，空 `TurnEnd` 丢弃逻辑 |
| `src/App.tsx:2893-2999` | Kimi Code 事件流主入口 |
| `src/components/chat/ChatThread.tsx` | 消息时间线渲染 |
| `src/components/chat/MessageBubble.tsx` | 消息气泡渲染 |
| `src/components/chat/MarkdownRenderer.tsx` | Markdown 正文渲染 |

---

## 8. 备注

- v2.16.8 已改为渲染层兜底：子代理 `events` 里的 `assistant_message` 内容会被提升到主时间线。
- 之前实现的自动继续兜底（`src/utils/autoContinue.ts`）已回滚，因为用户确认正文其实已被 Kimi 输出，不需要再发 prompt。
- 若 v2.16.8 仍复现，下一步优先抓取该会话的 `events` 数组和主进程 SSE 日志，确认正文是否真的在 `subagent.events` 里。
