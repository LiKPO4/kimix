# 模型切换后回退与错误路由：事件快照

日期：2026-07-19
目标会话：`session_01ea935b-5c5d-455a-a6aa-b8e9b2dbdefb`

## 现象

用户在 Kimix 将模型从 Flash 切换为 Pro 后发送消息。界面随后把消息头和底部模型选择器都显示为 `deepseek-v4-flash`；本轮等待较久后才出现回复，回复头仍显示 Flash。

## 主进程 / 官方 Server 快照

| 证据 | 结果 |
| --- | --- |
| Kimi Code Server 版本 | 0.27.0 |
| 会话 profile/status 的权威模型 | `opencode-go/deepseek-v4-pro` |
| 用户 prompt ID | `msg_01KXXFJ4EMYVADX4971JQQPTGS` |
| prompt 创建时间 | `2026-07-19T15:22:51.221Z` |
| 问题出现后的 Server 模型 | 仍为 Pro |

隔离探针另建会话执行 Flash → Pro → 立即发送。profile/status 与所有携带 model 的 WebSocket 帧均为 Pro，未观察到官方 Server 自动切回 Flash。

## Renderer 快照

- 问题截图中，本轮 Assistant 头和底部选择器同时显示 `deepseek-v4-flash`。
- 发送后诊断日志出现 `running-sample` canonical reconciliation。
- 旧实现的 `useEventStream` 与 `reconcileAgentCanonicalHistory` 会从历史 Assistant/status 事件读取模型，再写回 `session.model` 或 Agent `modelAlias`。
- 模型菜单在官方 mutation 完成前通过 `switchedToModel` 显示 Pro，但旧 prompt 构造只读取已提交的 `modelAlias`；快速发送可因此仍携带 Flash。

## 根因裁决

官方 Server 模型切换协议正常。故障属于 Kimix 的模型所有权与并发顺序错误：

1. 历史轮次的模型被错误当成当前会话模型，晚到的 Flash 历史可覆盖刚选中的 Pro。
2. 后台 `/status` 请求没有模型 revision 门禁，切换前发出的旧响应可能在切换后回写 Flash。
3. 切换中的 UI 目标模型与 prompt 使用模型不是同一份值，存在“界面已显示 Pro、prompt 仍锁定 Flash”的窗口。
4. 恢复链路把历史 `modelSwitchedAt` 当成仍在切换的证据，使旧本地 Flash 有机会压过恢复结果中的官方 Pro。

## 修复不变量

- 官方 session/profile status 是当前模型的首要权威；本地显式选择是离线回退，历史事件只归属其对应轮次。
- renderer 为每个 prompt 明确传递 `switchedToModel ?? modelAlias`，重试不得改变。
- Host 按 session 串行模型 mutation，并把该 prompt 模型用于 Server controls。
- status 刷新仅在 model revision 未变化且无 mutation 时接纳模型；旧响应不得对外暴露旧模型。
- 启动恢复和侧栏选择必须用官方 runtime model 修复旧版本留下的本地错误值。

快照只记录事件类型、身份、时间和模型元数据，不包含 token、正文、密钥或完整配置。
