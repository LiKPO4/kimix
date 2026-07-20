# 计划：Agent 流式输出时滚动卡顿治理

> 状态：待评审  
> 日期：2026-07-20  
> 范围：对话流渲染 + 视口滚动，不涉及模型/Server 协议变更  
> 目标体验：接近 Codex 桌面端——**输出可以密，用户滚动必须稳**

---

## 1. 问题是什么

### 1.1 用户现象

- Agent **正在输出**时，在对话区上下滚动有明显卡顿。
- 即使用户**没有**完全展开思考详情和工具详情，卡顿仍在。
- 底部显示「运行中」，过程区可见折叠的「N 个工具调用」摘要行，正文在持续增长。

### 1.2 问题不是什么

- 不是单纯“工具/思考展开太多 DOM”的问题（折叠时也会卡）。
- 不是单一 CSS 或某一帧偶发掉帧。
- 不是必须先上虚拟列表才能解决（虚拟列表是长会话增强，不是根因主刀）。

---

## 2. 根因（基于当前代码的结论）

流式输出时，主线程上叠加了三条重路径，并与用户滚动争用：

```
SSE/事件
  → 约 80ms 一批 updateSession（整会话时间线引用更新）
  → ChatThread 重渲染 + 活跃轮 buildRenderItems（跑着的轮不进完成缓存）
  → 活跃 MessageBubble 因 content 全文变化而整泡重渲
  → Markdown 流式路径仍跑 GFM + Math + KaTeX + Highlight（贵）
  → contentVersion 变化 → 视口保锚 / ResizeObserver / 导航轨测量
  → 与用户 wheel/touch 滚动争主线程 → 卡顿
```

### 2.1 写入过密、过整

| 点 | 现状 | 影响 |
|----|------|------|
| 批处理间隔 | `STREAM_EVENT_FLUSH_MS = 80` | 约 12.5 次/秒写 store |
| 更新粒度 | `updateSession` 替换整段 agent events | 订阅会话的树大面积重渲染 |
| 活跃轮缓存 | 运行中最新轮**禁止** completed-turn cache | 每批都重跑 `renderTurnBody` |
| 历史轮缓存命中 | 缓存命中检查用引用相等 `event === turnEvents[i]`（`ChatThread.tsx:1063-1068`），但 `projectCollaborationTimeline` 每次 flush 都用 spread 重建事件对象（`collaborationTimeline.ts:53-58, 146-160`） | **历史已完成轮每次 flush 都重跑 `renderTurnBody`，缓存实际完全失效** |

相关：`src/hooks/useEventStream.ts`、`src/components/chat/ChatThread.tsx`（`buildRenderItems` / `canCacheTurn` / `renderCachedTurnBody`）、`src/utils/collaborationTimeline.ts`（`projectCollaborationTimeline` 每次 spread 重建事件，是 A4 的根因所在）。

### 2.2 渲染过重

| 点 | 现状 | 影响 |
|----|------|------|
| 流式 Markdown | `streaming={isActiveAssistant}` 仍用完整 remark/rehype 栈 | 每批对“最后一块”全量 parse + highlight/math |
| memo 失效 | `timelineEventMemoKey` 把整段 `content`/`thinking` 拼进 key | 每字变化 → 整泡（过程区+正文+footer）重渲 |
| 过程区与正文同泡 | 同一 `AssistantMessageBubble`，共享 `messageBubblePropsEqual` | 正文变 → memo 破 → 整泡子树 VNode 重建与 commit（含过程摘要/工具行/footer）。注：`AssistantProcessSummary` 内部 `useMemo` 已不依赖 content，代价是 commit 而非内部计算重跑 |

相关：`src/components/chat/MarkdownRenderer.tsx`、`src/components/chat/MessageBubble.tsx`。

### 2.3 滚动与布局争用

| 点 | 现状 | 影响 |
|----|------|------|
| `contentVersion` | 每批随正文长度/对象身份变化 | 触发 layout effect |
| 脱离子跟随保锚 | 内容变时尝试 `restoreManualScrollAnchor` | 用户滚时仍可能改 `scrollTop` |
| 导航轨 | scroll + resize 时 rAF 重测 | 与滚动同帧抢主线程 |
| ResizeObserver | 内容撑高即回调 | 流式时频繁 |

相关：`src/hooks/useChatViewport.ts`、`useScrollAnchor.ts`、`ChatNavigationRail.tsx`。

### 2.4 为何“没展开工具”也会卡

- 折叠只减少工具**详情** DOM，不停止：
  - 正文流式 Markdown；
  - 活跃轮 renderItems 重建；
  - 视口 contentVersion / 保锚；
  - （Kimi Web 模式下）过程列表摘要行仍可能随工具数更新。
- 卡顿主因是 **输出驱动的高频重算**，不是展开深度。

---

## 3. 目标与非目标

### 3.1 目标

1. 用户**正在滚动阅读**时，流式输出几乎不抢滚动（跟手优先）。
2. **历史已完成轮**在流式期间接近零重渲。
3. 流式阶段正文渲染成本显著下降；完成后再做富文本精排。
4. 不破坏现有正确性：工具起止、完成帧、失败帧、多 Agent 归属、视口双模式语义。

### 3.2 非目标（本计划不做）

- 不改 Kimi Server/SDK 协议与模型路由。
- 不重做整套 Chat UI。
- 第一阶段不上完整消息虚拟列表（避免与五轮尾窗/导航轨强耦合，放到后续）。
- 不以“关闭 Markdown”或“关闭过程信息”为产品妥协。

### 3.3 成功标准（生产 build 验收）

同一长会话、Agent 持续输出时：

| 指标 | 目标 |
|------|------|
| 用户滚动历史的 2s 内 | 流式逻辑对 `scrollTop` 的写入 ≈ 0 |
| 历史完成泡 React commit | 流式期间 ≈ 0 |
| 流式正文路径 | 不跑 rehype-highlight / katex |
| 主线程长任务 | 单次 commit 相关工作尽量 < 50ms |
| 贴底跟随 30s 流式 | 可接受偶发掉帧，无明显“整页冻住” |

验收手段：React Profiler + Performance 面板；对比改前/改后同一操作路径。

---

## 4. 总体策略（三层隔离）

```
L1 写入：稀、局部     → 别每 80ms 撼动整棵会话树
L2 渲染：只重算可见活跃块 → 流式便宜，完成态再变贵
L3 视口：滚时让路       → 保锚/重测/跟尾给用户滚动让路
```

对标 Codex 类桌面端的共性：**写少、渲少、滚时不抢方向盘**。

---

## 5. 分阶段计划

### Phase A — 质变（优先，建议 3～5 个工作日量级，拆两个 PR）

> 目标：先让“边输出边滚”明显好转。

**拆 PR（降低风险、便于归因回滚）**

- **PR-A1（低风险，1～2 人日）**：A1 流式轻 Markdown + A3 滚动让路（含诊断埋点前置）。两者都有 flag，可独立关闭，不触及协作时间线核心。
- **PR-A2（高风险，2～3 人日）**：A2 拆泡 + memo 收紧 + A4 修复缓存命中。两者都改渲染正确性核心，无 flag，靠 8.3 单测 + 多 Agent/撤回/reload 回归用例作为合并门禁。

不要把 PR-A1 和 PR-A2 合并成一个 PR；A4 触及协作时间线，单 PR 难以归因和回滚。

#### A1. 流式便宜 Markdown / 完成态富文本

**做什么**

- 活跃助手（`isActiveAssistant === true`）：
  - **StreamingPlain**：保留换行、基础结构；代码块用简单 `<pre>`；
  - **不跑** `remark-math` / `rehype-katex` / `rehype-highlight`（及可延后的重 GFM）。
- 回合 `isComplete` 或空闲超过约 300ms：
  - **SettledRich**：升级为现有完整 Markdown 栈（与今天一致）。

**为什么**

- 当前流式路径每批仍对最后一块做完整 AST + 高亮/公式，成本远高于观感收益。
- 业界主流是“打字机阶段轻量，停稳再精排”。

**风险与缓解**

- 流式与完成态样式可能有一次轻微跳变 → 用相近排版、仅增强代码/公式，避免布局大跳。
- 完成瞬间升级要避开用户正在滚动（见 A3）。

**与现有 `StreamingMarkdownBlock` 分块的关系**

- 当前 `MarkdownRenderer.tsx:62-126` 已有 `splitStreamingMarkdownBlocks`（按 markdown 块切分）+ `StreamingMarkdownBlock`（`React.memo`，key 为 block index）。这套分块本身是对的，StreamingPlain 阶段**保留分块边界**（避免最后一块全量重 parse），只把每块的渲染换成轻量路径。
- StreamingPlain 阶段：每块走轻量渲染（`<pre>` 代码块、基础结构、不挂 `remark-math`/`rehype-katex`/`rehype-highlight`）。
- SettledRich 升级时整泡切回完整 remark/rehype 栈，分块逻辑退出。不要在 StreamingPlain 内复用完整栈。

#### A2. 过程区与正文拆分订阅 + memo 收紧

**做什么**

- 将助手泡拆成稳定壳 + 两个子树：
  - `ProcessSummary`：只依赖 tools / thinkingParts / 运行状态；
  - `BodyMarkdown`：只依赖 content / isActive / isComplete。
- `timelineEventMemoKey`（assistant）**不再拼接全文** content/thinking；
  - 改为 `revision` 或 `length + 尾部切片` 等轻量签名。

**为什么**

- 现在 content 一变，`timelineEventMemoKey` 全文拼接导致 memo 每字必破，整泡子树（含过程摘要/工具行/footer）VNode 重建与 commit。注：`AssistantProcessSummary` 内部 `useMemo` 已不依赖 content，所以真正省下的是 commit 成本而非内部计算成本。
- React `memo` 只有在 props 真稳定时才有效；全文 key 导致每字必破。

**风险与缓解**

- 自定义 equal 写错会漏更新 → 单测覆盖：delta 追加、完成、工具状态变化、失败回合。

#### A3. 用户滚动让路（Scroll Yield）—— 补齐 + 统一现有时间戳型让路

> 现状不是“没有让路”，而是“让路全是时间戳型、零散、有缺口”。本项是**补齐缺口 + 加活跃标志 + 统一调度**，不是从零新增滚动锁。

**现有让路机制（已存在，保留）**

| 机制 | 位置 | 保护路径 | 窗口 |
|------|------|----------|------|
| `USER_SCROLL_ANCHOR_RESTORE_SUPPRESS_MS` | `useScrollAnchor.ts:262` | contentVersion 锚点恢复 | 700ms |
| `USER_SCROLL_RESIZE_RESTORE_SUPPRESS_MS` | `useResizeObserver.ts:91` | ResizeObserver 锚点恢复 | 260ms |
| `lastManualAnchorRestoreAtRef` 节流 | `useScrollAnchor.ts:269` | `restoreManualScrollAnchor` | 350ms 最低间隔 |
| `userInputLockUntilRef` | `useChatViewport.ts:132` / `useAutoFollow.ts:89,105` | `scrollToBottom`（贴底写） | 200ms |
| `pauseAutoFollowForUser` | `useAutoFollow.ts:201` | 整体切离 auto-follow | 持续到重新触底 |

**缺口（本项要补）**

1. **无“正在滚动”活跃标志**：全靠 `lastUserScrollAtRef` 时间戳。慢速滚轮（事件间隔 >700ms）会在滚动序列中途触发锚点写入。→ 新增 `isUserScrollingRef` 活跃标志，wheel/touch/scrollbar 事件刷新 + 短超时（约 350ms 无事件）清零；活跃标志为真时直接跳过保锚与保底距 effect。
2. **`useChatViewport.ts:635-664` 的 contentVersion “保底距” effect 无任何让路**：只按模式门控（`autoFollow && !userScroll`），不感知用户当前交互。→ 加活跃标志门控。
3. **`ChatNavigationRail` measure 无让路**：`ChatNavigationRail.tsx:111-113` 的 `useLayoutEffect` **无依赖数组**，每次重渲染都 `scheduleMeasure` → 滚动期间持续 `setMarkers` 触发重渲染。→ 加依赖数组 + 滚动活跃时降频到 ≥200ms。
4. **无降频 flush**：→ 新增“用户滚动活跃时，文本类 flush 降频到 200–320ms”（工具边界/完成/失败仍立即提交）。
5. **Streaming → Settled 升级**：→ 延后到滚动停稳（与 A1 协同）。

**诊断埋点（前置到本项，不放到 C2）**

- 滚动期间 `scrollTop` 写入计数，按写手来源标注：anchor restore / auto-follow / resize / settle rAF。
- flush 间隔、活跃 commit 耗时。
- 仅诊断开关开启时上报，默认关闭；用于 A 验收的“滚动 2s 内 scrollTop 写入 ≈ 0”成功标准。

**边界事件仍立即提交**

工具开始/结束、审批、完成、失败等边界事件不降频、不让路，保持即时性。

**为什么**

- 卡顿是“输出改高度 + 保锚改 scrollTop + 用户在滚”三方争用。
- 现有时间戳让路在慢速滚动下漏判，且保底距 effect / 导航轨 measure / flush 完全没让路。
- Codex 感的关键是：**人在滚时，系统别抢方向盘**。

**风险与缓解**

- 跟随时误判为用户上滚 → 依赖现有 intent 信号（wheel 方向、scrollbar、navigation key），并保留“明确回到底部则恢复跟随”。
- 活跃标志超时太长会延迟跟尾恢复 → 超时取 350ms（介于 wheel 事件间隔与用户停顿之间），并在“回到底部”时立即清零。

#### A4. 修复历史轮缓存失效 —— 让 `completedTurnRenderCache` 真正命中

> 这是 Phase A 收益最大但风险也最高的一项。现状不是“历史轮可能被扫到”，而是**缓存实际完全失效**。

**真因（必须先理解）**

- 缓存命中检查（`ChatThread.tsx:1063-1068`）用引用相等：`cached.events.every((event, index) => event === turnEvents[index])`。
- 但所有会话都走 `projectCollaborationTimeline`（`collaborationTimeline.ts:53-58, 146-160`），它每次都用 spread 重建事件对象 → 引用每次都变。
- 结果：**每次 80ms flush，所有历史已完成轮的缓存命中检查都失败 → 全部重跑 `renderTurnBody`**。缓存只起“记录上次结果但下次必 miss”的作用。
- `canCacheTurn` 第 1015-1022 行注释已暗示设计意图是“保持对象身份让 React 复用 DOM”，但这个意图在协作会话路径上从未达成。

**做什么（两种方案二选一，建议方案 A）**

- **方案 A（推荐，改动小、回滚易）**：把命中检查从引用相等 `===` 改成 `timelineEventMemoKey(event)` 相等（已有函数，`MessageBubble.tsx:68`）。历史已完成轮的 content/thinking 不再变化，`timelineEventMemoKey` 对稳定事件的相等检查是稳定的。
- **方案 B（影响面大）**：让 `projectCollaborationTimeline` 在事件未变时保留原引用。`scopeEventToRoomAgent` 在 `roomAgentId` 匹配时已返回同一引用，但外层 spread（`collaborationTimeline.ts:53-58, 146-160`）破坏了它。需改 `deliveryEvents` / unclaimed 段，触及协作时间线核心，回滚成本高。

**为什么**

- 修好后，历史已完成轮在流式期间接近零重跑（O(活跃轮) 而非 O(全会话)）。
- 这是 §3.1 目标 2“历史已完成轮流式期间接近零重渲”的直接实现路径，不修则目标 2 无法达成。

**风险与缓解（高风险）**

- **触及协作时间线核心路径**，回归面覆盖：多 Agent 房间、撤回后重发、官方历史 reload、snapshot reconciliation。→ 必须配针对性回归用例（见 8.1），并作为合并门禁。
- **方案 A 的 `timelineEventMemoKey` 相等检查有性能成本**（每项拼字符串比较），但历史轮数量有限且 key 计算已是项目既有模式，可接受；若发现热点再用方案 B。
- 缓存误命中导致旧头/旧过程 → 沿用并加强 `canCacheTurn`（运行中最新轮永不缓存）回归测试。
- **无 flag**：改动在缓存命中逻辑，加 flag 反而增加分支复杂度，靠 8.3 单测 + 多 Agent/撤回/reload 回归用例作为合并门禁。

---

### Phase B — 巩固（A 验收通过后）

#### B1. 活跃轮草稿（activeTurnDraft）

**做什么**

- 流式 text/thinking delta 先写入按 `sessionId + agentTurnId` 隔离的 draft store。
- 只有活跃 `BodyMarkdown`（及必要状态）订阅 draft。
- step/工具边界、`prompt.completed`、失败帧再 commit 进正式 `events`。

**为什么**

- 比单纯拉长 flush 更干净：历史订阅者根本收不到高频 text 更新。
- 为以后多 Agent 并行输出打底。

**风险与缓解**

- draft 与正式 timeline 双源 → 明确唯一 commit 点；用“以正式 events 为准”的一致性测试。

#### B2. 贴底跟随单写手

**做什么**

- 跟随模式下，用**单一 rAF** 写到底部。
- 避免 `contentVersion` layout + ResizeObserver 多处写 `scrollTop`。

**为什么**

- 多写手是历史视口 bug 的温床；跟随只需一个权威写手。

#### B3. 运行中过程区默认单行摘要

**做什么**

- 运行中默认只显示一行过程摘要（不默认铺开多组工具卡）。
- 用户仍可手动展开；完成后再按用户设置的过程展示模式处理。

**为什么**

- 降低运行中 DOM 高度抖动，减轻滚动与 reflow。
- 属产品默认，可配置，不删功能。

---

### Phase C — 长会话增强（可选）

#### C1. 历史区虚拟列表

- 仅对**已折叠的更早历史**做窗口化挂载。
- 必须兼容：五轮初始尾窗、点按展开更早历史、导航轨/搜索定位。

#### C2. 空闲精排与可观测性

- SettledRich 可在 `requestIdleCallback` 升级。
- 增加轻量性能埋点：flush 间隔、活跃 commit 耗时、滚动期间 scrollTop 写入次数（仅诊断开关）。

---

## 6. 建议实施顺序与依赖

```
PR-A1: A1 流式 Markdown 降载 + A3 滚动让路（含埋点前置）
         │  (低风险, 有 flag)
         ▼  A 验收第一轮: 边输出边滚改善 + 历史轮仍重跑
PR-A2: A2 拆泡 + memo 收紧 + A4 修复缓存命中
         │  (高风险, 无 flag, 靠单测+回归门禁)
         ▼  A 验收第二轮: 历史轮接近零重渲
         │
         ▼
B1 draft 局部 store → B2 跟随单写手 → B3 过程默认摘要
         │
         ▼
C1 虚拟列表（若长会话仍吃力）→ C2 精排/埋点
```

**不要**先做 C1 虚拟列表再做 A1–A4（顺序反了，风险大、收益慢）。
**不要**把 PR-A1 和 PR-A2 合并；A4 触及协作时间线核心，单 PR 难以归因和回滚。

---

## 7. 明确不做或慎做

| 做法 | 原因 |
|------|------|
| 把 flush 改成 16ms 更“跟手” | 更新更密，卡顿更重 |
| 滚动 handler 里做重计算 | 直接打死跟手 |
| 为性能关掉工具/完成边界的即时性 | 正确性倒退 |
| 未经测量的“全面 memo” | 全文 key 已证明 memo 会失效 |
| 一轮 PR 里虚拟列表 + draft + Markdown 全改 | 无法归因、难回滚 |

---

## 8. 测试与回归清单

### 8.1 功能正确性

- [ ] 纯文本流式：完成后富文本与代码高亮正常
- [ ] 多工具回合：工具状态、折叠/展开、过程与正文顺序正确
- [ ] 失败/中断回合：头、失败文案、不误显示“输出完成”
- [ ] 多 Agent 房间：归属与活跃头不串
- [ ] 用户上滚后新输出不把视口拽回底部
- [ ] 用户回到底部后恢复跟随
- [ ] 导航轨/搜索跳转仍可用

### 8.2 性能（生产 build）

- [ ] Profiler：流式时历史 `MessageBubble` commit ≈ 0
- [ ] Performance：滚动期间少见 >50ms 长任务
- [ ] 对比改前：同会话同操作，滚动明显跟手

### 8.3 自动化

- [ ] Markdown：streaming 路径不挂载 katex/highlight（或等价断言）
- [ ] memo/拆分（A2）：content 追加不导致 Process 无故重渲（可用 render counter 测试）；equal 函数覆盖 delta 追加、完成、工具状态变化、失败回合
- [ ] 滚动让路（A3）：模拟 userScroll 活跃 + contentVersion 变化，不调用 restore anchor；慢速滚轮（间隔 >700ms）在活跃标志窗口内也不写入
- [ ] 缓存命中（A4）：活跃更新不重建已缓存完成轮 items；多 Agent 房间、撤回后重发、官方历史 reload、snapshot reconciliation 后缓存 key 仍正确、不误命中旧头/旧过程
- [ ] 诊断埋点（A3 前置）：scrollTop 写入计数按写手来源标注，滚动期间目标 ≈ 0

---

## 9. 回滚策略

- 各 Phase 拆 PR（见 §5），可单 PR revert。
- A1 可用 flag：`streamingPlainMarkdown`（默认开，出问题关回全量 Markdown）。
- A3 可用 flag：`scrollYieldWhenUserScrolling`（默认开，出问题关回现有时间戳型让路）。
- A2、A4 无 flag：改动在 memo 相等函数与缓存命中逻辑，加 flag 反而增加分支复杂度。回滚靠 `git revert` 对应 PR；合并门禁靠 8.3 单测 + 多 Agent/撤回/reload 回归用例，不通过不合并。
- 不改持久化 schema；draft 未 commit 前杀进程仅丢未落盘流式尾（与今类似或更好）。

---

## 10. 工作量粗估（供排期）

| 阶段 | 粗估 | 预期体感 |
|------|------|----------|
| PR-A1（A1 + A3 含埋点） | 1–2 人日 | 边输出边滚应有明显改善 |
| PR-A2（A2 + A4） | 2–3 人日 | 历史轮接近零重渲，流式期间整体稳感提升 |
| Phase B | 1–2 人日 | 接近 Codex 稳感，结构更干净 |
| Phase C | 2–4 人日 | 超长会话与可观测性 |

注：Phase A 原估 1–2 人日偏乐观，实际含 A4 协作时间线回归，拆两个 PR 后合计 3–5 人日更稳。

---

## 11. 关键代码（现状）

| 区域 | 路径 |
|------|------|
| 事件批处理 | `src/hooks/useEventStream.ts` |
| 会话更新 | `src/stores/sessionStore.ts`（经 `updateSession`） |
| 渲染投影 | `src/components/chat/ChatThread.tsx`（`buildRenderItems`） |
| 气泡/memo | `src/components/chat/MessageBubble.tsx` |
| Markdown | `src/components/chat/MarkdownRenderer.tsx` |
| 视口 | `src/hooks/useChatViewport.ts`、`useChatViewport/useScrollAnchor.ts` |
| 导航轨 | `src/components/chat/ChatNavigationRail.tsx` |
| 视口知识 | `knowledge/architecture/chat-viewport-state.md` |

---

## 12. 评审时请重点拍板的点

1. **是否同意拆 PR-A1 / PR-A2 两个 PR**（见 §5），而不是合并成一个 Phase A PR。
2. **A4 方案选择**：方案 A（改命中检查为 `timelineEventMemoKey` 相等，推荐）还是方案 B（改 `projectCollaborationTimeline` 保留引用，影响面大）。
3. **A2/A4 无 flag** 是否接受（回滚靠 `git revert`，门禁靠单测 + 多 Agent/撤回/reload 回归用例）。
4. **A3 活跃标志超时取 350ms**（介于 wheel 事件间隔与用户停顿之间），是否需要更长/更短。
5. **B1 activeTurnDraft** 是否纳入第二阶段，还是 A 够用就先停。
6. **运行中过程默认单行**（B3）是否接受为默认产品行为（可设置项）。

---

## 13. 一句话摘要（给忙的人）

> 卡顿是因为流式输出以约 80ms 频率驱动「整会话更新 + 全量 Markdown 精排 + 视口保锚」，与用户滚动抢主线程；且历史轮缓存因 `projectCollaborationTimeline` spread 重建事件对象而**实际完全失效**，每次 flush 重跑所有历史轮 `renderTurnBody`。
> 最优解是：**活跃轮局部写、流式轻渲染/完成再精排、滚动时补齐让路 + 加活跃标志、修复历史轮缓存命中、历史轮冻结**。
> 先做 PR-A1（A1+A3，低风险有 flag），再做 PR-A2（A2+A4，高风险靠单测+回归门禁），用生产 build 验滚动；再视情况做 draft 与虚拟列表。
