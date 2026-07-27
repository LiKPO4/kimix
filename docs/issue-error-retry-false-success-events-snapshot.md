# 错误卡“重试上一条”虚假成功事件快照

## 问题范围

- 目标会话：`session_cc972967-b75e-4f8d-a834-1fb615ec8ada`
- 现场版本：`v2.20.31`
- 用户可见现象：错误卡显示 `Kimi Server WebSocket 已关闭`；点击“重试上一条”后显示“已重新发送上一条消息”，但没有新一轮运行。

## 主进程 / 事件流快照

从正在运行的应用 IndexedDB 会话快照读取到：

| 顺序 | event id | 类型 | 时间戳 | content/message 长度 | scope / 内容 |
| --- | --- | --- | --- | --- | --- |
| 1554 | `yd4ysoqy7` | `user_message` | `1785117441176` | 19 | `roomMessageId=yd4ysoqy7`、`roomAgentId=room-agent:session_cc972967-b75e-4f8d-a834-1fb615ec8ada`、`agentTurnId=agent-turn:7uq2cu1sj`；`review一下这两天所有git提交吧` |
| 1555–1561 | 多个 | `status_update` / `assistant_message` / `tool_call` | `1785117441292`–`1785117480866` | Assistant 正文 28 | 同一 turn scope；助手开始回复并发起工具调用 |
| 1562 | `dzxi09n0i` | `error`（source=`ipc`） | `1785117483059` | 25 | 同一 room/agent/turn scope；`Kimi Server WebSocket 已关闭` |

会话本身的 `collaboration` 为 `null`。这说明 room/agent scope 是普通会话统一运行身份的一部分，不能用来证明当前会话是协作房间。

主进程发送链的既有行为是：Kimi Server 发送失败后建立 SDK fallback / session migration，并将当前发送判定为失败，避免在不确定是否已接收时自动重复发送。用户手动重试应当进入新的发送调用。

## UI / renderItems 快照

错误事件已存在于顶层 `events`，错误卡正常渲染；问题不在正文或事件丢失。

旧路由只检查错误事件是否带 `roomMessageId` 和 `roomAgentId`：

1. `ChatThread` 派发 `kimix:room-delivery-action`，随后 Promise 立即完成。
2. `ErrorCard` 因 Promise 完成而显示“已重新发送上一条消息”。
3. `Composer` 收到事件后检查会话；由于 `collaboration=null`，直接返回。
4. 没有调用普通会话的 `retryLastUserMessage`，也没有启动新一轮。

即使在真实协作房间中，旧桥接同样是 fire-and-forget：UI 成功状态早于持久化和实际派发结果。

## 根因与复现断言

根因属于 Kimix 重试路由与异步确认逻辑：

- scope 元数据被误当成会话类型；
- 浏览器事件“已发出”被误当成业务发送“已成功”。

最小回归断言：

1. 普通会话即使错误事件带 room scope，也必须走普通会话重试。
2. 只有 `session.collaboration` 存在时才允许走房间投递重试。
3. 房间投递重试必须等待监听器返回真实派发结果；失败、无人处理或超时都不得显示成功。

本次不手工修补目标会话数据，也不增加自动 prompt 兜底；运行验证只通过用户所反馈的“重试上一条”入口正常发起新一轮。

## v2.20.32 运行验证

使用与用户截图相同的内置产物 origin 和目标会话点击原错误卡：

- 旧失败轮保持原始事件证据，未手工修数据；
- 重试新增用户事件索引 1563，内容与上一条提示一致；
- 主进程记录 `prompt accepted → refresh live subscription`；
- 新轮随后落盘 Assistant、tool_call 和 status 事件（索引 1565–1572）；
- UI 进入“正在思考/运行中”并展示新的正文与工具调用。

因此修复后的点击已真实进入运行时发送链，而不是仅完成本地事件派发或提示文案切换。
