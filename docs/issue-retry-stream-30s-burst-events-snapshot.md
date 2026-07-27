# 重试后流式输出 30 秒成批补出事件快照

## 问题范围

- 用户会话：`session_cc972967-b75e-4f8d-a834-1fb615ec8ada`
- Server runtime：`session_7affc171-5482-4e85-adab-c7d04ebfec44`
- 现场版本：`v2.20.32`
- 用户可见现象：重试已真实启动，但新一轮约 30 秒没有连续过程输出，随后思考、正文和工具块成批出现。

## 主进程 WebSocket 快照

| 时间（UTC） | 事件 | 结果 |
| --- | --- | --- |
| `02:16:38.484` | prompt accepted | 主进程立即执行 prompt-boundary subscription refresh |
| `02:16:38.484` | old WS close | `subscribed=1`，进入 250ms 重连 |
| `02:16:38.556` | new WS connected | `client_id=web_72812ec0…`，订阅 1 个会话，ack=0 |
| `02:16:38.564` | `kimix.server.snapshot` | runtime `4ebfec44`，seq=150 |
| `02:16:49.484` | renderer live silence | 静默 10,504ms，当前轮正文 0、无完成工具 |
| `02:17:05.983` | renderer live silence | 静默 27,003ms，当前轮正文仍为 0 |
| `02:17:08.983` | `running-sample` | 静默 30,004ms 后触发全量官方历史读取 |
| `02:17:09.037` | canonical accepted | local size `42,983` → canonical size `43,019` |
| `02:17:22.483` | renderer live silence | 经历史补入后正文 36 字、已完成工具从 530 增至 532 |

prompt-boundary 重连确实执行，但新连接只交付初始 snapshot，后续实时输出未进入 renderer；内容由 30 秒 `running-sample` 补入。问题不在 React 渲染节流。

## 官方 messages / wire 快照

官方 Server 在 WS 静默期间持续写入内容：

| 官方消息 | role | created_at | JSON content 长度 |
| --- | --- | --- | --- |
| `msg_01KYGNR9AFX71ZFN8YKN264G9Q` | user | `02:16:38.485` | 44 |
| `msg_session_..._000010` | assistant | `02:16:38.486` | 986 |
| `msg_session_..._000011` | tool | `02:16:52.106` | 13,651 |
| `msg_session_..._000012` | assistant | `02:16:52.109` | 833 |
| `msg_session_..._000014` | assistant | `02:17:01.790` | 2,980 |

第一条 Assistant 在 prompt 用户消息后约 1ms 就已落盘，证明模型/Server 没有等待 30 秒才生成；丢失发生在 Kimix 的 WS 恢复判定。

## UI events / renderItems 快照

- `02:16:37.768`：新的 Assistant placeholder 进入 `thinking`，正文 0。
- 10.5 秒和 27 秒诊断均显示 `openAssistants=1`、`textChars=0`。
- 30 秒 canonical reconcile 接受 36 个新增映射单位后，UI 一次出现正文和两个工具结果。
- 截图中的“正在思考 32秒”与上述时间线一致。

二次诊断开启逐帧日志后还发现了 renderer 入口的独立丢弃条件：

- `02:42:03.331` 起主进程已收到连续 `thinking.delta`。
- `02:42:03.920` 起主进程已收到连续 `assistant.delta`。
- 同一时段 `findRoomRuntimeOwners` 返回 4 个完全相同的 room id，App 记录
  `kimiRuntimeOwner.ambiguous` 并直接丢弃事件。
- IndexedDB 当前轮因此仍只有空 Assistant；这解释了“WS 明明恢复，UI 仍要等历史补偿”的残余现象。

## 根因

此前 v2.20.20/v2.20.21 已实现“8 秒官方历史增长探针 + prompt 接受后立即重建 WS”，但存在三个未覆盖竞态：

1. prompt 接受、重连完成后才读取 `messages?page_size=1` 作为基线；本次首个 Assistant 在 1ms 内落盘，读取时最新消息已是 Assistant，于是基线越过了本应触发恢复的首段进度。
2. `lastSessionFrameAt` 由任何带 session id 的帧刷新，HTTP 探针也会因任意帧到达而取消比较。状态心跳或其他非正文进度帧因此可以让连接看似活跃，即使 body/thinking/tool 实时流已停止。
3. 会话 hydration/reconciliation 可短暂把同一逻辑 Session 重复放进 store。runtime owner 查询未按
   `roomId + roomAgentId` 去重，把同一 owner 的重复数组项当成多个竞争 owner；App 的安全防串流门禁随即丢弃所有实时事件。

## 最小复现断言

1. 接受后最新消息已是 Assistant 时，基线必须保留 prompt-specific “尚未看到输出”标记，短探针能识别官方历史已增长。
2. 最新消息仍是刚接受的 user 时，可将该 user 作为正常基线，避免把正常长考误判为丢流。
3. `agent.status.updated`、ping 等非内容帧不得刷新 session progress 时间或取消探针；thinking、body、tool、subagent、审批和提问帧可以。
4. 相同 `roomId + roomAgentId` 的重复 store 项只算一个逻辑 owner；不同 room 或 Agent 对同一 runtime 的声明仍必须保持歧义并拒绝路由。

本次不增加自动 prompt、自动重复发送或 30 秒 UI 兜底，只修复现有 WS 恢复逻辑。

## v2.20.33 真实运行验收

对同一目标会话使用构建产物发送短回复探针：

| 时间（UTC） | 事件 | 结果 |
| --- | --- | --- |
| `02:47:31.300` | 点击发送 | renderer 创建当前轮 placeholder |
| `02:47:32.229` | prompt boundary refresh | 在 Prompt POST 前重建实时订阅 |
| `02:47:32.361` | `llm.request` | 官方 wire 开始模型请求 |
| `02:47:41.544` | 首个 `thinking.delta` | App 立即映射进当前 Agent turn |
| `02:47:42.448` | 首个 `assistant.delta` | 正文开始进入当前 Assistant |
| `02:47:42.927` | `prompt.completed` | 完成屏障按同一 prompt 收口 |
| `02:47:43.007` | UI settled | 正文 23 字，`isComplete=true` |

- 该轮从模型请求到首个思考增量约 9.18 秒，属于上游生成等待；Kimix 收到帧后即时映射。
- 发送期间 `kimiRuntimeOwner.ambiguous` 为 0。
- 当前轮 IndexedDB 包含完整 23 字正文，未触发 30 秒 `running-sample` 才补正文。
- 定向测试 78 项、全量 131 文件 1278 项、Node/Renderer typecheck、生产构建和 OKF 校验通过。
