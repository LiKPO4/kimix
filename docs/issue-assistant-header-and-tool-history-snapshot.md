# Assistant 消息头与工具历史缺失快照

## 复现范围

- 日期：2026-07-20
- Kimi Code Server：0.27.0
- 会话：`session_01ea935b-5c5d-455a-a6aa-b8e9b2dbdefb`
- 模型：`opencode-go/deepseek-v4-pro`

## 消息头消失事件链

发送“仅回复‘收到’，不要调用工具。”后，UI 观测到：

1. 约 0.7 秒出现 `deepseek-v4-pro · 消息发送中` 的 Assistant 占位头。
2. 约 8 秒后 Assistant 行与消息头同时消失，底部恢复“已连接”。
3. 官方 Server snapshot 此时已经包含本轮 user、injection user 和完整 Assistant；Assistant 同时具有 thinking 与 text，session 为 `busy=false`、`last_turn_reason=completed`。
4. Renderer IndexedDB 同轮只有 user/status，没有任何 Assistant event。

这证明问题不是 MessageBubble 样式或 React key 闪动，而是 `prompt.completed` 在 Assistant 权威消息进入 renderer 前提前交付。旧完成屏障只要从 `/messages` 找到 prompt 就会返回非空 frames；即使这些 frames 只有 prompt 与注入 user，也会被误判为交付成功并关闭占位状态。

## 工具历史缺失事件链

官方 snapshot 的 Assistant message content 顺序包含 `thinking`、`text` 和 `tool_use`；随后使用独立 tool-role message 返回 `tool_result`。现场本地最新一轮统计为：

- `assistant_message`: 14
- `tool_result`: 28
- `tool_call`: 0

`contentPartsToFrames()` 原先只转换 text 与 thinking，完全忽略 `tool_use`。`ChatThread` 按设计不单独渲染 tool result，只把它合并到对应 tool call，因此所有结果都成为不可见孤儿。

## 修复不变量

1. `prompt.completed` 只能在同一 prompt 后出现 thinking、text 或 tool call 等可显示 Assistant frame 后交付；prompt/injection-only 页面必须退避重试。
2. Assistant snapshot 中的 `tool_use` 必须转换为带稳定 `toolCallId` 的 `tool.call.started`，保留名称和参数。
3. tool-role result 继续复用现有合并逻辑，不新增第二套 UI 展示体系。
4. 历史缓存版本递增，已有缺命令缓存必须重新从官方历史恢复。

## 回归门禁

- 第一次 `/messages` 只有 prompt，第二次才出现 Assistant：终态不得先于 Assistant frame。
- history snapshot 含 `tool_use`，并随后出现同 ID 的 `tool_result`：映射后必须得到可见且已完成的 tool call；同一转换器也服务于 in-flight snapshot。

## 2026-07-20 失败轮次补充快照

后续现场并非正文延迟，而是第三方 Provider 在首个 token 前失败：

- `turn.step.interrupted`: `provider.auth_error / 401 Insufficient balance`
- `turn.ended`: `reason=failed`
- `error`: 带完整供应商错误
- `prompt.completed`: `reason=failed`
- 官方 message history：user + injection user + content 为空的 Assistant

Server snapshot 不持久化瞬时 error，而且 0.27.0 的真实 snapshot/session 响应也不稳定提供 `last_turn_reason`。若失败 completion 仍进入成功正文屏障，它会等待不存在的 Assistant 正文，随后 message-only snapshot 会覆盖本地错误证据。修复后的规则是：失败终态直接交付；live error 投影为稳定 Assistant 失败回复；重启时仅在会话已静止、无 in-flight turn、历史末尾是稳定 ID 的空 Assistant，且该轮没有正文或工具输出时恢复通用失败说明，不猜测具体 Provider 原因。

## 2026-07-20 启动恢复竞态与局部对账补丁

v2.16.61 实机仍未恢复失败头，CDP 证明是两层问题叠加：

1. 主窗口先绘制、Server 延后 2 秒启动；当前会话 hydration 在 Server ready 前读取了本地 wire 镜像，镜像没有官方空 Assistant。Server 随后就绪，但当前会话被后台旧会话修复排除，启动期不会再读 snapshot。
2. 即使拿到 snapshot，完整 canonical 因旧历史正文更短被 `assistant-body-regression` 正确拒绝；失败 Assistant 会跟随整包候选一起丢弃，不能通过放宽整体单调性门禁解决。

最终不变量：首次历史读取会触发并有界等待同一个 Server startup promise；若 Server 在 4 秒内可用，直接读取官方 snapshot。完整 canonical 仍保持防倒退门禁；被拒绝时，只允许在本地最新用户轮次没有任何可显示输出、最新用户可由身份或相同文本加 30 秒时间窗对应、且 canonical Assistant 拥有稳定官方 message ID 时，单条补入最新 Assistant。旧历史不改写，重复执行幂等。

## 2026-07-20 live 失败完成帧补充

v2.16.62 只解决了重启 hydration，仍错误假设失败 `prompt.completed` 前的 transient `error` 必定进入 renderer。新发“？？？”再次复现：官方 session 为 `last_turn_reason=failed`，末尾空 Assistant ID 为 `msg_...000273`，本地却只有用户消息。失败 completion 现在必须先恢复一次权威 snapshot，再交付完成帧；snapshot 合成的失败 Assistant 同时携带“输出打断”状态，禁止 UI 将失败轮次显示为“输出完成/已完成”。

## 2026-07-20 v2.16.64 live 失败头消失三层根因根治

v2.16.62/63 的 `recoverSnapshot` 兜底仍不能让 live 失败的头出现。根因快照证明是三层叠加：

1. **snapshot 合成条件在 live 过渡态不满足**：`snapshotMessagesToServerFrames` 合成失败三帧要求 `inFlightItems.length === 0`、`session.busy !== true`、`session.main_turn_active !== true`、`!latestTurnHasDisplayFrame`、末尾是空 Assistant 全部同时成立。live 失败瞬间 snapshot 处于过渡态（`busy` 仍 true、`in_flight_turn` 非空、或 history 残留上一轮 delta），条件不满足 → 失败正文三帧一个都不发。重启恢复时 session 已稳态，条件成立 → 能合成，这就是“第二次打开才显示”的直接原因。
2. **`turn.ended(reason=failed)` 被 `kimixTerminalScope === "prompt"` 过滤**：`flattenServerEvent` 给所有 Server frame 打 `kimixTerminalScope: "prompt"`，`kimiCodeEventMapper` 对所有 prompt-scoped `turn.ended`（除 `reason=filtered` 外）直接 `return null`。`content.part` 产生 `isComplete=false` 的 assistant_message，只有 `turn.ended` 能产生 `isComplete=true` 的 terminal marker，但它被过滤 → 失败 assistant 永远 incomplete。
3. **`buildRenderItems.turnSettled` 要求所有 assistant `isComplete=true`**：失败 assistant 永远 `isComplete=false` → `turnSettled=false` → `projectedFailureAssistant`（要求 `turnSettled && errorEvents.length > 0`）不触发 → 不渲染消息头。
4. **次要**：`isVisibleTurnOutput` 把 `error` 当可见输出，`mergeMissingLatestCanonicalAssistant` 在本地有 transient error 时拒绝补入 canonical 失败 Assistant。

修复（三个修复点，全部已验证）：

- **修复点 1**（`electron/kimiCodeServerClient.ts`）：`deliverPromptCompletion` 失败分支不再仅依赖 `recoverSnapshot` 合成。保留 `recoverSnapshot`（cursor 同步 + WS 重订阅副作用），再调 `getSnapshot` 拿 snapshot，由新增的 `deliverFailedPromptFrames` 无条件自构三帧（`turn.step.interrupted` + `content.part(失败正文, barrier)` + `turn.ended(reason=failed)`），带 stable messageIdentity。`content.part` 的 `kimixPromptCompletionBarrier: true` 让 renderer `mergeEvents` 走 REPLACE 语义，与 `recoverSnapshot` 可能合成的相同 stable ID 帧幂等去重。
- **修复点 2**（`src/utils/kimiCodeEventMapper.ts`）：`turn.ended` 的 `kimixTerminalScope === "prompt"` 过滤放开 failed/cancelled/interrupted/error/canceled/aborted reason。成功轮次（`reason=completed` 或 missing）仍被过滤，保持 780e6629e 的“Server 成功轮次中间 turn.ended 是 step 边界”设计不变。
- **修复点 3**（`src/utils/kimiHistoryReconciliation.ts`）：`isVisibleTurnOutput` 移除 `error` 类型。transient error 是状态信号不是 Assistant 正文，移除后 live 失败时本地有 transient error 也不再阻止补入 canonical 失败 Assistant。

不影响成功轮次的保证：失败分支仅在 `FAILED_PROMPT_COMPLETION_REASONS` 命中时进入；成功 `turn.ended(completed)` 仍被过滤；SDK 路径不带 `kimixTerminalScope` 不受影响；`isVisibleTurnOutput` 的 `tool_call`/`tool_result`/`subagent` 仍算可见输出，tool-only 轮次不受影响。

## 2026-07-20 v2.16.65 正常轮次被提前判定终端导致消息头消失（6 秒 bug）

v2.16.64 修复了失败轮次的头消失，但用户报告新现象：发送消息后约 6 秒，Assistant 消息头消失，只剩 "Context: 13.87%" 气泡；轮次最终成功，body 后到时头又回来（闪烁）。这是与失败轮次**完全不同的路径**。

### 根因链（经完整事件链确认）

1. **0.27 Server 在 assistant body 还没 stream 到时，engine status 提前报 `idle`/`completed`**（step 边界 quirk）。
2. **`App.tsx:3261-3303` 终端轮询路径**：2.5s 起始 guard + 连续 2 次终端 poll 触发 `settleTerminalRoomAgent`。轮询间隔 1500ms（首次 1200ms），poll 落在 ~1.2s/2.7s/4.2s/5.7s；若 ~4.2s 开始报终端 → ~5.7s 第二次终端 poll → settle（用户感知"约 6 秒"）。
3. **`settleInactiveEvents`（eventHelpers.ts:265）**：空 assistant placeholder（没 content/thinking）被 `return []` 删除。
4. **`buildRenderItems`**：`turnSettled=true` + `mergedAssistantEvent=undefined` + `projectedFailureAssistant=undefined`（没 error event）+ `isTurnActive=false`（running flag 被清）→ 头消失，只剩 `status_update`（Context: 13.87%）当独立气泡（ChatThread.tsx:986-990）。
5. 之后真正 assistant body stream 到 → 头又回来。

### 为什么改 settleInactiveEvents 本身不够

即使保留空 assistant（不删），`mergeAssistantProcessEvents`（ChatThread.tsx:691）会过滤掉 `isComplete=true` 且无 content 的 assistant；`isTurnActive=false` 让 pending-placeholder fallback（ChatThread.tsx:865）不触发。必须在终端轮询路径阻止误判 settle，而不是在误判发生后补救。

### 修复

**修复点**（`src/App.tsx` + `src/utils/eventHelpers.ts`）：终端轮询路径在 `terminalPolls < 2` 检查之后、`flushStreamEvents()` 之前加守卫。新增纯函数 `hasTurnReceivedBody(events)`：判断当前轮次（latest user message 之后）是否收过 assistant body/thinking/tool/subagent/error 事件。守卫逻辑：

- 60 秒内 + `!hasTurnReceivedBody(agentEvents)` → 不 settle，return 等待，写回 `terminalPolls` 让计数继续累积。
- 超过 60 秒 → 允许 settle（兜底真正失败但无 error event 的轮次）。

**不影响真正完成/失败轮次的保证**：成功轮次 body 已到，`hasTurnReceivedBody=true`，守卫不触发；失败轮次有 error event，`hasTurnReceivedBody=true`，守卫不触发；超过 60 秒的轮次守卫不触发。只有"60 秒内 + 终端状态 + 从未收过 body"这个特定组合才触发——正是 0.27 提前误判终端的场景。`status_update`（Context 气泡）不算 body。

## 2026-07-20 v2.16.66 移除 60 秒上限，改为保留空 placeholder

v2.16.65 的 60 秒上限仍然太短：用户报告发送消息 1 分 03 秒后消息头消失（63 秒，刚好超过 60 秒上限），轮次最终成功，body 后到。根因是 401 余额不足时 body 来得很慢（Server 重试或延迟），60 秒内 body 没到达，上限放行后 settle 删了空 placeholder。

修复：移除时间上限，改为"只要轮次从未收过 body，settle 时保留空 placeholder"。具体做法：
- `settleInactiveEvents` 新增 `preserveEmptyAssistant` 参数：为 true 时空 assistant（无 content/thinking）不删除，保留为 `isComplete=false`，让消息头保持可见。
- `settleTerminalRoomAgent` 新增 `turnReceivedBody` 参数：传给 `settleInactiveEvents` 决定是否保留空 placeholder。
- App.tsx 守卫：移除 60 秒上限和 return，改为计算 `turnReceivedBody` 传给 `settleTerminalRoomAgent`。settle 仍执行（清 running state、派发下一条排队消息），但空 placeholder 保留。

为什么保留 `isComplete=false` 而不是 `isComplete=true`：`mergeAssistantProcessEvents`（ChatThread.tsx:691）会过滤掉 `isComplete=true` 且无 content 的 assistant，但保留 `isComplete=false` 的。保留 `isComplete=false` 让 `mergedAssistantEvent` 有值、`turnSettled=false`、消息头可见。body 到达后填充 placeholder，正常完成。

不影响真正完成/失败轮次：成功轮次 body 已到，`turnReceivedBody=true`，`preserveEmptyAssistant=false`，正常 settle；失败轮次有 error event，`turnReceivedBody=true`，正常 settle。只有"终端状态 + 从未收过 body"时才保留空 placeholder——正是误判或 body 延迟到达的场景。
