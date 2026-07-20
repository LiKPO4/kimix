# Kimix 长程任务状态

## 2026-07-20 v2.16.67 多步工具轮次展开只剩工具、思考丢失

- 当前目标：用户报告过程展开只能看到「N 个工具调用」，思考段全部消失。
- 根因：`prompt.completed` barrier 回放多步官方 Assistant（每步 think+tool_use）时，`mergeEvents` 的 `completionBarrierReplay` 路径把后续稳定 message ID 反复绑到同一个 incomplete 占位上，并用后一步的 `thinking/thinkingParts` 覆盖前序思考；同 ID 多帧时 `replaceCanonicalDimensions` 也会用最新 think 帧替换整段 thinkingParts。工具事件独立累积，所以 UI 只剩工具卡。
- 修复：barrier 仅绑定尚未持有 stable snapshot ID 的 live 占位；thinking 文本/parts 跨 barrier 帧合并累积（去重/升级超集），正文仍允许 barrier 权威改写。
- 验证：新增多步 barrier 思考保留回归；定向 barrier 2 项通过；全量 106 文件 913 项通过；typecheck 通过。
- 关键文件：`src/utils/eventMapper.ts`、`src/utils/__tests__/kimiCodeServerClient.test.ts`、`knowledge/architecture/runtime-routing.md`。
- 下一步：用户在 v2.16.67 实机展开多工具轮次，确认思考段与工具同时可见。

## 2026-07-20 v2.16.66 移除 60 秒上限，改为保留空 placeholder

- 当前目标：v2.16.65 的 60 秒上限太短，用户报告 1 分 03 秒后头消失（body 来得慢，401 余额不足重试），轮次最终成功。
- 根因：60 秒上限假设"60 秒内没 body 就是误判"，但 body 可能来得很慢（401 重试、长思考模型）。上限放行后 settle 删空 placeholder，头消失。
- 修复：移除时间上限。`settleInactiveEvents` 加 `preserveEmptyAssistant` 参数，`settleTerminalRoomAgent` 加 `turnReceivedBody` 参数。终端 settle 时若 `!turnReceivedBody`，保留空 placeholder 为 `isComplete=false`（不删），仍清 running state 和派发下一条。保留 `isComplete=false` 让 `mergeAssistantProcessEvents` 不过滤、`mergedAssistantEvent` 有值、`turnSettled=false`、消息头可见。
- 验证：eventHelpers 29 项通过（含新增 2 个）；全量 106 文件 910 项通过；typecheck + build 通过，renderer `assets/index-Cr97Rwyw.js`。
- 关键文件：`src/utils/eventHelpers.ts`、`src/utils/roomAgentControl.ts`、`src/App.tsx`、`src/utils/__tests__/eventHelpers.test.ts`。
- 下一步：用户实机复验 v2.16.66。

## 2026-07-20 v2.16.65 正常轮次被提前判定终端导致消息头消失（6 秒 bug）

- 当前目标：v2.16.64 修复了失败轮次头消失后，用户报告新现象——发送消息后约 6 秒 Assistant 消息头消失，只剩 "Context: 13.87%" 气泡；轮次最终成功，body 后到时头又回来（闪烁）。
- 根因证据（经完整事件链 + Explore agent 确认，与失败轮次完全不同路径）：
  1. 0.27 Server 在 assistant body 还没 stream 到时提前报 `idle`/`completed`（step 边界 quirk）。
  2. `App.tsx:3261-3303` 终端轮询路径：2.5s guard + 连续 2 次终端 poll → ~5.7s 触发 `settleTerminalRoomAgent`（1.5s 轮询间隔）。
  3. `settleInactiveEvents`（eventHelpers.ts:265）把空 assistant placeholder `return []` 删除。
  4. `buildRenderItems`：`turnSettled=true` + `mergedAssistantEvent=undefined` + `isTurnActive=false` → 头消失，只剩 `status_update`（Context: 13.87%）当独立气泡。
  5. body 后到 → 头又回来（闪烁）。
  6. 改 `settleInactiveEvents` 本身不够：`mergeAssistantProcessEvents` 过滤空 assistant，`isTurnActive=false` 让 pending-placeholder fallback 不触发。
- 修复（单个修复点，最小）：
  - `src/utils/eventHelpers.ts`：新增纯函数 `hasTurnReceivedBody(events)`——判断当前轮次（latest user message 之后）是否收过 assistant body/thinking/tool/subagent/error 事件。`status_update` 不算 body。
  - `src/App.tsx`：终端轮询路径在 `terminalPolls < 2` 之后、`flushStreamEvents()` 之前加守卫：60 秒内 + `!hasTurnReceivedBody` → 不 settle，return 等待，写回 `terminalPolls` 让计数继续累积。超过 60 秒允许 settle（兜底真正失败但无 error event 的轮次）。
- 验证：eventHelpers 测试 27 项通过（含新增 10 个 `hasTurnReceivedBody` 测试）；全量 106 文件 910 项通过；typecheck 通过；build 通过，renderer `assets/index-B4uS4UGQ.js`。
- 关键文件：`src/utils/eventHelpers.ts`、`src/App.tsx`、`src/utils/__tests__/eventHelpers.test.ts`。
- 风险与回滚：真正失败但无 error event 的轮次会等 60 秒才 settle（可接受）。revert 即可，无 schema/持久化变更。
- 下一步：用户实机复验 v2.16.65，确认正常轮次 6 秒后头不再消失。

## 2026-07-20 v2.16.64 live 失败头消失三层根因根治

- 当前目标：v2.16.63 仍存在“发送消息失败后 agent 消息头先消失、第二次打开才显示”的问题，需从最底层根治。
- 根因证据（三层叠加，经完整事件链快照确认）：
  1. `snapshotMessagesToServerFrames` 合成失败三帧要求 6 个条件全部满足（`inFlightItems.length===0`、`session.busy!==true`、`session.main_turn_active!==true`、`!latestTurnHasDisplayFrame`、末尾空 Assistant、空正文）。live 失败瞬间 snapshot 处于过渡态，条件不满足 → 失败正文三帧一个都不发。重启恢复稳态成立 → 能合成。这是“第二次打开才显示”的直接原因。
  2. `turn.ended(reason=failed)` 被 `kimixTerminalScope === "prompt"` 过滤（`flattenServerEvent` 给所有 Server frame 打 scope，`kimiCodeEventMapper` 对 prompt-scoped turn.ended 除 filtered 外全过滤）。`content.part` 产生 `isComplete=false`，只有 `turn.ended` 能产生 `isComplete=true` terminal marker，但它被过滤 → 失败 assistant 永远 incomplete。
  3. `buildRenderItems.turnSettled` 要求所有 assistant `isComplete=true`。失败 assistant 永远 incomplete → `turnSettled=false` → `projectedFailureAssistant`（要求 turnSettled）不触发 → 不渲染消息头。
  4. 次要：`isVisibleTurnOutput` 把 `error` 当可见输出，`mergeMissingLatestCanonicalAssistant` 在本地有 transient error 时拒绝补入 canonical 失败 Assistant。
- 修复（三个修复点，全部最小且已验证不影响成功轮次）：
  1. `electron/kimiCodeServerClient.ts`：`deliverPromptCompletion` 失败分支保留 `recoverSnapshot`（cursor 同步 + WS 重订阅副作用），再调 `getSnapshot`，由新增 `deliverFailedPromptFrames` 无条件自构三帧（`turn.step.interrupted` + `content.part(失败正文, kimixPromptCompletionBarrier:true)` + `turn.ended(reason=failed)`），带 stable messageIdentity。barrier 让 renderer mergeEvents 走 REPLACE 语义，与 recoverSnapshot 可能合成的相同 stable ID 帧幂等去重。
  2. `src/utils/kimiCodeEventMapper.ts`：`turn.ended` 的 prompt-scope 过滤对 failed/cancelled/interrupted/error/canceled/aborted reason 放开（新增 `isFailedTurnEndedReason` helper）。成功 `reason=completed/missing` 仍被过滤，保持 780e6629e 设计不变。
  3. `src/utils/kimiHistoryReconciliation.ts`：`isVisibleTurnOutput` 移除 `error` 类型。transient error 是状态信号不是 Assistant 正文。
- 验证：定向 3 文件 111 项通过；全量 106 文件 900 项通过；typecheck 通过；build 通过，renderer `assets/index-DiS4qqMI.js`；OKF 严格校验通过（10 概念、18 Markdown、254 链接）。
- 关键文件：`electron/kimiCodeServerClient.ts`、`src/utils/kimiCodeEventMapper.ts`、`src/utils/kimiHistoryReconciliation.ts`、三个对应测试文件。
- 风险与回滚：revert 本次 commit 即可，无 schema/持久化变更，KIMI_HISTORY_CACHE_VERSION 不变。
- 下一步：用户实机复验 v2.16.64，确认 live 失败时消息头不再消失、失败正文即时显示。

## 2026-07-20 v2.16.63 live 失败轮次权威收口

- 当前目标：修复 v2.16.62 中新发消息在 Provider 首 token 前失败时，仍只剩用户消息；同时纠正失败回复被显示为“输出完成/已完成”。
- 根因证据：用户在 v2.16.62 新发“？？？”后，官方 0.27.0 会话再次记录 `last_turn_reason=failed`，snapshot 末尾为 `msg_...MV3K` 用户消息 + injection user + 稳定 ID 空 Assistant `msg_...000273`，但本地没有该 Assistant。Client 对失败 `prompt.completed` 直接放行，错误依赖瞬时 `error` 一定先到 renderer；该证据丢失时既无失败投影，也没有权威 snapshot 收口。
- 修复：失败/中断/取消 completion 在交付前强制恢复一次官方 snapshot；snapshot 对终态空 Assistant 合成稳定失败正文，并同步生成“输出打断”状态。即使 transient error 丢失，也能恢复 Assistant 头、正文和左侧刻度，消息头/底部不再声称正常完成。缓存升级到 v13，版本升至 v2.16.63。
- 验证：精确失败测试先红后绿；定向链路最终 3 文件 110 项、全量 106 文件 894 项通过；严格类型检查与生产构建通过，renderer 为 `assets/index-BwNbJomS.js`；OKF 严格校验通过。CDP 正式构建实测最新“？？？”轮次已持久化稳定失败 Assistant `msg_...000273`，导航轨道末尾为用户第 9 节点/助手第 10 节点，DOM 中“输出打断”同时出现在消息头与终态区。
- 关键文件：`electron/kimiCodeServerClient.ts`、`src/utils/eventMapper.ts`、`src/utils/__tests__/kimiCodeServerClient.test.ts`。
- 下一步：全量门禁、清理临时 CDP 探针并提交；用户在当前 v2.16.63 窗口复验。

## 2026-07-20 v2.16.62 失败轮次启动恢复根治

- 当前目标：修复 v2.16.61 重启后目标失败轮次仍只剩用户消息、Assistant 头与左侧刻度继续缺失。
- 根因证据：真实 0.27.0 snapshot 末尾是 user + injection user + 稳定 ID 空 Assistant，但 snapshot/session 不提供 `last_turn_reason`；更关键的是当前会话 hydration 早于延后 2 秒的 Server startup，首次读取落到本地 wire 镜像，Server 就绪后不再重试。拿到官方 snapshot 后，完整 canonical 又因 `assistant-body-regression` 被正确拒绝，失败 Assistant 随整包候选丢失。
- 修复：首次历史读取触发并有界等待同一个 Server startup promise，避免启动竞态永久选中本地镜像。终态空 Assistant 恢复改为基于“静止会话 + 无 in-flight + 最新空 Assistant + 该轮无正文/工具”的真实可观测条件。整体 canonical 继续禁止正文倒退；拒绝时仅把同一最新用户轮次、稳定官方 message ID 的缺失 Assistant 单条补入，旧历史不动且幂等。缓存升级到 v12。
- 验证：定向 3 文件 80 项通过；全量 106 文件 890 项通过；Node/Renderer 严格类型检查通过；生产构建通过，renderer 为 `assets/index-D73YmxPk.js`；OKF 严格校验通过。CDP 正式构建实测目标会话已持久化 `msg_...000270` 失败 Assistant，DOM 命中通用失败说明，导航轨道末尾恢复“用户第 9 节点 → 助手第 10 节点”。
- 关键文件：`electron/main.ts`、`electron/kimiCodeServerClient.ts`、`src/utils/kimiHistoryReconciliation.ts`、`src/App.tsx`、`src/components/layout/Sidebar.tsx`。
- 下一步：全量回归、知识校验并提交；用户在 v2.16.62 窗口视觉复验。

## 2026-07-20 v2.16.61 第三方模型失败轮次可见性

- 当前目标：修复切换第三方模型后请求失败时，整轮只剩用户消息、Assistant 消息头与左侧刻度消失的问题。
- 根因证据：现场会话 `session_01ea935b-5c5d-455a-a6aa-b8e9b2dbdefb` 的官方事件 seq 615-619 明确为 `turn.step.interrupted`、`turn.ended(reason=failed)`、`error(provider.auth_error: 401 Insufficient balance)`、`prompt.completed(reason=failed)`；官方消息只保存一个空 Assistant，snapshot 不保存瞬时 error。v2.16.60 错把失败 completion 送入成功正文屏障，等待不存在的正文后回放 snapshot，最终冲掉本地 error，只留下用户消息。
- 修复：失败/中断/取消 completion 直接按官方顺序交付，不进入成功正文屏障。ChatThread 将“用户消息后只有 error”的终态投影成稳定 Assistant 失败回复，保留 Agent 头、输出打断状态和左侧刻度；余额不足与认证失败提供明确中文说明。历史恢复检测 `last_turn_reason=failed + 最新 Assistant 为空`，生成不伪造具体原因的通用失败回复；缓存升级到 v11，强制修复已受影响会话。
- 验证：真实事件形态对应的 Client 与 renderItems 定向回归 72 项通过；全量 106 文件 885 项、Node/Renderer 严格类型检查、生产构建均通过，renderer 为 `assets/index-DrLxnDGM.js`；OKF 严格校验通过（10 概念、18 Markdown、251 链接）。
- 关键文件：`electron/kimiCodeServerClient.ts`、`src/components/chat/ChatThread.tsx`、`src/utils/__tests__/kimiCodeServerClient.test.ts`、`src/utils/__tests__/chatRenderItems.test.ts`。
- 下一步：提交并重启本地 v2.16.61；用户重开目标会话，确认失败轮次出现 Assistant 失败头和说明。

## 2026-07-20 v2.16.60 Prompt 终态交付与工具历史完整性

- 当前目标：根治 Agent 开始回答后消息头短暂消失，以及重开/展开过程信息时命令大量缺失。
- 根因证据：目标官方 0.27.0 Server 会话在 `prompt.completed` 后持有完整 Assistant thinking/text，但 Kimix 本地 IndexedDB 同轮只有 user/status，证明终态先于 Assistant 交付；官方 Assistant snapshot 的 `content` 同时包含 `tool_use`，而 Client 只转换 text/thinking，导致本地 28 条 `tool_result` 无对应 `tool_call`，ChatThread 又按设计隐藏独立结果。
- 修复：`prompt.completed` 完成屏障以“本轮至少出现可显示 Assistant/content/tool call frame”为成功条件，对官方 messages 做有限退避重试并以最终 snapshot 收口，禁止仅找到 prompt/注入消息就提前结束 UI 占位。快照转换完整恢复 `tool_use` 的调用 ID、名称和参数，使现有 tool result 合并回可展开命令；历史缓存升级到 v10，强制旧缺命令缓存重新接受官方历史。
- 验证：新增延迟 Assistant 落库与 snapshot tool_use/tool_result 合并回归；全量 106 文件 882 项、Node/Renderer 严格类型检查、生产构建均通过，renderer 为 `assets/index-BdLNUMml.js`；OKF 严格校验通过（10 概念、18 Markdown、250 链接）。
- 关键文件：`electron/kimiCodeServerClient.ts`、`src/utils/__tests__/kimiCodeServerClient.test.ts`、`src/utils/kimiHistoryCache.ts`、`docs/issue-assistant-header-and-tool-history-snapshot.md`。
- 下一步：提交本轮；由用户使用 v2.16.60 复验首轮短回复与展开命令完整性。

## 2026-07-19 v2.16.59 会话模型所有权与单轮模型锁定

- 当前目标：根治用户切换到 Pro 后界面和实际回复又回退到 Flash，以及切换后长时间无响应的模型路由竞态。
- 根因证据：目标会话 `session_01ea935b-5c5d-455a-a6aa-b8e9b2dbdefb` 的官方 0.27.0 Server profile/status 在问题发生后仍为 `opencode-go/deepseek-v4-pro`，隔离探针的 Flash → Pro → 立即发送也确认所有带 model 的官方 WebSocket 帧均为 Pro；截图却同时把消息头和底部选择器显示为 Flash，且 `running-sample` 对账紧随发送触发。Kimix 过去把历史 Assistant/status 的 turn model 反写成当前会话 model，并允许旧 `/status` 响应覆盖刚完成的切换；模型菜单切换中又只让 `switchedToModel` 负责显示，prompt 仍读取旧 `modelAlias`，形成“看见 Pro、发送 Flash”的窗口。
- 修复：当前模型由官方 session/profile 状态与本地显式选择共同拥有，历史事件模型只描述对应轮次；启动恢复和侧栏选择使用官方 runtime model 修复旧本地污染。每个 prompt 从 renderer 显式携带 `switchedToModel ?? modelAlias`，主进程将其作为不可变模型贯穿重试和 Server controls。Server 模型切换按 session 串行，status 刷新受 revision 门禁约束，切换中的旧响应不再对外暴露旧模型。
- 验证：定向 4 文件 49 项通过；全量 106 文件 880 项通过；Electron 与 renderer 两套严格类型检查通过；生产构建通过，renderer 为 `assets/index-gRWhfgp9.js`；OKF 严格校验通过（10 概念、18 Markdown、249 链接）；`git diff --check` 通过（仅 LF/CRLF 提示）。
- 关键文件：`electron/kimiCodeHost.ts`、`electron/main.ts`、`src/App.tsx`、`src/components/chat/ContextBar.tsx`、`src/components/chat/Composer.tsx`、`src/components/layout/Sidebar.tsx`、`src/hooks/useEventStream.ts`、`src/utils/modelDisplay.ts`、`docs/issue-model-switch-routing-events-snapshot.md`。
- 下一步：提交本轮；由用户在 v2.16.59 复验 Flash → Pro 后立即发送和重启旧会话两条路径。

## 2026-07-19 v2.16.58 Prompt 完成屏障根治首轮消息头缺失

- 当前目标：根治切换模型后首轮 Assistant/消息头不显示、发送第二条消息后上一轮才突然补出的缺陷。
- 根因证据：目标官方会话在首条用户消息后 2ms 已创建含 thinking + text 的完整 Assistant；隔离 WebSocket 探针确认切换前后 epoch 不变、seq 连续且 `assistant.delta` 完整，排除模型与 Server 切换断流。`diag.log` 直到第二条消息运行约 6 秒才记录 `running-sample` 接纳第一轮官方正文，证明 Kimix 在超快 prompt 结束前漏接实时增量后，先关闭了运行态，而首个 1.2 秒快照采样尚未启动，缺失正文只能等下一轮补回。
- 修复：将 `prompt.completed` 改为协议级完成屏障。Client 收到完成帧后先从官方 messages 端点读取最近消息，按 prompt ID 截取本轮并以稳定 `snapshotMessageId` 回放；最近 100 条找不到 prompt 时才回退完整 snapshot。只有本轮官方消息已交付给 Host/renderer（或读取失败并明确降级）后，才下发原始 `prompt.completed`，从而保证状态完成、批量 flush 和 Assistant 渲染的因果顺序，不再依赖下一轮轮询。版本升至 v2.16.58。
- 验证：新增先失败后通过的协议与渲染回归，覆盖实时 delta 全丢/半丢、prompt 中夹有注入 user message、官方 messages 倒序且时间戳相同，以及完成前 Assistant 必须已进入可见且已收口的 renderItems；真实 0.27.0 Server 集成验证通过。严格 Node/Renderer 类型检查通过；全量 106 文件 872 项通过；生产构建通过，renderer 为 `assets/index-DRLmWo3M.js`；OKF 严格校验通过（10 概念、18 Markdown、248 链接）；`git diff --check` 通过（仅 LF/CRLF 提示）。
- 关键文件：`electron/kimiCodeServerClient.ts`、`src/utils/__tests__/kimiCodeServerClient.test.ts`、`knowledge/architecture/runtime-routing.md`。
- 下一步：提交本轮；由用户在 v2.16.58 切换模型后连续复验首轮短回复。

## 2026-07-19 v2.16.57 第三方模型供应商分层管理

- 当前目标：将设置页第三方模型配置完整重做为“供应商连接配置 + 供应商下多个模型”的两级管理，同时直接兼容现有 `config.toml` 数据。
- 根因：底层 Kimi Code 已将 `[providers.*]` 与 `[models.*]` 分离，但旧设置页仍把 Provider 名称、Base URL、API Key、模型别名、模型 ID、Context 塞进同一份草稿；每新增或修改一个模型都要重复处理供应商凭据，删除最后一个模型还会隐式删除 Provider。
- 修复：新增 Kimix 风格双栏管理器，左侧区分内置/第三方 Provider，右侧独立编辑连接信息并维护共享模型列表；现有配置按 provider 引用直接分组，未绑定旧模型仍可见。新增独立 Provider 保存、模型保存和 Provider 删除 IPC；模型删除只删除模型，Provider 删除需二次确认并连同引用模型处理。官方 managed Provider 保持只读；连接测试可复用直接保存或 `[providers.*.env]` 提供的 API Key；跨 Provider 的模型别名冲突会显式拒绝。SDK 保存失败时 TOML fallback 原位置按字段更新，保留未知字段及 `.env`/`.oauth` 子表顺序。版本升至 v2.16.57。
- 验证：新增 Provider 分组/旧数据迁移与 TOML 原位置编辑共 7 项测试；全量 106 文件 871 项通过；严格 Node/Renderer 类型检查通过；生产构建通过，renderer 为 `assets/index-CPvOlTmx.js`；OKF 严格校验通过（10 概念、18 Markdown、247 链接）；`git diff --check` 通过（仅 LF/CRLF 提示）。
- 关键文件：`src/components/settings/ModelProviderManager.tsx`、`src/components/settings/SettingsPanel.tsx`、`src/utils/modelProviderConfig.ts`、`src/utils/tomlSectionEditor.ts`、`electron/main.ts`、`electron/preload.ts`、`electron/types/ipc.ts`、`knowledge/architecture/runtime-routing.md`。
- 下一步：用户在 v2.16.57 设置页视觉验收内置/第三方 Provider 分组、添加 Provider、同一 Provider 连续添加多个模型及删除边界。

## 2026-07-19 v2.16.56 初始五轮窗口与折叠入口贴顶

- 当前目标：初次打开长会话时至少显示最近 5 个完整用户轮次，并消除折叠历史展开按钮上方过大的空白。
- 根因：初始尾窗按“最少 4 个 RenderItem、至少 2 条完成 Assistant”选取，不理解用户轮次，因此典型会话只挂载 `user + assistant + user + assistant` 两轮；滚动容器又固定保留 42px 顶部 padding，折叠入口自身再加 4px，按钮距顶部明显悬空。
- 修复：`selectInitialChatTail` 增加可选轮次边界，ChatThread 以 `user_message` 为轮次起点，在 28 项普通窗口内向前补足最近 5 轮；普通滚轮仍不扩容。存在折叠入口时滚动区顶部 padding 改为 10px，保留按钮自身 4px 呼吸空间；无折叠入口及长程任务布局保持原值。版本升至 v2.16.56。
- 验证：定向 2 文件 22 项、全量 104 文件 864 项和严格类型检查通过；生产构建通过，renderer 为 `assets/index-Dki-dToo.js`；OKF 严格校验通过（10 概念、18 Markdown、246 链接）。正式构建 DOM 实测初始挂载 10 项，滚动区顶部 padding 10px，滚到顶部后按钮距可视区顶边 14px、按钮高 34px。
- 关键文件：`src/utils/chatTailWindow.ts`、`src/components/chat/ChatThread.tsx`、`src/utils/__tests__/chatTailWindow.test.ts`。
- 下一步：全量回归、知识校验并提交；用户截图验收五轮刻度密度和按钮顶部位置。

## 2026-07-19 v2.16.55 稳定快照消息跨轮合并根治

- 当前目标：根治重启最新版本后仍把多轮 Agent 回复塞进同一条消息的问题；本轮不改动已稳定的滚动链路。
- 根因证据：正式 v2.16.54 重启后，目标会话本地 cache v7 有 152 个事件、Assistant 正文共 36204 字符；污染行 `kimi-code-event-1784419270510-4` 持有稳定官方身份 `msg_session_8723c487-47bf-4bc6-95a6-8ca7d3063fa6_000048`，本地正文长 13782 字符，而官方同一稳定身份只有 50 字符。官方历史共 140 个事件且正确分轮，DOM 确实含跨轮旧回复，排除截图误判和旧安装包。`diag.log` 同时记录 `assistant-body-regression`（local 36204 / canonical 22422），说明 v2.16.54 只补了迁移门禁，没有阻止污染继续产生。
- 根因：`useEventStream` 每 80ms 批量刷新时，会在进入主时间线前预合并相邻未完成 Assistant；该门禁只比较 room/turn/agent/model，没有比较 `snapshotMessageId`，所以同批回放的多个不同官方消息先被压成一条并继承第一条稳定 ID。随后 `mergeEvents` 对“尚未挂载的稳定 ID”仍会落入“最近未完成 Assistant”通用兜底；当官方窗口缺少原始 user 边界时，第二次把不同稳定消息吸入同一行。
- 修复：批处理仅允许无快照身份的实时 delta 互并，或相同 ID 且稳定性一致的快照片段互并；`mergeEvents` 将未见过的稳定 ID 视为独立不可变官方消息，禁止进入通用 open-Assistant 兜底。缓存版本升至 9；迁移优先按同一稳定 ID 对照官方正文。正式启动可能在 Server 就绪前回退到无 ID 的 SDK/wire 历史，因此另加保守证明：仅当本地同一用户轮次有多条 Assistant、至少一条持有稳定 ID，且聚合正文 80% 以上由多个不同 canonical 用户轮次的完整、不歧义、互不重叠回复构成时，才允许较短 canonical 绕过 no-shrink 门禁。
- 验证：四个精确回归覆盖不同稳定 ID 同批不得预合并、无 user 边界的两个未见稳定 ID 不得合并、同 ID 正文膨胀迁移、正式启动无 ID fallback 迁移；定向 4 文件 146 项、全量 104 文件 863 项通过；`pnpm build` 通过，renderer 为 `assets/index-B1xylDP9.js`；OKF 严格校验通过。正式 `file://` origin 实测从 cache v7 / 152 事件 / Assistant 36204 字符迁移为 cache v9 / 150 事件 / 22422 字符，13782 字符污染行消失，DOM 不含跨轮旧回复；完整关闭并第二次重启后上述数值和干净 DOM 保持不变。已确认源码 dev 与正式构建使用不同 IndexedDB origin，最终验收只采用正式 origin。
- 关键文件：`src/hooks/useEventStream.ts`、`src/utils/eventMapper.ts`、`src/utils/kimiHistoryReconciliation.ts`、`src/utils/kimiHistoryCache.ts`。
- 下一步：提交本轮；用户在当前 v2.16.55 正式窗口进行视觉复验，并新发一轮消息确认生产入口不再产生跨 ID 合并。

## 2026-07-19 v2.16.54 多行跨轮回复合并根治

- 当前目标：根治多个旧 Agent 回复被并入当前一轮的严重回归，同时保留 v2.16.53 已稳定的首会话滚动行为。
- 根因证据：目标官方会话与重载后的 store 均为 82 条正确分轮事件，当前官方 Assistant 正文不含截图中的旧回复；`diag.log` 在 10:03 明确记录 `assistant-body-regression`，本地 36204 字符、canonical 22422 字符，证明旧 v7 门禁拒绝了正确的较短官方历史。污染形态是同一用户边界内存在多个无稳定身份的 Assistant 行，渲染层按边界合成一条；v7 只检查单行，未识别跨行组合。更底层的问题是 canonical 候选尚未被调用方采用，`reconcileAgentCanonicalHistory` 就把缓存标为当前版本，使污染缓存失去下次启动自愈机会。
- 修复：跨轮组合证明改为聚合一个用户轮次内的全部 Assistant 正文，再要求当前轮和外轮的稳定官方完整回复具有不重叠区间并覆盖至少 80%；单行与多行污染共用同一保守规则。缓存版本升至 8；canonical reconciliation 只构造候选，只有入口明确采用 canonical，或成功加载的官方快照与本地“用户边界 + 聚合 Assistant 正文”逐轮完全等价时，才标记当前版本；真正拒绝候选时保留旧版本并在下次入口继续重试。未改动滚动链路。
- 验证：新增三类先失败后通过的回归：多 Assistant 行跨轮组合修复、未采用候选不升级缓存、逐轮等价与跨边界不等价判定；定向 3 文件 52 项、全量 104 文件 859 项通过；`pnpm build` 通过，renderer 为 `assets/index-CrEyTWyq.js`。CDP 对目标会话核验本地/官方均为 82 事件、13 个用户轮次，逐轮投影完全等价且首个差异为 -1；干净重启后 session 与 primary Agent 均从 cache v7 升到 v8，当前边界只有 `user_message + assistant_message`、Assistant 数量 1、正文 184 字符，未包含已知旧轮回复。
- 阻塞：无；代码与数据链路已验证，视觉最终验收仍由用户在 v2.16.54 窗口确认。
- 关键文件：`src/utils/kimiHistoryReconciliation.ts`、`src/utils/collaborationHistory.ts`、`src/App.tsx`、`src/components/layout/Sidebar.tsx`、`src/utils/kimiHistoryCache.ts`。
- 下一步：完成知识校验并提交；用户在已启动的 v2.16.54 窗口复验原截图位置及新发一轮消息。

## 2026-07-19 v2.16.53 跨轮缓存污染与首会话轻滚大跳

- 当前目标：根治旧回复被塞进新一轮，以及首个自动打开会话轻滚即大幅上跳。
- 根因证据：目标会话官方历史与完成加载后的 store 均为 82 条正确分轮事件，但旧 v6 缓存可绕过官方重载，且无稳定 ID 的污染行会被“本地正文更长”门禁保留；硬重载另复现 loading 占位期间滚动 ref 为 null 却提前 primed，加载完成后真实 viewport 不重跑初始化。首屏规则还把第一次向上滚动与隐藏历史扩容绑定，单次手势同时改变 `scrollTop` 和 DOM 高度。
- 修复：缓存版本升至 7；仅当稳定官方回复跨两个用户轮次、匹配区间互不重叠且覆盖污染行至少 80% 时允许较短 canonical 修复。视口增加 readiness 边界，真实节点挂载后才 primed/接 ResizeObserver；初始 4–12 项尾部保持稳定，普通滚轮不再触发历史扩容，完整历史只由显式展开或导航挂载。
- 验证：定向回归 3 文件 45 项、全量 104 文件 854 项通过；typecheck、生产构建（renderer `assets/index-B4unjDul.js`）与 OKF 校验通过。CDP 硬重载后缓存版本为 7，首会话 `bottomGap=0`、仅挂载 4 项；真实 `deltaY=-40` 后 `scrollDelta=-40`、`heightDelta=0`、仍为 4 项。
- 阻塞：无；等待用户 v2.16.53 截图验收。
- 关键文件：`src/utils/kimiHistoryReconciliation.ts`、`src/utils/kimiHistoryCache.ts`、`src/components/chat/ChatThread.tsx`、`src/hooks/useChatViewport.ts`。
- 下一步：用户重点复验原目标会话、首次轻滚，以及折叠历史/搜索导航的显式展开。

## 2026-07-17 回放乱序与损坏会话重建（一次性）

- 当前目标：根治会话显示错乱——snapshot 回放把旧轮事件追加到 events 数组末尾，渲染按数组顺序分组把旧轮 assistant 错配进最新轮拼接显示；叠加历史 mergeEvents 跨轮合并，该会话多轮回复被拼进单个 assistant。
- 根因：reconcile/回放合并只做尾部 append，不维护 events 时间序；renderItems 分轮依赖数组顺序而非时间戳。数据修复删除单条污染 placeholder 不足以解决（乱序 + 拼接仍在）。
- 修复：`reconcileRunningKimiSnapshot` 合并后按 timestamp 稳定排序（已有序时间线不受影响），运行中乱序根治；旧轮 assistant 不合并 placeholder、已完成包含即跳过（前次）。数据侧：清空该会话本地 events，经恢复路径从 Server 拉取官方干净历史重建（官方快照实证无错乱）。
- 验证：新增排序回归（回放旧轮回到时间序位置）；typecheck 通过。
- 阻塞：无；不推送、不打 tag、不发布。等待用户实机验收该会话重建后显示正确。
- 关键文件：`src/utils/kimiCodeSnapshotReplay.ts`。
- 下一步：用户验收；临时渲染探针已在后续 Review 修复中移除。

## 2026-07-17 轮次内容混入（回放跨轮合并 placeholder）

- 当前目标：修复会话回复"一轮夹杂多轮"——14:24 轮 placeholder 内容被旧轮回放 assistant 污染成摸底，与官方剧情回复（i=158）被 mergeAssistantProcessEvents 拼成一条显示。
- 根因证据（CDP 直读 IndexedDB）：官方快照干净（14:24 后就是正确剧情回复，无"摸底"）；本地 events 中 14:24 轮有 i=131（placeholder，内容=摸底）与 i=158（剧情）两条 assistant。`mergeEvents` 的 assistant 合并只看"最后一个未完成 assistant"、不查轮次身份，snapshot 回放把旧轮摸底 append 进 placeholder 并标完成，官方剧情只能另立 i=158；上游 i=2 本身已是拼接体（"我先并行读取"+"已完成项目快速摸底"），导致 alreadyMounted 同文检查失效。
- 修复：`reconcileRunningKimiSnapshot` 对早于当前轮的 assistant 不走 mergeEvents 合并、直接独立追加；alreadyMounted 对已完成 assistant 增加"本地内容已包含 canonical 干净版即跳过"。数据修复：CDP 删除被污染的 i=131（保留 i=158 剧情）。
- 验证：新增 2 项回归（旧轮不合并到 placeholder/包含即跳过）；全量 103 文件 824 项通过；typecheck 通过。
- 阻塞：无；不推送、不打 tag、不发布。等待用户实机复验该会话 14:24 轮只剩剧情回复。
- 关键文件：`src/utils/kimiCodeSnapshotReplay.ts`。
- 下一步：用户复验；临时渲染探针已在后续 Review 修复中移除。

## 2026-07-17 会话回复被重复 user 消息淹没（snapshot 回放去重）

- 当前目标：修复会话（session_8723c487）agent 回复全部"消失"——实际是被 66 条重复 user 消息挤出 28 项渲染窗口（官方仅 16 条 user）。
- 根因证据（CDP 直读 IndexedDB）：snapshot 历史回放的 user 消息 id 是确定性的（`snapshot:<messageId>:user:<n>`），但 `reconcileRunningKimiSnapshot.alreadyMounted` 对 user_message 恒返回 false、`mergeEvents` 的 user 去重只看"最后一条 user 的 10 秒窗口"；历史回放按时间顺序到来时任意相邻两条 user 都间隔 >10s，于是**每次回放把全部历史 user 复制一遍**。该会话回放 4 次 → 52 条重复 user 淹没窗口，assistant 被挤出可视区；重启后渲染高度 16944px→5122px。
- 修复三层：(1) `reconcileRunningKimiSnapshot.alreadyMounted` 对 user_message 按稳定 id 与"同内容+10s"跳过；(2) `mergeEvents` user 分支加全局稳定 id 查重；(3) 新增 `deduplicateTimelineEvents`（同 id 去重 + user 同内容近时保留身份更全副本），`loadLocalSessions` 启动时幂等清理已损坏历史（含 collaboration.agentEvents）。
- 验证：新增 5 项回归（重复回放不追加/本地乐观 user 不重复/id 查重/损坏历史清理/幂等）；typecheck 通过；全量回归见提交记录。
- 阻塞：无；不推送、不打 tag、不发布。等待用户实机复验该会话回复恢复、不再新增重复。
- 关键文件：`src/utils/kimiCodeSnapshotReplay.ts`、`src/utils/eventMapper.ts`、`src/utils/persistence.ts`。
- 下一步：用户复验；与 busy/视口修复一并提交。

## 2026-07-17 视口跳动与启动不置底（overflow-anchor 条件化）

- 当前目标：修复 v2.16.46 起两个视口回归——(1) 启动进入会话停在中间而非底部；(2) 流式期间视口反复上跳、点击置底按钮后仍跳。
- 根因：f7b5d13c 为防止 detached 模式下 Chromium 隐式锚定与 Kimix 显式锚定竞争，在 `.kimix-chat-scroll-area` **全局**设置 `overflow-anchor: none`。但同一提交的 issue 快照不变量只要求 "While detached" 禁用——实现过度。跟随模式下原生锚定本是"上方内容异步撑开时保持视口"的第一道防线（kimix.md 旧不变量），全局禁用后每次流式 reflow 都先漂移再由 ResizeObserver 事后纠正，视觉即"一跳一跳"；启动时异步内容（图片/高亮/Markdown settle）撑开后 scrollTop 停在原位即"悬在中间"。
- 修复：overflow-anchor 按模式条件化——跟随模式恢复原生锚定，仅 detached 模式禁用。`useAutoFollow.updateAutoFollow`（isAutoFollowRef 唯一写入点）同步响应式 `isFollowing` state；会话切换重置同步置 true；ChatThread 滚动容器在非跟随时加 `--detached` class。
- 验证：新增 useChatViewport 响应式跟随状态回归（pause/resume/会话切换）；全量 103 文件 816 项通过；typecheck 通过。
- 阻塞：无；不推送、不打 tag、不发布。等待用户实机复验启动置底与流式不跳。
- 关键文件：`src/index.css`、`src/hooks/useChatViewport.ts`、`src/hooks/useChatViewport/useAutoFollow.ts`、`src/components/chat/ChatThread.tsx`。
- 下一步：用户复验；临时渲染探针已在后续 Review 修复中移除，视口锚定不变量已按条件化结果同步。

## 2026-07-17 运行中闪"输出完成"根治（v2 busy 权威信号）

- 当前目标：根治 v2.16.46 后仍偶发的"闪过一下输出完成"（头部与底部"已连接"同闪后自行恢复）。
- 根因证据：agent-core-v2 的 `/api/v1/sessions/{id}/status` 只返回 `busy`（整个 prompt 期间含 step 间隙保持 true），**没有 `status` 字符串字段**（vendor/kimi-code-sdk SessionService.getStatus 实读确认）；Kimix `mapServerStatus(undefined)` 兜底返回 "idle"，于是 (1) `reconcileAgentRuntime` 轮询把 step 间隙运行中会话误判为终态，连续两次即 `settleTerminalRoomAgent` + 清 `runningSessionId`；(2) `prompt()` 180s 空闲判活的 `status.status === "running"` 恒 false，误走"已结束"快照收口。两条路径同源。
- 修复：`resolveServerEngineStatus`（busy=true 一律 running，缺失时回退 v1 status 字符串）统一替换 register/snapshot/getStatus 三处映射；`prompt()` 判活加 `busy === true` 分支。`ServerSession`/`ServerSessionStatus` 类型补 `busy`。
- 验证：新增 resolveServerEngineStatus 三组回归（busy 优先/真结束/旧兼容）；typecheck 通过；全量回归见本行更新时的测试输出。
- 阻塞：无；不推送、不打 tag、不发布。等待用户实机复验"不再闪输出完成"。
- 关键文件：`electron/kimiCodeHost.ts`、`electron/kimiCodeServerClient.ts`、`src/utils/__tests__/kimiCodeServerHost.test.ts`。
- 下一步：用户复验；`footerRenderDivergence` 临时探针已在后续 Review 修复中移除。

## 2026-07-17 提前"输出完成"与消息头消失根治（渲染派生层）

- 当前目标：根治两个多轮未修复的问题——(1) 发送后到 k3 思考中之间消息头消失；(2) 运行中头部提前显示"输出完成"而底部仍"运行中"。
- 根因证据（diag.log + 代码）：事件流层干净——`stream.flush.openAssistantChanged` 全程只有 `0→1`(116) 与真实轮末 `1→0`(3)，未完成助手数运行期间稳定为 1；`reconcile.runningSample.applied` 0 次，排除历史采样替换路径。真正根因在 `buildRenderItems` 渲染派生层：头部用 turn 级 `turnSettled`（依赖 per-event `isComplete` + `activeRoomAgentTurn` 精确 turn-id 匹配），底部用 session 级 `hasActiveTurn`，两套真相源背离。agent-core-v2 一轮内会先提交带内容的 `isComplete:true` 完成分步（`step.end` finishReason=end_turn），使 `hasCompletedAssistantOutput=true` → `!hasCompletedAssistantOutput` 门槛把 `isRuntimeAwaitingTurnOutput` 打成 false → `isTurnActive` 只剩 `activeRoomAgentTurn` 兜底；而事件回填的 `agentTurnId` 来自 activity `activeTurnId`，在 status 转换 `previous` 丢失时变 undefined，精确匹配失败 → `isTurnActive=false`：有内容则 `turnSettled=true` 提前"输出完成"(P2)，无内容则 pending 头也不生成、消息头消失(P1)。之前多轮补在快照回放/历史对账层，补错了层。
- 修复：`isRuntimeAwaitingTurnOutput` 的 `!hasCompletedAssistantOutput` 门槛仅对遗留非房间轮次保留；房间轮次（现全部真实场景）改为 `Boolean(roomAgentId) || !hasCompletedAssistantOutput`。安全前提已核实：Composer 发送路径 user_message 先于 `setRunningSessionId` 写入，`isLatestTurn && isSessionRunning` 无歧义指向运行中那一轮；终态处理器同 tick 清 `runningSessionId` 且置 activity 终态，轮次在真实结束点才 settle。单处修复同时解决 P1/P2。
- 验证：v2.16.44；定向 `chatRenderItems.test.ts` 35 项通过（新增 2 项精确复现 P1/P2）；严格类型检查通过；全量 103 个测试文件、813 项通过；OKF 严格校验通过（10 概念、18 Markdown、228 链接）；生产构建通过，renderer 为 `assets/index-B0QiYBan.js`。已还原上一轮遗留的 useEventStream/App.tsx 诊断脚手架。
- 阻塞：无；不推送、不打 tag、不发布。等待用户实机截图验收。
- 关键文件：`src/components/chat/ChatThread.tsx`、`src/utils/__tests__/chatRenderItems.test.ts`。
- 下一步：用户在真实长工具链复验——发送后消息头不再消失、运行中头部不再提前"输出完成"、真实结束时才显示完成。

## 2026-07-17 运行中假完成、过程折叠与消息闪断专项

- 当前目标：修复 Kimi Web 会话仍在运行时错误显示“输出完成”、用户手动展开的思考/命令被自动折叠、Agent 消息头瞬间消失再出现，以及旧过程内容在运行中暂时丢失的问题。
- 根因证据：官方 Server 同一轮直到真实 `turn.ended` 前始终运行；Kimix UI 却在历史快照回放期间反复关闭并重开未完成 Assistant。历史快照合成终态的批内可见性竞态是主因；无条件最终正文自动折叠和不稳定的合并 Assistant 渲染 ID 分别放大了折叠、闪烁与状态丢失。
- 待办与执行顺序：
  1. [已完成] 会话运行期间忽略历史快照合成的 `turn.ended` / `TurnEnd`，保留真实实时终态的唯一完成权，并补非空运行中 Assistant 回归测试。
  2. [已完成] 区分默认展开与用户手动展开，最终正文开始时不得覆盖用户显式展开意图，并补状态判断测试。
  3. [已完成] 稳定同一轮合并 Assistant 的渲染 ID，避免流式追加导致 React 重挂载，并补渲染身份回归测试。
  4. [已完成] 运行三组定向测试、严格类型检查、知识库校验和组合回归；等待用户实机会话验收。
- 验证：v2.16.33；三项定向回归 3 个测试文件、44 项通过；全量 101 个测试文件、784 项通过；版本读取测试 2 项通过；严格类型检查通过；OKF 严格校验通过（10 个概念、18 个 Markdown、216 条链接）；生产构建通过，renderer 为 `assets/index-5DbRpzMR.js`。
- 阻塞：无；不推送、不打 tag、不发布。当前工作树另有导航轨道与诊断改动，本专项必须按文件/补丁精确提交，不得混入。
- 关键文件：`src/utils/kimiCodeSnapshotReplay.ts`、`src/App.tsx`、`src/components/chat/MessageBubble.tsx`、`src/utils/liveThinkingViewport.ts`、`src/components/chat/ChatThread.tsx`。
- 下一步：用户在真实长工具链中复验运行期间不再提前显示完成、显式展开不被收起、消息头不闪断且旧过程持续可见。

## 2026-07-16 Kimi Code 0.24–0.26 跟进（v2 引擎断代修复）

- 当前目标：补齐 0.23.5→0.26.0 的上游评审，修复 Server v2 引擎切换造成的生产断代。
- 已完成：四项 P0 断代修复并实测——(1) WS 鉴权改 `kimi-code.bearer` 子协议（保留 `?token=` 兼容旧 v1）；(2) `createSession` 后经 profile 端点重放 agent_config（v2 create 静默丢弃，首轮必 `model.not_configured`）；(3) Host 能力探测携带 server token（v2 全量 `/api/*` 与 meta 文档强制鉴权）；(4) Host 单例锁感知启动（活实例直连 attach、Windows 死 pid 清锁后 spawn）并修复 `stop()` 空指针。vendored SDK 重新打包到 0.26.0（node-sdk 0.13.4，commit `36b05820`）。设置页"按需工具"徽章兼容 `dynamically_loaded_tools` 新能力名。
- 验证：主探针 6 通过/0 失败/4 跳过（`docs/kimi-code-server-probe-result.md`）；子代理/工具事件探针 10/10（`docs/kimi-code-0.26-subagent-probe.md`）；Host 锁两路径实测通过；`pnpm typecheck` 通过；全量 vitest 101 文件 777 项通过；宿主冒烟与会话导出探针通过。
- 未完成：用户视觉/功能验收（重点是 Server 路由端到端聊天）；0.25.0 任意文件附件仅记录为功能候选（`docs/kimi-code-0.24-0.26-followup.md` 遗留项）。
- 阻塞：无；不推送、不打 tag、不发布。
- 关键文件：`electron/kimiCodeServerClient.ts`、`electron/kimiCodeServerHost.ts`、`vendor/kimi-code-sdk/`、`scripts/probe-kimi-code-server.mjs`、`scripts/probe-kimi-code-server-subagent.mjs`。
- 下一步：提交本轮；用户验收 Server 路由聊天、审批/问题卡片与后台任务面板。

## 2026-07-16 对话导航轨道悬停预览

- 当前目标：在已验收并提交的导航轨道上增加悬停消息预览，强化当前位置层级、优化连续扫动跟手性，并保证刻度位置、密度与实际消息导航一致。
- 已完成：第一阶段提交为 `b3644fc`，悬停预览与密度收口提交为 `08ec3cd`。预览摘要直接从 `RenderItem` 生成有界纯文本；首次悬停为 110ms，连续切换为 16ms，离开关闭为 90ms。非当前位置刻度为 24% 不透明度，悬停为 62%，键盘焦点为 86%；只有当前位置保持 100% 身份色和高亮光圈。中间区域使用视口垂直中线判定当前位置；考虑浏览器在首尾限制滚动坐标，使用 3px 物理边界门槛。刻度与左侧边界约保留 14px，轨道相对初版向左移动 6px；刻度节距最大 14px、最小 6px，在视口上下各保留 24px 后按刻度数量自适应压缩，刻度组仍保持垂直居中。
- 验证：v2.16.35 定向 2 个测试文件 11 项、严格类型检查和生产构建通过，renderer 为 `assets/index-CiTqwGG3.js`。
- 未完成：用户视觉验收。
- 阻塞：无；不推送、不打 tag、不发布。
- 关键文件：`src/components/chat/ChatNavigationRail.tsx`、`src/components/chat/ChatNavigationPreview.tsx`、`src/utils/chatNavigation.ts`、`src/index.css`。
- 下一步：用户在 v2.16.35 重点验收左侧边界增加 2px 后的距离、悬停预览跟手性，以及到顶、到底和中间点击后的当前刻度。

## 2026-07-16 对话导航轨道第一阶段

- 当前目标：稳定接入截图所示的对话语义导航轨道，当前按用户反馈使用固定节距、统一宽度、用户蓝色与 Agent 黑色，并让 Agent 节点跳转后以消息头部对齐视口垂直中线；不引入悬停预览、完整历史估算或键盘快捷键。
- 已完成：轨道以当前已渲染的语义 `RenderItem` 为节点，过滤高频状态和不可见事件；刻度改为固定 14px 垂直节距，导航组高度仅由节点数量决定，并作为整体在聊天视口垂直居中，不再拉伸占满上下空间。刻度统一宽度，用户节点使用主题蓝色，Agent 及工具/变更/系统过程节点使用主题主文字色（浅色主题呈黑色），当前项只调整透明度/光圈而不改变宽度；每个固定节距同时作为独立点击分区。轨道点击继续复用 `focusTimelineEvent`，`start-center` 对齐模式使 Agent 卡片头部落在视口垂直中线；用户消息保留整块居中。
- 验证：v2.16.18 定向 3 个测试文件 18 项、严格类型检查、知识校验与 `git diff --check` 通过；清缓存生产构建通过，renderer 为 `assets/index-D_0h4hsR.js`，新构建已启动。功能代码沿用 v2.16.16 已通过的全量 101 个测试文件 772 项结果。
- 未完成：第一阶段已通过用户视觉验收；悬停摘要、更早历史聚合点、上下轮次按钮与快捷键留在后续阶段。
- 阻塞：无；不推送、不打 tag、不发布。
- 关键文件：`src/components/chat/ChatThread.tsx`、`src/components/chat/ChatNavigationRail.tsx`、`src/utils/chatNavigation.ts`、`src/hooks/useChatViewport/useEventFocus.ts`。
- 下一步：提交已验收的第一阶段；随后实现刻度悬停消息预览，继续沿用固定 14px 节距和现有点击跳转行为。

## 2026-07-16 提交审查问题修复与优化

- 当前目标：按 `a33dc2a..eca6c2ed` 全量 Review 结论，依次修复功能回归、消息流性能与诊断隐私问题，并收敛低优先级代码质量风险。
- 已完成：11 项全部完成并分别提交，提交范围为 `ac1a4a1c..ec42a4ee`。最终门禁通过：`pnpm typecheck` 通过；全量 100 个测试文件、767 项测试通过；`pnpm build` 通过，renderer 为 `assets/index-D_XlEPft.js`；`pnpm knowledge:validate` 通过（10 个概念、18 个 Markdown、209 条链接）；`git diff --check eca6c2ed..HEAD` 通过。长程任务单 runtime 边界已核实并写入知识库，旧 distinct reviewer 分支仅保留读取与收尾兼容。
- 待办与执行顺序：
  1. [已完成] 修复 `scripts/dev.cjs` 向 electron-vite 传参方式，并增加真实 CLI 链回归测试。
  2. [已完成] 将子代理正文提升诊断移出渲染热路径，按 turn 去重/节流；主进程诊断落盘改为异步串行队列，避免同步 I/O 阻塞。
  3. [已完成] 诊断日志默认脱敏：不记录 Assistant 正文片段、完整事件正文、工具结果、文件路径或图片 base64；完整快照改为显式诊断开关。
  4. [已完成] 修复通知切换到其他会话时 pending timeline focus 被 session reset 清空，并补跨会话通知聚焦测试。
  5. [已完成] 修正 canonical thinking 纠错策略：允许更短但结构正确的官方 thinking 替换重复/损坏的本地 thinking，同时保留过程历史防倒退门禁。
  6. [已完成] 修正子代理 eventId 冲突检测，区分真正身份冲突与工具状态/结果的合法演进，并补工具生命周期测试。
  7. [已完成] 加固 `contentVersion`：覆盖同长度正文纠正、`thinkingParts` 和非末项活动内容变化，同时保持常量级或受控计算成本。
  8. [已完成] 将 `RenderItem` 与缓存类型移出 `ChatThread` 组件模块，消除 Hook 到组件模块的类型边界倒置。
  9. [已完成] 房间投递身份诊断面板在会话或数据集变化时清理无效筛选，避免新会话误显示空列表。
  10. [已完成] 清理 `eventMapper.test.ts` 的整文件行尾/尾随空白噪声，恢复可读 diff 与 blame。
  11. [已完成] 核实长程任务 reviewer 双运行时流程是否正式废弃；确认新任务为单 runtime，保留旧任务读取/收尾兼容并记录稳定知识。
- 未完成：仅剩用户实机验收，不存在未提交代码。
- 阻塞：无；不推送、不打 tag、不发布。
- 关键文件：`scripts/dev.cjs`、`scripts/restart-kimix-dev.ps1`、`src/utils/chatRenderItems.ts`、`src/utils/reportError.ts`、`electron/main.ts`、`src/hooks/useChatViewport/useEventFocus.ts`、`src/utils/kimiHistoryReconciliation.ts`、`src/utils/eventMapper.ts`、`src/components/chat/ChatThread.tsx`。
- 下一步：用户重点复验 `--dev` 热更新启动、子代理长流式输出卡顿、跨会话通知定位、较短官方 thinking 纠错和子代理工具终态显示。

## 2026-07-15 Web 模式单轮长消息流性能改造

- 当前目标：对齐官方 Kimi Web 的消息流关键优化，解决单轮 Assistant 正文持续增长时卡顿随内容长度明显放大的问题。
- 对比结论：Kimix 已有 80ms 流事件批处理，主要瓶颈不是事件频率，而是批次内逐事件合并、完整时间线重复派生、运行中正文重复规范化、`react-markdown` 全文重解析，以及 `contentVersion`、`ResizeObserver`、`MutationObserver` 叠加触发布局跟随。官方 Web 使用稳定 `LiveMessage`、Streamdown 分块 Markdown 和 `react-virtuoso`；其中分块 Markdown 是单轮长消息的首要差异，虚拟列表主要改善长历史。
- 已完成：完成 Kimix 与官方仓库 `MoonshotAI/kimi-cli@ded99b4` 的静态代码对比，确认官方 `ContentPart` 同样近似逐事件更新，但 Streamdown 会将流式 Markdown 切成稳定块，只重解析增长中的尾块。阶段 1 已在 v2.16.10 落地：运行中 Assistant 使用 `marked` Lexer 切分顶层 Markdown 块，各块继续复用现有 `ReactMarkdown`，已完成块由 memo 保持稳定、只让尾块随流更新；完成态仍走原渲染路径。直接引入 Streamdown 曾导致 137 个额外包及大量 Shiki/Mermaid chunk，已撤回并改为单依赖 `marked@16.2.1`。阶段 2 已在 v2.16.11 落地：Assistant 段落/表格/围栏修复统一移入 `MarkdownRenderer`，正文不再先后规范化两次；`.md` 文件卡片全文正则只在消息完成后运行。阶段 3 已在 v2.16.12 落地：同一 80ms 批次内、相同 Agent/turn/投递身份的相邻未完成正文与思考 delta 先在小数组中合并，再只对完整 Session 时间线执行一次 `mergeEvents`；终态、工具边界和不同 turn 保持独立。阶段 4 已在 v2.16.13 落地：已完成 turn 的派生 `RenderItem` 按 turn 身份缓存，以原始事件对象引用判断命中，不序列化长正文；活动 turn 继续实时重建，历史 Assistant 对象引用保持稳定。阶段 5 已在 v2.16.14 落地：移除常驻 MutationObserver，统一由 ResizeObserver 响应内容/视口几何变化并执行自动跟底；`contentVersion` 改为常量时间元数据签名，不再扫描完整时间线，相关 layout effect 只保留手动浏览锚点恢复。阶段 6 已完成评估：当前初始窗口仅 4–12 项、普通上限 28 项，消息级虚拟化无法降低单条超长 Assistant 内部 DOM，且会大范围耦合搜索定位、历史展开、思考折叠补偿与手动锚点，因此不在本问题中引入；保留为长历史性能数据证明 DOM 项数仍是瓶颈后的独立项目。严格类型检查、91 个测试文件 678 项、生产构建和知识校验通过，最终 renderer 为 `assets/index-BkNOvlXC.js`。
- 待办与执行顺序：
  1. 为运行中的 Assistant 接入分块流式 Markdown 渲染，并保留完成态现有渲染作为首阶段回滚边界。
  2. 消除 `MessageBubble` 与 `MarkdownRenderer` 的重复正文规范化，将 `.md` 文件提取等非实时全文扫描延迟到消息完成后。
  3. 在 80ms flush 内合并连续正文/思考增量，减少 `mergeEvents` 的完整数组扫描与复制次数。
  4. 缓存已完成轮次的 `RenderItem`，只重建活动轮并保持历史 Assistant 对象引用稳定。
  5. 收敛 `contentVersion`、`ResizeObserver`、`MutationObserver` 的重复滚动与尺寸测量职责。
  6. 评估并接入消息列表虚拟化；明确它主要解决长历史，不作为单轮长正文的首要修复。
- 未完成：代码阶段已结束；等待用户用真实单轮长回复观察流畅度、完成瞬间样式切换和自动跟底稳定性，并决定是否补充 Chrome Performance trace。
- 阻塞：无；不推送、不打 tag、不发布。新增依赖必须说明理由与回滚方式。
- 关键文件：`src/hooks/useEventStream.ts`、`src/utils/eventMapper.ts`、`src/components/chat/ChatThread.tsx`、`src/components/chat/MessageBubble.tsx`、`src/components/chat/MarkdownRenderer.tsx`。
- 下一步：提交阶段 6 评估记录；用户用 v2.16.14 复测同一类长消息，若仍明显卡顿则采集 renderer Performance trace，按脚本/布局/绘制占比决定下一最小增量。

## 2026-07-15 v2.16.9 运行中提前完成与过程历史丢失

- 当前目标：修复长工具链仍在运行时 Assistant 错误显示“输出完成”，以及运行中只剩最新思考/工具、旧过程突然消失的问题。
- 根因：真实会话 `session_57482f3b-a5e8-4f10-830d-765e27f4f0f7` 的 wire 在同一 turn 内连续产生 `step.end(finishReason=tool_use)`；本地历史解析却把所有 `step.end` 都映射成整轮 `TurnEnd`。同时，4 秒静默期 Server snapshot 不包含完整工具调用，但 canonical 对账允许它仅因最新 thinking 不同覆盖本地更丰富时间线。
- 已完成：只有 `end_turn` 才映射终态；canonical 过程事件数量少于本地时禁止破坏性替换；最新 runtime 活跃回合在渲染层强制保持未完成；工具-only 活跃回合同样不提前完成。版本号三处同步至 v2.16.9，并补充 wire 终态、过程倒退和运行中渲染回归测试。`pnpm typecheck` 通过；全量测试 89 个文件、673 项通过；`pnpm build` 通过，renderer 为 `assets/index-D_SuSWbp.js`；`pnpm knowledge:validate` 通过（9 个概念、17 个 Markdown、197 条链接）。
- 未完成：等待用户真实长工具链复验。
- 阻塞：无；不推送、不打 tag、不发布。
- 关键文件：`electron/sessionHistory.ts`、`src/App.tsx`、`src/utils/kimiHistoryCache.ts`、`src/components/chat/ChatThread.tsx`、`src/utils/chatRenderItems.ts`、`docs/issue-empty-assistant-after-tool-use.md`。
- 下一步：完成门禁并启动 v2.16.9；用户复测连续多工具场景，确认运行中不再显示完成且旧过程持续保留。

## 2026-07-15 v2.16.8 子代理正文提升到主时间线

- 当前目标：修复"工具调用/子代理完成后，助手没有输出正文"的问题。
- 根因：Kimi 已经生成了正文，但这段 `assistant_message` 被挂到了子代理的 `events` 里，主时间线没有独立的 contentful `assistant_message`。`ChatThread.tsx` 渲染时走到 `createSubagentOnlyAssistantEvent`，生成空的占位卡片，导致用户看不到实际输出；重新打开软件后官方历史/投影把正文归位到主时间线，正文才显示出来。
- 已完成：在 `src/utils/chatRenderItems.ts` 的 `createSubagentOnlyAssistantEvent` 中，遍历子代理 `events` 里的 `assistant_message`，把 content 和 thinking 提升到主时间线的占位卡片里。新增 `src/utils/__tests__/chatRenderItems.test.ts`，覆盖空子代理、单条正文、多条正文、thinking、运行中子代理等场景。回滚了之前错误的自动继续兜底（已删除 `src/utils/autoContinue.ts` 及其测试，并还原 `src/App.tsx` 改动）。版本号保持 v2.16.8。`pnpm typecheck` 通过；全量测试 89 个文件、642 项通过；`pnpm build` 通过，renderer 为 `assets/index-CpTI7uaH.js`；`pnpm knowledge:validate` 通过。
- 未完成：未在真实场景中验证主时间线为空时子代理 events 是否确实包含正文；未抓取问题发生时的 `events` 数组快照确认根因；未验证多子代理同时有内容时的拼接效果。
- 阻塞：无外部阻塞。下一步依赖用户在真实场景复测，确认工具/子代理完成后正文是否直接显示。
- 关键文件：`src/utils/chatRenderItems.ts`、`src/utils/__tests__/chatRenderItems.test.ts`、`src/components/chat/ChatThread.tsx`、`docs/issue-empty-assistant-after-tool-use.md`。
- 下一步：用户在 v2.16.8 复测相同提示词与工具链，确认工具/子代理完成后主时间线直接显示正文；若仍复现，抓取当前会话的 `events` 数组和主进程 SSE 日志进一步分析。本轮不推送、不打 tag、不发布。

## 2026-07-15 v2.16.7 renderer 重载启动恢复

- 当前目标：根治 Electron renderer 重载后侧栏已有项目和会话、主区却永久停在“正在准备默认项目”的启动握手断层。
- 根因：主进程只用一次性 `did-finish-load` 发送 bootstrap；完整重载会重建 renderer 与 preload、清空 replay 缓存，但主进程不再发送。单实例 BAT 再次启动只激活旧窗口，因此开发热重载后的坏状态会被直接带回前台。
- 已完成：bootstrap 监听改为在页面加载前注册，并对每个 renderer 文档重复发布；默认项目迁移/目录准备只在 bootstrap 已发送后按应用生命周期延后执行一次，Windows 下仅大小写不同的同一路径不再被误判为迁移源；最近项目写入移到发送之后，按项目身份合并并发写入、成功后跳过重复写盘、失败后允许重试；默认项目解析失败时仍发送安全描述；空白页检查按文档代次取消过期任务。版本号三处同步至 v2.16.7。定向测试 4 个文件、17 项通过；`pnpm typecheck` 通过；全量测试 89 个文件、655 项通过；`pnpm build` 通过，renderer 为 `assets/index-BzZlgYw2.js`；`pnpm knowledge:validate` 通过。最终 v2.16.7 dev 首次加载生成 bootstrap generation 1，并恢复到保存的 Project06 会话 `session_acb48323-ab73-44d8-9640-6304d2466a1f`；随后通过正式 Ctrl+R 路径完整重载，主进程生成 generation 2，renderer 再次恢复同一会话，现场检查确认 v2.16.7、Project06 和原消息流均正常，且重载前后 `projects.json` 的时间戳与 SHA-256 均未变化。
- 未完成：等待用户从 BAT 再次启动或手动重载做最终使用侧验收。
- 阻塞：无；不推送、不打 tag、不发布。
- 关键文件：`electron/main.ts`、`electron/startupBootstrap.ts`、`src/utils/__tests__/startupBootstrapMain.test.ts`、`knowledge/architecture/collaboration-room-routing.md`、`docs/release-notes/v2.16.7.md`。
- 下一步：提交本轮修复；用户确认 v2.16.7 再次启动、Ctrl+R 或开发热重载后不再停在“正在准备默认项目”。

## 2026-07-15 v2.16.6 房间用户消息投递身份根治

- 当前目标：根治多 Agent 房间单次发送在运行中或重启后投影为两条相同用户消息的问题，不再用显示层去重掩盖底层身份丢失。
- 根因：现场官方 `wire.jsonl` 每条只有一次 `turn.prompt`，不是重复发送；旧主会话兼容回写会先删除 primary delivery，再从 legacy events 重建，因而丢失 `dispatchAttemptId` 及事务字段。房间合成消息随后无法认领仍带真实 attempt 的 canonical user event，两者被同时投影。
- 已完成：兼容回写改为按原 room message 增量合并，同一事务保留 attempt、prompt、context share、时间戳、previous attempts 和接收者顺序；显式新事务仅重置 attempt 专属字段并保留审计账本。legacy 新建直接继承事件 attempt；加载时仅按同 Agent 精确 `roomMessageId + agentTurnId` 的唯一、未占用 attempt 修复旧损坏 delivery，冲突数据保持未绑定。时间线与 canonical history 共用事务优先解析，identity-less official ID 仅在 Agent 内唯一时绑定，正文/时间迁移要求消息与事件双向唯一且显式冲突永不降级；事件认领按 Agent 作用域隔离。版本号三处同步至 v2.16.6。定向测试 4 个文件、46 项通过；`pnpm typecheck` 通过；全量测试 88 个文件、646 项通过；`pnpm build` 通过，renderer 为 `assets/index-VWA6NIrc.js`；`pnpm knowledge:validate` 通过。提交 `408575c` 已生成；旧 v2.16.5 dev 进程已按项目进程树关闭，v2.16.6 dev 完成 DOM 加载并保持运行。
- 未完成：等待用户对既有受损会话及新消息做真实回归。
- 阻塞：无；不推送、不打 tag、不发布。
- 关键文件：`src/utils/collaborationRooms.ts`、`src/utils/roomDeliveryIdentity.ts`、`src/utils/collaborationTimeline.ts`、`src/utils/collaborationHistory.ts`、`src/utils/__tests__/persistence.test.ts`、`knowledge/architecture/collaboration-room-routing.md`、`docs/release-notes/v2.16.6.md`。
- 下一步：用户先确认左下角版本为 v2.16.6，再打开目标房间检查旧重复气泡已归一，并连续发送单 Agent、多 Agent 与相同正文消息，确认一次投递只显示一次、两次真实投递仍显示两次。

## 2026-07-15 v2.16.5 思考转正文视口稳定

- 当前目标：修复 Agent 长思考在最终正文出现后收起时，用户手动浏览会话流发生页面上跳。
- 根因：首段正文到达的一次 React 提交中，思考区先退出 144px live 视口，随后自动折叠再次移除过程详情；通用滚动锚点只记录整条 Assistant 外壳，且普通 `scroll` 会把程序恢复和浏览器高度钳制误记成用户输入，导致旧锚点可循环恢复。靠近底部时，新滚动上限还会先夹低 `scrollTop`，仅恢复坐标无法保持视口。
- 已完成：最终正文过渡帧继续保留 live 思考几何，再按 Agent turn 执行专用 before/after 折叠事务；手动浏览态采样视口内存活 DOM 锚点并按需建立临时尾部补偿，补偿随真实正文增长消化、回到底部或切换会话时清零；明确用户输入使用 generation 使旧锚点失效，流式布局不再重置空闲采集计时。版本号三处同步至 v2.16.5。定向测试 3 个文件、21 项通过；`pnpm typecheck` 通过；全量测试 88 个文件、631 项通过；`pnpm build` 通过，renderer 为 `assets/index-32-Vq1Ti.js`；`pnpm knowledge:validate` 与 `git diff --check` 通过。旧安装版单实例进程已关闭，v2.16.5 dev 构建完成 DOM 加载并保持运行。
- 未完成：用户真实长思考视觉验收。
- 阻塞：无。
- 关键文件：`src/components/chat/ChatThread.tsx`、`src/components/chat/MessageBubble.tsx`、`src/utils/chatViewportTransaction.ts`、`src/utils/liveThinkingViewport.ts`、`knowledge/project/kimix.md`、`docs/release-notes/v2.16.5.md`。
- 下一步：用户先确认左下角版本为 v2.16.5，再在手动浏览旧消息、当前 Agent 正文及多 Agent 并行三种场景复测思考转正文。本轮不推送、不打 tag、不发布。

## 2026-07-15 v2.16.4 上下文压缩气泡居中

- 当前目标：修正上下文压缩状态气泡中文字和动画点组合的视觉居中。
- 根因：动画点使用固定 `1.5em` 槽位，当前字体下三个点的真实字宽更窄；右侧残留不可见空白使完整状态组合仍偏左。
- 已完成：改用同字体不可见三个点建立真实稳定槽宽，并覆盖当前动画点；动画过程不改变气泡宽度，三个点完整显示时不再带多余右侧空间；版本号三处同步至 v2.16.4。`pnpm typecheck` 通过；全量测试 87 个文件、622 项通过；`pnpm build` 通过，renderer 为 `assets/index-DAr_vk_-.js`；`pnpm knowledge:validate` 与 `git diff --check` 通过。
- 未完成：等待用户视觉验收。
- 阻塞：无。
- 关键文件：`src/components/chat/ChatThread.tsx`、`package.json`、`docs/release-notes/v2.16.4.md`。
- 下一步：用户确认 v2.16.4 上下文压缩状态在 0–3 个点动画中保持稳定且视觉居中；本轮不推送、不打 tag、不发布。

## 2026-07-15 v2.16.3 完全访问短标签

- 当前目标：缩短 Composer 的完全访问权限标签，避免窄工具栏中出现省略。
- 根因：Composer 的权限菜单和当前按钮仍使用“完全访问权限”，与设置页、添加 Agent 弹窗已经采用的“完全访问”不一致。
- 已完成：Composer 两处用户可见文案统一为“完全访问”，底层 `yolo` 模式、自动批准行为和风险提示保持不变；版本号三处同步至 v2.16.3。`pnpm typecheck` 通过；全量测试 87 个文件、622 项通过；`pnpm build` 通过，renderer 为 `assets/index-CElwOnN9.js`；`pnpm knowledge:validate` 与 `git diff --check` 通过。
- 未完成：等待用户视觉验收。
- 阻塞：无。
- 关键文件：`src/components/chat/Composer.tsx`、`package.json`、`docs/release-notes/v2.16.3.md`。
- 下一步：用户确认 v2.16.3 工具栏按钮和权限菜单均显示“完全访问”且不再省略；本轮不推送、不打 tag、不发布。

## 2026-07-14 v2.16.2 项目展开与启动上下文恢复

- 当前目标：完整修复项目展开/折叠状态未持久化，以及启动时可能进入非退出前项目或会话的问题。
- 根因：侧栏仅以内存项目 ID 集合记录展开状态；设置 bootstrap、主启动恢复和活动上下文持久化之间存在临时项目双写；保存项目但没有活动会话时又错误回退到其他项目的最近会话。
- 已完成：展开集合改为按规范化项目路径持久化，区分首次启动与用户明确全部折叠；启动设置加载不再选择项目；活动上下文写入等待正式恢复完成；启动优先级改为有效保存会话、保存项目、无保存上下文时的最近会话、默认项目。版本号三处同步至 v2.16.2；`pnpm typecheck` 通过；全量测试 87 个文件、622 项通过；`pnpm build` 通过，renderer 为 `assets/index-MZ4jIt_p.js`；`pnpm knowledge:validate` 与 `git diff --check` 通过。
- 未完成：等待用户重启验收。
- 阻塞：无。
- 关键文件：`src/App.tsx`、`src/components/layout/Sidebar.tsx`、`src/hooks/useBootstrap.ts`、`src/hooks/useStatePersistence.ts`、`src/utils/startupContext.ts`、`src/utils/sidebarProjectExpansion.ts`。
- 下一步：用户在 v2.16.2 验收多个项目的展开/折叠组合、停留在无活动会话项目后的重启，以及最近项目顺序与退出项目不一致时的恢复；本轮不推送、不打 tag、不发布。

## 2026-07-14 v2.16.1 TypeScript 严格门禁

- 当前目标：清除仓库既有 TypeScript 类型基线错误，并让生产构建之外的严格类型检查成为可重复门禁。
- 根因：Vite 生产构建只转译 TypeScript；根配置停在 ES2022、未统一检查 Electron 主进程，且未使用诊断与类型安全诊断混杂，导致 IPC 类型、事件状态、空值和不可达控制流长期漂移。
- 已完成：主进程与渲染端严格类型错误全部清零；新增串行 `pnpm typecheck` 覆盖 `tsconfig.node.json` 与 `tsconfig.json`。修复 BTW SDK 侧问缺失执行器、空白页异常清理越界、消息分组不可达分支、设置“从不显示状态”无法持久化、窗口对话框重载及多个 IPC/事件类型漂移；补齐浏览器预览 API 契约；版本号三处同步至 v2.16.1。`pnpm typecheck` 通过；全量测试 85 个文件、614 项通过；`pnpm build` 通过，renderer 为 `assets/index-BiLF6AMh.js`；`pnpm knowledge:validate` 与 `git diff --check` 通过。
- 未完成：等待用户最终运行验收。
- 阻塞：无。
- 关键文件：`tsconfig.json`、`tsconfig.node.json`、`electron/kimiCodeHost.ts`、`electron/main.ts`、`electron/preload.ts`、`src/App.tsx`、`src/types/ui.ts`、`package.json`。
- 下一步：用户用 v2.16.1 新构建重点验收 BTW、空白页快捷发送、消息分组和“从不显示状态”设置；本轮不推送、不打 tag、不发布。

## 2026-07-14 v2.16.0 多 Agent 房间发布

- 当前目标：完成从多 Agent 房间开发起点到当前 HEAD 的全量审查，在没有未解决高风险问题时发布一个新的中版本。
- 审查结论：投递身份、事件/历史分区、运行态恢复、停止、上下文桥接、归档恢复、搜索导出和 UI 归属均与设计不变量一致；发现的唯一发布阻塞项是并发持久化提前返回成功，已在 v2.15.64 独立修复并通过回归。未发现剩余 P0/P1 问题。
- 已完成：版本号三处同步至 v2.16.0；设置中的“内部验收”文案升级为正式功能状态；README、实施计划、验收记录、ADR、架构知识和专属 Release notes 已同步。全量测试 85 个文件、614 项通过；`pnpm build` 通过，renderer 为 `assets/index-CRwBxskp.js`；`pnpm knowledge:validate` 与 `git diff --check` 通过。`master` 已快进并推送至 `f32e986e`，`v2.16.0` 标签已推送；GitHub Actions `29339368596` 的知识校验、Windows、macOS、Linux 与 `publish-release` 全部成功，Release 已公开并生成 `SHA256SUMS.txt`。
- 未完成：等待用户安装 v2.16.0 做最终版本号与真实任务回归。
- 阻塞：无。
- 关键文件：`docs/release-notes/v2.16.0.md`、`docs/multi-agent-room-plan.md`、`docs/multi-agent-room-user-acceptance.md`、`knowledge/decisions/user-controlled-multi-agent-rooms.md`、`knowledge/architecture/collaboration-room-routing.md`。
- 下一步：用户从 `https://github.com/LiKPO4/kimix/releases/tag/v2.16.0` 安装并确认左下角版本为 v2.16.0；后续若出现归属、重复投递或恢复异常，立即暂停下一版本发布并按会话取证。

## 2026-07-14 v2.15.64 并发投递持久化屏障

- 当前目标：在发布前审查多 Agent 房间全部改动，修复并发投递可能绕过 `sending` 耐久化门禁的风险。
- 根因：通用持久化器在已有写入进行中时，只替换待写快照并立即返回成功；并行 Agent 因而可能在自己的 `sending` 状态真正落盘前调用官方运行时。
- 已完成：并发持久化调用统一等待当前写入及最新合并快照完成；队列写入失败会回传给所有等待者。新增成功合并与失败传播回归；版本号三处同步至 v2.15.64。定向测试 2 个文件、22 项通过；全量测试 85 个文件、614 项通过；`pnpm build` 通过，renderer 为 `assets/index-DtJcKY9M.js`；`pnpm knowledge:validate` 与 `git diff --check` 通过。
- 未完成：提交本安全修复；随后准备 v2.16.0 发布提交。
- 阻塞：无。
- 关键文件：`src/utils/persistence.ts`、`src/utils/__tests__/persistence.test.ts`、`knowledge/architecture/collaboration-room-routing.md`。
- 下一步：提交 v2.15.64，再生成 v2.16.0 Release notes 并按 Actions 流程发布。

## 2026-07-14 v2.15.63 房间本轮耗时稳定锚点

- 当前目标：修复刚发送并在约 10 秒内完成的多 Agent 回复偶尔显示“本轮总耗时 42–44 分钟”的问题；保持当前进程运行直到完成取证。
- 现场证据：官方 wire 中 mimo-v2.5-pro 本轮从 prompt 到 step.end 为 9.989 秒，deepseek-v4-pro 为 11.132 秒；UI 的 44分54秒和 42分27秒来自各 Agent 旧用户消息到本次完成事件的跨回合时间差。
- 根因：`completedAssistantDuration` 在房间当前 prompt 尚未进入 Agent 本地事件分区时，会把最近任意 `user_message` 当成本轮起点；房间隔离后这个回退可能命中数十分钟前的旧消息。
- 已完成：房间 Assistant 只接受相同 `roomMessageId`、同 Agent 的用户耗时锚点；找不到时回退到本轮 Assistant 占位起点，普通单 Agent 最近用户消息逻辑保持不变。版本号三处同步至 v2.15.63；定向测试 1 个文件、85 项通过；全量测试 85 个文件、613 项通过；`pnpm build` 通过，renderer 为 `assets/index-UEs024dF.js`；`pnpm knowledge:validate` 通过。
- 未完成：等待用户用新消息验收两个 Agent 的显示耗时是否接近官方真实耗时。
- 阻塞：无。
- 关键文件：`src/utils/eventMapper.ts`、`src/utils/__tests__/eventMapper.test.ts`、`src/components/chat/MessageBubble.tsx`。
- 下一步：用户在已启动的 v2.15.63 发送一次双 Agent 短回复，确认各自耗时约为真实秒级；发布继续暂停。

## 2026-07-14 v2.15.62 持久化任务唤醒运行态校准

- 当前目标：修复 v2.15.61 打开后仍显示假运行态、必须再次点击停止才会正确收尾的问题；发布继续暂停。
- 根因：v2.15.61 已能正确处理 unavailable runtime，但校准 effect 只由内存 `roomAgentActivities` 或 `runningSessionId` 唤醒；重启后两者为空，界面状态来自持久化 active delivery，导致校准逻辑根本没有执行。
- 已完成：从所有房间的持久化 active delivery 构造 Agent 校准目标和稳定签名；即使没有内存 activity 或 room 级 running ID，残留 delivery 也会启动周期校准并沿用 Agent 级安全收尾。版本号三处同步至 v2.15.62；定向测试 1 个文件、6 项通过；全量测试 85 个文件、611 项通过；`pnpm build` 通过，renderer 为 `assets/index-CbuxqMEE.js`；`pnpm knowledge:validate` 通过。
- 未完成：等待用户验证下一次外部终止后打开即自动恢复，无需再次点击停止。
- 阻塞：无。
- 关键文件：`src/App.tsx`、`src/utils/roomAgentControl.ts`、`src/utils/__tests__/roomAgentControl.test.ts`。
- 下一步：用户在已启动的 v2.15.62 复测外部终止场景；发布未经再次确认继续暂停。

## 2026-07-14 v2.15.61 外部终止后的 Agent 状态收束

- 当前目标：修复新 Agent 首轮运行时 Kimix 被重启，runtime 已终止但本地仍永久显示运行中、再次停止只返回 `session is not active` 的问题；发布继续暂停。
- 根因：运行态校准在所有 Agent runtime 候选均返回“不活跃/不存在”时直接退出，停止入口也只在官方 cancel 成功后收尾；外部终止因此没有任何终态事件来清除本地 activity 和 active delivery。
- 已完成：统一识别“不活跃/不存在”为 runtime 已终止；停止入口和周期校准都按对应 `roomId + roomAgentId + roomMessageId` 收束未完成事件、投递及活动状态，不恢复或重发消息，不影响其他 Agent。版本号三处同步至 v2.15.61；定向测试 2 个文件、11 项通过；全量测试 85 个文件、610 项通过；`pnpm build` 通过，renderer 为 `assets/index-Bq-Pj4Gr.js`；`pnpm knowledge:validate` 和 `git diff --check` 通过。
- 未完成：等待用户确认当前卡住 Agent 已自动退出运行态，并复测外部终止后再次点击停止不再报错。
- 阻塞：无。
- 关键文件：`src/App.tsx`、`src/components/chat/Composer.tsx`、`src/utils/kimiCodeSessionRecovery.ts`、`src/utils/roomAgentControl.ts`。
- 下一步：用户在已启动的 v2.15.61 确认目标房间已退出假运行态；发布未经再次确认继续暂停。

## 2026-07-14 v2.15.60 分 Agent 背景信息用量

- 当前目标：让多 Agent 房间的背景信息窗口显示每个模型各自的上下文用量；发布继续保持暂停。
- 根因：`ContextRing` 只读取房间顶层 `session.events` 的 primary 兼容镜像，其他 Agent 各自 `collaboration.agentEvents` 中的 Context 指标没有参与展示；仅有 Tokens 而没有 Context 的状态还会被误报为 0% 已用。
- 已完成：逐个读取未移除 Agent 的独立事件分区，分别计算模型上下文已用比例、标记数和上限；同名模型保留 Agent 名称用于区分，缺少正数 Context 指标时显示“等待上下文数据”。圆环和压缩操作仍绑定 primary Agent，不改变 runtime 控制边界。版本号三处同步至 v2.15.60；定向测试 1 个文件、26 项通过；全量测试 85 个文件、609 项通过；`pnpm build` 通过，renderer 为 `assets/index-CMOOuT9e.js`；`pnpm knowledge:validate` 和 `git diff --check` 通过。
- 未完成：等待用户截图验收每个 Agent 的模型与上下文用量；发布未经再次确认继续暂停。
- 阻塞：无。
- 关键文件：`src/components/chat/ContextRing.tsx`、`src/utils/sessionMetrics.ts`、`src/utils/__tests__/sessionMetrics.test.ts`。
- 下一步：用户在已启动的 v2.15.60 打开背景信息窗口，确认每个 Agent 的模型和上下文用量分别正确显示。

## 2026-07-14 v2.15.59 房间实时用户消息唯一投影

- 当前目标：修复 v2.15.58 多 Agent 房间单次输入在运行中仍出现多条相同用户气泡的问题；发布保持暂停。
- 根因：稳定投递身份已经进入 TurnBegin 与 canonical history，但通用 `mergeEvents` 仍只用“正文相同且 10 秒内”识别用户回声。同一投递的 snapshot 别名超过 10 秒会持续追加；反过来，两次身份不同但正文相同的真实输入又可能被误吞。房间投影器还只认领首个官方用户事件，其他同身份别名会被当作未归属历史再次显示。
- 已完成：房间用户事件仅按完整 `roomMessageId + agentTurnId + dispatchAttemptId` 合并，不再使用正文猜测；身份不同的相同输入分别保留。投影器按匹配投递身份认领全部用户事件别名，并拒绝用不匹配的旧 official ID 越过稳定身份。新增三项回归覆盖延迟 snapshot、相同正文不同投递及已有多别名投影；定向测试 2 个文件、88 项通过；全量测试 85 个文件、607 项通过；`pnpm build` 通过，renderer 为 `assets/index-CugjeIAX.js`；`pnpm knowledge:validate` 和 `git diff --check` 通过。版本号三处同步至 v2.15.59。
- 未完成：提交并启动新构建后等待用户复测；未经用户再次确认不发布。
- 阻塞：发布被本问题主动暂停，修复验证无阻塞。
- 关键文件：`src/utils/eventMapper.ts`、`src/utils/collaborationTimeline.ts`、`src/utils/__tests__/eventMapper.test.ts`、`src/utils/__tests__/collaborationTimeline.test.ts`。
- 下一步：完成门禁并启动 v2.15.59；用户在运行超过 10 秒的真实房间轮次中确认单次输入始终只有一个气泡，关闭重开后仍一致。

## 2026-07-14 v2.15.58 输入区文字基线统一

- 当前目标：统一输入区底部权限、Agents、携带正文、Swarm、Plan 和思考按钮的文字视觉高度与基线。
- 根因：权限标签继承 `line-height: 1`，Agents 使用 20px 行高且数字单独缩至 11.5px，右侧模式按钮又继承 `line-height: 1`；flex 只能让不同高度的行盒几何居中，无法形成一致的文字基线。
- 已完成：六类文字入口显式统一为 13px 基准字号和 20px 行高，Agents 数字恢复 13px 并保留等宽数字与次要颜色；长权限标签仍可按既有规则缩小字号，但统一使用 20px 行高。按钮宽度、高度、状态和交互均未改变；版本号三处同步至 v2.15.58；全量测试 85 个文件、604 项通过；`pnpm build` 通过，renderer 为 `assets/index-C17_fZNi.js`；`pnpm knowledge:validate` 和 `git diff --check` 通过。
- 未完成：提交并启动新构建后，等待用户截图验收整行文字基线。
- 阻塞：无。
- 关键文件：`src/components/chat/Composer.tsx`、`src/components/chat/RoomAgentPicker.tsx`、`src/components/chat/RoomContextPicker.tsx`。
- 下一步：完成门禁并启动 v2.15.58；用户确认自动权限、Agents 数字、携带正文及右侧模式文字视觉高度一致。

## 2026-07-14 v2.15.57 输入区工具栏瘦身

- 当前目标：减少多 Agent 房间输入区底部按钮的横向占用，避免携带正文按钮挤压右侧 Swarm 等工具。
- 根因：左侧权限、Agents、携带正文三个固定槽位合计占用 388px，右侧 Swarm、Plan、思考三个按钮又锁定至少 296px；按钮同时重复展示图标、单位和“开/关”文字，使中等宽度下几乎没有弹性空间。
- 已完成：左侧三个固定槽位收紧为合计 324px，移除 Agents 和携带正文入口的重复装饰信息；右侧三个模式按钮收紧为 84/72/76px，仅保留模式名称，状态继续由现有颜色、边框、悬浮提示及无障碍属性表达。按钮高度保持 34px、左右留白保持 12px，主次工具组间距改为 6px/4px。版本号三处同步至 v2.15.57；全量测试 85 个文件、604 项通过；`pnpm build` 通过，renderer 为 `assets/index-D0K0GKSg.js`；`pnpm knowledge:validate` 和 `git diff --check` 通过。
- 未完成：提交并启动新构建后，等待用户在 v2.15.57 截图中验收窄窗口及多 Agent 状态。
- 阻塞：无。
- 关键文件：`src/components/chat/Composer.tsx`、`src/components/chat/RoomAgentPicker.tsx`、`src/components/chat/RoomContextPicker.tsx`。
- 下一步：完成门禁并启动 v2.15.57；用户确认携带正文与 Swarm 不再互相挤压，按钮文字及状态仍清晰。

## 2026-07-14 v2.15.56 房间投递稳定身份协议

- 当前目标：从数据模型上消除多 Agent 房间单次输入被房间消息与 Agent 官方历史重复投影的问题，不再让新消息依赖正文和时间猜测归属。
- 根因：房间级 `collaboration.messages` 是共享用户气泡的显示权威，每个 Agent 的 canonical `TurnBegin` 是独立官方回合边界；运行时虽能从 activity 临时补上 `roomMessageId + agentTurnId`，但 canonical snapshot 会重建事件并丢失关联。投影器随后把未认领的官方用户事件当作独立消息，形成第二个气泡；运行中多次 snapshot 会让临时重复更明显。官方目标会话只有一次 prompt，不是重复发送。
- 已完成：现有长度校验房间封套新增协议版本和 `roomMessageId + agentTurnId + dispatchAttemptId`，解析器只有三项全部合法才恢复身份，用户正文仍按原协议剥离；非法换行身份在发送前拒绝。发送、流事件、官方历史映射、canonical 绑定与投影共享稳定身份；同文重复输入可分别精确归属。身份事件不匹配时不允许旧官方事件 ID 覆盖，也不做文字猜测；仅无身份旧历史保留同 Agent、30 秒内、正文一致且候选唯一的迁移。备份校验及冲突副本同步验证、重映射投递尝试身份。版本号三处同步至 v2.15.56；定向测试 5 个文件、113 项通过；全量测试 85 个文件、604 项通过；`pnpm build` 通过，renderer 为 `assets/index-VlSsF6XN.js`；`pnpm knowledge:validate` 和 `git diff --check` 通过。
- 未完成：提交并启动新构建后，等待用户复测目标会话和连续相同文本。
- 阻塞：无。
- 关键文件：`src/utils/roomContextBridge.ts`、`src/utils/eventMapper.ts`、`src/utils/collaborationHistory.ts`、`src/utils/sessionBackup.ts`、`src/components/chat/Composer.tsx`。
- 下一步：提交并启动 v2.15.56；用户确认单次 @ 消息在运行中和重启后均只有一个气泡，并验证连续发送相同文字仍显示为两次真实输入。

## 2026-07-14 v2.15.55 多 Agent 房间用户消息唯一绑定

- 当前目标：修复 `session_5b681eb3-a77a-4c16-b25e-4e2b8bc06f22` 中单次输入在运行中出现多份、重启后仍显示两份的问题。
- 根因：房间先持久化一条共享用户消息；Kimi Code 官方历史又为每个目标 Agent 保存一条 `turn.prompt`。发送接口没有返回 `officialUserEventId` 时，canonical history 的安全绑定只接受已有旧 ID，导致唯一对应的官方用户事件被保留为未归属事件，投影层同时渲染房间消息和官方消息；运行中 snapshot 重放会让临时重复更明显。官方 wire 只有一次真实 prompt 和一次 Assistant turn，不是重复投递给模型。
- 已完成：缺少官方用户事件 ID 时，改为仅在同一 Agent 中冻结的官方投递正文完全一致、时间相差不超过 30 秒且候选唯一时绑定；`@Agent` 可见路由文字不会参与官方正文匹配，多个相同候选继续拒绝猜测。历史缓存版本提升至 5，已有房间会重新读取并归一化。版本号三处同步至 v2.15.55；官方会话文件、Agent runtime、投递状态和消息正文均不改写。定向测试 3 个文件、18 项通过；全量测试 85 个文件、600 项通过；`pnpm build` 通过，renderer 为 `assets/index-CqqYbyWg.js`；`pnpm knowledge:validate` 和 `git diff --check` 通过。
- 未完成：提交后启动新构建，等待用户复测目标会话及新发一条 @ 消息。
- 阻塞：无。
- 关键文件：`src/utils/collaborationHistory.ts`、`src/utils/kimiHistoryCache.ts`、`src/utils/__tests__/collaborationHistory.test.ts`。
- 下一步：提交并启动 v2.15.55；用户确认目标会话只显示一条原消息，新发送一次也只出现一条。

## 2026-07-14 v2.15.54 Kimi Web 长思考固定视口

- 当前目标：让运行中的长思考达到 6 行后固定为内部滚动区域，并在最终正文开始时由结果接替主阅读区域。
- 已完成：只对当前活跃 Assistant 的最后一个思考组启用 144px 视口；短内容自然增长，超出后内部滚动并展示完整流式思考。位于底部时跟随最新内容，用户向上查看后暂停、回到底部附近恢复；滚轮在内部可滚时隔离，到达边界后放行外层。最终正文首次出现时单次收起过程，思考数据、复制和手动重开保持不变。专属滚动条使用 6px 透明轨道和低对比度滑块；多 Agent 按各自活跃状态判断。版本号三处同步至 v2.15.54；定向测试 1 个文件、5 项通过；全量测试 85 个文件、599 项通过；`pnpm build` 通过，renderer 为 `assets/index-elnc2-Rv.js`；`pnpm knowledge:validate` 和 `git diff --check` 通过。
- 未完成：等待用户截图视觉验收真实长思考的 6 行高度、低对比度滚动条、内部回看和最终正文接替效果。
- 阻塞：无。
- 关键文件：`src/components/chat/MessageBubble.tsx`、`src/utils/liveThinkingViewport.ts`、`src/utils/__tests__/liveThinkingViewport.test.ts`、`src/index.css`。
- 下一步：完成门禁并提交后启动新构建，用户用超过 6 行的真实长思考确认高度、滚动跟随和最终正文接替效果。

## 2026-07-14 v2.15.53 Windows 通知点击聚焦

- 当前目标：修复点击任务完成后的 Windows 系统通知时，Kimix 窗口没有获得前台焦点的问题。
- 已完成：确认原路径仅调用 `restore/show/focus`，会受 Windows 后台应用前台抢占限制；新增统一 `activateWindow`，Windows 下短暂置顶、恢复/显示、`moveTop` 并聚焦，200ms 后恢复原置顶状态。任务完成、待审批和待回答共用同一通知点击路径，session/Agent/event 路由未改；单实例唤醒同步复用激活策略。版本号三处同步至 v2.15.53；定向测试 1 个文件、4 项通过；全量测试 84 个文件、594 项通过；`pnpm build` 通过，renderer 为 `assets/index-CFXBh8cX.js`；`pnpm knowledge:validate` 通过。
- 未完成：等待 Windows 实机点击验收。
- 阻塞：无。
- 关键文件：`electron/windowActivation.ts`、`electron/main.ts`、`src/utils/__tests__/windowActivation.test.ts`。
- 下一步：用户在 v2.15.53 将 Kimix 置于其他窗口后方并点击完成通知，确认窗口可靠置前并跳转到对应会话。

## 2026-07-14 v2.15.52 更新 Kimi Code 版本动态入口

- 当前目标：将更新记录弹窗中 Kimi Code 的“浏览器查看”替换为更新更及时的官方 CLI Changelog 地址。
- 已完成：仅将 `KIMI_CODE_UPDATE_PAGE_URL` 从旧 `whats-new.html` 替换为 `https://www.kimi.com/code/docs/kimi-code-cli/release-notes/changelog.html`；Kimix 本体 Release 地址、Kimi Code 更新检测和安装逻辑均未改动；版本号三处同步至 v2.15.52。新地址 HTTP 200；全量测试 83 个文件、590 项通过；`pnpm build` 通过，renderer 为 `assets/index-De7xUNe3.js`；`pnpm knowledge:validate` 通过。
- 未完成：等待用户点击验收。
- 阻塞：无。
- 关键文件：`src/components/layout/DialogSystem.tsx`、`package.json`、`src/components/layout/Sidebar.tsx`、`src/components/settings/SettingsPanel.tsx`。
- 下一步：用户在 v2.15.52 点击 Kimi Code 卡片下方“浏览器查看”，确认打开官方 Changelog。

## 2026-07-14 v2.15.51 稳定多 Agent 消息信息气泡

- 当前目标：修复已完成 Agent 的 Tokens/Context 信息气泡在输出结束、切换 Agent、下一 Agent 开始输出或切换权限后，偶尔降级成超长耗时的问题，同时保持官方历史和消息归属不变。
- 已完成：确认根因是 `turn_end` 状态筛选只保留同一 Agent turn 的最后普通状态，导致晚到的权限、Plan 或运行状态在渲染前删除已有用量；现在按用户/steer 边界及 `agentTurnId` 优先保留最后一条指标状态，只有完全无指标时才保留最后普通状态。多 Agent 缺少指标时改为显示官方回复事件的模型或“已完成”，不再显示由历史间隔推导的耗时；普通单 Agent 耗时逻辑保持不变。状态 memo key 同步纳入指标和房间归属字段。版本号三处同步至 v2.15.51；定向测试 1 个文件、20 项通过；全量测试 83 个文件、590 项通过；`pnpm build` 通过，renderer 为 `assets/index-_ednI1AV.js`；`pnpm knowledge:validate` 通过。
- 未完成：等待用户在 v2.15.51 实机复测 Agent 输出结束、切换 Agent、下一 Agent 开始输出、切换权限四个节点。
- 阻塞：无。
- 关键文件：`src/components/chat/ChatThread.tsx`、`src/components/chat/MessageBubble.tsx`、`src/utils/sessionMetrics.ts`、`src/utils/__tests__/chatRenderItems.test.ts`。
- 下一步：用户用 v2.15.51 确认上一轮 Agent 的 Tokens/Context 在输出结束、切换 Agent、下一 Agent 开始输出、切换权限后不再变化。

## 2026-07-14 v2.15.50 固定正文范围弹窗锚点

- 当前目标：修复“本次补充正文”触发器按选项文字自适应宽度，导致上方弹窗左右移动的问题。
- 已完成：`RoomContextPicker` 触发器固定为 128px 槽位，弹窗继续以固定槽位右边界对齐；同步版本号至 v2.15.50。`pnpm test:run`（83 个文件、583 项）、`pnpm build`（renderer `assets/index-DEspJajq.js`）、`pnpm knowledge:validate` 和 `git diff --check` 已通过。
- 未完成：等待用户在 v2.15.50 窗口切换“上一轮/最近 3 轮/选择消息/全部正文/不补充”确认弹窗右边界稳定。
- 阻塞：无。
- 关键文件：`src/components/chat/RoomContextPicker.tsx`、`package.json`、`src/components/layout/Sidebar.tsx`、`src/components/settings/SettingsPanel.tsx`。
- 下一步：提交后用根目录 `start-kimix.bat` 启动 v2.15.50，切换正文范围选项，确认弹窗右边界保持稳定并回传截图。

## 2026-07-14 v2.15.49 Agents 文字色统一

- 当前目标：收束输入区固定 Agents 选择槽的视觉层级，让标签文字与“手动审批”“上一轮”等次要工具按钮一致。
- 已完成：移除 `Agents` 标签覆盖主文本色的显式样式，改为继承 `kimix-muted-action` 的次要文本色；同步版本号至 v2.15.49。`pnpm test:run`（83 个文件、583 项）、`pnpm build`（renderer `assets/index-VCEPHidv.js`）、`pnpm knowledge:validate` 和 `git diff --check` 已通过。
- 未完成：等待用户在 v2.15.49 窗口确认 Agents 标签颜色与相邻按钮一致。
- 阻塞：无。
- 关键文件：`src/components/chat/RoomAgentPicker.tsx`、`package.json`、`src/components/layout/Sidebar.tsx`、`src/components/settings/SettingsPanel.tsx`。
- 下一步：提交后用根目录 `start-kimix.bat` 启动 v2.15.49，确认 Agents 标签与相邻次要按钮使用一致的灰色。

## 2026-07-14 v2.15.48 固定 Agents 选择槽

- 当前目标：收束多 Agent 房间工具栏的实测视觉反馈，避免输入区 Agent 选择器用模型/Agent 名称造成省略。
- 已完成：`RoomAgentPicker` 触发器改为固定 136px 槽位，统一显示 `Agents`，保留已选数量、下拉入口和完整接收者 title；移除该触发器不再需要的动态字号测量。`pnpm test:run`（83 个文件、583 项）、`pnpm build`（renderer `assets/index-DypQPYoq.js`）、`pnpm knowledge:validate` 和 `git diff --check` 已通过。
- 未完成：等待用户在 v2.15.48 窗口确认固定标签、数量和正文范围按钮之间的间距是否合适。
- 阻塞：无。
- 关键文件：`src/components/chat/RoomAgentPicker.tsx`、`src/components/chat/Composer.tsx`、`package.json`、`src/components/layout/Sidebar.tsx`、`src/components/settings/SettingsPanel.tsx`。
- 下一步：提交后用根目录 `start-kimix.bat` 启动 v2.15.48，确认输入区显示固定 `Agents`、数量与下拉箭头，并回传截图做最终视觉验收。

## 2026-07-14 启动器构建指纹与旧进程清理

- 当前目标：修复通过 `start-kimix.bat` 启动时误用旧构建或被旧 Kimix 单实例窗口接管的问题。
- 已完成：启动器不再以“工作区干净”推断 `out` 一定最新；默认模式校验 Git HEAD 构建指纹，缺失或不一致时重建，并在 native 构建失败时拒绝启动旧产物。启动前同步清理当前仓库、旧兼容副本和已安装版 Kimix 进程，保留 `--fast` 作为明确跳过校验的入口。Windows PowerShell 5.1 语法解析、真实启动、构建指纹与当前 HEAD 一致性均已通过；`pnpm test:run`（83 个文件、583 项）、`pnpm build`（renderer `index-GGEvNiw2.js`）、`pnpm knowledge:validate` 和 `git diff --check` 已通过；本轮故障根因已记录到 `knowledge/project/kimix.md`。
- 未完成：等待用户用仓库根目录 `start-kimix.bat` 验收左下角版本与旧窗口不会被复用。
- 阻塞：无。
- 关键文件：`start-kimix.bat`、`scripts/restart-kimix-dev.ps1`、`electron/main.ts`。
- 下一步：提交本轮兼容性修复后，用仓库根目录 `start-kimix.bat` 验收左下角版本为 v2.15.47，并确认不会复用旧窗口。

## 2026-07-14 多 Agent 房间实施

- 当前目标：收束多 Agent 房间首轮用户实测反馈；v2.15.47 让固定宽度工具栏优先缩小文字再省略。
- 已完成：完成阶段 0-8 与阶段 9A/9B；真实 Windows Electron 已完成单目标、mention 覆盖、双目标与四目标跨 Provider 并行。v2.15.40 已修正预发送状态误报、工具栏顺序和 Agent 选择器垂直对齐。v2.15.41 默认向目标 Agent 补入上一轮已完成正文，并提供最近 3 轮、选择消息、全部正文和不补充五种单次范围；只共享用户消息与 Agent 最终正文，按 Agent 去重，投递失败重试保持冻结内容，隐藏桥接包不会污染官方历史显示；单 Agent 超过 48,000 字时明确拒绝。v2.15.45 实机确认原房间 `m13fnosjo` 的 3 个次要 Agent 仍在官方目录但本地 collaboration 丢失，已加入唯一 metadata 自动重组和持久化防降级。v2.15.46 将权限按钮固定在 124px 槽位内，并为权限、Agent 与正文范围热区设置明确的 8px 间距。v2.15.47 按 Agent 标签真实可用宽度将字号从 13px 逐级缩至最低 10px，权限长标签也优先降至 11-12px。
- 未完成：等待用户实机验收 v2.15.47 Agent 名称与权限标签的字号自适应；同时继续验收房间历史、需求澄清包装移除与房间 Agent 独立归因。
- 阻塞：无。v2.15.47 定向 1 个测试文件、4 项测试通过；全量 83 个测试文件、583 项测试通过；生产构建通过，renderer 为 `assets/index-GGEvNiw2.js`；OKF 严格校验通过；新构建已启动并完成同宽度运行检查。
- 关键文件：`docs/multi-agent-room-plan.md`、`docs/multi-agent-room-user-acceptance.md`、`knowledge/decisions/user-controlled-multi-agent-rooms.md`、`knowledge/architecture/collaboration-room-routing.md`、`src/types/ui.ts`、`src/components/chat/Composer.tsx`、`src/components/chat/RoomAgentPicker.tsx`、`src/components/chat/RoomContextPicker.tsx`、`src/utils/roomContextBridge.ts`、`src/utils/roomDelivery.ts`、`src/utils/collaborationRooms.ts`、`src/utils/collaborationTimeline.ts`、`src/utils/eventMapper.ts`、`src/utils/sessionBackup.ts`。
- 下一步：用户在已启动的 v2.15.47 窗口确认长 Agent 名称先缩小字号、达到 10px 下限后才省略。
- 验证补充：`pnpm exec tsc -p tsconfig.json --noEmit` 仍被仓库既有类型基线错误阻塞；本阶段涉及文件的新增类型问题已清理，正式门禁仍以现有 `test:run`、`build`、`knowledge:validate` 和 diff check 为准。

## 2026-07-13 v2.15.21 历史流程展开与滚动稳定性

- 当前目标：修复最新 Agent 继续工作时，用户展开较早 Agent 输出或命令详情后被自动折叠，并伴随页面向下跳动的问题。
- 根因：运行中 quiet-stream snapshot 会把重新映射、带全新事件 ID 的历史整体替换进时间线，导致旧消息 React 组件重挂载、内部展开状态清零；同时流程摘要会在“最新流程轮次”变化时再次应用默认展开值，覆盖用户选择。折叠造成内容高度骤减，滚动锚点失去原 DOM 身份后表现为跳动。
- 已完成：运行中 snapshot 改为增量归并，已挂载的相同 Assistant 与工具历史保持既有事件身份；流程默认展开只在组件首次挂载时应用，之后由用户选择控制；版本号三处同步到 v2.15.21。
- 关键文件：`src/utils/kimiCodeSnapshotReplay.ts`、`src/components/chat/MessageBubble.tsx`、`src/App.tsx`。
- 验证：snapshot 与事件归并局部测试 86 项通过；`pnpm test:run` 62 个文件、441 项测试通过；`pnpm build`、`pnpm knowledge:validate` 和 `git diff --check` 通过。
- 下一步：提交本轮改动；用户在 v2.15.21 运行中展开历史 Agent/命令详情并停留观察。

## 2026-07-13 v2.15.20 运行中消息头连续性

- 当前目标：修复发送消息后 Assistant 计时消息头短暂出现、消失、再重新出现的问题。
- 根因：runtime 运行期间连续 4 秒没有流事件时，Kimix 会加载官方历史 snapshot 补偿漏帧；中间 snapshot 尚未落盘当前 Assistant 行，却可能因其他历史更丰富而整体替换本地时间线，删除渲染器已创建的未完成占位行，首个后续 delta 又会重新创建该行。
- 已完成：运行中 snapshot 合并时保留当前用户消息、关联发送状态和未完成 Assistant 占位行；只有 snapshot 已包含官方未完成 Assistant 时才由官方行接管；版本号三处同步到 v2.15.20。
- 关键文件：`src/App.tsx`、`src/utils/kimiCodeSnapshotReplay.ts`。
- 验证：snapshot 与事件归并局部测试 85 项通过；`pnpm test:run` 62 个文件、440 项测试通过；`pnpm build`、`pnpm knowledge:validate` 和 `git diff --check` 通过。
- 下一步：用户用 v2.15.20 在首个回复事件延迟的场景确认消息头保持连续。

## 2026-07-13 v2.15.19 撤回重写服从官方历史

- 当前目标：修复撤回重写后旧用户消息重新出现在对话流中的问题。
- 根因：Kimix 虽调用官方 undo，却只接收成功/失败，随后自行用本地数组截断推演结果；迟到事件与只接受“更丰富”历史的修复策略会重新追加被撤回消息。
- 已完成：官方 undo 成功后立即加载 canonical snapshot 并无条件替换本地时间线，允许历史变短或为空；仅保留 canonical 消息对应的本地媒体元数据；版本号三处同步到 v2.15.19。
- 关键文件：`src/components/chat/MessageBubble.tsx`、`src/utils/undoHistory.ts`。
- 验证：官方历史缩短、清空、媒体回填与事件映射局部测试 98 项通过；`pnpm test:run` 62 个文件、438 项测试通过；`pnpm build`、`pnpm knowledge:validate` 和 `git diff --check` 通过。
- 下一步：用户用 v2.15.19 撤回一条已完成消息并重写，确认旧消息不会再次出现。

## 2026-07-13 v2.15.18 回复用量气泡终态门禁

- 当前目标：避免一轮仍在运行时提前显示阶段性模型用量，并修正气泡字段语义。
- 根因：渲染层仅按 Assistant、工具和子代理事件判断 `turnSettled`，没有把 runtime 运行态纳入最后一轮判断；`Tokens` 实际只显示输出 token，事件到达时间也被误当成有意义的信息展示。
- 已完成：仅对最新一轮增加 runtime 终态门禁；结束后只保留本轮最终状态；气泡改为“输入 / 输出”并移除完整时间串；版本号三处同步到 v2.15.18。
- 关键文件：`src/components/chat/ChatThread.tsx`、`src/components/chat/StatusCard.tsx`。
- 验证：状态气泡与渲染项局部测试 9 项通过；`pnpm test:run` 61 个文件、436 项测试通过；`pnpm build`、`pnpm knowledge:validate` 和 `git diff --check` 通过。知识库：无需更新。
- 下一步：提交本轮改动；用户用 v2.15.18 实机确认运行中不显示用量，结束后仅显示最终“输入 / 输出”。

## 2026-07-13 v2.15.17 项目打开方式接通与错误反馈

- 当前目标：让顶部工作区菜单中的文件资源管理器、VS Code 和终端入口可实际使用，并在失败时给出可诊断反馈。
- 根因：IPC 与主进程启动逻辑已存在，但编辑器只查 PATH；渲染层又丢弃所有调用结果，GUI 已安装但无 CLI 或启动失败时表现为静默无响应。
- 已完成：菜单仅保留文件资源管理器、VS Code、终端并按此顺序排列；VS Code 增加 Windows 常见用户级和机器级安装目录探测；三个入口统一接收 IPC 结果并显示失败原因；版本号三处同步到 v2.15.17。
- 关键文件：`electron/main.ts`、`src/utils/editorLaunch.ts`、`src/components/layout/SessionToolbar.tsx`。
- 验证：编辑器路径局部测试 2 项通过；`pnpm test:run` 61 个文件、433 项测试通过；`pnpm build`、`pnpm knowledge:validate` 和 `git diff --check` 通过。知识库：无需更新。
- 下一步：提交本轮改动；用户用 v2.15.17 实机点击三个入口，确认分别打开当前项目目录。

## 2026-07-11 v2.15.16 隐藏常驻置顶书钉

- 当前目标：移除侧栏置顶项目默认常驻的实心书钉，只在用户需要操作时显示。
- 根因：v2.15.15 将实心书钉做成独立取消置顶按钮后，该按钮默认常驻，重复强调了置顶分组已表达的状态，也占用了项目行的视觉空间。
- 已完成：书钉与菜单、新对话收拢进同一 hover / 键盘焦点操作组；默认全部隐藏，悬停时根据项目状态显示空心“置顶”或实心“取消置顶”书钉；版本号同步到 v2.15.16。
- 验证：`pnpm test:run` 60 个文件、431 项测试通过；`pnpm build`、`pnpm knowledge:validate` 和 `git diff --check` 通过。知识库：无需更新。
- 关键文件：`src/components/layout/Sidebar.tsx`、`src/index.css`。
- 下一步：完成验证并提交；用户验收置顶项目默认无书钉、悬停后可取消置顶。

## 2026-07-11 v2.15.15 项目置顶切换与紧凑操作组

- 当前目标：使侧栏已置顶项目的实心书钉可以直接取消置顶，并收紧项目行三个操作控件的节奏。
- 根因：实心书钉只是项目标题按钮内的展示图标，不能成为独立点击目标；书钉、菜单和新对话分别使用了静态图标、32px 控件和 36px 控件，加上 12px 行右留白，形成不一致且偏松散的视觉节奏。
- 已完成：实心书钉改为独立“取消置顶项目”按钮；未置顶项目保持 hover 时的空心书钉；三个控件统一 28px、组内 0px 间隙，行右内边距收紧为 6px，右侧仍对齐；版本号同步到 v2.15.15。
- 验证：`pnpm test:run` 60 个文件、431 项测试通过；`pnpm build`、`pnpm knowledge:validate` 和 `git diff --check` 通过。知识库：无需更新。
- 关键文件：`src/components/layout/Sidebar.tsx`、`src/index.css`。
- 下一步：完成验证并提交；用户验收实心书钉可取消置顶及三按钮紧凑对齐。

## 2026-07-11 v2.15.14 项目行操作显隐与置顶入口

- 当前目标：使项目行操作区仅在鼠标悬停或操作按钮实际获得键盘焦点时显示，并补齐未置顶项目的快捷置顶入口。
- 根因：项目行把整个行的 `group-focus-within` 作为操作区显隐条件；点击项目标题后焦点仍在标题按钮，因而鼠标移开后操作区持续显示。会话行已使用独立 action-focus 状态，项目行没有复用。
- 已完成：项目行改用独立 `projectActionFocusId` 控制键盘焦点显示，点击项目标题会清除该状态；未置顶项目 hover 操作区增加浅色空心书钉，点击直接置顶；已置顶项目继续保留静态实心书钉标识。
- 验证：`pnpm test:run` 60 个文件、431 项测试通过；`pnpm build`、`pnpm knowledge:validate` 和 `git diff --check` 通过。知识库：无需更新。
- 关键文件：`src/components/layout/Sidebar.tsx`。
- 下一步：完成验证并提交；用户验收项目标题点击后移开鼠标时操作按钮会消失，未置顶项目 hover 可见书钉。

## 2026-07-11 v2.15.13 套餐窗口时间进度文案

- 当前目标：让套餐用量每个窗口右下角文案与绿色时间进度条表达一致。
- 根因：绿色细条表示五小时/每周窗口已经过去的时间比例，但相邻文案仍显示额度剩余量，视觉上被理解为绿色条的说明却使用了另一套指标。
- 已完成：右下角改为复用绿色条的窗口时间计算并显示“已过 N%”；无法取得窗口长度时显示“时间进度未知”，不以额度使用率代替时间进度；版本号同步到 v2.15.13。
- 验证：`pnpm test:run` 60 个文件、431 项测试通过；`pnpm build`、`pnpm knowledge:validate` 和 `git diff --check` 通过。
- 关键文件：`src/components/chat/ContextBar.tsx`。
- 下一步：完成验证并提交，由用户验收用量浮层文案与绿色条是否一致。

## 2026-07-11 v2.15.12 Extra Usage 只读展示

- 当前目标：评估并补齐 Kimi Code 0.23.5 新增的 Extra Usage 展示能力。
- 评估结论：官方能力来自 `/usages` 的 BOOSTER 钱包，只读返回本月已用、月度扣费上限、可用余额和币种；它不是客户端功能开关，也没有官方本地充值或修改限额接口，因此只应并入现有套餐用量浮层，不新增设置项或伪操作入口。
- 根因：vendored SDK 已把 `boosterWallet` 解析为 `extraUsage`，但 Kimix 的 `parseManagedUsagePayload` 只保留 5 小时和每周窗口，导致官方数据在 IPC 前被丢弃。
- 已完成：IPC 增加 Extra Usage 结构；SDK 标准结果和直接接口原始钱包都能解析；仅在有效 BOOSTER 钱包存在时展示本月已用、月度上限、余额及上限进度，无上限时明确显示“不限额”；浮层增加视口高度约束和内部滚动。
- 验证：新增标准 SDK 数据、原始钱包、无效钱包测试；`pnpm test:run` 60 个文件、431 项测试通过；`pnpm build`、`pnpm knowledge:validate` 和 `git diff --check` 通过。
- 关键文件：`electron/kimiUsage.ts`、`electron/types/ipc.ts`、`src/components/chat/ContextBar.tsx`、`src/utils/__tests__/kimiUsage.test.ts`。
- 下一步：由具备 Extra Usage 的账号验收真实金额、无限额文案与月度进度显示。

## 2026-07-11 v2.15.11 工具审批桌面通知

- 当前目标：补齐 Kimi Code 0.23.4 起支持的工具审批桌面提醒，并让通知可直接返回对应会话。
- 根因：Kimix 只在轮次完成和需求澄清时触发通知；pending `approval_request` 虽已渲染审批卡片，但窗口失焦时没有系统提醒，现有通知点击也只聚焦窗口而不会定位来源会话。
- 已完成：pending 工具审批按 runtime session + request id 去重通知；复用通知模式和正文隐私开关；通知携带 Kimix 会话身份，点击后恢复窗口并按 local/runtime/official id 定位会话和项目；完成与澄清通知同步获得回跳能力；设置项统一更名为“桌面通知”。
- 验证：新增通知会话解析和审批摘要单元测试；`pnpm test:run` 60 个文件、428 项测试通过；`pnpm build`、`pnpm knowledge:validate` 和 `git diff --check` 通过。
- 关键文件：`src/App.tsx`、`src/utils/notificationRouting.ts`、`electron/main.ts`、`electron/preload.ts`、`electron/types/ipc.ts`。
- 下一步：在真实失焦窗口触发一次工具审批，验收通知正文与点击回跳；下一独立增量评估并实现 Extra Usage。

## 2026-07-11 v2.15.10 Kimi Code 0.23.5 SDK 兜底对齐

- 当前目标：将 vendored SDK 兜底从 Kimi Code 0.22.0 / Node SDK 0.12.0 对齐到官方 0.23.5 / Node SDK 0.13.2，缩小 Server 与兼容路由行为差异。
- 已完成：从官方 tag `@moonshot-ai/kimi-code@0.23.5` 的提交 `352a449` 重新构建并生成自包含 bundle；再生成脚本成功保留 Kimix 4 秒 MCP 启动超时补丁；更新两个旧探针以兼容官方 `createKimiHarness` 工厂接口。
- 验证：真实宿主 Prompt/Steer/Cancel、会话导出、reload、插件命令与运行时能力探针通过；`pnpm test:run` 59 个文件、426 项测试通过；`pnpm build`、`pnpm knowledge:validate` 和 `git diff --check` 通过。
- 关键文件：`vendor/kimi-code-sdk/index.mjs`、`vendor/kimi-code-sdk/README.md`、`scripts/probe-kimi-code-export.mjs`、`scripts/probe-kimi-code-runtime-capabilities.mjs`。
- 下一步：完成全量验证并提交；下一独立增量实现审批请求桌面通知。

## 2026-07-11 v2.15.9 自动 Server 路由与工具加载设置收口

- 当前目标：移除普通用户无需理解的 Server 路由开关，并明确实验性 `select_tools` 的作用和默认策略。
- 根因：官方 Server 已是 REST/WebSocket/Web UI 的主集成边界，Kimix 也已具备能力门禁和 SDK 自动回退；继续暴露“启用 Server”和“新会话使用 Server”会产生无意义组合，并让用户承担内部路由决策。`select_tools` 仍是官方默认关闭的实验能力，不适合随路由一起默认开启。
- 已完成：新会话和 Server Host 固定自动 Server 优先，能力不足或请求失败仍走现有 SDK 兜底；历史设置字段继续兼容但不再控制路由；环境变量保留为诊断逃生口；设置页删除两个路由开关，将 `select_tools` 独立为默认关闭的“工具加载”实验项并重写说明。
- 验证：`pnpm test:run` 59 个文件、426 项测试通过；`pnpm build`、`pnpm knowledge:validate` 和 `git diff --check` 通过。
- 关键文件：`electron/kimiCodeServerHost.ts`、`electron/kimiCodeServerClient.ts`、`electron/kimiCodeHost.ts`、`src/components/settings/SettingsPanel.tsx`。
- 下一步：以 v2.15.9 检查设置页仅保留工具加载项，并验证 Server 正常和 Server 不可用时的新会话创建。

## 2026-07-11 v2.15.8 官方历史替换保留本地附件

- 当前目标：修复刚粘贴发送的图片在 Agent 运行过程中降级为 `image.png / 未读取到绝对路径` 占位卡的问题。
- 根因：粘贴图片没有操作系统绝对路径是正常现象，但本地事件原本持有可预览的 `dataUrl`；运行中历史轮询发现官方快照多出工具事件后，会整体替换本地时间线，而官方图片记录只保留名称或非内嵌引用，导致本地图片字节和拖拽路径一并丢失。
- 已完成：所有官方历史整体替换入口先按消息类型、规范化正文和最近时间匹配本地用户消息，再把本地 `dataUrl`、文件路径、附件类型和标识回填进官方时间线；官方正文、过程和工具事件仍保持权威。
- 验证：`pnpm test:run` 59 个文件、426 项测试通过；`pnpm build`、`pnpm knowledge:validate` 和 `git diff --check` 通过。
- 关键文件：`src/App.tsx`、`src/utils/eventMapper.ts`、`src/utils/__tests__/eventMapper.test.ts`。
- 下一步：以 v2.15.8 粘贴图片后让 Agent 连续运行工具并等待历史轮询，确认图片预览不会降级。

## 2026-07-11 v2.15.7 运行中滚动跟随稳定性

- 当前目标：修复 Agent 运行工具或命令时，用户已手动滚到底部却被动态内容和底部面板向上顶走的问题。
- 根因：底部 Todo/队列/输入区改变高度时只观察了消息内容、没有观察滚动视口；工具内容复用事件标识时会被误判为纯布局变化并恢复旧锚点；用户从手动浏览重新滚到底部后没有恢复自动跟随；旧的底部计算依赖末项几何位置，内容收缩时可能生成向上的目标；触摸方向判断相反。
- 已完成：跟随态统一使用 `scrollHeight - clientHeight` 的真实底部并同时观察内容和视口；仅在明确向下输入抵达底部阈值时恢复跟随，布局钳制不会误恢复；手动浏览继续保留渲染锚点和浏览器原生滚动锚定；修正滚轮、滚动条、键盘和触摸意图处理。
- 验证：`pnpm test:run` 59 个文件、424 项测试通过；`pnpm build`、`pnpm knowledge:validate` 和 `git diff --check` 通过。
- 关键文件：`src/components/chat/ChatThread.tsx`、`src/utils/scrollIntent.ts`、`src/utils/__tests__/scrollIntent.test.ts`。
- 下一步：以 v2.15.7 在 Agent 连续运行工具、Todo 面板出现/消失时，分别验证底部跟随与向上浏览不会跳动。

## 2026-07-11 v2.15.6 模型切换后的新轮次稳定性

- 当前目标：修复切换模型后发送消息时 Agent 过程头短暂消失、底栏回退旧模型的问题。
- 已完成：历史回放的 `turn.ended` 不再关闭本地新轮占位消息；恢复会话和流批处理均遵守模型切换时间边界；Assistant 增量合并会保留实际模型；重建运行时显式携带当前模型。
- 验证：定向模型、快照回放和事件合并测试 91 项通过；`pnpm build` 通过；待完成知识库和 diff 校验。
- 关键文件：`src/components/chat/Composer.tsx`、`src/hooks/useEventStream.ts`、`src/utils/kimiCodeSnapshotReplay.ts`、`src/utils/modelDisplay.ts`、`src/utils/eventMapper.ts`。
- 下一步：以 v2.15.6 切换模型后立即发送消息，确认 Agent 过程头连续显示且底栏保持新模型。

## 2026-07-11 v2.15.1 审查回归修复

- 当前目标：修复 v2.15.0 代码审查中确认的持久化旧快照覆盖、Intel Mac 更新资产识别和运行计时高频刷新问题。
- 已完成：持久化在新保存开始时丢弃失败写入遗留的旧排队快照；新增 A 失败、B 排队、C 重试的顺序回归测试。更新资产选择抽为纯函数，兼容旧版无 `x64` 后缀的 Intel Mac 产物，后续 macOS 构建统一带架构后缀；新增 arm64/x64/拒绝错误架构测试。运行耗时改为按秒对齐的 `setTimeout` 调度。
- 验证：`pnpm test:run` 59 个文件、417 项测试通过；`pnpm build`、`pnpm knowledge:validate` 和 `git diff --check` 通过。
- 关键文件：`src/utils/persistence.ts`、`src/utils/updateAsset.ts`、`electron/main.ts`、`src/components/chat/MessageBubble.tsx`。
- 下一步：完成验证并提交 v2.15.1 代码；发布由 tag 触发 GitHub Actions。

## 2026-07-10 v2.14.122 上下文压缩摘要轮次定位

- 当前目标：把本轮开始前生成的上下文压缩摘要放在用户消息与 Agent 过程/正文之间，并默认折叠。
- 根因：事件合并层虽然保留了压缩 begin/end 的相对顺序，但轮次渲染仍按到达顺序遍历 Assistant 与过程事件；压缩完成事件晚到时会落到过程末尾，摘要正文也始终挂载并默认展开。
- 修复：轮次渲染先提取并输出压缩事件，再渲染 Assistant、工具和状态；完成摘要改为 40px 可点击折叠行，默认只显示“上下文压缩完成，已生成摘要”，展开后才挂载 Markdown 正文。
- 验收：定向顺序回归测试 5/5、全量测试 54 个文件 393/393、`pnpm build`、`pnpm knowledge:validate` 均通过。
- 下一步：由用户在真实压缩会话中检查位置、默认折叠与点击展开。

## 2026-07-10 v2.14.111 底栏浮层与窄宽度适配

- 当前目标：恢复工作空间浮层，避免会话侧栏重开时误弹 Git 详情，并消除右侧栏打开后的底部按钮文字叠加。
- 根因：底栏内容组的 `overflow-hidden` 裁掉了绝对定位浮层；侧栏组件重挂载时把已消费的 Git 打开信号从 0 重放；底栏只按窗口断点隐藏控件，没有根据主内容区的真实剩余宽度收缩。
- 修复：移除浮层裁剪；关闭侧栏时清零已消费的 Git 打开信号，且清零本身不触发弹窗；底栏通过 `ResizeObserver` 在宽度低于 760px 时统一进入纯图标态，普通态统一 8px 相邻间距和按钮内边距。
- 验收：`pnpm build`、`pnpm knowledge:validate`、`git diff --check` 通过。
- 下一步：用 `v2.14.111` 分别检查侧栏开关、工作空间浮层，以及底栏普通态/纯图标态。

## 2026-07-10 v2.14.110 底部状态栏防压缩

- 当前目标：避免底部工作空间、模型、连接状态和导出按钮在窄宽度下互相挤压。
- 修复：工作空间按钮正文固定为“工作空间”；工作空间和套餐用量列保持收缩保护；模型列允许收缩，模型名按长度使用 13/12/11px 字号并继续截断，完整名称保留在 tooltip。
- 验收：`pnpm build`、`pnpm knowledge:validate`、`git diff --check` 通过。
- 下一步：用 `v2.14.110` 在长项目名、长模型名和窄窗口下检查底部按钮完整性。

## 2026-07-10 v2.14.109 更新下载走本地代理

- 当前目标：让软件内 GitHub Release 检查和安装包下载与浏览器使用同一代理路径。
- 根因：Node `fetch` 不会自动读取 `HTTP_PROXY/HTTPS_PROXY/ALL_PROXY`；原实现优先使用 Node `fetch`，下载失败才尝试 Electron `net.fetch`，元数据请求没有代理感知 fallback。当前机器环境代理为 `127.0.0.1:7890`，但 Windows 系统代理开关关闭。
- 修复：新增独立 GitHub 更新 Session，优先将环境代理配置到 Electron Chromium Session；Release API、Atom 降级和资产下载统一走该 Session，Session 失败才回退直连 Node `fetch`，不改变 Kimi 运行时全局网络。
- 验收：`pnpm build`、`pnpm knowledge:validate`、`git diff --check` 通过；真实代理下载速度尚未在本轮实测。
- 下一步：在代理软件开启时用 `v2.14.109` 测试检查更新和下载速度；关闭代理后确认仍能直连或给出明确失败。

## 2026-07-08 v2.14.106 官方思考摘要恢复

- 当前目标：让思考折叠摘要只显示官方思考的最后一段，并清除旧本地镜像里重复、黏连的思考正文。
- 根因：官方 wire 的 `think` 与 `text` 分离正确，摘要算法对干净数据也正确；但历史恢复只比较最终正文和工具过程数量，不比较 thinking，导致已损坏的本地思考缓存长期压过官方历史。
- 修复：缓存版本升级为 2；增加官方/本地思考历史比较，发现差异时用官方事件整体恢复；侧栏重新加载同样采用该判定；增加真实“盲目与瘴气”思考摘要回归测试。
- 验收：历史缓存、思考分段、事件映射共 82 项测试、`pnpm build`、`pnpm knowledge:validate` 通过。
- 下一步：重新打开该会话，确认摘要只显示 `Since the user asked...`，展开后完整思考保留且只出现一次。

## 2026-07-08 v2.14.105 子代理迟到终态去重

- 当前目标：消除同一 `agent-N` 在过程卡中出现一条有子事件、一条 0 子事件的重复完成行。
- 根因：主轮终止事件可能先把运行中的子代理收口为 completed；稍后官方正式 `subagent.completed` 到达时，旧合并逻辑只匹配开放状态，因而把终态追加成第二行。
- 修复：终态事件仍优先合并开放行；没有开放行时，按同一 `agentId` 回并最近终态行，保留已有子事件并补齐 result summary/error。新的 spawned/started 调用仍不会合并进历史终态。
- 验收：事件映射 106 项测试、`pnpm build`、`pnpm knowledge:validate` 通过。
- 下一步：验证 `66 条子事件` 的原行直接更新为已完成，不再生成 `0 条子事件` 的重复行。

## 2026-07-08 v2.14.104 子代理名称与完成态核对

- 当前目标：避免把全会话递增的 `agent-N` 内部 ID 误展示成子代理名称，并确认完成项不会被过程卡过滤。
- 根因：官方 session 的 agent ID 跨调用递增，独立 `Agent` 调用可能只有一个代理但 ID 已到 `agent-6`；缺少 `subagentName` 时 Kimix 又把该 ID 当作可见名称。
- 修复：内部 ID 仅用于生命周期合并，名称缺失时显示“子代理”；任务描述仍优先展示；修正 `swarmIndex = 0` 的编号显示。聚合卡继续统计并展示 queued/running/suspended/completed/error 全部子代理。
- 验收：`kimiCodeEventMapper` 31 项测试、`pnpm build`、`pnpm knowledge:validate` 通过。
- 下一步：验证独立 Agent 显示任务描述与完成态，并验证 Swarm 的 `#0` 编号。

## 2026-07-08 v2.14.103 Release 完整信息展示

- 当前目标：更新记录不再截取前三条正文，而是展示 GitHub Release 的完整说明。
- 根因：数据层已返回完整 `body`，但弹窗 `summarizeReleaseBody` 主动过滤标题并只保留前三个非空行。
- 修复：移除摘要函数；每条 Release 改为信息卡，正文使用现有 Markdown 渲染器完整显示标题、段落、列表、代码与链接；标题行保留 GitHub 外链入口。
- 验收：`pnpm build` 与 `pnpm knowledge:validate` 通过。
- 下一步：由用户验收三条长 Release 的完整内容、卡片间距和弹窗滚动。

## 2026-07-08 v2.14.102 Swarm 可随时开关

- 当前目标：对齐官方 Web，允许同一会话反复开启和关闭 Swarm，运行中切换在下一轮生效。
- 官方核验：SDK `session.setSwarmMode(enabled)` 明确支持 `true` 与 `false`；“开启后不能关闭”来自 Kimix 的 `sdkPinnedSessionIds` 限制，不是官方契约。
- 修复：Host 移除关闭禁令；SDK 路由固定与 Swarm 当前状态分离，关闭 Swarm 不会拆分或新建会话。空闲切换立即调用官方 API，运行中切换只记录下一轮目标，并在下次发送前应用。
- UI：Composer 常驻显示可点击的 `Swarm 开 / Swarm 关`；待生效时显示“· 下轮”。加号菜单和 `/swarm on|off` 复用同一状态逻辑。
- 活跃时间：Swarm 配置和官方状态同步不再修改会话 `updatedAt`，避免配置点击改变侧栏排序。
- 验收：Swarm 状态与事件承载相关测试 37 项通过；`pnpm build` 与 `pnpm knowledge:validate` 通过。
- 下一步：完成知识库门禁后，由用户验收空闲开关、运行中下轮开关和连续点击取消待生效三种场景。

## 2026-07-08 v2.14.101 思考按钮文案对齐

- 当前目标：让 Composer 的思考状态按钮与 `Swarm 开`、`Plan 开`使用一致的词间距。
- 修复：按钮与切换 toast 统一显示为“思考 开 / 思考 关”；不修改开关状态、运行时配置或会话恢复逻辑。
- 验收：`pnpm build` 与 `pnpm knowledge:validate` 通过。
- 下一步：由用户确认底部三个模式按钮文案间距一致。

## 2026-07-08 v2.14.100 偏好开关不再中断会话恢复

- 现象：应用启动恢复尚未完成时误点“思考开/关”，当前会话会退化为空白占位，看起来像整个会话被删除。
- 根因：主运行时事件 effect 把思考、Plan 和权限偏好列为依赖；偏好变化触发 cleanup，清除启动历史恢复定时器并注销监听，但 `bootstrapDoneRef` 已为真，重建后不会重新执行恢复。
- 修复：主运行时监听与长程任务恢复不再订阅这些偏好；真正发起操作时继续通过 `useAppStore.getState()` 即时读取最新值。开关现在只更新设置，不会重启监听、清除恢复任务或替换当前会话。
- 数据结论：该问题通常只留下空 UI 会话壳，官方会话历史没有被删除；重新加载 `v2.14.100` 会按正常启动恢复链路重新读取。
- 验收：会话历史、fallback 和持久化相关测试 9 项通过；`pnpm build` 与 `pnpm knowledge:validate` 通过。
- 下一步：完成知识库门禁后，由用户在启动加载中和已加载会话各切换一次思考开关，确认消息保持不变。

## 2026-07-08 v2.14.99 Swarm 进度与更新 fallback 修复

- 当前目标：修正 Swarm 错误满进度，并修复 GitHub Atom 更新和非视觉图片降级的真实缺口。
- 修复：Swarm 蓝色进度始终使用 `completed / total`，运行中不再强制显示 100%。
- 修复：Atom parser 安全提取和解码 `/tag/`，非法 `%` 保留原始 tag；解析任意属性顺序的 enclosure 资产。Atom 没有资产清单时，应用内升级改为打开对应 GitHub Release 页面，不再报“未找到适合当前系统的升级包”。
- 修复：非视觉模型降级同时读取 SDK 序列化的 `image_url` 和旧兼容 `imageUrl` 字段，保留图片标识。
- 验收：Atom、非视觉图片及 Kimi 事件映射测试 34 项通过；`pnpm build` 与 `pnpm knowledge:validate` 通过。
- 下一步：完成知识库门禁后，由用户验收 Swarm 0%、部分完成进度及 Atom fallback 升级入口。

## 2026-07-08 v2.14.98 Swarm 聚合状态卡

- 当前目标：对齐官方新版 Web 的 Swarm 消息流状态 UI，而不恢复独立浮动面板。
- 官方核验：公开仓库当前仍以单 Agent activity 折叠组件展示运行状态和内部步骤；用户截图中的新版聚合层尚未出现在公开源码，但底层仍由子 Agent 生命周期和步骤事件驱动。
- 修复：消息流 Swarm 卡新增任务标题、完成数/总数、进行中或失败计数、活跃状态线；子 Agent 行显示任务序号、角色及排队/运行/暂停/完成/失败状态，继续复用现有可展开子事件详情。
- 状态规则：只有 `completed` 计入完成进度；`queued/running/suspended` 计入进行中；`error` 单独计为失败。活跃 Swarm 默认展开，结束后可手动折叠。
- 验收：子 Agent 生命周期、消息流承载和终态收敛相关测试 51 项通过；`pnpm build` 与 `pnpm knowledge:validate` 通过。
- 下一步：由用户实机发起至少三个子 Agent 的 Swarm，验收运行中、部分完成、全部完成和失败四种状态。

## 2026-07-08 v2.14.97 恢复官方历史图片数据

- 当前目标：修复旧会话图片只显示“未读取到绝对路径”，无法像官方 Web 一样长期恢复的问题。
- 官方结论：Kimi Web 将上传文件保存在会话 `uploads/` 中；Kimi Server 原生提示则在 `prompt.submitted.content` 中长期保存 `type: image + source.kind: base64`。
- 根因：Kimix 历史映射只识别旧 `image_url`，忽略新版 Server `image/source`，把仍存在的 base64 图片误降级为空附件。
- 修复：普通用户消息和引导消息映射均支持 `image/source` 的 base64、媒体类型和 data URL；现有丢图历史修复会重新读取官方记录并替换空附件。
- 验收：`eventMapper` 与 `kimiCodeEventMapper` 定向测试 104 项通过；`pnpm build` 与 `pnpm knowledge:validate` 通过。
- 下一步：构建后重新打开截图中的旧会话，确认图片缩略图与预览恢复。

## 2026-07-08 v2.14.96 图片预览 Esc 与有界切换

- 当前目标：图片预览支持 Esc 退出，并取消方向键首尾循环。
- 修复：Esc 在单图和多图预览中均直接关闭预览；第一张按左/上、最后一张按右/下时保持当前图片，不再循环跳转。画板打开时仍由画板持有键盘控制权。
- 验收：`pnpm build` 与 `pnpm knowledge:validate` 通过；Esc 在单图提前返回之前处理，方向键索引使用显式边界判断。
- 下一步：由用户验收单图 Esc、多图边界和中间图片切换。

## 2026-07-08 v2.14.95 多图预览方向键切换

- 当前目标：输入框和消息流中的多张图片预览支持方向键切换。
- 修复：预览组件统一接收当前图片组；左/上切上一张，右/下切下一张并循环导航。输入框附件、用户消息及引导消息均传入各自图片组；画板打开时不接管方向键。
- 验收：`pnpm build` 与 `pnpm knowledge:validate` 通过；输入框、用户消息、引导消息三个入口均传入图片组和切换回调。
- 下一步：由用户验收输入框和消息流中的单图、多图预览。

## 2026-07-08 v2.14.94 项目行只控制展开折叠

- 当前目标：点击左侧项目行只展开或折叠项目，不再切换会话。
- 修复：项目行只更新 `expandedProjectIds`；移除非当前项目自动选择最近会话、空项目清空会话以及展开空项目自动创建会话的逻辑。具体会话行仍负责切换会话，项目右侧“新对话”按钮仍负责创建会话。
- 验收：`pnpm build` 与 `pnpm knowledge:validate` 通过；项目行处理器中已无项目/会话选择和会话创建调用。
- 下一步：由用户验收当前项目、其他项目和空项目三种点击行为。

## 2026-07-08 v2.14.93 队列编辑恢复为普通输入

- 当前目标：移除待发送消息编辑后的“修改态”和“取消修改”按钮。
- 修复：点击队列编辑只移除原队列项，将正文和附件填回 Composer 并聚焦；不再保存编辑快照、显示取消修改或把发送按钮标成保存修改，后续完全走普通输入/发送逻辑。
- 验收：代码检索确认 `editingPending`、`取消修改`、`保存修改` 已全部移除；`pnpm build` 与 `pnpm knowledge:validate` 通过。
- 下一步：由用户验收编辑队列消息后的 Composer 状态。

## 2026-07-08 v2.14.92 窄右侧栏 Git 按钮防溢出

- 当前目标：修复右侧栏压缩到较窄宽度时 Git 卡片的“推送”等三列按钮超出卡片边界。
- 根因：280px 最小侧栏扣除两层内边距后，三列按钮各约 65px，小于图标、文字、间距和按钮内边距所需宽度。
- 修复：侧栏宽度小于 340px 时 Git 主操作区切换为两列，“推送”独占第二行；340px 及以上保持三列，所有列使用 `minmax(0, 1fr)`。
- 验收：`pnpm build` 与 `pnpm knowledge:validate` 通过；窄栏两列/宽栏三列分支均由明确宽度条件控制。
- 下一步：由用户验收最窄和常规侧栏宽度。

## 2026-07-08 v2.14.91 顶部按钮真正避让右侧栏

- 当前目标：修复 v2.14.86 两列布局仍无法让顶部按钮避让会话侧栏的问题。
- 运行态根因：右侧栏展开后 `<main>` 盒子实际宽度为 615px，但其未声明 Grid 列，隐式 `auto` 列受工具栏内容最小宽度影响仍为 754.67px；顶部栏的 100% 也因此参照错误列宽，超出的约 140px 被裁切。
- 修复：主区域显式使用 `gridTemplateColumns: minmax(0, 1fr)`，顶部栏同时设置 `minWidth: 0` 与 100% 宽度；已有两列工具栏现在会在真实主区域宽度内压缩标题并完整保留按钮列。
- 验收：侧栏展开时运行态测得主区域 615px、顶部栏 613px，按钮列右边界 934px、右侧栏左边界 959px，`allActionsInside: true`。
- 下一步：构建后由用户视觉验收。

## 2026-07-08 v2.14.90 从 GitHub 获取三条 Release

- 当前目标：纠正 v2.14.89 仅裁切本地旧时间线的错误实现，更新记录必须展示 GitHub 最新三条 Release。
- 修复：更新检查改用 GitHub Releases 列表 API 返回三条记录；匿名 API 遇到 403/429 时改读同仓库 `releases.atom`；弹窗移除本地旧数组和重复的单条详情，只展示三条 GitHub Release 卡片。
- 验收：`pnpm build` 通过；Electron 运行态直接调用 `window.api.checkForUpdates()`，确认返回 `v2.14.56`、`v2.14.42`、`v2.14.0` 三条 GitHub Release。
- 下一步：由用户视觉验收更新记录弹窗。

## 2026-07-08 v2.14.89 更新记录仅显示三条

- 当前目标：更新记录弹窗只展示最新三条历史记录，避免旧记录占据过多空间。
- 修复：保留完整历史数据，只在弹窗展示层截取时间线前 3 条；GitHub 最新版本详情不受影响。
- 验收：`pnpm build` 与 `pnpm knowledge:validate` 通过；展示列表固定截取前 3 条。
- 下一步：由用户验收更新记录数量。

## 2026-07-07 v2.14.86 顶部按钮避让会话侧栏

- 当前目标：修复右侧会话侧栏展开后，顶部工具按钮仍向右溢出并被遮挡的问题。
- 根因：顶部栏使用 `flex + justify-between`，左侧长标题的内部内容宽度溢出可收缩父项，进而把固定宽度的按钮组推到主区域之外。
- 修复：顶部栏改为 `minmax(0, 1fr) auto` 两列网格，左侧标题列允许裁切，右侧按钮列始终贴住主区域右边界并随侧栏展开向左避让。
- 验收：`pnpm build` 与 `pnpm knowledge:validate` 通过；代码确认按钮列保持完整且始终位于主区域网格内。
- 下一步：由用户分别验收会话侧栏关闭、展开两种状态。

## 2026-07-07 v2.14.85 恢复正文默认字号

- 当前目标：修复今日接入全局字号设置后，默认 14px 导致 Assistant 正文比此前固定 15px 小 1px的问题。
- 结论：v2.14.83/v2.14.84 最终正文 JSX 与 v2.14.82 相同；实际缩小来自更早的 `3a6fce0`，它让 `.markdown-body` 读取全局字号，而默认和已写入配置均为 14px。
- 修复：界面正文与 Composer 默认恢复 15px，侧栏继续使用正文减 1px；旧 14px 默认配置在首次加载时一次性迁移到 15px并写入 `fontSizeBaselineVersion: 1`，之后用户主动设置 14px不会再被覆盖。
- 验收：`pnpm build` 与 `pnpm knowledge:validate` 通过；v2.14.85 运行态 `.markdown-body` 和 Composer 均为 15px、侧栏为 14px，旧配置已迁移为 `fontSize: 15`、`fontSizeBaselineVersion: 1`。
- 下一步：等待用户视觉验收正文大小。

## 2026-07-07 v2.14.84 单段过程与思考总结一致

- 当前目标：纠正 v2.14.83 的语义误判；不可展开的单段过程应与可展开思考的总结一致，而不是与最终 Assistant 正文一致。
- 根因：上一轮把用户所指的下方灰色句误认成最终正文，导致单段过程改用主文本 Markdown 样式并显示为黑色。
- 修复：可展开 summary 与不可展开单段过程共享同一个 inline typography 常量，明确固定 `14.5px / 24px / secondary / LXGW WenKai / 400`，避免全局 `button { font: inherit }` 让 button 实际回退到 15px；前者保留 hover 和展开能力，后者保持静态 div；最终正文恢复原有 Markdown 主文本样式。
- 验收：v2.14.84 运行态测得两类 summary 均为 14.5px、`rgb(74, 85, 96)`、LXGW WenKai、400 字重和 24px 行高；不可展开项为静态 `DIV/cursor:auto`，可展开项为 `BUTTON/cursor:pointer`，视觉截图确认单段过程恢复灰色总结层级。
- 下一步：完成最终构建与提交，由用户在原截图会话复验。

## 2026-07-07 v2.14.83 不可展开过程正文语义

- 当前目标：让 Kimi Web 过程流中不可展开、实际承担正文语义的单段内容，与 Assistant 正文保持相同字号、颜色、字体和格式。
- 根因：`KimiWebThinkingItem` 的不可展开分支硬编码为 `13.5px + muted`，而正文通过 `MarkdownRenderer` 使用全局聊天字号和主文本颜色。
- 修复：不可展开分支改用与 Assistant 正文相同的 `MarkdownRenderer` 和正文容器样式；可展开的思考摘要及展开详情继续保留过程层级。
- 验收：构建通过；v2.14.83 运行态比较两类 `.markdown-body`，均为当前设置下的 14px、`rgb(13, 17, 21)`、LXGW WenKai、400 字重和 23.52px 行高；运行截图确认视觉一致。
- 下一步：提交后由用户在原截图会话复验不可展开过程句和正文。

## 2026-07-07 v2.14.82 Electron 视口确定高度

- 当前目标：彻底修复长会话仍把聊天壳撑到窗口外，导致滚动条和 Composer 消失的问题。
- 运行态证据：Electron 视口和 `#root` 均为 800px，但使用 `h-full` / `height: 100%` 时 `.kimix-app-shell` 实际为 18626px，Footer 顶部位于 18437px；运行时改为固定 800px 或 `100dvh` 后，壳体恢复 800px、消息区 506px、Footer 底边 799px，正文 18332px 仅作为内部 `scrollHeight`。
- 根因：Chromium 当前包含块链中的百分比高度不是 definite size，Grid 仍按长消息的 min-content 高度扩张；前两轮只约束子级和百分比高度，未固定最外层真实视口高度。
- 修复：应用壳直接使用 `height/maxHeight: 100dvh`，不再依赖 Tailwind `h-full` 或祖先百分比高度链。
- 验收：源码 HMR 后调试协议测得视口/壳体均为 800px、主面板 752px、消息区 506px、Footer 位于 611-799px，长正文 `scrollHeight` 18332px；运行截图确认滚动条、Composer 和 ContextBar 均恢复。
- 下一步：完成构建与提交，由用户在 v2.14.82 窗口复验同一长会话。

## 2026-07-07 v2.14.81 启动会话与聊天壳确定性布局

- 当前目标：修复启动后先显示 Project06 新会话、随后自动跳到目录首个旧会话，同时长会话再次把 Composer 挤出窗口的问题。
- 根因一：应用壳使用百分比高度和 flex 收缩约束，但主布局行仍没有确定的剩余高度，短内容时主面板按内容收缩，长内容时又被反撑。
- 根因二：启动目录同步在没有 active/local session 身份时 fallback 到 `activeSummaries[0]`，异步返回后强制抢占当前会话。
- 修复：应用壳改为 `48px + minmax(0, 1fr)` Grid，聊天面板改为 `toolbar + minmax(0, 1fr) + Composer` Grid；官方目录仅在命中明确恢复身份时拥有启动导航权。
- 下一步：测试、构建并启动 v2.14.81，复验启动后不再二次跳会话，长会话滚动与输入区保持可见。

## 2026-07-07 v2.14.80 长会话布局高度约束

- 当前目标：修复长会话打开后消息区反撑应用壳，导致聊天滚动条、Composer 和 ContextBar 被裁到窗口外的问题。
- 根因：应用壳纵向 flex 链只依赖 Tailwind `min-h-0`，关键容器没有同时显式约束 `height/minHeight/overflow`；长消息流的最小内容高度可反向撑大主列，而根页面禁止滚动。
- 修复：应用壳、主布局行、聊天主面板、ChatThread 根节点显式固定可用高度并允许 flex 子项收缩，消息溢出只交给内部聊天滚动容器处理。
- 下一步：构建并启动 v2.14.80，由用户打开截图中的长会话确认滚动条、输入框和底部状态栏恢复。

## 2026-07-07 v2.14.79 Release notes 准备

- 当前目标：为已完成的 0.23.0 对齐与本轮修复补齐专属 Release notes，避免发版时复用旧说明。
- 已完成：新增 `docs/release-notes/v2.14.79.md`，按功能、修复、改进聚合 `v2.14.56..HEAD` 的 34 个 commit；已通过 `pnpm knowledge:validate` 并提交。
- 下一步：如用户确认发布，再推送 `master` 并打 `v2.14.79` tag 触发 GitHub Actions。

## 2026-07-07 Kimi Code 0.23.0 对齐 TodoList

- [x] 官方 Web 本地消息队列：展示、删除、重排、附件状态保留。
- [x] 官方 `select_tools` 实验开关与模型能力展示。
- [x] 官方归档会话恢复与本地归档兼容。
- [x] Swarm footer / 浮动卡收敛到消息流 inline 过程卡。
- [x] AskUserQuestion 可读答案格式兼容。
- [x] `@` 文件补全覆盖额外工作目录和深层文件。
- [x] Preserved Thinking 默认值对齐官方：Kimi 模型默认保留思考，第三方/DeepSeek 等模型按能力降级。
- [x] 上下文压缩 summary 展示对齐官方：压缩完成后能在消息流里看到可读 summary，而不是只有开始/结束胶囊。
- [x] Bash/Edit 工具过程卡稳定性复核：长命令、后台命令、编辑 diff/审批上下文在消息流里与官方 0.23 表达一致。
- [x] Plan reminder / notice 对齐：进入 Plan 模式后的官方提醒、退出计划审批与本地 Plan 预览不重复、不丢失。
- [x] Gemini thinking signature / 第三方 thinking 兼容：确认历史回放和实时事件不丢签名相关字段，不误显示为空思考。
- [x] 0.23.0 Web 视觉细节巡检：Swarm inline、问题卡、文件补全、队列卡在 Kimix / Kimi Web 两种过程模式下无重复展示。

## 2026-07-07 v2.14.74 上下文压缩摘要展示

- 当前目标：继续对齐 Kimi Code 0.23.0，让上下文压缩完成后展示官方返回的可读 summary。
- 根因：`compaction.completed` / `CompactionEnd` 在事件映射时只保留 begin/end phase，`summary`、`result.summary`、`payload.summary` 等字段进入 UI 前被丢弃。
- 修复：压缩事件类型新增 `summary`；SDK 和旧 stream mapper 均保留 summary；聊天流在完成态有摘要时渲染为小摘要卡，无摘要时保持原来的短胶囊。
- 下一步：继续复核 Bash/Edit 工具过程卡稳定性。

## 2026-07-07 v2.14.75 Bash/Edit 工具过程卡官方展示字段

- 当前目标：继续对齐 Kimi Code 0.23.0，复核 Bash/Edit 工具过程卡在长命令、后台命令、编辑 diff/审批上下文里的展示来源。
- 根因：官方 `tool.call` 会附带 `description` 和 `display` 元数据，但 Kimix 只保留 args/result；因此 Bash 的 `Running:` / `Starting background:` 和 display command/cwd 可能被本地 preview 覆盖。
- 修复：工具调用类型保留官方 `description/display`；SDK 与 native mapper 均解析这些字段；工具结果合并时不覆盖已保存的 display；Kimi Web 过程行优先展示官方 description，并继续保留 Edit structured diff。
- 下一步：继续对齐 Plan reminder / notice。

## 2026-07-07 v2.14.76 Plan 审批展示对齐官方

- 当前目标：继续对齐 Kimi Code 0.23.0，确保官方 Plan reminder 不重复显示，ExitPlanMode 审批里的计划正文和多方案选项不丢失。
- 根因：system-reminder 已会被 Kimix 剥离，但官方 ExitPlanMode approval 的 `display.kind=plan_review`、`plan`、`path`、`options` 只存在于 display 内，旧 mapper 未保留；审批响应也无法回传官方多方案 `selectedLabel`。
- 修复：approval 事件保留官方 display；审批卡在 `plan_review` 时展示计划正文、路径和多方案选项；IPC/host 响应支持 `selectedLabel`，普通工具审批保持原按钮语义。
- 下一步：继续确认 Gemini thinking signature / 第三方 thinking 兼容。

## 2026-07-07 v2.14.77 第三方 thinking signature 保留

- 当前目标：继续对齐 Kimi Code 0.23.0，确认 Gemini / 第三方 thinking 的 signature 元数据在实时事件和历史回放中不丢失，也不会被误显示为空思考。
- 根因：官方 thinking content schema 支持 `signature`，但 Kimix `ThinkingPart` 只存 text；server snapshot replay 也只转发 thinking 文本。
- 修复：`ThinkingPart` 新增可选 `signature`；SDK/native mapper 从 `thinking.delta`、`content.part` 的 `think/thinking` 中保留 signature；server snapshot replay 透传 signature；空 thinking 仍返回 null，不进入可见思考块。
- 下一步：做 0.23.0 Web 视觉细节巡检。

## 2026-07-07 v2.14.78 Preserved Thinking 默认值

- 当前目标：继续对齐 Kimi Code 0.23.0，让 Kimi 模型默认沿用官方 preserved thinking，第三方/DeepSeek 等模型按能力显式降级。
- 根因：Electron `startRuntime` 已对 Kimi 默认不传 `thinking`，但 Server client 在创建会话时把缺省值转成 `"off"`，导致走官方 Server 路由时 Kimi 默认思考被意外关闭。
- 修复：Server 创建会话仅在 Kimix 明确传入 `thinking` 时写入 agent_config；DeepSeek/用户关闭思考仍会显式传 `"off"`；Server managed session 不再把缺失 thinking 状态硬标记为 off。
- 下一步：做 0.23.0 Web 视觉细节巡检。

## 2026-07-07 v2.14.79 Kimi Web 过程视觉巡检

- 当前目标：完成 0.23.0 Web 视觉细节巡检，确认 Swarm inline、问题卡、文件补全、队列卡在 Kimix / Kimi Web 两种过程模式下无重复展示。
- 巡检结论：`SwarmPanel` 浮动面板已无残留；Swarm 子代理只通过消息流 process summary / Kimi Web process list 展示，Composer 底部仅保留状态按钮；`QuestionCard` 只有 `ChatThread` 独立事件入口；`@` 文件补全只在 Composer 候选层；本地 prompt queue 已在官方 active/queued 存在时延后派发。
- 验收：相关测试覆盖 Swarm lifecycle/reduce、subagent-only assistant header、官方队列延后、本地 slash routing；完整构建通过。
- 下一步：等待用户实机截图验收，若无反馈则 0.23.0 对齐 TodoList 已全部完成。

## 2026-07-07 v2.14.73 @ 文件补全覆盖额外目录和深层文件

- 当前目标：继续对齐 Kimi Code 0.23.0，修复 `@` 文件补全在额外工作目录和深层目录里容易搜不到文件的问题。
- 根因：Composer 只把当前项目传给 `project:searchFiles`；本地 fallback 也只搜索项目根且递归深度上限为 8。
- 修复：`project:searchFiles` 支持 `additionalWorkDirs`；本地 fallback 同时搜索当前项目和额外工作目录，深度上限提高到 32；额外目录命中的候选使用绝对路径插入，避免与项目相对路径混淆。
- 下一步：实机在设置里添加额外工作目录，用 `@深层文件名` 验证可补全并能正确发送给 Kimi Code。

## 2026-07-07 v2.14.72 AskUserQuestion 可读答案兼容

- 当前目标：继续对齐 Kimi Code 0.23.0，修复结构化提问从内部 id 答案迁移到可读问题/选项文本后的兼容边界。
- 根因：Kimix UI 已按“问题文本 -> 选项标签”提交答案，但 Server 路由转换仍只按官方 `question.id` 取值；当官方问题 id 是 `q_0` 等内部值时，会取不到用户选择并回退到第一个选项。
- 修复：问题事件保留官方 question/option id，同时 UI 继续保存可读答案；Server 回答转换同时兼容 id key 与问题文本 key，选项匹配同时支持 option id 与 label。
- 下一步：实机触发一次 AskUserQuestion，确认选择非首个选项时 Server/SDK 路由都能按真实选择继续。

## 2026-07-07 v2.14.71 Swarm 展示全局收敛到消息流

- 当前目标：让 Swarm 不再使用输入区上方浮动面板，所有模式都以消息流里的过程卡为准。
- 修复：移除 Composer 浮动 `SwarmPanel` 和右侧收起恢复入口，避免 Swarm 展示来源分散。
- 修复：如果 Swarm 子代理事件先于 assistant 正文出现，会生成空 assistant 承载 `leadingSubagents`，确保实时进度仍进入消息流过程卡。
- 下一步：实机用 Swarm 会话验证 Kimix / Kimi Web 两种过程展示模式都只在消息流内显示子代理进度。

## 2026-07-05 v2.14.44 活跃轮次刷新恢复与正文漏流回补

- 根因一：Ctrl+R 后启动恢复无条件结算历史事件并清空 `runningSessionId`，没有复核主进程仍存活的官方 turn。
- 根因二：Server snapshot 把 `in_flight` Assistant 错误转换出 `turn.ended`，导致活跃正文在恢复时被标记完成。
- 根因三：运行态轮询只检查官方 status，不回补 snapshot；WebSocket 正文事件漏流后界面会长期停在旧内容。
- 修复：恢复历史前查询官方状态，running / waiting 状态保留忙态和未完成事件；禁止 in-flight snapshot 产生结束事件；运行中超过 4 秒没有正文过程事件时，节流读取官方 snapshot，仅在正文或过程信息更丰富时更新本地镜像。

## 2026-07-05 v2.14.43 全部复制按钮字号对齐

- 助手消息底部“全部”复制按钮由 12px 调整为 13px，与右侧状态信息气泡文字一致。
- 保持按钮 32px 高度、图标尺寸和既有留白不变，避免底部操作行位移。

## 2026-07-04 v2.14.42 扁平过程流思考详情灰度

- 根因：Kimi Web 扁平过程流的思考总结和展开详情同时使用 `--kimix-panel-text-secondary`，v2.14.41 只命中了另一套卡片详情组件。
- 修复：实际展开详情改用 `--kimix-panel-text-muted`，总结仍使用 secondary，形成可测量的色值差异。

## 2026-07-04 v2.14.41 思考详情文字层级

- 展开的思考详情使用过程灰色，与上方总结及最终正文形成明确层级。
- 仅限定 `.kimix-thinking-detail` 内的 Markdown，不影响普通助手正文、工具结果或导出内容。

## 2026-07-04 v2.14.40 历史会话模型显示校准
- 当前目标：修复打开历史会话时底部显示旧默认模型，发送一轮后才变为正确模型的问题。
- 根因：ContextBar 优先使用 session.model，压过事件中最后实际使用模型；启动和侧栏 history hydration 载入事件后没有用事件模型回写 session.model。
- 修复：新增 getSessionModelForDisplay；普通历史优先最后 assistant/status 实际模型，只有手动切换尚未产生新 assistant 时优先 session.model；启动和侧栏 hydration 均从最终采用的事件集回写 model。
- 下一步：实机直接打开截图会话，确认发送前底部即显示 deepseek-v4-flash；手动切换模型后仍立即显示新模型。

## 2026-07-04 v2.14.39 会话真实活跃排序与启动恢复
- 当前目标：修复最近 4 分钟会话未排顶部，以及退出时所在会话在重启后没有恢复的问题。
- 根因：Sidebar 列表、项目默认选择和启动 fallback 仍按容易被配置/目录同步刷新的 session.updatedAt 排序；Bootstrap 回调再次读取 active context，可能读到被启动初始化订阅覆盖后的值；恢复只匹配本地 UI id，未覆盖 runtime/official/Skill parent 身份。
- 修复：共享 compareSessionsByRecentConversation 按最后 user/steer/assistant 时间排序，仅无对话事件时回退 updatedAt；Sidebar、项目选择和启动 fallback 统一使用；模块加载时冻结退出 active context，Bootstrap 和本地恢复只消费该快照，并按完整 runtime 身份匹配保存会话。
- 下一步：实机确认 4 分钟会话排在项目顶部；停留该会话退出并重启后仍打开同一会话。

## 2026-07-04 v2.14.38 撤回到输入框
- 当前目标：修正“重新发送”语义；点击后不自动发送，而是删除该轮并把原消息恢复到输入框供用户修改。
- 修复：最新用户轮次按既有官方 undo 边界撤回，成功后从本地事件流删除该用户消息及其输出，通过 session-scoped 事件恢复文本和图片/文件附件到 Composer，并聚焦输入框；不创建 assistant 占位、不设置 running、不调用 sendPrompt。
- 边界：较早节点继续禁用；官方 undo 失败保留原轮次并显示真实错误；输入框已有草稿会被本次明确撤回的内容覆盖。
- 下一步：实机验证点击最新消息撤回后，该轮用户/assistant/tool 内容消失，原文本与附件进入输入框，可修改后手动发送。

## 2026-07-04 v2.14.37 最新轮次官方语义重发
- 当前目标：让用户消息“重新发送”与官方语义一致，不再保留该轮旧 assistant/tool 输出。
- 根因：原重发只追加一轮相同消息，没有调用官方历史撤回，也没有截断 Kimix 本地事件，因此旧输出和新输出同时存在。
- 修复：仅允许最新用户输入重发；已有真实输出时先调用官方 undoHistory(1)，成功后从目标用户节点截断本地事件并重新发送；失败/孤立本地消息跳过官方 undo，避免误撤上一轮真实历史；官方 undo 失败时保留原轮次并显示真实错误。
- 边界：官方 undo 只回退对话上下文，不回滚已经发生的文件、命令或外部副作用；较早节点在完成官方消息身份映射前保持禁用。
- 下一步：实机验证最新成功轮次重发后旧输出消失，新输出从同一位置重新生成；旧消息重发按钮显示禁用提示。

## 2026-07-04 v2.14.36 流式输出中手动滚动防跳
- 当前目标：修复 AI 正在输出正文时，用户向上滚动会出现内容跳动的问题。
- 根因：用户上滚后 auto-follow 已暂停，但 contentVersion 流式更新仍可能立即用旧 resize anchor 调用 restoreManualScrollAnchor，把视口拉回旧锚点；滚动中的新锚点尚未捕获完成。
- 修复：记录最近用户滚动时间；用户滚动保护窗口内，contentVersion 更新只刷新“回到底部”按钮并延迟捕获新锚点，不再立即按旧锚点恢复 scrollTop；连续滚动时保护窗口随 scroll 事件延长。
- 下一步：实机验证 AI 流式输出时向上滚动，视口不再上下抖动；停滚后仍可稳定显示回到底部按钮。

## 2026-07-04 v2.14.35 重发轮次计时修复
- 当前目标：修复点击用户消息“重新发送”后，新 assistant 直接显示旧轮次“处理了 30 分钟”的问题。
- 根因：重发只追加 assistant 占位，没有追加新的 user_message；ChatThread 分组把新 assistant 归到旧用户消息所在轮次，turnStartedAt 继承旧时间。
- 修复：用户气泡重发和错误卡重试都会追加新的 user_message、parent ipc status 和 assistant 占位，形成新的轮次边界；失败时标记占位结束并追加错误卡，避免静默留下处理中。
- 下一步：实机验证点击旧消息重发后，新消息气泡和新 assistant 成对出现，过程计时从 0 秒附近开始。

## 2026-07-04 v2.14.34 孤立失败消息撤回入口
- 当前目标：修复 v2.14.33 后部分失败发送残留只剩孤立用户气泡、看不到撤回按钮的问题。
- 修复：撤回入口除识别本地失败发送状态/错误卡外，也识别“当前会话不在 running，且用户消息后没有任何真实输出”的孤立本地发送残留；删除时仍复用本地事件清理逻辑，避免误删已有 assistant/tool/subagent 等真实输出。
- 边界：会话仍在 active turn 时，不对孤立末尾用户消息开放删除，防止删除正在发送中的正常消息。
- 下一步：实机验证截图场景里第二个“卡住了吗”气泡 hover 后显示删除按钮，点击后该孤立气泡消失。

## 2026-07-04 v2.14.33 失败发送本地撤回
- 当前目标：允许删除失败发送产生的用户消息，并同步移除 Kimix 本地错误信息，做到“像没发生过”。
- 修复：用户气泡操作区收紧间距；失败发送的用户消息新增删除按钮；删除用户消息时会清理同一发送尝试里的 parent status、空 assistant 占位和紧随错误卡；错误卡关闭按钮改为从 session events 移除错误。
- 边界：删除只影响 Kimix 本地展示，不回滚已经进入官方 runtime 的远端上下文；如果消息后面已经有真实 assistant 正文，不会误删正文。
- 下一步：实机验证失败消息删除后，用户气泡、发送中状态和错误卡一起消失，重进会话不会恢复。

## 2026-07-04 v2.14.32 Swarm 长轮次 busy 状态防提前完成
- 现象：Swarm 子代理仍在执行时，Assistant footer 已显示“已完成”，输入区允许发送；再次发送后官方报 `Cannot launch a new turn while another turn is active`。
- 根因：Kimix 的 stale 防卡死逻辑把超过 2 分钟的 running 子代理/工具排除在 active 判断之外；同时 runtime status 轮询看到 terminal/idle 后清理 `runningSessionId`，导致 UI 提前解锁，但官方 runtime 仍有 active turn。
- 修复：新增“未闭合工作项”判断，和原“近期活跃工作项”分离；status 轮询在本地仍有 open 子代理/工具/assistant 时不清 `runningSessionId`；Assistant footer 也使用 open work 判断保持“运行中”。
- 下一步：实机验证 Swarm 长时间运行超过 2 分钟时，底部仍显示运行中，输入区不允许发起新 turn，直到官方真正结束。

## 2026-07-04 v2.14.31 Swarm 子代理明细展开
- 当前目标：让 Kimi Web 风格过程区里的 Swarm 子代理可以查看子事件，同时避免大量子代理和大量事件造成层层嵌套。
- 修复：子代理行在存在 `subagent.events` 时支持展开；明细用一层紧凑时间线展示，工具调用/结果按 `toolCallId` 合并，assistant/thinking/status/error 显示短摘要。
- 边界：默认显示最近 8 条子事件，可手动展开全部；展开状态只在组件本地保存，不写入 session，不影响侧栏排序或历史。
- 下一步：实机验证 Swarm 大量子代理时，展开/收起是否顺滑、信息是否够用、页面高度是否可控。

## 2026-07-04 v2.14.30 Swarm 会话级锁定入口
- 当前目标：恢复 Swarm 主打入口，同时避免为 Swarm 再引入会话分支、同名对话或 Server/SDK 路由漂移。
- 修复：`+` 菜单在“需求澄清”下方新增 Swarm 模式；空闲会话可开启，运行中提示本轮结束后再开启；开启后本会话锁定，不能关闭。
- 路由边界：Server-backed 会话开启 Swarm 时同一个官方 session id 切到 SDK route，并在 Host 层 pin 住，后续 prompt 不再自动 promote 回 Server。
- 下一步：实机验证空会话/已有空闲会话开启 Swarm 后，不新增同名对话，下一条消息进入 Swarm，运行中点击只提示不切路由。

## 2026-07-04 Kimi Code 0.22.x 官方能力复核
- 当前目标：确认官方最近版本里哪些能力可以减少 Kimix 内部兼容层，而不是继续用曲线救国。
- 已完成：确认本机 CLI 与 npm latest 均为 `0.22.2`；`scripts/probe-kimi-code-plugins.mjs` 改为隔离临时 `KIMI_CODE_HOME` fixture，验证 SDK/RPC 可 `listPluginCommands()` 并 `activatePluginCommand()`，成功产生 `plugin_command.activated`、`turn.started/ended` 和 `session.meta.updated`。
- 已完成：临时验证 vendored SDK 导出 `compressImageForModel` / `compressBase64ForModel`，小图和非图片输入会安全 passthrough。
- 未完成：Server REST 是否有 plugin command 等价 endpoint 尚未确认；图片压缩仍需大图样本回归；历史/中断兼容层需用本地样本复验后再删。
- 下一步：优先做 SDK route 的 plugin commands 只读补全与激活入口；Server route 暂不强行接入，避免再次引入隐形分支。

## 2026-07-04 v2.14.29 SDK route 接入官方 Plugin commands
- 当前目标：把已验证的官方 Plugin manifest commands 接入 Kimix，减少静态 slash/兼容命令压力。
- 已完成：SDK route 的 `listSlashCommands` 会合并 `session.listPluginCommands()`，补全显示 `/<pluginId>:<commandName>`；发送当前 session 已知的 plugin command 时调用官方 `activatePluginCommand()`；Server route 明确不接，避免命令落到临时插件管理会话。
- 边界：未知 slash 仍透传；Server route 等官方公开等价 API 后再接入。

## 2026-07-04 v2.14.28 Skill 缺失优先同会话 reload
- 现象：为了让已有会话识别新同步的 Skill，Kimix 过去直接 fork 出 `skill-*` runtime，造成同名会话、历史回退和侧栏折叠等一系列兼容补丁。
- 探针：Kimi Code 0.22.2 SDK/RPC 的 `reloadSession` 可在同一个 session id 下刷新 Skill 视图并成功 activate；Server REST 仍没有公开 reload endpoint，活跃 Server session 经 SDK reload 后 Server REST 视图不会更新，但 SDK route 可在同一 id 上 activate。
- 修复：`reloadKimiCodeSession` 对空闲 Server 会话改为同 id SDK reload 并将该会话切到 SDK route；Composer 在 Skill 缺失时优先 `prepare -> reload -> list/activate`，只有 reload 失败或仍不可见时才 fallback 到原 `skill-*` fork。

## 2026-07-04 v2.14.27 Assistant footer Hook 徽标右置
- 现象：有 Hook 命中时，Assistant 底部元信息行左侧同时显示复制、全部复制和“钩子 1”，宽度超过中间状态胶囊预留，导致模型、时间、Tokens、Context 信息互相挤压省略。
- 修复：保持 footer 小改动结构，把 Hook 徽标从左侧复制操作区移到右侧绝对区，和左侧复制按钮形成左右分区，减少对中间状态胶囊的挤压。

## 2026-07-04 v2.14.26 历史会话打开不污染标题和排序
- 现象：点击旧会话 `5b6abf5a-3edf-4b4b-beac-5d817e563e0c` 后，侧栏标题从目录标题变成历史首条消息“最近怎么样”，并且该会话跳到项目会话列表顶部。
- 根因：侧栏打开历史时把只读 hydration 当成会话活动更新：完整历史回填后无条件 `deriveSessionTitle()` 重算标题，同时写入 `updatedAt: Date.now()`，导致排序按“刚刚”重排。
- 修复：侧栏和搜索面板加载历史只补 events / cache / loading；已有非默认标题保持不变，只有默认占位标题才从历史派生；打开历史不刷新 `updatedAt`。

## 2026-07-04 v2.14.25 侧栏 stale Skill mirror 标题去重
- 现象：v2.14.24 仍在刚打开时显示两个同名会话，说明两条本地持久化镜像没有共享 runtime/official/skillForkParent 身份链；点击后能打开并折叠，说明它们实际仍是 Skill fork 的父/leaf stale mirror。
- 修复：侧栏即时去重在身份链之外增加保守标题兜底：同项目、同标题，且至少一条带 `skill-*` 身份或 `skillForkParentSessionId` 时，按透明 Skill fork 镜像只展示一条；普通同名会话仍不按标题合并。

## 2026-07-04 v2.14.24 侧栏首屏 Skill fork 去重
- 现象：v2.14.23 已修复点击后可打开历史，但刚启动首屏仍短暂显示两个同名 Skill fork 会话，点击后才折叠为一个。
- 修复：侧栏渲染入口按 runtime/official/skillForkParent/longTask 身份做即时去重，优先保留当前会话或 skill leaf 后继，避免等待官方目录 reconciliation 后才消除重复。

## 2026-07-04 v2.14.23 Skill fork 本地父会话兜底
- 现象：v2.14.22 仍会在首屏显示两个同名会话，点击后只剩一个但一直停在“正在同步最新会话”。现场说明官方目录可能只返回 `skill-*` leaf，父会话只存在于 Kimix 本地镜像，且选中缓存会话时旧 `isLoading` 没被清理。
- 修复：目录折叠在 metadata 丢失时也会用本地同项目同标题的唯一非 `skill-*` 镜像推断父会话；启动恢复和侧栏点击都会在 `skill-*` leaf 历史为空时回退读取父历史；点击已有缓存会话会清除 stale loading。

## 2026-07-04 v2.14.22 Skill fork 同名会话折叠与历史兜底
- 现象：为刷新 Skill 注册表生成的 `skill-*` 透明 fork 在部分官方兼容链路下丢失 metadata，侧栏会出现两个同名会话；点击后虽然折叠成单项，但可能用空的 `skill-*` 历史加载而卡在同步。
- 修复：官方目录合并时对 metadata 丢失的 `skill-*` 按同项目同标题最近父项推断透明 fork 链，折叠到原本地会话并记录父会话；打开该会话时若 `skill-*` 历史为空，则回退读取父会话历史。

## 2026-07-04 v2.14.21 Kimi Web 过程区到正文距离
- 现象：Kimi Web 过程摘要线、展开详情与最终正文之间的垂直距离偏远，折叠/展开后都显得过程区和正文脱节。
- 修复：仅在 Kimi Web 展示模式下收紧过程区底部 padding 与过程区到正文的父级 gap；普通 Kimix 过程卡片间距不变。

## 2026-07-04 v2.14.20 Kimi Web 不可展开过程句字号
- 现象：Kimi Web 过程里不可展开的过程句虽然代表 Assistant 正文含义，但字号仍按辅助过程文本显示，比正文小。
- 修复：Kimi Web 思考/工具过程主文本改为与普通正文一致的 14.5px 字号和 24px 行高；辅助计数、状态图标维持小字号层级。

## 2026-07-04 v2.14.19 不可展开过程行取消禁用光标
- 现象：对话过程里不可展开的思考/工具/过程摘要行使用 disabled button，鼠标悬停时显示禁止符号，也影响文字选择和复制。
- 修复：可展开项仍渲染为 button 并保留 hover/点击展开；不可展开项改为普通文本容器，不使用 disabled button，不显示 hover 反馈，也不阻断选择文本。

## 2026-07-04 v2.14.18 手动滚动锚点大位移恢复
- 现象：v2.14.17 实测切换权限后仍会顶到顶部；截图确认版本已是 v2.14.17。
- 证据：日志中 `restoreManualScrollAnchor` 多次显示 `restored:true`，但 `beforeScrollTop:0`、`afterScrollTop:0`、`beforeDistance:8127`、`afterDistance:8127`，说明恢复函数找到锚点却没有真正移动滚动位置。
- 根因：`restoreResizeScrollAnchor()` 只允许 300px 内的小位移恢复，权限切换后的跳顶需要恢复约 8127px，被阈值拦掉；同时函数在找到锚点但未应用位移时仍返回 `true`，造成诊断假阳性。
- 修复：普通 resize 仍保留 300px 安全阈值；手动滚动锚点恢复使用无限位移上限来处理跳顶，并记录 delta、锚点偏移、目标节点和是否超过默认阈值。

## 2026-07-04 v2.14.17 权限切换后手动滚动锚点保持
- 现象：v2.14.16 诊断确认，刚进入会话时反复切换权限不跳顶；只要用户滚轮操作后，再切换权限就会把聊天流顶到顶部。
- 证据：同一权限切换 trace 中，点击和 `setPermissionMode` 当帧仍可读到原滚动状态；约后续帧/内容版本变化后 `scrollTop` 变成 0，且当时 `userHasScrolled=true`、`userScroll=true`、`autoFollow=false`，说明不是主动追底，而是手动滚动状态下布局提交缺少锚点保护。
- 根因：用户滚动后没有在 `handleScroll` 安排当前可见锚点捕获，权限切换引发菜单关闭、runtime 状态快照或 Markdown 延迟布局提交时，`restoreResizeScrollAnchor()` 没有可靠锚点可恢复，浏览器/React 布局可把滚动容器复位到顶部。
- 修复：用户滚动时 idle 捕获可见锚点；权限切换诊断事件到达时立即捕获锚点，并在 rAF1/rAF2 与 `contentVersion` 变化后恢复手动滚动锚点。

## 2026-07-04 v2.14.16 权限切换跳顶诊断
- 现象：v2.14.15 实测切换权限模式仍会瞬间顶到当前会话流顶部，前几轮基于推断的滚动修复没有命中根因。
- 本轮策略：停止继续猜修，先写可对齐事件顺序的诊断日志；`Composer` 为点击、菜单关闭、延后切换、SDK `setPermission` 前后和 UI 权限状态写入前后打同一 `traceId`；`ChatThread` 监听权限诊断事件并记录 immediate / rAF1 / rAF2 的滚动状态，同时增加 `scrollJumpNearTop` 捕捉从中下位置突然到顶部附近的瞬间。
- 待验收：用户启动 v2.14.16 后复现一次跳顶，回传诊断日志，重点搜索 `[Composer] permissionMode`、`[ChatThread] permissionDiag`、`[ChatThread] permissionDiag rAF1`、`[ChatThread] permissionDiag rAF2`、`[ChatThread] scrollJumpNearTop`。

## 2026-07-04 v2.14.15 权限切换污染 Assistant footer
- 现象：点击切换权限后，上一条 Assistant 底部模型 / 时间 / Tokens / Context 元信息会闪一下，时间变成切换权限时刻，随后又被显示规则挤掉。
- 根因：权限切换后的官方 runtime 会发 `agent.status.updated` 快照；Kimix 把它作为普通 `status_update` 追加到会话，`turn_end` 规则又把同一轮最后一个 status 当作 Assistant footer，导致配置操作的 idle 状态污染了上一条回复元信息。
- 修复：事件入库前区分 runtime 快照和真实轮次状态；空闲 `agent.status.updated` 不再进入消息流，活跃轮次状态和 `usage.record` 仍保留。

## 2026-07-04 v2.14.14 权限切换消息气泡闪烁
- 现象：切换权限模式时，消息的信息气泡会闪一下，视觉上像突然变长一段又变短。
- 根因：v2.14.13 移除了 `ChatThread` 自身的权限订阅，但父级 `AppShell` 仍订阅 `permissionMode`；React 父组件重渲染会继续调用未 memo 的 `ChatThread`，导致整棵消息流重新渲染，离屏 Markdown/气泡高度可能重新估算后再测回真实高度。
- 修复：将 `ChatThread` 改为无 props memo 组件，让权限切换只更新 Composer/设置等真实消费者，不再打穿到消息流。

## 2026-07-04 v2.14.13 反复权限切换顶到顶部
- 现象：v2.14.12 后反复切换权限仍会偶发把聊天流顶到当前会话最顶部。
- 根因：上一轮只阻断了权限恢复写回当前会话对象，但 `ChatThread` 仍无意义订阅 `permissionMode`，每次权限切换都会重渲染聊天流；同时底部权限菜单/控件开合触发 ResizeObserver 时，即使消息内容没变，也可能走 auto-follow 的 `scrollToBottom`，在 popover 开合瞬间 last item 测量失真时得到接近 0 的目标滚动位置。
- 修复：移除 `ChatThread` 对权限模式的订阅；ResizeObserver 记录消息内容版本，只在消息内容真正变化时允许自动追底，非消息布局变化仅恢复当前视口锚点。

## 2026-07-04 v2.14.12 权限切换滚动闪烁
- 现象：切换权限模式时，聊天流会短暂闪到当前会话顶部再回到底部。
- 根因：v2.14.11 的 inactive runtime 权限恢复成功后，会把恢复出的 runtime ID 写回会话，同时刷新 `updatedAt` 并替换 App 当前会话对象；权限配置变化被 UI 当成当前对话更新，可能扰动聊天流滚动状态。
- 修复：权限恢复只修正会话 store 中的 runtime/official session ID，不刷新会话活动时间，也不替换当前聊天对象；权限模式成功后仍正常提示并生效。

## 2026-07-04 v2.14.11 空闲旧会话权限切换兜底
- 现象：v2.14.10 只读打开旧会话后切换权限，官方返回 `Kimi Code session is not active`。
- 根因：旧会话导航不再预热 runtime，但空闲权限切换仍直接调用 `setPermission`，默认假设 session 已注册到 Host。
- 修复：权限切换仅在 inactive 错误时恢复原 session，校验恢复后的工作目录仍属于当前项目，再对实际 runtime ID 重试；成功后才更新 UI 权限，失败不创建新会话并保留原模式。

## 2026-07-04 v2.14.10 旧会话恢复与虚假长计时
- 现象：打开旧会话 `skill-4e88274b-eba5-4834-a04c-4621ddbf8379` 后，残留工具被重新显示为运行中，过程计时增长到 441 分钟。
- 证据：官方 wire 中工具调用时间为 2026-07-03 15:16，恢复 session 时才补写 `Tool execution was interrupted...` 结果，相差约 26,467 秒；该跨度被误当成工具执行时长。
- 根因：选中旧会话触发 runtime 预热 `resume`，唤醒了未收尾 turn；事件合并又把所有 tool result 当成功，并直接用结果时间减调用时间。
- 修复：删除选中会话时的自动 runtime 预热；仅发送消息等真实操作才恢复 runtime。过期 running 工具和官方恢复性中断按失败收尾，不生成跨恢复期耗时。

## 2026-07-03 v2.14.8 移除普通消息自动 fork
- 现象：用户没有主动派生，但新对话首次发送、或本地 Skill 修改后继续旧对话时，官方 session 会自动增加。
- 根因：每条普通消息发送前都同步全部 Agent Skills，并用所有 Skill 的最大 mtime 对比会话 `skillRegistrySyncedAt`；新会话初值为 0，因此只要本机存在 Agent Skills，首次普通消息必然 fork，任何 Skill 更新还会让所有旧会话在下次发送时 fork。
- 修复：普通消息不再同步或 fork Skill 注册表；当前 runtime 已能识别的 Skill 直接激活。只有用户明确调用当前 runtime 不可见的 `/skill:...` 时，才允许准备目标 Skill 并执行一次受控迁移。

## 2026-07-03 v2.14.7 Skill fork 会话链折叠
- 现象：侧栏持续增加多个同名对话，看起来像每轮都产生了分支。
- 根因：为刷新官方 Skill 注册表，Kimix 会 fork 当前 runtime 并把原 UI 会话迁移到子 runtime；官方目录仍同时返回父、子、孙，目录对账只按单个 ID 匹配，遂把旧祖先重新补成独立侧栏项。
- 修复：SDK 目录透传 `state.json` 中的 `source/forkedFrom`；目录对账只折叠 `skill-* + source=kimix-fork` 的透明迁移链，保留最新叶子 runtime、本地正文和 UI 会话 ID，并归档重复祖先镜像。独立同名会话和手动 `fork-*` 分支不按标题合并。

## 2026-07-03 v2.14.6 权限切换绑定真实轮次边界
- 现象：超过两分钟的最后一个工具仍在运行时，延后的权限切换可能提前生效，随后没有 Assistant 正文。
- 根因：Composer 以 `isCurrentSessionRunning` 下降沿代替官方轮次结束；该派生状态会受两分钟活动事件过期、`runningSessionId` 抖动和 status 对账影响，并不等价于 `turn.ended`。
- 修复：待切换权限绑定 UI 会话与 runtime ID；仅同一 runtime 的非快照 `turn.ended` 能消费，工具完成、轮询终态和历史/在途快照回放均不能提前触发。

## 2026-07-03 v2.14.5 运行中权限切换隔离
- 现象：切换权限模式偶发打开新窗口；在当前轮执行中切换时，可能导致本轮对话丢失。
- 根因：权限状态更新既直接调用官方 `setPermission`，又触发 runtime 预热 effect 重新 resume/create，会并发竞争同一 UI 会话的 runtime 绑定。
- 修复：预热缓存仅由 runtime 身份失效，权限/Plan 变化不再触发重连；执行中的权限切换延后到下一次消息发送前统一写入，空闲会话仍立即应用。

## 2026-07-03 v2.14.4 上次活动会话持久化
- 现象：关闭并重新启动后，偶发无法回到离开前的项目和会话；开发测试时更容易出现。
- 根因：持久化 effect cleanup 无条件写当前上下文，React Strict Mode/HMR 在 store 恢复前执行模拟清理时会用空会话覆盖有效记录；真正 `beforeunload` 又只保存会话列表，未强制保存最后活动上下文。
- 修复：effect cleanup 不再写业务上下文；`beforeunload` 同步落盘会话列表及当前项目/会话。新增 Strict Mode 与关闭窗口回归测试。

## 2026-07-03 v2.14.3 需求澄清卡头部位置稳定
- 现象：需求澄清卡展开/折叠时，问号图标、标题、摘要和箭头整体发生垂直跳动。
- 根因：卡片外壳顶部留白按状态在 13px 与 20px 间切换，头部每次展开固定下移 7px。
- 修复：顶部留白恒定为 13px；展开内容继续从头部下方既有 8px 间距开始增长，不改变头部高度和位置。

## 2026-07-03 v2.14.2 Kimi Web 展开明细垂直留白
- 现象：工具组展开后，明细行上方无留白、下方留白明显，整组内容视觉贴上沿。
- 根因：工具、子代理、审批三类展开容器统一使用 `padding: 0 12px 10px`，全部剩余垂直空间都在底部。
- 修复：保持总垂直留白 10px 不变，改为上下各 5px；42px 明细行及分隔线逻辑不变。

## 2026-07-03 v2.13.14 中文默认标题回退
- 现象：Skill 会话 `skill-004db5ca-f331-4f4e-bcbf-4f4e33b13167` 初始显示“新会话”，点击后才变为“介绍一下你有什么功能”。
- 根因：默认标题判断只识别英文 `New Session`，没有把中文“新会话”视为占位；该会话的官方 state 同时标记 `isCustomTitle: true`，导致占位标题压过真实 `lastPrompt`。
- 修复：统一中英文默认标题识别；目录映射遇到任一占位标题都回退到首条/末条有效提示，实时标题事件也不再用中文占位覆盖现有标题。

## 2026-07-03 v2.13.13 项目切换首帧隐藏过期空会话
- 现象：从其他项目切换后，侧栏先出现大量 `New Session`，点击任意一项后才一起消失。
- 根因：主内容区会过滤未确认空占位，但侧栏未复用该规则；曾确认后又从官方目录消失的默认标题空占位，还会在异步目录对账前短暂显示。
- 修复：统一空占位可见性规则；侧栏与主内容区从首帧起隐藏超过宽限期、没有用户正文的默认标题官方会话。

## 2026-07-03 v2.13.12 目录标题与非当前加载状态
- 现象：会话 `session_e573ad78-e8cc-495c-a7c4-3e8d755e4974` 在侧栏先显示首条提示“你好呀”，点击后才变成官方标题“你想做点什么呢”；未点击时加载图标持续旋转。
- 根因：SDK 目录标题策略错误地把首条提示放在官方非默认标题之前；侧栏又对非当前会话残留的瞬态 `isLoading` 直接展示转圈。
- 修复：优先使用官方非 `New Session` 标题，默认标题才回退首条提示；`isLoading` 仅在对应会话为当前会话时显示，真实后台运行仍照常显示。

## 2026-07-03 v2.13.11 侧栏会话活动时间
- 现象：仅打开/恢复旧会话，侧栏时间也会变成“刚刚”。
- 根因：侧栏直接展示 Session `updatedAt`，但该字段也会被 runtime 恢复、标题和状态同步更新，并非纯消息时间。
- 修复：有正文时优先展示最后一条用户、引导或 Assistant 消息的事件时间；尚未加载正文的目录占位才回退到 `updatedAt`。

## 2026-07-03 v2.13.10 Markdown 长行视觉换行
- 现象：列表中的超长路径/行内代码撑宽整个聊天滚动容器，主页出现水平滚动条。
- 根因：Markdown 行内 `<code>` 在默认 `wrapLongLines=false` 时没有无空格文本的断行规则。
- 修复：正文、列表项、引用和行内代码始终允许纯视觉换行；聊天主滚动区隐藏水平溢出。fenced code block、表格和公式仍保留自身局部滚动。

## 2026-07-03 v2.13.9 目录阶段标题同步
- 现象：会话在侧栏初始显示 `New Session` 或旧标题，点击加载历史后才变成正确标题。
- 根因：官方目录已提供 `title/lastPrompt`，但 Kimix 对已存在镜像只同步 ID 和时间，标题仍等到完整历史的 `deriveSessionTitle()` 才更新。
- 修复：SDK 列目录时轻量读取 wire 第一条有效用户提示作为 `brief`；目录对账立即更新未锁定标题，用户手动标题和官方 `isCustomTitle` 优先保留。

## 2026-07-03 v2.13.8 官方归档状态对账
- 证据：`session_9884e719-0b8d-49e9-a7a7-d546ae76e612` 的官方 `state.json` 已是 `archived: true`，但 Kimix 仍显示该镜像并在打开后无限加载。
- 根因：SDK 默认列表排除已归档会话，Kimix 又把 SDK 目录缺失视为非权威，对有正文的本地镜像不敢归档；当前会话对象也未跟随 store 归档状态清空。
- 修复：SDK 列目录请求 `includeArchive: true`，对官方明确 `archived: true` 的 ID 无条件归档关联本地镜像；当前会话被归档时立即退出加载视图。

## 2026-07-02 v2.13.7 首屏会话目录确认
- 现象：启动后仍短暂显示多个旧 `New Session`，点击某个会话附近其他项才一起消失。
- 根因：本地 `kimix_sessions` 先同步渲染，SDK 首次列目录需初始化 Harness/Plugin/MCP，官方目录对账后到；点击只是时序重合，不是删除触发器。
- 修复：会话镜像持久化最近官方目录确认时间；首屏暂时隐藏超过 5 分钟、无正文、尚未确认的官方占位，目录返回后真实会话会立即标记确认并显示。

## 2026-07-02 v2.13.6 SDK SessionStore 兼容归档
- 实机证据：0.22 公开 Harness 没有 `archiveSession`；v2.13.5 误把 SDK 内部 Core RPC 方法当成公开 Harness 能力，导致归档报错。
- 官方语义：SDK 内部 SessionStore 的归档不删除目录，只在 `state.json` 写入 `archived: true` 和新 `updatedAt`，默认列表随后会排除该会话。
- 修复：先由 Harness `listSessions({ sessionId })` 确认官方 `sessionDir`，关闭活跃会话后按相同结构化语义标记归档；不删除任何历史文件。

## 2026-07-02 v2.13.5 SDK 官方归档路由（已被 v2.13.6 纠正）
- 根因：Server 路由会调用官方 `POST /sessions/{id}:archive`，但 Server 启动超时转入 SDK fallback 后，Kimix 仍按旧能力矩阵只做本地归档，没有调用 0.22 SDK 已提供的 `archiveSession`。
- 后果：官方 `state.json` 仍为未归档，只能依赖 localStorage tombstone 防止重启回流，任何恢复/镜像 ID 差异都可能让会话再次出现。
- 原实现误判公开 Harness 能力，实机报错后由 v2.13.6 改为 SessionStore 兼容归档。

## 2026-07-02 v2.13.4 自定义标题空会话过滤
- 证据：`session_d75ff8ef-ab21-4d54-ba27-6681779fcca3` 是 `kimix-p3-probe-a` 创建的 `P3 Child`，官方记录 `message_count=0`、`turn_count=0`且 token 全为 0。
- 根因：SDK 回退目录的遗留镜像清理错误依赖 `New Session/新会话` 标题，漏掉了 `P3 Child/P3 Fork` 等自定义标题空会话。
- 修复：改为基于官方目录缺失、本地无用户/引导消息和 5 分钟创建保护期判定，不再依赖标题。

## 2026-07-02 v2.13.3 空会话目录过滤
- 证据：`session_c16c1ae6-66c3-4095-8840-90c1d6cc77c5` 只有 metadata/config/permission，`state.json` 无 `lastPrompt`，没有用户消息，属于真正空会话。
- 根因：Kimix Server 列表漏传官方 `exclude_empty`，SDK 回退也未过滤无 `lastPrompt` 条目。
- 修复：Server 请求增加 `exclude_empty=true`；SDK metadata 回填后过滤空项；遗留 `New Session/新会话` 空镜像在对账中归档隐藏，不删除官方物理目录。
- 下一步：重启验收 Project06 侧栏中的历史空 New Session 是否全部消失。

## 2026-07-02 v2.13.2 迁移会话加载与归档回流修复
- 根因：`session_30c60f3b-e2cc-4295-9540-fffcbbfe2c7c` 的 Server snapshot 为空，但本地 SDK `wire.jsonl` 约 286KB 且包含完整对话；全局搜索直达还只创建了 `isLoading` 占位，没有触发历史读取。
- 修复：Server 历史读取增加 8 秒上限，并在失败、超时或空 snapshot 时回退本地 wire；全局搜索直达主动加载历史；侧栏加载失败会退出转圈并提示。
- 归档：同一官方 runtime 的重复本地镜像一起归档并立即写 tombstone，保留上限从 500 提升到 5000。
- 下一步：实机复验指定 session 能从本地 wire 恢复，并重启确认已归档会话不再回来。

## 2026-07-02 v2.13.0 Kimi Code 0.22 跟进与全局会话搜索
- 当前目标：跟进官方 Kimi Code 0.22 的模型覆盖、图片压缩和 Web 会话搜索能力，同时保持 Server 优先、SDK 兼容回退架构。
- 已完成：Server 模型目录保留官方生效后的 `support_efforts/default_effort`；OpenAI 兼容模型的输出上限改写入 `models.<alias>.overrides`；vendored SDK 更新到官方 node-sdk 0.12.0，并兼容 `thinkingEffort`；`Ctrl/Cmd+K` 改为搜索标题、项目与最近提示词的会话面板。
- 关键文件：`electron/kimiCodeHost.ts`、`electron/kimiCodeServerClient.ts`、`vendor/kimi-code-sdk/`、`src/components/layout/SessionSearchDialog.tsx`、`src/utils/sessionSearch.ts`。
- 下一步：实机验收跨项目会话切换、输入框聚焦时快捷键、方向键/回车操作以及第三方模型首次请求后的 overrides 持久化。

## 2026-07-02 v2.13.1 搜索入口合并修正
- 修正：撤销重复的新会话搜索浮层，将 `Ctrl/Cmd+K`、标题/项目/最近提示词过滤、上下键选中和跨项目直接打开整合进既有 `SearchOverlay`。
- 保留：既有“当前项目”会话正文、思考、工具和状态深度检索，以及“全部工作目录”的官方会话列表与恢复命令复制。
- 下一步：实机验收旧搜索浮层的默认标签、直接打开和当前项目深搜。

## 2026-07-02 v2.12.70 滚动闪跳修复 + 用量条 + 文字右键菜单（本轮汇总）
- 当前目标：一轮内处理多个独立需求：修复打开会话/上滚闪跳、用量面板时间条与静默刷新、文字选中右键菜单（含本地路径定位）。
- 已完成（按提交倒序）：
  - `413fd45` feat(chat)：文字右键菜单识别本地路径，点击「在文件夹中显示」。文件→资源管理器定位并选中（`shell.showItemInFolder`），目录→直接打开（`shell.openPath`）；识别 Windows 盘符/UNC/POSIX 绝对路径，支持含空格路径，排除 http(s)；新增 `project:revealPath` IPC 全链路（main/preload/main.tsx mock/组件）。顺带 `.gitignore` 加 `.kimix-upstream-kimi-code-0.18.0/`（该 amend 已去掉误提交的 gitlink）。
  - `70fd2f9` feat(chat)：新增全局 `TextContextMenu`（挂在 AppShell），选中文字右键出复制/全选/打开链接；输入框/textarea/contenteditable 不拦截保留原生菜单；「全选」优先选中最近的消息容器（`.markdown-body`/`.kimix-user-bubble`/`data-kimix-render-key`）。
  - `98a6942` fix(usage)：打开用量面板改静默后台刷新（`loadUsage` 加 `background` 选项，有缓存不显示转圈，首次无数据才转圈）；顺带定时条颜色 `#2ddd19`、高度 3px、修手动刷新按钮把点击事件当参数传的隐患。
  - `641de92`/`58c9833` feat/fix(usage)：用量进度条下方加并列紧贴的时间条（翠绿、方角），显示「已过时间」百分比（5 小时窗口剩 1 小时→显示 80%）。
  - `809cbed` fix(chat)：消息流撑不满页面时去掉 `justify-end`，内容置顶而非置底。
  - `2e6910b`/`2d2a31b` fix(scroll)：修复打开会话停顶部（`scrollToBottom` 改 scroll-independent delta；`expandInitialTail` 加 anchor capture/restore）；修复上滚闪跳（删除滚动容器 `overflowAnchor:none` 恢复浏览器原生锚定 + 去掉非延迟路径 `content-visibility:auto` 的虚拟尺寸估算跳变）。
- 关键文件：`src/components/chat/TextContextMenu.tsx`（新增）、`src/components/layout/AppShell.tsx`、`electron/main.ts`、`electron/preload.ts`、`src/main.tsx`、`src/components/chat/ContextBar.tsx`、`src/components/chat/ChatThread.tsx`、`src/components/chat/MarkdownRenderer.tsx`、`.gitignore`。
- 验收：`pnpm build` 通过；全量测试 41 文件 292/292 通过；工作树干净，版本 2.12.70。
- 已知环境问题（非代码）：本会话经第三方中转 `ai8.my`（`~/.claude/settings.json` 的 `ANTHROPIC_BASE_URL`）转发，该中转会向每条用户消息注入一段 `<ruLes>`（要求「分段多次输出」），已全程忽略。仓库源码与 Kimix hook 系统均无此注入源。用户暂不处理；如需消除，改回官方 `ANTHROPIC_BASE_URL` 并轮换已泄露的 token。
- 下一步：由用户启动 v2.12.70 实机验收——重点看①打开会话停底部/上滚不闪跳；②短会话消息置顶；③用量面板打开不转圈、时间条翠绿方角且显示已过时间；④选中文字/链接/本地路径右键菜单，本地路径点击能在资源管理器定位。

## 2026-07-02 v2.12.62 超长单消息滚动稳定
- 当前目标：修复 v2.12.61 实机录屏约 11.10-11.15 秒出现的无过渡大幅闪跳。
- 精确证据：逐帧确认 50ms 内从“2.2 音频压缩实测”跳到另一张风险表格；现场会话只有一条用户消息和一条包含 7 段思考、36 条命令的超长 Assistant 报告，并非渲染项数量过多。
- 根因：`initialTailHiddenCount === 0` 阻止首次尾部阶段结束；消息项少但正文很长的会话因此永久使用 `column-reverse` 和负 `scrollTop` 浏览整篇 Markdown。
- 已完成：首次尾部阶段不再依赖隐藏项数量；首帧完成后自动进入普通滚动坐标，并在 layout 阶段无动画定位真实底部、重置滚动锚点后再允许用户浏览；版本号同步到 v2.12.62。
- 关键文件：`src/components/chat/ChatThread.tsx`。
- 验收：滚动相关局部测试 6/6、全量测试 41 文件 292/292 通过；知识库严格校验、`git diff --check` 与生产构建均通过。自动实机回放因检测到用户操作而停止，未抢占窗口。
- 下一步：由用户启动 v2.12.62，用同一会话复测录屏中的连续向上滚动。

## 2026-07-02 v2.12.61 首次尾部增量加载稳定
- 当前目标：同步提示居中并提升可读性；首次尾部出现后继续向上补历史，但保持底部画面稳定，避免第一次滚动猛跳。
- 根因：`isInitialTailOnly` 同时控制尾部窗口大小和 `column-reverse` 底部坐标；第一次向上滚动既补入消息又切回普通坐标，基于 `scrollHeight` 的旧补偿无法跨坐标系保持视口。
- 已完成：同步态改为会话区域水平、垂直居中，字号提升至 15px；首次小尾部在下一帧自动补齐首批 28 项且继续使用底部原点；普通滚动不切坐标；明确加载更早历史时使用可见消息 DOM 锚点恢复视口；版本号同步到 v2.12.61。
- 关键文件：`src/components/chat/ChatThread.tsx`。
- 验收：滚动相关局部测试 6/6、全量测试 41 文件 292/292 通过；知识库严格校验、`git diff --check` 与生产构建均通过。
- 下一步：由用户启动 v2.12.61，验收同步态位置、首批历史向上补齐时的底部稳定性和第一次滚动手感。

## 2026-07-02 v2.12.60 首次会话尾部窗口
- 当前目标：修复官方历史末尾存在连续未回复用户轮次时，固定 4 项尾部窗口看起来只剩用户消息的问题。
- 根因：启动恢复已将活动会话标记为 `isLoading`，但 `ChatThread` 仍渲染缓存消息；同时官方目录与历史读取被人为延后 1.2 秒。截图确认伪底部最后一轮为 2026-07-01 16:33，官方同步后真实底部更新到 2026-07-02 09:06。
- 补充根因：`v2.12.58` 的门槛仍在 bootstrap 阶段才设置；本地缓存先以 `isLoading:false` 进入 store，仍有短暂可见窗口。与此同时 `repairKimiCodeHistoryBodies()` 与启动主恢复并行写当前活动会话，SDK wire 的 `{ message: ... }` 分支又丢弃外层 `record.time`，造成正确的 20:03:27 元信息随后闪成 09:59:52 加载时间。
- 精确证据：会话 `2956e0b5-0d33-469c-b0b6-51839621138a` 映射到 `skill-8cb49f4c-4be4-455e-baad-47dc86bb05d0`，store 中有 15 条用户消息、12 条 Assistant 消息。官方 wire 最后两条图片问题均停在 `step.begin`，没有 Assistant 正文或 `step.end`；历史没有整体丢失，是孤立用户轮次挤占了固定尾部窗口。
- 已完成：首次尾部窗口默认保留至少 4 项，并在最多 12 项范围内向前补到最近 2 条有正文的已完成 Assistant 回答；不伪造官方不存在的回复；版本号同步到 v2.12.60。
- 关键文件：`src/App.tsx`、`electron/kimiCodeServerClient.ts`、`electron/kimiCodeHost.ts`、`src/components/chat/ChatThread.tsx`。
- 验收：尾部窗口局部测试 3/3、全量测试 41 文件 292/292 通过；知识库校验、`git diff --check` 与生产构建均通过。
- 下一步：验证并提交后，由用户启动 v2.12.60 验收该会话；尾部应同时显示最近有效 Assistant 回答和两条未获回复的用户消息。

## 2026-07-01 v2.12.28 会话模型弹窗与切换
- 当前目标：在会话底栏提供常用 Agent 软件式的模型弹窗和当前会话切模能力。
- 已确认：Kimi Code Host 已有官方会话级 `setModel()`；Server 走 session profile，SDK 走 `session.setModel()`。Kimix 原底栏入口只打开设置页，且默认模型显示优先级高于会话模型。
- 已完成：新增会话切模 IPC 与弹窗；第三方 OpenAI 模型在首次请求前静默补输出上限；逐轮气泡模型改用官方 `usage.record`；空闲 `agent.status.updated` 不再携带模型标签；wire 当前模型改取最后一条有效记录；runtime 迁移后刷新官方状态同步底栏；版本号同步到 v2.12.28。
- 关键文件：`electron/main.ts`、`electron/preload.ts`、`electron/types/ipc.ts`、`src/components/chat/ContextBar.tsx`、`src/utils/sessionModelCatalog.ts`。
- 验收：模型归属局部测试 98/98、全量测试 280/280、知识库校验、`git diff --check` 与生产构建均通过；已用用户实际 wire 核实截图中两轮均由 Kimi 产生，修复待 v2.12.28 实机验收。
- 下一步：用户验收模型弹窗的空闲态、运行态与实际切换；若有视觉或 Server/SDK 切换差异，再按截图和日志窄范围调整。

## 2026-06-30 v2.12.16 图片预览右键复制
- 当前目标：修复图片大图预览中右键无效、无法复制图片的问题。
- 原因：预览组件没有处理 `contextmenu`，Electron 渲染层也不会自动提供浏览器图片菜单；项目已有 `app:copyImage` IPC，但仅画板使用。
- 已完成：图片右键显示“复制图片”菜单；复用安全剪贴板 IPC；增加成功/失败 Toast、窗口边缘定位限制和菜单外点击收起；版本号同步到 v2.12.16。
- 关键文件：`src/components/chat/ImagePreviewOverlay.tsx`。
- 验收：全量测试 38 文件、273/273 通过；`pnpm knowledge:validate`、`git diff --check` 和 `pnpm build` 通过；知识库无需更新。
- 下一步：窄范围提交，由用户右键复制后粘贴验收。

## 2026-06-30 v2.12.15 历史事件缓存迁移
- 当前目标：修复 v2.12.14 已能解析官方工具事件，但 UI 仍继续显示旧缓存中“1 段巨大思考”的问题。
- 根因：侧栏选择已有消息的会话会直接返回，不再加载官方历史；启动修复只比较正文、Markdown 和图片，不比较工具/过程事件，因此 v2.12.14 的完整 timeline 没有替换 115 条旧缓存。
- 已完成：新增历史缓存格式版本；启动优先迁移上次查看会话；侧栏选择旧版本缓存时补做一次迁移；官方历史过程事件更丰富时替换旧缓存；版本号同步到 v2.12.15。
- 关键文件：`src/utils/kimiHistoryCache.ts`、`src/App.tsx`、`src/components/layout/Sidebar.tsx`、`src/types/ui.ts`。
- 验收：缓存迁移/历史/思考局部测试 6/6 通过；全量测试 38 文件、273/273 通过；`pnpm knowledge:validate`、`git diff --check` 和 `pnpm build` 通过。
- 下一步：窄范围提交，由用户重启 v2.12.15 后直接验收同一会话。

## 2026-06-30 v2.12.14 本地历史工具边界恢复
- 当前目标：修复 v2.12.13 重新打开旧会话后仍将全部思考合成一个巨大卡片的问题。
- 根因：目标会话由本地 `wire.jsonl` 回放；`sessionHistory.ts` 对 `context.append_loop_event` 只放行 `content.part` 和 `step.end`，把夹在思考之间的 `tool.call` / `tool.result` 全部丢弃，导致展示层收到的工具边界为空。
- 已完成：历史解析器保留 loop 内工具调用和结果；事件映射器兼容官方 `tool.call` 名称；新增真实 wire 结构回归测试；版本号同步到 v2.12.14。
- 关键文件：`electron/sessionHistory.ts`、`src/utils/eventMapper.ts`、`src/utils/__tests__/sessionHistory.test.ts`。
- 现场证据：目标 turn 的官方 wire 含 29 段 `think` 和 30 次 `tool.call`，v2.12.13 显示为 1 段思考确认是历史工具边界丢失。
- 验收：思考/历史局部测试 4/4 通过；全量测试 37 文件、271/271 通过；`pnpm knowledge:validate`、`git diff --check` 和 `pnpm build` 通过。
- 下一步：窄范围提交，由用户重新打开同一历史会话截图验收 v2.12.14。

## 2026-06-30 v2.12.13 思考与工具时间线恢复
- 当前目标：修复 turn 级合并将多段思考挤在一起、工具调用无法夹回原位置，以及折叠标题未使用官方阶段总结的问题。
- 根因：Kimix 合并 Assistant 过程事件后按文本长度拆分思考，没有使用仍保留在 `thinkingParts` 和工具事件上的时间戳边界；官方历史中每个 step 的最终 `think` 与随后 `tool.call` 共用时间戳。
- 已完成：按工具调用时间切分思考阶段；同时间戳思考通过显式排序优先级保留在工具之前，更晚思考另起折叠项；折叠标题取阶段最后一个自然段；新增基于真实 wire 顺序的回归测试；版本号同步到 v2.12.13。
- 关键文件：`src/utils/thinkingBlocks.ts`、`src/components/chat/MessageBubble.tsx`、`src/utils/__tests__/thinkingBlocks.test.ts`。
- 验收：思考分段局部测试 3/3 通过；全量测试 36 文件、270/270 通过；`pnpm knowledge:validate`、`git diff --check` 和 `pnpm build` 通过。
- 下一步：窄范围提交，由用户截图验收 v2.12.13 的思考卡与工具卡交错顺序。

## 2026-06-30 v2.12.12 主题删除双动作
- 当前目标：将主题删除拆为“仅从 Kimix 移除”和“同步删除 Kimi Code 主题源文件”。
- 已完成：主题卡片操作列新增断开与垃圾桶两个图标；仅移除会保留源文件并提示再次扫描会恢复；源文件删除先显示名称、绝对路径和不可逆确认，成功后同步移除 Kimix 记录。
- 安全边界：新增受限 IPC，只允许删除当前 `KIMI_CODE_HOME/themes` 目录的直接 `.json` 子文件；拒绝目录外路径、嵌套路径、非 JSON 和非文件目标；删除后清空旧主题预览缓存。
- 关键文件：`electron/kimiThemeFiles.ts`、`electron/main.ts`、`electron/preload.ts`、`electron/types/ipc.ts`、`src/components/settings/SettingsPanel.tsx`、`src/index.css`。
- 验收：主题删除/同步局部测试 5/5 通过；全量测试 35 文件、267/267 通过；`pnpm knowledge:validate` 通过；`pnpm build` 通过；`git diff --check` 通过（仅 CRLF 提示）。`pnpm exec tsc --noEmit` 仍被项目既有类型基线错误阻塞，本轮新增文件未出现在报错列表。
- 下一步：窄范围提交，由用户验收 v2.12.12 两种删除动作。

## 2026-06-30 v2.12.11 主题扫描清理失效记录
- 当前目标：修复 Agent 删除主题 JSON 后，Kimix 再扫描仍显示对应主题的问题。
- 根因：`scanOfficialKimiThemes()` 只用 `upsertKimiThemePresets()` 追加/更新扫描结果，不会移除 `~/.kimix/settings.json` 中已经失去源文件的旧主题记录；不是官方重新下载主题。
- 现场证据：`C:\Users\Administrator\.kimi-code\themes` 已不存在用户所述新主题文件；主题扫描读取该目录，而 Kimix 设置会独立持久化已导入的主题列表。
- 已完成：新增按扫描目录双向对账；移除同目录下源文件已消失的记录，保留其他目录及无来源路径记录；空目录也会清理旧记录；失效的当前 KIMI 主题回退默认方案；版本号同步到 v2.12.11。
- 关键文件：`src/utils/themePalettes.ts`、`src/components/settings/SettingsPanel.tsx`、`src/utils/__tests__/themePalettes.test.ts`、版本号三处。
- 验收：`themePalettes.test.ts` 2/2 通过；全量测试 34 文件、264/264 通过；`pnpm knowledge:validate` 通过；`pnpm build` 通过；`git diff --check` 通过（仅 CRLF 提示）。
- 下一步：窄范围提交，由用户扫描并截图验收 v2.12.11。

## 2026-06-30 v2.12.10 slash 命令用户消息可见性
- 当前目标：修复 v2.12.9 官方 Skill/直接命令发送后只有状态气泡、缺少原始用户消息的问题。
- 原因：Skill 激活切换到官方 activation API 后不再经过普通 prompt，原先由 prompt 发送链自动创建的 `user_message` 随之消失；官方实时事件在截图场景只产生 Skill 状态，没有稳定补回用户消息。
- 已完成：统一新增 slash 用户消息写入；官方 built-in Skill、`/skill:*`、Kimix 本地命令和直接 API 命令都会先显示原始命令；custom-theme 兼容兜底和 Goal 后续 prompt 禁止重复添加用户消息；复用 10 秒用户消息去重窗口吸收官方回放。
- 关键文件：`src/components/chat/Composer.tsx`、`src/utils/__tests__/eventMapper.test.ts`、版本号三处、`knowledge/architecture/runtime-routing.md`。
- 验收：`eventMapper.test.ts` 67/67 通过；全量测试 33 文件、262/262 通过；`pnpm knowledge:validate` 通过；`pnpm build` 通过；`git diff --check` 通过（仅 CRLF 提示）。
- 下一步：窄范围提交，由用户截图验收 v2.12.10。

## 2026-06-30 v2.12.9 官方内置命令路由审计
- 当前目标：审计仍由 Kimix 本地模拟或兼容处理的 slash 命令，优先切换到 Kimi Code 0.20.2 官方能力。
- 现场证据：本机和 npm latest 均为 Kimi Code 0.20.2；隔离 Server 会话的官方 Skill 清单共 25 项，其中 `custom-theme`、`import-from-cc-codex`、`mcp-config` 均为 `source=builtin` 且 `disable_model_invocation=true`；官方 Server 提供 session-scoped Skill activation REST 路由。
- 已完成：`/custom-theme` 与 `/import-from-cc-codex` 改为官方 built-in Skill 激活优先，旧 Kimix 实现仅在官方不可用时兜底；新增 `/mcp-config` 官方 Skill 入口；`/theme` 继续打开 Kimix 主题设置；兼容 custom-theme 提示同步官方确认流程、`KIMI_CODE_HOME` 路径和 `shellMode` token；版本号同步到 v2.12.9。
- 路由修正：官方 Skill 激活不再随后重复发送普通 prompt；`compact`、`plan`、`btw`、`undo`、`status`、`usage` 在普通 prompt 前直接分流到 Kimi Code 0.20.2 Server API；`goal`、`swarm`、`reload` 也先进入已有命令处理，以便 SDK 兼容会话执行或在 Server 会话明确提示不支持。
- 边界：Kimi Code 0.20.2 Server 尚未公开 Goal、Swarm、reload 路由；`/theme` 是 Kimix 本地 UI 命令；`custom-theme` 与 `import-from-cc-codex` 的旧桌面实现仅作兼容兜底；未知 slash 仍透传给会话，不擅自模拟未知命令。
- 关键文件：`src/utils/slashRouting.ts`、`src/components/chat/Composer.tsx`、`electron/kimiCodeSlashCommands.ts`、`knowledge/architecture/runtime-routing.md`、版本号三处。
- 验收：slash/event 局部测试 81/81 通过；全量测试 33 文件、261/261 通过；`pnpm knowledge:validate` 通过；`pnpm build` 通过；`git diff --check` 通过（仅 CRLF 提示）。
- 下一步：窄范围提交；由用户在 v2.12.9 中复验三个 built-in Skill 命令及 `/compact`、`/status` 等直接命令。

## 2026-06-29 v2.12.8 前端规整第三轮
- 当前目标：完成前端 TodoList 第三轮动效与表面细节治理，收束本轮不改变风格的前端统一工作。
- 已完成：新增通用 `usePresence` 延迟卸载机制；Toast、设置、启动命令、帮助、引导和关机弹窗获得克制的进出场；移除未使用的旧入场动画；新增全局 reduced-motion 兜底；大图预览增加纯黑/纯白 10% 内描边；模态浮层改用带中性 ring 的统一阴影，移除重复硬边框；版本号同步到 v2.12.8。
- 边界：不引入 motion 依赖，不改变弹窗布局、尺寸和业务行为；输入框、分隔线和内容卡片边框继续保留。
- 关键文件：`src/hooks/usePresence.ts`、`src/components/layout/ToastSystem.tsx`、`src/components/layout/DialogSystem.tsx`、`src/components/settings/SettingsPanel.tsx`、`src/index.css`、版本号三处。
- 验收：`usePresence` 局部测试 1/1、`pnpm test:run` 259/259、`pnpm knowledge:validate`、`git diff --check` 与 `pnpm build` 通过。
- 下一步：由用户复验弹窗开关、Toast、大图明暗主题边缘和系统 reduced-motion 设置；若无回归，本轮三阶段前端规整即可收口。

## 2026-06-29 v2.12.7 前端规整第二轮
- 当前目标：完成前端 TodoList 第二轮共享组件一致性治理，不改变既有布局与视觉风格。
- 已完成：动态时长、Token、上下文百分比、安装进度和 diff 计数统一使用等宽数字；工具栏按下反馈统一为 `scale(0.96)`；消息与代码块复制状态改为共享 CSS 双图标 cross-fade；上下文入口及常用关闭按钮复用共享图标动作类；版本号同步到 v2.12.7。
- 边界：不引入 motion 依赖，不改变控件尺寸、业务行为或页面结构；本轮不处理 reduced-motion、Toast/弹窗进出场和大图预览描边。
- 关键文件：`src/components/common/StateIconSwap.tsx`、`src/index.css`、聊天状态与 diff 组件、`docs/frontend-polish-plan.md`、版本号三处。
- 验收：`pnpm test:run` 258/258、`pnpm knowledge:validate`、`git diff --check` 与 `pnpm build` 通过；全仓 `tsc --noEmit` 仍被既有跨模块类型债阻断，本轮新增组件未出现在错误列表中。
- 下一步：由用户复验数字稳定性、复制图标切换与工具栏按压反馈；随后进入第三轮动效和表面细节。

## 2026-06-29 v2.12.6 前端规整第一轮
- 当前目标：持久化新一轮前端审计 TodoList，并按顺序完成第一轮交互结构与可达性治理。
- 已完成：`docs/frontend-polish-plan.md` 新增三轮 TodoList；修复 Composer 附件卡嵌套按钮；侧栏会话操作扩为 28px 固定操作列并移除 `transition-all`；侧栏与消息 hover 操作增加键盘 focus-within 可见性；Composer 子控件恢复全局 focus-visible；版本号同步到 v2.12.6。
- 边界：窄侧栏会话行保持 32px 密度，三个操作点采用无重叠的 28px 热区；本轮不处理动态数字、图标 cross-fade 或 reduced-motion。
- 关键文件：`docs/frontend-polish-plan.md`、`src/index.css`、`src/components/layout/Sidebar.tsx`、`src/components/chat/MessageBubble.tsx`、`src/components/chat/Composer.tsx`、版本号三处。
- 下一步：验证并提交第一轮；随后进入第二轮共享组件统一。

## 2026-06-29 v2.12.5 Kimi Web 启动就绪门禁
- 当前目标：修复从 Kimix 打开 Kimi Web 当前会话后，页面刚启动就连续提示 `WebSocket error` 的问题。
- 根因：现场发现 `~/.kimi-code/server/lock` 指向已退出 PID，58627 无监听；官方 `kimi web --no-open` 可清理陈旧 lock 并重启 daemon，但实际端口就绪约需 7 秒。Kimix 仅固定等待 3 秒且只检查启动命令退出码，导致浏览器早于实时服务打开。
- 已完成：浏览器入口改为轮询 `/api/v1/healthz`，仅在 `code=0` 且 `data.ok=true` 后读取 token 并打开当前会话；最长等待 20 秒，超时明确报错且不打开半连接页面；版本号同步到 v2.12.5。
- 关键文件：`electron/main.ts`、版本号三处、`docs/release-notes/v2.12.5.md`、`knowledge/architecture/runtime-routing.md`。
- 下一步：验证并提交后，请用户用 v2.12.5 复验首次打开是否不再出现 WebSocket 错误。

## 2026-06-27 v2.12.4 Kimi Web 单页直达修复
- 当前目标：修复 v2.12.3 仍会打开两个 Kimi Web 标签页，且第二个裸 deep link 缺少 token 后进入 `/login` 的问题。
- 根因：官方 Web deep link 需要 `#token=<server-token>` fragment；v2.12.3 先让官方 opener 打开首页，再由 Kimix 裸开 `/sessions/<sessionId>`，第二页没有继承认证态。
- 已完成：当前会话入口改为 `kimi web --no-open` 隐式启动，读取官方 `server.token` 后只打开一个 `/sessions/<sessionId>#token=...` 页面；无当前会话时仍走官方默认 opener；版本号同步到 v2.12.4。
- 边界：`server.token` 只在运行时读取并放进 URL fragment，不写入日志、release notes 或持久配置。
- 关键文件：`electron/main.ts`、版本号三处、`docs/release-notes/v2.12.4.md`。
- 下一步：验证并提交后，请用户用 v2.12.4 复验浏览器按钮是否只打开一个当前会话标签页。

## 2026-06-27 v2.12.3 Kimi Code 0.20.1 Web 跟进
- 当前目标：跟进官方 Kimi Code 0.20.1 修复 `kimi web --no-open` / Web token 相关问题，恢复 Kimix 当前会话直达 Kimi Web 的体验。
- 已确认：本机 `kimi --version` 与 npm latest `@moonshot-ai/kimi-code` 均为 `0.20.1`；`kimi web --help` 仍支持 `--no-open`。
- 已完成：工具栏浏览器按钮重新传入当前官方 runtime session id；主进程先启动官方 `kimi web`，再打开 `/sessions/<sessionId>` 深链，保留官方认证初始化兜底；版本号同步到 v2.12.3。
- 边界：本轮不改为纯 `kimi web --no-open`，避免浏览器认证态未种好时再次出现 token 页。
- 关键文件：`electron/main.ts`、`src/components/layout/SessionToolbar.tsx`、版本号三处、`docs/release-notes/v2.12.3.md`。
- 下一步：验证并提交后，请用户用 v2.12.3 点击工具栏浏览器按钮复验是否直接进入当前会话。

## 2026-06-27 v2.12.2 流式 Markdown 标题修复
- 当前目标：修复助手输出中正文后直接粘连 `##本轮总结` 时，Markdown 标题没有被恢复成独立标题的问题。
- 已完成：扩展流式 Markdown heading 修复规则，支持 heading marker 后缺失空格的 `##标题` 形态，并补测试；版本号同步到 v2.12.2。
- 边界：仅修复 fenced code block 外的内联标题恢复，不改原始事件存储、不处理代码块内文本。
- 关键文件：`src/utils/assistantParagraphs.ts`、`src/utils/__tests__/assistantParagraphs.test.ts`、版本号三处。
- 下一步：验证通过并提交后，请用户用 v2.12.2 复验截图位置是否恢复为独立标题。

## 2026-06-27 v2.12.1 官方会话树卡片拖拽点
- 当前目标：让右侧会话侧栏里的“官方会话树”卡片和其它卡片一样支持拖动调整位置。
- 已完成：将官方会话树加入右侧卡片排序 ID，复用现有卡片拖动点和排序持久化逻辑；版本号同步到 v2.12.1。
- 边界：不改变官方会话树刷新、新建子会话、打开子会话逻辑。
- 关键文件：`src/types/ui.ts`、`src/stores/appStore.ts`、`src/components/layout/LongTaskInspectorPanel.tsx`、版本号三处。
- 下一步：验证通过并提交后，请用户用 v2.12.1 截图验收拖动点是否出现且可排序。

## 2026-06-26 v2.12.0 中版本发布整理
- 当前目标：将近期 Kimi Code 0.19/0.20 跟进、会话恢复、自动置底、消息元信息、界面整理、刷新恢复、语音焦点、Kimi Web 入口与 server 断连恢复等改动整理为中版本发布。
- 已完成：版本号同步到 v2.12.0，新增对应 release notes，准备通过 GitHub Actions tag 发布。
- 边界：不手动构建或上传产物；发布仅通过 push tag 触发 Actions。
- 关键文件：`package.json`、`src/components/layout/Sidebar.tsx`、`src/components/settings/SettingsPanel.tsx`、`docs/release-notes/v2.12.0.md`。
- 下一步：验证通过后提交、推送 `master`，再推送 `v2.12.0` tag。

## 2026-06-26 v2.11.68 Kimi Web 双标签 token 页修复
- 当前目标：修复顶部浏览器按钮先打开正常 Kimi Web、又额外打开一个需要 token 的 `/sessions/...` 标签页的问题。
- 已完成：撤掉 Kimix 自己补开的会话深链，只调用官方 `kimi web` 打开流程；按钮提示改为“已打开 Kimi Web”；版本号同步到 v2.11.68。
- 边界：本轮不读取、不存储、不展示官方 bearer token；当前入口不再承诺直达当前会话。
- 关键文件：`electron/main.ts`、`src/components/layout/SessionToolbar.tsx`、`package.json`、`src/components/layout/Sidebar.tsx`、`src/components/settings/SettingsPanel.tsx`。
- 下一步：验证并提交后，请用户用 v2.11.68 复验是否只打开一个已认证的 Kimi Web 标签页。

## 2026-06-26 v2.11.67 Kimi Web token 页回归修复
- 当前目标：解释并修复顶部浏览器按钮打开 Kimi Web 后出现 “Server token required” 手输 token 页的问题。
- 已完成：移除 `kimi web --no-open` 路径，点击当前会话入口时先让官方 `kimi web` 完成自己的浏览器打开/认证流程，再打开 `/sessions/<sessionId>` 深链；版本号同步到 v2.11.67。
- 边界：本轮不读取、不存储、不展示官方 bearer token。
- 关键文件：`electron/main.ts`、`src/components/layout/SessionToolbar.tsx`、`package.json`、`src/components/layout/Sidebar.tsx`、`src/components/settings/SettingsPanel.tsx`。
- 下一步：验证并提交后，请用户用 v2.11.67 复验是否不再出现 token 输入页。

## 2026-06-26 v2.11.66 顶部 Kimi Web 会话入口
- 当前目标：将顶部工具栏重复的“打开终端”一级按钮改为浏览器入口，点击后打开当前会话的官方 Kimi Web 页面。
- 已完成：工具栏一级按钮改为浏览器图标；点击时若当前是 Kimi Code 会话则打开 `kimi web` 的 `/sessions/<sessionId>` 深链，否则打开 Kimi Web 首页；项目下拉菜单中的“打开终端”保留；版本号同步到 v2.11.66。
- 边界：本轮不改官方 `kimi web --host`、token 或 daemon 保活策略。
- 关键文件：`src/components/layout/SessionToolbar.tsx`、`electron/main.ts`、`electron/preload.ts`、`electron/types/ipc.ts`。
- 下一步：验证并提交后，请用户用 v2.11.66 点击顶部浏览器图标复验是否打开当前会话。

## 2026-06-26 v2.11.65 Kimi Server 断连保护
- 当前目标：排查并修复 Kimix 自管 Kimi Server 长时间运行后进程退出或 WebSocket 断连时仍被当作在线的问题。
- 已完成：自管 foreground server child 退出后 Host 立即降回 stopped/sdk；WebSocket 连续重连失败会通知 runtime failure，清理旧 client 并进入既有后台恢复；版本号同步到 v2.11.65。
- 边界：官方 `kimi web` 入口仍由 CLI 自身托管，本轮未改为长期托管或保活官方浏览器 Web UI daemon。
- 关键文件：`electron/kimiCodeServerHost.ts`、`electron/kimiCodeServerClient.ts`、`electron/kimiCodeHost.ts`、`src/utils/__tests__/kimiCodeServerHost.test.ts`、`src/utils/__tests__/kimiCodeServerClient.test.ts`。
- 下一步：验证并提交后，请用户用 v2.11.65 复验 Kimix 后台 Kimi Server 长时间打开是否仍断连；若实际断的是官方 `kimi web` 浏览器页，再做 `kimi web` 启动/探活/重开策略。

## 2026-06-26 v2.11.64 语音快捷键焦点修复
- 当前目标：修复点击会话输入区语音快捷键后 Composer 输入框丢失焦点，导致系统语音输入无法写入当前输入框的问题。
- 已完成：麦克风按钮 `mousedown` 阶段阻止按钮夺焦；触发系统语音快捷键前后都主动 focus Composer 输入框；版本号同步到 v2.11.64。
- 边界：本轮只修复会话 Composer 语音按钮，不调整设置页语音快捷键配置逻辑。
- 关键文件：`src/components/chat/Composer.tsx`、`package.json`、`src/components/layout/Sidebar.tsx`、`src/components/settings/SettingsPanel.tsx`。
- 下一步：验证并提交后，请用户用 v2.11.64 复验语音输入是否落在当前会话输入框。

## 2026-06-26 v2.11.63 页面刷新后回到原会话
- 当前目标：优化顶部“重新载入页面”按钮，刷新后回到刷新前所在会话。
- 已完成：刷新前同步调用 `persistLocalConversationState()` 和 `persistLocalActiveContext()`，确保当前会话列表与活动上下文立即落盘；版本号同步到 v2.11.63。
- 边界：本轮只处理工具栏刷新按钮；浏览器/菜单 Ctrl+R 的既有路径暂不扩大修改。
- 关键文件：`src/components/layout/SessionToolbar.tsx`、`src/utils/persistence.ts`、`package.json`、`src/components/layout/Sidebar.tsx`、`src/components/settings/SettingsPanel.tsx`。
- 下一步：验证并提交后，请用户用 v2.11.63 复验点击刷新后是否回到原会话。

## 2026-06-26 v2.11.62 顶部刷新按钮语义修复
- 当前目标：修复顶部工具栏环形箭头按钮语义危险的问题，避免用户把“撤销官方历史上一轮”误认为页面刷新。
- 已完成：将该按钮改为调用 `window.api.reloadWindow()` 的页面重新载入；按钮文案同步为“重新载入页面 (Ctrl+R)”；移除工具栏上的撤销官方历史入口；版本号同步到 v2.11.62。
- 边界：保留 slash `/undo` 的显式命令入口，本轮只移除易误点的工具栏按钮。
- 关键文件：`src/components/layout/SessionToolbar.tsx`、`package.json`、`src/components/layout/Sidebar.tsx`、`src/components/settings/SettingsPanel.tsx`。
- 下一步：验证并提交后，请用户用 v2.11.62 复验按钮 tooltip 与刷新行为。

## 2026-06-26 v2.11.61 侧栏折叠崩溃与 Skill 标题裁切修复
- 当前目标：修复用户截图反馈的左上角侧栏折叠崩溃和插件页 Skill 标题下半部分裁切。
- 已完成：将 `Sidebar` 的会话分组 `useMemo` 移到折叠早返回之前，避免 hooks 数量随 `sidebarOpen` 变化；放松 Skill 标题列的垂直裁切并固定标题 24px 行盒；版本号同步到 v2.11.61。
- 边界：本轮只修复 v2.11.60 UI polish 回归，不继续扩大插件页信息架构或侧栏视觉重设计。
- 关键文件：`src/components/layout/Sidebar.tsx`、`src/components/layout/SkillsPanel.tsx`、`package.json`、`src/components/settings/SettingsPanel.tsx`。
- 下一步：验证并提交后，请用户用 v2.11.61 复验折叠按钮和插件页标题。

## 2026-06-26 v2.11.60 前端 polish 第三轮
- 当前目标：完成三轮前端 polish 的第三轮，收拢侧栏、插件页和弹窗的局部整齐度。
- 已完成：统一侧栏项目行与设置入口留白；统一插件列表项、状态胶囊和 Skill 卡片 hover 层级；统一常用弹窗关闭按钮命中区；版本号同步到 v2.11.60。
- 边界：本轮不做官方 0.20 `/plugins` 四标签信息架构重设计，不改设置页业务字段和会话数据结构。
- 关键文件：`src/index.css`、`src/components/layout/Sidebar.tsx`、`src/components/layout/SkillsPanel.tsx`、`src/components/layout/DialogSystem.tsx`。
- 下一步：验证并提交后，请用户用 v2.11.60 截图验收三轮前端 polish 效果。

## 2026-06-26 v2.11.59 前端 polish 第二轮
- 当前目标：在不改变 Kimix 暖纸编辑器风格的前提下，推进第二轮聊天区整齐度优化。
- 已完成：统一聊天区折叠行、Assistant 过程行和滚动到底部浮动按钮的留白、轻触反馈与视觉层级；版本号同步到 v2.11.59。
- 边界：本轮不重排消息正文、不调整侧栏/设置/插件页结构，不处理官方 0.20 插件页大改版。
- 关键文件：`src/index.css`、`src/components/chat/ChatThread.tsx`、`src/components/chat/MessageBubble.tsx`、`src/components/chat/ToolCard.tsx`。
- 下一步：验证并提交后，进入第三轮侧栏、设置、插件和弹窗整齐度优化。

## 2026-06-26 v2.11.58 前端 polish 第一轮
- 当前目标：在不改变 Kimix 暖纸编辑器风格的前提下，按三轮计划优化前端整齐度和美观性；本轮先做全局质感基线。
- 已完成：新增 `docs/frontend-polish-plan.md` 持久化三轮方案；共享按钮、弱操作和侧栏导航增加克制按压反馈；补充标题/短文案换行、等宽数字工具类和 Markdown 图片 inset outline；版本号同步到 v2.11.58。
- 边界：本轮不调整聊天消息布局、侧栏列表结构、设置页卡片结构和插件页信息架构，避免把基线 polish 扩大成重设计。
- 关键文件：`docs/frontend-polish-plan.md`、`src/index.css`、`package.json`、`src/components/layout/Sidebar.tsx`、`src/components/settings/SettingsPanel.tsx`。
- 下一步：验证并提交后，进入第二轮聊天区整齐度优化。

## 2026-06-26 v2.11.57 Kimi Code 0.20.0 跟进
- 当前目标：跟进官方 Kimi Code 0.20.0，优先落地影响 Kimix 主聊天链路的 SDK 刷新、Markdown 行间 LaTeX 和显式 `/reload` 插件 Skill 刷新。
- 已确认：本机 `kimi --version` 与 npm latest 均为 `0.20.0`；官方 tag `@moonshot-ai/kimi-code@0.20.0` 对应 checkout commit `5f36e763ca671a2a67b4b9e5c42a611511a1e6b3`，node SDK 版本仍为 `0.10.0`。
- 已完成：刷新 `vendor/kimi-code-sdk/index.mjs` 并更新 provenance；Markdown 接入 `remark-math`/`rehype-katex`；SDK 显式 `/reload` 传入 `forcePluginSessionStartReminder: true`；版本号同步到 v2.11.57。
- 边界：Server `/reload` 暂无确认公开 REST 路由，继续显式提示不支持；shell 模式、`kimi web --host`、插件页重设计、web 文件逐行 diff、会话分页/标题同步列为后续产品评估。
- 关键文件：`docs/kimi-code-0.20-followup.md`、`scripts/probe-kimi-code-0.20.mjs`、`vendor/kimi-code-sdk/README.md`、`vendor/kimi-code-sdk/index.mjs`、`src/components/chat/MarkdownRenderer.tsx`、`src/index.css`、`electron/kimiCodeHost.ts`。
- 下一步：运行 0.20 探针、主机探针、测试、知识校验、构建和 diff 检查后窄范围提交。

## 2026-06-23 v2.11.56 手动发送消息置底
- 当前目标：修复用户手动发送消息后，聊天流可能仍停留在历史阅读位置、不主动滚到底部的问题；不改变队列消息自动发送时的滚动策略。
- 根因：用户向上阅读后 `userScrollRef` 会关闭自动跟随；普通发送只追加用户消息和助手占位，没有显式恢复本会话的 auto-follow。
- 已完成：`Composer` 在手动提交用户消息后派发 `kimix:user-message-submitted`；`ChatThread` 监听后恢复自动跟随、立即滚到底部，并开启 6 秒布局稳定置底窗口；队列消息发送显式跳过该触发。
- 关键文件：`src/components/chat/Composer.tsx`、`src/components/chat/ChatThread.tsx`。
- 下一步：完成构建、测试、知识校验和窄范围提交后，请用户用 v2.11.56 复验手动发送消息时是否立即置底。

## 2026-06-23 Kimi Code 0.19.0 跟进 todolist
- 当前目标：按官方 Kimi Code 0.19.0 增量跟进 Kimix；先刷新 vendored SDK，再探针验证 multi-directory workspace、snapshot、safety-policy 和图片 MIME 行为。
- 已确认：
  - 本机 `kimi --version` 为 `0.19.0`。
  - npm latest `@moonshot-ai/kimi-code` 为 `0.19.0`。
  - 官方源码 tag `@moonshot-ai/kimi-code@0.19.0` 对应 commit `b2d3ad07282278a64c11f4e7dd192a208e5756f5`。
  - 官方 node SDK 版本从 `0.9.4` 升到 `0.10.0`。
- 待办：
  1. [x] 刷新 `vendor/kimi-code-sdk/index.mjs` 与 provenance，保留 Kimix MCP fallback 4 秒补丁。
  2. [x] 增加 0.19 探针：SDK `additionalDirs` create/resume/session summary、`session.addAdditionalDir(path, { persist })` 已通过；Server snapshot schema/timeout 已通过。
  3. [x] 将官方 `additionalDirs` 能力接入 Kimix 创建/恢复 runtime；Server `/sessions` REST schema 暂未公开显式 additionalDirs 字段，Server 会话仍依赖上游 `.kimi-code/local.toml` 能力或后续官方 API。
  4. [x] 核对 Server snapshot 直接磁盘读取后的历史、pending approval/question 恢复兼容性；0.19 snapshot schema 与 Kimix message replay、pending approval/question 合成路径兼容。
  5. [x] 核对 safety-policy block 事件映射；`turn.ended` 的 `reason: "filtered"` 会显示为“模型安全策略拦截了本轮回复”，不再当普通完成轮次。
  6. [x] 核对图片真实格式 sniffing 与 Kimix 本地图片/Server `/files` 上传链路；Server prompt 转换会在 base64 fallback 和 `/files` 上传前按 PNG/JPEG/GIF/WebP 魔数修正 media type。
  7. [x] 评估 Ctrl+B 后台任务转移与 `/tasks` 是否需要 Kimix UI 跟进；Server `/tasks` 已接入 Kimix 后台任务面板的列表/输出/停止，官方 SDK 的前台转后台能力已补成兼容链路 IPC；Server 0.19 暂无等价 detach REST 路由，不新增误导性 UI。
- 关键文件：`docs/kimi-code-0.19-followup.md`、`scripts/vendor-kimi-code-sdk.mjs`、`vendor/kimi-code-sdk/README.md`、`vendor/kimi-code-sdk/index.mjs`、`electron/kimiCodeHost.ts`、`electron/kimiCodeServerClient.ts`。
- 下一步：0.19 当前跟进项已处理完；下一轮可做一遍轻量 review 后准备发布。

## 2026-06-21 官方能力对齐 todolist
- 当前目标：继续扫平 Kimix 与官方 Kimi Code Server 的能力差异；能走官方原生 API 的优先迁移，官方未公开能力不得伪装为已对齐。
- 补充扫描：
  - ✅ P0：排队消息可能命中已从主进程活动映射移除、但仍持久存在的 runtime，并显示 session is not active；已在统一发送入口恢复缺失映射，排队路径恢复失败时创建当前项目的新 runtime 并静默重发。
  - ✅ P0：应用启动自动恢复会话时，置底早于历史正文补全和 Markdown 布局稳定结束；已改为监听内容尺寸变化，连续稳定后执行最终置底，用户主动滚动立即取消。
  - ✅ P0：/skill 消息发送后过程头延迟到首个模型事件才出现；根因是 Skill 前置激活在创建本地 assistant 占位前执行。已改为先创建用户消息和过程头占位，再执行 Skill 激活并发送 prompt。
  - ✅ P0：创建 Server 会话时遇到 Session already exists 被渲染成错误卡；已识别 already exists 并接管已有 Server 会话，不再向用户暴露冲突错误。
  - ✅ P0：排队消息发送时仍可能复现 Session already exists 错误卡；已让排队发送静默恢复并接管已有官方会话后重发，同时兼容链路创建遇到已存在会话也改为恢复。
  - ✅ P0：归档已被官方删除的 Server 会话时会弹出 /api/v1/... does not exist 技术错误；已将这类 session missing 视为幂等成功，本地隐藏镜像并不再提示底层接口。
  - ✅ P0：消息信息气泡不能因空指标或纯时间状态被判空而消失；已恢复 footer 固定间距，除静默重试/中断类瞬态状态外，footer 状态至少显示时间信息。
  - ✅ P1：浏览器预览兜底、主进程能力缺失错误、配置导出失败和事件 mapper 默认错误仍会透出 Kimi Code SDK；已统一收口为 Kimi Code / 兼容链路口径。
  - ✅ P1：Slash/Skill/插件页仍有 SDK、TUI、Superpowers 等用户不需要理解的内部口径；已收口为“兼容能力 / 终端主题 / 官方插件”。
- 待办：
  1. ✅ P0：Goal / Swarm 仍是 SDK-only 能力，Server 会话误调用时会报 “Kimi Code session is not active”；已改为清晰能力边界，Server 会话显式提示暂未公开对应 API。
  2. ✅ P0：/reload 在 Server 会话只刷新 session 信息却提示“已重载配置”；已改为显式失败，明确 Server 暂无直接 reload API。
  3. ✅ P1：外部网页归档后，本地对账目前只增不减；已改为 Server 官方列表成功返回时双向对账，缺失的同项目官方镜像会本地隐藏。
  4. ✅ P1：历史正文加载仍优先本地镜像；已改为 Server 可用时优先使用官方 snapshot，再回落本地镜像。
  5. ✅ P1：Kimix 自有 pendingMessages 未与官方 prompts active/queued 队列补偿同步；已增加官方队列门禁，Server busy 时不会提前 shift 本地消息。
  6. ✅ P1：Slash 清单仍偏硬编码；已按当前 Server/SDK 运行时动态裁剪，不再向 Server 会话暴露 Goal、Swarm、reload。
  7. ✅ P2：Workspace、`@文件` 搜索、项目文本预览、图片消息格式、文件上传、OAuth 生命周期、配置 merge 写入、默认模型专用路由和历史加载待处理审批/问题补偿已对齐；目录选择保留 Electron 原生实现；官方 0.18 未提供模型/Provider 删除；消息详情分页与 Server Terminal 属于诊断/官方 Web 通道，不是 Kimix 主交互必须补齐的 UI。
- 边界：长程任务、Kimix 主题、Claude/Codex 导入、本地会话备份、Hooks、项目启动命令属于 Kimix 扩展，不按官方未对齐处理。
- 下一步：继续扫描剩余旧版/非官方接口残留，优先处理会影响主聊天体验的项。

## 2026-06-21 v2.11.41 Server 路由文案收口
- 当前目标：清理设置页中会误导用户的旧“实验功能”、SDK、REST/WebSocket 等内部路由文案。
- 根因：Server 已是默认主链路，设置页仍沿用早期实验开关命名和内部技术描述，容易让用户误以为功能仍处于实验态或需要理解底层链路。
- 已完成：保留兼容字段名不迁移设置文件；设置页展示统一改为“Server 路由 / 兼容链路”；版本号同步到 v2.11.41。
- 关键文件：`src/components/settings/SettingsPanel.tsx`、`package.json`、`src/components/layout/Sidebar.tsx`。
- 已验证：OKF 严格校验通过；生产构建与 `git diff --check` 通过。
- 下一步：验证并窄范围提交后，继续扫描剩余旧版/非官方接口残留。

## 2026-06-21 v2.11.40 历史待处理项补偿
- 当前目标：恢复 Server 历史会话时补齐官方 pending approvals/questions，避免用户打开历史会话时看不到待处理卡片。
- 根因：Kimix 实时订阅和 WebSocket 重连 snapshot 已能补 pending 项，但 `loadServerSessionHistory` 只把 snapshot messages 转为历史事件，漏掉了 snapshot 的 `pending_approvals` 与 `pending_questions`。
- 已完成：新增历史加载专用 snapshot frame 转换，保留消息 replay 逻辑，同时为 pending approval/question 合成官方事件；实时 snapshot 恢复路径不变，避免运行中重复渲染。
- 关键文件：`electron/kimiCodeServerClient.ts`、`electron/kimiCodeHost.ts`、`src/utils/__tests__/kimiCodeServerClient.test.ts`。
- 已验证：Server Client 定向测试 22/22；全量测试 32 个文件、245/245；OKF 严格校验与 180 天维护审计通过；生产构建与 `git diff --check` 通过。
- 下一步：验证并窄范围提交后，继续扫描剩余旧版/非官方接口残留。

## 2026-06-21 v2.11.39 官方默认模型路由
- 当前目标：优先使用官方模型目录的 `:set_default` 专用接口，并确认模型与 Provider 删除边界。
- 根因：默认模型虽已能通过 `/config` 修改，但官方提供了带模型存在性校验的专用路由；另一方面，官方 0.18 实际 Server 没有删除模型或 Provider 的路由。
- 已完成：仅修改默认模型时调用官方专用接口；其他配置仍使用 merge 路由；设置成功提示不再固定声称“通过官方 SDK”；删除逻辑继续作为 Kimix 本地配置扩展，不伪装成 Server 原生能力。
- 关键文件：`electron/kimiCodeServerClient.ts`、`electron/kimiCodeHost.ts`、`electron/main.ts`、`src/utils/__tests__/kimiCodeServerClient.test.ts`。
- 已验证：Server Client 定向测试 21/21；全量测试 32 个文件、244/244；OKF 严格校验与 180 天维护审计通过；生产构建与 `git diff --check` 通过。
- 下一步：验证并窄范围提交后，审计消息详情分页与审批/问题列表补偿。

## 2026-06-21 v2.11.38 官方配置写入
- 当前目标：让新增 Provider、模型配置、默认模型与 adaptive thinking 修改优先走官方 Server `/config` merge API。
- 根因：官方 0.18 已公开配置写接口，但 Kimix 所有设置变更仍先调用 SDK；同时 Kimix 使用 camelCase，不能原样发送给官方 wire schema。
- 已完成：增加顶层、Provider 与模型字段的 camelCase 到 snake_case 转换；Server 就绪时优先官方配置写入并重新读取 SDK 完整配置；官方失败时回落既有 SDK 写入。删除语义未混入本次 merge 迁移。
- 关键文件：`electron/kimiCodeServerClient.ts`、`electron/kimiCodeHost.ts`、`src/utils/__tests__/kimiCodeServerClient.test.ts`。
- 已验证：Server Client 定向测试 20/20；全量测试 32 个文件、243/243；OKF 严格校验与 180 天维护审计通过；生产构建与 `git diff --check` 通过。
- 下一步：验证并窄范围提交后，审计模型与 Provider 删除能力。

## 2026-06-21 v2.11.37 官方 OAuth 生命周期
- 当前目标：让登录状态、设备授权、取消未完成授权和退出优先走官方 Server OAuth API。
- 根因：Kimix 虽读取了 Server `/auth` 诊断，但登录固定调用 SDK，退出仅删除本地凭据文件，可能与 Server 运行态不一致。
- 已完成：Server 就绪时以官方 `/auth` 判断登录；登录调用官方设备授权并打开验证页；退出前取消未完成授权，再调用官方 logout；Server 不可用或 OAuth 调用失败时保留 SDK 登录与本地凭据清理兼容路径。
- 关键文件：`electron/kimiCodeServerClient.ts`、`electron/kimiCodeHost.ts`、`electron/main.ts`、`src/utils/__tests__/kimiCodeServerClient.test.ts`。
- 已验证：Server Client 定向测试 19/19；全量测试 32 个文件、242/242；OKF 严格校验与 180 天维护审计通过；生产构建与 `git diff --check` 通过。
- 下一步：验证并窄范围提交后，审计官方配置与默认模型写入能力。

## 2026-06-21 v2.11.36 官方图片上传
- 当前目标：让 Server 会话中的本地图片先走官方 `/files` 上传，再通过 `file_id` 发送 prompt。
- 根因：v2.11.35 已把图片转换为官方 `image.source`，但 data URL 仍直接内嵌为 base64，没有复用官方 Web 的文件生命周期。
- 已完成：新增 multipart 文件上传；本地图片上传成功后转换为官方 file source；prompt、steer 与 BTW 共用同一转换入口；网络图片继续使用 URL source；未提供上传器的纯转换场景保留 base64 source。
- 关键文件：`electron/kimiCodeServerClient.ts`、`src/utils/__tests__/kimiCodeServerClient.test.ts`。
- 已验证：Server Client 定向测试 18/18；全量测试 32 个文件、241/241；OKF 严格校验与 180 天维护审计通过；生产构建与 `git diff --check` 通过。
- 下一步：验证并窄范围提交后，审计官方 OAuth 生命周期。

## 2026-06-21 v2.11.35 官方图片消息格式
- 当前目标：完成目录浏览边界审计，并修复 Server 图片消息仍使用旧式 payload 的协议偏差。
- 根因：官方 `/fs:home`、`/fs:browse` 用于 Web 无法调用系统选择器的场景，Kimix Electron 原生目录对话框不应被重复实现替换；但 Server prompt 把图片转换为 `image_url`，不符合官方 0.18 `image.source` 协议。
- 已完成：明确目录选择器属于桌面适配并保留；Server 图片 data URL 转为官方 `image + base64 source`，普通 URL 转为 `image + url source`；SDK 输入格式保持不变。
- 关键文件：`electron/kimiCodeServerClient.ts`、`src/utils/__tests__/kimiCodeServerClient.test.ts`。
- 已验证：Server Client 定向测试 16/16；全量测试 32 个文件、239/239；OKF 严格校验与 180 天维护审计通过；生产构建与 `git diff --check` 通过。
- 下一步：验证并窄范围提交后，评估官方文件上传链路。

## 2026-06-21 v2.11.34 Server 文件预览优先
- 当前目标：让 Server 会话中的项目文本预览优先使用官方会话级 `fs:read`，同时保持现有安全和兼容边界。
- 根因：预览面板、会话 Plan 卡片和侧栏 Plan 读取均只调用本地文件系统，未使用 Server 已提供的会话工作区读取接口。
- 已完成：读取请求可携带 runtime session ID；仅在 Server 会话根与项目根一致时调用官方 `fs:read`；限制 UTF-8 文本和 1 MiB，二进制/超限/官方失败回落既有本地校验；`__latest_kimi_plan__` 与用户目录 Kimi Plan 明确保留本地读取。
- 关键文件：`electron/kimiCodeServerClient.ts`、`electron/kimiCodeHost.ts`、`electron/main.ts`、`electron/types/ipc.ts`、`src/components/layout/AppShell.tsx`、`src/components/chat/ChatThread.tsx`。
- 已验证：Server Client 定向测试 16/16；全量测试 32 个文件 239/239；OKF 严格校验、180 天维护审计、生产构建及差异检查通过。
- 下一步：验证并窄范围提交后，审计官方目录浏览能力。

## 2026-06-21 v2.11.33 Server 文件搜索优先
- 当前目标：让 Server 会话的 `@文件` 补全使用官方工作区文件搜索，而不是始终由 Kimix 递归扫描磁盘。
- 根因：Composer 只把项目路径传给本地 `project:searchFiles`；即使 Server 已接管，会话级 `fs:search` 的工作区边界、gitignore 和排序也完全未使用。
- 已完成：搜索请求携带当前 runtime session ID；主进程仅在该 Server 会话与项目根匹配且查询非空时调用官方 `fs:search`，过滤为文件候选；SDK、空查询、会话未恢复或官方失败时回落现有本地搜索。
- 关键文件：`electron/kimiCodeServerClient.ts`、`electron/kimiCodeHost.ts`、`electron/main.ts`、`electron/types/ipc.ts`、`src/components/chat/Composer.tsx`。
- 已验证：Server Client 定向测试 15/15；全量测试 32 个文件 238/238；OKF 严格校验、180 天维护审计、生产构建及差异检查通过。
- 下一步：验证并窄范围提交后，继续迁移 Server 文件预览读取。

## 2026-06-21 v2.11.32 官方 Workspace 会话绑定
- 当前目标：在不覆盖 Kimix 项目扩展数据的前提下，让新建 Server 会话使用官方 Workspace 生命周期。
- 根因：Kimix 项目还承载置顶、排序、Git 和长程任务，不能被官方 Workspace 直接替代；但 Server 会话此前只传 `metadata.cwd`，没有调用 `/workspaces`，也没有携带官方 `workspace_id`。
- 已完成：创建 Server 会话前先通过官方 `/workspaces` 幂等注册/刷新工作目录，再使用官方返回的规范 root 与 workspace ID 创建会话；Server 失败仍保持既有 SDK fallback。Kimix 项目目录继续保存本地扩展字段。
- 关键文件：`electron/kimiCodeServerClient.ts`、`src/utils/__tests__/kimiCodeServerClient.test.ts`。
- 已验证：Server Client 定向测试 14/14；全量测试 32 个文件 237/237；OKF 严格校验、180 天维护审计、生产构建及差异检查通过。
- 下一步：验证并窄范围提交后，继续审计官方文件服务。

## 2026-06-21 v2.11.31 Slash 运行时能力清单
- 当前目标：让 Slash 补全只展示当前运行时真正可用的命令，避免 Server 会话继续出现 SDK-only 入口。
- 根因：Composer 对 `kimi-code` 会话直接采用完整静态清单，绕过了主进程能力查询；主进程的查询本身也忽略 sessionId 并固定返回同一组命令。
- 已完成：主进程按活动会话识别 Server/SDK 运行时；Server 清单排除 Goal、Swarm、reload，SDK 清单保留兼容入口；渲染层统一查询运行时清单，查询中、查询失败或会话尚未恢复时使用不含 SDK-only 项的保守集合。
- 关键文件：`electron/kimiCodeSlashCommands.ts`、`electron/kimiCodeHost.ts`、`electron/main.ts`、`src/components/chat/Composer.tsx`。
- 已验证：运行时清单与 Slash 路由定向测试 8/8；全量测试 32 个文件 236/236；OKF 严格校验、180 天维护审计、生产构建及差异检查通过。
- 下一步：验证并窄范围提交后，进入 P2 Workspace 官方能力审计。

## 2026-06-21 v2.11.30 官方 Prompt 队列门禁
- 当前目标：避免 Kimix 本地 pendingMessages 与官方 Server prompts active/queued 状态不同步导致重复派发或停止状态误判。
- 根因：收到 completed 状态后，Kimix 立即 shift 下一条本地消息；但官方 Server 可能仍有 active/queued prompt。Server abort 后也直接标记 interrupted，没有复查官方队列。
- 已完成：新增轻量官方 prompt queue IPC；普通会话和长程任务自动派发前先核对官方队列；Server busy 时保留本地待发消息；abort 后若官方仍有 prompt 则保持 running 状态；SDK 和查询失败路径继续使用原本地队列逻辑。
- 关键文件：electron/kimiCodeHost.ts、electron/main.ts、electron/preload.ts、electron/types/ipc.ts、src/App.tsx、src/utils/promptQueue.ts。
- 已验证：队列定向测试通过；全量测试 31 个文件 233/233、OKF 严格校验、180 天维护审计、生产构建和 git diff --check 通过。
- 下一步：窄范围提交后，继续处理 P1 Slash 清单按 Server/SDK 能力动态裁剪。

## 2026-06-21 v2.11.29 官方历史正文优先
- 当前目标：让历史正文加载优先使用官方 Server snapshot/messages，减少本地镜像与官方网页显示不一致。
- 根因：kimi-code:loadSession 只读取本地 sessionHistory 镜像；旧缓存曾出现 Markdown、换行和 Skill 内部指令映射偏差，打开历史会话时可能继续展示本地错误版本。
- 已完成：Server 会话历史优先读取官方 snapshot 并转换成 Kimix 现有历史事件；snapshot 失败时回落本地镜像；官方 snapshot 用户消息也会还原成普通用户消息；历史 mapper 支持官方 content.part。
- 关键文件：electron/main.ts、electron/kimiCodeHost.ts、electron/kimiCodeServerClient.ts、src/utils/eventMapper.ts。
- 已验证：事件映射与 Server client 定向测试通过；全量测试 30 个文件 230/230、OKF 严格校验、180 天维护审计、生产构建和 git diff --check 通过。
- 下一步：窄范围提交后，继续处理 P1 pendingMessages 与官方 prompts active/queued 队列补偿同步。

## 2026-06-21 v2.11.28 官方目录双向对账
- 当前目标：修复官方网页归档会话后，Kimix 本地侧栏仍显示旧会话的问题。
- 根因：启动和项目切换时读取的是本地历史镜像，且目录对账只会把官方可见项补进本地，不会隐藏官方已经不可见的旧镜像。
- 已完成：启动/项目切换改用官方 Server 会话列表对账；仅在 Server 列表成功返回时执行缺失隐藏；保护 SDK fallback、本地-only、长程任务和其他项目会话；Server title/lastPrompt 可生成本地占位标题。
- 关键文件：`src/App.tsx`、`src/utils/sessionCatalog.ts`、`electron/kimiCodeHost.ts`、`electron/main.ts`。
- 已验证：目录对账单测 9/9、全量测试 30 个文件 229/229、OKF 严格校验、180 天维护审计、生产构建和 `git diff --check` 通过。
- 下一步：窄范围提交后，继续处理 P1 历史正文优先官方 snapshot/messages。

## 2026-06-21 v2.11.27 Server-only 能力边界
- 当前目标：处理官方能力对齐 P0，避免 Server 会话误走 SDK-only 的 Goal / Swarm / reload。
- 根因：Goal / Swarm 仍由 SDK 暴露，官方 Server OpenAPI 暂未提供；/reload 在 Server 分支只刷新 session metadata 却返回成功，造成伪重载。
- 已完成：Server 会话调用 Goal / Swarm / reload 时返回明确的不支持提示；Slash 补全文案标注 SDK 兼容能力；版本号同步到 v2.11.27。
- 关键文件：`electron/kimiCodeHost.ts`、`src/components/chat/Composer.tsx`、`electron/main.ts`、`knowledge/architecture/runtime-routing.md`。
- 已验证：全量测试 30 个文件、224/224 通过；OKF 严格校验、180 天维护审计、生产构建和 `git diff --check` 通过。
- 下一步：处理 P1 外部归档同步，避免官方网页归档后 Kimix 侧栏继续显示旧会话。

## 2026-06-21 v2.11.26 官方归档语义对齐
- 当前目标：确认 Kimix 归档行为是否与官方一致，并消除本地与官方归档状态分叉。
- 根因：Kimix 先本地归档再异步请求官方，官方失败不会回滚；设置页还提供官方不存在的 unarchive“恢复”操作；SDK 路径在无法调用官方归档时会静默返回成功。
- 已完成：官方归档成功后才写本地状态与 tombstone；失败时保留会话并提示；Server 归档后停止订阅；移除本地恢复入口；SDK 无官方能力时明确失败；设置页明确只可移除本地归档记录。
- 关键文件：`src/utils/sessionArchive.ts`、`src/hooks/useArchiveSession.ts`、`electron/kimiCodeHost.ts`、`src/hooks/useStatePersistence.ts`、`src/components/layout/Sidebar.tsx`、`src/components/layout/SessionToolbar.tsx`、`src/components/settings/SettingsPanel.tsx`。
- 已验证：官方优先顺序、成功后本地归档、失败不隐藏测试通过；全量测试 30 个文件、224/224 通过，OKF 严格校验、180 天维护审计、生产构建和 `git diff --check` 通过。
- 下一步：窄范围提交后，等待 v2.11.26 实机验收单个归档、批量归档和失败提示。

## 2026-06-21 v2.11.25 非归档会话目录对账
- 当前目标：修复 Kimi Server 网页仍正常可见的非归档会话偶尔未出现在 Kimix 项目侧栏的问题。
- 根因：Kimix 侧栏只读取本地会话镜像；启动恢复虽然取得完整官方会话列表，但只将一条最新会话写回本地，缓存缺项和项目切换后其余官方会话无法自行恢复。
- 已完成：启动和切换项目时将完整可见官方目录对账进本地镜像；新发现会话只建立轻量占位，点开时再加载正文；已有本地正文、标题和归档状态保持不变。
- 关键文件：`src/utils/sessionCatalog.ts`、`src/App.tsx`、`src/utils/__tests__/sessionCatalog.test.ts`。
- 已验证：目录补齐、已有正文保留、归档不复活和跨项目隔离测试通过；全量测试 29 个文件、221/221 通过，OKF 严格校验、生产构建和 `git diff --check` 通过。
- 下一步：窄范围提交后，等待 v2.11.25 实机确认 Project06 侧栏与 Server 非归档列表一致。

## 2026-06-21 v2.11.24 Server 正文原样合并
- 当前目标：修复 Kimix 在编号列表、英文短语、括号和标题中出现多余换行或缺少换行，而同一会话在 Server 网页正常的问题。
- 根因：Kimix 根据工具、压缩和子代理等过程事件猜测段落边界并主动插入空行，但 Server 增量可以在任意 token 中间被过程事件穿插，无法安全推断语义换行。
- 已完成：过程事件不再改写助手正文；Server 文本增量按原字符顺序直接拼接，换行只服从原始正文；启动时最近会话的本地助手正文与官方完成历史对账，差异时恢复官方版本。
- 关键文件：`src/utils/eventMapper.ts`、`src/App.tsx`、`src/utils/__tests__/eventMapper.test.ts`。
- 已验证：编号列表、英文短语、标题路径跨过程边界的原样拼接测试通过；全量测试 28 个文件、217/217 通过，OKF 严格校验、生产构建和 `git diff --check` 通过。
- 下一步：窄范围提交后等待 v2.11.24 实机验收新消息及旧缓存与 Server 网页显示一致。

## 2026-06-21 v2.11.23 整轮计时修复
- 当前目标：修复助手过程头计时在思考、命令、子代理和输出阶段切换时反复归零，并改为中文时长。
- 根因：界面明确选择当前阶段的最新时间戳作为起点；完成态也优先采用助手阶段时长，而非用户消息到本轮结束的总时长。
- 已完成：渲染分组向助手过程头传递本轮用户消息时间；阶段只切换状态文案，不再改变计时起点；完成态优先整轮区间；显示格式改为 `x分x秒`，不足一分钟显示 `x秒`。
- 关键文件：`src/components/chat/ChatThread.tsx`、`src/components/chat/MessageBubble.tsx`、`src/utils/processTiming.ts`、`src/utils/eventMapper.ts`、`src/utils/duration.ts`。
- 已验证：整轮起点、阶段切换不重置、完成态整轮时长和中文格式测试通过；全量测试 28 个文件、216/216 通过，OKF 严格校验、生产构建和 `git diff --check` 通过。
- 下一步：窄范围提交后等待 v2.11.23 实机验收长轮次跨思考、工具、子代理与输出阶段的连续计时。

## 2026-06-21 v2.11.22 流式 Markdown 边界修复
- 当前目标：修复同一条 Server 消息在官方网页显示正常，但 Kimix 将 `**Explorer:**` 拆成孤立 `**` 与错误正文的问题。
- 根因：工具或子代理事件夹在文本增量之间时，Kimix 会补段落；当流边界恰好位于 `- **` 与 `Explorer:**` 之间，补入的空行破坏了 Markdown 强调语法。官方网页使用完成后的规范消息，因此不受影响。
- 已完成：未闭合的 `**` / `__` 强调语法跨过程边界时直接拼接；启动恢复检测本地缓存的未闭合强调行，并用官方完整历史替换损坏正文。
- 关键文件：`src/utils/eventMapper.ts`、`src/utils/eventHelpers.ts`、`src/App.tsx`。
- 已验证：针对工具边界拆分强调语法和缓存损坏检测的回归测试通过；全量测试 27 个文件、215/215 通过，OKF 严格校验、生产构建和 `git diff --check` 通过。
- 下一步：窄范围提交后等待 v2.11.22 实机验收同一消息与官方 Server 网页的显示一致性。

## 2026-06-21 v2.11.21 Skill 子路由与缓存历史修复
- 当前目标：修复 v2.11.20 中子 Skill 仍未进入当前会话清单，以及旧会话仍显示完整 `<kimi-skill-loaded>` 指令的问题。
- 根因：直接 `/skill:` 分支绕过了 Agent Skill 全量同步；首次刷新时间又可能大于安装包自带的旧文件 mtime，导致新展平的子 Skill 被误判为已加载。历史侧栏对已有本地事件直接返回，旧缓存未经过官方历史映射器。
- 已完成：所有 Skill 激活前先同步 Agent Skills；只要创建了新的顶层或展平注册项就强制 fork 刷新；应用启动恢复本地会话时迁移 Skill 载荷消息和合成英文标题。
- 关键文件：`src/components/chat/Composer.tsx`、`electron/skillMigration.ts`、`src/utils/eventHelpers.ts`、`src/App.tsx`。
- 已验证：真实 Server 探针确认嵌套目录不注册、展平后的 slash 子 Skill 可注册且 fork 后可见；全量测试 27 个文件、213/213 通过，OKF 严格校验、生产构建和 `git diff --check` 通过。
- 下一步：窄范围提交后等待 v2.11.21 实机验收父/子 Skill 调用与旧缓存迁移。

## 2026-06-20 v2.11.20 安装后 Skill 自动刷新
- 当前目标：修复 `find-skills` 已将 Skill 安装到 `~/.agents/skills`，但下一条普通消息仍无法使用新 Skill 的问题。
- 根因：Kimix 本地扫描遗漏标准 `.agents/skills` 目录；同时 Server 会话的 Skill 注册表固定在创建时，普通消息发送前没有检测安装变化并刷新 runtime。
- 已完成：纳入 `.agents/skills` 扫描；发送普通消息前静默同步新安装的顶层 Skill（连同子 Skill），按最新修改时间判断当前 runtime 是否过期，必要时通过官方 fork 保留上下文并刷新注册表后再发送。
- 子 Skill 兼容：真实探针确认 Server 不扫描嵌套目录但接受带 `/` 的 Skill 名称；同步时将子 Skill 额外展平到 Kimi Code Skill 根目录，并把副本名称改为原始完整路由（如 `game-development/game-design`）。
- 同轮修复：历史加载会把官方 `<kimi-skill-loaded>` 内部指令压缩为简短 Skill 调用信息，模型自动调用不再伪装成用户消息；Skill 首轮激活会生成正常会话标题。
- 关键文件：`electron/skillMigration.ts`、`electron/main.ts`、`src/components/chat/Composer.tsx`、`src/types/ui.ts`。
- 已验证：真实 Server 探针确认旧会话直接激活返回 `40415`，官方 fork 后可发现顶层及展平的嵌套 Skill 并成功激活；全量测试 27 个文件、210/210 通过，OKF 严格校验、生产构建及 `git diff --check` 通过。
- 下一步：窄范围提交后，由用户在 v2.11.20 实机验收安装后调用、消息显示和旧会话标题。

## 2026-06-20 v2.11.19 Skill 真实调用修复
- 当前目标：修复本地/Codex Skill 虽出现在 `/skill:` 补全中，发送后却丢失 Skill 前缀并作为普通文本交给 Agent 的问题。
- 根因：官方会话未识别本地 Skill 时，旧逻辑只写入 Kimix 的“已启用”设置，随后剥掉 `/skill:<name>` 并发送参数正文；该设置没有接入 Kimi Server 的 Skill 扫描目录，因此不构成真实 Skill 调用。
- 已完成：用户消息保留完整 Skill 指令；本地 Skill 会先无覆盖迁移到 Kimi Code 用户 Skill 目录，再通过官方 fork 保留上下文并刷新 Skill 注册表，确认 Server 可见后才调用官方激活接口；迁移、识别或激活失败时明确报错，不再降级为普通消息。
- 已验证：Skill 目录迁移测试覆盖完整目录复制和同名目标不覆盖；真实 Server 探针确认原会话创建后迁入 Skill 时直接激活返回 `40415`，fork 后会发现并成功激活同一 Skill；全量测试 27 个文件、207/207 通过，OKF 严格校验、生产构建及 `git diff --check` 通过。
- 关键文件：`src/components/chat/Composer.tsx`、`electron/skillMigration.ts`、`electron/main.ts`、`electron/preload.ts`。
- 下一步：窄范围提交后由用户实机验收 Skill 指令显示和调用结果。

## 2026-06-20 古早接口与功能残留迁移
- 当前目标：按风险从低到高迁移并清理旧版 Kimi 对接接口、无调用功能和过时说明，保留仍承担用户升级与历史会话读取职责的兼容逻辑。
- 待办：
  1. ✅ 清理无调用的古早 TUI 登录、旧插件安装与 Superpowers 安装接口。
  2. ✅ 将 Renderer 对旧 `kimi:*` IPC 的调用迁移到 `kimi-code:*`，先迁移调用方，再删除兼容入口。
  3. ✅ 迁移依赖旧事件通道的 handoff 等逻辑，随后移除 `kimi:event` / `kimi:status` 双广播与旧 preload 监听。
  4. 清理无引用文件、函数、误提交运行日志和过时用户文案。
  5. ✅ 归档或删除已经失去维护价值的旧迁移计划与探针材料。
  6. ✅ 执行全量测试、OKF 校验、构建与最终残留扫描，形成迁移收尾证据。
- 保留边界：`~/.kimi` 配置迁移、历史会话解析、历史 Superpowers 消息识别等读取兼容，在明确支持截止策略前不删除。
- 提交策略：每个可独立验证的迁移增量单独窄范围提交；禁止 `git add .`，不处理历史未跟踪文件。
- 关键文件：`electron/main.ts`、`electron/preload.ts`、`electron/types/ipc.ts`、`src/App.tsx`、`src/components/`、`src/main.tsx`。
- 已完成：删除会启动裸 `kimi` 并写入 `/login` 的旧 TUI 登录实现；删除已无 Renderer 调用且依赖不存在 CLI 子命令的旧 Plugin 安装入口；删除旧 Superpowers 下载、安装与 bootstrap IPC。历史 Superpowers 消息读取兼容继续保留。
- 迁移进度：Renderer 的消息发送、停止轮次、关闭会话、加载历史已从旧 `sendPrompt` / `stopTurn` / `closeSession` / `loadSession` 切换到 `sendKimiCodePrompt` / `cancelKimiCodeTurn` / `closeKimiCodeSession` / `loadKimiCodeSession`；对应旧 preload 暴露已删除。
- 迁移进度：启动 runtime、历史列表、slash 列表、会话导出、账户用量、Vis 与 Web Server 保留原有 Kimix 产品语义，但公开方法和 IPC channel 已统一迁入 `kimi-code:*` 命名空间；Renderer 已无旧会话 API 调用。
- 迁移进度：handoff、长程任务和缺少 `engine` 字段的历史本地会话已统一消费 `kimi-code:event` / `kimi-code:status`；旧双广播、旧 preload 监听及无调用旧会话 handler 已删除。
- 清理进度：删除无引用的旧 Kimi 类型、会话 hooks、TodoCard 和误提交 dev 日志；增加 `*.err` 忽略规则；slash 与浏览器预览文案不再暴露旧 SDK/未实现边界描述。
- 清理进度：删除全仓仅有定义、没有调用的目录复制、旧模型环境收集、用量/插件格式化、画板换色、Markdown fence 包装和用户输入包装函数。
- 清理进度：旧 Kimi SDK/Wire 迁移计划和旧探针结果已移入 `docs/archive/`；删除会继续探测旧 `@moonshot-ai/kimi-agent-sdk`、旧 0.8 API 和 P7 迁移阶段的历史探针脚本；vendor 刷新说明改为当前 host smoke probe。
- 收尾扫描：主路径只剩知识库中“不得再复制旧 `kimi:event` / `kimi:status` 通道”的架构约束文本；未发现旧会话 IPC、旧事件监听、旧插件/Superpowers 安装接口、旧探针脚本或用户可见旧链路文案残留。
- 注意：本轮发现新增未跟踪 `nul`，疑似另一边操作产生的 Windows 保留名文件，未处理。
- 下一步：等待用户实机验收启动、发送、handoff/长程任务事件是否正常。

## 2026-06-20 v2.11.9 自动重试静默化
- 当前目标：避免底层会话失效自动重试时，过程头短暂闪现“消息重新发送中”打扰用户。
- 已完成：删除 runtime 重建前后的两次警告状态更新；自动重建和重发继续执行，但用户侧过程头保持“消息发送中”不变。
- 已验证：`pnpm test:run` 26 个测试文件、200/200 通过；`pnpm knowledge:validate` 通过；`pnpm build` 通过，renderer hash `index-CpiYAzQ8.js`；`git diff --check` 通过。
- 关键文件：`src/components/chat/Composer.tsx`。
- 下一步：窄范围提交本轮自动重试静默化。

## 2026-06-20 v2.11.8 活跃轮次冲突提示收口
- 当前目标：避免“官方仍有未结束的轮次”作为消息头写入对话流。
- 根因：正常发送前已有本地 active-turn 队列拦截；当本地运行态短暂落后于官方状态时，官方提交仍会原子拒绝新 turn，旧兜底在回滚发送后额外写入一条 `status_update`，因此显示成消息头。
- 已完成：保留官方拒绝作为竞态兜底，但普通发送冲突时只回滚本次用户消息、发送状态和 assistant 占位，并通过 Toast 提示“上一轮仍在运行，请等待或停止后再发送”；队列自动续发冲突时静默放回队列，两者都不再生成消息头。
- 已验证：`pnpm test:run` 26 个测试文件、200/200 通过；`pnpm knowledge:validate` 通过；`pnpm build` 通过，renderer hash `index-nBQAfEN7.js`；`git diff --check` 通过。
- 关键文件：`src/App.tsx`、`src/components/chat/Composer.tsx`、`src/components/chat/EmptyState.tsx`。
- 下一步：窄范围提交本轮竞态提示收口。

## 2026-06-20 v2.11.7 发送状态文案简化
- 当前目标：去除对话里发送消息开头状态对 Kimi Server / Kimi SDK 链路的区分，统一成用户更容易理解的简短文案。
- 已完成：普通发送、空态建议发送和发送结果回写统一显示“消息发送中”；runtime 失效重试时显示“消息重新发送中”，不再暴露 server/sdk/runtime 等内部实现词。
- 已完成：设置页 Server 路由说明同步改为“对话里只显示简洁发送状态”；版本号同步到 v2.11.7，新增 release notes。
- 已验证：`pnpm test:run` 26 个测试文件、200/200 通过；`pnpm knowledge:validate` 通过；`pnpm build` 通过，renderer hash `index-CoB148OV.js`；`git diff --check` 通过。
- 关键文件：`src/utils/kimiCodeRouteStatus.ts`、`src/components/chat/Composer.tsx`、`src/components/chat/EmptyState.tsx`、`src/components/settings/SettingsPanel.tsx`。
- 下一步：窄范围提交本轮文案优化。

## 2026-06-20 v2.11.6 启动耗时日志定位与 dev 快速启动
- 当前目标：定位用户反馈“启动花了 20 多秒”的真实耗时来源，并减少日常双击启动等待。
- 已确认：当前用户启动路径是 `start-kimix.bat` → `scripts/restart-kimix-dev.ps1`，脚本每次都会杀旧 dev 进程、清 `out/` / Vite 缓存、执行 `pnpm build`，再进入 `pnpm dev`；后续快速启动实测进一步确认主进程 155ms 开始 loadURL，但 renderer entry/首帧约 19.8 秒，主因是 Vite dev 首次现场编译 renderer 大包，不是 Kimi Server 阻塞。
- 已完成：`start-kimix.bat` 默认改为运行已构建的 Electron 包，有构建产物时直接启动，无产物才先 build；热更新开发改为显式 `start-kimix.bat --dev`；完整清缓存和全量 build 改为显式 `start-kimix.bat --clean`。
- 已完成：主进程补充 `[KimixStartup] main ...` 日志，覆盖 app ready、窗口创建、loadURL/loadFile、did-finish-load、Kimi Server 后台启动和就绪；renderer 补充 theme snapshot 与 browser preview API 打点。
- 已验证：`pnpm test:run` 26 个测试文件、200/200 通过；`pnpm knowledge:validate` 通过；`pnpm build` 通过，renderer hash `index-DhQGGCwM.js`；`git diff --check` 通过；默认启动脚本实测 renderer entry 632ms、first animation frame 670ms、Kimi Server ready 3817ms。
- 关键文件：`start-kimix.bat`、`scripts/restart-kimix-dev.ps1`、`electron/main.ts`、`src/main.tsx`。
- 下一步：窄范围提交本轮启动优化。

## 2026-06-20 v2.11.5 完全访问权限与启动白屏修复
- 当前目标：修复 Server 链路下“完全访问权限”仍出现工具审批卡，以及启动后约 10 秒白屏才进入主界面的问题。
- 已确认：Kimix 三档权限 `manual` / `auto` / `yolo` 与官方 Kimi Code 权限模式一致；截图中的“完全访问权限”对应官方 `yolo`。问题是 Server approval 事件路径没有像 SDK approval handler 一样在 `yolo` 下自动批准。
- 已完成：Server session 收到 approval 时若当前 permission 为 `yolo`，直接通过官方 approval API 按 session 批准，不再发 UI 审批卡。
- 已完成：启动 bootstrap 先设置本地 currentProject/currentSession，让主界面先渲染；官方 session 列表、runtime start、history load 延后到首屏后 1.2 秒后台执行，避免 stale runtime 恢复拖慢首屏。
- 已完成：新增 `[KimixStartup]` renderer 启动打点并在主进程转发，后续可区分 renderer entry、React render、first animation frame 与 Kimi Server 后台启动时序。
- 已验证：`pnpm test:run` 26 个测试文件、200/200 通过；`pnpm knowledge:validate` 通过；`pnpm build` 通过，renderer hash `index-CzYRi0f4.js`；`git diff --check` 通过；`pnpm preview` 启动日志显示 renderer entry 841ms、React render 843ms、first animation frame 881ms，且 root 内容检查非空，Kimi Server 与 stale runtime 恢复均发生在首帧之后。
- 未完成：需要用户用 v2.11.5 实际复验“完全访问权限”下 `/goal ...` 不再弹审批卡，以及安装/dev 实际启动是否不再白屏 10 秒。
- 关键文件：`electron/kimiCodeHost.ts`、`electron/main.ts`、`src/App.tsx`、`src/main.tsx`。
- 下一步：运行测试、OKF 校验、build、preview 启动时序验证后提交。

## 2026-06-20 v2.11.4 Server slash 官方优先路由
- 当前目标：让 slash 命令优先进入 Kimi 官方发送链路，Kimix 只保留产品专属本地命令，并在官方发送链路失败时使用旧本地处理兜底。
- 已完成：新增 slash 分类 helper；`/goal`、`/swarm`、`/compact`、`/undo`、`/btw`、`/reload`、`/status`、`/usage`、`/plan`、`/skill:...` 改为官方链路优先；`/theme`、`/custom-theme`、`/import-from-cc-codex` 仍由 Kimix 本地处理。
- 已完成：新增真实 Server slash 探针 `pnpm probe:kimi-server-slash`，默认只跑低风险命令；`KIMIX_KIMI_SERVER_SLASH_PROBE_MUTATING=1` 时才跑 `/compact`、`/undo`、`/btw`、`/swarm off` 等可变更探针。
- 已完成：版本号同步到 v2.11.4，新增对应 release notes；更新 runtime routing 知识，记录“官方 slash 优先、Kimix 专属本地、旧 SDK handler 兜底”的架构不变量。
- 已验证：`pnpm probe:kimi-server-slash` 默认安全探针 8/8 通过；开启 `KIMIX_KIMI_SERVER_SLASH_PROBE_MUTATING=1` 与 `KIMIX_KIMI_SERVER_SLASH_PROBE_EXHAUSTIVE=1` 后全量探针 18/18 通过，包括 `/compact`、`/undo`、`/btw`、`/swarm on/off`、Goal start/pause/resume/cancel 和 `/skill:kimix-probe`；`pnpm test:run` 26 个测试文件、200/200 通过；`pnpm knowledge:validate` 通过；`pnpm build` 通过，renderer hash `index-CnWF7KRM.js`；`git diff --check` 通过。
- 边界：如果官方 Server 成功接收 prompt 但在内部判定某个 slash 未支持，Kimix 目前拿不到结构化“未处理”信号，只能把发送链路失败作为自动 fallback 条件。
- 关键文件：`src/components/chat/Composer.tsx`、`src/utils/slashRouting.ts`、`src/utils/__tests__/slashRouting.test.ts`、`knowledge/architecture/runtime-routing.md`。
- 下一步：审查并窄范围提交本轮相关文件，不纳入历史未跟踪目录。

## 2026-06-19 OKF v0.1 项目知识部署
- 当前目标：把稳定项目知识部署为可移植、可校验、可长期维护的 Open Knowledge Format bundle，同时不破坏现有 `docs/`、release notes 与 `TASK_STATE.md` 的职责边界。
- 已确认：截图引用的 `GoogleCloudPlatform/knowledge-catalog` 根目录是 Knowledge Catalog 工具/样例仓库，且根 README 声明仓库内容不是 Google 官方产品；OKF 规范提案位于其 `okf/SPEC.md`，当前版本为 `0.1 — Draft`。上游 SPEC 仅强制概念 `type`，同仓库 PoC 实现额外强制 `title/description/timestamp`，Kimix 明确以 SPEC 为规范源、额外要求标记为项目严格 profile。
- 已实施：新增独立 `knowledge/` bundle，首批覆盖项目概览、Server/SDK 路由、MCP/Plugin 生命周期、发布流程、知识维护策略、OKF 采用决策和上游规范引用；现有高频状态与历史文档不做机械转换。
- 已实施：新增 `scripts/validate-okf.mjs`、`pnpm knowledge:validate` 与 `pnpm knowledge:validate:spec`；严格 profile 检查必填元数据、H1、目录索引、根日志、链接与时间戳，spec-only 模式保留 OKF 宽容消费语义。
- 已实施：新增 Knowledge CI，并将知识校验作为 tag 发布工作流的前置 job；`AGENTS.md` 和 README 已写入长期维护规则与使用入口。
- 关键文件：`knowledge/`、`scripts/validate-okf.mjs`、`.github/workflows/knowledge.yml`、`.github/workflows/release.yml`、`AGENTS.md`、`README.md`、`package.json`。
- 已验证：上游研究基线固定为 commit `d2b9e2e13ccb2528af555b207b3c73312757b7c5`；spec-only 与 strict 校验均通过（7 concepts / 15 Markdown / 25 links）；校验器 3 个边界测试通过；全量 24 个测试文件、191 个测试通过；`pnpm build`、两份 workflow YAML 解析与 `git diff --check` 通过。
- 下一步：审查并只提交本轮 OKF 相关文件，不纳入历史未跟踪目录。

## 2026-06-19 v2.10.13 MCP 面板按钮反馈与插件更新
- 当前目标：修复 MCP 面板普通服务“测试 / 授权 / 重置授权 / 删除”点击后像没反应的问题，并澄清 Plugin MCP 是否必须“加入配置”。
- 已完成：普通 MCP 添加/删除改为直接安全维护 `mcp.json`，删除前备份；测试/授权/重置授权不再调用当前 Kimi Code 0.18.0 未暴露的 `kimi mcp ...` 子命令，而是在卡片内返回明确原因和运行态/更新入口提示。
- 已完成：Plugin 随带 MCP 新增“更新 MCP”按钮；原“加入配置”改为“写入 mcp.json”，文案说明这是兼容旧普通 MCP 配置，不是 Kimix 使用前置条件。
- 已完成：MCP 卡片增加局部状态反馈，运行态重启、普通 MCP 操作、Plugin 写入/更新都会在对应卡片内显示进度或错误。
- 已完成：版本锚点同步到 v2.10.13（`package.json`、`SettingsPanel`、`Sidebar`）。
- 已验证：`git diff --check` 通过；直接调用 `electron-vite build` 通过，输出 `out/main/index.cjs`、`out/preload/index.cjs`、`out/renderer/assets/index-W1y4oWuh.js`。
- 部分阻塞：`pnpm build` 会先触发 pnpm install；Electron postinstall 下载二进制时被当前网络拒绝 `connect EACCES 20.205.243.166:443`，因此完整 pnpm build 未通过。源码构建本身已通过。
- 关键文件：`electron/main.ts`、`src/components/layout/McpPanel.tsx`、`src/components/layout/Sidebar.tsx`、`src/components/settings/SettingsPanel.tsx`、`package.json`。
- 下一步：用户用 v2.10.13 窗口复验 MCP 面板；如要恢复完整 `pnpm build`，需允许 Electron 二进制下载或配置本地/镜像缓存。
- 2026-06-19 v2.10.14：MCP “更新 MCP”进一步对齐官方 `/plugins` 更新语义：仍调用官方 SDK `installPlugin(source)`，但不再传当前运行中会话、不再尝试热重启正在运行的 MCP；若当前会话运行态已加载该 Plugin MCP，则提示先 `/reload`、新会话或重启释放进程后再更新。后端对 `EBUSY/resource busy/locked` 增加专门说明，避免误判为更新源失败。
- 2026-06-19 v2.10.15：修正 v2.10.14 形成“运行态 MCP 超时但更新被占用拦截”的死循环；更新 Plugin MCP 时如果当前 runtime 正在加载同名 MCP，会先调用官方 closeSession 释放当前 runtime，再调用官方 SDK `installPlugin(source)`。更新成功后提示 `/reload` 或新会话生效；若仍 EBUSY，提示关闭其它 Kimi Code/Kimix 窗口后重试。
- 2026-06-19 v2.10.16：继续修正插件目录被 Kimix 自身占用的问题。后端 `listPlugins/installPlugin/setPluginEnabled/setPluginMcpServerEnabled` 优先使用官方 SDK harness 级插件接口，不再为插件管理创建/复用 `kimix-plugin-management` 会话；安装前会关闭残留内部插件管理会话，避免该会话加载旧 MCP 后自锁 managed 插件目录。
- 2026-06-19 v2.10.17：跟进官方 Kimi Code 0.18.0；本机 CLI 已是 0.18.0，官方源码 tag 对应 commit `e6c2f51fa3ed471e983a6dc4b2977709c62a9200`，`packages/node-sdk` 仍为 0.9.4；已重建并刷新 `vendor/kimi-code-sdk/index.mjs`，保留 Kimix MCP fallback timeout 4 秒补丁，并新增 `docs/kimi-code-0.18-followup.md`。vendor 脚本新增工作区本地官方源码 fallback，避免 Windows `%TEMP%`/用户目录权限导致 bundle 失败。

## 2026-06-18 Kimi Code 0.17.1 能力增量回归主线
- 当前修复：v2.10.11 修复思考过程展开/折叠的视口跳转：顶部摘要交互锚定摘要按钮，底部收起交互锚定正文起点；用户主动切换时终止进入会话后的自动贴底，并暂时抑制通用 ResizeObserver 补偿，避免重复滚动修正。v2.10.10 已将故障 MCP 的 SDK 默认启动等待由 30 秒收紧至 4 秒。
- 当前修复：v2.10.7 将启动恢复 Server session missing 提升为静默自愈：补齐 `was not found` 识别，旧 session 失效时 renderer 再次无 ID 创建 fresh runtime；fresh runtime 瞬时失败也不再生成启动红卡，由后台预热继续恢复；加载本地历史时清除已落盘的同类错误事件。
- 当前修复：v2.10.6 折叠“本轮内容”时以过程区结束、正文开始位置为局部滚动锚点，布局收缩前后补偿 `scrollTop`，并短暂抑制通用 ResizeObserver 锚点恢复，避免正文产生大幅跳动。
- 当前修复：v2.10.5 套餐用量悬窗承接官方用量接口的 `totalQuota`，以灰色辅助信息展示为“Kimi Code 总额度”；不将其描述为月额度。v2.10.4 已实现悬窗每次打开自动刷新及并发请求结果防覆盖。
- 当前修复：v2.10.3 稳定运行中过程头计时；assistant 正文事件已完成但同一轮工具/子代理仍在运行时，不再切到无 live elapsed 的完成耗时分支，过程头会持续显示“命令运行中/子代理运行中 x秒”。
- 当前修复：v2.10.2 恢复新会话标准欢迎页；空态判断改为基于过滤后的可渲染事件，避免后台 Server/runtime 状态事件被隐藏后仍把 ChatThread 判定为“已有内容”，导致主区域出现空白。
- 当前修复：v2.10.1 针对 v2.10.0 启动恢复旧官方 Server runtime 时 `/profile Session was not found` 仍冒红错的问题，补齐 resume 后同步 profile 阶段的 session missing 兜底；单个旧 session 丢失不再标记 Server 整体 fallback，自动创建同项目 fresh runtime 并保留 Kimix 本地历史。
- 发布收口：v2.10.0 汇总 v2.9.97 之后 48 个能力与稳定性提交；全量测试、生产构建和真实 Kimi Code 0.17.1 Server 主探针通过，准备由 tag 触发 GitHub Actions 多平台发布。
- 当前目标：停止重复加固探针，按官方 0.17.1 Server 协议逐项补齐 Kimix 的实际能力缺口。
- 能力收口 TodoList（按顺序推进）：
  - [x] 已转 Server：会话创建/恢复、prompt/steer/abort、WebSocket 恢复、审批/提问、compact/undo、BTW、归档同步、usage、Skill、MCP、会话树、tool/connections 诊断。
  - [x] 半接入 UI 1：发送状态显示每次 prompt 的真实路由（Server / SDK / Server 失败后 SDK fallback）。
  - [x] 半接入 UI 2：Server 路由对新安装默认开启；保留设置显式关闭、capability gate 和失败自动 SDK fallback 三层回滚边界。
  - [x] 半接入 UI 3：Server background task 显示来源与最新输出尾部；运行态 2 秒刷新，刷新失败保留上次成功结果并提示重试。
  - [x] 半接入 UI 4：右侧 Kimi 自检只读查询最近 messages 摘要与 active/queued prompts，不回灌正文、不形成第二套聊天历史。
  - [x] 只读已接：模型目录已有模型、Context、thinking 能力、Provider/认证状态；继续保持只读，避免与 SDK 配置和凭据形成双写。
  - [x] 暂不做：OAuth Server 写登录、Windows terminal 实机、unarchive、文件系统 REST、强制迁移全部旧 SDK 会话；均已确认阻塞、已有本地替代或边际收益过低。
- 已完成：新增 `docs/kimi-code-0.17-capability-gap.md`，区分已接入、后端已接但 UI 不完整、尚未接入、阻塞/延后能力。
- 已完成：Server client 新增 compact、undo、BTW start、archive 四个官方 REST 封装；compact、undo 已接回 Kimix 现有 `/compact`、`/undo` 正式入口。
- 已完成：Server BTW 按官方返回的 `agent_id` 提交 prompt、隔离子 Agent WebSocket 事件并汇总正文/思考/结束原因，复用现有 BTW 面板且不污染主对话。
- 已完成：所有 Kimix 归档入口统一通过状态迁移触发官方 Server `session:archive`，同时保留本地 tombstone；官方无 unarchive，因此本地恢复不会反向取消官方归档。
- 已完成：会话注册和 prompt 完成后读取 Server session status，把 `context_tokens` / `max_context_tokens` / `context_usage` 转为现有 SDK 状态事件，复用 ContextRing 展示。
- 已完成：Server Skill/MCP、会话树、tool catalog/connections 诊断，以及 auth/redacted config/model/provider 只读目录已接入现有页面；模型配置写入继续走 SDK。
- 已完成：v2.9.148 设置页新增“实验功能”模块，`experimentalKimiServer` / `experimentalKimiServerSessions` 写入 `~/.kimix/settings.json`；主进程启动时读取该设置，等效于原 `KIMIX_EXPERIMENTAL_KIMI_SERVER` / `KIMIX_EXPERIMENTAL_KIMI_SERVER_SESSIONS` 环境变量，保存后需重启生效。
- 已完成：v2.9.149 修复 Server 路由开启后本地 Server 请求失败直接 `fetch failed`；Server create/resume/prompt 失败会标记 fallback 并继续走 SDK，避免实验开关打断正常对话。
- 已完成：v2.9.150 修正 assistant “已处理 x 秒”计时口径，普通发送、空态发送和重试发送在真正调用 Kimi Code prompt 前刷新占位消息 timestamp，不再把会话恢复、Server 探测或 fallback 前置耗时算入模型处理时间。
- 已完成：v2.9.151 优化普通发送前置握手：已有 runtime id 的会话直接发送，不再每条消息前 resume；Server REST 控制请求增加 5 秒超时，卡住时更快 fallback SDK。
- 已完成：v2.9.152 针对“首条消息仍约 32 秒、第二条不到 1 秒”的实测差异，把空白 Kimi Code 会话 runtime 创建前移到用户输入前后台预热；预热失败不弹错误，发送时仍走原兜底创建链路。
- 已完成：修复 `start-kimix.bat` 构建后不拉起窗口的问题；`restart-kimix-dev.ps1` 不再把 `pnpm dev` 放到隐藏 cmd 后台，而是在当前 bat 窗口前台运行，避免后台进程快速退出时只显示“dev process exited”。
- 已完成：v2.9.153 修复老会话恢复旧 runtime 时 Server `/profile Session was not found` 直接报红错；启动恢复遇到旧 ID 不存在会创建同项目 fresh runtime，当前空闲历史会话也会后台验证/预热 runtime，让老非 Server 会话发送前先脱离失效 ID。
- 已完成：v2.9.154 给普通发送和空态建议发送增加链路状态提示，显示“准备链路 / 恢复旧 runtime / 创建 runtime / runtime 失效重建 / 已提交给 Kimi Code”等阶段，避免长时间只显示“思考中”。
- 已完成：v2.9.155 主进程返回每次 prompt 的真实发送路由；普通发送和空态建议发送会明确显示 Kimi Server、Kimi SDK 或 Server 失败后自动降级 SDK。
- 已完成：v2.9.156 将 Server host/session routing 改为新安装默认开启；已有显式关闭配置继续保持 SDK，环境变量 `0` 也可强制关闭，设置页从“实验功能”改为明确的 Server 路由与回滚说明。
- 已完成：v2.9.157 补强后台任务 UI：区分 Server/SDK 来源，映射 Server `output_preview`，运行态每 2 秒刷新；瞬时刷新失败不清空任务，保留上次结果并展示失败提示。
- 已完成：v2.9.158 接入官方 messages 分页与 prompts 队列 GET；右侧 Kimi 自检只展示最近消息数量/角色分布和 active/queued prompt 数，不读取正文到 UI、不参与本地时间线写入。
- 已完成：v2.9.159 修复运行中链路状态被 ChatThread 隐藏且空占位 assistant 被误标为“正在思考”；过程头现在显示准备/恢复/runtime/Server/SDK fallback 等真实链路阶段，收到真实 thinking、正文、工具或子代理事件后再切换为对应状态。
- 已完成：v2.9.160 为流式输出造成的 Markdown 表格截断增加兜底；确认表头后可补齐不完整分隔线，并把多行首尾粘连、再次断开的表格正文按表头列数重排，代码块及普通含竖线文本不参与修复。
- 已完成：v2.9.161 稳定运行计时和终态收口；消息计时改为组件本地秒表并在窗口重新可见/聚焦时立即校准，Server `prompt.completed` 不再被等待态漂移挡住，renderer 在运行期间轮询底层 engine 状态并以连续两次终态确认清理漏掉的停止按钮与运行圈。
- 已验证：真实 Kimi Code 0.17.1 新建空会话后，messages GET 返回 `code=0/items=0/has_more=false`，prompts GET 返回 `code=0/active=false/queued=0`。
- 收口结论：Server 模型/auth/config/provider 目录保持只读已足够；files/workspace REST 与 Electron 本地文件能力重复，OAuth/terminal 有上游阻塞，强迁移旧 SDK 会话风险高，当前没有继续实现的高收益项。
- 已验证：真实 0.17.1 返回认证 ready、1 个 connected OAuth Provider、1 个 262144 context 模型；Server OAuth login 启动超过 10 秒无响应，暂不替换现有 SDK 登录。
- 阻塞：Windows 0.17.1 terminal 仍缺少可加载的 `conpty.node`，按用户要求暂缓。
- 关键文件：`electron/kimiCodeServerClient.ts`、`electron/kimiCodeHost.ts`、`docs/kimi-code-0.17-capability-gap.md`。
- 下一步：用户在 v2.9.159 验收发送后的过程头阶段切换，并继续验收默认 Server、后台任务和 Kimi 自检。

## 2026-06-14 v2.9.87 显式会话快照迁移
- 当前目标：放弃 dev 版 / 安装版自动共享会话状态，改为用户手动导出全部快照、另一端去重合并导入。
- 已完成：清理自动共享状态 IPC 和共享文件路径方案；新增主进程快照 zip/json 读写 IPC；设置页新增“会话迁移”区块，支持导出全部与合并导入。
- 已完成：快照包含会话、待发送队列、项目、归档 tombstone、隐藏交接记录和 active context；导入时会保留新机器上的归档状态，并合并 tombstone，避免已归档会话被官方历史恢复流程重新顶回列表。
- 未完成：需要构建通过后，请用户用 dev/安装版各导出一次、互相导入验证列表和归档状态。
- 2026-06-14 v2.9.88：会话迁移区新增拖入 `.zip/.json` 快照直接合并导入；导入成功后新增明确弹窗提示，避免只在卡片底部显示状态。
- 2026-06-14 v2.9.89：同一会话若本机和导入快照都各自新增了不同事件，导入侧改为生成“导入副本”会话，不再硬合并到同一条时间线。
- 2026-06-14 v2.9.90：收敛 Markdown 聊天记录导出入口，顶部状态栏和侧栏 Markdown 图标都走主进程 `exportMarkdown`；侧栏 Debug ZIP 改名为“Kimi 调试包”以区分用途。
- 2026-06-14 v2.9.93：展开折叠的较早对话时按新增内容高度补偿 `scrollTop`，保持当前视口位置；清理消息同步排查遗留的 LevelDB/SST 调试脚本、大 JSON 和临时构建目录。
- 2026-06-15 v2.9.94：Composer 忙碌态不再只依赖 `runningSessionId`，当前会话只要还有未完成 assistant 输出，新发送消息就进入待发送队列，避免正文流式输出尾段与新消息混杂。
- 2026-06-15 v2.9.95：侧栏会话转圈不再只依赖单个全局 `runningSessionId`，同时识别 runtime id 和会话内未完成的 assistant/tool/steer/subagent 事件，多个并行会话可同时显示运行态。
- 2026-06-15 v2.9.96：设置页归档对话“展开剩余”数量改为基于当前实际未展示条目计算，展开后改用“收起归档列表”文案，避免把总量或固定差值误读为可展开数量。
- 2026-06-15 v2.9.97：修复流式输出把 Markdown 表格分隔线拆成 `|` / 空行 / `--------|` 多段后无法渲染为表格的问题，预处理会合并 separator 碎片并补充测试覆盖。
- 2026-06-15 v2.9.98：默认项目显示名改为“Kimix 默认项目”，启动时兼容刷新旧本地记录中仍显示为 `kimix` 的默认项目名称；侧栏和底部状态栏新增显示层兜底，避免前端缓存旧 name 时仍显示 `kimix`。
- 2026-06-15 v2.9.99：补齐空态页、长程任务入口和检查面板的默认项目显示名兜底；会话快照导入合并时保留本机隐藏内部会话；当前轮仍在输出时 slash/skill 输入也会先进入待发送队列；会话快照导入/导出的磁盘读写改为异步路径；`useLiveSession` 复用会话 id 索引；设置页归档摘要去掉 JSON 字符串往返并用浅比较减少无关重渲染；侧栏按项目路径缓存可见会话分组；本地持久化订阅用 id Map 判断归档变化；已完成的大段 assistant Markdown 离视口较远时延迟渲染，降低长会话初次渲染压力。
- 2026-06-15 v2.9.100：引导消息不再把 Kimix 本地合成的 fallback steer 记录显示为成功，只有官方 `turn.steer` 记录出现后才显示为“官方已记录引导”；本地提交后到官方确认前显示“等待官方确认”。
- 2026-06-15 v2.9.100：补齐 SDK `tool.result` 中 `display/output` 结构化 diff block 的解析，差异面板可以重新从当前会话事件里收集文件变更。
- 2026-06-15 v2.9.100：结构化 diff 同步派生 `change_summary`，恢复每轮消息末尾的文件变更卡片和 assistant 过程摘要里的变更文件提示。
- 2026-06-15 v2.9.100：官方 `Write/Edit/MultiEdit` 只返回 “Wrote bytes” 且无结构化 diff 时，基于工具调用参数中的文件路径兜底生成文件变更摘要，避免写文件后没有任何变更卡片。
- 2026-06-15 v2.9.101：文件变更卡片保留原 `ChangeCard`，但没有结构化 diff 的降级态不再展开虚线说明块，改为摘要行，避免视觉上像新做的异常卡片。
- 2026-06-15 v2.9.102：文件变更卡片头部改为“文件变更 + 数量 + 增删统计 + 全部撤销”的固定两列布局，文件行固定右侧操作列，避免长路径挤压按钮。
- 2026-06-15 v2.9.103：文件变更卡片头部高度收紧为明确 44px 左右，头部按钮高度 30px，减少顶部空白。
- 2026-06-15 v2.9.104：文件变更卡片摘要态的 hover 提示改为完整路径，文件行 `+/-` 收拢成紧凑统计组，避免固定列导致数字距离过远。
- 2026-06-15 v2.9.105：右侧“差异面板”改为“文件预览”，列出当前项目根目录允许预览的文本文件；设置页新增允许预览扩展名配置，默认 `md, txt`。
- 2026-06-16 v2.9.106：文件预览右栏收敛为根目录文件列表；点击文件后在中间主工作区预览内容，右栏不再承载正文阅读。
- 2026-06-16 v2.9.107：文件预览列表扩展到根目录下一层目录文件，排序保持根目录文件在前，二级目录文件在后并显示相对路径。
- 2026-06-16 v2.9.108：当 assistant 正文事件已结束但子代理/工具仍未完成时，过程摘要不再显示“输出完成”，改为显示“子代理运行中/命令运行中”并保持会话运行态。
- 2026-06-16 v2.9.109：跟进官方 Kimi Code 0.15.0，研究仓库切到 tag `@moonshot-ai/kimi-code@0.15.0` / commit `18aa21575b893c02f244272e78e994afe1b0adcc`；`packages/node-sdk` 仍为 `0.9.3`，已重建并刷新 `vendor/kimi-code-sdk/index.mjs`，记录 `docs/kimi-code-0.15-followup.md`，轻量 SDK 探针兼容 `getExperimentalFeatures()`。
- 2026-06-16 v2.9.110：补齐官方 0.15.0 新增的 legacy SSE MCP support，Kimix MCP 类型、添加面板、主进程校验、Plugin MCP 导入和配置读取支持 `transport: "sse"`。
- 2026-06-16 v2.9.111：搜索面板新增“全部工作目录”官方会话视图，调用 Kimi Code SDK 全量会话列表，可跨工作目录搜索并复制恢复命令。
- 2026-06-16 v2.9.112：修复搜索历史加载提示不收束、搜索结果点击只打开会话不定位、全工作目录恢复命令使用 cmd 写法导致 PowerShell 报错；搜索命中折叠历史时会先展开再滚动高亮。
- 2026-06-16 v2.9.113：搜索命中定位从消息块级提升到文本级，点击结果后会在目标消息内部选中搜索词并滚动到对应文字行。
- 2026-06-16 v2.9.114：修复搜索定位请求残留导致切回会话再次跳转；assistant 合并渲染块挂载原始事件 id，文本选择支持跨 DOM 文本节点；历史补充加载同一弹层内不再反复重跑。
- 2026-06-16 v2.9.115：消息流在窗口全屏/缩小时记录当前视口消息锚点，ResizeObserver 触发布局变化后补偿 scrollTop，减少用户当前位置跳动。
- 2026-06-16 v2.9.116：左侧项目/会话列表滚动条向右偏移 8px，保留列表内容原位置。
- 2026-06-16 v2.9.117：去除左侧滚动条右移时的负 margin 越界，避免侧栏/主内容边界出现浅色缝隙。
- 2026-06-16 v2.9.118：修正右侧窗口边缘缝隙的真实来源，移除 `.kimix-app-shell` 的 8px 右 padding，并恢复左侧滚动条右移处理。
- 2026-06-16 v2.9.119：修复列表内 Markdown 代码围栏遇到顶格续行时的代码块串台；表格/标题修复逻辑跳过 fenced code block；统一代码块宽度和 highlight.js 内边距。
- 2026-06-17 v2.9.126：修正官方 steer 引导状态时序，`turn.steer` 只更新引导为已写入当前轮，不再提前完成上一段 assistant；下一段 assistant/可见过程开始时才收尾上一段计时，并调整引导气泡文案避免误解。
- 2026-06-17 v2.9.127：修复 steer 后下方新 assistant 过程头短暂显示“输出完成”的闪烁；空完成标记不再提前收口 steer 后新片段，等待真实终态结算。
- 2026-06-17 v2.9.128：修复运行中过程摘要计时器偶尔卡住几秒后再跳动；消息头计时改为共享秒级时钟，按秒边界对齐并在激活时校准。
- 2026-06-17 v2.9.129：统一运行态判定，侧栏、底部状态栏和消息头共用 active timeline work 规则；修复侧栏转圈/停止按钮存在时底部仍显示“已连接”、消息头无计时的问题。
- 2026-06-17 v2.9.130：收紧 active timeline work 兜底，官方 running id 不匹配时只有 2 分钟内的未完成事件可撑起运行态；超时未完成但已有正文的 assistant 按已收束显示，避免长期误报运行中。
- 2026-06-17 v2.9.131：修复 agent 正在输出正文时发送引导导致路径/文件名尾巴被切到引导后消息头的问题；steer 后疑似上段正文尾巴会补回上一段，后续回复仍留在第二个消息头下。
- 2026-06-17 v2.9.132：修复切换/打开任意历史会话时只滚到中段的问题；会话打开后短暂持续贴底，并监听内容高度变化，搜索定位或用户滚动会立即取消自动置底。
- 2026-06-17 v2.9.133：继续修复 steer 引导切断正文问题；confirmed steer 后若第一段 assistant 文本是在补全上一段未完成 Markdown 表格行，会合并回 steer 前正文，真正新回复再开第二个消息头。
- 2026-06-17 v2.9.134：修复切换历史会话时文件变更卡片先在错误视口闪出、上方消息随后补齐的问题；会话切换期间隐藏中间消息流，首轮同步置底和首帧校正完成后再显示。
- 2026-06-17 v2.9.135：调整轮次内部顺序，文件变更卡片进入 assistant 气泡内部并显示在复制按钮/轮次信息上方，保证 footer 信息始终是一轮最底部。
- 2026-06-17 v2.9.136：继续修复 steer 引导切断正文问题；覆盖 Markdown 表格单元格内容被截断后从 steer 后继续输出的场景，合并前会修正尾部 `|`，真正新段落仍保留在第二个消息头下。
- 2026-06-17 v2.9.137：修复实时 steer 场景下未闭合代码围栏/inline code 的正文尾巴被切到第二个消息头下；新增 fenced markdown 尾巴归并和快照前缀去重测试。
- 2026-06-17 v2.9.138：修复完整 Markdown 文件被外层 ```markdown 与内层 ```bash 同长围栏切碎的问题；渲染前自动升级外层 markdown fence，并让表格/标题修复按围栏长度识别边界。
- 2026-06-17 v2.9.139：修复 Write/Edit 大参数工具详情直接渲染完整 JSON/content 导致页面卡顿和计时器停顿；工具详情改为结构化摘要，大字段只显示行数/字数和短预览，重复 rawArguments 不再拼接。
- 2026-06-17 v2.9.140：修复展开较早对话后大段 Markdown 空白正文；离屏 Markdown 占位接近视口时同步渲染真实内容，并监听聊天滚动容器作为兜底。
- 2026-06-18 v2.9.141：复核滚动卡顿 P0/P1/P2；滚动事件不再持续执行 anchor DOM 扫描，改为滚动停顿后捕获；ResizeObserver 改为 rAF 批处理并只观察内容容器；用户/引导气泡减少全局订阅，MessageBubble 增加内容级 memo 比较，避免新数组 props 击穿旧消息缓存。
- 2026-06-18 v2.9.142：修复长会话从底部向上翻时进度条偶尔倒退；用户主动滚动期间暂停 ResizeObserver 锚点回补，滚动停顿后再捕获新锚点。
- 2026-06-18 Kimi Code 0.17.1 P0：本机 CLI 已更新到 0.17.1；Kimix vendored node-sdk 从 0.9.3 刷新到 0.9.4，来源 tag `@moonshot-ai/kimi-code@0.17.1` / commit `55f865642f18768ac0ae5d0ac236f617f79c4ff1`。下一步新增官方 Server REST / WebSocket 能力探针。
- 2026-06-18 Kimi Code 0.17.1 P1：新增 `scripts/probe-kimi-code-server.mjs`，启动官方 foreground Server 并运行官方 server-e2e 场景；health/meta/auth、OpenAPI/AsyncAPI、session snapshot、WS 重连与 seq replay、prompt、queued steer、cancel、approval、question 共 6 组全绿。下一步在实验开关后新增 Server Host，保留 vendored SDK Host 为默认回滚路径。
- 2026-06-18 Kimi Code 0.17.1 P2.1：新增实验性 `KimiCodeServerHost`，仅在 `KIMIX_EXPERIMENTAL_KIMI_SERVER=1` 时复用或启动 foreground Server；按 endpoint / OpenAPI / AsyncAPI capability gate 验证，失败自动回退且会话流量仍走 SDK，退出时只停止 Kimix 自己启动的 Server。
- 2026-06-18 Kimi Code 0.17.1 P2.2：新增实验性 Server 会话客户端与双开关路由；仅同时启用 `KIMIX_EXPERIMENTAL_KIMI_SERVER=1`、`KIMIX_EXPERIMENTAL_KIMI_SERVER_SESSIONS=1` 且 capability gate 通过时，create/resume/prompt/steer/cancel、状态、模型/思考/权限/Plan、usage、审批/提问走 REST+WS，其他情况保留 SDK。真实探针在官方 0.17.1 上完成 create→WS subscribe→prompt→`prompt.completed`，会话回到 idle；下一步补齐高级 Session API 和 WS 断线重连/seq replay 后再考虑扩大灰度。
- 2026-06-18 Kimi Code 0.17.1 P2.3：实验性 Server 客户端补齐 ping/pong、意外断线指数退避重连、session `{seq, epoch}` cursor、重放订阅和 `resync_required` snapshot 恢复；snapshot 会同步会话状态及待审批/提问。真实探针完成首轮 prompt→主动断开→cursor 重连→第二轮 prompt，序号从 12 前进到 22，收到 2 个 `prompt.completed`。下一步补齐高级 Session API，并评估 snapshot 消息内容对流式正文的精确修复策略。
- 2026-06-18 Kimi Code 0.17.1 P3：实验路由下全局会话列表改走 Server，现有派生会话与后台任务入口自动接入官方 fork/task API；新增官方 children 与 terminal 的主进程/preload API，终端覆盖 create/list/close 和 WS attach/detach/input/resize。真实探针验证跨工作区列表、fork、child 创建/查询，并成功启动、读取、取消一个 running bash 后台任务；Windows 0.17.1 terminal create 被上游缺失 `conpty.node` 阻塞，Kimix 将上游 native module 错误归一为可读中文提示并保留原始错误，已有单测覆盖。P0-P3 review 另修正了 P3 capability gate 的实际 OpenAPI 模板路径。后续评估 snapshot 正文精确修复与 Windows terminal 上游修复。
- 2026-06-18 Kimi Code 0.17.1 P3 follow-up：Server snapshot 恢复新增活跃正文补偿；`in_flight_turn` 中的 assistant thinking/text 与 tool result 会转回现有 Kimi Code raw event 形状，经 renderer 复用原 mapper 合并。为避免重连后重复旧消息，`snapshot.messages.items` 历史列表暂不自动回灌，只作为后续“按 message id 精确去重/重建”候选。
- 2026-06-18 Kimi Code 0.17.1 P3 follow-up：Server snapshot 历史消息补偿增加 `snapshotReplay` / `snapshotMessageId` / `snapshotMessageText` 标记；renderer 收到 history replay 时会先和当前 timeline 的 assistant/tool 内容去重，已有内容跳过、缺失内容才补。`in_flight` replay 不跳过，用于断线时恢复正在生成的正文。
- 2026-06-18 Kimi Code 0.17.1 P3 follow-up：增强 `scripts/probe-kimi-code-server.mjs`，新增真实 Server session / prompt / snapshot 探针项验证 Kimix snapshot replay adapter：history replay 有稳定标记，renderer 去重策略可跳过已存在内容并保留缺失补偿；报告只记录 text length / marker，不落完整模型正文。同步兼容官方 message content 的 `thinking` 与 `tool_result` 结构。
- 2026-06-18 v2.9.143：收口 Kimi Server 后台任务体验；Server task stop 遇到官方 40904 already finished 时按幂等终态处理，不再在侧栏显示“停止失败”；Server task 映射补充 `outputBytes`、取消/失败摘要，右侧长程任务栏能提示已有输出可查看。三处版本号同步到 2.9.143。
- 2026-06-18 Kimi Code 0.17.1 P3 follow-up：Server 主探针补齐真实后台任务链路；新建 session 后通过 Bash 后台任务验证 task list/get/cancel、输出元数据和重复停止 already-finished 语义。实测 9/0 通过，重复 cancel 返回官方 `40904/cancelled=false`，与 Kimix 幂等停止适配一致。

## 当前目标
停止继续把旧 hidden runtime 作为主交互引擎修补，按新版官方 Kimi Code 文档与官方仓库迁移到 SDK / Wire 主链路。P0 探针已确认当前机器应接官方源码 `packages/node-sdk` 的 `KimiHarness` / `Session` API；P1 已新增主进程 `KimiCodeHost` 最小适配层和独立 `kimi-code:*` IPC；P2 已新增 SDK event -> Kimix timeline 独立 mapper；P3 已完成 renderer 灰度接入 `engine: "kimi-code"` 的第一版；P4 已完成队列/引导的 SDK 最小收敛；P5 已把审批 / 提问 / 权限 / Plan 的最小闭环接到 SDK。P6 已完成会话导出、插件状态 / 启停、模型配置读写、MCP / usage / background tasks runtime API 的 SDK 接入。用户已确认后续彻底不使用旧 runtime；P7 已删除正式 UI、可见入口、后端 IPC、类型兼容和依赖中的旧 runtime 链路，并通过 P7 专用 SDK 主链路连续验收。下一步进入最终构建 / diff / 重启后可做目标完成审计。

## 2026-06-11 v2.9.22 Kimi Code 0.14.0 SDK / Swarm 跟进
- 当前目标：对照官方最新 Kimi Code 0.14.0，先刷新 Kimix vendored node-sdk，并落下后续未跟进清单。
- 已完成：官方研究仓库切到 tag `@moonshot-ai/kimi-code@0.14.0`，commit `ecc049611508ca0e1b8ffbc8a2788b5ccc4c250e`；`packages/node-sdk` 版本为 `0.9.1`；已重新生成 `vendor/kimi-code-sdk/index.mjs`。
- 已完成：轻量探针确认新版 SDK 可导入、创建会话、读取配置、列出插件/Skill，并暴露 `setSwarmMode`、`swarm`、`reloadPlugins`、`removePlugin`、`getPluginInfo`、`undoHistory`。
- 已完成：Kimix 补齐官方 `Interrupt` Hook 事件到类型、主进程校验、规则生成提示和 Hooks 面板事件下拉。
- 已完成：`/swarm on`、`/swarm off` 和 `/swarm <任务>` 已接官方 SDK `setSwarmMode()` / `swarm()`，不再作为普通消息发送。
- 已完成：`/swarm <任务>` 会先显式进入官方 task-triggered Swarm 模式，并在对话流里显示独立的“已发出 Swarm 指令”提示；移除 Kimix 之前插入的空 assistant 占位，避免看起来像普通“正在思考”。
- 已完成：输入框上方新增 Swarm 子进程悬浮卡，基于官方 `subagent.*` 生命周期展示排队、运行、限流、完成、失败状态；同一 `agentId` 的正文、思考、工具调用和状态会归档到对应子代理，用于显示每个子代理最近在做什么。
- 已完成：核验 Kimi 提出的 8 项修复清单，全部确认属于真实问题或真实规则缺口；已修复 TurnEnd 子代理状态、steer wire 确认、CC Codex Skill 备份、ChatThread 类型收窄、拖拽 cleanup、历史 data 空值、renderer watchdog cleanup、Swarm/TodoPanel 间距。
- 已完成：文件附件不再插入输入框正文，改为复用图片附件栏位展示；发送、排队、引导、重新发送时会把附件文件名和绝对路径加入 prompt，提示 agent 直接读取路径。
- 已完成：修复 Swarm/子代理后期无新事件时过程摘要计时不刷新的问题；ChatThread 在当前会话运行时每秒轻量刷新，MessageBubble 也会把运行中的工具/子代理纳入 active 判断。
- 已完成：Swarm 子进程悬浮卡按最新一批 subagent 过滤，只展示当前批次，避免同一会话历史里的 completed 子代理混入当前运行列表。
- 已完成：修复启动后左侧大量“新会话”loading 占位的问题；启动恢复只读取当前项目的 SDK 会话摘要并选择可用最新会话，不再把所有最近项目历史注入本地 session 列表。
- 已完成：修复拖拽附件绝对路径丢失的问题；Electron preload 通过 `webUtils.getPathForFile()` 获取文件/文件夹真实路径，renderer 保留旧 `File.path` fallback。
- 已完成：修复启动恢复历史对话时过程摘要显示离谱耗时的问题；历史回放不再用当前时间兜底计算完成耗时，完成态取不到可靠耗时时只显示“（输出完成）”。
- 已完成：调整 Windows NSIS 安装器升级快捷方式策略；安装器初始化阶段预写 `KeepShortcuts` 标记，让升级卸载旧版本时尽量保留桌面/开始菜单快捷方式，减少更新后桌面图标被删除重建。
- 已完成：优化画板左侧工具区布局，从画笔工具开始改为两列排列，并补足颜色/背景切换与色板之间的留白；版本锚点同步到 v2.9.26。
- 已完成：画板新增选择工具和基础图形对象层；方形、圆角矩形、圆形、线条绘制后可移动、缩放、旋转、删除，并在复制/保存时合成为 PNG；版本锚点同步到 v2.9.27。
- 已完成：根目录 `start-kimix.bat` 改为调用安全重启脚本，启动前清理 Kimix dev 旧进程和 Vite/构建缓存，避免用户双击 bat 后仍看到旧版本窗口；版本锚点同步到 v2.9.28。
- 已完成：修复重新构建/启动恢复后已归档对话被官方历史重新拉回的问题；新增归档 tombstone，启动恢复会按官方 session id / runtime session id / 长程任务子会话 id 跳过已归档历史，并为恢复会话补写 `officialSessionId`；版本锚点同步到 v2.9.29。
- 已完成：画板撤销/重做升级为完整快照，覆盖背景层、笔刷层、对象层和画布尺寸；补齐对象新增/移动/缩放/旋转/删除、背景色、裁剪尺寸恢复；对象退出操作态或切换工具后固定到像素层，便于油漆桶上色；版本锚点同步到 v2.9.30。
- 已完成：修复滚动条出现/消失导致布局横向重排的问题；左侧项目/会话列表、对话流滚动区、画板左侧工具栏保留稳定滚动槽，避免页面和画板在内容溢出时抖动；版本锚点同步到 v2.9.31。
- 已完成：修复连续绘制多个图形后撤销需要重复经过视觉相同历史节点的问题；对象固定到像素层时替换当前历史顶而非新增撤销项，恢复快照时只在尺寸变化时重设 canvas 宽高，减少撤销闪烁；版本锚点同步到 v2.9.32。
- 已完成：画板裁剪提示卡移动到线条宽度和工具之间；支持 Enter 应用裁剪、Esc 取消裁剪；固定画板主体高度并让滚动限制在左侧工具栏内部，避免工具栏滚动条改变右侧绘图页面高度；版本锚点同步到 v2.9.33。
- 已完成：调整主对话流滚动条位置，减少消息区域右侧预留空白，让滚动条更靠近右边界，同时保留稳定滚动槽；版本锚点同步到 v2.9.34。
- 已完成：修复画板主体高度过高导致画布顶穿底部操作区的问题；右侧画布区域改为固定容器内自适应居中，避免 1:1 画布按自身尺寸撑开弹窗；版本锚点同步到 v2.9.35。
- 后续约定：用户要求每次完成代码改动并构建通过后，直接重启 Kimix 应用，便于用最新版本截图验收。
- 已完成：官方 Kimi Code 0.14.2 跟进第一步已落地；vendored `@moonshot-ai/kimi-code-sdk` 从 0.9.1 更新到 0.9.3，来源 tag `@moonshot-ai/kimi-code@0.14.2` / commit `1cb49dba5bbc7d015a791ec9699d45df931ead92`；BTW 侧问优先使用官方 `withInteractiveAgent()` 作用域 API，旧 SDK 保留 setter fallback；版本锚点同步到 v2.9.41。
- 已完成：官方 Kimi Code 0.14.2 shell 工具 streaming 事件 `tool.progress` 已映射到 Kimix 工具卡，运行中 stdout/stderr 会合并显示；补齐 `/reload`、`/status`、`/usage` 本地 slash 到 SDK reload/status/usage API；核查官方 slash 注册表后确认 `/provider` 等配置入口继续由 Kimix 设置页/模型配置承载，不新增伪聊天命令；版本锚点同步到 v2.9.42。
- 已完成：修复上下文压缩完成后当前轮仍在执行但输入框提前解锁的问题；Composer 不再根据本地已完成 assistant 分段自行清运行态，改为等待 SDK status/turn 收口；真正 TurnEnd 时兜底关闭仍 running 的工具卡，避免过程摘要停在“正在思考/执行中”；版本锚点同步到 v2.9.43。
- 已完成：修复官方 active turn 残留/恢复场景下新消息误发后 UI 再次清运行态的问题；Composer、空态建议、队列续发和长程任务启动遇到 active-turn 拒收时会回滚本地占位、恢复运行态并提示等待当前轮结束；`sendKimiCodePromptWithRetry` 不再自动 cancel 官方当前轮；dev 重启脚本只匹配当前仓库 dev 进程，降低误碰安装版风险；版本锚点同步到 v2.9.44。
- 已完成：继续收口 Kimi Code 0.14.2 剩余项；接入 `getConfigDiagnostics()` 并在插件 / Skills 页显示配置警告，SDK Skill 列表展示 Sub-skill 标识和数量统计；历史回放兼容 SDK 原生 assistant/thinking/tool progress/turn end/compaction 事件，补测试核验 compaction replay 后不会提前结束 assistant 或丢工具进度；版本锚点同步到 v2.9.45。
- 已完成：优化长会话滚动到底部的顿挫感；确认输入区是正常 footer 而非覆盖浮层后，将 ChatThread 底部真实滚动留白从 120px 收敛到 60px，减少滚到底后继续滚空白区的顿挫，同时保留底部呼吸感；版本锚点同步到 v2.9.46。
- 未完成：Swarm 子进程 live delta/tool-call 尾句、undo selector、插件 marketplace update badge、OpenAI-compatible 工具图片输出渲染 fixture、subagent 分组进度细化、`xhigh` reasoning effort 配置回环。
- 未完成：Kimi Code 0.14.2 后续跟进仍包括 Swarm “必须单独运行”提示和 YOLO/Plan resume 行为复验。
- 关键文件：`vendor/kimi-code-sdk/index.mjs`、`vendor/kimi-code-sdk/README.md`、`docs/kimi-code-0.14-followup.md`、`electron/kimiCodeHost.ts`、`electron/main.ts`、`electron/preload.ts`、`electron/types/ipc.ts`、`src/components/chat/Composer.tsx`、`src/components/chat/SwarmPanel.tsx`、`src/utils/kimiCodeEventMapper.ts`、`src/components/layout/AppShell.tsx`、`src/components/layout/HooksPanel.tsx`。

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
**v2.8.248** — 三处同步：`package.json` + `src/components/layout/Sidebar.tsx` + `src/components/settings/SettingsPanel.tsx`。

## 本轮证据（v2.8.248：审批卡按钮 / 路径不符 / yolo 仍弹审批 / 完成对话工具请求折叠）
- 问题1：`ApprovalCard` "本会话允许" 由 legacy `bg-accent-blue` 改为统一主按钮 `bg-accent-primary text-text-inverse hover:bg-accent-primary-dark`；`index.css` 为 `.bg-accent-primary` 增加 `:active:not(:disabled)` → `--accent-primary-dark`（"按下变深蓝"成为全局规则）。
- 问题2（路径绑错 temp/kimix-plugin-mgmt）：根因为 `sessionHistory.getKimiCodeSessionDirs` 扫描所有 bucket、把插件临时会话串进任意项目列表，bootstrap resume 后绑到 temp workDir。改为只扫描请求 workDir 的 bucket；`main.ts kimi:startSession` resume 后校验 workDir 不符则改新建；`Composer.ensureKimiCodeRuntime` resume 分支也加 workDir 守卫（覆盖旧持久化的错绑会话）。
- 问题3（完全访问仍弹审批）：`kimiCodeHost` 的 `ManagedSession` 跟踪 `permission`，create/setPermission/resume(getStatus 回填) 同步；审批 handler 在 `permission==="yolo"` 时直接自动放行不打扰用户（最强兜底）。`Composer` resume 后用当前 `permissionMode` 调一次 `setKimiCodePermission`；`handleSetPermissionMode` 仅在存在真实 runtimeSessionId 时下发，避免运行时未建时误回滚 UI 模式。
- 问题4（完成对话工具请求折叠）：`ChatThread.renderTurnBody` 把已解决(approved/rejected)审批挂到所属 assistant 的 `leadingApprovals`，pending 审批仍独立渲染保持可交互；`MessageBubble` 新增 `ApprovalProcessItem`（默认折叠）并入 `AssistantProcessSummary`，消息头 summary 追加 "N 个工具请求"。
- 验收：`npx vitest run kimiCodeEventMapper/eventMapper/eventHelpers` 47/47 通过；`pnpm build` 通过（新 hash `index-CC82C73D.js`）；本次改动未引入新 tsc 错误（既有 `sessionTitle.test` 2 失败与 tsc 噪声无关）。待用户截图验收 4 项现象。

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

# 2026-06-02 Kimi Code SDK 0.6.0 vendoring 收口
## 已完成
- `vendor/kimi-code-sdk/index.mjs` 已升级为官方 `packages/node-sdk@0.6.0` 的自包含 bundle，来源 commit `9143fdadf68c252ed4d84b16db0d8274390fa132`，对齐 CLI `kimi 0.8.0`。
- `vendor/kimi-code-sdk/README.md` provenance 表已更新到 node-sdk 0.6.0 / CLI 0.8.0。
- `docs/kimi-code-sdk-probe-result.md` 已重跑并记录 CLI 0.8.0 + node-sdk 0.6.0 结论。
- 版本号三处同步到 v2.8.250。
## 验证
- `node scripts/probe-kimi-code-sdk.mjs`：15 通过 / 4 失败 / 1 跳过；主链路 `createSession`、`resumeSession`、prompt 流式、steer、cancel、approval/question handler 均通过。失败项为已知非主链路：`--wire` 不支持、SDK npm 404、旧 agent-sdk 不在当前依赖、官方源码 `build:dts` Windows `spawn EINVAL`。
- 干净临时目录无 `node_modules` import `vendor/kimi-code-sdk/index.mjs` 并实例化 `KimiHarness` 通过。
- `pnpm test:run -- src/utils/__tests__/kimiCodeEventMapper.test.ts src/utils/__tests__/eventMapper.test.ts` 通过：2 个文件、46 个测试。
- `pnpm build` 通过。
## 下一步
提交阶段 A 相关文件；用户确认后进入阶段 B，静态和动态盘点 node-sdk 0.6.0 新 API。

# 2026-06-02 Kimi Code 0.8.0 SDK 新 API 盘点
## 已完成
- 新增 `scripts/probe-kimi-code-0.8.mjs`，加载仓库内 vendored SDK，盘点导出面、`KimiHarness` / `Session` 方法、实验开关、provider catalog、undo、background tasks 和 goal 可用性。
- `docs/kimi-code-sdk-probe-result.md` 已追加“0.8.0 新能力 SDK 可用性盘点”表，区分可接 / 部分可接 / TUI-core-only / 待官方开放 / 本轮不接。
- 版本号三处同步到 v2.8.251。
## 关键结论
- 可接：后台 agent 真实终态 + 恢复提示、自适应思考开关、Provider catalog 导入、`Session.undoHistory(count)`。
- 暂不接：后台结构化提问目前 `background-ask=false` 且缺独立非阻塞控制 API；审批生命周期事件未开放；cron/reminder 没有 SDK 管理 API；goal mode 虽有 SDK 方法但与 Kimix 长程任务冲突且当前 `goal-command=false`。
## 验证
- `node scripts/probe-kimi-code-0.8.mjs` 通过：catalog fetch 138 providers，内存 `applyCatalogProvider` 成功；fresh session `undoHistory(1)` 成功；background tasks 可列举；goal disabled 如预期。
## 下一步
进入阶段 C1：后台 agent 真实终态 + 恢复提示，先补 GUI 展示与操作，不扩大到 C2/C4/C5。

# 2026-06-02 C1 后台任务真实终态侧栏
## 已完成
- 长程任务右侧侧栏新增“SDK 后台任务”分区，会同时读取执行 agent / 审查 agent 的 SDK background tasks。
- 后台任务 UI 展示真实状态：运行中、等待审批、已完成、失败、已终止、已失联；失败/终止/失联时展示 `failureReason`、`stopReason`、`timedOut` 或 `exitCode`。
- 每个任务提供复制输出入口；非终态任务提供停止入口，调用现有 `stopKimiCodeBackgroundTask` IPC。
- 版本号三处同步到 v2.8.252。
## 验证
- `pnpm test:run -- src/utils/__tests__/kimiCodeEventMapper.test.ts src/utils/__tests__/eventMapper.test.ts` 通过：2 个文件、46 个测试。
- `pnpm build` 通过。
## 下一步
等待用户用真实后台任务截图验收空态 / 运行态 / 失败或终止态；若显示信息不足，再补恢复按钮或输出查看细节。

# 2026-06-03 长程任务 SDK 事件入库修复
## 已完成
- 修复长程任务前端 session 未标记 `engine: "kimi-code"`，导致 `onKimiCodeEvent` / `onKimiCodeStatus` 直接丢弃官方 SDK 事件的问题。
- 新建长程任务的 kickoff 改为显式调用 `sendKimiCodePrompt`，不再走模糊的 legacy `sendPrompt` 入口。
- SDK 事件处理对已有 longTask 会话增加兜底：即使历史会话缺少 `engine` 字段，也允许事件入库。
- 版本号三处同步到 v2.8.253。
## 验证
- `pnpm test:run -- src/utils/__tests__/kimiCodeEventMapper.test.ts src/utils/__tests__/eventMapper.test.ts` 通过：2 个文件、46 个测试。
- `pnpm build` 通过。
## 下一步
重新创建一个长程任务或停止当前卡住任务后重发；确认正文 / 提问卡 / 工具事件能进入长程任务对话流。

# 2026-06-03 C2 自适应思考开关接入
## 当前目标
- 继续推进 Kimi Code 0.8 GUI 接入阶段 C，完成 C2：把 SDK `models[alias].adaptiveThinking` 暴露到设置页。
## 已完成
- `electron/main.ts` 的 Kimi 模型摘要新增 `adaptiveThinking` 字段，并新增 `kimi:setModelAdaptiveThinking` IPC，通过官方 vendored SDK `getConfig` + `setConfig` 更新指定模型别名。
- `electron/preload.ts` / `electron/types/ipc.ts` 暴露 `setKimiModelAdaptiveThinking`，设置页模型列表新增紧凑“思考开/关”按钮，点击后写入 SDK 配置并刷新摘要。
- 浏览器预览 mock 补齐 `adaptiveThinking` 字段和模拟接口。
- 版本号三处同步到 v2.8.254。
## 验证
- `pnpm build` 通过。
- `pnpm test:run -- src/utils/__tests__/kimiCodeEventMapper.test.ts src/utils/__tests__/eventMapper.test.ts` 通过：2 个文件、46 个测试。
## 下一步
- 继续按阶段 B 结论推进 C4 Provider catalog；C3 后台 ask 仍因 SDK 缺少非阻塞接续 API 暂不接，C5 undoHistory 可在 C4 后做一个独立增量。

# 2026-06-03 C4 Provider catalog 填表接入
## 当前目标
- 继续推进 Kimi Code 0.8 GUI 接入阶段 C，完成 C4 的低风险入口：从官方 catalog/registry 填入 OpenAI-compatible Provider。
## 已完成
- `electron/kimiCodeHost.ts` 新增 vendored SDK catalog wrapper，调用 `fetchCatalog` / `inferWireType` / `catalogBaseUrl` / `catalogProviderModels`，只返回 `wire=openai` 且存在可用模型和 baseUrl 的 Provider。
- `electron/main.ts` / `electron/preload.ts` / `electron/types/ipc.ts` 新增 `kimi:listProviderCatalog` / `listKimiProviderCatalog`。
- 设置页 OpenAI-compatible Provider 表单上方新增“官方 Provider catalog”区：载入后可选 Provider 和模型，并自动填入 Provider 名称、模型别名、Base URL、模型名、Context；保存/测试仍复用原按钮，API Key 不自动写入。
- 浏览器预览 mock 补齐 catalog 模拟接口。
- 版本号三处同步到 v2.8.255。
## 验证
- `pnpm build` 通过。
- `pnpm test:run -- src/utils/__tests__/kimiCodeEventMapper.test.ts src/utils/__tests__/eventMapper.test.ts` 通过：2 个文件、46 个测试。
- 轻量动态校验 vendored SDK catalog：`providers=139`，其中 `wire=openai` 且可填表的 Provider 为 `109`。
## 下一步
- C3 后台 ask 继续保持“待官方开放”状态；下一轮可做 C5 undoHistory 的撤销入口，范围建议限定在当前 Kimi 会话最近 1 步。

# 2026-06-03 C5 官方 undoHistory 撤销入口
## 当前目标
- 继续推进 Kimi Code 0.8 GUI 接入阶段 C，完成 C5：接入 SDK `Session.undoHistory(count)`。
## 已完成
- `electron/kimiCodeHost.ts` 新增 `undoHistory(sessionId, count)` wrapper，要求当前 Session 暴露官方 `undoHistory` 方法。
- `electron/main.ts` / `electron/preload.ts` / `electron/types/ipc.ts` 新增 `kimi-code:undoHistory` / `undoKimiCodeHistory`，默认撤销 1 步，IPC 侧限制 count 为 1-10。
- `SessionToolbar` 新增“撤销官方历史上一轮”图标按钮：仅普通 Kimi Code 会话、非运行中、存在用户/steer 轮次时启用；长程任务会话禁用，避免误撤销编排器内部轮次。
- 后续 v2.11.62 已移除该工具栏图标入口，避免刷新图标语义误导；显式 `/undo` 命令仍保留。
- 撤销流程先 resume 官方 session，再调用 `undoKimiCodeHistory({ count: 1 })`，随后用 `loadKimiCodeSession` 读取官方 wire 历史并用 `mapHistoryEvents` 刷新本地时间线，不做本地假删除。
- 浏览器预览 mock 补齐 `undoKimiCodeHistory`。
- 版本号三处同步到 v2.8.256。
## 验证
- `pnpm build` 通过。
- `pnpm test:run -- src/utils/__tests__/kimiCodeEventMapper.test.ts src/utils/__tests__/eventMapper.test.ts` 通过：2 个文件、46 个测试。
## 下一步
- 阶段 C 可接项已完成 C1/C2/C4/C5；C3 后台 ask 仍因 SDK `background-ask=false` 且缺非阻塞接续 API 暂不接。后续建议做真实窗口人工验收与必要 UI 微调。

# 2026-06-03 修复同会话连续发送 active turn 竞态
## 当前目标
- 修复用户反馈的同会话连续提问时出现 `Cannot launch a new turn while another turn is active`，导致第二轮进入错误卡、看起来上下文丢失的问题。
## 已完成
- 新增 `src/utils/kimiCodeSendRetry.ts`，只针对官方 SDK 返回的 active-turn 释放延迟错误做短暂退避重试；其它发送错误仍原样返回。
- 普通 Composer 发送、队列续发、空态建议发送、长程任务 kickoff 均改为使用 `sendKimiCodePromptWithRetry`。
- 版本号三处同步到 v2.8.257。
## 验证
- `pnpm build` 通过。
- `pnpm test:run -- src/utils/__tests__/kimiCodeEventMapper.test.ts src/utils/__tests__/eventMapper.test.ts` 通过：2 个文件、46 个测试。
## 下一步
- 重启 dev 窗口后复测：连续发送“回复 1/2/3”应不再出现 active turn 错误卡；如仍出现，需要抓对应主进程日志确认 SDK 是否长时间未释放 turn。

# 2026-06-03 修复 pending 队列双消费
## 当前目标
- 修复用户复测发现的连续发送仍出现 active turn 错误：本地队列可能在同一次完成状态后同时发送后续两条消息。
## 已完成
- `App.tsx` 新增 per-session pending 队列分发锁 `pendingQueueDispatchRef`，并把 `onKimiCodeStatus` 里的 pending 消费收敛到 `dispatchNextPendingKimiMessage()`。
- 旧 `onKimiStatus` 对普通 Kimi Code 会话直接让路，不再和 `onKimiCodeStatus` 同时消费 pending 队列；长程任务和交接逻辑仍保留在旧 status 分支。
- 版本号三处同步到 v2.8.258。
## 验证
- `pnpm build` 通过。
- `pnpm test:run -- src/utils/__tests__/kimiCodeEventMapper.test.ts src/utils/__tests__/eventMapper.test.ts` 通过：2 个文件、46 个测试。
## 下一步
- 重启 dev 窗口后复测同会话快速输入 1/2/3。若仍复现，下一步把队列泵提升到主进程/SDK host 层，以 runtime session 为 key 串行化所有 `prompt()` 调用。

# 2026-06-03 优化 Provider catalog 设置布局
## 当前目标
- 修复用户截图反馈的设置页官方 Provider catalog 区域过度挤压、标题和下拉框横向抢空间的问题。
## 已完成
- `SettingsPanel` 中 catalog 卡片改为上下分层布局：标题/说明/刷新按钮一行，Provider 与模型选择改为纵向两行。
- catalog 卡片 padding 调整为 `14px 16px`，内部间距用 inline `gap: 14` / `gap: 12` / `marginTop: 14` 明确数值，避免 Tailwind spacing 缓存问题。
- 版本号三处同步到 v2.8.259。
## 验证
- `pnpm build` 通过。
## 下一步
- 等用户回传 v2.8.259 设置页截图，确认右栏 catalog 卡片不再挤压；如仍偏挤，再把刷新按钮下移为独立行。

# 2026-06-03 缩短套餐用量按钮
## 当前目标
- 按用户截图反馈，去掉底部“套餐用量”按钮的小箭头，缩短按钮宽度。
## 已完成
- `ContextBar` 移除套餐用量按钮里的 `ChevronDown`，保留用量图标和文字。
- 按钮使用 inline `paddingLeft: 12` / `paddingRight: 12`，高度保持 36px，弹层逻辑不变。
- 版本号三处同步到 v2.8.260。
## 验证
- `pnpm build` 通过。
## 下一步
- 等用户回传 v2.8.260 底部状态栏截图，确认按钮宽度和弹层位置是否更协调。

# 2026-06-03 统一长程任务状态块方角样式
## 当前目标
- 按用户截图反馈，收敛同一元素块内方圆不一的问题；这里采用较方的按钮/标签样式。
## 已完成
- `ChatThread` 长程任务 banner 右侧 `BIGPLAN` 与 agent 标签统一为 `rounded-lg`，agent 标签补 `minHeight: 32`。
- `LongTaskInspectorPanel` 的 SDK 后台任务状态标签与 `exit n` 标签从圆胶囊改为 `rounded-lg`，补 `minHeight: 24`。
- 版本号三处同步到 v2.8.261。
## 验证
- `pnpm build` 通过。
## 下一步
- 等用户回传 v2.8.261 长程任务 banner / 侧栏后台任务截图，确认方角风格是否统一。

# 2026-06-03 收敛侧栏选中态圆角
## 当前目标
- 按用户截图反馈，将左侧项目行和设置入口选中态从偏胶囊圆角收敛到设置页较小圆角规范。
## 已完成
- `Sidebar` 主导航、折叠导航、项目行、项目新对话按钮和底部设置入口由 `rounded-xl` 收敛为 `rounded-lg`。
- 版本号三处同步到 v2.8.276。
## 规范依据
- `AGENTS.md` 的 UI 留白防回归规则要求圆角/选中态保持克制，并明确对话流按钮不要做成大胶囊。
- `TASK_STATE.md` 既有“统一长程任务状态块方角样式”记录，采用 `rounded-lg` 作为同组状态按钮/标签的收敛方向。
## 验证
- `pnpm build` 通过。
## 下一步
- 等用户回传 v2.8.276 侧栏截图，确认项目选中块和设置入口圆角是否与设置页风格一致。

# 2026-06-03 压缩指令静默化
## 当前目标
- 修复点击上下文用量浮层“压缩”后，`/compact` 被当作普通用户消息进入上一轮对话的问题。
## 已完成
- `ContextRing` 不再通过通用 `sendPrompt` 发送 `/compact` 文本。
- 新增 `kimi-code:compact` IPC，调用官方 SDK `session.compact()`，让压缩走 SDK 真能力并保持静默。
- 版本号三处同步到 v2.8.277。
## 斜杠命令判断
- 可优先 GUI 化：SDK 已暴露真 API 的能力，例如 `compact()`、`setPlanMode()`、`undoHistory()`、`setThinking()`、`setPermission()`。
- 谨慎代发：仅 TUI 导航类命令可以在 hidden TUI 链路中作为安全导航使用，但不能混入 SDK 主对话链路。
- 不建议代发：会产生正文、需要交互菜单或依赖 TUI 状态机的 slash 命令，容易污染对话或卡住状态。
## 验证
- `pnpm build` 通过。
## 下一步
- 等用户用 v2.8.277 点击压缩，确认对话流不再出现 `/compact` 用户消息或模型复述正文。

# 2026-06-03 顶部小窗点外关闭与压缩反馈
## 当前目标
- 修复启动/文件两个顶部小窗点击外部仍不关闭，以及压缩按钮静默后看起来无响应的问题。
## 已完成
- `SessionToolbar` 的点外关闭监听改为捕获阶段 `pointerdown`，不再受菜单内部冒泡阻断影响。
- `ContextRing` 为静默压缩增加本地状态反馈：压缩中、已请求、压缩失败，不写入对话流。
- 版本号三处同步到 v2.8.278。
## 验证
- `pnpm build` 通过。
## 下一步
- 等用户用 v2.8.278 验证：打开两个顶部小窗后点击空白处可关闭；点击压缩会立即显示状态反馈且不污染对话。

# 2026-06-03 设置页扁平行式布局试版
## 当前目标
- 按用户建议，不照搬 Codex 左侧设置导航，先将现有设置卡片压扁为单列行式布局，并按使用频率从上到下摆放。
## 已完成
- workspace 设置页由左右两列改成 `min(920px, 100%)` 单列行流。
- 保留现有设置卡片和控件结构，仅调整 workspace 专用外层 section、标题、主题按钮、权限/连接行密度。
- 通过 CSS `order` 将连接情况、Kimi 登录、模型配置、权限模式、主题等高频项排到前面。
- 版本号三处同步到 v2.8.279。
## 验证
- `pnpm build` 通过。
## 下一步
- 等用户用 v2.8.279 截图验收设置页密度、排序和模型配置区域是否还需要继续压缩。

# 2026-06-03 设置页多选项横向压缩
## 当前目标
- 发挥设置页单列宽度优势，将多选项区域参考主题选择改成横向自动换行，进一步节约纵向空间。
## 已完成
- workspace 设置页 `.kimix-settings-permissions` 改为 `auto-fit/minmax(220px, 1fr)` 网格，权限、消息、上下文、通知等多选项可一行展示，空间不足时自动换行。
- workspace 下单个选项保持最小高度 58px，避免横向压缩后选项内容过度挤压。
- 版本号三处同步到 v2.8.280。
## 验证
- `pnpm build` 通过。
## 下一步
- 等用户用 v2.8.280 截图验收横向选项密度；若某些长文案仍显臃肿，再针对该 section 缩短说明或改成两列固定宽度。

# 2026-06-03 设置页单输入行内布局
## 当前目标
- 按用户截图反馈，将“新对话建议”和“语音输入”这类单输入设置合并成左右同一行，减少垂直空间。
## 已完成
- 新对话建议卡片改为左侧开关说明、右侧轮数输入。
- 语音输入卡片改为左侧说明、右侧快捷键输入和示例。
- 版本号三处同步到 v2.8.281。
## 验证
- `pnpm build` 通过。
## 下一步
- 等用户用 v2.8.281 截图验收两处行内布局是否节省空间且不挤压。

# 2026-06-03 设置页归档和诊断默认显示 5 条
## 当前目标
- 按用户要求，归档对话和卡死诊断默认都只显示 5 条，减少设置页纵向占用。
## 已完成
- `SettingsPanel` 新增 `SETTINGS_PREVIEW_ITEM_LIMIT = 5`，归档对话和卡死诊断共用。
- 展开/折叠逻辑保留不变。
- 版本号三处同步到 v2.8.282。
## 验证
- `pnpm build` 通过。
## 下一步
- 等用户用 v2.8.282 验收默认列表高度。

# 2026-06-03 去除插件页内部实现提示
## 当前目标
- 按用户反馈，去除插件页里面向开发者的 SDK 实现说明，并检查其他类似文案。
## 已完成
- 删除插件页“直接读取官方 Session.listPlugins，不再依赖旧菜单镜像”提示。
- 版本号三处同步到 v2.8.283。
## 检查结果
- 还发现几处疑似内部文案：设置页“另有 N 个模型别名，后续 P0 写入入口会一并管理”；项目工具入口“隔离环境/工作树后续接入”；若干“待实现”toast。
## 验证
- `pnpm build` 通过。
## 下一步
- 等用户确认是否继续清理上述剩余内部文案。

# 2026-06-03 清理剩余内部计划文案
## 当前目标
- 按用户确认，除“待实现”和 SDK 字样外，删除或改正其他暴露内部计划的用户可见提示。
## 已完成
- 设置页模型配置的“后续 P0 写入入口”改为普通展示说明。
- 项目工具帮助里的“预留 / 后续接入 / 说明入口”改为面向用户的能力说明。
- 版本号三处同步到 v2.8.284。
## 验证
- `pnpm build` 通过。
## 下一步
- 等用户用 v2.8.284 确认这些提示文案是否自然。

# 2026-06-03 设置页右侧按钮垂直居中
## 当前目标
- 按用户截图反馈，修复设置页 OpenAI-compatible Provider 的 catalog 行右侧按钮未按整行垂直居中的问题，并核查设置页同类按钮。
## 已完成
- `官方 catalog` 行从顶部对齐的 flex 改为两列 grid，右侧“载入 / 刷新”按钮按整行视觉居中。
- 核查设置页其它右侧操作按钮：标题行按钮、归档 / 卡死诊断操作、模型列表“使用 / 使用中”均已有居中约束，本轮未发现同类 `items-start` 右侧按钮。
- 版本号三处同步到 v2.8.285。
## 验证
- `git diff --check` 通过；`pnpm build` 通过。
## 下一步
- 等用户用 v2.8.285 截图验收 catalog 行按钮是否已与左侧文字块垂直居中。

# 2026-06-03 替换 Hooks 侧栏图标
## 当前目标
- 按用户反馈，当前 Hooks 图标不像钩子，需要换成语义更贴近的图标。
## 已完成
- `Sidebar` 中 Hooks 入口图标由 `Cable` 替换为 `Webhook`，折叠态和展开态同步。
- 版本号三处同步到 v2.8.262。
## 验证
- `pnpm build` 通过。
## 下一步
- 等用户回传 v2.8.262 侧栏截图，确认 Hooks 图标是否符合预期。

# 2026-06-03 修复审查 agent 输出路由
## 当前目标
- 按用户截图反馈，修复长程任务审查 agent 输出混入执行 agent 消息、终态读取不到可用结果的问题。
## 已完成
- 隐藏长程任务 runtime 只把审批 / 问题 / 错误镜像到主对话，不再把审查 agent 的 assistant / status 输出混进执行轮次。
- `onKimiCodeEvent` 与旧 `onKimiEvent` 对齐：为长程任务事件附加 executor / reviewer 角色，审查 reviewer 事件写入隐藏缓冲，供审查完成后生成正确 agent 代理消息头和后续执行 prompt。
- 版本号三处同步到 v2.8.263。
## 验证
- `pnpm test:run -- src/utils/__tests__/kimiCodeEventMapper.test.ts src/utils/__tests__/eventMapper.test.ts` 通过。
- `pnpm build` 通过。
## 下一步
- 等用户用 v2.8.263 复验审查 agent 是否单独显示并继续流转；如仍失败，下一步检查审查完成状态事件是否携带了 reviewer runtimeSessionId。

# 2026-06-03 补齐 Hooks 图标替换遗漏
## 当前目标
- 按用户截图反馈，补齐 Hooks 页面和对话 Hook 命中徽标里仍残留的旧钩子图标。
## 已完成
- `HooksPanel` 页面标题图标由 `Cable` 改为 `Webhook`，与侧栏 Hooks 入口一致。
- `MessageBubble` 的 Hook 命中徽标图标由 `Cable` 改为 `Webhook`。
- 版本号三处同步到 v2.8.264。
## 验证
- `rg -n "Cable|Webhook" src/components/layout/HooksPanel.tsx src/components/chat/MessageBubble.tsx src/components/layout/Sidebar.tsx src/components/layout/McpPanel.tsx src/components/layout/SkillsPanel.tsx` 确认 Hooks 入口 / 页面 / 徽标均为 `Webhook`，剩余 `Cable` 仅在 MCP / Skills 连接器语义中。
- `pnpm build` 通过。
## 下一步
- 等用户用 v2.8.264 截图复验 Hooks 图标一致性。

# 2026-06-03 修正 Kimi Code 更新误判与旧 CLI 文案
## 当前目标
- 按用户反馈，修复启动时已是新版 Kimi Code 却提示发现新版本/安装的问题，并清理界面里旧的 Kimi Code CLI 命名。
## 已完成
- Kimi Code 版本解析兼容纯版本号、`kimi-code 0.x`、`Kimi Code v0.x`、旧 `kimi-cli version` 等格式。
- 已安装但版本解析失败时不再默认判定 `hasUpdate=true`，避免启动时误弹“发现新版本/安装”；旧版 Kimi 迁移仍会提示。
- 用户可见文案中的 `Kimi Code CLI` / `Kimi CLI` / `CLI 检查` 等更新为 `Kimi Code` / `旧版 Kimi`。
- 版本号三处同步到 v2.8.265。
## 验证
- 本机真实 `kimi --version` 为 `0.8.0`，官方 `https://code.kimi.com/kimi-code/latest` 返回 `0.8.0`。
- Node 片段验证版本解析兼容 `0.8.0` / `kimi-code 0.8.0` / `Kimi Code v0.8.0` / `kimi, version 0.8.0` / `kimi-cli version: 0.7.0`。
- `rg -n "Kimi Code CLI|Kimi CLI|CLI 更新|CLI 检查|检查 CLI|CLI 输出|CLI 调用|CLI fallback|官方 CLI|传给 CLI|面向 Kimi Code CLI|重新登录 Kimi Code CLI|旧版 Kimi CLI" src electron package.json` 无命中。
- `pnpm build` 通过。
## 下一步
- 等用户用 v2.8.265 复验启动顶部提示不再误报 Kimi Code 新版本/安装，并确认旧 CLI 文案不再出现。

# 2026-06-03 减少设置页状态块重复刷新闪烁
## 当前目标
- 按用户截图反馈，避免每次进入设置页时连接情况、Kimi 登录、模型配置先显示默认/读取态再刷新到真实状态。
## 已完成
- `SettingsPanel` 增加模块级状态快照，缓存连接情况、登录状态和模型配置。
- 进入设置页时已有缓存则直接复用，不再自动切换 loading；首次进入或缓存缺失时才检测。
- 手动点击“检查 / 刷新”仍会明确显示刷新态；登录变化事件会静默刷新缓存与界面。
- 版本号三处同步到 v2.8.266。
## 验证
- `pnpm build` 通过。
## 下一步
- 等待用户用 v2.8.266 反复进出设置页复验三块不再闪烁。

# 2026-06-03 修复 DeepSeek catalog Context 过大导致测试失败
## 当前目标
- 按用户截图反馈，修复从官方 catalog 填入 DeepSeek V4 后补 API Key 测试时报 `Invalid max_tokens value` 的问题。
## 已完成
- DeepSeek Provider / Base URL / Model 相关的 Context 上限收敛到 393216，避免 catalog 的 1000000 被传给 Kimi Code 测试命令后触发 DeepSeek 400。
- 前端填入 catalog、手动测试、保存前都会归一化 Context；后端测试 / SDK 写配置 / TOML fallback 写配置也做同样收敛。
- `kimiCodeHost.listProviderCatalog()` 返回 catalog 时已归一化 DeepSeek 模型 `maxContextSize`，后续 UI 首次填入不再显示 1000000。
- 版本号三处同步到 v2.8.267。
## 验证
- `pnpm build` 通过。
- `rg -n "393216|normalizeOpenAiProviderContextSize|normalizeCatalogMaxContextSize|KIMI_MODEL_MAX_CONTEXT_SIZE|maxContextSize" src/components/settings/SettingsPanel.tsx electron/main.ts electron/kimiCodeHost.ts` 确认前端填入 / 后端测试保存 / catalog 返回均覆盖 DeepSeek 上限收敛。
## 下一步
- 等待用户用 v2.8.267 重新选择 DeepSeek 并测试。

# 2026-06-03 降低 DeepSeek 简单请求长思考
## 当前目标
- 按用户截图反馈，排查 DeepSeek 默认模型下简单请求长时间只输出 thinking、不出正文的问题。
## 已完成
- 确认当前 Kimi Code 配置里 `deepseek/deepseek-v4-flash` 为默认模型，`default_thinking=true` 且模型 `adaptive_thinking=true`，简单请求会进入长思考链路。
- `kimi:startSession` 创建官方 SDK session 时补传 thinking：DeepSeek 默认模型强制 `thinking: "off"`；其他模型在用户关闭输入区“思考”时也传 `off`。
- `kimiCodeHost` 补官方 SDK `setThinking(level)`，恢复已有 DeepSeek runtime 时也会同步 `thinking: "off"`，避免旧会话继续长思考。
- DeepSeek OpenAI-compatible Provider 的 catalog / 前端填入 / 后端测试保存 Context 默认从 393216 进一步收敛到 65536。
- DeepSeek Provider 保存时写入 `adaptive_thinking = false`；设置页对 OpenAI-compatible Provider 不再展示自适应思考按钮，改为提示由输入区思考开关控制。
- 版本号三处同步到 v2.8.268。
## 验证
- `pnpm build` 通过。
- 真实命令行验证：`KIMI_MODEL_DEFAULT_THINKING=false` + `KIMI_MODEL_MAX_CONTEXT_SIZE=65536` 时，DeepSeek 执行 `只回复 q` 返回 `q`，耗时约 2.7s。
## 下一步
- 等待用户用 v2.8.268 停止当前运行中的旧轮次后复验 DeepSeek 简单请求是否快速出正文。

# 2026-06-03 允许重复输入排队并优化模型使用文案
## 当前目标
- 按用户反馈，修复相同输入无法在队列里连续排队；将模型卡片里的“默认 / 设为默认”改成更明确的“使用中 / 使用”。
## 已完成
- `sessionStore.addPendingMessage` 移除同会话最后一条 pending 内容/图片签名去重，允许相同输入作为独立队列项重复加入。
- 设置页模型配置区将“默认模型”改为“当前使用”，模型卡片状态改为“使用中”，切换按钮改为“使用”，相关提示文案同步收敛。
- 版本号三处同步到 v2.8.269。
## 验证
- `pnpm build` 通过。
- `pnpm test:run` 未通过：`src/utils/__tests__/sessionTitle.test.ts` 有 2 个与会话标题策略相关的既有失败（期望仅 assistant 生成标题，但当前实现返回首条 user 文本），与本轮队列/设置文案改动无直接关系。
## 下一步
- 等用户用 v2.8.269 复验：同一句输入可连续排入队列，设置页模型卡片显示“使用中 / 使用”。

# 2026-06-03 修复新会话发送后仍显示空态面板
## 当前目标
- 按用户截图反馈，修复新会话已发出消息、左侧会话转圈时主区域仍显示“要在 Project 中构建什么？”默认面板的问题。
## 已完成
- `ChatThread` 空态判断纳入当前会话运行中状态和本会话 pending 消息；只在无运行、无 pending、无可见对话时显示欢迎空态。
- 版本号三处同步到 v2.8.270。
## 验证
- `pnpm build` 通过。
## 下一步
- 等用户用 v2.8.270 复验新会话发送后默认面板会立即隐藏，等待首个事件流式进入。

# 2026-06-03 修复空会话模型显示和中断摘要文案
## 当前目标
- 按用户反馈，修复未开始输入的新会话在切换使用模型后底栏仍显示旧模型；被打断输出的轮次摘要不再显示“输出完成”。
## 已完成
- `ContextBar` 仅在会话已有事件后才优先显示会话固定模型；空会话继续显示当前默认/使用模型，跟随设置页切换刷新。
- `MessageBubble` 识别尾随 status_update 中的中断/取消信号，完成态摘要改为“输出打断”。
- 版本号三处同步到 v2.8.271。
## 验证
- `pnpm build` 通过。
## 下一步
- 等用户用 v2.8.271 复验空会话底栏模型跟随切换、停止后的轮次摘要显示“输出打断”。

# 2026-06-03 增加 Assistant 全部复制按钮
## 当前目标
- 按用户反馈，在 AI 回复复制按钮旁增加“全部复制”，点击后同时复制 AI 思考和正文。
## 已完成
- `MessageBubble` 新增“全部”复制按钮，复用现有思考块过滤逻辑，将思考以 `## 思考`、正文以 `## 回复` 拼接写入剪贴板。
- 普通复制按钮仍只复制正文；两个按钮各自有独立复制成功状态。
- 版本号三处同步到 v2.8.272。
## 验证
- `pnpm build` 通过。
## 下一步
- 等用户用 v2.8.272 复验普通复制和“全部”复制的剪贴板内容是否符合预期。

# 2026-06-03 修复完成轮次仍显示停止按钮
## 当前目标
- 按用户反馈，修复轮次已显示“输出完成”后，输入区仍显示停止按钮且新消息被加入队列的问题。
## 已完成
- `Composer` 的 active turn 判断从“会话内任意未完成 assistant”收敛为“最新用户消息之后仍有未完成 assistant，且没有完成 assistant，并且当前会话仍在运行”。
- 当前会话已出现最新轮次完成回复时，会自动清理 stale `runningSessionId`，避免迟到 delta / 旧占位让输入区继续判定为运行中。
- 版本号三处同步到 v2.8.273。
## 验证
- `pnpm build` 通过。
## 下一步
- 等用户用 v2.8.273 复验：输出完成后右下角恢复发送按钮，新消息直接发送而不是排队。

# 2026-06-03 修复顶部小窗外点关闭和上下文图标常驻
## 当前目标
- 按用户反馈，顶部启动/文件/更多小窗应支持点击外部关闭；输入区思考按钮右侧的上下文用量图标不应消失。
## 已完成
- `SessionToolbar` 为会话更多、启动方式、项目文件三个小窗增加外部 `pointerdown` 关闭逻辑，行为对齐底部套餐用量浮层。
- `ContextRing` 改为当前会话下常驻显示；暂无 status 时显示中性空环和“暂无上下文用量”，发送后继续显示真实 Tokens / Context。
- 版本号三处同步到 v2.8.274。
## 验证
- `pnpm build` 通过。
## 下一步
- 等用户用 v2.8.274 复验：顶部小窗外点关闭；思考按钮右侧上下文图标常驻。

# 2026-06-03 优化更新弹窗与归档管理
## 当前目标
- 按用户反馈，更新弹窗本体区域三按钮挤压内容；归档对话会重新出现在左侧列表；归档列表需要增加彻底删除且不挤压。
## 已完成
- 更新弹窗 Kimix 本体卡片只保留主操作按钮，“浏览器下载”改为次级文字链接，减少右侧操作区对版本信息的挤压。
- 本地会话持久化对归档状态变化和会话删除改为立即 flush，降低归档后快速刷新/重启导致旧状态回来的概率。
- 设置页归档列表右侧增加“恢复 / 删除”固定操作列，删除前二次确认，删除会同时清理 pending 消息。
- 版本号三处同步到 v2.8.275。
## 验证
- `pnpm build` 通过。
## 下一步
- 等用户用 v2.8.275 复验：更新弹窗不挤压；归档后左侧不复现；归档列表可恢复也可彻底删除。

# 2026-06-02 重跑 P0 探针对齐 CLI 0.7.0（迁移审计 1c 收口）
## 背景
- 置顶审计第 1c 条指出探针结论过期（旧记录 CLI 0.6.0 / SDK 0.4.0）；用户选择"先重跑 P0 探针再决定"是否 vendoring。
## 已完成
- 实测当前真源：installed `kimi --version` = `0.7.0`；研究仓库 `packages/node-sdk` = `0.5.0`（commit `121a6dd`，仍 `private:true`）；`@moonshot-ai/kimi-code-sdk` npm 仍 404。
- 重跑 `node scripts/probe-kimi-code-sdk.mjs`：16 通过 / 5 失败；`docs/kimi-code-sdk-probe-result.md` 已用本次结果覆盖刷新。
- 把重跑结论回填进 `KIMI_CODE_SDK_MIGRATION_PLAN.md` 第 1c 条（标记已收口）。
## 关键结论
- 新 SDK 主路在 CLI 0.7.0 + node-sdk 0.5.0 上全绿：create/resume、prompt 实时流式（首 delta ~1.0s）、steer 不裂 session（会话数 before=after=2）、cancel、approval/question handler 全部命中；sessionId 与 wire.jsonl 对齐、wireExists=true。迁移核心假设依旧成立。
- 5 个失败均无关新主路：`kimi --wire` 在 0.7.0 已被移除（→旧 ProtocolClient 握手 2 项失败，坐实旧 SDK 已死必删）；npm 仍 404（→vendoring 仍唯一）；node-sdk build 仅 `build:dts` 在 Windows spawn EINVAL 失败，运行时 index.mjs 正常（vendoring 用预构建 dist 可绕开）。
## 未完成 / 下一步
- 第 1 条 vendoring 尚未执行：兼容性已验证通过，等用户确认是否把研究仓库预构建 `node-sdk/dist` 拷进 `vendor/kimi-code-sdk/` 并改 `resolveSdkEntry` 去掉 %TEMP% 硬编码。

# 2026-06-02 建新：vendoring 官方 Kimi Code SDK（审计 #1 收口）
## 背景
- 用户拍板顺序「先 vendoring 再分阶段清旧」。审计 #1：新主引擎从 %TEMP% 临时研究目录加载未发布的 private SDK，换机/CI/安装包必崩。
## 关键发现
- 官方 `node-sdk/dist/index.mjs` **不自包含**：干净目录导入实测缺 `zod` 等 bare import（今天能跑只因临时目录旁有 node_modules）。只拷 dist 不可行。
## 已完成
- esbuild 把官方 dist 重打成**自包含单文件** `vendor/kimi-code-sdk/index.mjs`（5.5MB；JS 依赖全内联；`bufferutil`/`utf-8-validate`/`canvas` 标 external；注入 `createRequire` banner 修 ESM 动态 require）。
- `electron/kimiCodeHost.ts`：`import { app }`；`resolveSdkEntry()` 改为优先 vendored（打包 `process.resourcesPath/vendor/…`，dev `app.getAppPath()/vendor/…`），%TEMP%/env 降为开发兜底；错误文案更新。
- `electron-builder.yml`：`extraResources` 增加 `vendor/kimi-code-sdk` 随包发布。
- 新增 `scripts/vendor-kimi-code-sdk.mjs` + `pnpm vendor:kimi-code-sdk` + `esbuild` devDep(0.28.0)；`vendor/kimi-code-sdk/README.md` 记录来源 commit 121a6dd / node-sdk 0.5.0 / CLI 0.7.0 / 刷新步骤。
## 验证
- 干净目录（无 node_modules）：import OK、`KimiHarness` 实例化 OK、`createSession` 真实会话 id OK。
- 用真实 App 身份 `kimi-code-cli` 跑真实 prompt：**101 deltas、首 delta ~2.1s、reason=completed**（流式/websocket 在原生外部化下正常）。
- 过程中用非白名单身份会 403「Kimi For Coding 仅对编码 agent 开放」——与 vendoring 无关；已确认 `kimiCodeHost.ts:685` 真实用的是白名单 `kimi-code-cli`。
- `pnpm build` 通过；优先级实测：%TEMP% 仍在时 resolveSdkEntry 仍选中仓库内 vendored。
- 脚本重生成产物字节与手动一致（5521684），可复现。
## 未完成 / 下一步
- 旧 `@moonshot-ai/kimi-agent-sdk` 的 `extraResources` 与依赖未删——属第 3 条「清旧」分阶段迁移，下一阶段做。
- 建议：在真实 Electron 窗口跑一次新建会话发消息，确认主进程从 vendored 加载（dev 路径）；打包一次确认 extraResources 落到 resources/vendor。

# 2026-06-04 适配 Kimi Code 0.9.0 / BTW 侧问
## 当前目标
- 按官方 0.9.0 changelog 升级 vendored SDK，并把 `/btw` 对应的真 SDK 能力接到 Kimix 右侧栏。
## 已完成
- 研究仓库切到 `@moonshot-ai/kimi-code@0.9.0` tag，vendored SDK 刷新为 `packages/node-sdk@0.7.0`，来源 commit `6c0afc4d9c10e4d9001f2a891e20bf61e34ec754`。
- `electron/kimiCodeHost.ts` 适配 0.9.0 新工厂 `createKimiHarness()`，保留旧 `new KimiHarness()` 兜底。
- 新增 SDK `Session.startBtw()` 的主进程封装、IPC、preload 类型和右侧栏 BTW 侧问卡片；侧问事件按 `agentId` 静默收集，不进入主对话流。
- `docs/kimi-code-sdk-probe-result.md` 和 `vendor/kimi-code-sdk/README.md` 已更新 0.9.0 / node-sdk 0.7.0 证据；版本三处同步到 v2.8.286。
## 验证
- `node scripts/probe-kimi-code-0.8.mjs` 通过，确认 vendored bundle 导出 `createKimiHarness`、`Session.startBtw`、catalog 139 个 provider。
- vendored SDK 动态烟测通过：`startBtw()` 返回 `agent-0`，侧通道事件 39 条，独立收集正文 `侧问`。
- `node scripts/probe-kimi-code-sdk.mjs`：15 通过 / 4 已知失败 / 1 跳过。失败项为本机 CLI 仍 0.8.0 且无 `--wire`、SDK npm 仍 404、旧 SDK 已移除；官方 runtime bundle 构建成功，`build:dts` 仍为 Windows `spawn EINVAL`。
- `pnpm build` 通过。
- `pnpm test:run` 未全绿：`src/utils/__tests__/sessionTitle.test.ts` 2 个既有标题推导断言失败，和本轮 SDK/BTW 改动无交集。
## 下一步
- 用户用 v2.8.286 回传右侧栏 BTW 侧问视觉和交互反馈。
- 后续可单独处理标题推导测试期望，或等用户确认后提交/发布。

# 2026-06-04 优化 BTW 侧问侧栏显示
## 当前目标
- 按用户反馈修正 BTW 侧问记录的 Markdown、排序、折叠和计数展示。
## 已完成
- 侧问状态从消息数组改为“轮次”结构，一轮对应一次用户提问和一次 agent 回复。
- 侧问列表改为最新轮在上、旧轮向下排；计数从“x 条侧问记录”改为“x 轮侧问”。
- Agent 回复改用 `MarkdownRenderer` 渲染，支持 Markdown 格式。
- Agent 回复增加折叠按钮，折叠态只保留两行高度；思考内容仅在展开时显示。
- 版本号三处同步到 v2.8.287。
## 验证
- `pnpm build` 通过。
## 下一步
- 等用户用 v2.8.287 回传 BTW 侧栏视觉反馈，重点看两行折叠高度和 Markdown 渲染是否舒适。

# 2026-06-04 调整更新弹窗浏览器下载位置
## 当前目标
- 按用户反馈，更新弹窗内“浏览器下载”应始终位于对应主按钮正下方并水平居中。
## 已完成
- Kimix 本体操作区从横向 flex 改为小 grid：无更新时“浏览器下载”位于“检查本体”正下方；有更新时位于“升级”正下方。
- 浏览器下载文本使用 `justifySelf: "center"`，和上方按钮水平居中对齐。
- 版本号三处同步到 v2.8.288。
## 验证
- `pnpm build` 通过。
## 下一步
- 等用户用 v2.8.288 复验更新弹窗两种状态下的按钮对齐。

# 2026-06-04 持久化 BTW 侧问轮次
## 当前目标
- 修复关闭并重新打开右侧栏后 BTW 侧问记录消失的问题，并澄清是否为官方 SDK 限制。
## 已完成
- 确认根因：官方 0.9.0 SDK 提供 `Session.startBtw()` 和侧通道事件，但 Kimix 之前只把侧问记录存放在 `AppShell` 内存 state，侧栏重建会丢失。
- 新增 `Session.btwRounds`，把 BTW 一轮问答写入 Kimix 会话 store，并立即调用现有 `persistLocalConversationState()` 持久化到本地会话数据。
- 输入框草稿、loading、error 仍保留为临时 UI 状态，不写入会话历史；清空按钮会清掉当前会话的持久化 BTW 轮次。
- 版本号三处同步到 v2.8.289。
## 验证
- `pnpm build` 通过。
## 下一步
- 等用户用 v2.8.289 复验：侧问后关闭/重新打开右侧栏，记录应仍在；重启应用后也应随该会话恢复。

# 2026-06-04 对齐 BTW 输入框发送快捷键
## 当前目标
- 按用户反馈，让右侧栏 BTW 输入框发送方式与主窗口一致。
## 已完成
- BTW textarea 新增键盘处理：`Enter` 和 `Ctrl+Enter` 发送，`Shift+Enter` 保持换行。
- 版本号三处同步到 v2.8.290。
## 验证
- `pnpm build` 通过。
## 下一步
- 等用户用 v2.8.290 复验侧栏输入框快捷键。

# 2026-06-04 修复画板原图被油漆桶填色
## 当前目标
- 按用户反馈，点击已有图片进入画板时，原图应作为背景层；油漆桶只作用于用户绘制层。
## 已完成
- 打开已有图片时，原图改为绘制到 `bgCanvas`，`drawCanvas` 保持透明，只承载用户后续绘制内容。
- 裁剪逻辑改为分别裁剪背景层和绘制层，不再把背景与绘制合并后塞回绘制层。
- 版本号三处同步到 v2.8.291。
## 验证
- `pnpm build` 通过。
## 下一步
- 等用户用 v2.8.291 复验：原图进画板后，油漆桶只填用户绘制层，不会污染原图背景。

# 2026-06-04 发布前测试收口
## 当前目标
- 发布 Kimi Code 0.9.0 适配前，清理阻塞测试并准备 release。
## 已完成
- `deriveSessionTitle` 重新对齐既有策略：默认优先用 assistant 正文派生标题，不再用用户首句覆盖；保留非默认 fallback 的兜底能力。
- 版本号三处同步到 v2.8.292。
## 验证
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
- `pnpm build` 通过。
## 下一步
- 提交并推送 `master`，推送 `v2.8.292` tag，由 GitHub Actions 自动构建并发布 Release。

# 2026-06-04 修复安装后登录引导
## 当前目标
- 修复旧版 Kimix 更新后安装新版 Kimi Code，下一步登录没有明确跳转的问题。
## 已完成
- 安装 Kimi Code 成功后，Kimix 自动进入设置页并聚焦到 `Kimi 登录` 区域，toast 改为提示在设置页完成登录。
- onboarding 和更新弹窗中“安装后登录”的文案改为引导用户使用设置页登录，不再要求用户自行去终端运行 `/login`。
- 设置页新增 `kimix:focus-auth-settings` 聚焦事件，进入登录区时顺手刷新登录状态。
- 版本号三处同步到 v2.8.293。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-yPuyDNsf.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
## 下一步
- 构建通过后，请用户用旧版更新到 v2.8.293 路径复验安装后是否自动跳到登录区域。

# 2026-06-04 修复执行中本轮计时丢失
## 当前目标
- 修复 assistant 处于“执行中”时，状态行不显示本轮耗时的问题。
## 已完成
- `MessageBubble` 不再自行从全局 `currentSession` 推断活跃轮次，改由 `ChatThread` 显式传入当前渲染 session 的 `sessionId` 和 `runtimeSessionId`。
- 活跃轮次判断同时兼容 Kimix 本地 session id 和官方 runtime session id，避免官方 SDK 回报 runtime id 时计时被隐藏。
- `ChatThread` 空态判断也同步兼容 runtime session id，减少运行中误判。
- 版本号三处同步到 v2.8.294。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-CjBemWGb.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
## 下一步
- 验证通过后，请用户复验执行中状态行应显示类似 `执行中 12s`。

# 2026-06-04 修复思考内容编号粘连显示
## 当前目标
- 判断思考内容中编号列表偶发粘连换行是官方输出问题还是 Kimix 展示问题，并修复可控部分。
## 已完成
- 对照用户导出的 md，确认原始导出中的思考编号列表本身有换行，不属于必须忽略的官方输出问题。
- `ThinkingProcessItem` 展开内容从 `<pre>` 纯文本改为 `MarkdownRenderer`，让编号列表按 Markdown 规则显示。
- 新增窄范围显示层修正：仅对 `1. ...2. ...3. ...` 这类编号粘连补换行，不改原始会话数据和导出内容。
- 版本号三处同步到 v2.8.295。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-BhgAitEU.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
## 下一步
- 验证通过后，请用户复验思考展开内容中编号列表的换行。

# 2026-06-04 修复 Release notes 来源
## 当前目标
- 修复最近两个 GitHub Release 复用旧版 `v2.8.106` Release notes 的问题，并避免后续 tag 继续复用旧说明。
## 已完成
- 确认根因：`.github/workflows/release.yml` 每次发布固定执行 `gh release edit "$GITHUB_REF_NAME" --notes-file RELEASE_NOTES.md`，而根目录 `RELEASE_NOTES.md` 长期停留在 v2.8.106。
- 新增 `docs/release-notes/v2.8.292.md` 和 `docs/release-notes/v2.8.295.md`，分别记录 0.9.0 适配版和后续体验修复版说明。
- 更新 `RELEASE_NOTES.md` 为当前最新 `v2.8.295` 说明，作为 fallback。
- 更新 release workflow：优先读取 `docs/release-notes/${GITHUB_REF_NAME}.md`，不存在时才回退到 `RELEASE_NOTES.md`。
- 已用 `gh release edit` 修正 GitHub 上 `v2.8.292` 和 `v2.8.295` 的 Release notes。
## 验证
- `gh release view v2.8.292` 读回标题为 `Kimix v2.8.292 Release Notes`。
- `gh release view v2.8.295` 读回标题为 `Kimix v2.8.295 Release Notes`。
- `git diff --check` 通过。
## 下一步
- 提交并推送 release notes 来源修复。

# 2026-06-04 修复 Markdown 代码块复制
## 当前目标
- 修复 Markdown 代码块点击“复制”后出现大量 `[object Object]`，复制内容不等于显示内容的问题。
## 已完成
- 确认根因在 Kimix：`MarkdownRenderer` 的 `CodeBlock` 使用 `String(children)` 生成复制文本；代码高亮后 `children` 是 React 节点数组，直接转字符串会得到 `[object Object]`。
- 新增 `nodeText()` 递归提取 React 节点中的纯文本，代码块复制改用该纯文本。
- 版本号三处同步到 v2.8.296。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-DqLGUpv2.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
## 下一步
- 验证通过后，请用户复验 markdown/lua 等带高亮代码块的复制内容。

# 2026-06-04 检查复制对象串残留风险
## 当前目标
- 全局检查是否还有其它复制入口可能把 React 节点复制成 `[object Object]`。
## 已完成
- 扫描 `navigator.clipboard.writeText` / `copyToClipboard` / `String(children)` 等路径。
- 确认消息复制、全部复制、会话 Markdown 复制、Plan/后台任务复制、错误详情复制均传入原始字符串字段，不会出现 ReactNode 转字符串问题。
- 将 `MarkdownRenderer` 内联 code 的 block 判断也从 `String(children)` 改为 `nodeText(children)`，消除同源残留风险。
- 版本号三处同步到 v2.8.297。
## 验证
- `rg` 未再发现 `String(children)` 或把 `children` 直接写入剪贴板的路径。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
- `pnpm build` 通过，renderer hash：`assets/index-84Zkp01f.js`。
## 下一步
- 验证通过后，请用户复验代码块复制和普通 inline code 显示。

# 2026-06-04 修复设置页登录聚焦位置
## 当前目标
- 修复安装 Kimi Code 后进入设置页时没有聚焦到 `Kimi 登录` 区块的问题。
## 已完成
- 确认根因：`authSettingsRef` 错挂到设置页其它区块，`kimix:focus-auth-settings` 事件会滚到错误位置。
- 将 `authSettingsRef` 挪到 `Kimi 登录` 外层区块。
- 版本号三处同步到 v2.8.298。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-BcWlv3GV.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
## 下一步
- 验证通过后，请用户复验旧版升级并安装 Kimi Code 后，是否自动进入设置页并聚焦到 `Kimi 登录`。

# 2026-06-04 修复左侧栏折叠态入口
## 当前目标
- 修复左侧栏折叠后图标列不齐、图标按钮高度和展开态不一致、长程任务与设置入口缺失的问题。
## 已完成
- 折叠态入口统一为 `40x40` 图标按钮，外层左侧 padding 调整到固定 10px，使图标列中心线与顶部折叠按钮一致。
- 顶部折叠按钮在折叠态使用更小左边距，与左侧图标列水平对齐。
- 折叠态恢复 `长程任务` 入口，并在底部恢复 `设置` 入口。
- 版本号三处同步到 v2.8.299。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-CIFS88JT.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
## 下一步
- 验证通过后，请用户复验折叠态图标对齐、按钮高度，以及长程任务/设置入口是否可见可点。

# 2026-06-04 微调左侧栏折叠/展开几何基准
## 当前目标
- 修复展开态顶部折叠按钮未与导航图标水平对齐、折叠态导航按钮纵向位置变化、折叠态设置入口未保持原底部高度的问题。
## 已完成
- 展开态顶部折叠按钮左边距改为 18px，对齐展开侧栏导航图标中心线。
- 折叠态导航列移除额外顶部 padding，按钮仍保持 `40x40`，避免折叠前后顶部入口高度漂移。
- 折叠态设置入口改为 `40x36`，底部 padding 调整为 18px，与展开态设置入口的底部中心位置一致。
- 版本号三处同步到 v2.8.300。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-D-MzAhxU.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
## 下一步
- 验证通过后，请用户复验展开/折叠两态的顶部折叠按钮、导航按钮和底部设置入口位置。

# 2026-06-04 修正侧栏折叠态未生效根因
## 当前目标
- 判断 v2.8.300 侧栏对齐改动看起来未生效的原因，并修复真正的结构问题。
## 已完成
- 确认用户截图已显示 v2.8.300，因此不是旧版本缓存；根因是折叠态 `<aside>` 缺少 `h-full`，`mt-auto` 无法把设置入口压到底。
- 折叠态侧栏补 `h-full`，导航按钮间距改为 4px，与展开态 `space-y-1` 一致。
- 展开态顶部折叠按钮左边距改为 24px，按截图做视觉中心补偿。
- 版本号三处同步到 v2.8.301。
## 验证
- 已清理 `out/`、`node_modules/.vite/`、`node_modules/.cache/` 后重跑 `pnpm build`，通过，renderer hash：`assets/index-BsVQGJi1.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
## 下一步
- 验证通过后，请用户用 v2.8.301 复验展开/折叠态侧栏。

# 2026-06-04 侧栏按钮改为显式盒模型
## 当前目标
- 修复 v2.8.301 中顶部折叠按钮仍未与侧栏按钮对齐、折叠态设置入口仍未贴底的问题。
## 已完成
- 顶部折叠按钮改为显式 `40x40` 热区，展开态按展开侧栏按钮左边界对齐，折叠态按折叠侧栏按钮左边界对齐。
- 折叠态导航按钮去掉 Tailwind 高宽类，改用 inline `width/height/minHeight/padding` 固定为 `40x40`。
- 折叠态设置按钮使用 inline `marginTop: auto` 和 `40x36`，避免 `mt-auto` 类名没有压到底。
- 版本号三处同步到 v2.8.302。
## 验证
- 已清理 `out/`、`node_modules/.vite/`、`node_modules/.cache/` 后重跑 `pnpm build`，通过，renderer hash：`assets/index-BRBkvdCz.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
## 下一步
- 验证通过后，请用户用 v2.8.302 复验展开和折叠两态。

# 2026-06-04 接入官方会话派生
## 当前目标
- 按官方 Kimi Code 0.9 能力盘点顺序，先接入 SDK 已暴露的 `KimiHarness.forkSession()`，替代顶部会话菜单里的占位项。
## 已完成
- `electron/kimiCodeHost.ts` 新增 `forkSession()` 包装，并读取派生会话的权限状态后注册为 Kimix 托管会话。
- `electron/main.ts` / `electron/preload.ts` / `electron/types/ipc.ts` 新增 `kimi-code:forkSession` / `forkKimiCodeSession` IPC 链路。
- 顶部更多菜单的“派生到本地”改为真实动作：当前会话为 Kimi Code、非长程任务、非运行中且有官方 runtime session id 时可用；派生后创建并切换到新对话。
- 版本号三处同步到 v2.8.303。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-BC5wBQMu.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows 换行转换警告。
## 下一步
- 验证通过后，请用户复验顶部更多菜单“派生到本地”是否生成新对话并保留原会话历史。

# 2026-06-04 接入官方会话重命名
## 当前目标
- 将顶部更多菜单里的“重命名对话”接入官方 `KimiHarness.renameSession()`，对应官方标题能力。
## 已完成
- `electron/kimiCodeHost.ts` 新增 `renameSession()` 包装，调用官方 SDK 写入会话标题。
- `electron/main.ts` / `electron/preload.ts` / `electron/types/ipc.ts` 新增 `kimi-code:renameSession` / `renameKimiCodeSession` IPC 链路。
- Kimi Code 会话重命名改为先写官方标题，成功后再更新 Kimix 本地标题；非 Kimi Code 会话仍保持本地重命名。
- 版本号三处同步到 v2.8.304。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-W_SDuD4s.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows 换行转换警告。
## 下一步
- 验证通过后，请用户复验重命名后重新打开会话列表/侧栏，标题是否保持一致。

# 2026-06-04 增强官方 SDK Skills 状态
## 当前目标
- 按 Kimi Code 0.9 可接能力顺序，补齐插件页对官方 SDK 已加载 Skills 的直接展示。
## 已完成
- `electron/kimiCodeHost.ts` 新增 `listSkills()` 包装，调用官方 `Session.listSkills()`。
- `electron/main.ts` / `electron/preload.ts` / `electron/types/ipc.ts` 新增 `kimi-code:listSkills` / `listKimiCodeSkills` IPC 链路。
- 插件页“官方 SDK 插件状态”刷新时并行读取 Plugin 与 Skill，并在同一卡片内展示已加载 Skills 数量和前 5 个摘要。
- 版本号三处同步到 v2.8.305。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-ddL1NBdg.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows 换行转换警告。
## 下一步
- 验证通过后，请用户复验插件页官方 SDK 状态卡，确认 Skills 摘要是否有助于判断当前会话加载能力。

# 2026-06-04 修复重命名与 Markdown 回归
## 当前目标
- 修复 v2.8.305 验收反馈：旧对话打开时报 `React is not defined`，点击重命名时报 `prompt() is not supported`，派生到本地缺少可见反馈。
## 已完成
- `MarkdownRenderer` 显式导入 `React`，修复 `nodeText()` 使用 `React.isValidElement()` 时的运行时引用错误。
- 顶部更多菜单“重命名对话”从原生 `window.prompt` 改为 Kimix 自有弹窗，避免 Electron 环境不支持 prompt。
- “派生到本地”的新会话标题改为 `原标题 · 分支 HH:mm`，成功 toast 明确提示已切换到哪个分支会话。
- 版本号三处同步到 v2.8.306。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-h-48lRzY.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows 换行转换警告。
## 下一步
- 验证通过后，请用户复验旧对话打开、重命名弹窗、派生到本地三处行为。

# 2026-06-04 修复派生会话覆盖感
## 当前目标
- 修复“派生到本地”后原本对话像是消失/被替换的问题，确保派生一定生成独立新会话。
## 已完成
- 派生时显式生成 `kimix-fork-<uuid>` 作为 `forkId` 传给官方 `forkSession()`，不再依赖官方默认生成。
- 派生返回后校验新会话 id 不得等于原 runtime session id 或当前本地 id；如果官方返回原 id，直接中止并提示，不切换会话。
- `addSession` 改为按 id 去重后置顶新会话，避免重复 id 造成列表混乱。
- 派生成功 toast 明确说明“原对话仍保留在左侧列表”。
- 版本号三处同步到 v2.8.307。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-CdMc2SiU.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows 换行转换警告。
## 下一步
- 验证通过后，请用户复验派生后左侧列表是否同时保留原对话和新分支对话。

# 2026-06-04 修复派生列表与标题锁定
## 当前目标
- 修复派生后左侧只显示原对话、不显示分支对话，以及手动重命名标题在下一轮对话后回退的问题。
## 已完成
- 新增 `Session.titleLocked`，手动重命名和派生分支标题会锁定，事件流、侧栏历史加载、搜索历史加载、撤销刷新均尊重锁定标题。
- 派生会话改为本地 UI id 与官方 runtime id 分离：左侧使用 `local-fork-<uuid>`，官方调用继续使用 `runtimeSessionId/officialSessionId`。
- 派生会话强制挂到当前项目路径下显示，避免官方返回 workDir 格式差异导致跑到其它项目分组。
- 侧栏和搜索加载空历史会话时改用 `getRuntimeSessionId(session)` 读取官方历史，兼容本地 UI id。
- 版本号三处同步到 v2.8.308。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-B_w046hW.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows 换行转换警告。
## 下一步
- 验证通过后，请用户复验：派生后左侧同时显示原对话和分支对话；重命名后继续对话标题不再回退。

# 2026-06-04 修复派生分支 active turn 残留
## 当前目标
- 修复派生分支第一次发消息出现无计时执行头、切换会话后再发报 `Cannot launch a new turn while another turn is active` 的问题。
## 已完成
- `electron/kimiCodeHost.ts` 的 `sendPrompt()` 在 SDK prompt 抛错时将托管会话状态置为 `error`，避免失败后 UI 残留执行中状态。
- `sendKimiCodePromptWithRetry()` 多次遇到 active-turn 拒绝后，会对同一 runtime session 执行一次 cancel，再重发一次，清理官方残留 active turn。
- 派生成功后、读取分支历史前，对 fork 出来的官方 runtime session 先 best-effort cancel 一次，避免新分支继承原会话的半活跃轮次。
- 版本号三处同步到 v2.8.309。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-B3aT5L7-.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows 换行转换警告。
## 下一步
- 验证通过后，请用户复验：派生分支首次发送应正常出现计时与后续输出，不再报 active turn。

# 2026-06-05 适配 Kimi Code 0.10.0 基础能力
## 当前目标
- 跟进官方 Kimi Code 0.10.0，先升级 vendored SDK 并接入可稳定落地的 P0/P1 能力。
## 已完成
- 研究仓库切到 `@moonshot-ai/kimi-code@0.10.0`，对应 commit `12d062d48e32f8c19626b7236278cba598e60c37`，`packages/node-sdk` 版本为 `0.8.0`。
- 重生成 `vendor/kimi-code-sdk/index.mjs`，更新 `vendor/kimi-code-sdk/README.md` provenance 到 0.10.0 / node-sdk 0.8.0。
- 重跑 `node scripts/probe-kimi-code-sdk.mjs`：15 通过 / 4 已知失败 / 1 跳过；本机 `kimi --version` 为 0.10.0，`--wire` 原始 CLI 启动仍不是公开入口，SDK npm 仍 404，官方 runtime bundle 可用，`build:dts` 仍是 Windows `spawn EINVAL`。
- 接入官方 0.10.0 的 `Session.reloadSession()`：保存 OpenAI-compatible Provider、切换使用模型、更新自适应思考后，会 best-effort 重载空闲 Kimi Code 会话；运行中会话不打断。
- 设置页模型配置新增 `诊断` 按钮，调用 `kimi doctor` 校验 Kimi Code 配置，并显示简短诊断结果。
- Windows 连接检测新增 Git Bash 预检，覆盖 `bin\\bash.exe` 与 `usr\\bin\\bash.exe` 常见安装路径；缺失时提示安装 Git for Windows 或设置 `KIMI_SHELL_PATH`。
- 版本号三处同步到 v2.8.310。
## 未完成 / 暂不接
- `/goal next` 属于官方实验目标队列，且官方文档明确是 TUI 专属队列；与 Kimix 自制长程任务冲突，暂不接入 GUI 主线。
- `update-config` 是官方内置 Skill，本轮不另做 GUI 包装；Kimix 已通过模型配置表单和 doctor 覆盖主要配置路径。
## 下一步
- 跑 `pnpm build`、`pnpm test:run`、`git diff --check` 验证 v2.8.310。

# 2026-06-05 v2.8.310 验证
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-B1mz8Ozn.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
- `kimi doctor` 通过：`config.toml` 与 `tui.toml` 均有效。
## 下一步
- 请用户在 v2.8.310 复验设置页“模型配置 -> 诊断”、配置保存/切换后的会话 reload 行为，以及 Windows 缺 Git Bash 场景的提示文案。

# 2026-06-05 v2.8.310 提交前 review
## Review 结论
- 已全局 review 本轮 0.10.0 相关 diff：SDK host、IPC、设置页、会话派生/重命名、Skills 状态、标题锁定、Markdown 复制、侧栏折叠和文档记录。
- 修复 review 中发现的设置页模型配置按钮组窄列挤压风险：诊断/刷新按钮组允许换行并保留右侧操作区留白。
- 修复 `doctorKimiConfig` renderer 调用异常时可能残留 loading 的健壮性问题，改为 try/catch/finally。
## 最终验证
- `pnpm build` 通过，renderer hash：`assets/index-BKZKKait.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
- `kimi doctor` 通过：`config.toml` 与 `tui.toml` 均有效。
## 下一步
- 提交并推送 master；暂不打 tag、不发 release。

# 2026-06-05 v2.8.312 默认模型切换修复
## 已完成
- 更新弹窗里“浏览器下载”改为“浏览器查看”，Kimi Code 卡片也新增“浏览器查看”，点击打开官方 Kimi Code 页面。
- 修复设置页切换默认模型后可能被旧缓存覆盖的问题：切换默认模型、保存 Provider、切换自适应思考后同步刷新 `settingsStatusCache.modelConfig`。
- 修复旧会话沿用旧模型的问题：启动/恢复 Kimi Code 会话时统一使用当前默认模型；恢复旧会话后显式调用官方 SDK `setModel()`。
- 后端切换默认模型后增加复读校验：SDK `setConfig()` 返回后会 `getConfig({ reload: true })` 确认默认模型已持久化；否则回退到 TOML 写入。
- 版本号三处同步到 v2.8.312。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-1Zk7oWtA.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
## 下一步
- 请用户在 v2.8.312 复验：设置页从 Kimi 切到 DeepSeek 后，切出/切回设置仍保持 DeepSeek；进入旧 Kimi 对话发送新消息时，底部显示和实际回复模型都应跟随 DeepSeek。

# 2026-06-05 v2.8.313 官方 Goal / 斜杠命令第一版接入
## 已完成
- 确认 Kimi Code 0.10.0 SDK 的 `Session.createGoal/getGoal/pauseGoal/resumeGoal/cancelGoal` 是真 SDK 能力，需要开启 `KIMI_CODE_EXPERIMENTAL_GOAL_COMMAND=1`。
- Electron host、IPC、preload 和 renderer preview stub 接通官方 Goal API。
- Composer 在 Kimi Code SDK 会话恢复斜杠建议，并拦截 `/goal`、`/compact`、`/plan`、`/btw`、`/undo`；这些命令不会作为普通用户文本发送给模型。
- `/goal` 支持启动、查看、暂停、继续、取消、替换；右侧会话侧栏新增“官方 Goal”卡片，支持刷新、启动/替换、暂停/继续、取消。
- `/goal next` 暂不作为真实队列接入：当前 SDK 未公开 next queue/list API；无当前 Goal 时按创建处理，有当前 Goal 时提示使用完成/取消/替换。
- `/compact` 成功路径保持完全静默，不在对话里追加内部状态；失败时才显示错误。
- 版本号三处同步到 v2.8.313。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-GRLNbX4b.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
- SDK Goal 专项探针通过：`createKimiHarness()` 创建会话后，`createGoal/getGoal/pauseGoal/resumeGoal/cancelGoal` 五个方法存在且均可调用。
## 下一步
- 请用户在 v2.8.313 复验：右侧“官方 Goal”卡片、`/goal <目标>`、`/goal status`、`/goal pause/resume/cancel/replace`，以及 `/compact` 静默压缩是否仍正常。

# 2026-06-05 v2.8.314 Goal 执行流与模型显示修正
## 当前目标
- 修复 v2.8.313 验收反馈：`/goal` 只更新侧栏、不进消息流也不触发 agent 感知；Goal 运行中用户普通输入误发新 turn 导致 active turn 报错；Goal 完成后右侧状态长时间不刷新；底部模型显示与实际默认模型不一致。
## 已完成
- `/goal <目标>` / `/goal replace <目标>` 创建官方 Goal 后，会把原始 slash 命令作为用户消息显示在聊天流，并给 SDK 发送一条“继续执行当前官方 Goal”的 prompt，触发官方 Goal runtime 自动推进后续 turn。
- 运行中普通发送统一进入 Kimix 队列，不再在 SDK active turn 中直接 `prompt()`，避免 `Cannot launch a new turn while another turn is active`。
- Kimi Code 会话终态 `completed/error/interrupted` 时，如果当前会话有官方 Goal 卡片，会自动 `getGoal()` 刷新右侧状态，避免 Goal 已结束但侧栏仍挂“进行中”。
- 底部模型显示优先跟随当前默认模型；创建/恢复 Kimi Code runtime 时也用 SDK 返回模型同步本地会话模型。
- 版本号三处同步到 v2.8.314。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-Bhs6ixO9.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
## 下一步
- 请用户用 v2.8.314 复验 `/goal <目标>` 是否进入聊天流并自动执行、Goal 完成后侧栏是否刷新、运行中输入是否不再报 active turn、底部模型是否显示当前默认模型。

# 2026-06-05 v2.8.315 空历史会话回填修复
## 当前目标
- 修复 v2.8.314 后用户点击刚才的 Project06 会话时主面板显示空态，像是刚才那轮 Goal 对话消息丢失的问题。
## 已完成
- 确认官方 Kimi Code 磁盘历史未丢：`~/.kimi-code/sessions/wd_project06_34246546ba20/session_84b8d2b5-9532-478c-9829-2b0a8fb9f6b7/agents/main/wire.jsonl` 有 341 行，末尾包含 `goal.update status=complete`、`goal.clear`、`usage.record model=deepseek/deepseek-v4-flash`，以及用户“现在goal完成了吗”的后续一轮。
- 确认 UI 根因：`Sidebar.selectSession()` 对空事件会话先 `setCurrentSession(session)`，异步 `loadSession()` 后只 `updateSession()`，没有把回填后的会话同步到 `currentSession`，主面板继续拿旧空对象。
- 修复 `Sidebar.selectSession()`：官方历史加载并映射后，立即从 store 取回更新后的会话并 `setCurrentSession(updated)`。
- 版本号三处同步到 v2.8.315。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-fwSdiZKt.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
## 下一步
- 请用户用 v2.8.315 点击左侧 Project06 下刚才那条“新会话”，确认聊天流能从官方历史回填。

# 2026-06-05 v2.8.316 当前会话左侧列表一致性修复
## 当前目标
- 修复 v2.8.315 后“对话能打开、聊天流已恢复，但左侧 Project06 列表里仍只显示旧的空新会话/不显示当前可打开对话”的问题。
## 已完成
- 确认根因不止历史回填：左侧列表只从 `sessionStore.sessions` 渲染，而当前打开内容可能存在于 `appStore.currentSession`；同时项目过滤使用 `session.projectPath === project.path` 精确字符串匹配，路径大小写、斜杠、尾斜杠差异会把能打开的会话过滤掉。
- `Sidebar` 新增项目路径规范化比较：统一斜杠、去尾斜杠、忽略大小写，用于项目下会话列表、归档项目会话、自动创建空会话判断。
- `Sidebar` 新增 currentSession -> sessions 回灌：当前打开且非隐藏/非归档的会话如果不在 `sessionStore.sessions`，自动加入；如果标题、更新时间、项目路径或事件数量更新，也同步回列表源。
- 左侧列表的显示源和点击源统一为 `visibleSessions`，避免当前会话临时可见但点击时从 `sessions` 查不到。
- 版本号三处同步到 v2.8.316。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-Cc2HunTZ.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
## 下一步
- 请用户用 v2.8.316 复验：当前打开的 Project06 Goal 对话应出现在左侧 Project06 会话列表中，且点击该列表项仍能打开同一条聊天流。

# 2026-06-05 v2.8.317 左侧多项目同时展开
## 当前目标
- 支持左侧多个项目同时展开，方便多线程工作时同时观察不同项目下会话的运行/转圈状态。
## 已完成
- `Sidebar` 的展开状态从单个 `expandedProject` 改为 `expandedProjectIds: Set<string>`。
- 点击项目头只切换该项目自身展开/收起，不再折叠其它已展开项目。
- 当前项目自动展开、新建会话、项目菜单新建会话都会把项目追加到展开集合，而不是替换展开项。
- 移除项目时只从展开集合删除该项目，并保留其它项目展开状态。
- 版本号三处同步到 v2.8.317。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-BAZh80PD.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
## 下一步
- 请用户用 v2.8.317 复验：Project06、Project04、kimix 等多个项目可同时展开，并能看到各自会话的转圈/运行状态。

# 2026-06-05 v2.8.318 Slash Goal 本地消息流同步
## 当前目标
- 修复发送 `/goal ...` 后右侧 Goal 卡片更新、SDK 运行，但聊天消息流里看不到用户发送的 slash 指令的问题。
## 已完成
- 确认根因：`/goal` 路径先 `syncOfficialGoal()`，会把 `appStore.currentSession` 刷成“只有 Goal 状态”的对象；随后 `sendPromptContent(rawCommand)` 虽然把 user message / assistant placeholder 追加到 `sessionStore`，但没有立即同步 `currentSession`，导致主消息区继续看旧对象。
- `sendPromptContent()` 在追加本地 user message / assistant placeholder 后，立刻从 `sessionStore` 取回最新 session 并 `setCurrentSession()`。
- `appendLocalEvent()` 也同步更新 `currentSession`，覆盖 `/goal status`、失败提示、`/plan` 等本地状态卡路径。
- 版本号三处同步到 v2.8.318。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-DwN3LzqS.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
## 下一步
- 请用户用 v2.8.318 复验：发送 `/goal 全面review一下当前项目` 后，聊天流应立即出现这条用户消息，同时右侧 Goal 卡片更新并开始执行。

# 2026-06-05 v2.8.319 多项目展开收起回归修复
## 当前目标
- 修复 v2.8.317 多项目同时展开后，点击已经展开的非当前项目时会闪烁一下但仍保持展开的问题。
## 已完成
- 确认根因：点击已展开的非当前项目时，点击逻辑先从 `expandedProjectIds` 删除该项目，同时 `setCurrentProject(project)` 触发“当前项目自动展开”的 effect；effect 看到 currentProject 变化后又把该项目加回展开集合。
- 修复项目头点击逻辑：当用户主动收起已展开项目时，先把 `lastAutoExpandedProjectId` 同步为该项目 id，避免自动展开 effect 撤销用户的收起操作。
- 版本号三处同步到 v2.8.319。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-CwTNcDHt.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
## 下一步
- 请用户用 v2.8.319 复验：点击已展开项目应收起；点击未展开项目应展开；多个项目仍可同时保持展开。

# 2026-06-05 v2.8.320 Slash Goal 消息流覆盖链路修复
## 当前目标
- 修复发送 `/goal ...` 后右侧官方 Goal 已进入进行中、底部按钮已变停止，但聊天消息流仍看不到用户 slash 指令的问题。
## 已完成
- 确认根因不是没有追加消息，而是 `/goal` 先 `syncOfficialGoal()` 刷新了 `currentSession`，随后 `sendPromptContent()` 写入 `sessionStore` 后，`ensureKimiCodeRuntime()` 又把写消息前的旧 `targetSession` 设置回 `currentSession`。
- v2.8.316 为修复左侧列表一致性新增的 `currentSession -> sessions` 回灌，会在上述旧 `currentSession` 存在时把更少 events 的对象写回 `sessionStore`，导致刚追加的 user message / assistant placeholder 被覆盖。
- `Composer` 新增 `syncCurrentSessionFromStore()`，在追加本地消息、恢复/创建 Kimi Code runtime、追加本地状态事件后，都从 `sessionStore` 取回最新会话再同步 `currentSession`。
- `Sidebar` 的回灌逻辑增加保护：当 `currentSession.events` 少于 store 中已有 events 时，保留 store 的 events，不再用旧对象清空更完整的消息流。
- 版本号三处同步到 v2.8.320。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-D4saw83F.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
## 下一步
- 请用户用 v2.8.320 复验：发送 `/goal 全面review一下当前项目` 后，聊天流应立即出现这条用户 slash 消息，同时右侧官方 Goal 卡片更新、底部按钮进入停止态。

# 2026-06-05 v2.8.321 旧 Goal 会话打开循环修复
## 当前目标
- 修复 v2.8.320 后打开以前 Goal 会话时报 `Maximum update depth exceeded`，界面进入 React 循环更新错误页的问题。
## 已完成
- 确认根因在 `Sidebar` 的 `currentSession -> sessions` 回灌 effect：当 store 中旧 Goal 会话已经有更多 events 或更新的 `updatedAt` 时，effect 仍因为 `existing.updatedAt !== currentSession.updatedAt` 反复调用 `updateSession()`。
- 调整回灌策略：只有当前会话事件数更多，或当前会话元数据不旧于 store 且确实不同，才写回 `sessionStore`。
- 写回前按最终合并结果做无差异检查，避免 store 已是最新时仍触发新的 `sessions` 数组更新。
- 版本号三处同步到 v2.8.321。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-U3S125d-.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
## 下一步
- 请用户用 v2.8.321 复验：点击以前的 Goal 会话应能正常打开，不再进入 `Maximum update depth exceeded` 错误页；新 `/goal ...` 发送后仍应出现在聊天流。

# 2026-06-05 v2.8.322 输入框上方 Goal 状态条首版
## 当前目标
- 在输入框上方增加类似 TodoList/排队消息的小型官方 Goal 提示条，让用户随时知道当前对话正处于 Goal 模式。
## 已完成
- `Composer` 在存在未完成官方 Goal 时，在 TodoList/排队消息之后、输入框之前显示一行 Goal 状态条。
- 状态条包含 Goal 图标/运行 spinner、状态文案、目标摘要和已用轮数；已完成/取消状态不显示，避免历史完成 Goal 长期占用输入区。
- 首版不提供关闭按钮，避免用户收起后再次忘记当前处于 Goal mode。
- 版本号三处同步到 v2.8.322。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-DofmW0Ai.js`。
- `pnpm test:run` 通过：6 个测试文件、83 个测试全部通过。
## 下一步
- 请用户用 v2.8.322 复验：启动 `/goal ...` 后，输入框上方应出现一行 Goal 状态条；若空间、颜色或顺序不舒服，再按截图微调。

# 2026-06-05 v2.8.323 Assistant 多段进度正文换行修复
## 当前目标
- 修复 Goal 运行过程里明显应分段的多轮进度正文被强行塞进一个段落，导致聊天流和导出的 Markdown 都难以阅读的问题。
## 已完成
- 按用户截图关键词只读取导出 Markdown 局部，确认问题段在导出文件第 4111 行，导出时已经是一整段连续正文。
- 确认根因不在 Markdown 导出器删除换行，而在 `mergeEvents()`：工具调用之后的新 assistant 正文仍继续拼回同一个未完成 assistant event，缺少段落边界。
- `eventMapper` 调整 assistant 正文合并：中间隔过工具/审批/文件等处理事件后，后续正文用段落分隔；普通 token 级流式拼接仍保持 `Hel` + `lo` -> `Hello`。
- 新增 `restoreAssistantProgressParagraphs()` 作为旧会话兜底：对已经压平的长进度正文，在聊天气泡显示和 Markdown 导出时按保守状态句边界恢复段落。
- 新增单测覆盖工具边界后的 assistant 分段，以及导出 Markdown 的旧压平进度段恢复。
- 版本号三处同步到 v2.8.323。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-6C0s1q-v.js`。
- `pnpm test:run` 通过：7 个测试文件、85 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
## 下一步
- 请用户用 v2.8.323 复验：截图中的 Goal 进度长段应在聊天流里分段显示；重新导出 Markdown 后，对应段落也应带空行分隔。

# 2026-06-05 v2.8.324 Goal 状态条可收起/恢复
## 当前目标
- 给输入框上方的官方 Goal 状态条增加关闭按钮，点击后隐藏；右侧会话侧栏提供恢复入口，可再次显示到输入框上方。
## 已完成
- `ComposerDockCard` 增加 `goal` 类型，复用现有 hidden composer cards 机制。
- 输入框上方 Goal 状态条右侧增加 `X` 图标按钮，点击后隐藏该状态条，不影响官方 Goal 本身继续运行。
- 右侧会话侧栏“已收起卡片”加入“官方 Goal”恢复项，显示当前 Goal 状态和目标摘要，点击后恢复到输入框上方。
- 版本号三处同步到 v2.8.324。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-GUrULSjH.js`。
- `pnpm test:run` 通过：7 个测试文件、85 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
## 下一步
- 请用户用 v2.8.324 复验：点击输入框上方 Goal 条右侧关闭按钮后应隐藏；右侧“已收起卡片”里点击“官方 Goal”应恢复显示。

# 2026-06-05 v2.8.325 更新弹窗按钮高度对齐
## 当前目标
- 修复“更新记录”弹窗里 Kimi Code 卡片的“重新安装/更新”和“检查 Kimi Code”按钮视觉高度/顶线不一致的问题，并检查 Kimix 本体卡片同类按钮。
## 已完成
- `DialogSystem` 增加更新弹窗共享操作列样式：主按钮固定 `height/minHeight: 40`，第二行链接/占位固定 `height/minHeight: 20`。
- Kimi Code 卡片的安装/更新/检查操作统一为两行操作列，按钮第一行顶线和高度一致，浏览器查看留在第二行。
- Kimix 本体卡片也改为同一套操作列，避免“升级/检查本体/浏览器查看”在有更新或无更新状态下出现同类错位。
- 版本号三处同步到 v2.8.325。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-B6vBmaDg.js`。
- `pnpm test:run` 通过：7 个测试文件、85 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
## 下一步
- 请用户用 v2.8.325 复验更新记录弹窗：Kimi Code 卡片两个主按钮应等高、顶线一致；Kimix 本体卡片按钮也应保持同样规则。

# 2026-06-05 v2.8.326 Markdown 表格碎片恢复
## 当前目标
- 修复 assistant 原本输出 GFM 表格时，表格分隔行被流式/历史内容切成多行，导致聊天流把表头和分隔符当普通段落渲染的问题。
## 已完成
- 确认用户附件里的原始片段已经出现坏结构：`| 功能 | 实现方式 | 价值 |` 后的 separator 被拆成 `|------`、空行、`|---------|------|`，GFM 无法识别成表格。
- `restoreAssistantProgressParagraphs()` 增加窄范围表格修复：只在疑似表头行后收集 Markdown separator 碎片，并恢复为合法的 `|------|---------|------|`。
- 聊天气泡显示和 Markdown 导出共用该修复链路，不改历史原始事件。
- 新增导出单测覆盖被拆开的表格 separator。
- 版本号三处同步到 v2.8.326。
## 验证
- `pnpm vitest run src/utils/__tests__/markdownExport.test.ts` 通过：1 个测试文件、2 个测试全部通过。
- `pnpm build` 通过，renderer hash：`assets/index-CDpAcmtG.js`。
- `pnpm test:run` 通过：7 个测试文件、86 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
## 下一步
- 请用户用 v2.8.326 复验截图中的方案 A / 方案 B 表格是否恢复为真正表格；若仍有非 separator 类型的断行，再按具体片段扩展修复规则。

# 2026-06-05 v2.8.327 Kimi Code 0.11.0 SDK 跟进
## 当前目标
- 按官方 Kimi Code 0.11.0 更新，刷新 Kimix vendored node-sdk 并确认 Goal 队列、子 Skill、自动更新相关影响。
## 已完成
- 本机 `kimi --version` 已确认是 `0.11.0`；npm `@moonshot-ai/kimi-code` latest 为 `0.11.0`。
- 从官方 repo `84afaf42fc2fc1882fd6fc1b656bdc5189b62315` 重生成 `vendor/kimi-code-sdk/index.mjs`；`packages/node-sdk` 版本仍为 `0.8.0`。
- SDK 探针确认 `createKimiHarness()` 仍可用，`Session.createGoal/getGoal/pauseGoal/resumeGoal/cancelGoal` 五个方法存在且可调用。
- SDK 探针确认 0.11.0 仍未公开 `/goal next` 或 queue API；Kimix 继续不伪造真实队列，只把提示更新为“0.11.0 TUI 已修复队列，但 node-sdk 未公开”。
- SDK 探针确认开启 `KIMI_CODE_EXPERIMENTAL_SUB_SKILL=1` 时，`listSkills()` 能看到 `sub-skill.review` / `sub-skill.consolidate`，但本轮暂未默认开启到产品 UI。
- Kimix 启动 vendored SDK 和运行 Kimi CLI 检查命令时默认设置 `KIMI_CODE_NO_AUTO_UPDATE=1` 与旧别名 `KIMI_CLI_NO_AUTO_UPDATE=1`，避免官方自动更新预检干扰 Kimix 自己的更新弹窗。
- 版本号三处同步到 v2.8.327。
## 验证
- 0.11.0 SDK 方法探针通过：`createKimiHarness()` 可创建 session；Goal 生命周期五个方法存在且可调用；未发现 `next` / queue 公开方法。
- 0.11.0 SDK Skill 探针通过：开启 `KIMI_CODE_EXPERIMENTAL_SUB_SKILL=1` 后，`listSkills()` 可看到 `sub-skill.review` / `sub-skill.consolidate`。
- `pnpm build` 通过，renderer hash：`assets/index-DIKVWFSS.js`。
- `pnpm test:run` 通过：7 个测试文件、86 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
## 下一步
- 完整验证通过后，请用户用 v2.8.327 复验 Kimi Code 更新弹窗、`/goal next` 边界提示和普通 Goal 生命周期。

# 2026-06-05 v2.8.328 Kimi Code 纯工具轮消息头修复
## 当前目标
- 修复发送 `/goal 是否收到?` 这类 Goal 状态/完成相关消息后，assistant 轮次只有 `UpdateGoal` 工具执行体、没有正常消息头的问题。
## 已完成
- 确认根因在聊天渲染分组：同一 turn 如果没有 assistant 正文/思考，只包含工具调用，会退化成 standalone tool group，绕过 `MessageBubble` 的 assistant process header。
- `ChatThread` 在 `kimi-code` 会话中把纯工具轮包装为一个空正文 assistant 占位事件，并把工具挂到 `leadingTools`，从而显示正常“执行中 / 输出完成”消息头。
- 旧 `prompt` 引擎仍保留原 standalone tool group 行为，避免扩大影响面。
- 新增 `createToolOnlyAssistantEvent()` 和单测覆盖纯工具轮完成态、运行态。
- 版本号三处同步到 v2.8.328。
## 验证
- `pnpm vitest run src/utils/__tests__/chatRenderItems.test.ts` 通过：1 个测试文件、2 个测试全部通过。
- `pnpm build` 通过，renderer hash：`assets/index-_lF6m99b.js`。
- `pnpm test:run` 通过：8 个测试文件、88 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
## 下一步
- 请用户用 v2.8.328 复验：发送 `/goal 是否收到?` 后，`UpdateGoal` 这类纯工具轮应出现在带“执行中/输出完成”头部的 assistant 消息内，而不是只剩工具执行体。

# 2026-06-05 v2.8.329 /goal status 对话流反馈
## 当前目标
- 修复单独发送 `/goal status` / `/goal show` 时只刷新右侧 Goal 侧栏、对话流没有明确反馈的问题。
## 已完成
- `/goal status` / `/goal show` 仍作为 Kimix 本地查询命令处理，不作为用户消息发送给 agent。
- 查询成功后追加一条完成态 assistant 本地反馈，展示“已刷新官方 Goal 状态”、状态标签、轮数和目标摘要。
- 失败路径仍追加状态错误信息，避免误显示为正常 assistant 回复。
- 版本号三处同步到 v2.8.329。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-CBCgc_aW.js`。
- `pnpm test:run` 通过：8 个测试文件、88 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
## 下一步
- 请用户用 v2.8.329 复验：输入 `/goal status` 后，右侧 Goal 卡片刷新，同时聊天流应出现一条本地 assistant 状态反馈。

# 2026-06-05 v2.8.330 Goal 工具完成证据优先
## 当前目标
- 修复 agent 已调用 `UpdateGoal` 并返回 `Goal marked complete.` 后，右侧官方 Goal 和输入框上方 Goal 条仍显示旧 blocked 目标的问题。
## 已完成
- 新增 `officialGoalState` 工具：识别 terminal Goal 状态，并在 SDK 刷新返回同一目标旧状态时保留本地 terminal 证据。
- `App` 的 Kimi Code event listener 识别 `UpdateGoal` 的 `tool_result` / 合并后 `tool_call` 成功结果；若结果包含 `Goal marked complete.` 或 `status: complete`，立即把本地 `officialGoal.goal.status` 标为 `complete`。
- turn 结束自动 `getGoal()` 刷新、`/goal status` 刷新、右侧“刷新”按钮都改为通过同一合并规则，避免 SDK 返回旧 blocked 时把本地 complete 倒回去。
- 右侧“官方 Goal”卡片和输入框上方 Goal 条不再把 terminal goal 当作活跃目标显示。
- 新增单测覆盖：本地 complete 不被同目标 blocked 刷新覆盖；`UpdateGoal` 工具结果可推断 complete。
- 版本号三处同步到 v2.8.330。
## 验证
- `pnpm vitest run src/utils/__tests__/officialGoalState.test.ts` 通过：1 个测试文件、2 个测试全部通过。
- `pnpm build` 通过，renderer hash：`assets/index-BlkQF6L1.js`。
- `pnpm test:run` 通过：9 个测试文件、90 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
## 下一步
- 请用户用 v2.8.330 复验：让 agent 调用 `UpdateGoal` 完成目标后，右侧 Goal 卡片应回到未启动/无活跃目标状态，输入框上方 Goal 条也应消失；手动点刷新不应恢复旧 blocked 目标。

# 2026-06-06 v2.8.331 Goal 卡片消息流实时刷新
## 当前目标
- 让右侧官方 Goal 卡片和输入框上方 Goal 条在 Kimi Code 消息流持续变化时同步刷新轮次/状态，而不是只依赖手动刷新或 turn 结束刷新。
## 已完成
- `App` 增加按 runtime session 节流的 Goal 刷新调度：当前会话已有官方 Goal 时，每次 Kimi Code 事件入流都会尝试触发 `getGoal()`，同一 runtime 1.2 秒内最多刷新一次。
- Kimi Code turn 终态仍立即刷新 Goal，并更新节流时间，避免终态显示滞后。
- effect 清理时会清掉 Goal 刷新 timer 和最近刷新时间，避免旧会话 timer 残留。
- 版本号三处同步到 v2.8.331。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-CUAVopva.js`。
- `pnpm test:run` 通过：9 个测试文件、90 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
## 下一步
- 请用户用 v2.8.331 复验：Goal 运行中随着消息/工具/状态事件推进，右侧卡片的轮次和状态应在约 1 秒级别内刷新；截图左下角需确认是 v2.8.331。

# 2026-06-06 v2.8.332 Slash 本地指令中央提示
## 当前目标
- 发送 Kimix 本地处理的 slash 指令时，在屏幕中央追加一条非消息提示，让用户知道指令已被接收。
## 已完成
- `status_update` 增加 `source` / `tone` 字段；slash 确认提示使用 `source: "slash"`、`tone: "info"`。
- `StatusCard` 复用轮次信息的中央胶囊形态，slash 提示使用浅蓝信息态。
- `ChatThread` 对 `source === "slash"` 的状态提示不应用 turn-end 过滤，确保每条本地 slash 都可见。
- `Composer` 对本地处理的 `/goal`、`/compact`、`/plan`、`/btw`、`/undo` 先追加“已接收本地指令：/xxx ...”提示；未知 slash 和 `/skill:` 不误标为本地指令。
- `isEmptyStatusUpdate()` 认为带 `message` 的状态不是空状态，避免 slash 提示被空状态逻辑吞掉。
- 版本号三处同步到 v2.8.332。
## 验证
- `pnpm vitest run src/utils/__tests__/sessionMetrics.test.ts` 通过：1 个测试文件、15 个测试全部通过。
- `pnpm build` 通过，renderer hash：`assets/index-CoyMH2qz.js`。
- `pnpm test:run` 通过：9 个测试文件、91 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
## 下一步
- 请用户用 v2.8.332 复验：发送 `/goal status`、`/compact`、`/plan`、`/btw ...`、`/undo` 时，聊天流中央应立即出现浅蓝胶囊提示；未知 slash 不应出现本地指令提示。

# 2026-06-06 v2.8.333 Kimi Code 更新说明链接修复
## 当前目标
- 修复“更新记录”弹窗里 Kimi Code 卡片的“浏览器查看”打开 403 页的问题。
## 已完成
- `DialogSystem` 中 Kimi Code 更新查看链接从 `https://code.kimi.com/kimi-code` 改为官方 changelog：`https://moonshotai.github.io/kimi-code/zh/release-notes/changelog.html`。
- 版本号三处同步到 v2.8.333。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-oN2oadfS.js`。
- `pnpm test:run` 通过：9 个测试文件、91 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
## 下一步
- 请用户用 v2.8.333 复验：更新记录弹窗中 Kimi Code 卡片的“浏览器查看”应打开官方 changelog，不再进入 403 页。

# 2026-06-06 v2.8.334 顶部工具栏 hover 动效统一
## 当前目标
- 修复顶部工具栏里项目打开、差异面板、会话侧栏等按钮悬停反馈不一致的问题。
## 已完成
- 新增 `kimix-toolbar-button` 通用交互类，统一 toolbar 图标按钮的 hover 阴影、轻微上移和 active 回落。
- 将启动 split button、项目 split button、终端、撤销、差异面板、会话侧栏统一套用同一类，避免部分按钮只有颜色变化或无明显反馈。
- 版本号三处同步到 v2.8.334。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-BWnpkjRt.js`。
- `pnpm test:run` 通过：9 个测试文件、91 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
## 下一步
- 请用户用 v2.8.334 复验：顶部工具栏项目打开、差异面板、会话侧栏 hover 时应与旁边按钮一样有轻微阴影/位移反馈。

# 2026-06-06 v2.8.335 顶部工具栏图标 hover 加深
## 当前目标
- 补齐顶部工具栏按钮 hover 时中心图标加深的反馈，让项目打开、差异面板、会话侧栏与旁边按钮一致。
## 已完成
- `kimix-toolbar-button:hover` 增加主文字色，并对子级 `svg` 同步加深。
- 版本号三处同步到 v2.8.335。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-BDGviyqi.js`。
- `pnpm test:run` 通过：9 个测试文件、91 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
## 下一步
- 请用户用 v2.8.335 复验：顶部工具栏这些按钮 hover 时外壳有反馈，中心图标也会明显加深。

# 2026-06-06 v2.8.336 顶部项目图标颜色统一
## 当前目标
- 修复顶部项目文件夹图标原本为黄色、hover 后变黑导致状态跳变不一致的问题。
## 已完成
- 顶部工具栏项目文件夹图标去掉 `text-accent-warning`，改为继承工具栏统一图标颜色。
- 下拉菜单里的文件夹语义图标保持黄色，不影响菜单信息层级。
- 版本号三处同步到 v2.8.336。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-adrU9oWC.js`。
- `pnpm test:run` 通过：9 个测试文件、91 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
## 下一步
- 请用户用 v2.8.336 复验：顶部项目文件夹图标默认色应和其他工具按钮一致，hover 时只做统一加深。

# 2026-06-06 v2.8.336 发布准备
## 当前目标
- 按用户要求推送 GitHub 并发布 Release，发版说明覆盖 v2.8.295 之后累计改动。
## 已完成
- 新增 `docs/release-notes/v2.8.336.md`，按 Kimi Code 0.11.0、官方 Goal、slash 命令、会话列表、模型设置、Markdown、UI 细节分组整理累计改动。
- 发布前验证重新通过。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-adrU9oWC.js`。
- `pnpm test:run` 通过：9 个测试文件、91 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
## 下一步
- stage 累计改动、提交、推送 `master`，再创建并推送 `v2.8.336` tag 触发 GitHub Actions。

# 2026-06-06 v2.8.337 UI 全盘巡检前 6 项修复
## 当前目标
- 修复 UI 巡检清单中用户指定的 1-6 项：插件页崩溃、长程任务/搜索黑描边、更新弹窗 Kimi Code 卡片、Hooks 空态重心、Hooks 创建页密度。
## 已完成
- `SkillsPanel` 对 SDK Plugin/Skill、Marketplace、本地 Skill 列表返回值做数组归一，避免浏览器预览或异常数据下 `.length/.map` 崩溃。
- `LongTasksPanel` 弹窗、项目卡、创建卡、输入框和 textarea 改用 Kimix 浅边框，焦点态使用主色细边。
- `SearchOverlay` 弹窗外边框改为浅边框，空态补虚线浅边框，降低黑描边感。
- `DialogSystem` 更新弹窗中的 Kimi Code 卡片改成单列信息 + 下方右对齐操作区，减少左侧提示框和右侧按钮列的割裂。
- `HooksPanel` 创建页左右比例和间距微调，创建提示词高度收敛；普通空态右侧编辑区改为更完整的居中浅底空态。
- 版本号三处同步到 v2.8.337。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-u-U4B-Zv.js`。
- `pnpm test:run` 通过：9 个测试文件、91 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
- 浏览器预览复验：插件页不再崩溃；长程任务、搜索、更新弹窗、Hooks 普通页和 Hooks 创建页均可打开并保存复验截图。
## 下一步
- 完成构建/测试后，用浏览器重新打开插件、长程任务、搜索、更新弹窗、Hooks 页面复验视觉效果。

# 2026-06-06 v2.8.338 新会话 Plan 模式启动修复
## 当前目标
- 修复新窗口/新会话未创建官方 runtime session 时，直接点击输入框底部 Plan 模式会提示 session 不存在的问题。
## 已完成
- `Composer` 的 Plan 按钮切换不再使用 `getRuntimeSessionId()` 的 UI 会话 id fallback；只有存在 `runtimeSessionId` 或 `officialSessionId` 时才同步调用 SDK `setPlanMode()`。
- 无官方 runtime 的新会话只更新本地默认 Plan 状态，首条消息创建 Kimi Code session 时通过 `createKimiCodeSession({ planMode })` 生效。
- `/plan` 本地 slash 指令同样只在真实官方 runtime 存在时同步 SDK，避免新会话误报 session 不存在。
- 版本号三处同步到 v2.8.338。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-D0o_Vweu.js`。
- `pnpm test:run` 通过：9 个测试文件、91 个测试全部通过。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
## 下一步
- 请用户用 v2.8.338 复验：新窗口/新会话直接点击 Plan，应只提示 Plan 已开启且不报 session 不存在；随后发送首条消息应以 Plan 模式开始。

# 2026-06-13 v2.9.47 Kimi Code 实时输出重复修复
## 当前目标
- 查明并修复会话 `fjwq6pgu6` 中助手输出出现词片段重复的问题。
## 已完成
- 确认根因：主进程同时向旧 `kimi:event` 和新 `kimi-code:event` 通道发送同一条 Kimi Code SDK 事件；v2.9.45 为 compaction replay 让旧 `eventMapper` 开始识别 SDK 原生 `assistant.delta` 后，实时会话里同一 delta 被两个通道各合并一次。
- 旧 `kimi:event` handler 现在跳过 `engine === "kimi-code"` 和长程任务会话，保留给 legacy 流程使用，避免 Kimi Code 实时输出双重合并。
- 版本号三处同步到 v2.9.47，并新增 `docs/release-notes/v2.9.47.md`。
## 验证
- `pnpm test:run -- src/utils/__tests__/eventMapper.test.ts src/utils/__tests__/kimiCodeEventMapper.test.ts src/utils/__tests__/kimiCodeSendRetry.test.ts` 通过：3 个测试文件、69 个测试通过。
- `pnpm build` 通过，renderer hash：`assets/index-C8DDvTFB.js`。
## 下一步
- 构建和相关事件映射测试通过后，请用户用 v2.9.47 复验 Kimi Code 新实时会话是否还会出现词片段重复。

# 2026-06-13 v2.9.48 高优先级按钮 hover 收敛
## 当前目标
- 核对并修复 Kimi 自检清单中确认真实的高优先级按钮 hover 不一致问题，避免强按钮 hover 变淡、危险操作颜色硬编码和可点击元素缺少反馈。
## 已完成
- 停止按钮、弹窗保存命令按钮、审批“允许一次”按钮改为背景色加深/体系化 hover，不再使用 `hover:opacity-90`。
- 顶部启动/项目组合按钮统一外层 hover 背景与展开态反馈，小三角 hover 改用同一 panel soft 背景。
- 画板删除对象改用 `accent-danger` 体系；附件删除按钮 hover 改为危险色；MCP OAuth 开关补齐 hover。
- 确认 Settings 拖拽手柄已有 hover 和 `cursor: grab`，该条为误报，未改动。
- 版本号三处同步到 v2.9.48，并新增 `docs/release-notes/v2.9.48.md`。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-CYTyxGsA.js`。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
## 下一步
- 构建通过后，请用户用 v2.9.48 重点复验停止按钮、审批卡、顶部工具栏、MCP OAuth、画板删除对象和附件删除 hover。

# 2026-06-13 v2.9.49 侧栏设置入口 hover 对齐
## 当前目标
- 修复侧栏底部「设置」按钮 hover 背景色与上方「插件 / Hooks」导航按钮不一致的问题。
## 已完成
- `kimix-settings-entry:hover` 从硬编码 `rgba(0, 0, 0, 0.05)` 改为主题 token `var(--surface-hover)`，与 `kimix-sidebar-nav-item:hover` 保持一致。
- 版本号三处同步到 v2.9.49，并新增 `docs/release-notes/v2.9.49.md`。
## 验证
- `pnpm build` 通过，renderer hash：`assets/index-DCpAIzL6.js`。
- `git diff --check` 通过；仅提示 Windows LF/CRLF warning。
## 下一步
- 构建通过后，请用户用 v2.9.49 复验侧栏底部「设置」和上方「插件 / Hooks」hover 背景是否一致。

# 2026-06-18 v2.9.144 Kimi Server Skill / MCP 接入
## 当前目标
- 把 Kimi Code 0.17.1 Server 的 Skill 与 MCP 能力接入现有 Kimix 产品入口。
## 已完成
- Server Client 接入 Skill list/activate 与 MCP server list/restart；Host 统一映射到现有 SDK 数据结构。
- `/skill:name 参数` 优先调用当前官方会话的 Skill 激活接口；该接口本身会启动一轮，不再重复发送参数。
- Skills 页兼容 Server 无 Plugin 列表的情况；MCP 页展示当前会话运行态、工具数、错误并支持重启。
- 版本号三处同步到 v2.9.144；新增独立真实探针脚本。
## 验证
- 真实 0.17.1 Server 探针通过：13 个 Skill、项目 Skill 激活成功；1 个 MCP connected、2 个工具；缺失服务 restart 返回 40408。
- 全量测试 21 个文件、176/176 通过；`pnpm build` 通过，renderer hash：`assets/index-BQVv66qF.js`。
## 下一步
- 跑全量测试后提交本轮；随后进入 fork / children 会话树 UI。

# 2026-06-18 v2.9.145 Kimi Server 会话树接入
## 当前目标
- 将已经桥接的 fork / children 能力接入右侧会话栏，形成可操作的官方会话关系视图。
## 已完成
- 右侧栏只在 Server 查询成功时显示“官方会话树”，SDK 会话不显示空壳。
- 展示当前节点、fork 分支和直接 child；支持刷新、新建 child、读取历史并切换到关联会话。
- Host 将官方 `/children` 与 Kimix fork 时保存的 `metadata.forkedFrom` 合并；UI 明确区分“分支”和“子会话”。
- 版本号三处同步到 v2.9.145；新增独立真实会话树探针。
## 验证
- 真实 0.17.1 Server 探针通过：child 被官方 children 返回，fork 不在官方 children 中但可由 `forkedFrom` 识别，合并后共 2 个关联节点；child 可按 ID 恢复。
- 全量测试 21 个文件、177/177 通过；`pnpm build` 通过，renderer hash：`assets/index-Dxl8HXaf.js`。
## 下一步
- 跑全量测试与最终构建并提交；随后继续 tool catalog / 运行时诊断。

# 2026-06-18 v2.9.146 Kimi Server 工具目录与运行时诊断
## 当前目标
- 接入官方 Server 的 session-effective tools 与 live connections，补齐可观察性。
## 已完成
- Server Client 接入 `/tools?session_id=` 与 `/connections`，Host 汇总 session status、工具、MCP 和连接为只读诊断接口。
- MCP 页展示 builtin/Skill/MCP 工具来源分布、工具目录、MCP 状态和当前会话订阅连接数。
- 右侧 Kimi 自检补充 Server 工具、MCP 与订阅连接摘要；SDK 会话保持原诊断路径。
- 版本号三处同步到 v2.9.146；新增真实 tools/connections 探针。
## 验证
- 真实 0.17.1 Server 探针通过：26 个 builtin 工具；1 个完成 client_hello 的 WebSocket 客户端正确订阅当前 session。
- 全量测试 21 个文件、177/177 通过；`pnpm build` 通过，renderer hash：`assets/index-BW3gMdIH.js`。
## 下一步
- 跑全量测试与最终构建并提交；随后核对 Server model catalog / config / OAuth。
# 2026-06-20 v2.10.18 OKF 自治维护
## 当前目标
- 让项目知识库在日常开发中自动收尾并定期暴露维护债务，减少人工提醒。
## 已完成
- 新增任务结束知识变更判定规则；架构、集成、运维、事故与治理变化由 Agent 主动更新知识库。
- 校验器新增维护审计模式，检查 180 天陈旧、孤立条目、重复标题和未来时间戳。
- Knowledge workflow 增加每周定时及手动巡检；版本号同步到 v2.10.18。
- `$deploy-okf-knowledge` Skill 增加自治维护边界、定期巡检、团队分发和第二项目前向验收流程；仓库保留可版本化规范源，用户目录保留自动发现安装副本。
## 未完成
- 仍需在第二个真实项目执行 `$deploy-okf-knowledge` 做跨项目验收。
## 关键文件
- `scripts/validate-okf.mjs`
- `.github/workflows/knowledge.yml`
- `knowledge/maintenance/knowledge-maintenance.md`
- `tools/skills/deploy-okf-knowledge/`
## 下一步
- 在第二个真实项目执行 Skill 前向验收；本轮先完成全量测试、构建和窄提交。

# 2026-06-20 v2.11.0 Kimi Server 接管恢复优化
## 当前目标
- 减少会话长期停留在 SDK 链路的情况，并隐藏面向开发者的内部回退细节。
## 已完成
- SDK 链路发送时会按 30 秒冷却触发 Server 后台恢复，不阻塞当前消息。
- Server 就绪后，空闲 SDK 会话仅在 Server 能解析同一官方会话 ID 时安全晋升，无法解析则继续保留 SDK 上下文。
- 发送结果统一为“使用kimi server链路已发送消息”或“kimi sdk链路已发送消息”。
- 版本号三处同步到 v2.11.0。
## 未完成
- 等待用户用 v2.11.0 实机复验 Server 恢复与两种发送文案。
## 关键文件
- `electron/kimiCodeHost.ts`
- `src/utils/kimiCodeRouteStatus.ts`
- `src/components/chat/Composer.tsx`
- `src/components/chat/EmptyState.tsx`
## 下一步
- 启动 v2.11.0，分别验证 Server 与 SDK 路由文案；在 Server 暂时失败并恢复后，再次发送应可安全切回 Server。

## 验证
- 路由相关测试通过：3 个测试文件、20/20。
- 全量测试通过：25 个测试文件、196/196。
- `pnpm build` 通过，renderer hash：`assets/index-BlN3VQq1.js`。
- OKF 严格校验、v0.1 规范校验、180 天维护审计均通过。
- `git diff --check` 通过，仅有 LF/CRLF 提示。

# 2026-06-20 v2.11.1 查看菜单 Web Server 入口
## 当前目标
- 去掉未实现的文件树入口，把浏览器入口改为真实打开 Kimi Web Server。
## 已完成
- 查看菜单移除“切换文件树”。
- “打开浏览器标签页”改为“打开 Web Server”，不再显示准备中占位。
- 新增 `kimi:openWebServer` IPC，调用官方 `kimi web`，让 Kimi Code 启动 Web Server 并打开浏览器页面。
- 版本号三处同步到 v2.11.1。
## 未完成
- 等待用户用 v2.11.1 实机复验菜单入口和浏览器页面。
## 关键文件
- `src/components/layout/TopMenuBar.tsx`
- `src/components/layout/AppShell.tsx`
- `electron/main.ts`
- `electron/preload.ts`
## 下一步
- 验证菜单类型、构建和测试；实机点击“查看 → 打开 Web Server”确认浏览器页面打开。

## 验证
- 旧菜单入口搜索通过：`切换文件树`、`打开浏览器标签页`、`toggle-file-tree`、`open-browser-tab` 在 `src/`、`electron/`、`package.json` 中无残留。
- `pnpm test:run` 通过：25 个测试文件、196/196。
- `pnpm build` 通过，renderer hash：`assets/index-BHMqkYGH.js`。
- `pnpm knowledge:validate` 通过。
- `git diff --check` 通过，仅有 LF/CRLF 提示。
- 真实命令验证：本机执行 `kimi web`，进程以 code=0 正常交给官方命令处理。

# 2026-06-20 v2.11.2 启动白屏排查与旧 Server 会话硬化
## 当前目标
- 排查用户反馈启动后白屏，并降低旧 Server session 缺失导致启动期状态异常的风险。
## 已完成
- 干净 dev 与生产 preview 均能渲染主界面，版本显示 v2.11.1，未复现构建产物必现白屏。
- 发现启动日志中旧 Server session 在新 Server 中返回 missing 后仍短暂保留绑定。
- 恢复旧会话应用 profile 失败且为 session missing 时，先关闭旧绑定再创建新 runtime。
- 初始 status refresh 遇到 session missing 时移除 stale Server binding，不再继续保留脏状态。
- 版本号三处同步到 v2.11.2。
## 未完成
- 等待用户用 v2.11.2 启动复验是否仍白屏。
## 关键文件
- `electron/main.ts`
- `electron/kimiCodeHost.ts`
- `src/components/layout/Sidebar.tsx`
- `src/components/settings/SettingsPanel.tsx`
## 下一步
- 跑构建、全量测试和知识校验；如用户侧仍白屏，要求回传截图和当前版本号，优先排查旧进程/缓存或特定窗口状态。

# 2026-06-20 v2.11.3 启动首屏预热延后
## 当前目标
- 解决“启动 Kimi 后白屏很久才有内容”的加载体验问题。
## 已完成
- 将当前会话 Kimi runtime 预热从 350ms 延后到 3000ms，先让主界面完成首屏显示。
- 预热恢复旧 runtime 遇到 session missing 时，清理本地 `runtimeSessionId` / `officialSessionId`，避免后续启动反复恢复同一个失效会话。
- Kimi Server 启动从 app ready 串行阻塞改为窗口 `did-finish-load` 后延迟 2 秒后台启动，避免 Server 探测/启动挡住主界面。
- 版本号三处同步到 v2.11.3。
## 未完成
- 等待用户实机复验启动白屏时长。
## 关键文件
- `src/App.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/components/settings/SettingsPanel.tsx`
## 下一步
- 跑生产构建/预览截图、全量测试和知识校验；用户用 v2.11.3 复验主界面是否先出现，再后台连接 Kimi。

## 验证
- `pnpm build` 通过，renderer hash：`assets/index-DaR0L8bW.js`。
- `pnpm preview` 生产预览日志顺序已变为 renderer content check 先出现，Kimi Server 后台启动日志后出现。
## 2026-07-05 v2.14.45 Assistant footer 操作文字层级统一
- 现象：“全部复制”从 12px 调到 13px 后，相对中间状态气泡显得偏大；同层级 Hook 按钮仍为 12px。
- 修复：“全部复制”和 Hook 按钮统一使用 12px 文字，保留 13px 图标与 32px 按钮高度。
- 下一步：实机确认两侧操作文字与中间状态气泡的视觉层级协调。
## 2026-07-05 v2.14.46 Assistant footer 字面高度校准
- 证据：v2.14.45 截图像素测量中，“全部”字面高度约 13px，“模型：”约 12px，左侧仍明显偏大。
- 根因：中文与拉丁字形占用 em 的比例不同，且操作按钮继承约 20.4px 行高，而状态气泡明确使用 18px 行高。
- 修复：“全部复制”和 Hook 操作文字统一改为显式 11px 字号、18px 行高；图标和 32px 按钮高度保持不变。
- 下一步：实机截图复核 v2.14.46 两侧操作文字与中间状态气泡的实际字面高度。
## 2026-07-05 v2.14.47 Assistant footer 半像素光学校准
- 证据：v2.14.45 的 12px 操作文字实际字面约 13px；v2.14.46 的 11px 操作文字实际字面约 10px；中间 13px 状态气泡实际字面约 12px。
- 修复：抽出状态气泡 13px/18px 共享文字基准；“全部复制”和 Hook 操作文字从该基准派生为 11.5px，并维持相同的 18px 行高。
- 下一步：实机截图复核 v2.14.47 两侧操作文字是否与中间状态气泡达到相同视觉高度。
## 2026-07-05 v2.14.48 Assistant footer 中文文字同参数
- 根因：上一轮错误地参考英文模型名做字面高度补偿，没有直接比较同为中文的“全部”和“模型”。
- 修复：“全部复制”和 Hook 操作文字完整复用状态气泡的 13px/18px 共享样式，不再做任何字号补偿。
- 下一步：实机截图确认“全部/钩子”与“模型”中文文字大小一致。
## 2026-07-05 v2.14.49 历史 Context 假零隐藏
- 根因：旧 `StatusUpdate` 缺少 `context_usage` 时被映射为 `contextSize: 0`，显示层又把已定义的零值渲染为 `Context: 0.00%`。
- 修复：缺失上下文保持 `undefined`；显示层仅渲染正数 Context，兼容隐藏已落盘的旧零值；最新状态取得正数时照常显示。
- 下一步：实机确认旧会话不再显示假零，最新有上下文数据的会话仍显示正常百分比。
## 2026-07-06 v2.14.50 旧会话模型切换恢复
- 现象：软件重启后在旧会话切换模型，直接调用未激活 runtime，提示 `Kimi Code session is not active`。
- 根因：权限切换已有 inactive 恢复重试，模型切换仍假设主进程已注册该会话。
- 修复：抽出通用会话变更恢复逻辑；模型和权限共用 inactive 恢复、项目目录校验与重试；模型成功后同步真实 runtime ID。
- 下一步：实机验证重启后旧会话可直接切换模型，且不会恢复到其他项目。
## 2026-07-06 v2.14.51 子事件详情列对齐
- 现象：子代理详情左侧有多余竖线；类型列按内容自适应，“输出/状态/工具完成 Bash”等长度不同导致详情起点乱窜。
- 修复：移除详情容器左边框；类型列固定为 104px，超长类型截断并保留 title，详情列统一起点。
- 下一步：实机检查多种子事件混排时的详情列对齐和长文本换行。
## 2026-07-06 v2.14.52 缺失 turn.ended 的回复收尾
- 现场：`session_d378904e-1b5d-460c-ac59-269b701a5f31`最后有`turn.step.completed + finishReason=end_turn`，但缺少后续`turn.ended/prompt.completed/status idle`；本地`runningSessionId=null`，Assistant仍`isComplete=false`并永久计时。
- 修复：Server `turn.step.completed`仅在`finishReason=end_turn`时映射Assistant完成事件；`tool_use`等中间步骤保持未完成。Todo残留不是本次忙态根因。
- 下一步：实机打开该会话，确认计时停止、footer不再显示“消息处理中”。
## 2026-07-06 v2.14.53 额度 403 后残留忙态
- 现场：`session_01e4f589-c2c5-473e-adbe-62406f8098ef` 的 SDK 在 21:11:38 因额度耗尽返回 HTTP 403 并记录 `turn failed`，但本地 5 个子代理和工具事件仍为 running，导致 `runningSessionId=null` 后界面继续显示运行中。
- 根因：SDK failed/error 的 `turn.ended` 被主进程归为 completed；renderer 的 error/interrupted 收尾只删除未完成 Assistant，没有关闭子代理与工具。
- 修复：失败原因进入 engine error；终态错误统一将未结束子代理/工具标为 error，并保留、收尾已有的部分 Assistant 正文。
- 下一步：实机制造一次可控失败，确认计时、消息处理中、底部运行中和子代理运行态同时停止。
## 2026-07-06 v2.14.54 Web 思考缩短时视口上跳
- 现象：Kimi Web 流式思考先占满 5–6 行，追加下一段后折叠为最新 1 行时，内容总高度瞬间缩短，浏览器先钳制 scrollTop，导致当前视口向上跳。
- 修复：contentVersion 布局提交前记录 scrollHeight、scrollTop、clientHeight 和底部距离；自动跟随且非用户滚动时，如果提交后内容变短，在绘制前按原底部距离同步恢复 scrollTop。
- 下一步：实机观察连续思考段由多行切到一行，确认当前消息和下方工具卡位置不再突跳。
## 2026-07-06 v2.14.55 Swarm 底部锁定态按钮
- 目标：Swarm 模式开启/锁定后，在 Composer 底部增加和 Plan/思考同层级的临时状态按钮，放在 Plan 左侧，不常驻。
- 修复：`swarmModeLocked` 为真时显示“Swarm 开”按钮，复用 active 状态边框、背景、字号和图标文字按钮尺寸；未锁定时不渲染。
- 下一步：实机确认 Swarm 锁定会话底部显示按钮，普通会话不显示。
## 2026-07-06 v2.14.56 工具运行期间渲染卡顿
- 现场：运行工具/命令时 `diag.log` 高频写入 `contentVersion effect`、`restoreManualScrollAnchor`、`processResize`，同一运行会话多次生成 renderer freeze 报告；计时器不更新说明 renderer 主线程被阻塞。
- 修复：移除正常流式路径的 contentVersion/resize 诊断写入；手动滚动锚点恢复 350ms 节流且只记录真实位移/失败；普通滚动诊断从 50ms 放宽到 500ms。
- 下一步：实机在工具调用和全屏切换期间观察计时器是否持续更新、窗口是否不再卡住。
# 2026-07-10 v2.14.112 ContextBar 浮层与 Git 详情解耦
## 当前目标
- 修复底栏模型按钮异常空隙、右侧栏展开时浮层被裁切，以及分支按钮强制打开右侧栏的问题。
## 已完成
- 模型容器取消无条件 `flex-1`，按内容宽度收缩并保留最大宽度，恢复与“已连接”之间的真实 8px sibling gap。
- 工作空间、套餐用量和模型浮层统一通过 `document.body` Portal 渲染，以触发按钮计算 fixed 坐标，并在 resize、滚动和触发器尺寸变化时重新定位及限制视口边界。
- Git 详情继续复用 `LongTaskInspectorPanel` 的单套数据和操作逻辑，但允许只挂载弹窗宿主而隐藏右侧栏主体；底部分支按钮不再修改右侧栏开关。
- 版本号三处同步到 v2.14.112。
## 验证
- `pnpm test:run` 通过：54 个测试文件、389 个测试全部通过。
- `pnpm build` 通过，renderer hash：`assets/index-jpASRLHj.js`。
- `pnpm knowledge:validate` 通过：7 个概念、15 个 Markdown、114 条链接。
- `git diff --check` 通过，仅有 LF/CRLF warning。
## 未完成
- 等待用户用 v2.14.112 截图复验普通宽度与右侧栏展开态下的按钮间距、三个浮层边界，以及分支按钮交互。
## 关键文件
- `src/components/chat/ContextBar.tsx`
- `src/components/layout/AppShell.tsx`
- `src/components/layout/LongTaskInspectorPanel.tsx`
## 下一步
- 用户实机截图确认普通宽度和右侧栏展开态；版本号须为 v2.14.112，再决定是否需要视觉微调。
# 2026-07-10 v2.14.113 左侧项目与会话列表密度优化
## 当前目标
- 在保留层级间距的前提下，收紧左侧项目、项目到会话、会话之间过大的历史留白。
## 已完成
- 项目 section 间距从 18px 调整为 6px。
- 项目标题到展开会话列表从 8px 调整为 4px。
- 会话 sibling 间距从 5px 调整为 2px。
- 保留项目行 36px、会话行 32px，不压缩文字和操作热区；版本号三处同步到 v2.14.113。
## 未完成
- 等待用户用 v2.14.113 截图复验折叠项目、单会话和多会话混排密度。
## 验证
- `pnpm test:run` 通过：54 个测试文件、389 个测试全部通过。
- `pnpm build` 通过，renderer hash：`assets/index-Bt1FhMnE.js`。
- `pnpm knowledge:validate` 通过：7 个概念、15 个 Markdown、115 条链接。
- `git diff --check` 通过，仅有 LF/CRLF warning。
## 关键文件
- `src/components/layout/Sidebar.tsx`
## 下一步
- 用户用 v2.14.113 截图确认后，再决定是否需要 1-2px 微调。
# 2026-07-10 v2.14.114 Kimi Web 长会话历史过程默认折叠
## 当前目标
- 降低长会话上下滚动卡顿，让 Web 模式只默认展开最新一轮过程，历史轮次保留正文但折叠过程。
## 已完成
- `ChatThread` 从完整轮次渲染结果中识别最后一个可展示过程的 Assistant，只向该轮传递默认展开信号。
- Kimi Web 历史轮次的思考、工具、子代理和审批过程列表保持未挂载，正文继续显示；用户点击过程摘要后仍可单独展开。
- 新一轮出现时，上一轮在布局提交前自动转为历史折叠态；用户手动展开稳定历史轮次后，普通流式重渲染不会强制关闭。
- Kimix 模式保持原有默认折叠行为；版本号三处同步到 v2.14.114。
## 未完成
- 等待用户用 v2.14.114 打开真实长会话，复验初始展开范围和滚动流畅度。
## 验证
- `pnpm test:run` 通过：54 个测试文件、389 个测试全部通过。
- `pnpm build` 通过，renderer hash：`assets/index-C6TLWwfs.js`。
- `pnpm knowledge:validate` 通过：7 个概念、15 个 Markdown、116 条链接。
- `git diff --check` 通过，仅有 LF/CRLF warning。
## 关键文件
- `src/components/chat/ChatThread.tsx`
- `src/components/chat/MessageBubble.tsx`
## 下一步
- 用户用 v2.14.114 实机复验后，再判断是否需要进一步虚拟化历史正文。
# 2026-07-10 v2.14.115 长会话顶部历史被静默截断修复
## 当前目标
- 修复 `session_b8c1f05f-2dbe-43c4-994e-32eaa2844da3` 滚到顶部后仍缺少更早内容、且没有继续加载入口的问题。
## 根因
- 该会话主 wire 文件约 7.4MB、4,614 行；`electron/sessionHistory.ts` 只保留最后 2,000 个可识别事件并直接删除最早事件。
- ChatThread 的 28 项渲染窗口只能折叠“已经进入 renderer 的历史”，无法恢复数据层已删除的早期轮次，因此会出现假顶部。
## 已完成
- 移除本地 wire 解析层的 2,000 事件静默截断，完整历史交给 ChatThread 的首屏窗口和“展开更早记录”控制渲染规模。
- 新增 2,105 条 wire 事件回归测试，验证第一条和最后一条均保留。
- 版本号三处同步到 v2.14.115。
## 未完成
- 等待用户用 v2.14.115 重开指定会话，确认顶部出现更早历史入口并能继续查看最初轮次。
## 验证
- 新增长历史回归测试通过：2,105 条事件完整保留首尾。
- `pnpm test:run` 通过：54 个测试文件、390 个测试全部通过。
- `pnpm build` 通过，renderer hash：`assets/index-CjAYba47.js`。
- `pnpm knowledge:validate` 通过：7 个概念、15 个 Markdown、117 条链接。
- `git diff --check` 通过，仅有 LF/CRLF warning。
## 关键文件
- `electron/sessionHistory.ts`
- `src/utils/__tests__/sessionHistory.test.ts`
## 下一步
- 用户用 v2.14.115 重开并复验指定 session 的最早历史。
# 2026-07-10 v2.14.116 底部分支按钮直接打开 Git 图谱
## 当前目标
- 点击 ContextBar 的当前分支按钮时直接显示 Git 图谱，不再进入提交详情弹窗，也不展开右侧会话侧栏。
## 已完成
- ContextBar 分支按钮改为发送独立的 Git 图谱打开请求，并补充明确的 title 与无障碍标签。
- AppShell 为 Git 图谱维护独立信号，可仅挂载既有 `LongTaskInspectorPanel` 弹窗宿主而隐藏侧栏主体。
- `LongTaskInspectorPanel` 复用原有图谱加载、刷新、分页与弹窗 UI，增加外部打开及关闭回调，没有复制 Git 数据读取逻辑。
- 版本号三处同步到 v2.14.116。
## 未完成
- 等待用户用 v2.14.116 点击底部 `master` 按钮，复验直接出现 Git 图谱且右侧栏保持原状态。
## 验证
- `pnpm test:run` 通过：54 个测试文件、390 个测试全部通过。
- `pnpm build` 通过，renderer hash：`assets/index-9uqbSkTo.js`。
- `pnpm knowledge:validate` 通过：7 个概念、15 个 Markdown、118 条链接。
- `git diff --check` 通过，仅有 LF/CRLF warning。
## 关键文件
- `src/components/chat/ContextBar.tsx`
- `src/components/layout/AppShell.tsx`
- `src/components/layout/LongTaskInspectorPanel.tsx`
## 下一步
- 用户实机复验 v2.14.116 的底部分支入口；右侧 Git 卡片的“详情”和“图谱”入口保持原语义。
# 2026-07-10 v2.14.117 Git 图谱首次直开永久加载修复
## 当前目标
- 修复从底部分支按钮首次挂载图谱宿主时，请求结果被丢弃并永久停在“正在读取 Git 图谱”的问题。
## 根因
- 外部图谱信号 effect 先发起请求，随后项目路径初始化 effect 递增请求代号；首个请求因此被判定为过期，结果与 loading 收尾均被忽略。
## 已完成
- 将项目路径重置与请求失效 effect 调整到外部 Git 详情/图谱信号 effect 之前，确保首次直开请求使用初始化后的有效代号。
- 同步覆盖 Git 详情的首次直开顺序，避免相同生命周期竞态。
- 版本号三处同步到 v2.14.117。
## 未完成
- 等待用户用 v2.14.117 实机确认图谱可正常加载。
## 验证
- `pnpm test:run` 通过：54 个测试文件、390 个测试全部通过。
- `pnpm build` 通过，renderer hash：`assets/index-COiBIsiW.js`。
- `pnpm knowledge:validate` 通过：7 个概念、15 个 Markdown、119 条链接。
- `git diff --check` 通过，仅有 LF/CRLF warning。
## 关键文件
- `src/components/layout/LongTaskInspectorPanel.tsx`
## 下一步
- 用户点击底部 `master`，确认图谱提交列表正常出现且关闭后可再次打开。
# 2026-07-10 v2.14.118 Git 图谱标签与提交描述布局优化
## 当前目标
- 避免 Git 分支/Tag 标签挤压提交描述，并解决常规标签自身被固定宽度截断的问题。
## 根因
- 引用标签与提交描述共用一个横向 flex 行，同时标签被硬限制为 92px；两者会竞争描述列宽度，标签和正文同时过早截断。
## 已完成
- 提交描述改为独占主信息行，保持单行截断和完整 tooltip。
- 引用标签移至独立的次要信息行，支持换行且取消 92px 固定上限；普通分支和版本标签可完整展示。
- 极端超长单个引用仍受描述列宽约束并提供自身 tooltip，避免撑破表格。
- 版本号三处同步到 v2.14.118。
## 未完成
- 等待用户用 v2.14.118 截图复验无标签、双标签和带隐藏计数的提交行。
## 验证
- `pnpm test:run` 通过：54 个测试文件、390 个测试全部通过。
- `pnpm build` 通过，renderer hash：`assets/index-Dczy1CDV.js`。
- `pnpm knowledge:validate` 通过：7 个概念、15 个 Markdown、120 条链接。
- `git diff --check` 通过，仅有 LF/CRLF warning。
## 关键文件
- `src/components/layout/LongTaskInspectorPanel.tsx`
## 下一步
- 用户确认两行信息层级和装饰提交行高度是否合适，再决定是否微调 4px 行间距。
# 2026-07-10 v2.14.119 Git 图谱引用标签全部展开
## 当前目标
- 利用独立可换行的标签行，取消 `+N` 汇总，直接展示提交的全部分支和 Tag 引用。
## 已完成
- 保留 HEAD、当前分支、远端分支、Tag 的既有优先级排序。
- 移除仅显示前两个标签及 `+N` 的前端压缩逻辑，完整渲染数据层返回的全部引用。
- 继续依赖数据层每个提交最多 8 个引用的上限，防止异常仓库产生无限标签行。
- 版本号三处同步到 v2.14.119。
## 未完成
- 等待用户用 v2.14.119 复验原 `+1` 位置已显示真实引用标签。
## 验证
- `pnpm test:run` 通过：54 个测试文件、390 个测试全部通过。
- `pnpm build` 通过，renderer hash：`assets/index-DGSWbbmg.js`。
- `pnpm knowledge:validate` 通过：7 个概念、15 个 Markdown、121 条链接。
- `git diff --check` 通过，仅有 LF/CRLF warning。
## 关键文件
- `src/components/layout/LongTaskInspectorPanel.tsx`
## 下一步
- 用户确认三项及更多引用在一行或自动换行后的视觉密度。
# 2026-07-10 v2.14.120 Kimi Web 工具行 hover 铺满卡片
## 当前目标
- 修复展开工具组内单条命令 hover 背景左右缩进、与卡片边界不一致的问题，并检查其他同类展开列表。
## 根因
- 工具列表外层承担 12px 水平 padding，导致子行的全宽 hover 和分隔线只能覆盖 padding 以内的内容宽度。
## 已完成
- 将工具列表外层改为仅保留上下留白，命令行本身铺满卡片可用宽度。
- 将原有 12px 水平留白移动到可交互行内部，图标、文字和右侧状态位置保持不变。
- 展开后的命令详情同步补偿左右 padding，保持原有内容起点并补齐右侧留白。
- 核查同文件的子代理、审批和旧版 ToolCard：子代理与 ToolCard 已是全宽交互行；审批子行不可交互且无 hover，不做无关改动。
- 版本号三处同步到 v2.14.120。
## 未完成
- 等待用户用 v2.14.120 复验工具行 hover 与分隔线是否自然贴合卡片边界。
## 验证
- `pnpm test:run` 通过：54 个测试文件、390 个测试全部通过。
- `pnpm build` 通过，renderer hash：`assets/index-DoRPRvqJ.js`。
- `pnpm knowledge:validate` 通过：7 个概念、15 个 Markdown、122 条链接。
- `git diff --check` 通过，仅有 LF/CRLF warning。
## 关键文件
- `src/components/chat/MessageBubble.tsx`
## 下一步
- 用户分别悬停折叠和展开状态下的工具命令行，确认内容对齐不变且 hover 横向铺满。
# 2026-07-10 v2.14.121 官方思考历史统一纠错
## 当前目标
- 根除本地缓存中的思考正文重复、列表换行丢失或段落粘连在当前会话中继续显示的问题。
## 根因
- v2.14.108 的官方思考修复只覆盖后台迁移；当前会话恢复和运行中快照仍仅比较正文长度、正文差异或过程事件数量，正文与工具数量相同时会继续保留损坏的 thinking 缓存。
## 已完成
- 抽取统一的 `shouldReplaceWithCanonicalKimiHistory` 判断，同时比较正文、图片、Markdown 完整性、过程事件和思考正文。
- 后台缓存迁移、当前会话首次恢复、运行中安静期快照对账三条路径全部复用该判断。
- Kimi 历史缓存版本升级到 3，强制旧缓存重新接受官方历史纠错。
- 新增取自本次问题的中文物品列表回归场景，覆盖正文与工具数量不变但 `\n- ` 被粘连的情况。
- 版本号三处同步到 v2.14.121。
## 未完成
- 等待用户用 v2.14.121 在目标会话重新触发官方历史同步，复验列表换行和段落结构。
## 验证
- `pnpm exec vitest run src/utils/__tests__/kimiHistoryCache.test.ts` 通过：1 个测试文件、6 个测试。
- `pnpm test:run` 通过：54 个测试文件、392 个测试全部通过。
- `pnpm build` 通过，renderer hash：`assets/index-BcBckMON.js`。
- `pnpm knowledge:validate` 通过：7 个概念、15 个 Markdown、123 条链接。
- `git diff --check` 通过，仅有 LF/CRLF warning。
## 关键文件
- `src/App.tsx`
- `src/utils/kimiHistoryCache.ts`
- `src/utils/__tests__/kimiHistoryCache.test.ts`
## 下一步
- 完整验证后启动 v2.14.121，重新打开目标会话；缓存版本 3 应使用官方 wire 中保留换行的 thinking 替换本地粘连版本。
