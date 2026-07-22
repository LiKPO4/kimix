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

## 项 2：Agent 生命周期事件（待处理）

计划：`agent.created`/`agent.disposed` 纳入诊断快照与归属审计（含 transcript disposal time）；不渲染成聊天卡片。

## 项 3：`fs:content` Range 播放（待处理）

计划：历史视频/文件播放改用 `GET /api/v1/fs:content`（ETag + Range），替换"整段读取转 data URL"；仅 Server 路由，SDK 路由保持现有行为。

## 项 4：Provider 配置兼容验证（待处理）

计划：0.29 v2 配置层重构下冒烟 Provider 管理增删改与模型探测，确认 Kimix 直写 `config.toml`（`type`/`base_url`/`api_key`）与官方两层凭证解析一致。

## 项 5：goal 泄漏历史兜底确认（待处理）

计划：核查 #1990 修复前会话混入 transcript 的 continuation prompt 对 canonical 历史映射的影响，给出"需要兜底/不需要"结论。

## 项 6：中断回归验证（待处理）

计划：#1970 后取消请求不再被包装成可重试错误，验证 Esc 中断在 Server 与 SDK 双路由下无静默重试。

## 回滚

- 项 1：revert 上述四文件对应改动即可；`active` 为纯增量可选字段，旧 Server 不受影响。
