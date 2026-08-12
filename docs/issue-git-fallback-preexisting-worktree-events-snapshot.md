# Git fallback pre-existing worktree snapshot

## 现场

- UI 会话：新会话只发送“你好”，回复完成后错误显示 `文件变更 154 个 +43891 -0`。
- 官方 runtime：`session_cfa8b107-3980-46dc-bda4-fa95ca1f56b5`。
- 工作目录：`D:/WORKS/LuaProjects/LuaSource_超级跑酷公司`。

## 官方 wire 事件

对应 `agents/main/wire.jsonl` 的业务事件序列为：

| 顺序 | 类型 | 说明 |
| --- | --- | --- |
| 1 | `turn.prompt` | 用户输入“你好” |
| 2 | `context.append_message` | 写入用户消息 |
| 3 | `step.begin` | 开始生成 |
| 4 | `llm.request` | `deepseek-v4-flash`，messageCount=1 |
| 5 | `usage.record` | 用量 |
| 6 | `content.part(think)` | 明确判断“简单问候，不需要使用任何工具” |
| 7 | `content.part(text)` | 问候正文 |
| 8 | `step.end` | 结束步骤 |
| 9 | `turn.ended` | completed |

该轮没有 tool call、Write、Edit、Bash、patch 或 diff 事件，因此官方事件没有声明任何文件变更。

## Git 现场

问题会话结束后仓库仍包含大量会话开始前已存在的暂存/未跟踪内容，例如 `.agents/skills/**` 与 `AGENTS.md`。旧实现于轮次结束时调用 `getGitNumstat()`，读取的是整个工作区相对 HEAD 的累计快照，再用聊天历史里已记录的路径排除。新会话历史为空，因此累计脏状态全部被误归为本轮变更。

## UI 层根因

`App.reconcileGitFallbackChanges` 没有轮次开始 Git 基线。`planGitFallbackChanges(events, numstat)` 只能判断“此前是否展示过”，不能判断“是否由本轮产生”，因此新会话必然放大误报。

修正后的最小事件序列：

1. 主进程 `kimi-code:sendPrompt` 在 prompt hooks/runtime dispatch 前读取 Git numstat，并发送 `kimix.turn.git-baseline`。
2. renderer 将基线绑定到同一 runtime turn。
3. completed 时读取结束 HEAD + numstat；HEAD 未变化时仅对基线与结束快照的净增量做 fallback。
4. 没有可信发送前基线时关闭 Git fallback；Write/Edit/diff 等官方工具事件仍照常展示。
5. 若本轮执行 commit/rebase/reset 导致 HEAD 变化，两个 numstat 不再共享参照系，该轮同样关闭 fallback，避免制造反向巨量变更。
