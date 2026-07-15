# Issue：工具调用/子代理完成后助手正文缺失，需手动发送“继续”

**状态**：已修复（v2.16.8 渲染端自动继续兜底）  
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

截图中的“继续”不是 UI 自动提示按钮，而是用户手动输入的消息；发送后新一轮 prompt 才把缺失的正文补上。

---

## 2. 根因分析

这不是 UI 渲染 bug，而是 **Kimi Code SDK 事件流与 Kimix 事件映射之间缺少“工具调用后必须产出正文”的兜底机制**。

### 2.1 事件映射：正文只能来自 `assistant.delta` / `ContentPart`

`src/utils/eventMapper.ts:845` 对 `assistant.delta` 的处理：

```ts
case "assistant.delta": {
  const delta = payloadString(payload, source, "delta");
  if (!delta) return null;
  return {
    id: generateId(),
    type: "assistant_message",
    timestamp: eventTimestamp,
    agentId: payloadString(payload, source, "agentId"),
    content: delta,
    model: payloadString(payload, source, "model")?.trim() || undefined,
    isThinking: false,
    isComplete: false,
  };
}
```

`src/utils/eventMapper.ts:982` 对 `ContentPart` 的处理 likewise 生成带 `content` 的 `assistant_message`。

而 `TurnEnd` 的处理（`src/utils/eventMapper.ts:1257`）固定生成 **content 为空**的完成事件：

```ts
case "TurnEnd": {
  return {
    id: generateId(),
    type: "assistant_message",
    timestamp: eventTimestamp,
    content: "",
    model: payloadString(payload, source, "model")?.trim() || undefined,
    isThinking: false,
    isComplete: true,
  };
}
```

也就是说：如果 SDK 在一轮末尾只发了 `tool.result` + `TurnEnd`，没有发 `assistant.delta`，Kimix 没有任何事件来源可以“造”出正文。

### 2.2 合并逻辑会丢弃没有正文的 `TurnEnd`

`src/utils/eventMapper.ts:1352` 的 `mergeEvents` 在收到空 `assistant_message` 且 `isComplete=true` 时：

```ts
if (incoming.isComplete && !incoming.content && !incoming.thinking) {
  const latestOpenIndex = existing.findLastIndex((e) => e.type === "assistant_message" && !e.isComplete);
  // ...
  if (latestOpenIndex === -1) {
    return base;   // 没有未完成的 assistant_message，直接忽略这个 TurnEnd
  }
```

如果本轮完全没有流式正文，连空白的 `assistant_message` 都不会出现在时间线上。界面自然看不到任何助手输出。

### 2.3 主进程侧同样只累积 `assistant.delta`

`electron/kimiCodeHost.ts:2262` 在 `prompt()` 内部收集正文：

```ts
if (event.type === "assistant.delta") {
  if (typeof event.delta === "string") parts.push(event.delta);
}
```

BTW（between-turn worker）模式下的 `updateBtwRunFromEvent`（`electron/kimiCodeHost.ts:2717`）同样只读 `assistant.delta`。

主进程没有检测“一轮结束但正文为空”并自动续写的逻辑。

### 2.4 当前没有“自动继续”兜底

在 `src/App.tsx:2893-2999` 的 Kimi Code 事件流主入口中：

- 只负责把 SDK 事件映射为 UI 事件并合并。
- 没有任何逻辑检查：本轮结束时，如果 `assistant_message` 为空、但存在已完成的工具/子代理，则自动触发下一轮 prompt。

因此当模型/SKD 决定“这一轮我先不生成正文”时，用户必须手动再发一条消息才能推进。

---

## 3. 最可能的触发条件

结合截图，有两种可能：

1. **SDK/模型行为**：在 tool use 后，Kimi Code SDK 或模型把当前 turn 标记为结束，把总结留到下一轮。这在某些模型或长工具链后可能出现。
2. **Swarm 子代理归属错误**：`src/utils/eventMapper.ts:597-610` 的 `attachScopedEventToSubagent` 按 `scopedAgentId` 把事件挂到子代理内部。如果主 Agent 的总结输出被错误归属到子代理 scope，或子代理结束事件提前关闭了主对话的 turn，都会导致主对话缺少正文。

---

## 4. 已排除的假设

| 假设 | 结论 | 依据 |
|------|------|------|
| `MarkdownRenderer` 延迟渲染导致正文不显示 | 排除 | 第一张截图中没有任何正文区域，说明 `event.content` 当时就是空字符串 |
| `mergeAssistantProcessEvents` 合并丢失 content | 排除 | `ChatThread.tsx:547-568` 会保留所有非空 content，不会丢弃 |
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

在 `src/App.tsx` 处理 Kimi Code 事件流的位置，当检测到以下全部条件时，自动调用 `sendKimiCodePromptWithRetry({ sessionId: runtimeSessionId, content: "继续" })` 发送一条轻量的继续提示：

- 当前 turn 的 `assistant_message` content 为空；
- 本轮存在已完成的工具调用或子代理；
- 不是长程任务 / Goal 暂停 / 等待用户审批或澄清；
- 权限模式为 `auto` 或 `yolo`（`manual` 模式下保留用户控制，不自动推进）；
- 避免无限循环（记录本轮已自动继续一次）。

实现位置：
- `src/utils/autoContinue.ts`：纯函数 `checkAutoContinueAfterEmptyTurn`，负责条件判断。
- `src/App.tsx`：`maybeAutoContinueAfterEmptyTurn` 在 `onKimiCodeEvent` 收到空 `TurnEnd` 后延迟 150ms 检查，在 `onKimiCodeStatus` 收到 `completed` 后立即检查。

优点：不依赖 SDK/模型修复，立即可改善用户体验。  
风险：可能改变模型原意；当前实现通过权限模式、长程任务排除、待审批/待回答排除、单次循环保护来降低风险。若真实场景中仍误触发，可进一步收紧条件或改为仅显示“继续”按钮。

### 方案 B：SDK/模型层修复

如果确认是 SDK 在 tool use 后错误地发送 `TurnEnd` 而没有正文，则需要在 Kimi Code SDK 或模型调用层修复：确保每个 turn 在结束时至少包含一个 `assistant.delta` 或 `ContentPart`。

优点：根因修复。  
风险：Kimix 无法直接控制上游 SDK 发布节奏。

### 方案 C：UI 明确提示用户“本轮无正文，可发送继续”

如果判定这是模型/SDK 的正常分轮行为，Kimix 可以在检测到空正文 + 已完成工具/子代理时，显示一个非侵入式提示（如“助手本轮未生成回复，发送消息继续”）。

优点：避免无限循环风险，用户知情权高。  
缺点：没有真正解决“需要手动继续”的打断感。

---

## 7. 关键代码清单

| 文件 | 作用 |
|------|------|
| `electron/kimiCodeHost.ts` | SDK 调用入口，`prompt()` 实现；只累积 `assistant.delta` |
| `src/utils/eventMapper.ts:845-855` | `assistant.delta` → `assistant_message` |
| `src/utils/eventMapper.ts:982-1010` | `ContentPart` → `assistant_message` |
| `src/utils/eventMapper.ts:1257-1267` | `TurnEnd` → 空 `assistant_message` |
| `src/utils/eventMapper.ts:597-610` | `attachScopedEventToSubagent`，子代理事件归属 |
| `src/utils/eventMapper.ts:1298-1390` | `mergeEvents`，空 `TurnEnd` 丢弃逻辑 |
| `src/App.tsx:2893-2999` | Kimi Code 事件流主入口 |
| `src/App.tsx` | `maybeAutoContinueAfterEmptyTurn` 自动继续兜底 |
| `src/utils/autoContinue.ts` | 空 turn 自动继续条件判断 |
| `src/utils/__tests__/autoContinue.test.ts` | 自动继续单元测试 |
| `src/components/chat/MessageBubble.tsx` | 消息渲染 |
| `src/components/chat/MarkdownRenderer.tsx` | Markdown 正文渲染 |

---

## 8. 备注

- v2.16.8 已实现渲染端自动继续兜底。
- 该问题尚未在主进程日志中复现确认；若 v2.16.8 仍复现，下一步仍优先抓取 SSE 事件序列，确认是 SDK/模型行为还是 Swarm 子代理归属问题。
- 自动继续目前仅在 `auto`/`yolo` 权限模式下生效；`manual` 模式下用户需手动发送"继续"。
