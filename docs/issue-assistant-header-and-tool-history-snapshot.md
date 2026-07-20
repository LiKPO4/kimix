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
