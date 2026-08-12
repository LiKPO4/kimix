# Kimix 长程任务状态

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

# 2026-08-10 性能：启动同步最新会话不再阻塞本地首屏（v2.21.30）

- 现场：启动恢复已有会话时，全屏显示“正在同步最新会话”约 7-8 秒；本地持久化消息已经存在但不可见。
- 根因：启动链无条件把 active local session 设为 `isLoading=true`，ChatThread 随即用全屏门禁遮住非空本地时间线；门禁要等待 `listSessions → loadSessionHistory → resume → getStatus`。官方历史路径包含最长 4 秒 Server 冷启动等待和 8 秒 snapshot 回退上限，7-8 秒与该网络/超时链吻合，不是 React 渲染慢。
- 修正：采用 stale-while-revalidate：本地已有 user/assistant（含房间次级 Agent 时间线）时立即渲染，仅空本地会话保留阻塞占位；官方历史继续后台对账。启动历史加载与 `resume/status` 改为并行，缩短后台收敛总时长。
- 回归：启动上下文测试覆盖普通会话、房间次级 Agent 与空会话三种门禁语义；全量 175 文件 / 1909 项、typecheck、knowledge validate 和生产构建通过。

## 2026-08-10 修复：引导/压缩会话重复刻度与双重流式（v2.21.29）

- 现场：同一逻辑对话在 steer、canonical user 和压缩事件附近显示为三段；左侧刻度出现多个点且都跳到上方同一位置，上下两个 Assistant 同时渲染同一份流式正文，切换会话后旧刻度/滚动还会短暂污染新会话。
- 根因：steer 会把相同 `agentTurnId` 切成多个 Assistant 渲染段，但所有段都派生为同一个 `assistant:<turnId>`；该值同时充当 React key、DOM 锚点和导航 key，节点 Map 覆盖与同 ID 查询导致所有刻度命中同一节点。旧段又可能按同一 active turn 订阅同一 live draft key。导航栏节点缓存/marker 状态和原生 smooth scroll 也未在会话边界同步清理。
- 修正：同 turn 的后续渲染段加入稳定 `segment-N` 身份；空 turn id 回退有效 `roomMessageId`；同一房间 Agent 的后续用户边界结算旧段；导航栏按 session 清空节点/预览/刻度状态，viewport 切会话时取消在途平滑滚动。
- 取证与回归：最小六事件快照见 `docs/issue-steer-compaction-navigation-events-snapshot.md`；回归锁定三段 ID 唯一、仅最新段 active，以及切会话执行 auto 滚动冻结。
- 验证：全量 175 个测试文件 / 1907 项通过；新增并行 Agent 边界保护后，定向 3 文件 / 91 项与 `pnpm typecheck` 再次通过；`pnpm knowledge:validate` 和 `pnpm build` 通过。

## 2026-08-10 修复：Agent 房间撤回后消息仍残留（v2.21.28）

- 官方逻辑：`undo(count: 1)` 从历史尾部删除最近一个真实用户输入及其后整轮 assistant/tool；官方历史可能不返回 `officialUserEventId`。
- 根因：房间 undo 对账在缺失官方用户 ID 时保守保留 `collaboration.messages`，导致撤回成功后房间投递记录仍投影为上一条消息。
- 修正：撤回调用把用户点击的 `undoRoomMessageId` 传入 canonical reconciliation；官方调用成功后按该明确 ID 删除对应房间投递，其他 Agent/消息保持不变。
- 验证：新增缺失官方用户 ID 的回归，22 项 collaborationHistory 测试与 typecheck 通过；待补全量测试、知识校验和生产构建。

## 2026-08-10 修复：Agent 房间首条 live assistant 仍缺模型（v2.21.27）

- 根因：协作房间消息先写入 `collaboration.messages`，再按 Agent 独立派发，没有普通会话那种空 Assistant 占位；`kimix.turn.model` 可能先到，`stampCurrentTurnModel` 当时无目标可盖章，后续首条 assistant 仍可能沿用旧 Agent 名称。
- 修正：实时事件映射后、入队前，为无模型且非历史回放的 assistant 使用所属房间 Agent 当前发送模型；历史回放仍只接受自身 turn-scoped 模型。
- 验证：房间投递/多 Agent/历史模型 100 项测试通过，typecheck 通过；待补生产构建与全量回归。

## 2026-08-10 修复：旧会话切换模型后新轮消息头仍显示旧模型（v2.21.26）

- 现场快照：旧会话底栏已切到 `qwen3.8-max`，新一轮空占位消息头仍显示 `k3 · 等待模型输出`；Host 发送路径以新模型作为 `promptModel` 并在 dispatch 发出 `kimix.turn.model`，错误位于 Renderer 本轮占位/消息头投影。
- 根因：旧会话转成 collaboration state 时，主 Agent `displayName` 由当时模型生成并持久化；切换只更新 `modelAlias`。消息头把 `displayName !== compact(modelAlias)` 误判为自定义 Agent 身份，使旧 `k3` 压过本轮 `qwen3.8-max`；空占位又未在用户边界冻结模型，扩大了 dispatch 前的错误窗口。
- 修正：主 Agent 消息头始终优先使用本轮事件模型，次级 Agent 自定义名称保持不变；正常发送和两条本地队列补发路径创建占位 Assistant 时立即写入入队/发送时选中的模型。
- 回归：模型显示 fixture 覆盖“旧主 Agent 名 + 新 turn model”和“次级自定义 Agent 名”两条边界；事件快照见 `docs/issue-old-session-turn-model-header-events-snapshot.md`。

## 2026-08-10 修复：统一右侧面板标题按钮悬停态（v2.21.25）

- 根因：会话侧栏标题栏使用 `.kimix-inline-icon-action is-roomy`，文件预览标题栏刷新/关闭按钮却使用 `.kimix-muted-action` 加 Tailwind 几何类；两者虽然都是 32px，但 hover/active 材质、圆角和自定义 UI Style 接入点不同。
- 修正：文件预览标题栏两个按钮改用与会话侧栏关闭按钮完全一致的 `.kimix-inline-icon-action is-roomy text-text-muted hover:bg-surface-hover hover:text-text-primary`。
- 扫描：右侧同位置的会话侧栏与文件预览是当前两处面板标题按钮入口；同时补齐 Default/Modern/Retro/Nostalgia 对 `.kimix-diff-panel` 的标题按钮覆盖。契约测试锁定 JSX 类名和四套主题选择器，防止同层样式再次分叉。

## 2026-08-10 修复：关闭文件预览侧栏不清空中间预览（v2.21.24）

- 根因：AppShell 监听 `diffPanelOpen`，侧栏关闭时同时清空 `previewFile`、正文、解析路径和错误；这把“文件列表侧栏”与“中间文件预览”错误绑定，覆盖了预览自身的返回会话按钮。
- 修正：移除关闭侧栏时的清理 effect。侧栏只改变可选文件列表的可见性；中间预览继续由自己的返回按钮退出，切换项目/会话时仍按原逻辑清理，避免跨上下文残留。
- 回归：布局契约测试锁定侧栏关闭回调只写 `diffPanelOpen=false`，且不存在通过 `!diffPanelOpen` 清空中间预览的路径。

## 2026-08-10 调整：右侧面板恢复小缝隙并统一内边距（v2.21.23）

- 根因：v2.21.11 用共享 `.kimix-layout-resizer` 把 12px 拖拽热区全部负边距抵消，虽然解决了左侧栏与主区域之间的宽缝，却也把同一规则应用到右侧会话侧栏/文件预览，导致右面板与主区域完全贴合。
- 修正：拖拽柄增加右面板专用变体；左侧继续零净占位，右侧保留 4px 视觉间隙，同时用 12px 热区覆盖后继面板，拖拽手感不变。悬停指示线移到 4px 间隙中央。
- 一致性：文件预览标题区改为左右 `18/14px`，内容区改为左右 `18px`、上 `14px`、下 `20px`，与同位置的会话侧栏保持一致；两者继续共享同一个 `rightPanelWidth`，拖拽后同步自适应。
- 回归：布局契约测试锁定左侧无缝、右侧 4px、右侧变体只挂载在右拖拽柄，以及两类右侧面板相同的标题/内容外边距。

## 2026-08-09 修复：Assistant Markdown 保留模型单换行（v2.21.22）

- 现场快照：新会话官方 `/messages` 中“每行两句”的 Assistant 已正确落库为单 text part、162 字、12 个换行；Renderer 最终正文同为 162 字，但截图把 11 行诗折叠成一段。模型、Provider SSE、Server 落库和完成回放均未丢换行。
- 根因：流式轻量 Markdown 已把普通正文 `\n` 转为 `<br>`，settled/rich ReactMarkdown 却沿用 CommonMark soft-break 语义，把段落内单换行折叠为空格；所以流式与完成态显示不一致，双换行可见而单换行消失。
- 修正：共享 ReactMarkdown 插件只把 mdast 普通 text 节点中的源换行转成 `break` 节点；代码块、行内代码、表格结构与段落边界继续使用原生 Markdown 语义，不使用 `white-space: pre-wrap`，避免 loose list/段落分隔符产生额外空白。
- 回归：真实“两行诗”fixture 先稳定复现无 `<br>`，修正后 settled 与 streaming 均保留一个 `<br>`；另锁定 fenced code 仍保留原始换行且不生成 `<br>`。

## 2026-08-09 修复：完成回放不再人为插入短句换行（v2.21.21）

- 复核官方与旧版：官方流式 transcript 使用 `open.text += delta`，多 text part 默认 `join('')`；Kimix v2.21.18 可见正文路径同样逐 part 原样发送。重复正文的根因是完成回放身份绑定错误，不是正文分隔符。
- 分层取证：多 part 样本证明临时 `join("\\n")` 会把 128 字/15 换行膨胀为 157 字/44 换行；但最新 `..._000024` 在官方 `/messages` 中只有一个 136 字/45 换行的 text part，Kimix delta offset 与 UI 投影均为 136。最新短句已存在于上游原文，不能归因于当前回放拼接。
- 受控 SSE 对照：同一 `opencode-go/deepseek-v4-flash` + `xhigh` 提示词直连得到 105 个正文网络 chunk，按 `+=` 拼成 130 字/5 换行的正常正文；同一提示词经官方 Kimi Code 落库为单 part、266 字/9 换行，也正常。SDK OpenAI 适配器逐 delta yield，消息合并直接 `target.text += source.text`，排除系统性“网络 chunk 变段落”。
- 原会话放大链：切换该线路后的首条异常已经是单 part 236 字/90 换行，随后“俳句/再写一个/再来一个/五言”等依赖上文的短指令依次得到 177/63、113/36、114/34、136/45，说明异常格式进入上下文后持续被模仿。首条异常当时没有 Provider SSE，只能定位到该轮模型/线路响应，无法再区分模型与网关。
- 修正：完成回放恢复为 text part 原文直接连接（`join("")`），不添加协议不存在的分隔符；原 part 内换行保持不变。
- 边界：不增加正文空白清洗；单 part 原文必须透传，否则会破坏诗歌、Markdown 与代码。出现同类上游异常时应新开会话或给出完整格式要求，避免用“再来一个”等省略指令继续放大。事件快照见 `docs/issue-streaming-short-lines-v22120-events-snapshot.md`。
- 回归：完成回放多 part 与 event mapper 定向测试 2 文件 / 272 项通过。

## 2026-08-09 修复：live 草稿首次绑定权威整文时不再追加（v2.21.20）

- 现场快照：本轮 volatile `assistant.delta` offset 从 0 连续到 128，官方 `/messages` 也只有一个 128 字 Assistant；完成屏障后 UI 却变成 285 字，约 2.5 秒 canonical repair 后恢复 128 字。
- 根因：live draft 没有 `snapshotMessageId`，权威回放首次带稳定 ID，因此走 completion binding 分支；v2.21.19 只在“已有相同稳定 ID”分支识别 `completionBarrierFullBody`，binding 分支仍按旧启发式追加。
- 修正：首次绑定稳定 ID 时同步保留 full-body 语义并直接整体替换 live 正文；普通 delta、非完整 barrier part 和不同官方消息仍沿用原边界。
- 回归：把完成回放测试改为真实的“无稳定 ID live draft → 稳定 ID 权威整文”序列，断言时间线始终只有一份完整正文。快照见 `docs/issue-streaming-body-duplicate-v22119-events-snapshot.md`。

## 2026-08-09 修复：完成回放正文改为权威整文（v2.21.19）

- 现场快照：v2.21.18 仍出现 live 正文与 `/messages` 完整正文短暂并排/重复；两者内容并非单纯空白差异，渲染层无法可靠判断应覆盖还是追加。
- 根因：Server 完成屏障把同一条已落库 Assistant 的多个文本 part 重新作为通用增量帧发送，Renderer 只能用字符串包含关系猜测语义，导致完成前后出现双正文。
- 修正：完成屏障回放仅对稳定消息 ID 生成一个带 `kimixPromptCompletionFullBody` 标记的权威完整文本帧；事件映射保留该语义，合并时直接替换同一消息的 live 正文。普通流式与历史回放仍保持原分片行为。
- 回归：新增完成屏障多文本 part 聚合及 live→权威整文替换测试；相关 Server/Mapper 测试与 TypeScript 检查通过。

## 2026-08-09 修复：空白漂移的 barrier 全文不再重复追加（v2.21.18）

- 现场快照：v2.21.17 本轮 live 正文完整为 273 字，完成屏障后同一个 Assistant 瞬间变成 543 字，约 2.5 秒后 canonical repair 恢复 273 字；截图表现为上下两份近乎相同的正文。
- 根因：Server `/messages` 回放的近完整正文与 volatile live 正文存在段落/列表空白差异。v2.21.17 能识别逐片回放和原始字符串包含关系，但两份近完整正文因换行不同互不 `includes`，仍回退为顺序追加。
- 修正：completion barrier 专用合并在原始覆盖判断之后增加空白折叠视图；规范化后一方覆盖另一方时保留对应完整正文，仅确实不同的分片继续追加。判断仍只作用于同一稳定消息 ID 的 barrier 回放，不扩散到普通 Assistant 合并。
- 回归：新增 273→约双倍形态的“live Markdown 正文 + 空白布局不同的近完整 barrier 正文 + 空 terminal”测试，旧实现稳定产生双重正文，修正后保持单一 live 正文；相关 5 文件 / 391 项及 TypeScript 检查通过。

## 2026-08-09 修复：完成屏障分片不再把完整正文闪回尾句（v2.21.17）

- 现场快照：v2.21.16 本轮 56 字 live 正文按 offset `0→56` 完整累积；`prompt.completed` 的 barrier 随后以同一个稳定消息 ID 回放 8 个 `content.part`，Renderer 在 20ms 内从完整流式正文变为最后 7 字“让我帮忙的吗？”，并显示输出完成；约 2.5 秒后 canonical repair 才恢复 56 字。
- 根因：事件合并把每个 `completionBarrierReplay` 正文帧都当作“整条官方消息快照”并覆盖已绑定的 live Assistant；但 Server barrier 实际逐 part 回放同一消息，因此前七片依次被后一片覆盖。
- 修正：未完成的 barrier content part 改为覆盖感知合并：live 正文已包含该片时保留完整正文，累计回放更丰富时升级，彼此独立时顺序追加；只有携带正文且 `isComplete` 的整条权威帧才整体替换。空 terminal 仅负责完成，不改正文。
- 回归：新增与现场一致的“完整 live 正文 + 同稳定 ID 的 8 段 barrier 回放 + 空 terminal”测试，旧实现稳定失败并只剩最后 7 字，修正后保持单一完整 Assistant；相关 5 文件 / 390 项及 TypeScript 检查通过。

## 2026-08-09 修复：状态刷新不再把流式正文截成最后一片（v2.21.16）

- 现场快照：新一轮正文实际按 15 个连续 offset 分片完整输出 93 字，但每个分片之间都夹有 `agent.status.updated`；日志中正文 anchor 持续前进而 `accChars` 每次都回到 0，最终正式时间线只剩最后一个“？”。`prompt.completed` 后 Host 又对普通提示无条件保留 30 秒续轮 grace，界面因此停在“消息处理中”，随后 canonical repair 才恢复完整正文。
- 根因：80ms 信息状态批处理定时器复用了“正式边界 flush”，每次状态刷新都会提交并清空 active-turn draft，却不重置同一步的 offset anchor；下一片只能从空 accumulator 继续。另一个独立问题是所有正常 `prompt.completed` 都套用长续轮等待，即使没有 Goal 或排队任务。
- 修正：信息性 `status_update` 的定时批处理只刷新事件，不再物化 active draft；正文、工具、完成等真实结构边界仍同步提交草稿。普通提示完成后立即发布 Host 完成态，仅活动 Goal 或明确 queued prompt 保留 30 秒自动续轮窗口，等待审批/提问期间也不会被延迟回调误置为完成。
- 回归：新增与现场一致的 15 段 offset + 每段状态刷新 fixture，锁定活动草稿与最终正式正文均为完整 93 字；新增普通提示、活动 Goal 与 queued prompt 的续轮 grace 判定测试。

## 2026-08-09 修复：流式正文只在完整落盘后完成并保留耗时（v2.21.15）

- 现场快照：同一 Server 会话真实输出按 offset `0→9→14→20→21→28→33→40` 连续到达并正常 `prompt.completed`，SDK wire 记录本轮 3893ms；Renderer 正式时间线却只剩最后 7 字。App 随后连续两次读取 REST `/status=idle`，在 Host 仍处于 30 秒续轮 grace 的情况下提前清除运行态并显示“输出完成”；约 30 秒后 canonical repair 用完整 40 字替换正文，同时丢掉显示层临时推导的耗时。
- 根因：Host 管理态与 Renderer REST poll 构成两套终态权威；`prompt.completed` 没有映射成正式时间线完成屏障，草稿没有在权威边界原子落盘；ChatThread/MessageBubble 又把“运行态消失 + 有可见残片”投影成完成；canonical 整体替换未保留本地可靠 duration。
- 修正：Server `getStatus` 对 Renderer 暴露 Host effective status，grace 内 raw idle 不再越权终结；主 `prompt.completed` 映射成无正文 completion marker，使完整 active draft 先落批、再按用户边界计算并持久化 duration；未完成可见正文保持执行中；canonical repair 按用户轮次保留本地可靠时长。
- 回归：真实 7 段 offset fixture 锁定完整 40 字、一次完成与 3893ms；另覆盖 grace 内 raw idle、inactive incomplete 假完成、prompt completion marker、canonical 40 字修复后 duration 保留及错位边界不串时长。定向 6 文件 / 209 项、全量 175 文件 / 1891 项、Node/Renderer TypeScript、生产构建与 OKF 严格校验通过。

## 2026-08-09 功能：目录缺失时自动复制 AI 核对提问词（v2.21.14）

- 目标：模型目录完全匹配失败或只返回部分元数据时，不让用户停在错误提示；自动向剪贴板写入一段可直接粘贴给 AI 的核对请求。
- 实现：提问词包含 Provider 名称、去除 query/hash 的 Base URL、上游模型 ID、Kimix 模型别名及实际缺失项；要求 AI 优先引用供应商/模型官方资料，区分模型原生上限与具体路由上限，无法确认时标记未知，禁止用通用参数枚举或 HTTP 2xx 猜测。完整失败询问 Context+effort，部分成功只询问缺失字段。
- 交互：目录返回失败、IPC 异常、未保存即点击匹配，以及成功但缺少 Context/effort 时都会尝试自动复制；成功提示“可直接粘贴给 AI 查询”，系统剪贴板不可用时明确提示检查权限。提问词不读取 API Key，Base URL 查询参数和片段也不会进入剪贴板。
- 回归：新增纯提示词内容/URL 脱敏，以及目录失败、请求异常、剪贴板拒绝、Context-only 成功自动复制且保留表单值的 UI 用例；定向 2 文件 / 38 项与 Node/Renderer TypeScript 检查通过。

## 2026-08-09 修复：目录匹配独立回填 Context 与思考档位（v2.21.13）

- 复验现象：`opencode-go/mimo-v2.5` 已被 models.dev 收录且声明 `limit.context = 1000000`，但目录没有声明可选 effort 档位。v2.21.12 的“匹配目录”把两类元数据绑死为 effort-only 结果；Host/IPC/UI 均丢弃已解析的 Context，并把“无 effort 声明”整体当成失败。
- 修正：目录解析改为 provider/model 范围内的一次模型元数据匹配，`maxContextSize` 与 `supportEfforts` 分别可选、独立回填；按钮改为“匹配模型信息”。目录有 Context、无档位时更新 Context 并保留现有手动档位；缺失 Context 不再伪造 262144。SDK 目录模型的 `offEffort` 也纳入 Kimix 档位映射，避免 `none` 在 SDK 转换层丢失。
- 数据源边界：Provider `/models` 仍优先提供实际路由返回的 Context，models.dev 提供 provider-aware 元数据，名称推断仅作最低优先级兜底。OpenRouter/LiteLLM 可作通用模型信息参考，但不能证明当前网关的 provider-specific effort 或 Context 上限，本轮不引入跨供应商猜测。
- 回归：新增 `hy3 → 256000 + off/low/high`、`mimo-v2.5` 无档位仍返回 1000000 Context，以及 UI Context-only 回填且保留手动档位用例；定向 2 文件 / 30 项与 Node/Renderer TypeScript 检查通过。

## 2026-08-09 修正：思考档位只采信模型级目录声明（v2.21.12）

- 复验现象：v2.21.10 增加无效值 sentinel 后，`opencode-go/hy3` 仍探测为 minimal–max 六档。这不是版本旧图或 sentinel 未生效：该网关会拒绝非法字符串，但在 provider 全局 schema 层接受全部合法枚举。sentinel 只证明网关校验枚举，合法值 2xx 仍不能证明具体模型实际支持；chat/completions 也不回显最终生效档位，无法从输出/usage 稳定反推。
- 实际事实：models.dev 当前对 `opencode-go/hy3` 明确声明 `none / low / high`，Kimix 应映射为 `off / low / high`。设置页原本又把所有 provider 的 models 直接 flatMap 后按裸 model id 匹配；多个 provider 都有 `hy3` 且档位声明不同，存在跨 provider 串档。
- 修正：设置页操作改为「匹配目录」，Host 仅返回 models.dev 模型级 `supportEfforts`；先按 provider id，再按规范化 Base URL 唯一匹配 provider，然后在该 provider 内匹配模型。目录未收录、未声明或同名声明冲突时明确失败且不修改表单，不再用 HTTP 2xx 扩展档位。目录预填管线同步改为当前 provider 内匹配，不再全局裸 ID 匹配。
- 回归：新增 provider id/Base URL 匹配、`opencode-go/hy3 → off/low/high`、provider 身份不明/重复、目录未声明与设置 UI 隔离用例；定向 3 文件 / 48 项与 Node/Renderer TypeScript 检查通过。

## 2026-08-09 修复：侧栏拖拽热区不再挤出面板宽缝（v2.21.11）

- 根因：左侧栏、拖拽柄、主面板是同一 flex 行的三个兄弟节点；`.kimix-layout-resizer` 用 `width: 12px` + `flex: 0 0 12px` 保留热区时，也真实占据了 12px 布局列。中间 2px 蓝线只是伪元素，所以蓝线两侧必然剩下透明空白，不是主面板 border/radius 或侧栏内边距造成。
- 修复：保留 12px 拖拽热区，用 `margin-right: -12px` 让其全部覆盖到后继面板内，flex 净占位归零；可见 2px 线位回到真实分界线。热区不向前一面板侵入，避免抢占侧栏/聊天区右缘滚动条；z-index 保证拖拽层位于后继面板之上。共用样式同时修正左侧栏和右侧检查器拖拽柄；侧栏收起时的 12px spacer 是非拖拽布局，本轮不改。
- 设置页同链路：实机截图暴露设置侧栏外壳 10px 右 padding 与内层 8px margin/padding 叠加，滚动列还被 stable scrollbar gutter 再挤窄，导致搜索框、导航项右边界不齐且距分界线过宽。外壳右 padding 收为 0，滚列右 padding 收为 0 让 gutter 自身成为唯一右侧留白；搜索、头部、导航、版本行统一保留 8px 外边界，并继续以传入 `width` + `width: 100%` 随拖拽宽度自适应。
- 回归：新增拖拽柄 CSS 契约测试，锁定“12px 热区 + 单侧负外边距抵消占位 + 边界线定位 + 层级”；设置布局测试锁定动态外壳宽度、统一右边界和导航项 100% 宽度。

## 2026-08-09 修复：思考档位探测不再把静默忽略误报为全支持（v2.21.10）

- 根因：旧探测在基线请求成功后，把每个携带 `reasoning_effort` 的 HTTP 2xx 直接等同为该档位受支持。大量 OpenAI 兼容供应商/网关会静默丢弃未识别字段或任意枚举值，因此 minimal 到 max 全部返回 2xx，Kimix 遂误回填六个档位；UI 和 Host 只是忠实回填，不是根因。
- 修复：基线成功后先发送一个必然无效的对照档位。只有供应商用 400/422 拒绝对照值，证明该端点确实校验 `reasoning_effort` 后，才继续逐档判定；对照值仍成功时直接报“无法可靠探测”，不再伪造全档位结果。逐档拒绝同步兼容 422。
- 回归：新增“任意 effort 都返回 200”与“422 拒绝无效值、仅 high 成功”用例，定向 9/9 通过；Node/Renderer TypeScript 检查通过。

## 2026-08-09 修复：正文复制严格跟随最终正文边界（v2.21.9）

- 根因：Kimi Web 的对话正文已经通过 `computeFinalTextBlockContent` 只显示本轮最终文本块，但单个“复制”按钮仍直接复制合并后的 `event.content`。该字段有意保留同 turn 的中间文本段，因此工具调用前后的残片（实机为“特征。”“内）。”）虽然只在展开的过程链中显示，仍越界进入了正文剪贴板；不是 Markdown 渲染或 AI 生成内容错误。
- 修复：普通复制改为复用正文区同一份 `finalText / streamingContent` 结果，完成态只复制屏幕最终正文，运行态复制当前正文候选；显式“全部复制（含思考）”继续使用 turn 聚合内容，保留其中间文本与思考语义。全局检查确认 `/copy` 读取的是持久化事件数组中的最后一个非空 Assistant 段，不经过渲染层 turn 聚合，本轮无需改动；会话 Markdown 导出本就以完整时间线为目标，也不收窄。
- 回归：组件级剪贴板测试构造“中间文本 → 工具 → 中间文本 → 工具 → 最终正文”的真实结构，锁定普通复制只得到最终正文，并同时锁定“全部”仍得到 turn 聚合内容。
- 验证：定向 MessageBubble/turnBlocks 测试 2 文件 / 53 项、全量测试 174 文件 / 1867 项、Node/Renderer 类型检查、生产构建、OKF strict validate 与 180 天 audit 均通过；v2.21.9 构建版已启动，CDP 确认窗口正文注入版本号。

## 2026-08-09 修正：对话 disclosure 仅在交互态显示导入材质（v2.21.8）

- 纠正：v2.21.7 把“hover 未完整消费圆角与实体边框”误修成了“静止态完整消费 control”，导致 Agent 过程头与可展开思考摘要在消息流里常驻两个高浮雕胶囊，抢过正文层级。用户确认这两个触点在内置风格中的正确语义是静止安静、鼠标悬停才显现材质。
- 修复：保留精确的 `.kimix-chat-standalone-disclosure` 角色，但静止态强制透明背景、透明边框色、无阴影，仅按 hover 边框宽度预留不可见几何以避免位移；hover 与键盘 focus-visible 完整消费 control hover 的边框、圆角、背景和阴影，active 完整消费 active 材质。无详情的静态 Agent 头不受按钮规则影响；卡片内部折叠行继续保持原边界所有权。AI 角色目录同步明确这两个触点只消费交互态。
- 壳层修复：自定义消费者还把 `toolbar` 角色圆角同时写给主壳顶部工具栏与底栏，导致顶部工具栏底边出现不该有的两枚圆角，底栏顶边也存在同类风险。两者都是父 shell 内部的满宽分区，现固定自身圆角为 0，由 `overflow-hidden` 的父 shell 统一裁切真正的外轮廓；顶部下边与底部上边保持直线，外角仍精确跟随 shell。
- 验证：定向 UI Style 测试 2 文件 / 41 项、全量测试 174 文件 / 1866 项、Node/Renderer 类型检查、生产构建、OKF strict validate 与 180 天 audit 均通过。v2.21.8 Y2K 运行态中两处 disclosure 静止态均为透明背景、透明边框且无阴影，强制 hover 后均完整切换为 999px 圆角、实体边框、表面和双层浮雕；主 shell 保持 28px 外角，内部 toolbar/footer 均为 0px 圆角，由父层裁切外角且相接边为直线。

## 2026-08-09 修复：Agent 过程头与折叠思考完整消费导入风格（v2.21.7）

- 根因：Agent 过程消息头与 Kimi Web 的可展开思考摘要都只带通用 `.kimix-chat-collapse-row`；UI Style v1 为避免卡片内部行重复套框，只给这个遗留大类桥接 hover/active，导致两个真正独立的边界所有者在静止态仍固定为基础 6px、透明、无边框、无阴影。Y2K 的 control resting 材质已正确编译但没有消费者，不是导入 JSON 或 AI 生成失败。
- 修复：新增 `.kimix-chat-standalone-disclosure` 语义，只登记 Agent 过程头（含无详情静态头）与游离折叠思考摘要，完整消费 control 的 resting/hover/active 边框、圆角、表面与层次；思考摘要补 `aria-expanded`。工具卡、提问卡、通知卡等已有父卡边界的内部折叠行继续只桥接交互态，避免框套框。AI 角色目录同步说明 control 覆盖这两个触点。
- 验证：定向 UI Style 测试 2 文件 / 40 项、全量测试 174 文件 / 1865 项、Node/Renderer 类型检查、生产构建、OKF strict validate 与 180 天 audit 均通过。v2.21.7 Y2K 运行态中两触点静止态均从 6px/透明/无边框/无阴影变为 control 的 999px、1px 边框、`#EAECEE` 表面与双层浮雕；hover/active 正确切换边框、表面、阴影和按压 scale。相邻“2 个工具调用”内嵌头仍为 6px/透明/无边框/无阴影，未产生框套框。

## 2026-08-09 修复：导入风格的嵌套分段控件保持同心圆角（v2.21.6）

- 根因：主题三段控件有 6px 可见内边距，内部按钮消费 `interactiveCard` 圆角，外壳却直接消费无几何关联的 `insetSection` 圆角；Y2K 运行态因此形成外 14px、内 20px 的反向嵌套转角。桌面通知列表虽共享外壳材质，但其子项贴边满铺，不能与主题控件共用同一圆角推导。
- 修复：共享边框、背景和层次继续来自 `insetSection`；主题外壳按 `interactiveCard radius + 6px inset` 推导同心外圆角，通知列表保持直接使用 `insetSection` 并由外壳裁切。6px 间距抽成局部结构变量，测试锁定半径与内边距的关系，避免以后只改其中一侧。
- 验证：定向 UI Style 测试 2 文件 / 39 项、全量测试 174 文件 / 1864 项、Node/Renderer 类型检查、生产构建、OKF strict validate 与 180 天 audit 均通过。v2.21.6 运行态中 Y2K 主题外壳为 26px、内部三项均为 20px、padding/gap 均为 6px；通知外壳仍为 14px、padding 0、四个满铺子项均为 0px，由父层正确裁切。

## 2026-08-09 修复：内容容器圆角按角色硬限幅（v2.21.5）

- 根因：UI Style v1 虽限制 card/panel/shell primitive 最大为 40/48px，但任何角色都能引用 `pill=999`，AI 把 `userBubble` 设为 pill 后绕过数值上限；长消息气泡因此接近半圆，圆角侵入正文并把文字挤出视觉边界。
- 修复：编译器新增覆盖全部 29 个角色的半径上限表。固定高度的导航、按钮、开关、菜单触发器和状态胶囊继续允许真正 pill；shell 最高 32px，card/code/table/menuItem 等内容面最高 20–24px，modal/composer/userBubble/popup/inspector/toast/dock 等最高 28px。历史已导入 JSON 无需迁移，重新编译即自动收敛；AI 提示同步禁止正文容器使用 pill。
- 验证：定向 UI Style 测试 2 文件 / 39 项、全量测试 174 文件 / 1864 项、Node/Renderer 类型检查、生产构建、OKF strict validate 与 180 天 audit 均通过。v2.21.5 运行态中 Y2K 的 userBubble 从 `999px` 收敛为 `min(999px, 28px)`，浏览器最终解析为 28px；modal/composer 保持 24px，primaryAction/toggle 仍为 999px 胶囊。

## 2026-08-09 调整：复合按钮分割线改为短直线（v2.21.4）

- 根因：分割线直接作为右半按钮的 inset box-shadow 绘制；右半按钮自身带圆角且接近外壳全高，阴影两端因此沿圆角形成上下小折。
- 修复：右半按钮不再直接承载 divider shadow，改由左侧垂直居中的 1×16px、零圆角伪元素绘制；播放、工作区和文件卡的同类 `.kimix-split-control` 统一生效，既有风格 token 与 hover/expanded 材质保持不变。
- 验证：定向 UI Style 测试 1 文件 / 27 项、全量测试 174 文件 / 1863 项、Node/Renderer 类型检查、生产构建、OKF strict validate 与 180 天 audit 均通过。v2.21.4 运行态中启动/工作区两处分割线均为 1×16px、border-radius=0、translateY(-8px) 居中，右半按钮自身 box-shadow=none。

## 2026-08-09 修复：设置分段外壳完整消费导入风格（v2.21.3）

- 根因：主题三段控件外壳被测试白名单标成“结构性元素”，完全未消费 UI Style v1；桌面通知外壳虽被写入 `insetSection` 消费者，但放在零 specificity 的 `:where(...)` 内，实际优先级低于工作区基础选择器，Y2K JSON 提供的 14px 圆角被基础 6px 覆盖。
- 修复：主题与桌面通知两类工作区分段外壳统一由一个显式工作区选择器消费 `insetSection` 的边框、圆角、背景与层次；主题外壳退出结构差集白名单，并新增选择器优先级回归测试。继续逐页扫描设置页 8 个分类，把同样停留在基础 6px 的侧栏搜索框和主题色值框纳入 `field` 角色；其余命中项均为刻意的单边分隔线。
- 验证：定向 UI Style 测试 2 文件 / 38 项、全量测试 174 文件 / 1863 项、Node/Renderer 类型检查、生产构建、OKF strict validate 与 180 天 audit 均通过。v2.21.3 运行态读取 Y2K 的 `insetSection`/`field` 预期均为 14px，主题外壳、通知外壳、搜索框、色值框 computed border-radius 均为 14px；设置页 8 个分类已无残留的 6px 完整边框容器。

## 2026-08-09 调整：Composer 思考菜单显示精确英文档位（v2.21.2）

- 界面：思考强度弹出菜单改为“中文名称（英文 wire 值）”，例如 `超高（xhigh）`、`最高（max）`；菜单外的紧凑工具栏按钮继续只显示中文，不增加英文宽度。
- 边界：菜单仍只列出当前模型声明并经 provider 协议规范化后的档位，不为不支持 `max` 的 OpenAI 模型虚构可选项；运行时的 `max → xhigh` 防线保持不变。
- 验证：思考档位定向测试 1 文件 / 7 项、全量测试 174 文件 / 1862 项、Node/Renderer 类型检查、生产构建、OKF strict validate 与 180 天 audit 均通过。

## 2026-08-09 修复：思考档位在运行时与子 Agent 配置边界校验（v2.21.1）

- 根因：OpenAI 兼容模型配置可声明 Kimi 协议的 `max`，Composer 仅靠异步 effect 在部分无声明场景做 `max → xhigh`；已声明 `max`、首次创建/恢复、直接 `setThinking` 以及 `[secondary_model] default_effort=max` 都能绕过 UI 矫正，最终把 provider 不接受的 `reasoning_effort=max` 原样发出并收到 400。
- 修复：新增共享运行时思考档位策略，OpenAI/OpenAI Responses 协议将 `max` 规范化为 `xhigh`，再按 `support_efforts → default_effort → 首个声明档位` 校验回退；Host 的 Server/SDK 共用 `createSession` 与 `setThinking` 入口统一执行。保存 secondary_model 时使用同一策略，避免再次写入 OpenAI `max`；Kimi `max` 保持不变。
- 界面：模型配置页的全部思考档位按钮和默认档下拉直接显示英文原值（`off/minimal/low/medium/high/xhigh/max`），子 Agent 思考档位下拉同步显示英文，避免中文“超高/最高”掩盖真实 wire 值。
- 验证：定向策略、secondary_model、模型目录与模型配置 UI 测试 5 文件 / 81 项通过；全量测试 174 文件 / 1861 项、Node/Renderer 类型检查、生产构建、OKF strict validate 与 180 天 audit 均通过，构建产物已确认注入 2.21.1。旧 Electron/Node 进程为空；`out`/`.vite` 递归清理两次被本机策略拒绝，因此本轮构建沿用现有缓存。开发版启动后因已安装的 `Kimix.exe` 占用单实例锁而退出，未擅自关闭用户当前正式版窗口；运行态交互待用户关闭正式版后启动 v2.21.1 复验。

## 2026-08-09 发布：v2.21.0 中版本

- 范围：从上一个实际发布版本 v2.20.272 起算，汇总自定义界面风格、插件页重组、Goal/SDK v2 稳定性、思考档位、对话体验与性能等 49 个本地提交。
- 发布准备：版本号由 v2.20.316 提升为 v2.21.0，新增 `docs/release-notes/v2.21.0.md`；Release notes 仅描述用户可感知变化和已知边界。
- 验证：全量测试 174 文件 / 1855 项、Node/Renderer 类型检查、生产构建、OKF strict validate 与 180 天 audit 均通过；构建产物已确认注入版本号 2.21.0。发布提交 `23f0440b` 与标签 `v2.21.0` 已推送；GitHub Actions 的知识校验、Windows/macOS/Linux 构建、Release 创建和 SHA256 校验文件上传全部通过，正式 Release 已公开。

## 2026-08-09 修复：风格卡固定单行高度并收紧描述契约（v2.20.316）

- 根因：设置页风格描述仍使用两行 line-clamp，长描述会把所在网格行从约 76px 撑高；UI Style v1 数据 schema 同时仍允许 240 字，与 AI 提示声明的 48 字不一致，导致过长描述能被实际导入。
- 修复：风格卡外壳固定 76px，描述改为单行省略号并保留 title 完整提示；schema description 硬上限改为 48 字，AI 提示明确“包含标点与空格、超出拒绝导入”。历史已持久化长描述只在规范化加载时截断到 48 字，避免现有自定义风格失效；新导入仍严格拒绝。
- 验证：完整重启后，历史 Luna 描述由 151 字迁移并持久化为 48 字，自定义风格仍保留；设置页五张风格卡运行态均为 76px、描述均为单行，Luna 正确溢出省略。定向测试 2 文件 / 37 项、全量测试 174 文件 / 1855 项、TypeScript 类型检查、生产构建、OKF validate/audit 均通过。

## 2026-08-09 修复：hover accent 类不再绕过导入风格材质（v2.20.315）

- 根因：自定义消费者用 `[class*="bg-accent-"]` 排除拥有常驻语义色背景的按钮，但该子串判断也会命中 `hover:bg-accent-danger/10` 等变体类；归档、删除、重试、外链等次要强调操作因此整个退出 control resting/hover/active 规则，只剩局部浅色背景，导入风格的边框与阴影完全未生效。
- 修复：五处排除条件改为只识别位于 class token 起点或空格后的静态 `bg-accent-*`；`hover:` 变体继续保留语义文字色，但背景、边框与阴影由自定义 control 状态统一接管。真正的实心主按钮和常驻警告/危险背景仍被排除。
- 验证：Luna 运行态中归档按钮静止透明；hover 为红色图标 + 灰色表面 + 深边框 + 双层浮雕，active 为内凹材质。定向测试 2 文件 / 36 项、全量测试 174 文件 / 1854 项、TypeScript 类型检查、生产构建、OKF validate/audit 均通过。

## 2026-08-09 修复：侧栏随行操作只在单按钮交互时凸起（v2.20.314）

- 根因：导入风格把所有 `.kimix-sidebar-icon-action` / `.kimix-inline-icon-action` 当成常驻控件消费 resting 材质；项目与会话行的 6 个操作虽然只是随父行 hover 显形，却在显形瞬间全部获得浮雕，错误地把“父行 hover”表现成“三个按钮同时 hover”。
- 修复：为这 6 个按钮增加 `.kimix-sidebar-reveal-action` 语义；自定义风格下静止状态强制透明并保留边界占位，只有单按钮 hover、键盘聚焦或按下时才恢复各自 navigationAction/control 材质。常驻顶部、Composer、弹窗、消息复制、检查器等控件继续保留 resting 材质。
- 验证：Luna 运行态中项目/会话随行操作静止均为透明边界、透明背景、无阴影；单独 hover 会话导出按钮后恢复灰色表面、深边框与双层浮雕。定向测试 2 文件 / 35 项、全量测试 174 文件 / 1853 项、TypeScript 类型检查、生产构建、OKF validate/audit 均通过。

## 2026-08-09 修复：Composer 权限按钮补齐同排高度约束（v2.20.313）

- 根因：上一轮只修正了思考强度按钮，左侧权限复合按钮仍单独写死为 34px；它与加号及右侧工具按钮同处一行，却没有纳入同一轮高度检查。
- 修复：权限按钮同步统一为 32px；回归测试由单点断言扩展为同时约束权限、思考强度两组复合按钮，禁止任一处重新出现 34px。
- 验证：运行态逐项测量 Composer 工具栏 8 个可见按钮，高度均为 32px；定向测试 24/24、全量测试 174 文件 / 1852 项、TypeScript 类型检查、生产构建、OKF validate/audit 均通过。

## 2026-08-09 修复：Composer 思考强度按钮与同排控件等高（v2.20.312）

- 根因：Swarm、Plan 等同排控件通过 `.is-compact` 使用 32px 高度，思考强度按钮却额外内联 `height/minHeight: 34`，因此导入风格描边后上下各多出 1px，视觉高度明显不齐。
- 修复：思考强度复合按钮统一为 32px 高，宽度、图标、文字和下拉结构不变；新增源码回归断言防止重新写回 34px。
- 验证：运行态同排六个控件均为 32px 高；定向风格测试 24/24、全量测试 174 文件 / 1852 项、TypeScript 类型检查、生产构建、OKF validate/audit 均通过。

## 2026-08-09 收口：导入风格触点与交互状态覆盖门禁（v2.20.311）

- 根因：内置 modern/retro/nostalgia 仍有大量组件级选择器，导入风格则只依靠固定语义角色消费段；过去的测试仅确认 29 个 role token 被编译和“至少出现一次”，没有校验内置触点差集、每个交互角色的状态完整度，也没有阻止新 JSX button 继续裸写 Tailwind，因此新控件会出现内置正常、导入遗漏。
- 触点补齐：通用 `.kimix-icon-text-button`、检查器操作、弹窗关闭、媒体预览导航、房间触发、运行时错误关闭、设置图标操作、聊天 banner 操作统一接入 control；检查器列表接入 menuItem；模型供应商条目接入 navigationItem；设置徽章接入 statusSurface；工作区权限分组外壳接入 insetSection；muted、配色侧操作和对话折叠/过程行通过只覆盖 hover/active 的兼容桥消费 control 状态，避免静态整行误变成凸起按钮。
- 状态补齐：navigationItem/navigationAction、interactiveCard、menuTrigger/menuItem、mediaThumb、dock、roomChoice 增加此前缺失的 active/selected 消费；工作区分段权限由外壳拥有边界，内项只消费 hover/selected 表面，避免自定义风格形成嵌套边框。
- 防回退：新增“内置触点 vs 导入契约”集合差分测试，差集只允许 9 个已说明的结构或委托类；新增 13 个交互角色状态矩阵测试；扫描全部组件 JSX button，要求声明 `kimix-*` 风格角色或显式 `kimix-style-exempt`，以后新增裸按钮直接失败。
- 验证：定向契约/风格测试 2 文件 / 33 项、全量测试 174 文件 / 1851 项、TypeScript 类型检查、生产构建、OKF validate/audit 均通过。

## 2026-08-09 修复：Composer 加号与画板比例项接入自定义 hover（v2.20.310）

- 根因：加号已有 `.kimix-composer-tool-button`，但该角色遗漏于自定义 control 的 resting/hover/active 消费清单，导致导入风格下 hover 仍走基础 token；画板比例项仅有通用 `.kimix-icon-text-button`，完全没有自定义控件角色，Luna hover 只出现透明背景与空阴影。
- 修复：将 `.kimix-composer-tool-button` 纳入自定义 control 三态消费清单；画板比例按钮加入 `.kimix-control-button`，不再用局部 hover 颜色模拟材质。
- 运行态量化：Luna 下加号与 1:1 比例项 hover 均从白色 `rgb(255,255,255)` 切换为灰色 `rgb(229,232,234)`，同时保留 1px 边框与统一浮雕阴影；比例项静态状态也从透明无阴影接入完整 control 材质。
- 验证：定向风格测试 21/21、全量测试 174 文件 / 1849 项、TypeScript 类型检查、生产构建、OKF validate/audit 均通过。

## 2026-08-09 修复：Agent 消息复制操作统一尺寸与材质（v2.20.309）

- 根因：用户消息复制使用基础 `.kimix-inline-icon-action`（28×28），Agent 单条复制额外带 `is-roomy`（32×32），复制全部又使用独立 `.kimix-muted-action`（62×32、无控件边框/阴影），三者尺寸和风格角色不一致。
- 修复：Agent 单条复制移除 `is-roomy`，固定为与用户复制相同的 28×28 方形；复制全部保留文字但固定 28px 高。两者统一加入 `.kimix-message-copy-action` 与 control 角色，间距收为 4px，在自定义风格下共享同一边框、圆角和材质。
- 运行态量化：用户复制 28×28、Agent 复制 28×28、复制全部 62×28；Luna 下三者均为 1px border、3px radius、同一 raised shadow。
- 验证：定向风格测试 20/20、全量测试 174 文件 / 1848 项、TypeScript 类型检查、生产构建、OKF validate/audit 均通过。

## 2026-08-09 修复：Composer 单边界、模式键状态与复合按钮材质（v2.20.308）

- 输入内线根因：自定义 `field` 消费选择器错误包含 `.kimix-composer-input`，与 `composer` 外壳同时拥有边界，形成双框。修复将内层 textarea 永久固定为 border/radius/background/shadow/outline = 0/transparent，且 field 只覆盖独立设置/检查器字段，JSON 无法重新制造内线。
- Swarm/Plan 根因：V1 toggle 只消费 `aria-pressed=true`，resting/hover/active 三态完全漏接。现补齐四态且 hover 排除已选中项，选中态在 hover 时保持自身材质。
- 启动/打开根因：组件已消费 compoundControl，但 Luna JSON 明确把完整表面按钮的 resting/hover elevation 写为 none；提示此前只有角色名且强迫 AI 重写全部角色，容易盲猜不一致。提示新增 29 角色触点目录、Composer 单边界/compound/toggle 一致性规则，并允许未覆盖角色继承 basedOn。
- 兼容现有配置：规范化阶段仅在 compoundControl 已有非透明完整表面+边框、普通 control 有材质而 compound elevation 独缺时，继承同状态 control elevation；真正 transparent+border none 的扁平复合按钮仍保留 none。现有 Luna 无需重导入，运行态已确认 textarea 零边界、Swarm hover 内凹材质、split hover 凸起高光与投影。
- 验证：定向契约/风格 2 文件 29 项、最终全量 174 文件 1847 项、Node/Renderer typecheck、生产构建（main `702.26 kB`、renderer CSS `assets/index-B-Be-sDv.css`、JS `assets/index-CLDZ8FWI.js`）、OKF strict（14 concepts、475 links）与 180 天审计通过；Luna 运行态用 CDP 强制 hover 量化核对 input/state/split 三类计算样式，最终视觉待用户在 v2.20.308 截图复验。

## 2026-08-09 修复：自定义风格消费规则真正生效并收紧描述卡片（v2.20.307）

- 现象一：自定义风格的长 description 完整铺开，Windows XP Luna 卡片达到 8 行并撑高整行。修复为最多两行（36px）截断，完整说明保留在 title；AI 生成提示同时限制后续 description 不超过 48 个中文字符。
- 现象二：设置显示 `custom:windows-xp-luna` 已选中，但多数控件仍接近默认。运行态证据显示 JSON 已加载（壳层/卡片角色变量为 8px/4px），实际壳层/卡片却是 20px/6px。
- 根因：v2.20.305 用 `@scope (:root[data-ui-style-contract="v1"])` 隔离自定义规则，但内部仍以根祖先选择器开头，作用域根无法按该写法参与匹配；移除 `@scope` 后，文件后半段的同特异性基础组件规则又覆盖了自定义规则。
- 修复：47 组固定消费规则统一使用 `:root[data-ui-style-contract="v1"]`，既只命中自定义风格，又以根伪类 + 属性标记的稳定特异性压过后置基础形状，不使用 `!important`。Windows XP Luna 实机计算样式复核：shell 8px、活动风格卡 4px、普通按钮 3px + raised shadow、输入 2px/2px border + inset shadow，均与 JSON 一致。
- 验证：定向契约/风格 2 文件 28 项、最终全量 174 文件 1846 项、Node/Renderer typecheck、生产构建（main `701.24 kB`、renderer CSS `assets/index-DM6_vo8-.css`、JS `assets/index-C9D1Dd-5.js`）、OKF strict（14 concepts、474 links）与 180 天审计通过；自定义 Luna 运行态计算样式已量化核对，最终视觉待用户在 v2.20.307 截图复验。

## 2026-08-09 修复：AI 风格提示优先创建可导入 JSON 文件（v2.20.306）

- 根因：复制提示的终止指令是“只输出一个 JSON 代码块”，会明确诱导具备文件工具的 Agent 也把配置留在对话正文，用户还要手动复制并另存。
- 修复：提示现在要求 Agent 优先在当前工作目录创建 UTF-8 纯 JSON 文件 `kimix-ui-style-<id>.json`，成功后只返回文件路径、不重复配置全文；仅当执行环境确实不能写文件时，才降级输出 JSON 代码块并说明原因。
- 验证：提示词定向 1 文件 9 项、最终全量 174 文件 1846 项、Node/Renderer typecheck、生产构建（main `701.24 kB`、renderer CSS `assets/index-DRf1amHg.css`、JS `assets/index-DnQIBPo6.js`）、OKF strict（14 concepts、473 links）与 180 天审计通过。

## 2026-08-09 修复：自定义风格契约不再重画默认与内置风格（v2.20.305）

- 现象：v2.20.304 的默认界面被额外盒化——顶部运行/打开控件、侧栏选中行和 Composer 出现不属于原版的边框、圆角与阴影，视觉偏离 v2.20.301 已验收基线。
- 根因：V1 角色消费层错误使用 `:root:not([data-ui-style])` 和通用 `[data-ui-style]` 作用域，同时 `applyUiStyle` 给四套内置风格写入编译后的 inline `--ui-*`；因此新增契约以更高优先级覆盖了默认及内置专属 CSS。
- 修复：默认风格恢复为无属性、无 inline 编译变量；Modern/Retro/Nostalgia 只保留原有 `data-ui-style` 专属 CSS；仅 `custom:*` 写入编译变量并用 `data-ui-style-contract="v1"` 显式开启固定角色消费层。缺失自定义文档安全回退默认并清除两类属性和残余变量。
- 验证：定向风格/契约 2 文件 28 项、最终全量 174 文件 1846 项、Node/Renderer typecheck、生产构建（main `701.24 kB`、renderer CSS `assets/index-DRf1amHg.css`、JS `assets/index-DYoSaM2R.js`）、OKF strict（14 concepts、472 links）与 180 天审计通过；构建产物保留自定义 `@scope`，默认/内置视觉待用户在 v2.20.305 实机截图复验。

## 2026-08-09 功能：界面风格全面收口为可导入 JSON 契约（v2.20.304）

- 边界：只导入界面风格，不接管明暗主题、配色、字体、间距或布局。UI Style v1 仅允许有界圆角/边框、结构化浮雕与阴影、动效和完整语义角色状态；阴影色全部由当前主题 token 派生，拒绝颜色、任意 CSS、选择器、URL 与脚本。
- 引擎：新增严格 Schema、规范化与 `--ui-*` 编译器；Kimix 默认/现代/复古/怀旧提供同版受保护基线文档，自定义风格独立消费固定角色规则。自定义文档可基于内置风格继承缺失角色，持久化前物化为完整角色集。
- 产品链路：设置页支持选择 JSON 导入、立即应用、自定义项删除（当前项删除后回退默认）和复制由当前 Schema/角色目录/完整模板动态生成的 AI 提示；内置项没有删除入口。主进程限制 JSON 与 256 KB，导入后保存规范化副本，不依赖原文件路径；首帧缓存只保存当前自定义文档，设置保存完整风格库。
- 验证：定向契约/风格/圆角/设置布局与导航 5 文件 42 项通过；最终全量 174 文件 1846 项、Node/Renderer typecheck、生产构建（main `701.24 kB`、renderer CSS `assets/index-Bs7IJlSx.css`、JS `assets/index-DPp_lkfr.js`）、OKF strict（14 concepts、471 links）与 180 天审计通过。设置页导入/应用/删除与四套内置风格视觉待用户在 v2.20.304 实机复验。

## 2026-08-09 修复：切换模型同步重置为新模型默认思考强度（v2.20.303）

- 根因：聊天底栏模型切换只调用官方 `setModel`；Composer 的既有矫正只在旧 effort 不受新模型支持时触发。因此两个模型都支持同一档位时，旧模型的思考强度会被错误保留，覆盖新模型的 `default_effort`。
- 修复：模型切换从模型目录解析新模型有效的 `defaultEffort`，无可信默认时使用 `on` 交还官方决定；当前会话在 `setModel` 成功后对同一返回 runtime 调用 `setThinking`，欢迎屏待用模型同步更新新会话 effort。模型成功但思考 profile 暂时不可用时不回滚模型，本地保留目标 effort，由既有 resume/create 链路重放；切换按钮锁定覆盖两步操作。
- 验证：定向 3 文件 16 项、最终全量 173 文件 1836 项、Node/Renderer typecheck、生产构建（renderer CSS `assets/index-C0ZojaQD.css`、JS `assets/index-f0uNbnKK.js`）、OKF strict（14 concepts、470 links）与 180 天审计通过；实机交互待用户在 v2.20.303 切换模型复验。

## 2026-08-08 修复：review v2.20.272..294 后修前两批确认问题（v2.20.295）

- 背景：对上次发版 v2.20.272 以来 23 个提交做全量 review（3 组并行子代理 + 主代理抽查），无严重级；用户复核结论并定修复顺序。
- 第一批（#1+#9 同链合修，electron/kimiCodeHost.ts）：`isTurnCompletionEventType` 原匹配不带后缀的 `full_compaction`（永不命中——vendor emit 名是 `compaction.completed/cancelled`，wire 记录名是 `full_compaction.complete/cancel`），压缩成功后 `lastTurnCompletedAt` 不刷新；且快照重放帧/合成失败 `turn.ended` 会写入 `lastTurnCompletedAt`，与「重放不污染」注释矛盾。修法：匹配两套终态名（blocked 不计），`payload.snapshotReplay` 帧跳过 `recordTurnCompletion`；新增 3 单测固化。
- 第二批（src/components/layout/SkillsPanel.tsx）：installCapability 2s 轮询 interval 存 ref 并随卸载清理（此前卸载后永久轮询）；toggleSkill 失败回滚 `enabledIds` 乐观更新。
- 验收：typecheck 双配置 0 错误、全量 vitest 1818/1818（新增 3）、build 通过。vendor probe 未跑对照：probe 脚本无 compaction 断言，跑了也不覆盖本改动；事件名依据 vendor 源码实读（用户复核）与 compactionWire 类型定义。
- 遗留：第三批 #4（last_turn_reason 陈旧窗）/#5（turnSettled 同 tick）需先抓 SSE/事件流快照再动；其余轻微项挂后续择机。

## 2026-08-08 修复：默认/现代化下侧栏「打开项目」加号按钮补 hover 背景+阴影（v2.20.294）

- 现象：默认与现代化模式下，侧栏「项目」行右侧「打开项目」+ 按钮 hover 无背景/阴影，辨识度低（用户截图红箭头）。
- 根因：`.kimix-sidebar-icon-action` 基础规则只有尺寸与 transition，默认/现代化无 hover 背景/阴影；复古/怀旧有专属 hover（描边+浮雕）。
- 修法：index.css 新增 `.kimix-sidebar-icon-action:hover:where(:not(:disabled)) { background-color: var(--surface-hover); box-shadow: var(--shadow-hover); }`；`:where()` 把特异性压到 (0,2,0)，低于复古/怀旧专属 hover 的 (0,3,0)，不串扰。
- 验收（CDP 真实鼠标 hover + 1s 稳态读值）：default/modern hover = 浅灰底 #E5E8EA + 软投影；retro = 复古描边浮雕（#DADDE1 底 + 1px 环 + inset 高光）；nostalgia = Win98 浮雕，均未被破坏。typecheck 双配置 0 错误、全量 vitest 1815/1815、build 通过。实机截图待用户复验。

## 2026-08-08 功能：插件页整体重组 + 官方内置能力补全（v2.20.291–293，三提交）

- 背景：用户反馈插件页「草台班子」+ 官方商店缺 Computer Use。计划模式确认方向：Skills 顶部子 Tab 重组 + MCP tab 一起改。
- 根因闭合：① Skill 双卡=扫描只按绝对路径去重，同名跨根（.kimi-code/skills 与 .agents/skills）不去重；② 「vundefined」=marketplace.json 的 superpowers/vercel-plugin 无 version 字段；③ 商店缺项=marketplace.json 只有 3 个插件，kimi-cu/kimi-webbridge 是 v2 引擎 capabilityService 的客户端注入内置条目，node-sdk 已暴露 listCapabilities/installCapability，vendor bundle 实测可用。
- 阶段 A（0226c3df）：`electron/skillScanDedupe.ts` 按名去重（roots 顺序即优先级、Kimi Plugin 卡不参与、enabled 取并集、mergedDuplicates 明示）；capability 类型/host/IPC/preload 全链路（v1 降级空列表+明确报错）；探针 probe-kimi-code-capabilities.mjs 实测通过；顺带修复 vitest include 不含 electron/__tests__（280 轮测试此前从未运行）。
- 阶段 B（c1b8f03a）：SkillsPanel 重写为 本地 Skills/插件商店/运行时状态 三子页；卡片去 174px 固定行高、名称完整显示、双胶囊合一；商店子页内置能力区块（状态胶囊+安装/继续安装+2s 进度轮询+失败重试）、修 vundefined；运行时子页双列；消息整卡改细状态条。
- 阶段 C（3dd4fcd4）：McpPanel embedded 去 320px 左栏，配置/状态合并为顶部细信息条（路径收 title）；非 embedded 保留。
- 验收：去重测试 6/6、全量 vitest 1815/1815（含新接入的 electron 测试 12 例）、typecheck 双配置 0 错误、build 通过；dev 实例 CDP 端到端验证 IPC（capabilities 2 项、mergedDuplicates 7 个）+ 四张实机截图核对。实机复验待用户（布局观感、内置能力安装链路——安装会下载托管运行时，未在探针中执行）。

## 2026-08-08 功能：隐藏「长程任务」侧栏入口——官方 goal 模式已取代（v2.20.290）

- 背景：用户确认官方 goal 模式完全取代自建长程任务流程，要求隐藏功能入口。
- 修法：Sidebar 展开态与折叠态两处「长程任务」导航按钮移除（仅入口）；store（`longTasksOpen`/`setLongTasksOpen`）、LongTasksPanel、AppShell/App.tsx 长程任务运行时与既有任务会话的审查/侧栏 UI 全部保留，回滚即恢复按钮。
- 验收：typecheck 双配置 0 错误、全量 vitest 1803/1803、build 通过。实机待用户截图（侧栏导航应只剩 新对话/搜索/插件/Hooks）。

## 2026-08-08 修复：复古模式侧栏「打开项目」加号按钮上缘被裁切（v2.20.289）

- 现象：复古模式悬停侧栏「项目」行的加号按钮时，按钮上方边缘被裁掉一条。
- 根因（CDP 实测量化闭合）：侧栏滚动容器的 `pt-2` Tailwind 类未生成（stylesheet 中只有 `*{padding:0}` 命中），paddingTop 实测 0px，头部行与按钮贴在容器滚动口顶缘；复古 hover 的 `box-shadow: 0 0 0 1px` 外环向 border-box 外各方向多画 1px，溢出容器 padding box 上沿即被 `overflow-y:auto` 裁掉。
- 修法：Sidebar.tsx 滚动容器移除失效的 `pt-2`，inline style 补 `paddingTop: 8`（沿用 AGENTS.md「spacing 用 inline」惯例）。
- 验收：CDP 复测 paddingTop 8px、按钮顶部净空间 8px（1px 外环有富余）；typecheck 双配置 0 错误、全量 vitest 1803/1803、build 通过。实机视觉待用户截图复验。
- 后续事项（未改）：同一头部行的 `mb-2`、`px-3` 同样未生成（实测 marginBottom/paddingLeft 均 0），当前视觉可接受，如需恢复设计间距再单独一轮处理。

## 2026-08-07 修复：goal 续跑提示词被当用户消息渲染——三层折叠为「目标续跑」状态摘要（v2.20.288）

- 现象：goal 模式每轮的内部续跑提示词（"Continue working toward the active goal.…"）在 Kimix 渲染成用户气泡；官方 web/TUI 只显示一条 12px「目标续跑」来源标记。
- 根因（调查闭合，上游 0.34.0 源码佐证）：续跑提示词是纯文本 role=user 消息，结构化标记 `metadata.origin={kind:'system_trigger',name:'goal_continuation'}`，但 Kimix 两处帧合成（server 快照 `snapshotMessageToServerFrames`、SDK wire `parseKimiCodeRecord`）都把 origin 丢了，映射层无任何 goal 判定；`<system-reminder>` 类提醒（objective XML）此前已被 stripOfficialSystemReminders 覆盖，只有这条纯文本漏网。
- 修法（origin 为主、文本前缀兜底）：① electron 两层透传 origin 进帧 payload；② `eventHelpers.ts` 新增 `parseKimiGoalContinuation`（origin 命中或 trim 后两个固定前缀之一）；③ 三层折叠为 status_update「目标续跑」（保留事件位置维持轮边界，不 return null）：kimiCodeEventMapper live 分支、eventMapper wire 历史路径（mapStreamEvent，brief 外必要补充——历史恢复实际走这条）、sanitizePersistedEvents 清洗层。
- 误伤防护：`Resume the active goal.`（/goal resume）与首轮 objective 原文保持正常用户消息；近似文本「Continue working on this task.」与非 goal 的 system_trigger 均不折叠，负向用例覆盖。
- 验收：定向 313/313（eventHelpers/kimiCodeEventMapper/eventMapper）、关联回归 103/103、typecheck 双配置 0 错误；全量 vitest/build 见提交记录。实机复验待用户（goal 会话历史里的续跑提示词应变「目标续跑」摘要行）。

## 2026-08-07 修复：官方 goal 状态不同步——接住 goal.updated 事件 + 首次发现轮询（v2.20.287）

- 现象：CLI/web 侧创建的 goal（目标模式）在 kimi web 输入区上方显示「目标 进行中」pill，Kimix 同位置 pill 行缺失。
- 根因（两路只读调查闭合，含上游 0.34.0 源码佐证）：① goal 状态是专用通道（WS `goal.updated` + REST `GET /sessions/{id}/goal`），不进 snapshot/status/session 对象；SDK 路由下事件全链路透传到渲染层，但被 `kimiCodeEventMapper` 白名单 switch 的 `default: null` 丢弃；② 首次发现缺失——`scheduleOfficialGoalRefresh`/`refreshOfficialGoalState` 在 officialGoal 为空时直接 return，外部创建的 goal 永不拉取；server 路由本就无 goal 事件面，只能靠 REST 轮询。渲染层 pill 逻辑（ComposerDockBar:177）早已就绪，非根因。
- 修法：`officialGoalState.ts` 新增纯函数（事件 snapshot 归一/写入-清除语义/空 goal 60s 限流分档/版本竞态判定）；`App.tsx` onKimiCodeEvent 入口在 mapper 前早退接住 `goal.updated`（写 store 或清除 + bump 版本），goal 未知会话事件到达时 eager 调度首次发现，放开两处空 goal 门禁并加 per-session 版本竞态保护（REST 落地前版本变了即丢弃）。
- 验收：officialGoalState 14/14、周边回归 276/276、typecheck 双配置 0 错误；全量 vitest/build 见提交记录。实机复验待用户（CLI 创建 goal 后 Kimix 应出现「目标」pill，完成后消失）。
- 已知边界：goal.updated 早于会话归属解析到达时丢弃，靠 REST 首次发现兜底（弱一致）；空 goal 会话 60s 限流轮询。

## 2026-08-07 跟进：SDK 路由默认切 v2 引擎，v1 留环境变量回滚（上游跟进队列 5/5，v2.20.285）

- 背景：goal 队列第 5 项。前置 probe 已验证：v2 client 方法面完整（host 调用面全覆盖）、事件经 event-mapper 翻译回 v1 形状、v1/v2 会话存储（目录布局/state.json/wire.jsonl）完全同构可无缝互 resume。
- 修法：`KimiCodeSdkModule` 类型补 `createKimiHarnessV2` 签名；`getHarness()` 默认走 v2，`KIMIX_SDK_ENGINE=v1` 整体回退 v1，bundle 无 v2 导出时防御回退并 warn；`forcePluginSessionStartReminder` 两处传参加注「v2 忽略该参数」；探针 `probe-kimi-code-host.mjs` 加 `KIMIX_HOST_PROBE_ENGINE=v2` 参数化。
- 探针（v2）：主探针三轮全绿（prompt completed 16.7s 首字、steer completed 含 prompt.queued 排队事件、cancel cancelled）；触点验证全绿——resume 真实 v1 会话零污染（前后 sha256 全等）、fork 成功、listPlugins/listSkills/listMcpServers 只读正常。
- 行为差异（对 host 均无影响，已注释）：忙碌 prompt v1 丢弃 vs v2 FIFO 排队；空闲 steer v2 报 prompt.not_found；createSession 未知模型别名 v2 抛 config.invalid（host 有兜底）。
- 验收：定向 12/12、typecheck 双配置 0 错误；全量 vitest/build 见提交记录。实机复验待用户（SDK 兜底路由下的会话行为）；回滚：KIMIX_SDK_ENGINE=v1。

## 2026-08-07 跟进：缓存过期提醒——长闲置会话发送前提示 compact（上游跟进队列 4/5，v2.20.284）

- 背景：goal 队列第 4 项，上游 0.34.0 #2646 的 Kimix 版。可行性已验证：端点 `POST https://api.kimi.com/coding/v1/client_configs`（body `{"name":"estimated_cache_duration"}`）匿名可达（实测 200）；规则按模型给 `cache_duration`/`min_tokens_to_hint`（k3 系 600s、kimi-for-coding 系 3600s，阈值均 200k tokens）。
- 实现：① `src/utils/cacheHint.ts` 纯函数（schema/evaluateCacheHint/模型 id 去前缀兜底/时间线兜底 deriveSessionLastActiveAt）；② 主进程 `kimi-code:getCacheHintConfig` IPC（内存+磁盘 24h 双层缓存、5s 超时、有 token 带 Bearer 失败降级匿名、全程静默 skip）；③ lastActiveAt 双源——主进程在 SDK/Server 两事件漏斗按终态帧（turn.ended/prompt.completed/full_compaction）记录并经 `kimix.turn.activity` 下发（不进时间线），重启后渲染层时间线兜底；④ Composer 发送前同步检查（仅普通正文路径），命中弹 DialogSystem 的 CacheHintDialog 四动作：压缩并继续（compactSession 后重发）/开启新会话（带消息）/直接发送/不再询问（settingsService `cacheHintDismissed`）。
- 取舍：不做 FIFO 吞提交拦截（第一版只发送前检查+后台预热）；对话框由 Composer 直接渲染而非 App 状态提升（四动作全依赖 Composer 内部机制）。
- 验收：cacheHint 21/21、相关回归 127/127、typecheck 双配置 0 错误；全量 vitest/build 见提交记录。端到端 UI 与真实 Electron fetch 待用户实机（闲置>600s 且 ≥200k tokens 会话发送时应弹窗）。

## 2026-08-07 跟进：MCP 状态枚举对齐上游 0.34.0——removed 不再误显「未连接」（上游跟进队列 3/5，v2.20.283）

- 背景：goal 队列第 3 项。上游 0.34.0（#2694）MCP status 新枚举 pending/connected/failed/disabled/needs-auth/removed；Kimix `ServerMcpServer.status` 是旧猜值，McpPanel 未知状态一律误显「未连接」。
- 核实纠偏：server 路由 `/api/v1/mcp/servers` 仍返回旧 4 值枚举（server 端 mapMcpStatus 把新枚举压缩回旧值）；只有 SDK 会话路由与 `mcp.server.status` 事件返回新 6 值。`removed` 语义：工具保留注册但调用报移除提示。
- 修法：`ServerMcpServer.status` 取两路由并集 9 值；`toKimiCodeMcpServerInfo` 归一化（connecting→pending、error→failed、disconnected→disabled 沿用原语义，新 6 值透传）；新增 `src/utils/mcpServerStatus.ts` 文案/配色映射（removed/disabled 次要灰、failed/needs-auth 警示红、未知值显示原始字符串）；McpPanel removed 隐藏「重启」按钮。
- 验收：新增 5 例（mcpServerStatus 3 + kimiCodeServerHost 2），定向 113/113、typecheck 0 错误；全量 vitest/build 见提交前记录。视觉待用户截图（MCP 面板运行态卡片）。

## 2026-08-07 跟进：消费官方 last_turn_reason——侧栏失败标记 + busy 判定短路（上游跟进队列 2/5，v2.20.282）

- 背景：goal 队列第 2 项。官方 0.34.0 起会话列表/恢复携带 `last_turn_reason`（completed/cancelled/failed；cancelled 不持久化、busy 中省略）。本地 daemon 已是 0.34.0。
- 字段链路（server 路由）：`kimiCodeServerClient.ts:80` wire 字段 → `kimiCodeHost.ts:3568` 摘要映射 → `sessionCatalog.ts` reconcile 三处落 `Session.officialLastTurnReason`（归一化只收三值；目录缺失字段时显式覆盖清除，对齐 busy 省略语义防残留误标）。
- **重要纠偏**：前置调查报告称「SDK v1 路由 getStatus 已带 lastTurnReason」不实——实施子代理逐段核实 vendor 后确认 v1 引擎的 listSessions/getStatus 均不含该字段（94469 行映射的是 daemon 协议会话），SDK 路由恒缺失、走原启发式兜底，vendor 未改。
- 消费 1：`isSessionSidebarBusy` 在无权威 runtime 状态时，官方终态字段存在即判不 busy，跳过 2 分钟窗口；字段缺失保持原启发式（兜底不删）。
- 消费 2：Sidebar 会话项非 busy 且 `officialLastTurnReason === "failed"` 时时间旁显示 13px AlertTriangle（继承 text-text-muted，aria-label「上一轮已失败」）；cancelled/completed 不标。
- 验收：sessionActivity 新增 5 例（21/21）、sessionCatalog+orphanRoom 46/46、kimiCodeServerClient 69/69、typecheck 0 错误；全量 vitest/build 见提交前记录。实机复验待用户（失败会话侧栏应出现警告标）。

## 2026-08-07 跟进：vendor SDK 刷新 0.31.0→0.34.0（上游跟进队列 1/5，v2.20.281）

- 背景：goal 队列第 1 项。vendored node-sdk 从上游 tag 0.31.0（0.15.0）刷新到 0.34.0（0.15.3）；已验证 SDK 面零破坏（87 文件零增删、wire 事件格式不变、v1 client 路径两 tag 一致）。
- 执行：research repo（`.kimix-upstream-kimi-code-0.18.0/`，原为 shallow 克隆）fetch + checkout tag 0.34.0（commit f0614c53，注意 tag 对象 SHA ee5ad6aa≠commit）；corepack 自动切 pnpm 10.33.0 完成 install；tsdown 产出 dist/index.mjs；`scripts/vendor-kimi-code-sdk.mjs` 重打 bundle（MCP 超时补丁标记正常命中）。
- 探针：`probe-kimi-code-host.mjs` 三轮全过——prompt 轮 completed（10.4s）、steer 轮 completed（39.9s，含 tool.call）、cancel 轮 cancelled（836ms）。
- bundle：12,034,233 → 12,641,721 字节（+5.05%）；README provenance 表已更新（含 Bundled on 2026-08-07）。
- 验收：kimiCodeVendorBundle 3/3（marker 全命中）、typecheck 双配置 0 错误、全量 vitest 与 build 见提交前记录。
- 已知边界：0.34.0 新 SDK API（lastTurnReason、capability 管理、workspace trust 等）已随 bundle 就绪，消费在队列后续项；v1 引擎维护态风险记录在案（队列第 5 项切 v2 应对）。

## 2026-08-07 性能：启动恢复提速——目录扫描去重 + loadSession 并行编排（v2.20.280）

- 现象：每次启动恢复上次会话长时间停在「正在同步最新会话」；用户怀疑全量加载所有未归档会话。
- 调查（3 个只读子代理并行）：全量加载所有会话「历史」不成立——关键路径只加载当前会话正文；但全量「目录扫描」单次启动重复 2-3 次（恢复主链 App.tsx 原 2249 + currentProject effect 原 1577 + Sidebar 展开 296），且整条恢复链全串行；主进程 loadSession 先与 server 冷启动 4s 赛跑才开始解析本地 wire 镜像，server 路由下同一 wire.jsonl 还为 StatusUpdate 水合再全量解析一遍；后台 repairKimiCodeHistoryBodies（≤12 会话）与主链抢 IPC/CPU。
- 修法（2 个并行子代理，按文件归属分区）：① 新建 `src/utils/listKimiCodeSessionsDedupe.ts`（按 workDir 的 in-flight 去重 + 5s TTL），App.tsx 两处扫描改用它，启动窗口内每 workDir 只扫一次（Sidebar 那处未动，留后续）；② `electron/sessionHistory.ts` 新增 `loadSessionHistoryParallel`——本地镜像解析立即开始且只执行一次，server 冷启动与之并行（4s 上限不变），server 快照 StatusUpdate 水合复用同一解析结果，消除双读；③ App.tsx 恢复主链完成信号 + `scheduleHistoryRepairAfterStartup`（20s 兜底），后台修复延后到恢复链完成后。
- 验收：新增 5+6 例定向测试全绿，typecheck 双配置 0 错误，全量 vitest 1746/1746（基线 1741+5），build 通过；知识库 runtime-routing 新增不变量 14g，validate PASS。实机启动耗时改善幅度待用户复验。
- 已知边界/后续候选（未做）：Sidebar.tsx:296 第三次扫描未接入去重；resume→getStatus 重复取状态未去重（改动跨 preload 类型，暂搁）；各阶段实际毫秒占比未 profile（可用 startupProfiler/cdp 脚本补证据）；SDK 路由逐会话 brief 串行扫描仍可并行化。

## 2026-08-07 修复：压缩气泡去重——同时只有一个「压缩中」、完成后只剩摘要行（v2.20.279）

- 现象：① 压缩进行中同时出现两个「上下文压缩中」气泡；② 压缩完成后仍残留「耗时较长」x2 + 无摘要「压缩完成」三个气泡，只有「已生成摘要」行该留。
- 根因：官方一次压缩从多个通道各发一对 begin/end（`compaction.started` / `full_compaction.begin` 等映射到同一 compaction 事件），时间线堆出嵌套重复序列（b,b,b,e,e）；旧 `collapseCompletedCompactions` 只删「下一条压缩事件恰好是 end」的 begin，嵌套序列里中间的 begin 下一条仍是 begin，被漏掉。
- 修法：`eventHelpers.ts` 新增 `normalizeCompactionDisplay`，按「连续压缩事件簇」归一：栈式配对 begin→end，簇内有 end 时 begin 全删、只留一个 end（优先带摘要、并列取靠后）；仍在压缩只留最后一条 begin；最后一条 end 之后的未配对 begin 视为新一轮压缩予以保留。`ChatThread` 删掉旧本地函数改用该工具。
- 验收：eventHelpers 新增 5 例（含图1/图2 实机序列复现），定向 53/53、typecheck 双配置、全量 vitest 1741/1741、build 均过；实机复验待用户（下次 /compact 观察气泡数量）。

## 2026-08-07 修复：流式思考首句孤立不随续流滚动——draft 思考并入尾部 live 思考组滚动窗（v2.20.278）

- 现象：正在思考阶段，整段思考的第一句孤立悬在上方固定不动，下面大块续流在另一个 5 行滚动窗里滚动（用户截图红框确认孤立句是整段输出第一句）。
- 根因：流式期间任何正式帧到达都会把缓冲 draft 提交成正式思考段（`commitActiveTurnDraftsToBatch` / useEventStream 身体帧提交路径）。已提交段进入正式 turnBlocks 尾部思考组并占用该组的 live 滚动窗（`KimiWebThinkingBlock` isLive），续流 draft 却由 `LiveDraftTail` 的独立 `LiveThinkingPre` 在下方再开一个滚动窗——两个窗堆叠，先提交的短段（常是第一句）只有一行、无滚动条，看起来固定不动、不随下文滚动。
- 修法：新增 `shouldMergeLiveThinkingDraftIntoTimeline`（`liveThinkingViewport.ts`，条件与 `shouldUseLiveThinkingViewport` 一致：末尾组是思考组且 live）；为 true 时 draft 思考改由新叶子 `LiveThinkingDraftTail` 渲染进该组同一个滚动窗（draft 订阅下沉叶子、每帧只重渲染叶子，滚动跟随复用外层 `followLatestRef`），`LiveDraftTail` 以 `suppressThinking` 关闭自己的第二个滚动窗。
- 验收：liveThinkingViewport 新增 3 例（末尾组非思考 / 非活跃轮 / 折叠过渡期），定向 21/21、typecheck 双配置、全量 vitest 1736/1736、build 均过；实机复验待用户（正在思考时长段思考应只有一个滚动窗、首句随流滚动）。

## 2026-08-07 修复：后台子代理/残留 running 工具挡住轮 settle，思考工具链不自动折叠（v2.20.277）

- 根因：自动折叠只在 `hasFinalContent` false→true 跳变时触发（`shouldCollapseKimiWebProcessOnFinalContent`），而 `hasFinalContent = isComplete && !isActiveAssistant && hasContent`，`isActiveAssistant = !turnSettled`。`buildRenderItems` 的 `isSessionLevelTurnStopped` 要求 `!hasPendingToolOrSubagent`——轮内带 run_in_background 子代理（可能跑几十分钟）或残留 running 工具时，会话已停轮仍不 settle，折叠永不触发。
- 依据：前台执行必然伴随会话运行中（isSessionRunning / activeRoomAgentTurn 覆盖）；会话已停时 running 条目只可能是后台任务或残留标志。
- 修法：`ChatThread.tsx` `isSessionLevelTurnStopped` 去掉 `&& !hasPendingToolOrSubagent`（第四分支的运行中守卫保留，覆盖会话仍运行但本轮已完的语义）。
- 复现先行：chatRenderItems 新增 2 例（后台子代理 running / 工具 result 缺失残留 running），未修复时 2 例皆失败（已验证），修复后通过。
- 验收：定向 55/55、typecheck、全量 vitest、build 均过；实机复验待用户（后台子代理运行时主轮输出结束应收折）。


## 2026-08-07 功能：对话刻度设置——开关/左右侧/宽度（v2.20.276）

- 需求：设置里可关闭对话刻度、切换刻度位于左侧或右侧、调整刻度宽度。
- 修法：新增三个持久化设置 `chatNavigationRailEnabled/Side/Width`（默认 开/左/11px，宽度 6-28），走完整设置管线（ipc 类型 + zod + settingsService 默认值 + useBootstrap 水合 + useSettingsSync 落盘 + App bootstrapSetters + main.tsx 浏览器预览默认值）；`ChatNavigationRail` 新增 `side`/`markWidth` props（右侧时刻度线贴右缘、预览浮层改向刻度左侧展开，`chatNavigationPreviewPosition` 加 `side` 参数）；`ChatThread` 按开关条件渲染；设置面板外观区「界面字号」卡下新增「对话刻度」卡（SelectionIndicator 开关 + 位置 select + 宽度 NumberInput，关闭时后两项禁用）。
- 验收：chatNavigation 定向 11/11（含右侧预览定位新例）、typecheck 双配置、全量 vitest、build 均过；视觉待用户截图。


## 2026-08-07 调整：侧栏 Git 卡布局——刷新上移头部、图谱/推送同行（v2.20.275）

- 需求：Git 卡刷新按钮从底部移到头部拖拽钮左侧（替代项目目录文本，与 Kimi Code 卡同构）；图谱与推送放一行，推送恢复正常半宽。
- 修法：`LongTaskInspectorPanel.tsx` Git 卡头部改为 `[标题, 刷新+拖拽]` 两列；按钮区合并为单一 2 列 grid（详情/拉取、图谱/推送），去掉窄宽时推送独占整行的 `gridColumn` 逻辑；清理随之失效的 `gitProjectLabel`、`projectNameFromPath`、`displayProjectName` 导入。
- 验收：typecheck、全量 vitest、build 通过；视觉待用户截图。


## 2026-08-07 修复：思考强度运行中可预切换（v2.20.274）

- 根因：`Composer.tsx` `handleSetThinkingEffort` 首行 `if (isMutationOwnerRunning) return;`（自 a91929e4 引入起就存在的保守拦截），运行中点击菜单项被静默吞掉，菜单不关、显示不变，与按钮 tooltip「运行中切换将从下一轮生效」的承诺矛盾。
- 依据：SDK/server 两侧 `setThinking` 均为 profile 级写入（`IAgentProfileService.setThinking` / `updateSession`），无轮次守卫；当前轮继续用旧值，下一轮生效——正是预切换语义。权限模式早已按同语义放开。
- 修法：移除拦截；成功 toast 在运行中追加「，将从下一轮生效」。显示链路（`setActiveThinkingEffort` + `setDefaultThinkingEffort`）即时更新按钮标签。
- 验收：typecheck、全量 vitest、build 通过；实机复验待用户。


## 2026-08-07 修复：数字输入框逐键 clamp 吞中间态（v2.20.273）

- 问题：设置「界面字号」无法正常输入——受控值直连 store，store setter 每键 clamp 到 [11,20]，输 15 时第一个字符「1」先被压成 11、补一位又顶到 20。
- 排查：全仓 5 处 type=number——字号（[11,20] store clamp，致命）、推荐轮数上限（[1,200] store clamp，同类）、Hooks 超时（[1,600] 行内 clamp，轻度）、模型 Context 与长程任务 Step（本地字符串草稿，正常）。
- 修法：新增共享组件 `src/components/common/NumberInput.tsx`（草稿语义：聚焦期草稿优先，落回范围内实时提交，越界/空草稿不打断，失焦/Enter 钳制提交、非法回退），替换三处问题输入框；新增 5 例组件测试。
- 验收：定向 5/5、renderer typecheck、全量 vitest、build 均过；实机输入待用户复验。


## 2026-08-07 修复：通知卡折进思考工具链 + 样式走 Kimix 基础（v2.20.272）

- 问题：v2.20.269 的通知详情卡/分组卡整卡铺 tone 底色（现代模式发蓝、复古刺眼），且作为独立块漂在正文下方，不进思考工具链。
- 修法：`turnBlocks.ts` 新增 notification 块类型（buildTurnBlocks 按事件位置成块、groupTurnBlocks 相邻聚合、turnBlocksEqual）；`MessageBubble` 双显示模式接入（kimi-web 走 TurnBlocksProcessGroup、kimix 走 ProcessItem→ProcessDetailList），摘要行计「N 条通知」；`ChatThread` 轮内不再独立推，纯通知轮（无 assistant/工具载体，如闲置时后台任务完成）回退独立卡 + ≥3 分组；`NotificationCard`/`NotificationGroupCard` 重构为 kimix-soft-card 基础样式 + 仅图标/计数点着色调。
- 审计：时间线卡片中近期新增的只有通知卡两种（上一张新增卡是 v2.5.45 QuestionCard）；pending 审批/提问保持独立可交互卡是官方式有意设计，已 resolve 的走 turnBlocks 折叠，管线归属正确。
- 验收：定向 78/78、renderer typecheck、全量 vitest、build 均过；视觉待用户截图。


## 2026-08-07 修复：提问外部 settle 触发点加固（v2.20.271）

- 实机复验 v2.20.270 失败：web/CLI 端已答提问在 Kimix 仍残留待回答。根因：单触发点（setStatus 迁出 waiting_question）不可靠——外部轮次的 prompt.completed/状态迁移可能整段缺席（Server 不向非发起客户端广播完成帧），状态永远停在 waiting_question，对账钩子永不触发。
- 修法（全部汇到同一个 settleExternallyResolvedServerQuestions 对账函数）：1) 新增纯函数 shouldResumeWaitingQuestionOnFrame——waiting_question 期间主 Agent 轮次活动帧（delta/content.part/tool 系）到达即翻回 running，经 setStatus 触发对账；只认主 Agent 帧（子代理在主 Agent 阻塞时仍会输出），审批不走这条（拒绝后同样有输出，无法区分去向）；2) 新 question.requested 到达前先对账旧条目（单 pending 不变量，覆盖外部答 Q1→立即追问 Q2 无输出帧场景）；3) 快照重放后用该快照 prefetched pending 集合直接对账（重连恢复路径，免重复抓取）。
- 验收：定向 39/39、双 typecheck、全量 vitest、build 均过；实机复验待用户。

## 2026-08-07 修复：web 端已答提问残留待回答（v2.20.270）

- 根因：官方 Server 在其他客户端（web）回答提问后不广播 resolved 帧，只把条目从 pending 列表移除；审批卡早有外部 settle 对账（`settleExternallyResolvedServerApprovals`），提问卡缺同款机制，导致 `question_request` 永远 pending。
- 修法：`electron/kimiCodeHost.ts` 新增 `settleExternallyResolvedServerQuestions`（快照对账 + 2s/4s/6s 退避重试，与审批同款）+ 两个 export 纯函数；`setStatus` 迁出 `waiting_question` 时触发；`src/App.tsx` 新增 `kimix.question.resolved` 消费块（镜像审批块，含 collaboration 各 roomAgent）。
- 边缘：web 答 Q1 后 agent 立即追问 Q2 的场景在下一次状态迁出 waiting_question 时自愈（单触发点，有意不加第二触发）；外部 settle 一律 answered，过期失活由 settleInactiveEvents 兜底。
- 验收：定向 36/36、双 typecheck 过、全量 vitest 绿、build 过；实机复验待用户（web+Kimix 同开会话，web 答后 Kimix 卡片应变已答）。

## 2026-08-07 功能：后台任务/定时任务通知卡+分组卡，对齐官方（v2.20.269）

- 起因：官方输出流的通知是「N 条通知」分组卡+可展开详情卡（类型/来源/严重度/正文/原始 payload），Kimix 只有摘要 pill。排查确认数据在映射层被丢：信封带全字段（type/source_kind/source_id/Title/Severity/正文），parseKimiAgentEnvelope 只提取一句 summary。
- 数据层：parseKimiAgentEnvelope 升级返回 StatusNotificationDetail（kind/type/category/sourceKind/sourceId/title/severity/body/raw，cron-fire 同构 type=cron.fire）；status_update 加可选 notification 字段（additive，旧持久化数据回退 pill）；3 个映射口（kimiCodeEventMapper 实时/eventMapper TurnBegin 回放/sanitizePersistedEvents 持久化清洗）同步带上。
- 渲染层：新组件 NotificationCard（色调卡，头部图标+中文标题+英文副标题+「状态 HH:MM」，展开详情+原始 payload 折叠）与 NotificationGroupCard（「N 条通知」+摘要行+色调点）；新渲染项 notification_group；groupNotificationRenderItems 在 buildRenderItems 出口聚合连续 ≥3 条（1-2 条逐条详情卡，匹配官方两截图行为）。
- 管线接线：轮内主循环通知 status_update 按事件位置独立渲染（原被统一跳过）；轮末 trailing/settled 兜底排除通知防重复；filterStatusUpdates 豁免通知（turn_end/never 档不再丢官方通知）；chatNavigation 三类函数补 notification_group 分支。
- 测试：eventHelpers +3（detail 断言）、notificationGroups 新文件 5 例、NotificationCard 新文件 4 例、ChatThread +3（按位渲染/分组/兜底防重）。全量 164 文件 1717 例全绿、两套 typecheck、pnpm build 通过。视觉待用户截图。

## 2026-08-07 功能：dock 目标胶囊+弹窗，接通官方 Goal UI（v2.20.268）

- 起因：用户发现 dock 胶囊缺官方客户端的「目标 · 进行中」胶囊。排查结论：不是没同步——session.officialGoal 同步链路（事件流/快照对账/手动刷新）完好，是 UI 从未实现；AppShell 传给侧栏面板的 officialGoal + 5 个 goal 回调是死 prop（面板只声明类型没解构渲染），ComposerDockBar 只有 4 类胶囊。
- 实现（用户选定胶囊+弹窗方案，对齐官方）：ComposerDockBar 加第 5 类 goal 胶囊（排第一，非终态才显示，count 为状态文案），弹窗显示 objective/完成判据/轮次 tokens/状态 + 暂停/继续/取消/刷新按钮（busy 防连点，handler 同步调用）；AppShell 把 mutationSessionView.officialGoal 与 4 个回调经 Composer 注入（复用现有 ensureInspectorMutationRuntime 链路），goal 回调 reason 字符串从「from Kimix sidebar」改「from Kimix」。
- 测试：ComposerDockBar +3 例（进行中胶囊排第一+面板操作、终态不显示、已暂停继续按钮+消失自动关面板）；修 busy 异步收尾致同步连点被吞的测试问题（run 改同步调用 handler）；uiStyles 断言同步上一轮侧栏刷新按钮纯图标化（遗漏，上轮未跑全量）。
- 验收：全量 164 文件 1705 例全绿、两套 typecheck、pnpm build 通过。视觉待用户截图。

## 2026-08-06 修复：阶段 3 低级项一批（21 项，v2.20.266）

- 已修 20 项（16 项子代理分区、4 项主理，关键结论已抽查复核）：
  - B1 watch TTL：postTerminalExternalWatch 原「观察不设过期」，会话废弃后 Map 只增不减且每 30s 空探；加 30min TTL 淘汰（entry 加 armedAt）+ TTL 用例。B4 顺手删 deliver() 里 kimix.server.snapshot 删 watch 的死分支（该帧只在 recoverSnapshot 直发，不经 deliver）。
  - B2 会话级状态清理：新模块 kimiCodeSessionState.ts（forgetSessionState），host 5 个会话销毁/迁移调用点接线 + 5 测试。
  - B3 steerConfirm 时钟校准：本地钟偏快时确认消息被误判为旧消息；首探未命中后用官方最大时间戳覆盖基线（校准放内容匹配之后，避免吸收确认消息自身时间戳）。
  - B5 projectService untracked 目录过滤 isDirectory + 集成测试；B6 getMcpStartupMetrics 补 resolveMigratedSessionId（与 listMcpServers 同款）。
  - C2 sessionMetrics：通知摘要文案（「后台任务已完成：…」等前缀）作为唯一/首元素时不再原样泄漏进轮末信息卡 message，token 指标保留；acc 分支同步剥通知文案。
  - C4 liveTurnDiag 两个 anchor Map FIFO 200 key 上限；C5 turnBlocks nearDuplicate 升级分支不再动 textBoundaryPending；C6 attachedSteers 死路径删除；C7 AssistantProcessBlock memo 比较器补 event.content。
  - D1 互斥空态复位：backgroundTasks 新 pruneHiddenTaskKeysWhenEmpty + AppShell effect，任务列表清空时自动解除 hidden（否则「恢复胶囊」入口不可达只能重启）；D2 胶囊面板 maxHeight 改 min(342px, calc(100vh - 220px)) 防矮窗口裁顶；D3 SettingsPanel 权限变更 try/finally + 新测试文件；D4 AppShell 后台任务刷新会话守卫 ref 三处比对（无测试基建，仅 typecheck+逻辑论证）。
  - E1 胶囊展开色走 --ui-toggle-color；E2 nostalgia settings-input 焦点 1px 点线 outline；E3 --ui-radius-xl 三处规则 fallback 12/10px 改 20px。
- 跳过 3 项：C1 按停止规则——kimix.turn.model 信号只带 {model, phase}，host 无轮次起始追踪，渲染层纯启发式无法区分「刚完成的 settle 轮」与「流式中的下一轮」，正确修复需跨进程信号扩展，超出低级项范围；残留场景由历史对账 backfill 自愈。D5 前提不成立（latest_chat_id 全仓不存在）。E4 证伪（z-20 会盖滚动到底按钮）。
- 方案偏离说明：E3 有意不改 :root 定义 --ui-radius-xl，避免 105 处 rounded-xl 工具类全站漂移（tailwind.config.ts），只改用到该令牌的三处规则 fallback。
- 阶段 3 收尾：全量 164 文件 1702 例全绿、两套 typecheck 通过、pnpm build 通过（新 hash）。E 项样式仅代码自查，视觉验收留用户截图。

## 2026-08-06 修复：阶段 2 渲染内存与测试保护（A4+A5+A6，v2.20.265）

- A4：`committedSegments` 只增不减（生产零清理）。修复：LRU 上限 40，take 时 delete+set 移到最新、超限从 oldest 淘汰。未按原设想挂 turn 终态/会话切换清理——会话切换时后台会话可能仍在流式、turn 刚结束时迟到 resync 重放仍依赖条目，两钩子都不安全；被淘汰旧 turn 的重放由 formalCoverage 兜底。新增 LRU 淘汰回归 1 例。
- A5：steer 切分两段轮共享 `completedTurnCacheKey`（同 agentTurnId+startedAt），事件身份校验挡住错渲染但双方每遍互相覆盖、缓存形同虚设。修复：flushTurn 按 turnId 分配段序号（0=前段、1=后段）并进 key。
- A6：ChatThread.test.ts 新增 steer 切分 describe 3 例（切分顺序+各段正文恰好一次、双段独立缓存键+重渲染全命中引用、后段重连重放去重不丢内容），此前 steer 渲染零覆盖。
- 阶段 2 收尾：全量 162 文件 1685 例全绿、两套 typecheck 通过。

## 2026-08-06 修复：A2 跨轮残片替换补「本地下一轮已对齐」安全前提（v2.20.264）

- review A2。根因：`mergeCanonicalFragmentTurnBodies` 的 isCrossTurnRemnant 注释声称「下一轮已对齐到本地轮（否则不进此分支）」，但代码从未校验 `localTurns[i+1]`；本地缺下一轮 user 边界时，残片是下一轮内容在本地唯一副本，仍被顶成本轮官方终段，永久丢失且后续对账无法兜回。修复：对齐循环改索引式，新增 `nextLocalAligned`（`turnUsersMatch(localTurns[i+1], canonicalTurns[matchIndex+1])`）前提，不满足则跳过并计 `crossTurnUnalignedSkips` 留痕（两条日志 payload 同步带上）。测试：新增「本地缺下一轮边界残片保留」回归 1 例。阶段 1（A1/A3/A2）收尾：全量 162 文件 1681 例全绿、两套 typecheck 通过。

## 2026-08-06 修复：A3 turnBlocks 同段重放去重方向修正——反序不再丢完整正文（v2.20.263）

- review A3。根因：同 turn 前缀去重对「既有段是新段前缀（新段更长）」方向也 continue 丢新段，反序到达（滞留短前缀先材料化、官方完整段后重放）时完整正文被丢成 35 字符开场白；且实机两段只差结尾标点（「桌面：」vs「桌面。」），严格 startsWith 双向都不匹配，只能靠 ≥20 字符长前缀兜底。修复：统一为 nearDuplicate 判定（相等/互为前缀/长前缀分叉），按长度保留更完整者——既有不短则跳过新段，新段更长则原位升级既有段（events.push + content 替换）。测试：新增反序回归 1 例，turnBlocks 39/39 通过。

## 2026-08-06 修复：A1 promote 失败不再全局杀 daemon（v2.20.262）

- review A1。根因：`promoteSdkSessionToServer` catch 里凡非 404 一律 `markServerRuntimeFailure`，单个损坏会话（daemon 活着但 getSession 持续 500）让 10s 巡检每轮杀一次整个 daemon + 全部空闲会话迁 SDK，自维持循环。修复：新增纯策略模块 `electron/kimiCodePromotePolicy.ts`——`isDaemonLevelPromoteError` 只认明确网络/守护进程信号（fetch failed/ECONN*/WS 未连接等），其余一律会话级；`PromoteFailureBackoff` 指数退避（60s×4ⁿ 封顶 30min）。host 接线：会话级失败只跳过该会话+退避+warn 留痕，成功 promote 清零。测试：新增 6 例（分级+退避窗口/增长/封顶/清零/会话隔离）。

## 2026-08-06 全面 Review：v2.20.145 → v2.20.261（137 提交 / 142 文件）

- 方式：8 个只读 explore 子代理按模块分区审查，主代理对全部"中"级结论逐条读码复核（1 条证伪：steer handler throw 实际被外层 catch 转 {success:false}，Composer 有 failed+toast 处理）。分区定向测试共 1300+ 用例全过。
- 确认的中级问题（均已复核，等用户圈定修复顺序）：① electron/kimiCodeHost.ts:1469 单会话 promote 失败→markFallback 杀整个 daemon→10s ticker 自维持循环；② kimiHistoryReconciliation.ts:947 isCrossTurnRemnant 缺本地下一轮对齐校验，可能永久丢轮内容；③ turnBlocks.ts:133 前缀去重方向不对称丢更长正文段；④ activeTurnDraftStore.ts:520 committedSegments 生产零清理只增不减；⑤ ChatThread.tsx:1276 steer 两段轮共享 completedTurnCacheKey 缓存击穿；⑥ steer 切分渲染逻辑零测试覆盖（ChatThread.test.ts 无 steer 用例）。
- 低级问题约 20 条（post-terminal watch 永不过期、steerConfirm 时钟未校准、胶囊空态无法复位 hidden、胶囊展开色绕令牌、nostalgia 输入框无焦点指示等），清单在本轮会话 review 报告。
- 建议修复优先级：①杀 daemon 循环 → ③丢正文 → ②历史替换 → ④内存累积 → ⑤⑥缓存 key+补测试。
- 注意：TASK_STATE.md 已 2443 行，超 2000 行归档阈值，需尽快归档早期条目到 TASK_HISTORY.md。

## 2026-08-06 修复：胶囊弹窗与侧栏后台任务块互斥（v2.20.261）

- 现场：胶囊弹窗和侧栏「后台 Bash」「子 Agent」块同时存在。用户定义终态语义：默认只显示胶囊+弹窗；点收起到侧栏 → 胶囊弹窗消失、侧栏块出现；侧栏点恢复 → 胶囊回来、侧栏块消失。修复：LongTaskInspectorPanel 两个任务卡渲染条件加 `(hiddenComposerCardKeys ?? []).includes(key)`，未收起时一律不渲染；「恢复胶囊」按钮天然只在已收起时出现。测试更新：互斥新例（有任务未收起不渲染）+ 原渲染例补 hiddenComposerCardKeys。

## 2026-08-06 微调：胶囊与输入框间距减半（v2.20.260）

- 现场：胶囊与输入框间 16px（dock marginBottom 8 + Composer paddingTop 8）嫌大，用户要求减半。修复：ComposerDockBar 根 marginBottom 8→0，间距只留 Composer paddingTop 的 8px。

## 2026-08-06 修复：footer 顶边渐变遮罩（伪元素，不改布局）（v2.20.259）

- 现场：258 回退后 footer 顶边仍是实色硬切，用户要求"向上延伸一点的渐变、不要改变高度"。修复：`.kimix-app-shell-footer::before` 伪元素（bottom:100%、height:28px、transparent→surface-base、pointer-events:none）叠在聊天区底部，不占文档流高度、无负 margin（255 翻车根因规避）；modern 用工作区底色覆写。

## 2026-08-06 回退：撤销 footer 负 margin 重叠渐变（v2.20.258）

- 现场：v2.20.257 实机窗口顶部工具栏被裁切（用户截图箭头处），系 255 的 `margin-top:-28px` footer 重叠破坏壳层布局。用户要求立即回退。处理：`git revert 28aa0915`（仅撤 255 的页脚改动，冲突的 TASK_STATE/package.json 保留当前态）；256/257 的侧栏语义保留。页脚回到 254 实色条形态，胶囊悬浮保留。

## 2026-08-06 修正：bash/subagent 收起语义回归，恢复入口并入侧栏旧块（v2.20.257）

- 现场：256 误删了 bash/subagent 的收起到侧栏按钮；用户本意是胶囊显隐逻辑不变（有任务才显示），侧栏不出现重复的独立小块。修正：恢复胶囊面板的收起到侧栏按钮与 hiddenCards 抑制（ComposerDockCard 恢复 bash/subagent）；侧栏不渲染独立恢复小块，改为在旧「后台 Bash」/「子 Agent」块头部注入「恢复胶囊」小按钮（LongTaskInspectorPanel 新增可选 prop hiddenComposerCardKeys，AppShell 传 hiddenComposerCardList）。未收起时侧栏只有旧块，无任何重复。

## 2026-08-06 修复：后台任务侧栏双块去重——去掉 bash/subagent 收起语义（v2.20.256）

- 现场：侧栏出现两个后台 Bash 块——旧的内容丰富的后台任务卡 + 250 新加的「收起到侧栏」恢复条目。修复：bash/subagent 胶囊不再有收起到侧栏（侧栏展示归旧块全权负责），面板头部只留 X 关闭；`ComposerDockCard` 类型还原（去掉 bash/subagent）；Composer 不再按 hiddenCards 抑制这两个胶囊；AppShell 删恢复条目与 SquareTerminal/Users 导入。todo/queue 收起语义不变。DockBar 测试改为 7 例（bash/subagent 无收起、todo/queue 双按钮）。

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

