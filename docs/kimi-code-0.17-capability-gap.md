# Kimi Code 0.17.1 能力差距盘点

基准：官方 `@moonshot-ai/kimi-code@0.17.1`（commit `55f865642f18768ac0ae5d0ac236f617f79c4ff1`）。

## 结论

0.17.0 的核心新增是 Kimi Code Web，以及支撑 Web 的本地 REST / WebSocket Server。Kimix 已完成 Server 主链路和恢复能力，并将兼容探测通过的 Server 设为新安装默认路由；显式关闭和失败自动 SDK fallback 仍保留。

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
- Server Skill list / activate 已接入现有 Skills 页和 `/skill:name 参数` 入口；SDK 会话继续走同名官方 SDK 方法。
- Server MCP list / restart 已接入现有 MCP 页，展示当前会话的真实连接状态、工具数和错误，并支持按服务 ID 重启。
- 真实 0.17.1 探针已验证：会话发现 13 个 Skill，项目探针 Skill 激活成功；MCP 返回 1 个 connected 服务和 2 个工具；不存在服务的 restart 返回官方 `40408`。
- 右侧会话栏已接 Server 会话树：展示当前节点、fork 分支和直接 child，支持刷新、新建 child、载入历史并切换。官方 `/children` 不包含 `:fork`，Kimix 使用创建 fork 时写入的 `metadata.forkedFrom` 合并关系。
- 真实会话树探针已验证：官方 child 可列出和恢复；fork 不进入官方 children，但 `forkedFrom` 元数据可稳定识别，合并后得到 2 个关联节点。
- Server tool catalog 与 connections 已合并为只读运行时诊断：MCP 页展示会话有效工具、builtin/Skill/MCP 来源分布、MCP 状态和当前订阅连接；右侧 Kimi 自检复用同一诊断结果。
- 真实 0.17.1 探针已验证：当前会话返回 26 个 builtin 工具；WebSocket 完成 `client_hello` 后，connections 返回 1 个客户端且正确订阅当前 session。
- Server auth / redacted config / model catalog / provider catalog 已接入设置页只读运行时目录；现有 SDK 模型配置和默认模型写入继续作为正式链路。
- 每次 prompt 提交结果会回传真实路由，聊天链路状态可区分 Kimi Server、Kimi SDK 和 Server 失败后 SDK fallback。
- 真实 0.17.1 探针已验证：认证 ready，1 个 connected OAuth Provider，模型 `kimi-code/kimi-for-coding` 的 context 为 262144，并返回 thinking、image/video input、tool use 等能力。

## B. 后端已有基础，产品入口仍不完整

- background tasks：主进程和长程任务侧栏已桥接；展示 Server/SDK 来源与 Server 输出尾部，运行态 2 秒刷新，刷新失败保留上次成功快照。
- terminal：接口已接；Windows 0.17.1 缺少可加载的 `conpty.node`，当前无法完成真实创建。
- Server session routing：新安装默认开启；设置页可显式关闭，环境变量设为 `0` 可强制关闭，能力探测或请求失败自动回退 SDK。

## C. 官方 Server 尚未完整接入

按用户价值排序：

1. files / workspace fs：上传文件、读取、搜索、grep、git status/diff、open/reveal 等 REST 尚未接入。
2. messages / prompts：已在 Kimi 自检接入只读摘要；最近消息数量/角色分布、active/queued prompt 可诊断，不回灌正文或形成第二套历史。

## D. 延后或阻塞

- terminal 实机：等待官方 Windows native 模块修复。
- OAuth Server 写链路：本机 `POST /api/v1/oauth/login` 超过 10 秒仍无响应；官方实现会等待 device code 且请求断开未中止后台流程。Kimix 暂保留已验证的 SDK 登录入口，避免设置页请求挂起。
- Server 默认化已完成代码与自动化验证，仍需用户完成一次新会话、旧会话和手动关闭后的实例验收。
- 官方 0.17.1 只提供 archive、没有 unarchive；设置页“恢复归档”仍是 Kimix 本地恢复，不会反向取消官方归档标记。
- 文件系统 REST：Kimix 已有 Electron 本地文件能力，除非需要浏览器/远程 Server 场景，否则边际收益低于会话能力。

## 推荐推进顺序

1. 评估模型目录对现有模型设置的只读增强。
2. files/workspace 等低边际能力暂不推进。
