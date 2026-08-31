# 旧会话重开后误显示“执行中”事件快照

记录时间：2026-08-31（Asia/Shanghai）

## 复现对象

- Kimix 会话：`session_b9886daf-acd5-4be5-8d2e-e55dfa0570bc`
- 官方 runtime：同一 session id（日志中缩写为 `fa0570bc`）
- 现场版本：`v2.21.158`
- 用户可见现象：旧会话显示 `k3-256k · 执行中 913分18秒`，并持续增长。

## 主进程 / 官方事件流

通过当前 Electron 实例的 CDP 调用 `window.api.loadKimiCodeSession` 与 `window.api.getKimiCodeStatus`：

| 原始历史索引 | 事件 | 官方时间 | turn / agent | 证据 |
| --- | --- | --- | --- | --- |
| 3379 | `ContentPart`（assistant text） | 2026-08-30T20:21:15.849+08:00 | turn 26 / main | 最终正文存在 |
| 3380 | `TurnEnd` | 2026-08-30T20:21:15.849+08:00 | turn 26 / main | `finishReason=end_turn` |
| 3381 | `turn.ended` | 2026-08-30T20:21:15.850+08:00 | turn 26 / main | 官方回合结束 |

同次检查的 `getKimiCodeStatus` 返回 `engineStatus=idle`。因此 SDK/Server 已终止，不是模型仍在执行。

`diag.log` 的同一启动序列进一步显示：

- `2026-08-31T03:25:59.245Z`：收到多条历史 `turn.ended`。
- `2026-08-31T03:25:59.325Z`：权威轮询为 `engine=idle`。
- `2026-08-31T03:26:00.380Z`：UI 却投影为 `thinking`，`isComplete=false`、`active=true`、`wallElapsedMs=54,782,642`。
- `54,782,642ms = 913.04 分钟`，与截图时间一致。

## UI events / renderItems 快照

IndexedDB `kimix-state/state` 中该会话共有 2389 个本地事件，`officialLastTurnReason=completed`，尾部同时存在：

1. 已完成的 canonical assistant：`x7qez5hz6`，时间 `2026-08-30T20:21:15.849+08:00`，`isComplete=true`，正文长度 860，`durationMs=498121`。
2. 随启动历史回放追加的同正文 assistant：`kimi-code-event-1788146762321-140`，原始时间 `2026-08-30T20:20:58.997+08:00`，`isComplete=false`，正文长度 860。
3. 启动时追加的状态事件：`kimi-code-event-1788146762333-141`。

诊断投影先在 `03:26:02.482Z` 显示 canonical 行为 `settled_complete`，随后在 `03:26:02.525Z` 被回放残留覆盖为 `running`。紧接着 repair 因 `assistant-body-regression` 拒绝用较短 canonical 替换本地较丰富时间线，未能自愈。

## 根因判定

这是 Kimix 的恢复与投影错误，不是 SDK/模型缺少终态：

1. 新进程 `registerServerSession` 从 `getSession()` 继承了上一进程残留的 `running`，fresh REST `/status` 虽已是 `idle`，却没有覆盖 `managed.status`，导致恢复期间短暂广播旧运行态。
2. `recoverSnapshot` 会回放完整历史；旧运行态让历史 tool/body 再次进入活动投影。之后的 fresh `idle` 没有作为恢复收敛信号清掉 room activity。
3. 侧栏选择会话的缓存快速路径与 canonical 合并路径只收敛历史提问，没有在权威终态下收敛最终事件集里的陈旧 assistant/tool 状态。
4. `ChatThread` 因残留 `assistant.isComplete=false` / `tool.status=running` 判定 turn 未结束；`MessageBubble` 从旧 `event.timestamp` 计算 `Date.now() - start`，于是产生数百分钟且不断增长的“执行中”。

## 修复边界

- 新绑定首次 fresh 状态覆盖进程外遗留状态；进程内真实 turn 的 continuation grace 仍保留。
- `idle` 只执行恢复收敛，不触发旧会话的完成通知或排队消息派发。
- 侧栏在最终合并结果上按 fresh runtime 状态收敛，不能只处理 canonical 中间值。
- guarded settle 保留两分钟内的真实流式窗口；超过窗口的未完成 assistant/running tool 才作为历史残留收尾。
