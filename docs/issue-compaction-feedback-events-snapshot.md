# 上下文压缩反馈事件快照

日期：2026-07-26

## 现象

- 背景信息窗口可能在数秒后显示“压缩失败”，但 Server 后台仍继续执行。
- 手动发送 `/compact 保留本轮测试结果和待办` 后只显示用户消息，Kimix 不展示成功终态。

## 主进程 / 官方 wire 快照

目标会话的官方 `wire.jsonl`：

```json
{"type":"full_compaction.begin","source":"manual","instruction":"保留本轮测试结果和待办","time":1785020570780}
{"type":"full_compaction.complete","time":1785020631378}
```

本次手动压缩实际耗时约 60.6 秒，并成功完成；界面上下文占用从约 24.87% 降至 21.40%。

历史会话还确认了自动压缩的取消终态：

```json
{"type":"full_compaction.begin","source":"auto","time":1783602216903}
{"type":"full_compaction.cancel","time":1783602219240}
```

## UI events / renderItems 快照

修复前的解析和映射结果：

```text
parseKimiCodeRecord(full_compaction.begin)    -> null
parseKimiCodeRecord(full_compaction.complete) -> null
mapStreamEvent(full_compaction.begin)         -> null
mapStreamEvent(full_compaction.complete)      -> null
renderItems                                   -> 无 compaction 项
```

因此官方事件已经存在于 wire，但实时 UI 和重启后的历史恢复都会丢弃它们。Kimix 仅识别旧命名
`compaction.started`、`compaction.completed`、`compaction.cancelled`。

另一个独立问题是 `:compact` HTTP 请求沿用 5 秒控制接口超时，而实际压缩可能持续数十秒，
会出现客户端先报失败、Server 后台随后完成的假失败。

## 最小修复

- 同时识别 `full_compaction.begin`、`full_compaction.complete`、`full_compaction.cancel`。
- 压缩请求使用 120 秒长任务超时。
- 背景信息窗口区分“压缩处理中”“压缩完成”和“压缩失败”，并保留 8 秒的具体失败原因。
- `/compact` 收到接口确认后追加“上下文压缩请求已提交。”；真正完成或取消由官方终态事件反馈。
