# 根因快照：后台 Bash 运行中会话已收口轮被重开成「执行中」（v2.21.185 实机）

> 日期：2026-09-08。症状：一轮已正常结束（用户已收到最终回复），但 Kimix 对话区该轮卡片仍显示「k3-256k · 执行中 10分14秒」、footer 停「消息处理中」、正文一度不显示，底部状态栏「运行中」；约 90 秒后自愈。

## 结论先行

**用户的假设成立**：根因链路是「该轮派生的后台 Bash（pnpm dev，detached + 无超时）仍在运行 → 官方 server 侧会话状态保持 running → Kimix 的 1.5s 轮询持续走 running-sample 快照调和 → 调和在轮刚收口的竞态窗口里把该轮 canonical 助手强制按未完成合并（reconcileRunningKimiSnapshot 的 hasOpenLocalAssistant 守卫），已 settled 的轮被重开成 running」。不是 SDK/模型没发收口帧。

## 证据链

### 1. wire（SDK 侧）完整收口，无缺失

`wire.jsonl`（本机 CLI 会话）turn 12：

- `step.end(finishReason=end_turn)` time=1788849718172（14:41:58 本地）
- `turn.ended reason=completed durationMs=570520` time=1788849718174
- 最终正文 `content.part text`（「你好霖江路，已修复并提交（494c42ad…」）在收口前已落盘

### 2. Kimix live 流正常收到终态帧并正确 settle

`diag.log`（UTC 06:41 = 本地 14:41）：

- `06:41:58.147` 最后一条 `assistant.delta`（textChars 115, offset 445）
- `06:41:59.765` **terminal 帧 `prompt.completed` 正常到达**（terminal:1）
- `06:41:59.909` display：running → **settled_complete**（isComplete:true, durationMs 570520）——轮次已正确收口

### 3. 100ms 后被重开，随后被状态帧反复「续命」

- `06:42:00.017` display：settled_complete → **running**（同一条 assistant，isComplete 被打回 false）
- `06:42:20` ~ `06:43:24` 反复收到 `agent.status.updated` 状态帧（engine=running）
- silence 采样：wire 层 `latestIsComplete:true`、openAssistants:0，但展示层保持 running
- `06:43:28.432` display：running → settled_complete 自愈（同一时刻后台任务完成通知轮 0NZ8TVSQ 开始，带来新的权威快照）
- 用户截图时刻（14:42:41）正落在 06:42:00–06:43:28 这个重开窗内

### 4. 重开代码点

- `src/utils/kimiCodeSnapshotReplay.ts:381-386`：`reconcileRunningKimiSnapshot` 中「本地存在未完成助手时，当前轮 canonical 助手一律 isComplete:false 合并」——为防提前关闭而设，但在「调和开始时本地助手尚未 settle、应用时已 settle」的竞态窗口里会把刚收口的轮重开。
- 调和的触发源：`src/App.tsx:4042` `reconcileRuntimeStatus` 1.5s 轮询；只要 server 报会话 running（后台 Bash 未退出），running-sample 调和就会持续执行，不断提供重开机会。
- 相关闸门：`runtimeStatusTimeline.ts` 的 `shouldAppendRuntimeStatusToTimeline`、`kimiCodeHost.ts:3737` 的 live 帧守卫（快照重放帧不计轮次活动）——这些都没拦住「重开」这条路。

## 影响面与边界

- 仅影响「轮次派生了长时后台任务且未退出」的会话（dev 实例、长测试等 detached/disable_timeout 任务）。无后台任务的轮次：turn.ended → settle，无重开。
- 自愈条件：下一个真实事件（后台任务完成通知轮、用户新 prompt）带来权威快照后恢复正常；手动刷新页面也会恢复（快照重放按 wire 收口态渲染）。
- 底部「运行中」在该窗口内也反映 server 侧 running，部分是真实状态（后台任务确实在跑），但轮次卡片显示「执行中」是假的。

## 修复方向（待实施）

最小修法二选一或组合：

1. **调和应用时重读本地状态**：`reconcileRunningKimiSnapshot` 的 hasOpenLocalAssistant 在「应用更新」时重新判定（而非用调和开始时的快照），或增加「本地该轮已有真实 TurnEnd（非合成）则不得重开」的硬守卫——完成态只能由真实 turn 结束事件授予，同样也只能被真实新活动重开。
2. **状态帧不再驱动轮次重开**：background 运行期间的 `agent.status.updated`/running-sample 只允许更新 footer/状态栏，不得把 `isComplete:true` 的助手改回 false。

建议选 1 的硬守卫版本：语义最贴近「TurnEnd 是收口的唯一权威」。
