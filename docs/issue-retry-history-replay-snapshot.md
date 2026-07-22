# 重试轮混入历史工具：事件快照

时间：2026-07-22（Asia/Shanghai）  
会话：`session_d2092d06-9027-4105-9240-3bc0bc0ca58d`

## 官方事件

- 重试前失败轮：turn 11，seq 490-501，无工具调用，`prompt.completed(reason=failed)`。
- 重试轮：turn 12，seq 503-532。
- turn 12 的官方工具调用为 seq 503、507-511、519-522，共 **10 个**，随后 seq 530 `turn.ended`、seq 532 `prompt.completed`。
- 因此截图中瞬间出现的“25 个工具调用”不可能全部来自 turn 12。

## UI / 本地时间线

从当前 Renderer 的 IndexedDB `kimix-state / kimix_sessions` 只读抽样：

- 新重试用户事件位于本地索引 306，时间戳 `1784699318380`。
- 索引 308-332 随后追加 25 个 `tool_call`，但它们的时间戳为 `1784635585202` 至 `1784637945747`，均早于新用户约 17 小时。
- 这些调用包含 turn 3、6、10 的官方 call ID；部分 call ID 在更早索引已经存在。
- 当前会话缓存共 237 个 `tool_call`，证明完整历史在多次恢复时被当作新到事件重复写入。

## 根因结论

`recoverSnapshot` 按“完整 history → 当前 in_flight”交付。旧过滤器只跳过本地已有且结果文本相同的历史工具；没有结果或本地形态不同的历史 `tool.call.started` 会按到达顺序追加到最新用户之后。工具去重又仅匹配 `status=running` 的本地调用，已完成的同 call ID 无法挡住重放。重试占位也没有携带请求模型，故同一期间消息头只显示“消息发送中”。

同一会话的统计气泡另有独立但相邻的数据形态：usage 状态包含模型、输入、输出，后到的 context 状态只包含 Context；两者中间有正文/工具时不会走相邻状态合并，渲染只取最后一个 metric，最终只剩 Context。

## 验收不变量

1. 活动用户轮只接收 `in_flight` 或不早于本轮用户边界的可归属事件。
2. `history` 帧不继承当前活动 room message / agent turn 身份。
3. 同一官方 tool call ID 在整个会话中只渲染一次；已完成状态同样幂等。
4. 整包 canonical 替换仍需覆盖全部唯一工具 ID；分页外历史只可凭本地稳定 `snapshot:` 行清理相同 call ID 的后续副本，不能用去重名义丢失其他本地独有工具。
5. 重试占位与实际请求使用同一模型。
6. 模型、输入、输出、Context 只在同一用户轮内按字段合并，不跨轮借用。

## 实机结果

v2.16.91 构建 `index-CDYdIW8Y.js` 重启并完成 hydration 后：

- 目标会话 `tool_call` 从 237 条降为 114 条，唯一 call ID 也是 114，重复数为 0。
- DOM 不再包含孤立的 `Context: 20.22%` 气泡。
- 后续有真实 usage 的轮次仍完整显示模型、输入、输出与 `Context: 30.17%`。
