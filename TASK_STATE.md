# Kimix 长程任务状态

## 当前目标
停止继续把旧 hidden runtime 作为主交互引擎修补，按新版官方 Kimi Code 文档与官方仓库迁移到 SDK / Wire 主链路。P0 探针已确认当前机器应接官方源码 `packages/node-sdk` 的 `KimiHarness` / `Session` API；P1 已新增主进程 `KimiCodeHost` 最小适配层和独立 `kimi-code:*` IPC；P2 已新增 SDK event -> Kimix timeline 独立 mapper；P3 已完成 renderer 灰度接入 `engine: "kimi-code"` 的第一版；P4 已完成队列/引导的 SDK 最小收敛；P5 已把审批 / 提问 / 权限 / Plan 的最小闭环接到 SDK。P6 已完成会话导出、插件状态 / 启停、模型配置读写、MCP / usage / background tasks runtime API 的 SDK 接入。用户已确认后续彻底不使用旧 runtime；P7 已删除正式 UI、可见入口、后端 IPC、类型兼容和依赖中的旧 runtime 链路，并通过 P7 专用 SDK 主链路连续验收。下一步进入最终构建 / diff / 重启后可做目标完成审计。

## 当前路线文档
- `KIMI_CODE_SDK_MIGRATION_PLAN.md`：新版 Kimi Code SDK / Wire 迁移总计划与新窗口交接提示词。

## 当前优先级 Todo（新路线）
1. [x] P0：新增并运行 SDK / Wire 探针脚本，只验证官方新链路，不改正式 UI。
2. [x] P0：产出 `docs/kimi-code-sdk-probe-result.md`，写清当前 CLI 版本、可用 SDK 包名/API、`prompt/steer/cancel/approval/question` 行为、sessionId 与 `wire.jsonl` 路径。
3. [x] P1：基于 P0 结果新增 Electron 主进程 `KimiCodeHost`，以官方 session id 为唯一运行时 id。
4. [x] P2：新增 SDK/Wire event -> Kimix timeline 的独立 mapper，正式消息流不再从 TUI screen parser 取正文。
5. [x] P3：灰度接入 `engine: "kimi-code"`。
6. [x] P4：重写队列与引导逻辑，彻底摆脱旧 runtime idle / screen 猜测。
7. [x] P5：审批 / 提问 / 权限 / Plan 闭环接 SDK。
8. [ ] P6：插件、MCP、模型、用量、后台任务、导出等官方能力 GUI 化盘点与迁移。
   - [x] P6.1：会话导出走官方 SDK `KimiHarness.exportSession()`，旧 `kimi export` 仅作 fallback。
   - [x] P6.2：插件页刷新状态不再必须打开 `/plugins` TUI 菜单。
   - [x] P6.3：模型选择不再必须打开 `/model` TUI 菜单。
   - [x] P6.4：MCP / usage / background tasks 能力接 SDK API 或明确 fallback。
9. [x] P7：收口并移除旧 hidden runtime 主链路。
   - [x] P7.1：正式聊天页不再通过旧 hidden runtime 发送 / steer / slash 遥控 / event 入库。
   - [x] P7.2：移除侧栏旧调试入口、AppShell DebugPanel 渲染、ContextBar 旧状态订阅、插件页旧镜像/遥控面板和正式审批/问题旧回写分支。
   - [x] P7.3：删除旧 runtime host、IPC/preload/types/browser fallback、孤立 DebugPanel、reducer/tests/依赖，以及旧 engine / workspace view 正式类型。
   - [x] P7.4：连续验收普通发送 / 队列 / 引导 / 审批 / question。

## 本轮证据（Kimi Code 新引擎）
- P0：`scripts/probe-kimi-code-sdk.mjs` 与 `docs/kimi-code-sdk-probe-result.md` 已生成并运行。结论：`kimi --wire` 当前 CLI 0.6.0 原始启动不可用；npm `@moonshot-ai/kimi-code-sdk` 404；旧 `@moonshot-ai/kimi-agent-sdk@0.1.8` ProtocolClient 不能和当前 CLI wire 握手；官方源码 `packages/node-sdk` runtime 可用，create/resume/prompt/steer/cancel/approval/question 均已闭环，sessionId 可对齐 `~/.kimi-code/sessions/.../agents/main/wire.jsonl`。
- P1：新增 `electron/kimiCodeHost.ts`、独立 `kimi-code:*` IPC / preload API、`scripts/probe-kimi-code-host.mjs`。`node scripts/probe-kimi-code-host.mjs` 通过：prompt completed、steer completed、cancel cancelled。`pnpm build` 通过；已按规则重启 dev 实例并确认 Electron 进程启动。
- P2：新增 `src/utils/kimiCodeEventMapper.ts` 和 `src/utils/__tests__/kimiCodeEventMapper.test.ts`。独立映射官方 SDK event：`assistant.delta`、`thinking.delta`、`turn.ended`、`tool.call.*`、`tool.result`、`agent.status.updated`、`turn.step.*`、`subagent.*`、`compaction.*`、`error/warning`；同时把 SDK handler 的 approval/question request 映射为 Kimix timeline 卡片。已验证 `pnpm test:run -- src/utils/__tests__/kimiCodeEventMapper.test.ts src/utils/__tests__/eventMapper.test.ts` 通过，`pnpm build` 通过；已按规则重启 dev 实例并确认 Electron 进程启动。
- P3：renderer 已允许 `engine: "kimi-code"`；新建普通会话默认走 Kimi Code SDK host；`App.tsx` 消费 `kimi-code:event` / `kimi-code:status` 并通过 `kimiCodeEventMapper` 入库；`Composer.tsx` 的 prompt / steer / cancel / plan / permission 已按 `engine` 分流到 `kimi-code:*` IPC，已有 TUI 会话仍保留原调试链路。已验证 mapper 局部测试通过、`pnpm build` 通过。尚需用户做一次真实 UI 发送/停止/引导截图验收。
- P4：SDK 队列和引导收敛到 `kimi-code:status` / `steerKimiCode`。运行中输入框对 `engine: "kimi-code"` 显示“引导”按钮；SDK steer 成功后本地 `steer_message` 立即标记 `sent`；pending queue 续发失败会把消息放回队列并写入错误卡，避免消息被 shift 后丢失。已验证 mapper 局部测试通过、`pnpm build` 通过。
- P5：`electron/kimiCodeHost.ts` 已挂载官方 SDK `setApprovalHandler` / `setQuestionHandler`，把请求转为 `kimix.approval.request` / `kimix.question.request` 事件进入 timeline；`ApprovalCard` / `QuestionCard` 对 `engine: "kimi-code"` 回写 `respondKimiCodeApproval` / `respondKimiCodeQuestion`，由主进程 resolve 官方 handler promise。权限与 Plan 已继续走 `setKimiCodePermission` / `setKimiCodePlanMode`。已验证 mapper 局部测试通过、`pnpm build` 通过。
- P6.1：`KimiCodeHost.exportSession()` 已接官方 `KimiHarness.exportSession()`；侧栏导出 Debug ZIP 会传 runtime/official sessionId；主进程导出优先走 SDK，失败才 fallback 到旧 `kimi export` CLI。新增 `scripts/probe-kimi-code-export.mjs`，已验证 SDK export 生成 ZIP：`entries=3`，manifest sessionId 与官方 sessionId 一致。`pnpm build` 通过。
- P6.2：`KimiCodeHost` 已接官方 `Session.listPlugins()` / `installPlugin()` / `setPluginEnabled()` / `setPluginMcpServerEnabled()`；插件页在 `engine: "kimi-code"` 会话里显示 SDK 插件状态，刷新和启停不再依赖 `/plugins` TUI 菜单，安装入口优先走 SDK，旧 CLI 只保留给非 SDK 会话。新增 `scripts/probe-kimi-code-plugins.mjs`，已验证 SDK listPlugins 返回 2 个插件：`kimi-datasource`、`superpowers`。`pnpm build` 通过。
- P6.3：`KimiCodeHost` 已接官方 `KimiHarness.getConfig()` / `setConfig()`；主进程 `kimi:getModelConfig`、`kimi:saveOpenAiProvider`、`kimi:setDefaultModel` 已改为 SDK 优先，旧 TOML parser/writer 只作 fallback。新增只读探针 `scripts/probe-kimi-code-model-config.mjs`，已验证 SDK getConfig 返回默认模型 `kimi-code/kimi-for-coding`、2 个 provider、2 个 model alias。`pnpm build` 通过。
- P6.4：`KimiCodeHost` 已接官方 `Session.getUsage()`、`Session.listMcpServers()`、`Session.getMcpStartupMetrics()`、`Session.reconnectMcpServer()`、`Session.listBackgroundTasks()`、`Session.getBackgroundTaskOutput()`、`Session.getBackgroundTaskOutputPath()`、`Session.stopBackgroundTask()` 和 `KimiHarness.auth.getManagedUsage()`；preload 暴露对应 `kimi-code:*` API。新增 `scripts/probe-kimi-code-runtime-capabilities.mjs`，已验证这些 API 均可调用；当前临时会话 MCP/后台任务为空，managed usage 返回 Weekly limit 与 5h limit。`pnpm build` 通过。
- P7.1/P7.2/P7.3：正式聊天页的旧 hidden runtime 主路径、可见前端入口、后端 host、IPC/preload/types/browser fallback、孤立 DebugPanel、reducer/tests 和终端依赖已删除；旧持久化会话在启动恢复时会作为未知旧 engine 迁到 `kimi-code`，未知 workspace view 迁回 `chat`。已验证 `pnpm install --lockfile-only --ignore-scripts`、`pnpm build` 通过；`rg -n "tui|TUI|PTY|ConPTY" src electron package.json pnpm-lock.yaml` 无结果。
- P7.4：新增 `scripts/probe-kimi-code-p7-acceptance.mjs` 并验证通过。结果：同一个官方 session `session_b0e58915-d766-4a0d-8c40-a86e7b063a7a` 连续 10 轮普通 prompt 均 completed，turnId 0-9；steer same session completed；cancel turn ended reason 为 `cancelled`；approval handler roundtrip completed；question handler roundtrip completed。队列 UI 路径已由代码核对：运行中普通发送只入 pending queue，SDK completed 后 `shiftPendingMessage()` 再 `sendKimiCodePrompt()`，队列项“引导”先移除再 `steerKimiCode()`，失败恢复。
- 本轮模型显示修正：新对话底部模型不再显示“未记录”，`ContextBar` 优先显示当前会话 `model`，无记录时读取官方 `getKimiModelConfig().defaultModel`，失败 fallback 到 `kimi-for-coding`；设置页切换/保存模型会广播刷新。`Composer` 与 `useCreateProjectSession` 创建本地 `kimi-code` 会话时写入同一默认模型，SDK create/resume 后不再写死 `Kimi Code SDK`；新对话按钮不再提前调用旧 `startSession`。已验证 `pnpm build` 通过。
- 本轮引导渲染修正：运行中 `steer_message` 不再作为 assistant 正文合并边界；`mergeEvents` 会继续把 steer 后到达的 assistant delta 合并回当前未完成 assistant，`ChatThread` 将同一 turn 内的引导气泡附着到当前 assistant 项，`MessageBubble` 在“正在思考/执行中”消息头之后、正文之前渲染它，避免“正在引导”切断 AI 正文或压到思考消息头上方。已验证 `pnpm test:run -- src/utils/__tests__/eventMapper.test.ts src/utils/__tests__/kimiCodeEventMapper.test.ts src/utils/__tests__/eventHelpers.test.ts` 通过，`pnpm build` 通过。
- 本轮普通聊天入口归一：按 `KIMI_CODE_SDK_MIGRATION_PLAN.md` 收紧正式聊天入口，`Sidebar` 新对话、`EmptyState` 建议发送、`Composer` 普通发送 / 引导 / 停止 / 权限 / Plan 不再调用旧 `startSession` / `sendPrompt` / `stopTurn` / TUI IPC，而是只走 `createKimiCodeSession` / `resumeKimiCodeSession` / `sendKimiCodePrompt` / `steerKimiCode` / `cancelKimiCodeTurn` / SDK Plan/Permission。已验证 `pnpm build` 通过；`rg -n 'startSession\(|sendPrompt\(|stopTurn\(|startTui|sendTui|stopTui|TUI|Kimi Code SDK' src/components/chat/Composer.tsx src/components/chat/EmptyState.tsx src/components/layout/Sidebar.tsx src/hooks/useCreateProjectSession.ts` 无结果。剩余旧调用在长程任务、交接和 App 历史分支，需下一轮继续按计划归一。
- 本轮修正重启方式：新增 `scripts/restart-kimix-dev.ps1`，只停止命令行匹配 Kimix 工作区或 Kimix user-data-dir 的 Electron / Node 进程，避免误杀 Codex/OpenAI 自身 Electron 后弹出 `Unable to find Electron app at C:\Program Files\WindowsApps\OpenAI...`。
- 注意：服务端当前拒绝 `userAgentProduct: "kimix"` 使用 `kimi-code/kimi-for-coding`，P1 暂按 P0 验证可用的 `userAgentProduct: "kimi-code-cli"` 运行。后续若官方开放 host identity，再切回 Kimix 自身身份。

## 当前优先级 Todo
1. [x] P0：确认官方 0.6.0 CLI 行为，验证 prompt-mode 是否可用 `--session` 续会话。
2. [x] P1：实现 prompt-mode 连续对话恢复，当前采用实测可用的 `--continue`，避开 Windows 下 `--session <id> -p` 误报 different directory。
3. [x] P2：补齐 `auto` 权限模式到类型、设置、输入框和会话启动参数。
4. [x] P3：增加官方导出能力入口：会话侧栏支持导出 Kimi Debug ZIP，后端调用官方 `kimi export`。
5. [x] P4：补插件来源与信任级别展示，Skill 扫描覆盖 `.kimi-code/skills` 与 `.kimi-code/plugins`，插件页显示 Kimi 官方 / 精选 / 第三方 / 本地徽章。
6. [x] P5：接入 `KIMI_MODEL_*` 高级模型环境变量透传；prompt 模式继承进程环境，wire 模式显式传入匹配变量。
7. [x] P6：评估官方定时任务能力；当前 0.6.0 帮助中未暴露任务管理 CLI/API，暂不新增伪 UI，继续保留 Kimix 长程任务能力。
8. [x] P7：构建、空白检查已完成；已输出 P0-P7 验收需求报告，等待用户按报告视觉 / 实机验收。
9. [x] P8：权限模式按官方 0.6.0 收敛为手动审批 / 自动权限 / 完全访问；移除输入框加号菜单旧 AFK 自动模式，并清理底层 `--afk` / `KIMIX_KIMI_AFK` 链路。
10. [x] P9：支持 Kimi Code 0.6.0 新版思考内容展开；prompt-mode 从新版 `agents/main/wire.jsonl` 回读本轮 `content.part` 的 `think`，并补齐新版历史回放解析。

## 下一阶段官方 Kimi Code 能力补齐计划
目标：对照 Kimi Code 0.6.0 / 0.5.0 / 0.4.0 changelog，把 Kimix 已有适配从“能用”补齐到“可视化、可配置、可恢复”。新窗口按优先级逐项推进，每次只做一个可验证最小增量。

### P0：其他模型 API 接入配置（优先）
目标：把官方支持的第三方 / OpenAI-compatible 模型配置做成 Kimix 一等入口，而不是只依赖用户手动设置环境变量。
- 关键文件：`electron/main.ts`、`electron/kimiBridge.ts`、`src/components/settings/SettingsPanel.tsx`、`package.json` 版本锚点。
- 功能范围：Provider 列表、`base_url` / `api_key` / `model` 配置、默认模型选择、连接测试、敏感信息脱敏展示、写入 / 读取 Kimi `config.toml` 或兼容官方环境变量。
- 验收标准：新增一个 OpenAI-compatible Provider 后，Kimix 能测试连接；新会话使用所选模型发出请求；关闭重开后配置仍保留；错误卡能明确区分 key、base URL、模型名错误。

### P1：Plugin 从 GitHub URL 安装（优先）
目标：补齐官方从 GitHub URL 安装 plugin 的入口，打通输入、安装、扫描、刷新、错误提示闭环。
- 关键文件：`electron/main.ts`、插件扫描 / 插件页相关组件、`src/components/settings/SettingsPanel.tsx` 或插件管理页。
- 功能范围：输入 GitHub URL、安装到官方插件目录、安装进度、失败摘要、安装后自动刷新插件列表、保留现有官方 / 精选 / 第三方 / 本地信任徽章。
- 验收标准：一个公开 GitHub plugin URL 可从 Kimix 安装成功；列表立即出现；安装失败能展示可操作错误，不吞掉 CLI 输出。

### P2：Plugin 自带 MCP Server 管理（优先）
目标：识别并管理 plugin 随带的 MCP server，让插件能力和 Kimix 现有 MCP 面板打通。
- 关键文件：插件扫描逻辑、MCP 设置 / 管理面板、`electron/main.ts`。
- 功能范围：发现 plugin manifest 中的 MCP server、展示来源 plugin、启停、授权 / 信任提示、连通性测试、错误日志入口。
- 验收标准：安装带 MCP server 的 plugin 后，Kimix 能在 MCP 管理区识别来源、启用并完成一次测试；禁用 plugin 后对应 MCP 状态同步变化。

### P3：后台 Agent 状态恢复提示（优先）
目标：对齐官方后台 agent 的成功、失败、中断、恢复提示，减少“后台卡住但用户不知道下一步”的情况。
- 关键文件：`electron/kimiBridge.ts`、`electron/longTaskService.ts`、`src/components/layout/LongTasksPanel.tsx`、`src/components/chat/MessageBubble.tsx`。
- 功能范围：识别后台 agent 状态、失败原因、恢复提示、可恢复操作按钮；在顶部 banner、右侧栏和对话流中保持一致。
- 验收标准：后台 agent 成功 / 失败 / 中断时都有明确 UI；可恢复场景能一键继续或给出下一步 prompt；不可恢复场景显示明确原因。

### P4：模型错误恢复与重试提示（优先）
目标：把 token 限制、terminated、上下文溢出、压缩失败、登录失效等官方恢复信息映射成 Kimix 可操作错误卡。
- 关键文件：`src/components/chat/ErrorCard.tsx`、`electron/kimiBridge.ts`、`electron/main.ts`。
- 功能范围：错误类型归一、中文摘要、重试 / 登录 / 压缩 / 导出 / 切换模型等动作按钮、保留原始错误详情入口。
- 验收标准：常见模型错误不再只显示原始栈或英文；用户能从错误卡直接执行下一步；重试不会重复发送不可恢复请求。

### P5：套餐用量展示对齐官方新体验（优先）
目标：在已修复用量查询的基础上，补齐官方新版用量展示口径和刷新态 / 错误态。
- 关键文件：`electron/main.ts`、`src/components/chat/ContextBar.tsx`。
- 功能范围：5 小时、本周、刷新时间、加载态、过期登录态、服务端错误摘要、必要时展示官方字段差异。
- 验收标准：点击“套餐用量”刷新能稳定显示 5 小时和本周用量；登录过期时引导 Kimix 接管登录；接口失败时展示可读错误摘要。

### P6：官方 `/export-md` 导出（需要支持）
目标：把官方 `/export-md` 能力做成一等入口，和现有本地 Markdown 导出 / debug zip 导出区分清楚。
- 关键文件：`electron/main.ts`、会话侧栏 / 导出菜单相关组件。
- 功能范围：当前会话导出 Markdown、选择保存位置、成功后打开文件 / 文件夹、失败摘要。
- 验收标准：当前会话可通过 Kimix 调用官方导出 Markdown；导出内容和官方口径一致；失败时不影响现有本地导出能力。

### P7：Write / Edit 审批 diff 与全屏查看增强（需要支持）
目标：补齐官方审批体验里的文件内容、diff 和全屏查看能力，让写文件 / 改文件审批更清楚。
- 关键文件：审批卡 / 变更卡组件、diff 面板、`src/components/chat/MessageBubble.tsx`。
- 功能范围：审批卡内展示文件路径、摘要、diff 预览、全屏查看、接受 / 拒绝 / 局部查看；保留现有变更卡撤销能力。
- 验收标准：一次 Write/Edit 审批能在 Kimix 内看清改动内容；全屏查看不遮挡主操作；拒绝和接受状态回写准确。

### P8：官方定时任务接入（计划内，非第一优先级）
目标：先保留到路线图，不抢占 P0-P7；后续评估官方定时任务和 Kimix 长程任务的边界，避免做出并行冲突体系。
- 关键文件：`electron/longTaskService.ts`、长程任务 UI、可能新增的任务调度配置。
- 功能范围：指定时间提醒、cron、几分钟后继续工作、任务恢复提示、与现有长程任务状态合并展示。
- 验收标准：先完成官方能力盘点和最小原型；确认不会破坏当前长程任务执行 / 审查 / 暂停继续链路后再进入实现。

## 当前版本
**v2.8.247** — 三处同步：`package.json` + `src/components/layout/Sidebar.tsx` + `src/components/settings/SettingsPanel.tsx`。

## 本轮证据
- v2.8.247：修复 TUI assistant 完成后显示“已处理 0s”和运行中消息头不稳定的问题。`mergeEvents` 在 assistant 完成时改用 `Date.now() - placeholder.timestamp` 结算 duration，避免官方完成事件批量同 timestamp 导致 0s；`MessageBubble` 的 active 判断同时识别 UI session id 和 runtimeSessionId，运行中应能显示思考/执行头；完成态非零 duration 至少显示 1s。待验证：长时间思考后不再显示 0s，发送后能尽早看到消息头。
- v2.8.246：修复同一官方 TUI 会话被 Kimix 侧栏拆成多个本地会话的问题。`resolveUiSessionId` 和 `findLocalSessionForRuntime` 增加 `officialSessionId` 匹配；TUI 事件入口传入 `payload.session.officialSessionId`，重启/恢复后即使 runtime id 改变，也能把事件归并回已有 UI session。待验证：同一个官方会话后续消息不再生成新的侧栏条目。
- v2.8.245：修复引导气泡和 agent 事件顺序错位。`mergeEvents` 重新规定只有官方 `SteerInput` 确认后的 `sent` steer 才是新回合边界；本地刚点击后的 `sending` steer 不再切断上一轮 assistant，后续旧轮工具/思考/状态事件会插到 trailing sending steer 前面。引导气泡的 sending 文案改为“已发送引导请求”，避免已发出后仍显示“正在引导”。新增 eventMapper 测试覆盖未确认/已确认 steer 边界和 tool_call 顺序。
- v2.8.244：修复排队消息点击“引导”后仍短暂或持续留在队列的问题。`handleSteerPending` 改为插入本地 steer 气泡后立即 `removePendingMessage(id)`，不再等待 `sendTuiInput` 返回；若发送失败，再恢复该 pending 并把 steer 气泡标记失败。待验证：引导按钮点击后队列项立即消失，失败时才回队列。
- v2.8.243：修复 v2.8.242 后仍会把一条多行输入拆成多个 TUI turn/session 的问题。停止使用真实换行/bracketed paste 写入 TUI，`electron/tuiHost.ts` 统一把多行内容压成一条物理输入，用 `⏎` 标记原换行，避免 PTY/TUI 把换行当提交边界；本地时间线仍显示原始用户内容。pending 引导在 `sendTuiInput` 成功后立即从队列移除，但 steer 气泡状态仍等待官方 semantic 确认。待验证：多行普通发送和多行引导不再创建多个会话，agent 能看到完整内容。
- v2.8.242：修复多行 steer 被 TUI 截断后重复显示片段的问题。`electron/tuiHost.ts` 对多行 TUI 输入改用 bracketed paste 再追加 Enter/Ctrl+S，避免换行被终端当成提前提交；`mergeEvents` 对官方 `SteerInput` 回流使用宽松匹配，若本地已有完整 `sending` steer，则只确认状态并保留完整内容，不再追加截断气泡；pending steer 移除也使用同一匹配。新增 eventMapper 测试覆盖“官方回流首行片段时不新增重复气泡”。待验证：多行引导完整送达，agent 不再反馈信息不全。
- v2.8.241：修正 v2.8.240 的 steer 成功时机：Composer 只在发送前插入 `sending` 占位，API 成功只提示“已发送引导请求，等待 TUI 确认”，不再提前标记 `sent` 或移除 pending；App 在真实 semantic `SteerInput` 回流后才通过 `mergeEvents` 标记“已引导对话”，并按内容移除对应队列项。输入区运行态不再被 stale `runningSessionId` 单独撑起，只有存在未完成 assistant 时才显示停止/引导；TUI screen 分支也在无未完成 assistant 且无审批/问题时清掉运行态。已完成 assistant 的处理头改为“（输出完成）已处理 …”。待验证：真实 UI 中引导确认、队列移除、停止按钮消失和输出完成文案。
- v2.8.240：修复 steer 引导状态和消息归属竞速。Composer 在发送 steer 前先插入本地 `steer_message` 占位，API 成功后立即标记 `sent`，失败标记 `failed`；pending 引导同样先占位，成功后再移除队列项。`mergeEvents` 将 `sending` 的 steer 也作为 assistant chunk 合并边界，避免引导尚未确认时 agent 回复被并入上一轮 assistant。新增 eventMapper 测试覆盖 pending steer 边界。已验证 `pnpm test:run -- src/utils/__tests__/eventMapper.test.ts src/utils/__tests__/tuiSemanticReducer.test.ts` 通过、`pnpm build` 通过；已按要求重启 dev 实例，真实 UI 待用户截图复验。
- v2.8.239：修复 TUI idle 兜底 timer 被连续 screen 快照反复重置的问题。同一 `uiSessionId:runtimeSessionId` 已有 `scheduleTuiIdleCompletion` timer 时直接复用，避免“不 busy 但 isInputIdle 不稳定”的状态持续刷新导致 1.5s finish/queue flush 永远等不到，从而继续显示“引导”按钮。已验证 `pnpm test:run -- src/utils/__tests__/tuiSemanticReducer.test.ts src/utils/__tests__/eventMapper.test.ts` 通过、`pnpm build` 通过、`git diff --check` 仅 LF/CRLF warning。真实发送后 queue flush / 引导按钮消失仍待用户截图或实机反馈。
- v2.8.215：补 hidden TUI 图片附件与排队链路的第一个官方能力闭环。先用真实 hidden TUI 探针验证：发送桌面图片路径后，官方 wire 出现 `ToolCall: ReadMediaFile`，并返回真实图片描述，说明官方 TUI 可通过本地图片路径触发官方媒体读取工具。随后 `sendTuiInput` 支持接收 Kimix 图片附件并保存为当前工作区 `.kimix-uploads/images` 文件，再把“图片附件：<路径>”随本轮输入写入真实 TUI；Composer / pending queue 同步保留图片附件，队列项显示图片数量，运行中按钮文案改为“等待”，队列自动 flush 时不再丢图。已验证 `pnpm test:run -- src/utils/__tests__/tuiSemanticReducer.test.ts` 通过、`pnpm build` 通过、`git diff --check` 通过（仅 LF/CRLF warning）；真实 UI 图片发送/排队待截图验收。
- v2.8.214：把 hidden TUI 语义源迁移收口到独立 reducer。新增 `src/utils/tuiSemanticReducer.ts`，集中处理 semantic events -> Kimix timeline：正文只来自 `ContentPart(text)`，官方思考只来自 `ContentPart(think)`，Kimix 合成 prompt-mode 状态不进入 thinking，`TurnCancel` 统一标记当前 assistant 中断。`App.tsx` 的 TUI semantic 分支改为调用 reducer，只保留运行态、完成态和队列调度；新增 `tuiSemanticReducer.test.ts` 覆盖 text/think 分离、合成 thinking 过滤、TurnCancel 中断。已验证 `pnpm test:run -- src/utils/__tests__/tuiSemanticReducer.test.ts` 通过、`pnpm build` 通过、`git diff --check` 通过（仅 LF/CRLF warning）。
- v2.8.213：补 hidden TUI 迁移诊断面板收口能力。`tuiHost` 在 session summary 中保留最近 raw `wire.jsonl` tail 和 semantic events tail；TUI 调试页输出区新增 `Screen / Wire / Semantic / 文本 / ANSI` 切换，显示 wire 文件路径与 semantic 事件数量，便于后续判断污染来自官方事件、semantic reducer 还是 UI 合并。已验证 `pnpm build` 通过、`git diff --check` 通过（仅 LF/CRLF warning）；真实 TUI Debug Panel 切换待截图验收。
- v2.8.212：收紧思考展开来源，避免 Kimix 本地 prompt-mode “【实时状态】/ 尚未实时写出思考正文”占位混入思考过程。`eventMapper` 新事件映射时不再把这类合成状态转成 assistant thinking；`MessageBubble` 和 `ChatThread` 对历史已存的合成 thinking 也会过滤，只有真实官方 thinking 段才允许展开。已验证 `pnpm build` 通过、`git diff --check` 通过（仅 LF/CRLF warning）；真实 UI 截图待验收。
- v2.8.211：修复 v2.8.210 语义源切换后“思考开”但普通 TUI 回复没有可展开思考的问题。`ChatThread` 对 TUI 完成态普通回答继续压制旧 screen 噪音，但只要 assistant 事件带有 wire semantic 生成的 `thinkingParts`，就保留过程摘要和可展开 thinking；正文仍只来自 `ContentPart(text)`，thinking 不进入正文。已验证 `pnpm build` 通过、`git diff --check` 通过（仅 LF/CRLF warning）；真实 UI 截图待验收。
- v2.8.210：开始按 Hidden TUI 语义源重构计划止血：`tuiHost` 新增 `agents/main/wire.jsonl` semantic 事件侧路，正式消息页 TUI 分支不再从 `screen.answerText/thinkingText` 写正文，改由 `ContentPart(text/think)` 合并；`step.end` 仅在 `finishReason=end_turn` 时结束 turn，避免工具轮次过早完成。Composer 在当前轮未结束时普通发送和 Skill 命令后续文本都只加入队列，队列等待官方 wire TurnEnd 且 TUI 输入框 idle 后再自动发送下一条；“立即发送/运行中 steer”普通路径已禁用。已验证 `pnpm build` 通过、`git diff --check` 通过（仅 LF/CRLF warning）；真实 hidden TUI 连续发送待实机验收。
- v2.8.209：针对用户截图中普通回复混入 `Welcome to Kimi Code` / `/help` / “用户只是说了句 hello”推理文本的问题加硬闸。`tuiHost` 现在会过滤带 `●` 块标题里的 TUI chrome，并且单块完成态只有在不像 thinking/meta-reasoning 时才提升为 `answerText`；renderer 正式消息页暂不再把 hidden TUI `thinkingText` 写入 assistant 气泡详情，避免未稳定的 TUI raw thinking 出现在主对话。真实原始 thinking 仍保留在 TUI mirror/debug，后续再做稳定结构化 Thinking 卡。已验证临时 hidden TUI 发送 `hello` 后 `answerText=你好霖江路！你好呀，有什么我可以帮你的吗？` 且 `answerHasChrome=false`；`pnpm build` 通过、`git diff --check` 通过（仅 LF/CRLF warning）。正式 UI 截图待用户验收。
- v2.8.208：推进阶段 6「官方能力 GUI 化」中的 Plan 模式遥控闭环。正式输入区 Plan 按钮在 hidden TUI 会话下不再调用旧 `kimi:setPlanMode` / `kimiBridge.setPlanMode`，而是向真实 TUI runtime 发送官方 `/plan` slash 命令；prompt 兼容链路仍保留原 SDK `setPlanMode`。已通过临时 hidden TUI 实测 `/plan` 后官方屏幕显示 `Plan mode: ON`；`pnpm build` 通过、`git diff --check` 通过（仅 LF/CRLF warning）。正式 UI 点击 Plan 按钮待用户实机验收。
- v2.8.207：推进阶段 3「输入接管」的运行中追加输入闭环。正式聊天页在 hidden TUI 会话运行中点击队列消息“立即发送”时，不再调用旧 `steerPrompt` / prompt-mode Turn steer 路径，而是直接 `sendTuiInput` 写入当前真实 TUI runtime，避免 TUI 主链路下仍触发 `No active turn`；prompt 兼容链路仍保留原 `steerPrompt` 行为。已验证 `pnpm build` 通过、`git diff --check` 通过（仅 LF/CRLF warning）；真实 TUI 运行中队列发送待用户实机验收。
- v2.8.206：收敛 hidden TUI 普通回答在正式消息页的过程区噪音。`ChatThread` 在 `engine: "tui"`、本轮已完成、有正文、且没有工具 / 子代理 / Hook / 文件变更 / 状态卡时，默认隐藏“已处理 · N 段思考”过程摘要，避免简单问候或普通回答上方持续出现过程条导致用户误以为 agent 乱输出；涉及工具、审批、变更和运行状态的轮次仍保留过程区。已验证 `pnpm build` 通过、`git diff --check` 通过（仅 LF/CRLF warning）；正式 UI 视觉效果待用户截图验收。
- v2.8.205：修复 hidden TUI 普通回复被误放进 thinking 的边界。官方 TUI 的长 thinking 可能把前一个块标题滚出可见屏，Kimix 只看到最后一个 `● 回复` 块；旧逻辑要求至少两个文本块才把最后一块当正文，导致“你好”等简单回复在正式消息页表现为 agent 乱输出过程。现在当真实 TUI 已回到输入框完成态且可见区只剩一个文本块时，将该块提升为 `answerText`，不再写入 `thinkingText`。已验证真实 hidden TUI 发送“你好”后 `answerText` 为正常回复、`assistantText` 同步为回复正文；`pnpm build` 通过、`git diff --check` 通过（仅 LF/CRLF warning）。当前仍有用户 dev 窗口相关 Electron / kimi 进程，未擅自关闭。
- v2.8.204：修复 hidden TUI 主链路仍发送 prompt-mode 本地“需求澄清包装”的问题。`Composer` 在 hidden TUI 主链路下现在直接把用户原文发送给真实 TUI，不再拼入 `【Kimix 需求澄清工具】`、`用户原始需求`、AskUserQuestion 规则等本地控制提示；这些 prompt-mode 兼容包装仅在关闭 hidden TUI 回退旧链路时保留。已验证 `pnpm build` 通过、`git diff --check` 通过（仅 LF/CRLF warning）；源码确认 TUI 分支 `outboundContent` 为用户原文，`withClarificationBehavior` 仅用于非 TUI 兼容回退分支。当前仍有用户 dev 窗口相关 Electron / kimi 进程，未擅自关闭，待用户关闭窗口后复查残留。
- v2.8.203：继续清理 hidden TUI 正式消息页显示。renderer 收到 TUI screen 事件时，不再把“`TUI 正在运行。` / `TUI 正在思考。` / `TUI 等待审批。`”这类泛化占位写进 assistant 正文；没有语义正文时只保留过程区状态，真正正文只来自 `answerText`。已验证 `pnpm build` 通过、`git diff --check` 通过（仅 LF/CRLF warning）；通过真实 hidden TUI 发送“只回复 OK”，确认 `answerText=OK`、`assistantText=OK`。验证用 TUI 已清理；当前仍有用户 dev 窗口相关 Electron / kimi 进程，未擅自关闭，待用户关闭窗口后复查残留。
- v2.8.202：修复 hidden TUI 发送后正式消息页“乱输出一阵子”的根因。`tuiHost` 不再把整屏 `visibleText` 作为 `answerText` 兜底，renderer 也不再把 `screen.lines` / raw output 兜底写进 assistant 正文；正式消息页只展示语义解析出的 answer/thinking/tool/approval/question，原始终端屏仍保留在 TUI mirror/debug。已验证 `pnpm build` 通过、`git diff --check` 通过（仅 LF/CRLF warning）；通过真实 hidden TUI 启动欢迎页和打开 `/model`，确认 `answerText` / `assistantText` 均为空且 `screen.models` 仍可用。验证用 TUI 已清理；当前仍有用户 dev 窗口相关 Electron / kimi 进程，未擅自关闭，待用户关闭窗口后复查残留。
- v2.8.201：按 `docs/KIMIX_TUI_ENGINE_MIGRATION_PLAN.md` 的“prompt-mode 只保留为临时 fallback，最终删除”方向推进默认链路。新配置默认启用 hidden TUI，renderer 初始 store 和浏览器 fallback 同步默认开启；设置页文案从“实验：普通输入走 hidden TUI / 默认关闭”改为“hidden TUI 主链路 / 默认开启”，关闭开关时才使用 prompt 兼容回退。已验证 `pnpm build` 通过、`git diff --check` 通过（仅 LF/CRLF warning）、三处版本号同步；进程检查发现当前仍有正在运行的 Kimix Electron / kimi 进程，疑似用户正在打开的 dev 窗口和 hidden TUI，未擅自关闭，待用户关闭窗口后复查残留。
- v2.8.200：修正 v2.8.199 的方向：不再把官方 `... (N more lines, ctrl+o to expand)` 当成展示过滤问题，而是在 hidden TUI host 发现该截断提示时自动向真实 PTY / pipe 写入 `Ctrl+O`（`\x0f`），让官方 TUI 展开真实内容后再镜像回 Kimix 消息页；同时把 `ctrlO` 加入 TUI 按键白名单，供后续调试/手动闭环使用。已验证 `pnpm build` 通过、`git diff --check` 通过（仅 LF/CRLF warning）；通过可控 hidden PTY 样本输出 `... (5 more lines, ctrl+o to expand)`，确认 host 自动发送一次 `Ctrl+O` 并收到真实展开内容 `EXPANDED_BY_CTRL_O / 真实展开内容第一行 / 真实展开内容第二行`，且无残留 `kimi.exe` / `electron.exe`。
- v2.8.199：曾尝试通过过滤官方 TUI 截断提示修复消息页显示，但用户指出应让消息真正展开而不是过滤；该方向已被 v2.8.200 取代，不作为最终验收依据。
- v2.8.198：继续清理 hidden TUI 菜单状态污染消息页。官方 `/model`、`/plugins` 等菜单镜像打开时，`tuiHost` 不再输出 `thinkingText`；renderer 收到纯菜单 snapshot 时只更新 runtime/model/plugins 镜像，不再用 screen fallback 改写当前 assistant 消息的正文、思考和 `isThinking`。待验证 `pnpm build`、`git diff --check`、真实 hidden TUI 打开 `/model` 后正文/思考字段保持为空且 `screen.models` 仍可用。
- v2.8.197：修复 hidden TUI 菜单/搜索状态污染正式消息页的问题。`tuiHost` 在生成 `answerText` 时识别官方 `/model`、`/plugins`、Marketplace 等菜单屏，过滤 `Select a model Search...`、`No matches`、快捷键提示、分隔线等 TUI chrome；当答案只是可见菜单 fallback 时不再写入助手正文，菜单状态继续走 `screen.models` / `screen.plugins` 镜像。已验证 `pnpm build` 通过、`git diff --check` 通过（仅 LF/CRLF warning）；通过真实 hidden TUI 打开 `/model`，确认 `screen.models` 仍解析到 `Kimi-k2.6` / `deepseek`，但 `answerText` 与 `assistantText` 为空，不再包含菜单搜索行，backend 为 `pty`，且无残留 `kimi.exe` / `electron.exe`。
- v2.8.196：插件页官方 TUI 插件状态卡把“当前选中”从单行提示升级为只读详情卡，展示 selected 插件的 name/id/version/status/source/trust/skills/MCP 摘要，全部来自真实 hidden TUI `screen.plugins` 镜像；不发送任何 TUI 输入，不安装、不启停、不改变官方插件配置。已验证 `pnpm build` 通过、`git diff --check` 通过（仅 LF/CRLF warning）；通过真实 hidden TUI 打开 `/plugins`，确认 selected 插件 `Kimi Datasource` 快照包含 `id=kimi-datasource`、`status=disabled`、`trustLevel=official`、`skillsCount=2`、`mcpSummary=MCP 1/1`、`source=installed`，backend 为 `pty`，且无残留 `kimi.exe` / `electron.exe`。
- v2.8.195：插件页官方 TUI 插件状态卡里的“打开 /plugins”改为安全导航入口，复用 `escape` + `/plugins` 的 official TUI 切屏流程，避免当前已经在官方插件菜单时直接输入 slash 命令被当作普通文本；不发送 Enter / Space，不安装、不启停、不改变官方插件配置。已验证 `pnpm build` 通过、`git diff --check` 通过（仅 LF/CRLF warning）；通过真实 hidden TUI 先打开 `/plugins marketplace`，再执行 Escape + `/plugins`，确认 `screen.plugins[0].source` 从 `marketplace` 切回 `installed`，插件状态仍为 `kimi-datasource:disabled, superpowers:enabled`，backend 为 `pty`，且无残留 `kimi.exe` / `electron.exe`。
- v2.8.194：插件页官方 TUI 插件状态卡补只读选中导航。“上移选中 / 下移选中”只向当前 hidden TUI runtime 发送 `arrowUp` / `arrowDown` 白名单按键，让正式插件页能遥控官方 `/plugins` 菜单的 selected 状态；不发送 Enter / Space，不安装、不启停、不改变官方插件配置。已验证 `pnpm build` 通过、`git diff --check` 通过（仅 LF/CRLF warning）；通过真实 hidden TUI 打开 `/plugins` 后发送 `arrowDown` / `arrowUp`，确认 selected 从 `Kimi Datasource` 移到 `Superpowers` 再回到 `Kimi Datasource`，插件状态仍为 `kimi-datasource:disabled, superpowers:enabled`，backend 为 `pty`，且无残留 `kimi.exe` / `electron.exe`。
- v2.8.193：插件页官方 TUI 插件状态卡补“退出插件菜单”安全闭环。按钮只向当前 hidden TUI runtime 发送 `escape` 白名单按键，用于关闭官方 `/plugins` 或 Marketplace 菜单；不发送 Enter / Space，不安装、不启停、不改变官方插件配置。已验证 `pnpm build` 通过、`git diff --check` 通过（仅 LF/CRLF warning）；通过真实 hidden TUI 打开 `/plugins` 后发送 Escape，确认 `screen.plugins.length=0` 且官方插件菜单标题消失，再重新打开 `/plugins` 确认插件状态仍为 `kimi-datasource:disabled, superpowers:enabled`，backend 为 `pty`，且无残留 `kimi.exe` / `electron.exe`。
- v2.8.192：正式执行层浮层里的 TUI 模型菜单补“退出模型菜单”安全闭环。按钮只向当前 hidden TUI runtime 发送 `escape` 白名单按键，让官方 `/model` 菜单回到普通输入态；不发送 Enter，不应用模型切换。已验证 `pnpm build` 通过、`git diff --check` 通过（仅 LF/CRLF warning）；通过真实 hidden TUI 打开 `/model`、下移选中 `deepseek` 后发送 `escape`，确认模型菜单关闭、`screen.models.length=0`、`Select a model` 消失、`modelName` 仍为 `Kimi-k2.6`，backend 为 `pty`，且无残留 `kimi.exe` / `electron.exe`。
- v2.8.191：正式执行层浮层里的 TUI 模型菜单增加只读安全导航。“上移选中 / 下移选中”只向当前 hidden TUI runtime 发送 `arrowUp` / `arrowDown` 白名单按键，不发送 Enter，不应用模型切换；用于确认正式 UI 能遥控官方模型菜单并镜像 selected 状态。已验证 `pnpm build` 通过、`git diff --check` 通过（仅 LF/CRLF warning）；通过真实 hidden TUI 打开 `/model` 后发送 `arrowDown` / `arrowUp`，确认 selected 从 `Kimi-k2.6` 移到 `deepseek` 再移回，而 current 始终保持 `Kimi-k2.6`，backend 为 `pty`，且无残留 `kimi.exe` / `electron.exe`。
- v2.8.190：官方 `/model` 菜单开始结构化镜像到正式执行层浮层。`TuiScreenSnapshot` 新增 `models`，从真实 `Select a model` 菜单解析模型名、provider、当前项和选中项；底部“执行层”详情浮层在 TUI 模型菜单打开时显示“模型选中”和模型列表，不再只依赖原始屏幕摘要。已验证 `pnpm build` 通过、`git diff --check` 通过（仅 LF/CRLF warning）；通过真实 hidden TUI 打开 `/model`，确认 `screen.models` 只包含 `Kimi-k2.6 (Kimi Code)` 和 `deepseek (deepseek)`，其中 `Kimi-k2.6` 为 selected/current，backend 为 `pty`，且无残留 `kimi.exe` / `electron.exe`。
- v2.8.189：正式底部栏“模型”入口在 TUI 会话下不再切到侧栏 TUI 调试页。点击后仍向当前 hidden TUI runtime 发送官方 `/model`，但留在正式聊天页并展开“执行层”详情浮层查看真实 TUI 模型菜单镜像；prompt 会话仍打开设置页模型配置。待验证 `pnpm build`、`git diff --check` 与真实 Kimix dev app 中模型入口是否停留在正式界面。
- v2.8.188：正式对话底部栏的“执行层”胶囊新增只读详情浮层，不再只能跳侧栏调试页确认 hidden TUI。浮层显示当前链路、runtime id、模型/权限、TUI 屏幕尺寸、插件选中项和最近屏幕摘要；全部来自当前正式会话绑定的 hidden TUI runtime。已验证 `pnpm build` 通过、`git diff --check` 通过（仅 LF/CRLF warning）；通过真实 Kimix dev app 启动 hidden TUI runtime、打开 `/plugins` 并绑定到正式当前会话，点击底部“执行层”后确认浮层出现 Runtime、`Kimi-k2.6 · manual`、`TUI 镜像摘要 120x32`、`插件选中：Kimi Datasource · Installed`，且无残留 `kimi.exe` / `electron.exe`。
- v2.8.187：正式对话底部栏新增“执行层”状态胶囊，让用户在 Kimix 自己的界面里直接看到当前会话走的是 `Prompt 兼容链路` 还是 `hidden TUI · PTY/PIPE · 状态`。TUI 会话会订阅对应 runtime session 的 `onTuiEvent` / `listTuiSessions`，状态来自真实 hidden TUI，不依赖侧栏调试面板。已验证 `pnpm build` 通过、`git diff --check` 通过（仅 LF/CRLF warning）；通过真实 Kimix dev app 启动 hidden TUI runtime 并把正式当前会话标记为 `engine: "tui"`，确认底部栏 DOM 出现“执行层 / hidden TUI / PTY”，且无残留 `kimi.exe` / `electron.exe`。
- v2.8.186：官方插件菜单状态镜像新增当前选中项。`TuiPluginSnapshot` 增加 `selected`，从真实 TUI 插件菜单的 `❯` 高亮行解析；插件页官方 TUI 状态卡和 TUI 调试面板会只读展示“当前选中”并在列表项上用浅色背景 / 边框标记。已验证 `pnpm build` 通过、`git diff --check` 通过（仅 LF/CRLF warning）；通过真实 hidden TUI 打开 `/plugins` 后发送 `arrowDown` / `arrowUp`，确认 `selected` 从 `kimi-datasource` 切到 `superpowers` 再切回，backend 为 `pty`，且无残留 `kimi.exe` / `electron.exe`。
- v2.8.185：插件页官方 TUI 状态卡增加只读安全导航入口。“进入 Marketplace / 返回 Installed”会先向 hidden TUI 发送 Escape 退出当前菜单态，再发送 `/plugins marketplace` 或 `/plugins`，避免在官方菜单内直接输入 slash 命令被当成普通文本；不发送 Space/Enter，不改变插件安装或启停状态。已验证 `pnpm build` 通过、`git diff --check` 通过（仅 LF/CRLF warning）；通过真实 Kimix dev app + hidden TUI 验证 Installed -> Marketplace -> Installed，`screen.plugins[0].source` 依次为 `installed` / `marketplace` / `installed`，backend 为 `pty`，前后插件状态均为 `kimi-datasource:disabled, superpowers:enabled`，未安装/启停插件，且无残留 `kimi.exe` / `electron.exe`。
- v2.8.184：hidden TUI 增加安全按键输入能力。新增 `SendTuiKeyRequest` / `TuiKeyName`，主进程 IPC `tui:sendKey` 只允许 Escape、Enter、Space、Tab、方向键这组白名单按键；`tuiHost.sendTuiKey` 向 PTY/pipe 写入对应原始按键序列；TUI 调试面板增加 Esc/方向键/Enter/Space/Tab 按钮，为后续官方插件菜单启停、Marketplace 安装等真实 TUI 菜单导航打基础。已验证 `git diff --check` 通过（仅 LF/CRLF warning）、`pnpm build` 通过；通过真实 Kimi TUI 打开 `/plugins` 后发送 `arrowDown`，确认选中项从 `Kimi Datasource` 移动到 `Superpowers`，再发送 `escape` 确认插件菜单关闭，backend 为 `pty`。
- v2.8.183：插件页官方 TUI 状态镜像补刷新入口。TUI 会话下的“官方 TUI 插件状态”卡新增“刷新镜像”和“打开 /plugins”按钮；刷新镜像只读取当前 hidden TUI session 的 `screen.plugins`，不改变官方插件状态；打开 `/plugins` 会遥控真实 TUI 菜单，等待后续 screen 事件回传。已验证 `git diff --check` 通过（仅 LF/CRLF warning）、`pnpm build` 通过；通过真实 Kimi TUI 发送 `/plugins`，确认刷新入口依赖的数据源 `screen.plugins` 返回 2 个插件，backend 为 `pty`。
- v2.8.182：Kimix 插件页开始接入官方 TUI 插件状态镜像。`SkillsPanel` 在当前会话为 TUI 引擎且存在 runtime session 时，会订阅对应 hidden TUI session 的 `screen.plugins`，并以只读“官方 TUI 插件状态”卡展示插件 name/id/status/trustLevel/skills/MCP/version/source；非 TUI 会话仍保留原本本地 Skill / MCP 扫描。已验证 `git diff --check` 通过（仅 LF/CRLF warning）、`pnpm build` 通过；通过真实 Kimi TUI 发送 `/plugins`，确认插件页订阅的数据源 `screen.plugins` 解析到 `kimi-datasource` 和 `superpowers`，backend 为 `pty`。
- v2.8.181：TUI 插件状态开始从官方 screen 镜像。`TuiScreenSnapshot` 新增 `plugins`，从真实 `/plugins` 和 `/plugins marketplace` 画面提取插件 name/id/status/trustLevel/skills/MCP/version/source；TUI 调试面板在有解析结果时显示“插件状态”摘要，后续可复用到 Kimix 插件页。已验证 `git diff --check` 通过（仅 LF/CRLF warning）、`pnpm build` 通过；通过两个独立真实 Kimi TUI 会话分别发送 `/plugins` 与 `/plugins marketplace`，确认 installed 源解析到 `kimi-datasource`、`superpowers` 的启用/停用与 skills/MCP 信息，marketplace 源解析到两个插件的 installed 状态、official/curated 信任级别和版本号，backend 为 `pty`。
- v2.8.180：TUI 插件商店入口开始遥控官方 `/plugins marketplace`。顶部菜单的插件 / Skills 入口在当前会话为 TUI 引擎且存在 runtime session 时，会直接发送 `/plugins marketplace` 并切到 TUI 面板；插件页“官方插件商店”按钮在 TUI 会话下同样优先打开官方 TUI Marketplace，非 TUI 会话仍打开官方网页文档。已验证 `git diff --check` 通过（仅 LF/CRLF warning）、`pnpm build` 通过；通过真实 Kimi TUI 发送 `/plugins marketplace`，确认 screen 出现官方 `Official plugins`、`Marketplace`、`Kimi Datasource`、`Superpowers`，backend 为 `pty`。
- v2.8.179：TUI 插件入口开始遥控官方 `/plugins`。侧栏插件按钮和顶部菜单插件/MCP 入口在当前会话为 TUI 引擎且存在 runtime session 时，会发送 `/plugins` 到 hidden TUI 并切到 TUI 面板查看官方插件菜单；非 TUI 会话仍打开 Kimix 插件页。已验证 `git diff --check` 通过（仅 LF/CRLF warning）、`pnpm build` 通过；通过真实 Kimi TUI 发送 `/plugins`，确认 screen 出现官方 Plugins 菜单、Installed plugins、Marketplace、Kimi Datasource、Superpowers，backend 为 `pty`。
- v2.8.178：TUI 模型入口开始遥控官方 `/model`。底部 ContextBar 的“模型”按钮在当前会话为 TUI 引擎且存在 runtime session 时，会发送 `/model` 到 hidden TUI 并切到 TUI 面板查看官方模型菜单；非 TUI 会话仍打开 Kimix 模型设置页。已验证 `git diff --check` 通过（仅 LF/CRLF warning）、`pnpm build` 通过；通过真实 Kimi TUI 发送 `/model`，确认 screen 出现官方 `Select a model` 列表、当前项 `Kimi-k2.6 (Kimi Code) ← current`，backend 为 `pty`。
- v2.8.177：TUI 当前模型状态开始来自官方 screen。`TuiScreenSnapshot` 新增 `modelName`，从真实 TUI 欢迎卡 `Model:` 和状态栏 `Kimi-... thinking` 提取当前模型；`App` 会把该值同步到当前会话 `model` 字段，让底部“模型”入口在 TUI 引擎下显示官方 TUI 的当前模型，而不是固定 `Kimi TUI` 占位。已验证 `git diff --check` 通过（仅 LF/CRLF warning）、`pnpm build` 通过；通过真实 Kimi TUI 启动样本确认 `screen.modelName=Kimi-k2.6`、backend 为 `pty`，来源为官方欢迎卡 `Model:` 行。
- v2.8.176：TUI 权限模式开始遥控官方 `/auto`。`TuiScreenSnapshot` 新增 `permissionMode`，从真实 TUI 状态栏和 `Auto mode: ON/OFF` 输出回读 manual/auto 并同步 Kimix 权限显示；`Composer` 在实验 TUI 会话中点击“手动审批 / 自动权限”会发送 `/auto` 给 hidden TUI 切换官方权限，旧 prompt-mode 权限参数和 `yolo` 本地语义不变。已验证 `git diff --check` 通过（仅 LF/CRLF warning）、`pnpm build` 通过；通过真实 Kimi TUI 发送 `/auto`，确认 screen 捕获 `Auto mode: ON`、状态栏出现 `/auto: auto permission mode`，`screen.permissionMode=auto`、backend 为 `pty`。
- v2.8.175：TUI 输入接管补官方 slash 命令放行。`Composer` 在实验 TUI 引擎开启时不再用旧 SDK/prompt-mode 的 slash 白名单拦截 `/...` 输入，而是把官方 slash 命令原样送入 hidden TUI；`/skill:` 这类 Kimix 本地命令仍先由 Kimix 处理，关闭实验开关后旧 prompt-mode 拦截逻辑不变。已验证 `git diff --check` 通过（仅 LF/CRLF warning）、`pnpm build` 通过；通过真实 Kimi TUI 发送 `/help`，确认 screen 中出现官方命令列表（如 `/auto`、`/compact`、`/export-md` 等），backend 为 `pty`。
- v2.8.174：TUI 异常退出接入 Kimix 错误卡。renderer 收到非 interrupted 的 TUI error / 非零 exit 后，会先清理 pending question，再追加原有 `error` 事件；`ErrorCard` 文案补充 hidden TUI / PTY 进程退出场景，继续保留重试上一条入口。已验证 `git diff --check` 通过（仅 LF/CRLF warning）、`pnpm build` 通过；通过无效 TUI 命令触发真实主进程 error event，确认 `kind=error`、`status=error`、`interrupted=false`、错误摘要为 `spawn ... ENOENT`，并由源码映射进入原有 ErrorCard。
- v2.8.173：TUI 停止/中断态接入 Kimix 状态清理。`TuiSessionSummary` 新增 `interrupted`，主进程在 `stopTuiSession` 触发停止时标记该会话；renderer 收到 interrupted exit 后会清理 pending question，并追加“`TUI 已停止生成。`”状态卡，避免停止后看起来像自然完成或留下等待态。已验证 `git diff --check` 通过（仅 LF/CRLF warning）、`pnpm build` 通过；通过真实 Kimi TUI 启动长输出请求后调用 `stopTuiSession`，确认 session 摘要 `status=exited`、`interrupted=true`、backend 为 `pty`。
- v2.8.172：TUI 提问态接入 Kimix 问题卡。主进程在真实 TUI 回到输入框且 answer 明显是等待用户补充的问题时输出 `questionRequest` snapshot；`App` 将其合并成原有 `question_request` 事件；`QuestionCard` 对 TUI 问题改为把用户回答直接发送到 hidden TUI，旧 prompt-mode `respondQuestion` 链路不变。已验证 `git diff --check` 通过（仅 LF/CRLF warning）、`pnpm build` 通过；通过真实 Kimi TUI 要求先提澄清问题，确认 `questionRequest.questionText` 提取成功，再向 TUI 回答“修复 bug”，确认后续 `answerText=收到。`、backend 为 `pty`。
- v2.8.171：TUI Bash 失败态接入 Kimix 工具失败状态。主进程现在识别真实 TUI 的 `✗ Used Bash (...)` 工具块，将对应 `toolCalls[].status` 标为 `error`，提取退出码 / 失败摘要作为工具输出，并把 `✗` 工具块从 thinking / fallback 文本中排除，避免失败工具过程混入思考正文。旧 prompt-mode 工具失败映射不变。已验证 `git diff --check` 通过（仅 LF/CRLF warning）、`pnpm build` 通过；通过真实 Kimi TUI 强制执行失败 Bash 命令并自动批准一次，确认 `toolCalls[0].status=error`、输出包含 `exit code 7`、`thinkingText` 不含 `✗ Used Bash`、backend 为 `pty`。
- v2.8.170：TUI 多文件完成态开始聚合到 Kimix 变更摘要。`TuiScreenSnapshot` 新增 `changeSummaries` 数组，保留 `changeSummary` 作为首项兼容字段；主进程会收集同屏多个 `● Used Write/Edit (...)` 变更摘要，`App` 将数组逐个合并成原有 `change_summary` 事件，让多文件写入/编辑能在聊天流里显示多项变更。旧 prompt-mode 变更摘要不变。已验证 `git diff --check` 通过（仅 LF/CRLF warning）、`pnpm build` 通过；通过真实 Kimi TUI 创建两个临时文件并批准两次，确认 `changeSummaries.length=2`，两个文件均为 `kind=write`、`additions=1`、backend 为 `pty`，并确认测试临时文件已清理。
- v2.8.169：TUI Edit 批准后的完成态接入 Kimix 变更摘要。`TuiScreenSnapshot.changeSummary` 现在识别真实 TUI 的 `● Used Edit (...) · +N -N` 和其后的 `+N -N <file>` 摘要行，输出 `kind=edit`、文件路径、增删行数；同时把 Read / Edit / Write 等工具块从 thinking / fallback 文本中排除，避免工具过程混进思考正文。旧 prompt-mode 变更摘要不变。已验证 `git diff --check` 通过（仅 LF/CRLF warning）、`pnpm build` 通过；通过真实 Kimi TUI 强制 Edit 临时文件并批准一次，确认 `changeSummary.kind=edit`、`additions=1`、`deletions=1`、backend 为 `pty`，并确认测试临时文件已清理。
- v2.8.168：TUI Edit 审批 diff 预览进入 Kimix 审批卡。主进程识别真实 TUI 的 `● Using Edit (...)` / `▶ Apply these edits?` 审批屏，从 `+N -N <file>` 和 numbered `-` / `+` 行提取 `approvalPreview.kind=edit`、目标文件、`oldText`、`newText`；`App` 继续复用原有 `diff` 事件和审批卡 `approvalDiffs` 展示。旧 prompt-mode diff 映射不变。已验证 `git diff --check` 通过（仅 LF/CRLF warning）、`pnpm build` 通过；通过真实 Kimi TUI 请求编辑临时文件但不批准，确认 `approvalPreview.kind=edit`、`oldText=KIMIX_TUI_EDIT_BEFORE`、`newText=KIMIX_TUI_EDIT_AFTER`、backend 为 `pty`，并确认文件保持原内容且测试临时文件已清理。
- v2.8.167：TUI 覆盖写入审批补真实 oldText，推进 Edit-like diff 体验。真实 Kimi TUI 对简单编辑会走 `Read + Write`，因此 `approvalPreview` 在提取 `Write this file?` 时会尝试读取目标文件当前内容作为 `oldText`，新预览内容作为 `newText`；目标文件不存在时保持新增文件语义。这样审批卡可复用 Kimix 原有 diff 预览展示“改前 / 改后”，旧 prompt-mode diff 映射不变。
- v2.8.166：TUI Write 批准后的完成态接入 Kimix 变更摘要。`TuiScreenSnapshot` 新增 `changeSummary`，主进程从真实 TUI 的 `● Used Write (...) · N line(s)` 提取已写入文件和新增行数，并从 thinking 提取中排除 Write 工具块；`App` 将其合并为原有 `change_summary` 事件，让聊天流继续显示 Kimix 现有“已修改文件 / 变更摘要”卡片。旧 prompt-mode 变更摘要不变。已验证 `git diff --check` 通过（仅 LF/CRLF warning）、`pnpm build` 通过；通过真实 Kimi TUI 创建临时文件并批准一次，确认 `changeSummary.kind=write`、`filePath=.kimix-tui-write-complete-sample.txt`、`additions=1`、`deletions=0`、backend 为 `pty`，并确认测试临时文件已清理。
- v2.8.165：TUI Write 审批接入 Kimix 原有 diff 预览的第一个最小增量。`TuiScreenSnapshot` 新增 `approvalPreview`，主进程从真实 TUI 的 `● Using Write (...)` / `▶ Write this file?` 审批屏提取目标文件路径和 numbered preview 内容；`App` 将其合并为原有 `diff` 事件，让审批卡能复用现有 `approvalDiffs` / 变更预览链路。旧 prompt-mode 审批和 diff 映射不变。已验证 `git diff --check` 通过（仅 LF/CRLF warning）、`pnpm build` 通过；通过真实 Kimi TUI 创建临时文件请求但不批准，确认 `isAwaitingApproval=true`、`approvalPreview.kind=write`、`filePath` 指向 `.kimix-tui-sample-delete-me.txt`、`newText=KIMIX_TUI_DIFF_SAMPLE`、backend 为 `pty`，并确认临时文件未被创建。
- v2.8.164：TUI 工具调用进入 Kimix 工具卡的第一个最小增量。`TuiScreenSnapshot` 新增 `toolCalls`，主进程从真实 TUI 的 `● Using Bash (...)` / `● Used Bash (...)` 块提取 Bash 命令、运行态和输出，并从 assistant 正文提取中排除工具块；`App` 将这些 snapshot 合并成原有 `tool_call` 事件，工具卡展开时展示命令参数和输出。旧 prompt-mode 工具映射不变。已验证 `git diff --check` 通过（仅 LF/CRLF warning）、`pnpm build` 通过；通过真实 Kimi TUI 强制 Bash 只读命令并自动批准一次，确认 `toolCalls[0].toolName=Bash`、`status=success`、`output=KIMIX_TOOL_OK`、`answerText=""`、backend 为 `pty`。
- v2.8.163：TUI 审批画面进入 Kimix 审批卡闭环。`TuiScreenSnapshot` 新增 `approvalText` / `isAwaitingApproval`，主进程识别真实 TUI 的 `Run this command?`、`Approve once`、`Reject with feedback` 等审批屏后不再把它误写入 assistant answer；`App` 将审批屏映射成 `approval_request` 并在等待审批时保持运行态；`ApprovalCard` 在 `engine === "tui"` 时把“允许一次 / 本会话允许 / 拒绝”分别发送到隐藏 TUI 的 `1` / `2` / `3`，旧 prompt-mode 审批仍走 `approveRequest`。已验证 `git diff --check` 通过（仅 LF/CRLF warning）、`pnpm build` 通过；通过真实 Kimi TUI 强制 Bash 只读命令样本，确认 `isAwaitingApproval=true`、`isBusy=true`、`answerText=""`、backend 为 `pty`。
- v2.8.162：TUI 运行态增加 screen-level idle 识别。`TuiScreenSnapshot` 新增 `isBusy` / `isInputIdle`，主进程根据 spinner / working / thinking 提示、输入框 `>` 和是否已有 answer 判断当前 TUI 是否回到可输入状态；`App` 收到 TUI screen 时，如果已有 `answerText` 且 `isInputIdle=true`，立即收口当前 assistant 气泡，否则才保留 2.8 秒空闲兜底。已验证 `git diff --check` 通过（仅 LF/CRLF warning）、`pnpm build` 通过；通过真实 Kimi TUI 发送“只回复 OK”，确认 `answerText=OK`、`thinkingText` 有内容、`isBusy=false`、`isInputIdle=true`、backend 为 `pty`。
- v2.8.161：TUI 语义层进一步拆分 thinking / answer。`TuiScreenSnapshot` 新增 `answerText` 和 `thinkingText`，主进程把最后一个 `●` 块作为临时 answer，之前的 `●` 块合并为 thinking；`assistantText` 保持为 answer 优先的兼容字段。`App` 回填 TUI 气泡时把 `answerText` 写入 assistant 正文，把 `thinkingText` 写入原有 `thinking` 字段，answer 未出现前只显示“ TUI 正在思考。”占位并保持思考态。已验证 `git diff --check` 通过（仅 LF/CRLF warning）、`pnpm build` 通过；通过真实 Kimi TUI 发送“只回复 OK”，确认 `screen.answerText` 为 `OK`，`screen.thinkingText` 提取到思考内容，backend 为 `pty`。
- v2.8.160：给 TUI screen snapshot 增加第一版语义正文提取。`TuiScreenSnapshot` 新增 `assistantText`，主进程基于真实 TUI screen 中最后一个 `✨` 用户输入之后的最后一个 `●` 块提取当前 assistant 正文，并过滤欢迎卡、输入框、状态栏、context、spinner 等 TUI chrome；`App` 回填聊天气泡时优先使用 `assistantText`，没有语义正文时才回退整屏镜像 / 清洗文本。已验证 `git diff --check` 通过（仅 LF/CRLF warning）、`pnpm build` 通过；通过 `node --experimental-strip-types` 直接导入 `electron/tuiHost.ts` 启动真实 Kimi TUI，发送“只回复 OK”，确认 `screen.assistantText` 能提取 `OK`，且不包含 `Welcome to Kimi Code` / `Directory:` / `context:` 等整屏 UI。
- v2.8.159：开始把 hidden TUI 从 Debug Panel 推向正式聊天入口。新增 `experimentalTuiEngineEnabled` 设置项，默认关闭并持久化；设置页新增“TUI 引擎”实验开关。打开后，普通 Composer 新输入会为当前 UI 会话启动 / 复用 hidden TUI session，通过 `sendTuiInput` 发送文本，并由 `App` 订阅 `onTuiEvent`，把 `screen` snapshot 镜像回填到当前 assistant 气泡；TUI 会话空闲 2.8 秒后先作为原型自动收口当前气泡，停止按钮 / Escape 对 TUI session 调用 `stopTuiSession`。旧 prompt-mode 默认链路不变，长程任务仍走旧链路；图片附件暂未接入 TUI，会提示关闭实验开关后发送。已验证 `git diff --check` 通过（仅 LF/CRLF warning）、`pnpm build` 通过。
- v2.8.158：TUI Debug Panel 接入 `@xterm/headless`，每个 hidden TUI session 在主进程维护 headless terminal screen buffer；`TuiSessionSummary` 新增 `screen` snapshot，renderer 默认显示“镜像”视图，并保留“文本 / ANSI”切换和复制能力。新增依赖理由：复用成熟终端解析器，避免手写 ANSI/screen buffer；回滚方式：移除 `@xterm/headless` 依赖、`screen` 字段和调试面板“镜像”模式。已验证 `git diff --check` 通过（仅 LF/CRLF warning）、`pnpm build` 通过；通过 `node --experimental-strip-types` 直接导入 `electron/tuiHost.ts`，启动 `cmd.exe` PTY 输出 `SCREEN_READY`，确认 `listTuiSessions().data[].screen.lines` 捕获该输出，调用 `resizeTuiSession({ cols: 88, rows: 20 })` 后 screen snapshot 尺寸同步为 `88x20`，并能 `stopTuiSession` 停止。
- v2.8.157：TUI Debug Panel 进入阶段 2 的第一个最小增量。`electron/tuiHost.ts` 新增 PTY resize 能力，IPC / preload / browser preview 类型链路补齐 `tui:resizeSession`；调试面板用 `ResizeObserver` 按日志容器估算终端 cols/rows 并同步给 hidden PTY，同时增加清洗文本 / 原始 ANSI 输出切换和复制按钮。已验证 `git diff --check` 通过（仅 LF/CRLF warning）、`pnpm build` 通过；通过 `node --experimental-strip-types` 直接导入 `electron/tuiHost.ts`，启动 `cmd.exe` PTY 后调用 `resizeTuiSession({ cols: 100, rows: 24 })` 返回成功，并能 `stopTuiSession` 停止。
- v2.8.156：把 `electron/tuiHost.ts` 从 pipe 原型推进到真实 PTY 优先：新增运行时依赖 `@lydell/node-pty`，Windows 下通过预编译包使用 ConPTY，保留 pipe fallback；调试面板会显示当前 backend 为 `PTY` 或 `PIPE`。直接安装 `node-pty` 曾被本机 Visual Studio Spectre mitigated libraries 缺失卡住，已改用无安装脚本的 `@lydell/node-pty`。已验证 `git diff --check` 通过（仅 LF/CRLF warning）、`pnpm install` 通过、`pnpm build` 通过；Node 直接加载 `@lydell/node-pty` 启动 `cmd.exe /c echo PTY_OK` 成功；通过 `node --experimental-strip-types` 直接导入当前 `electron/tuiHost.ts`，调用 `startTuiSession` 启动真实 Kimi Code TUI，`sendTuiInput("只回复 OK")` 后捕获最终回复 `● OK`，`stopTuiSession` 返回成功，随后 `Get-Process kimi` 确认没有残留 `kimi.exe`。
- v2.8.155：开始 hidden Kimi Code TUI 原型。新增 `electron/tuiHost.ts` 作为主进程 TUI 会话管理层，提供启动 / 输入 / 停止 / 列表和 renderer 事件推送；`electron/main.ts` 接入 `tui:*` IPC 并在退出时清理 TUI 进程；`electron/preload.ts`、`src/main.tsx` 和 `electron/types/ipc.ts` 补齐 TUI 类型与浏览器预览兜底；前端新增 `src/components/layout/TuiDebugPanel.tsx`，在侧栏新增 “TUI 调试” 入口，并把版本号同步到 v2.8.155。尚未完成 build / diff 验证。
- v2.8.110：P0「其他模型 API 接入配置」完成第一个只读增量：新增 `kimi:getModelConfig`，脱敏读取 Kimi Code `config.toml` 的 `default_model`、Provider 摘要和 Model alias 摘要；设置页 Kimi 登录卡下方新增模型配置摘要块；`KIMI_CODE_HOME` 优先级接入主进程、bridge 会话目录和 hook 配置写入路径。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.154：新增 `docs/KIMIX_TUI_ENGINE_MIGRATION_PLAN.md`，作为下一窗口迁移到 hidden Kimi Code TUI 引擎的主计划文件。计划明确冻结 prompt-mode 扩展，分阶段实现 `KimiTuiHost`、终端镜像、输入接管、状态机重做、语义化聊天视图、官方能力 GUI 化、历史迁移和旧引擎删除，并附下一窗口开工提示词。三处版本号同步到 v2.8.154。
- v2.8.153：修复 prompt-mode 结束 / 引导失败后的运行态残留。Composer 判断当前会话运行中时同时匹配 UI 会话 id 和 runtime session id，终态 status 也会清理这两种 id，避免右下角仍显示错误状态；prompt-mode 不支持 SDK `Turn.steer()`，当引导返回 `No active turn` 时不再在对话里留下失败引导，而是清掉运行态并把内容作为普通新消息发送；遇到官方续会话缺失 tool response 的 `tool_calls` 错误后，自动断开下一轮 `--continue`，避免继续接入坏的官方上下文。三处版本号同步到 v2.8.153。
- v2.8.152：修复关闭思考后 assistant 消息头缺失。消息头“正在思考 / 执行中 / 已处理 xx”属于每条 agent 回复必须保留的生命周期信息，不应依赖 thinking 内容是否开启；`MessageBubble` 现在只要不是被渲染层显式隐藏的重复片段，就始终显示 `AssistantProcessSummary`，关闭思考时也保留执行中 / 已处理时长。三处版本号同步到 v2.8.152。
- v2.8.151：补 prompt-mode 长推理阶段的实时状态 fallback。实测官方 `wire.jsonl` 在某些长请求中只先写 `turn.prompt` / `step.begin`，直到模型返回前不实时写出 `content.part think`，导致 Kimix 没有真实思考正文可回放；现在轮询 `logs/kimi-code.log` 的 `llm request` 记录，作为可展开过程项提示“官方尚未实时写出思考正文”和当前 step / 估算输入 tokens，一旦 `wire.jsonl` 后续写出真实 `think` 仍继续回放真实思考。三处版本号同步到 v2.8.151。
- v2.8.150：修复 prompt-mode 运行中思考回放的两个边界问题。官方 `agents/main/wire.jsonl` 可能在不同轮次复用同一个 `turnId`，Kimix 不再用最新 `turnId` 回捞本轮 thinking，改按本轮用户 prompt 时间切分，避免把前几次对话的思考混进当前轮；同时运行中轮询不再只盯已记录的 `cliSessionId`，会把显式 session 和最近活跃官方 session 目录一起作为候选，避免 `--continue` / 官方内部换目录时输出过程中看不到新增思考。三处版本号同步到 v2.8.150。
- v2.8.149：统一已发送消息和输入框图片预览路径。新增 `ImagePreviewOverlay`，通过 React portal 挂到 `document.body`，避免已发送消息处于 `kimix-message-enter` transform 动画容器内时让 `position: fixed` 预览被局部容器约束；`Composer` 和 `MessageBubble` 均复用同一预览 / 画板入口。三处版本号同步到 v2.8.149。
- v2.8.148：补 prompt-mode 运行中思考回放。`kimi --output-format stream-json -p` 正文会走 stdout，但 thinking 只写入官方 `agents/main/wire.jsonl`；现在 prompt-mode 回合运行期间每 1.2 秒轻量扫描本项目最新官方会话文件，按 `uuid` 去重回放新增 `think` part，让“正在思考”阶段也能出现可展开内容，结束时再补一次漏网 thinking。三处版本号同步到 v2.8.148。
- v2.8.147：修复历史回复处理时长重新打开后越算越长。`MessageBubble` 对已完成 assistant 消息不再用实时 `elapsed` 兜底；历史事件缺少 `durationMs` 时显示 0s，避免把“当前时间 - 回复开始时间”误显示成已处理几十分钟。三处版本号同步到 v2.8.147。
- v2.8.146：修复左上角前进 / 后退无效和内部会话外露。TopMenuBar 的左右箭头不再调用 Electron 单页里无实际意义的 `window.history.back/forward`，改为切换当前项目内上一条 / 下一条可见对话；菜单里的“后退 / 前进”同步复用该逻辑。会话标题改为优先取真实用户消息，后端列表与前端侧栏 / 搜索都会过滤 `只回复 OK/NEW`、Hooks 规则创建、长程任务调度、需求澄清包装、交接提示等 Kimix 内部提示，避免系统会话出现在用户对话列表。三处版本号同步到 v2.8.146。
- v2.8.145：修正插件页官方文档跳转。旧链接 `www.kimi.com/code/docs/kimi-code-cli/...` 已替换为新版 `moonshotai.github.io/kimi-code/zh/customization/plugins.html`，官方插件商店按钮跳到“安装与管理 plugins”说明，自定义插件文档按钮跳到 “Plugin manifest” 说明；新版文档确认官方插件通过 `/plugins`、`/plugins marketplace [source]` 管理，Superpowers 应作为整体 Plugin 接入。三处版本号同步到 v2.8.145。
- v2.8.144：修正 Kimi Plugin 在插件页的展示口径。`.kimi-code/plugins` 下的安装项不再递归拆分为多个 `skills/*/SKILL.md` 卡片，而是按 `plugin.json` / `kimi.plugin.json` 聚合成一个整体 Kimi Plugin 卡片；官方 Kimi Plugin 信任标签显示“官方”，状态显示“已安装”，不再展示“第三方”或当成本地 Skill 开关。三处版本号同步到 v2.8.144。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.143：插件页改为暴露官方 Kimi Plugin 入口，并移除 Kimix 旧 Superpowers UI 接入。插件页侧栏新增“官方插件商店”卡片，可打开官方插件页 / 自定义插件文档，并可直接安装官方示例 `kimi-datasource` ZIP；手动安装入口从“仅 GitHub”改为支持 GitHub URL 或官方 ZIP Plugin URL。顶部不再显示 Kimix 旧 Superpowers 安装按钮，侧栏不再显示旧 Superpowers 诊断卡；新建会话不再自动注入 Kimix Superpowers agent-file，后续 Superpowers 交由官方 Plugin 系统接管。三处版本号同步到 v2.8.143。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.142：底部模型状态改为显示当前对话绑定模型，而不是当前默认模型。主进程从 Kimi Code 会话 `wire.jsonl` 的 `config.update.modelAlias` / `usage.record.model` 回读会话模型，并在 `startSession` 响应中返回；前端 `Session` 增加 `model` 字段，创建 / 恢复会话时记录该值；`ContextBar` 只显示当前会话模型，缺失时显示“未记录”，不再用默认模型冒充。三处版本号同步到 v2.8.142。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.141：继续修正设置页勾选视觉居中，并补卡死诊断展开。连接情况卡内部从顶部对齐改为垂直居中；新对话建议卡顶部勾选行从 `items-start` 改为 `items-center`；卡死诊断默认只显示最近 8 条，超过 8 条时提供和归档对话同款展开 / 折叠按钮。三处版本号同步到 v2.8.141。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.140：设置页可选项勾选统一垂直居中。去掉 `SelectionIndicator` 自身顶部偏移，并把 `.kimix-settings-permission` 从顶部对齐改为垂直居中，使权限模式、消息信息、上下文显示、通知方式、模型列表等复用该结构的勾选圆点和蓝色勾都按整行视觉居中。三处版本号同步到 v2.8.140。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.139：调整底部模型状态入口。去掉“新对话生效”文案，底部只显示“模型 + 当前模型名”；点击模型按钮会切换到设置页并滚动到“模型配置”区块，方便直接管理默认模型 / Provider。三处版本号同步到 v2.8.139。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.138：修复模型配置 Context 编辑保存问题。Context 输入改为可临时清空的文本状态，显示居中，保存 / 测试时才校验 1 到 1048576 的整数；保存已有 Kimix 管理 Provider 时，API Key 留空会沿用 config.toml 里原有密钥，不再因只改 Context 触发 `apiKey` 为空校验失败。三处版本号同步到 v2.8.138。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.137：补新对话底部默认模型提示，并将聊天输入和空正文提示中的 Kimi 文案改为 Agent。底部状态栏新增“模型 <default_model> · 新对话生效”，提示当前读取到的默认模型；说明模型切换通常对新对话生效，已有会话沿用创建时模型。思考过程条目只要有内容就允许展开，避免 deepseek 等模型流式回复过程中短 thinking 块没有展开箭头、回复结束后才可展开。三处版本号同步到 v2.8.137。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.136：修复侧栏新对话与项目折叠两个交互问题。新建会话入口在放入占位会话前先强制切回 `workspaceView="chat"`，确保右侧设置 / 插件 / Hooks 等窗口及时关闭并显示新对话；项目展开同步改为只在切换到不同项目时自动展开，点击当前已展开项目时不再被 `currentProject` effect 立即拉回展开；同时项目标题点击仅在展开且无会话时自动创建首个会话，收起时不再触发创建。三处版本号同步到 v2.8.136。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.135：按设置页反馈做一个 UI 收敛增量：新对话建议轮数和模型配置 Context 数字输入隐藏上下 spinner；模型配置里 OpenAI-compatible Provider 从内嵌卡片改为同一卡片内分隔区，减少一层边框/背景；默认模型徽章改为蓝色；移除“保存后设为默认模型”复选项，保存 Provider 不再携带 makeDefault，默认模型仍通过独立“设为默认”按钮完成。三处版本号同步到 v2.8.135。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.134：统一已发送消息图片与输入框图片的预览结构。已发送消息原先在 `MessageBubble` 里维护另一套图片 preview markup，尺寸、按钮位置和画板按钮样式都与 `Composer` 不一致；现改为与输入框图片预览相同的 overlay 结构、关闭按钮布局、图片尺寸约束和画板按钮样式。三处版本号同步到 v2.8.134。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.133：修复点击搜索后侧栏突然出现大量历史会话的问题。根因是 `SearchOverlay` 打开时把 `listSessions` 返回的磁盘历史直接 `addSession()` 写入全局会话 store，侧栏读同一 store 后立即展示这些历史；现改为搜索弹层内部维护 search-only 历史索引，仅在用户从搜索结果点开某个历史会话时才加入全局会话列表。三处版本号同步到 v2.8.133。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.132：确认官方 `kimi --output-format stream-json -p` 可触发 `ReadMediaFile` 工具读取图片文件；prompt-mode 图片附件提示改为明确要求先调用 `ReadMediaFile` 逐一读取本轮落盘图片，再基于图片内容回答，避免模型只根据路径 / 文件名 / 占位符作答。三处版本号同步到 v2.8.132。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.130：恢复设置页默认刷新连接情况 / Kimi 登录 / 模型配置；模型配置独立卡片改用设置页既有标题、说明、选中项和按钮层级，模型项可选中并保留“设为默认 / 测试 / 保存”闭环。三处版本号同步到 v2.8.130。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.131：修复 prompt-mode 图片附件只变成 `[图片]` 占位符的问题；当官方 CLI 无 `--wire` 只能走 `kimi -p` 时，Kimix 会把 `data:image` 附件保存到项目内 `.kimix-uploads/images/`，并在 prompt 中写入真实本地图片路径，避免模型只能读到占位文本。三处版本号同步到 v2.8.131。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.111：P0 继续补 OpenAI-compatible Provider 最小闭环：新增保存 Provider/Model alias 到 Kimix managed models 区块、保存前备份 `config.toml`、可选更新顶层 `default_model`、临时 `KIMI_MODEL_*` 连接测试，并在设置页提供 Base URL/API Key/模型名/Context/默认模型表单。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.112：P0 收尾补新会话默认模型生效：移除主会话、侧栏、空态、长程任务和交接恢复等 `startSession` 调用里的 `kimi-code/kimi-for-coding` 硬编码，避免覆盖 Kimi Code `config.toml` 的 `default_model`；同时将会话错误归一为 API Key / Base URL / 模型名 / 登录过期等可区分中文摘要。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.113：P1「Plugin 从 GitHub URL 安装」完成第一个最小闭环：插件页新增 GitHub URL 输入与安装按钮；后端新增 `project:installKimiPlugin`，校验 GitHub URL 后调用官方 `kimi plugin install <url>`，安装成功后刷新本地插件列表；若当前 CLI 未暴露 plugin install，则把 CLI 输出转成明确错误提示。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.114：P2「Plugin 自带 MCP Server 管理」完成第一个发现/展示增量：主进程扫描 `$KIMI_CODE_HOME/plugins/managed`、`.kimi-code/plugins`、旧 `.kimi/plugins` 下的 `plugin.json`、`kimi.plugin.json`、`.kimi-plugin/plugin.json`，提取 manifest 中的 `mcpServers`；MCP 面板新增“Plugin 随带 MCP”只读分区，展示来源 plugin、传输方式、启用态和命令/URL 摘要，避免误用普通 MCP 删除操作破坏 plugin 状态。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.115：P2 继续补“管理 / 测试”桥接：由于本机 Kimi Code 0.6.0 未暴露 `plugin` / `mcp` 子命令，MCP 面板给 Plugin 随带 MCP 增加“加入配置”按钮；后端重新校验 manifest 来源并把对应 `mcpServers` 条目写入 Kimi `mcp.json`，写入前备份，导入后可复用普通 MCP 卡片的测试、授权、重置授权链路。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.116：P3「后台 Agent 状态恢复提示」完成第一个状态增量：长程任务新增持久化 `recovery` 元信息；执行 / 审查 agent 运行失败或中断时自动记录原因、建议动作和时间，手动暂停也写入可恢复说明；顶部长程任务状态按钮显示“可恢复 · 失败/中断/暂停”，右侧长程任务栏展示可恢复状态块和下一步建议。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.117：P3 继续收口恢复动作：右侧长程任务“可恢复状态”块新增“继续”和“复制 prompt”动作；点击继续 / 开始执行会清理 `recovery` 并给出“已继续长程任务”反馈，避免失败或中断提示在恢复后残留。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.118：P4「模型错误恢复与重试提示」完成第一个错误卡片增量：`ErrorCard` 按登录、模型配置、Token/额度、上下文溢出、压缩失败、请求终止等类型展示中文标题、恢复建议和可操作按钮；登录错误可直接打开登录，模型/API/Base URL/Token/上下文类可打开模型配置，所有错误可复制详情。`kimiBridge` 同步补 token/context/terminated/compact 关键词归一。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.119：P4 继续补安全重试：`ErrorCard` 仅对请求中断 / 泛型临时错误显示“重试上一条”，登录、模型配置、上下文溢出、压缩失败等不可直接重试类型不显示重试；`ChatThread` 重试时复用当前会话最后一条用户/steer 消息，只追加新的 assistant 占位，不重复插入用户消息，失败时追加新的错误卡。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.120：P5「套餐用量展示对齐官方新体验」完成第一个展示增量：用量浮层显示官方来源和更新时间，保留 5小时 / 本周两段进度与刷新时间；后端在用量接口失败时带出服务端响应摘要；登录过期/401 场景在浮层状态摘要中提供“重新登录”按钮，登录后自动刷新用量。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.129：补“设为默认”旧 preload 保护：如果当前 Electron 窗口尚未载入 `setKimiDefaultModel`，设置页不再抛出界面错误，而是提示完全关闭 Kimix dev 窗口后重启；三处版本号同步到 v2.8.129。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.128：补模型配置选中 / 默认模型测试链路：模型列表卡片可点击选中并回填表单，非默认模型提供“设为默认”按钮；新增 `kimi:setDefaultModel` IPC，只更新 Kimi `config.toml` 顶层 `default_model`，无需重新输入 API Key，新会话即可用选中模型测试。三处版本号同步到 v2.8.128。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.127：修复点击“模型配置-刷新”卡死根因：`readKimiModelConfig()` 原 TOML section 扫描在真实 `config.toml` 上会因嵌套 `RegExp.exec()` 和 `lastIndex` 回退进入无限循环，已改为 `matchAll()` 一次性收集 section 边界；实测本机 config 解析 0.138ms。设置页同时把模型配置从 Kimi 登录卡内部拆成独立小卡，避免两个模块视觉粘连。三处版本号同步到 v2.8.127。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.126：继续修复启动进入设置页无响应：设置页首屏不再自动触发 Kimi CLI 检查、登录刷新和模型配置读取，只保留卡死诊断轻量加载；连接情况、Kimi 登录和模型配置改为用户点击检查 / 刷新后再执行，避免 workspace 初始页同时启动多条 IPC 导致 Electron 被系统判定未响应。三处版本号同步到 v2.8.126。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.125：修复进入设置页 OOM / 无响应风险：设置页归档列表改为订阅轻量会话摘要，避免完整会话 events 进入设置页渲染链路；卡死诊断 localStorage 读取和 lag 检测写入都增加 64KB 上限，异常过大时自动清理，防止 JSON.parse 超大历史导致 V8 heap OOM。三处版本号同步到 v2.8.125。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.124：完成 P0-P7 验收需求报告，新增 `docs/KIMI_CODE_0_6_P0_P7_ACCEPTANCE_REPORT.md`，逐项列出代码侧完成项、用户验收步骤、已知边界和回传模板；三处版本号同步到 v2.8.124。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.123：P7「Write / Edit 审批 diff 与全屏查看增强」继续补审批卡 diff 预览：`ChatThread` 将同轮结构化 `diff` 事件传给审批卡；审批卡按涉及文件关联 diff，展示最多 2 个文件的紧凑增删预览和 +/- 统计，全屏详情与接受 / 拒绝链路保持不变。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.122：P7「Write / Edit 审批 diff 与全屏查看增强」完成第一个审批卡可读性增量：审批卡解析 JSON / 文本详情中的文件路径，展示工具名、风险级别、操作摘要和涉及文件；详情预览保留原始内容并新增全屏查看 / 复制详情浮层。审批接受 / 拒绝仍沿用原 `approveRequest` 链路，状态回写不变。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.121：P6「官方 `/export-md` 导出」完成第一个独立 Markdown 导出入口：侧栏会话行新增“导出 Markdown”按钮，与“导出 Kimi Debug ZIP”分开；主进程新增 `project:exportMarkdown`，保存 `.md` 后打开所在位置。当前 Kimi Code 0.6.0 `kimi export --help` 仅暴露 ZIP 导出，未暴露 `export-md` 参数，因此本轮先使用 Kimix 会话事件生成 Markdown，并保留后续接官方 `/export-md` 的入口边界。已验证 `pnpm build` 通过，`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- 官方 changelog/npm/本机均确认 Kimi Code 最新为 `0.6.0`。
- 实测 `kimi --session <session_id> --output-format stream-json -p ...` 仍会误报 different directory。
- 实测 `kimi --continue --output-format stream-json -p ...` 可恢复最近会话并返回同一 `session.resume_hint`。
- 实测 `kimi --output-format stream-json -p ...` 的 stdout 只返回 assistant 正文和 `session.resume_hint`；新版思考内容落在 `.kimi-code/sessions/wd_<project>_<hash>/session_<id>/agents/main/wire.jsonl` 的 `context.append_loop_event` / `content.part` / `part.type="think"`。
- `pnpm build` 通过；`git diff --check` 通过（仅 Git 的 LF/CRLF warning）。
- v2.8.105：输入区加号小浮层宽度从 372px 缩到 260px；画板比例按钮改为 38px 固定宽度，需求澄清分段控件同步收窄，保持现有行数不换行。
- v2.8.106：修复套餐用量查询失败。根因是 Kimi Code 0.6.0 的 OAuth refresh token 接口要求 `application/x-www-form-urlencoded`，Kimix 旧实现发送 JSON 导致 HTTP 400 `unsupported_grant_type`；已改为和官方 CLI 一致的 form body，并在刷新失败时带出服务端错误摘要。

## 历史目标
v2.8.56 待验收：隐藏规则创建 agent 内部会话，避免 prompt/JSON 暴露到侧栏和主对话。

## 当前版本
**v2.8.56** — 三处同步：`package.json` + `src/components/layout/Sidebar.tsx` + `src/components/settings/SettingsPanel.tsx`。

## Kimi 特有能力路线图
### 执行顺序
1. Hooks 自动化规则中心
2. Plugins / 项目工具箱
3. 视觉验收：自动截图、让 Kimi 查看并给出修复建议
4. 会话 Fork：从历史轮次分支出新方案

### Step 1：Hooks 自动化规则中心
目标：把 Kimi Code 官方 hooks 做成 Kimix 可视化规则中心，用于安全拦截、自动验收、通知和项目级工作流。
- [ ] 盘点 SDK/CLI hooks 支持面：`PreToolUse`、`PostToolUse`、`Stop`、`StopFailure`、`SessionStart`、`SubagentStart`、`PreCompact` 等。
- [ ] 设计规则数据结构：触发事件、匹配器、动作类型、命令/提示/阻断原因、启用状态、项目级/全局级。
- [ ] 后端接入 Agent SDK `hooks`，支持 allow/block、timeout、错误回传和日志记录。
- [ ] 前端新增 Hooks 设置页：规则列表、新建/编辑、启停、测试触发、最近命中记录。
- [ ] 内置首批模板：危险命令拦截、文件改动后自动 build/lint、失败时通知、需求澄清/审批/完成通知增强。
- [ ] 验收：至少一个 `PreToolUse` 阻断规则和一个 `Stop` 后自动命令规则可端到端运行。

### Step 2：Plugins / 项目工具箱
目标：把 Kimi Code plugins 和项目常用脚本做成可安装、可启停、可测试的工具箱。
- [ ] 盘点官方 plugins 配置方式和本地目录结构。
- [ ] 设计插件列表、详情、启停、项目级安装/移除 UI。
- [ ] 支持把项目脚本包装成 agent 可调用工具。
- [ ] 内置常用模板：运行测试、生成 changelog、读取项目约定、发布前检查。
- [ ] 验收：一个本地插件能被 Kimix 创建、启用，并被 Kimi Code 调用。

### Step 3：视觉验收自动截图查看
目标：对 UI 改动自动截图，让 Kimi 读取截图并按 Kimix 留白规则给出问题和修复建议。
- [ ] 接入本地窗口/页面截图能力，支持 Electron 主窗口和指定区域。
- [ ] 设计视觉验收任务：截图、附带当前改动摘要、调用 Kimi 视觉能力分析。
- [ ] 输出结构化结果：通过/不通过、问题位置、建议改法、可一键转成修复 prompt。
- [ ] 优先覆盖高风险区域：右侧栏、弹窗、小浮层、对话流圆角框、底部状态栏浮层。
- [ ] 验收：一次 UI 改动后可生成截图分析，并能把问题回填到当前会话。

### Step 4：会话 Fork
目标：利用 Kimi SDK `forkSession` / `parseSessionEvents`，从历史轮次分支出不同实现方案。
- [ ] 读取官方 session 列表和事件，映射到 Kimix 当前会话。
- [ ] 在消息/轮次菜单增加“从这里 Fork”。
- [ ] Fork 后创建新 Kimix 会话，保留来源信息和分支说明。
- [ ] 支持比较两个分支的结果、文件变更和验收状态。
- [ ] 验收：从历史第 N 轮 fork 出新会话并继续提问，原会话不受影响。

## 当前开发会话待办
### 已完成
- [x] 长程任务创建后复用主对话流，不在弹窗里继续聊天。
- [x] 创建 `.kimix-long-tasks/<task-id>/` 基础骨架：`BIGPLAN.md`、`state.json`、executor/reviewer prompt、`reviews/REVIEW_QUEUE.md`。
- [x] 顶部长程任务 banner、侧栏长程任务会话底色、右上 `PanelRight` 展开右侧栏。
- [x] 右侧栏读取并展示真实 `BIGPLAN.md` 和 `REVIEW_QUEUE.md`。
- [x] 右侧待审查项支持点击确认、划线、移动到“已审查”，并支持撤回。
- [x] 澄清卡片支持折叠、已处理默认折叠、保留历史选项/输入、已处理不可再次点击。
- [x] 本轮处理详情底部增加“收起本轮内容”；重启后不再把已处理时长写成 0 秒。
- [x] 同一轮里需求澄清卡片按时间语义排在 assistant 正文下方。
- [x] 状态回写 `state.json`：`stage`、`activeAgent`、`currentStep`、`targetStep`、人工审查确认状态。
- [x] 审查 agent 接棒闭环：executor 明确交审后，由 Kimix 独立 reviewer session 输出，并可靠更新顶部 banner/右侧状态。

### 待推进
- [x] reviewer 结果路由：通过 / 需修复 / 待人工审查后，决定交回 executor、等待用户或进入下一步。
- [x] 支持“执行到第 N 步”：用户设置目标步骤，调度器按 BIGPLAN 顺序推进。
- [x] 轮次记录：产品层自动把每轮执行、审查、修复、接棒和完成状态追加写入 `rounds/step-XXX.md`。
- [x] 自动修复闭环：审查发现问题后生成修复 prompt，executor 修复后再交 reviewer 复查。
- [x] 长程任务控制区：右侧栏支持暂停、继续、切换当前 agent、设置目标步骤、查看并复制下一步 prompt。
- [x] 执行状态按钮同步到顶栏，方便随时查看/打开长程任务状态。
- [x] 右侧栏展示 `rounds/step-XXX.md` 轮次记录。
- [x] 命令页面上下移动时跟随焦点，避免选中项跑出可视区域。
- [x] 删除对话全面改为归档对话，并把归档入口补到设置页。
- [x] 错误弹窗按设计规范修正图标、关闭按钮、边距和垂直居中。
- [x] 长程任务页面和任务列表继续修留白，避免元素贴边或贴在一起。
- [x] 思考图标和展开按钮互斥：短内容只显示思考图标，需要展开时用展开按钮代替。
- [x] 卡死诊断入口补到设置页，可查看最近 `kimix_freeze_reports`。

## 已完成
- v2.7.63：
  - `ChatThread` 渲染分组保留 primary assistant 之前的 `question_request` 原始位置，避免点击继续后上一轮已处理澄清卡被重新挂到下一轮 agent 输出下面。
  - 右侧栏“继续/执行到 Step”内部调度 prompt 明确本轮只允许执行当前 Step，完成后必须停止并交给审查 agent；即使目标 Step 未达到，也不能自行继续下一步。
  - 审查通过后调度 executor 的 prompt 同步补充硬性停止条件，防止执行 agent 把多个 Step 合并到一轮里。
  - 版本号三处同步到 v2.7.63。
- v2.7.62：
  - reviewer 隐藏 session 的 assistant/thinking/tool/status 流式事件会镜像合并到主对话里的同一条审查代理消息；内部用户 prompt 仍隐藏不展示。
  - 运行中的代理消息按普通 assistant 逻辑展示思考详情，存在 thinking/tool/status 时可直接展开查看。
  - assistant 头部文案统一为“正在思考（执行/审核）”“执行中（执行/审核）”“已处理（执行/审核）”，其他正文、Markdown、复制、展开逻辑保持一致。
  - 版本号三处同步到 v2.7.62。
- v2.7.61：
  - reviewer 完成时如果运行占位气泡已被通用收口逻辑清掉，会补建一条带审查正文的代理消息，避免审查信息像“消失”一样不显示。
  - 需求澄清卡片头部只保留问号图标在左侧，展开/收起按钮移到卡片右端，减少左侧图标挤在一起的观感问题。
  - 版本号三处同步到 v2.7.61。
- v2.7.60：
  - 审查/执行代理气泡完成时，详情内容写入普通 assistant `content`，由 `MarkdownRenderer` 渲染，不再塞进 `thinking` 伪装成思考详情。
  - 运行中的代理气泡仍保留思考态；完成后正文、复制和展示逻辑与普通输出一致。
  - 版本号三处同步到 v2.7.60。
- v2.7.59：
  - 长程任务规划启动 prompt 和 executor 专属规则明确要求：存在关键歧义时必须调用官方 AskUserQuestion/需求澄清工具，允许多轮澄清，不用普通正文替代澄清卡片。
  - reviewer 审查 prompt 明确要求最终正文第一行必须写“结论：通过 / 需修复 / 待人工审查”，不要只写在思考过程。
  - 调度器解析 reviewer 输出时改为正文优先、正文为空再用思考文本兜底，并补充“审核通过 / 可继续 / 下一步 / 继续 Step”等通过表达，避免审核输出被误判为无明确结论。
  - 版本号三处同步到 v2.7.59。
- v2.7.58：
  - 顶部工具栏的终端按钮统一为与差异面板、长程任务侧栏按钮一致的 36px 方形圆角边框样式。
  - 长程任务右侧栏的“工作 agent”和“执行到”控制块改为竖向布局，增加块内 gap 和输入框高度，减少窄栏挤压。
  - reviewer 完成时不再先结算空白代理气泡；调度解析到审核输出后，会带详情内容一次性结算“已处理（审核）”，后续可展开查看。
  - 审核通过识别补充“符合预期/执行吧/继续执行/无阻塞/未发现问题”等常见表达；自动发送给执行 agent 的下一步 prompt 明确这是内部调度，不再询问用户是否继续。
  - 版本号三处同步到 v2.7.58。
- v2.7.57：
  - reviewer 完成后会把隐藏收集到的审核输出写入“已处理（审核）”代理气泡详情，后续可展开查看。
  - 代理气泡详情摘要从“段思考”调整为“段内容”，避免把审核/执行输出误标成思考。
  - 版本号三处同步到 v2.7.57。
- v2.7.56：
  - 同一轮内多个 `change_summary` 事件会合并为一张“文件已更改”卡片，避免连续出现多张单文件变更卡。
  - 变更卡每个文件行右侧新增独立撤销按钮；撤销成功后只移除对应文件行，并移除卡片头部的全局撤销入口，避免非 Git 项目部分撤销后仍报错。
  - 撤销后端改为按文件所属 Git 根执行，并对非 Git 项目的 `.kimix-long-tasks` 生成文件提供受限兜底；普通非 Git 文件无法安全恢复时返回明确中文错误。
  - 版本号三处同步到 v2.7.56。
- v2.7.55：
  - 将 `electron/kimiBridge.ts` 的 session metadata 预热从 `startSession` 关键路径移到后台执行，避免长程任务创建 executor/reviewer 两个 session 时串行等待 5-10 秒。
  - metadata 预热超时改为明确 warning，不再打印整段 TimeoutError 栈；会话启动继续返回，真实可用性仍以后续 sendPrompt/status 为准。
  - 版本号三处同步到 v2.7.55。
- v2.7.49：
  - 继续把 `Composer`、`MessageBubble`、`ContextBar`、`SkillsPanel`、`ChatThread` 等高频区域切到统一主题 token，补齐深色模式下的输入区、思考卡、用量浮层、技能面板、图片预览和长程任务 banner。
  - 将工具返回的结构化 diff 映射为独立 `diff` 事件，并在主界面接入最小可用“差异面板”，可按时间查看最近变更并打开对应文件。
  - 版本号三处同步到 v2.7.49。
- v2.7.48：
  - 修复深色模式下设置面板、主壳层、侧栏、长程任务检查器、帮助/引导弹层等一级容器仍大面积保持浅色的问题。
  - 浏览器预览模式补齐 `getSettings` / `saveSettings` 本地持久化，主题切换后不再在下次打开时丢失。
  - 版本号三处同步到 v2.7.48。
- v2.7.47：
  - 继续收口设置页“新对话建议 / 语音输入 / 归档对话 / 卡死诊断”等卡片内边距和列表说明间距。
  - 收口长程任务右侧窄栏里的“已审查”区块、Kimi CLI onboarding 卡片，以及 Composer / ContextBar / 思考过程卡片等常用浮层与边框块的留白。
  - 版本号三处同步到 v2.7.47。
- v2.7.46：
  - 收口关于/更新弹窗中的说明卡、更新时间线卡和操作按钮间距，避免按钮与正文、卡片边界贴得过近。
  - 收口长程任务头部 banner、消息里的思考详情面板、Skills 面板顶部说明区的 sibling gap 与内边距。
  - 版本号三处同步到 v2.7.46。
- v2.7.45：
  - 设置页“连接情况”里，`已找到 Kimi CLI` / `Kimi CLI 连接正常` 的左侧标记统一改成和其他已选项一致的蓝色圆形勾选指示器。
  - 版本号三处同步到 v2.7.45。
- v2.7.44：
  - 为设置页标题行补上通用规则：`kimix-settings-section-title` / `kimix-settings-row-title` 后的内容块默认增加 12px 顶部间距，避免模块标题和内容直接贴在一起。
  - 版本号三处同步到 v2.7.44。
- v2.7.43：
  - 设置页为“上下文详细显示”补上独立模块标题“上下文显示”，不再视觉上挂靠在“权限模式”下面。
  - 版本号三处同步到 v2.7.43。
- v2.7.42：
  - 继续收口右侧长程任务栏的 BIGPLAN / 轮次记录 / 待审查等卡片，统一 section 内部的 sibling gap、块间距和说明块 padding。
  - 收紧 `ContextBar` 套餐浮层、`Composer` 权限/思考菜单、`SettingsPanel` 归档对话/卡死诊断/输入配置卡片的留白，减少“块贴块”和“内容挤在一起”的风险。
  - 版本号三处同步到 v2.7.42。
- v2.7.41：
  - 右侧长程任务状态栏的“工作 agent / 执行到 / 下一步 prompt”三块改成统一的纵向 stack 和显式 gap，避免紧挨在一起。
  - `AGENTS.md` 的“UI 留白防回归”重写为“硬规则 / 高风险区域 / 提交前留白验收清单”三段式，新增“独立区块之间最小间距”和“必须检查 sibling gap”硬约束。
  - 版本号三处同步到 v2.7.41。
- v2.7.39：
  - `src/main.tsx` 新增浏览器预览模式的 `window.api` 兜底实现；非 Electron 环境下会自动注入同签名 API，避免 `getSettings` 等调用在首屏直接报错。
  - 预览模式下提供只读/空实现：基础设置、应用信息、外链打开、窗口控制和事件订阅都有安全降级；需要原生能力的操作会返回明确提示，不再以未定义 API 方式崩溃。
  - 版本号三处同步到 v2.7.39。
- v2.7.38：
  - 长程任务创建弹窗的项目卡、创建卡、输入框和底部说明区补齐上下留白，避免标题、输入框和边框贴得过紧。
  - 右侧长程任务状态栏的“当前状态”“执行到 Step”控制区补齐卡片内边距与段间距，按钮区不再挤在一起。
  - 版本号三处同步到 v2.7.38。
- v2.7.37：
  - 新手引导新增“一键安装 Kimi CLI”，Windows 下直接执行官方 `install.ps1`，不再要求用户先手动安装 `uv`。
  - `kimi:checkCli` 会补查常见安装路径，并把命令目录临时补进当前进程 PATH，降低首次安装后仍识别不到 CLI 的概率。
  - 官方说明链接改为稳定可打开的 Kimi CLI 中文入门文档地址，避免点击后跳到空白页。
  - 版本号三处同步到 v2.7.37。
- v2.7.36：
  - 修复 v2.7.35 安装包启动后 `Monitor is not defined` 的渲染错误。
  - 补齐 `src/components/layout/AppShell.tsx` 中 Kimi CLI 引导卡片使用的 lucide `Monitor` 图标 import。
  - 版本号三处同步到 v2.7.36。
- v2.7.35：
  - 应用启动后会自动调用 GitHub Release 更新检查，更新记录弹窗不再需要用户先手动检查。
  - 发现新版本时，更新记录顶部显示蓝色“升级”按钮。
  - 新增 `app:downloadUpdate` IPC：按当前平台和包体类型选择 Release asset，下载到用户下载目录 `Kimix Updates/`，下载完成后启动升级包。
  - 版本号三处同步到 v2.7.35。
- v2.7.34：
  - 修正 assistant 流式文本合并逻辑，工具调用后只在下一段非空内容开始时补一次段落间隔。
  - 短流式碎片不再触发额外段落断开，避免回复被拆成单字/短词纵向排列。
  - 版本号三处同步到 v2.7.34。
- v2.7.33：
  - 应用启动后会检测 Kimi CLI；如果 PATH 中找不到 `kimi` 命令，会显示居中的新手配置引导。
  - 引导卡片提供官方说明入口、复制安装命令、打开设置、重新检测和稍后配置。
  - 已安装 Kimi CLI 的用户不会看到该引导。
  - 版本号三处同步到 v2.7.33。
- v2.7.32：
  - 侧栏项目点击时，“是否已有会话”改为只判断未归档会话。
  - 当某项目只剩归档会话时，再次打开会直接新建会话，不会把已归档会话重新拉出。
  - 版本号三处同步到 v2.7.32。
- v2.7.31：
  - 长程任务弹窗移除“任务列表”整块，只保留项目选择和创建入口，避免与左侧会话列表重复。
  - 同步删除弹窗内与旧任务列表、打开主对话、打开任务目录相关的冗余前端逻辑。
  - 版本号三处同步到 v2.7.31。
- v2.7.30：
  - 设置页新增统一选中指示器，选中项改为蓝色勾选圆点，不再只靠颜色区分。
  - assistant 在同一轮中跨工具阶段继续输出时，会自动插入段落换行，避免两次输出直接粘连。
  - 版本号三处同步到 v2.7.30。
- v2.7.29：
  - 设置页新增“卡死诊断”区块，直接读取本地 `kimix_freeze_reports`，展示最近记录的时间、卡顿毫秒数和关联会话。
  - 诊断入口支持手动刷新和清空，方便在复现卡顿后快速核对或重置样本。
  - 顶部 docx 待办已全部收敛完成。
  - 版本号三处同步到 v2.7.29。
- v2.7.28：
  - 长程任务弹窗的项目卡、创建卡、任务列表卡片和状态信息块补充明确内边距与间距，减少标题、状态胶囊、session 文本和按钮贴边。
  - 任务列表中的步骤、agent、session 和更新时间改为独立浅底信息块，提升横向密集区域可读性。
  - 思考项现在只在内容较长或含多行时显示展开箭头；短内容仅保留思考图标和摘要，避免图标与展开按钮同时出现。
  - 版本号三处同步到 v2.7.28。
- v2.7.27：
  - 运行时错误弹窗新增警告图标和右上角关闭按钮，关闭不会强制刷新。
  - 错误弹窗外层保持视口垂直/水平居中，卡片和详情区域补充明确边距、圆角和留白。
  - 主操作按钮改为克制红色实心按钮，避免黑色描边/黑色主按钮过重。
  - 版本号三处同步到 v2.7.27。
- v2.7.26：
  - 输入框 `/` 和 `@` 候选浮层在方向键切换时，会把当前选中项滚入可视区域，避免高亮项跑出面板。
  - 会话侧栏单个对话和项目菜单“归档对话”改为写入 `archivedAt`，不再从本地会话列表物理移除；侧栏和搜索默认隐藏归档会话。
  - 设置页新增“归档对话”入口，展示最近归档对话数量和列表，并支持恢复。
  - 版本号三处同步到 v2.7.26。
- v2.7.25：
  - `longTasks:getDetail` 返回 `rounds/step-XXX.md` 文件列表、相对路径、内容和更新时间。
  - 右侧长程任务栏新增“轮次记录”区块，按 Step 展示执行/审查/修复/接棒/完成记录摘要，并支持打开对应记录文件。
  - 版本号三处同步到 v2.7.25。
- v2.7.24：
  - 将 docx 未完成项整理进当前开发会话待办，后续按列表依次收敛。
  - 主内容顶栏运行按钮在长程任务会话中改为真实状态按钮，显示当前执行/审查 agent、阶段和 Step 进度。
  - 点击顶栏长程任务状态按钮会直接打开右侧长程任务栏，普通对话下保留小运行按钮并提示当前不是长程任务。
  - 版本号三处同步到 v2.7.24。
- v2.7.23：
  - 长程任务右侧栏“当前状态”卡片新增工作 agent 分段切换，可手动切到执行或审查 agent，并持久化到 `state.json`。
  - 新增暂停/继续控制：暂停会同步停止当前长程任务 turn 并把阶段写为 `paused`；继续复用现有“执行到 Step”调度入口。
  - 新增下一步 prompt 预览和复制，按当前 activeAgent/stage 生成执行或审查提示词。
  - 版本号三处同步到 v2.7.23。
- v2.7.22：
  - 新增 `longTasks:appendRound` IPC 和 `appendLongTaskRound` 服务，按 taskId 精确定位任务目录，把调度过程写入 `rounds/step-XXX.md`。
  - executor 交审时自动记录本轮执行输出；reviewer 给出结论时自动记录审查输出；继续/修复/完成时自动记录接棒或完成状态。
  - 修正 reviewer 结论为“需修复”时仍把 `currentStep` 加一的问题；现在修复留在当前 Step，通过或待人工审查可继续时才进入下一 Step。
  - 版本号三处同步到 v2.7.22。
- v2.7.21：
  - Kimi 流式事件从逐条立即更新会话，改为按 session 进行 80ms 批处理，减少长输出时的 React 重渲染次数。
  - 终止状态到达前会先 flush 流式批次，避免完成/审查调度读取到落后一拍的输出。
  - 本地会话持久化 debounce 从 180ms 放宽到 900ms，降低长程任务流式输出时频繁 `JSON.stringify` 大会话的压力。
  - 版本号三处同步到 v2.7.21。
- v2.7.20：
  - 主进程窗口状态通知增加 fullscreen 状态，进入/退出全屏也会同步 renderer，降低卡住后窗口样式与实际状态不一致的概率。
  - `window:isMaximized` 现在会把全屏也视作最大化类状态，右上角按钮图标更容易和真实窗口状态保持一致。
  - 右侧长程任务详情改为打开时读取、会话事件变化后静默刷新，并每 3 秒轮询一次；agent 更新 BIGPLAN/REVIEW_QUEUE 后右侧栏会自动跟进。
  - 版本号三处同步到 v2.7.20。
- v2.7.19：
  - 长程任务 state 查找改为按 `state.json` 里的 `taskId` 精确匹配，不再靠文件夹名前缀，避免两个相似任务目录互相串读。
  - 长程任务进度识别把“当前步骤”与“目标步骤”拆开，避免 Step 1 完成后误把计划最大步数写成当前步骤。
  - 长程任务旧消息的“重新发送”按钮在当前任务里会对非最新用户消息禁用，避免关闭重开后把旧内容重发到错误步骤。
  - renderer 增加轻量卡死诊断心跳：事件循环延迟过大时会记录到本地并输出到控制台，方便后续抓卡顿原因。
  - 版本号三处同步到 v2.7.19。
- v2.7.18：
  - 右侧长程任务状态卡新增“执行到 Step”输入框，可保存目标步骤到 `state.json`。
  - 右侧栏支持直接点击“开始执行”，由 Kimix 把“执行到 Step N”的内部 prompt 发给 executor session。
  - 手动启动时如果当前已经停在 Step 2，会从 Step 2 开始执行，符合“执行到第 3 步就是做 2 和 3”的语义。
  - 版本号三处同步到 v2.7.18。
- v2.7.17：
  - reviewer 输出“待人工审查”时不再把长程任务暂停；这类事项只进入右侧待审查，从计划推进角度等同可继续。
  - 下一步 executor prompt 文案从“审查通过”调整为“审查可继续”，避免误导用户以为待人工审查已完全确认。
  - 版本号三处同步到 v2.7.17。
- v2.7.16：
  - reviewer 完成后会解析“结论：通过 / 需修复 / 待人工审查”，并分别进入下一步、交回 executor 修复或记录待人工确认项后继续推进。
  - 审查通过且未达到目标步骤时，会自动生成下一步 executor prompt，并把当前步骤推进到下一步。
  - 审查发现问题时，会自动生成修复 prompt 发回 executor；executor 修复完成后仍沿用交审规则再次触发 reviewer 复查。
  - 启动补偿扫描新增 reviewer 完成后的路由补偿，避免重载后卡在审查完成但未继续调度的状态。
  - 版本号三处同步到 v2.7.16。
- v2.7.15：
  - executor 完成后会从最新输出识别 `Step N`、`当前步骤`、`rounds/stepN.md`、`待审查/交给审查 agent` 等执行证据。
  - 识别到计划确认输出时，会把长程任务推进到 `ready` 并记录目标步骤；识别到执行输出时，会把 `stage` 推进到 `running`、更新 `currentStep` 并回写 `state.json`。
  - reviewer 接棒判断改为基于“执行完成证据 + 交审意图”，避免只看旧 `state.json` 导致执行完成后不接棒。
  - 启动后会扫描已恢复的长程任务历史；如果旧会话已经出现“执行完成 + 交审”但未触发 reviewer，会补偿派发审查 agent。
  - 版本号三处同步到 v2.7.15。
- v2.7.14：
  - 审查 agent 自动接棒条件收紧为仅 `running` 执行阶段触发，drafting/planning/ready 阶段不会因“计划完成后审查”等文字误切 reviewer。
  - drafting/planning/ready 阶段统一把用户输入路由到 executor，即使旧状态曾停在 reviewer/reviewing，也会在本地恢复为执行 agent。
  - 长程任务创建提示、executor/reviewer 专属 prompt 和创建面板文案调整为“规划阶段不审查，执行阶段再审查”。
  - 版本号三处同步到 v2.7.14。
- v2.7.13：
  - Kimix 自动发送给 reviewer 的内部审查 prompt 不再作为用户消息显示，主对话下一条可见输出保持为审查 agent 回复。
  - 从长程任务列表重新打开任务时，会恢复 executor 与 reviewer 两段历史，并按 `activeAgent` 指向当前真实 session。
  - reviewer 启动失败时会把长程任务状态回写为 reviewer/paused，避免顶部 banner 和 `state.json` 长时间停在“正在工作”的假状态。
  - 当前开发会话待办中“审查 agent 接棒闭环”已标记完成。
  - 版本号三处同步到 v2.7.13。
- v2.7.12：
  - 新增 `longTasks:updateState` IPC，用于把长程任务状态字段安全写回对应任务目录的 `state.json`。
  - activeAgent/stage/currentStep/targetStep/reviewedReviewItems 会随运行状态变化和人工审查勾选同步持久化。
  - 从任务列表打开长程任务主对话时，会从 `state.json` 恢复 `reviewedReviewItems`。
  - 当前开发会话待办中“状态回写 state.json”已标记完成。
  - 版本号三处同步到 v2.7.12。
- v2.7.11：
  - `TASK_STATE.md` 顶部“当前开发会话待办”按“已完成 / 待推进”拆分，匹配本轮协作计划。
  - 搜索确认产品 UI 中没有“长程任务功能开发待办”或开发 roadmap 常量残留。
  - 版本号三处同步到 v2.7.11。
- v2.7.10：
  - 撤回误加到产品右侧栏的“长程任务功能开发待办”UI，避免把协作看板混入正式功能界面。
  - 在 `TASK_STATE.md` 顶部新增“当前开发会话待办”，作为本轮对话/协作进度看板。
  - 版本号三处同步到 v2.7.10。
- v2.7.9：
  - 曾误把“当前开发会话待办”做进产品右侧栏；v2.7.10 已撤回。
  - 版本号三处同步到 v2.7.9。
- v2.7.8：
  - 右侧长程任务“待审查”条目可点击确认，确认后从待审查列表移到“已审查”区。
  - 已审查条目显示删除线，点击后可撤回到待审查列表。
  - 人工审查确认状态保存到长程任务会话元数据中，不改写原始 `REVIEW_QUEUE.md`。
  - 版本号三处同步到 v2.7.8。
- v2.7.7：
  - 同一轮中存在 assistant 正文时，`question_request` 需求澄清卡片会排在 assistant 正文之后，避免澄清块抢到最终回复文字上方。
  - 版本号三处同步到 v2.7.7。
- v2.7.6：
  - executor 完成规划且无待处理结构化澄清时，Kimix 会主动把审查 prompt 发给长程任务 reviewer session，并把长程任务状态切到 reviewer/reviewing。
  - 长程任务顶部 banner 在 reviewer 工作时改为淡黄色，执行 agent 保持淡蓝色。
  - 执行 agent 专属提示词与创建后的启动 prompt 均补充规则：需要审查时不要自己调用 subagent/Reviewer 来模拟审查。
  - 澄清卡片支持折叠；已回答/已跳过的卡片默认折叠，展开后保留曾经选择的选项或自定义回答。
  - 本轮处理详情展开后底部增加“收起本轮内容”按钮。
  - 重启收口未完成 assistant 时不再把缺失时长写成 0 秒。
- v2.7.5：
  - 新增 `longTasks:getDetail` IPC，从当前项目内安全读取长程任务 `BIGPLAN.md` 和 `reviews/REVIEW_QUEUE.md`。
  - 右侧长程任务栏不再只显示占位说明，会解析展示目标、初始需求、Step 列表、当前步骤状态和待人工审查项。
  - 待审查队列为空时显示“暂无待人工审查项”。
  - 版本号三处同步到 v2.7.5。
- v2.7.4：
  - 长程任务创建基础骨架已接入：`electron/longTaskService.ts` + `.kimix-long-tasks/<task-id>/` + `BIGPLAN.md` + `state.json` + executor/reviewer 双 agent prompt 文件 + `reviews/REVIEW_QUEUE.md`。
  - 创建长程任务后进入主 `ChatThread`，不在弹窗内继续聊天。
  - 主对话顶部已有固定蓝色长程任务 banner，距离顶部约 10px。
  - 侧栏长程任务会话有淡蓝色底色，选中态更深。
  - 右上 `PanelRight` 按钮已能展开长程任务右侧栏。
  - 右侧栏已显示基础信息：任务名、当前 agent/stage、BIGPLAN 路径、待审查路径、打开按钮。
  - 底部输入区外壳顶部留白从 8px 改为 10px。
  - 版本号三处同步到 v2.7.4。
  - `pnpm build` 已通过，`pnpm dev` 已重新启动。
- v2.7.3：
  - 右侧长程任务栏标题区下方到第一张内容卡片的纵向间距改为 10px。
- v2.7.2：
  - 顶部固定长程任务条与顶栏间距改为 10px。
  - 主内容区与右侧长程任务栏间隔改为显式 10px。
- v2.7.1：
  - 长程任务蓝色信息条固定在主对话顶部，距顶栏约 20px，不随聊天内容滚动消失。
  - 侧边栏中的长程任务会话默认使用淡蓝底色，当前选中态加深，和普通会话区分。
  - 右上角展开按钮接入长程任务侧栏，显示当前状态、BIGPLAN 入口和待审查入口；可视化计划树与待审查列表先留出后续承载区域。
- v2.7.0：
  - 长程任务创建后直接生成主对话会话壳，切换到主 ChatThread，并把规划启动 prompt 发给执行 agent；弹窗不再承载对话流。
  - 长程任务列表支持“打开/回到主对话”：即使重载后本地内存里没有该任务会话，也会恢复 executor/reviewer 两个真实 session，并把 executor 历史映射回主对话流。
  - 主事件路由会把 executor/reviewer 任一真实 session 的事件映射回同一个长程任务主会话，并根据运行中的真实 session 更新当前工作 agent。
  - Composer、停止、引导、审批、澄清回答、压缩和重新发送统一按当前 active agent 的真实 sessionId 路由，避免长程任务上下文串到错误 agent。
- v2.6.9：
  - 新增长程任务 IPC 和主进程服务，在项目隐藏目录 `.kimix-long-tasks/<task-id>/` 下创建 `BIGPLAN.md`、`state.json`、`prompts/executor/AGENTS.md`、`prompts/reviewer/AGENTS.md`、`reviews/REVIEW_QUEUE.md` 和 `rounds/000-bootstrap.md`。
  - 创建长程任务时会启动执行 agent 与审查 agent 两个真实 Kimi session，并在 `state.json` 中记录各自 sessionId、当前阶段、当前工作 agent、步骤游标和目标步骤。
  - 长程任务面板从占位改为第一版工作台：可选择当前项目或新项目、输入初始需求、创建任务、查看任务列表、打开 BIGPLAN 和任务目录。
  - 任务列表中显示当前阶段、当前工作 agent、执行/审查 sessionId 和步骤状态，为后续“谁在干活就把用户消息发给谁”的消息流铺底。
- v2.6.8：
  - 压缩需求澄清卡片底部操作区高度：按钮行从 60px 收到 46px，卡片底部 padding 从 18px 收到 12px，提交/跳过按钮保持在操作区垂直居中。
- v2.6.7：
  - 会话和排队消息从仅 `beforeunload` 保存改为 Zustand 状态变化后防抖写入 `localStorage`，减少 dev 重载、强杀 Electron/Node 时丢失最新 UI 事件。
  - `QuestionRequest` 澄清事件到达后立即额外落盘，降低刚弹出澄清卡就重启时卡片消失的风险。
  - 启动恢复最新 Kimi 会话时，会用历史 session id 和 runtime session id 查找已有本地会话；命中本地会话且已有事件时优先保留本地 `question_request` 等 Kimix UI 事件，避免被 SDK 原生历史覆盖。
  - 已保留上一轮自定义回答交互：输入框已有文字时点击/聚焦即可选中自定义答案；点击上方选项只切换高亮，不清除自定义文本。
- v2.5.45：
  - 确认 Kimi Agent SDK 已在 Wire 初始化中声明 `supports_question: true`，官方 `AskUserQuestion` 能力可由 agent 触发。
  - 补齐 `QuestionRequest` 事件映射、Kimix 风格结构化问题卡片、用户回答回传 IPC 与 SDK `respondQuestion` 链路。
  - 保持需求澄清工具默认 `auto`；发送时按关闭/开启/自动判断三态注入轻量行为策略，自动模式只在高歧义、高返工风险时引导 agent 调用官方结构化提问。
  - 本地用户气泡和历史去重会剥离 Kimix 澄清策略包装，只显示用户原始消息，避免 prompt 策略污染对话 UI。
- v2.5.44：
  - 轮末消息信息增加本地输出时间，格式如 `2026-05-10-22-33-55`。
  - 需求澄清工具从二态改为三态：关闭、开启、自动判断；点击切换时不再关闭左下角加号菜单。
  - 需求澄清工具开启态和 Skill 已启用态统一改为发送按钮同款蓝色 `#339af0`，作为 Kimix 差异色。
  - 查明并修复 agent 回复被渲染成“窄窄一条”的根因：流式 `ContentPart` 合并时错误插入双换行，现改为按 SDK 原始增量直接拼接。
- v2.5.43：
  - 项目菜单接入置顶、在资源管理器中打开、归档本项目对话、从侧栏移除项目；重命名项目和创建永久工作树先提示“待实现”。
  - 最近项目为空时自动创建并选中软件数据目录下的默认项目，避免新窗口停在“未选择项目”导致输入框不可用。
  - Composer 左下角加号增加“需求澄清工具”开关，默认关闭并持久化；官方暂无独立澄清工具接口，后续按本地策略接入发送流程。
- v2.5.42：
  - Markdown 行内代码加大内边距和左右呼吸空间，避免浅灰背景/阴影挤压文字。
  - Markdown 表格外框与单元格边框统一为浅灰色，避免圆角矩形看起来像纯黑描边。
  - 输入区语音按钮改为触发可配置系统快捷键，默认 `Win+H`；设置页新增“语音输入”快捷键配置。
  - 左侧栏“自动化”改为“长程任务”，点击打开未来长程任务配置占位面板。
- v2.5.41：
  - 收起侧栏时移除重复的展开按钮，只保留标题栏侧栏按钮；按钮会随展开/收起切换图标形态。
  - 侧栏收起后仍保留新对话、搜索、技能三个窄栏图标入口。
  - 子代理事件进入 assistant 顶部折叠过程区，摘要行补充“X 个子代理”，展开后与思考、命令按时间顺序显示。
- v2.5.40：
  - 子代理状态不再提前显示到 assistant 最终回复前；同一轮内改为显示在最终回复文字之后、轮末消息信息之前。
  - 轮末消息信息胶囊恢复显示 `消息 / Tokens / Context`，避免只剩 message id 看起来像信息缺失。
- v2.5.5：
  - Slash 命令补全改用不重复斜杠的命令图标，避免图标和 `/init` 文案双斜杠。
  - 发送前校验 `/xxx` 是否属于当前 Kimi SDK 会话返回的可用 slash 命令；明确拦截 `/status`、`/usage` 这类 Shell 层命令，提示使用底部“套餐用量”菜单，避免发送后出现 Unknown slash command。
- v2.5.7：
  - 图片和文字同在一条用户消息里时，图片缩略图区和文字气泡之间改用 inline `marginBottom: 12` 明确留白，避免 Tailwind spacing 缓存/JIT 导致看起来贴在一起。
- v2.5.8：
  - 修复重启后历史会话里残留未完成 assistant 思考块导致“正在思考”继续计时的问题：TurnEnd 会收口所有未完成 assistant，重启加载和本地保存时也会冻结非运行会话的未完成思考状态。
- v2.5.9：
  - 空状态建议列表行距放大到约 1.5 倍；点击建议后立即进入禁用/选中反馈，并用同步锁防止快速连点并发创建多个会话。
  - 底部停止按钮除了全局运行态，也会在当前会话存在未完成 assistant 时显示；点击会立即冻结本地未完成状态并调用 SDK stopTurn，修复“仍在思考但无法停止”的兜底问题。
- v2.5.10：
  - 对话流自动跟随时，用户滚轮、触控或指针操作会立即暂停自动下滚，并取消待执行的 smooth scroll；只有点击“到底部”按钮才恢复跟随，避免流式回复和用户滚动对抗。
- v2.5.11：
  - 修复滚动自动跟随状态在高频 scroll/wheel 事件中重复 setState，可能触发 React `Maximum update depth exceeded` 的问题；滚动状态改为 ref 去重后才更新，并移除过宽的 pointerDown 打断监听。
- v2.5.12：
  - 左侧顶部导航项放大左右留白并加 hover 阴影，避免图标贴边或看起来超出 hover 背景。
  - 新增 Codex 风格搜索浮层，可搜索当前项目会话标题、用户消息、助手回复、思考、工具、状态、Todo、错误和变更内容；官方 Kimi SDK 只提供 listSessions/parseSessionEvents，没有全文搜索 API，因此由 Kimix 本地索引补齐。
  - 新增技能面板，先扫描本机 `.kimi/skills`、`.config/agents/skills`、`.codex/skills` 下的 `SKILL.md`；官方 SDK 目前只暴露 `skillsDir` 入参，没有 list/manage Skill API。
- v2.5.13：
  - Skill 面板支持勾选全局启用；Kimix 会复制选中 Skill 到 `~/.kimix/enabled-skills`，并在新建/恢复会话时通过官方 `--skills-dir` 传给 Kimi CLI。
  - 明确 `/skill:xxx` 不是 Kimix 的 Skill 触发协议，只会作为普通用户文本发送；Skill 是否触发由 Kimi CLI 在启用目录和会话上下文中处理。
  - 查明 Kimix 不会手动注入 `SKILL.md` 到 prompt；若 agent 提到系统上下文已有 Skill 文档，来自 Kimi CLI/SDK 的 skills 机制或会话历史，而不是 Kimix 壳层重复注入。
  - 查明 Kimix 只在用户本轮附图时向 `sendPrompt` 传 `image_url`；同一 Kimi session 内早期图片仍可能被 CLI 历史上下文引用，这是会话延续语义，不是壳层再次发送。
- v2.5.14：
  - Skill 扫描改为递归查找 `SKILL.md`，恢复 `.codex/skills/.system/skill-creator` 等二级目录技能在面板中的显示和启用。
- v2.5.15：
  - 新建会话入口增加全局创建中状态、本地占位会话和按钮禁用反馈，避免 SDK 启动慢时多次点击创建多个会话。
  - 技能面板两段提示改为短文案并补足上下间距；Skill 卡片右侧状态标签加大内边距，避免背景贴文字。
- v2.5.16：
  - 设置中新增消息信息显示策略，默认只在每轮对话末尾显示最后一条 Tokens/Context 状态胶囊，也可切换为实时多次显示。
  - Kimi 轮次完成后基于 Git 工作区基线展示本轮更改文件摘要，提供“撤销”入口；暂不实现审核弹窗。
  - 助手正文提到 `.md` 文件时补充文档元素块，点击“打开”优先跳转到 VS Code。
- v2.5.17：
  - 对话渲染改为按用户轮次收集工具命令，并把命令摘要挂到本轮 assistant 回复顶部；默认折叠，点击后展开命令列表，避免命令堆积在最终回复下方。
- v2.5.27：
  - assistant 顶部“已处理/正在思考”改为折叠菜单，思考块和命令条目进入同一个元信息区域，减少正文前的大块堆积。
  - 思考默认只显示第一句话摘要，单段点击后才展开全文；旧历史思考会按段落/句组拆分，新流式 think 会保存 `thinkingParts` 以便后续按时间与命令排序。
- v2.5.28：
  - 聊天流显示层会折叠已配对的 `CompactionBegin -> CompactionEnd`，只保留“上下文压缩完成”，避免旧的“压缩中...”动画在完成后继续播放。
  - 思考折叠条目的箭头和脑图标改为固定 20px 居中容器，去掉上偏移，和单行/换行摘要保持垂直居中。
- v2.5.29：
  - 设置中新增“新对话建议”，默认开启，推荐轮数上限默认 10 轮，后续可再补 token 输入/输出阈值配置。
  - ContextRing 悬浮窗增加“推荐会话长度”进度条，显示剩余推荐轮数。
  - agent 回复完成后若当前会话达到推荐轮数上限，会在轮末插入 Kimix 本地提示卡片；用户不点击时后续每轮继续提示，点击“开启新对话”会在当前项目下创建并切换到新会话。
- v2.5.30：
  - 长会话建议卡片左侧图标改为固定 24px 居中容器，避免看起来偏上。
  - 卡片右侧新增“携带交接内容”按钮：点击后旧会话进入隐藏“交接中...”流程，生成结果不显示在旧会话；生成完成后自动开启当前项目新会话，并把交接内容作为首条消息发送。
  - 交接期间当前会话 Composer 禁用输入，避免用户继续发送消息打断隐藏生成。
- v2.5.31：
  - 修复历史重载时多轮相同 `user_message` 被 `TurnBegin` 去重逻辑误删的问题。
  - 用户消息去重现在只作用于“最近一轮尚未产生实质 assistant 回复”的乐观插入场景，不再跨已完成回复全局去重。
- v2.5.32：
  - ContextRing 悬浮窗改为 pointer/focus 立即触发并提高 z-index，避免 agent 回复中 hover 不弹出。
  - 长会话建议卡片按钮移动到正文下一行；“携带交接内容”改为文字在前、图标在后，避免右侧显示不全。
  - 输入框 textarea 顶部 padding 从 6px 收到 3px，使文字到上边和左边的视觉距离更一致。
- v2.5.33：
  - ContextRing 移除 mouse/pointer 双事件绑定，只保留 pointer/focus 触发，避免 hover tooltip 离开后被重复 enter 事件重新打开。
  - “携带交接内容”按钮完整显示为“携带交接内容开启新对话”，交接状态会持续到新会话创建并发送交接内容后再释放。
  - Composer 停止按钮改读 `sessionStore` 中的实时会话事件，停止时同步收口目标 session 的未完成 assistant，并回写当前会话快照，避免切换会话后才刷新。
- v2.5.34：
  - 标注的运行、审查/差异、底部项目和分支入口点击后统一弹出“待实现”，避免无反馈。
  - 对话标题右侧三点菜单改为 Codex 风格列表；已接入重命名、复制工作目录、复制会话 ID、复制深度链接、复制为 Markdown。
  - 置顶、归档、打开侧边聊天、派生、本地自动化和新窗口打开等暂未实现能力先置灰不可点击。
- v2.5.35：
  - “携带交接内容”不再直接向原会话的真实 Kimi session 发送隐藏交接 prompt，避免污染原会话上下文。
  - 交接生成改为启动隐藏临时 session，并把 Kimix 可见聊天记录拼入 prompt 让其离线总结；生成事件只进入 handoff job，不进入原会话 UI。
  - 隐藏交接 sessionId 会记录到本地并在启动加载最新会话时过滤，同时完成后关闭活动 session，避免下次启动误打开交接生成会话。
  - 对已经被旧逻辑污染过的原会话，用户后续发送消息时会一次性换到干净的 SDK sessionId，并保留 Kimix 可见历史，避免继续只思考不回复。
- v2.5.36：
  - 交接源会话如果已经卡在旧污染 SDK session 的运行态，不再等待下一次正常发送；Composer 会主动关闭旧 session、换干净 session，并补发最后一条用户消息。
  - 自愈判断改为识别所有非 running 的交接建议卡片，不再只依赖 `handoffStatus === "completed"`，兼容旧历史里状态字段缺失的卡片。
  - `ensureSession` 改为优先读取 `sessionStore` 最新快照，避免 appStore 当前会话快照过旧导致自愈条件判断不到。
- v2.5.37：
  - 撤销 v2.5.36 中“把可见会话 id 替换为新 SDK sessionId”的方案，避免刷新/重载后只剩最后一轮 SDK 原生历史。
  - `Session` 新增 `runtimeSessionId`：UI 会话 id 和完整历史保持不变，所有 Kimi API 调用按需走 `runtimeSessionId`。
  - App 事件/状态流会把 runtime sessionId 映射回原 UI sessionId，重启加载时也会识别 runtimeOwner，防止可见历史被底层新 session 覆盖。
- v2.5.26：
  - 技能面板新增“添加”按钮，可选择本地 `.zip` Skill 压缩包导入；面板也支持直接拖放 `.zip` 导入。
  - 导入的 Skill 存放到 `~/.kimix/skills`，扫描范围同步包含该目录；压缩包解压时校验 `SKILL.md` 并防止路径越界。
  - ContextRing 压缩按钮只受当前会话运行/压缩状态影响，不再被其它会话的 `runningSessionId` 锁住。
  - Turn 结束、错误或中断时会补齐未结束的 compaction end；超过 5 分钟仍未结束的压缩 UI 显示“可能已超时，可重新尝试”。
- v2.5.25：
  - 聊天流中的“上下文压缩中”提示增加 0-3 个点循环动画，并用固定宽度避免文字抖动。
  - ContextRing tooltip 的压缩按钮在压缩期间也显示动态点，明确程序仍在等待压缩完成。
- v2.5.24：
  - 底部状态栏项目名从可点击项目选择按钮改为静态当前项目标识，和 git 分支一致只展示上下文，避免在当前会话中切换项目造成上下文错乱。
- v2.5.23：
  - `kimi:listSlashCommands` 增加 sessionId 校验和 6 秒超时，避免 Kimi SDK metadata warm 卡住时 IPC 永不回包。
  - Kimi session metadata warm 增加 5 秒超时；失败只记录日志，仍返回已有 slashCommands。
  - Composer 获取 slash 命令失败时降级为空列表并 catch promise，不再触发全局 unhandledrejection 错误遮罩；`.bat` 启动链路下 CLI 初始化慢也不会把界面打崩。
- v2.5.22：
  - 技能面板移除“不要发送 `/skill:xxx`”提示，避免误导用户。
  - 输入框支持 `/skill:名称 可选正文` 作为 Kimix 本地指令：先启用对应 Skill、用 `skillsDir` 刷新当前 Kimi 会话，再把可选正文发送给 agent；没有正文时只显示本地启用状态。
- v2.5.21：
  - Composer 思考按钮左侧新增 `ContextRing` 环形进度条，读取当前会话最新 `status_update` 的 `contextSize/contextLimit`，实时显示上下文使用比例。
  - 进度条颜色按阈值变化：`<70%` 蓝色、`70-89%` 黄色、`≥90%` 红色。
  - 鼠标悬停 200ms 后弹出 tooltip，展示"背景信息窗口：XX% 已用（剩余 XX%）\n已用 XXk 标记，共 XXk" + 底部水平进度条。
- v2.5.20：
  - ChangeCard 默认收起，标题行加 ChevronRight/ChevronDown 展开按钮；收起时只显示第一个文件 + "……" 省略行，展开后显示全部文件。
  - ChangeCard 标题行左右 padding 从 18px 调整为 22px/30px，撤销按钮右侧与文件行 Chevron 垂直对齐。
  - ChangeCard 文件行 `+N` 和 `-N` 间距从 `ml-1`(4px) 加大到 10px，`-N` 和 Chevron 间距从 `ml-4`(16px) 加大到 18px。
- v2.5.19：
  - 技能面板"已启用"标签改为绿色背景+深绿文字，`#e8f5e9`/`#2e7d32`；"未启用"保持浅灰背景+浅灰文字 `#f3f1ec`/`#aaa49a`，一目了然。
  - assistant 回复中的 md 文档卡片只显示本轮对话实际修改过的文件（基于 `change_summary`），不再把正文中单纯提及的 md 也列出来。
  - 发送按钮有内容时的蓝色态从 `#9bd8ff` 提高到 `#339af0`，hover `#228be6`，更醒目。
- v2.5.18：
  - assistant 回复顶部顺序调整为“已处理/思考/命令/正文”，避免命令摘要抢在处理状态前面。
  - 图片预览大图支持右键复制到系统剪贴板。
- v2.5.6：
  - 用户消息操作按钮从气泡边缘下移，并加大复制/重新发送之间的间距，降低误点击。
  - 图片消息改为结构化附件显示，用户气泡中直接展示图片缩略图并支持点击预览，不再只把图片写成正文占位。
  - 发送图片时 SDK `TurnBegin` 回显里的 `[图片]` 会和本地乐观消息归一化去重，避免同一条图片消息显示两次。
- v2.5.4：
  - 集中筛查并修复图标+文字按钮拥挤问题：更新页检查按钮、设置检查按钮、底栏项目/套餐用量/导出、队列“引导”、审批卡片、变更卡片、侧栏项目菜单等统一放松按钮尺寸。
  - 新增 `.kimix-icon-text-button` 和 `.kimix-top-menu-trigger`，统一图标文字按钮与顶部菜单文字触发区的最小高度、左右留白、间距和 hover 阴影。
  - 顶部菜单“文件/编辑/查看/窗口/帮助” hover 背景不再贴文字，保留明确热区和轻微阴影。
  - `AGENTS.md` 增补图标+文字按钮与顶部菜单 hover 热区规范。
- v2.5.3：
  - 套餐用量浮层加宽并放松纵向密度：外层 padding、标题区间距、条目间距、进度条高度和说明文字行高同步优化。
  - `AGENTS.md` 增补小浮层/下拉菜单密度规范，避免后续菜单类 UI 再出现内容过度挤压。
- v2.5.2：
  - 底部状态栏移除“本地模式”，改为“套餐用量”按钮；菜单保留 5小时/本周/本月进度结构，并通过 Kimi Code 官方 `https://api.kimi.com/coding/v1/usages` 接口读取真实用量。
  - 底部 git 分支只在当前项目真实可获取分支时显示；非 Git 项目不再 fallback 显示 `main`。
- v2.5.1：
  - 对话内容不在底部时，滚动区右侧显示轻量“到底部”按钮；点击后滚到底部并恢复 agent 流式回复自动跟随，用户手动滚离底部后解除自动跟随。
  - 引导消息插入前会收口上一段未完成 assistant；后续 assistant 流只合并到最近引导之后的消息，避免引导后的回复显示在引导节点上方。
- v2.0.0：即时计时、上下文百分比/详细显示、工具命令聚合、空会话输入自动建会话。
- v2.1.0：
  - 移除 Kimi bridge 45 秒“无正文”中断，不再把慢响应判为错误，继续等待 SDK turn。
  - 输入框支持粘贴图片和拖拽图片，按官方 SDK `ContentPart[]` 传 `{ type: "image_url", image_url: { url: dataUrl } }`。
  - 图片粘贴后在输入框上方显示缩略图，可移除；纯图片也可发送。
  - 工具组聚合 key 改为第一条命令 id，展开后后续新增命令不再导致整组自动收起。
  - `BrowserWindow.icon` 指向项目根 `Kimix.png`，并将 `build/icon.png` 覆盖为同一张图。
  - 顶部菜单和思考模式菜单按权限菜单方法加宽、加高、加内边距。
  - 重写 `AppShell.tsx` 为有效 UTF-8，修复顶部菜单乱码文案。
- v2.2.0：
  - 空会话/无当前会话界面显示中心引导和项目相关建议。
  - 建议项会从当前项目历史会话和本地持久化记录中恢复，点击后可直接创建/复用会话发送。
  - 项目、本地模式、分支、导出从内容顶部移到输入区下方的底部状态栏。
  - 重写 `EmptyState.tsx`、`ContextBar.tsx` 为有效 UTF-8，修复本轮可见乱码。
- v2.2.1：
  - 当前会话存在但只有不可见事件或空 assistant 占位时，也回到空状态建议页，避免启动第一眼主区空白。
- v2.2.2：
  - 历史记录里存在 SDK 原始事件（如 `TurnBegin`）时，不再把这些未知事件当作可见内容，避免空白消息列表挡住空状态。
- v2.2.3：
  - 空状态建议列表从 620px 收窄到 460px，使建议项在标题下方和内容中心区域对齐。
- v2.2.4：
  - 空状态标题下方间距从 `mb-6` 增加到 `mb-9`，避免标题和建议项贴得太近。
- v2.2.5：
  - 标题与建议列表间距改用 inline `style={{ gap: 56 }}` 过正验证，绕开 Tailwind spacing 类不生效的问题。
- v2.2.6：
  - 标题与建议列表间距从 56px 回撤到 28px。
- v2.3.0：
  - 主内容区顶部补充 Codex 风格会话工具栏：左侧会话标题/更多，右侧运行、工作区、终端、面板图标按钮。
- v2.3.1：
  - 去掉系统标题栏中间的会话标题，避免和主内容工具栏重复。
  - 主内容工具栏左右内边距放大，标题从左边缘后移。
  - 工作区按钮点击打开项目根目录，右侧下拉提供资源管理器、VS Code、Trae、Coder 打开选项。
  - 终端按钮会在项目根目录打开终端，侧栏按钮切换侧边栏。
- v2.3.2：
  - 侧栏切换移到窗口左上角按钮。
  - 右上角最右按钮恢复为审查/Diff 面板占位，暂不实现实际动作。
  - 工作区按钮从紧凑小方块改为更宽松的分段胶囊，下拉菜单加宽、加行高、补图标和更接近 Codex 的排序。
- v2.3.3：
  - 主内容顶部工具栏高度从 48px 增加到 56px，左右内边距增加到 30px。
  - 工作区按钮加宽，右侧按钮组间距增加。
  - 工作区下拉菜单从 260px 增加到 288px，行高和左右内边距继续放松。
- v2.3.4：
  - 工作区下拉菜单项改用 inline 左右 padding，左内边距 28px，图标列固定 24px，避免小图标贴左边。
- v2.4.0：
  - 新增 `.kimix-chat-column`，将对话内容列和底部输入区统一为居中最大宽度 882px。
  - `ChatThread`、`AppShell` 共用同一居中列，修复输入框过宽、内容列与输入框不对齐的问题。
- v2.4.1：
  - `StatusCard` 状态信息胶囊过正放大：上下外留白 8px，内部左右 padding 18px，上下 padding 7px，字段间距 14px，字号 13px。
- v2.4.2：
  - `MarkdownRenderer` 不再依赖 ReactMarkdown 的 `inline` 参数，改用 className/换行判断代码块。
  - 表格里的行内 code 恢复为轻量灰底小标签，避免误渲染成带标题的大代码框。
- v2.4.3：
  - 代码块标题栏和正文改用 inline padding，避免内容贴到块边缘。
  - 侧栏项目行、会话行图标列左侧留白加大，避免图标顶住选中背景左边。
- v2.4.4：
  - `Composer` 图片附件缩略图移动到输入内容上方，并放大到 80px。
  - 缩略图支持点击打开居中大图预览，预览层点击背景或关闭按钮退出。
- v2.4.5：
  - 确认官方 SDK `listSessions` 的 `brief` 是 first user message preview，不是智能标题；`parseSessionEvents` 只提供历史事件。
  - 新增 `deriveSessionTitle`，从 assistant 正文提取会话标题；发送时不再用用户第一句话覆盖标题。
- v2.4.6：
  - 修复历史恢复把 SDK 原始事件直接塞给 ChatThread 的问题，新增 `mapHistoryEvents` 转成 Kimix `TimelineEvent`。
  - 侧栏点击旧会话时，如果本地事件为空/不可见，会主动 `loadSession` 并映射历史。
- v2.4.7：
  - 连续 `StatusUpdate` 合并为最新一条，避免连续两行会话消耗提示。
  - `StatusCard` 上下外留白收紧，减少和上下内容之间的空白。
  - 输入框占位文字下挪 3px，底部工具行左侧加号左移 6px。
- v2.4.8：
  - 侧栏会话行移除前置对话图标。
  - 会话列表改用 5px 行间距，避免选中背景上下挤在一起。
  - 会话列表左缩进收回到 20px，行内文字左 padding 调整为 16px。
- v2.4.9：
  - 修复 `ToolCallPart` 被误当作独立工具调用的问题，参数分片会合并回最近的 `ToolCall`。
  - `ToolResult` 按官方 `return_value.display` 读取 diff/todo/brief 显示块。
  - 历史事件兼容 `wire.jsonl` 的 `{ message: { type, payload } }` 包裹结构。
- v2.4.10：
  - 侧栏项目 section 改用 inline flex column + 8px gap，明确拉开项目选中背景和首条会话选中背景。
- v2.4.11：
  - 排队消息 UI 改为 Codex 风格的白色卡片列表，顶部显示排队数量和继续提示。
  - 队列“引导”按钮改为可见文字按钮：运行中移到队首，空闲时立即发送。
  - 修改排队消息时先从队列撤回到输入框，不再保留原队列项。
  - 排队消息支持通过拖拽把手上下排序。
- v2.4.12：
  - 侧栏项目列表外层改用 inline flex column + 18px gap，明确拉开跨项目组的选中背景。
- v2.4.13：
  - `kimiBridge.stopTurn` 不再等待 `turn.interrupt()` resolve，立即标记中断、释放运行锁并发送 interrupted 状态。
  - Kimi 事件循环会忽略已中断 turn 的后续事件/结果，避免中断后又被 completed 覆盖。
  - Composer 停止按钮和 Escape 快捷键优先使用 `runningSessionId`，并先本地退出运行态。
- v2.4.14：
  - Composer 输入框初始高度从单行提升为约两行起步，空状态下不再显得只能输入一行。
  - Composer 外层上下留白略微放松，让输入区域整体高度更接近 Codex 参考图。
- v2.4.15：
  - 主进程向渲染层同步窗口最大化状态，最大化按钮会在最大化/还原之间切换图标。
  - 右上窗口控制按钮整体增加右侧留白，避免关闭按钮贴屏幕边缘像被裁切。
- v2.4.16：
  - 侧栏会话行不恢复前置图标，但运行中/加载中的会话会在右侧时间位置显示旋转加载。
- v2.4.17：
  - `AGENTS.md` 新增 UI 留白防回归规则，明确卡片/队列/列表/菜单等容器不得文字贴边。
  - Kimi bridge 新增 `steerPrompt`，队列“引导”在当前 turn 运行中通过 SDK `Turn.steer()` 直接发送补充输入。
  - 队列内部拖拽不再触发附件拖入蓝色高亮。
  - 附件拖入高亮移动到输入框本体内部，尺寸与输入框一致。
  - 队列头部和列表行左右 padding 放大，缓解文字和右侧提示贴边。
- v2.4.18：
  - Kimi bridge 启动 session 后预热 Wire initialize，读取官方返回的 `slash_commands`。
  - 新增 `kimi:listSlashCommands` IPC，输入 `/` 时展示官方 slash 命令候选。
  - 新增项目文件搜索 IPC，输入 `@` 时展示智能体、插件和项目文件候选。
  - Composer 支持方向键选择候选，Enter/Tab 插入候选文本，Escape 关闭当前触发词。
- v2.4.19：
  - 思考内容展开框和工具详情展开框改用更明显的 inline 左右 padding，并加断行约束，避免文字贴住圆角边框。
  - `ToolResult.display.todo` 会落入 `todo` 时间线事件，输入框上方新增可折叠 TodoList 面板。
  - TodoList 面板显示在消息队列上方；两者同时存在时 TodoList 在上、消息队列在下。
  - 右上项目打开按钮整体收窄，下拉触发按钮减少右侧外边距，下拉菜单向左偏移，避免选中态看起来出界。
- v2.4.20：
  - 放宽 `index.html` 静态 CSP，允许 Vite dev 注入 React Refresh/HMR 脚本和 localhost/ws 连接，避免开发启动白屏。
  - 主进程保留 `did-fail-load` 日志，便于后续定位页面加载失败。
- v2.4.21：
  - 思考状态行、收起/展开思考按钮、工具/命令折叠行统一放大到接近正文的 15px 次要灰色，并增加上下 padding 和图标尺寸。
  - 思考内容框和工具详情框继续放大左右/上下 padding，降低贴边和拥挤感。
  - TodoList 面板头部、行项目、图标和间距整体放松，和输入框之间增加 12px 间距。
- v2.4.22：
  - `AGENTS.md` 删除“矫枉必须过正”，新增对话流圆角框、焦点态和统一按钮尺寸规范。
  - 对话流折叠按钮/工具按钮收回到克制尺寸：约 32px 高、14.5px 字号、15px 图标，默认透明，hover 才浅灰底。
  - 隐藏对话流里的重复 `todo` 事件卡片，只保留输入框上方 TodoList 面板，避免两份列表互相遮挡。
  - TodoList 面板回缩到中等密度：头部 12px 上下 padding，列表 max-height 44，行内 9px 上下 padding。
  - 全局 focus-visible 从蓝色改为浅灰细描边，TodoList 头部禁用默认蓝/黑焦点框。
- v2.4.23：
  - 主进程在 `did-finish-load` 后检查 `#root` 内容长度和子节点数，若检测到空 root，会自动忽略缓存 reload 一次并输出日志。
- v2.4.24：
  - 引导消息新增独立 `steer_message` 时间线事件，显示“正在引导对话 / 已引导对话 / 引导失败”。
  - `eventMapper` 支持官方 Kimi SDK `SteerInput` 事件，继续使用 `Turn.steer()` 官方接口，不自造替代协议。
  - 队列自动续发时先插入用户消息，再插入 assistant 占位，避免排队消息显示在回复下方。
  - 主进程 dev 启动兼容 electron-vite 的 `ELECTRON_RENDERER_URL`，避免清缓存后误加载不存在的 `out/renderer/index.html` 导致白屏。
- v2.5.0：
  - 顶部“文件/编辑/查看/窗口/帮助”菜单按参考图补齐中文条目，已接入新对话、打开项目、设置、窗口、剪贴板、缩放、全屏、重载等可实现功能。
  - 帮助菜单新增“关于 Kimix”“更新记录”“键盘快捷键”和说明弹窗；关于页包含项目介绍、版本、开发者 `@linjianglu` 和仓库入口。
  - 更新页维护本地更新记录时间表，并通过 GitHub Releases API 检查 `LiKPO4/kimix` 最新版本。
  - 菜单浮层和设置按钮 hover 阴影加大，设置入口左侧留白增加，避免图标贴边。
  - 运行时错误从左上角红块改为居中的错误面板，并对新增 preload API 做热更新兼容保护。

## 未完成
- 等待 v2.5.0 启动和 release 安装包验收：菜单中文功能、关于/更新页、GitHub 检查更新、安装包下载运行。
- v2.4.24 运行中点击队列“引导”是否被 agent 看到，是否显示引导中/成功提示；队列自动续发消息是否在 agent 回复上方仍需实测。
- v2.4.23 启动不空屏、对话流按钮克制、圆角框/焦点态灰色化、TodoList 回缩效果仍需截图验收。
- v2.4.18 输入框 @ 和 / 候选弹窗仍需截图/操作验收。
- v2.4.17 队列引导、拖拽和留白仍需用户操作确认。
- v2.4.16 侧栏运行中加载态仍需用户截图确认。
- v2.4.15 窗口控制按钮仍需用户截图确认。
- v2.4.14 输入区域高度仍需用户截图确认。
- v2.4.13 停止功能仍需用户实测确认。
- 后续继续做 ChatThread + MessageBubble Codex 风格细化、应用图标打包 ico 完善、端到端 Kimi 会话联调、Diff 详情、会话历史、设置持久化完善。

## 阻塞/注意
- 构建前 PATH 必须包含：`C:\Program Files\nodejs;C:\Users\lijialin08\AppData\Roaming\npm`。
- 截图版本号不对时必须让用户重发，不基于错图推理。
- UI 数值改动若反馈无效，优先排查旧进程、缓存、版本号和 Tailwind JIT，不再执行“矫枉必须过正”规则。

## 关键文件
- `electron/kimiBridge.ts`：不再有 45 秒无正文超时；`sendPrompt` 支持 string / SDK `ContentPart[]`。
- `electron/main.ts`：图片 data URL 转官方 SDK `ContentPart[]`；窗口图标指向 `Kimix.png`；dev 模式兼容 `ELECTRON_RENDERER_URL`。
- `src/components/chat/Composer.tsx`：图片粘贴/拖拽、缩略图、发送图片。
- `src/components/chat/ChatThread.tsx`：工具组稳定 key，避免展开状态被新增命令重置。
- `src/components/chat/EmptyState.tsx`：项目相关空状态建议、建议本地持久化、点击建议直接发送。
- `src/components/chat/ContextBar.tsx`：底部状态栏，包含项目、本地模式、分支、导出。
- `src/components/chat/StatusCard.tsx`：消息/Tokens/Context 状态胶囊宽松度。
- `src/components/chat/MarkdownRenderer.tsx`：Markdown 行内代码/代码块渲染。
- `src/components/chat/Composer.tsx`：输入框图片附件缩略图、预览层、排队消息 UI 和交互。
- `src/stores/sessionStore.ts`：会话与排队消息状态，支持队列拖拽重排。
- `src/utils/sessionTitle.ts`：从对话内容派生会话标题。
- `src/App.tsx`：会话标题更新策略和历史会话标题恢复。
- `src/utils/eventMapper.ts`：历史 SDK 事件映射、工具调用分片合并。
- `index.html`：dev/production 共用 CSP，需允许 localhost 与 ws，避免 Vite dev 白屏。
- `src/components/layout/Sidebar.tsx`：侧栏项目/会话行留白、运行态加载、归档会话和版本号 v2.7.29。
- `src/components/chat/TodoPanel.tsx`：输入框上方 TodoList 可折叠面板，从最新 todo 事件或 SetTodoList 工具参数派生。
- `AGENTS.md`：UI 留白防回归规则。
- `src/components/layout/AppShell.tsx`：顶部菜单文案、主内容会话工具栏、项目/终端/侧栏按钮；底部输入区套用 `.kimix-chat-column`。
- `src/components/layout/AppShell.tsx`：顶部中文菜单、帮助弹窗、更新记录和 GitHub 检查更新入口。
- `src/index.css`：`.kimix-chat-column` 控制对话列和输入框统一居中宽度。
- `src/components/chat/ComposerInput.tsx`：输入框占位文字垂直位置和初始高度。
- `src/components/settings/SettingsPanel.tsx`：归档对话、卡死诊断入口和版本号 v2.7.29。

## 下一步最小行动
docx 待办已清空；进入下一阶段前先等你按 v2.7.29 截图验收。
# Kimix 主线待办（Kimi CLI 能力补全）

## 当前目标
长程任务开发告一段落，回到主线：按官方 Kimi CLI 能力补齐 Kimix 未产品化的功能。

## 待办顺序
- [x] CLI 更新检测与一键更新：启动时同时检查 Kimix 本体和 Kimi CLI，更新弹窗中分别展示状态。
- [ ] Plan 模式：接入 `--plan` / plan mode 状态与切换，形成“先规划再执行”的主线交互。
- [ ] MCP 管理：接入 `kimi mcp add/list/remove/auth/reset-auth/test`，替换当前 MCP 占位页。
- [ ] 登录与模型配置：接入 `kimi login --json` / `logout --json`，读取并管理默认模型、thinking、yolo、plan 配置。
- [ ] 额外工作目录：接入 `--add-dir` / `/add-dir`，支持一个会话访问多个目录。
- [ ] 插件系统：接入 `kimi plugin install/list/remove/info`，与现有 Skills 面板区分。
- [ ] 自定义 Agent：接入 `--agent default|okabe` 与 `--agent-file`。
- [ ] 会话导出：接入 `kimi export [session_id] -o xxx.zip`，用于诊断包/交接包。
- [ ] 低优先级入口：`kimi web`、`kimi vis`、`kimi acp`、`kimi term` 作为辅助打开入口评估。

## 本轮进展
- 已将本机 Kimi CLI 从 1.41.0 更新到 1.44.0。
- 已补 Kimix 启动时的本体 + CLI 更新检测与 CLI 一键更新入口。

# Kimix 主线待办顺序（Kimi CLI 能力补全，2026-05-15）
## 当前目标
按用户指定顺序依次产品化 Kimi CLI 尚未充分利用的能力；每轮只做一个可验证最小增量。

## 待办顺序
- [x] CLI 更新检测与一键更新：启动时同时检查 Kimix 本体和 Kimi CLI，更新弹窗中分别展示状态。
- [x] Plan 模式：接入 SDK `setPlanMode` / `planMode`，输入区提供 Plan 开关，新会话与发送前同步状态。
- [ ] AFK 模式。
- [ ] 额外工作目录。
- [ ] 插件系统：内置几个插件网站链接，并支持一键导入。
- [ ] 完整 MCP 管理。
- [ ] 配置文件能力。
- [ ] 会话导出：现有导出入口点击后，让用户选择官方导出或 Kimix 导出。

## 下一步最小行动
制作第 2 项 AFK 模式。

# 2026-05-18 Plan 侧栏补充
## 当前目标
普通会话右侧侧栏展示会话相关卡片，并把 Kimi 官方 Plan markdown 展示出来。
## 已完成
- 右侧面板在非长程任务会话中显示会话侧栏，包含 Plan、会话信息、最近变更。
- 新增安全文本读取 IPC，仅允许项目内文本文件与 `~/.kimi/plans/*.md`。
- 判断 Plan 审批英文文案来自 Kimi 官方 `QuestionRequest` payload，Kimix 当前按原值展示与回传。
## 下一步
等待 v2.7.75 实例验收；随后进入 AFK 模式。

# 2026-05-18 Plan 与文件变更卡片调整
## 已完成
- Plan 文件预览从处理折叠区外置到确认卡前，避免用户不知道 approve 的具体内容。
- 文件变更卡片合并多文件展示，默认显示前三个，剩余文件点击展开。
- 保留单文件撤销，并新增全部撤销；文件行可点击展开查看结构化 diff。
## 下一步
等待 v2.7.76 实例验收；随后进入 AFK 模式。

# 2026-05-18 细节回归修复
## 已完成
- Diff 展开改为行级红绿对比，减少整块文本难以识别的问题。
- 文件修改整合兼容 `diff` 事件，旧对话里单文件 diff 也会尽量合并成组。
- 滚动条加宽，并给窗口右侧留出 8px，避免拖滚动条时命中窗口缩放热区。
- 未完成 assistant 不再显示“执行中 0s”，非运行状态显示为“已暂停”。
- 侧栏打开项目按钮改为加号。
- 普通会话右侧栏增加长程任务卡片，Plan 刷新增加最近官方 Plan 兜底。
## 下一步
等待 v2.7.77 实例验收；随后进入 AFK 模式。

# 2026-05-18 会话侧栏排序与 Plan 渲染
## 已完成
- 普通会话侧栏排序调整为 Plan、会话信息、最近变更、长程任务。
- 长程任务卡过滤仅关联已归档对话的任务。
- Plan 内容从纯文本 `<pre>` 改为 MarkdownRenderer 渲染。
## 下一步
等待 v2.7.78 实例验收；随后进入 AFK 模式。
# 2026-05-18 布局拖拽与 Plan 横向滚动
## 已完成
- 左侧栏展开态支持拖动分隔条调整宽度，收起态保留固定窄栏与主内容间隔。
- 右侧会话侧栏 / diff 面板支持拖动分隔条调整宽度。
- Plan 侧栏 markdown 启用长行换行渲染，去除底部横向滚动条。
- 版本号三处同步到 v2.7.79。
## 下一步
等待 v2.7.79 实例验收；随后进入 AFK 模式。

# 2026-05-18 顶部播放按钮启动文件
## 已完成
- 普通会话顶部播放按钮改为“启动文件”，点击后选择并启动 exe / bat / cmd / ps1 / com / msi / lnk 等 Windows 可执行文件。
- 顶部工具栏右侧按钮组右内边距收紧到 12px，使最右按钮右侧间距更接近上方间距。
- 版本号三处同步到 v2.7.80。
## 下一步
等待 v2.7.80 实例验收；随后继续 AFK 模式。

# 2026-05-18 启动文件右键重选
## 已完成
- 顶部播放按钮左键启动已保存的启动文件；未选择或文件丢失时自动弹出选择器。
- 顶部播放按钮右键只打开文件选择器并保存选择，方便后续修改目标文件。
- 选择的启动文件写入本地设置，随应用重启保留。
- 版本号三处同步到 v2.7.81。
## 下一步
等待 v2.7.81 实例验收；随后继续 AFK 模式。

# 2026-05-18 Plan 闪烁与空正文提示
## 已完成
- 收窄右侧 Plan 自动刷新依赖，避免 agent 流式事件更新时反复读取 Plan 文件并闪烁。
- 确认 Kimi SDK 的 `RunResult` 不包含最终正文；正文只能来自 `ContentPart(type=text)`，因此只有思考/命令而没有正文时属于官方未发正文而非 Kimix 丢失。
- 当 assistant 长时间没有正文或本轮完成后仍无正文时，消息流显示明确提示，避免用户误以为界面卡住。
- 版本号三处同步到 v2.7.83。
## 下一步
等待 v2.7.83 实例验收；随后继续 AFK 模式。

# 2026-05-18 AFK / 自动模式
## 已完成
- 确认 Kimi CLI 的 `--afk` 会自动跳过用户提问并自动批准工具调用，和现有三种权限模式不完全等价，因此作为独立开关加入。
- 新增全局“自动模式”设置，普通会话、长程任务、会话恢复、交接会话等启动和发送链路会带上该状态。
- 在 Kimix 桥接层为官方 SDK 未暴露的 `--afk` 参数补了窄范围启动参数桥接。
- 输入区与设置面板均使用中文“自动模式”，并给权限模式、Plan、思考、自动模式补充 hover 提示。
- 版本号三处同步到 v2.7.84。
## 下一步
等待 v2.7.84 实例验收；随后继续主线第 3 项“额外工作目录”。

# 2026-05-18 AFK 文案调整
## 已完成
- 将用户可见的“离开模式 / 离开开 / 离开关”改为“自动模式 / 自动开 / 自动关”。
- hover 提示同步使用“自动模式”，底层仍沿用 Kimi CLI 的 AFK 行为。
- 版本号三处同步到 v2.7.85。
## 下一步
等待 v2.7.85 实例验收；随后继续主线第 3 项“额外工作目录”。

# 2026-05-18 额外工作目录审查与收口
## 已完成
- 额外工作目录已在设置页提供列表编辑入口，状态写入 `additionalWorkDirs`。
- Kimi 会话启动时读取全局额外工作目录，并通过 Kimix 桥接层注入 Kimi CLI `--add-dir` 参数。
- 审查发现 `app:saveSettings` 的 Zod schema 未放行 `defaultPlanMode` 与 `additionalWorkDirs`，会导致设置重启后丢失；已修复。
- 审查发现 `--add-dir` 桥接缺少 patch 标记类型，并且目录列表未去空、trim、去重；已修复。
- 版本号三处同步到 v2.7.88。
## 风险
- 目前额外工作目录入口是手动输入路径，尚未提供目录选择器。
- 目前只在传给 CLI 前做去空、trim、去重，暂未在 UI 层阻止不存在的路径。
## 下一步
等待 v2.7.88 实例验收；通过后继续主线第 4 项“插件系统”。

# 2026-05-18 输入区工具菜单与套餐用量
## 已完成
- 将“需求澄清”改为输入框 `+` 菜单内的一行三态切换：开启、关闭、自动。
- 将“自动模式”和“额外工作目录”从设置面板移到输入框 `+` 菜单；自动模式使用圆圈勾选开关，额外工作目录继续写入 `additionalWorkDirs` 并由 CLI `--add-dir` 使用。
- 将上下文按钮移动到语音输入按钮左侧。
- 修复设置页圆圈勾选的选中态填充样式。
- 套餐用量移除“本月”，仅保留 5小时和本周，并为每段显示刷新时间。
- 版本号三处同步到 v2.7.89。
## 风险
- Kimi 官方用量接口若未提供重置/刷新时间字段，Kimix 会退回显示本次读取时间。
- 额外工作目录仍是手动输入路径，暂未接入目录选择器。
## 下一步
等待 v2.7.89 实例验收；通过后继续主线第 4 项“插件系统”。

# 2026-05-18 自动模式分段开关
## 已完成
- 将输入框 `+` 菜单里的自动模式从圆圈勾选开关改为和需求澄清一致风格的“关闭 / 开启”双态分段开关。
- 保留自动模式说明文案，并让选中态使用白底蓝字和轻阴影，视觉上对齐上方三态切换。
- 版本号三处同步到 v2.7.90。
## 下一步
等待 v2.7.90 实例验收；通过后继续主线第 4 项“插件系统”。

# 2026-05-18 工具菜单分段控件对齐
## 已完成
- 将输入框 `+` 菜单里的“需求澄清”和“自动模式”分段控件统一为 158px 宽度。
- 两个分段控件内部按钮改为均分宽度，保证右侧控制区视觉对齐。
- 版本号三处同步到 v2.7.91。
## 下一步
等待 v2.7.91 实例验收；通过后继续主线第 4 项“插件系统”。

# 2026-05-18 工具菜单行高留白修正
## 已完成
- 去掉“需求澄清”行底部额外 `marginBottom`，让它到下方分隔线的高度与“自动模式”一致。
- 版本号三处同步到 v2.7.92。
## 下一步
等待 v2.7.92 实例验收；通过后继续主线第 4 项“插件系统”。

# 2026-05-18 套餐用量刷新倒计时修正
## 已完成
- 将套餐用量刷新文案从“刷新于 HH:mm”改为“将于 X 后刷新”。
- 后端不再把本次读取时间当作额度刷新时间；5 小时窗口兜底按 5 小时后，本周额度兜底按下周一 00:00。
- 若官方用量接口返回 `resetAt` / `nextResetAt` / `nextRefreshAt` 等字段，优先使用官方返回的刷新时间。
- 版本号三处同步到 v2.7.93。
## 风险
- 官方接口若没有返回精确重置字段，5 小时窗口只能按完整窗口周期估算，无法知道当前用量中最早一笔请求的真实过期时间。
## 下一步
等待 v2.7.93 实例验收；通过后继续主线第 4 项“插件系统”。

# 2026-05-18 套餐用量官方 resetTime 对齐
## 已完成
- 对照 Kimi 官方用量接口原始返回，确认本周和频限明细的额度恢复字段为 `resetTime`。
- 修复用量解析器漏读 `resetTime` 的问题，避免退回估算刷新时间导致与官网不一致。
- 继续保留 `resetAt` / `nextResetAt` / `nextRefreshAt` 等兼容字段。
- 版本号三处同步到 v2.7.94。
## 下一步
等待 v2.7.94 实例验收；套餐用量应与官网的“几小时后重置”对齐。

# 2026-05-18 旧会话思考片段渲染修复
## 已完成
- 修复旧会话历史里已完成、无正文、只有思考内容的 assistant 片段被逐段渲染成独立卡片的问题。
- 渲染列表现在只把有正文或仍在运行的 assistant 作为独立消息；历史中的纯思考完成片段不再撑出重复占位块。
- 版本号三处同步到 v2.7.95。
## 下一步
等待 v2.7.95 实例验收；旧会话应不再被大量“已处理 / 本轮没有生成正文内容”切碎。

# 2026-05-18 旧会话思考合并修正
## 已完成
- 修复 v2.7.95 过滤过粗导致旧会话思考内容消失的问题。
- 同一轮无正文时，将多个 assistant 思考片段合并成一个过程摘要，并挂载同轮工具、子代理、文件变更和状态信息。
- 有工具/思考/文件变更的无正文轮次不再显示“本轮没有生成正文内容”占位提示。
- 版本号三处同步到 v2.7.96。
## 下一步
等待 v2.7.96 实例验收；旧会话应保留思考摘要，同时不再被切碎。

# 2026-05-18 输入区卡片收起与恢复
## 已完成
- TodoList 右侧新增小 X，可收起到右侧会话侧栏，并提示用户可在侧栏恢复。
- 排队消息面板同样支持收起到侧栏。
- 普通会话侧栏新增“已收起卡片”区域，可将 TodoList / 排队消息恢复到输入框上方。
- 版本号三处同步到 v2.7.97。
## 下一步
等待 v2.7.97 实例验收；确认 TodoList 和排队消息的收起/恢复链路。

# 2026-05-18 自动模式说明改为 hover
## 已完成
- 去掉输入框 `+` 菜单里“自动模式”标题下方的说明文字。
- 将自动模式说明移动到标题区域 hover 提示，视觉上与需求澄清/权限类控件保持一致。
- 版本号三处同步到 v2.7.98。
## 下一步
等待 v2.7.98 实例验收；确认自动模式行高和 hover 提示。

# 2026-05-18 旧会话运行上下文与过程卡对齐
## 已完成
- 移除 Composer 中因会话推荐卡自动新建 runtime session 的逻辑，避免用户继续旧会话时像新对话一样丢失上下文。
- 如果发送时 Electron 后端 active session 丢失，会用当前会话 ID 重新挂回同一个 Kimi session 后再发送。
- 展开过程里的思考/工具/子代理小卡改为固定列布局，修复图标垂直对齐不一致。
- 版本号三处同步到 v2.7.99。
## 下一步
等待 v2.7.99 实例验收；确认旧会话继续提问能记住上下文，展开卡图标对齐。

# 2026-05-18 思考小卡内层对齐
## 已完成
- 修复展开过程里思考小卡因内部 button 额外 padding 导致图标/正文起点与工具小卡不齐的问题。
- 思考、工具、子代理小卡统一首列 18px、gap 9px、左右 padding 14px。
- 版本号三处同步到 v2.7.100。
## 下一步
等待 v2.7.100 实例验收；确认展开内容小卡左侧图标和文字起点对齐。

# 2026-05-20 轮次完成提醒与变更卡收起入口
## 已完成
- Kimi 轮次完成后由 renderer 触发 Electron 桌面通知，并给任务栏图标加红点；用户点击通知或窗口重新聚焦后清除红点。
- 文件更改卡片在展开全部文件后，底部新增“收起 xx 个文件”按钮，方便长列表回到汇总态。
- 版本号三处同步到 v2.7.101。
## 下一步
等待 v2.7.101 实例验收；确认完成通知、任务栏红点和文件更改卡片底部收起入口表现符合预期。

# 2026-05-20 代码块复制与引导状态时序
## 已完成
- Markdown 代码块头部新增复制按钮，复制后短暂显示“已复制”。
- 引导消息气泡先显示用户引导内容，再在下方显示“正在引导对话 / 已引导对话 / 引导失败”。
- steer 请求成功后不再立刻标记“已引导对话”；当前运行轮 completed 后才把待定引导标记为已引导，error/interrupted 时标记失败。
- 版本号三处同步到 v2.7.102。
## 下一步
等待 v2.7.102 实例验收；确认代码块复制按钮、引导消息位置和引导完成时机。

# 2026-05-20 pnpm hoist 依赖错配修复
## 已完成
- `.npmrc` 增加 `hoist=false`，避免 `lru-cache@5.1.1` 在公共提升目录里误加载 `yallist@5.0.0`，修复 Vite/Babel 的 `Yallist is not a constructor`。
- 使用 `pnpm install --ignore-scripts --no-hoist --frozen-lockfile` 重建依赖链接，并单独执行 Electron install，避免坏掉的全量 postinstall 链路。
- 重新验证 `pnpm run postinstall`、`pnpm build`、`pnpm dev`，均已越过原报错；`pnpm dev` 可进入 Electron 常驻运行。
- 版本号三处同步到 v2.7.103。
## 下一步
等待 v2.7.103 实例验收；确认本机直接执行 `pnpm dev` 能正常打开应用且不再出现全屏 Vite 报错。

# 2026-05-20 代码块复制按钮与变更卡收起文案
## 已完成
- 代码块复制按钮和复制后文本改为与左侧语言标签一致的次要灰色，hover 只使用浅灰底。
- 文件更改卡片展开后底部按钮改为按隐藏数量显示，例如“再显示 2 个文件”展开后对应“收起 2 个文件”。
- 文件更改卡片底部收起按钮图标改为向上箭头。
- 版本号三处同步到 v2.7.104。
## 下一步
等待 v2.7.104 实例验收；确认代码块头部颜色和变更卡底部收起文案/图标符合截图预期。

# 2026-05-20 文件更改卡同路径合并
## 已完成
- 文件更改卡片展示层按规范化路径合并同一文件，避免同一文件显示多行。
- 同轮多个 change_summary 事件合并时同样按规范化路径归并，减少重复文件行进入卡片。
- 撤销后移除文件行也按规范化路径匹配，避免同一路径不同写法的重复项残留。
- 版本号三处同步到 v2.7.105。
## 下一步
等待 v2.7.105 实例验收；确认同一文件只显示一行，展开/收起不再联动多个重复行。

# 2026-05-20 顶部启动菜单与文件菜单收窄
## 已完成
- 顶部启动按钮改为和文件按钮一致的分段下拉样式，主按钮启动当前启动文件，下拉支持启动文件、选择启动文件、启动命令、设置启动命令。
- Electron 侧新增保存和运行启动命令的 IPC，启动命令默认在当前项目目录中打开终端执行。
- 文件下拉菜单从 288px 收窄到 236px，行高、图标和左右留白同步收敛为更轻的密度。
- 版本号三处同步到 v2.7.106。
## 下一步
等待 v2.7.106 实例验收；确认启动下拉菜单可用，文件菜单宽度和留白符合图 2 的紧凑观感。

# 2026-05-20 启动命令弹窗与更新箭头
## 已完成
- 设置启动命令从浏览器原生 prompt 改为 Kimix 应用内弹窗，避免 Electron 渲染环境报 `prompt() is not supported`。
- 顶部启动按钮和文件按钮宽度收敛到 56px，高度收敛到 32px，图标和下拉箭头留白更接近参考图。
- 检测到 Kimix 本体有更新时，顶部工具区显示蓝色向上箭头；点击会打开“更新记录”窗口。
- 版本号三处同步到 v2.7.107。
## 下一步
等待 v2.7.107 实例验收；确认设置启动命令不再崩溃、两个按钮更轻，以及有更新时蓝色箭头可进入更新窗口。

# 2026-05-20 release 自动发布与旧版更新兜底
## 已完成
- release workflow 增加收尾 publish job，等待三平台构建完成后自动执行 `gh release edit "$GITHUB_REF_NAME" --draft=false --latest`。
- 更新下载从单纯 `fetch` 改为 `fetch -> net.fetch` 双层兜底；如果仍失败，会自动打开发布页并提示手动下载。
- 下载失败打开发布页的兜底逻辑只保留在 `app:downloadUpdate`，避免误伤“启动命令”。
- 版本号三处同步到 v2.7.112。
## 下一步
等待 v2.7.112 实例验收；确认旧版本更新时不再只报 `fetch failed`，以及每次标签发布会自动变成正式 release。
# 2026-05-21 消息信息显示排查
## 已完成
- 查明消息信息事件仍由 `StatusUpdate` 映射和入库，缺失重点来自前端过滤：会话运行中把全部 `status_update` 隐藏。
- 调整为运行中也按设置保留消息信息；默认模式保留当前轮最后一条，实时模式显示每条。
## 下一步
构建验证后让用户确认运行中和轮末都能看到“消息 / Tokens / Context”胶囊。

# 2026-05-21 顶部窗口控制按钮间距
## 已完成
- 右上角最小化、最大化、关闭按钮调整为统一 32px 点击区、8px 间距。
- 标题栏右侧取消额外内边距，配合外层 shell 8px 右边距，使关闭按钮右侧与上侧距离一致。
- 版本号三处同步到 v2.8.11，方便截图确认实例已更新。
## 下一步
等待 v2.8.11 截图验收，确认关闭按钮右侧/上侧距离一致，三个按钮间距一致。

# 2026-05-21 升级下载百分比
## 已完成
- Kimix 本体升级下载从一次性 arrayBuffer 改为流式读取，并通过 IPC 向前端推送下载进度。
- 更新记录弹窗里的“升级/下载中”按钮在下载时显示百分比，如“下载中 37%”。
- 响应头没有 content-length 时，使用 GitHub release asset size 兜底计算百分比。
- 版本号三处同步到 v2.8.12，方便截图确认实例已更新。
## 下一步
构建验证后等待 v2.8.12 实例验收，确认下载按钮能实时显示百分比。

# 2026-05-21 重启后背景信息 0 值
## 已完成
- 排查到重启/更新后可能先读到一条 token/context 全为 0 的空壳 `status_update`，导致消息信息和背景信息窗口显示 0。
- 背景信息窗口改为只读取最近一条有实际 token/context 数据的状态；没有有效状态时不显示背景信息入口，避免误导。
- `StatusCard` 遇到纯 0 状态时不渲染，避免重开后显示 `Tokens: 0 / Context: 0.00%`。
## 下一步
等待用户用重开软件场景验收：旧会话不应再出现纯 0 的消息信息和背景信息窗口。

# 2026-05-22 Superpowers 原版兼容第一阶段
## 已完成
- 技能面板新增 Superpowers 安装入口：从官方 `obra/superpowers` 下载 `skills/`，写入 `~/.kimix/skills/superpowers`。
- 安装后自动启用 Superpowers 核心 skills，并同步到 `~/.kimix/enabled-skills`，继续通过 Kimi CLI 官方 `--skills-dir` 接入。
- 新会话首次发送消息时，如果启用了 `using-superpowers`，会隐藏前置注入该 `SKILL.md` 作为 bootstrap；对话界面仍只显示用户原文。
- 版本号三处同步到 v2.7.106。
## 下一步
等待 v2.8.13 实例验收；确认技能面板可安装 Superpowers，新会话首轮能按 Superpowers 工作流先检查/使用技能。

# 2026-05-22 Superpowers 安装失败修复
## 已完成
- Superpowers 安装不再只依赖 Electron `fetch` 下载 GitHub zip；先尝试本机缓存副本，再尝试 `git clone`，最后才走 zip 下载。
- 安装失败时聚合输出各 fallback 的具体错误，避免只显示 `fetch failed`。
- 版本号三处同步到 v2.8.13。
## 下一步
等待 v2.8.13 实例验收；确认点击技能面板 Superpowers 后能完成安装并显示已启用。

# 2026-05-22 Superpowers bootstrap 展示修正
## 已完成
- `getSuperpowersBootstrap` 不再返回整篇 `using-superpowers/SKILL.md`，改为 Kimix-Kimi 专用的简短隐藏适配指令。
- 适配指令明确 Kimi 不要复述 bootstrap，也不要声称调用不存在的 Skill tool；需要时按已启用 skills 目录读取对应 `SKILL.md`。
- 历史事件映射会剥离隐藏 Superpowers bootstrap，只保留用户真实消息，避免新窗口显示两条用户消息或长段英文。
- 版本号三处同步到 v2.8.14。
## 下一步
等待 v2.8.14 实例验收；确认新对话只显示用户原文，且 Kimi 会以简短中文说明进入相关 Superpowers 流程。

# 2026-05-22 Superpowers agent-file 修正
## 已完成
- Composer 不再把 Superpowers bootstrap 拼进首轮用户消息，避免 UI 出现真实消息 + 长提示两条用户气泡。
- 主进程在 Superpowers 启用时生成 `~/.kimix/superpowers-agent.md`，启动 Kimi 会话时与 `--skills-dir` 一起通过官方 `--agent-file` 传入。
- 历史事件映射补充兼容旧版隐藏 header，并递归剥离外层 Superpowers 和内层需求澄清提示。
- 版本号三处同步到 v2.8.15。
## 下一步
等待 v2.8.15 实例验收；确认新窗口只显示用户原文，Kimi 不再复述 bootstrap，并按启用的 Superpowers skills 流程响应。

# 2026-05-22 Superpowers agent-file 崩溃修复
## 已完成
- 排查 `C:\Users\Administrator\.kimi\logs\kimi.log`，确认报错来自 Kimi CLI 按 agent spec 解析纯 Markdown `superpowers-agent.md`，导致字符串调用 `.get()` 崩溃。
- `superpowers-agent` 改为合法 YAML：`version: 1`、`agent.extend: default`，并通过默认 agent 的 `ROLE_ADDITIONAL` 注入 Superpowers 适配说明。
- 已删除本机残留的错误 `C:\Users\Administrator\.kimix\superpowers-agent.md`。
- 版本号三处同步到 v2.8.16。
## 下一步
等待 v2.8.16 实例验收；确认新窗口不再出现 CLI exited 错误，且用户消息不显示隐藏 bootstrap。

# 2026-05-22 需求澄清后计时冻结修复
## 已完成
- 排查到 `QuestionRequest` 后续文本到来时，事件合并会把澄清前 assistant 提前标记 complete 并写死 `durationMs`，导致 UI 显示“已处理 xx”后不再跳秒。
- 修复事件合并逻辑：澄清边界后新的 assistant 内容直接追加为新事件，不再提前冻结上一段计时。
- 修复对话渲染主消息选择：同一轮内优先展示最后一条未完成 assistant，否则才回退到第一条有正文 assistant。
- 版本号三处同步到 v2.8.17。
## 下一步
等待 v2.8.17 实例验收；确认需求澄清卡出现后，如果 Kimi 仍在输出，上方计时继续增长，不再卡在旧的“已处理”时间。

# 2026-05-22 需求澄清后重复计时修复
## 已完成
- 排查到同一轮被拆成多段 assistant 后，渲染层会给每段都显示 `AssistantProcessSummary`，导致上下两个“正在思考 xx”同步跳秒。
- `ChatThread` 保持 assistant 片段原有顺序，但只给同一轮第一段 assistant 附加工具/状态/进度摘要；后续 assistant 片段只展示正文。
- `MessageBubble` 新增 `hideProcessSummary` 展示开关，避免后续片段重复显示进度条。
- 版本号三处同步到 v2.8.18。
## 下一步
等待 v2.8.18 实例验收；确认需求澄清后只保留一个正在思考/已处理计时，且时间不重置。

# 2026-05-22 需求澄清后消息信息条位置修复
## 已完成
- 排查到 `status_update` 被作为 `trailingStatuses` 挂在同一轮第一段 assistant 下面，因此遇到需求澄清卡时会显示在卡片上方。
- `ChatThread` 改为把状态条按整轮末尾独立渲染，不再附着到第一段 assistant bubble。
- 保持后续 assistant 片段不重复显示进度摘要，避免回归双计时问题。
- 版本号三处同步到 v2.8.19。
## 下一步
等待 v2.8.19 实例验收；确认需求澄清卡和后续正文之后，消息信息条出现在本轮末尾。

# 2026-05-22 正在思考时消息信息提前显示修复
## 已完成
- 排查到状态条虽已移动到整轮末尾，但仍无条件渲染；SDK 先吐出 token/context 时，assistant 还在运行也会提前显示消息信息。
- `ChatThread` 新增本轮 settled 判断：没有未完成 assistant、没有 running tool、没有 running subagent 时，才渲染 `status_update`。
- 兜底路径也不再把 `status_update` 作为 assistant 的 trailing status 传入，避免状态条提前挂到气泡内。
- 版本号三处同步到 v2.8.20。
## 下一步
等待 v2.8.20 实例验收；确认正在思考/执行时不显示消息信息，整轮完成后再显示在轮末尾。

# 2026-05-23 Plan 空状态与 Superpowers 诊断
## 已完成
- 右侧会话侧栏读取最新官方 Plan 时，如果 `~/.kimi/plans` 不存在或还没有 markdown 文件，不再显示红色读取失败，改为普通空状态提示。
- `getSuperpowersBootstrap` 返回 agent-file、skills-dir、启用 skill 数、旧 agent 残留等诊断字段，技能面板可直接查看 Superpowers 是否接入。
- 技能面板打开、安装、启停后会刷新 Superpowers 诊断；检测到旧 `superpowers-agent.md` 残留时给出提示，当前版本仍使用 `superpowers-agent.yaml`。
- 版本号三处同步到 v2.8.21。
## 下一步
等待 v2.8.21 实例验收；确认 Plan 空状态不再报错，并在技能面板诊断里看到 Superpowers 的 skills-dir 和 agent-file。

# 2026-05-23 TodoList 卡片同步修复
## 已完成
- 排查到输入区 TodoList 直接读取 `appStore.currentSession.events`，右侧“已收起卡片”读取 `sessionStore` 中的实时会话，流式运行时两边可能不同步。
- `Composer` 改为使用 `activeSession` 渲染 TodoList，并用同一 session id 管理隐藏/恢复状态。
- 版本号三处同步到 v2.8.22。
## 下一步
等待 v2.8.22 实例验收；确认输入区 TodoList 和右侧已收起卡片的完成数一致。

# 2026-05-23 差异面板行级颜色
## 已完成
- 差异面板不再只显示整段“修改前/修改后”，改为单列 unified diff。
- 新增行用绿色背景和 `+` 标记，删除行用红色背景和 `-` 标记，未变更行保持普通背景。
- 每个 diff 块保留标题、变更数量和滚动区域，适配右侧窄栏阅读。
- 版本号三处同步到 v2.8.23。
## 下一步
等待 v2.8.23 实例验收；确认差异面板能清楚看出具体新增/删除段落。

# 2026-05-23 无正文思考展开
## 已完成
- `MessageBubble` 的过程详情判断补充 `thinkingParts`，避免只有流式思考片段时被误判为没有详情。
- `ChatThread` 保持后续有正文 assistant 不重复显示过程摘要，但无正文且有思考片段的 assistant 会保留可展开头部。
- 版本号三处同步到 v2.8.24。
## 下一步
等待 v2.8.24 实例验收；确认“Kimi 还没有生成正文内容”这类场景可以点击头部展开查看思考。

# 2026-05-23 已发送图片画板编辑与复制
## 已完成
- 用户已发送消息里的图片预览新增“画板”入口，可基于原图打开简易画板。
- 从历史图片打开画板后，保存结果会作为新 PNG 图片直接追加到输入框上传图片列表。
- 画板底部在“取消”和“保存”之间新增蓝色“复制”按钮，点击后复制当前画布图片到剪贴板，并加大三个按钮间距。
- 版本号三处同步到 v2.8.25。
## 下一步
等待 v2.8.25 实例验收；确认历史图片可编辑回填输入框，复制按钮可复制当前画布。

# 2026-05-23 额外工作目录入口迁移
## 已完成
- 输入框 `+` 菜单移除“额外工作目录”块，避免工具菜单被长期配置项占用。
- 底部当前项目按钮改为“工作目录”展开面板，展示主目录和额外目录列表。
- 新增 `project:chooseDirectory` IPC，只选择目录并返回路径，不会切换当前项目或写入最近项目。
- 额外目录新增方式改为系统目录选择器，支持去重和移除，继续写入 `additionalWorkDirs` 并由 Kimi CLI `--add-dir` 使用。
- 版本号三处同步到 v2.8.26。
## 下一步
等待 v2.8.26 实例验收；确认底部工作目录面板可展开、选择目录可添加、删除后不再传给 CLI。

# 2026-05-23 额外工作目录入口位置修正
## 已完成
- 纠正 v2.8.26 的入口位置错误：顶部项目按钮恢复为原来的打开项目/打开方式菜单。
- 额外工作目录展开面板改接到底部 ContextBar 的文件按钮，即截图里原本点击无效果的项目名按钮。
- 版本号三处同步到 v2.8.27。
## 下一步
等待 v2.8.27 实例验收；确认底部文件按钮展开工作目录面板，顶部项目按钮不再承担额外目录配置。

# 2026-05-23 额外工作目录选择兜底
## 已完成
- 底部工作目录面板的“选择目录”增加 try/catch，避免旧主进程未注册 `project:chooseDirectory` 时弹出全局错误。
- 旧窗口触发缺失 handler 时改为 toast 提示需要重启到新版 Kimix；其他选择失败也改为 toast。
- 版本号三处同步到 v2.8.28。
## 下一步
等待 v2.8.28 实例验收；重启新版后确认点击底部文件按钮里的“选择目录”能打开目录选择器并添加额外工作目录。

# 2026-05-23 工作目录浮层垂直对齐
## 已完成
- 工作目录浮层头部改为两列 grid，左侧标题说明与右侧“选择目录”按钮在各自空间内垂直居中。
- 额外工作目录标题行的计数胶囊改为固定高度 inline-flex 居中。
- 额外目录条目改为两列 grid，目录文本与删除按钮在条目空间内垂直居中。
- 版本号三处同步到 v2.8.30。
## 下一步
等待 v2.8.30 实例验收；确认截图标注的 1、2、3 三处都在各自空间内垂直居中。

# 2026-05-23 额外工作目录标题行微调
## 已完成
- “额外工作目录”标题与计数胶囊改为同一个 24px 行盒内居中，避免各自 line-height 造成视觉偏上/偏下。
- 分组和目录条目之间的间距调整为 8px，让标题行处在上下空间的视觉中心。
- 版本号三处同步到 v2.8.31。
## 下一步
等待 v2.8.31 实例验收；确认“额外工作目录”和右侧数字胶囊都在所在行内垂直居中。

# 2026-05-23 额外工作目录标签条
## 已完成
- 换掉裸标题行方案，将“额外工作目录”和计数胶囊放进 30px 高的浅色标签条容器。
- 标签条使用 grid 两列和明确左右内边距，文字、数字都在容器内居中，避免裸文字在空白区域里产生偏移感。
- 版本号三处同步到 v2.8.32。
## 下一步
等待 v2.8.32 实例验收；确认额外工作目录标题行在新标签条中视觉居中。

# 2026-05-23 额外工作目录独立分区卡
## 已完成
- 回退“裸标题/标签条夹在两块之间”的思路，改为额外工作目录独立分区卡。
- 标题与计数胶囊放在分区卡内部头部，目录项作为同卡内容，避免标题行在上下卡片之间漂浮导致整体不居中。
- 版本号三处同步到 v2.8.33。
## 下一步
等待 v2.8.33 实例验收；确认额外目录分区整体视觉重心和内部标题行都自然居中。

# 2026-05-23 工作目录浮层间距兜底
## 已完成
- 工作目录浮层关键垂直间距从 Tailwind `mt-*` 改为 inline `marginTop`，规避 Kimix 旧缓存/JIT spacing 类不生效导致卡片贴在一起。
- 额外目录分区和主目录卡片之间明确保留 14px 缝隙。
- “选择目录”按钮在 34px 固定高度基础上增加 1px 视觉下移，修正上/下留白观感不一致。
- 版本号三处同步到 v2.8.34。
## 下一步
等待 v2.8.34 实例验收；确认主目录与额外工作目录之间有明确缝隙，选择目录按钮上下视觉居中。

# 2026-05-23 额外目录列表项间距
## 已完成
- 额外工作目录有多项时，目录项外层增加 flex column 容器，并用 inline `gap: 8` 保留稳定缝隙。
- 版本号三处同步到 v2.8.35。
## 下一步
等待 v2.8.35 实例验收；确认多个额外目录条目之间不再贴在一起。

# 2026-05-23 小浮层 UI 规范沉淀
## 已完成
- 复盘本轮工作目录浮层问题：旧规则过于泛化，缺少小浮层分层、动态列表多项态、父级结构根因、Tailwind `mt/gap/bottom` 类不可靠等可执行约束。
- `AGENTS.md` 新增“小浮层/列表专项规则”，要求浮层先拆层级、分区标题归属分区卡、分区/列表项间距用 inline style、动态列表验收空态/单项态/多项态。
- `AGENTS.md` 扩展 Tailwind JIT 规则，把 `mt-*`、`gap-*`、`bottom-*` 纳入风险类；连续两次反馈没生效时必须先查父级结构和 sibling 关系。
- 版本号三处同步到 v2.8.36。
## 下一步
等待 v2.8.36 实例验收；后续小浮层和动态列表 UI 必须按新规则先做结构自查。

# 2026-05-23 TodoList 自动隐藏与通知正文
## 已完成
- TodoList 推导新增 `getVisibleTodos`：最新 Todo 全部为 `done` 时视为已结束，不再显示输入区 TodoList，也不再进入右侧“已收起卡片”恢复入口。
- 桌面通知记录 runtime 本轮开始位置和当时未完成的 assistant 占位消息；完成时从本轮新增/本轮占位 assistant 正文中提取摘要作为通知正文。
- 通知摘要会剥离 Markdown 代码块、图片、链接语法并截断到约 120 字；若本轮没有 assistant 正文，才回退到会话标题完成提示。
- 版本号三处同步到 v2.8.37。
## 下一步
等待 v2.8.37 实例验收；确认 TodoList 全完成后自动消失，桌面通知正文使用本轮 agent 回复内容。

# 2026-05-23 需求澄清等待通知
## 已完成
- 收到 pending `question_request` 时触发桌面通知，提示用户回到 Kimix 回复需求澄清。
- 通知正文使用澄清问题摘要，并复用当前通知可见性设置，窗口可见时按设置避免打扰。
- 按 runtime session + request id 去重，避免同一张澄清卡重复弹通知。
- 版本号三处同步到 v2.8.38。
## 下一步
等待 v2.8.38 实例验收；触发一次需求澄清，确认窗口不在前台时会提示用户回复。

# 2026-05-23 插件与 Hooks 右侧界面
## 已完成
- 左侧“技能”入口改为“插件”，点击后切换到主工作区右侧页面，不再使用居中弹窗。
- 左侧在“插件”和“长程任务”之间新增 Hooks 入口；误改成“自动化”的文案已恢复为“长程任务”。
- 插件页复用原 Skills 管理逻辑，保留导入、Superpowers、启用状态和诊断，并把 Skill 卡片改为两列网格提高信息密度。
- Hooks 页改为真正两列：左侧规则状态、已有规则、模板、最近命中；右侧规则编辑器。
- 点击新建或模板创建规则时隐藏已有规则，进入“规则创建 Agent + 规则草稿”两列创建态，保存后回到已有规则列表。
- Hooks 设置接入 `hookRules` / `hookRunLog` 类型、默认设置、主进程保存 schema 和浏览器预览保存返回值，修复保存不生效的问题。
- 创建规则窗口新增自然语言描述与规则创建提示词；v2.8.40 已从本地启发式生成改为 `hooks:generateRule` 调用临时 Kimi session，由规则创建 Agent 输出 HookRule JSON 草稿。
- 点击“生成规则草稿”后会进入生成中状态，按钮禁用并显示转圈；生成失败会在规则状态里显示错误，不再瞬间填入假草稿。
- v2.8.41 补齐 HookRule 的 `timeout` 字段，并要求通知/提示类 hook 也生成可执行 `command`。
- 对“每轮开始提示当前时间”这类需求增加后端兜底，会生成 `SessionStart + notify + powershell Get-Date` 命令，避免只有名称和说明。
- v2.8.42 在前端收到 agent 结果后、保存草稿前都再次补全 HookRule；即使后端返回空 command，右侧命令框和保存内容也会填入可执行脚本。
- v2.8.43 将 settings 中启用的 HookRule 转换为 Kimi SDK `hooks` 注册到新建 session；handler 执行规则 command、写入 hookRunLog，并按 block/exit 2 返回阻断。
- Hooks 编辑交互调整：保存后关闭右侧编辑窗口，右上角改为“取消”，删除规则按钮移动到保存按钮下方。
- v2.8.44 将自然语言规则创建的一次性 Kimi session 使用 `kimix-hidden-hooks-` 前缀，并在后端历史列表过滤；前端启动恢复时会清理已泄漏的旧规则创建会话。
- v2.8.45 修复 `selectedRuleId=null` 后仍通过 `rules[0]` 自动打开编辑器的问题；保存、取消、删除当前规则后会保持右侧为空态。
- v2.8.46 移除 Hooks/插件工作区顶部 toolbar 的重复小标题，保留页面内主标题。
- v2.8.46 保存 HookRule 时同步写入官方 `~/.kimi/config.toml` 的 `[[hooks]]` 配置块；用于需要 stdout 注入上下文的 shell hooks。
- v2.8.47 修复时间注入规则误用 `SessionStart` 的问题：官方“用户提交输入前”事件是 `UserPromptSubmit`，用于每轮注入上下文。
- v2.8.47 补齐官方 hooks 事件列表：`PreToolUse` / `PostToolUse` / `PostToolUseFailure` / `Notification` / `Stop` / `StopFailure` / `UserPromptSubmit` / `SessionStart` / `SessionEnd` / `SubagentStart` / `SubagentStop` / `PreCompact` / `PostCompact`。
- v2.8.47 写入 `~/.kimi/config.toml` 前会移除顶层 `hooks = []`，避免和 `[[hooks]]` 数组表冲突；加载设置时也会自动同步一次已有规则。
- v2.8.48 映射 Kimi `HookTriggered` / `HookResolved` 事件，并在助手消息复制按钮旁显示“钩子 N”提示，悬停可看事件和结果。
- 版本号三处同步到 v2.8.48。
- v2.8.49 将 `UserPromptSubmit` 从官方 TOML 同步中剔除，改为 Kimix 在 `sendPrompt` 前执行命令、发送 HookTriggered/HookResolved UI 事件，并把 stdout 作为隐藏上下文拼入本轮用户消息，解决 wire 会话里触发但模型不吃上下文的问题。
- v2.8.49 复制按钮旁钩子提示只统计 resolved 阶段并去重，避免一个规则显示成“钩子 2”；Hooks 页“新建规则”按钮改为蓝色主按钮。
- v2.8.50 修复 Windows PowerShell hook stdout 中文乱码：执行 hook command 时读取 buffer，优先 UTF-8，检测到替换字符后退回 GB18030 解码。
- v2.8.51 依据真实 `wire.jsonl` 排查到 hook 上下文已进入 `TurnBegin.payload.user_input`，但被包在需求澄清工具外层；改为对 `UserPromptSubmit` 只匹配用户原始需求，并把 hook 上下文注入到“用户原始需求”内部，同时强化“必须先读取并遵守”指令。
- v2.8.51 清理 hook stdout 中的替换字符、控制字符和 Windows emoji 退化出的行首 `??`，减少 tooltip/log 的残留乱码。
- v2.8.52 根据截图反馈修正：`eventMapper` 剥离需求澄清包装后递归剥离 Hooks 包装，避免 `TurnBegin` 回放把隐藏 Hook 上下文显示成第二条用户气泡。
- v2.8.52 不再把 Hook 上下文插入“用户原始需求”开头，改为追加到整条 prompt 末尾作为本轮硬性要求，降低被用户原消息/澄清包装覆盖的概率。
- v2.8.53 思考过程展开后，顶部摘要行保持单行并收紧底部留白，减少截图中展开态上半部分占用空间的问题。
- v2.8.53 设置入口改为右侧主工作区页面，复用现有 `workspaceView`，设置面板支持 workspace/modal 两种承载；右侧页面下隐藏弹窗关闭按钮。
- v2.8.54 修复设置页 workspace 模式误用 CSS columns 导致内容横向排到屏幕外的问题；改为两列 CSS grid，`overflow-y: auto`、`overflow-x: hidden`，窄宽度自动单列。
- v2.8.55 排查到 `settings.json` 已有 `hookRunLog`，但 HooksPanel “最近命中”仍是写死占位；改为读取 `hookRunLog` 并展示规则名、事件、动作、结果、时间和消息摘要。
- v2.8.56 将内部会话过滤抽为 `isHiddenInternalSession`，覆盖 `kimix-hidden-hooks-`、规则创建 prompt 标题和 HookRule JSON 标题；用于启动恢复、搜索加载、侧栏展示和 store 清理，避免 Hooks 规则创建 agent 会话暴露。
## 下一步
等待用户验收 v2.8.56；确认侧栏不再显示规则创建 agent prompt/JSON 会话，主对话也不会打开这些内部会话。

# 2026-06-02 Kimi Code SDK 登录入口修复
## 已完成
- 排查用户截图中的登录失败：旧 `@moonshot-ai/kimi-agent-sdk` 登录 helper 会调用当前 Kimi Code CLI 不支持的 `--json`，导致前端显示 `error: unknown option "--json"`。
- `kimi:login` 改为优先启动新版 Kimi Code 交互进程并发送 `/login`，捕获官方授权链接后用系统浏览器打开；旧 SDK 登录 helper 只保留为 fallback。
- 放宽授权链接匹配规则，兼容 `authorize_device` / `authorize` 类官方链接，降低 CLI 输出格式微调导致抓不到链接的风险。
- 新增/使用 `scripts/restart-kimix-dev.ps1` 安全重启方式：只停止命令行中包含 Kimix 工作区或 Kimix userData 的 Electron/Node 进程，避免全局杀 `electron.exe` / `node.exe` 误伤 Codex/OpenAI 桌面壳。
## 验证
- `pnpm build` 通过。
- `scripts/restart-kimix-dev.ps1` 已完成构建、清理缓存并启动 Kimix；确认 Electron 进程来自当前 Kimix 工作区。
- `kimix-dev.log` 暂未出现主进程启动错误。
## 未完成
- OAuth 授权本身需要用户点击“去登录”后在浏览器完成，当前未代替用户完成网页登录。
## 下一步
请在新启动的 Kimix 窗口里再次点击“去登录”；若浏览器没有打开或仍报错，回传新的错误文案。

# 2026-06-02 Kimi Code SDK 登录二次修复
## 已完成
- 用户复验发现：消息错误卡登录按钮会卡在“打开中”，设置页登录按钮闪一下但没有跳转。
- 根因修正：`kimi` 0.6.0 没有 `login` 子命令，普通 pipe 启动交互式 `/login` 不可靠；官方源码确认 `/login` 实际调用 `harness.auth.login("kimi-code", { onDeviceCode })`。
- `electron/kimiCodeHost.ts` 新增 SDK auth login 封装：拿到 device-code 授权链接后立即返回给 IPC，同时后台继续等待浏览器授权写入 token。
- `electron/main.ts` 的 `kimi:login` 改为 SDK auth 优先，并在 `onDeviceCode` 里立刻 `shell.openExternal()` 打开授权链接。
- `ErrorCard` 和 `SettingsPanel` 的登录按钮增加 `try/catch/finally`，避免 IPC 异常或超时后按钮持续卡在 loading。
## 验证
- `pnpm build` 通过。
- `scripts/restart-kimix-dev.ps1` 已重新构建、清理缓存并启动 Kimix；确认 Electron 进程来自当前 Kimix 工作区。
- `kimix-dev.log` 暂未出现主进程启动错误。
## 未完成
- 浏览器授权完成与 token 写入仍需用户实际点击登录并在浏览器授权后验收。
## 下一步
请在新窗口再次点击“去登录”；预期浏览器会打开 Kimi 授权页，按钮不再长期卡住。

# 2026-06-02 Kimi Code SDK 登录 provider 修正
## 已完成
- 用户复验后出现 `No OAuth manager configured for provider "kimi-code"`。
- 查官方源码确认 `KIMI_CODE_PROVIDER_NAME = "managed:kimi-code"`，裸 `kimi-code` 是平台 id，不是 OAuth provider name。
- `electron/kimiCodeHost.ts` 的 SDK login 默认 provider 改为 `managed:kimi-code`。
- `electron/main.ts` 的 `kimi:login` 调用同步改为 `managed:kimi-code`。
## 验证
- `pnpm build` 通过。
- `scripts/restart-kimix-dev.ps1` 已重新构建并启动 Kimix；确认 Electron 进程来自当前工作区。
- `kimix-dev.log` 暂未出现启动错误。
## 下一步
请再次点击“去登录”；若仍失败，回传新错误文案。

# 2026-06-02 登录成功后旧错误卡回收
## 已完成
- 用户复验确认登录已成功且后续消息能正常回复，但旧 `requires login` 错误卡仍停留在对话流中。
- `ErrorCard` 对登录类错误增加认证状态监听：收到 `kimix:kimi-auth-changed` 或每 5 秒轮询 `getKimiAuthStatus()` 发现已登录时，自动隐藏旧登录错误卡。
- 登录按钮自身收到 `loggedIn: true` 时也会立即隐藏当前错误卡。
## 验证
- `pnpm build` 通过。
- `scripts/restart-kimix-dev.ps1` 已重新构建并启动 Kimix；确认 Electron 进程来自当前工作区。
- `kimix-dev.log` 暂未出现启动错误。
## 下一步
请在新窗口看旧登录错误卡是否会自动消失；若仍残留，先点击一次设置页刷新登录状态触发 auth changed。

# 2026-06-02 DeepSeek V4 Flash 默认 Provider 草稿
## 已完成
- 设置页 OpenAI-compatible Provider 表单默认草稿从 OpenAI GPT-4.1 改为 DeepSeek V4 Flash。
- 默认值：Provider `deepseek`，模型别名 `deepseek/deepseek-v4-flash`，Base URL `https://api.deepseek.com`，模型名 `deepseek-v4-flash`，Context `1000000`。
- 浏览器预览 mock 中保存 / 设为默认后的模型配置也同步改为 DeepSeek V4 Flash，避免预览与桌面默认值不一致。
## 验证
- `rg` 确认 `SettingsPanel.tsx` 和 `src/main.tsx` 中不再残留旧 `kimix-openai` / `kimix/gpt-4.1` / `gpt-4.1` / `api.openai.com` 默认值。
- `pnpm build` 通过。
- `scripts/restart-kimix-dev.ps1` 已重新构建并启动 Kimix；确认 Electron 进程来自当前工作区。
- `kimix-dev.log` 暂未出现启动错误。
## 下一步
请打开设置页确认 OpenAI-compatible Provider 表单默认填入 DeepSeek V4 Flash。

# 2026-06-02 SDK 引导状态延迟结算
## 已完成
- 用户反馈：运行中 steer 刚发出去就显示“已引导对话”，但应该等 agent 确实处理完后再显示。
- `SteerMessageEvent.status` 新增 `accepted` 中间态：IPC 成功只表示 SDK 已接收引导请求，不代表 agent 已完成处理。
- Composer 发送普通引导和队列项引导成功后改为 `accepted`，不再立即标记 `sent`。
- MessageBubble 文案调整：`sending` 显示“已发送引导请求”，`accepted` 显示“正在引导”，只有 turn completed 后结算为 `sent` 才显示“已引导对话”。
- App 终态结算会把 `sending` / `accepted` 的 steer 在 completed 时标为 `sent`，在 error/interrupted 时标为 `failed`。
- eventMapper 把 `accepted` 和 `sent` 一样视为 steer 边界，保证 agent 回复仍出现在引导消息下面。
## 验证
- `pnpm test:run -- src/utils/__tests__/eventMapper.test.ts src/utils/__tests__/kimiCodeEventMapper.test.ts` 通过：2 个文件、45 个测试。
- `pnpm build` 通过。
- `scripts/restart-kimix-dev.ps1` 已重新构建并启动 Kimix；确认 Electron 进程来自当前工作区。
- `kimix-dev.log` 暂未出现启动错误。
## 下一步
请再次在运行中发送一条引导，确认发送后先显示“正在引导”，agent 完成后才变为“已引导对话”。

# 2026-06-02 Kimi Code 更新源口径修正
## 已完成
- 用户反馈 Kimi Code “重新安装/更新”总失败，更新页显示当前 0.6.0、最新 0.7.0。
- 排查确认：实际 `kimi` 路径为 `C:\Users\Administrator\.kimi-code\bin\kimi.exe`，版本 0.6.0；npm registry `@moonshot-ai/kimi-code` 返回 0.7.0；但官方 Windows 安装 CDN `https://code.kimi.com/kimi-code/latest` 当前仍返回 0.6.0，且 `https://code.kimi.com/kimi-code/0.7.0/manifest.json` 不存在。
- 根因：Kimix 检查更新使用 npm registry 最新版本，安装器使用官方 CDN latest/manifest，两个源不一致导致 UI 要求安装 0.7.0，但安装器只能装回 0.6.0，最终被判定“仍未达到最新版本”。
- `electron/main.ts` 的 Kimi Code 最新版本检查改为使用安装器同源的 CDN `latest`，与 Windows 安装 manifest 保持一致。
- 更新弹窗文案从“最新”改为“最新可安装”，避免把 npm 已发布但安装器未上架的版本误认为可更新。
## 验证
- 本机验证：CDN latest = 0.6.0，npm latest = 0.7.0，实际 `kimi --version` = 0.6.0。
- `pnpm build` 通过。
- `scripts/restart-kimix-dev.ps1` 已重新构建并启动 Kimix；确认 Electron 进程来自当前工作区。
- `kimix-dev.log` 暂未出现启动错误。
## 下一步
请打开更新页重新点“检查 CLI”；预期 Kimi Code 不再提示可安装的 0.7.0，除非官方 CDN 后续补齐 0.7.0 manifest。

# 2026-06-02 引导后 assistant 内容保留修复
## 已完成
- 用户反馈：运行中引导一条消息后，上次输出正文在 UI 中丢失，只剩完成态过程摘要。
- 复查确认与引导状态中间态有关：`accepted` 应作为新 assistant 回合边界，但不能像 `sending` 一样把后续 assistant/status/tool 插回引导前。
- `eventMapper` 保留 `accepted/sent` 作为 assistant 合并边界，但只有 `sending` 仍作为“尾部占位”回插保护；accepted 后的 assistant/status/tool 会留在引导消息下面。
- 修复完成/持久化结算中只认 `thinking` 不认 `thinkingParts` 的漏洞，避免只有分段思考的 assistant 被当成空消息删除。
- 修复 `ChatThread` 合并可见 assistant 时漏认 `thinkingParts` 的漏洞，避免只有分段思考/过程的消息在渲染时被跳过。
- 新增 `eventHelpers.test.ts`，覆盖 settle 时保留只有 `thinkingParts` 的 assistant；补充 eventMapper accepted steer 边界测试。
## 验证
- `pnpm test:run -- src/utils/__tests__/eventMapper.test.ts src/utils/__tests__/kimiCodeEventMapper.test.ts src/utils/__tests__/eventHelpers.test.ts` 通过：3 个文件、47 个测试。
- `pnpm build` 通过。
- `scripts/restart-kimix-dev.ps1` 已重新构建并启动 Kimix；确认 Electron 进程来自当前工作区。
- `kimix-dev.log` 暂未出现启动错误。
## 风险
- 已经被旧逻辑过滤掉且没有持久化在本地事件里的历史正文，无法靠 UI 结算逻辑自动恢复；后续引导链路应不再复现同类丢失。
## 下一步
请再次在运行中发送一条引导，确认后续 assistant 正文仍保留在引导消息下方。
