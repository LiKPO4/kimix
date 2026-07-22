# Kimi Code 0.29.0 跟进记录

日期：2026-07-22
本机 CLI：`kimi --version` → `0.29.0`（npm latest 同步确认）
当前 vendored SDK：官方 `0.29.0` tag 底座（node-sdk `0.14.0`）+ PR #1996 六个提交 + Kimix sticky resume/retry 与 `subagent.spawned` 审计补丁（v2.16.103 已重打，本轮不重打）

## 官方变更摘要（对照）

| 项 | 上游变更 | Kimix 影响 | 处理 |
|---|---|---|---|
| `#1992`/`#2030`/`#2015` Thinking effort 档位 | 档位来自模型声明能力；不再对不可关闭推理的模型提供误导性 Off；修复 catalog 导入 Claude 被锁 always-on | 主输入区"思考开/关"需升级为档位选择 | **已完成**（v2.16.104）：按 `support_efforts`/`default_effort` 生成档位弹窗 |
| `#1999` 视频直接输入 | 粘贴/上传视频随 prompt 直达模型，历史恢复后可播放；ReadMediaFile 无上传通道时回退 inline | Kimix 原把视频当普通文件路径 | **已完成**（v2.16.105）：附件协议 + `/api/v1/files` 上传 + 历史映射 + 播放器 |
| `#1735` v2 自定义 Agent | Markdown frontmatter 自定义 Agent（主/子）；委派约束；全局工具门禁 + 会话级覆盖；用户级系统提示词覆盖 | 自定义 Agent 发现与路由 | **已接入**（v2.16.103，Server v2 路由）；工具门禁效果的可观测出口见项 1；用户级系统提示词覆盖为知晓项，不暴露 UI |
| `#2005` tools `active` 字段 | `/api/v1/tools` 每个工具新增 `active`，区分"已注册但被 Agent 工具策略禁用" | `ServerTool`/运行时诊断未接该字段，自定义 Agent 的工具限制会被误报为可用 | **本轮已处理**（项 1） |
| `#1997` Agent 生命周期事件 | 会话事件流新增 `agent.created`/`agent.disposed`；transcript API 暴露 disposal time | Kimix 仅显示 `subagent.spawned/started/completed` | **本轮处理**（项 2）：纳入诊断快照与归属审计，不渲染聊天卡片 |
| `#2012` `GET /api/v1/fs:content` | 按绝对路径 Serve 任意文件，带 Content-Type/ETag/Range | 历史视频/文件当前"点击整段读取转 data URL"，无流式 Range | **本轮处理**（项 3）：播放路径改用该端点，仅 Server 路由 |
| `#1970` v2 配置层重构 | 移除 `[platforms]` 段与 `provider.platformId`；凭证改 model→provider 两层解析 | Kimix 零引用 `platformId`（已全仓搜索确认），但有绕过官方 API 的 config.toml 直写路径 | **本轮验证**（项 4）：Provider 管理增删改 + 模型探测冒烟 |
| `#1990` goal 续跑 prompt 泄漏修复 | 恢复会话时 goal mode continuation prompt 不再混入 transcript | 0.28 及之前会话的历史可能已含污染记录 | **本轮确认**（项 5）：给出 canonical 历史映射是否需要兜底的结论 |
| `#1970` 取消不再可重试 | 取消的模型请求不再被包装成可重试 provider 错误，打断不再触发静默重试 | Kimix Esc 中断 UX 依赖取消语义 | **本轮验证**（项 6）：Server + SDK 双路由中断回归 |
| `#1993` env 覆盖 loop/background | `KIMI_LOOP_MAX_STEPS_PER_TURN` 等 env 优先于配置；config API 不再把 env 覆盖值持久化 | Kimix 不展示 loop_control/background 配置 | 观察项，无需改动 |
| `#1991` MCP 断线自动重连 | 调用工具时自动重连断开的 MCP 并重试一次 | 纯上游行为改善 | 观察项，知识库记一句 |
| `#2015` models.dev 导入扩展 | xai/openrouter 等 vendor SDK 可导入；过滤 deprecated/alpha；context limit 修正 | Kimix 模型探测走认证 models endpoint，不经 CLI 导入流程 | 无需改动 |
| `#1970` 模型解析检查 RPC | 只读 model resolution inspection + 连通性探测，带字段级来源 | 暂无消费方 | 可选后续，不阻塞 |
| `#1970` prompt cache key | cache key 扩展到 OpenAI/Responses provider | 上游侧 | 无需改动 |
| `#1968` 过滤后空消息修复 | content-filtered 响应后不再每轮卡 "message must not be empty" | 上游侧修复 | 无需改动 |
| `#2022`/`#1995`/`#2014`/`#1976`/`#2050` | web 棋盘格/高亮配色/更新提示/TUI 性能/工具描述文案 | Kimix 自有渲染、主题、更新器 | 不适用 |

## 项 1：工具 `active` 字段（已完成）

### 改动

- `electron/kimiCodeServerClient.ts`：`ServerTool` 新增 `active?: boolean`。
- `electron/kimiCodeHost.ts`：`getServerRuntimeDiagnostics` 的 tools 类型与映射透传 `active`。
- `electron/types/ipc.ts`：`KimiCodeServerToolInfo` 新增 `active?: boolean`。
- `src/components/layout/McpPanel.tsx`：工具目录汇总行追加"N 个被策略禁用"；`active === false` 的工具名称置灰并加"已禁用"徽标（title 说明"已注册但被当前 Agent 工具策略禁用"）。

### 语义边界

- 仅 `active === false` 判禁用；字段缺省（0.29 之前的 Server）按可用处理，不误标。
- SDK 兜底路由无工具目录诊断（`getServerRuntimeDiagnostics` 本来就只对 Server 会话开放），无需兼容改动。

### 验证

- 真实 Server 探针（临时脚本，用后已删）：0.29.0 `web --no-open` 启动，`POST /sessions` + `GET /api/v1/tools?session_id=…` → 28 个工具全部携带 `active` 字段，值均为 `true`（无工具门禁的普通会话），`ok: true`。
- `pnpm typecheck` 通过。
- 禁用态展示无真实 gated 会话可验（需自定义 Agent 工具门禁），按类型与条件渲染静态自查；待用户截图验收。

## 项 2：Agent 生命周期事件（已完成）

### 探针实测（0.29.0 真实 Server）

- `agent.created` 帧载荷：`{ type, agentId, sessionId }`，无官方时间戳；子代理创建时触发（实测 seq 11）。
- 正常轮次内未观察到 `agent.disposed`（等 3s 未到，应在会话收尾/归档阶段触发）。
- transcript API 为按 Agent 查询：`GET /sessions/:id/transcript` 缺 `agent_id` 返回 40001（HTTP 200 信封）。官方 disposal time 需按 `?agent_id=` 逐个查，本轮不接入——快照 + 帧观测已覆盖审计面。
- 快照 `subagents` 条目字段实测：`id/session_id/kind/description/status/subagent_phase/subagent_type/parent_tool_call_id/run_in_background/created_at/started_at/completed_at/output_preview`。

### 改动

- `electron/kimiCodeServerClient.ts`：`ServerSnapshot` 新增 `subagents?: ServerSubagentSummary[]`（字段按 0.29 实测，除 `id` 外可选防御）。
- `electron/kimiCodeHost.ts`：`ServerManagedSession.agentLifecycle` 跟踪 `agent.created/disposed` 帧（主进程本地观测时间）；`getServerRuntimeDiagnostics` 合并快照 subagents（官方时间）与生命周期观测，输出 `agents`；仅观测到帧但快照未收录的 Agent 也保留记录。
- `electron/types/ipc.ts`：新增 `KimiCodeServerAgentInfo`；`KimiCodeServerRuntimeDiagnostics` 新增 `agents`。
- `src/components/layout/McpPanel.tsx`：运行态区新增"Agent 生命周期"卡（计数、已释放徽标、创建/启动/完成/释放时间线）。不渲染聊天卡片——渲染器 mapper 对未知事件类型默认返回 null，天然满足。

### 验证

- 真实 Server 探针（临时脚本，用后已删）抓到 `agent.created` 实测载荷、快照字段与 transcript 形态（上文）。
- `pnpm typecheck` 通过；vitest 全量通过。
- 释放态展示依赖 `agent.disposed` 实际到达（多在会话收尾），按类型与条件渲染静态自查；待用户截图验收。

## 项 3：`fs:content` Range 播放（已完成）

### 探针实测（0.29.0 真实 Server）

- `GET /api/v1/fs:content?path=<绝对路径>`：200 + ETag，扩展名缺失的存储文件返回 `application/octet-stream`。
- Range 请求 `bytes=0-1023` → **206 + Content-Range**，真实可用（实测 20MB MP4 只回 1024 字节）。
- 官方文件存储布局实测为 `~/.kimi-code/files/<file_id>`（无扩展名），fileId → 绝对路径映射稳定。
- 对照：`/api/v1/files/<file_id>` 对历史存储文件返回 404（code 40407），覆盖不如 fs:content。

### 改动

- `electron/kimiCodeServerHost.ts`：`serverAuthHeaders` 导出复用。
- `electron/main.ts`：注册特权协议 `kimix-media`（`standard/secure/stream/bypassCSP`）；`protocol.handle` 新增流式代理——校验 fileId（`^f_[A-Za-z0-9-]+$`）与存储目录边界后，经 `net.fetch` 转发官方 `fs:content?path=…`（携带 bearer token 与原始 Range 头），透传 206/Content-Range/ETag/Content-Length，补 `Accept-Ranges: bytes`；Content-Type 优先取渲染进程附件元数据里的 `?mime=` 提示（正则校验），回退上游 octet-stream。CSP dev/prod 两条均加 `media-src 'self' kimix-media: data: blob:`。
- `index.html`：meta CSP 同步加 `media-src`。
- `src/components/chat/MessageBubble.tsx`：`VideoAttachmentThumb` 在 fileId 存在时直接挂载 `kimix-media://server-file/<fileId>?mime=…`（保留点击加载门槛，不预加载）；`<video>` 播放失败自动回退原整段 dataUrl IPC 路径一次。SDK 路由（无 fileId）行为不变。

### 验证（生产构建 + CDP 实测）

- `pnpm build` 后以 `--fast` 启动生产应用，CDP 在真实渲染进程内创建 `<video>` 挂载流式地址：
  - `loadedmetadata`：duration 11.92s、1920×1080、readyState 4、无错误（代理与 Content-Type hint 生效）。
  - seek 至中点 5.96s：`seeked` 成功——未缓冲区域 seek 必须靠 Range 请求取回，流式拖动链路实证可用。
- 期间发现并修正：fetch() 走 `connect-src` 且自定义 scheme 需 `supportFetchAPI`，但 `<video>` 媒体元素走 `media-src` 且不受 CORS 限制——最终仅保留 `media-src` 增量，`connect-src` 已回滚并复测通过。
- `pnpm typecheck` 通过；vitest 全量通过。
- 待用户截图验收：历史视频点击后的播放器表现与拖动。

## 项 4：Provider 配置兼容验证（待处理）

计划：0.29 v2 配置层重构下冒烟 Provider 管理增删改与模型探测，确认 Kimix 直写 `config.toml`（`type`/`base_url`/`api_key`）与官方两层凭证解析一致。

## 项 5：goal 泄漏历史兜底确认（待处理）

计划：核查 #1990 修复前会话混入 transcript 的 continuation prompt 对 canonical 历史映射的影响，给出"需要兜底/不需要"结论。

## 项 6：中断回归验证（待处理）

计划：#1970 后取消请求不再被包装成可重试错误，验证 Esc 中断在 Server 与 SDK 双路由下无静默重试。

## 回滚

- 项 1：revert 上述四文件对应改动即可；`active` 为纯增量可选字段，旧 Server 不受影响。
