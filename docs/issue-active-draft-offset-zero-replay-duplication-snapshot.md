# 流式草稿 offset 0 回放重复：事件快照

记录时间：2026-07-28（Asia/Shanghai）

目标会话：`session_a05a8b17-ceb2-4109-b374-441911a7e9f0`

## 结论

- 官方 wire 中，用户截图里的英文思考片段和中文进度正文在对应轮次都只出现一次。
- 当前源码直接投影该 wire 后，英文思考片段也只有一个，因此重复不是模型重复输出，也不是官方历史重复。
- 安装版 IndexedDB 的 UI 时间线已经持久化了两类重复：
  - 一个 Assistant 内含两个随机 ID 不同、时间戳和 3012 字正文完全相同的 `thinkingParts`。
  - 同一 `agentTurnId=p7zn3w5rz` 下，完全相同的 51 字中文进度被物化为 16 个不同 `active-draft:` 事件。
- 根因是 Kimix 把 turn-global 的 `offset=0` 回放误判为工具边界后的新视觉片段；每次都生成新的 `materializationId`，所以按事件 ID 去重无法识别。

## 主进程 / 官方事件流快照

数据源：

`%USERPROFILE%\.kimi-code\sessions\wd_kimix_90b5212d0d7e\session_a05a8b17-ceb2-4109-b374-441911a7e9f0\agents\main\wire.jsonl`

抽样结果：

| 片段 | 官方 wire 次数 | 当前源码规范投影次数 |
| --- | ---: | ---: |
| `你好霖江路，两个问题分别查证…` | 1 | 1 |
| `Let me check both: where updateState comes from…` | 1 | 1 |
| `Now find where the renderer consumes discoverProviderModels…` | 1 | 1 |
| `Let me check the IPC registration…` | 1 | 1 |

直接对真实 wire 执行 `getSessionHistory → mapHistoryEvents`：

```text
raw events: 2274
mapped events: 1420
target thinking parts: 1
exact duplicate: false
```

这排除了“官方 K3 发了两遍”和“当前 canonical mapper 把一条 wire 记录展开两遍”。

## UI events / renderItems 快照

安装版数据库：

```text
database: kimix-state
key: kimix_local_session_session_a05a8b17-ceb2-4109-b374-441911a7e9f0
events: 3138
```

重复英文思考对应同一个 Assistant：

```text
thinkingParts[0]: random id A, timestamp=1785226258226, textLength=3012
thinkingParts[1]: random id B, timestamp=1785226258226, textLength=3012
text A === text B
```

重复中文进度对应 16 个独立事件：

```text
id prefix: active-draft:
agentTurnId: p7zn3w5rz
content length: 51
content: 完全一致
materializationId: 每条不同
```

运行日志里的 history reconcile 样本还显示本地 Assistant 可见文本按 `+51` 周期增长，与该重复片段长度严格一致。

## 根因

Server 0.29 的 `assistant.delta` / `thinking.delta` offset 是整个 Agent turn 的全局游标，不在工具边界重置。

工具边界调用 `takeActiveTurnDraft` 后：

```text
visible accumulator = empty
turn-global anchor = retained
```

旧逻辑却无条件接受 `offset === 0`：

```text
reconnect/resync replays old turn prefix
  -> treated as a new visual segment
  -> mint new materializationId
  -> persist another active-draft event
```

另一个合并漏洞是：当 `existing thinkingParts` 为空时，`mergeAssistantThinkingParts` 直接返回整批 `incoming`，没有对同一 incoming batch 内部的完整回放做幂等清理。

## 最小复现

1. 用 `offset=0` 写入一段 active draft。
2. 通过 `takeActiveTurnDraft` 模拟工具边界提交；视觉 accumulator 清空，但 turn anchor 保留。
3. 模拟重连，再次发送相同的 `offset=0` 片段。
4. 旧逻辑创建第二个 materialization；重复步骤会持续增加相同事件。

## 修复不变量

- 当前视觉片段仍挂载时，`offset=0` 保持“实时流重启并替换”的原语义。
- 视觉片段已提交且 turn anchor 仍存在时，`offset=0` 是旧前缀回放：保留游标状态但不创建草稿、不生成 materialization。
- authoritative body / clear 重置 anchor 后，下一个流仍可正常从 0 或非 0 offset 建立新基线。
- `thinkingParts` 必须对同一 incoming batch 内的完整重复保持幂等。
- 对已持久化损坏数据，只在相同 room/message/turn 下清理正文与思考完全相同的 `active-draft:` materialization；普通 Assistant 和不同轮次的同文消息必须保留。
