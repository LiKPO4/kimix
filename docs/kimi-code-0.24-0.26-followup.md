# Kimi Code 0.24–0.26 跟进记录

日期：2026-07-16

## 范围与背景

- 跟进跨度：vendored SDK `0.23.5` → `0.26.0`；跟进文档自 `0.22` 后断档。
- 官方 0.24.0 起 `kimi server run` / `kimi web` 默认 agent-core-v2 引擎，v1 server 包与 `@moonshot-ai/server-e2e` 场景包整体移除。
- 本机 CLI 已自动更新到 `0.26.0`，即 Kimix 生产 Server 路由在评审前已运行在 v2 上，本轮为补评审 + 修断代。
- 证据文件：`docs/kimi-code-server-probe-result.md`（6 通过 / 0 失败 / 4 跳过）、`docs/kimi-code-0.26-subagent-probe.md`（10 通过 / 0 失败）。

## 发现并修复的生产断代（P0）

### 1. WebSocket 鉴权方式更换

- v2 WS upgrade 只认 `Authorization` 头或 `kimi-code.bearer.<token>` 子协议，**不再读取 `?token=` 查询参数**（`kap-server/src/start.ts`、`transport/ws/bearerProtocol.ts`）。
- Kimix 生产客户端原只用查询参数 → 对 0.24+ 服务器 WS 握手 401，全部 WS 依赖流程失效。
- 修复：`electron/kimiCodeServerClient.ts` 连接时同时提供 `?token=`（兼容 ≤0.23 v1 网关）与 bearer 子协议。实测：子协议 OPEN 且服务端回选，查询参数 401。

### 2. create 路由不再消费 `agent_config`

- v2 `POST /sessions` 只读 `metadata.cwd` / `workspace_id` / `title`，**静默丢弃 `agent_config`**；会话停留在无模型状态，首个 prompt 以 `model.not_configured` 硬失败（config 的 `default_model` 也不再兜底）。
- Kimix createSession 原只在 create 时携带 agent_config → 0.24+ 上新建 Server 会话首轮必失败。
- 修复：`KimiCodeServerClient.createSession` 在 create 成功后用同一 agent_config 再调 `POST /sessions/{id}/profile`（旧版本上为幂等冗余）。实测 profile 路径 turn 正常完成。

### 3. Host 能力探测未带鉴权

- v2 对全部 `/api/*` 以及 `/openapi.json`、`/asyncapi.json` 强制 bearer 鉴权（0.25.0 同时修了百分号编码路径绕过与 fs 符号链接逃逸）。
- `KimiCodeServerHost.probe()` 原不带 token → `/meta` 401 → 能力门永远失败 → 启动即整体降级 SDK 路由。
- 修复：Host 读取 `~/.kimi-code/server.token` 并对全部探测请求附加 `authorization` / `x-kimi-server-token`。实测能力门 0.26.0 全量通过（openapi 66 条路径，REQUIRED_PATHS 全存在）。

### 4. 0.24+ 单例锁与 Windows 死 pid 误判

- v2 用 `<KIMI_CODE_HOME>/server/lock` 强制单实例；`kimi server run` 在活锁下直接退出（code 2）。
- 上游 `lock.ts` 用 `process.kill(pid, 0)` 判活，**Windows 上死 pid 被误判存活**（本机实测：pid 已不存在，Node 仍返回成功），导致死锁文件永久阻塞启动，只能手动删锁。
- 修复：`KimiCodeServerHost.start()` 增加锁感知——活实例则按锁记录的 host/port 直连 attach；死 pid（Windows 用 tasklist 确定性确认）则清锁后正常 spawn。两条路径均实测通过。
- 顺带修复同文件 `stop()` 的空指针：shutdown 成功后 close 回调已将 `this.child` 置空，后续解引用崩溃（既有 bug，验证时暴露）。

### 5. 探针基础设施适配

- `scripts/probe-kimi-code-server.mjs`：REST/WS 鉴权、profile 应用、BTW 前先引导主 agent（v2 主 agent 惰性创建，`:btw` 要求 source agent 已存在）、openapi/asyncapi 带鉴权、官方 e2e 包缺失时显式跳过、报告版本号动态化。
- 新增常驻 `scripts/probe-kimi-code-server-subagent.mjs`：子代理/工具事件流探针。

## 已验证兼容（无需改动）

- **REST/WS 主干**：会话 create/snapshot（snapshot 新增 `subagents` 键）、history replay、BTW 归属、tasks list/get/cancel（`kind:"bash"`、重复 cancel 40904 幂等）全部保持。
- **子代理投影**：`subagent.spawned/started/completed` 字段（subagentId/subagentName/parentToolCallId/parentAgentId/callerAgentId）满足 Kimix 18c/18d 假设；嵌套帧按 subagentId 归属；0.26.0 的 coder 子代理扩展（后台任务/Todo/plan/嵌套 agent）不改变事件拼写。
- **工具事件**：v2 线上拼写为 `tool.call.started` + `tool.call.delta` + `tool.result`；`tool.call` 仅存在于 `context.append_loop_event` 历史内。Kimix 映射器两种都支持。
- **后台任务事件**：v2 发 `task.started/terminated`，广播器自动改写为旧名 `background.task.*`；Kimix 只走 `/tasks` REST，不消费 WS 任务帧。
- **AskUserQuestion**：线上 5-kind 答案 union 含 `skipped`；id→label 翻译由 server 完成；dismiss=不回答（0.23.6 语义）与 Kimix skipped 路径一致；Kimix 按 id 或 label 双匹配选项，与 0.23.0 label 回填兼容。
- **tool-select**：`experimental["tool-select"]` 旗标与 `select_tools` 工具名不变；模型能力词表改名 `dynamically_loaded_tools`，设置页徽章已做双名兼容。k3 目录已带 `support_efforts`/`default_effort`。
- **模型目录**：`/models` 条目字段为 `{provider, model, display_name, max_context_size, capabilities?}`（无 `id`/`alias`），`/meta` 自报 `server_version`/`capabilities`/`backend:"v2"`。
- **vendored SDK 0.26.0**（node-sdk 0.13.4，tag `@moonshot-ai/kimi-code@0.26.0`，commit `36b05820`）：宿主冒烟探针通过（完整 turn + skill 激活 + cancel 闭环）、会话导出探针通过、managed usage 正常。`getBackgroundTaskOutputPath` 在 0.23.5 起即缺失，非回归；图片压缩导出（`compressImageForModel`/`compressBase64ForModel`）与 MCP 超时补丁均在。
- **全量回归**：`pnpm typecheck` 通过；vitest 101 文件 777 项全过。

## 行为变化记录（留意，无需改动）

- 重试预算默认 3→10（`loop_control.max_retries_per_step`）；前台 Bash 超时自动转后台（`[background] bash_auto_background_on_timeout`）；coder 子代理等后台任务收尾后才报完成（0.26.0）。
- `prompt_id` 采用 `msg_` 前缀；`prompt.completed` 载荷为 camelCase `promptId`。
- resume 不再误刷 `updated_at`（0.26.0 #1784），与 Kimix 既有"按真实活动排序"不变量方向一致。

### 6. exclude_empty 语义收紧导致新建会话秒消

- v2 的 `exclude_empty=true` 会**立即**滤出刚创建的空会话（v1 不过滤）；Kimix 对账把"不在官方列表"的 Server 镜像一律本地归档，新建会话存活约 1 秒即被隐藏（创建宽限期在 Server 权威分支被绕过）。
- 修复：`sessionCatalog.ts` 归档扫描对创建宽限期（5 分钟）内的镜像豁免，仅凭显式归档证据（官方归档目录）处理；新增 2 个回归测试。
- 顺带：创建会话失败此前被静默吞掉，现在渲染层直接 toast 真实错误；`kimi-code:startRuntime` 失败写主进程日志。

## 遗留跟进项

1. **任意文件附件（0.25.0，功能候选）**：官方支持任意文件上传（模型不能内联消费的文件上传为服务端文件路径）。Kimix Composer 目前仅图片，可另起一轮扩展到文档类附件，走 `/files` 官方链路。
2. **e2e 覆盖缺口**：官方 server-e2e 场景包已删；刷新重放、pending 闭环、队列 steer、cancel 语义目前只有 Kimix 适配器探针部分覆盖，建议后续把这些场景写成自有探针。
3. **可选上报上游**：Windows 上 `process.kill(pid, 0)` 对死 pid 误判存活导致 `lock.ts` 永久拒启，可向上游提 issue。
4. **0.22 跟进候选回顾**：plugin commands（`listPluginCommands`/`activatePluginCommand`）仍是 SDK-only；Server 路由仍无等价 REST，维持"Server 会话不代理 plugin command 激活"的现状。
