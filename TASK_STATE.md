# Kimix 长程任务状态

## 2026-09-03 审查：0.39.0 → 0.40.1 跟进质量复核与收尾修复（无版本 bump）

- 审查结论：0.40.1 确为上游最新；逐条核对 0.39.1/0.40.0/0.40.1 changelog，需 Kimix 配合的变化（危险命令审批 #3290、配置原子保存 #3348、Tower base #3346/#3399、suggestFiles）均已落地，无版本遗漏；typecheck + 全量 2130 测试通过。
- 本轮修复（文档/注释级，不影响产物，未递增版本）：清理 kimiCodeHost.ts resumeSession 处描述已删除的 yolo auto-approve guard 的过时注释；knowledge/log.md 追加澄清条目，声明旧的 `yolo=自动通过` 措辞约束已被 v2.21.164 的两段式文案取代；kimi-code-subagent-model-pool.md 补记 env 注入会压过 config.toml 显式关闭的托管策略；新增 docs/release-notes/v2.21.167.md 覆盖 163–167 五版变动（均未打 tag，按发布流程从上个实际发布版本算起）。
- 已知边界（记录在案，暂不修）：Tower 预检→开启存在 TOCTOU 小窗口，base 以预检时分支为准；原子写入 rename 失败时原始系统错误直抛；官方 suggestFiles 返回空数组时静默落到本地搜索结果；上游 #3377 transcript 去重修复对 Kimix 的影响建议实机抽验。
- 测试债务：kimiApprovalPolicy.test.ts 与 tower.test.ts 新增部分为源码 grep 边界测试，缺"yolo 审批 → ApprovalCard"端到端行为测试与 searchKimiCodeSessionFiles 路由单测。

## 2026-09-03 对齐：SDK fallback 接入 0.40 文件建议（v2.21.167）

- 差异：Composer 的 `@文件` 搜索已优先使用官方 Server `fs:search`，但会话落在 vendored SDK 时直接退回 Kimix 本地递归搜索，没有使用 0.40 / SDK 0.20 新增的 `suggestFiles(workDir, { query, limit })`。
- 修复：统一会话文件搜索入口；Server 会话继续走 Server，SDK 会话改走官方 `suggestFiles`，旧 SDK/v1 返回 undefined 时仍使用现有本地兜底。两条路径都校验会话工作目录并只投影 file 行。
- 回归：新增统一结果规范化测试，覆盖目录项、畸形项和能力缺失；vendor 契约继续锁定 v2 暴露、v1 缺失的边界。

## 2026-09-03 对齐：Kimi Code 0.40 Tower 基础分支与恢复回归（v2.21.166）

- 差异：0.40 的 `setTowerMode(enabled, base)` 与 Server profile `tower_base` 已支持显式基础分支，但 Kimix 仍只传布尔值；同时预检弹窗沿用 0.39 文案，错误声称 dirty checkout 不会进入任务分支。
- 修复：开启时主进程以预检确认的当前分支作为 base，SDK 与 Server 两条链路统一转发；关闭时跳过启用预检且不携带旧 base，避免仓库状态变化后反而无法退出。dirty 文案更新为 0.40 的真实行为：首次 spawn 会创建基础快照，主 checkout 中与待合并文件重叠的改动会让 TowerMerge 拒绝合并。
- 回归：锁定 Server profile patch、主进程预检 base 转发、SDK 调用签名和 dirty 文案；同时重跑旧会话 idle 收敛、快照恢复、官方/本地 prompt 队列、压缩事件映射与 Tower 测试组。

## 2026-09-03 修复：Kimi config.toml 改为原子替换（v2.21.165）

- 根因：Kimix 的 TOML fallback 写入虽有读后比较保护，但最终使用 `writeFileSync(configPath, ...)` 直接截断目标文件；Kimi daemon 的文件监控可能在截断与写完之间读到空文件或半文件，正是 0.40 上游配置监控修复所规避的瞬态。
- 修复：写入改为同目录唯一临时文件，落盘并 `fsync` 后再次比较目标原文，最后 `rename` 原子替换；任意失败都会清理临时文件，原有外部修改冲突提示保持不变。
- 边界：现有调用方的 `.bak` 备份策略不变；原子替换只覆盖所有经 `writeKimiConfigTomlIfUnchanged` 的 `config.toml` fallback 路径，不扩大到无关 JSON 缓存。
- 回归：验证成功路径实际经过 rename；冲突路径保留外部内容；rename 失败保留旧文件且无 `.tmp` 残留。

## 2026-09-03 修复：YOLO 强制审批被 Kimix 二次放行（v2.21.164）

- 根因：官方运行时会在 YOLO 模式内部自动批准普通工具，但危险命令、无法安全分析的命令或敏感操作仍会把强制审批请求交给宿主；Kimix 的 Server 与 SDK 接入层又按会话 `yolo` 状态无条件批准了所有到达宿主的请求，绕过了 0.40 的安全护栏。
- 修复：两条运行时路径均把实际到达宿主的审批请求视为上游强制询问并展示 ApprovalCard；普通 YOLO 工具仍由官方运行时内部自动批准，不增加日常打断。
- 文案：Composer、设置页与 Room Agent 创建弹窗明确区分“普通工具自动批”和“危险/敏感操作仍确认”。
- 回归：新增源码边界测试，锁定 Server 不得直接 `resolveApproval`、SDK 不得从回调直接返回 approved。

## 2026-09-03 更新：内置 Kimi Code 运行时升级至 0.40.1（v2.21.163）

- 基线：vendored fallback 从官方 `@moonshot-ai/kimi-code@0.39.0` / Node SDK `0.19.2` 升级至 `0.40.1` / SDK `0.20.0`，固定上游提交 `0d45dddc57510e6b1306dd12c0b0703c37b8c63a`。
- 覆盖边界：继续只保留 Kimix 的 MCP 启动超时 4 秒 overlay；新 SDK 原生带入危险命令审批、Tower checkout/merge 修正、配置监控稳健性与 `suggestFiles(workDir, { query, limit })`。
- 兼容性：vendor 契约测试同步至 `setTowerMode(enabled, base)` 和 `suggestFiles`；现有 Server 优先、vendored SDK fallback 的路由不变。
- 验证：vendor 契约 16 项通过；真实 fallback host 的 Prompt、Steer、Cancel 探针通过。

## 2026-08-31 修复：文件变更卡片底部黑线（v2.21.162）

- 现象：文件超过三项并折叠时，底部「再显示 N 个文件」行在部分自定义风格、尤其悬停状态下出现一条突兀黑线。
- 根因：该按钮已经是卡片最后一行，却额外携带 `border-b border-border-subtle`；自定义风格的 `.kimix-muted-action:hover` 交互桥接会重写边框颜色，使这条本无结构意义的末行分隔线随 control hover 边框加深。卡片外壳自身已有完整边界，错误不是 sectionCard shadow。
- 修复：移除末行按钮的底边及 hover 透明覆盖技巧；有错误内容跟随时，错误块自身的 `border-t` 继续负责真实分隔。新增四文件折叠 DOM 回归，确保末行操作不再声明 divider。
- 实机取证：`custom:win11-fluent-light` 下强制 hover 前按钮 bottom border 为 `1px #CDCECA`，hover 后变为 `1px #777876`；卡片 outer border 始终为 `1px #CDCECA`、shadow 为 none。
- 验证：定向、typecheck、全量测试、知识校验、构建与实机 computed style 见收尾。

## 2026-08-31 修复：自定义风格同排同级控件几何专项收敛（v2.21.161）

- 扫描范围：复核 UI Style v1 的 control/toggle/compoundControl/menuTrigger/roomChoice/field/primaryAction radius consumers，以及全部 state/control/split/room 角色和 `aria-expanded` 触点。
- 确认遗漏：control 展开时误从 control radius 跳为 menuTrigger radius；顶部启动/打开 split control 与同行 toolbar control 分别消费 compound/control radius；Add/Edit Room Agent footer 的取消与主操作分别消费 compound/primary radius；添加 MCP 表单的 OAuth 状态字段与同级输入字段分别消费 toggle/field radius。
- 修复：保留各角色的边框、背景、阴影和状态矩阵，只用局部几何标记让同行控件分别对齐 control、primaryAction 或 field radius；顶部 split 内部 part 由外壳统一裁切，不再保留另一套子圆角。
- 排除：FileCard 独立 split、弹层 Swarm/Tower 垂直配置项、同角色选择组、独立 header action、Composer 圆形发送/停止按钮均有明确结构或层级语义，不做全局圆角抹平。
- 验证：定向、typecheck、全量测试、知识校验、构建与实机 computed style 见收尾。

## 2026-08-31 修复：Composer 模式按钮自定义风格圆角与同行不一致（v2.21.160）

- 现象：启用允许 toggle 使用胶囊圆角的自定义界面风格后，Composer 同排的 Swarm、Plan、Tower 呈 999px 圆角，而思考强度按钮呈 4px 圆角，工具行出现两套轮廓。
- 根因：三个模式按钮正确使用 `.kimix-state-button` 获取 toggle 的完整状态材质，但也无差别消费了 `--ui-role-toggle-radius`；思考强度属于普通 control，消费 `--ui-role-control-radius`。该自定义风格恰好把两者配置为 999px 与 4px，暴露了状态语义与同行几何被同一角色绑定的问题。
- 修复：为工具行内三个模式按钮增加局部 `.kimix-composer-mode-button` 几何角色，仅在自定义契约下把圆角切到 control radius；边框、背景、阴影、颜色和 `aria-pressed` 选中态仍全部由 toggle 状态矩阵负责。弹层与设置页 toggle 不受影响。
- 验证：定向 UI Style 回归 52 项和 typecheck 已通过；全量测试、知识校验、构建与实机 computed style 见收尾。

## 2026-08-31 修复：旧会话重开后误显示数百分钟“执行中”（v2.21.159）

- 现象：已于前一日结束的会话，重开 Kimix 后仍显示 `执行中 913分+`，时间持续增长。
- 根因：Server 新绑定继承上一进程的旧 `running`，首次 fresh REST `idle` 未覆盖 managed status；恢复快照把历史 tool/body 再投影成活动事件，而 renderer 的 idle 分支与 Sidebar 历史路径都未完整收敛最终本地事件。残留 `assistant.isComplete=false` 触发 MessageBubble 从旧事件时间戳持续计时。
- 修复：首次 fresh status 覆盖旧 managed status（不影响进程内 continuation grace）；恢复 idle 清除 transient activity 且不触发旧会话完成通知/队列派发；Sidebar 缓存与 canonical 合并路径均在最终事件集上按 fresh runtime 终态 guarded settle。
- 取证：`docs/issue-stale-running-session-events-snapshot.md` 保存官方 `TurnEnd/end_turn`、runtime `idle`、UI 回放未完成事件及 54,782,642ms 精确对应截图的事件快照。
- 验证：定向回归、typecheck、全量测试、构建见收尾。

## 2026-08-30 修复：重启后重复弹「界面风格已导入」提示（v2.21.158）

- 现象：每次重新进入软件都会再弹一次风格已导入/已更新提示。
- 根因：useUiStyleInboxSync 启动扫描与 useBootstrap 的 getSettings 水合存在竞态。水合完成前 store 里的 customUiStyles 只是首绘快照（只含当前活动风格），扫描先到时把收件箱里早已导入的风格误判为新 id → 重复 upsert + 弹 toast，且 upsert 路径会自动启用，可能劫持用户当前风格选择；随之而来的 customUiStyles 变化还会触发 useSettingsSync 用残量列表回写设置。
- 修复：AppState 新增 settingsHydrated 标志，useBootstrap 在 getSettings 落定后（含失败兜底 finally）置位；useUiStyleInboxSync 的启动扫描与广播订阅统一等水合完成后再挂，水合前的文件事件由扫描兜底覆盖。
- 验证：typecheck、全量、构建见收尾。


## 2026-08-30 修复：设置页选项行角色归一 + 风格提示词补对比度硬约束（v2.21.157）

- 问题 1：设置页「关闭上下文缓存过期提示」用 kimix-settings-card 独立卡片外壳，与兄弟选项行（kimix-settings-permission）角色不同源，自定义风格下呈现灰底分段块与白色浮起卡两种差异极大的样式。
- 修复：该行改为与兄弟完全一致的 permission 行结构（kimix-settings-permissions 容器 + is-active 按钮 + SelectionIndicator + BellOff 图标 + permission-copy），纳入同一角色，四套内置风格与自定义契约层下自动一致。
- 问题 2：自定义风格化对界面对比度不重视，容器层级与选中态经常难以分辨。
- 修复：buildUiStyleAiPrompt 新增第 16/17 条硬性要求（对比度是硬指标：surface 与文字/主色明度差、容器层级必须肉眼可分辨、禁止全容器同 surface 且 border 全 none；状态反馈必须可感知：selected 一眼可辨、subtle 边框不得淡到近乎消失），原 16/17/18 顺延为 18/19/20（收件箱/回退两分支同步改号）。
- 验证：typecheck、uiStyleContract 定向 19 项通过；全量与构建见收尾。


## 2026-08-30 修复：本地斜杠命令发送后输入框残留（v2.21.156）

- 现象：v2.21.155 实机发送 /自定义风格 后输入框仍残留命令文本（截图可见「消息发送中 3秒」仍在派发）。
- 根因：local 斜杠命令是 handleSend 里唯一「先 await 整个命令链路（收件箱 IPC → ensureSession 建会话 → 发送派发）再清空输入框」的分支；skill/plugin/排队分支全部先清空再执行。慢链路期间原文一直残留，链路抛异常时甚至永不清空。
- 修复：两个 local 命令入口（活动轮拦截、主 slashHandled 路径）都改为先 setInput("") 再 await handleSdkSlashCommand，与兄弟分支模式一致；发送内容已从 trimmed 捕获，不受影响。
- 验证：typecheck、全量、构建见收尾。实机待用户验收。


## 2026-08-30 功能：界面风格收件箱自动导入（v2.21.155）

- 需求：提示词与 /自定义风格 命令引导 agent 把生成的 UI Style JSON 直接写到正确位置，Kimix 自动解锁（导入并启用），不再手动导入。
- 实现：新增收件箱目录 `~/.kimix/ui-styles/`（electron/uiStyleInbox.ts：扫描/按 id 删除/fs.watch 监听 600ms 防抖，内容指纹去重）；主进程 3 个 IPC（getUiStyleInboxDir/scanUiStyleInbox/deleteUiStyleInboxFile）+ `kimix:ui-style-inbox` 广播；渲染端 `useUiStyleInboxSync`（App.tsx 挂载）：新 id → upsertCustomUiStyle（与手动导入一致，自动启用），已有 id 内容变化 → 仅更新文档不劫持启用选择；启动时兜底扫描一次。buildUiStyleAiPrompt(inboxDir?) 第 16/17 条改为引导写入收件箱绝对路径；设置页「复制 AI 提示」与 /自定义风格 共用。删除自定义风格时同步清理收件箱文件防止复活。
- 验证：typecheck、定向 27 项（收件箱 5 + uiStyleContract 19 + palette 3）通过；全量与构建见收尾。


## 2026-08-30 修复：/自定义风格 双气泡与输入框残留（v2.21.154）

- 现象：选中模板命令发送后，①输入框残留完整命令文本且补全面板仍开；②对话流里同一轮被拆成两个用户气泡（命令文本 + 完整提示词）。
- 根因 2（双气泡）：handler 用发散模式——可见消息=命令文本（appendSlashUserMessage），实际发送=outboundContent 完整提示词。官方 Server 回放 canonical 用户消息（完整提示词）时与本地命令气泡内容不一致，echo 去重失败，提示词被追加为第二个用户气泡。修复：去掉发散，直接 sendPromptContent(完整提示词)（默认 addUserEvent:true，可见=发送，与手动粘贴提示词效果一致）。
- 根因 1（残留）：活动轮次中 handleSend 走排队分支，本地斜杠命令被**原样**存进 pending 队列；drain 时不解释命令会当普通文本发出，用户点「编辑」回补时命令文本重新填进输入框并触发补全面板。修复：排队分支前拦截 classifySlashCommand==="local" 的命令直接走 handleSdkSlashCommand；/自定义风格 发送遇活动轮冲突时 sendPromptContent 兜底把完整提示词回补队列（内容正确）。
- 边界：官方命令（/compact 等 direct/skill 路由）在活动轮中仍按原样排队，属既有行为未改动。
- 验证：typecheck、slashRouting 定向 9 项、全量 195 文件 2113 项通过；生产构建见当轮收尾。实机双气泡/残留修复待用户截图验收。


## 2026-08-30 修正：/自定义风格 需求模板文案不再只提色彩（v2.21.153）

- 用户反馈：默认模板「做一套低饱和莫兰迪色系风格」只提色系，易误导用户以为只能改色彩。
- 修正：模板改为「做一套低饱和、大圆角卡片质感的界面风格」，detail 补「形状/质感/色彩都可定制」（UI Style v1 实际覆盖圆角/边框/浮雕层次/控件状态/三色 palette）。
- 验证：typecheck、全量 2113 项、生产构建通过。

## 2026-08-30 修复：runtime 会话下本地斜杠命令从补全列表消失（v2.21.152）

- 现象：用户输入 /自定义 补全面板只显示 /custom-theme 等官方命令，/自定义风格 不出现（v2.21.150 截图实证）。
- 根因：有 runtime 会话时 `setSlashCommands(res.data.map(...))` 用官方 Server 命令列表**整体替换**本地列表，`slashCompletionSource` 优先取 slashCommands，导致全部 Kimix 本地命令（/theme /settings /自定义风格 等）从补全消失（命令本身仍可执行，只是无联想）。
- 修复：官方命令优先展示，conservativeSlashCommandItems 按 commandName 去重后追加合并；findOfficialPluginCommand 只匹配 kind==="plugin-command"，不受合并影响。
- 验证：typecheck、全量 195 文件 2113 项、生产构建通过。实机补全列表待用户验收。

## 2026-08-30 功能：新建会话后侧栏自动定位居中（v2.21.151）

- 需求：侧栏「在该项目下新对话」创建会话后，左侧应定位到该项目的这个会话，尽量在会话列表中居中。
- 实现：`createSessionForProject` 落位后 80ms 对 `[data-session-id]` 行 `scrollIntoView({ behavior: "smooth", block: "center" })`（对齐 ContextBar 既有模式）；会话行新增 `data-session-id` 属性。列表折叠窗口既有「当前会话在折叠区外自动展开」保护（sidebarSessionList），新建会话设为 current 必定渲染，无需额外展开逻辑。
- 覆盖面：createSessionForProject 是所有新建入口（侧栏项目按钮、顶部新对话、EmptyState 等）的共用函数，均受益。
- 验证：typecheck、layout+sidebarSessionList 定向 15 项、全量 195 文件 2113 项、生产构建通过。实机滚动效果待用户截图验收。

## 2026-08-30 功能：新增本地斜杠命令 /自定义风格（v2.21.150）

- 需求：斜杠命令应直接发送「自定义风格化」的提示词（用户纠正：第一版做成打开设置页，太敷衍，已重写）。
- 实现：
  - `slashRouting.ts`：`slashCommandPattern` 名称字符类扩展 CJK（`一-鿿`），`KIMIX_LOCAL_SLASH_COMMANDS` 注册「自定义风格」（local 路由）。ASCII 命令行为不变，`/路径/x` 含斜杠输入仍不命中。
  - `Composer.tsx`：`handleSdkSlashCommand` 新分支直接调用 `buildUiStyleAiPrompt()`（与设置页「复制 AI 提示」同一份提示词，内容与效果一致），经 `sendPromptContent` 的 `outboundContent` 发送；可见用户消息只显示命令本身（沿用 goal kickoff 同款模式）；`/自定义风格 <需求>` 的 args 以「我的风格需求：…」追加在提示词后。补全项含基础项与带需求模板项，insertText 带尾随空格引导补需求；/help「其他」行补记。
- 验证：typecheck、slashRouting 定向 9 项、全量 195 文件 2113 项、生产构建通过。实机验收待用户截图。


## 2026-08-30 功能：通知信封卡片对齐官方来源署名（v2.21.148）

- 用户要求：参考官方 Kimi Code Web，非用户发的消息（后台任务/子代理完成等通知）上方必须注明来源信息，如「子代理完成 · agent-4」。
- 官方逻辑（bundle 0.39.1 实证）：仅 origin.kind 为 task/background_task/task_notification 且携带 <notification> XML（或 kimiWeb.taskNotification 缓存对象）的 role=user 消息走 NotificationCard；来源头固定为「{kind}{状态} · {id}」，kind 按 source_kind 区分 子代理/后台任务，id 子代理取 agentId、其余取 sourceId；状态按 type 后缀识别 completed/failed/timed_out/killed/lost（兜底 info）；卡片体含 Title、正文、<output-file> 输出文件行（路径+字节数+复制路径）、原始 payload 折叠。cron-fire/goal 续跑/injection/skill_activation 各有独立渲染或丢弃路径，不走通知卡。
- 我方改动（在既有折叠卡设计上对齐，卡片仍默认折叠、外观不变）：
  - parseKimiAgentEnvelope：来源名按 source_kind 区分（摘要出现「子代理已完成：…」），状态识别从精确等值 task.completed/task.lost 改为 endsWith 后缀（补齐 failed/timed_out/killed 三态，warning 色调）；新增解析 <output-file path bytes> 到 detail.outputFile。
  - NotificationCard：头部标题改为官方格式「子代理完成 · agent-4」/「后台任务完成 · bash-bv5pc30f」/「定时任务触发 · jobId」；状态文案与图标补齐 超时(Clock)/被终止(CircleStop)；展开详情新增输出文件行（路径 rtl 截断 + 字节数 + 复制路径按钮，已复制反馈）。
  - sessionMetrics 的 isNotificationSummaryMessage 从前缀数组改正则，覆盖 子代理/后台任务 × 全部状态后缀。
- 验证：typecheck、定向 9 文件 463 项（含新增 6 条用例）、全量 195 文件 2112 项、生产构建通过；uiStyles 治理（新按钮声明 kimix-style-exempt）通过。实机截图验收待用户回传。
- 已知边界：官方 cron-fire 渲染为独立 role:cron 消息（显示 prompt 全文），Kimix 保留自有「定时任务触发」折叠卡，属刻意差异；官方 output-preview 预览未接入（信封里未见实际产出）。

## 2026-08-30 修复：压缩摘要重复显示为用户气泡（对齐官方）（v2.21.147）

- 现象：压缩后同一时间线出现两块相同内容——用户消息气泡里是摘要全文，「上下文压缩完成」卡片里又是同一摘要。
- 官方逻辑（bundle 0.39.1 实证）：SDK 把 `context.apply_compaction` 的摘要物化为 `role:"user"` + `origin:{kind:"compaction_summary"}` 的合成消息；官方 Web 历史映射层先判 `metadata.origin.kind === "compaction_summary"`，命中即映射为 `role:"compaction"` 的 compact-divider 分隔行（「上下文已压缩」，摘要只在侧边面板查看），**绝不进用户气泡分支**。
- 我方根因：两个 TurnBegin 映射器（`eventMapper.ts` wire/host、`kimiCodeEventMapper.ts` server 快照）对所有 role=user 带文本消息一律渲染用户气泡，没有 compaction_summary origin 判定。
- 修复：两个映射器把该 origin 映射为带摘要的 compaction end 事件（server 路径用 `compaction:{snapshotMessageId}` 稳定 id），摘要落到既有压缩卡片；相邻重复卡片由 `normalizeCompactionDisplay` 簇归一去重（优先带摘要者）。卡片本身保留 Kimix 既有设计（内联展开），未改成官方分隔线+侧面板。
- 已知边界：修复前已持久化的旧会话时间线里的摘要气泡不会回溯清除，待该会话下次被官方历史替换后消失；SDK 路由 wire 不含摘要消息，本修复主要作用于 Server 快照与实时流。
- 验证：typecheck、定向 3 文件 326 项（含新增 3 条映射用例）、全量 2108 项、生产构建通过；知识库新增 /references/kimi-code-web-compaction-display.md 并通过严格校验。

## 2026-08-30 修复：缓存过期弹窗「开启新会话」发回旧会话 + 间距与「暂不发送」（v2.21.146）

- 根因（发回旧会话）：`handleCacheHintAction` 的 new-session 分支 `await createSession()` 后调用 `sendPromptContent`，后者经 `ensureSession()` 读的是**渲染闭包**里的 `currentSession`（zustand 已切换、闭包未更新），消息被发回旧会话；旧会话上下文超限触发 SDK 自动压缩，表现为「先压缩再发送到旧会话」。修复：`ensureSession()` 改读 `useAppStore.getState().currentSession` 现值（7 个调用点语义均为「当前会话」，读现值严格更正确）。
- 附带修复：弹窗命中时 `handleSend` 提前 return 未清输入框，发送类动作（直接发送/开启新会话/压缩并继续/不再询问）执行前先 `setInput("")` + 清空附件，避免草稿残留导致同内容二次发送；压缩失败的草稿恢复路径不受影响（prev 为空时回填 dialog.content）。
- 新功能：新增「暂不发送」动作（`CacheHintDialogAction` 加 `"hold"`），只关闭弹窗，输入框草稿原样保留。
- 间距：弹窗内 `mt-3`/`mt-5` Tailwind spacing 类按规则改 inline style（描述 14px、提示卡 16px、按钮行 20px、gap 10）；按钮顺序：不再询问 / 暂不发送 / 直接发送 / 开启新会话 / 压缩并继续。
- 验证：typecheck、定向 chat 15 文件 138 项 + cacheHint、全量 195 文件 2105 项、生产构建通过。Composer 发送流无既有测试夹具，未新增单测；弹窗实机交互待用户验收。

## 2026-08-30 功能：模型列表按添加顺序从老到新排列（v2.21.145）

- 用户要求：设置 → 模型与供应商的模型列表按添加时间从老到新，新添加的模型在下方。
- 根因：排序发生在两层——electron 汇总层（`readKimiModelConfig`、`kimiCodeConfigToModelSummary`、`mergeRuntimeAndDiskModelConfig`）按「默认优先 + 别名字母序」重排；渲染层 `groupModelsByProvider` 再按别名排序，插入顺序在到达 UI 前已被销毁。
- 实证：`config.toml` 的 `[models.*]` 段落顺序即添加顺序（千问 provider：qwen3.8-max 在 158 行先添加、qwen3.8-flash 在 206 行后添加，但 UI 按字母序把 flash 显示在上），SDK/TOML 写入均为末尾追加，保留文件顺序即得老→新。
- 修复：三处汇总排序与渲染层别名排序全部移除，全程保持插入顺序；`mergeRuntimeAndDiskModelConfig` 的 Map 语义保证受管模型按 SDK 配置顺序在前、第三方模型按 config.toml 书写顺序在后。
- 影响面：模型选择下拉（ContextBar、AddRoomAgentDialog）同步变为添加顺序，默认模型不再置顶（列表内有「默认」徽章标识）；`handleTestProvider` 的连接测试回退模型变为最老模型。
- 测试更新：`modelProviderConfig.test.ts` 原用例「切换默认模型时保持模型列表位置不变」锁定的是别名排序，改为锁定「保持插入顺序 + 切换默认位置不变」的原始意图。
- 验证：typecheck、定向 2 文件 25 项 + 设置 6 文件 41 项、全量 195 文件 2105 项、生产构建通过；运行实例 DOM 实测未做（用户已安装的 Kimix.exe 持有单实例锁，dev 实例无法同机共存），待用户截图验收。

## 2026-08-28 修正：「默认」按钮悬停改为 accent 预览态（v2.21.144）

- 上一轮（v2.21.143）移除内联透明背景后用户仍反馈"看不出变化"。实测根因：win11-fluent 下 `--surface-hover`、模型行 hover 底、control 角色 hover 底三者同为 #EDEEEB，按钮 hover 融进已 hover 的行里；且 hover 边框色仍被内联 `borderColor: transparent` 挡住。
- 修复：按钮加专属类 `.kimix-model-default-action`，悬停预览选中态（accent-primary-light 底 + accent-soft 边 + accent-dark 字，`!important` 压过契约 control hover 规则，排除已选中态）；className 里冗余的 `hover:bg-surface-hover` 移除。
- 验证手法：CDP `CSS.forcePseudoState` 同时强制行+按钮 hover 模拟真实悬停，计算样式 bg rgb(230,240,249)/border 1px accent 蓝；`Page.captureScreenshot` 截图实证按钮蓝底与灰行对比清晰。注意 forcePseudoState 在 ws 断开后失效，截图须在连接存活期内用 CDP 自带截图完成。
- 验证：typecheck、定向 6 文件 41 项、全量测试、生产构建。

## 2026-08-28 修正：模型行「默认」按钮悬停无反馈（v2.21.143）

- 根因：非默认态内联 `backgroundColor: "transparent"` 压过一切 class hover 规则（`.kimix-icon-text-button:hover` 与自定义风格 control 角色 hover），悬停零反馈。
- 修复：非默认态不再内联背景（改为 undefined），静止仍透明（win11-fluent control resting 实测 transparent），悬停吃到角色 hover 背景 #EDEEEB；默认选中态的内联 accent 样式保留，悬停不被覆盖。
- 验证手法：CDP `CSS.forcePseudoState` 强制 hover 实测计算样式；注意按钮有 background-color transition，强制后须等约 600ms 再读，否则读到过渡初值误判"没生效"。
- 验证：typecheck、定向 6 文件 41 项、全量测试、生产构建。

## 2026-08-28 修正：自定义风格下模型页侧栏圆角错位（v2.21.142）

- 根因：用户启用自定义风格 `custom:win11-fluent-light`（`data-ui-style-contract="v1"` 生效），契约层 inspector 角色规则把 `.kimix-model-provider-sidebar` 当独立检查器卡，给了 12px 圆角+完整四边边框+阴影；但它实际是管理器卡（8px 圆角+overflow:hidden）内的平铺窗格，形成双层边框与圆角错位月牙缝。v2.21.141 只改了内置默认风格下的外卡圆角，未触及契约层，故用户截图"还是不一致"。
- 修复：`src/index.css` 契约 inspector 组移除 `.kimix-model-provider-sidebar`（保留 longtask-inspector/diff-panel），侧栏回落基础平铺规则（仅右分隔线、surface-base 背景、由外卡裁切圆角）；`uiStyleContract.ts` inspector 角色描述同步。
- 验证手法（可复用）：未打包实例默认开 CDP 9222（`electron/main.ts:8774`），用 Runtime.evaluate 读 computed style 实测：sidebar radius 12px→0px、box-shadow→none、仅余 1px 右分隔线；截图确认四角与外卡一致。
- 已知边界：自定义风格不再能通过 inspector 角色给供应商侧栏单独配背景/边框（现为平铺窗格）；如后续需要可为侧栏单设角色变量。
- 验证：typecheck、定向 2 文件 51 项、全量测试、生产构建。

## 2026-08-28 修正：模型页圆角统一 + 侧栏底部切换按钮完全对齐（v2.21.141）

- 圆角：模型与供应商页外卡 `.kimix-model-provider-manager` 从 `--radius-md`(12px) 改为 `--radius-sm`(6px)，与设置页通用卡 `.kimix-settings-card`、消息条、模型行一致；管理器内层背景块固定 `rounded-xl`(12px，不吃风格 token) 改为 `rounded-sm-token`。
- 对齐：对话页「设置」按钮的 `pb-2`/`px-2 pt-2`/`gap-3` 等 Tailwind spacing 类在本项目有静默不生成前科（Sidebar.tsx:898 注释即此案），全部改 inline style；两侧按钮几何确定且一致：左 20、右 W-14、底 18、高 36、gap 12，同类名同结构。
- 验证：定向 10 文件 83 项、typecheck；全量测试与构建见本轮收尾。

## 2026-08-28 修正：两条顶栏统一收缩（v2.21.140）

- 顶部菜单栏 48 → 40px（AppShell grid 行 + TopMenuBar `h-12`→`h-10`）；页面级工具栏 56 → 48px（对话页 SessionToolbar `h-14`→`h-12`，设置/Hooks/插件/Skills 共用 `.kimix-workspace-header` 56→48px）。
- 知识库 `project/kimix.md` 的 shell 轨道描述同步为 40px；右侧面板/弹窗的 h-14 头部不属于页面顶栏，未动。
- 验证：知识库严格校验、typecheck、全量测试、生产构建。

## 2026-08-28 修正：设置侧栏「返回对话」移到底部与对话页「设置」同位（v2.21.139）

- 目标：设置页与对话页通过同一物理位置的按钮互相切换。
- 改动：展开态设置侧栏头部的返回按钮移除（头部仅留「设置」标题），底部版本条替换为与对话页设置按钮同结构的整宽 `kimix-settings-entry` 按钮（左 20px、底 18px、高 36px，右侧保留版本号）；折叠态返回箭头移到 `marginTop:auto` 底部槽位，侧栏底边距对齐对话页 18px。清理 `kimix-settings-sidebar-back` / `kimix-settings-sidebar-version` 死样式。
- 验证：定向 2 文件 14 项、全量测试、typecheck、生产构建。

## 2026-08-28 修正：供应商删除按钮移至头部行右端（v2.21.138）

- 模型与供应商编辑区的「删除供应商」按钮从底部操作行（测试/保存供应商旁）移到头部「凭据就绪」胶囊右侧，仅第三方供应商（非内置、非新建态）显示；交互与确认弹窗不变。
- 验证：定向 ModelProviderManager 17 项、全量测试、Node/Renderer typecheck、生产构建。

## 2026-08-28 功能：消息自动折叠开关（v2.21.137）

- 参考官方 Kimi Code web 0.39.1（本机缓存 bundle）：`kimi-web.turn-folding` 开关默认关、回合结束时把最后一条非空正文之前的过程块折叠为「已工作 X」条；官方另有 `activityRunFolding`（工具调用汇总，默认开），Kimix 已有连续工具聚合，不在本轮范围。
- Kimix 落地：新增 `autoCollapseTurnProcess`（localStorage `kimix_auto_collapse_turn_process`，**默认开**，与官方默认相反，用户明确要求），设置入口在「对话与权限 → 过程展示方式」分区；持久化链路复用 `collapseProcessWhileRunning` 的 localStorage-only 模式，不进 settings.json。
- 行为：开关拆为纯函数 `resolveProcessDefaultExpanded`（liveThinkingViewport.ts），开启时行为与之前完全一致（kimi-web 最新回合出现最终正文后折叠、kimix 始终摘要）；关闭后过程保持展开（含历史回合），且 `isFinalContentTransition` 自动折叠事务不再触发；「运行中折叠过程详情」仍优先。
- 验证：定向 3 文件 33 项、全量测试、Node/Renderer typecheck。

## 2026-08-28 修正：输入区交互不再误收起后台卡片（v2.21.136）

- 根因：ComposerDockBar 注册了全局 capture 阶段的 `mousedown` 外部点击关闭；输入框位于 dock 根节点之外，因此聚焦输入框会误收起已打开的任务面板。
- 修复：移除全局外部点击关闭监听，面板只由对应胶囊、面板 X/收起操作或数据清空关闭；保留面板互斥和数据生命周期清理。
- 验证：定向 ComposerDockBar 测试、全量测试、Node/Renderer typecheck、生产构建、diff 检查与知识库严格校验通过。

## 2026-08-28 修正：Tower 终态优先于滞后任务状态（v2.21.135）

- 根因：Tower 卡片原先优先使用后台任务列表状态；任务列表短暂保留 `running` 时，会覆盖官方 roster/事件已报告的完成状态。
- 修复：Tower 记录从任务、事件、roster、mission 汇总状态，任一来源明确终态即优先采用；兼容 `complete`、`finished`、`success`、`done`、`terminated` 等官方常见终态别名，并统一状态文案归一化。
- 验证：定向 Tower/样式测试、全量测试、Node/Renderer typecheck、生产构建、diff 检查与知识库严格校验通过。

## 2026-08-28 修正：Tower 筛选框改为硬圆角（v2.21.133）

- 根因：筛选 Tab 复用了 toggle 角色，风格化的 toggle 半径为 pill，导致“最近”等选中项呈胶囊形。
- 修复：筛选 Tab 使用 navigationItem 的 medium 半径；自定义风格读取 `--ui-role-navigation-item-radius`，旧内置风格回退到对应的 `--radius-sm`，保留选中颜色与描边。
- 验证：定向 UI 契约测试、全量测试、Node/Renderer typecheck、生产构建、diff 检查与知识库严格校验通过。

## 2026-08-28 修正：修复风格化筛选选中态（v2.21.132）

- 根因：Tower 后台 Agent 筛选使用语义正确的 `aria-selected`，但通用风格契约只识别 `aria-pressed`，导致自定义风格下“全部”等选中项缺少选中背景与描边。
- 修复：`kimix-state-button` 基础样式和自定义风格契约同时识别 `aria-pressed="true"` / `aria-selected="true"`，不改变 Tab 语义。
- 验证：定向 2 文件 47 项、Node/Renderer typecheck、全量测试、生产构建、diff 检查与知识库严格校验通过。

## 2026-08-28 修正：Tower 后台 Agent 面板按官方 Web 语义对齐（v2.21.131）

- 明确 v2.21.129 只完成了胶囊入口形态，并未完整对齐官方 Web：旧实现仍使用 Tower roster 元数据作为卡片主信息，且展开层存在 Kimix 自定义头部与操作区。
- 胶囊与展开层统一改为官方“后台 Agent”命名；展开层采用单一标题、运行中计数、最近/进行中/已完成/全部筛选，以及两位序号、真实任务描述、运行状态和耗时卡片。
- 卡片状态、描述与时间优先读取官方后台任务；点击卡片后按 agentId 展示当前会话中的真实子 Agent 事件，而非只展示 sessionId 等元数据。缺少任务结束时间时使用子 Agent 最后事件时间冻结耗时。
- “最近”筛选按官方 Web 语义保留全部进行中 Agent，并附带最近完成的最多 6 个 Agent，避免完成任务较多时把运行中的 Agent 挤出默认视图。
- Tower roster 对应任务从普通后台 Bash/子 Agent 胶囊中排除，避免同一 Agent 重复展示；Tower 待开启态仍保留可撤销入口。
- 官方登录态 Web 的卡片点击后路由细节当前无法直接检查；本轮对齐范围为用户截图可观察交互与 Kimi Code 0.39 SDK 可验证的数据语义，不宣称内部实现逐行一致。
- 验证：定向 3 文件 59 项、全量 195 文件 2103 项、Node/Renderer typecheck、生产构建、diff 检查与知识库严格校验通过；随后按官方源码补正“最近”筛选为全部进行中 + 最近完成最多 6 个。

## 2026-08-28 优化：Tower 入口与后台 Agent 胶囊对齐（v2.21.129）

- Composer 加号菜单新增 Tower 开关，与底部模式按钮共用 Git 预检、互斥检查和官方模式切换；待首轮开启状态可从菜单、工具栏或胶囊展开层撤销。
- 移除输入区上方的 Tower 横向状态卡，接入现有 Dock 胶囊；展开层参考官方 Web 的“后台 Agent”，提供最近/进行中/已完成/全部筛选，并可点击 Agent 卡片查看任务、分支与官方会话 ID，完整状态仍可进入右侧检查器。
- Tower roster 投影补充 sessionId/spawnedAt，并在 roster 缺少状态时从关联 mission 推导，保证筛选与状态标签可用。
- 缩短“子 Agent 上下文 fork”和“Tower 协作编排”的设置描述，使实验功能行在常见设置宽度下保持单行说明和一致行高。
- 验证：定向 4 文件 62 项、全量 195 文件 2102 项、Node/Renderer typecheck、生产构建、diff 检查与知识库严格校验通过。

## 2026-08-28 功能：接入官方 Tower 协作编排（v2.21.128）

- 设置页新增默认关闭的 Tower 实验开关，严格写入官方 `experimental.tower`；Tower 工具与 worker profile 属于 App-scope 组装，开启或关闭后需要重启 Kimix/托管 Kimi Server，Kimix 不会重启外部 Server。
- 普通单 Agent 会话可在 Composer 预检 Git 仓库、初始提交、分支、脏工作区和已有 Tower owner/open missions；新会话会保留开启意图，在官方 runtime 创建后、首个目标发送前回读确认 Tower 已生效。
- Tower 与 Plan、Swarm 双向互斥，多 Agent 房间明确禁用；运行时 status 是模式真值，切换失败不会伪造本地开启状态。
- 右侧检查器只读解析官方 `.tower/comms/state.json` v1 与最近 100 条 activity，展示任务、Agent、活动；未知版本、损坏结构和越界符号链接 fail closed，不解析生成的 Markdown，也不写 `.tower`。
- 退出 Tower 只关闭会话模式并保留工作区。独立 Teardown 经 owner/idle 校验后派发固定空参数官方指令，不开放 `force`，不由 Kimix 直接删除 worktree、分支或审计记录。
- 验证：Tower 定向 4 文件 16 项、全量 195 文件 2101 项、Node/Renderer typecheck、生产构建、diff 检查和知识库严格校验通过。

## 2026-08-28 功能：子 Agent 上下文 fork 实验开关（v2.21.127）

- 新增默认关闭的“子 Agent 上下文 fork”设置，严格写入官方 `experimental.subagent_fork`；IPC 只接受 `tool-select | subagent_fork`，不开放任意实验 ID。
- 设置页明确说明 fork 只赋予模型可选参数，会把调用方已完成的完整对话复制给子 Agent；AgentSwarm 会按成员数放大上下文 Token 与成本。
- 官方 Server 通过配置事件热更新实验标志；SDK 空闲会话在配置变化后主动 reload，运行中的会话不被中断。
- Tower 仅完成产品交互分析，尚未开放：后续应区分会话模式、`.tower` 工作区与 teardown 三层状态，并以官方生成的 `.tower/comms/state.json` 作为只读仪表盘数据源。
- 验证：定向 3 文件 16 项、全量 192 文件 2088 项、Node/Renderer typecheck、生产构建和知识库严格校验通过。

## 2026-08-28 功能：跟进 Kimi Code 0.39 SDK 与任务转后台协议（v2.21.126）

- 官方基线：vendored Node SDK 从 Kimi Code 0.38.0 / SDK 0.19.1 刷新到官方 0.39.0 / SDK 0.19.2（commit `52e8d19d`），继续只保留 Kimix 的 4 秒 MCP 默认启动超时覆盖。
- SDK 收益：v2 状态事件重新携带实时 Context 使用量；全局 MCP 管理支持可选工作目录和 `verify:false` 离线授权分类。0.39 同时提供 Tower 模式，但本轮不在 Kimix 界面开放，避免把独立产品能力混入兼容升级。
- Server 补齐：官方 0.39 新增 `POST /api/v1/sessions/{session_id}/tasks/{task_id}:detach`；Kimix 的“转后台”不再在 Server 会话直接报不支持，而是调用官方接口并回读完整任务状态。SDK 会话分支保持不变。
- 配置边界：官方 0.39 删除 provider 时会有意保留失效的 `[secondary_model]` 并在下次会话校验时报具名错误；Kimix 设置页继续保留自身的级联清理保护，这是明确的产品安全差异，不再描述为官方语义。
- 验证：定向 2 文件 88 项、全量 191 文件 2085 项、Node/Renderer typecheck、SDK 只读能力探针、生产构建与知识库严格校验通过。

## 2026-08-28 修复：全屏压暗层不再回填透明窗口四角（v2.21.125）

- 现象：更新记录等弹窗出现时，黑色压暗背景按矩形视口铺满，在透明窗口的四个圆角外各露出一个黑角。
- 根因：窗口曲线原先只由 `.kimix-app-shell` 承担；`position: fixed` 或 Portal 挂载的全屏遮罩按 viewport 合成，不能可靠受应用壳圆角/overflow 裁剪。
- 修复：Windows 透明窗口的 `body` 新增与 `--kimix-window-corner-radius` 同源的 `clip-path` 视口裁剪，统一约束普通内容、fixed 遮罩和 body Portal；最大化/全屏状态显式移除裁剪并保持矩形。
- 回归保护：`uiStyles.test.ts` 锁定透明窗口 body 的圆角裁剪及最大化归零契约；定向 31 项通过，待用户以 v2.21.125 截图验收真实透明窗口边缘。

## 2026-08-26 修复：历史图片占位卡真根因——持久化坏 images 不被 canonical 修补（v2.21.124）

- 现象：v2.21.123（blobref 接入）后用户复测同一会话仍显示"图片 2/图片 3 / 未读取到绝对路径"。
- 证据链：用户提供官方导出包（agents/main/wire.jsonl）。该会话图片 part 实为标准 `kimi-file://f_xxx`（无 id 字段）；本地复现 v2.21.123 映射链（parseKimiCodeRecord → mapStreamEvent）输出 `{name:"图片 2", fileId:"f_…"}` 完全正确——**映射与渲染层健康，blobref 并非本会话根因**（blobref 形态在本机 wire 确实存在，v2.21.123 的支持保留，属前瞻兼容）。
- 真根因：旧版（v2.21.115 之前）映射器落地的持久化 images 只剩 `{name}`，无任何可渲染字段；历史修复管线 `hasPossiblyLostUserImages` 每次启动都检测到丢失并拉取 canonical，但 ① 该检测只认 filePath/dataUrl，不认 fileId——即使修好也会永远反复触发；② `mergeCanonicalFragmentTurnBodies` 只补 assistant 正文残片，从不把 canonical 的可展示 images 写回本地 user_message；③ `mergeEvents` 的「内容匹配 → 原样保留」去重分支同样丢弃 canonical 好数据。坏数据因此永生。
- 修复（三处闭环）：① `hasDisplayableUserImageRefs` 认可 fileId/blobRef/url，`hasPossiblyLostUserImages` 用之（修好后不再反复触发修复）；② `mergeCanonicalFragmentTurnBodies` 轮次对齐后，本地 images 不可展示而 canonical 可展示时用官方引用修补（imageRepairs，日志加 patchedImageTurns）；③ `mergeEvents` 盖章/十秒窗口去重分支加 `repairedUserImages` 自愈（本地 dataUrl 可展示时不覆盖）。
- 验证：新增 5 项单测（mergeEvents 修补/不覆盖、轮次补丁修补/不覆盖、丢失检测认可引用）；typecheck、全量 191 文件 2080 项通过；待用户装 v2.21.124 截图复验该会话。

## 2026-08-26 修复：blobref 会话媒体丢失——官方新内容寻址形态接入（v2.21.123）

- 现象：v2.21.115 修过 kimi-file://f_ 后仍有用户反馈历史图片显示"图片 N / 未读取到绝对路径"占位卡（截图版本 v2.21.122）。
- 根因：官方 wire 新增会话级内容寻址 `blobref:<mime>;<sha256>`（image_url/video_url part 的 url），内容落在会话目录 `sessions/<bucket>/<sessionId>/agents/<agent>/blobs/<hash>`，不在 `files/`、不经 fs:content；两套映射器只认 data:/kimi-file://f_，blobref 图既无 dataUrl 也无 fileId，渲染层落占位卡。本机 wire 抽样确认 blobref 与 kimi-file、data: 三形态并存。
- 修复：映射器（eventMapper/kimiCodeEventMapper）提取 `blobRef`+MIME（blobref 原始串不泄漏进 url）；渲染层 `kimix-media://blob/<hash>?mime=` 流式缩略/预览/视频播放；主进程协议新增 blob 路由，按 sha256 跨候选 share dir 解析本地 blobs（命中缓存、miss 不缓存），Range/206/416 语义复用；`kimi-code:loadFile` IPC 增加 blobRef 参数供复制/画板物化。
- 验证：新增映射/blob 解析/预览物化用例，全量 191 文件 2075 项、typecheck、OKF strict、生产构建通过；待用户截图验收真实 blobref 会话。
- 修正（2026-08-26 晚）：用户复测证明该会话根因不是 blobref（实为 kimi-file://f_ + 持久化坏数据不自愈，见 v2.21.124）；blobref 形态在本机 wire 确实存在，接入保留为前瞻兼容。

## 2026-08-26 修复：能力安装预清理不再按镜像名全局杀进程（v2.21.122）

- 现场：v2.21.121 用 `taskkill /F /IM <exe>` 在能力安装前释放二进制占用，但该写法会结束全系统所有同名进程，可能误杀其他 Kimi 系工具拉起的 kimi-webbridge.exe / kimi-cu.exe。
- 修复：新增 `electron/win32ProcessTree.ts`（PowerShell 枚举 Win32_Process 进程表），`stopCapabilityBinary` 只定向结束两类“自有”进程——当前 Kimix 进程的后代（本次实例经 SDK/Server 拉起），以及父进程已退出的同名孤儿（上一实例残留）；按 PID `taskkill /T`，不再按镜像名。枚举失败时跳过预清理（回到原部分就绪行为），不扩大影响面。
- 顺带：main.ts 与 sessionHistory.ts 的 `resolveKimiShareDir` 三函数重复实现合并为 sessionHistory 单一导出；kimix-media 协议 fileId 校验顺序理顺（先正则后解析）。
- 验证：新增 win32ProcessTree.test.ts 9 项（解析/后代/孤儿/他方进程/大小写/父链成环/root 兜底）；typecheck、kimiMediaFile/windowChrome 相关测试通过。

## 2026-08-25 修复：Kimi WebBridge 安装卡“部分就绪”——能力二进制占用释放（v2.21.121）

- 现象：官方内置能力 Kimi WebBridge 卡在“部分就绪/继续安装”，顶部“正在安装…”一直转圈。
- 根因：官方安装器把下载的 exe rename 到 `~/.kimi-webbridge/bin/` 时 EPERM（目标 `kimi-webbridge.exe` 正被运行中的进程占用，官方日志 `capability install failed step=download`），安装卡住并被标记 partial。
- 修复：`kimiCodeHost.installCapability` 触发前按能力 id 先结束对应二进制进程（kimi-webbridge.exe / kimi-cu.exe），再调官方安装，重装/升级不再被占用打断。
- 验证：本次 dev 重启后官方服务重新评估 wiring，WebBridge 已显示“就绪”（二进制与运行进程均有效），marketplace v1.11.3 已安装；typecheck 通过。
## 2026-08-25 修复：任务栏图标再次回退 androidx——setAppDetails 仅打包态（v2.21.120）

- 现象：用户并行提交 41db22d6 恢复 dev 任务栏 Kimix 图标尝试失败，任务栏又显示 electron.exe 的默认 Atom 图标。
- 根因：41db22d6 重新加入了 `mainWindow.setIcon + setAppDetails({appId: "com.kimix.app"})`（无条件执行）；dev 态自定义 AUMID 无匹配快捷方式时，Windows 任务栏按钮回退宿主 exe 图标——这正是 v2.21.109 已确认并移除的坑。
- 修复：`setIcon/setAppDetails` 仅在 `app.isPackaged` 时执行（打包 EXE 图标即 Kimix，AUMID 分组身份保留）；dev 态不设置。windowChrome 测试断言同步。
- 验证：重启后任务栏显示 Kimix 图标（深底白 K + active 下划线）；typecheck 与定向测试通过。
## 2026-08-25 修复：透明窗口补外描边并恢复任务栏 Kimix 图标（v2.21.119）

- 现象：v2.21.118 的透明窗口在浅色桌面上缺少最外边界，窗口与背景辨识度低；Windows 任务栏按钮再次显示 Electron Atom 默认图标。
- 外框根因与修复：透明 BrowserWindow 不再具有 DWM 外框，`.kimix-app-shell` 只有圆角/底色，主内容区边框也不是窗口边界。最外壳新增不占布局、不接收鼠标的 1px 中性 inset 描边覆盖层（浅色低透明黑、深色低透明白），沿当前风格 shell 半径裁切，最大化时关闭；不向 HWND 外扩，因此不会重现灰色包裹层。
- 图标证据与根因：发行 `Kimix.exe` 内嵌图标、`resources/icon.ico` 与仓库 `build/icon.ico` 一致，均为 Kimix K，排除打包资源遗漏。回归来自窗口创建链删除了显式 `nativeImage` / `setIcon` / `setAppDetails` 后，无框透明窗口的任务栏身份回退到 Electron 宿主图标。
- 图标修复：恢复同源 NativeImage 校验和窗口级 `setIcon` / `setAppDetails`；AppID 继续使用与 electron-builder 一致的 `com.kimix.app`，安装版/便携版不产生新分组，dev 仍不设置进程 AUMID。
- 回归保护：外框契约覆盖透明/最大化状态，Windows chrome 契约覆盖 nativeImage、窗口图标、任务栏 AppID/图标路径与打包资源；视觉验收等待用户安装或运行 v2.21.119 后截图确认。
- 验证：全量 190 个测试文件 / 2061 项、Node/Renderer typecheck、OKF strict 校验与生产构建通过。

## 2026-08-25 修复：历史 file-backed 图片操作与离线读取链路补齐（v2.21.118）

- P2 根因一：file-backed 图片没有内联 dataUrl，预览列表却用空 dataUrl 兜底定位，导致多张历史图片都命中第一张；复制图片和画板也把空 dataUrl 直接传给后续能力。
- P2 根因二：`kimix-media` 把文件目录固定为 `~/.kimi-code/files` 且强依赖已就绪 Server，与实际 `KIMI_CODE_HOME` / `KIMI_SHARE_DIR` / legacy `.kimi` 解析不一致，Server 离线时本地仍存在的历史媒体也无法读取。
- 修复：预览身份按 `id → fileId → url → 非空 dataUrl → name` 分级定位；缩略图、预览失败以及复制/画板操作按需通过现有文件 IPC 物化 data URL。主进程统一从当前 Kimi shareDir 做严格 fileId/路径校验，优先官方 `fs:content`，失败后本地受控回退；Range 回退只读请求片段并返回 206/416。
- 回归保护：覆盖多张空 dataUrl 图片导航、复制/画板物化、自定义/legacy Kimi 目录、路径逃逸、Range 局部读取与常见图片 MIME 推断。
- 验证：全量 190 个测试文件 / 2061 项、Node/Renderer typecheck、OKF strict 校验与生产构建通过。

## 2026-08-25 修复：清空的 Composer 草稿重启后不再复活（v2.21.117）

- 现象：输入框保留过长内容时，用户将文字全部删除并关闭应用，重新打开同一对话仍恢复已经删掉的旧文字。
- 根因：每次输入和卸载都已同步写盘，不是退出漏刷；多窗口草稿恢复为了保留其他窗口内容，只把非空 writer 槽加入候选，导致较新的空值墓碑被忽略，renderer 重启生成新 writerId 后反而选中更早的非空槽。
- 修复：跨 writer 恢复按 `updatedAt` 选择最新合法记录，空字符串同样是权威状态；不删除其他窗口的槽，继续保持并行窗口隔离。空写与显式清空也统一执行 12 槽上限修剪，避免墓碑无限累积。
- 回归保护：新增“旧非空槽 + 较新空槽 + 清内存模拟重启”用例，修复前稳定恢复旧文字、修复后保持空白。
- 验证：全量 189 个测试文件 / 2052 项、Node/Renderer typecheck、OKF strict 校验与生产构建通过。

## 2026-08-25 修复：file-backed 图片预览 overlay 渲染条件补流式 url（v2.21.116）

- 现象：v2.21.115 缩略图已能流式显示，但点击缩略图预览无反应。
- 根因：ImagePreviewOverlay 的渲染条件为 `previewImage?.dataUrl && (...)`，file-id 流式 PreviewImage 的 dataUrl 为空字符串（内容是流式 url），条件为假不渲染。
- 修复：两处条件改为 `previewImage && (previewImage.dataUrl || previewImage.url)`；实测点击缩略图打开预览 overlay（大图、画板、上一张/下一张、关闭齐全）。
## 2026-08-25 修复：历史 file-backed 图片走官方内容寻址流式渲染（v2.21.115）

- 现象：老会话的图片附件显示文件名 + “未读取到绝对路径”（官方 Web 无此问题）；新图片正常。
- 官方机制：Kimi Code 的图片协议用 `kimi-file://f_<id>`/`file_id` 内容寻址，官方 Web 端直接按 id 取文件内容渲染，不存在本地路径概念；本地端官方文件位于 `~/.kimi-code/files/<fileId>`，经官方 `fs:content` 读取。
- 根因（两层）：① 两套入站映射器（eventMapper.extractUserMessage / kimiCodeEventMapper.extractPromptMessage）对 file-backed image part 只提取 dataUrl，未提取 fileId；② 渲染层 AttachmentThumb/getPreviewImages 只认 dataUrl，file-backed 图落入“文件面板”显示“未读取到绝对路径”；且历史会话 timeline 由本地缓存恢复，旧记录只有 `name=f_xxx`（即官方 file id），不会重新映射。
- 修复：映射器提取 fileId（`kimi-file://f_` 前缀或 f_ 前缀 id）；渲染层对无 dataUrl 的图以 fileId（含 name 回退）走 `kimix-media://server-file/<fileId>` 流式渲染（复用视频的官方 fs:content 代理），预览 overlay 同样支持流式 url。
- 验证：老会话 f_391a9c5f / f_5399c25a 两张历史图片渲染为真实缩略图（内容可见）；新增映射器测试 1 项；全量 2051 项通过。
## 2026-08-25 修复：Kimix 默认风格 shell 圆角 20px→16px，与面板/卡片层级顺滑（v2.21.114）

- 用户反馈：默认（Kimix 默认）风格的主区/窗口圆角 20px 与该风格其他部分（卡 12、面板 16、控件 6）断层太大；现代风格的 20px 与自身体系无异议，不动。
- 修改：内置风格文档 default 的 `shell: 20 → 16`（与 panel 同级），CSS `:root` 的 `--kimix-window-corner-radius: 20px → 16px`；modern 块保持 16px→（保持 20px 不变）。
- 回归：uiStyles 测试更新 :root 断言为 16px；窗口/主区仍由同一 token 驱动，四角与主区一致。
## 2026-08-25 修复：设置页右缘缝隙 = shell 额外 1px 亮带，已移除并与底部对称（v2.21.113）

- 现场：用户放大截图确认右下不对称——右侧有一条 1px 缝隙、底部没有；逐像素扫描右/底缘：右侧白卡与窗口边缘之间多一层 1px 米色带（`.kimix-app-shell` 的历史 `padding-right: 1px`），底部无此带，深色桌面上右侧表现为亮缝。
- 修复：移除 shell 的 padding-right: 1px；右缘结构变为“内容 → 1px 卡描边 → 窗口缘”，与底缘一致（右侧滚动条侧 1px 米色带消失）。
- 验证：本地像素扫描右缘 x=1599 由米色带变为卡描边线，与底缘 915 描边对称；圆角抗锯齿（0.5px 半透明）属于透明窗口物理边界，浅色桌面不可见。
## 2026-08-24 修复：设置页主区右侧恢复浅色边，与底部过渡对称（v2.21.112）

- 现场：v2.21.111 让滚动条贴窗口右缘后，右侧仅剩 2px 面板边，紧邻窗外深色桌面形成"深色缝隙"；而底部主卡下有状态条浅色过渡（约 76px），右下不对称。用户要求：右、下都有小缝隙或都为零，不得单边有缝或发生裁切。
- 修复：`kimix-settings-body` 右侧 padding 恢复为 12px（滚动条距窗缘 12px 浅色边），内容层 `kimix-settings-page` 右侧 padding 调为 16px（内容与滚动条间保持 28px 阅读留白）。实测设置页右侧 = 浅色边过渡，底部不变 = 右下对称。
- 验收：等用户完整关闭重启 v2.21.112 后确认右下边缘与主卡描边。
## 2026-08-24 修复：设置页主区滚动条贴窗口右缘，消除右侧空白带（v2.21.111）

- 现象：设置页（workspace）主卡右缘与窗口右缘之间留有一条 24-34px 的 panel 背景空白带，滚动条未贴窗口右缘，用户反馈"右侧多一点点"。
- 根因：`.kimix-settings-body` 的 `padding-right: 24px` 使滚动条位于内容右缘而非窗口右缘；叠加 `.kimix-settings-page` 的 `padding-right: 4px` 后右侧带更宽。
- 修复：滚动容器右侧 padding 移出（`padding: 18px 0 22px 24px`），内容层 `.kimix-settings-page` 右侧 padding 补为 28px；滚动条贴窗口右缘、内容右间距 28px（遵守留白规则），实测右侧带由 34px 收敛为约 6px。
- 底部"少一行"：滚动到底时"色彩方案"标题+扫描按钮正常显示，与用户截图同构；若无更多证据不为观感差异盲改，待用户验收后确认。
## 2026-08-24 修复：透明窗口外壳消除圆角包边，窗口四角完全由 CSS 风格圆角决定（v2.21.110）

- 现象：v2.21.109 的 setShape 原生区域方案在用户桌面（深色壁纸）上仍出现四角"包边"——窗口外圈有 7px 白色装饰带（DWM 窗口边框+阴影，按窗口矩形/8px 圆角绘制），不随 setShape 的 20px 自定义圆角，且 HRGN 只能裁 HWND 矩形内部、裁不掉 HWND 外的 DWM 装饰，inset 内缩也无解。本机无损截图（PIL ImageGrab）复现确认。
- 方案：Windows 改用透明窗口（`transparent: true` + `backgroundColor: "#00000000"`），完全移除 setShape/windowShape 与 roundedCorners 干预；`html/body` 不再铺底色（仅 Windows 由 renderer 标记 `data-transparent-shell="1"` 使 body 透明），四角由 `.kimix-app-shell` 的 `--kimix-window-corner-radius`（默认/现代 20px、复古 6px、怀旧 0px、自定义 v1 contract）CSS 圆角 + alpha 裁剪决定，天然与主工作区同一半径、平滑抗锯齿、无系统装饰冲突。最大化经既有 `[data-window-maximized]` 归零为直角；非 Windows 继续原生窗口 + body 底色，行为不变。
- 实测（本机 Win11 100% DPI）：左/右/底边缘像素扫描无黑带无白带，四角弧线平滑、直接透现桌面；MoveWindow 缩放无残影；最大化直角、任务栏不被遮挡；任务栏继续显示 Kimix 图标。代价：窗口不再有 DWM 系统投影（透明窗口无系统阴影），且 setShape 相关测试移除。
- 知识库：interface-style-system.md 更新为"透明窗口外壳"决策，明确 setShape 与 DWM 装饰冲突为结构性限制。

## 2026-08-24 修复：窗口四角跟随风格圆角并恢复任务栏图标（v2.21.109）

- 现象：v2.21.108 把默认/现代主工作区圆角缩到 8px 反向适配 DWM，现代化风格白色主区四角与窗口轮廓同为小圆角，违背"窗口四角应跟随风格主区域圆角"的需求；任务栏按钮继续显示开发载体 electron.exe 的 Atom 默认图标。
- 圆角修复：主进程重新按 `resolveUiStyleShellRadius(settings.uiStyle, settings.customUiStyles)` 生成 `setShape()` 圆角矩形并集（默认/现代 20px、复古 6px、怀旧 0px、自定义 0–32px 由 v1 contract 同源解析），resize/最大化/还原/切换风格时同步，最大化与全屏恢复直角；`--kimix-window-corner-radius` 默认与现代恢复 20px，主工作区继续消费该变量，风格值重新成为几何事实源。与 v2.21.105 的关键区别：**不再设置 `roundedCorners: false`**，DWM 圆角保持平台默认——本机 100% DPI 实测四角 20px 曲线干净无灰框、无内容裁切（灰框根因指向 roundedCorners:false 与自定义 HWND 区域组合，而非 setShape 本身）。
- 图标根因：`app.setAppUserModelId("com.kimix.app")` 是无匹配快捷方式的自定义 AUMID；Electron 42 下任务栏按钮图标因此回退 exe 图标（dev 载体 electron.exe 的 Atom），v2.21.108 的 setIcon/setAppDetails 也都盖不过该回退。修复：dev 态不再设置 AUMID；打包态 exe 图标即 Kimix（build/icon.ico 已嵌入），保留 AUMID 维持通知身份。
- 窗口图标：统一 `APP_ICON_PATH`（dev 用 build/icon.ico，打包用 resources/icon.ico），构造参数直接传路径，不再使用 setIcon/setAppDetails。
- 回归保护：windowShape 几何、windowChrome 外壳契约（setShape 存在、icon 路径、无 setIcon/setAppDetails）与 uiStyles 20px token 断言；定向 37 项、全量、typecheck、生产构建与知识库严格校验均通过；已在本机截图实测：任务栏显示 Kimix 图标、左上/右上 20px 圆角干净无灰框。高 DPI（非 100%）的 setShape 表现仍未实测，作为已知边界保留。

## 2026-08-24 修复：默认窗口曲线与 Windows 任务栏图标收敛（v2.21.108）

- 现场：v2.21.107 已消除灰色原生包裹，但默认/现代白色主工作区仍为 20px，和 Windows DWM 外轮廓约 8px 的曲线不一致；任务栏继续显示开发载体 `electron.exe` 的 Atom 图标。
- 圆角：不重新裁切 HWND；默认与现代的最外应用壳、贴边主工作区统一使用 8px 系统兼容半径，主工作区改为消费同一个 `--kimix-window-corner-radius`。卡片、面板、Composer 等内部层级继续保留原有大圆角；复古、怀旧和自定义风格仍可在 renderer 内使用自己的 shell 半径。
- 图标根因：开发态只在 BrowserWindow 构造参数传根目录 PNG，未明确更新任务栏按钮；打包文件白名单也不携带该运行时 PNG。Windows 因而可回退到 Electron 默认图标，打包态路径还可能不存在。
- 图标修复：固化由现有 Kimix PNG 转换、包含 256px Windows 图标帧的 `build/icon.ico`，显式作为 Windows EXE 图标并复制到 resources；主进程按开发/打包路径加载 NativeImage，调用 `setIcon()` 与 `setAppDetails()` 写入同一 AppUserModelID 的任务栏身份。非 Windows 继续使用同源 PNG。
- 回归保护：窗口契约测试锁定 8px 默认/现代贴边曲线、ICO 打包与运行时解析、`setIcon`/`setAppDetails`，并继续禁止实验性 `setShape()`；待用户彻底重启 v2.21.108 后截图验收。

## 2026-08-24 修复：恢复 Windows 原生窗口外壳与任务栏身份（v2.21.107）

- 现象：v2.21.106 的应用内容外出现灰色矩形包裹，任务栏里的 Kimix 图标同时丢失；截图确认这是窗口级回归，不是界面风格本身的配色或容器样式。
- 根因：v2.21.105 为让物理窗口圆角跟随风格，关闭了 Windows DWM 圆角并调用 Electron 实验性 `BrowserWindow.setShape()` 裁切 HWND。该方案把 Chromium 客户区、系统非客户区/阴影与任务栏窗口身份置于不稳定组合，产生外框和图标回归。
- 修复：完整移除原生 `setShape()`、窗口区域生成器和 `roundedCorners: false`，恢复 Windows DWM 默认外壳；显式保留 `frame: false`、`skipTaskbar: false` 与 Kimix 图标路径。风格半径仍只作用于 renderer 内部应用壳，最大化时保持直角。
- 稳定边界：物理窗口最外四角重新由操作系统决定，不能再按自定义 JSON 任意数值变化；这是保留系统阴影、命中区域和任务栏身份的一致性取舍。窗口创建参数需要完全退出旧进程后才会生效。
- 回归保护：新增主窗口配置契约测试，禁止重新引入 `setShape()` 或 `roundedCorners` 覆盖，并锁定任务栏可见性和图标路径；待用户彻底重启 v2.21.107 后截图验收外框与任务栏图标。

## 2026-08-24 功能：超长用户消息默认折叠并可展开（v2.21.106）

- 根因：`UserMessageBubble` 直接完整渲染 `event.content`，长提示词、JSON 或多段要求会占据大幅对话空间；现有过程折叠只覆盖 Agent 输出，不作用于用户消息。
- 实现：普通用户消息按实际渲染高度判断，正文超过 252px 时默认裁切并显示底部渐隐与居中的“展开”按钮；展开后显示完整正文与“收起”按钮。`ResizeObserver` 会在窗口宽度、字号或字体布局变化时重新判断，历史恢复的消息同样生效。
- 数据边界：折叠仅影响正文展示；附件始终完整显示，复制、撤回及模型上下文继续使用原始全文。引导消息 `steer_message` 暂不纳入，避免改变运行中引导状态块。
- 风格：按钮复用 `kimix-icon-text-button` / `kimix-muted-action`，默认和现代提供克制的浮面，复古/怀旧沿用其控件语言，自定义导入读取 control resting/hover/active 角色；32px 可见按钮通过伪元素扩展为 40px 点击热区。
- 回归保护：新增短消息不折叠、长消息默认折叠与往返切换、图片仍显示且复制保持完整正文/附件的 jsdom 用例；待用户截图验收折叠高度、渐隐和按钮位置。

## 2026-08-24 功能：软件窗口圆角跟随界面风格（v2.21.105）

- 根因：`roles.shell.radius` 只被 renderer 内层 `.kimix-app-shell-main` 消费；无边框 BrowserWindow 仍由 Windows DWM 使用固定系统圆角，CSS 无法改变最外层可见和可点击区域，所以怀旧直角、复古小圆角及自定义 shell 半径都在窗口四角失真。
- 实现：Windows 主进程关闭固定系统圆角，依据内置/自定义风格的规范化 shell 半径生成 `setShape()` 整数矩形并集；切换风格、缩放窗口、还原窗口时动态同步，最大化/全屏恢复直角。renderer 最外 `.kimix-app-shell` 同时消费同一语义半径并在最大化时归零。
- 兼容边界：默认/现代为 20px、复古为 6px、怀旧为 0px；自定义导入读取 `roles.shell.radius` 并保持现有 0–32px 契约上限，缺失或失效文档回退默认。macOS/Linux 继续使用平台原生窗口外形，避免透明窗口对缩放、最大化和系统阴影的已知破坏。
- 回归保护：新增风格半径解析、CSS 外壳映射和窗口区域几何测试；Windows 原生外形仍待用户在实际桌面截图验收。

## 2026-08-24 修复：附带图片的用户消息不再显示协议占位符（v2.21.104）

- 现场证据：截图对应的官方 `turn.prompt` 原始记录为 1 个 text part + 2 个 `image_url`（`kimi-file://` 独立引用），正文末尾没有 `[图片]`；Server 历史快照把已上传图片还原为 file-backed image part。
- 根因：两套入站事件映射器在已经把结构化 image part 写入 `images` 后，又对缺少内嵌 data URL 的合法文件引用向 `textParts` 追加 `[图片]`；两张图片因此恰好污染出两行可见正文，`MessageBubble` 只是忠实渲染该错误投影。
- 修复：结构化图片只投影到附件数组，不再二次写入用户/引导正文；用户真实输入的 `[图片]` 与无视觉模型的具名降级文本 `[图片: 文件名]` 均不受影响。
- 回归保护：保存脱敏协议/UI 快照；新增普通 TurnBegin 与 steer 的双 file-backed 图片用例，先稳定复现两行占位再锁定正文纯净及附件数量。

## 2026-08-24 修复：恢复的长草稿会自动适应输入框高度（v2.21.103）

- 根因：ComposerInput 的自动高度计算只绑定原生 `onChange`；持久草稿初始恢复、撤回消息回填和待发消息编辑只更新受控 `value`，不会触发输入事件，因此长内容仍停留在最小高度，直到用户再次键入。
- 修复：高度测量统一迁入随受控 `value` 执行的 `useLayoutEffect`，在浏览器绘制前按最新 DOM 内容执行 `height: auto → min(scrollHeight, 132px)`，并继续刷新自绘滚动条；用户输入路径不再重复测量。
- 回归保护：新增短草稿初始高度、程序化恢复长草稿封顶高度、清空后回落高度的 jsdom 渲染用例；定向 1 文件 3 项、全量 188 文件 2041 项、Node/Renderer typecheck、生产构建与知识库严格校验均通过，待用户截图验收。

## 2026-08-24 功能：自定义界面风格自带专属色彩方案（v2.21.102）

- 数据契约：UI Style v1 新增受控 `palette.primary/surface/accent` 三色种子，仍禁止任意颜色字段、CSS、选择器、字体和布局；AI 生成提示同步要求设计与风格匹配的明暗模式色彩。
- 自动联动：导入或选择 `custom:<id>` 时原子切换到独立 `ui-style:<id>` 色彩身份；用户仍可手动覆盖为普通色组。切走或删除风格时，仅在自带色彩仍激活时回退暖纸，不覆盖用户手动选择。
- 设置展示：色彩方案区只追加当前选中自定义风格的一张专属卡，并标记“风格化自带”；其他自定义风格的色彩不展示。
- 兼容边界：旧版缺少 palette 的自定义风格在解析/持久化规范化时自动补为项目默认暖纸三色；缺失或错配的 `ui-style:*` 身份在设置加载与运行时解析时安全回退暖纸。
- 验证：定向 4 文件 41 项、全量 188 文件 2039 项、Node/Renderer typecheck、生产构建与知识库严格校验均通过；开发启动已完成 main/preload/renderer 编译并进入 `loadURL`，随后本机 Chromium cache 报拒绝访问且进程退出，待用户正常重启 v2.21.102 后截图验收色彩卡与实际明暗表现。

## 2026-08-22 功能：跟进 Kimi Code 0.38 与 Electron 42 运行时（v2.21.101）

- 官方基线：对 `@moonshot-ai/kimi-code@0.38.0` 实机启动 `kimi web --no-open`，健康检查、版本元数据、90 条 REST 路由和 WebSocket 契约通过；Kimix 依赖的 11 条 Server 路由均存在，旧探针统一移除已废弃的 `kimi server run`。
- SDK：vendored Node SDK 从官方 0.36.0 / 0.17.0 刷新为 0.38.0 / 0.19.1（commit `0999454b`），保留唯一的 4 秒 MCP 启动超时覆盖；接入稳定 `promptId`，为重试提供官方冲突检测基础，并锁定多 Skill、统一 MCP 登录状态和双登录区域契约。
- 桌面运行时：Electron 从 35 升级到 42.9.3（Node 24.18.1），移除 Electron 32 已删除的 `File.path` 兼容读取，只经 preload `webUtils.getPathForFile` 获取拖拽路径；原生依赖已按新 ABI 重建。
- 配置安全：全部本地 `config.toml` 兜底写入改为 compare-before-write；若官方 Web/CLI 在 Kimix 读取后修改配置，本次保存会明确取消，不再静默覆盖外部新增字段或无效但仍需保留的内容。
- 验证：Server 0.38 契约门禁通过；定向 3 文件 29 项、全量 187 文件 2031 项、Node/Renderer typecheck、Electron 42 原生依赖重建与生产构建通过。

## 2026-08-22 修复：文件名与预览按钮使用一致悬停反馈（v2.21.100）

- 根因：文件变更卡的文件名入口和“预览”按钮虽然执行同一动作，却分别依赖泛用 `kimix-muted-action` 加不同 Tailwind 圆角；文件名的宽列因此显示成大面积列表灰底，而按钮还会叠加独立焦点/风格反馈。
- 修复：两个入口统一改用 `.kimix-control-button`，移除各自的圆角与 transition 分叉，让边框、圆角、背景、阴影及 hover/active 状态由同一个 control 角色拥有；文件名仍保留整列点击热区。
- 回归保护：新增结构用例，强制两个触发器同时使用 control 角色且不再回退到 muted-action。
- 验证：定向 3 文件 51 项、全量 186 文件 2026 项、Node/Renderer typecheck、生产构建与知识库严格校验通过。

## 2026-08-22 修复：自定义 JSON 风格覆盖全部弹层外壳（v2.21.99）

- 根因：popup/modal 的公共基础 CSS 在自定义角色消费层之后仍用固定默认圆角 `!important`，导致弹窗内部控件已风格化、外壳圆角却停留在默认值；Diff/长任务 inspector 还用固定边框、背景和圆角 `!important`，同样截断自定义角色。
- 修复：菜单、浮层、modal/onboarding 的公共外壳直接消费 popup/modal 角色变量并保留原默认 token 回退；Diff/长任务 inspector 的强制基础声明改为消费完整 inspector border/background/radius，阴影也采用角色优先回退。运行时错误卡移出 interactive-card 状态矩阵并接入 modal 语义类。
- 全量扫描：现有 38 个 popup/modal/inspector 语义触点均已纳入公共角色骨架，未发现新的独立弹窗壳遗漏。
- 回归保护：CSS 契约测试锁定强制基础声明的角色变量优先级、默认 fallback、运行时错误卡 modal 归属，并继续通过内置/导入风格触点奇偶校验。
- 验证：定向 2 文件 47 项、全量 186 文件 2025 项、Node/Renderer typecheck、生产构建与知识库严格校验通过。

## 2026-08-22 修复：当前轮文件变更卡不再误归上一轮（v2.21.98）

- 现场：当前轮仍在执行 Write，文件变更卡却出现在当前用户消息之前、上一轮已完成区域；真实现场事件已不可恢复，已按截图文件名与统计保存可复现的主进程/UI 时间线快照。
- 根因：`restoreLateHistoricalChangePlacement` 仅凭派生 `change_summary` 的陈旧时间戳判断历史归属，未识别同一 `toolCallId` 的 Write/Edit 工具已经位于当前用户边界之后，因此历史兼容修复反向搬错当前轮变更。
- 修复：显式 `agentTurnId` / `roomMessageId` 或当前用户边界后的同源工具调用优先于时间戳；只有缺少这些稳定来源证据的真正迟到历史变更继续执行旧搬移逻辑。
- 回归保护：新增“当前 Write 工具 + 陈旧派生时间戳”用例，先证实上一轮错误收到 `+311` 卡片，再锁定当前轮归属；保留既有历史变更及其 diff 同步回放用例。
- 验证：定向 1 文件 60 项、全量 186 文件 2024 项、Node/Renderer typecheck、生产构建与知识库严格校验通过。

## 2026-08-22 修复：切换默认模型不再改变设置页模型列表位置（v2.21.97）

- 根因：模型配置读取结果会把当前默认模型排在最前；设置页分组直接沿用该顺序，因此切换默认模型后新默认项跳到首位、旧默认项重新落位。
- 修复：设置页模型分组统一按模型别名稳定排序，默认状态只影响按钮标记，不再参与模型列表位置计算；未绑定模型分组遵循相同规则。
- 回归保护：新增默认模型从 model-b 切换到 model-a、且输入数组随默认项重排的用例，断言切换前后展示顺序一致。
- 验证：定向 2 文件 39 项、全量 186 文件 2023 项、Node/Renderer typecheck、生产构建与知识库严格校验通过。

## 2026-08-22 修复：textOverlap KMP 提前终止致思考内容可被整段剥空 + 审查清单落地（v2.21.96）

- 背景：v2.21.89 发布后范围全面审查（A=侧栏目录确认态 / B=思考双轨漂移 / C=capabilities），14 项清单经复核确认 13 项属实；本轮落地必修与建议项。
- 根因（H2）：textOverlap.ts `if (state === right.length) break;` 把「right 完整出现在 left 中段」误当「后缀-前缀重叠」提前返回。mergeAssistantThinkingText 路径被前置 includes 检查挡住不可达；buildThinkingBlocks 路径可达（16 字符阈值下 part 全文为中段子串时），重叠=next 全文长度 → part 被整段剥空、静默丢内容。
- 修复：删除提前 break（完整匹配后下一轮迭代 right[state]=undefined 自然经 fail 回退；匹配恰在文本末尾时循环结束保留全值），新增长注释说明不变量；buildThinkingBlocks 补「剥空则不追加」守卫（定位为防御性 no-op，与字符串路径对齐）；语义 A（中间完整包含不算重叠）按用户拍板以断言锁定，语义 B（段尾-段头真实 ≥16/20 字符同短语但非重放）作为启发式固有行为记入已知边界，待真实数据再定是否收紧阈值。
- 同处落地：L1 eventMapper.ts 三处 mergeAssistantThinkingUnified 双调用改单次 spread（python 改，混合行尾保持）；M2 removeProject 无条件清理 confirmedProjectPaths（不挂 currentProject 分支）；清理 Sidebar.tsx 展开路径残留的过期注释（与「即时显示」新策略一致）。
- 回归保护：新增 textOverlap.test.ts 10 项（空串/minLength 边界/完全相等/单字符/纯空白归一化/语义 A 负用例/真后缀重叠正用例）；eventMapper.test.ts 补语义 A 断言；thinkingBlocks.test.ts 补 part 级语义 A + 剥空守卫 2 条；全量 186 文件 2022 项、Node/Renderer typecheck、生产构建通过。
- 已知边界（记录不修，对应审查清单）：① M6 capabilities 迁移标记靠 TOML 注释存活，官方 CLI 重写会清掉，此后首次启动会为「无 capabilities 条目」补写——用户想关图片应把 capabilities 改为 ["tool_use"]（非 deepseek 家族视为手动声明不动），而非删行；中期方案（标记挪到 Kimix 状态文件）backlog。② M3 展开集合引用变更触发全部已展开项目刷新风暴（幂等无碍，性能项）。③ L4 迟到刷新为已删项目 push 会话（窗口极小）。④ L5 provider 新建流程重新计算覆盖手动 capabilities（语义为新建，记录即可）。⑤ M4 server 路由 setConfig 透传 capabilities 未实机验证；M5 existing.capabilities 与迁移竞态需日志验证。
- 知识库：sidebar-session-catalog.md 与 streaming-render-pipeline.md 同步检查见知识笔提交。

## 2026-08-21 修复：deepseek 视觉变体被名称一刀切降级，图片仍看不到（v2.21.95）

- 现象：v2.21.94 上线 capabilities 补写后，用户用 `deepseek-v4-flash-vision-exp`（opencode-go 网关）发图仍看不到，模型原话引用 `[图片: image.png]` 占位符。
- 根因（两处叠加）：(1) Kimix 侧 `isKnownNonVisionModelName` 只要名字含 "deepseek" 就判非视觉 → `adaptPromptForModel` 在发送前把图片降级为文本占位 `[图片: xxx]`，模型根本没收到图像数据；(2) `buildModelCapabilities` 同样的 deepseek 一刀切给该条目写了 `capabilities = [ "tool_use" ]`，无 image_in。
- 修复：判定收敛为“deepseek 家族且名称无 vision/vl/multimodal 标记才算非视觉”纯函数 `isKnownNonVisionModelName`（移入 customModelCapabilitiesToml.ts 统一事实源，fetch 拦截器/能力写入/迁移三处共用）；能力写入同规则；迁移新增自终止升级：deepseek 家族内精确 `["tool_use"]` 签名且新规则应含视觉时升级（该签名原本就是旧规则自动写的，非 deepseek 家族的 tool_use 是用户手动声明不动；升级后不再命中，不依赖可能被官方 CLI 重写时清掉的 marker 注释）。
- 验证：单测新增 isKnownNonVisionModelName（vision/vl2/multimodal 变体）+ 升级规则共 5 项（12 项全过）；本机真实 config.toml 演练：vision-exp 升级为 `image_in, video_in, tool_use`，`deepseek-v4-flash` 纯文本保持 `tool_use`；electron 全量 69 项、typecheck、构建、知识库校验通过。
- 已知边界：若网关对 vision-exp 实际拒绝图片，fetch 拦截器会 400 降级重试文本并标记该模型；官方 CLI 可能重写 config.toml 丢掉迁移标记注释（v2.21.95 已改用精确签名自终止，不依赖标记）。

## 2026-08-21 修复:自定义模型识图能力丢失——config.toml 补写 capabilities（v2.21.94）

- 现象：官方 CLI 更新后，自定义 OpenAI 模型（如公司网关 kimi-k3）发图后模型看不到图，只能拿到 session media 目录的 PNG 路径，用 Read 工具读取报 "is an image file. Only text files can be read"，且 ReadMediaFile 不存在。
- 根因（官方 v2 引擎）：`resolveModelCapabilities` 以 `[models.<alias>] capabilities` 声明为准，与内置静态模型名表取并集；未知/未收录模型全部为 false。未声明时 image_in=false → 不注册 ReadMediaFile、附件图片/视频不进上下文（文件落盘到 session media 目录但模型无工具可读）。Kimix 托管保存的自定义模型从未写 capabilities，官方更新后集体失去识图/视频能力。
- 修复：新建纯函数模块 `electron/customModelCapabilitiesToml.ts`（buildModelCapabilities / applyCustomModelCapabilitiesFix）。三条写入路径统一补写 `capabilities = [ "image_in", "video_in", "tool_use" ]`（deepseek 只写 `[ "tool_use" ]`，不覆盖用户已声明列表）：`buildKimixManagedModelBlock`、`saveOpenAiProviderConfigWithSdk`、`saveProviderModelConfigWithSdk`（SDK patch + TOML fallback）。存量条目由 `ensureKimiCodeMigratedConfig` 末尾的一次性迁移补写，标记 `# Kimix: custom model capabilities migration v1` 落盘后不再自动改写，尊重手动调整；官方 `managed:kimi-code` 条目、`.overrides` 子表、无 provider/未知 provider 类型一律跳过。
- 兜底：官方 CLI 进程内加载（getHarness → installNonVisionFetchInterceptor），个别真不支持图片的模型首张图会被 fetch 拦截器 400 降级重试文本，不会持续失败。
- 回归保护：新增 customModelCapabilitiesToml.test.ts 7 项（含真实 config.toml 演练：11 个自定义条目补写、5 个 deepseek 仅 tool_use、managed 跳过）；electron 目录 64 项单测、Node/Renderer typecheck、生产构建通过；知识库严格校验通过。
- 已知边界：思考能力（thinking/always_thinking）未声明——官方托管条目才会声明，自定义模型目前思考不受影响（截图会话思考过程已验证）；若后续官方对 thinking 也按声明门控，需要再补。

## 2026-08-18 修复：侧栏展开项目不再闪现已归档会话（v2.21.90）

- 根因：侧栏项目会话列表先以 sessionStore 旧状态同步渲染，其中 Web 端已归档的会话本地尚无 archivedAt 标记，先全部显示；随后展开触发的 listKimiCodeSessions（活动目录 + 归档目录合并）异步返回，reconcileOfficialSessionCatalog 依据归档目录 archived:true 行把对应本地镜像标记 archivedAt，Sidebar 过滤后瞬间隐藏——表现为“先显示多个、再一闪而过少几个”。
- 修复：Sidebar 引入目录确认态 confirmedProjectPaths。用户主动展开项目（handleProjectClick expand 分支）先移除确认态并渲染加载占位，catalog 刷新 reconcile 完成（含失败降级）后才一次显示最终列表；30s 轮询 / focus / 可见性回归刷新在 finally 统一确认，幂等。
- 回归保护：Node/Renderer typecheck、生产构建、sidebarProjectExpansion / sidebarSessionList / sessionCatalog 共 49 项单测通过。
- 已知边界：已确认项目在 30s 轮询窗口内 Web 端新归档时，项目保持展开期间仍可能有一次 ≤30s 的隐藏更新；收起再展开会强制重新确认，无展开期闪现。

## 2026-08-18 修复：Windows 自动更新下载失败 + 安装包体积翻倍（v2.21.89）

- 根因一（更新失败）：v2.21.88 发布后 Windows 资产被重命名为点号风格（`Kimix.Setup.2.21.88.exe`），与构建产物 `latest.yml`（连字符 `Kimix-Setup-2.21.88.exe`）和 `SHA256SUMS.txt`（带空格 `Kimix Setup 2.21.88.exe`）三处文件名不一致；应用走 GitHub API 拿资产后 sha256 查不到（SHA256SUMS key 不匹配）、按名合并 latest.yml 的 sha512 也失败，最终抛「缺少 SHA256/SHA512 校验值」拒绝自动安装。另外 `parseReleaseSha256` 对带空格文件名的 `split` 解析本身也是错的（只取 `parts[1]`）。
- 修复：`electron-builder.yml` 显式固定 win `nsis/portable` artifactName（连字符命名，与历史一致）；发布工作流新增「latest.yml path 与产物一致性」断言；`main.ts` 改用 `releaseFeed.ts` 新增的 `parseSha256SumsText` 纯函数（正则取完整文件名，兼容 BSD `*` 前缀）并补 3 项单测。
- 根因二（体积翻倍）：v2.21.75→v2.21.88 安装器 92.9MB→169.7MB；区间引入 `@huggingface/transformers@3.8.1`（思考内容本地翻译），其 optional 依赖 `onnxruntime-node@1.21.0`（208MB，npm 包内置全平台二进制）+ `onnxruntime-web`（89MB）+ transformers（47MB）全部打进生产依赖。修复：三平台 `files` 分别剔除非当前平台 onnx 二进制与 `onnxruntime-web`（worker 仅用 node backend）。
- 回归保护：新增 1 文件 3 项单测；全量 184 文件 / 1996 项、Node/Renderer typecheck、生产构建均通过；发布前追加断言已合入工作流。
- 发布结果（v2.21.89 已发布）：CI 全绿；三平台体积：Windows 安装器 127.6MB（v2.21.88 为 169.7MB）、mac dmg x64 155.7MB / arm64 150.4MB（此前 203-208MB）、Linux AppImage 369.8MB（此前 423.7MB）。最新一环三处命名实测一致（latest.yml / SHA256SUMS / 资产名均为连字符），`releases/latest/download/Kimix-Setup-2.21.89.exe` 返回 200。本地打包曾踩「平台级 files 覆盖顶层白名单」坑（把 .pnpm-store 1.2GB 打进 asar，包 469MB），已按平台写完整清单修复。

## 2026-08-17 修复：Release 三平台产物改为单点汇总发布（v2.21.88）

- v2.21.87 Actions 五个 job 均成功，但最终核验发现三个并行 `electron-builder --publish always` 同时创建同标签草稿：公开 Release 只得到 Linux 产物，Windows/macOS 产物分别留在两个隐藏草稿。Actions 全绿不等于 Release 资产完整。
- 修复：三平台 job 改用 `--publish never`，分别上传 Actions artifact；最终 `publish-release` 单一 job 下载合并全部产物，只创建一个草稿 Release，统一上传、生成 SHA256SUMS 后再公开。发布职责从三个并行构建器收敛为一个串行 owner。
- v2.21.87 的两个隐藏草稿暂未删除，避免未经确认执行不可逆的远端清理；v2.21.88 成功后再由用户决定是否清理。
- 回归保护：发布工作流契约测试扩展为 2 项，强制三平台 `--publish never`、三份 artifact 上传、单点下载合并与唯一 Release 创建；全量 183 文件 / 1993 项、Node/Renderer typecheck、生产构建、知识库严格校验、生产依赖 audit 与 YAML 解析通过。

## 2026-08-17 修复：官方 Plan 不再串用其他会话的全局本地文件（v2.21.87）

- 发布前审查发现：官方 Server 会话在冷启动尚未绑定、transcript 暂无计划或读取失败时，旧逻辑仍可能落到 `~/.kimi-code/plans` 的全局最新文件；该目录不带当前会话归属，存在把另一会话 Plan 显示到当前会话的风险。
- 修复：计划回退策略显式区分 runtime——SDK 会话保留本地计划目录兼容；Server 会话只认官方 transcript；尚未绑定时返回可重试空态并继续既有 1 秒、最多 15 次的有限恢复。没有会话身份的通用文件预览不受影响。
- 回归保护：`planPath` 新增 runtime 回退策略用例，覆盖 `sdk → local`、`null → retry`、`server → official_only`；定向 2 文件 19 项、全量 183 文件 / 1992 项、Node/Renderer typecheck、生产构建与知识库严格校验通过。
- 发布审查同时将 `adm-zip` 升级到 0.6.0，并通过 workspace override 固定已修复的 `tar 7.5.22`、`fast-uri 3.1.5`、`sharp 0.35.3`；生产依赖 audit 无已知漏洞，现有离线模型真实推理冒烟成功。

## 2026-08-17 修复：Swarm 子代理按编号稳定升序展示（v2.21.86）

- 根因：官方事件已携带正确的 `swarmIndex`，但 Swarm 卡片直接按子代理状态事件的到达/归并顺序渲染；运行中的任务和已完成任务更新节奏不同，因此截图出现 `#3、#1、#2`。
- 修复：仅在 Swarm 多任务卡片的展示投影中按 `swarmIndex` 自然升序排列；不改变官方事件数组和过程时间线。缺少编号的旧兼容事件排在有编号任务之后，并保持彼此原始稳定顺序。
- 回归保护：新增乱序输入 `#3 running、#1 completed、#2 completed` 用例，展开卡片后强制断言 `#1 → #2 → #3`；定向 2 文件 55 项、全量 183 文件 / 1991 项、Node/Renderer typecheck、生产构建与知识库严格校验通过。

## 2026-08-17 修复：超长会话思考可正常调用本地翻译（v2.21.85）

- 现场诊断确认设置为本地翻译、模型缓存完整，且同一运行中 Kimix 直接调用本地模型可在约 4 秒返回中文；失败发生在 Renderer 到主进程的参数校验之前。
- 根因：翻译 `requestId` 直接拼接会话、房间 Agent、官方消息、思考块等完整 key。截图会话的 key 为 368 字符，最终 `requestId` 为 388 字符，超过 IPC schema 的 200 字符上限；主进程返回 `invalid_request`，Renderer 按既定失败回退只显示英文原文。
- 修复：仅将诊断相关的 `requestId` 改为固定 16 位双指纹，并继续携带请求版本、源偏移和开始时间；缓存键、并发隔离和过期响应判断仍使用完整 key，不降低会话作用域正确性。
- 回归保护：新增超过 350 字符的官方会话键用例，验证本地 provider、固定长度 requestId、IPC 长度边界和译文落地；定向 3 文件 16 项、全量 183 文件 / 1990 项、Node/Renderer typecheck、生产构建与知识库严格校验通过。

## 2026-08-16 修复：首次打开自动等待计划会话绑定（v2.21.84）

- 根因：首次恢复历史时，计划事件比官方 Server 会话绑定更早进入 Renderer；计划读取只执行一次，主进程因 `serverSessions` 尚无该会话而退回全局计划目录，空结果随后被永久保留。切换会话会重新触发读取，因此表现为“切换一下才有内容”。
- 修复：主进程在计划 sentinel 回退时显式标记“运行时尚未绑定”；Renderer 仅对此状态每 1 秒静默重读，最多 15 次。会话切换、成功读取、手动刷新和组件卸载都会取消旧计时器，不轮询普通计划文件，也不覆盖新会话状态。
- 回归保护：新增 sentinel、retryable 标记和最大重试次数边界测试；定向 3 文件 89 项、全量 183 文件 / 1989 项、Node/Renderer typecheck、生产构建与知识库严格校验通过。

## 2026-08-16 修复：计划胶囊读取官方会话正文（v2.21.83）

- 现场复现确认 v2.21.82 只通过事件恢复了计划胶囊的显隐，却仍从全局 `~/.kimi-code/plans` 猜测计划文件，因此官方会话的实际计划位于 session/agent 专属目录时，面板只能显示目录和“待生成”。
- 对 Project06 会话抓取 Kimi Code Server 0.36.1 数据后确认，官方权威来源是 `GET /api/v1/sessions/{session_id}/transcript/plan?agent_id=main`；响应直接包含按时间线排列的完整 Markdown、精确文件路径和审批状态。
- 修复：Server 会话优先读取官方 transcript plan 的最后一项，并校验会话与工作目录归属；接口缺失、会话未托管或请求失败时继续使用旧版本地文件回退。计划面板改用现有 Markdown 渲染器，外层保持限高滚动。
- 回归保护：新增官方 plan endpoint 路由、agent scope、正文响应与计划面板 Markdown 标题/列表渲染测试；定向 2 文件 85 项、全量 183 文件 / 1988 项、Node/Renderer typecheck、生产构建与知识库严格校验通过。

## 2026-08-16 修复：补全官方工作胶囊状态链路（v2.21.82）

- 对照本机 Kimi Code Web 0.36.1 的 `ChatDock` 确认官方工作胶囊共五类：目标、计划、后台 Bash/后台任务、子 Agent、当前进度；消息队列属于输入区的独立队列胶囊。Kimix 并非缺少新的独立类型，而是“计划”胶囊的数据链路不完整。
- 根因：会话计划读取错误绑定到右侧会话侧栏开关，侧栏关闭时主动清空 `sessionPlanState`；计划显隐又只判断 Plan 模式或正文，漏掉官方已有计划对象但只有路径/审批状态的情况。因此同一会话在官方 Web 显示“计划”，Kimix 可能只剩后台 Bash 和子 Agent。
- 修复：计划识别对齐官方 `sessionPlans` 语义，读取 `ExitPlanMode` 工具参数和 `plan_review` 审批中的会话内正文/路径，同时保留历史计划文件与提问信号兼容；计划状态脱离侧栏生命周期，只有路径也显示胶囊。普通后台列表含官方 `kind=tool` 时，胶囊和面板改称“后台任务”，否则仍称“后台 Bash”。
- 回归保护：新增官方五类胶囊顺序、路径单独显隐、tool 文案以及 ExitPlanMode / plan_review / 历史文件识别测试；全量 183 文件 / 1986 项、Renderer/Node typecheck、生产构建与知识库严格校验通过。

## 2026-08-16 功能：思考翻译支持免账号本地模型与互斥提供方（v2.21.81）

- 设置页将翻译能力从“过程展示方式”拆成独立“思考翻译”分区，提供“不启用翻译 / 本地轻量翻译 / Microsoft 云端翻译”三个互斥状态；译文显示和 1～5 秒频率由两种提供方共用。
- 本地方案采用 `Xenova/opus-mt-en-zh` q8 量化模型，实际缓存约 119.5 MB；用户可在设置中下载并启用、查看下载进度或删除。下载后推理不需要账号、Key 或网络，质量目标为快速可读而非高精度。
- CPU 推理在 Electron `utilityProcess` 中运行，避免阻塞主进程和 Renderer；模型缓存位于 `userData/thinking-translation-models/opus-mt-en-zh`，完成标记控制离线可用状态，删除操作限制在模型根目录内。
- 旧版 `thinkingTranslationEnabled=true` 自动迁移为 `provider=azure`；翻译 store 将提供方纳入请求和缓存复用边界，切换本地/云端时不会混合旧译文，本地单块限制为 900 字符以适配 Marian 上下文和实时延迟。
- 新增 `@huggingface/transformers@3.8.1` 与 ONNX Runtime 构建许可；回滚时可删除依赖、worker/manager、IPC 与本地设置区，并将 provider 迁移回布尔开关。模型文件不打进安装包，只由用户按需下载和删除。

## 2026-08-16 优化：翻译凭据增加官方入口并扩展更新频率（v2.21.80）

- 设置页在 Microsoft Translator 凭据标题右侧增加“获取 Key”入口，打开 Microsoft Learn 官方 Translator 资源创建与认证密钥说明。
- 更新频率从 2、2.5、3 秒扩展为 1、2、2.5、3、4、5 秒；Renderer 调度、App Store、主进程设置校验和持久化清洗范围同步统一为 1～5 秒，默认值仍为 2.5 秒。
- UI 保留现有卡片层级，链接使用 32px 次级按钮并在窄宽度下与标题保持两列留白；频率按钮允许换行。

## 2026-08-16 功能：思考内容通过 Azure Translator 近实时翻译（v2.21.79）

- 目标：在不改变 Kimi Code 官方思考事件、历史和流式性能边界的前提下，将当前可见思考按 2～3 秒节奏自动翻译为简体中文。
- 实现：新增默认关闭的思考翻译设置，支持仅中文/中英对照和 2、2.5、3 秒频率；Azure Key 由主进程 `safeStorage` 单独加密，Renderer 只调用凭据状态、保存/清除、测试和翻译 IPC，不能读取明文。
- 流式边界：翻译调度接在 `activeTurnDraftStore` 聚合后的叶子渲染层；只发送新增完整句段，单键串行、全局最多 2 个请求，使用 source version 丢弃过期响应，隐藏/卸载的思考不继续排队。落定块立即补译尾巴，中文块跳过服务，代码段使用占位保护，任何失败都回退官方原文。
- 安全边界：自定义 Endpoint 仅允许 Microsoft Translator 或 Cognitive Services 官方 HTTPS 根地址，避免把订阅密钥发送到任意主机；凭据不进入 AppSettings、会话历史或日志。
- 验证：Azure Provider 与增量调度定向测试覆盖认证/限流/超时、Endpoint 限制、2.5 秒合并、增量句段和落定补译；Node/Renderer typecheck、知识库校验和生产构建由本轮统一收尾。

## 2026-08-13 功能：通过官方 extra_skill_dirs 接入外部 Skill（v2.21.60）

- 目标：实现类似 Codex 的外部 Skill 来源接入，但不恢复 Kimix 私有扫描、单项勾选或目录复制。
- 实现：运行时 Skills 页面新增“官方附加 Skill 目录”，选择/添加/移除均读写 Kimi Code `config.toml` 的 `extra_skill_dirs`；配置适配明确映射 `extraSkillDirs -> extra_skill_dirs`。移除只撤销登记，不删除原目录。
- 官方语义：附加目录与用户、项目、Plugin、内置 Skill 一并由 Kimi Code 发现；不会像 `skillDirs/--skills-dir` 那样替换默认 user/project 来源。同名优先级继续由官方注册表决定。
- 实测：在隔离 Kimi Home、工作目录 `D:\WORKS\LuaProjects\LuaSource_超级投资大亨` 下登记 `C:\Users\Administrator\.eggitor\codex\fs\skills`，官方 `session.listSkills()` 返回 `eggy-fs-design`，路径为 Eggitor 原始 `SKILL.md`，来源为 `extra`；同时用户级 `.agents/skills` 和内置 Skill 仍存在。

## 2026-08-13 功能：升级 Kimi Code 0.35 并接通 Skill 附件（v2.21.59）

- 上游：vendored Kimi Code 从 `0.34.0` / Node SDK `0.15.3` 升级到官方 `0.35.0` / Node SDK `0.16.0`，来源提交 `f6ee44e4`；仅保留既有 MCP 启动超时 overlay。
- 补齐：官方 Server 的 Skill 激活已经支持图片、视频和文件附件，Kimix 现复用普通 prompt 的上传/物化协议将附件随 `/skill:` 同一轮发送，不再在 Composer 直接拒绝。
- 兼容：官方 Node SDK 公共 `activateSkill(name,args)` 暂未开放附件参数；落到 SDK fallback 且带附件时明确失败，不拆成错误的第二个 prompt。无附件 Skill 仍正常走 Server/SDK 双路径。
- 验证：vendor host prompt/steer/cancel smoke probe；Skill API、路由和事件定向 3 文件 137 项；Node/Renderer typecheck 通过。

## 2026-08-13 重构：Skill 加载回归 Kimi Code 官方注册表（v2.21.58）

- 根因：Kimix 曾自行扫描多套 Skill 目录、维护勾选状态并复制到 `~/.kimix/enabled-skills`，但该目录未接入会话；显式 `/skill:` 找不到时还会复制到 Kimi 用户目录并通过 reload/透明 fork 刷新注册表，形成与官方发现和优先级并行的第二套体系。
- 修正：移除本地扫描、勾选、ZIP 导入、私有复制、自动迁移和新 `skill-*` fork 生产链路；补全与调用只使用官方 `listSkills` / `activateSkill`。设置页仅保留官方运行时 Skills 与官方 Plugin 商店。
- 兼容：不自动删除 `~/.kimix/skills`、`~/.kimix/enabled-skills` 或已复制到 Kimi 用户目录的文件；旧 `skill-*` 会话关系继续只读解析，避免历史会话重复或正文回退失效。
- 验证：Node/Renderer typecheck；官方 Skill API、斜杠路由、事件映射、旧会话兼容和 UI 风格定向 5 文件 207 项通过。

## 2026-08-13 优化：背景信息窗口模型区与推荐区边距对齐（v2.21.57）

- 现场：背景信息窗口的模型名称、百分比、Token 说明和进度条比下方“推荐会话长度”左右各多缩进 16px，视觉上像向内缩了两圈。
- 根因：浮层外壳已有 16px 水平 padding，模型项又使用带背景圆角语义的 `kimix-inset-section` 并追加 16px 水平 padding；推荐区只有外壳的一层 padding。
- 修正：模型项移除内嵌卡片外观语义及额外水平 padding，仅保留 10px 垂直呼吸，使两段内容统一落在浮层的 16px 左右轴线上。
- 验证：UI 风格定向 3 文件 49 项、Node/Renderer typecheck、生产构建通过。

## 2026-08-12 修复：月度额度续期候选不丢失且认证任务绑定账号（v2.21.56）

- Review 发现：旧 localStorage/Cookie Token 调用会员接口验真期间，真实 `/apiv2/` Bearer 会被 `capturing` 布尔锁直接丢弃；全局认证 Promise 还会跨交互模式或账号约束复用，设置页主动登录未传 Kimi Code 用户身份。
- 修正：新增按 `request > cookie > storage` 优先级串行处理的候选队列，锁期间到达的新 Bearer 在当前验真后继续处理；成功后停止并清空其余候选。认证任务协调器只复用同交互模式、同预期用户的任务；交互登录接管后台刷新，不允许冲突后台任务并行操作同一持久分区。
- 账号边界：交互登录优先复用基础用量已识别的用户 ID，否则从 Kimi Code OAuth JWT 取得 subject；无法确认身份时不开网页窗口，网页 Token subject 不一致时不写入 safeStorage。
- 回归：新增 deferred Promise 竞态测试，证明旧凭证验真未完成时新请求 Bearer 不丢失且优先处理；新增任务复用、冲突后台跳过、交互接管测试。

## 2026-08-12 修复：月度额度网页登录凭证以会员接口验真和续期（v2.21.55）

- 现场：设置显示网页 JWT 到 11 月才到期，但套餐用量的会员统计接口已返回 HTTP 401；持久登录会话未能自动恢复。
- 对照：参考仓库的月度/赠送额度网页 Token 明确约 30 天有效且不支持自动续期；其会员请求只发送 `Authorization`、`Content-Type`、`connect-protocol-version`。Kimix 自建的持久网页续期此前只按 JWT `exp` 选候选并额外伪造 Cookie/Origin/设备等请求头。
- 根因：JWT 声明未到期不代表服务端未提前撤销；旧采集会反复保存一个本地看似有效、实际已被会员接口拒绝的候选，查询头也偏离已验证参考实现。
- 修正：会员请求头对齐参考实现；保存前必须由会员接口验真；401 后加载持久会员额度页，从页面真实 `/apiv2/` 请求的 Bearer 头捕获候选并验真，成功后才覆盖安全存储并重试查询。Cookie/localStorage 仅保留兼容兜底。
- 边界：若 Kimi 的长期网页会话本身已退出，后台无法无交互续期，仍需用户重新登录；设置页改称“JWT 声明到期”，避免把 `exp` 误解为服务端有效性承诺。

## 2026-08-12 修复：文件变更只归属本轮 Git 增量（v2.21.54）

- 现场：新会话只发“你好”，回复没有调用任何工具，却显示 154 个文件、43891 行新增。
- 实证：官方 `session_cfa8b107-3980-46dc-bda4-fa95ca1f56b5` wire 只有 prompt、LLM、think/text 与 turn ended，思考还明确写明“不需要使用任何工具”；项目在会话前已有大量暂存/未跟踪文件。
- 根因：轮次结束 Git fallback 读取整个工作区相对 HEAD 的累计 numstat，新会话没有历史 change path 可排除，导致既有脏状态全部冒充本轮变更。
- 修正：主进程在 prompt hooks/runtime dispatch 前抓取并发布 Git HEAD + numstat 基线；completed 在 HEAD 未变化时只补基线到结束快照的净增量。没有可信发送前基线、或本轮 commit/rebase/reset 令 HEAD 改变时关闭 fallback，继续信任 Write/Edit/diff 等协议事件。
- 快照：`docs/issue-git-fallback-preexisting-worktree-events-snapshot.md`。

## 2026-08-12 修复：未连接的新会话仍可配置和操作（v2.21.53）

- 现场：选中项目的新会话尚未创建官方 runtime 时，权限、Swarm、Plan、思考强度等 Composer 控件因没有 `activeMutationOwner` 被统一禁用；欢迎页快捷任务还会被其他会话残留/后台运行的全局 `runningSessionId` 一并锁住。
- 根因：界面把“当前有唯一 runtime Agent”错误当成所有交互的前置条件，未区分下一轮本地配置、项目级操作与必须绑定运行时的停止/引导操作。
- 修正：新增“可配置下一轮”能力；新会话可修改权限、Plan、思考强度和 Swarm，前 3 项使用默认/草稿状态，Swarm 只写本地 desired 状态且不提前连接，首次发送时再创建 runtime 并应用。欢迎页快捷任务只锁当前提交，不再受其他会话运行标记影响，并沿用草稿权限、Plan 与 Swarm。
- 边界：已有多 Agent 房间在目标不唯一时仍锁定 Agent 专属配置；停止、引导等运行时操作仍要求明确的活动 runtime。

## 2026-08-12 修复：Swarm 开启态被通用按钮静止态覆盖（v2.21.52）

- 现场：v2.21.51 已生成正确的 toggle selected 内凹材质，Swarm DOM 也有 `aria-pressed=true`，但截图中仍无浮雕。
- 根因：Swarm 同时带 `.kimix-icon-text-button` 与 `.kimix-state-button`。自定义风格的通用 control 选择器包含三个 `:not(...)`，优先级高于专用 toggle selected 选择器，导致后声明的 selected 阴影仍被通用 resting 覆盖。
- 修正：`.kimix-state-button` 从通用 control 的 resting/hover/active 三组消费者中退出，完整交由 toggle 专用状态机管理；未开启静止、hover、active、`aria-pressed=true` 不再互相抢样式。
- 回归：CSS 消费契约断言通用 control 三个状态都显式排除 `.kimix-state-button`。

## 2026-08-12 修复：开启、选中和菜单展开态恢复持续立体强调（v2.21.51）

- 现场：普通按钮静止态收敛后，Swarm/Plan 开启态、菜单选中项及部分已展开菜单触发器可能缺少持续浮雕，状态与未选中项辨识不足。
- 根因：v2.21.50 只规定 quiet resting，没有规定 selected 的材质深度下限；导入 JSON 可为 `menuItem.selected` 等配置非透明表面但 `elevation: none`。部分 Composer 下拉触发器使用 `.kimix-control-button[aria-expanded]`，也未显式消费菜单 selected 契约。
- 修正：参照内置复古/怀旧状态语义，`toggle`、`menuTrigger`、`menuItem`、`roomChoice` 未写 selected 时完整继承 `basedOn` 对应选中态；已写非透明 selected 但无 elevation 时继承其 selected/active 深度（复古/怀旧为按下内凹），并保留导入表面、边框与圆角。普通 control 的 `aria-expanded=true` 显式消费 menuTrigger selected 材质。
- 回归：新增 selected depth 契约与 Composer 普通控件菜单展开 CSS 映射测试。

## 2026-08-12 修复：顶部启动与打开分段按钮漏出静止态治理（v2.21.50）

- 现场：v2.21.49 已收敛 Composer 与普通按钮，但顶部启动、打开项目两组分段按钮仍常驻浮雕背景。
- 根因：两组按钮消费专用 `compoundControl` 角色；上一轮将结构性复合控件排除在安静静止态名单外，导致导入配置中的 loud resting 继续生效。
- 修正：`compoundControl` 静止态继承 `basedOn` 中普通 `control.resting`，避免 Y2K 的 `basedOn: nostalgia` 继续继承内置复合控件的常驻浮雕；导入半径和 hover/active 仍保留，菜单展开态继续使用 hover 材质明确反馈。既有导入无需重导。
- 回归：扩展静止态契约测试覆盖 `compoundControl`，验证怀旧基线下仍为扁平静止态，并验证悬停缺失 elevation 时仍能继承普通 control 的交互层次。

## 2026-08-12 优化：导入风格普通按钮静止态保持克制（v2.21.49）

- 现场：自定义导入风格把 Composer 的 Swarm、Plan、思考以及大量普通按钮在未悬停、未选中时也绘制成带背景、边框和浮雕的高强调控件，页面到处都是同等醒目的按钮，状态辨识度反而下降；内置风格只在 hover/selected 时强调。
- 根因：UI Style v1 允许导入文档覆盖普通交互角色的 `resting`，固定 CSS 消费层会忠实应用该材质。AI 生成的 Windows/Y2K 文档为 `control`、`toggle` 等 resting 配置了完整 plate/elevation，Kimix 没有状态层级治理。
- 修正：自定义风格规范化时，`navigationItem`、`navigationAction`、`control`、`toggle`、`menuTrigger`、`menuItem`、`roomChoice` 的 resting 强制继承 `basedOn` 内置基线；导入文档的 radius、hover、active、selected 仍保留。`primaryAction` 和 `compoundControl` 不受影响，真正主操作与结构性复合控件仍可常驻强调。
- 兼容：治理发生在运行时 canonicalize，既有已导入 JSON 无需重导；下次加载即自动收敛。AI 提示同步明确普通按钮只在悬停或选中时醒目。
- 回归：新增七类普通交互角色 loud resting 被基线替换、hover/selected 保留、primaryAction resting 不被改写的契约测试。

## 2026-08-12 优化：月度额度使用持久网页会话按需续期（v2.21.48）

- 诉求：网页 access token 有效期很短，不应要求用户频繁重新登录；希望内置浏览器保持登录，在查询额度时后台获取新凭证。
- 根因：此前登录窗口使用随机非持久 partition，捕获 access token 后立即清空整个会话；这主动销毁了 Kimi 的长期登录/refresh 状态，只能保存一枚短期 token。
- 修正：月度额度改用独立持久 partition `persist:kimix-monthly-quota-auth`。用户首次交互登录后关闭窗口但保留专用浏览器存储；每次查询前创建不显示的后台窗口访问 Kimi Code 控制台，让网页自行刷新 `localStorage.access_token`，捕获后关闭后台窗口并用新 token 查询。后台刷新 6 秒内失败时回退当前未过期 token，不阻断基础套餐用量。
- 安全与清理：专用会话不与主应用浏览器上下文混用；Token 仍加密保存且不进 renderer/日志；用户点击“清除 Token”时同时清除加密文件、专用 partition 存储和缓存，相当于退出该专用网页登录态。
- UI：设置页将短时间解释为“当前访问凭证到期”，明确会在查询时按需自动更新，不再暗示用户需要按该时间手动重登。

## 2026-08-12 修复：月度额度选择真实 access_token 并发送会话身份（v2.21.47）

- 复验：v2.21.46 补齐通用网页头后仍返回 HTTP 401，说明“接口拒绝”只是准确诊断，不是功能闭环。
- 根因：Kimi Code 控制台明确使用 `localStorage.access_token`；Kimix v2.21.45 将所有 localStorage JWT 混合后按到期时间择优，长期 refresh Token 可能压过短期 access Token。当前会员请求还需要从 access JWT 提取 `device_id`、`ssid`、`sub`，分别发送 `x-msh-device-id`、`x-msh-session-id`、`x-traffic-id`。
- 修正：页面存储捕获保留键名并给精确 `access_token` 最高优先级，其次才比较 Kimi app、设备、会话、用户声明与到期时间；会员请求补齐三项 JWT 派生身份头。
- 回归：候选测试锁定长期 `refresh_token` 不得压过较短期 `access_token`；请求契约锁定设备、会话、流量身份头。

## 2026-08-12 修复：有效网页 Token 不再被会员接口误判过期（v2.21.46）

- 现场：v2.21.45 自动获取成功，套餐小窗却立即提示“Token 无效或已过期”，同一卡片显示 JWT 本地到期日为 2026/11/10。
- 根因：本地 `exp` 证明 Token 尚未过期；401 来自会员接口。Kimix 请求只发送 Bearer、Content-Type 和 Connect 版本，而成熟网页用量实现还会携带 `Cookie: kimi-auth=...`、`Origin`、`Referer`、浏览器 User-Agent、语言、平台与时区上下文。服务端拒绝缺少网页上下文的请求后，Kimix 又把所有 401 错误统称成“无效或已过期”。
- 修正：会员统计请求补齐 Kimi 网页上下文头，Bearer 与 Cookie 使用同一 safeStorage 凭证；本地到期判定仍只依据 JWT `exp`。HTTP 401 改为“会员接口拒绝当前凭证”，不再冒充本地过期结论。
- 回归：请求契约测试锁定 Cookie/Origin/Referer/User-Agent/平台/语言头；新增未过期 JWT 收到 401 时不得显示“已过期”的诊断测试。

## 2026-08-12 修复：内置登录同时捕获页面存储凭证（v2.21.45）

- 复验：v2.21.44 已直达 Kimi Code 控制台，页面头像确认登录成功，但 Kimix 仍显示“等待登录”；持续查询 Electron Cookie store 也未得到 `kimi-auth`。
- 根因：参考仓库的真实提取逻辑并非 Cookie-only，而是同时收集 `document.cookie` 与 `localStorage` 中的 JWT，并按 `app_id=kimi`、`sub` 和有效期择优。Kimix v2.21.43/v2.21.44 只观察 Cookie，因此 Token 落在页面存储时永远无法完成。
- 修正：主进程在受限的 HTTPS kimi.com 登录窗口中，Cookie 未命中时读取最多 32 个、单项不超过 16 KiB 且以 `eyJ` 开头的 localStorage 候选；只保留结构有效、未过期、有到期时间的 JWT，并优先选择 `app_id=kimi` 且带用户身份的候选。捕获值仍不进入 renderer 或日志。
- 回归：新增过期、通用 JWT、Kimi 用户 JWT 的候选优先级测试，以及登录窗口页面存储捕获的源契约测试。

## 2026-08-12 修复：内置登录完成后未自动获取月度额度凭证（v2.21.44）

- 现场：一次性内置浏览器在 Kimi 首页完成账号登录后仍停留在窗口内，设置页一直等待，未保存网页 Token。
- 根因：自动获取从 `https://www.kimi.com/` 首页发起；通用登录态不保证立即建立 Kimi Code 额度控制台使用的 `kimi-auth`。官方用量集成的网页凭证入口是 `/code/console`，现有流程也只依赖 Cookie 变更事件与页面加载后单次读取。
- 修正：登录窗口直接进入 `https://www.kimi.com/code/console`，确保登录回跳落在会产生额度凭证的产品页；窗口存活期间每 750ms 在主进程补查一次 `kimi-auth`，捕获成功或窗口关闭时清理轮询，单次 Cookie 读取异常不再终止等待。
- 边界：仍使用唯一非持久 partition、只允许 HTTPS kimi.com 域、Token 仅在主进程经 `safeStorage` 保存；手动配置继续作为上游登录行为变化时的备用路径。

## 2026-08-12 优化：月度额度凭证支持登录后自动获取（v2.21.43）

- 诉求：不再要求用户打开开发者工具手动寻找 `kimi-auth`，设置中提供一键进入可自动抓取凭证的登录流程。
- 边界：系统浏览器 Cookie 对 Kimix 不可读，因此使用主进程创建的一次性内置 Kimi 登录窗口；窗口采用唯一非持久 partition，只允许 HTTPS kimi.com 及子域留在窗口中。
- 实现：用户点击“打开 Kimi 并自动获取”后完成网页登录；主进程监听 `kimi-auth` Cookie，校验 JWT、写入 `safeStorage`，清空临时浏览器会话并自动关闭。关闭窗口视为取消，手动粘贴仍作为备用入口。
- 回归：URL 白名单测试覆盖 Kimi 主域/子域、HTTP 和伪装域；全量 178 文件 / 1926 项测试、双 tsconfig typecheck、knowledge validate 和生产构建通过。

## 2026-08-12 功能：套餐小窗增加月度与赠送额度查询（v2.21.42）

- 参考实现：`kimi-code-dashboard` 使用 kimi.com 网页 JWT 调用 MembershipService `GetSubscriptionStats`，与 Kimi Code Coding OAuth 属于不同认证域；返回 `subscriptionBalance` 与 `giftBalances` 的已用比例和到期时间。
- 修正：账户与连接设置新增独立“月度额度查询”区，默认关闭；支持粘贴 JWT、`Bearer` 值或完整 `kimi-auth=...` Cookie，凭据经 Electron `safeStorage` 加密保存且不回显，支持覆盖与清除。
- 展示：底部套餐用量小窗在原有 5 小时/每周/额外用量之后展示月度总额度和赠送额度；基础用量与月度查询使用独立 IPC，私有接口超时或变更不会阻塞基础数据。
- 治理：移除使用 Coding OAuth 串行探测 6 个历史订阅地址的错误链路；Token 过期和已知账号不一致在本地拒绝请求。
- 回归：月度解析测试覆盖 Cookie 归一、比例/到期时间、账号不一致阻断与唯一接口/协议头；全量 177 文件 / 1923 项测试、双 tsconfig typecheck、knowledge validate 和生产构建通过。

## 2026-08-12 调整：外观设置按职责拆分（v2.21.41）

- 现场：“界面字号”和“对话刻度”被放在“界面风格”预设与导入操作下方，造成材质风格、阅读偏好和导航偏好看起来属于同一配置块。
- 根因：外观页只定义 `theme`、`palette` 两个 section；主题、界面风格、字号和对话刻度全部堆在 `theme` 的一个 DOM section 中，搜索也把字号归到“主题与字号”。
- 修正：外观页拆为“主题 / 界面风格 / 显示与阅读 / 色彩方案”四个独立、可搜索、可聚焦、可拖拽 section；界面风格只保留预设、JSON 导入和 AI 提示，字号与对话刻度迁入显示与阅读。
- 回归：导航测试锁定 `uiStyle`/`display` 页面归属和搜索结果；结构测试锁定界面风格区间不再包含字号/对话刻度。全量 176 文件 / 1919 项、typecheck、knowledge validate 和生产构建通过。

## 2026-08-12 修复：结构化提问进入思考工具链并保持主题样式（v2.21.40）

- 现场：待回答的 `question_request` 被排除在 `turnBlocks` 外，显示为思考工具链下方独立的大卡片；选择答案或聚焦“其他回答”后，局部 Tailwind 状态色覆盖导入 UI Style 的控件材质。
- 根因：`buildTurnBlocks` 明确跳过 pending question，`ChatThread` 又只折叠 resolved question；`QuestionCard` 的选中/聚焦态直接声明 border/background，而没有持续消费 `.kimix-room-choice` 与 field 语义角色。
- 修正：pending/answered/skipped 提问统一保留在原始事件位置的 question block；过程链内 pending 状态渲染可交互标准过程卡，提交后同位置切为只读结果；答案选项与自定义输入分别由 room-choice/field 主题契约完整接管。
- 回归：turnBlocks 与 ChatThread 锁定 pending 不再生成独立行；MessageBubble 组件测试锁定过程卡表面和答案控件语义类。全量 176 文件 / 1918 项、typecheck、knowledge validate 和生产构建通过。

## 2026-08-12 修复：无差异提示可正常展开与收起（v2.21.39）

- 现场：文件变更行点击预览后显示“未找到可确认属于本轮的差异”，但箭头仍朝右、操作仍显示“预览”，再次点击无法收起提示。
- 根因：错误提示由 `previewErrors` 无条件渲染，而箭头、按钮文字和点击切换只把结构化 diff 或已加载 patch 视为展开内容；无差异分支未写入 `expandedDiffs`。
- 修正：无差异与加载错误提示统一纳入文件预览展开状态；提示出现时箭头朝下、操作显示“收起”并暴露 `aria-expanded=true`，再次点击隐藏提示并恢复收起态。
- 回归：`ChangeCard.test.ts` 新增 unavailable preview 的展开/收起闭环；全量 176 文件 / 1917 项、typecheck、knowledge validate 和生产构建通过。

## 2026-08-11 修复：单 Agent 残留态发送路径真正降级为普通会话（v2.21.32）

- 现场：v2.21.31 的 hasMultipleRoomAgents 入口门禁让“单 Agent 残留态”（collaboration 存在但 active Agent 只剩 primary，如加过 Agent 又全部移出）改走普通发送路径，但该路径只写 session.events；projectCollaborationTimeline 在有 collaboration 时只从 collaboration.messages + agentEvents 投影、忽略 session.events，回流时 replaceRoomAgentEvents 又经 mirrorPrimaryAgentToLegacySession 用 agentEvents[primary] 整体替换 session.events，导致新发 userEvent 在聊天时间线不可见、回流后被覆盖丢失（临时 vitest 复现：发送后时间线无该事件，回流后 session.events 不含该事件）。
- 根因：门禁只改了“路由”（绕过房间投递），没改“状态”（collaboration 仍挂在会话上），下游投影/回流/mirror 仍按房间逻辑处理，数据流断裂。
- 修正（方案 A）：发送入口检测到 collaboration && !hasMultipleRoomAgents 时调用 degradeSingleAgentRoomSession（src/utils/sessionDegrade.ts）一次性降级为普通会话——用 projectCollaborationTimeline 投影合并 messages + agentEvents 历史进 session.events、过滤 open delivery 空占位、清除 collaboration/unsupportedCollaboration 并持久化（持久化失败忽略、幂等）；此后下游全走纯普通逻辑，重新添加 Agent 时也从最新 events 重建房间，历史不丢。
- 验证：新增 sessionDegrade.test.ts 5 项（无 collaboration 同引用 / 多 Agent 不降级 / 残留态合并历史并过滤占位 / 幂等 / 降级后普通发送在时间线可见）；房间相关 6 文件 87 项全绿；双 tsconfig typecheck 通过。子代理并行实现与测试，主代理抽查复核后收尾。


## 2026-08-11 修复：发送路径单 Agent 惰性降级避免误拼房间模板（v2.21.31）

- 现场：天然的普通对话（从未增加过其他房间 Agent）发出的消息在官方 Kimi Code 后端历史记录中带有 【Kimix 房间正文｜仅作背景】 前缀。
- 根因：发送逻辑 sendPromptContent（Composer.tsx:1572）只要 targetSession.collaboration 结构存在就无条件走 sendRoomPrompt。buildRoomDeliveryPrompt 的无前缀保护要求 contextShare/identity/deliveryIdentity 三者全缺才返回原文，而房间链路默认总是传入 Agent 身份，导致单 Agent 会话（或移出所有 Secondary Agent 后的残留房间态）发送给后端的 Prompt 也被强制拼上了多 Agent 房间前缀。
- 修正：在 Composer.tsx:1572 的入口处使用 hasMultipleRoomAgents(targetSession) 进行门禁拦截。当会话仅有 1 个主 Agent（单 Agent 对话/移出后残留态）时，直接走普通消息发送流程，不再进行房间前缀包装与队列投递；保留原有的 collaboration 历史数据与被移出 Agent 的恢复能力，避免静默破坏存储结构。
- 验证：全量 175 个测试文件 / 1910 项单元测试（新增 hasMultipleRoomAgents 状态识别断言）与 pnpm typecheck 全部一次性通过。
