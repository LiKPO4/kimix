# Kimix 长程任务状态
## 2026-08-06 修复：footer 上重叠 + 顶部渐变，消息淡出而非硬切（v2.20.255）

- 现场：输入框上方仍有一短行实色背景硬切聊天文字。修复：`.kimix-app-shell-footer` 加 `margin-top:-28px` 向上重叠聊天滚动区（flex 布局让滚动视口随之延长 28px），背景改 `linear-gradient(transparent → surface-base 28px)`，滚来的消息在渐变带里淡出；modern 覆写同步。关键认知：此前单纯给 footer 加透明渐变无效——footer 与滚动区是兄弟节点不重叠，透明带后面只有应用底色，必须负 margin 制造重叠。

## 2026-08-06 修复：Dock 胶囊行脱离文档流悬浮，不再占 footer 背景带（v2.20.254）

- 现场：胶囊行在 footer 实色背景带上占一整行，用户要求"胶囊悬在后面的内容之上，不带一行背景"。修复：ComposerDockBar 根节点改 `position:absolute; bottom:100%`（锚定 Composer relative 根），不占 footer 高度，胶囊直接浮在聊天滚动区底部内容上；展开面板仍向上弹出。DockBar 7 例、build 通过。

## 2026-08-06 修复：胶囊圆角风格分化 + 撤掉滚动区渐隐 mask（v2.20.253）

- 现场：① default/modern/retro 胶囊都是 999px 同样式，用户期望默认圆角稍小、复古更小；② 底部渐隐 mask 反而像"一层背景挡住后面内容"。修复：胶囊圆角改 `var(--ui-radius-xl, 10px)`（默认 10/modern 14/retro 6/nostalgia 0）；删除 `.kimix-chat-scroll-area` 的 mask-image——footer 本就是实色兄弟节点，消息在滚动边界干净截断，渐隐只会制造遮挡错觉。

## 2026-08-06 微调：Dock 胶囊补默认轻描边（v2.20.252）

- 现场：251 令牌化后 modern/default 下 --ui-control-border 为透明，胶囊几乎隐形。修复：基础规则回退 `1px solid var(--border-subtle)` + hover `--border-default`，nostalgia 覆写保持 `--ui-control-border` 浮雕。uiStyles 18 例、build 通过。

## 2026-08-06 修复：Dock 胶囊风格化真正失效根因——用户是 nostalgia 主题（v2.20.251）

- 现场（用户 v2.20.250 截图）：胶囊仍是扁平灰底细边，没吃到任何风格化。250 只补了 `[data-ui-style="retro"]` 覆写，但项目有四套界面风格（default/modern/retro/nostalgia），用户截图（直角硬边、永久浮雕按钮）是 **nostalgia（怀旧，Win98 硬浮雕）**，retro 覆写根本不命中——上一轮修错了目标。
- 根因治本法：胶囊不再按风格打补丁，基础规则直接吃项目语义控制令牌（与其他按钮同一体系）：`border: var(--ui-control-border)`、`box-shadow: var(--ui-control-shadow)`、hover 用 `--ui-control-hover-*`、展开态用 `--ui-toggle-background/--ui-toggle-shadow`。四套风格自动生效：nostalgia 永久浮雕+展开内凹、retro 扁平 hover 浮雕、default/modern 柔和 hover。
- 同步：删除 250 的 retro 专属覆写；nostalgia 下胶囊/面板圆角走 `--ui-radius-*`（0px 直角）；dock 面板半透明覆写扩展到 nostalgia。
- 验收：uiStyles 契约 18 例 + DockBar 7 例、typecheck 通过。实机待用户截图验收（nostalgia 浮雕、retro 扁平 hover 浮雕）。
- 关键文件：`src/index.css`（.kimix-dock-capsule/.kimix-dock-panel）。

## 2026-08-06 修复：Dock 胶囊 retro 风格化 + 面板遮挡 + X/收起按钮语义拆分（v2.20.250）

- 现场（用户 v2.20.249 retro 主题截图）：① 胶囊本体没吃到复古风格化（扁平描边，无浮雕）；② 展开面板实心遮挡对话内容，影响阅读；③ 面板头部唯一的 X 实际是「收起到侧栏」，语义错误——X 应是关闭浮窗（同点胶囊），收起到侧栏应是另一个按钮，且四个胶囊都该有。
- 修复：
  - `index.css`：`.kimix-dock-capsule` 增加 retro 覆写（浮雕按钮语言：顶高光+投影、hover 用 --kimix-retro-button-hover-*、expanded 内凹 pressed）；`.kimix-dock-panel` retro 覆写改为 92% 半透明 + blur(8px)（与现代一致思路，不再实色遮挡）；聊天滚动区底部渐隐 24px→32px。
  - `ComposerDockBar`：头部拆两按钮——X=关闭浮窗（仅 setOpenPanel(null)），PanelRightClose=收起到侧栏（onHide + 关浮窗）；`panelConfig` 四胶囊全部支持 onHide（新增 onHideBash/onHideSubagent props）；面板 maxHeight min(360px,50vh)→min(300px,42vh)。
  - `ComposerDockCard` 类型加 "bash"/"subagent"；Composer 按 hiddenCards 抑制对应胶囊并传收起回调；AppShell `hiddenComposerCardEntries` 增加后台 Bash/子 Agent 恢复条目（整个 entries 块移到 bashTasks 声明之后，修复声明顺序）。
- 验收：ComposerDockBar 测试更新为 7 例（X 只关浮窗不触发收起、收起按钮两语义、四胶囊收起按钮齐全）；全量 vitest、typecheck、knowledge:validate 通过。实机待用户截图验收（retro 浮雕、面板半透明、两按钮）。
- 已知边界：retro 面板半透明是本轮用户反馈驱动的调整，覆盖了 249 时「复古保持实色」的决定。知识库：无需更新。
- 关键文件：`src/components/chat/ComposerDockBar.tsx`、`src/index.css`、`src/types/ui.ts`、`src/components/chat/Composer.tsx`、`src/components/layout/AppShell.tsx`。

## 2026-08-06 重构：输入区 Dock 卡片改官方式胶囊行 + 遮挡优化（v2.20.249）

- 现场（用户 v2.20.246 截图）：① Composer 上方 TodoList 卡与排队消息面板是不透明实心卡+重阴影，遮挡聊天内容；② 卡片太重量级，要求改成官方 kimi-code web 的胶囊行（后台 Bash (N)/子 Agent (N)/待办 (done/total)/队列 (N)，点击向上展开面板）。用户拍板：胶囊对齐官方四类；展开面板半透明+背景模糊（复古主题保持实色）。
- 实现：
  - 新增 `ComposerDockBar`：四胶囊按数据>0 显隐，单面板互斥、document mousedown capture 点外关闭、数据清空自动关闭；面板 `absolute bottom:100%` 向上展开、maxHeight min(360px,50vh)。
  - `index.css`：新增 `.kimix-dock-capsule`（999px 圆角）/`.kimix-dock-panel`（color-mix 88% + blur(14px)，retro 覆盖实色无 blur）；`.kimix-chat-scroll-area` 加底部 24px 渐隐 mask，缓解 Composer 本体实心遮挡。
  - `TodoPanel` 删除卡片外壳，拆出 `todoCounts`/`TodoListItems` 供 dock 面板复用；`backgroundTaskTone/KindLabel/DurationLabel/Summary` 从 LongTaskInspectorPanel 迁至 `utils/backgroundTasks.ts` 双向复用。
  - `Composer` 新增可选 props `bashTasks/subagentTasks`（AppShell 由 splitBackgroundTasksByKind 传入）；排队消息列表面板迁入 dock「队列」胶囊，拖拽排序/引导/编辑/删除/更多菜单原样保留。
- 验收：新增 ComposerDockBar 6 例（显隐/计数/展开互斥/点外关闭/清空自闭/收起回调）；uiStyles、composerDraft 两处源码契约断言同步更新；全量 1671 例、typecheck、knowledge:validate、build 通过。实机待用户截图验收。
- 已知边界：队列「更多」菜单在面板 overflow 内可能被裁剪（与原 max-h-40 面板行为一致，未变差）；「当前任务结束后继续」头部提示随旧面板移除（每行已有 引导/等待/发送 状态）。知识库：无需更新（纯 UI 重构，无架构不变量变化）。
- 关键文件：`src/components/chat/ComposerDockBar.tsx`、`src/components/chat/Composer.tsx`、`src/components/chat/TodoPanel.tsx`、`src/utils/backgroundTasks.ts`、`src/index.css`。

## 2026-08-06 修复：steer 切分后前段轮不 settle（双滚动区/同文重复）+ 头部等待标签（v2.20.248）

- 现场（用户复验 v2.20.247 三截图，session_532ff5cb RemoveBlack steer「另外先把163构建出来放桌面上吧」）：① 同一段思考在上下两块重复出现；② steer 后屏幕上出现两个带滑块的 live 滚动区——上一区域输出已结束应折叠成总结；③ 消息/steer 发出后头部直接「k3-256k · 正在思考 35秒」，模型尚未产出任何内容，应为「等待模型输出」。
- 根因（代码级定位 + 证伪测试先行）：
  - ①②同根：244 条件切分把 steer 前段轮 flush 成独立渲染轮，但官方 turn 继续以同一 agentTurnId 运行，roomAgentActivityMatchesTurn 不看 isLatestTurn → 前段轮被判 isTurnActive → turnSettled=false → isAssistantActive=true：旧思考保持 live 滚动窗不折叠、footer 停「消息处理中」，且与 steer 后最新轮订阅同一份 draft → 同文两处渲染 + 双滚动区。重载窗口因 isSessionLevelTurnStopped 早已 settle，live 与 reload 形态不一致。
  - ③：237 的等待标签分支以 liveDraftKey 非空为跳过条件，但 draft 键随 activeTurnId 在发送时刻即建立（roomAgentActivities），模型未产出任何字符时头部已跳「正在思考」。
- 修复：
  - ChatThread：steer 切分 flush 传 hasLaterSteerBoundary → 与用户边界同语义计入 turnSettled（isSupersededBySteerBoundary，仅非最新轮生效）。前段轮按完成态渲染：思考折叠 teaser、footer 收尾，live 状态只留 steer 后最新轮。
  - activeTurnDraftStore 新增 useActiveTurnDraftHasOutput：布尔快照订阅（empty→非空才翻转重渲染，不破 237 叶子订阅性能不变量）；AssistantProcessBlock 等待分支改判 hasLiveDraftOutput，文案「等待模型输出」。
- 验收：证伪先行——live 会话 buildRenderItems 测试（session running + roomActivity 匹配同 agentTurnId）旧实现红（isAssistantActive=true）；修复后新增 3 例全绿；全量 1665 例、typecheck 通过。实机待用户验收（steer 后前段轮折叠为总结、只剩一个滚动区、发送后头部先「等待模型输出」）。
- 已知边界：steer 前无正文的 242 不切分语义不变；前段轮 settle 后 footer 在官方 usage.record 到达前显示「模型：X」兜底（与重载后形态一致）；模型 steer 后新 step 重新复述的相似思考属官方行为（241 边界），不做内容级去重。
- 关键文件：`src/components/chat/ChatThread.tsx`、`src/components/chat/MessageBubble.tsx`、`src/utils/activeTurnDraftStore.ts`、`knowledge/architecture/streaming-render-pipeline.md`（Invariant R）。

## 2026-08-06 修复：steer/resync 重放正文跨轮重复渲染（v2.20.247）

- 现场（用户 v2.20.246 截图，session_532ff5cb 12:10-12:22 窗口）：同一段「你好霖江路。先看下这条线的性质…关于那条竖线…」正文上下渲染两次（steer 前正式区 + steer 后本轮区），重载窗口后仍复发。
- 取证（IndexedDB blob 事件序列 + diag [live] anchor）：正式时间线已有 6gbye795m（正文 X，12:09:43）与 e2beahztr（正文 Y，12:10:54）；steer 后官方从 offset=0 累计重放 X+Y（12:11:41，161 字符；12:22:55 又重放到 585 字符），重放被吞进 draft 并在 12:11:46 材料化为 active-draft db5ea784（正文与正式 X 逐字节相同、thinking 是后续新段、delivery identity 相同）。三层防线各自的洞：① committedSegments 单槽——think-only 提交把 content 基准刷空，且重载后整体为空；② deduplicateTimelineEvents 的 deliveryContentKey 守卫其实能拦住这对（探针证实），但 live 时间线与 runtime-recovery 路径不经过它；③ collapseDuplicateMaterializations 只比对材料化互相签名，formal-vs-材料化同文漏过（探针证实双份存活）——这是重载后仍重复的直接原因。
- 修复：
  - draft 层（根因）：新增 buildFormalReplayCoverage + anchorStreamText 覆盖抑制——draft 为空且未锚定时，增量若落在「同 turn 已正式落盘正文/思考覆盖串」（各段单独 + 原始/\n\n 拼接两种累计形态）的同一 offset 前缀上即拒，偏离覆盖串自动恢复正常路径；≥8 字符才抑制（新步问候语「你好霖江路。」6 字符短前缀不误杀，正式提交时 greeting 由正式帧补全，与既有 committedSegments 误拒权衡一致）。useEventStream 按事件数组引用 WeakMap 缓存覆盖串，不引入每 delta O(历史)。
  - 持久化自愈层：collapseDuplicateMaterializations 扩展——同轮（user/steer 边界内）active-draft 正文与此前正式事件逐字节相同（≥16 字符）则清空其正文、保留思考段（对齐 deduplicateTimelineEvents 同语义）；只认「正式在前、材料化在后」顺序。
- 验收：证伪先行——抑制 3 例旧实现全红（累计重放/单步重放/思考重放均被吞进 draft）、collapse formal-vs-材料化 1 例旧实现红；修复后新增 9 例全绿（另含新步开头/问候短帧/无覆盖旧路径/反向顺序不误伤）；定向 309+94 例、全量 1662 例、typecheck、knowledge:validate、build 通过。实机待用户验收（同会话重载后不再双份；新 steer 后本轮只显示新增正文）。
- 已知边界：重放碎片极细（<8 字符首帧）时首帧可能漏抑随后续锚定拼入——实测官方重放首帧为 40-85 字符大块，残留风险低；材料化在正式帧【之前】到达的反向顺序仍靠既有签名去重与 243 块级前缀去重兜底。
- 关键文件：`src/utils/activeTurnDraftStore.ts`、`src/hooks/useEventStream.ts`、`src/utils/kimiHistoryReconciliation.ts`。

## 2026-08-06 修复：steer 会话历史自愈失效——边界等价映射 + 条件切分 + 缓存升版 20（v2.20.244）

- 现场（用户对照官方 kimi-web vs 重载后的 Kimix v2.20.243，session_532ff5cb）：官方结构 user → 工作轮 1 → steer → 工作轮 2（各自独立、内容完整）；Kimix 重载后两轮粘连成一个折叠轮（总耗时 7分0秒），轮 1 正文与总结长文「缺失」。重载窗口不能自愈。
- 取证（repair 决策日志 + 逐轮比对）：持久化内容其实未丢——「缺失」是渲染层 242 无条件「steer 不切 turn」把两轮粘连 + 243 text 前缀去重跳过总结；同时对账层本地 12 边界（9 user + 3 steer）vs canonical 8 边界，8/5 failed steer 抢占 canonical 轮导致对齐错位，fragment 补丁错误替换/跳过（diag 多次 rejected reason=process-history-regression 与 mismatchedTurns）。241 让本地比 canonical 少一条 steered user 边界是本轮新变量。
- 修复：
  - 渲染层条件切分（buildRenderItems）：steer 前同 user 轮内已有带正文 assistant → steer 作轮间边界切分（官方两轮结构）；steer 前无正文（打断生成中）→ 不切（242 语义保持）。
  - 对账层归一化（新增 normalizeSteerBoundariesForComparison，接入 kimiHistoryTurnBodies/mergeCanonicalFragmentTurnBodies/hasEquivalentKimiHistoryTurnBodies）：canonical 侧与本地 steer 内容匹配（30s 窗）的 user 归一为 steer 边界；本地 failed steer 与无 canonical 匹配的 steer 降级为非边界。只作用比较视图，不改本地时间线。
  - 缓存升版 KIMI_HISTORY_CACHE_VERSION 19→20：一次性重跑 repair 让受影响 steer 会话在新比较语义下自愈（232 先例；旧逻辑下这些会话边界数不等不会被误标 cache-current，升版是清创重跑）。
- 验收：新增 5 例（条件切分 + 归一化四例），两处证伪（禁用条件切分/禁用 failed 降级均失败）；定向 169 例、全量 1653 例、typecheck、knowledge:validate 通过。实机待用户验收（重载后两轮分开、steer 居中、各自耗时）。
- 已知边界：canonical getSnapshot 100 条截断使长会话尾轮（turn 8）不在 canonical——本轮靠渲染层条件切分让本地完整内容直接显示官方结构；对账补 turn 8 正文需 electron 层分页/转换（记为上游边界）。总结长文因 243 去重保留较早副本，折叠轮正文显示「提交完成…」、总结在过程时间线内展开可见（展示差异，未处理）。
- 关键文件：`src/components/chat/ChatThread.tsx`、`src/utils/kimiHistoryReconciliation.ts`、`src/utils/kimiHistoryCache.ts`、`knowledge/architecture/runtime-routing.md`。

## 2026-08-06 修复：steer 轮正文段落在过程时间线重复渲染（v2.20.243）

- 现场（用户 241 截图，session_532ff5cb 08:53-08:55 steer 轮）：「你好霖江路。 dist/ 里的构建产物还在，我直接再复制一份到桌面。」在时间线出现两次（ls -la 工具卡前 + CHANGELOG 工具卡前）。
- 取证（diag [live] anchor + wire + IndexedDB）：官方在 steer 确认后重放 step 1 完整正文（body offset=0 regression:true prevOffset=6，191 字符）；而 step 1 的 live 正文只推了 35 字符且在工具边界未 commit 滞留 draft store；重放流因 draft 非空绕过 offset=0 回放判定（`!acc` 语义）被吞进 draft；滞留 35 字符随后被 step-4 思考附着、08:55 重新材料化为第二个事件。两个 text 段前 34 字符逐字相同（仅结尾标点「：」vs「。」不同）。
- 修复：`buildTurnBlocks` text 块分支新增同 turn 长前缀去重（完全相同/前缀包含/前 ≥20 字符逐字相同，MIN_REDUNDANT_TEXT_PREFIX=20）——跳过冗余段保留更完整者；共享开场白（6 字符）不达阈值不受影响。draft 侧 committedSegments 判定不动（主防线），块级去重是滞留场景的渲染兜底。
- 验收：新增 2 例（滞留前缀去重证伪——临时禁用去重旧实现两 text 块失败；共享开场白不误删回归）；定向 38 例、全量 1648 例、typecheck、knowledge:validate 通过。实机待用户验收。
- 已知边界：滞留 draft 根因（工具边界 flush 未 commit）未在协议层根治——draft 非空时 offset=0 判定放宽会误拒正常新 step 正文，权衡未动；再复现「滞留」其他表现（如思考错位附着）应从 commit 时机查。
- 关键文件：`src/utils/turnBlocks.ts`、`knowledge/architecture/streaming-render-pipeline.md`。

## 2026-08-06 修复：steer 气泡位置倒挂 + 进行中仍卡「等待官方写入」（v2.20.242）

- 现场（用户复验 241，同会话第二次 steer 08:54 UTC 窗口）：① agent 回复文本渲染在轮内，steer 气泡却排在回复之后（位置倒挂）；② 官方已落库（agent 已作答）气泡仍 accepted。
- 取证：live WS 不推送 steer 官方确认帧（无 context.spliced/prompt.steered 推送，确认只在轮末完成屏障回放携带）→ 241 的 mergeEvents 匹配轮末才有 incoming；位置倒挂根因是 attachedSteers 在 JSX 里排过程卡之后。
- 修复：
  - 位置：renderTurnBody 中 steer_message 按事件位置 push 独立渲染单元（官方注入点语义），删除 getAttachedSteers/pushStandaloneSteers 机制（RenderItem.attachedSteers 字段保留类型兼容、不再填充）。
  - 收敛：新增 `electron/steerConfirm.ts`——Server 路径 steer 成功后轮询 listMessages（3s×90s 上限），发现 created_at 晚于 steer 时刻 + 角色 user + 内容匹配的官方消息即发合成确认帧（turn.steer/server-confirm），渲染层映射 sent → 进行中约一个轮询间隔收敛。护栏：created_at>startedAt 过滤（历史同文不误收敛）、角色必须 user、纯附件跳过、failed 不轮询、mergeEvents 幂等。
- 验收：新增 steerConfirm 5 例 + eventMapper 幂等 1 例 + 位置断言更新；两处证伪（移除 created_at 过滤、steer 推迟到轮末渲染均失败）；定向 277 例、全量 1646 例、typecheck、knowledge:validate 通过。实机待用户验收。
- 已知边界：官方落库 >90s 时由轮末 completed 兜底收敛；轮询只覆盖 Server 路径（SDK 沿用 wire 轮询）；steer 早于 step1 commit 时气泡在 step1 前（更贴用户感知，与官方注入点轻微偏差）。
- 关键文件：`electron/steerConfirm.ts`、`electron/kimiCodeHost.ts`、`src/components/chat/ChatThread.tsx`。

## 2026-08-06 修复：引导（steer）链路三症状——236 修复的部分成功遗留（v2.20.241）

- 现场（用户 v2.20.240 三截图，会话 session_532ff5cb）：① steer 后双重思考块同跑（同一段思考在旧轮 settle 块与新一轮流式块并存）；② steer 实际已注入且 agent 已针对其作答，气泡仍长期「等待官方写入」；③ 完成后同一文案双气泡（steer「引导已写入当前轮」+ 普通 user），回复中一段思考（"Reply with instructions."）也出现两次。
- 取证（三源交叉：官方 wire session_532ff5cb.jsonl + diag.log + IndexedDB blob 解码）：官方时间线 steer 内容只有一条 user 消息（08:08:17 context.spliced/append_message 落历史），turnId=7 全程不变（官方不重启 turn）——三症状全部判定为 **Kimix 渲染侧缺陷**，官方无异常。
- 根因与修复：
  - 症状 2+3 同根（mergeEvents user_message 分支）：官方回放 user（snapshot:/user: 前缀或 snapshotMessageIdStable）与本地 steer echo 并存渲染。修复：官方回放 user 内容与 sending/accepted/sent 的 steer_message 匹配（isMatchingSteerContent）→ 立即收敛 sent（不等轮次终态）且不追加独立 user 气泡；failed steer 不吞。
  - 症状 1（buildRenderItems）：steer_message 触发 flushTurn() 切出「无 user 的伪新轮」（官方不切 turn）→ 独立轮头部 + 新思考块。修复：steer 改入 turnBody 归属——有 assistant 块时 attachedSteers 嵌入轮头，无轮包围时独立渲染。
  - 症状 1（clearActiveTurnDraft）：step 边界权威帧删除 committedSegments（回放判定基准）→ steer 后新 step 思考流 offset=0 同前缀重放被当新内容材料化（diag 铁证 08:08:26 offset:0 regression:true prevOffset:2051）。修复：clear 保留 committedSegments，误拒代价单帧自愈。
- 验收：新增 6 例（每处修复均有临时恢复旧实现的证伪实证）；定向 271 例、全量 1640 例、typecheck、knowledge:validate 通过。实机三症状待用户验收。
- 已知边界：steer 后官方新 step 重新生成的相似思考是官方行为，归入同一轮单块连续显示、不做内容级去重；历史已持久化的旧双 user 事件不主动回溯（重启回放经 mergeEvents 自然去重）。
- 关键文件：`src/utils/eventMapper.ts`、`src/components/chat/ChatThread.tsx`、`src/utils/activeTurnDraftStore.ts`、`knowledge/architecture/runtime-routing.md`（20a）、`knowledge/architecture/streaming-render-pipeline.md`。

## 2026-08-06 修复：思考工具链展开带动子内容一并展开（v2.20.240）

- 现场：用户截图——点击展开「思考工具链」摘要行后，链条内部 running 状态的子代理任务卡（「任务 · 集成 C+D 选中主体算法」）一并展开，委托 prompt 全文直接铺开。展开父级应只露出链条条目列表，子内容展开与否由子项自身交互决定。
- 根因（全链路排查后仅 2 条跟随路径，均在子卡首次挂载时以运行态作初始展开值）：`KimiWebTaskCard` 原 `useState(isRunning)`；`KimiWebSubagentGroupCard` 原 `useState(activeCount > 0)`。其余可折叠子项（思考条目/工具行/工具组/审批/提问/subagent detail/showAll）均各自默认折叠，无跟随。
- 修复：两处初始值统一改 `useState(false)`。合法联动保留：父摘要自身默认展开规则（B3/expandByDefault/collapseWhileRunning）、live 流式块、settle 折叠、processManualExpand 手动恢复。
- 验收：新增 MessageBubble 测试 4 例（临时恢复旧实现实测 3 例证伪失败）；定向 8 例、全量 1634 例、typecheck、knowledge:validate 通过。实机待用户验收。
- 已知边界：子卡手动展开态不跨父级折叠/重展开持久化（父折叠子卡卸载回默认）——所有子卡既有行为，未扩大范围。
- 关键文件：`src/components/chat/MessageBubble.tsx`、`knowledge/architecture/streaming-render-pipeline.md`。

## 2026-08-06 修复：teaser 覆盖全文的思考块不再可展开（v2.20.239）

- 现场：用户截图——kimi-web 模式过程时间线里，单段无换行的长思考触发折叠（长度 > 200 字符），teaser 取「最后一个非空行」= 全文，折叠态与展开态内容完全相同，却仍可点击，展开后同一段文字再显示一遍（红框内同文本出现两次）。
- 修复：`resolveSettledThinkingFold`（thinkingBlocks.ts:129）算出 teaser 后加通用判定——teaser.trim() 等于全文 trim 即返回 foldable:false，`KimiWebSettledThinkingItem` 走既有静态分支直接全量显示。多段场景（teaser=最后一段）天然不受影响。
- 验收：旧用例「folds a single long line by length」反转（证伪点）+ 新增 3 例（单行无换行长文本不可折叠/首尾空白行 teaser 等于全文/多段长文本仍可折叠）；定向 18 例、全量 1630 例、typecheck、knowledge:validate 通过。实机待用户验收。
- 关键文件：`src/utils/thinkingBlocks.ts`、`knowledge/architecture/streaming-render-pipeline.md`（Invariant N 补例外）。

## 2026-08-06 修复：输出完成后尾部大段空白（尾部补偿两条残留路径）（v2.20.238）

- 现场：用户截图——一轮输出完成后最后一条消息下方约 40% 视口空白，滚到视觉底部也消不掉；用户判断是展开的长内容完成时折叠、内容变矮但尾部空间未收回。
- 根因（代码级，两条路径）：
  - A 释放条件过严：`canReleaseViewportTailCompensation`（chatViewportTransaction.ts:86）只认 `scrollTop <= 自然最大滚动`；补偿把视觉底部推到「自然底+补偿」，用户滚到视觉底部时永不满足 → 补偿永不释放。集成测试实证滚到视觉底部补偿仍为 300px。
  - B 无 anchor 折叠仍设补偿：`useChatViewport.ts:602` after 分支在 `selectStableAnchor` 返回 null（折叠节点本身就是视口锚点，如正在阅读的思考被自动折叠）时 fallback 设补偿 = 视口底部悬空量；折叠后无内容增长消费它 → 空白永久残留（即截图场景）。
- 修复：A——canRelease 增加「滚到补偿撑出的视觉底部即释放」；释放时 handleScroll 显式把 scrollTop 收敛到自然底（不依赖浏览器 clamp 时机）。B——无 anchor 且需补偿时不再设补偿，直接贴自然底（`processCollapseViewportNoAnchor` 诊断）；有 anchor 的补偿保留（阅读位置保护语义不变），由 A 在用户滚到视觉底部时释放。
- 验收：新增 useChatViewport.processCollapse 测试 4 例（含对旧实现证伪 2 例）；canRelease 用例更新（补偿空间内不释放/视觉底部释放）；定向 38 例、全量 1628 例、typecheck、knowledge:validate 通过。实机待用户验收：完成后无空白、detached 阅读位置不跳。
- 关键文件：`src/utils/chatViewportTransaction.ts`、`src/hooks/useChatViewport.ts`、`knowledge/architecture/chat-viewport-state.md`。

## 2026-08-06 性能：流式思考卡顿——draft 订阅下沉叶子组件（v2.20.237）

- 现场：流式输出卡顿。根因（代码级）：每个 delta 触发整个活动气泡全量重渲染——`AssistantMessageBubble` 顶层 `useActiveTurnDraft` 订阅 → `buildThinkingBlocks` 全量切块 O(n) + `liveThinkingBlocks` 新数组击穿 `AssistantProcessBlock` memo → `mergeLiveDraftBlocks` 全量重跑 + `buildAssistantFullCopyText` 每帧重建 + 视口整段 reflow。
- 修复（移植官方 kimi-web 做法）：
  - 新增叶子 `LiveDraftTail`/`LiveThinkingPre`（MessageBubble.tsx:1428/1446）：流式思考纯文本 pre-wrap 单块（不 markdown、不逐段 summarize），120px 固定滚动窗，距底 24px 才跟随（原 12px），settle 后正式折叠 teaser 接管。
  - `AssistantBodyBlock` 自建 draft 订阅合成流式正文 tail；复制全文改点击时惰性构建（ref 快照）。
  - `AssistantProcessBlock` 四个每帧变化的 live props 收敛为稳定 `liveDraftKey` 字符串，memo delta 间全命中；`mergeLiveDraftBlocks` 退出渲染路径（函数与测试保留）。
- 交接说明：本轮基于上一个 agent 的代码级定位执行；其半成品（不可编译的 `LiveDraftProcessTail` 删除残留）已 `git stash` 保存（stash@{0}，wip: LiveDraftProcessTail），未采用。
- 行为差异（已记入知识条目）：运行中摘要行「N 段思考」计数不再逐帧更新；liveDraftKey 非空时过程行显示「正在思考/执行中」而非「等待首个模型事件」；live→formal 为 mount 切换。
- 验收：新增 liveDraftTail 测试（含对旧实现证伪：旧路径每帧切块/summarize）+ 24px 跟随边界用例；定向 85 例、全量 1624 例、typecheck、knowledge:validate 通过。实机帧率改善待用户验收。
- 关键文件：`src/components/chat/MessageBubble.tsx`、`src/utils/activeTurnDraftStore.ts`、`src/utils/liveThinkingViewport.ts`、`knowledge/architecture/streaming-render-pipeline.md`。

## 2026-08-06 修复：引导/队列链路三故障（steer 双投递、accepted 永卡、队列不排空）（v2.20.236）

- 现场（用户 v2.20.231 截图）：steer 卡「等待官方写入」且同一内容出现两遍回复；轮次完成但本地队列不派发；已结束会话仍显示停止按钮。
- 取证：daemon 0.33 活探针确立官方语义——busy 投递入官方队列、任意终态约 1ms 内自动排空且用排空时刻模型、prompts:steer 两步非原子（POST 已入队）、排队项无取消接口、prompt.completed/aborted 是唯一权威 per-prompt 终态。
- 根因与修复：
  - I1 双投递：steer 第二步失败时内容已在官方队列，渲染层又回补本地队列 → 同一内容跑两遍。client.steer 失败时用 listPrompts 分辨去向（queued/running）并如实返回；渲染层不再回补，标「未注入当前轮，内容在官方队列」。
  - I1 accepted 永卡：server 路径 steer 成功后官方确认帧丢失时「等待官方写入」永存 → completed 终态统一收敛 accepted/sending → sent。
  - I2 队列不排空：completed 时本地仍挂 pending 提问（官方已过期）→ 按 skipped 结算后继续；官方 active 为终态残留时 defer 不再拦截。
  - I3 停止按钮残留：主要由孤儿官方队列/卡住的 accepted steer 驱动，随 I1/I2 修复收敛；未单独改代码。
- 验收：promptQueue 新增 2 例（终态 active 不拦截——旧实现恒拦截，证伪成立；未知状态保守拦截）；全量 1616、tsc、build 通过。实机待用户验收。
- 关键文件：`electron/kimiCodeServerClient.ts`、`electron/kimiCodeHost.ts`、`electron/main.ts`、`src/components/chat/Composer.tsx`、`src/App.tsx`、`src/utils/promptQueue.ts`。

## 2026-08-06 修复：排队消息补发跟随当前模型 + 失败轮自动排空队列（v2.20.235）

- 现场：k3 轮 429 挂起约 70s 后自行失败，用户只切了模型到千问，排队消息被以千问自动重发，气泡模型「瞬变」。
- 取证：官方 wire（两次 turn.prompt + 中断 + config.update 时序）+ 两个 daemon 0.33 活探针——daemon 切模型不中断不重发（探针 1），轮次保持 dispatch 时模型（探针 2）；重发来自 Kimix 队列补发在补发时刻取当前模型。daemon 队列无取消接口（仅 prompts:steer，实测其余 action 全 unsupported）→ C 不做，记为边界。
- 修复 A：`PendingMessage.model` 入队锁定，App.tsx 三个补发点一律 `next.model ?? currentSessionPromptModel(...)`；Composer 三个入队点（运行中发送/发送冲突回补/steer 失败回补）都传锁定模型。
- 修复 B：error/interrupted 终态不再自动 dispatch 本地队列，改为插入「上轮已终止，N 条排队消息未自动发送」状态卡；completed 路径照常排空。
- 验收：新增 store 测试 3 例（锁定模型保存/shift 保留/重排保留/无模型兼容）；定向 7 例、tsc 通过；全量+build 见提交记录。实机待用户验收。
- 关键文件：`src/stores/sessionStore.ts`、`src/components/chat/Composer.tsx`、`src/App.tsx`。

## 2026-08-06 排查：切模型后气泡模型标签 k3→千问——判定为正确行为，非 bug（附一条边界）

- 现场：k3 跑「刻度跳转」轮卡住无响应，用户切换千问后，该轮页脚胶囊显示千问，用户疑为归属错误。
- 取证（94f414ec wire + IndexedDB 双源）：turn 3（06:50:08，k3）70 秒零输出，06:51:18 turn.cancel + turn.ended + interruptionReminder（官方取消，未产出一个字符）；06:52:11 context.undo；06:52:13 turn 4 同文案重发，qwen 完成全部工作。页脚模型来自本轮 usage.record（`模型：` 状态帧），显示千问与事实一致；左侧官方 web 的 k3 胶囊属于上一轮（18360a88 回答），两客户端一致。
- 结论：模型标签正确，无需修复。k3 的 70s 静默是 provider 侧卡顿，非 Kimix 问题。
- 已知边界（轻微，未修）：取消+重发在持久化时间线留下两条同文案 user_message（233/234，undo 帧 Kimix 全链路不处理——src/electron 均无 context.undo 消费）。当前渲染未见双气泡（用户截图单气泡），若日后该会话出现重复用户气泡再处理。

## 2026-08-06 已知边界：运行中出现「输出打断」页脚+实时页脚双气泡（未闭环，等现场复现）

- 现场：用户 v2.20.218 截图——运行中的轮尾部出现两个相邻页脚胶囊：「输出打断 输入:186.18k…」（数字冻结，沉底 artifact）+「模型: k3 …」（数字增长，活跃轮实时页脚）。实时页脚运行中显示是 v2.11.55 起既有设计，非回归。
- 已确证机制：「输出打断」页脚 = 某 assistant 段 isComplete=true 且尾部挂「输出打断」status_update（来自 `turn.step.interrupted` 帧映射，`kimiCodeEventMapper.ts:747`）。合法来源实例：532ff5cb 会话 16:19:30 steer 打断 step 1。非合法通道之一（子代理失败帧误置主轮状态）已在 v2.20.234 修复。
- 未闭环点：截图时刻「提前完结的中段 assistant」具体由哪一帧 settle 未能从事后数据唯一确定（diag 轮转 + 持久化点早于截图）；三个会话的 IndexedDB 快照（532ff5cb / 06b4c056 / 8351ce72）均未复现该形态。
- 待查疑点（暂不修）：`eventMapper.ts:1803` 历史映射把 `turn.step.interrupted` 落成无 agentId 状态，子代理步中断若进入历史回放会漏进主时间线——无实例，列边界。
- 下次复现取证协议：用户不刷新不切会话直接报告 → 立即 dump 该会话 IndexedDB 记录（`file__0.indexeddb.blob` 按会话 id grep 定位，V8 序列化 UTF-16LE 解码）+ diag 对应窗口，定位 settle 帧与「输出打断」状态来源。
- 关键文件：`src/components/chat/MessageBubble.tsx:3011-3015`（isInterrupted/shouldShowBodyFooter）、`src/utils/kimiCodeEventMapper.ts:747`、`src/utils/eventMapper.ts:1803`。

## 2026-08-06 修复：子代理 turn.ended(failed) 误驱动主会话状态（假「输出完成」闪屏）（v2.20.234）

- 现场：用户报「显示输出完成+模型请求失败，但内容还在变」（v2.20.218 截图），要求确认当前版本是否仍存在。
- 取证：diag.log 实机抓到现行——16:21:49 子代理 agent-37 的 `turn.ended{reason:failed}` + `prompt.completed` 到达主会话频道，40ms 内主轮 display 从 thinking → settled_complete → running。失败帧合成路径（deliverFailedPromptFrames / 快照门）自 v2.17.4 起只认主 Agent，不是本案通道。
- 根因：`KimiCodeStatusSequencer.handle` 不看 agentId，子代理 turn.ended(failed) 直接 emit 会话级 error。SDK 主代理事件无 agentId 字段（wire 实测 0 次），守卫不误伤。
- 修复：sequencer 顶部跳过 agentId 存在且非 "main" 的事件。知识库不变量 82 扩展（会话状态迁移同样只认主 Agent）。
- 验收：新增 3 例（子代理 failed/cancelled/started 不发状态——旧实现会 emit error，证伪成立；主代理 failed 仍发 error）；定向 8 例通过；全量/typecheck/build 见提交前记录。实机待用户验收：Swarm 子代理失败时主轮不再闪「输出完成/报错」。
- 关键文件：`electron/kimiCodeStatusSequencer.ts`、`knowledge/architecture/runtime-routing.md`。

## 2026-08-06 修复：body-only 等价认证冻结思考虚高缓存（认证防线 + 缓存升版）（v2.20.232）

- 现场：旧会话 06b4c056 的 repair 循环 13:03 后消失，非收敛——被拒后残片补丁补齐正文，`hasEquivalentKimiHistoryTurnBodies` 只比正文判等价 → 打 cache-current → 永久移出 repair 候选，损伤固化。
- 取证（IndexedDB blob + wire 镜像逐段对齐，227 本地 vs 258 canonical 思考段）：本地前 209 段与 canonical 逐字符一致；损伤全在尾部——9 段盲拼（两相邻官方段无分隔拼合，跨形态，三层折叠都管不到）+ 1 段 7548 字正式事件精确重复（非 active-draft id，231 collapse 不覆盖）+ ~491 字可去重重复。门禁曾见的「5 字符」是这些形态经去重与连接符增减后的净值，非真实内容差。canonical 后期反超本地（619175 vs 581128），升版重跑 repair 可整体替换洗净。
- 修复 A（认证防线）：新增 `hasInflatedLocalKimiThinkingHistory`（本地思考先过比较侧去重再比总量），接入 App.tsx 全部四个 cache-current 认证点（repair/runtime-recovery/startup/running-sample）。
- 修复 B（一次性清创）：`KIMI_HISTORY_CACHE_VERSION` 18→19，全部会话下次启动重跑 repair；版本钉住测试同步更新。
- 附带：230 的知识库收尾漏改 Invariant G（仍写 turn-global 旧语义，与 per-step 小节自相矛盾），本轮已重写对齐；缓存版本引用 17→19。
- 验收：新增敏感性用例 4 例（虚高阻断认证/思考一致放行/本地更薄放行/可证重复先去重；首例对旧实现证伪——旧谓词在同场景放行）；定向 75 例、全量 1608、typecheck 通过；build 见本条目收尾。实机待用户验收：重启后 06b4c056 应被整体替换（重复思考段消失）、不再出现 repair 空转。
- 关键文件：`src/utils/kimiHistoryReconciliation.ts`、`src/utils/kimiHistoryCache.ts`、`src/App.tsx`、`knowledge/architecture/streaming-render-pipeline.md`。

## 2026-08-05 收敛：材料化重复事件持久化折叠（思考/正文虚高修复面）（v2.20.231）

- 背景：230 已修产生侧（offset per-step 锚定冻结级联），本轮按 handoff 收敛剩留点。交接文档问题 2（commit 切碎正文）已被 230 的 per-step 根修覆盖，无需单独处理。
- 收敛点（问题 1）：`dedupeLocalHistoryForComparison` 的去重只作用于比较侧，本地时间线的重复材料化仍原样落盘——同一段文本被材料化为多个 `active-draft:` 事件（旧快照实据：51 字进度×16），思考/正文总量虚高，单调门禁把干净 canonical 判「更薄」拒绝替换，重复永久固化。
- 修复：新增 `collapseDuplicateMaterializations`——同轮内 `active-draft:` id 事件（正文+思考）签名完全相同且 ≥16 字符时保留首个、清空其余；只认材料化 id 前缀，formal 事件与合法短回复不动。接入 repair/runtime-recovery/startup/room-snapshot 四个非替换分支（包在 fragment 补丁输入侧）。
- 验收：新增单测 4 例（折叠/不碰 formal/跨轮窗口重置/短文本不折叠）；定向 71 例、全量 1604、typecheck、build 通过。实机待用户验收：旧会话重复思考段应不再堆积、门禁更易放行 canonical 替换。
- 知识库：无需更新（invariant 14 已含 identity-aware merge 与 dedupe 语义，本次是把比较侧语义落到持久化侧）。
- 关键文件：`src/utils/kimiHistoryReconciliation.ts`、`src/App.tsx`、`src/utils/__tests__/kimiHistoryReconciliation.test.ts`。

## 2026-08-05 修复：流式 offset 是 per-step，回放守卫吞掉整个 step（v2.20.230）

- 现场：用户报「工具又全粘成一张卡、中间思考段不显示」，同时 225/226 一直在事后打捞正文残片。
- 取证：227 的不抽样 `[live] anchor` 首次产出 1240 行——accepted False 960 / True 280；think 拒 814/932、body 拒 146/308；17 次 offset 回退全部精确落在 0；按 offset 0 切块后每块严格单调（think 0..2339 / 0..259 / 0..3493）。
- 根因：offset **每 step 从 0 重启**，而代码与知识库自 v2.20.12 起记的是 turn-global，`takeActiveTurnDraft` 因此故意保留 anchor。提交后「acc 空 + anchor 在场」与新 step 首帧完全同构，`!acc && anchor !== null → reject` 把真实输出当回放拒掉，anchor 从此冻结，该 step 余下 delta 连锁全拒。一条根因同时解释三个症状（思考段缺失、工具粘连、正文残片）。
- 修复：提交时清 anchor（per-step 作用域随段结束）；移除该 reject 规则；改用「delta 是刚提交段前缀」判定真回放，且**拒绝时保持 anchor 为 null**，误判只损失一个 delta 并在下一帧自愈，不退化成冻结级联。
- 验收：改写 1 例（原用例断言 turn-global，编码的正是被证伪的假设）、新增 2 例（边界提交后 offset 0 必须接受并累计；疑似回放后自愈）；保留原「重连回放不得重复材料化」用例原样通过。全量 1600、typecheck、build 通过。临时探针证实旧实现下新 step 首帧根本不产生草稿。实机待用户验收。
- 已知边界：真回放判定依赖内容前缀，非前缀形态的尾部回放不在覆盖内；`[live] anchor` 可抓到（offset 0 且 accChars>0 被接受）。
- 注意：本轮期间另一会话提交了 `0badd6e9`（v2.20.229，崩溃页主题），占用 229，故本轮用 230；两会话并行时 `package.json`/`TASK_STATE.md` 是冲突热点。
- 关键文件：`src/utils/activeTurnDraftStore.ts`、`src/utils/__tests__/activeTurnDraftStore.test.ts`。

## 2026-08-05 修复：崩溃/卡死页不吃主题（v2.20.229）

- 现场：dev 实例 React 双副本崩溃（vite 旧 .vite 缓存，清缓存重启可解）时，错误页停在默认浅色，不跟用户主题。
- 根因：首帧主题只读 localStorage `kimix_theme_snapshot`，按 origin 隔离（dev localhost:5173 与安装版不同源，dev 侧可能无快照）；且 `#kimix-runtime-error` 遮罩背景硬编码浅色 rgba。
- 修复：main.tsx 启动时在缓存快照之后用 `window.api.getSettings()` 权威设置补一次 applyThemeSnapshot 并回写快照；遮罩背景改 `var(--kimix-overlay-bg)`（light/dark 各有值）。
- 验收：typecheck/全量 1599/build 通过；实机待用户验收（dark/复古主题下触发崩溃页应跟随主题；dev 卡死实例需先杀进程清 node_modules/.vite、.cache、out 再重启）。
- 知识库：无需更新（首帧主题快照机制补强，不变量未变）。
- 关键文件：`src/main.tsx`、`src/index.css`。


## 2026-08-05 修复：空闲会话每 90 秒无谓断连重连（v2.20.228）

- 现场：diag 里 `[wsc] watchdog 假死判定 固定静默上限` 连续 12 轮，周期 90/92 秒，每轮重连后重拉 100 条快照而 `as_of_seq` 恒为 798（无任何新数据）。
- 根因：`WS_SILENCE_LIMIT_MS=90_000` + `WS_WATCHDOG_INTERVAL_MS=2_000`（相位差解释 90/92 秒）。`lastMessageAt` 只被收到的帧刷新（`receive()`，socket message 监听器把每条消息都送进去），而官方 0.32 daemon 从不主动 ping（diag 里 ping 帧 0 次；代码只有被动 pong）。早退条件只有 closing / socket 非 OPEN / 无订阅，缺「无在飞任务」，于是空闲订阅会话静默必然线性撞上限。
- 该上限是 v2.20.20 为「有轮次在跑却收不到帧」引入的假死兜底，空闲期周期空转这一面未被覆盖。
- 修复：新增纯函数 `shouldReconnectForFixedSilenceLimit`，上限只在 `pendingPrompts` 非空（确有在飞任务）时生效；完全空闲交给 8s 粒度的 REST 进度探测（`WS_PROGRESS_PROBE_SILENCE_MS=8_000` / `INTERVAL=3_000`，走 `listMessages` 而非 WS，僵尸 socket 下仍能发现官方历史增长并 `forceWatchdogReconnect`）。正确性不依赖固定上限。
- 净效果：空闲每 90s 少一次断连 + 少一次 100 条快照；REST 探测频率不变（原本 8s~90s 之间也在每 3s 探测）。
- 验收：新增单测 2 例（空闲 90s/1h 均不重连；在飞时 90_000 重连、89_999 不重连、自定义 limitMs 生效）；全量 1599、typecheck、build 通过。实机待验收：空闲不再出现周期性 `固定静默上限` 行。
- 已知边界（未处理，记为后续）：空闲期 REST 进度探测仍每 3s 跑一次（本轮之前既有行为，非本次引入）。
- 关键文件：`electron/kimiCodeServerClient.ts`、`src/utils/__tests__/kimiCodeServerClient.test.ts`。

## 2026-08-05 加强：offset 锚定不抽样诊断（产生侧定性前置）（v2.20.227）

- 背景：226 已让两个残片轮实机闭环（用户验收：正文均显示）。转追产生侧。
- 自我更正（重要）：先前从 diag 读出「13 次 offset 从 8389 回退到 247-320、无一落 0」，据此判定「协议按 step 计 offset、注释承诺的 offset 0 自愈永不发生」——该结论作废。`[live] stream` 每 sid 每 2s 只抽样一条（`noteLiveStreamFrame`），「offset 真归 0」与「offset 按 step 计」在抽样日志下观测等价：归零后头几百字符的 delta 全落在采样窗内，首条被采样到的必然是小非零值。回退值挤在 247-320 这条窄带恰是「2s 内累积字符数」的特征。
- 影响：A（锚定改 per-step）的前提无证据支撑，不能选；B（大幅回退视同重起点）同样缺依据。知识库 streaming-render-pipeline 的 turn-global 模型无证据前不改。
- 本轮改动：新增 `noteStreamAnchorDecision`（不抽样，输出 `[live] anchor`：offset/deltaChars/accChars/anchorBefore/anchorAfter/accepted/regression/prevOffset/row，不含正文），挂在 `applyActiveTurnDraftDelta` 的 `applyStreamOffsetDelta` 决策点；上限每 `key:kind` 前 1200 行全记、超出只记 accepted=false 与 offset 回退、硬上限 2000。纯函数 `shouldLogStreamAnchorDecision` 可单测。
- 验收：新增单测 3 例（软上限内全记 / 超软上限只留关键信号 / 硬上限即使关键信号也停）；全量 157 文件 1597 例、typecheck、build 通过。待用户复现一轮后回传 `[live] anchor` 序列，再判定 turn-global 还是 per-step，然后定修法。
- 已知边界：先前取证的 offset 回退帧全是 `kind=think`，body 通道的回退尚未直接抓到；那段 diag（08:21-08:41Z）不覆盖两个残片轮（06:52-07:31Z）。
- 未完成：watchdog 固定静默上限空转收窄（证据链已完整：`WS_SILENCE_LIMIT_MS=90_000` + `WS_WATCHDOG_INTERVAL_MS=2_000` 对应实测 90/92 秒；daemon 从不主动 ping，diag 里 ping 0 次；8s 粒度 REST 探测走 `listMessages`，僵尸 socket 下仍能发现官方历史增长并重连，故固定上限在完全空闲时多余）。
- 关键文件：`src/utils/liveTurnDiag.ts`、`src/utils/activeTurnDraftStore.ts`。


## 2026-08-05 修复：跳轮错位残片（下一轮首段落到上一轮边界下）（v2.20.226）

- 现场：225 修好了 T4 那轮（用户已确认），但截图下面那轮（显示「backoff。」）仍不修。
- 取证：225 新增的轮数计数直接定案——diag `fragmentTurnBodiesPatched {patchedTurns:1, localTurns:16, canonicalTurns:12, alignedTurns:12, mismatchedTurns:3}`，随后 `fragmentTurnBodiesSkipped {mismatchedTurns:2}`。本地是多 4 条边界（不是缺），上一轮「缺 T6 边界」的推断被推翻；12 条官方轮已全部对齐，剩下 2 轮是对齐了但残片判定拒绝。
- 根因：该轮展示正文不属于本轮任何官方段，而是【下一轮】首段的残片（live 下官方 user 边界帧比下一轮首段正文晚到，首段落到上一轮边界下）。真实 wire 形状已验证：「backoff。」在 T5 任何段里都不存在，却是 T6 首段（66 字）的子串。
- 修复：新增跳轮残片判定——本轮不命中但命中相邻下一轮某段时，认为是错位残片，把展示正文换回本轮官方终段。护栏：必须先排除本轮命中（短残片如「。」会同时命中多轮，实测 T6/T7/T9/T10/T11 均为本轮命中）；下一轮段长度需达阀值。下一轮自己也已对齐到本地轮，所以不会丢它的内容。
- 验收：新增单测 2 例（跳轮恢复 + 短正当回复不误改），均经确认在 225 下失败；真实 wire 形状前后对照（225 原样返回，本版补成 1149 字且 T6 本轮不动）；全量 1594、typecheck、build 通过。实机待用户验收。
- 已知边界：本地多出的 4 条边界（痑疑 steer / 中断重发）未查清；产生侧（offset 锚定把末段正文缩成残片、首段跳轮）的帧级机制仍未定位，目前靠 222-226 自愈网兜底。
- 关键文件：`src/utils/kimiHistoryReconciliation.ts`、`src/utils/__tests__/kimiHistoryReconciliation.test.ts`。

## 2026-08-05 修复：残片补丁零命中的两处结构性根因（223/224 未生效的真因）（v2.20.225）

- 现场：用户实测 224 仍缺正文（两轮显示「。」/「backoff。」）。diag 取证：`fragmentTurnBodiesPatched` 全天 0 次，而同刻 `latestCanonicalAssistantPatched`/`latestCanonicalTurnPatched` 有——补丁链在跑，函数每次都 patchedTurns=0。
- 取证方式：用真实 wire 镜像（session_94f414ec，7629 行）跑真实 `parseKimiCodeRecord` + `mapHistoryEvents` + `settleInactiveEvents`，得 canonical 12 条 user 边界、tool_call 243（与 diag 的 canonicalProcessEvents=243 完全一致，证明探针复现了应用所见）。
- 根因 1（对齐）：按数组下标配对轮次且首个不匹配就 `break`。本地缺任一官方边界（T3 是中断后原文重发、与 T4 正文完全相同）即整体错位，后面所有残片轮永远修不到。改单调游标向前搜索、匹配不到的本地轮跳过、绝不 break。
- 根因 2（判定粒度）：canonical 一轮有**多段正文（每 step 一段）**，旧判定只拿「整轮最后一段」比残片。实测残片属于**首段**（T6 step1 尾 delta「backoff。」不是 step17 那 1101 字终段的子串），恒判否。改为逐段判定，命中后仍补成官方终段（折叠轮显示的就是终段），本地已持有终段则跳过。
- 补取证钩子：新增 `fragmentTurnBodiesSkipped`（只在确有正文不一致的轮次时打，只打计数不打正文）。前两轮「触发了但零命中」无从判断，就是缺这条。
- 验收：真实数据前后对照——本地缺 T3 边界时 HEAD 原样返回（残片仍 1 字符），新版补成 833 字；缺 T6 边界时两者都能补（证明失效条件是 T4 之前的早期分歧）。新增永久回归 2 例（早期边界缺失后仍补later残片轮 / 残片来自非终段），已验证两例在 HEAD 版函数上均失败。typecheck、全量 1592、build 通过。
- 已知未闭合（下一增量）：T5/T6 那轮是**跨轮错位+边界合并**，本地该轮展示正文是 T6 首段残片，在 T5 的 canonical 任何段里都不存在 → 同轮补丁按设计不动它。需要「缺失 user 边界回填」增量，而整轮替换正被 process-history-regression 门保护（local 596 进程帧 vs canonical 243），属独立机制，不并入本轮。
- 知识库：invariant 14 扩展（对齐单调游标、canonical 每 step 一段），log.md 记一条。
- 关键文件：`src/utils/kimiHistoryReconciliation.ts`、`src/utils/__tests__/kimiHistoryReconciliation.test.ts`。
## 2026-08-05 修复：残片补丁对齐与残片判定两处失配（223 实测不生效根因）（v2.20.224）

- 现场：223 的 repair 触发但 fragmentTurnBodiesPatched 零日志。
- 根因 1（对齐）：canonical user 正文带客户端注入的 <system-reminder> 包装，本地是裸文本，223 用纯文本相等对齐轮次，第一轮就 break，永远到不了残片轮。改轮次身份优先（agentTurnId/roomMessageId/id），退化包含关系+30s 时间窗。
- 根因 2（判定）：offset 重置截出的残片是 canonical 全量的中间子串（「backoff。」）而非尾后缀，223 的 endsWith 判不中。放宽为「子串且显著更短」（≤32 字符或 ≤一半长度），门槛防误伤。
- 验收：新增单测 1 例（中间残片+reminder 包装对齐）；定向 63 例、全量、typecheck、build 通过；实机待用户验收（加载 224 重启或下一轮 settle 后两残片轮应完整）。
- 知识库：无需更新（223 条目已覆盖机制，本次为判定修正）。
- 关键文件：`src/utils/kimiHistoryReconciliation.ts`、`src/utils/__tests__/kimiHistoryReconciliation.test.ts`。

## 2026-08-05 修复：残片正文按轮补丁（222 自愈实测不生效的补刀）（v2.20.223）

- 现场：222 的 settle 自愈实测不修残片。diag 取证：整轮替换被 process-history-regression 门拒绝（local 进程帧 559 vs canonical 205，门在保护 live 过程细节），旧补丁 mergeMissingLatestCanonicalAssistant 只补最新一轮，老残片轮无人修。
- 修复：新增 mergeCanonicalFragmentTurnBodies——按 user 边界对齐轮次，local 展示正文是 canonical 最终正文真后缀（或空）时，替换该轮最后带正文 assistant 为 canonical 全量，并清空同轮作为其前缀的流式残段；多消息轮中间正文、工具/进程帧一律不动。接入 repair/runtime-recovery/startup/room-snapshot 四个非替换分支。
- 验收：新增单测 4 例（残片替换+前缀清空/等价不动/无关不改/多消息轮中间正文保留）；全量 1589、typecheck、build 通过。实机待用户验收：加载 223 后重启或下一轮 settle，两个残片轮应显示完整正文。
- 知识库：无需更新（reconciliation 补丁面扩展，门控不变量未变）。
- 关键文件：`src/utils/kimiHistoryReconciliation.ts`、`src/App.tsx`、`src/utils/__tests__/kimiHistoryReconciliation.test.ts`。

## 2026-08-05 修复：活跃会话轮末正文残片不自愈（v2.20.222）

- 现场：过去两轮 settle 后正文只剩尾部残片（「。」/「backoff。」），盯着的会话一直看不到完整正文。
- 取证：wire.jsonl 官方帧完整（流式 delta 可拼全）；IndexedDB 最新表含完整正文（另一实例启动修复写入）；diag [live] display 显示 live settle 时 textChars=22/24，而 15:31 重启后同两轮 init 即 1125/1937 全量——修复管线本身有效。
- 根因：`repairKimiCodeHistoryBodies` 显式排除启动活跃会话（防打扰 live 水合），而用户盯着的会话正是启动活跃会话；SDK 轮又无完成屏障回放，server 轮屏障在该现场未补全 → 残片永久停留，只有重启/切走才修。
- 修复：轮次终态（completed/interrupted/error/idle）后 2.5s 去抖，对单个非运行会话以 includeActive 复用同一条修复管线（repair 门控/熔断/限流原样生效）。
- 验收：typecheck/全量 1585/build 通过；触发器为 App 层接线，实机待用户验收（settle 后 ≤3s 残片轮应被 canonical 全量替换）。
- 知识库：无需更新（修复触发面扩展，reconciliation 不变量未变）。
- 关键文件：`src/App.tsx`。

## 2026-08-05 加强：Server daemon 静默故障自愈，压缩 SDK 兜底窗口（v2.20.221）

- 现场：13:20 发送显示「经 SDK 发送」——非显示误标，daemon 实例 13:37:39 才启动，发送时 Server 不可用真实走了 SDK 兜底；daemon 恢复后会话已 promote 回 Server（当前轮 journal 连续写入）。
- 根因：recovery 只被「发送落 SDK」与「显式 server 调用失败」触发；daemon 静默不在时 `shouldRouteNewSessionToServer()` 直接 false，不发 server 调用、不产生失败，无人触发 recovery，故障窗口无限长。
- 修复：① 新增 10s 周期自检 ticker（unref，不阻挡退出）：routing 启用且 daemon 不在 → scheduleServerRecovery；daemon 在 → 空闲 SDK 会话批量 promote 回 Server。② backoff 30s→10s。③ recovery 成功后立即跑 promote 扫描。④ 启动首绘后 arm ticker。pinned/运行中/等待中会话不动，SDK 仍作最后兜底。
- 验收：typecheck/全量 1585/build 通过；electron 主进程无测试基建，ticker 行为实机待用户验收（杀 daemon 后 ≤10s 应自愈拉起，空闲 SDK 会话自动回 Server）。
- 知识库：无需更新（恢复触发面增强，路由不变量未变）。
- 关键文件：`electron/kimiCodeHost.ts`、`electron/main.ts`。

## 2026-08-05 修复：运行中点左侧刻度跳转约 1 秒后跳回旧位置（v2.20.220）

- 现场：流式运行中点击 ChatNavigationRail 刻度跳转，约 1 秒后视口自动回到跳转前位置（跟随态的底部）。
- 根因：focusTimelineEvent 经 pauseAutoFollowForUser → recordExplicitUserScrollIntent 调度 140ms 闲时锚点捕获；smooth 滚动落定需数百毫秒，捕获落在出发时的旧位置。700ms 抑制窗过后，下一次内容刷新的 restoreManualScrollAnchor 按过期锚点（无上限 delta）把视口拖回旧位置。wheel/触摸滚动是瞬时的所以没暴露，smooth 导航才触发。
- 修复：useEventFocus 导航成功后取消待定闲时捕获，改用 rAF 落定检测（先观察到 scrollTop 移动、再连续 3 帧稳定，1.5s 兜底）捕获新锚点；会话切换/卸载取消该循环。
- 验收：新增回归 1 例（fake timers+Date，smooth 300ms 落定模型；无修复时断言失败 800≠84，修复后通过）；useChatViewport 21 例、全量 1585 例、typecheck、build 通过；实机刻度跳转待用户验收。
- 知识库：无需更新（视口锚点时序修正，不变量未变）。
- 关键文件：`src/hooks/useChatViewport/useEventFocus.ts`、`src/hooks/useChatViewport.ts`、`src/hooks/__tests__/useChatViewport.test.ts`。

## 2026-08-05 修复：流式期间思考/正文段跳到工具帧前——多步工具粘成一张「N 个工具调用」卡（v2.20.219）

- 现场：运行中 kimi-web 展开过程流里几十步工具合并成「69 个工具调用」一张卡、中间思考段只剩末段 teaser、部分正文不可见；Ctrl+R 后 kimiHistoryReconciliation 回放 canonical 恢复正常（diag.log 有 repair 记录）。kimi Web 端任何时候都正常。
- 取证：官方 wire.jsonl 证实 think/text/tool 帧序完全交错（排除上游）；渲染层所有容器 inline gap 无条件生效（排除样式）；截图「工具粘连」实为分组合并。
- 根因：`commitActiveTurnDraftsToBatch` 把草稿段插到批次「首个非 assistant 项」之前。running 工具帧是 deferrable（500ms 批量 flush）会在批次堆积，后到的思考/正文段提交时跳到整串工具帧前面；连续段再被 mergeEvents 合并成一段（teaser 只显末段），工具则连成一坨。
- 修复：插入位置改按段首 delta 时间戳定位——assistant 项同毫秒保持先到者领先（f2,f1,f3 守卫不变）；非 assistant 项同毫秒段仍在前（官方 wire 思考与随后工具同时间戳、思考在线序在前）。
- 验收：新增回归 2 例（段落在早到 running 工具之后 / 同毫秒思考仍在工具前）；旧「双身份段保持到达序」用例时间戳改真实（原 Date.now 远大于边界 ts，恰是 bug 行为编码）；全量 1584 例 + typecheck + build 通过；实机流式交错待用户验收。
- 知识库：无需更新（批内排序修正，事件管线不变量未变）。
- 关键文件：`src/hooks/useEventStream.ts:169-185`、`src/hooks/__tests__/useEventStream.test.ts`。

## 2026-08-05 修复：事件归属 tie + 样式体系（review 中 7/中 10）（v2.20.218）

- 中 7 site 1 复核后回滚：「canonical 回放盖章取最早匹配」改为时间戳最近匹配后，既有承重测试「同内容连发一一配对」失败——回放按序到达时 FIFO 才是正确语义，且官方/本地时间戳可能不同域；乱序场景仅为理论风险。维持现状不改，记为复核结论。
- 中 7 site 2 修复：迟到外部用户边界的插入触发从严格 > 改为 >=，同毫秒 tie 时插到同值非 user 帧之前（旧逻辑退化为尾部追加，新轮回复被归到上一轮）。新增回归 1 例。
- 中 10 样式：① nostalgia 通用 hover 补 `:not(.bg-accent-primary)`（与 retro 对齐，实底主按钮 hover 不再视觉突变）；② 「框套框」——retro/nostalgia 下 `.kimix-modal-card`/`.kimix-floating-panel` 内的 `.kimix-section-card` 去边框去阴影只留背景分层（AGENTS.md 内层递减硬规则，LongTaskInspectorPanel 等浮层直接受益）；③ 主题/风格选择网格默认 gap 8px→12px（workspace 分段控件变体保持 6px——那是一个完整容器而非独立卡片）；④ color-mix `08%`→`8%`；⑤ uiStyles 测试描述与 nostalgia normalize 断言补齐。
- 有意不改：4 风格预设配三列网格的第二行单卡（需视觉验收定 2×2 还是保持，留给用户截图决策）；nostalgia `--ui-nav-list-*` 显式补全（纯形式一致性问题，无实际缺陷）。
- 验收：typecheck/定向测试通过；样式改动视觉待用户验收（重点：retro/nostalgia 下长程任务浮层内层不再带边框、设置页主题/风格卡间距）。
- 知识库：无需更新（样式与归属修复，不变量未变）。
- 关键文件：`src/utils/eventMapper.ts`、`src/index.css`、`src/utils/__tests__/eventMapper.test.ts`、`src/utils/__tests__/uiStyles.test.ts`。

## 2026-08-05 修复：模型表单预填三项（review 中 8 余项）（v2.20.217）

- type 模式清空即回填：原「为空才填」把用户手动清空当未编辑，下一次按键又填回。新增 touched 跟踪（`modelContextTouchedRef`/`modelEffortsTouchedRef`）：预填恒以空值取候选，仅未触碰字段采纳；「用户清空」是明确意图不再回填。所有草稿重置点（选供应商/新建/选模型/加模型/目录换供应商）统一复位。
- 目录惰性加载竞态：目录返回前已选中/手输模型时首跑预填只见空目录；新增目录到达 effect——catalogModels 从空到非空且表单已有模型 ID 时，对未触碰字段补跑一次 type 预填。
- Context 上限不一致：输入框 `max` 1048576 与 `readContextSize`/目录上限 10_000_000 对齐为 10_000_000。
- 验收：既有「为空才填」用例更新为新语义（未触碰即可预填，无需先清空），新增「手动清空不回填 + 未触碰档位仍预填」用例；typecheck/ModelProviderManager 14 例通过。
- 知识库：无需更新（表单交互语义，不变量未变）。
- 关键文件：`src/components/settings/ModelProviderManager.tsx`、`src/components/settings/__tests__/ModelProviderManager.test.ts`。

## 2026-08-05 修复：竞态类三项（review 中 8 批次）（v2.20.216）

- SettingsPanel 权限切换并发竞态：原无锁，A→B 快速连点时 A 的失败回滚可晚于 B 成功写入。加 in-flight ref 守卫（写 server 期间忽略新点击）+ 条件回滚（仅当全局值仍是本次目标才回滚）。
- AppShell 后台任务轮询漂移：原 setInterval 依赖任务 state，每次结果回来重建定时器（实际间隔 = 请求耗时 + 2s/5s）。改 setTimeout 链式调度 + ref 镜像读最新任务态；refresh 函数返回内部 promise 供链式等待（其余调用方不受影响）。
- Git fallback 幂等：`reconcileGitFallbackChanges` 追加前按事件 ID 去重（completed 与轮询对账近同时触发时不再产生重复 change_summary）；`normalizeGitPath` 补多余斜杠归一（新增 1 例）。
- 有意不改：全量历史去重窗口（v2.20.175/186 的文档化权衡——numstat 相对 HEAD 累计，窗口切本轮会重新引入同文件跨轮重复进卡；代价是连续两轮 Bash 改同一未提交文件不重复显示）。跨轮归属根治需按轮 git 快照，超出最小修复范围，记为已知边界。
- 验收：typecheck/全量 1580 通过；SettingsPanel/AppShell 无组件级测试（harness 成本），实机覆盖。
- 知识库：无需更新（竞态修复，不变量未变）。
- 关键文件：`src/components/settings/SettingsPanel.tsx`、`src/components/layout/AppShell.tsx`、`src/App.tsx`、`src/utils/gitFallbackChanges.ts`。

## 2026-08-05 修复：渲染类四项（review 中 9 批次）（v2.20.215）

- hljs 增量不重着色（MarkdownRenderer）：首次 idle 着色后 `<code>` 带 hljs 类+`data-highlighted`，React 复用节点更新文本时旧守卫直接 return。改为按「文本与上次着色是否一致」判断，重着色前清 hljs 类与 `data-highlighted`（highlight.js v11 对带标记节点直接跳过——调试实证只清类会导致着色静默失败）。新 jsdom 用例（先 alpha 后 beta，断言重新着色）调试期负向验证通过。
- 后台 Bash 与模型并列（MessageBubble）：settled/非活跃轮 `assistantFooterFallbackLabel` 原以「后台 Bash 运行中」整盖模型信息，现「模型：X · 后台 Bash 运行中」；无模型保持原文案。更新 1 旧断言 + 新增 2 例。
- assistantParagraphs 假阴性收窄：196 的「数字句点不拆」误伤「1. ## 本章小结」类真标题，收窄为「# 后紧跟数字（议题号）才跳过」。新增 1 例。
- Sidebar 缓存快速路径补 `settleHistoricalQuestions`：Web 端答完澄清后，缓存命中路径此前不对齐，pending 提问长期残留；外层条件放宽为 `session.isLoading || runtimeStatus?.success`（hydrate 对 undefined model 本就可空转，与同文件慢路径一致）。
- 验收：typecheck/定向 66 例通过；Sidebar 改动无组件级测试（harness 成本），由 typecheck+实机覆盖。
- 知识库：无需更新（渲染修复，不变量未变）。
- 关键文件：`src/components/chat/MarkdownRenderer.tsx`、`src/components/chat/MessageBubble.tsx`、`src/utils/assistantParagraphs.ts`、`src/components/layout/Sidebar.tsx` 及对应测试。

## 2026-08-05 修复：审批 settle 幂等与模型盖章错轮守卫（review 中 6）（v2.20.214）

- 复核证伪一条：review 称「kimix.approval.resolved / kimix.turn.model 排在 snapshot skip 之后会被吞」——两事件均无 `snapshotReplay: "history"` 标记，skip 首行即 return false，永不误吞，无需改动。
- 修复 1（审批 settle）：`settleExternallyResolvedServerApprovals` 是唯一外部审批对账入口，此前快照读取失败直接 return 且无后续触发 → 外部已回应审批永久「待审批」；现加有上限退避重试（2s/4s/6s 共 3 次）。另 `waiting_question` 此前被误归 rejected——审批通过后 server 可能继续追问澄清，现计入 approved（新纯函数 `resolveExternalApprovalSettleStatus` + 6 断言）。
- 修复 2（模型盖章错轮）：`kimix.turn.model` 两发射点加 `phase`（dispatch/settle）；settle 相位 `stampCurrentTurnModel` 新增 `requireTurnContent`——目标轮只有空占位 assistant（无正文未完成，即迟到 settle 撞上新一轮）时拒绝盖章，避免旧轮模型 fill-empty 挡住新一轮自己的 dispatch 盖章；dispatch 相位行为不变。
- 验收：新增 3 例（settle 错轮拒绝/dispatch 不受影响/settle 有证据正常盖章）+ 6 断言；typecheck/定向 92 例通过。
- 知识库：无需更新（实现对齐性修复，不变量 65 语义未变）。
- 关键文件：`electron/kimiCodeHost.ts`、`src/utils/kimiHistoryReconciliation.ts`、`src/App.tsx`、`src/utils/__tests__/kimiHistoryReconciliation.test.ts`、`src/utils/__tests__/kimiCodeServerHost.test.ts`。

## 2026-08-05 修复：Server 链路轮末信息卡只剩「模型：k3」（切会话自愈）（v2.20.213）

- 现场：用户实机——长轮结束后 footer pill 只剩「模型：k3」，无输入/输出/Context；切换一次会话即正常。
- 取证（diag.log 事件流）：该轮（27 分钟 swarm 轮，think 14028/tool 29344 帧）全程无 prompt.completed/turn.ended 主终帧；settle 走 snapshot 路径。链式根因：① Server live 流不发 usage.record（208 已确证）；② `refreshServerSessionStatus` 发射的 agent.status.updated 只带 contextTokens/maxContextTokens，**无 usage.currentTurn**（`serverStatusToAgentEvent` 证据）→ 映射出的 status_update 无 tokenCount/inputTokenCount/模型文案；③ `mergeMetricStatusUpdates` 的 hasTurnUsage 只认 token 计数/「模型：」文案 → finalUsageStatus 恒 undefined → 回落 modelOnlyFallbackStatus（只剩模型名）；④ 切会话走 canonical 历史（含 usage.record）才补齐——与用户自愈路径吻合。
- 修复：新增 `mergeContextOnlyStatusUpdates`（专用 context 合成；只认 host 主动状态读取发射的 `status_refresh` 帧 + 正数 contextSize 才出卡，快照恢复/回放的无标 context 帧不算）；ChatThread 轮末卡链改 `mergeMetricStatusUpdates ?? mergeContextOnlyStatusUpdates`，缺模型文案时用当轮助手已盖章模型补齐 message。两道既有守卫均不动——mergeMetricStatusUpdates 严格口径（会话级 context 快照不得自成轮次用量）、ChatThread「context-only recovery snapshot 不渲染为 footer」与入口闸门（status_refresh 闲置不入时间线）全部保持原语义并有测试锁定。
- 验收：新增 4 例（sessionMetrics 合成×2+无标帧拒绝×1、chatRenderItems 端到端×1）；旧代码下端到端用例必失败（旧逻辑回落 footer-model 兜底而非 context 卡，负向成立）；typecheck/定向 99 例通过；实机待验收（下一轮结束 footer 应显示「模型：k3 + Context: …」，token 计数仍待 canonical 补齐）。
- 已知边界：live 卡无输入/输出 token（Server 不提供），canonical 对账后补齐；主终帧未到达的根因（27 分钟轮无 prompt.completed）未单独追查，如复发抓 [wsframe] 取证。
- 知识库：runtime-routing 不变量 14f 补记 Server live 无 token 级用量的显示路径，log 已记。
- 关键文件：`src/utils/sessionMetrics.ts`、`src/components/chat/ChatThread.tsx`、`src/utils/__tests__/sessionMetrics.test.ts`、`src/utils/__tests__/chatRenderItems.test.ts`。

## 2026-08-05 修复：listHistorySessions Server 分支窄映射丢必填字段（v2.20.212）

- 背景：自 review 高 4——host 已映射完整 `KimiCodeSessionSummary`，`main.ts` 二次窄映射只留 id/workDir/brief/updatedAt，`sessionDir`/`createdAt` 在类型上必填却变 undefined（IPC handler 返回无类型约束，typecheck 拦不住）。当前唯一消费方 SearchOverlay 只用 id/brief/workDir/updatedAt，未爆雷，但契约漂移已存在。
- 修复：改 `{ ...session, brief: 兜底 }` 透传。
- 验收：typecheck 通过；消费方行为不变（所读字段原样保留）。
- 知识库：无需更新（实现细节）。
- 关键文件：`electron/main.ts`。

## 2026-08-05 修复：getGitNumstat 主进程同步 IO 改异步分批（v2.20.211）

- 背景：自 review 高 3——untracked 文件行数统计逐文件 `fs.readFileSync`，大量/大型 untracked 文件阻塞主进程事件循环，全应用 IPC 卡死。
- 修复：改 `fs.promises.stat`+`readFile`，8 个一批并发；>8MB 文件放弃行数统计按 0 行（原实现会整个读进内存，更危险）；目录/不可读仍按 0 行。
- 验收：typecheck 通过；electron 侧无 vitest harness（`electron/__tests__` 为空，electron 模块不可入 jsdom），行为等价性靠人工复核：同一路径集合、同一行数规则、同一异常兜底。已知行为变化：>8MB untracked 文件 added 从实计变 0，属有意的安全收窄。
- 知识库：无需更新（实现细节）。
- 关键文件：`electron/projectService.ts`。

## 2026-08-05 测试：帧队列溢出保护补回归 + 修剪日志计数修正（v2.20.210）

- 背景：自 review 高 2——复核后**证伪**审查的「混合队列会误删终止帧」：第一遍全队列扫描后剩余必然全是终止帧，兜底 splice 只在全终止帧极端场景删最老终止帧，语义正确；真实缺口是该保护（160/198 两轮修复核心）无单元测试。
- 变更：kimiCodeServerClient.test.ts 新增「frame queue overflow protection」3 例——滞回修剪（2001→1200、之后不每帧扫描）、混合队列最老终止帧保留且 waitForSessionEvent 可匹配、全终止帧极端兜底截断最老保留较近。顺带修正溢出 warn 日志计数（trimmed removed → dropped，实际删除量恒为 dropped）。
- 验收：typecheck 通过；该文件 66 例通过（63+3）。
- 知识库：无需更新（队列实现细节，不变量未变）。
- 关键文件：`electron/kimiCodeServerClient.ts`、`src/utils/__tests__/kimiCodeServerClient.test.ts`。

## 2026-08-05 修复：新会话入口遗漏消费 pendingNewSessionModel（/new 与推荐卡）（v2.20.209）

- 背景：自 review（v2.20.145..HEAD 全面审查）高 1——207 只修了 EmptyState，`Composer /new|/clear` 与 `useCreateProjectSession`（推荐卡「开启新对话」）仍直接 `getDefaultKimiModel()`，违反不变量 100「所有建会话入口必须优先消费 pending 模型」。
- 修复：两入口对齐 EmptyState.ensureSession——`pendingModel ?? await getDefaultKimiModel()`，创建成功后 `setPendingNewSessionModel(null)` 一次性消费。
- 验收：新增 `useCreateProjectSession.test.ts` 2 例（k3 优先+消费 / 无 pending 回落 config 默认）；typecheck 通过；定向 8 例通过；旧代码下 k3 用例必失败（旧逻辑恒取 config 默认，负向成立）。Composer /new 路径无组件级测试（Composer 渲染 harness 成本高），由 typecheck+实机覆盖。
- 知识库：无需更新（不变量 100 已于 207 入库，本条是收口执行）。
- 关键文件：`src/components/chat/Composer.tsx`、`src/hooks/useCreateProjectSession.ts`、`src/hooks/__tests__/useCreateProjectSession.test.ts`。

## 2026-08-05 修复：当轮消息头/底部信息缺模型，切会话来回才正常（v2.20.208）

- 现场：207 实机验收主链路已通过（k3 执行、选择器不回跳），但当轮「（输出完成）本轮总耗时」行无模型徽标、底部 pill 显示裸「已完成 · 用时 26秒」；切其他会话再回来即正常。
- 根因：消息头徽标（resolveTurnHeaderModelName←processEvent.model）与底部 pill（assistantFooterFallbackLabel←event.model）都依赖 assistant 事件的 model 字段；live 路径从不写它——server 路由 WS 不广播 usage.record（只写 wire.jsonl），agent.status.updated 状态刷新携带的 model 被映射层丢弃（无 usage.currentTurn 时不进 message）。只有切会话触发的历史对账 backfillTurnModelsFromUsageStatuses 从 wire usage.record 回填 model，故「切回来就好了」。
- 修复：host 新增轻量信号 `kimix.turn.model`——sendPrompt 注入模型后立即 emit（dispatch 意图，不变量 65；server/SDK 两路由统一），settle 后以 server 实际模型补 emit（覆盖 Web 发起的外部轮次）；渲染层 App.tsx 预映射分支接收，用新 helper `stampCurrentTurnModel`（backfill 的 live 孪生：扫到最后用户边界、只填空不覆盖）盖到当轮 assistant。合并安全：eventMapper 2162 `incoming.model ?? target.model` 保留已盖章值，不打断流式合并。
- 验收：新增 stampCurrentTurnModel 单元测试 3 例（多段盖章/只填空/同引用短路）；typecheck/全量 1564/build 通过；实机待验收（当轮完成即显示模型徽标+「模型：k3」pill，不必切会话）。
- 已知边界：live 仍无 token/Context 用量卡（server /status 无 usage，需 wire 才有）——用量数字仍在重载后出现，本轮只解决模型信息；dispatch 盖章为意图模型，server 实际分叉的罕见情形以重载对账为准。
- 知识库：runtime-routing invariant 65 扩展（kimix.turn.model 信号），log 已记。
- 关键文件：`electron/kimiCodeHost.ts`、`src/App.tsx`、`src/utils/kimiHistoryReconciliation.ts`、`src/utils/__tests__/kimiHistoryReconciliation.test.ts`。

## 2026-08-04 修复：新对话点推荐被 deepseek 接管根因——EmptyState 不消费 pendingNewSessionModel（v2.20.207）

- 现场：同 206——归档 → 新对话初始页（显示 k3）→ 点推荐 → 选择器变 deepseek、被 deepseek 接管；205/206 两轮未根治。
- 根因（静态锁定，无需运行时诊断）：欢迎屏选模型只写 `pendingNewSessionModel`（ContextBar 无会话分支），显示链路 `pendingNewSessionModel ?? defaultModel` 显示 k3；但 `EmptyState.ensureSession` 建会话只用 `getDefaultKimiModel()`（config 默认），206 的 `effectiveModel = switchedToModel ?? model ?? pendingNewSessionModel` 中 `targetSession.model` 恒非空 → pending 是死代码 → 发送携带 config 默认（本机 deepseek）→ server 执行 deepseek 并状态回写。Composer.ensureSession 才是正确参照（pending 优先 + 一次性消费）。
- 修复：EmptyState.ensureSession 对齐 Composer——`model: pendingModel ?? await getDefaultKimiModel()`，创建后 `setPendingNewSessionModel(null)` 一次性消费。
- 验收：新增 EmptyStateSend 组件回归测试 2 例（k3 优先+消费 / 无 pending 回落 config 默认）；旧代码下 k3 用例失败、修复后通过（负向验证已做）；typecheck/全量 1561/build 通过；实机待验收（归档→新对话点推荐应保持 k3 执行、选择器不回跳）。
- 知识库：runtime-routing 新增 invariant 100（pending 模型是渲染层一次性契约，所有建会话入口必须优先消费），log 已记。
- 关键文件：`src/components/chat/EmptyState.tsx`、`src/components/chat/__tests__/EmptyStateSend.test.ts`、`knowledge/architecture/runtime-routing.md`。

## 2026-08-04 修复：新对话点推荐被 deepseek 接管（显示 k3 却以 deepseek 执行）（v2.20.206）

- 现场：归档 → 新对话初始页（模型显示 k3）→ 点第一条推荐 → 发送后选择器变 deepseek、被 deepseek 接管。
- 根因：初始页模型显示走 ContextBar 全局默认（k3，无 runtime），但 EmptyState 推荐快捷发送创建 runtime 后 prompt 携带 `switchedToModel ?? model`——新会话两者皆空 → undefined → server 用其 deepseek profile 执行；与 v2.20.205 同族（205 权威化防回跳，本条修「根本没携带」）。
- 修复：EmptyState 创建 runtime 时把 `switchedToModel ?? model ?? pendingNewSessionModel` 写入会话 `switchedToModel`（同步 store + targetSession）；发送处 model 改读最新 store 的 switchedToModel 兜底 pendingNewSessionModel。显示值从此进入发送字段。
- 验收：typecheck/全量 1559/build 通过；实机待验收（新对话点推荐应：选择器保持 k3、server 以 k3 执行——可对照 dev 控制台 model 字段）。
- 已知边界：初始页未显式点选模型时 pendingNewSessionModel 可能也为空（ContextBar 局部 defaultModel 不入 store），该罕见组合仍可能回退 server 默认——但那是无显式选择的情形，语义可接受。
- 知识库：无需更新（显示/发送一致性修复，不变量 8 语义复用）。
- 关键文件：`src/components/chat/EmptyState.tsx`。

## 2026-08-04 修复：新会话选 k3 发送被以 deepseek 执行 + 选择器回跳（v2.20.205）

- 现场：204 下「新会话+选 k3+发送」：消息「发送中」久不结束、选择器回跳 deepseek；server REST 实锤 `model=deepseek`、busy=true（deepseek 挂起中），用户 k3 选择没带到 server。
- 根因（两层）：① sendPrompt 的 setModel 以旧 deepseek 配置/连接发 /profile，「卡住的 deepseek」上 updateSession 可能挂起/失败致本轮以旧模型执行；② 挂起/失败后 server 状态刷新（busy 期间 managed.model 未更新时仍回写）把选择器刷回 deepseek。图1「未连接」是前一实例（204 前）的日志。
- 修复：sendPrompt 在 setModel 后把本地期望值直接注入 managed（`managedNow.model = promptModel`）——用户选择是本轮权威意图，server 状态刷新不能再回写；prompt 携带源同步即为此值。k3 选择可生效时以 k3 执行，server 卡住无法 updateSession 时仍以 deepseek 执行但选择器不再回跳。
- 验收：typecheck/全量 1559/build 通过；实机待验收（新会话选 k3 发送：选择器应保持在 k3 或至少不回跳；若仍被以 deepseek 执行，回传——下一步查 setModel 在卡住会话上的具体失败）。
- 已知边界：setModel 对「卡住会话」的失败未单独重试；需诊断时抓 dev 控制台 `[KimiCodeServerHost] prompt failed`/`updateSession` 日志。
- 知识库：无需更新（权限/模型不变量 8 的语义复用）。
- 关键文件：`electron/kimiCodeHost.ts`。

## 2026-08-04 修复：新会话 prompt 被 server 拒（thinking 空串）→ 闪一下无内容+模型回跳（v2.20.204）

- 现场：203 下复现「新会话+切 k3+发送」：闪一下无内容、选择器回跳 deepseek。203 的秒定守卫已生效（无 settled_complete），但 POST 根本没到 server（server messages:0）。
- 取证（dev 控制台）：POST 报错 `thinking: Too small: expected string to have >=1 characters`——`serverControls` 直发 `managed.thinking`，新会话为 ""，server zod 拒收 → sendPrompt 抛错 → 空轮 + 错误回落（模型回跳是回落副作用）。前两次新会话复现同因。
- 修复：`serverControls` 空串不发送 thinking（缺省时 server 用会话默认）。
- 验收：typecheck/全量 1559/build 通过；实机待验收（新会话切 k3 发送应正常流式、选择器保持 k3）。
- 知识库：无需更新（请求体卫生修复）。
- 关键文件：`electron/kimiCodeHost.ts`。

## 2026-08-04 修复：新轮被 pre-POST snapshot 秒定「输出完成 1s」+ 模型选择被 status 刷回（v2.20.203）

- 现场：deepseek 挂后新会话切 k3 发消息，闪一下「输出完成·1s」无内容；底部模型选择器变回 deepseek。
- 取证（diag 14:29:39）：sendPrompt 前「refresh live subscription before POST」的 snapshot（必然 inFlight=0/busy=false）经 snapshot handler `setStatus` 把刚乐观置 running 的轮降级 completed——display 121ms 即 settled_complete；同窗口 status 刷新把 server 模型（deepseek）回写覆盖本地 k3。
- 修复：① snapshot handler 终态降级守卫——`mainTurnActive===true` 且 snapshot 无 in_flight 时不 setStatus（终态判定交给 prompt.completed/settle）；② `refreshServerSessionStatus` 的 modelMutationPending 扩展 `|| mainTurnActive===true`，轮中 server 模型刷新不回写本地选择。
- 验收：typecheck/全量 1559/build 通过；实机待验收（新会话切模型发送应正常流式、选择器不回跳）。
- 已知边界：轮中 Web 侧改模型 Kimix 不实时镜像（轮后收敛），可接受。
- 知识库：无需更新（199 mainTurnActive 信号的复用，语义一致）。
- 关键文件：`electron/kimiCodeHost.ts`。

## 2026-08-04 修复：Context 显示格式轮间不一致（绝对值/百分比随数据切换）（v2.20.202）

- 现场：相邻两轮 footer 一个 `Context: 329.52k`、一个 `Context: 33.05%`。
- 根因：`formatContext` 按 contextLimit 是否存在切换「绝对值/百分比」两种格式；不同轮帧结构不同（usage.record 无 limit / status 帧有 limit）→ 显示不一致。
- 修复：格式只依赖 detailed 开关——非 detailed 一律绝对 token 数（ratio×limit 换算）；detailed 显示 used/limit；纯 ratio 无 limit 的罕见情形才 %。2 新用例。
- 顺带说明：用户该会话输入已达 985k，无首字长等待属百万级上下文 provider TTFT（knowledge large-context-latency runbook，remedy 是 compaction），非链路 bug。
- 验收：typecheck/全量 1559/build 通过；视觉待用户确认两轮格式一致。
- 知识库：无需更新（显示格式修复）。
- 关键文件：`src/components/chat/StatusCard.tsx`、`src/components/chat/__tests__/StatusCard.test.ts`。

## 2026-08-04 修复：折叠提示 pill 图标方向（折叠态应箭头朝右）（v2.20.201）

- 现场：「已折叠较早对话 N 条，点击展开」pill 用 ChevronDown（朝下），与轮次折叠行朝右语义不一致。
- 修复：FoldedHistoryNotice 只在折叠态渲染，图标改 ChevronRight。
- 验收：typecheck/全量 1557/build 通过；视觉待用户确认。
- 知识库：无需更新。
- 关键文件：`src/components/chat/ChatThread.tsx`。

## 2026-08-04 优化：搜索浮层大屏不居中（顶挂 86px）（v2.20.200）

- 现场：搜索窗只在小屏看似居中；大屏顶挂 paddingTop 86 + items-start，垂直不居中。
- 修复：overlay 改 `items-center` + 上下 24px 留白；面板 `maxHeight: calc(100vh - 48px)` + flex column，列表 `minHeight: 0, flex: 0 1 auto`（矮屏内部滚动、大屏整体垂直居中）；头部/scope 行 flexShrink 0。
- 验收：typecheck/全量 1557/build 通过；视觉待用户大小屏各截图验收。
- 知识库：无需更新（纯 UI 微调）。
- 关键文件：`src/components/layout/SearchOverlay.tsx`。

## 2026-08-04 修复：主轮结束仅后台任务挂着时 Kimix 仍「消息处理中」+ 后台工具帧重开 running（v2.20.199）

- 现场：Web 显示主轮已结束（后台 bash 挂着），Kimix 仍「消息处理中」；live 流工具调用混乱，重启后正常。
- 根因（双通道）：① `settleServerSessionAfterPromptCompleted` 按 busy 权威——后台任务使 busy=true → settle 保持 running；② 3198 重开逻辑：后台 bash 的 tool.call.delta 在 status completed 后把状态重开 running。两者都把「会话 busy」误当「轮次 running」。
- 修复：引入主轮信号 `mainTurnActive`（thinking/assistant.delta 或自身 prompt 或 snapshot in_flight → true；主 prompt.completed / snapshot 无 in_flight → false）。① settle 后读 snapshot：`in_flight_turn`/`main_turn_active` 判主轮，busy=true 且主轮已结束 → completed（后台任务自有面板）；② 重开逻辑加 `mainTurnActive !== false` 守卫。无法确认时保守按 busy（不假完成）。3 新断言。
- 验收：typecheck/全量 1557/build 通过；实机待验收（主轮结束+后台 bash 挂着时 Kimix 应 settle，后台任务面板独立显示）。
- 已知边界：status 帧通道（agent.status.updated busy=true）未加降级——若 server 在后台期持续广播 status 仍可能翻回 running，观察实机后必要时补。
- 知识库：无需更新（状态裁决实现细节；不变量 8/7 语义未变）。
- 关键文件：`electron/kimiCodeHost.ts`、`src/utils/__tests__/kimiCodeServerHost.test.ts`。

## 2026-08-04 性能：帧队列溢出每帧 O(n) 扫描+同步 warn 的主进程 CPU 黑洞（v2.20.198）

- 现场：196 dev 日志 8651 条 `frame queue overflow`，启动即开始、持续整轮。
- 根因：`queued` 是无 waiter 时也全量保留的竞态兜底队列（上限 2000）；长轮无 waiter 期间每来一帧溢出一次：一次 O(2000) 终止帧保护扫描 + 一次同步 console.warn → 主进程 CPU 黑洞，整机卡顿帮凶。
- 修复：滞回修剪（>2000 一次剪到 1200，摊还扫描成本）+ warn 限流 5s；终止帧保护语义不变。
- 验收：typecheck/全量 1557/build 通过；实机待验收（长轮期间日志不再刷 overflow，主进程占用下降）。
- 知识库：无需更新（队列实现细节，不变量未变）。
- 关键文件：`electron/kimiCodeServerClient.ts`。

## 2026-08-04 修复：select 无目录档位残留不对称清空 + 195 探针三段序补测试（v2.20.197）

- 背景：review 195/196 后确认 #7 残留不对称仍在（select 切到目录未声明档位的模型时档位保留旧模型值），且 195 探针三段序无测试覆盖。
- 修复：`prefillFromCatalog` select 模式档位改为 `catalogEfforts ?? []`——目录带档位时覆盖、无档位时清空（不再返回 null 保留旧模型档位）；type 模式保持「为空才填」不变。更新 4 处既有断言 + 语义注释。
- 补测试：`kimiCodeServerClient.test.ts` 新增「post-terminal external prompt watch probe」describe 4 用例——命中（snapshot 边界晚于轮末 → 删 watch + 两次 recoverSnapshot 共 3 次 /snapshot 请求）、未命中保留 watch、无 user 保留 watch、本地 pendingPrompts 存在时删 watch 不 recover。
- 验收：全量 1557 测试通过（+4）、typecheck 通过；build 未跑（逻辑改动，dev 重启时验证）。
- 关键文件：`src/utils/modelProviderConfig.ts:132-146`、`src/utils/__tests__/modelProviderConfig.test.ts`、`src/utils/__tests__/kimiCodeServerClient.test.ts:1929-2012`。
## 2026-08-04 修复：富文本误拆加粗列表项（「**1. #7」→ 残片+一级大标题）（v2.20.196）

- 现场：Kimix 渲染另一方 review 消息时字超大、`**1.` 字面残留、加粗/列表不解析；Web 正常。
- 根因（原文复现证实）：`restoreInlineMarkdownHeadings` 正则把「序号句点 + 空格 + #议题号」（`1. #7`）当内联标题恢复，拆成 `**1.` + `# 7 …` 一级标题（渲染巨大），加粗被撕开成字面星号。
- 修复：replace 改函数回调——标点为 `.`/`。` 且前字符为数字时不拆；其余恢复语义不变。2 新用例（`1. #7` 保持原样 / 真标题仍恢复）。
- 验收：typecheck/全量 1553/build 通过；实机待用户验收（该消息重渲染后应为正常加粗段落）。
- 知识库：无需更新（渲染修复启发式收窄，不变量未变）。
- 关键文件：`src/utils/assistantParagraphs.ts`、`src/utils/__tests__/assistantParagraphs.test.ts`。

## 2026-08-04 修复：外部新轮早到工具帧粘到上一轮（工具卡丢失+思考块粘连）（v2.20.195）

- 现场：Web+Kimix 同开，Web 运行中可见的工具调用（读文件×2、sed、git status）Kimix 丢失，思考块粘连；新实例启动全量重放（顺序正确）则全部正常 → 判定为 live 探针路径帧序问题。
- 根因：183 回溯重订阅在探针命中时立即执行，此时 snapshot 可能尚未提交用户边界（REST /messages 先可见）→ 早到工具帧在边界之前挂载粘到上一轮；边界后到也无法重排已挂载工具。
- 修复（探针三段序）：① 边界判定改以 **snapshot** 为准，未提交保留 watch 下轮重试；② 先普通 recoverSnapshot 挂边界；③ 再以**恢复前捕获的轮前 cursor** 显式重订阅（recoverSnapshot 新增 resubCursor 选项替代 backdateResubCursor）回放早到帧——边界必先于工具帧。
- 验收：typecheck/全量 1551/build 通过；实机待用户验收（Web 再发一轮，工具卡应齐全、思考块不粘连）。
- 已知边界：snapshot 提交滞后期间探针每 4s 重试（watch 保留），最坏延迟数秒；重复重订阅帧幂等。
- 知识库：无需更新（183/194 机制的序修正，不变量语义未变）。
- 关键文件：`electron/kimiCodeServerClient.ts`。

## 2026-08-04 修复：外部新轮启动时全量 snapshot 重放风暴致卡死+旧气泡误显「消息处理中」（v2.20.194）

- 现场：Web+Kimix 同开，Web 发消息后 Kimix 把上一条消息气泡映射为「消息处理中」，且整 UI 卡死（滚动/点击无响应），Web 已继续走消息。
- 取证（diag 12:06:16）：外部轮启动触发 recoverSnapshot，指纹 legitimately 变化（in_flight 出现）→ **全量 100 条历史合成帧（46+ turn.ended，1ms 内）灌入渲染管线**；18k events 会话每帧触发重渲染 → 卡死；风暴期间新轮用户边界未挂上，running 状态挂到旧气泡 → 错位。191 指纹守卫只挡「不变」，挡不住「合法变化」的全量重放。
- 修复：host snapshot 重放改**增量尾部**——按上一次 snapshot 最新消息 id 切片（`lastSnapshotLatestMessageIds`），只重放其后新增历史消息 + in_flight；id 找不到（窗口滑动）才全量。注意 msgs=100 是分页上限，count 切片无效，必须用 id。
- 验收：typecheck/全量 1551/build 通过；实机待用户验收（Web 发新轮后 Kimix 不再卡死、不再错位显示「消息处理中」、边界数秒内挂上）。
- 已知边界：窗口滑动超 100 条时回落全量（罕见）；历史消息被外部编辑不重放（轮末对账兜底）。
- 知识库：无需更新（191 守卫的性能补强，不变量语义未变）。
- 关键文件：`electron/kimiCodeHost.ts`。

## 2026-08-04 修复：192 静态 import highlight.js 致 dev 启动崩溃（v2.20.193）

- 现场：192 后打开 dev 直接「界面遇到错误」：`Cannot read properties of null (reading 'useState')`（vite deps chunk）——新增静态依赖触发 vite 重新预打包，旧 `node_modules/.vite` 缓存使 React 双副本。
- 修复：hljs 改**动态 import**（`import("highlight.js/lib/common")` 在 idle 回调里，主 chunk 彻底无 hljs 静态依赖，首包 -340kB）；清 `node_modules/.vite`/`.cache` 后重启。cleanup 置 cancelled 防卸载后着色。
- 验收：typecheck/全量 1551/build 通过；实机待用户确认打开不再崩溃、首滚顺滑、代码异步着色。
- 教训：渲染层新增静态重依赖要走动态 import（dev 预打包 churn + 首包体积）。
- 关键文件：`src/components/chat/MarkdownRenderer.tsx`。

## 2026-08-04 优化：首次滚动 1-3s 卡顿——hljs 高亮移出渲染通道（v2.20.192）

- 现场：191 后周期性 bursts 消失，但首次滚动最初 1-3s 仍卡。
- 根因：首次上滚触发历史扩展/挂载，代码块经 rehype-highlight 在 **react-markdown 渲染通道内同步高亮**，大批代码块挂载时 hljs 解析占主线程 1-3s。
- 修复：rehypePlugins 去掉 rehypeHighlight；CodeBlock 挂载先出纯文本，`requestIdleCallback`（600ms timeout，回退 setTimeout 120ms）里 `hljs.highlightElement`（highlight.js/lib/common，与低亮语言集一致）异步着色；卸载取消。着色略延迟出现，换取首滚/扩展不被阻塞。
- 验收：typecheck/全量 1551/build 通过；实机待用户验收（首次上滚应明显顺滑，代码着色稍后出现）。
- 已知边界：idle 被持续滚动推迟时着色延后；流式 Plain→Rich settle 路径同样受益。
- 知识库：无需更新（渲染性能微调，streaming-render-pipeline 既有预算语义不变）。
- 关键文件：`src/components/chat/MarkdownRenderer.tsx`。

## 2026-08-04 修复：上下滚动卡顿（snapshot 同指纹重放风暴）+ 大会话结构性问题登记（v2.20.191）

- 现场：用户反馈页面上下滚动卡顿异常。diag 取证（session da02b357）：
  1. 该会话累计 **18k events**（含 630+ 工具调用的轮），`buildRenderItems` 单次 **max 448ms**、persist.strip **1039ms**（longTask max 1053ms）——任何触发重建的更新都百毫秒级卡主线程，滚动尤甚（根因，结构性）；
  2. 放大器：每次 `recoverSnapshot`（idle 90s 重连/探针恢复）把**同一快照**（as_of_seq=1804 两小时不变）重放，单次 50+ `turn.ended` 帧 2ms 内灌入渲染管线，累计 **4700 次重复投递**——纯浪费 storms，叠加大会话成周期性卡顿。
- 修复（191）：host 的 `kimix.server.snapshot` 处理加同指纹跳过守卫（as_of_seq|epoch|inFlight|条数 不变 → 直接 return，不重放历史帧/不重发 pending 合成；首帧与内容前进仍正常重放）。
- 验收：typecheck/全量 1551/build 通过；实机待用户验收（滚动应无周期性 bursts；idle 重连不再灌帧）。
- 未完成/后续登记（结构性，另开轮次）：① 大会话渲染窗口化（buildRenderItems 对全量 events 重建 448ms）；② persist.strip 18k events 1s 主线程（knowledge 243 已记预算项，需增量 strip 或分片）。
- 知识库：无需更新（性能修复未变不变量；结构性问题已在 streaming-render-pipeline 243 段覆盖 persist 语义）。
- 关键文件：`electron/kimiCodeHost.ts`（snapshotReplayFingerprints 守卫）。

## 2026-08-04 优化：代码块留白/占比对齐官方 Web（v2.20.190）

- 现场：同内容代码块官方 Web 比 Kimix 更易读、留白与占比更合理（三主题对比截图）。
- 官方实现实测（curl 其 CSS bundle，markstream-vue）：body padding 8/12、字号 12px/行高≈1.65、头部**无灰底**（surface/transparent + 底分隔线）、头部≈36px、复制**纯图标**、外边距 1.5em、圆角 8px、body 用 sunken 底色。
- Kimix 原状：body 16/18、14px/24px、头部 surface-hover 灰底 ≈46px、复制图标+文字、my-3。
- 修复（MarkdownRenderer CodeBlock + index.css）：body padding 10/14、字号 13/行高 21（取 Web 与旧值中间保可读性）、头部去灰底+紧凑（6px 上下）、复制按钮图标化（26px）、外边距 14px 0。圆角/边框既有不动。
- 验收：typecheck/全量 1551/build 通过；视觉待用户三主题截图验收。
- 知识库：无需更新（纯 UI 微调）。
- 关键文件：`src/components/chat/MarkdownRenderer.tsx`、`src/index.css`。

## 2026-08-04 功能：轮中允许预切换权限/plan/思考强度，下一轮生效（v2.20.189）

- 现场：官方 Web 轮中可正常切换权限模式等；Kimix 的权限/plan/思考强度按钮轮中被 `isMutationOwnerRunning` 禁用（swarm 已允许轮中切换、下一轮生效）。
- 修复：三者解锁（disabled 去掉 running 门禁，canTogglePlanMode 同步），轮中切换走即时写 server profile（与官方 Web/设置面板同语义，下一轮起生效）；权限处理器删除轮中 toast 拒绝 + pending 分支，直接 applyPermissionMode；移除 `pendingPermissionChange` 工具与测试（机制被即时写取代）；title 文案改「运行中切换将从下一轮生效」。
- 保留门禁：撤销/房间变更等真实 mutation 控件仍轮中禁用；hasUniqueMutationOwner/canUseComposer 不变。
- 验收：typecheck/全量 1551（-2 pending 用例）/build 通过；实机待用户验收（轮中点权限/plan/思考强度应可切换且 toast/标题语义正确，下一轮生效）。
- 知识库：不变量 8 扩写轮中可切换语义，log.md 已记。
- 关键文件：`src/components/chat/Composer.tsx`、`src/components/settings/SettingsPanel.tsx`（注释）、删除 `src/utils/pendingPermissionChange.ts`+测试。

## 2026-08-04 修复：全宽行式按钮按压时阴影/灰底左右覆盖不全（v2.20.188）

- 现场：变更卡「再显示 N 个文件/收起」展开收起按钮点击时灰底+阴影左右收缩、露出卡片底色，表现奇怪。
- 根因：`.kimix-muted-action:active:not(:disabled) { scale: 0.96 }` 全局按压缩放对小按钮合适，对 w-full 行式按钮会让整行横向缩 4%，两侧露底。
- 修复：新增角色类 `.kimix-row-action`（`:active` scale 保持 1，按压只变色不缩放），挂载 5 处全宽行按钮：ChangeCard 展开/收起 ×2、HooksPanel 模板行 ×2、ContextBar 入口行 ×1。紧凑小按钮（Composer/RoomPicker 等）保留原按压反馈。
- 验收：typecheck/全量 1549/build 通过；视觉待用户截图验收（默认/retro/nostalgia 三风格下按压行按钮不再横向收缩）。
- 知识库：无需更新（纯 UI 微调）。
- 关键文件：`src/index.css`（kimix-row-action 规则）、`ChangeCard.tsx`/`HooksPanel.tsx`/`ContextBar.tsx`。

## 2026-08-04 修复：配置新模型后老会话必须重启才能用（v2.20.187）

- 现场（用户 145 复现）：设置里配置新模型后不重启，老会话继续对话报 `Model "…" is not configured in config.toml`；重启后正常。
- 分析：报错来自官方运行时用内存配置校验；配置写盘从一开始就对，缺的是通知运行中的运行时。现状缺口：① idle SDK 会话保存后有 `reloadIdleSessions` 覆盖；② **server 路由会话不在重载范围**（`reloadIdleSessions` 只遍历 SDK sessions map，官方 server 无公开 reload 路由），是否热生效 POST /api/v1/config 的 models 无证据；③ 保存时运行中的 SDK 会话被 skip，旧 toast 承诺「下一轮生效」未验证。
- 修复：`sendPrompt` 两处 catch 增加陈旧配置恢复——匹配 `not configured in config.toml` 且模型在本地 config（reload 读）存在时：server 会话 `migrateServerSessionToSdk`(pinToSdk) 后重试一次；SDK 会话 `reloadSession` 后重试一次；恢复失败落回原错误路径（真缺模型不循环）。toast 措辞改为如实描述恢复机制。
- 探针决策：server 热生效探针需改用户全局 config.toml（探针 server 共享全局配置），收益仅知识存档、不改变修复覆盖面，**不跑**；改由用户重跑 145 复现做端到端验收（server 热生效则直接成功，不热生效则恢复机制迁移+重试成功，两种结果都不需要重启）。
- 验收：typecheck/全量 1549/build 通过；实机待用户按 145 步骤复验。
- 已知边界：server 会话恢复后 pin 到 SDK（与 reload 语义一致，server 恢复后不弹回）；恢复重试仅一次且仅在特定错误后。
- 知识库：runtime-routing.md 新增不变量 92，log.md 已记。
- 关键文件：`electron/kimiCodeHost.ts`（isModelNotConfiguredError/isModelConfiguredLocally + 两处 catch 恢复）、`electron/main.ts`（toast 措辞）。

## 2026-08-04 修复：08-03~08-04 改动复查清单（8 项修复 + 2 项澄清）（v2.20.186）

- 背景：6 子代理并行 review 08-03 起 30 提交；经逐条复核修正严重级（无高危，多数低概率/展示层）；用户先修 select 档位粘住（v2.20.185），本轮修复其余项。
- 修复：
  1. #5 CATALOG_EFFORT_TO_KIMIX 补 `max: "max"`——实测 models.dev 588 条带 max、253 条 max-without-xhigh（kimi-k3/glm-5.2）预填丢 max 档；
  2. #11 SessionToolbar renameError 补 `backgroundColor: var(--accent-danger-light)`（与 AddRoomAgentDialog 对齐）；
  3. #3 settleExternallyResolvedServerApprovals 快照读取失败时保守跳过 settle（原仍全部按去向误报 approved/rejected）；
  4. #4 settleHistoricalQuestions 仅明确 `isWaitingQuestion === false` 才 settle——getStatus 失败（undefined）时保守保留 pending，避免真实等待中的提问被误标已解决；
  5. #1 live 轮末观察窗 arm 后异步校准 terminalAt 到官方最新消息时间戳（取时间戳最大一条，与顺序无关）——消除探针跨时钟域比较（本地钟偏快时漏检两轮合并）；
  6. #6 matchCatalogModel 加「剥离 provider 前缀后裸 id」回退匹配（仅唯一命中），修复 models.dev 带前缀 id（48%）对 OpenAI/Anthropic/Google 探测预填静默失效；
  7. #2 git numstat：`-c core.quotePath=false`（中文路径不转义）+ `--no-renames`（rename 拆删除/新增）+ 二进制 `-` 行过滤 + staged/unstaged 同路径合并（原 4 缺陷：乱码/重复/空卡/双计）；
  8. #8 SettingsPanel 权限写失败回滚改回点击前全局默认（`globalBefore`），不再用会话值污染全局默认。
- 变更：
  9. #12 变更卡跨轮重复：collectRecordedChangePaths 改全量历史去重（git numstat 是相对 HEAD 累计快照，同一未提交文件跨轮不重复显示）；取舍：连续两轮 Bash 改同一未提交文件时第二轮不重复显示；
  10. #9 设置面板轮中即时写 vs Composer pending 属设计差异，加注释澄清不改逻辑。
- 验收：全量测试通过（新增 #4 1 用例、#6 3 用例、#12 1 用例，共 5 新用例；#2/#5 经一次性实测脚本验证 5+5 场景后删除）；typecheck 通过；`pnpm build` 通过。
- 已知边界：#2 中文路径反转义依赖 core.quotePath=false（git 版本均支持）；#12 全量去重对「连续两轮 Bash 改同一未提交文件」第二轮不显示；#1 校准失败回落本地时间基线（等效旧行为）。
- 关键文件：`electron/kimiCodeHost.ts:2634,3646`、`electron/kimiCodeServerClient.ts:1055-1074,1999`、`electron/projectService.ts:471-530`、`src/components/settings/SettingsPanel.tsx:1166,1214`、`src/components/layout/SessionToolbar.tsx:703`、`src/utils/eventHelpers.ts:566-578`、`src/utils/modelProviderConfig.ts:76-95`、`src/utils/gitFallbackChanges.ts`、`src/App.tsx:768-772`。

## 2026-08-04 修复：select 切换模型档位不跟随（Context 跟、档位留旧）（v2.20.185）

- 现场：复查清单 #7 我原判「静态未能证实」，用户读码纠正：机制在两条路径交汇处，成立。
- 根因：`handleDiscoveredModel`（select 路径）里 Context 每次 select 强制刷新（select 模式 `probe ?? catalogLimit ?? infer` 恒有值），而 `prefillFromCatalog` 的档位仅在当前为空数组时预填、否则 null → `?? current.supportEfforts` 留旧值。复现：选 A（预填 [low,high]）→ 选 B（目录 [medium]）→ draft = B 的 Context + A 的档位，保存带旧档位入库。
- 修复：select 视为新意图——目录带非空档位时覆盖（与 Context 对称）；type（手输）保持「为空才填」不覆盖手改。2 新用例（select 跟随 / 新模型无档位保留现值）。
- 验收：typecheck/全量 1549/build 通过；实机待用户验收（探测下拉 A→B 切换后档位应跟随 B）。
- 已知边界：新模型目录无档位时保留现值（无权威来源可跟随，合理不对称）。
- 知识库：无需更新（局部表单行为调整，v2.20.171 本身未入知识库）。
- 关键文件：`src/utils/modelProviderConfig.ts`（prefill 语义）、`src/utils/__tests__/modelProviderConfig.test.ts`。

## 2026-08-04 修复：182 前遗留污染行仍在信息卡显示通知文案（v2.20.184）

- 现场：v2.20.183 实机，轮末信息卡仍显示「后台任务已完成：后台跑… 输入 输出 Context」。
- 复查结论：182 的跨类不折叠对新合并生效（用例+代码确认），但截图行是 **182 之前持久化的遗留合并行**（该轮 15:5x 结束于 181 环境，合并行已落 IndexedDB）；且 `sessionMetrics.mergeMetricStatusUpdates` 的 reduce 也有 `message: incoming ?: acc` 继承，遗留行（带度量）会把通知文案再传进页脚。
- 修复：`sessionMetrics` 新增 `isNotificationSummaryMessage`（通知摘要前缀，与 eventHelpers 摘要构造同源）；① `getStatusCardDetailTexts` 度量行剔除通知文案（显示层兜底，与既有 tone/source 遗留修复同先例）；② `mergeMetricStatusUpdates` message 继承双侧剔除。2 新用例（度量行剔除、纯通知行保留）。
- 验收：typecheck/全量 1547/build 通过；实机待用户验收（遗留行无需切会话，渲染即修复）。
- 已知边界：前缀列表与 eventHelpers 摘要构造需保持同源（硬编码两处，注释互指）。
- 知识库：runtime-routing.md 14f 补显示层兜底句，log.md 已记。
- 关键文件：`src/utils/sessionMetrics.ts`、`src/components/chat/StatusCard.tsx`、`src/components/chat/__tests__/StatusCard.test.ts`。

## 2026-08-04 修复：外部新轮首段丢失（等待首事件 30+s 后同步仍缺思考/首段正文）（v2.20.183）

- 现场：v2.20.182 实机双端对比。Web 侧发新轮后 Kimix 长时间「等待首个模型事件 33秒」，开始同步后直接是工具调用，缺 Web 可见的思考与首段正文（「读代码先。你好霖江路！合理质疑…」）。
- 取证（diag [wsc]/[wssnap]/[live] 闭环）：① 07:52:41 外部轮开始，旧订阅只收到 status 帧，**无任何 thinking/body 帧**（server 不向轮前建立的订阅推送新轮早期帧）；② 07:52:45 181 探针命中后 forceWatchdogReconnect，snapshot inFlight=1 但**首段尚未提交**，as_of_seq=1284 续订把 1280-1284 的早期帧永久丢掉（重连后 thinking.delta 从 offset=34 恢复）；③ 轮中 canonical 对账被单调性闸门拒绝（本地 live thinking 更富），首段只能等轮末对账——用户看到的就是「首段不对」。
- 修复：探针命中不再断连接，改 `recoverSnapshot(sessionId, { backdateResubCursor: true })`——同连接以**轮前 cursor** 重订阅，server 回放新轮早到的 thinking/body 帧；snapshot 同时补用户边界。早到帧在边界挂载后按 live 流挂载到新轮，首段如始终在线般流式出现。
- 验收：typecheck/全量测试/build/knowledge 结果待出；实机待用户验收（Web 发新轮后 Kimix 应数秒内出用户边界+思考+首段正文，与 Web 同步）。
- 已知边界：回溯重订阅会重放少量已处理帧（渲染层按 id/offset 去重，幂等）；server 若不认回溯 cursor 会 resync_required，既有 recoverSnapshot 兜底。
- 知识库：runtime-routing.md 不变量 90(a) 探针语义重写，log.md 已记。
- 关键文件：`electron/kimiCodeServerClient.ts`（recoverSnapshot backdate 参数 + 探针改同连接重订阅）。

## 2026-08-04 修复：轮末信息卡混入后台任务通知文案（v2.20.182）

- 现场：v2.20.181 实机，轮末用法信息卡显示「后台任务已完成: 后台跑全量测试确认基线 输入: 100.67k 输出: 2.37k Context: 100.67k」——通知文案不该出现在度量卡里。
- 根因：`mergeEvents` 的 status_update 合并分支里 `message` 仍是「incoming 没有就继承 last」旧规则（v2.20.176 只修了 source/tone/parentEventId 继承）。后台任务信封（role=user 的 `<notification>`，映射为 source=runtime/tone=success 的 status_update）先到，usage 快照（无 message 或仅模型文本）后到，合并行 = 通知文案 + 度量数字 + 中性色调。反向同样：通知卡会继承先到的度量数字。
- 修复：新增 `isNotificationStatusUpdate`（带 tone 或 source 为 runtime/skill/slash），合并分支跨类不折叠（双向各自成行）；同类度量行保持折叠与模型文本继承。3 新用例（跨类双向不折叠、同类折叠保留模型文本）。
- 验收：typecheck/全量测试/build/knowledge 结果待出；已持久化的污染行经切会话 canonical 重放自愈（重放走修复后的 mergeEvents）。
- 已知边界：无标记的反馈行（如「输出打断」、ui/ipc 源）仍按旧合并语义（非本次报告场景，不扩大范围）。
- 知识库：runtime-routing.md 不变量 14f 扩写 message 族规则，log.md 已记。
- 关键文件：`src/utils/eventMapper.ts`（isNotificationStatusUpdate + 跨类守卫）、`src/utils/__tests__/eventMapper.test.ts`。

## 2026-08-04 修复：轮末观察窗永不触发 + 重启丢失，外部新轮仍两轮合并（v2.20.181）

- 现场：v2.20.180 实机，Web 侧发第二轮后 Kimix 仍不显示用户消息、两轮回复合并（与 179 同场景）。
- 根因（两层叠加）：① 179 探针 `[...items].reverse().find(user)` 在 newest-first 的 items（items[0] 即最新，进度标记依赖此序）上取到的是**最老**用户消息，`userAt <= terminalAt` 恒成立，探针永不触发——179 出生即无效；② 观察窗只挂在当前进程的 live 主 agent 轮末帧上，进程重启后 idle 会话 resume 拿到的是 snapshot 重放帧（被 `recovered_from_snapshot` 排除），窗口永不挂载。
- 修复：① `latestUser` 改 `items.find(...)` 取最新用户；② 新挂载点：`recoverSnapshot` 后无 `in_flight_turn` 时以 `terminalAt = snapshot 最新消息时间戳` 挂载（与官方用户消息同源时钟），覆盖重启/重连对账；③ 去掉 180s 过期，仅 unsubscribe/pending 清除，覆盖长 idle 后发消息；④ 抽 `armPostTerminalExternalWatch` 共用挂载点。探测命中后强制重连拿 snapshot 补边界，179 的 mergeEvents 乱序插入保证归属。
- 验收：typecheck/全量测试/build 结果待出；实机待用户验收（重启后已合并的旧会话有望经启动对账 canonical 历史自愈；新外部新轮应 ≤4s 出边界）。
- 已知边界：每挂载会话 idle 时 4s 一次 HTTP GET /messages（与既有 8s idle 进度探针同量级，可接受）；误报代价仍为一次重连 + snapshot 补全。
- 知识库：runtime-routing.md 不变量 90(a) 段重写，log.md 已记。
- 关键文件：`electron/kimiCodeServerClient.ts`（探针取序/挂载点/去过期/公共方法）。

## 2026-08-04 修复：Web 侧新建对话不同步到 Kimix 侧栏（v2.20.180）

- 现场：用户在官方 Web 新建对话并发送消息后，Kimix 侧栏（v2.20.179）不出现该新会话，需折叠重展开或重启才可见。
- 根因：官方 Server 不广播「其他客户端新建会话」（WS 订阅是会话级）；侧栏 `refreshExpandedProjectSessions` effect 只依赖 `expandedProjectPaths`/`recentProjects` 变化触发，无周期/焦点刷新，外部新建会话永不被发现。
- 修复：Sidebar 新增 30s 周期 tick + 窗口 focus/可见性回归触发，复用既有 `listKimiCodeSessions` + `reconcileOfficialSessionCatalog` 链路（合并幂等、无变化不写状态；缺失官方会话以懒加载镜像进入侧栏；归档清扫仍只认显式证据，周期刷新不会误归档）。
- 验收：typecheck/全量测试/build 结果待出；实机「Web 新对话 ≤30s 或焦点回归后出现在 Kimix 侧栏」待用户验收。
- 已知边界：只刷新已展开项目的目录（现场目标项目为展开态）；每 tick 每展开项目一次 HTTP GET /sessions；窗口未聚焦时最慢 30s 发现。
- 知识库：runtime-routing.md 新增不变量 91，log.md 已记。
- 关键文件：`src/components/layout/Sidebar.tsx`（常量 + tick/focus effect + deps）。

## 2026-08-04 修复：Web 侧新轮用户消息 Kimix 缺失 + 两轮回复合并 + 外部已回应审批永久待审批（v2.20.179）

- 现场：用户全程在官方 Web 侧交互（session_c0197cc1-13ad-430e-b4db-d303e8d14aa0），Kimix 侧（截图 v2.20.178）：① Web 第二次发的用户消息不显示，两轮 agent 回复糅合到一轮；② Web 已回应的权限申请在 Kimix 仍待回复，底部常驻「待审批」。
- 根因 1：官方 Server live WS 不广播其他客户端发起的新轮用户消息（TurnBegin 仅 snapshot 重放合成）；前轮尾帧 + 新轮头帧使静默低于 watchdog 阈值，既有静默探针抓不到 → 用户消息永久缺失、两轮合并。
- 修复 1：`kimiCodeServerClient.ts` 轮末观察窗（live 主 agent `prompt.completed/aborted` 后 180s，每 4s 轮询官方历史），发现晚于轮末的用户消息即强制重连拿 snapshot 补用户边界；`eventMapper.mergeEvents` 对迟到的稳定用户边界（`user:*` id）按时间序插入而非追加尾部（id 去重；本地非稳定消息仍走追加路径，3 新用例）。
- 根因 2：其他客户端回应审批后 Server 不广播 resolved 帧，只把条目从 `pending_approvals` 移除 → Kimix 审批卡永远「待审批」。
- 修复 2：`kimiCodeHost.setStatus` 从 `waiting_approval` 迁出时回读 snapshot，对本地跟踪且已不在 pending 列表的审批发 `kimix.approval.resolved`（去向 running/completed 视为 approved，其余 rejected）；`App.tsx` 把会话与房间 agent 分区里对应 pending `approval_request` settle 掉。本地 respondApproval 先删 id 再改状态，不会自触发。
- 验收：全量 1542 测试通过、typecheck 通过、`pnpm build` 通过；实机双端同步待用户验收（复验需确保 dev 为 v2.20.179 构建）。
- 已知边界：观察窗仅在 live 主 agent 轮末帧后开启（启动时 idle 会话由既有启动对账覆盖）；探测误报代价为一次重连 + snapshot 补全（无害）；审批 settle 依赖状态迁出 waiting_approval 的帧，状态帧丢失时仍靠 snapshot 对账兜底。
- 知识库：runtime-routing.md 新增不变量 90（跨客户端广播双缺口与本地补偿），log.md 已记。
- 关键文件：`electron/kimiCodeServerClient.ts`（观察窗/探针/重连）、`electron/kimiCodeHost.ts:3626-3668`（审批 settle）、`src/App.tsx:2708-2727`（resolved settle）、`src/utils/eventMapper.ts:2585-2603`（乱序插入）。

## 2026-08-04 结论：权限双向同步链路 live 实测全部正常（v2.20.178 环境下）

- 用户反馈「两个方向都不行」后做了一系列 live 实测（CDP 直连运行实例 + curl 带 server.token 直写官方 REST）：
  1. **Kimix→server**：CDP 调 `setKimiCodePermission` 多次写入（含轮次运行中写 yolo/auto 往返），`/status` 回读全部生效且稳定。
  2. **server 外部变更→Kimix**：curl 直写 profile（auto→manual），6ms 后 Kimix 收到 `agent.status.updated` 广播帧（diag `[live] stream` 实证），`session.permissionMode` 跟随 manual；再写回 auto 再次跟随——广播→`syncSessionPermissionMode` 链路完整。
  3. 用户 05:52 的两次点击（auto/yolo）从 diag 看 IPC 都成功执行，且事后实测 server 值证实 **写入其实落库了**（yolo 生效）——用户看到的「不行」更可能是：测试时 dev 实例是旧构建（sidebar 显示 v2.20.177），以及 **web 端权限 pill 不随广播实时刷新**（web 读 status，但页面可能需要手动刷新才重新拉取；web 侧行为 Kimix 无法控制）。
- 结论：v2.20.178 下双向链路协议层全部正常，无新增代码修复。遗留观察项：web pill 实时性（官方 web 侧问题）；用户复验需确保 dev 为最新构建。
- 知识库：无需更新（不变量 8 已覆盖本轮验证的链路语义）。

## 2026-08-04 修复：权限模式调整被缓存吞没不同步到 server（v2.20.178）

- 现场：用户反馈权限模式在 Kimix 调整后 kimi code web 不同步（截图：Kimix「完全自主 auto」、web「自动通过 yolo」）。
- 取证（live）：官方 server `/status` 实测 `permission: "yolo"`，Kimix 本地 `session.permissionMode = "auto"`——调整没落库。web bundle 分析：当前版本 web 的权限 pill 显示**读 server status**（不是旧版 localStorage 显示），但每个 prompt 携带 `permissionMode: e.permission`（本地持久化状态），与 Kimix 的 prompt 携带 `permission_mode: managed.permission` 形成「最后写入者胜」。
- 根因两个：① `kimiCodeHost.ts:1627` 的 early-return 拿**缓存** `serverManaged.permission` 对比目标值——web 经 prompt 改写 profile 后缓存过期，缓存==目标时显式调整被静默吞掉，且连 v2.20.165 的写后回读也被跳过（UI 保持乐观值、server 保持旧值）；② `Composer.tsx:3877` 同模式点击纯 noop 不发 IPC，已不一致时用户点当前模式无法重新对齐。
- 修复（v2.20.178）：① setPermission 改「先回读再决定」——先 `refreshServerSessionStatus` 拿 server 真值（校准缓存 + emit 同步 UI，失败不阻塞写入），新鲜值==目标才跳过写入，否则写入 + 写后回读；② 同模式点击改为重申语义（`click:reassert-same-mode`），仍走 applyPermissionMode 向 server 重申（轮次中保持 pending 流程不轮中直写）。
- 验收：全量 1539 测试通过（新增 `shouldWritePermissionToServer` 3 用例）、typecheck 通过、`pnpm build` 通过、`knowledge:validate` PASS；实机双端权限同步待用户验收。
- 已知边界（范围外）：resume 重放与 prompt 携带仍以本地值覆盖 server（最后写入者胜的协议本质），后续可单独评估 resume 时 adopt server 值；回读失败时按缓存判断仍有小吞没窗口（保守取舍）。
- 知识库：`runtime-routing.md` 不变量 8 权限段扩写（先回读再决定 + 最后写入者胜说明），log.md 已记。
- 关键文件：`electron/kimiCodeHost.ts:1625-1661`、`src/components/chat/Composer.tsx:3877-3886`。

## 2026-08-04 修复：滚动停止约 1s 后视口自动下跳（v2.20.177）

- 现场：用户反馈消息区滚动结束后约 1s 视口莫名自动往下跳一下，向上滚动后尤其明显。
- 取证（diag.log 实锤）：用户最后一次滚动（04:58:28.5）后 1.6s，`[useScrollAnchor] restoreManualScrollAnchor reason=contentVersion:user-scroll` 把 scrollTop 6073→6086（delta +13）。
- 根因（三层叠加）：① MarkdownRenderer 的 Plain→Rich settle 机制在用户停止滚动 350ms+120ms 后切回富渲染，产生约 13px 布局净增高；② 上滚后 detached 状态原生 overflow-anchor 被禁用；③ `restoreManualScrollAnchor` 把「渲染形态切换的自身漂移」误判为「新内容到达」做补偿写入（700ms 亲和期盖不住 0.5~1.6s 的 settle 漂移）。下滚到底时 auto-follow 贴底吸收不可见，上滚停在中间时补偿完全可见——所以「向上滚动后尤其明显」。
- 修复（v2.20.177）：restore 计算出 delta 后加最小阈值 `MIN_MANUAL_ANCHOR_RESTORE_PX = 32`——|delta| ≤ 32px 时不写 scrollTop，仅 scheduleAnchorCapture 把漂移后位置重捕获为新基准；真实内容插入（通常 >32px）补偿行为不变。diag 补 `suppressedByMinDelta` 字段便于生产验证。
- 验收：全量 1536 测试通过（新增「小 delta 不写 scrollTop 且重捕获、40px 仍补偿」用例）、typecheck 通过、`pnpm build` 通过；实机滚动体验待用户验收。
- 已知边界：≤32px 的真实内容位移也会被抑制（只重捕获不补偿，视觉几乎无感）；日志中另观察到一次 99px 回退来源未完全定位（同一漂移家族，保留 diag 观察）。
- 知识库：无需更新（视口补偿参数调整，未变 chat-viewport-state 既有不变量）。
- 关键文件：`src/hooks/useChatViewport/constants.ts:11-18`、`src/hooks/useChatViewport/useScrollAnchor.ts:139-159`。

## 2026-08-04 修复：轮末用法信息卡缺失（显示「已完成 · 用时」而非模型/输入/输出/Context）（v2.20.176）

- 现场：用户截图对比——一轮结束时 footer 有时显示「已完成 · 用时 22秒」，切会话再切回就变成正常的「模型: k3 输入 输出 Context」卡。
- 根因（代码证据闭环）：时序为 turn.ended/prompt.completed → renderer settle（清 runningSessionId + settleInactiveEvents + 渲染冻结）→ 最终 usage.record / agent.status.updated **迟到**；迟到帧在入口被 `shouldAppendRuntimeStatusToTimeline`（`runtimeStatusTimeline.ts:30` 要求 active/open work）丢弃；切会话走 canonical 历史（不经闸门）所以自愈。
- 关键约束：闸门本来是为了拦「快照帧」（`refreshServerSessionStatus(emitEvent=true)` 发射，resume/切会话/权限变更/compaction 回读，带 contextTokens，不变量 8/14f 要求闲置时不得重写 footer），不能简单放宽。
- 修复（v2.20.176）：refresh 路径 emit 点给事件打标 `kimixStatusRefresh: true` → 映射为 `source: "status_refresh"`（维持旧闸门语义）；未打标的实时帧携带指标数据（tokenCount/inputTokenCount/contextSize/contextLimit 任一）且会话最新事件在 2 分钟新鲜窗口（STALE_TIMELINE_WORK_MS）内时放行。sessionMetrics 无需改动（status_refresh 无 token/message 不自成卡）。
- 验收：全量 1535 测试通过（新增 4 闸门用例）、typecheck 通过、`pnpm build` 通过、`knowledge:validate` PASS；实机轮末卡片完整性待用户验收。
- 已知边界：settle 到迟到帧超过 2 分钟仍可能缺卡（切会话自愈兜底）；空事件新会话的极端场景实时帧被丢弃。
- 知识库：`runtime-routing.md` 不变量 14f 扩写（settle 竞态 + 打标语义），log.md 已记。
- 关键文件：`electron/kimiCodeHost.ts:3189`（打标）、`src/utils/kimiCodeEventMapper.ts:706`、`src/utils/runtimeStatusTimeline.ts`（闸门）。

## 2026-08-04 修复：变更卡统计不到 Bash/python 改动 + 输入区上方空白过大（v2.20.175）

- 现场 1：用户反馈 v2.20.174 轮实际改 4 个文件，变更卡只显示「文件变更 1 个 +9 -0」（TASK_STATE.md）。
- 根因 1：变更卡数据源是纯工具调用拦截（官方只对 Write/Edit 附 display.diff，Kimix fallback 只认 write/edit/multiedit 工具名），Bash 执行 python 脚本改的文件三条路径都统计不到（官方 web 同款边界）。
- 修复 1：轮次 completed 时 git numstat 兜底——新增 `project:gitNumstat` IPC（工作区+暂存区相对 HEAD 行数，untracked 按行数，失败静默返回空），App.tsx completed 分支对照本轮已记录路径去重后追加 change_summary 事件（`gitFallbackChanges.ts` 纯函数 + 8 用例）。
- 现场 2：输入框上方和 TodoList 上方有一大块空白遮挡内容。
- 根因 2：不是遮罩元素（全仓 0 处 mask/fade），是滚动区内 `CHAT_BOTTOM_SPACER_HEIGHT = 60` 的呼吸间距（v2.9.46 从 120 收敛到 60）+ footer padding（≈78px 同色空白），卡片滚到底边时被裁切读作「被空白盖住」。另有动态补偿变量 `--kimix-detached-tail-compensation`（折叠防跳动用，不能删）。
- 修复 2：常量 60→28（保留呼吸感，总间距 ≈46px），TodoPanel 上方同步变窄。
- 验收：全量 1531 测试通过（新增 8 用例）、typecheck 通过、`pnpm build` 通过；实机变更卡计数与底部间距待用户验收。
- 已知边界：git 兜底会把用户手改的未提交文件并入轮次卡；上轮未提交的变更可能在下一轮卡片重复出现（按轮次区间去重）；非 git 仓库无兜底；空白若远超 46px 则是 detached 补偿卡住，需另抓 tailCompensation 诊断。
- 知识库：无需更新。
- 关键文件：`electron/projectService.ts:470-533`、`electron/main.ts:4814`、`src/App.tsx:741-792,3104-3116`、`src/utils/gitFallbackChanges.ts`、`src/components/chat/ChatThread.tsx:254`。

## 2026-08-04 修复：模型保存成功后编辑表单不收起（v2.20.174）

- 现场：用户保存模型（编辑态）后，「编辑模型」表单仍保留内容展开，期望自动关闭。
- 根因：`handleSaveModel` 成功路径只调 `setAddingModel(false)`（收起添加态表单），编辑态表单由 `selectedModelAlias` 驱动，成功时 `setSelectedModelAlias(effectiveAlias)` 保持选中 → 表单不收起。
- 修复（v2.20.174）：成功路径改为 `setSelectedModelAlias("")` + `setAddingModel(false)`（编辑/添加两态都收起），成功提示从不可见的表单内 message 移到面板顶部共享 message；测试补「保存成功后表单自动收起」断言。
- 验收：全量 1523 测试通过、typecheck 通过、`pnpm build` 通过；实机保存后表单收起待用户验收。
- 知识库：无需更新。
- 关键文件：`src/components/settings/ModelProviderManager.tsx:420-423`。

## 2026-08-04 修复：中文供应商别名保存失败 + 模型表单报错位置过远（v2.20.173）

- 现场：用户给中文供应商「千问」添加模型，点「保存模型」无反应——实际失败但报错「模型保存失败：modelAlias: Invalid」显示在面板顶部（保存供应商旁），视线外看不到。
- 根因两个：① 别名自动生成为 `千问/qwen3.8-max`，被 electron/main.ts 的 modelAlias ASCII 正则拦截（与 v2.20.170 providerName 同族；上游官方 models 键 `z.record(z.string(), ...)` 无约束，放宽安全）；② ModelProviderManager 用单一共享 message state 渲染在面板顶部，模型表单操作反馈离触发按钮太远。
- 修复（v2.20.173）：① 2 处 modelAlias 正则放宽为 `/^[\p{L}\p{N}_./:-]+$/u`（保留 `/`，附中文消息）；② 模型表单反馈拆出独立 `modelFormMessage` state，渲染在添加模型卡片内「保存模型」按钮正下方（含进行中/失败/前置校验全部 5 处），供应商级操作仍走顶部 message；切换供应商/打开表单等时机清空。
- 验收：全量 1523 测试通过（新增「错误显示在表单卡片内而非顶部」用例）、typecheck 通过、`pnpm build` 通过；实机保存中文别名模型待用户验收。
- 知识库：无需更新。
- 关键文件：`electron/main.ts:1476,1499`、`src/components/settings/ModelProviderManager.tsx:153,189-218,394-424,964-966`。

## 2026-08-04 修复：重启后 in-flight 轮次失去订阅、尾部事件丢失（v2.20.172）

- 现场：用户双端对比截图——web 端显示完整尾部（grep/编辑 TASK_STATE/git 提交 3 个工具调用 + 最终答复），Kimix 侧只剩 1 个工具调用，最终答复是旧内容。用户反馈「还是会有这种不同步」。
- 取证链（diag.log + IndexedDB 导出 + persist 计数）：
  1. 本地时间线在启动对账前**恰好缺 8 个事件**（02:11:12 `kimiHistoryReconciliation.accepted` reason=startup，persist 21669→21677 = 缺失的 status×3 + Edit + change_summary + diff + Bash + 最终答复 assistant）。
  2. 02:08:42 renderer boot（electron-vite 因主进程代码改动重启了整个应用）后 **diag.log 再无任何 [wsframe]/[poll] 帧日志**——WS 订阅随主进程死亡，agent 在外部 server 继续跑了 2 分钟（web 全程可见），新主进程无人重新订阅。
  3. 渲染层 `runningSessionId` 是内存态（重启后 null）→ 1.5s reconcile 轮询短路；启动链路直接 `getKimiCodeStatus`，而主进程 getStatus 对未注册会话必抛错 → 一律按 idle → 无任何机制发现 server 上会话还在忙。
- 修复（v2.20.172）：启动主链路（App.tsx:2258）与房间恢复路径（:483）在 getStatus 前补幂等 `resumeKimiCodeSession`（镜像 Sidebar.tsx:717-722 已验证模式；resume = 绑定 WS 订阅 + 回读状态，不是复活），后续 getStatus 用 resume 返回的权威 sessionId；runningSessionId 仍只由官方 status 的 active 判定置位，terminal/unknown 维持 settleInactiveEvents（与不变量 7 兼容——复活门是 status 裁决本身）。
- 验收：全量 1522 测试通过、typecheck 通过、`pnpm build` 通过、`knowledge:validate` PASS；实机「重启后续传」待用户验收。
- 已知边界：主进程每次启动多一次 resume IPC（失败静默）；生产环境 quit/reopen 中途轮次同样受益；不变量 7 已扩写「resume 是绑定不是复活」。
- 知识库：`runtime-routing.md` 不变量 7 扩写，log.md 已记。
- 关键文件：`src/App.tsx:2258-2262`（主启动链路）、`src/App.tsx:483-486`（房间恢复路径）。

## 2026-08-04 功能：添加模型时 Context 与思考档位自动预填（v2.20.171）

- 现场：用户添加第三方供应商模型（阿里百炼 qwen3.8-max），问思考档位和上下文大小能否自动探测、不能的话怎么快捷设置。
- 调查结论（三路）：① 思考档位**确凿不可探测**——标准 OpenAI /models 只有 id/owned_by，连最全的 OpenRouter 也只有布尔 reasoning，无 effort 枚举接口；② Context 部分可探测（仅 OpenRouter/Moonshot 等少数端点带扩展字段），百炼/DeepSeek/OpenAI 官方不可探测；③ 但官方 models.dev 目录（设置页「官方 Provider 目录」本来就在拉）每个模型都有 `limit.context` 和 `reasoning_options`，上游 kimi-code CLI 正是用它实现免手填——**卡点在 Kimix 两层丢数据**：kimiCodeHost 丢弃 SDK 已算好的 supportEfforts，渲染层表单完全没用目录模型条目；④ 推断表缺 qwen3.8-max（错误兜底 131k，实际 1M）。
- 修复（v2.20.171）：
  1. electron：`KimiProviderCatalogModelSummary` 透传 `supportEfforts`（models.dev 值映射到 Kimix 词表：none→off、xhigh→max、minimal 保留、未认识别丢弃不编造）。
  2. 渲染层：`matchCatalogModel`（大小写不敏感精确匹配，不模糊猜）+ `prefillFromCatalog`（Context 优先级：探测 contextLength > 目录 > 名称推断 > 保留现值；档位仅在未勾选时填；defaultEffort 不预填——SDK 自动取中间档）；探测下拉选中和手输模型 ID 两条管线都接入；目录未载入时惰性静默拉取，失败降级为原行为。
  3. 推断表补 qwen3.8-max → 1,000,000。
- 覆盖纪律：手输模式「为空才填」；探测选中视为新意图可覆盖 Context（沿用原探测值覆盖语义），档位永不覆盖手改。
- 验收：全量 1522 测试通过（新增 13 用例：qwen3.8-max、目录匹配/预填优先级/覆盖纪律、目录命中预填端到端）、typecheck 通过、`pnpm build` 通过；实机添加模型预填效果待用户验收。
- 已知边界：qwen 系模型在目录里只有 toggle+budget_tokens（无 effort 档位列表），档位预填对它们不会生效（符合语义——百炼是 enable_thinking+budget 不是 reasoning_effort）；目录异步载入完成前的选择会降级为无目录值（下次触发点生效）。
- 知识库：无需更新（局部功能增强，未变架构不变量）。
- 关键文件：`electron/kimiCodeHost.ts:2613-2652`、`electron/types/ipc.ts:495`、`src/utils/modelProviderConfig.ts:67-137`、`src/components/settings/ModelProviderManager.tsx`、`src/utils/modelContextInference.ts:130`。

## 2026-08-04 修复：中文供应商名称无法保存（v2.20.170）

- 现场：用户添加第三方供应商「千问」保存失败，报错是不可读的 zod JSON：`[{"validation":"regex","code":"invalid_string",...,"path":["providerName"]}]`。
- 根因：`electron/main.ts` 4 个 provider schema 自加的 `providerName` 正则 `/^[A-Za-z0-9_.:-]+$/` 排除中文。上游官方 schema（agent-core `z.record(z.string(), ...)`）对 provider key 无格式约束，TOML 写入侧 `toTomlTableKey` 对非 ASCII 键自动加引号，放宽是安全的。
- 修复（v2.20.170，仅 electron/main.ts）：4 处正则放宽为 `/^[\p{L}\p{N}_.:-]+$/u`（允许中文等 Unicode 字母数字，仍排除空格）并补中文错误消息；新增 `formatProviderConfigError`（zod issues JSON → 「字段: 消息」可读格式），4 个 provider IPC handler（saveOpenAiProvider/saveProvider/saveProviderModel/discoverProviderModels）的 catch 接入。
- 验收：全量 1512 测试通过、typecheck 通过、`pnpm build` 通过；实机保存中文供应商待用户验收。electron 侧无测试基建（vitest 只含 src/），未加单测。
- 已知边界：modelAlias 仍限 ASCII slug（`千问/qwen3-max` 中别名部分需英文）；官方 web/CLI 对中文 provider key 的实际兼容性未经实机全链路验证（写入 config.toml 是合法 TOML 引号键）。
- 知识库：无需更新。
- 关键文件：`electron/main.ts:1475,1492,1498,1508`（正则）、`1516-1523`（formatProviderConfigError）。

## 2026-08-04 修复：系统性穷举并补齐所有悬停风格化遗落（v2.20.169）

- 现场：用户连续反馈「还是不全」——Retro 下画板比例按钮、Swarm 关闭、Git 图谱刷新、套餐用量刷新等仍是平面灰块，要求穷举所有有悬停变化的元素。
- 根因（三路穷举审计）：① retro/nostalgia 的 `:where` 悬停环只给 box-shadow 不给 border/background，hover 底色仍是基类平涂 `--surface-hover`；② 悬停环成员不全（settings-icon-button、settings-check-button、chat-process-row 等未纳入，nostalgia 环比 retro 少更多）；③ `.kimix-inspector-action` 只在 inspector 作用域有规则，modal 内（Git 图谱刷新）完全失效；④ 一批组件仍是裸 Tailwind hover 未挂角色类（KimiWeb 折叠行、ChangeCard 按钮、DrawingBoard 控件、Hooks/Diff/Mcp/Sidebar/ModelProviderManager 等）；⑤ nostalgia 的 nav-list/selection hover shadow 是 none。
- 修复（v2.20.169，四路并行 + 主代理收尾）：
  1. CSS（index.css）：两个 allowlist 补全三件套（border-color+background+color+ring/raised）并扩 9 个成员；补 `.kimix-modal-card .kimix-inspector-action` 作用域；7 类带边框选择卡补无 ring 的边框 hover；menu-item danger 项补两风格 hover；实底 success/error/primary 按钮 hover 保浮雕（提特异性压过基类 shadow-hover）；nostalgia token `--ui-nav-list/selection-hover-shadow` none→raised；skill-card hover 保浮雕。
  2. 组件（12 个 tsx）：MessageBubble 7 处折叠行、ChatThread 压缩行、QuestionCard 折叠行+选项 → kimix-chat-collapse-row/room-choice；ChangeCard 6 钮、SessionRecommendationCard 2 钮、EmptyState 建议行、DrawingBoard 2 组控件、HooksPanel 3 处、DiffPanel 文件行、McpPanel OAuth 开关、Sidebar 展开行、ModelProviderManager 3 处全部挂角色类。
  3. 主代理收尾补丁：`.kimix-chat-collapse-row` 基类补 hover 底（挂类后 default 无 hover 的回归）、`.kimix-menu-item` transition 补 box-shadow（retro 环 150ms 过渡而非 snap，符合不变量 45）。
- 验收：全量 1512 测试通过（uiStyles 回归门禁断言同步更新）、typecheck 通过、`pnpm build` 通过、`knowledge:validate` PASS；实机两风格悬停效果待用户截图验收。
- 已知边界：Composer 排队拖拽行（4378）与 TodoPanel 标题行（105）经判断不适合挂角色类保持现状（有报告理由）；nostalgia  hover 新增 1px border 有约 0.5px 位移（Win98 语言既有模式）；nostalgia 选中侧栏行 hover 从平面变凸起（token 修正的预期变化）。
- 知识库：log.md 已记（allowlist 补全与组件角色化），契约不变量无需新增。
- 关键文件：`src/index.css`（两个 allowlist + modal 作用域 + 边框卡 hover + token）、12 个组件 tsx、`src/utils/__tests__/uiStyles.test.ts`。

## 2026-08-04 修复：Retro/Nostalgia 下菜单项悬停与实底主按钮无风格质感（v2.20.168）

- 现场：用户截图（Retro 风格）——顶部「编辑」下拉菜单项悬停是平涂灰底、工作目录浮层「选择目录」深色按钮、套餐用量「刷新」按钮，悬停效果与当前风格不一致。
- 根因：上一轮（v2.20.167）把元素都挂上了角色类，但 CSS 契约层本身没给这些角色定义 preset 悬停质感——`.kimix-menu-item:hover` 在所有预设下都是平涂 `--surface-hover`；`button.bg-accent-primary` 实底主按钮无任何 preset 浮雕；Nostalgia 的 icon-text/muted 按钮 hover 只有 radius 归零没有凸起。问题不在组件层而在预设规则缺失。
- 修复（v2.20.168，只改 index.css + 文档）：
  1. Retro `.kimix-menu-item:hover` → 共享悬停背景 + 描边内阴影（与按钮 hover 同一语言）；选中/危险/disabled 项排除，保留各自语义。
  2. Nostalgia `.kimix-menu-item:hover` → 凸起浮雕；选中项保持下沉。
  3. Nostalgia icon-text/muted 等按钮 hover 补 `raised-shadow`（此前只有 radius 0）。
  4. Retro/Nostalgia `button.bg-accent-primary` 实底主按钮补形状级浮雕（retro 顶高光+投影 / nostalgia 凸起静止+下沉按压），accent 填充仍归色彩主题所有（未违反 token 所有权）。
- 验收：全量 1512 测试通过、typecheck 通过、`pnpm build` 通过（Tailwind v4 校验 CSS 语法）、`knowledge:validate` PASS；实机两风格悬停效果待用户截图验收。
- 知识库：`interface-style-system.md` 新增一条不变量（菜单项悬停语言 + 实底主按钮 preset 浮雕例外），log.md 已记。
- 关键文件：`src/index.css`（retro 菜单项 hover、nostalgia 菜单项 hover、nostalgia 按钮 hover、两风格 bg-accent-primary 规则）。

## 2026-08-04 优化：二级菜单/浮层风格化覆盖补齐（v2.20.167）

- 现场：用户截图反馈多个二级菜单/浮层（权限菜单 tooltip、套餐用量浮层、思考强度菜单、会话「…」菜单、顶部「文件」下拉、工作目录浮层）未跟随界面风格体系，要求全面排查所有二级菜单位置。
- 方式：四路并行审计（对照 `knowledge/architecture/interface-style-system.md` 契约与 index.css 角色类）→ 六路并行修复（严格按文件归属分区）。审计确认：浮层外壳大多已 enroll，缺口集中在**浮层内部元素**。
- 修复内容（19 个文件，+120/−95）：
  1. 菜单项/选择项角色化：模型选择行、@/slash 补全条目、「+」附件菜单行、搜索结果行 → `kimix-menu-item`（选中态走 aria-checked/aria-selected）；停止/引导目标行 → `kimix-room-choice`；DiffPanel 排序项删硬编码选中色。
  2. 选中/开关态通道统一：Swarm 切换、SearchOverlay scope 按钮 → `kimix-state-button` + aria-pressed；room 系列选中态改 data-selected/aria-pressed 通道（删 class 三元拼装）。
  3. 字段控件统一：模型搜索框、重命名输入框、HooksPanel/McpPanel/LongTasksPanel 全部手写字段 → `kimix-settings-input`。
  4. 对话框角色修正：重命名对话框、添加/编辑房间 Agent 对话框 `kimix-floating-panel` → `kimix-modal-card`；遮罩 `bg-black/30` → `--kimix-modal-overlay-bg`。
  5. inset 分区与分隔线：目录分区卡、说明/错误块 → `kimix-inset-section`（额外目录行去边框，修「浮层内框套框」违规）；菜单分隔线统一 `kimix-menu-separator`。
  6. CSS 契约补强（index.css）：`.kimix-menu-item` 新增 `:disabled`/`[aria-disabled]` 规则（此前 disabled 菜单项不变灰）；`.kimix-room-choice` 基类补默认 hover 底与 radius（修角色化后默认风格失去可点外观的回归）。
  7. 杂项：`#2ddd19` 硬编码绿 → accent-success token；`bg-green-50/amber-50` Tailwind 色板 → accent token；`hover:bg-white/70` → surface-hover；外壳冗余 rounded/inline borderRadius 清理。
- 验收：全量 1512 测试通过（ComposerToolbarPopover 测试断言随契约更新：radius 由角色类独占）、typecheck 通过、`pnpm build` 通过；四风格实机效果待用户截图验收。
- 已知边界：子代理首次引入 Tailwind v4 `data-[selected=true]:`/`aria-pressed:` variant 作默认/Modern 选中态兜底（Retro/Nostalgia 由层外角色类压制接管），若截图发现默认风格选中态未生效需清缓存重验；「选择目录」实底主按钮保持不动（契约允许的主操作例外）；原生 select 弹出列表与系统 tooltip 是平台限制无法风格化。
- 知识库：无需更新（契约文档已覆盖所有用到的角色类，未新增角色语义）。
- 关键文件：`src/index.css`（disabled 规则 + room-choice 基类）、Composer/ContextBar/SessionToolbar/SearchOverlay 等 17 个组件文件。

## 2026-08-04 修复：通知点击跳转聚焦消息中部而非顶部（v2.20.166）

- 现场：点击 Kimix Windows 通知跳转到对应消息时视口落在消息中部，用户要求与左侧刻度条点击一致（顶部）。
- 根因：通知链路 `App.tsx` 派发 `kimix:focus-timeline-event` 不带 alignment → `useEventFocus.focusTimelineEvent` 默认 `"center"`；刻度条路径显式传 `"start"`（顶部 + 16px 偏移）。两条路径共享同一滚动实现，只差参数。
- 修复（v2.20.166）：通知 detail 增加 `alignment: "start"`，`useEventFocus` 的 detail 类型、pending 暂存与重放路径全链路透传；SearchOverlay 搜索跳转不传、保持 center 不变。
- 验收：全量 1512 测试通过（新增对齐透传用例 1 个）、typecheck 通过、`pnpm build` 通过；实机点击通知效果待用户验收。
- 知识库：无需更新。

## 2026-08-03 优化：权限模式 Kimix↔官方 Web 双端同步（v2.20.165）

- 现场：用户截图——Kimix 权限「完全自主(auto)」、web 侧「自动通过(yolo)」，Kimix 调整后 web 不同步，怀疑「没走同一条链路」。
- 调查结论（四路子代理）：写入链路其实已是同一条（Composer → `updateSession(permission_mode)` → POST /profile），真正断点三个：① SettingsPanel 全局权限切换只写本地 appStore，从不推 server；② 回读方向断裂——主进程 `refreshServerSessionStatus` 已把官方 status.permission 经 `agent.status.updated` emit，但渲染层只消费 swarmMode，忽略 permission（web 改权限后 Kimix UI 和 yolo 自动审批 guard 都不跟随）；③ 写后无回读校验，`kimiCodeHost.ts:1627` 的 early-return 可能基于过期缓存吞掉切换。
- 修复（v2.20.165）：① App.tsx 新增 `syncSessionPermissionMode`（镜像 `syncSessionSwarmMode`，只写 session/room-agent 级，不动全局默认偏好），`agent.status.updated` 分支并列消费；② SettingsPanel 切换改为「全局默认本地写 + 有 runtime 推 server」（复用 `setKimiCodePermissionWithRecovery` 与 Composer 的恢复/失败 toast 模式）；③ `setPermission` server 路径写成功后 `refreshServerSessionStatus(sessionId, true)` 写后回读（校准缓存 + emit 权威值给渲染层）。
- 验收：全量 1511 测试通过（新增 extractPermissionModeStatus 3 用例）、typecheck 通过、`pnpm build` 通过、`knowledge:validate` PASS；实机双端切换效果待用户验收。
- 已知边界：SettingsPanel 路径在活跃轮次中不走 Composer 的 turn.ended 延迟门（官方 profile 端点本身支持随时修改，上游 web 也无门控，但比 Kimix 既有不变量 8 的门控宽松）；SDK 路径未加写后回读；回读只更新 UI 不反向写 server，无循环。
- 知识库：`runtime-routing.md` 不变量 8 扩写双向同步语义，log.md 已记。
- 关键文件：`src/App.tsx`（syncSessionPermissionMode）、`src/utils/kimiCodePermission.ts`（extractPermissionModeStatus）、`src/components/settings/SettingsPanel.tsx`、`electron/kimiCodeHost.ts:1630-1635`。

## 2026-08-03 修复：停止/失败后排队消息不再自动派发（v2.20.164）

- 现场：用户截图——上一轮「输出完成 本轮总耗时 45分2秒」，队列里 1 条消息卡住不发，底部「有错误」，停止后也无法发出（v2.20.159）。
- 根因（四路调查 + 主代理复核代码确认）：排队消息自动派发全仓只有 3 个事件驱动触发点（completed 状态、长程任务分支、reconcile 轮询），其中 `App.tsx` 的 error/interrupted 分支 settle 后直接 return 不派发；停止路径又先清 runningSessionId → reconcile 轮询停摆 → 队列永久无触发点。后台 bash/子代理/swarm 都经「轮次被停止 → interrupted」汇入这同一链路，非独立 bug。
- 修复（v2.20.164）：error/interrupted 分支 settle 后镜像 completed 守卫（primary-room）补一次 `dispatchNextPendingKimiMessage`；两个 defer 分支（pendingQuestion / officialQueue）补 `app.pendingDispatchDeferred` 诊断日志。
- 链路闭合依据：server 路径 cancel 后必发 running|interrupted 状态帧（`kimiCodeHost.ts:1584`）；SDK 路径 cancel 经 `turn.ended(cancelled)` → StatusSequencer → interrupted（`kimiCodeStatusSequencer.ts:50-57`）。官方队列未排空时 defer 会重置 running → reconcile 继续轮询 → 排空后派发，自洽。
- 验收：全量 1508 测试通过、typecheck 通过、`pnpm build` 通过；实机「停止后队列自动发出」待用户验收。
- 已知边界：派发失败重排队首后仍无自动重试（等下一次触发点，有意为之防死循环）；App.tsx 状态回调无纯函数测试接缝，未单测。
- 知识库：无需更新（局部触发点补齐，未变架构不变量）。
- 关键文件：`src/App.tsx:2998-3003`（派发补点）、`src/App.tsx:1888,1893`（defer 日志）。

## 2026-08-03 修复：跨客户端同步多轮合并、用户消息只剩最早一条（v2.20.163）

- 现场：kimi code web 和 Kimix 同时运行同一会话时，Kimix 把多轮内容混成一轮渲染，用户消息只显示最早的一条（用户截图，安装版 v2.20.159）。
- 取证：快照存 `docs/issue-cross-client-turn-merge-events-snapshot.md`——① 实时帧入口 `mapKimiCodeEvent`（`kimiCodeEventMapper.ts`）无 `TurnBegin` case，web 轮次 user 消息的唯一实时载体被 default→null 静默丢弃；② CDP 导出当前会话 IndexedDB：本地发送的 2 条 user_message 都在（乐观回显），丢失只发生在同步映射层；③ `ChatThread.tsx:1310-1334` 只以 user_message 为硬 turn 边界，边界缺失 → 多轮合并。
- 修复（v2.20.163）：
  1. `mapKimiCodeEvent` 新增 `TurnBegin → user_message` 映射，对齐历史路径（envelope→status_update、skill 激活→status_update/格式化命令），stable snapshotMessageId 时 id 取 `user:${snapshotMessageId}`；in-flight `turn.started` 帧确认无 user 载荷，保持过滤并注释。
  2. 全量测试抓到一个真实回归：同客户端乐观回显（无身份）与屏障回放 TurnBegin（稳定身份、>10s 后到达）重复出泡切轮。修复：`mergeEvents` 对带稳定身份的 user_message 先按 snapshotMessageId 硬去重，否则把身份「盖章」到最早的内容等价无身份回显上而非追加；已带稳定身份的最后一条 user 不再吃 10 秒窗口（保护同内容连发）。
- 验收：全量 1508 测试通过、typecheck 通过、`pnpm build` 通过、`pnpm knowledge:validate` PASS；实机双端显示效果待用户截图验收。
- 已知边界：内容启发式配对——同会话两端同时发完全相同内容时，身份可能盖到本端回显上（内容相同，边界效果一致）；「继续」类同内容消息若前一条从未被盖章，后一条跨端回放可能配对错（极端边缘）。
- 知识库：`runtime-routing.md` 新增不变量 19c，log.md 已记。
- 关键文件：`src/utils/kimiCodeEventMapper.ts`、`src/utils/eventMapper.ts`（mergeEvents 盖章去重）、`src/types/ui.ts`（UserMessageEvent 身份字段）。

## 2026-08-03 修复：状态胶囊不区分「消息处理中」与「后台 Bash 运行中」（v2.20.162）

- 现场：用户截图反馈，对话区消息底部胶囊在后台 Bash 任务还在跑时也显示「消息处理中」，无法区分两种状态。
- 根因：胶囊文案 `assistantFooterFallbackLabel`（`MessageBubble.tsx`）只看 turn 是否 active，没有后台任务信号；后台任务轮询（AppShell `refreshLongTaskBackgroundTasks`）此前只在右侧长程面板打开时运行且结果存组件局部 state，对话层拿不到。
- 修复（v2.20.162）：
  1. `backgroundTasks.ts` 提升 export `isBackgroundTaskTerminalStatus` + 新增 `hasRunningBackgroundBashTask`（只计 bash 组非终态任务，子 Agent 组不计）。
  2. appStore 新增 `sessionHasRunningBackgroundBash` 字段；AppShell 轮询门槛放宽为「有 runtimeSessionId 即轮询」（不再要求面板打开，2s/5s 节奏不变），成功/清空分支比较后同步 store。
  3. `assistantFooterFallbackLabel` 加第三参：`hasRunningBackgroundBash && (event.isComplete || !isActiveAssistant)` → 「后台 Bash 运行中」（优先级低于「输出打断」）；模型仍在输出（active 且未提交正文）时仍显示「消息处理中」。
- 验收：全量 1497 测试通过、typecheck 通过、`pnpm build` 通过；实机显示效果待用户截图验收。
- 已知边界：胶囊文案受轮询节奏影响最多延迟约 2s；面板关闭时新增每 5s 一次的会话级 IPC 轮询开销（本地 localhost，开销可忽略，如在意可降为 10s）。
- 关键文件：`src/components/chat/MessageBubble.tsx`、`src/components/layout/AppShell.tsx`、`src/utils/backgroundTasks.ts`、`src/stores/appStore.ts`、`src/types/ui.ts`。

## 2026-08-03 现场取证：Swarm 子代理回复「已完成」但内容缺失（v2.20.161 修 isThinking 误标）

- 现场：用户 19:59 发「现在你自己review一下你这两轮做的改动」，UI 显示「已完成」，但回复只有英文思考 + 11 个工具调用 + 57 字符开场白，没有 review 结论正文。
- 取证链（CDP 读 IndexedDB + diag.log + DOM）：
  1. 主进程帧完整：delta 帧 1069 个 offset 零缺口（Python 逐帧校验），终止帧（turn.ended + prompt.completed completed/main）12:00:38 全部到达；帧队列 0 次溢出。
  2. events（IndexedDB）里 19:59 消息（i=1410, turn=agent-turn）的回复只有：i=1412 正文 57 字符（「你好霖江路，我来全面 review 这两轮的所有改动…」）+ i=1414-1435 十一个 Bash 工具调用。**最终 review 结论正文不在 events**（全库搜「Let me review each change for correctness」0 命中）。
  3. [live] display：子代理 turn（sid=jfdmfies, key=ant:agent-turn:sjfdmfies）19:59:06 init→thinking，20:00:39 thinking→settled_complete，**textChars 全程只有 57**（英文 ~1000 字符是 thinking 不计入正文）。
  4. 子代理 settled_complete（20:00:39）在主 agent turn.ended + prompt.completed（20:00:38, completed/main）**之后 1 秒**——子代理正文疑似被主 agent 完成信号提前终止或服务端未输出（待验证：对比 web 端同会话，或复现时抓子代理 turn 帧级日志）。
  5. 渲染层块 11 的英文内容显示为灰色 thinking 样式（rgb(107,118,128) 13.5px muted）——用户看到的「英文 review」是思考不是正文。
  6. 主 agent 完整 review（4909 字符，i=1384）在 19:44 turn 内生成并渲染为块 9（正文样式完整显示），但**被 draft 提交缺陷标 isThinking=true**（draft 同时累积 thinking.delta + assistant.delta，toAssistantShell 只要 draft.thinking 非空就标 thinking）。
  7. 子代理英文 thinking（~1000 字符）渲染过但**未落盘**（draft 在 turn 结束时被清理）——刷新后消失。
  8. 12:02:10 watchdog 92s 静默重连 + 快照恢复（as_of_seq=2871, inFlight=0），之后会话静止无新帧。
- v2.20.161 已修（P1）：`activeTurnDraftStore.ts` toAssistantShell 的 isThinking 判定——**draft 有 content（正文）时不再标 thinking**（正文与思考混合以正文为准）。
- 未修（P0，需进一步证据）：
  a. **子代理 turn final answer 缺失**——是「主 agent 完成信号提前终止子代理」还是「服务端未输出」需验证。验证方法：web 端同会话对比正文是否完整；或复现时开 KIMIX_FRAME_DIAG=1 抓子代理 turn（agent-turn scope）的 delta/turn.ended 帧。
  b. **子代理 thinking 未落盘**——settled 后 draft 清理导致思考丢失，刷新后消失（视觉抖动/内容减少的另一个来源）。
  c. i=1382（3223 字符交接摘要）落盘但 UI 无对应渲染块（在折叠区或合并进块 9 未确认）。
- 关键文件：`src/utils/activeTurnDraftStore.ts`（isThinking 判定）、`src/hooks/useEventStream.ts`（draft 提交/清理）、`src/utils/turnBlocks.ts`（分组不看 isThinking）、`electron/kimiCodeHost.ts:3072-3087`（prompt.completed 屏障）。
- 类型：功能缺陷，Swarm 子代理长回复的正确性问题。

## 2026-08-03 待修：Swarm 子代理消息截断 + 状态卡在「执行中」（v2.20.160 已修帧队列保护，卡死链路待快照验证）

- 现场：swarm 子代理回复消息内容不完整（对比 web 端少了一大段），且 UI 永久卡在「执行中 37 秒」「消息处理中」，engineStatus 一直是 running。重启 dev 后仍复现（v2.20.159）。
- 根因复核（v2.20.160 修正交接时的错误结论）：
  1. 帧队列溢出（`kimiCodeServerClient.ts` deliver）：**不丢 host 事件流帧**——`for (const listener of this.listeners) listener(frame)` 在 waiter 匹配/queued 之前每帧必达（1915/2006 行）；queued 只服务 `waitFor`/`waitForSessionEvent` 事后回放（先查 queued 再注册 waiter）。溢出删最老的真实影响：`waitForSessionEvent`（1399 行，等 `prompt.completed`/`prompt.aborted` 完成确认）匹配不到完成帧 → 挂 180s 空闲超时 → `resolveServerPromptIdleTimeout` 查权威状态，**状态仍 busy 时 `continue` 无限续等** → UI 表现永久「执行中」。正文截断另有来源（渲染合并/快照重放/子代理独立会话），待事件流快照验证。
  2. 终止帧只 log 不清 running（`App.tsx:2677-2688`）：属实，但这是**有意设计**——`kimiCodeHost.ts:3072-3087` 注释明确「prompt.completed 是交付屏障不是终态，立即 terminalize 会清 runningSessionId、停 poll、UI 把中间正文当最终正文（伪正文+折叠+卡住）」。**交接方案 a（渲染层终止帧无条件 setRunningSessionId(null)）与既有架构冲突，有伪正文回归风险，未实施**。正确语义：终止帧只提示「该 prompt 输出已交付」，会话是否终态由 server /status.busy 权威判定 + 轮询 settle。
  3. watchdog 90s（`WS_SILENCE_LIMIT_MS=90_000`）：属实；swarm 高帧率下 WS 不沉默，watchdog 无法感知丢帧。
- v2.20.160 已实施：帧队列溢出**保护终止帧**（`isTerminationFrame`：prompt.completed/prompt.aborted/turn.ended 不参与删最老，优先删普通帧；全终止帧极端场景才兜底截断）。消除「完成帧被挤掉 → 180s 超时 → busy 无限续等」链路的队列侧成因。
- 未实施（需先抓事件流快照再定）：
  a2. 渲染层安全超时兜底：running 持续超阈值（如 5 分钟）且无新流式帧时清 running + 标 interrupted——注意长思考轮次实测 616s 无帧（client 1394 行注释），纯时间兜底会误伤，条件需含「无帧且权威状态非 busy」。
  c. recoverSnapshot 补全 delta 帧（需服务端配合）。
  d. 卡死复现取证：开主进程调试日志（sdiag）+ 复现 swarm 长回复，抓事件流快照（终止帧是否到达、delta 是否缺、engineStatus 变化序列），区分 SDK/server 行为与 Kimix 逻辑后再修渲染层。
- 关键文件：`electron/kimiCodeServerClient.ts`（帧队列/wdog/完成确认）、`electron/kimiCodeHost.ts:3072-3114`（prompt.completed 屏障语义）、`src/App.tsx:2677-2688, 3453-3571`（终止帧处理/轮询 reconcile）
- 类型：功能缺陷，swarm 模式下的性能与正确性问题。
## 2026-08-03 修复：Windows 通知点击不聚焦窗口（v2.20.159）

- 现场：点击 Kimix Windows 通知不跳转聚焦到窗口。
- 根因两个：(1) Notification 对象在 showTurnCompleteNotification 返回后无模块级引用，可能被 GC 回收导致 click 事件丢失；(2) activateWindow 的 setAlwaysOnTop 脉冲 200ms 在 Windows 后台进程抢焦点场景下太短。
- 修复：(1) keptNotifications Set 持有 Notification 引用（click/close 后移除）；(2) WINDOWS_TOPMOST_PULSE_MS 从 200→500ms；(3) click 回调增加 app.focus() 作为 Windows 聚焦补充。
- 验证：typecheck 过；全量 1489 测试过。提交 85d841f4。
- 实机待验：发通知（等一轮完成或触发后台任务完成通知），点击通知确认窗口聚焦。


## 2026-08-03 修复：跨客户端实时同步（web 发消息/已答澄清不同步）（v2.20.157-158）

- 现场：kimix 与 kimi code web 都开着，web 发消息 Kimix 不显示新消息与回复；web 已答的澄清卡片在 Kimix 显示未回答。
- 根因（同源）：Kimix 打开会话（selectSession）只 load 历史 + getStatus，从不 resume 绑定主进程 serverSessions。dev 重启/冷启动后 store 恢复的会话不在主进程 map，不订阅 WS → web 发消息收不到实时帧；web 答 question 的解决状态也收不到（server 不广播 resolved 帧，仅 /questions?status=pending 可查）。
- v2.20.157：selectSession 开头先 resumeKimiCodeSession（幂等）确保订阅，再 getStatus + load。
- v2.20.158：新增 settleHistoricalQuestions——历史重放（App 启动恢复 + Sidebar selectSession）时按 engineStatus 是否为 waiting_question 对齐：非 waiting 时 pending 澄清视为已答。未动 settleInactiveEvents（避免误伤实时状态路径）。
- 验证：typecheck 过；全量 1489 测试过（新增 3 个）。提交 adde6aee / 6586c16e。
- 实机待验：v2.20.158 下 web 发消息 Kimix 实时出现；已答澄清不再显示未回答。


## 2026-08-03 修复：侧栏打开会话同步 Swarm 开关状态（v2.20.156）

- 现场：web 端（官方 Server）Swarm 一直开，Kimix 启动后点击侧栏进入对应会话显示「关」。
- 排查：CDP 实测——Server 权威 `status.swarm_mode=true`；Kimix 主进程 `getKimiCodeStatus` 返回 `swarmMode:true`（数据正确）；问题在渲染层。
- 根因：Sidebar `selectSession`（点击会话入口）只同步 model（hydrateSessionModel），不同步 swarmMode → store 保持 undefined → `displayedSwarmMode` 显示「关」。startup 自动恢复路径（App.tsx:2290）有同步，手动点击路径缺失。
- 修复：新增 `hydrateSessionSwarmMode` 辅助，`selectSession` 三处 updateSession（缓存命中/加载失败/主加载）统一从 `runtimeStatus.data.swarmMode` 同步（直接访问字段，未依赖 App.tsx 私有 extractSwarmModeStatus）。
- 验证：typecheck 过；store 测试 12 个过；dev 重启正常。提交 677b13e3。
- 已知边界：若 web 端在 Kimix 运行期间（会话 idle 打开中）改 swarm，仍需触发一次状态刷新（切会话/发消息）才同步；无 idle 轮询。实机待验：点击侧栏进入 web 已开 swarm 的会话应显示「开」。


## 2026-08-03 修复：迁移矩阵剩余毛边收敛（v2.20.154）

- 迁移显式化：`migrateServerSessionToSdk` 迁移成功后发 `emitStatus(sessionId, "idle")`，渲染层据此刷新 runtime 绑定。
- reload 语义定案：`/reload` 迁移传 `pinToSdk: true`——reload 目的是让 SDK 重载 Skill/Plugin 注册表，钉住避免 Server 恢复后被弹回导致效果丢失与链路横跳（与 Swarm pin 一致）。
- 僵尸会话自愈：`markServerRuntimeFailure` 后新增 `migrateIdleServerSessionsToSdk`，把已打开的非运行中 Server 会话 best-effort 批量迁到 SDK；运行中/等待中保留（走 createSdkFallbackSession）。
- 至此 docs/server-sdk-migration-matrix.md 第三节 6 条收敛建议全部落地（2/3/6 在 v2.20.153，1/4/5 在本版）。
- 验证：typecheck 过；全量 1486 测试过；pnpm build 过；knowledge:validate PASS。
- 知识库：runtime-routing 不变量 99 + log 更新。
- 实机待验：v2.20.154 下 reload 后会话不再弹回 Server；Server 降级时已打开会话可继续用（自愈迁移）。


## 2026-08-03 功能：套餐用量/Goal读取/历史列表/会话导出接入官方 Server 链路（v2.20.153）

- 背景：五路并行审查（docs/feature-web-linkage-audit.md）找出全部未走官方 Web 一致链路的功能点，经在线实测确认 4 项可迁移。
- B1 套餐用量：`getManagedUsage` server 就绪时先走 `GET /oauth/usage`（新 `getOAuthUsage`），新增 `parseServerUsagePayload`（官方结构无 label，`summary.window`+`limits[].window`）；SDK/官方 HTTP 直连兜底保留。
- B2 Goal 读取：`getGoal` server 会话接入 `GET /sessions/{id}/goal`（读侧 200，POST 为 unsupported action）；`SERVER_GOAL_UNSUPPORTED_MESSAGE` 文案修正为「仅支持读取」。
- B3 历史列表：`kimi-code:listHistorySessions` server 就绪时改走双链 `listSessions`（server 权威），title 映射 brief（serverSessionSummary 无 brief 字段）；磁盘扫描兜底保留。
- B7 会话导出：`exportSession` server 就绪时走 `POST /sessions/{id}/export`（实测 1.3MB application/zip 流），SDK/CLI 兜底保留。
- 毛边：`resolveMigratedSessionId` 补齐 16 个遗漏函数（askBtw/undo/compact/planMode/thinking/permission/status/usage/MCP/后台任务/skills）；`closeSession` 双向清理 `serverSessionMigrations`；`getMcpStartupMetrics`/`listChildSessions` 文案改能力提示。
- 实测否决 B6：`/transcript*` 仅是文本帧回放 ops（append text），无 `full_compaction.*`/`usage.record`/`turn.steer` 语义；compact/steer 确认保留 wire.jsonl 读取。
- 验证：typecheck 过；全量 1486 测试过（新增 3 个 parseServerUsagePayload 用例）；pnpm build 过；在线实测 export/goal/usage 端点 200；knowledge:validate PASS。
- 知识库：runtime-routing 不变量 97-98 + log 更新。提交 0c6371ad。
- 实机待验：v2.20.153 下设置页套餐用量显示（Server 数据）、server 会话 Goal 面板不再报错、搜索浮层历史列表、导出 ZIP 可解压。


## 2026-08-02 修复：Swarm 改走官方 Server 原生接口，不再迁移 SDK（v2.20.152）

- 起因：用户指出官方 Web 的 Swarm 可正常使用。实测官方 0.31.1：profile `agent_config.swarm_mode` 可双向切换（status.swarm_mode 跟随），prompts 请求接受 `swarm_mode` 标记并正常完成；此前「Swarm 只能 SDK」是 ≤0.29 探针的过时结论。
- 修复：`setSwarmMode`/`swarm` 在 Server 会话上改走 `updateSession({swarm_mode})` + prompt 携带 `swarm_mode`（serverControls 仅在为真时写字段）；不再 `migrateServerSessionToSdk`、不再 pin；运行中开启仍拒绝（渲染层记 desired 下轮生效）。
- 影响：开 Swarm 不再换引擎/换 id/跳链路，与官方 Web 同链路；迁移窗口竞态类问题（气泡掏空）的该诱因消除。
- 验证：官方 Server 实测（profile/prompt/schema）+ typecheck + 全量 1483 测试 + build。实机待 v2.20.152 切换 Swarm 确认。

## 2026-08-02 修复：轮次收尾帧丢失后立即可自愈（v2.20.151）

- 现场：与 Kimi Web 共存时本轮最终总结在 Kimix 缺失（官方 wire 有 1112 字全文，Kimix 本地只到 21:58:32；丢帧窗口与 dev 重启重合）。
- 根因：丢帧只在轮次尾巴发生时无法自愈——启动水合在轮次完成前跑完，而轮询判定 terminal 后只 settle 不再对账；30s running-sample 又要求 running 态。与 Web 共存不互踢（cursor/epoch 可续传订阅），非必现。
- 修复：抽出共用 `reconcileFromHistorySnapshot`（原 running-sample 内联块）；terminal 分支在流上最后事件 >8s 无更新时触发一次同守卫（熔断器 + shouldReplace 单调性，settled 投影）的 `terminal-tail` 对账；`AgentCanonicalHistoryReason` 加 `"terminal-tail"`。
- 验证：typecheck + 全量 1483 测试过。实机待 v2.20.151。

## 2026-08-02 排查：发送后约 1 分钟才响应、中途卡顿（无版本变更）

- 方法：解析会话 `336f7ae6` 完整 wire.jsonl（57MB），逐轮计算三段耗时。
- 数据：turn.prompt→llm.request = 0s（链路零开销）；llm.request→首字 17–123s（中位 ~23s）；tool.result→下一请求 = 0s。每步输入 ~409k tokens、459 条消息、think=high、maxTokens 65536、grok-4.5 第三方 relay；16:09 曾达 ~786k，16:23 手动 compact 后砍半，5 小时又涨回 409k。diag 的 [live] silence 显示卡顿期间 thinking delta 仍在流。
- 结论：瓶颈 = 超大上下文 × relay × high thinking 的模型往返，非 Kimix 缺陷；不修渲染/事件管线。
- 处置：runbook 沉淀 `knowledge/maintenance/large-context-latency.md`；建议用户 compact/新会话、降 thinking 与 maxTokens。纯文档，未 bump。

## 2026-08-02 排查：切换 Swarm 后上一条 assistant 气泡被掏空（无版本变更）

- 现象：20:53 切 Swarm 后，发布轮气泡只剩文件变更卡 + 模型页脚。
- 快照结论：wire canonical、IndexedDB 本地、buildRenderItems 三层全部健康；本地事件 id 已重生成，证明之后被一次完整 canonical 水合自愈；渲染管线无 bug。
- 根因方向：Server→SDK 迁移窗口瞬态（快照回放/水合/wire 重写竞态），精确写入路径不可回溯；唯一无回归守卫的替换入口是非房间水合直换路径 `preserveLocalUserMediaInCanonicalHistory`（App.tsx ~2343）。
- 快照文档：`docs/issue-swarm-toggle-assistant-bubble-gutted-events-snapshot.md`。纯文档，未 bump。

## 2026-08-02 优化：单工具调用直接显示工具行（v2.20.150）

- 根因：工具组只有 1 个调用时仍包一层「1 个工具调用」折叠头，信息冗余。
- 修复：`KimiWebToolGroupCard` 在 tools.length===1 时直接渲染 `KimiWebToolRow`（保留卡片外壳、状态图标与自身展开详情）；两条渲染路径（KimiWebProcessGroup / TurnBlocksProcessGroup）共用该组件，一并生效。
- 验证：typecheck + 全量 1483 测试过；pnpm build 过。实机待 v2.20.150 截图。

## 2026-08-02 修复：设置页按钮接入界面风格体系（v2.20.149）

- 根因：设置侧栏「返回对话」、折叠图标钮、导航项/搜索结果硬编码 `surface-hover`，未消费 `--ui-nav-action-*` / `--ui-nav-list-*` / `--ui-selection-*` token，怀旧（和复古）的浮雕/触感覆盖不到。
- 修复：全部接入语义 token（active 走 selection，含 `.is-active:hover`）；怀旧下 `.kimix-workspace-header` 的「返回对话」静止即 raised 浮雕、按下 sunken（设置/Hooks/Skills 共用该头部，一并生效）。
- 注意：默认/现代化风格下导航项 hover 现在会带 `--ui-nav-list-hover-*` 的细边/无阴影，与主侧栏行行为一致，属预期对齐。
- 验证：settingsLayoutStyles + SettingsWorkspaceSidebar + uiStyles 27 过；pnpm build 过。实机待 v2.20.149 截图。

## 2026-08-02 修复：怀旧风格可保存 + 风格网格一行三列（v2.20.148）

- 根因：IPC `uiStyle` zod 与 settingsService 白名单仍是 default/modern/retro，选 nostalgia 触发 Invalid settings data。
- 修复：主进程/加载校验/ipc 类型放行 nostalgia；外观风格网格恢复 repeat(3)。
- 验证：结构抽查。实机待 v2.20.148 切换怀旧/复古保存。

## 2026-08-02 修复：顶栏侧栏按钮与导航键同尺寸（v2.20.147）

- 根因：侧栏折叠键写死 40×40，后退/前进为 h-8 w-8（32）。
- 修复：侧栏键改为 h-8 w-8，与相邻导航键一致；间距交给父级 gap。
- 验证：结构抽查。实机待 v2.20.147。

## 2026-08-02 功能：新增怀旧（Win98）界面风格（v2.20.146）

- 提炼：零圆角、硬浮雕斜切（亮上左/暗下右）、静止即立体、按下反转内凹、输入沉入、弹层硬偏移阴影、选中实面无侧栏导条；不锁定灰绿系统色，与「复古 Platinum」区分。
- 实现：`UiStyleId=nostalgia`，外观页「怀旧」；token + 角色覆盖（壳层/Composer/卡片/控件/浮层/侧栏/房间）。
- 验证：uiStyles 定向。实机待 v2.20.146 切换怀旧截图。

## 2026-08-02 修复：运行/文件分体钮展开态误用 toggle 蓝底（v2.20.145）

- 根因：`kimix-split-control.is-expanded` 走 `--ui-toggle-*`（accent-primary-light），菜单打开像模式选中；展开悬停仍锁蓝底。
- 修复：展开改为 sticky hover 表面；从共享 toggle 规则移除 split-control；分片 hover 用 surface-hover/active。
- 验证：uiStyles。实机待 v2.20.145。

## 2026-08-02 优化：默认浅色主题对比度与辨识度（v2.20.144）

- 根因：浅色 `text-muted`/`border-*` 过浅（muted≈2.5:1，边框≈1.2–1.5）；`borderSubtle` 还向白混合；surface ladder 过近。
- 修复：加深 muted/secondary/placeholder 与边框；边框改为向墨色混合；拉大 ground/base/hover 阶梯；四套默认 palette seed 略加深；浅色对比度单测。
- 验证：themePalettes/uiStyles。实机待 v2.20.144 暖纸/灰白等截图。

## 2026-08-02 优化：现代化工具卡背景改浅（v2.20.143）

- 对照：官方工具行为近白浅灰细边；Kimix modern 工具组用 `kimix-soft-card` + `surface-base`，在近白工作画布上偏深灰实底。
- 修复：新增 `--kimix-modern-process-background/border`（elevated 为主的浅 wash）；modern 下 soft-card 使用该色，贴近官方深度。
- 验证：uiStyles 定向。实机待 v2.20.143 现代化截图。

## 2026-08-02 调整：刻度条左距加倍（v2.20.142）

- 反馈：v2.20.141 贴边过近。
- 调整：轨道 left 4→8，刻度 left 2→4（相对主区左缘约 12px）。
- 验证：结构抽查。实机待 v2.20.142。

## 2026-08-02 修复：刻度条视觉贴左（v2.20.141）

- 根因：v2.20.140 虽把轨道挂到视口左缘，但刻度画在 40px 热区 `right: 8`，视觉中心约在 left+30px，仍显偏右。
- 修复：热区改左对齐，刻度 `left: 2`，轨道 `left: 4`、宽 28；标记 transform-origin 改为 left。
- 验证：结构抽查。实机待 v2.20.141 最大化确认贴主区左缘。

## 2026-08-02 修复：全屏时刻度条水平位置漂移（v2.20.140）

- 根因：`ChatNavigationRail` 挂在居中的 `kimix-chat-stream-column` 内，并用 `left: -46` 相对内容柱定位；窗口变宽后内容柱居中，刻度条跟着离开聊天区左缘。
- 修复：轨道改为挂在聊天视口 `absolute inset-0` 层，`left: 10` 相对视口左缘固定，不再嵌套居中内容柱。
- 验证：结构抽查。实机待 v2.20.140 最大化/还原对比。

## 2026-08-02 修复：窗口最大化/还原改回方框样式（v2.20.139）

- 反馈：Minimize2/Maximize2 箭头不像常见窗口控件；最小化横线是对的，问题在全屏键。
- 修复：最大化用单方框 SVG，还原用重叠双框 SVG；最小化仍为 Minus 横线，关闭仍为 X，尺寸 14 对齐。
- 验证：结构抽查。实机待 v2.20.139 截图。

## 2026-08-02 修复：窗口最大化按钮图标不一致（v2.20.138）

- 根因：最大化/还原使用 `Square`/`Copy` 且仅 12px，最小化/关闭为 14px Lucide 线标，中间键观感像字符。
- 修复：改为 `Maximize2`/`Minimize2`，统一 14px、`strokeWidth=2`，与两侧窗口控件一致。
- 验证：结构抽查。实机待 v2.20.138 截图。

## 2026-08-02 优化：文件预览侧栏层次与内边距（v2.20.137）

- 根因：面板壳、内层块、文件行全用 `surface-base`，再叠 14–18px 外圈 padding，观感全面内陷、无层次。
- 修复：外圈 padding 收到 10–12px；列表区用 `.kimix-section-card`；文件行改为 `surface-elevated`+细边，与壳层 base 区分。
- 验证：结构抽查。实机待 v2.20.137 截图。

## 2026-08-02 优化：会话侧栏卡片标题与内容间距（v2.20.136）

- 根因：标题下方正文多用 Tailwind `mt-3`/`mt-4`，spacing 类在本项目常不生效，标题贴内容。
- 修复：侧栏卡片 `mt-3`/`mt-4` 改为 inline `marginTop: 14`，统一标题→内容呼吸间距。
- 验证：结构抽查；实机待 v2.20.136 截图。

## 2026-08-02 优化：界面风格说明去外部产品名（v2.20.135）

- 调整：三套界面风格描述改为自有表述，不再出现 Codex / Platinum 等外部名称。
- 验证：文案与 uiStyles 单测。

## 2026-08-02 修复：深色模式层级与对比度灾难（v2.20.134）

- 根因：`buildDarkTokens` 把 surface 种子与 `#050505` 高比例混合，ground/base/elevated/hover 几乎同色；边框反而更暗；`--text-muted` 在 elevated 上约 2.5:1。
- 参考：Material Design 3 elevation、VS Code Dark+、GitHub Dark——抬升画布、表面阶梯可辨、边框向白、次要文字接近 AA。
- 修复：重建暗色 ladder + 亮边框 + 提亮 secondary/muted；同步 CSS `[data-theme=dark]` 与 Kimi dark；对比度单测锁门槛。
- 验证：themePalettes/uiStyles 定向 + 对比度断言。实机待 v2.20.134 深色截图。

## 2026-08-02 修复：顶栏启动/打开分体钮默认像选中（v2.20.133）

- 根因：`.kimix-split-control` 静止态强制 `--ui-compound-*` 实心底+边，观感等同 toggle/选中；默认顶栏其它工具键只是 soft border。
- 修复：静止态只保留 overflow，走与 toolbar-button 相同的 control 合约；展开时才用 `--ui-toggle-*`；分片分隔线仍用 compound divider。
- 验证：uiStyles 定向。实机待 v2.20.133 截图。

## 2026-08-02 修复：选中行悬停与普通悬停描边对齐（v2.20.132）

- 根因：v2.20.131 的 `--ui-selection-hover-*` 用“加深选中底”另一套语义，和普通 `--ui-nav-list-hover-*`（描边/触感）不一致。
- 修复：selection-hover 的 border/background 直接复用 nav-list-hover；默认/现代列表悬停补 subtle 描边；复古 hover shadow = 左侧选中条 + list-hover 浮雕。
- 验证：uiStyles 定向。实机待 v2.20.132 截图。

## 2026-08-02 修复：侧栏已选中行悬停无反馈（v2.20.131）

- 根因：`.kimix-sidebar-project-row.is-active:hover` 与 `.is-active` 共用 `--ui-selection-*`，悬停被锁死为选中静止底。
- 修复：拆分选中/选中悬停；新增 `--ui-selection-hover-*`（默认更深 `surface-active`，复古保留左侧 inset 标记）。
- 验证：uiStyles 定向。实机待 v2.20.131 截图。

## 2026-08-02 修复：会话侧栏剩余交互面接入风格角色（v2.20.130）

- 根因：仅 Git 五键与 section-card 外壳入角色；Plan 刷新、会话树 ±、最近变更行、大量 icon-text 仍用 Tailwind 固定底/圆角，切换 Modern/Retro 几乎不变。
- 修复：次级按钮统一 `.kimix-inspector-action`（去 accent-light 常驻底）；32px 图标钮 `.kimix-inline-icon-action.is-roomy`；列表行 `.kimix-inspector-list-item`；中性内嵌块 `.kimix-inset-section`。
- 验证：uiStyles 定向；OKF。实机待 v2.20.130 截图。

## 2026-08-02 修复：侧栏 Git 矩阵按钮可辨浅底（v2.20.129）

- 根因：v2.20.128 去掉常驻 accent/surface 工具类后，Git 五键只剩文字，静止态无法辨认为按钮。
- 修复：新增 `.kimix-inspector-action` 安静芯片角色（`--surface-base` + 细边框），hover 再加深；复古仍仅在 hover/active 加 Platinum 触感，不用 accent-light 常驻底。
- 验证：uiStyles 定向；OKF strict。实机视觉待 v2.20.129 截图。

## 2026-08-02 修复：会话侧栏次级按钮静止态过重（v2.20.128）

- 根因：v2.20.123 把侧栏 `.kimix-icon-text-button` 静止态套上 compound 浮雕；Git「详情/拉取/推送/图谱/刷新」又常驻 `bg-accent-primary-light`/`bg-surface-base`，默认就读成 hover。
- 修复：Git 矩阵去掉常驻底色，仅保留文字色与 hover 底；Retro 侧栏次级按钮改为静止透明、hover/active 才给 border+inset；`.bg-accent-primary` 主按钮不套该皮。
- 验证：uiStyles 17 项通过；OKF strict 通过。实机视觉待用户在 v2.20.128 截图确认。

## 2026-08-02 功能：子代理模型同步覆盖 Kimi Code Web 与 Swarm（v2.20.127）

- 根因：Kimix 原先只写 `[secondary_model]`，并只给自管 Server 注入 `KIMI_CODE_EXPERIMENTAL_SECONDARY_MODEL=1`；外部启动的 `kimi web` 不继承该环境，配置会被忽略。Kimi Code 0.31.1 已支持持久化 `[experimental] secondary-model = true` 和通过 `POST /api/v1/config` 热更新；最新版还通过 `/api/v1/meta.experimental_flags` 暴露有效状态。
- 修复：设置子代理模型时同时写入 `secondary_model` 与 `experimental`，活动 Web 走官方 Config API 立即生效并回读确认；支持新版 Meta 字段时再校验有效状态，早期 0.31.1 缺该字段时兼容。TOML 作为旧版回退且保留其他实验项。该配置同时作用于后续 Agent 与 AgentSwarm 新建子代理，恢复中的子代理仍保留原模型。侧栏名称同步调整为“子 Agent / Swarm 模型”。
- 验证：定向 3 文件 39 项、全量 155 文件 1480 项、Node/Renderer typecheck、生产构建（renderer CSS `assets/index-DDoRVO1c.css`、JS `assets/index-G0mJAJkX.js`）、OKF strict（13 concepts、403 links）与 180 天审计通过；对本机 Kimi Web `0.31.1` 的只读探测确认 Config API 已暴露 `experimental`/`secondary_model`，该早期构建尚未暴露最新版 `meta.experimental_flags`，兼容回读路径覆盖此边界。

## 2026-08-02 优化：精简上传媒体菜单项（v2.20.126）

- 调整：“上传图片或视频”按钮名已能完整表达用途，移除重复的“视频将直接作为多模态内容发送”副标题；文本改为单行截断，按钮最小高度从 52px 收敛到与相邻菜单项一致的 48px。上传逻辑、图标、禁用态和点击热区不变。
- 验证：全量 155 文件 1476 项、Node/Renderer typecheck、生产构建（renderer CSS `assets/index-DDoRVO1c.css`、JS `assets/index-CbX7JbeB.js`）、OKF strict（13 concepts、402 links）通过；实机视觉验收等待用户在 v2.20.126 截图确认。

## 2026-08-02 修复：Agent 选择项机器人图标垂直居中（v2.20.125）

- 根因：接收者弹层的 Agent 选择项使用 48px 最小行高和三列 Grid，文字列与勾选列已有 `self-center`，但 28px 机器人图标容器沿用 Grid 默认拉伸单元格的起始位置，视觉上贴近顶部。
- 修复：为机器人图标容器补充 `self-center`，只校正垂直位置，不改变图标尺寸、行高、列宽、点击热区或选择逻辑；增加源码回归断言锁定对齐约束。
- 验证：界面风格定向 17 项、全量 155 文件 1476 项、Node/Renderer typecheck、生产构建（renderer CSS `assets/index-DDoRVO1c.css`、JS `assets/index-EtzmU645.js`）、OKF strict（13 concepts、402 links）通过；实机视觉验收等待用户在 v2.20.125 截图确认。

## 2026-08-02 修复：Composer 房间触发器恢复同排层级（v2.20.124）

- 根因：Retro 将 `.kimix-room-trigger` 与弹窗 `.kimix-room-secondary-action` 合并使用 `--ui-compound-*`，使 Composer 底栏的 `Agents` 和正文范围触发器在静止态持续带框、浮雕；它们因此比同排的权限、Swarm、Plan 和思考强度更突出，错误表达成主操作层级。
- 修复：拆分房间触发器与弹窗次级按钮材质。`.kimix-room-trigger` 回到 `--ui-control-*` 基线，Retro 静止态透明，仅在 hover、展开和按压时显示触感；`.kimix-room-secondary-action` 继续保留完整 compound 边界。尺寸、弹层逻辑和 Multi-Agent 行为不变。
- 边界：同为 Multi-Agent 控件不代表共享同一静止材质；Composer 工具行按同排层级统一，弹窗命令按钮按独立操作层级处理。
- 验证：界面风格定向 17 项、全量 155 文件 1476 项、Node/Renderer typecheck、生产构建（renderer CSS `assets/index-DDoRVO1c.css`、JS `assets/index-YVEx1elZ.js`）、OKF strict/audit（13 concepts、402 links）通过；实机视觉验收等待用户在 v2.20.124 截图确认。

## 2026-08-02 修复：会话侧栏内部控件接入界面风格（v2.20.123）

- 根因：v2.20.122 只把会话侧栏 18 张外层分区迁移为 `.kimix-section-card`；Git 操作、长程任务控制等内部按钮仍只使用通用 `.kimix-icon-text-button`，模型选择和 BTW 输入仍由 Tailwind 固定表面拼装。Retro 对普通按钮采用“静止扁平、悬停触感”的全局策略，因此外卡虽已变化，内部密集操作区仍明显扁平。
- 修复：将 `.kimix-longtask-inspector .kimix-section-card .kimix-icon-text-button` 定义为侧栏专属成组操作角色，Retro 复用 `--ui-compound-*` 获得静止态小圆角、主题边界、轻浮雕与按压内凹，Modern 保持透明边界和扁平表面；目标步数、子 Agent 模型/思考强度和 BTW 输入接入 `.kimix-inspector-field` 字段角色，拖拽柄接入 `.kimix-inspector-drag-handle`。
- 边界：规则必须同时由 `.kimix-longtask-inspector` 与 `.kimix-section-card` 限定，不给全局 `.kimix-icon-text-button` 永久换肤，也不改变业务按钮的背景色、文字色与主次状态。
- 验证：界面风格定向 17 项、全量 155 文件 1476 项、Node/Renderer typecheck、生产构建（renderer CSS `assets/index-c9sRM_1J.css`、JS `assets/index-C2PCKuH-.js`）、OKF strict/audit（13 concepts、401 links）通过；实机视觉验收等待用户在 v2.20.123 截图确认。

## 2026-08-02 重构：内容表面确定接入界面风格角色（v2.20.122）

- 根因：界面风格已能通过语义类控制壳层、浮层、菜单和设置卡，但会话侧栏 18 张分区卡、Hooks 顶层分区及多类对话事件卡仍在业务组件中拼装固定圆角、边框和阴影；Retro 因此通常只改变 Tailwind 圆角变量，无法获得完整的 Platinum 小圆角与克制浮雕质感。
- 修复：新增 `.kimix-section-card` 统一独立中性分区的完整表面，新增 `.kimix-event-card` 只接管审批、澄清、错误、会话建议和恢复卡的形状/质感，`.kimix-inset-section` 为完整卡片内部提供无边框背景分层；业务语义色继续归组件所有。会话侧栏 18 卡、Hooks 6 分区及文件变更、文件、Todo 完成迁移，提问块使用内层递减角色。AppShell、弹窗、浮层、附件缩略图清除覆盖既有语义角色的固定圆角/阴影，文件卡打开控件复用 split-control 合约并保留 Kimix 默认基线。
- 边界：不重定义 `--border-*` 颜色主题 token；输入框、可点击选择项、分隔线、弹窗内说明块及图片预览等上下文特例不机械迁移为完整卡片，避免角色误判和框套框。
- 验证：界面风格定向 2 文件 19 项、全量 155 文件 1475 项、Node/Renderer typecheck、生产构建（renderer CSS `assets/index-BJx-m4wp.css`、JS `assets/index-BJ_YD1_r.js`）、OKF strict/audit（13 concepts、400 links）通过；执行策略阻止删除 `out/`/Vite 缓存，因此本轮不是清缓存构建。实机视觉验收等待用户在 v2.20.122 截图确认。

## 2026-08-02 修复：恢复默认顶栏并补齐多 Agent 风格角色（v2.20.120）

- 根因：v2.20.95（`e79dd434`）建立全局界面风格合约时，把共享控件的默认边框、背景和阴影设为透明；`SessionToolbar` 又移除了原先的 `rounded-xl border border-[var(--kimix-panel-border-soft)]`，于是新增风格意外改变了 Kimix 默认顶栏。底部 ContextBar 没有被同一提交删除，但默认 hover 仅靠浅背景与低扩散阴影，在当前配色上辨识不足。
- 修复：仅在没有 `data-ui-style` 的 Kimix 默认作用域恢复顶栏 12px 圆角、细边框、hover 轻上浮与展开/选中完整状态；长程任务状态按钮保留自己的语义边框，不被默认恢复规则覆盖。默认底栏 action 增加主题色派生的浅边界、完整文字色与 1px 上浮反馈。
- 多 Agent：为接收者/正文范围触发器、模型与权限选项、消息选择项、关闭/取消/管理模型和添加/保存主操作补充 `.kimix-room-*` 语义角色。Modern 继续使用安静大圆角；Retro 使用小圆角、主题派生边界、轻浮雕与内凹选中态，不覆盖任何颜色主题 token。
- 验证：UI 风格定向 15 项、全量 155 文件 1474 项测试、Node/Renderer typecheck、生产构建（renderer CSS `assets/index-Bk3h-5yh.css`、JS `assets/index-BcasY1xp.js`）、OKF strict/audit（13 concepts、399 links）通过；v2.20.120 开发窗口已重启，实际按钮观感等待用户截图验收。

## 2026-08-02 审计修复：发布门禁与多窗口草稿隔离（v2.20.119）

- 发布说明缺口核验：v2.20.76–118 均未打 tag，按“从上个实际发布版本聚合”的规则不需要 43 份内部 patch 说明；真实风险是 workflow 缺专属文件时静默回退到过期 `RELEASE_NOTES.md`。现改为缺文件直接失败，并新增下一实际发布候选 `v2.20.119.md`，范围从 v2.20.75 起算。
- TASK_STATE 缺口核验：v2.20.76–91 的 16 个版本确无独立条目，但 Git 版本提交完整；已按不可变提交记录补记，未虚构原轮测试结果。v2.20.103 从未写入 `package.json`，属于跳号而非遗失版本，无需补条目或 release notes。
- 多窗口草稿风险真实：旧实现虽写入 `updatedAt`，但读取不使用，且所有窗口写同一 localStorage 键。现按 renderer 窗口建立独立持久槽，恢复时选择最新有效内容，清空只影响当前窗口，并兼容 v1 旧记录；附件跨完整重启仍保持原有已知边界。
- Retro hover 当前不存在所报 `:where + !important` 冲突：低权重 allowlist、状态按钮专用规则和防全局 button fallback 测试均在；radius 双轨分别服务 Tailwind 固定尺寸与语义容器尺寸，当前不做高风险合并。
- UI 验收核验：v2.20.104–108 有实机证据记录；v2.20.109–118 仍需一次集中截图验收，属于待验收状态而非可由代码自动修复的缺陷。
- 验证：草稿与发布门禁定向 2 文件 8 项、全量 155 文件 1472 项测试、Node/Renderer typecheck、生产构建（renderer CSS `assets/index-B0OfNeag.css`、JS `assets/index-BqmfPaOa.js`）、OKF strict/audit 校验（13 concepts、398 links）通过；多窗口草稿真实交互与 v2.20.109–118 集中视觉验收仍需用户实机复验。

## 2026-08-02 补记：v2.20.76–91 版本上下文恢复

- 2026-08-02 审计确认这 16 个版本在 `TASK_STATE.md` / `TASK_HISTORY.md` 中没有独立任务条目，但对应 Git 提交与 `package.json` 版本变更完整存在。以下内容按不可变提交记录回填；原轮次更细的测试输出未保留，不补写无法核实的验证结论。
- **v2.20.76** `f2e9dc48`：模型列表默认模型标识改为明确语义。
- **v2.20.77** `e960cadf`：修复 Assistant footer 回落为裸“已完成”的根因。
- **v2.20.78** `84542a74`：默认模型按钮改为与 Swarm 模式一致的开关形式。
- **v2.20.79** `033d586c`：项目会话列表默认只展示最近 5 个，其余按需展开。
- **v2.20.80** `b93218ce`：设置头部完整显示默认模型名，并固定默认按钮宽度。
- **v2.20.81** `bb8a5802`：会话侧栏新增“后台 Bash / 子 Agent”任务面板。
- **v2.20.82** `e85fe84e`：隐藏两处不应暴露给用户的内部运行状态。
- **v2.20.83** `fe5a16b2`：会话列表收起入口与展开入口对称，并显示数量。
- **v2.20.84** `0c6d2eff`：后台任务卡空态自动隐藏，消除刷新闪烁。
- **v2.20.85** `4fd106a0`：“最近变更”与对话流变更记录对齐。
- **v2.20.86** `73312574`：文件预览列表新增排序弹窗切换。
- **v2.20.87** `0ea2a8d3`：外观页色彩方案拆为独立设置分区，并与主题分区格式对齐。
- **v2.20.88** `a485ceeb`：外观页新增 Kimix 默认、现代化、复古三套界面风格切换。
- **v2.20.89** `e9a14cd7`：修复界面风格机制并重做三套基础呈现。
- **v2.20.90** `ed26d236`：统一复古风格圆角与阴影。
- **v2.20.91** `050cb9c1`：按 `frontend-design` 方法论重做界面风格；其视觉方向随后在 v2.20.92 根据用户截图调整为 Classic Mac OS Platinum。

## 2026-08-02 修正：恢复设置侧栏上下文并移除正文重复标题（v2.20.118）

- 根因：v2.20.117 为统一工作区顶栏，误把设置替换侧栏中的“返回对话/设置”也当成重复身份移除；同时保留了右侧“常规/外观”等活动分类标题，既损失导航上下文，又继续占用正文空间。
- 修正：恢复展开与折叠设置侧栏的返回入口，展开态恢复“设置”标题；删除右侧活动分类标题与说明，让正文直接进入配置内容。模型页的默认模型信息、诊断和刷新操作改为独立紧凑工具行，功能不随标题删除。
- 验证：设置侧栏、布局与 UI 风格定向 3 文件 22 项、全量 154 文件 1470 项测试、Node/Renderer typecheck、生产构建（renderer CSS `assets/index-B0OfNeag.css`、JS `assets/index-BKntR3ty.js`）、OKF strict/audit 校验（13 concepts、396 links）通过；实际空间与层级观感等待用户在 v2.20.118 截图验收。

## 2026-08-02 优化：设置页统一工作区顶栏（v2.20.117）

- 根因：插件与 Hooks 把页面身份、范围说明和返回动作统一放在右侧工作区顶栏；设置页却把“返回对话/设置”塞进替换侧栏，右侧正文直接从当前分类标题开始，同级全页工作区出现两套层级结构。
- 修复：设置工作区复用 `.kimix-workspace-header`，展示设置图标、范围说明和右侧“返回对话”；设置侧栏仅保留搜索、分类导航与版本信息。工作区面板改为固定顶栏加剩余高度正文，避免新增顶栏后滚动内容溢出。
- 验证：设置侧栏、布局与 UI 风格定向 3 文件 22 项、全量 154 文件 1470 项测试、Node/Renderer typecheck、生产构建（renderer CSS `assets/index-CmAXhwa6.css`、JS `assets/index-CnUiimmE.js`）、OKF strict/audit 校验（13 concepts、395 links）通过；实际顶栏观感等待用户在 v2.20.117 截图验收。

## 2026-08-02 修复：复古 Swarm/Plan 分离 hover 与选中态（v2.20.116）

- 根因：Retro 将共享 `--ui-toggle-*` 改成中性浮雕值，导致 Swarm/Plan 的持久开启态看起来像 hover；未选中 hover 又由通用按钮兜底环负责，只出现普通阴影，状态层级反转。
- 修复：把 `.kimix-state-button` 从独立按钮兜底白名单移出。未选中 hover 显式使用 Retro 边框、背景和 inset 阴影；`aria-pressed="true"` 使用 Kimix 默认同源的蓝色边框、浅蓝背景和蓝色文字，且选中后 hover 不退回中性浮雕。
- 验证：UI 风格定向 13 项、全量 154 文件 1469 项测试、Node/Renderer typecheck、生产构建（renderer CSS `assets/index-pLCc4bvR.css`、JS `assets/index-D05m6Ujm.js`）、OKF strict/audit 校验（13 concepts、394 links）通过；构建产物确认包含独立的未选中 hover 与 `aria-pressed="true"` 规则，实际状态观感等待用户在 v2.20.116 复验。

## 2026-08-02 修复：复古混合角色按钮移除双层描边（v2.20.115）

- 根因：Composer 的添加、权限、思考强度、上下文用量等按钮同时具有结构控件类与通用按钮类；v2.20.113 的通用复古 hover 白名单使用高权重 `[data-ui-style="retro"]` 作用域，压过后置的结构控件规则，导致真实 1px 边框与额外 1px 阴影环同时显示。
- 修复：将通用白名单的 preset 作用域降为零权重 `:where([data-ui-style="retro"])`。后置结构控件重新接管其单层边框与浮雕阴影；无真实边框的独立按钮、Agent 折叠标题仍保留兜底环和 v2.20.114 的平滑过渡。
- 验证：UI 风格定向 13 项、全量 154 文件 1469 项测试、Node/Renderer typecheck、生产构建（renderer CSS `assets/index-DrvnGm_l.css`、JS `assets/index-Q9XW1yLp.js`）、OKF strict/audit 校验（13 concepts、393 links）通过；构建产物确认保留零权重 `:where([data-ui-style...])` 作用域，实际描边观感等待用户在 v2.20.115 复验。

## 2026-08-02 优化：复古按钮阴影过渡与 Agent 标题 hover（v2.20.114）

- 根因：顶部菜单触发器会同时过渡背景与浮雕阴影，其他部分独立按钮虽然在 v2.20.112/113 获得相同阴影，但多个语义类没有声明 `box-shadow` 过渡，阴影直接跳变；Agent 内容标题使用 `button.kimix-chat-collapse-row`，此前又未登记到复古按钮角色白名单。
- 修复：为静默按钮、行内图标、侧栏图标、弹窗关闭按钮和折叠标题补齐共享 150ms 阴影过渡；顶部菜单同时平滑过渡边框；只把可交互的 `button.kimix-chat-collapse-row` 加入复古 hover 合约，非按钮标题和嵌套点击热区不受影响。
- 验证：UI 风格定向 13 项、全量 154 文件 1469 项测试、Node/Renderer typecheck、生产构建（renderer CSS `assets/index-k1CvEqEz.css`、JS `assets/index-BMhpkE1x.js`）、OKF strict/audit 校验（13 concepts、392 links）通过；构建产物确认包含 `button.kimix-chat-collapse-row` 复古角色，实际观感等待用户在 v2.20.114 检查动画连贯性。

## 2026-08-02 修复：复古会话行移除嵌套文字框（v2.20.113）

- 根因：v2.20.112 的全局原生 `button:hover` 兜底同时命中了会话行外层视觉表面内的标题点击按钮，导致一行 hover 时出现“整行外框 + 文字内框”两个边界所有者。
- 修复：删除全局原生按钮兜底，改为独立视觉按钮语义类白名单；会话行继续由 `.kimix-sidebar-session-row` 绘制唯一 hover 外框，内部标题按钮只保留点击热区，右侧独立操作按钮仍有自己的 hover 反馈。
- 验证：UI 风格定向 13 项、全量 154 文件 1469 项测试、Node/Renderer typecheck、生产构建（renderer CSS `assets/index-BPPwNv4t.css`、JS `assets/index-ML95Vm0Q.js`）、OKF strict/audit 校验（13 concepts、391 links）通过；实际观感等待用户在 v2.20.113 检查会话行 hover。

## 2026-08-02 优化：复古按钮 hover 全覆盖并移除底栏外框（v2.20.112）

- 根因一：左上角新对话、搜索等使用 `ui-nav-action`，Retro 将该角色的 hover 边框/阴影设为透明与 `none`；顶部菜单和工具按钮则走另一套 tactile token，造成同为按钮却反馈不一致。
- 修复一：新增 Retro 共享 hover border/background/shadow token，并让 control、nav action、nav list、menu trigger 与 ContextBar action 统一消费；增加零 specificity 的原生 button hover 兜底，业务主操作、危险、选中和展开态仍可用更具体规则覆盖。
- 根因二：Retro 把底部 ContextBar 当成连续控制带，额外添加整体边框、底色和内阴影，与上方 Composer 外框叠成双层框。
- 修复二：ContextBar 恢复透明、无边框、无阴影，仅保留内部按钮在 hover/展开时的复古触感。
- 验证：UI 风格定向 13 项、全量 154 文件 1469 项测试、Node/Renderer typecheck、生产构建（renderer CSS `assets/index-rIXsImFv.css`、JS `assets/index-DXbWuSS5.js`）、OKF strict/audit 校验（13 concepts、390 links）通过；实际观感等待用户在 v2.20.112 检查导航 hover 与无框底栏。

## 2026-08-02 修复：默认模式移除复古选中左条（v2.20.111）

- 根因：v2.20.95 建立全局界面风格合约时，基础 `:root` 将 `--ui-selection-shadow` 初始化为蓝色 inset 左条；Modern 显式覆盖为 `none`，Retro 单独增强，因此默认模式反而一直继承了本应属于复古的标记。
- 修复：基础 selection shadow 恢复为 `none`；项目、会话、设置等默认选中态继续保留主题背景，不再显示左条。Retro 仍由自己的 preset token 提供左条，Modern 保持无左条。
- 验证：UI 风格定向 13 项、全量 154 文件 1469 项测试、Node/Renderer typecheck、生产构建（renderer CSS `assets/index-CRMnqXlI.css`、JS `assets/index-D22joVgt.js`）、OKF strict/audit 校验（13 concepts、389 links）通过；实际观感等待用户在 v2.20.111 切换默认/复古截图验收。

## 2026-08-02 修正：现代用户消息改为同源单次混合（v2.20.110）

- 连续两次小幅加权仍未解决用户气泡过浅。v2.20.109 截图取样：工作画布亮度约 254、用户气泡约 247、信息气泡约 242；用户气泡与画布只差约 7 级。
- 根因：用户气泡先取得已混合的信息表面，再向 elevated 二次混合；浅色 52% 的表面权重等效只保留约 30% hover，参数名看似过半，实际对比仍被连续稀释。
- 修正：用户气泡改为与信息气泡同源的单次混合。浅色使用 46% hover（信息气泡 58%），深色使用 54%（信息气泡 66%），明确保留 12 个百分点的较浅层级，同时把浅色目标亮度拉到约 244–245。
- 验证：UI 风格定向 12 项、全量 154 文件 1468 项测试、Node/Renderer typecheck、生产构建（renderer CSS `assets/index-CVLHZ1wY.css`、JS `assets/index-BWU3Q_OB.js`）、OKF strict/audit 校验（13 concepts、388 links）通过；实际观感等待用户在 v2.20.110 截图验收。

## 2026-08-02 调整：现代用户消息气泡回收过浅层级（v2.20.109）

- 用户实机反馈 v2.20.108 的用户消息气泡与画布过于接近，短消息的作者归属不够清晰。
- 调整：保持信息气泡与 Agent 行内代码的共享色不变；用户气泡对共享色的权重由浅色 44% 提至 52%、深色 50% 提至 56%，仅略微加深，仍明确低于共享色本身。
- 验证：UI 风格定向 12 项、全量 154 文件 1468 项测试、Node/Renderer typecheck、生产构建（renderer CSS `assets/index-DgED8crQ.css`、JS `assets/index-4UY0sHiF.js`）、OKF strict/audit 校验（13 concepts、387 links）通过；实际观感等待用户在 v2.20.109 截图验收。

## 2026-08-02 调整：现代消息中性色统一为两级层次（v2.20.108）

- 现状核对：消息信息气泡与 Agent 正文行内代码原本同为 `surface-hover`；用户消息另用 `surface-active/elevated` 混合。三者并非全相同，且不同主题下两套来源可能造成层级反转。
- 修复：消息信息气泡与行内代码统一消费 `--kimix-modern-message-meta-background`，浅色由 58% hover + elevated 混合；用户消息再由该共享表面向 elevated 淡化，浅色只保留 44% 共享表面。深色对应为 66% 与 50%，保证用户消息始终比前两者淡一级。
- 实机验收：Windows v2.20.108 同屏确认消息信息气泡与 Agent 行内代码保持同色，用户消息为更浅一级的无描边表面；证据：`C:/Users/Administrator/AppData/Local/Temp/kimix-ui-audit-22108/01-modern-message-surface-hierarchy.jpg`。
- 验证：消息表面定向 3 文件 20 项、全量 154 文件 1468 项测试、Node/Renderer typecheck、生产构建（renderer CSS `assets/index-DwKZO88K.css`、JS `assets/index-BiWjGHSx.js`）、OKF strict/audit 校验（13 concepts、387 links）通过。

## 2026-08-01 调整：现代用户气泡降低表面色权重（v2.20.107）

- 用户实机反馈 v2.20.106 气泡过深，短消息呈现为突出的灰色按钮，而非 Codex 参考中的轻灰输入层。
- 修复：浅色模式 `surface-active` 权重从 82% 降至 48%，深色模式从 86% 降至 62%；继续保持主题派生、无描边和无阴影，仅降低与画布的明度差。
- 实机验收：Windows v2.20.107 当前灰白主题下，短消息气泡已由中灰按钮感降为接近画布的轻灰层，同时仍可辨识作者输入。证据：`C:/Users/Administrator/AppData/Local/Temp/kimix-ui-audit-22107/01-modern-user-bubble-light.jpg`。
- 验证：UI 风格定向 12 项、全量 154 文件 1468 项测试、Node/Renderer typecheck、生产构建（renderer CSS `assets/index-vNJGB5--.css`、JS `assets/index-DsfKRyLG.js`）、OKF strict/audit 校验（13 concepts、386 links）通过。

## 2026-08-01 优化：现代用户输入气泡与画布拉开明度（v2.20.106）

- 根因：Modern 将主工作画布提亮为 96% `surface-elevated`，用户气泡仍直接使用 `surface-elevated`，两者在浅色主题下几乎同为白色，作者输入层级消失。
- 修复：新增仅属于 Modern 的用户气泡呈现 token，由当前颜色主题的 `surface-active` 与 `surface-elevated` 混合；浅色 82% active、深色 86% active，并保持无描边、无阴影。默认、复古和颜色主题源 token 均不改变。
- 实机验收：Windows v2.20.106 当前暖纸主题下，用户气泡已与亮色画布形成稳定的浅灰层级，文字对比清晰且没有卡片化描边/投影。证据：`C:/Users/Administrator/AppData/Local/Temp/kimix-ui-audit-22106/01-modern-user-bubble.jpg`。
- 验证：UI 风格定向 12 项、全量 154 文件 1468 项测试、Node/Renderer typecheck、生产构建（renderer CSS `assets/index-BA0QW722.css`、JS `assets/index-BUkj_FYD.js`）、OKF strict/audit 校验（13 concepts、385 links）通过。

## 2026-08-01 修复：未发送 Composer 草稿跨工作区持久保留（v2.20.105）

- 根因：`AppShell` 在设置、插件等工作区与聊天工作区之间条件挂载，进入设置会卸载 `Composer`；正文和附件此前都只存在组件本地 state，重新挂载必然从空值开始。
- 修复：新增会话级草稿边界，已有会话使用 `session:<id>`，尚未创建新会话时使用 `project:<id>:new`；每次正文变化同步写入内存与 `localStorage`，附件保留内存副本，工作区卸载只刷新、不清空。`Composer` 按会话/项目身份 remount，切换会话不会串草稿；只有明确发送或清空才删除对应草稿。
- 实机验收：Windows v2.20.105 输入唯一未发送正文 `草稿保护验收-20260801-2107：切换设置后必须逐字保留`，打开设置再返回、杀死旧进程并重启开发应用后均逐字保留。证据：`C:/Users/Administrator/AppData/Local/Temp/kimix-draft-audit-22105/01-draft-restored.jpg`、`02-draft-restored-after-app-restart.jpg`。
- 持久边界：正文可跨设置、工作区、renderer/app 重启恢复；附件可跨设置和会话往返恢复，但大附件未写入同步存储，完整进程重启后的附件持久化仍需独立 IndexedDB 方案。
- 验证：草稿定向 6 项、全量 154 文件 1468 项测试、Node/Renderer typecheck、生产构建（renderer CSS `assets/index-CO_RFeGP.css`、JS `assets/index-Bj0urN8U.js`）、OKF strict/audit 校验（13 concepts、384 links）通过。

## 2026-08-01 优化：现代内容圆角覆盖与轻量表格（v2.20.104）

- 根因一：Modern 已有 control/card/panel/shell 四级圆角，但设置分组、连接卡、模型行、插件项及完整模型面板没有按语义角色登记，仍回退到旧的 `radius-sm/md`，导致设置页大圆角只覆盖部分容器。
- 修复一：成组选择容器统一使用 16px segment 圆角，单层内容卡统一使用 14px card 圆角，完整子区域面板统一使用 18px panel 圆角；控件 10px 与主壳 20px 保持不变，颜色、布局、默认和复古风格不受影响。
- 根因二：Markdown 表格把硬编码米灰外框、单元格四边框、灰表头与斑马纹叠在一起；Modern 即使圆角化，仍像旧式数据网格，且深灰偶数行压过正文层级。
- 修复二：Markdown 表格暴露 frame/table/head/cell 语义角色；仅 Modern 移除卡片外框、竖线、表头底色与斑马纹，改为主题 `border-subtle` 派生的浅横线，首末列与正文边缘对齐。默认/复古保留既有网格表现。
- 实机验收：Windows 直接操作 v2.20.104，模型与供应商、外观、对话与权限、对话表格四个状态均无裁切、反向嵌套或深色斑马纹。证据：`C:/Users/Administrator/AppData/Local/Temp/kimix-style-audit-22104/01-models.png` 至 `04-modern-table.png`，详细结论见 `design-qa.md`。
- 验证：定向 Markdown/UI/设置样式 3 文件 22 项、全量 153 文件 1462 项测试、Node/Renderer typecheck、生产构建（renderer CSS `assets/index-CO_RFeGP.css`、JS `assets/index-CehvMEy_.js`）、OKF strict/audit 校验（12 concepts、380 links）通过。

## 2026-08-01 修正：现代分隔线目标与空态建议槽位（v2.20.102）

- 纠错一：v2.20.100 误把用户所指分割线理解成会话标题栏底边并将其移除；实际目标是启动和打开两个 split button 主动作/下拉动作之间的竖线。现恢复标题栏原有结构横线，新增 `--ui-compound-divider-shadow` 角色 token，Modern 设为 `none`，默认与复古继续保留内部语义分隔。
- 根因二：空态先铺项目级历史建议，再追加最新继续和固定建议，最后直接截前五条；两个历史“接着上次”与一个动态“继续”因此同时出现，并把固定的“快速全面了解一下当前的项目”挤出列表。
- 修复二：空态改成固定槽位优先级——项目概览始终第一，最新上下文规范化成唯一一条 `继续：…`，所有历史继续被过滤，其余位置再按历史非继续建议与默认建议补足；没有最新消息时也只将第一条历史继续规范化保留。
- 验证：空态与 UI 风格定向 2 文件 16 项、全量 153 文件 1462 项测试、Node/Renderer typecheck、生产构建（renderer CSS `assets/index-ClPEf-oq.css`、JS `assets/index-DKUd3t13.js`）、OKF strict/audit 校验（12 concepts、379 links）通过。

## 2026-08-01 修复：空态建议图标兼容历史文案（v2.20.101）

- 根因：空态建议由项目级 `localStorage` 跨版本保留，但图标分配只按四条当前内置文案做整句精确匹配；历史建议、截断的最近对话和轻微改写全部未命中，统一回退成 Sparkles，截图中的前四条因此看起来完全相同。
- 修复：新增稳定的语义图标解析，内置文案继续走精确映射，历史/动态建议再按继续上下文、风险审查、待办整理、问题分析和项目概览识别；不清空用户已保存的建议，也不退回与内容无关的按位置轮换。
- 验证：截图中的真实文案已加入 2 项定向单测；全量 153 文件 1460 项测试、Node/Renderer typecheck、生产构建（renderer CSS `assets/index-C-QE97_z.css`、JS `assets/index-CifO4X5r.js`）、OKF strict/audit 校验（12 concepts、377 links）通过。

## 2026-08-01 优化：现代会话工具栏移除无语义分割线（v2.20.100）

- 根因：`SessionToolbar` 自带 `border-b`，Modern 又将其着色为 `--ui-section-divider-color`；v2.20.99 已让标题栏和对话画布共用同一亮面后，这条整宽横线不再表达独立滚动、尺寸调整或内容归属，只会把连续工作区硬切成两块。
- 修复：仅在 Modern 下为 `.kimix-app-shell-toolbar` 关闭底边；没有修改全局分隔色 token，因此默认/复古壳层，以及菜单、列表和复合按钮内部真正承担分组作用的局部分隔仍保持原样。
- 实机验收：Windows 直接操作 v2.20.100 空白对话页，确认标题栏与画布连续、整宽横线消失，外层壳边框和右侧按钮组边界完整。证据：`C:/Users/Administrator/AppData/Local/Temp/kimix-ui-audit-22100/01-modern-toolbar.png`。
- 验证：定向 UI 风格 12 项、全量 152 文件 1458 项测试、Node/Renderer typecheck、生产构建（renderer CSS `assets/index-C-QE97_z.css`、JS `assets/index-D_VKKddI.js`）、OKF strict/audit 校验（12 concepts、377 links）通过。

## 2026-08-01 优化：现代模式亮面工作画布（v2.20.99）

- 根因：Modern 虽已建立 Codex 式圆角和壳层，但主内容、工具栏、Footer、设置与插件工作区仍直接使用颜色主题的 `surface-base`；暖纸等主题在大面积铺开时压平了侧栏与画布的明度差，整体看起来灰蒙。
- 修复：新增 `--kimix-modern-workspace-background` 呈现 token，浅色模式以 96% `surface-elevated` + 4% `surface-base` 生成接近白色但仍带主题底色的工作画布，深色模式使用 78%/22% 保持相对提亮；聊天主壳、工具栏、Footer、设置、插件与 Hooks 统一消费该 token，侧栏、选中态、强调色和所有颜色主题源 token 不变。
- 实机验收：Windows 直接操作 v2.20.99，对照 Codex 参考检查空白对话主界面、外观设置和插件工作区；主画布明显提亮，外围主题色与卡片层级仍可辨，无漂白或边界消失。证据：`C:/Users/Administrator/AppData/Local/Temp/kimix-ui-audit-22099/01-modern-main.png`、`02-modern-settings.png`、`03-modern-plugins.png`。
- 验证：定向 UI 风格 12 项、全量 152 文件 1458 项测试、Node/Renderer typecheck、生产构建（renderer CSS `assets/index-BIpNiJJT.css`、JS `assets/index-D1OODTQw.js`）、OKF strict/audit 校验（12 concepts、376 links）通过。

## 2026-08-01 修复：复古壳层边框与现代嵌套圆角（v2.20.98）

- 根因一：v2.20.96 为移除无语义的侧栏分隔线，错误地在复古 `.kimix-app-shell-main` 上设置 `border-left-width: 0`，把主内容壳本身的结构边框也一并删除，设置页与对话页左边缘因此像被裁切。
- 根因二：v2.20.97 将 Modern 的全局 `rounded-*` 工具档位整体放大，同时把设置主题选项纳入通用卡片圆角，造成主题分段控件外壳 10px、内部选中块 14px 的反向嵌套；大壳层与小控件缺少角色化圆角边界。
- 修复：复古主壳恢复完整 1px 四边结构边框，装饰分隔继续保持关闭；Modern 拆分 control/card/panel/shell 四级角色圆角，通用 utility 恢复递进尺度，主题分段控件固定为外 16px = 内 10px + 6px 间距。
- 实机验收：Windows 直接操作 v2.20.98，现代设置页同心圆角、复古设置页完整左边框、复古对话页完整左边框均通过；证据：`C:/Users/Administrator/AppData/Local/Temp/kimix-ui-audit-22098/01-modern-settings.png`、`02-retro-settings.png`、`03-retro-main.png`。详细结论见根目录 `design-qa.md`。
- 验证：定向 UI 风格 12 项、全量 152 文件 1458 项测试、Node/Renderer typecheck、清缓存生产构建（renderer CSS `assets/index-D_k4R3YX.css`、JS `assets/index--ouAyPud.js`）、OKF strict/audit 校验（12 concepts、375 links）通过。

## 2026-08-01 重做：现代化风格转向 Codex 式静谧工作台（v2.20.97）

- 根因：旧“现代化”只把默认 Kimix 的圆角统一压到 6px、删除阴影并淡化 hairline，默认本身又已经是现代视觉，导致两者只有数值差异、没有可辨识的设计身份；同时旧规则直接覆盖 `--border-subtle`，越过了“界面风格不接管颜色主题”的边界。
- 修复：Modern 改为完整导航选中胶囊（无方向性主题刻度）、18–20px 主内容/Composer/浮层壳、低扩散悬浮阴影、安静扁平控件、轻量复合按钮与统一设置卡；所有表面、文字、强调色和边框颜色继续消费当前颜色主题，不改变 Skills、设置和对话的业务布局。
- 实机验收：Windows 直接操作 v2.20.97，切换现代化后检查对话主界面、外观设置、插件工作区及导航切换；三张实现截图与用户提供的三张 Codex 参考图同轮对照，无 P0/P1/P2 视觉问题。证据：`C:/Users/Administrator/AppData/Local/Temp/kimix-ui-audit-22097/01-main.jpg`、`02-settings.jpg`、`03-plugins.jpg`；详细结论见根目录 `design-qa.md`。
- 验证：定向 UI 风格 12 项、全量 152 文件 1458 项测试、Node/Renderer typecheck、生产构建（renderer `assets/index-cqYO6o5q.js`）、OKF strict/audit 校验（12 concepts、374 links）通过。

## 2026-08-01 修复：复古风格收回常驻控件框并拆分状态语义（v2.20.96）

- 用户截图确认 v2.20.95 虽然覆盖了壳层触点，但将“接入风格契约”错误实现成“所有控件常驻描边和凸起”：侧栏五个主动作堆成工具条，窗口按钮和会话菜单过度盒化，主区左侧边界仍像无语义竖线；Swarm/Plan 又误用纵向导航的左侧主题刻度。
- 修复将普通控件、窗口动作、侧栏动作和列表恢复为平面静止态，仅 hover/active 显示复古触感；启动/打开使用独立 `--ui-compound-*` 保留复合控件边界。`--ui-selection-*` 仅服务项目/会话等纵向导航，新增 `--ui-toggle-*` 服务 Swarm、Plan、pressed/expanded 控件，按钮开启态改为完整轻内凹面，绝不带方向性蓝条；复古主内容面板去掉左边框和多余投影。
- 实机验收：通过 Windows 直接操作 v2.20.96 开发窗口，检查主界面、项目/会话 active+hover、Swarm/Plan 分别与同时开启、启动菜单展开；确认侧栏恢复安静列表、导航刻度悬停不丢失、两种模式按钮均无左侧蓝条、复合按钮和弹窗仍保留复古层级。验收截图：`C:/Users/Administrator/AppData/Local/Temp/kimix-ui-audit-22096/02-main-clean.png`。
- 验证：定向 UI 风格 11 项、全量 152 文件 1457 项测试、Node/Renderer typecheck、生产构建（renderer `assets/index-D2IUv33I.js`）、OKF strict/spec/audit 校验（12 concepts、373 links）通过。

## 2026-08-01 重构：全局界面风格合约与壳层触点覆盖（v2.20.95）

- 用户在 v2.20.94 截图中确认，选中项目悬停时左侧主题刻度消失、侧栏与主区之间出现无语义全高竖线，侧栏主动作/项目/会话和标题栏右侧启动/打开控件仍没有进入复古语言，说明上一轮仍以预设选择器补点为主，缺少可批量扩展的角色契约。
- 根因一是复古 `.kimix-sidebar-project-row:hover` 后置覆盖完整 `box-shadow`，抹掉 active 刻度；根因二是复古侧栏直接写入 `inset -1px` 全高阴影；更深层根因是组件只暴露零散类名，预设自行寻找触点，没有 `主题颜色 -> 语义风格令牌 -> 组件角色` 的稳定边界。
- v2.20.95 建立 `--ui-control-*`、`--ui-nav-action-*`、`--ui-nav-list-*`、`--ui-selection-*`、`--ui-popup-*`、`--ui-menu-trigger-*`、`--ui-shell-*` 等契约；侧栏主动作/项目/会话/设置、窗口控制、顶部菜单、启动/打开 split control、工具按钮与菜单分隔线统一消费角色令牌。active+hover 显式保持 selection 优先级，装饰性侧栏全高线移除。
- 验证：定向 UI 风格 10 项、全量 152 文件 1456 项测试、Node/Renderer typecheck、生产构建（renderer `assets/index-BihEH33x.js`）、OKF strict/spec/audit 校验（12 concepts、372 links）通过；本机开发窗口已重启为 v2.20.95，视觉验收待用户截图确认。

## 2026-08-01 重构：全局控件状态与浮层骨架统一（v2.20.94）

- 用户在 v2.20.93 截图中确认，项目选中态叠加边框/内框/主题刻度，Swarm/Plan 与套餐用量分别使用三套选中语法，各类菜单和小浮层仍由业务组件自行定义圆角、阴影及菜单项，导致默认 Kimix 与复古模式同时漂移。
- 初版 Kimix 先建立共享角色：二元模式统一 `.kimix-state-button` + `aria-pressed`，下拉控件统一 `.kimix-control-button` + `aria-expanded`，菜单/浮层/弹窗统一 `.kimix-menu-panel`、`.kimix-menu-item`、`.kimix-floating-panel`、`.kimix-modal-card`；复古模式只覆盖这些角色的材质。侧栏项目/会话选中态收敛为单一浅表面与左侧主题刻度。
- Composer、ContextBar、顶部菜单、侧栏项目菜单、文字/图片右键菜单、文件菜单、Diff 排序菜单及主要模态窗已接入共享骨架；颜色仍完全由主题 token 决定。
- 验证：定向 2 文件 11 项、全量 152 文件 1455 项测试、Node/Renderer typecheck、生产构建（renderer `assets/index-QQs-QpyB.js`）、OKF strict/spec/audit 校验（12 concepts、371 links）通过；本机开发窗口已重启为 v2.20.94，视觉验收待用户截图确认。

## 2026-08-01 修复：复古风格组件语言统一（v2.20.93）

- 用户截图确认 v2.20.92 仍有三类割裂：Composer 外壳与内部 textarea 同时描边形成“双框”；复古规则只覆盖 `.kimix-toolbar-button` / `.kimix-icon-text-button`，导致输入区部分按钮风格化、部分仍扁平；侧栏和 ContextBar 仍使用现代平面语言，局部 Platinum 控件像外贴皮肤。
- 修复改为按组件角色接入：Composer 只有外壳拥有边界和 focus，所有二级工具/模式键统一轻凹面，发送/引导/停止保留圆形主操作；ContextBar 统一为连续控制带；侧栏项目/会话显式 active class 使用同款内框与主题刻度；标题栏增加唯一的极淡 Platinum 横向细纹，其他表面保持克制。
- 稳定边界写入 `/architecture/interface-style-system.md`：颜色主题拥有颜色，界面风格只拥有形状/质感；禁止全局按钮、textarea 和基础 primitive 铺皮肤。
- 验证：定向 2 文件 10 项、全量 152 文件 1454 项测试、Node/Renderer typecheck、生产构建（renderer `assets/index-DHUUXMwX.js`）、OKF strict/spec/audit 校验（12 concepts、370 links）通过；本机开发窗口已重启为 v2.20.93，视觉验收待用户截图确认。

## 2026-08-01 重做：复古风格转向 Classic Mac OS Platinum（v2.20.92）

- 用户截图反馈 v2.20.91 的 Win95/98 全局直角与双边框只顾风格化、整体不美观。参考 1997 Mac OS 8 Human Interface Guidelines 与 Classic Mac OS 8/9 Platinum，复古风格改为小圆角、薄边界、轻微顶高光和仅用于交互控件的克制层次，不再让所有内容卡片承担强浮雕。
- 界面风格与颜色主题保持正交：复古规则不覆盖 `surface`、`text`、`accent`、`border` 颜色 token，新增源码门禁防止风格预设重新接管配色。
- 验证：全量 152 文件 1453 项测试、Node/Renderer typecheck、生产构建（renderer `assets/index-RSanmFOM.js`）、OKF 校验（365 链接）通过；本机开发窗口已重启为 v2.20.92，视觉验收待用户截图确认。

## 2026-07-31 整理：TASK_STATE 早期记录归档至 TASK_HISTORY.md

- TASK_STATE.md 从 6424 行精简至约千行；2026-06-11 至 2026-07-19（含原尾部乱序的 07-06/07-10 交接块）移入 TASK_HISTORY.md，仅搬运未改写；尾部乱序的 07-25 条目已摘回本文件 07-25 条目群。

## 2026-07-31 功能：模型表单选中后展开 + 设置头部默认模型标注（v2.20.75）

- 模型与供应商页不再默认选中首个/默认模型、不再默认显示编辑卡片；点击模型行显示编辑卡片，“添加模型”按钮或探测结果选择才展开添加表单（新增 addingModel 显式状态）；保存/删除/切换供应商联动已同步。
- 设置页头部默认模型名加“默认模型”前缀。
- 验证：定向 10/10、全量 146 文件 1423 项、typecheck、生产构建（index-CW7cifKd.js）通过。提交 f740d5ad。

## 2026-07-31 修复：发送-回复全链路缺陷集中修复（v2.20.74）

- 背景：四路子代理审查 + 另一 agent 报告交叉核实，落地 22 项修复；2 项排除：currentStep || 1 经核实 Step 从 1 编号、0 为未开始哨兵，现状正确（三处已加防再犯注释）；compaction 卡片位置为测试锁定的刻意设计。
- 要点：长程任务 updateState schema 补 recovery（.strict() 下全量持久化失败，P0）；Server 审批/提问 snake_case 字段映射；targetStep 未知不宣称最终步；子代理名首个具体名获胜；正文区/过程流按 computeFinalTextBlockIndex 块 key 对齐；队列失败重排队首；active-turn 失败回补队列；发送成功显式落盘；房间终态清身份；retry 保留 contextShare；queued 投递随已加载房间恢复。
- 验证：全量 146 文件 1422 项、typecheck、生产构建、OKF 校验通过。提交 a9c870e9、d6b25e6e。
- 后续专项（已知边界，本轮未动）：两套队列派发实现统一（App.tsx 约 1896 vs 3152）；Server 成功轮无事件级终态兜底；context.append_loop_event 在 mapStreamEvent 的触发面核实；echo 去重窗口调优。

## 2026-07-28 修复：流程富文本异常空行（v2.20.47）

- 用户用 v2.20.46 复验后，Markdown 语义已正确，但段落和列表之间出现远多于官方的空白行。
- 根因：流程正文容器复用了原始思考文本的 `KIMI_WEB_THINKING_SUMMARY_STYLE`，其中 `whiteSpace: pre-wrap` 会把 ReactMarkdown 在段落、列表及 loose-list `<li><p>` 之间生成的 HTML 分隔换行也渲染出来；再叠加正常 Markdown margin 后形成异常大间距，并非解析器错误或源内容包含大量空行。
- 修复：仅在 `KimiWebIntermediateTextBlock` 覆盖为 `whiteSpace: normal`，让 Markdown 元素自身管理段落与列表间距；思考原文继续保留 `pre-wrap`，最终正文、工具卡和全局 Markdown 样式不变。
- 验证：定向流程正文与 Markdown 回归 2 文件 4 项、全量 135 文件 1330 项、Node/Renderer typecheck、生产构建（renderer `assets/index-CF3n4vEJ.js`）、OKF 校验（355 链接）均通过。

## 2026-07-28 修复：流程内正文恢复富文本渲染（v2.20.46）

- 用户对照官方 Kimi Code 后反馈：过程流里的正文原样显示 `**`、`-`、反引号等 Markdown 标记，而官方会渲染为粗体、列表与行内代码。
- 根因：`KimiWebIntermediateTextBlock` 在 v2.20.36 调整正文层级时仍直接输出字符串，绕过了项目已有的 `MarkdownRenderer`；此前 v2.20.35 的富流式修复只覆盖底部 Assistant 正文，因此流程内文本形成了独立缺口。
- 修复：流程正文统一接入 `MarkdownRenderer`；仅活动轮次中仍在增长的末位文本组启用现有 300ms 节流富流式路径，已结束的中间文本立即使用完整 Markdown，且不恢复折叠、不改变思考/工具卡的展开行为。
- 验证：定向组件与 Markdown 回归 2 文件 4 项、全量 135 文件 1330 项、Node/Renderer typecheck、生产构建（renderer `assets/index-CPvnb_d0.js`）、OKF 校验（354 链接）均通过。

## 2026-07-28 修复：更新记录移除日期显示（v2.20.45）

- 用户反馈：本体卡「最新可安装」后的发布日期换行难看，且 Release 条目行的日期也不需要。移除两处日期显示（版本行与 Release 条目行），formatReleaseDate 不再被该面板使用。
- 验证：全量 130 文件 1329 项、Node/Renderer typecheck、生产构建（renderer assets/index-BFXlsQoL.js）、OKF 校验（353 链接）、git diff --check 通过。
## 2026-07-28 修复：旧流式重复未被 v2.20.43 完整清理（v2.20.44）

- 用户用 v2.20.43 复验后，旧会话仍显示两份相同 IPC 思考/正文。安装版 IndexedDB 实证剩余 2425 个事件、6 组完整语义重复，以及同一 delivery 下 19 份正文相同但思考不同的历史草稿。
- v2.20.43 缺口：只比较多个 `active-draft:` 的完整 payload，并把 `thinkingParts` 碎片结构纳入指纹；未覆盖“身份完整实时事件 + 身份缺失 canonical 镜像”，也不能在保留不同思考的同时移除重复正文。此外 hydration 修复后的 session 被误标为已持久化，清理未保证写回 IndexedDB。
- 修复：同一去重后用户轮次内按规范化正文+完整思考识别有界实时/canonical 镜像，不受 parts 分片数量影响；后续同 delivery active draft 只回放旧正文时清空正文、保留独立思考；跨轮、跨 delivery、跨 Agent 和普通不同时间 identity-less Assistant 均保留。修复 session 在 pending hydration 后单独标脏并增量持久化。
- 根因快照：`docs/issue-active-draft-offset-zero-replay-duplication-snapshot.md` 已补充 v2.20.43 缺口和 v2.20.44 规则。
- 验证：定向 eventMapper + persistence 191 项、全量 134 文件 1329 项、Node/Renderer typecheck、生产构建（renderer `assets/index-D6HBGrg2.js`）、OKF 校验（353 链接）均通过。真实目标会话重载后 IndexedDB 事件 2425→2404，完整语义重复组 6→0、同轮重复正文组 19→0，且清理结果已持久化。

## 2026-07-28 修复：流式草稿回放被重复物化（v2.20.43）

- 目标会话官方 wire 中，截图所示英文思考与中文进度都只出现一次；当前源码从真实 wire 投影也只有一份。安装版 IndexedDB 却有一个 Assistant 内两份完全相同的 3012 字 thinking part，以及同一 Agent turn 下 16 个不同 `active-draft:` ID、正文完全相同的 51 字进度事件，确认是 Kimix 本地解析/持久化重复。
- 根因：Server 0.29 offset 是 turn-global；工具边界提交可视草稿后 accumulator 为空但 anchor 保留，重连的 `offset=0` 旧前缀却被当作新视觉片段，持续生成新 materialization。另有 thinking parts 合并在 existing 为空时绕过了 incoming batch 内部去重。
- 修复：挂载中的流仍允许 `offset=0` 重启替换；已提交且 anchor 保留时拒绝该旧前缀回放，不创建草稿。thinking parts 始终经过幂等合并；hydration 仅清理同 room/message/turn 下正文与思考完全相同的 `active-draft:` 协议产物，不对普通 Assistant 或跨轮同文做全局去重。
- 根因快照：`docs/issue-active-draft-offset-zero-replay-duplication-snapshot.md`。
- 验证：定向 2 文件 188 项（含协议回放、批内重复、旧数据修复、跨轮同文保留和无身份事件保留）、全量 134 文件 1322 项、Node/Renderer typecheck 通过；生产构建（renderer `assets/index-B-B-o6zF.js`）、OKF 校验（352 链接）通过。

## 2026-07-28 修复：更新记录版本格式统一与模型探测代理兼容（v2.20.42）

- 用户反馈两点：①「更新记录」里 Kimix 本体卡版本行（最新版本：…）与 Kimi Code 卡（当前：…· 最新可安装：…）格式不一致，要求统一；②第三方供应商 Base URL 为本地代理（127.0.0.1:15722）时模型探测报 404 失败，询问是否代理转发所致、能否兼容。
- 修复①：本体卡版本行改为「当前：{appInfo.version} · 最新可安装：{tagName} · {发布日期}」，与 Kimi Code 卡同构。
- 修复②：确认代理只实现 /chat/completions、不实现 /models（两个候选端点均 404「Models endpoint is not available」）。新增 ModelListEndpointUnsupportedError（全部候选均 404 时抛出，区别于真实连接/凭据失败），主进程转换为 { unsupported: true } 结构化结果，前端显示「该 Base URL 未实现模型列表接口（部分代理转发不提供 /models），连接本身不受影响，可手动添加模型」——不再显示「模型探测失败」。
- 验证：相关 6+8 项、全量 130 文件 1316 项通过；Node/Renderer typecheck、生产构建（renderer assets/index-DnPBr9lX.js）、OKF 校验、git diff --check 通过。待用户截图复验。
## 2026-07-28 修复：官方 Web 会话模型被全局默认覆盖、自动压缩失败无提示（v2.20.42）

- 目标会话事件流证明：进入 Kimix 前最近 20 轮均为官方 `kimi-code/k3`；Kimix 恢复会话时没有等待/返回官方 `/status.model`，恢复后的本地状态因而回退到全局默认 `opencode-go/deepseek-v4-pro`，发送路径再将该别名写回官方 profile。
- 官方 daemon 随后用被覆盖的代理模型执行自动压缩：原始 1028 messages 返回 413，丢弃 246 条后的 782 messages 重试返回 400，最终写出 `full_compaction.cancel`。自动压缩算法与请求完全属于官方逻辑，Kimix 只负责事件转发和显示。
- 修复：Server 会话注册在返回前完成一次官方 status hydration，并将模型随恢复结果返回；全局默认模型只用于新会话，恢复已有会话时仅显式 `request.model` 才允许修改官方 profile。自动压缩 `source:auto` 会传递到无 source 的终止事件，并显示持久的“自动上下文压缩失败”提示；手动取消仍显示普通取消。本轮按用户要求不新增首 token 等待提示。
- 根因快照：`docs/issue-web-session-model-compaction-events-snapshot.md`。
- 验证：定向 3 文件 228 项、全量 134 文件 1313 项、Node/Renderer typecheck、生产构建（renderer `assets/index-C0XkYdvZ.js`）、OKF 校验（351 链接）和 `git diff --check` 均通过。待用户安装版截图复验。

## 2026-07-27 修复：恢复后任务卡退化为工具卡（v2.20.41）

- 用户 v2.20.40 实测：重新加载会话后单次 Agent 委派显示为「1 个工具调用」而非任务卡。CDP 实证：持久化记录里 Agent tool_call 仍在（toolCallId、arguments 含 description/prompt/subagent_type），但 subagent 事件整体消失。
- 根因：subagent 事件只来自实时帧（subagent.started 等）；快照回放（snapshotMessagesToServerFrames）不发 subagent 帧（快照里有 subagents 字段但未被映射），mapHistoryEvents 也无法从官方 /messages 重建。记录被规范历史替换后 subagent 事件丢失，Agent 调用走「未匹配回退」变成普通工具块。
- 修复（显示层合成，零数据迁移）：buildTurnBlocks 对 settled（success/error）且未匹配的 Agent/Task/AgentSwarm 调用，用工具自身合成 subagent 块（description/agentName 取自 arguments，resultSummary/error 取自工具 result，key 稳定）——所有恢复路径自动生效。running 的未匹配调用不合成（live 安全：等真实 subagent 事件到达再吸收，避免中途 remount）。旧测试「未匹配 Agent 回退为普通工具块」钉住的正是该缺陷，已更新为新预期。
- 验证：相关 34 项、全量 130 文件 1309 项通过；Node/Renderer typecheck、生产构建（renderer assets/index-BKtuOdvp.js）、OKF 校验（349 链接）、git diff --check 通过。待用户截图复验（重载会话后应显示任务卡）。
## 2026-07-27 功能：单次委派渲染为「任务」卡（v2.20.40）

- 用户对比截图指出：官方单次 Agent 委派是「任务」卡（主内容为完整委派 prompt，子代理类型作标签，内部活动收进查看/状态行），Kimix 一律标「Swarm」且只显示进度条+子代理行、prompt 不可见。经运行会话实证：Agent 工具 arguments 含 description/prompt(1305 字)/subagent_type，数据现成。用户拍板：单个叫任务，多个仍叫 Swarm。
- 实现：groupTurnBlocks 迁入 turnBlocks.ts 并让 subagent 组按索引保留派发 Agent 工具（含 prompt）；新增 KimiWebTaskCard——头部「任务 · 描述 + 子代理类型 + 状态」（运行中默认展开），展开体显示完整委派 prompt + 子代理内部活动（复用 KimiWebSubagentDetails）+ 完成后的 resultSummary / 失败的 error；两个渲染分派点（TurnBlocksProcessGroup、KimiWebProcessGroup）均按 subagents.length===1 走任务卡，多个保留 Swarm 组卡（进度条、0/N）。
- 验证：相关 31 项、全量 130 文件 1306 项通过；Node/Renderer typecheck、生产构建（renderer assets/index-DIqAgfCw.js）、OKF 校验（349 链接）、git diff --check 通过。待用户截图复验。
## 2026-07-27 功能：归档面板对齐官方新版 UX（v2.20.39）

- 用户要求对照官方新版「已归档会话」面板优化 Kimix 归档区（先只读分析后实施）。关键发现：用户截图的官方客户端比仓库 v1.49.0 克隆新，克隆里只有侧栏 Archived 折叠区；截图版有搜索/工作区筛选/三种排序/分组计数/归档时间。Kimix 现状：平铺列表无时间无搜索，计数徽标为官方+本地直接相加（有重复虚高），archivedAt 实为 updated_at（Server 0.29.1 无 archived_at 字段）。
- 实施（纯客户端，无需服务端配合）：①搜索框（标题+项目路径，大小写不敏感）；②排序切换（归档时间/创建时间/按字母，默认归档时间）；③按 projectPath 工作区分组+组计数，组按最新归档时间排序、无路径归「其他」置底，另有「所有工作区」筛选下拉；④每项显示时间——本机归档过的显示真实「归档于」（本地 Session.archivedAt），其余如实显示「最后活动」，不再把 updated_at 冒充归档时刻；⑤徽标改为官方∪本地按 id 去重；⑥恢复成功后状态条提供「打开该对话」（切到对应项目并选中会话、关闭设置）。
- 逻辑抽取为纯函数 src/utils/archivedSessions.ts（filter/sort/group/dedupe/时间格式化），8 项单测。本地归档记录子区保持独立不动。
- 验证：相关 8 项、全量 130 文件 1304 项通过；Node/Renderer typecheck、生产构建（renderer assets/index-B6K5_Ojz.js）、OKF 校验（348 链接）、git diff --check 通过。待用户截图复验。
## 2026-07-27 修复：熔断指纹补 thinking/图片字段（v2.20.38）

- 用户转来一份 9 项代码审查结论要求逐条核实。三项并行核查后的裁决：#1 部分属实（真漏洞在指纹未覆盖 thinkingHistorySize/displayableUserImageCount，且知识库描述过期）；#2/#3/#7 不属实；#4 机制属实但零触发；#5 数值有误（已有全局 3s 节流）；#6 理论成立现实自愈；#8 属偏好；#9 有备份兜底、低优先级。用户批示按表处理：只修 #1，顺手补 #4 文档。
- 修复 #1：computeFingerprint 增加 thinking 历史大小与可显示用户图片数（与拒绝门判定字段一一对应，canonical 补回任一者即翻转指纹放行重试）；STORAGE_KEY 升 v6；知识库 Invariant B 的过期描述（v1/timestamp）同步纠正；新增 2 条回归测试。
- 修复 #4（文档）：Invariant A 补一句「store 的 Session 永不就地修改，逐会话跳过按对象引用判等」。
- 其余项按裁决不动：#2（算法可证正确且已有注释）、#3（Invariant J + 测试锁定）、#5（可选逐会话退避，不紧迫）、#6（如需彻底消除应给 offset-0 重启的 draft 打标记而非前缀 guard）、#7（函数内部已按跃迁节流）、#8（要拆就整段 KimiWeb* 一起拆）、#9（窄边界，可选 warn）。
- 验证：相关 14 项、全量 130 文件 1296 项通过；Node/Renderer typecheck、生产构建（renderer assets/index-PNM5eRwR.js）、OKF 校验（348 链接）、git diff --check 通过。
## 2026-07-27 功能：末段文本流内流式、settle 单份归位（方案 C，v2.20.37）

- 用户就「最终正文定义」拍板方案 C：运行中所有文本（含末段）在流内原地流式渲染，settle 时最终段归位正文区，且归位时不得流内一份、正文区一份。用户认可该方向优于候选规则（过渡句搬进搬出）。
- 实现：① TurnBlocksTimeline 只在 hasFinalContent（settle）时跳过末位文本组——运行中末段文本在流内原位置渲染；② mergeLiveDraftBlocks 把 draft 尾巴接入流内块（无 thinking 间隔时前缀安全续接正式尾块，有 thinking 时按 think→text 线序追加新块，key 与正式提交对齐复用 DOM）；③ 过程区折叠（默认运行中折叠）时流内不可见，此时正文区保留候选流式（v2.20.29 路径），展开时正文区留空——任何时刻只有一份可见；④ settle 后正文区接管最终段，流内跳过，无重复。
- 验证：相关 54+39 项、全量 130 文件 1294 项通过；Node/Renderer typecheck、生产构建（renderer assets/index-CvIf_GTK.js）、OKF 校验（347 链接）、git diff --check 通过。待用户实测复验（重点：过渡句不再搬进正文区、settle 归位不重复、折叠/展开两态都只有一份）。
## 2026-07-27 分析：最终正文定义差异；修复：中间段正文主文本色（v2.20.36）

- 用户实测两点：①中间段总结句被当候选最终正文渲染进正文区，要求先分析——结论：官方没有「最终正文区」概念，全部内容平坦流内原地渲染，最终答案只是流中最后一条 text；Kimix 的正文区/过程区分层是自有产品决策，截图中的「先出现再搬走」是 v2.20.29 候选规则的固有副作用（总结句→工具是最高频过渡）。可选方向 A 保持现状 / B 回到 settle 才显示（已否决）/ C 运行中全部流内渲染、settle 时最终段归位正文区（推荐，贴近官方）/ D 彻底取消正文区（不建议本轮）。用户要求本轮只分析，暂不动。
- ②官方中间段正文是黑色主文本、不可点击、全段展示；我们此前是次要灰（与思考同色）。修复：KimiWebIntermediateTextBlock 改为主文本色（--kimix-panel-text），保持不可点击与全段展示，层级与官方一致（思考灰、正文黑）。
- 验证：全量 130 文件 1289 项、Node/Renderer typecheck、生产构建（renderer assets/index-C35qhmVX.js）、OKF 校验（346 链接）、git diff --check 通过。待用户截图复验。
## 2026-07-27 功能：流式期间富 Markdown 渲染（v2.20.35）

- 用户实测反馈：流式期间正文区显示原始 Markdown 符号（##、**、反引号），长最终答案全程都是原始内容；官方 kimi web 流式即渲染。用户建议按间隔渲染而非每 token 渲染。
- 结论：仓库里早已存在块级 memo 的富流式渲染器（StreamingRichMarkdown，Lexer.lex 分块 + 每块 memo 的 ReactMarkdown），只是默认走了纯文本路径。残剩成本是全内容 lex/normalize（每修订一次）和增长的尾块重渲染。
- 修复：① 默认切换到富流式路径（新增 shouldUsePlainStreamingMarkdown 解析：仅当用户显式 plain=1 或 rich=0 时回退纯文本，新 flag kimix_streaming_rich_markdown 默认开）；② 新增 useThrottledStreamingContent，可见内容按 300ms 节拍前进、滚动中暂停推进（150ms 复查）、settle 立即同步全量——把全内容 lex/normalize 与尾块渲染压到每秒几次而非每 token。不完整 Markdown 的瞬态（未闭合加粗/围栏）随下一拍自愈，settle 后仍由完整渲染接管。
- 验证：相关 7 项、全量 130 文件 1289 项通过；Node/Renderer typecheck、生产构建（renderer assets/index-RJdoYdU-.js）、OKF 校验（346 链接）、git diff --check 通过。待用户实测复验（重点：长答案流式期格式是否渐进渲染、滚动是否依旧流畅）。
## 2026-07-27 修复：最终正文流式输出（v2.20.29）

- 用户实测反馈：过程内容（思考/工具）已经流式，但最终正文在回合结束时一瞬间全部吐出，观感像卡住。要求最终正文也流式，并先分析根因、确保改动安全稳定。
- 根因（三条规则叠加）：① computeFinalTextBlockContent 在未 complete 时返回空（turnBlocks.ts:210，刻意扣留最终段）；② TurnBlocksTimeline 总是跳过末位文本组（为正文区保留），于是流式期间末段文本在过程区也不可见；③ resolveHasFinalProcessContent 要求 complete 且非 active，正文区只在 settle 后点亮——于是最终答案在模型撰写期间完全不可见，结束时一次出现。
- 修复（trailing 候选正文流式上屏）：新增 computeStreamingTrailingTextContent——末位 text 块在没有任何 tool/subagent/approval/question 跟随其后时即为候选最终正文（thinking 阶段不降级，避免 think/text 交替闪烁）；active 期间正文区流式渲染「正式末段 + draft 未提交尾巴」（appendStreamingText 前缀安全拼接，提交点天然互斥）。一旦工具/子代理/审批/提问落在文本之后，该段自动回到过程区（既有跳过逻辑自然接管），settle 后由既有 finalTextBlockContent + 完整 Markdown 接管。legacy 无 turnBlocks 路径原本就流式，不受影响。
- 取舍说明（已告知用户）：text→tool 过渡短句会先在正文区流式、工具启动后收回过程区——这是保留「正文区/过程区」分离结构的固有代价，换来最终答案全程可见；官方无正文区分离因此无此问题。
- 验证：相关 25 项、全量 130 文件 1282 项通过；Node/Renderer typecheck、生产构建（renderer assets/index-CJofiutt.js）、OKF 校验（345 链接）、git diff --check 通过。待用户实测复验。
## 2026-07-27 修复：重试/新轮 WS 静默后 30 秒成批补输出（v2.20.33）

- 用户在 v2.20.32 实测：重试能真实启动，但新一轮“正在思考 32秒”后才一次出现正文、思考和工具块，回归到此前修过的 30 秒批量补历史症状。
- 三层快照确认：prompt 在 `02:16:38.484` 接受并立即重连，官方 Assistant 在 `02:16:38.486` 已落盘；新 WS 只收到 seq=150 snapshot，renderer 到 27 秒仍正文为 0；`02:17:08.983` 的 30 秒 `running-sample` 才把 local size `42,983` 补到 `43,019`。
- 根因：接受后基线可能已越过 1ms 内落盘的首个 Assistant；watchdog 把状态心跳也当实时进度；会话 hydration/reconciliation 还会短暂产生同一 room/Agent 的重复 store 项，owner 查询误判为多归属并丢弃已经收到的 `thinking.delta` / `assistant.delta`。
- 修复：已有订阅在 Prompt POST 前重建；接受后保留 prompt-specific “尚未看到输出”标记，并以 1.5 秒短探针读取当前 prompt 的最近消息增量后再重连；只有正文/思考/工具等真实进度刷新静默时钟。runtime owner 按 `roomId + roomAgentId` 去重，同一 owner 的重复数组项不再触发歧义，不同 owner 冲突仍拒绝路由。
- 回归：定向 2 文件 78 项、全量 131 文件 1278 项、Node/Renderer typecheck、生产构建、OKF 校验通过。
- 真实目标会话验收：`02:47:32.361` 官方开始模型请求，`02:47:41.544` 首个思考增量进入当前 turn，`02:47:42.448` 正文开始流入，`02:47:43.007` 以 23 字完整正文结束；该轮 `kimiRuntimeOwner.ambiguous=0`，没有等 30 秒 running-sample 才显示。

## 2026-07-27 修复：错误卡“重试上一条”虚假成功（v2.20.32）

- 用户在 `session_cc972967-b75e-4f8d-a834-1fb615ec8ada` 点击错误卡“重试上一条”后，界面显示“已重新发送上一条消息”，但没有新一轮。
- 运行时快照确认：该会话 `collaboration=null`，但普通会话的统一事件 scope 仍带 `roomMessageId/roomAgentId`。旧 UI 仅凭这两个字段误走协作房间事件；监听器发现不是协作房间后直接返回，而发出自定义事件的 Promise 已提前成功。
- 修复：房间重试必须同时满足会话确实存在 `collaboration`；普通会话稳定走 `retryLastUserMessage`。协作房间事件桥接增加完成回执与 60 秒上限，等待持久化和指定 Agent 的真实派发结果后才显示成功；失败、无人处理和超时均保留错误态。
- 回归：覆盖“普通会话带 room scope 仍走普通重试”“真实房间才走投递重试”，以及房间回执成功、派发失败、无人响应超时；定向 2 文件 23 项、全量 131 文件 1274 项、Node/Renderer typecheck、生产构建（renderer `assets/index-MJYnDxu_.js`）、OKF 342 链接和 `git diff --check` 通过。
- 真实目标会话验证：内置产物窗口显示 v2.20.32；点击原错误卡后新增重试用户事件（索引 1563），主进程记录 `prompt accepted → refresh live subscription`，随后落盘新的 Assistant、tool_call 和 status 事件（索引 1565–1572），界面显示“正在思考/运行中”，证明不是只改按钮文案。

## 2026-07-27 修复：完整过程恢复后耗时缩短为首段耗时（v2.20.31）

- 用户复验 v2.20.30：思考与工具可展开，但完成头从此前正确的 `7分58秒` 变成 `4分29秒`。
- 精确证据：官方 wire `turn.prompt=1785069209683`，最终 `content.part/step.end=1785069687392`，整轮为 `477,709ms`，按统一格式化规则显示 `7分58秒`。恢复后的 mapped final Assistant 同样保存 `durationMs=477709`。
- 根因：`mergeAssistantProcessEvents` 合并多段 Assistant 时取第一个可靠 `durationMs`；第一过程段为累计 `269,463ms`（`4分29秒`），错误覆盖了最终段与 user→final 派生的完整耗时。
- 修复：合并过程段使用最大可靠累计 duration；渲染投影再与排除迟到 status/派生事件后的 user→实际过程终点耗时取最大值。单段、流式、canonical 恢复和迟到状态过滤逻辑不变。
- 回归：新增“首段 269,463ms、最终段 477,709ms 时必须显示整轮 477,709ms”；定向 3 文件 114 项、全量 130 文件 1269 项、Node/Renderer typecheck、生产构建（renderer `assets/index-DrvsZbdP.js`）、OKF 341 链接和 `git diff --check` 通过。
- 真实目标会话验证：v2.20.31 DOM 顶部显示 `本轮总耗时 7分58秒`；过程头仍为 button，点击后思考/工具过程可见，493 字最终正文首尾仍完整。

## 2026-07-27 修复：缺失轮次恢复后过程流不可展开（v2.20.30）

- 用户复验 v2.20.29：493 字 1.4.486 最终正文与 `7分58秒` 已正确，但最新轮没有可展开的思考和工具调用。
- 新快照确认：目标 IndexedDB 最新轮只有“用户 + 最终正文”两条；用户边界之前仅有 25 条属于该轮的迟到 status，思考和工具并未恢复。官方 canonical 最新轮则有 114 条原始事件，包含 33 ContentPart、26 tool.call、26 tool.result、24 StatusUpdate。
- 根因：v2.20.29 把“缺失用户边界”误当作“缺失最终正文”，只追加用户与最后 Assistant；旧轮历史虽被保护，但新轮过程尾部没有原子恢复。
- 修复逻辑：全量历史仍保守拒绝；对严格更新且本地缺失的用户轮，若本地只有被动残片，则原子采用该轮 canonical 尾部（用户、思考、工具、状态、最终正文），不触碰任何旧轮；若本地已有更丰富的可见过程，则把这些残片重锚到新用户之后并只补最终正文，绝不以更薄 canonical 覆盖。对 v2.20.29 已形成的“用户 + 正文”尾轮自动升级为完整 canonical 过程尾部；circuit key 升 v5。
- 回归：覆盖完整过程尾部恢复、v2.20.29 数据形态升级、较丰富本地残片保留与重锚、幂等；定向 3 文件 113 项、全量 130 文件 1268 项、Node/Renderer typecheck、生产构建（renderer `assets/index-jvKGL8Xi.js`）、OKF 340 链接和 `git diff --check` 通过。
- 真实目标会话验证：最新用户已从索引 1503 重锚到 1478，其后恢复 76 条 mapped events，包含多段 thinking、26 个 tool.call/tool.result 对应的工具过程、状态和 493 字最终正文；折叠头恢复为可点击 button，实际点击后 DOM 出现思考文本、中间正文与「N 个工具调用」卡片。

## 2026-07-27 修复：最新轮次边界与最终正文缺失、耗时异常（v2.20.29）

- 用户在 `session_cc972967-b75e-4f8d-a834-1fb615ec8ada` 截图反馈：最新轮只剩「全量 970/970 全绿…」一句，完成头误显示 `102分41秒`。
- 用户补充官方截图后确认：期望正文是更新一轮的 493 字 `1.4.486 发布闭环完成…`，并非本地尚存的 721 字 1.4.485 总结。
- 根因快照 `docs/issue-late-stable-snapshot-final-body-events-snapshot.md`：官方 wire 与 canonical loader 均有最新用户边界和完整 1.4.486 正文；本地 IndexedDB 漏掉两者、只收到该轮状态。全量 canonical 因 process history 较少被保守拒绝，旧加法恢复又只支持同一最新用户，无法自愈。旧轮内部还存在较早稳定快照迟到覆盖正文，以及被动状态延长耗时两个投影问题。
- 修复保持流式链路不动：canonical 最新用户严格晚于本地、在本地不存在且其后有非空最终正文时，只追加该用户边界与最终 Assistant；不替换旧工具/思考历史。reconcile circuit 升 v4。完成态正文按 Assistant 时间选择（同毫秒按数组后项）；耗时排除 status、usage 与 diff/change/todo 等被动投影。
- 回归：新增“严格更新用户轮边界与最终正文恢复/幂等”，并保留不同用户同时间、旧 wire 尾段拒绝；连同正文选择和耗时用例，定向 3 文件 111 项通过。
- 验证：定向 3 文件 111 项、全量 130 文件 1266 项、Node/Renderer typecheck、生产构建（renderer `assets/index-DO5z9T8l.js`）、OKF 339 链接及 `git diff --check` 通过。日常构建窗口 v2.20.29 的目标 IndexedDB 已恢复最新用户 + 493 字最终正文；DOM 首尾正文均可见，耗时为 `7分58秒`，不再出现 `102分41秒`。

## 2026-07-26 修复：流内提问卡与工具卡同款样式（v2.20.28）

- 用户 v2.20.27 截图反馈：落进过程流的提问用的是独立的交互大卡片（需要你确认一下/已提交），与周围工具卡样式不一致；官方的流内提问是与工具卡一致的折叠组卡（头部「提问 · 1 个回答」，展开看问题与选项、所选打勾）。
- 修复：新增 KimiWebQuestionGroupCard，完全复用工具/审批组卡的视觉令牌（kimix-soft-card、8px 12px 头部、14px 图标、右侧状态+chevron）；展开后按「问题 + 选项列表」渲染，已提交答案打勾高亮、其余置灰，自定义答案同样列出。答案读取规则与 QuestionCard 一致（先按问题文本、再按问题 id）。pending 的独立交互卡保持不变。
- 验证：全量 130 文件 1262 项、Node/Renderer typecheck、生产构建（renderer assets/index-JdBmnWrt.js）、OKF 校验（338 链接）、git diff --check 通过。待用户截图复验。
## 2026-07-26 修复：中间正文段不再折叠（v2.20.27）

- 用户 v2.20.26 截图反馈：过程流里的中间正文段（如「尸气专项测试和 analyze 已通过…改动范围确认一下…全绿后走 1.4.486 发布流程。」）被默认折叠成尾段摘要，官方则全段直接展示。
- 官方对照（kimi-code web 仓库 assistant-message.tsx）：正文消息经 MessageResponse 全量渲染，没有任何折叠/截断/行数豁免；可折叠的只有 reasoning（标签式）和工具卡。即官方对中间正文没有「豁免逻辑」——它从不折叠。
- 修复：KimiWebIntermediateTextBlock 删除折叠逻辑（段落判定、teaser 按钮、展开态），始终全量渲染。思考的落盘折叠（resolveSettledThinkingFold）保持不变——那是用户已验收的摘要+可展开设计。
- 验证：全量 130 文件 1262 项、Node/Renderer typecheck、生产构建（renderer assets/index-_cTNCM5q.js）、OKF 校验（338 链接）、git diff --check 通过。待用户截图复验。
## 2026-07-26 修复：已回答提问落盘进过程流（v2.20.26）

- 用户 v2.20.25 截图反馈：已回答的提问卡片（需要你确认一下/已提交）挂在消息最末尾（消息处理中之后），官方则按提问发生的位置落在过程流中间。
- 原因：buildTurnBlocks 只处理 approval_request（pending 跳过），没有 question_request 分支；ChatThread 把提问事件一律渲染为 assistant 气泡之后的独立行。
- 修复（完全镜像 resolvedApprovals 既有模式）：buildTurnBlocks 新增 question 块（pending 跳过）；TurnBlocksTimeline 按流内位置用 QuestionCard 渲染；ChatThread 对已回答/已跳过的提问折叠进过程流，只有 pending 保持独立可交互卡片；turnBlocksEqual 补 question 分支。
- 验证：相关 2 文件 37 项、全量 130 文件 1262 项通过；Node/Renderer typecheck、生产构建（renderer assets/index-D62AKiHN.js）、OKF 校验（337 链接）、git diff --check 通过。待用户截图复验。
## 2026-07-26 修复：思考阶段落盘摘要与失败工具打叉（v2.20.25）

- 用户 v2.20.24 截图反馈两点：①已走完的思考阶段（后面已跟正文/工具卡）仍挂五行滚动区，没有落成官方那样的摘要；②失败的工具调用（官方 is_error=true，如 Grep 路径不存在）在 Kimix 显示绿色对勾，官方显示叉并标「有失败」。
- 证据：官方 /messages 的 tool_result 内容分片带 `is_error: true`（msg_…_000767「Failed to grep: rg: … (os error 2)」）；Kimix 三条摄入路径（live WS 映射、快照回放、native/SDK 历史）都只取 output，丢失失败标记，merge 层永远落 success。
- 修复①：shouldUseLiveThinkingViewport 只对**最后一组**（仍在生长的）思考阶段启用五行实时视口；已走完的阶段按 resolveSettledThinkingFold 落盘为尾部摘要、可点击展开全文。
- 修复②：is_error 全链路透传——kimiCodeEventMapper/electron 快照回放/eventMapper(native+SDK) 提取到 ToolResultEvent.isError，mergeEvents 据此把关联 tool_call 落为 error；UI 行内图标改为 ✗（accent-danger），工具组头显示「有失败」并不再给整组绿勾。
- 验证：相关 4 文件 262 项、全量 130 文件 1260 项通过；Node/Renderer typecheck、生产构建（renderer assets/index-B5i0hR0u.js）、OKF 校验（336 链接）、git diff --check 通过。待用户截图复验。
## 2026-07-26 修复：落盘思考可展开、完成闪烁与正文乱序（v2.20.24）

- 用户 v2.20.23 GIF 验收反馈三点：长思考落盘后变成固定不可点开的块；思考完成瞬间闪烁一次（消失又出现）；工具前正文「霖江路。你好我来查…」乱序（应为「你好霖江路。我来查…」）。
- 乱序根因快照（docs/issue-body-fragment-inversion-events-snapshot.md）：diag.log 帧级日志证明服务端按正确顺序发送（dlen 2→4→22→19，均无 offset），且持久化终态正确（完成屏障已修复）——乱序只发生在渲染层提交路径：按 turn 过滤的 draft 提交可越过更老的同房间身份代 draft；提交段也无条件 prepend 到 batch 头部，排到更早到达的 formal 事件之前。
- 修复①乱序：commitActiveTurnDraftsToBatch 按 draft 首帧时间戳排序提交；turn 过滤提交自动带上更老的同房间 draft；段插入 batch 时不越过更早到达的 assistant 项，同时保持在触发边界之前。
- 修复②落盘思考：新增 resolveSettledThinkingFold——多段思考取尾段为摘要（原行为），单段长文（>5 行或 >200 字符）取最后一非空行为摘要，点击展开全文；短思考保持原样。
- 修复③闪烁：authoritative body 帧不带 thinking 时不再整体清空 draft，改为先提交仅含 thinking 的段；live 思考块 key 与该段正式提交后的 turnBlocks 组 key 对齐（thinking:active-draft:<key>:<materializationId>），live→formal 切换复用 DOM 不再卸载重挂。
- 验证：全量 130 文件 1256 项通过；Node/Renderer typecheck、生产构建（renderer assets/index-zyWUUe1_.js）、OKF 校验、git diff --check 通过。待用户 GIF 复验。
## 2026-07-26 修复：实时思考草稿未进入五行滚动区（v2.20.23）

- 用户 v2.20.22 动图对比：Kimix 仍在工具边界处整段跳出思考；官方体验是思考逐行持续增长，超过五行后固定为内部可滚动区域，并可回看完整内容。
- 根因快照：该轮 Server 在 116 秒内持续发送 202 个 `thinking.delta`，证明上游并未批量阻塞。Kimix 遇到 v2 中间步骤 `event.isComplete=true` 后停止订阅 active draft；即使草稿继续增长，已有 formal `turnBlocks` 又覆盖了 `processEvent` 里的实时 thinking，UI 只能等下一次工具/正式边界刷新。旧视图还仅渲染思考尾部 2000 字，违反“完整可回看”。
- 修复：只要运行时仍 active 就持续订阅 active draft，不再把中间 step complete 当整轮终态；当前草稿的 thinking 作为独立 live block 接到 formal blocks 后实时渲染。运行中的每个思考阶段固定五行（120px）并内部滚动、默认跟随底部，用户上滚后暂停自动跟随；移除 2000 字截断，全文始终保留在滚动区。运行中正文仍遵守既有“不闪现、完成后再落正文区”约束。
- 验证：全量 130 文件 1245 项通过；Node/Renderer 严格类型检查、生产构建（renderer `assets/index-Bilp5pKv.js`）、OKF 严格校验（11 概念、19 Markdown、334 链接）及 `git diff --check` 通过。待用户动图复验。

## 2026-07-26 修复：完成回放误把工具前短句当最终正文（v2.20.22）

- 用户 v2.20.21 实测：一轮含工具调用的回答在服务端已生成完整最终正文，但 UI 只显示工具前的 26 字引导句并标记“输出完成”；实时正文仍有固定分段跳出的观感。
- 根因快照：官方 `/messages` 保存了 `000728` 工具前短句与 `000730` 592 字最终正文；完成屏障按时间正确回放，但 `mergeEvents` 只允许 stable 消息绑定尚未完成且后方无工具的 live Assistant。旧短句因此被追加到数组尾部，最终正文则绑定到更早的 live 草稿，`computeFinalTextBlockContent` 合法地取尾块时便取错。模型/Server 没有提前结束，丢失发生在 Kimix 完成回放归属层。
- 修复：完成屏障可将历史消息绑定到已由工具边界关闭的对应 live 段，并用“官方步骤时间—候选 live 段时间之间是否存在工具/子代理/审批”阻止旧步骤吞掉工具后的新草稿；同一 stable 消息的后续正文帧即使目标后方已有工具也继续更新原段。空闲流式通知从固定 100ms 桶改为下一 animation frame 发布，滚动中仍保留 250ms yield。
- 验证：定向 3 文件 233 项、全量 131 文件 1245 项通过；Node/Renderer 严格类型检查、生产构建（renderer `assets/index-Cq1CoGUd.js`）、OKF 严格校验（11 概念、19 Markdown、333 链接）及 `git diff --check` 通过。待用户真实长工具轮验收。

## 2026-07-26 修复：新轮订阅静默与重连快照错序（v2.20.21）

- 用户 v2.20.20 实测：新轮仍需约 20 秒才整批出现输出，且过程文本出现 ``registeredInteresting``、句首半截等非自然拼接。
- 根因快照：prompt 前建立的 WS 在新轮只收到首条状态，之后 17 秒无帧；官方历史增长后 v2.20.20 watchdog 重连，重连后的独立 WS 可持续收到约 0.2–1 秒一条增量，证明延迟是旧订阅跨轮失活。官方 messages 中原文完整；IndexedDB 本地事件却把较早 snapshot 步骤吸进当前 live draft，并把无 offset、时间戳 1ms 倒序的 thinking parts 按到达顺序连接，确认错文发生在 Kimix 归属/拼装层。
- 修复：HTTP prompt 接受后立即重建 WS 订阅，不再等待官方历史持久化后由 watchdog 判定；未见过的 stable snapshot ID 必须经过带工具/子代理/审批边界与时间边界的 guarded binding，禁止 same-turn 快捷路径绕过；无 offset thinking parts 按源时间戳稳定恢复顺序，同 ID 增长更新保留原始位置。版本升至 v2.20.21。
- 验证：定向 2 文件 212 项、全量 131 文件 1244 项通过；Node/Renderer 严格类型检查、生产构建（renderer `assets/index-CGsF8wBH.js`）、OKF 严格校验（11 概念、19 Markdown、332 链接）和 `git diff --check` 通过。待用户真实长任务实测。

## 2026-07-26 修复：WS 假死期间每 30 秒批量补输出（v2.20.20）

- 用户 v2.20.19 实测：运行约 30 秒后正文、思考和 5 个工具结果整批出现，怀疑没有实时同步。
- 根因快照：官方 wire 在 08:05:27、08:05:39、08:05:50 连续写入步骤结果，而 Kimix WS 从 08:05:18 起仅收到 1 条状态、正文/思考/工具增量均为 0；08:05:48 的 30 秒 `running-sample` 首次把历史整批补入。旧 watchdog 到 08:06:57（静默 99 秒）才重连，重连后增量立即恢复为约 2 秒一批。
- 修复：每次 prompt/steer 接受后用 `/messages?page_size=1` 记录轻量历史基线；WS 静默 8 秒后按 3 秒节奏比较最新消息标记。历史未增长视为正常长考，不重连；历史已增长而 WS 无帧则立即重连并走既有快照恢复。90 秒固定静默上限继续作为最终兜底。版本升至 v2.20.20。
- 待用户实测：长任务正常长考不应被频繁重连；若 WS 再次静默假死，应在下一次官方消息提交后的数秒内自动恢复，不再等 30 秒历史采样批量跳出。

## 2026-07-26 修复：所有模型上下文窗口误显示 256k（v2.20.19）

- 用户 v2.20.18 实测：k3 与 grok-4.5 的背景信息窗口都显示总量 256k，导致 25.1k 被算成 10%、198.6k 被算成 78%，与模型真实窗口不符。
- 根因：旧 `StatusUpdate` 映射只要收到 `context_usage` 就伪造 `contextLimit: 256000`，会话汇总缺少上限时又二次回退到 256000；该常量既污染新事件，也会留在已持久化历史里。
- 修复：不再从用量值猜测窗口上限；背景信息窗口加载当前模型配置与 Server 模型目录，按 Agent/会话模型别名解析各自的 `maxContextSize`，并让目录值覆盖历史里的伪 256k。目录和运行时都没有上限时明确显示“窗口上限未知”，不再编造百分比。版本升至 v2.20.19。
- 待用户实测：k3 应显示其目录声明的约 1M 窗口，grok-4.5 应显示其配置/目录声明的窗口；切换其他模型后也应各自变化。

## 2026-07-26 补充：被拒 canonical 仍恢复压缩用量（v2.20.18）

- v2.20.17 已保留 session usage，但该问题会话长期因本地正文更丰富而拒绝整份 canonical history；已有的 additive usage 合并按原始时间戳把 usage 插回 `complete` 之前，仍会被上下文边界排除。
- 修复：缺失的 `usageScope:"session"` 在 additive 合并时固定插到对应成功 compaction end 之后；普通 turn usage 仍保持时间序。这样无需再次压缩，重启当前问题会话也能从 wire 恢复最近一次约 25,079 token 的窗口数据。版本升至 v2.20.18。

## 2026-07-26 修复：压缩完成重复提示且小窗无用量（v2.20.17）

- 用户 v2.20.16 实测：压缩终态已能出现，但同一次 `/compact` 显示两条“上下文压缩完成”；背景信息窗口仍显示“等待上下文数据”。
- 根因：一条完成来自主动投递的官方 `full_compaction.complete`，另一条来自 Composer 成功后追加的本地 status。小窗方面，wire 在每次 complete 前都会写权威的 `usageScope:"session"` 用量（本次为 5,879 other + 19,200 cache read = 25,079 input token），但历史解析只接收 `usageScope:"turn"`；live bridge 也只投递终态、不投递该 session usage。
- 修复：完成提示统一由官方终态事件产生，Composer 只保留“正在处理”和失败提示；wire bridge 同时提取并在终态后投递 session usage，历史解析也保留该用量，保证实时与重启后小窗都能显示压缩结果。版本升至 v2.20.17。
- 待用户实测：压缩完成后只出现一条完成提示，小窗显示新的低占用 token/百分比；重启后仍保留。

## 2026-07-26 修复：压缩完成事件不经 WebSocket 推送（v2.20.16）

- 用户 v2.20.15 实测：`/compact` 已显示“请求已提交”，但约一分钟后仍无完成反馈，小窗变为“等待上下文数据”。
- 新快照：本次官方 wire 在 07:28:40 写入 `full_compaction.begin`、07:29:17 写入 `full_compaction.complete`，实际 36.6 秒完成；同时间主进程 WS 帧没有任何 `full_compaction`。确认 Server 只把压缩生命周期写入 wire，不通过当前 WS/Snapshot 协议投递，单纯补 mapper 无法形成实时反馈。
- 修复：Server `:compact` 接口确认后，主进程轮询目标会话 wire 尾部等待本次请求之后的新 `complete/cancel`，将终态主动送入 UI，并刷新 Server 状态恢复压缩后的上下文用量；`/compact` 先显示“正在处理”，终态后再显示完成或具体失败。版本升至 v2.20.16。
- 待用户实测：从 `/compact` 或背景信息窗口发起一次压缩，处理中状态应持续约几十秒，完成后对话流出现终态且小窗恢复压缩后的上下文数据。

## 2026-07-26 修复：上下文压缩假失败且无终态反馈（v2.20.15）

- 用户 v2.20.14 实测：背景信息窗口点压缩可能显示“压缩失败”；发送 `/compact` 后只保留用户气泡，没有完成或失败反馈。
- 根因快照：官方 wire 明确记录 `full_compaction.begin` → `full_compaction.complete`，手动压缩实际约 60.6 秒且上下文 24.87% → 21.40%；Kimix 实时映射与历史解析只识别旧的 `compaction.started/completed/cancelled`，因此真实终态在 UI 和重启恢复中都被丢弃。压缩 HTTP 还沿用 5 秒普通控制超时，长压缩可能产生客户端假失败。
- 修复：识别官方 `full_compaction.begin/complete/cancel`，区分完成与取消；请求改用 120 秒长任务超时；小窗持续显示处理中并在终态显示完成/失败与具体原因；`/compact` 明确反馈请求已提交，最终结果由官方事件进入对话流。
- 待用户实测：v2.20.15 分别从小窗与 `/compact` 发起一次压缩，确认处理中、完成/取消反馈可见，重启后终态仍保留。

## 2026-07-26 修复：存量缺失正文无法从官方历史自愈（v2.20.14）

- 用户 v2.20.13 重启实测：同一旧轮仍只剩“推送完成。升版本并发布 1.4.484。”一句。
- 新快照证据：06:46 dev 窗口启动时 canonical reconciliation 接受更完整官方历史（本地 15831 → canonical 22544）并写入 7757 events；06:48 用户日常构建窗口重启后仍从另一 renderer origin 的 IndexedDB 加载旧 5831 events，目标轮仍为 1267 字。dev 与 built 的 renderer origin/IndexedDB 不同，不能用前者的恢复结果代表后者已修复。
- 自愈阻塞根因：built 存储曾因 canonical thinking 较短触发 `thinking-history-regression`，旧 `kimix_reconcile_circuit_v1` 又永久跳过相同指纹；现有 additive fallback 只允许“本地最新轮完全无可见输出”时补一个官方 Assistant，遇到“已有阶段短句但缺最终段”会拒绝。
- 修复：当本地与 canonical 最新 user turn 匹配时，有稳定消息 ID 则只补序号严格更大的最后一个 Assistant；官方 wire 无消息 ID 时，仅补时间戳严格晚于本地最后 Assistant 且正文尚不存在的尾段。保留本地更丰富的 thinking/tool/diff，不做整轮替换。reconcile circuit 升 v3，使升级后的新恢复算法获得一次重试。新增 stable 与 identity-less wire 两组幂等回归测试。
- 待用户实测：启动 v2.20.14 后，该旧轮应直接从官方 wire 补回完整最终正文；再次重启后仍保留。

## 2026-07-26 修复：重启后最终正文被同 ID 去重（v2.20.13）

- 用户 v2.20.12 实测：长工具轮结束时正文完整，重启后只剩阶段性短句，最终答案消失。
- 根因快照：主进程 SSE/日志显示结束前收到并展示 779 字最终正文（整轮显示 3670 字）；官方 `wire.jsonl` 同样保存完整最终段。重启后 IndexedDB/React `turnBlocks` 只剩 1267 字，最终 779 字不存在，确认是 Kimix 持久化恢复丢失，不是 SDK/模型漏发或渲染隐藏。
- 丢失根因：同一 Agent turn 在工具/状态边界间会多次提交 active draft，但每次都使用 `active-draft:<turn-key>` 相同事件 ID；运行中 `mergeEvents` 可保留边界后的新段，重启 hydration 的 `deduplicateTimelineEvents` 却按相同 ID只保留第一段，删除后续阶段汇报和最终正文。
- 修复：草稿定位 key 与持久化事件身份解耦；每个新建可视草稿段分配跨进程唯一的 `materializationId`，同一段内 ID 稳定、跨边界再次物化 ID 唯一。新增“两次物化同一 turn → 重启去重仍保留两段”回归测试。
- 待用户实测：重启 v2.20.13 后新跑一轮含多个工具边界的长任务，结束前后最终正文应一致。已经被 v2.20.12 重启去重并覆盖落盘的旧轮正文无法由本地事件自动恢复，官方 wire 仍可作为修复来源。

## 2026-07-26 修复：长工具轮流式卡顿与正文错拼（v2.20.12）

- 用户 v2.20.11 实测：输出几十秒不更新，恢复后出现缺词、旧句尾混入新句等不通顺正文。
- 根因快照：主进程日志显示 Server 的正文增量本就以约 30–100 秒的长步骤间隔突发；同时纯工具参数流每 10 秒触发 38–42 次 `buildRenderItems`，累计占用约 6–7 秒。UI 层 IndexedDB/React `turnBlocks` 已含错文，而官方 `wire.jsonl` 同位置原文完整，确认是 Kimix 拼装错误，不是模型原文或 Markdown 渲染问题。
- 拼装根因：Server `offset` 是整轮累计，跨 `turn.step`/工具边界不归零；Kimix 把游标保存在会被边界提交并删除的临时 draft 中，后续重放尾部被当新段开头接入。修复为独立保存整轮 content/thinking 游标，draft 提交只清可视段、不清协议游标；offset 落后跳过，缺帧不再模糊硬拼，权威快照后允许从非零 offset 续流。
- 性能修复：纯 running tool/status/subagent 进度批次由 80ms 降为 500ms；Assistant 正文仍为 80ms，完成、审批、报错等边界仍同步刷新。
- 待用户实测：重启到 v2.20.12 后复跑长工具轮，确认正文不再错拼；Server 自身长步骤静默仍可能存在，但 UI 不应再被工具参数投影额外拖慢。

## 2026-07-25 存量事件顺序错乱修复（hydration 重排 + v2.20.1）

- 根因：barrier 绑定保留 placeholder 早期 timestamp（f510c91 修复未来，本任务修复存量）
- 修法：新建 repairStableAssistantOrder（eventHelpers.ts），按 sid 尾部数字号排序
- 接入：loadLocalSessions 两处 hydration 路径（per-session + old-key）
- 测试 4 项：真实错乱修复、幂等、无 sid 不动、多轮不同 prefix
- 版本：2.20.1；release notes v2.20.1.md

## 2026-07-25 修复：完成轮重启后正文被 turnBlocks 规则藏空（v2.20.11）

- 用户 v2.20.10 重启后：头「输出完成 5分19秒」+ 用量 footer，正文空白；官方 web 同轮全文仍在；用户称结束当时曾见正文。
- 日志：startup reconcile `assistant-body-regression` 拒绝更短 canonical（local 21227 > canonical 20240）；display `event-…-1159` `textChars:1438` `isComplete:true` `active:false`——**数据在本地，非丢库**。
- 根因：`computeFinalTextBlockContent` 在 complete + 多段 text + 末段后仍有 tool 时 return ""（旧注释当「中间段」）。多步轮/快照补 tool 后常见此结构 → 正文区空、过程折叠，看起来像「没正文」。
- 修复：complete 时始终取最后一段 text 为最终正文；streaming 仍 return ""。回归测试改写。
- 待用户实测：重启后该 review 轮正文重新出现（最后答案段）；运行中仍不闪中间段。

## 2026-07-25 修复：prompt.completed 过早 completed（伪正文+卡住，v2.20.10）

- 用户 v2.20.9 截图：头「输出完成 5分19秒」+ 伪正文「发现两个要点…」+ 过程折叠 + 底「已连接」；实际卡住。
- 日志：15:08:30 `prompt.completed` → display settled_complete；之后 **0 次 poll**；15:10/11/13/15 反复 watchdog，recover 仍出 `tool.call.started`（tool 418→486）——**Server 仍在跑，Kimix 已 completed**。
- 根因：`handleServerFrame` 对 main `prompt.completed` 立刻 `setStatus(completed)`，未查 v2 `/status.busy`。交付屏障 ≠ engine 终态。
- 修复：完成后 `refreshServerSessionStatus`，`resolveEngineStatusAfterPromptCompleted`（busy→running；idle→completed；unknown→running）；若仍 completed 又收到 tool/think/body 帧则 re-open running。
- 待用户实测：长 review 中途不再「输出完成+已连接」假收口；忙时保持运行中；真结束后再完成。

## 2026-07-25 修复：中间 complete 步正文闪现再收进过程（v2.20.9）

- 用户实测 v2.20.8：整轮更正常；唯一残留——中间汇报句（「代码部分已全部完成，正在跑最终验收」）先出现在正文位，续跑后又缩回折叠过程。
- 日志：`thinking→settled_complete`（prompt.completed）→约 10s 后 `settled_complete→running`（同一 key）；`computeFinalTextBlockContent` 在 isComplete 时展示正文，再变 incomplete 时 return ""。
- 根因：非房间路径 `isRuntimeAwaitingTurnOutput` 用 `!hasCompletedAssistantOutput` 门闩——中间步已 complete 时误判 turnSettled，ChatThread 投影 isComplete=true 再因会话仍 running 重开。房间路径本就不看该门闩。
- 修复：非房间与房间统一——latest + session running 即 awaiting；显示层 `event.isComplete && !isActiveAssistant` 才算最终正文。回归测试 body-flash guard。
- 待用户实测：多步工具轮中间汇报不再进正文位闪现；整轮结束后最终答案仍正常显示。

## 2026-07-25 一口 live 诊断 + 官方 client_id 对齐（v2.20.8）

- 目标：用同一条 `diag.log` 录全症状 7/11/12/13，并对照官方 kimi-web 补复刻缺口，而不是再盲改显示层。
- 官方对照（`.kimix-upstream-kimi-code-0.18.0/apps/kimi-web`）：
  1. `buildWsUrl` 与 `client_hello.client_id` 同源 `web_*`（Kimix 曾 URL 用 web_、hello 用 kimix-*）→ 已对齐。
  2. 官方 projector 有 `turnTextLen` + `alignDelta(offset)` 的 skip/gap（gap 触发 re-snapshot）；Kimix 用 merge offset 拼接，缺官方 gap→snapshot 自愈环——记为后续缺口，本轮先靠日志证伪。
  3. 官方完成态跟 session/task/in_flight，不跟「非 active + 有可见输出」；Kimix `isSettledForDisplay` 会在假完成窗口写「输出完成」——`[live] display` 专抓。
- 实现：`src/utils/liveTurnDiag.ts`；App stream/silence/settle；MessageBubble display；main `KIMIX_LIVE_DIAG` 默认 dev 开；帧摘要带 offset/dlen。
- 用法：`pnpm dev` 复现 → 项目根或 userData 的 `diag.log` → `rg "\[live\]" diag.log`。
- 待用户实测：假完成瞬间是否出现 `display … to=settled_visible` 且 `isComplete=false`；空白窗是否 `silence` + `stream counts.body=0`；卡死是否 `watchdog` 或长期 `silence`。

## 2026-07-25 根治：WS 假死致轮次卡"正在思考"（Server 在跑但 WS 停推，v2.20.7）

- 现象：重任务（TodoList 9 项）卡"正在思考 9分28秒"+0/9 十几分钟，官方 web 同任务已 3/9 推进。
- 帧级取证（KIMIX_FRAME_DIAG 默认开，七维探针：wsframe/wsc/wssnap/wsbarrier/poll/running-sample/settle）：① `[poll]` engineStatus 持续 running（无 idle → settle 未触发，排除轮询误判）；② running-sample 触发但 reconcile rejected（保护拦住，排除快照替换误判）；③ **13:48:31 后 WS 13+ 分钟零帧**（无 close/无 delta/无 ping），但 `[poll]` HTTP 轮询持续 running；④ wire.jsonl 显示 Server 端 14:05 仍持续产出（llm.request/content.part/tool.call）。
- 根因：**Server 端 WS 推送对 Kimix 该连接假死**（Server 在跑、HTTP 正常、官方 web 另一连接正常收到，唯独 Kimix 这条 WS 连接 13+ 分钟零帧）；socket 不发 close，客户端检测不到，卡"正在思考"。属 Server 端推送连接级停滞；Kimix 侧缺陷是无假死检测。
- 修复（v2.20.7）：kimiCodeServerClient 加 WS watchdog——receive() 记 lastMessageAt，每 10s 检查，socket OPEN + 有活跃订阅 + 静默 >90s（WS_SILENCE_LIMIT_MS）则主动 close + scheduleReconnect（client_hello + recoverSnapshot 补全到 Server 最新）。90s 覆盖 llm 长考 thinking.delta 正常节奏，误判代价仅一次重连+快照（无害）。
- 验证：typecheck ✓；build ✓；重启后启动恢复把卡住的会话从 0/9 补到 5/9 且任务继续推进（14 个文件变更）。帧诊断改回默认关（KIMIX_FRAME_DIAG=1 才开）；渲染层 settle/running-sample 低频诊断保留。
- 知识库：runtime-routing 增不变量 85（WS 假死检测）+ log。
- 待用户实测：重任务长考不再卡"正在思考"；watchdog 真死时自动重连补全。

## 2026-07-25 根治：正文只在完成时回放、运行中无流式——WS 缺 client_id 致 volatile delta 不推（v2.20.6）

- 现象：多轮迭代后用户仍报"正文只发一条就输出完成"；重启后完整。运行中思考实时可见、正文不实时。
- 帧级取证（主进程 WS 诊断，KIMIX_FRAME_DIAG）：① 运行期间 WS 零 `assistant.delta`，仅 thinking.delta(durable, seq 递增)/tool.call.delta/tool.result 等实时帧；② 正文全在 `prompt.completed` 时刻整批回放到达；③ 回放后 store 与显示均完整（用户确认）。
- 根因（对照官方开源仓库实锤）：官方 kimi-web 正文实时推送用 `assistant.delta`（volatile text-delta，seq=durable watermark 不推进），且以 `?client_id=web_<uuid>` 连接 WS；Server 只对带 `client_id=web_` 的连接推 volatile 正文帧。**Kimix 的 WS 连接只有 bearer token、无 client_id** → Server 只发基础帧（thinking.delta），正文 volatile delta 不发 → 正文只能等完成屏障回放补全。排除项：cursor 机制（官方 trackCursor 与 Kimix deliver 逻辑相同）、client_id 值门控（官方 client_id 亦为随机 uuid，实按 `web_` 前缀形态识别）。
- 修复：kimiCodeServerClient.connect 的 WS URL 追加 `client_id=web_<device_id>`（kimixWsClientId，复用 ~/.kimi/device_id，缺失回退 randomUUID）——仅加客户端标识，不动 bearer 鉴权。帧诊断改 KIMIX_FRAME_DIAG=1 才开（默认关，防刷屏）。
- 验证（用户实测复现）：帧流出现 26 个实时 `assistant.delta`（5 秒内 ~300ms/个陆续到达，非回放）+ 渲染正文实时流式显示完整。typecheck ✓；全量 1214 测试 ✓；build ✓。
- 知识库：runtime-routing 增不变量（WS client_id 必须带 `web_` 前缀形态才能解锁 Server volatile assistant.delta 推送）。

## 2026-07-25 修复：Kimi Web 未勾选「运行中折叠」时过程仍被自动折叠（v2.20.5）

- 现象：用户 Kimi Web 模式 + 关闭「运行中折叠过程详情」（未勾选），运行中「k3 · 正在输出」仍折叠——期望「未勾选时 agent 反应期间思考/命令流全程实时展开，除非手动折叠」。
- 根因：`AssistantProcessSummary` 的 `hasFinalContent` 由 MessageBubble.tsx:2728 传入 `hasContent`（displayContent 非空）——运行中第一段思考/预告到达即为 true：① `defaultExpanded` 的 `!hasFinalContent` 把 Kimi Web「最新一轮展开」短路；② `shouldCollapseKimiWebProcessOnFinalContent` 在 false→true 沿自动折叠。选项「运行中折叠」本身未失效（用户已关=false），被该语义 bug 掩盖。
- 修复：新增纯函数 `resolveHasFinalProcessContent(isComplete, hasBodyContent) = isComplete && hasBodyContent`（liveThinkingViewport.ts），传入处改为 `hasFinalContent={resolveHasFinalProcessContent(event.isComplete, hasContent)}`——运行中恒 false（未勾选时全程展开、shouldCollapse 不触发，仅手动折叠有效），完成有正文时恒 true（自动折叠突出答案）；勾选「运行中折叠」时 collapseWhileRunning=true 仍运行中折叠（选项作用保留）。
- 测试：resolveHasFinalProcessContent 四象限 + 现有 shouldCollapse 场景；liveThinkingViewport 6/6。
- 验证：typecheck ✓；全量 1214 测试 ✓；build ✓（index-DQYjIV0p.js）；Tab 0。bump 2.20.5。
- 待用户实测：Kimi Web 未勾选时发消息，运行中思考/工具流全程展开，完成后自动折叠；勾选项开启时运行中仍折叠。

## 2026-07-25 功能：欢迎屏模型切换改「待使用模型」+ 运行中正文段全程折叠（v2.20.3/2.20.4）

- 闪烁修复（`d33b2da`，v2.20.3）：用户实测流式正文段"偶尔出现在正文区、很快又被隐藏到折叠中"——根因：computeFinalTextBlockContent 把"当前最后 text 块"当答案段显示，工具块到达后判定翻转移进折叠（每段闪一次）。修复：运行中（!isComplete）一律返回 ""，text 段全程待在折叠过程详情，完成后最终答案一次性显示。取舍：流式期间正文区不再滚动显示正文（用户明确选择"一直放在折叠里面"）。2 项新测试。
- 待使用模型（v2.20.4）：用户拍板"欢迎屏切换模型不应改默认模型，默认模型应在设置里切换"（选择"只影响下一个新会话"）。执行 agent 被中止无产出，我自行实施：① appStore 新增 pendingNewSessionModel（localStorage `kimix_pending_new_session_model` 持久化，trim/置空语义）；② ContextBar 欢迎屏分支移除 setKimiDefaultModel 调用，改写 pendingNewSessionModel，toast"下一个新会话将使用 X"，displayModel 与菜单选中态均改为 pendingNewSessionModel ?? defaultModel；③ Composer ensureSession（:1175 新会话唯一模型消费点）优先用 pendingNewSessionModel，addSession 后清除（一次性）；④ 4 项 store 测试。设置界面默认模型入口与有会话路径（本就只改当前会话）不动。
- 验证：typecheck ✓；全量 1213 测试 ✓（新增 6）；build ✓（index-Q_ZKjFkZ.js）；Tab 0；AGENTS.md 版本规则更新提交（0c3bfe5）。
- 待用户实测：①欢迎屏切换后设置里默认模型不变；②新会话用所选模型、再建会话回默认；③运行中正文段不再闪现；④"用 swarm 模式"轮汇总完整显示（v2.20.2 引用比较修复）。

## 2026-07-25 修复：同轮事件顺序错乱——汇总排在预告前致正文"缺失"

- 现象（用户重启后仍缺失）："用 swarm 模式随便读点东西"轮只显示 33 字符预告（"读完汇总给你"），996 字符完整汇总不见。
- 实锤（CDP 查 IDB）：该轮两条 assistant——996 汇总（sid=f_000010, stable, barrier, ts=user+40ms）排在 user 后第 2 位；33 预告（sid=f_000008, ts=user+30s）排在 subagent×4 之后。官方 sid 序列预告(8)在前、汇总(10)在后，数组顺序相反 → turnBlocks 按数组顺序取最后 text 块（预告）为"最终答案"，汇总被折叠进过程详情。
- 根因：eventMapper.ts completionBarrierReplay 绑定分支（:1846-1872）`{...target, content: incoming.content}` 保留本地 placeholder 的早期 timestamp（=user 发送时刻），官方后续消息（预告）按官方 ts 插入落在汇总之后。
- 修复（`f510c91`+`df05e32`）：① barrier 绑定 timestamp 改 `incoming.timestamp ?? target.timestamp`（官方权威时间优先）；② 附带发现——绑定未设 isComplete 致被绑事件保持未完成、sameTurnAssistantIndex 会错误合并后续不同 sid 事件，改 `isComplete: incoming.isComplete || target.isComplete`；③ df05e32 修回 17 行 Tab 缩进（执行 agent 第三次同类污染，我已直接修并在此记录：后续派单提示词必须硬性要求"提交前 grep Tab 验证为 0"）。
- 测试：真实场景 fixture（user → barrier(f_000010, +40s) 绑定 → unseen stable(f_000008, +30s) 插入 → 断言预告在汇总前）。
- 验证：typecheck ✓；全量 128 文件 1202 测试 ✓；build ✓；ignore-all-space diff 确认缩进纯格式。待用户实测：该轮显示完整汇总（预告段在过程详情）。

## 2026-07-25 修复：重排不生效——hydration changed 检测 length 比较丢弃修复（v2.20.2）

- 现象：c2261d2（存量重排）+ v2.20.1 后用户实测显示依旧——"改了多轮都没变"。
- 根因：persistence.ts 两处 hydration 接入处 `changed = events.length !== session.events.length || ...`——`repairStableAssistantOrder` 位置槽交换**不改变数组 length**，dedupe 无重复也不变 length → changed=false → 返回未重排的原始 session，重排结果被整个丢弃。接入 bug（c2261d2 审查时我和执行 agent 均未发现：重排"length 不变"特性与 length 检测冲突）。
- 修复（`95fd25f`）：两处 changed 检测从 length 比较改为**引用比较**（`events !== session.events` / `agentEvents[agentId] !== list`）——dedupe（eventMapper.ts:2451）与 repairStableAssistantOrder 幂等均返回原引用，幂等时引用全同返回原 session（identity 缓存友好），重排产生新数组时 changed=true 生效。补关键回归测试（错乱但 length 不变的持久化会话 → loadLocalSessions → 顺序修复断言）。bump 2.20.2。
- 验证：typecheck ✓；全量 1207 测试 ✓（persistence 定向 17/17 含新测试）；build ✓（index-DoyQhs7W.js）；Tab 0。待用户实测：重启后该轮显示完整汇总，版本号 v2.20.2。
- 教训沉淀：hydration/缓存层的"是否变化"检测必须与数据变换的特性对齐——位置交换/内容编辑类变换（length 不变）一律用引用比较，length 比较只适用于增删类变换。

## 2026-07-25 诊断：历史轮次正文"消失"（kimi-web 块模式误判单块合并正文为中间过程）

- 现象（用户截图+官方 web 对照）：所有历史轮次只剩消息头+工具组+变更卡，assistant 正文全部不见；最后一轮只显示正文尾部两句（"简洁汇报。生效后..."）；与官方 kimi web 同轮对照，正文完整但 Kimix 未显示。
- CDP 全链取证（9222 直连运行实例）：IDB 里 11 轮 assistant 正文全部完整（len 838-2170，isComplete）；React fiber 里 MessageBubble 的 event.content=1060 完整；但该轮 turnBlocks=[thinking(3248), text(1060,1事件), tool×5]——**正文合并成单块且排在全部工具块之前**。
- 根因：MessageBubble.tsx:2674-2682 finalTextBlockContent——最后 text 块后存在 tool/subagent/approval 块时返回 ""（kimi-web 语义：无最终答案段，中间段收进过程详情）。mapHistoryEvents 把同轮所有 text delta 合并为单条 assistant_message 并置于数组首位（工具事件之前）→ 该唯一 text 块被误判为"中间过程"→ 底部正文为空，全文进过程摘要（折叠态只露尾部 teaser 两句）。过程摘要折叠即"正文消失"。
- 修复方案（已定稿待执行）：isComplete && textBlocks.length===1 && hasTrailingProcessBlock 时返回该 text 块全文（单块即全部正文，含答案）；多块与运行中保持现有语义。同步验证过程详情展开时 text 段内联渲染正常。
- 修复落地（`6018d6e`）：computeFinalTextBlockContent 提取纯函数，单块+trailing+isComplete 豁免返回全文；6 项定向测试；复审+独立复验通过。
- 治本落地（`e47d3a3`+`aeabb20`）：用户追问确认新消息同样被合并为单块——实锤 sameTurnAssistantIndex（eventMapper.ts:1789）同 turn 未完成 assistant 跨工具吸收全部 text delta。mergeEvents 两处加 hasToolBoundary 断段（stableAssistantIndex 分支 :1829 + 后备路径 :1988），identity terminal 完成空帧不受影响，barrier/stable id/房间 scope 语义不变。新消息落库即官方多段结构 → turnBlocks 多块 → 穿插排版。4 项旧测试依赖跨工具合并旧行为已更新。aeabb20 修回 54 行 Tab 缩进污染（纯格式）。
- 验证：typecheck ✓；全量 128 文件 1192 测试 ✓；build ✓。待用户实测：①旧会话 11 轮正文全文显示；②新消息多步工具轮次为官方穿插排版且重启后保持。
- 遗留：①旧会话已合并单块无法还原分段（信息已丢），以全文显示为终态；②index 重复条目（43 条/19 唯一 id）脏数据另案。

## 2026-07-25 运行时问题排查：发不出消息（非代码回归）+ 空帧误判纠正

- 现象：grok-4.5 发消息 50s 无响应被打断、撤回报"Kimi Code session is not active"、换 deepseek-v4-flash"瞬间完成"无正文、右下角卡运行中。
- CDP 取证（9222 直连）：deepseek 轮 isComplete=true 但"正文"是 Kimix 合成占位"模型请求失败：本轮已结束，但模型未返回可显示内容"——**模型空响应**；grok 轮超时。主因：会话 context 117.12% 超限（模型请求超时/被拒/返回空）+ grok 打断后 Server session 状态卡死（轮询拿不到终态 → 卡运行中）。用户指引：重启 Kimix + 换新会话（旧会话仅回看）。
- 排版改动无恙且超预期：断段改动后 reconcile 用 canonical 断段版替换本地单块，**旧轮次重新获得官方分段结构**（实测 06:21 警告条轮从单块 1060 变为 text:301+text:759 双块，答案段落底部）。
- 误判纠正（曾报"断段副作用"）：IDB 里 87 条空完成帧曾被认为是断段引入的非幂等累积。逐行复核 mergeEvents 全部路径（:1809 标记完成、:1874/:1897 stable id return existing、:1936-1976 后备路径 return base 不含 incoming、:1968 TurnEnd 主动删除空白未完成 assistant）——**所有路径均不 append 空帧**。87 条实为 canonical 官方历史的合法 step 边界标记，随断段版 reconcile 进入本地，渲染层过滤、体积可忽略、无幂等问题。`398e1b4` 补 3 项防回归测试（全完成空帧不新增/正常标记完成/幂等）。
- 验证：typecheck ✓；全量 128 文件 1195 测试 ✓；build ✓。

## 2026-07-25 修复：乱序 delta 拼接错乱（grok 正文"你好"移位）

- 现象（用户新会话实测 grok-4.5）：①"你好霖江路"被拼成"霖江路\n\n最近几你好轮改动"（"你好"被移到句中）；②一轮显示"用 swarm 并行读几处关键文件，读完汇总给你"后"输出完成"，汇总正文未显示。
- 取证（CDP 查 store）：两轮最终正文完整正确（1687 字符/996 字符汇总全文均在）——用户看到的是**流式中间态**，非数据丢失。
- 根因①（拼接错乱）：appendAssistantContent（eventMapper.ts:187）只做 existing+incoming 简单拼接，完全不看 streamOffset；grok-4.5（第三方 provider）delta 乱序到达（offset 2"霖江路"先于 offset 0"你好"）→ 按到达顺序拼错。既有问题，与断段无关；权威快照帧最终纠正 store。
- 根因②（没说完就结束）：轮次完成显示时正文还是流式预告段，权威全量汇总在完成后到达替换（时序窗口），store 最终正确。
- 修复（`69b2581`+`ea755ff`）：新建 mergeAssistantContentWithOffset——两端均有 streamOffset 时按区间排序拼接（完全在前 prepend/完全在后 append/重叠取先到者+不重叠后缀）；无 offset 回退 mergeAssistantContentPrefixSafe（startsWith 语义，与原 mergeLiveBody 一致，避免 includes 把中部子串误判为全量覆盖丢字）。stableAssistantIndex 与后备 lastIndex 两处合并路径替换，合并后事件 streamOffset 取最小值。审查打回两处已修：19 行 Tab 缩进（ea755ff 修回，agent 第二次引入同类污染已要求自查工具链）+ mergeLiveBody→includes 未披露语义变化（改 startsWith 保守语义）。
- 测试：乱序真实案例（"霖江路"→"最近几"→"你好"→"你好霖江路最近几"）、顺序、重叠去重、无 offset 回退、includes 替换、startsWith 中部子串安全。
- 验证：typecheck ✓；全量 128 文件 1201 测试 ✓；build ✓。待用户实测：grok 新消息拼接顺序正确；旧轮次回看确认时序窗口自愈。

## 2026-07-25 诊断：启动卡顿复发根因收敛（persist 风暴 × 永败 reconcile）

- 现象：启动卡顿复发且更严重。KIMIX_PERF：启动 30s 窗口 21 个长任务共 26065ms、maxMs 1894，呈 ~1.7s 周期性（2.7s 持续到 27s+）；React 渲染仅 7 次、setState 仅 29 次。
- 石锤（diag.log 04:46-04:48 启动段）：① `persist.run {sessionCount:365,totalEvents:39560,stripMs:6764,commitMs:3931,totalMs:13887}`，启动窗口每秒级连续全量落盘（04:46:55/56/57 三连 + 04:47:57 + 04:48:47/49）；② 同一 Swarm 房间会话 session_a4d8499f 每秒 ~15 次 `kimiHistoryReconciliation.rejected {reason:"process-history-regression",localProcessEvents:119,canonicalProcessEvents:19→64}`。
- 根因三层：L1 直接成本——persist 对 365 会话/39560 事件全量 strip（extractImages 图片提取 + 遍历拷贝）+ stringify + IDB 克隆，单次 1.4-13.9s，规模只涨不跌（persistence.ts:351 stripImagesFromSessions、:548 commitState）。L2 触发放大——Swarm 房间本地 119 过程事件 vs canonical snapshot 19-64（缺工具帧），process-history-regression 保护逻辑（kimiHistoryReconciliation.ts:621，行为正确）永远拒绝；而修复候选条件 roomAgentNeedsKimiCodeHistoryRepair 的 OR 链恒真（App.tsx:218-229），repair 循环（:254 slice 0,12）/startup recovery（:502）每次启动+恢复无限重试，无熔断无记忆，每次 setState 换 sessions 引用。L3 防线失效——引用守卫只拦"引用相同"（persistence.ts:523-529）；启动档防抖只走订阅 debounce；archiveOrDeletionChanged 立即 flush（useStatePersistence.ts:73-84）等路径绕过；叠加后每秒级全量落盘。
- 复发原因：上轮 5bfbe35/d0605bf/d6e0cb4 只减落盘次数，未治单次成本；数据规模增长（70MB→39560 事件/13.9s）+ Swarm 房间永败目标是上轮没有的新放大器。
- 已排除：MessageBubble:574（撤回手动路径）、Composer:3056（发消息路径）非风暴源；无 sendSync；buildRenderItems 实测 max 0.7ms 非瓶颈；scrollTopWrites≈0。
- 遗留取证缺口：rejected 日志调用方 reason 被 "process-history-regression" 覆盖（kimiHistoryReconciliation.ts:622-627），无法区分 repair/startup/running-sample 调用源，修复时一并补。
- 修复选项（待用户拍板）：A. reconcile 熔断/记忆（rejected 指纹持久化，canonical 未变不重试；repair 对永败目标登记不再每启动重试）；B. persist 触发收口（启动窗口内 archiveOrDeletionChanged 立即 flush 改合并；setState map 全原引用时复用旧数组）；C. persist 成本治本（按会话分键增量持久化或 strip/stringify 迁 Worker）；D. 日志补调用方 reason。建议 A+B 先行，C 立项。

## 2026-07-25 启动卡顿根治（A+B+C+D 全量落地，v2.20.0）

- 方案：按 docs/plan-startup-lag-rootfix.md 定稿计划，四路并行修复。
- Phase D+A（d583ca1）：reconcile 熔断/记忆 + 归因补强。新建 `src/utils/reconcileCircuitBreaker.ts`——基于 (local,canonical) 指纹持久化到 localStorage（key `kimix_reconcile_circuit_v1`，LRU 500）。rejected 分支登记指纹，accepted 分支清除；`isCanonicalReconciliationCircuitOpen` 供 repair/startup/running-sample 4 处调用源在 reconcile 前检查，命中则整体跳过。rejected/accepted 日志全部补 `callerReason` 字段。
- Phase B（0dc86bc）：persist 触发收口。useStatePersistence 订阅加逐项浅比较（pendingMessages 引用相同 + 每元素引用相同则 return）；启动窗口内 archiveOrDeletionChanged 合并到防抖 persist，窗口外保持立即 flush。
- Phase C（4384265）：增量持久化。分键存储 `kimix_local_sessions_index` + `kimix_local_session_<id>`；runPersist 按引用缓存判断变化会话，仅 strip+写变化/新增/删除；loadLocalSessions 读 index 分批并行加载（20/批）；旧单键 `kimix_sessions` 自动迁移。persist.run 日志补 changedSessions/totalSessions。
- Phase 4：package.json 2.19.5→2.20.0；streaming-render-pipeline.md 持久化段更新并新增不变量 A/B/C；knowledge/log.md 记录；docs/release-notes/v2.20.0.md。
- 验证：typecheck × 4 轮均通过；kimiHistoryReconciliation 45/45 + persistence 14/14 + useStatePersistence 5/5 = 64 定向全绿。
- 审查修复（两轮打回，`6c11254`/`2b95953`）：① P0 缓存引用错位——loadLocalSessions 用内部引用填缓存，App.tsx hydration 两次 map 换引用，首次真实 persist 退化全量；修为 markConversationStatePersisted 逐项登记。② P1-a 熔断命中后仍写误导性 error issue；修为 circuitSkipped 守卫。③ P1-b 熔断指纹登记用 reconciled canonical、检查用 raw canonical，含用户媒体时熔断静默失效；修为 context.rawCanonicalEvents 同源。④ P1-c→新 P0 GC 误删：sessionImageRefs 只为变化会话建立，未变化会话 refs 缺失将被 deleteImages 批量误删历史图片；修为预填充+惰性回退，补非空 getAllImageIds 回归测试（mock 恒 [] 的测试结构抓不到此类 bug）。⑤ P1-d 迁移检查改模块级 flag。知识库新增 Invariant D（GC ref availability）。
- 最终验证（独立复验）：typecheck ✓；全量 128 文件 1179 测试 ✓；build ✓（新 hash）；knowledge:validate ✓。
- 用户实测 v2.20.0 仍卡（06:15 启动段取证）：persist 增量确认根治（commitMs 103-129ms、changedSessions 2-3/365），但暴露两个运行时缺陷（此前被 persist 风暴掩盖）：① 熔断失效——repair patch 路径每次追加 Date.now() usage status 事件，指纹 localLastTs 每 ~70ms 变，同 canonical 被 reconcile 23 次（callerReason:"repair"，canonical 统计量 119vs64 恒定）；② rejected 日志经 ...context 携带完整 rawCanonicalEvents 事件数组，84KB/条×25=2.1MB 序列化+IPC+写盘（06:15:30 窗口 6 长任务 10519ms、timings 空白的真凶）；首次 persist stripMs 墙钟 38s 系主线程被挤占的受害者。
- 三轮修复（`bb94d61`）：① 指纹去掉 lastTs，仅留 assistantBodySize+processEventCount（PROCESS_EVENT_TYPES={tool_call,subagent,approval_request,question_request,hook}，usage status 不影响，patch 免疫）；② logCtx 剔除 rawCanonicalEvents（7 处统一）；③ repair 限流同 target ≤3 次/轮（circuitSkipped 联动抑制 error issue）。
- 三轮复验：typecheck ✓；全量 1180 ✓；build ✓（index-BIR0lN-9.js）。
- 待用户二次实测：KIMIX_PERF 启动 30s 长任务总时长 <1500ms；persist.run ≤2 次且 <500ms；同 target rejected ≤3 次/启动；rejected 日志行 <1KB；diag.log 启动段无 MB 级增长；抽查历史图片显示正常。

## 2026-07-25 修复：自定义模型子代理未生效（外部 Server 缺实验 flag）

- 现象：配置子代理用 deepseek（[secondary_model] deepseek/deepseek-v4-flash），跑任务后 deepseek 无账单，实际仍用 kimi 额度。
- 取证链：① config.toml [secondary_model] 配置正确；② 子代理 wire `modelAlias: kimi-code/k3`（caller inheritance 石锤）；③ server 日志 `experimental flags enabled flags=[]`（flag 未开石锤）；④ 当前 server 父进程是 powershell 非 electron（kimiCodeServerHost spawn 用 shell:false，证明该 server 是手动启动的 `kimi web`），没有 KIMI_CODE_EXPERIMENTAL_SECONDARY_MODEL=1；⑤ 附带发现 default_effort="max" 不在模型声明 ["low","medium","high"]（官方会静默丢弃）。
- 根因：0.29.1 secondary_model 是实验特性，flag 跟随 Server 进程而非配置文件；手动启动的 server 无 flag → [secondary_model] 被静默忽略。
- 修复：`3ccbb0b` attach 外部 server 时检测 config 的 [secondary_model] 并经 diagnostics 透传，子 Agent 卡显示「外部 Server 可能不生效」警告；`9188f19` 保存 secondary_model 写前校验 default_effort 合法性（拒绝未声明档位）。另直接修正用户 config 的 max→high（备份 .kimix-backup-effort-fix）。
- 验证：typecheck；定向 4/4 + 22/22；全量 1165/1161 两轮通过；build 通过。警告条视觉待用户截图验收（AGENTS.md 规则）。
- 用户操作：重启 Kimix（切换为托管 server 带 flag）或手动 `KIMI_CODE_EXPERIMENTAL_SECONDARY_MODEL=1 kimi web --no-open` 后，子代理即走 deepseek。
- 知识库：runtime-routing 不变量 71 扩展（flag 随进程不随配置）+ log。

## 2026-07-25 修复：prompt 前 WS 订阅保障（review 3279387 后修正）

- 背景：3279387 为修「发消息一直没有首字」在 prompt() 开头加 `this.subscribed.add(sessionId)`。用户要求 review。
- review 结论：方向对（首字丢失 = Server 端 WS 订阅缺失，delta 只推订阅者）但实现不充分——裸 add 只改本地 Set，Server 端订阅仅经两条路建立：connect() 握手 client_hello 的 subscriptions（:1240，仅新连接瞬间）与 subscribe() 的 sendControl("subscribe")（:970）。WS 已连接而会话未订阅（正是 bug 场景）时 add 不发任何控制帧，首波 delta 照丢；且污染 recoverSnapshot 的 subscribed.has() 判定。
- 修正（`a73ed3c`）：prompt() 未订阅会话改走真 subscribe()（add+ensureConnected+sendControl），失败 console.warn 降级（HTTP prompt 与快照兜底不阻断）；steer() 不动（运行中必已订阅）。测试：fake WS 断言 subscribe 控制帧先于 prompts HTTP、订阅失败仍发送、已订阅不重复。
- 验证：typecheck；定向 52/52；全量 1157 通过；build 通过。待用户实测发消息首字。
- 知识库：runtime-routing 新增不变量 83（WS 订阅是线路状态非本地 Set）+ log。

## 2026-07-25 修复：启动恢复会话不置底（92ec0ad 误改回退）

- 现象：启动自动恢复上次项目会话后不停在底部（实测停在 distance≈433px），用户自改一轮（92ec0ad）无效。
- 取证（diag.log 02:38 启动段）：primed 完成（32.1）但 scrollTopWrites 全 0、`[useAutoFollow] scrollToBottom` 零记录——启动后从未发生自动贴底写入；handleScroll 证 userScroll 只能来自真实交互（排除程序化误判）。
- 根因：92ec0ad 把 useChatViewport.ts:785 跟随分支从 `scrollToBottom("auto")` 改成 `settleSessionAtBottom()`——settle 在「连续 3 次稳定提前退出」（v2.16.86 引入）或 3.5s 窗口过期后调用直接 return（useAutoFollow.ts:171 remaining<=0）。启动恢复的对账换入/子代理内容浮现/markdown 升级都发生在 settle 死后（实测 scrollHeight 涨 ~433px），无人贴底。
- 修复（`e4055b5`）：该分支恢复 `scrollToBottom("auto")`，保留 92ec0ad 正确的 contentVersion 依赖与 viewportReady 条件；回归测试「settle 窗口过期后内容增长仍贴底」双向验证（buggy 版复现失败、修复后通过）。
- 验证：typecheck；定向 17/17；全量 1154 通过；build 通过。待用户重启实测置底。
- 知识库：chat-viewport-state 增「死 settle 循环不贴底，contentVersion 兜底必须直接写」不变量 + log。

## 2026-07-25 模型 Context Window 表更新至最新两代

- 用户要求：74f9acc 补充的模型落后，点名补 kimi k3/k2.7-code、glm 5.2/5.1。
- 查证（四路并行官方来源，2026-07-25）：k3=1M（官方仅 "1M-token"，按 kimi 二进制行文取 1,048,576，精确值待 07-27 技术报告）；k2.7-code/k2.5/k2.6/k2-thinking/k2-0905=262,144；k2 初版=131,072；glm-5.2=1,000,000、glm-5.1/5/4.6=200,000；gpt-5.6/5.5=1,050,000、gpt-5/5.3-codex=400,000、gpt-4.1=1,047,576（官方奇特精确值）；claude fable-5/sonnet-5/opus-4-8/4-7/4-6/sonnet-4-6=1M（GA 默认）、haiku-4-5=200k；gemini-3 全系=1,048,576（3.x pro 也是 1M，不再 2M）；qwen3.7/3.6-plus/3.6-flash=1M、qwen3.6-max/qwen3-max=256k；grok-4.5=500k（比上代小的陷阱）、grok-4.3/4.20=1M。
- 落地（`6f548b2`）：modelContextInference.ts 家族规则按新版在前顺序更新 + 顶部来源注释；测试 +6 it 块。
- 验证：typecheck；定向 17/17；全量 1153 通过；build 通过。
- 知识库：无需更新（数据表维护，非架构/流程知识）。
- 跟进：07-27 k3 技术报告发布后核对精确 context 值。

## 2026-07-24 启动后卡顿根因收敛（四路分析 + 诊断接线）

- 现场：上个 agent 发现 perfDiag 埋点因 `isPerfDiagEnabled()` 默认 false（perfFlags.ts:31）全短路，已建 `startupProfiler.ts`（启动 30s 无条件采集）但未接线完。本轮补齐 `noteStartupScrollTopWrite`（useChatViewport 3 处写入点）、`noteStartupLayoutEffect`（5 个 useLayoutEffect）、`noteStartupStateSet`（两个 zustand store set 包装），修正 KIMIX_PERF 注释。typecheck + 定向 19 测试 + build 通过，提交 `2592af5`。
- 四路只读分析（滚动管线 / React 渲染 / 持久化加载 / 主进程启动序列）收敛根因排序：
  1. **启动即全量回写 70MB**：`useStatePersistence.ts:70-72` hydration 0→N setState 命中 length 变化 → `archiveOrDeletionChanged=true` → 立即 flush → stringify 70MB + IDB 克隆 140MB（1-3s 主线程）。数据刚从磁盘读出未变，纯浪费。
  2. **每启动 12 会话全量修复循环**：`App.tsx:217-229` 候选条件 OR 链几乎恒真（cacheVersion 无筛选作用）；每会话 IPC 全量历史 + `mapHistoryEvents` O(n²)（eventMapper.ts:2280 逐事件过 mergeEvents 含全扫+全拷贝）+ setState 风暴；且 `App.tsx:335/348/362/376` 直接 `void persistLocalConversationState()` 绕过防抖，级联多次 70MB 锤。
  3. **loadSession 4s server race**：`electron/main.ts:6691-6696` server 未就绪时确定性空等最多 4s，本地 wire 镜像本可立即回答；修复循环每会话也撞此 race。
  4. **eagerMarkdown × settle 3.5s 窗口耦合**：`useChatViewport.ts:790-792` settle 窗口内禁用 deferOffscreen → 启动同步全量 markdown 渲染（tail ≤28 项），布局不稳延长 settle，每次校正 2 条无条件 writeDiag IPC（useAutoFollow.ts:106/134）。
  5. **Sidebar `dedupeSidebarSessions` O(n²)**（Sidebar.tsx:521-536），启动期 5+ 次 sessions 数组换引用反复触发；v2.16.87 只修了 isInternalPromptText 没修它。
  6. **4.25MB 单 renderer bundle 无分包**，parse/eval 300-800ms 阻塞首 paint。
- 已排除：bootstrap IPC 不含全量 sessions；`deduplicateTimelineEvents` 是 O(n) 非 O(n²)；bbc8d1a image refs 修复完整；v2.16.86 settle 轮询修复无回退。
- 下一步：用户拍板修复顺序（建议先修 1+2 持久化锤）；或用诊断版实测 `window.KIMIX_PERF()` 验证各根因占比。

## 2026-07-25 修复：启动持久化锤（根因 1+2 落地）

- 方案：`persistLocalConversationState` 引用守卫——store 的 sessions/pendingMessages 数组引用与「上次成功落盘或 hydration 登记」相同则跳过 prepare+strip+stringify，返回 `{success:true}`。
- 三条不变量（reviewer 独立审查产出）：登记只旧不新（入口捕获快照源引用，禁止 await 后 getState 现值）；hydration 必须先 `markConversationStatePersisted(restoredSessions, 当前pending引用)` 再 setState（订阅同步触发）；跳过必须返回 success（persist 是房间投递/Composer 的 pre-dispatch barrier，失败会回滚）。
- 落地：persistence.ts 守卫 + 登记 API；App.tsx hydration 两处先登记后 setState（pending 引用必须同时登记，否则 0→N flush 不命中——P0-b 二轮修正）；删除 repairKimiCodeHistoryBodies 4 处绕过防抖的显式落盘（订阅防抖兜底）；其余 9 处直接调用不动（无变化时守卫自动 no-op）。
- 附带收益：守卫跳过消除「hydration flush 把空 pending 覆盖盘上未发送草稿」的既有读写竞态。
- 提交：`5bfbe35`（守卫+登记+删 4 处+测试）、`d0605bf`（P0-b pending 引用+hydration 时序测试）。
- 验证：typecheck；persistence/useStatePersistence 定向 20+19；全量 1127 通过；build 通过。区分：守卫逻辑已验证；启动卡顿实测改善幅度未验证，待用户重启实测（可用 `window.KIMIX_PERF()` 对比）。
- 知识库：streaming-render-pipeline 补 startup persistence guard 段 + log。
- 下一步：用户重启实测启动卡顿；剩余根因（loadSession 4s race、eagerMarkdown×settle 窗口、Sidebar O(n²)、4.25MB 单 bundle）按实测占比逐个推进。

## 2026-07-25 修复：带图发消息「模型请求失败：/api/v1/files: HTTP 500」

- 现象：Server 路由发带两张截图的消息，整轮失败（截图显示 1 秒内报错 + 已完成）。
- 取证：错误格式锁定 `kimiCodeServerClient.request`（uploadFile POST）；wire.jsonl 无 prompt 帧（上传阶段即失败，prompt 未发出）；Server 0.29.1（PID 22904）16:32 起持续健康，本地同形态复现（FormData、1x1~20MB、并发两张、token 一致）全部 200——官方 Server 瞬态 500，Kimix 无法根治；`~/.kimi-code/files/index.json` 自 7-11 未更新（0.29.x 不再维护索引，新旧 id 格式不同）。
- 根因定性：Kimix 健壮性缺陷——upload 失败无任何回退，prompt 也不 fallback SDK 完成本轮（kimiCodeHost.ts:1110-1121 只给下轮换 SDK session）。
- 修复（`7ab9d3b`）：toServerPromptContent upload 抛错时图片回退 base64 内嵌（与 1fb6311 前官方发图路径同形态），视频不回退，13M base64 文本上限（超限时抛原始错误），console.warn 留痕。
- 验证：typecheck；定向 49/49；全量 1135 通过；build 通过。真实 500 瞬态无法本地复现，回退路径由单测覆盖。
- 知识库：runtime-routing 不变量 25 更新 + log。

## 2026-07-25 修复：启动 persist 风暴压平（用户实测「前 15s 仍 2-3 次卡顿」）

- 取证（diag.log 17:32:19-29Z 启动窗口）：longTasks 12 次共 3350ms、maxMs 851ms；persist.stripSessions 2 次共 392ms（修复前 5-7 次/10s，守卫生效）；timeSync 可见仅 ~400ms，其余 ~2950ms 在盲区——commitState 的 70MB stringify 在 Promise 异步段，timeSync 只计同步段显示 0ms。同窗口 2 条 kimiHistoryReconciliation.rejected 佐证修复循环在跑，2 次真实状态变化各触发一次全量 persist。
- 修复（`d6e0cb4`）：① resolvePersistDelayMs 加启动档——启动 30s 内非 streaming 按 10s debounce/30s maxWait（streaming 5s/60s、archive-delete/流式结束/切后台/beforeunload 显式 flush 均不变），窗口内 2-3 次全量 persist 合并为最多 1-2 次；② perfDiag 新增 timeAsync，commitState 改用它消除 stringify 计时盲区；③ runPersist 写 `persist.run` 归因日志（sessionCount/totalEvents/stripMs/commitMs/totalMs），下次取证直接可见每次落盘成本。
- 验证：typecheck；定向 26/26；全量 1132 通过；build 通过。实测改善待用户重启确认（diag.log 看 persist.run 条数与 longTasks 对比）。
- 知识库：streaming-render-pipeline 持久化段补启动档。

## 2026-07-23 发版：v2.17.0

- 决策：中等版本号跳至 **2.17.0**；Context 近似值、实验 dual-model、强制委派文案、子 Agent 互斥 UI 按用户指示本轮不改。
- 落地：context 合并仅取最近 user/compaction 边界之后的 status；kimix-media fileId 路径 `resolve` + 目录前缀守卫。
- 交付：`package.json` 2.17.0；`docs/release-notes/v2.17.0.md`；推 master + tag 由 CI 构建。

## 2026-07-23 修复：Composer 上下文弹窗「等待上下文数据」

- 现象：页脚已有 Context%，输入区背景信息窗口仍显示「等待上下文数据」。
- 根因：`getSessionContextUsages` 只读最新单条 status 的 `contextSize`，`usage.record` 无 contextTokens 时 hasContext=false。
- 修复：与页脚一致，对 agent 全部 status 做 `mergeMetricStatusUpdates`，无 context 时用 input 回填 used，并合并 contextLimit。
- 验证：sessionMetrics 33 项全绿；typecheck 通过；待用户截图弹窗。

## 2026-07-23 修复：页脚长时间「已完成」且缺 Context

- 现象：含子代理 turn 结束后页脚只显示「已完成」可持续数分钟；恢复后仍缺 Context。
- 根因：① `usage.record` 晚于 settle，期间 merge 只见 contextSize=0 壳且不认 turn usage → trailing 空；② merge assistant 从 first 取 model， intermediate 无 model 时 fallback 纯「已完成」；③ `mergeMetricStatusUpdates` 用 `??` 让 0 盖掉有效 context，且 usage.record 本身无 contextTokens。
- 修复：`preferPositiveMetric` 合并用量/上下文；usage 无 context 时用 input 作 used；merge assistant 保留任一可见 model；settle 无 usage 时合成 model-only trailing；fallback 优先模型。
- 验证：sessionMetrics/ChatThread/chatRenderItems 定向 89 项全绿；typecheck 通过；待用户截图。

## 2026-07-23 修复：kimi-web 思考组卡样式倒退

- 现象：过程展示选 Kimi Web 时，思考仍显示 Kimix 式「思考过程 / 已完成 ✓」soft-card。
- 根因：`1ce61d86` 新增 `KimiWebThinkingGroupCard` 并把 thinking 分支从 `KimiWebThinkingBlock` 改为组卡（与工具卡同构），偏离 `d42051cc`/`f9dd5b0a` 官方内联设计。
- 修复：删除 `KimiWebThinkingGroupCard`，thinking 分支恢复直出 `KimiWebThinkingBlock`；不改数据层合并/回放/直播视口，不改工具/子代理/审批组卡与 Kimix 模式。
- 验证：diff 与 `1ce61d86` 对称（-34/+1）；typecheck 通过；待用户截图验收。

## 2026-07-23 交接：验收构建已就绪

- 接手交接摘要（18 提交自 e3b5cde8，HEAD=`74585827`，版本仍为 **v2.16.105** 未 bump）。
- 本轮动作：`pnpm build` 成功；`scripts/restart-kimix-dev.ps1 --fast` 已拉起 dev；fingerprint 对齐当前 HEAD；Electron 主进程带 `--kimix-runtime-token`，renderer CDP **9222**。
- 工作区：已提交代码干净；仅存在若干 `.tmp-*` / perf 文档等 untracked，未纳入本轮。
- 下一步：用户按验收清单截图/实测 → 通过后 bump **v2.16.106** + release notes → 确认后推 tag（不手动 dist）。

## 2026-07-23 优化：窄宽度输入框底部按钮行布局

- 现象：右侧侧栏展开（composer 内容盒 ~517px）时，输入框下方按钮行变成"左组独占一行 + 右组按钮左聚右留白"，位置奇怪。
- 根因：index.css 两条 container query 冲突——`max-width:760px` 规则让工具行换两行且右组 `justify-end`；`max-width:520px` 规则又把右组改回 `flex-start`。composer surface 以内容盒计约 517px 时两条同时命中，后者胜出导致左聚。
- 修复：第二条阈值 520px → 420px，520-760 宽带只保留"两行 + 右组右对齐"的整洁布局，极窄（≤420）才回退左聚+换行。
- 验证：CDP 实测窄态 secondaryJustify=flex-end、子项 499→896 贴右缘无死区；vitest 1046 全绿；typecheck 通过。

## 2026-07-23 修复：历史轮页脚模型/用量缺失（wire 镜像水合）

- 现象：session_d1673cd4 末轮只显示"已完成"，无模型/上下文用量。用户疑自定义子代理模型所致。
- 根因（快照流程取证）：① 官方侧对该会话全部轮次 snapshot/transcript 的 model/usage 均为 null（与自定义子代理无关，wire 证明全部轮次含子代理都是 kimi-for-coding）；② Kimix 页脚来自直播 agent.status.updated（usage.currentTurn）的本地持久化，该轮直播帧当时未到达（瞬态）；③ 现行 0.29 Server 探针证明普通轮/子代理轮均正常下发 usage 帧，非稳定缺陷。
- 修复：Server 快照优先的历史加载合并 wire 镜像的 turn-scoped usage.record → StatusUpdate（时间序插入 + 身份去重），内容仍以快照为权威，页脚从官方 wire 记录水合。
- 验证：新增合并函数单测 3 项；真实会话 CDP 实测 loadKimiCodeSession 返回 16 事件含 3 条精确用量（54/22386、262/22472、510/25801），位置在各轮 turn.ended 之后；vitest 全绿、typecheck 通过。
- 跟进（用户复验仍显示"已完成"）：canonical 替换被 no-shrink 门禁拒绝（thinking-history-regression 606>487，门禁尽职）。补第二层——四个对账拒绝分支对保留的本地时间线做增量水合 `mergeMissingUsageStatusEvents`（状态是附加元数据，不受收缩门禁约束，身份去重防直播帧重复）。真实会话 CDP 复验：时间线 12 事件，三轮页脚全部到位（第 1 轮直播状态无重复，第 2/3 轮水合成功）。
- 跟进（头部/页脚模型不一致）：合成主 Agent 显示名取自会话当前模型（k3），对历史轮误示；按不变量 38 改为——水合/对账时用轮级 usage 状态给无模型 assistant 事件回填真实轮模型，头部在该显示名为模型派生时优先显示轮模型，自定义 Agent 名作为身份保留。真实会话 CDP 实测：3 个 assistant 全部回填 kimi-code/kimi-for-coding，头部渲染与页脚一致。

## 2026-07-22 验收修复：思考按钮省略、会话树卡片挤压、overrides 伪模型

- 思考按钮：`Composer` 思考强度按钮外层由固定 108px 改为 minWidth 108，档位名（如"思考 · 最高"）完整显示不再省略。
- 会话树卡片：右侧栏"官方会话树"头部的"新建子会话"由文字按钮改为与同排刷新一致的 32px 图标按钮（title/aria 保留语义），标题与说明不再被挤压竖排。
- overrides 伪模型：`readKimiModelConfig` 新增 `directModelSectionAlias`，只接受 `models.<alias>` 直接子表，过滤官方运行时写入的 `models.<alias>.overrides` 嵌套子表（含已删模型残留的孤儿 overrides）；单模型与 Provider 删除路径连带删除 `.overrides` 子表，防止再残留。
- 验证：真实 config.toml CDP 实测模型列表 14 个干净别名、零 overrides 伪条目；vitest 1036 全绿；typecheck 通过。

## 2026-07-22 Kimi Code 0.29.0 全量跟进（目标驱动）

- 范围：0.29 剩余跟进六项（思考强度 v2.16.104、视频 v2.16.105 已完成在先）。全程记录 `docs/kimi-code-0.29-followup.md`。
- 项1：`ServerTool`/`KimiCodeServerToolInfo` 接入 `/api/v1/tools` 的 `active`；MCP 面板工具目录区分"被策略禁用"（徽标+置灰+计数）；字段缺省按可用。
- 项2：`agent.created/disposed` 帧按会话跟踪（本地观测时间）+ 快照 `subagents`（官方时间）合并进运行时诊断 `agents`；MCP 面板新增 Agent 生命周期卡；不渲染聊天卡片。
- 项3：新增 `kimix-media` 特权协议，历史官方视频经 0.29 `fs:content`（ETag+Range）流式播放，替换整段 dataUrl；播放失败回退原 IPC 一次；CSP 增 `media-src kimix-media:`。生产构建 CDP 实测 loadedmetadata 与中点 seeked 成功。
- 项4：隔离临时 home 验证 0.29 v2 配置层重构与 Kimix 直写 config.toml 双向兼容（官方解析 Kimix 形状、目录列出别名、官方写入可复扫、无 [platforms]/platformId、merge 不破坏托管块）；无需代码改动。
- 项5：goal 续跑 prompt 泄漏三层证据齐全（SDK 解析跳过无 type 记录、0.29 快照对真实污染会话零泄漏、transcript 续跑 turn 标记 origin.kind=other 且文本消失），结论不需要兜底。
- 项6：#1970 双路由验证通过（Server :abort 20ms 结算零重试帧；SDK cancel reason=cancelled 零 retry 事件）。立项观察项已单独修复：`prompt()` 等待器同规则匹配 `prompt.aborted`（严格 promptId），Esc 后 dispatch 立即结算；新增单测覆盖异 id 不结算/同 id 立即结算。
- 知识库：runtime-routing 不变量 39 底座更正为 0.29.0/0.14.0，新增 74-76（kimix-media 流式、工具 active、Agent 生命周期诊断）；MCP 生命周期补 0.29 自动重连说明。

## 2026-07-22 v2.16.105 视频直接输入

- 目标：让粘贴、选择和拖入的视频作为官方多模态内容发送，不再把视频伪装成需要 Agent 自行读取的普通文件路径。
- 协议：Renderer 附件新增 `video` / `fileId` 元数据；Server 路由先经 `/api/v1/files` 上传，再用官方 `video + file` source 发送；兼容 SDK 路由仍接收 `video_url`，并在 retry/resume 时按需物化 Server 文件引用。
- 历史：官方 snapshot 中的 base64/file/url 视频都会恢复为用户附件；纯视频用户消息不再因空文本被丢弃。历史 file 引用在用户点击播放时才通过主进程下载，避免打开会话时批量加载视频。
- UI：加号浮层新增“上传图片或视频”；输入区显示 176×96 视频预览；消息历史使用 240×135 原生播放器，未加载的官方历史视频显示点击加载态。
- 约束：单个视频上限 50 MiB、每条最多 4 个、合计最多 100 MiB；历史文件当前按点击整段读取并转 data URL，不做流式 Range 播放。
- 缓存：`KIMI_HISTORY_CACHE_VERSION` 升至 15，避免旧缓存缺少视频类型与官方 file id 时继续覆盖规范历史。

## 2026-07-22 v2.16.104 主 Agent 思考强度弹窗

- 目标：将输入区原有“思考开/关”按钮升级为与权限选择一致的小弹窗，并真正配置当前主 Agent 的官方 thinking effort。
- 能力：按当前模型的 `support_efforts` / `default_effort` 生成选项；声明多档的模型只展示官方档位，不为不可关闭推理的模型虚构“关闭”；未声明档位的旧模型保留“关闭/开启”兼容项。
- 路由：空闲 runtime 通过新增 `kimi-code:setThinking` 即时应用；新建、恢复、房间 Agent 和长程入口沿用已保存强度。兼容值 `on` 在创建时仍省略，让 Kimi Code 使用官方默认；明确档位或 `off` 才写入会话 profile。
- 交互：运行中禁用切换，弹窗使用 16px 外层留白、8px 列表间距、52px 选项热区，并显示当前强度与模型能力加载态。
- 兼容：旧设置只有 `defaultThinking` 时迁移为 `on/off`，不会把历史“关闭”误恢复成“开启”。

## 2026-07-22 v2.16.103 子 Agent 路由切换到官方 0.29.0 底座

- 核对：本机官方 CLI 已升级到 `0.29.0`；Release 新增 v2 自定义 Agent、委派约束与工具门禁，但未合并仍为 Open 的 dual-model-routing PR #1996。
- 修正：vendored Node SDK 不再直接取 PR 分支的 `0.13.4` 树，而是以官方 `0.29.0` tag（Node SDK `0.14.0`）为干净底座，仅移植 PR #1996 的 6 个功能提交。
- 保留：Kimix 的旧子 Agent sticky resume/retry 与 `subagent.spawned` 实际模型/思考强度审计补丁继续叠加。
- 官方验证：legacy agent-core 66 项、agent-core-v2 45 项、Node SDK 15 项定向测试通过；Node SDK 完整构建通过。
- 自定义 Agent：官方 Server 真实探针 14/14 通过，临时项目中的 `.kimi-code/agents/kimix-probe.md` 被自动发现并以 `subagentName=kimix-probe` 启动。
- 路由边界：保持“跟随主 Agent”不会再迁移到 legacy SDK，继续保留官方 v2 Markdown Agent；只有明确选择独立模型/思考强度才进入兼容路由，侧栏会提示这一取舍。

## 2026-07-22 v2.16.102 会话级子 Agent 模型配置

- 新增：会话侧栏在 Kimi Code 与 Git 之间提供“子 Agent”卡片，可为当前单一会话 Agent 设置新子 Agent 默认模型与思考强度。
- 路由：普通 Agent 与 AgentSwarm 共享会话级默认值；BTW 继续使用主模型。运行中修改进入 desired 状态，在下一轮发送前应用。
- 房间：配置归属当前唯一 mutation owner，不写入房间外壳或其他 Agent；Server 会话按同一官方 ID 迁移到 SDK，不创建重复 owner。
- 稳定性：模型与思考强度原子应用，第二项失败会回滚两项；已存在的子 Agent 在 resume/retry 时保持创建时模型，不中途切换。
- 审计：`subagent.spawned` 记录实际 `modelAlias` 与 `thinkingEffort`；配置模型被删除时 UI 明确标记不可用并拒绝静默回退。
- 上游：vendored SDK 基于开放 PR #1996 commit `30f7418c`，叠加 Kimix sticky resume 与 spawn 审计字段补丁。

## 2026-07-22 v2.16.101 模型选择统一使用 URL 探测

- 调整：删除模型编辑卡内的“从官方目录选择模型”按钮、目录模型下拉框和自动预填逻辑。
- 新流程：外部供应商模型统一从上方 Base URL 探测卡选择并填充；手动输入仍作为 models 接口不可用时的兼容入口。
- 边界：官方 Provider 目录仍可用于填充供应商名称和 Base URL，但不再介入模型选择或模型表单。

## 2026-07-22 v2.16.100 模型探测与添加流程相邻

- 问题：“从 Base URL 探测模型”卡位于供应商连接表单内，与它实际填充的“添加/编辑模型”表单被模型列表隔开，交互因果不直观。
- 调整：探测卡移入外部供应商的模型管理区，放在添加/编辑模型卡正上方；两张独立卡保留 14px 显式间距，探测结果仍直接填充下方表单。
- 回归：组件测试固定“探测卡在添加模型卡之前”的 DOM 顺序，并继续验证探测选择、保存和列表即时更新。

## 2026-07-22 v2.16.99 新增模型落盘后仍不显示

- 真实证据：设置页一直只显示 `opencode-go` 的 4 个模型，但本机 `config.toml` 已经存在完整的 `opencode-go/qwen3.7-plus` 和后续保存的 `opencode-go/qwen3.7-max` 段落。
- 根因：Server/SDK 写入已成功落盘，主进程却立即用 SDK 未更新的内存快照构造保存响应和后续刷新结果，导致 renderer 持续收到旧 4 项。
- 修复：配置读取合并 SDK 能力与磁盘持久状态；外部 OpenAI Provider/模型以 `config.toml` 为权威，SDK 只补充未落盘的官方受管模型和动态凭据能力。新增项会立即出现，已删除的外部项也不会被 SDK 旧快照复活。

## 2026-07-22 v2.16.98 恢复会话 runtime 单归属

- 现象：老会话切换模型后发送持续计时，回复却进入同 ID 的新空会话；新会话因没有原轮占位和模型元数据，只显示通用“已完成”。
- 根因：模型切换/恢复返回新 runtime ID 与官方目录同步并发，目录可先创建同 ID 空镜像；事件路由之后用首个路径匹配猜 owner，导致原会话轮次与回复分离。
- 修复：runtime 绑定与空镜像归档在同一次 store 更新中完成；目录同步优先保留已有正文的稳定本地会话。事件/状态路由只接受唯一 owner，或存在多个候选时唯一处于活动轮的 owner；仍歧义则记录诊断并拒绝串线。
- 安全边界：只自动归档同项目、精确同 runtime ID 且没有任何事件的目录镜像；有正文的重复会话始终保留，不按数组顺序猜测或自动合并。

## 2026-07-22 v2.16.97 编辑模型卡片圆角统一

- 现象：“编辑模型”区域单独使用 12px `rounded-xl`，与上方模型行及 Kimix 设置卡统一采用的 `var(--radius-sm)` 不一致。
- 修复：编辑模型容器直接复用 `.kimix-settings-card`，统一标准边框和圆角；保留原有底色、14px 区块间距及 16px 左右内边距。
- 回归：组件测试确认模型编辑区位于标准设置卡容器内，避免后续重新写入独立圆角。

## 2026-07-22 v2.16.96 模型设置隐藏内部实现信息

- 目标：模型配置页只呈现用户需要操作和判断的内容，不展示已经由 Kimix 自动处理的运行时实现细节。
- 调整：隐藏 Server 运行时目录、运行时模型能力列表、Code Home、代理变量、微压缩说明和 `config.toml` 物理路径；保留当前模型、Provider 凭据概况、诊断/刷新入口及供应商与模型管理。
- 性能：模型配置刷新不再额外请求仅用于已隐藏目录卡片的 Server 模型目录；诊断能力和底层微压缩行为保持不变。

## 2026-07-22 v2.16.95 删除模型后全局无法输入字符

- 现场：删除模型并关闭确认框后，对话 Composer 与模型设置输入框均可获得焦点、可用 Backspace 删除，却不能输入新字符；截图中的字体 CSP 和历史对账日志与键盘输入无关，截图版本为旧窗口 v2.16.88。
- 根因：模型/供应商删除使用同步原生 `window.confirm`，它暂停 Electron renderer；Windows 下返回后可能破坏输入法文本提交状态，因此普通删除键仍有效而字符组合无法提交。
- 修复：模型和供应商删除改用 Kimix renderer 内异步确认弹窗，支持 Escape、遮罩取消、焦点圈定和删除忙态，不再进入同步原生对话框。
- 回归：确认点击删除只打开应用内 `aria-modal`，不会调用 `window.confirm`；确认后模型行即时消失、弹窗卸载，设置输入框仍可接收新字符。

## 2026-07-22 v2.16.94 删除模型后旧缓存覆盖界面

- 现象：用户确认删除模型后，列表没有立即移除该模型；截图版本为 v2.16.93。
- 根因：删除 IPC 已返回从 `config.toml` 读取的正确新配置，但 renderer 等待 SDK 二次重读后才更新页面；SDK/Server 若短暂返回删除前缓存，旧模型会覆盖写入结果。
- 修复：配置写入响应立即成为设置页权威状态；后台仍执行强制重读，但只有重读内容与本次写入一致时才视为同步完成，不一致时保留写入结果并提示后台仍在同步。
- 回归：受控设置页 fixture 模拟“删除返回 1 个模型、紧随其后的 SDK 重读仍返回 2 个模型”，确认删除行即时从 DOM 消失且旧快照不会二次写回。

## 2026-07-22 v2.16.93 供应商配置即时刷新与模型探测

- 保存供应商或模型后不再只信任写入响应；renderer 会立即重新调用 `getKimiModelConfig`，以磁盘与 SDK reload 后的配置刷新设置页，并广播模型配置变更给会话模型选择器。
- 第三方 OpenAI-compatible Provider 可用当前 Base URL 与 API Key 探测模型：主进程优先请求 `{base}/models`，无版本段时有限回退 `{base}/v1/models`，只接受接口真实返回的模型 ID。
- 探测请求在主进程执行，API Key 使用 Bearer 认证；响应限制 2 MB、最多保留 1000 个去重模型，12 秒超时，不把密钥暴露到 renderer 网络请求中。
- 设置页可直接选择探测结果，自动填写模型 ID 和基于 Provider 的稳定别名；手动填写仍作为不支持模型枚举接口时的兼容入口。
- 验收：URL 推导、OpenAI 列表解析、认证/回退、探测后选模、供应商/模型保存后强制重读均有自动化覆盖；全量结果见本轮提交。

## 2026-07-22 v2.16.92 文件变更统计与历史预览

- 真实样本：Project06 提交 `2933405` 对 `assets/data/storylets.json` 是 `+1/-1`，旧卡片却显示 `+0/-0` 且“摘要”不可点击。
- 根因：结构化 diff 与 Edit fallback 用新旧文本总行数差冒充增删统计，等行替换必然归零；`TurnChanges` 又把上游缺失统计强制填成零。预览仅按路径寻找会话中最新 diff，既无法恢复已提交修改，也可能借用后续轮次的同路径内容。
- 修复：Myers 行级最短编辑路径计算真实增删；未知统计保持未知。结构化摘要携带稳定 `diffEventId`；文件行点击原地展开。缺少结构化 diff 时，主进程只接受明确提交号或时间窗内唯一触碰该文件的提交，并用 `git show`/`numstat` 返回受限大小预览；多候选拒绝猜测，只有五分钟内的新事件允许回退当前工作区。
- 历史来源：成功恢复后将不可变 commit SHA 写回源摘要；同轮聚合保留源事件 ID，撤销和预览不再拆解含冒号的复合 ID。
- 验收：定向测试覆盖等行替换、未知统计、同路径跨轮隔离、唯一/歧义提交恢复和工作区预览；全量结果见本轮提交。

## 2026-07-22 v2.16.91 重试轮混入历史工具 / 统计气泡只剩 Context

- 真实会话 `session_d2092d06-9027-4105-9240-3bc0bc0ca58d`：新 turn 12 实际只执行 10 个工具，UI 却瞬间显示 25 个；本地缓存共有 237 条 `tool_call`，同一官方 call ID 在重连快照中被重复追加。
- 根因：`recoverSnapshot` 先重放完整 `history` 再交付 `in_flight`；活动重试轮只过滤本地已有结果，没有按最新用户时间边界拒绝旧历史帧，且已完成工具不参与 call-ID 去重。重试占位没有写入目标模型，导致“消息发送中”头缺模型名。
- 修复：活动轮拒绝早于最新用户边界或无时间归属的 history 帧，历史帧不得继承当前 room turn identity；工具按官方 call ID 终身幂等；cache v14 整包替换仍要求 canonical 覆盖全部唯一 call ID，分页外旧工具则只在本地已有稳定 snapshot 行时清理同 call ID 副本；重试占位与请求共用同一目标模型。
- 统计气泡：同一轮的 usage 与 context 事件可能被正文/工具隔开，旧逻辑只取最后一个 metric，故只剩 Context；现改为在单轮内部按字段合并模型、输入、输出与 Context。
- 证据：官方 seq 503-532 对应 turn 12 的 10 个调用；IndexedDB 尾部在新用户事件后追加了 25 个时间戳更早的历史工具。详见 `docs/issue-retry-history-replay-snapshot.md`。
- 实机：新构建 `index-CDYdIW8Y.js` 下，目标会话从 237 个工具收敛为 114/114 唯一；孤立 `Context: 20.22%` 气泡不再渲染，下一轮完整 usage 仍显示模型、输入、输出和 Context。

## 2026-07-22 v2.16.90 流式正文因草稿身份切换而局部倒序

- 真实会话 `session_259f8e2c-6581-49fa-9f08-20a190878d03`：官方 wire 的首段始终是「你好霖江路。我会补上…」，终态正文也正确；Kimix 运行中曾显示「霖江路。我会你好补上…」。
- 根因：同一 `roomMessageId` 的本地占位 `agentTurnId` 会切换为官方 `agentTurnId`，旧实现留下两个草稿；`commitActiveTurnDraftsToBatch` 对它们逐个 `unshift`，稳定反转到达顺序。终态权威帧 REPLACE 后才恢复正常。
- 修复：同一 session/Agent/roomMessage 的草稿在 turn identity 切换时迁移到新 key 并继续累积；多个草稿提交时先按创建顺序收集，再一次性前置到边界事件之前。
- 文件变更裁决：Project06 失败 turn 11 无工具；紧邻的 turn 10 只改 `assets/data/storylets.json`。另两个文件来自 turn 3/6，`v2.16.89` 显示一个文件是正确归属，不是未来丢失。
- 验收：两条回归测试先稳定复现「后段 + 你好」倒序，再验证身份迁移与批量顺序。

## 2026-07-22 v2.16.89 失败轮错误继承旧文件变更

- 真实会话 `session_d2092d06-9027-4105-9240-3bc0bc0ca58d`：最新 turn 11 只有 `503 auth_unavailable`，没有工具调用；被错误聚合的三个文件实际来自历史 turn 3/6/10。
- 根因：快照重放虽给工具结果稳定 ID，但由工具结果派生的 `change_summary` / `diff` 仍使用随机 ID并盲目追加到时间线尾部；失败轮的渲染聚合因此把旧摘要当成当前轮变更。
- 修复：派生事件使用源工具结果的确定性 ID并继承轮次身份；重放时在源工具旁幂等 upsert；渲染前按用户时间边界修复旧版本已经持久化的迟到摘要，且不改动旧正文。
- 验收：真实事件链已核对；`eventMapper` 与 `chatRenderItems` 回归测试覆盖重复重放和已污染历史；全量验收见本轮提交。

## 2026-07-21 v2.16.88 流式正文空白/问候重复

- 现象：输出中正文短/像用户复述；结束后完整但「你好霖江路」出现两次。
- 根因：draft 傻拼接 + 完成/barrier 全文再 append；Body 缺 turnId 时订不到 draft。
- 修复（不动性能路径：draft 仍只写局部、合帧 10fps、权威帧仍走 formal）：
  1. draft `appendStreamingText` 前缀安全合并（防累积帧加倍，真 delta 仍 concat）
  2. 权威正文帧（complete/barrier/stable）到达时 **丢弃 draft** 不 commit
  3. open assistant：complete/barrier 带 body → **REPLACE**；live 用前缀安全 merge
  4. Body draft key 回退 `roomAgentActivities.activeTurnId`
- 验收：973 测试 + typecheck；用户复测流式可见、完成后问候不重复。

## 2026-07-21 v2.16.87 CDP CPU profile 主因：isHiddenInternalSession 全量扫 events

- 取证：lag-watch 抓到 stall lag=3425ms / 7828ms；profile self 热点：
  - `areRelatedSidebarSessions` / `dedupeSidebarSessions`（侧栏每次 sessions 更新）
  - **`isInternalPromptText` ~3s**（对每条消息 content 做正则）
  - `commitState` + IDB `put` ~1–2s（大状态落盘，次要）
- 根因：Sidebar / useStatePersistence 订完整 `sessions`；每次流式 flush 换数组 → 对**每个会话全量 events** 跑 `isHiddenInternalSession` → 每条 content 正则。长会话 + 多会话 = 每秒数百碎任务，无 >50ms longtask。
- 修复：`internalSessions.ts`——WeakMap 按 session 引用缓存；正文只取头 800 字；只扫前 6 条 user/steer；prompt 文本 Map 缓存；协作 agentEvents 同样限扫。
- 验收：968 测试 + typecheck + build；用户重启 2.16.87 复测卡顿。

## 2026-07-21 v2.16.86 贴底 settle 空转风暴（CDP 卡顿取证）

- 证据：lag-watch 测到主线程 timer lag 1733ms；diag 在 07:09:53 起 1.5s 内 `settleSessionAtBottom`→`scrollToBottom` token 37→50+ 连打，且 height 已稳定在 9187/8681；10s 窗 auto-follow 写 scrollTop 23 次。
- 根因：`settleSessionAtBottom` 每 80ms 递归贴底最多 6s，**从不检查是否已在底部**；`sessionAutoBottomStableRef` 写了从未用于提前退出；每次还 `writeDiag` IPC（before+after）→ 每秒数十次跨进程小任务，与「无长任务但事件循环停滞」一致。
- 修复：已在底部且布局连续 3 次稳定则结束 settle；auto 贴底 no-op 直接 return；递归去掉双重 rAF/双重 scroll；轮询 80→200ms。
- 工具：`scripts/cdp-cpu-profile*.mjs`（内联采样已修）。
- 验收：typecheck + viewport 测试；用户复现卡顿对比 diag 中 settle 风暴是否消失。

## 2026-07-21 v2.16.84 冻结/爆发输出根因：running-sample 全量历史对账

- 现象：输出中计时器冻结 11-20s 后跳变；正文长期不出、然后一下一大波；"已完成"复发。
- 根因（归因数据 + 代码核验）：运行中对账循环在"流静默 4s 且状态 running"时触发 running-sample——**每次拉取整个官方历史**（IPC 传输 + 渲染主线程反序列化）+ `mapHistoryEvents` 全量映射 + `reconcileAgentCanonicalHistory` 全量对账。长思考（静默 8s+）时每 ~4s 触发一次，主线程秒级停滞（实测 lagMs 15225，无长任务归因说明成本在 IPC 反序列化/大批量小任务而非单个长 JS 任务）。正文"爆发"= 完成快照经对账一次性换入；冻结窗口中对账/权威帧把事件置完成 = "已完成"复发。
- 修复：触发阈值 4s → 30s（30s 静默且 running 才是"可能丢事件"的强信号，频率降 10 倍）；fetch/map/reconcile 三段加 `timeSync("runningSample.*")` 归因，下次复现可在 diag.log 直接看到各段成本。
- 说明：正文"一阵不出然后一大波"还有一部分是上游交付语义（deepseek 静默思考约 20s 后正文以大帧送达，历史快照证实正文为单个 completionBarrierReplay 大帧），不是 Kimix 渲染问题；本会话同时有多个会话的后台对账（含本机另一个 Kimi 会话）也是背景噪音。
- 测试：全量 962 + typecheck + build；验收待用户复现（diag.log 看 runningSample.* 三段耗时）。

## 2026-07-21 v2.16.83 流式卡顿三轮根因（归因数据驱动）

- 取证（v2.16.82 埋点 + 用户复现 diag.log + 视频）：
  1. 10s 窗口 flushStreamEvents 触发 395 次（~40/s），avg 14ms → 55% 主线程。根因：tool_call 的 rawArguments 按 token 流式增长，被 A3 的边界规则误判为立即 flush；该会话正在跑 python 改 storylets，参数是整段替换文本。
  2. 计时器冻住 11s→35s 跳变，但 JS 侧计时全部正常（projection 0ms、renderItems 0ms、persist ~50ms）→ 剩余饱和来自浏览器文本 shaping/布局：实时思考区每帧渲染完整思考文本（56KB）+ 正文 60fps 重排。
  3. React Profiler 数据缺失的原因：生产版 React 不触发 Profiler 回调，别再用它测 commit。
- 修复：
  1. `isDeferrableStreamEvent`：`tool_call && status === "running"` 回到 80ms 批（参数流）；完成（非 running）仍立即。
  2. `capLiveThinkingRenderText`：实时思考只渲染末尾 2000 字符（视口仅 144px）。
  3. draft 通知 cadence rAF → 100ms（STREAMING_NOTIFY_MS，滚动中 250ms 不变），流式文本 10fps。
- 测试：useEventStream deferrable 更新、draft 通知等待时间适配、thinkingBlocksCap +2；全量 962 + typecheck + build。
- 知识库：streaming-render-pipeline 增加"JS 便宜后布局是主成本"一节 + log。

## 2026-07-21 v2.16.82 卡顿归因埋点

- 真实数据基准（913 事件）：投影 8.2ms、renderItems 0.9ms、merge 0.1ms——渲染热路径无秒级瓶颈，停止盲修。
- 埋点（`kimix_perf_diag=1`）：timeSync 计时 flushStreamEvents/projectCollaborationTimeline/buildRenderItems/persist；ChatThread 包 Profiler；PerformanceObserver longtask；每 10s 汇总写 diag.log。

## 2026-07-21 v2.16.81 流式全局卡顿二轮根因（持久化锤 + 状态事件失去批处理）

- 现象：v2.16.80 后输出仍全局卡顿，菜单复制会话 id 困难。
- 取证（IndexedDB blob）：持久化的会话值每代约 140MB（UTF-16，约 70MB JSON 文本）。输出期每次 80ms flush 都会调度防抖落盘（debounce 900ms / maxWait 5s）→ 每 ~5 秒一次：全量遍历 + JSON.stringify(70MB) + IDB 结构化克隆 140MB + 落盘 ≈ 1-3s 主线程阻塞 + 巨量 GC，周期性冻结所有交互（与 watchdog 10-14s 冻结一致）。
- 第二根因（自查 A3 过度修正）：`status_update`（token 计数）与 running 子代理进度被归为"边界事件"立即 flush，高频信息事件绕过 80ms 批处理，每个都触发整树重渲染。冻结报告 lastEventType=status_update 佐证。
- 修复：
  1. `resolvePersistDelayMs`：流式活跃期间落盘降到每分钟最多一次；runningSessionId 结束、归档/删除、切后台、卸载时立即落盘。Server 会话崩溃后可从官方历史重建，窗口安全。
  2. `isDeferrableStreamEvent` 扩到 status_update 与 running 子代理进度（留在 80ms/250ms 批内）；真正边界（工具生命周期、审批、提问、错误、完成、子代理状态跃迁）仍立即 flush。
- 测试：persistDelay +2、useEventStream +1；全量 960 + typecheck。
- 后续（若仍卡）：持久化分片（按会话增量序列化，消除 O(全量状态)）；projectCollaborationTimeline 每次 flush 对每条 room 消息重跑 delivery 解析的成本。

## 2026-07-21 v2.16.80 流式输出全局卡顿根因修复（draft 逐 token 唤醒）

- 现象：Agent 输出时全 UI 卡顿，菜单里复制会话 id 都困难（watchdog 曾有 10-14s 冻结报告）。
- 第一性原理核算（每个 SSE delta 在主线程的成本）：
  1. `applyActiveTurnDraftDelta` 每 token 跑完整 `mergeEvents`（thinkingParts 全量数组拷贝 O(n)/delta → O(n²)）。
  2. `notify(key)` 每 token 同步唤醒 `useSyncExternalStore` → 整个 AssistantMessageBubble 重渲染：ProcessBlock（thinkingBlocks 重建）+ BodyBlock。
  3. 每次渲染对**全量正文**跑 `normalizeMarkdownContent`（5 层正则修复栈）+ `splitStreamingPlainBlocks`。
  - kimi SSE 是 token 级碎片（快照中看到 "Test"/" passes"/". Now" 这类），30-100 delta/s × 每次 O(累计内容) → 主线程饱和，菜单/点击全部饿死。B1 把 80ms 批处理从热路径上拿掉后，渲染频率从 12.5/s 变成 delta 频率，比 B1 之前更差。
- 修复（三刀，全部对准每帧成本）：
  1. `scheduleNotify`：draft 通知合并到每 rAF 最多一次；用户滚动活跃时降到 250ms 定时器（scroll-yield）；`take`/`clear` 提交路径同步 flush，不丢更新。
  2. draft 合并改 append-only（snapshot/barrier 帧上游已排除，保留 mergeEvents 兜底），不再每 token 跑完整 merge 机器。
  3. 流式 plain 路径跳过 `normalizeMarkdownContent` 整套正则修复栈，直接用原始 content；settled 后 rich 路径不变。
- 测试：activeTurnDraftStore +3（按帧合并/提交同步 flush/thinkingParts 累积）；全量 957 + typecheck。
- 知识库：streaming-render-pipeline 增加"draft 通知必须合帧"不变量 + log。

## 2026-07-21 v2.16.79 撤回后模型看到重复内容块修复（session_01ea935b）

- 现象：用户撤回一条消息并重发，Agent 思考中说"The user sent the same block twice"。
- 快照取证（IndexedDB blob）：官方消息 `msg_01KY04Q44PZFASSHAJCPPYJHYV`（16:11 首次发送，无回复）与本地重发 `a3j0r8wth`（16:13，同文）都在时间线中；回答该重发的助手思考里确认模型上下文有两份相同内容块。首次发送已派发（官方历史有记录），但该轮没有任何官方回复证据。
- 根因：撤回判定 `needsOfficialUndo = hasOfficialTurnEvidenceAfterUser(...)` 用的是"该轮有没有官方输出证据"，而不是"这条消息有没有派发到官方运行时"。已派发但无应答（失败/静默轮）的消息没有输出证据 → 走本地 truncate 分支，官方历史里的消息从未被 undo → 重发后官方历史有两份 → 模型看到重复；之后 reconciliation 又把官方那份回放为 snapshot 用户事件，本地也显示两份。
- 修复：无输出证据时，撤回前加载官方历史，用 `officialHistoryHasUserMessageAsLatest`（officialUserEventId 或空白归一化内容回声，且必须是官方最新用户轮）判定是否真正在官方历史中；在则走官方 undo（count:1 只撤最新一轮），不在才走本地撤回；历史加载失败回退本地撤回（不阻塞用户操作）。
- 测试：eventHelpers +4（id 匹配/内容回声/非最新轮/空输入）；全量 954 + typecheck。
- 知识库：runtime-routing 新增 19b + log。

## 2026-07-21 v2.16.78 消息气泡提前"已完成"治理（settle 权限分级）

- 现象：Agent 输出中气泡经常自己变成"已完成"。用户判断正确——兜底太强制。
- 排查（explore 子代理全路径梳理 + 代码核验）：
  - 路径 A（状态事件终态 App.tsx:2862）：权威（Server prompt.completed），保留立即 settle。
  - 路径 B（运行状态轮询 → settleTerminalRoomAgent）：启发式，1.5s×2 次 poll，步间隙 busy/status 抖动即可误判；原守卫（hasTurnReceivedBody）只保护空气泡，已有内容的轮次无保护。
  - 路径 C（hydration 一次性状态查询）：单发无守卫。
  - 路径 D（持久化 prepareEvents）：把 A/B/C 的误判永久烘进磁盘。
  - 路径 E（step.end end_turn 标记）：prompt scope 已过滤，SDK turn scope 语义正确，不动。
- 修复：`settleInactiveEvents` 增加第 4 参 `guardRecentActivity`——时间线内有任何事件比 STALE_TIMELINE_WORK_MS（2min）新时，不强制完成未完成助手、不删空 placeholder；全部静默过期后与立即模式行为一致（真实结束帧丢失也能在 stale 窗口内收敛）。应用到路径 B（roomAgentControl.settleTerminalRoomAgent）、C（App.tsx 4 处 hydration）、D（persistence.prepareEvents）。
- 测试：eventHelpers +3（活跃时保留/全 stale 后收敛/立即模式不变），roomAgentControl 1 改 1 增（stale 后完成/近期事件保持开放）；全量 950 + typecheck。
- 知识库：runtime-routing 新增 18i + log。

## 2026-07-21 v2.16.77 输出中过程区自动折叠修复

- 现象：Agent 输出中，用户手动展开过程详情后，过一会自行折叠回单行。
- 根因：过程摘要的展开状态是组件内 useState + ref，无跨挂载持久化。助手泡的 React key 是渲染事件 id：
  1. 轮次无助手事件时渲染 pending 占位泡（id `assistant-pending-<userId>`），首个正式助手事件出现后换成 merged 泡（id `assistant:<agentTurnId>`）→ key 变化 → 整泡重挂载，expanded 与 manuallyExpandedRef 一起丢失；B1(draft) 推迟首个正式 assistant 事件（要等第一个边界事件提交 draft），拉长了这个窗口。
  2. merged id 在 first.agentTurnId 缺失时回退 first.id，visible[0] 变化也会改 key。
  3. 重挂载后 final-content transition 的手动守卫（manuallyExpandedRef）失效，首次 hasFinalContent 上升沿即自动折叠。
- 修复：
  1. pending 占位 id 在 agentTurnId 已知时用 `assistant:<agentTurnId>`（与 merged id 一致，占位→真实不再换 key）；merged id 回退加 roomMessageId 档（ChatThread.tsx）。
  2. 手动展开/折叠意图按轮次持久化到模块级 LRU Map（`src/utils/processManualExpand.ts`），useState 初始化与 auto-collapse 守卫都读它，任何剩余重挂载都恢复用户选择（MessageBubble.tsx）。
- 测试：processManualExpand +3、chatRenderItems +1（pending 与真实泡 id 一致）；两处既有断言按新稳定 id 更新；全量 946 + typecheck。
- 知识库：chat-viewport-state.md 新增 Render item identity 一节 + log。

## 2026-07-21 v2.16.76 官方回放消息乱序修复（session_01ea935b）

- 现象：最终正文末尾出现一句本应更早出现的话（"先改这两处，同时拉全部多场景剧情。"）。
- 快照取证（IndexedDB blob）：官方消息 `..._000389`（计划句，complete、stable、barrier replay）在事件数组里位于 `..._000397`（最终答案）之后；全文仅出现一次；diag.log 显示当日多次 kimiHistoryReconciliation rewrite。根因：回放不保证按官方顺序到达，000389 迟到且无可绑定的未完成 placeholder 时，mergeEvents 把"未见过的 stable 事件"直接追加到末尾。
- 修复：`mergeEvents` 解析 snapshotMessageId 末尾 `_NNNNNN` 官方序号，迟到消息插入到同族第一个更大序号的 stable 事件之前；无序号/无更晚兄弟时保持末尾追加（eventMapper.ts `officialSnapshotSequence`）。
- 测试：eventMapper.test.ts +3（迟到插入、最大序号末尾追加、无序号后缀末尾追加），全量 942 + typecheck。
- 与性能改动（PR-A1/A2/B1）无关：这是历史绑定/回放管线问题。
- 遗留：已落盘的该会话乱序事件不会自动修复（reconciliation 按 size 判等，31217==31217 已通过）；如需修复存量数据另立项。
- 教训：会话全量事件在 IndexedDB blob（`IndexedDB/file__0.indexeddb.blob`），UTF-16 存储；localStorage leveldb 里只有摘要；CDP 需应用以 --remote-debugging-port 启动。

## 2026-07-20 v2.16.75 流式滚动性能审核修复

- 背景：对 PR-A1/PR-A2/B1 的审核发现 3 个 P1 + 1 个 P2，按用户确认修复。
- 做法：
  1. 触屏（touchstart/touchmove）与 scrollbar 拖动（native scroll + userScroll 模式）接入 `noteUserScrollActivity`；程序化写入不计入（仅 `userScrollRef` 为真时记）
  2. 导航轨降频加尾部补偿：节流丢弃时起 200ms trailing 定时器，保证滚动收尾有一次最终测量
  3. `deliveryFallbackEvents`（失败/不确定 delivery 的 error、开放 delivery 占位）按 message 引用 WeakMap 身份缓存，签名为 roomAgentId+agentTurnId+status+error
  4. B3「运行中折叠过程详情」加用户设置：`collapseProcessWhileRunning`（localStorage `kimix_collapse_process_while_running`，默认开），SettingsPanel 过程展示方式区加开关，经 AssistantProcessBlock 透传到 AssistantProcessSummary
- 知识库：新增 `knowledge/architecture/streaming-render-pipeline.md`，更新 architecture/index.md 与 log.md；`pnpm knowledge:validate` PASS
- 验收：全量 939 + typecheck；新增 fallback 身份缓存测试
- 注意：Windows 上 `perl -pi` 会把文件改写成 CRLF，本仓库禁止用；混合行尾文件 Edit 工具匹配不稳定时用 python 保持原行尾改写

## 2026-07-20 v2.16.74 B1 activeTurnDraft

- 计划：`docs/plan-streaming-scroll-performance.md` B1。
- 做法：
  1. `activeTurnDraftStore` 按 `sessionId + roomAgentId + agentTurnId` 隔离
  2. 可延迟 text/thinking delta **只写 draft**（无 snapshot barrier）；不触发 80ms session flush
  3. 工具/完成/失败等边界与 `flushStreamEvents` 先 commit draft 再 merge 正式 events
  4. 活跃助手 Body/过程 thinking 订 draft；历史泡不订
  5. flag：`kimix_active_turn_draft`（默认开，`"0"` 关）
- 回退：无 agentTurnId / 有 snapshotMessageId 走旧路径
- 验收：全量 938 + typecheck；用户实机边输出边滚 + 多工具回合正文完整性

## 2026-07-20 v2.16.73 PR-A2 + B2/B3 流式滚动性能

- 计划：`docs/plan-streaming-scroll-performance.md` v2。
- 已完成：
  1. A4：`collaborationTimeline` WeakMap 身份保持投影（历史事件引用跨 flush 稳定）
  2. A5：`useProjectedTimeline` 仅在 agentEvents/messages/events 引用变化时重投影
  3. A2：memo 引用快路径 + WeakMap memoKey；助手泡拆 Process/Body 子树
  4. B2：贴底 `scrollToBottom("auto")` 同帧 rAF 合并
  5. B3：运行中过程区默认折叠单行摘要
- 后续：v2.16.74 完成 B1
- 验收：全量 932 + typecheck；用户生产 build 边输出边滚体感

## 2026-07-20 v2.16.72 PR-A1 流式滚动性能（Phase 0 + A1 + A3）

- 计划：`docs/plan-streaming-scroll-performance.md` v2，PR-A1 低风险有 flag。
- 已完成：
  1. `perfFlags` / `userScrollActivity` / `perfDiag` 基线埋点约定
  2. A1：流式 StreamingPlain（无 katex/hljs，fence 分块）；完成或滚动停后再 SettledRich
  3. A3：滚动活跃 350ms 让路（保锚/保底距/resize/导航轨降频）；flush 滚动时 250ms，边界事件立即 flush
- 后续：v2.16.73 完成 PR-A2 + B2/B3
- 验收：定向单测 + 全量 + typecheck；生产 build 体感复测由用户回传

## 2026-07-20 v2.16.71 模型按钮恢复自适应宽度

- 用户反馈：固定 168px 导致长模型名显示不全。
- 修复：撤回按钮定宽，保留 popover 打开时横向锚点冻结（resize/scroll 才重锚），弹窗仍不横移。
- 下一步：用户切长短模型名确认弹窗不晃、长名可截断展示。

## 2026-07-20 v2.16.70 模型菜单选中后弹窗横向位移

- 根因：`ContextBarPopover` 右对齐用 anchor `rect.right`；选模型后按钮宽度随名称变，ResizeObserver 重算 left，弹窗横移。
- 修复：打开时冻结横向左右边缘，仅窗口 resize/scroll 时重新锚定。
- 验证：popover 定位 3 项 + typecheck。

## 2026-07-20 v2.16.69 SDK 0.28 + 多实例端口

- 目标：完成 0.28 跟进剩余两项——vendor SDK 升 0.28、多实例端口策略。
- 已完成：
  1. `vendor/kimi-code-sdk` 自 tag `@moonshot-ai/kimi-code@0.28.0` / `a05228c6` 重打，MCP 4s 补丁保留。
  2. Host 读 `server/instances/*.json` + legacy lock；attach 优先配置端口再最长运行实例；spawn 从偏好端口递增最多 20 口。
- 验证：host/vendor 定向 21 项；全量 + typecheck + OKF（提交前跑）。
- 下一步：用户冷启动确认 Server 路由与端口占用时的换口；可选完整 server 探针。

## 2026-07-20 v2.16.68 跟进 Kimi Code 0.28.0

- 当前目标：对照官方 0.28.0 changelog，修 Kimix 必跟项。
- 修复：`kimi web --no-open` 启动；YOLO/Auto 文案；`docs/kimi-code-0.28-followup.md`。
- 后续在 v2.16.69 完成 SDK 与多实例端口。

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

