# v2.21.19 流式正文完成时重复：事件快照

## 现场

- UI 会话：`session_8a50c19b-43b5-4669-83e7-709866228f79`
- Agent turn：`agent-turn:0x9v5vosp`
- 用户 prompt：`msg_01KZKBVPYGA1F4C1GEZFHC8JV3`
- 官方 Assistant：`msg_session_8a50c19b-43b5-4669-83e7-709866228f79_000013`

## 主进程事件序列

1. `13:37:15.166Z` 至 `13:37:17.156Z`：volatile `assistant.delta` 的 offset 从 `0` 连续增长到 `128`，无缺口、无回退；active draft 最终正文为 128 字。
2. `13:37:17.236Z`：收到主 Agent `turn.ended`。
3. `13:37:17.263Z`：收到 `prompt.completed`，完成屏障读取 `/messages`。
4. `/messages` 中本轮只有一个 Assistant 消息；其所有 text part 串联后也是 128 字，不存在服务端双正文。
5. `13:37:17.387Z`：UI 正式时间线却显示 `textChars=285`；`13:37:17.416Z` 以同样的 285 字进入完成态。
6. `13:37:19.910Z`：canonical repair 接受官方历史；`13:37:19.924Z` UI 恢复为 128 字。

## 根因

volatile live draft 没有 `snapshotMessageId`，完成屏障帧则第一次携带稳定的官方消息 ID。`mergeEvents` 因此不会进入“同稳定 ID”分支，而会进入 completion binding 分支，把官方消息 ID 绑定到 live draft。v2.21.19 只在前一个分支识别 `completionBarrierFullBody`；binding 分支仍调用旧的覆盖/追加启发式，因 live 与落库正文在分片/空白上不完全相同而执行追加，得到约双倍正文。canonical repair 随后整体替换，所以重复只短暂存在。

## 修复不变量

完成屏障的 `completionBarrierFullBody` 在两种身份路径都必须表示整体替换：

- 已有相同稳定 `snapshotMessageId`；
- live draft 首次绑定稳定 `snapshotMessageId`。

普通 delta、非完整 barrier part 和不同 Assistant 消息仍不得整体覆盖。
