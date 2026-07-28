# 官方 Web 会话模型被覆盖与自动压缩失败：事件快照

记录时间：2026-07-28（Asia/Shanghai）

目标会话：`session_a05a8b17-ceb2-4109-b374-441911a7e9f0`

## 结论

- 该会话进入 Kimix 前，官方历史最近 20 条 `usage.record` 均为 `kimi-code/k3`，不是 DeepSeek。
- `opencode-go/deepseek-v4-pro` 来自 Kimix 的恢复链路：恢复结果没有返回官方 `/status.model`，随后重连逻辑把全局默认模型当成会话模型写回官方会话。
- 自动上下文压缩由官方 Kimi daemon 执行。Kimix 只发起手动压缩请求、转发事件并渲染结果，没有自研自动摘要算法。
- 本次自动压缩沿用了已被覆盖的代理模型；代理 Provider 先后返回 413 和 400，官方 daemon 最终写出 `full_compaction.cancel`。

## 主进程 / 官方事件流快照

数据源：

- `%USERPROFILE%\.kimi-code\sessions\wd_kimix_90b5212d0d7e\session_a05a8b17-ceb2-4109-b374-441911a7e9f0\wire.jsonl`
- `%USERPROFILE%\.kimi\logs\kimi-code.log`
- 官方 Server `GET /api/v1/sessions/{sessionId}/status`

关键序列：

| 时间（UTC） | 事件 | 关键字段 |
| --- | --- | --- |
| 2026-07-28 06:23:44 | `config.update` | `modelAlias=opencode-go/deepseek-v4-pro` |
| 2026-07-28 06:23:44 | `config.update` | `thinkingEffort=high` |
| 2026-07-28 06:23:44 | `llm.request` | provider=`openai`，model=`deepseek-v4-pro`，messages=`1027` |
| 2026-07-28 06:23:53 | Provider 错误 | `413 Upstream request failed` |
| 随后 | `full_compaction.begin` | `source=auto` |
| 随后 | 压缩请求 | `1028` messages，返回 413 |
| 随后 | 压缩重试 | 丢弃 246 条后剩 `782` messages，返回 `400 Error from provider (Console Go): Upstream request failed` |
| 2026-07-28 06:24:08 | `full_compaction.cancel` | 官方自动压缩终止 |

当前官方 `/status` 返回 `model=kimi-code/k3`、`context_tokens=570000`、`max_context_tokens=1048576`。会话对象的 `agent_config.model` 为空，因此恢复时必须读取 `/status.model`，不能用 Kimix 全局默认模型补写已有会话。

## UI events / renderItems 快照

映射前：

```text
full_compaction.begin(source=auto)
full_compaction.cancel(source absent)
```

旧映射后：

```text
CompactionEvent(phase=begin, source lost)
CompactionEvent(phase=end, outcome=cancelled, source absent)
```

因此渲染层只能显示“上下文压缩已取消”，无法区分用户取消和自动压缩失败。

修复后的不变量：

```text
full_compaction.begin(source=auto)
  -> CompactionEvent(begin, source=auto)
  -> merge terminal event
  -> CompactionEvent(end, outcome=cancelled, source=auto)
  -> 持久显示“自动上下文压缩失败”
```

## 最小复现

1. 全局默认模型设为 `opencode-go/deepseek-v4-pro`。
2. 在官方 Kimi Code Web 创建并以 `kimi-code/k3` 对话。
3. 在 Kimix 中恢复该会话，恢复接口只返回 sessionId/workDir/status，不返回模型。
4. Kimix 使用本地/全局默认模型继续发送。
5. 主进程发现期望模型与托管模型不同，调用官方 profile 更新接口，将 DeepSeek 写回会话。
6. 上下文达到阈值后，官方 daemon 使用当前会话模型自动压缩；Provider 拒绝后发出 `full_compaction.cancel`。

## 修复边界

- 恢复已有官方会话时，`/status.model` 是模型权威来源；全局默认模型只用于新建会话。
- 只有明确传入的模型选择才允许修改已恢复会话的官方 profile。
- 自动压缩算法、触发阈值与摘要请求继续由官方 daemon 负责。
- 本轮不增加“首 token 等待过久”提示。
