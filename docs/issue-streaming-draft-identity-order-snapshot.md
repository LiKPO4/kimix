# 流式正文身份切换倒序快照

## 现象

- UI 运行中：`霖江路。我会你好补上换模型后的焦点归还…`
- 同一回复结束后：`你好霖江路。我会补上换模型后的焦点归还…`
- 发生会话：`session_259f8e2c-6581-49fa-9f08-20a190878d03`

## 主进程 / 官方历史证据

官方 wire：

`C:\Users\Administrator\.kimi-code\sessions\wd_kimix_90b5212d0d7e\session_259f8e2c-6581-49fa-9f08-20a190878d03\agents\main\wire.jsonl`

turn 5 / step 1 的持久化 `content.part` 为：

```text
你好霖江路。我会补上换模型后的焦点归还，并在 AGENTS.md 写明提交信息用中文。
```

turn 5 / step 11 的最终正文同样以 `你好霖江路。` 开头。官方持久化正文没有倒序，问题只存在于 Kimix 的实时草稿投影。

## UI 草稿最小复现

同一 `roomMessageId` 在首 token 后由本地占位 turn identity 切到官方 turn identity：

```text
draft(session, agent, turn-local)    = "你好"
draft(session, agent, turn-official) = "霖江路。我会补上…"
```

旧 `commitActiveTurnDraftsToBatch` 依次对同一 batch 执行 `unshift`，物理数组变为：

```text
["霖江路。我会补上…", "你好", boundary]
```

随后 `mergeEvents` 得到截图中的倒序正文。终态完整正文走权威 REPLACE，所以结束后恢复正常。

## 修复不变量

1. session、room Agent、`roomMessageId` 相同但 `agentTurnId` 变强时，迁移同一草稿，不创建第二个正文缓冲。
2. 多草稿提交先按创建顺序收集，再整体放到边界事件前；禁止循环 `unshift`。
3. 权威 completion/snapshot/barrier 正文仍走 REPLACE，不改变终态单调性规则。

## 回归测试

- `src/utils/__tests__/activeTurnDraftStore.test.ts`：同 room message 的 turn identity 切换后只剩一个新 key，正文保持 `你好` 在前。
- `src/hooks/__tests__/useEventStream.test.ts`：即使存在两个独立草稿，提交顺序仍为先到先出。
