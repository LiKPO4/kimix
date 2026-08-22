# 当前轮文件变更误归上一轮事件快照

## 现场

- 用户截图版本：Kimix v2.21.89。
- 可见现象：当前轮仍在运行，正文明确表示将写入 `kimix-ui-style-winxp-bevel.json`；同名文件变更卡（`+311 -0`）却显示在当前用户消息之前、上一轮已完成页脚之前。
- 当前机器持久化状态与官方 sessions 目录中已找不到截图对应文件名和正文，无法恢复该次真实 session / wire 原始记录；以下快照使用截图中的文件名与统计构造最小事件序列，不把缺失的现场数据伪装成真实 SSE。

## 主进程 / 事件流最小快照

该序列保留问题所需的全部归属信息：当前用户边界之后已经存在当前轮 Assistant 和 `Write` 工具，工具派生的 `change_summary` 物理上也位于当前工具之后，但携带了早于当前用户消息的源时间戳。

| 数组位置 | 类型 | id / toolCallId | timestamp | 说明 |
| --- | --- | --- | ---: | --- |
| 0 | `user_message` | `user-old-turn` | 1 | 上一轮用户消息 |
| 1 | `assistant_message` | `assistant-old-turn` | 4 | 上一轮已完成 |
| 2 | `user_message` | `user-current-turn` | 10 | 当前轮用户消息 |
| 3 | `assistant_message` | `assistant-current-turn` | 11 | 当前轮运行中正文 |
| 4 | `tool_call` (`Write`) | `tool-current-write` / `call-current-write` | 12 | 当前轮写入目标文件 |
| 5 | `change_summary` | `call-current-write:change-summary` | 3 | 当前工具派生，物理位置正确但时间戳陈旧 |
| 6 | `diff` | `call-current-write:diff` | 3 | 同一工具派生 diff |

这里没有“SDK 未发送变更”问题：`tool_call`、`change_summary` 和 `diff` 都已进入 UI 时间线，并且派生 id 明确共享 `call-current-write` 来源。

## UI events / renderItems 快照

`buildRenderItems` 入口首先调用 `restoreLateHistoricalChangePlacement`。旧逻辑只检查：尾部 `change_summary.timestamp` 之前是否存在一个更晚的用户消息。由于 `3 < 10`，它把位置 5、6 的当前轮派生事件搬到位置 2 之前，没有检查同源 `tool_call` 位于当前用户消息之后。

错误投影：

| renderItems 顺序 | 载体 | 文件变更归属 |
| --- | --- | --- |
| 1 | 上一轮用户消息 | - |
| 2 | 上一轮 Assistant（已完成） | `kimix-ui-style-winxp-bevel.json +311 -0` |
| 3 | 当前轮用户消息 | - |
| 4 | 当前轮 Assistant（运行中，含 Write 工具） | 无变更卡 |

定向失败测试：

```text
src/utils/__tests__/chatRenderItems.test.ts
keeps a current tool-derived change summary in the current turn when its timestamp is stale

Expected oldAssistant.changeSummary: undefined
Received: kimix-ui-style-winxp-bevel.json (+311/-0)
```

## 根因

根因在 Kimix 渲染归属修复器，不在 SDK/模型：历史快照迟到兼容逻辑把“时间戳更早”当作唯一所有权证据，忽略了派生 id 与当前轮 `toolCallId` 的更强物理来源证据。

修复必须保留旧历史回放能力，同时规定：若 `change_summary` 的派生 source id 能匹配一个位于较晚用户边界之后的 `tool_call`，则工具物理归属优先，不得按陈旧时间戳搬回上一轮。
