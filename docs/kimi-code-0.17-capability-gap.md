# Kimi Code 0.17.1 能力差距盘点

基准：官方 `@moonshot-ai/kimi-code@0.17.1`（commit `55f865642f18768ac0ae5d0ac236f617f79c4ff1`）。

## 结论

0.17.0 的核心新增是 Kimi Code Web，以及支撑 Web 的本地 REST / WebSocket Server。Kimix 已完成 Server 主链路和恢复能力，但尚未覆盖全部 REST 能力，也还没有把 Server 路由作为默认链路。

## A. 已接入并验证

- Server host、health/meta/auth、OpenAPI/AsyncAPI 探测。
- 会话创建、恢复、列表、重命名、派生、子会话列表与创建。
- prompt、steer、abort，模型、thinking、权限、Plan 控制。
- WebSocket 订阅、游标、重连、replay、resync 和 snapshot 恢复。
- approval、question、usage、后台 task、terminal 协议接入。
- snapshot 历史去重与进行中正文恢复。
- Server task 重复取消的官方 `40904 already finished` 兼容。
- Server 会话的 `compact` 与 `undo` 已复用 Kimix 现有 `/compact`、`/undo` 入口。
- Server BTW 已按官方 `agent_id` 隔离 WebSocket 事件并汇总正文、思考和结束原因，复用现有 BTW 面板。
- Kimix 本地归档迁移会同步调用 Server `session:archive`，并继续写入本地 tombstone 防止历史恢复回流。
- Server session status 会在会话注册和 prompt 完成后回填 context tokens/limit/usage，并复用现有 ContextRing。

## B. 后端已有基础，产品入口仍不完整

- fork / children：主进程和 preload 已接，尚无完整会话树 UI。
- background tasks：主进程和现有长程任务侧栏已有桥接，但 Server task 的实时输出、失败恢复提示仍可加强。
- terminal：接口已接；Windows 0.17.1 缺少可加载的 `conpty.node`，当前无法完成真实创建。
- Server session routing：仍受 `KIMIX_EXPERIMENTAL_KIMI_SERVER=1` 与 `KIMIX_EXPERIMENTAL_KIMI_SERVER_SESSIONS=1` 控制。

## C. 官方 Server 尚未完整接入

按用户价值排序：

1. skills：Server 的 list / activate 尚未接入；当前仍走 SDK Skill 能力。
2. tools / MCP：Server 的 tools、MCP server list/restart 尚未接入；当前仍走 SDK/配置链路。
3. model catalog / config / OAuth：Server API 尚未取代现有 SDK 配置和登录链路。
4. files / workspace fs：上传文件、读取、搜索、grep、git status/diff、open/reveal 等 REST 尚未接入。
5. messages / prompts：分页读取单条消息和 prompt 队列查询尚未作为独立能力暴露。
6. connections：连接列表只在探针层验证，尚无诊断入口。

## D. 延后或阻塞

- terminal 实机：等待官方 Windows native 模块修复。
- Server 默认化：需先完成 BTW、归档同步、状态字段回环和一轮 UI 回归，再考虑灰度扩大。
- 官方 0.17.1 只提供 archive、没有 unarchive；设置页“恢复归档”仍是 Kimix 本地恢复，不会反向取消官方归档标记。
- 文件系统 REST：Kimix 已有 Electron 本地文件能力，除非需要浏览器/远程 Server 场景，否则边际收益低于会话能力。

## 推荐推进顺序

1. Server Skill / MCP 状态与现有管理页统一。
2. 会话树（fork / children）正式 UI。
3. 再评估文件系统、connections、独立 prompt/message 查询等边际能力。
