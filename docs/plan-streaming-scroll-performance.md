# 计划：Agent 流式输出时滚动卡顿治理

> 状态：已评审 v2（2026-07-20 评审修订，可直接执行）
> 日期：2026-07-20
> 范围：对话流渲染 + 视口滚动，不涉及模型/Server 协议变更
> 目标体验：接近 Codex 桌面端——**输出可以密，用户滚动必须稳**

---

## 0. v2 评审修订说明（先读这段）

v1 经逐条代码核验，**所有根因论断属实**（行号、机制均与仓库一致）。评审发现 8 个需要修正/补充的点，已全部合并进本版：

| # | v1 问题 | v2 处理 |
|---|---------|---------|
| 1 | A2 要把 `timelineEventMemoKey` 改成轻签名，A4 又要用同一个函数做缓存命中检查，两者冲突：轻签名用于缓存命中会在撤回/重发/reload 同长同尾内容时误命中旧缓存 | **键函数语义不再改动**。memo 短路改为「`===` 快路径 + WeakMap 缓存 key 计算」（见 A2），缓存命中继续依赖引用相等（由 A4 方案 C 恢复引用稳定性） |
| 2 | A4 方案 A（key 比较）每 flush 对全部历史事件拼全量 key，tool_call 含 `JSON.stringify(event.result)`（`MessageBubble.tsx:113`），12.5Hz 下大结果反复 stringify 会成为新热点 | A4 主方案改为**方案 C（身份保持投影，WeakMap）**，key 比较降级为备选；即使做 key 比较也必须「缓存侧存 key、先 length+id 短路」 |
| 3 | 「历史完成泡 React commit ≈ 0」这条验收可能锚错：`messageBubblePropsEqual` 已用 memoKey 挡住大部分历史泡 commit，现状基线可能已接近 0 | 成功标准改锚到「历史轮 `renderTurnBody` 重跑次数 ≈ 0 / 投影重跑次数受控 / `buildRenderItems` 耗时」，commit 指标先测基线再定（见 §3.3、Phase 0） |
| 4 | 漏了一个同量级成本：`projectCollaborationTimeline` 每 flush 全量重投影（`ChatThread.tsx:1219` memo 依赖整个 `session` 引用，flush 必换引用） | 新增 **A5**：投影入口做输入引用比对 + A4 方案 C 在投影内部恢复事件引用稳定性 |
| 5 | 导航轨「持续 setMarkers 触发重渲染」不准确（`ChatNavigationRail.tsx:97` 已有 `markersEqual` 防御）；`useChatViewport.ts:635-664` 只在 `autoFollow && !userScroll` 快照下写入，「无任何让路」略重 | 措辞已修正（§2.3）；修法不变 |
| 6 | A3 缺口 4「滚动时 flush 降频」缺集成点：flush 在 `useEventStream` 全局层，滚动状态在 viewport 层 | 明确集成方案：新增 `src/utils/userScrollActivity.ts` 模块级单例（见 A3） |
| 7 | 缺性能基线前置任务，没有基线验收只能靠体感 | 新增 **Phase 0**：基线录制 + 诊断埋点前置 |
| 8 | flag 存放位置未定；`isUserScrolling` 事件源未含 scrollbar 拖动和键盘翻页；流式分块器 `splitStreamingMarkdownBlocks` 每次 content 变化对全文跑 `Lexer.lex`（`MarkdownRenderer.tsx:112`） | flag 模式明确（见 A1/A3）；事件源补齐（见 A3）；分块器降本写入 A1 |

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

## 2. 根因（基于当前代码的结论，v2 已逐条核验）

流式输出时，主线程上叠加了三条重路径，并与用户滚动争用：

```
SSE/事件
  → 约 80ms 一批 updateSession（整会话对象引用更新）
  → projectCollaborationTimeline 每 flush 全量重投影（spread 重建所有事件对象）
  → ChatThread 重渲染 + 全量 buildRenderItems（历史轮缓存因引用失效而完全 miss）
  → 活跃 MessageBubble 因 content 全文变化而整泡重渲
  → Markdown 流式路径仍跑 GFM + Math + KaTeX + Highlight（贵）
  → contentVersion 变化 → 视口保锚 / ResizeObserver / 导航轨测量
  → 与用户 wheel/touch 滚动争主线程 → 卡顿
```

### 2.1 写入过密、过整

| 点 | 现状 | 影响 |
|----|------|------|
| 批处理间隔 | `STREAM_EVENT_FLUSH_MS = 80`（`useEventStream.ts:15`） | 约 12.5 次/秒写 store |
| 更新粒度 | `updateSession` 替换整段 agent events 且每 flush 更新 `updatedAt`（`useEventStream.ts:67-77`） | session 对象引用每 flush 必变，订阅会话的树大面积重渲染 |
| 投影重算 | `roomTimeline` memo 依赖整个 `session` 引用（`ChatThread.tsx:1219`）；`projectCollaborationTimeline` 每次用 spread 重建事件对象（`collaborationTimeline.ts:53-58, 146-160`） | 每 flush 对所有 room 消息重跑 `deliveryEvents`/`resolveRoomDeliveryUserEvents`，且所有事件对象引用必变 |
| 历史轮缓存失效 | 缓存命中检查用引用相等（`ChatThread.tsx:1063-1068`），但投影层 spread 使引用必变 | **历史已完成轮每次 flush 都重跑 `renderTurnBody`，`completedTurnRenderCache` 实际完全失效** |

关键事实（A4 方案 C 的依据，已核验）：存储层事件对象本身是稳定的——`getRoomAgentEvents` 返回 `session.collaboration.agentEvents[roomAgentId]` 数组引用（`collaborationRooms.ts:335-338`），`mergeEvents` 只为被合并的活跃事件创建新对象，历史事件引用不变；`scopeEventToRoomAgent` 在已盖章时返回同一引用（`collaborationRooms.ts:411-417`）。**引用断裂只发生在投影层的 spread**，这就是修复抓手。

### 2.2 渲染过重

| 点 | 现状 | 影响 |
|----|------|------|
| 流式 Markdown | `streaming={isActiveAssistant}`（`MessageBubble.tsx:2148`）仍挂全量插件栈 `[remarkGfm, remarkMath] + [rehypeKatex, rehypeHighlight]`（`MarkdownRenderer.tsx:439-440, 467-473`） | 每批对“最后一块”全量 parse + highlight/math |
| 流式分块器 | `splitStreamingMarkdownBlocks` 每次 content 变化对**全文**跑 `Lexer.lex`（`MarkdownRenderer.tsx:62-68, 112`） | 12.5Hz 下 marked 全量 lex，O(全文) |
| memo 比较成本 | `messageBubblePropsEqual` / `eventArrayMemoEqual` 用 `timelineEventMemoKey` 全量拼接比较（`MessageBubble.tsx:193, 204`），含 content/thinking 全文与 `JSON.stringify(tool result)` | 每个已挂载泡每次渲染都拼两组大字符串 |

注：`messageBubblePropsEqual` 的 memoKey 比较**已经挡住了大部分历史泡的 React commit**（key 相等 → memo 命中）。所以卡顿主因不是历史泡 commit，而是：投影全量重建 + `renderTurnBody` 全量重跑 + memoKey 全量字符串拼接，三者都是每 flush O(全会话)。修复收益与验收指标必须锚在这里（见 §3.3）。

### 2.3 滚动与布局争用

| 点 | 现状 | 影响 |
|----|------|------|
| `contentVersion` | 每批随正文长度/对象身份变化 | 触发 layout effect |
| 脱离子跟随保锚 | 内容变时尝试 `restoreManualScrollAnchor`（已有 700ms 时间戳让路，`useScrollAnchor.ts:262`） | 慢速滚动（事件间隔 >700ms）漏判，用户滚时仍可能改 `scrollTop` |
| 保底距 effect | `useChatViewport.ts:635-664` 只在 `autoFollow && !userScroll` 快照下写 `scrollTop` | 用户已上滚时不写；争用发生在「wheel 活跃但 userScroll 尚未置位」的窗口期，缺交互活跃感知 |
| 导航轨 | `ChatNavigationRail.tsx:111-113` 的 `useLayoutEffect` **无依赖数组**，每次重渲染都 `scheduleMeasure` | 每帧 rAF 测量（`getBoundingClientRect`）；`setMarkers` 已有 `markersEqual` 防御（`ChatNavigationRail.tsx:97`），真问题是测量频率而非重渲染循环 |
| ResizeObserver | 内容撑高即回调（已有 260ms 让路，`useResizeObserver.ts:91`） | 流式时频繁 |

### 2.4 为何“没展开工具”也会卡

- 折叠只减少工具**详情** DOM，不停止：正文流式 Markdown、活跃轮 renderItems 重建、视口 contentVersion / 保锚、过程列表摘要行随工具数更新。
- 卡顿主因是 **输出驱动的高频重算**，不是展开深度。

### 2.5 渲染链上已存在的防御（执行时勿误判现状）

- `scopeEventToRoomAgent` 已盖章事件返回同一引用（`collaborationRooms.ts:415`）。
- `messageBubblePropsEqual` / `eventArrayMemoEqual` 已用 memoKey 深比较挡 commit（`MessageBubble.tsx:189-230`）。
- 导航轨 `setMarkers` 已有 `markersEqual` 防御（`ChatNavigationRail.tsx:97`）。
- 已完成离屏泡已有 `deferOffscreen` + `contentVisibility: auto`（`MessageBubble.tsx:2150`、`MarkdownRenderer.tsx:451-459`）。
- 已有 5 处时间戳型滚动让路（见 A3 现状表）。
- 已有诊断通道：`useAutoFollow.ts` 内的 `writeDiag`（埋点应复用，不新建通道）。

---

## 3. 目标与非目标

### 3.1 目标

1. 用户**正在滚动阅读**时，流式输出几乎不抢滚动（跟手优先）。
2. **历史已完成轮**在流式期间不重复跑 `renderTurnBody`，事件对象引用保持稳定。
3. 流式阶段正文渲染成本显著下降；完成后再做富文本精排。
4. 不破坏现有正确性：工具起止、完成帧、失败帧、多 Agent 归属、视口双模式语义。

### 3.2 非目标（本计划不做）

- 不改 Kimi Server/SDK 协议与模型路由。
- 不重做整套 Chat UI。
- 第一阶段不上完整消息虚拟列表（避免与五轮尾窗/导航轨强耦合，放到后续）。
- 不以“关闭 Markdown”或“关闭过程信息”为产品妥协。
- 不改 `timelineEventMemoKey` 的语义（v2 新增约束，见 §0-1）。

### 3.3 成功标准（生产 build 验收，先测基线再对比）

同一长会话、Agent 持续输出时：

| 指标 | 目标 | 备注 |
|------|------|------|
| 用户滚动活跃的 2s 窗口内 | 流式逻辑对 `scrollTop` 的写入 ≈ 0（按写手来源计数） | 诊断埋点验证，见 A3 |
| 历史完成轮 `renderTurnBody` 重跑次数 | 流式期间 ≈ 0（缓存命中） | **主指标**，A4 直接验证 |
| 投影重跑 | 仅在实际输入（agentEvents/messages/events 引用）变化时重跑；投影输出事件引用对未变更输入保持稳定 | A5 + A4 方案 C 验证 |
| 流式正文路径 | 不跑 rehype-highlight / katex；不做全文 `Lexer.lex` | A1 |
| 历史完成泡 React commit | 流式期间不高于基线（基线可能已 ≈ 0，以 Phase 0 实测为准） | 次要指标，勿作为 A4 收益证明 |
| 主线程长任务 | 滚动期间少见 >50ms 长任务，单次 commit 相关工作尽量 < 50ms | Performance 面板 |
| 贴底跟随 30s 流式 | 可接受偶发掉帧，无明显“整页冻住” | 体感 + 面板 |

验收手段：React Profiler + Performance 面板 + A3 埋点计数；对比改前/改后同一操作路径。**没有 Phase 0 基线数据不允许宣布达标。**

---

## 4. 总体策略（三层隔离）

```
L1 写入：稀、局部     → 别每 80ms 撼动整棵会话树
L2 渲染：只重算可见活跃块 → 流式便宜，完成态再变贵；历史轮引用稳定、缓存真命中
L3 视口：滚时让路       → 保锚/重测/跟尾/flush 给用户滚动让路
```

对标 Codex 类桌面端的共性：**写少、渲少、滚时不抢方向盘**。

---

## 5. 分阶段计划

### Phase 0 — 基线与埋点（前置，0.5～1 人日，并入 PR-A1 的第一个 commit）

**做什么**

1. **性能基线录制**（改任何代码之前）：
   - 生产 build，同一长会话（建议 ≥30 轮、含多工具调用），Agent 持续输出时执行固定操作路径：贴底跟随 30s → 上滚阅读历史 30s → 回底部。
   - Performance 面板录制，记录：长任务分布、`buildRenderItems` 单次耗时、投影耗时（可临时加 `performance.mark`）、滚动期间 `scrollTop` 写入次数。
   - 结果摘要写入 `docs/perf-baseline-streaming-scroll.md`（日期、会话规模、操作路径、关键数字），作为验收对照。
2. **诊断埋点**（默认关闭，复用现有 `writeDiag` 通道，不新建 IPC）：
   - `scrollTop` 写入计数，按写手来源标注：anchor restore / auto-follow / resize / 保底距 effect / settle rAF。
   - flush 间隔分布、活跃泡 commit 耗时、历史轮缓存命中/miss 计数、投影重跑计数。
   - 开关：localStorage `kimix_perf_diag`（`"1"` 开，默认关），与既有 localStorage flag 模式一致（参照 `roomAgentProvisioning.ts:15` 的 `MULTI_AGENT_ROOM_UI_GATE_KEY`）。

**为什么**：v1 最大的验收漏洞是没有基线；且「历史泡 commit ≈ 0」可能已是现状，必须用数据重新锚定各修复项的收益。

---

### Phase A — 质变（拆两个 PR，合计 3～5 个工作日）

**拆 PR（降低风险、便于归因回滚）**

- **PR-A1（低风险，1.5～2.5 人日）**：Phase 0 + A1 流式轻 Markdown + A3 滚动让路。均有 flag，可独立关闭，不触及协作时间线核心。
- **PR-A2（高风险，2～3 人日）**：A4 身份保持投影 + A5 投影入口收窄 + A2 memo 快路径与拆泡。改渲染正确性核心，无 flag，靠 §8.3 单测 + 多 Agent/撤回/reload 回归用例作为合并门禁。

不要把 PR-A1 和 PR-A2 合并成一个 PR；A4/A5 触及协作时间线，单 PR 难以归因和回滚。

#### A1. 流式便宜 Markdown / 完成态富文本

**做什么**

- 活跃助手（`isActiveAssistant === true`）走 **StreamingPlain**：
  - 保留换行、基础结构；代码块用简单 `<pre>`；
  - **不跑** `remark-math` / `rehype-katex` / `rehype-highlight`（及可延后的重 GFM）。
- 回合 `isComplete` 或空闲超过约 300ms 走 **SettledRich**：升级为现有完整 Markdown 栈（与今天一致）。
- **分块器降本**：流式阶段不再对全文跑 `Lexer.lex`。用轻量 fence 状态机按「段落边界 + 代码围栏状态」切分（只在 fence 外按 `\n\n` 切），输出与现有 `StreamingMarkdownBlock` 分块语义等价；SettledRich 退出分块逻辑。

**与现有 `StreamingMarkdownBlock` 分块的关系**

- 保留分块边界（避免最后一块全量重 parse），只把每块的渲染换成轻量路径；块 key 继续用 index。
- 不要在 StreamingPlain 内复用完整栈。

**flag**

- 新建 `src/utils/perfFlags.ts`，仿 `roomAgentProvisioning.ts:15` 模式：localStorage `kimix_streaming_plain_markdown`，`"0"` 关闭，默认开。

**风险与缓解**

- 流式与完成态样式可能有一次轻微跳变 → 用相近排版、仅增强代码/公式，避免布局大跳。
- 完成瞬间升级要避开用户正在滚动（见 A3 的升级延后）。
- fence 状态机切错会导致代码块被拆碎 → 单测覆盖：未闭合 fence、嵌套 fence、CJK 段落、表格块（对照现有 `splitStreamingMarkdownBlocks` 在流式典型输入上的分块结果）。

#### A2. memo 快路径 + 过程区与正文拆泡

> v2 修订：**不改 `timelineEventMemoKey` 语义**（避免与缓存命中检查产生 §0-1 的冲突）。memo 降本靠引用快路径与 key 计算缓存，这两者都依赖 A4 方案 C 提供的引用稳定性，所以 A2 放在 PR-A2。

**做什么**

1. **memo 比较加引用快路径**：
   - `messageBubblePropsEqual`（`MessageBubble.tsx:203`）与 `eventArrayMemoEqual`（`MessageBubble.tsx:189`）：先 `prev.event === next.event` / `a[i] === b[i]` 短路，引用相等直接通过，不拼 key。
   - key 计算加 WeakMap 缓存：`timelineEventMemoKey(event)` 结果按事件对象引用缓存（模块级 `WeakMap<TimelineEvent, string>`）。A4 方案 C 保证历史事件引用稳定后，历史泡的 memo 比较变成纯指针比较；引用失效场景（reload）退化为一次性 key 重建，正确性不变。
2. **拆泡**：将助手泡拆成稳定壳 + 两个子树：
   - `ProcessSummary`：只依赖 tools / thinkingParts / 运行状态；
   - `BodyMarkdown`：只依赖 content / isActive / isComplete。
   - 目标：正文流式变化时，过程摘要/工具行/footer 子树不参与 commit。

**为什么**

- 现在每批正文变化，memoKey 全文拼接 + 整泡子树 commit。引用快路径把历史泡比较降到 O(1)，拆泡把活跃泡的 commit 范围缩到正文子树。
- `AssistantProcessSummary` 内部 `useMemo` 已不依赖 content，拆泡省下的是 commit 而非内部计算。

**风险与缓解**

- 拆泡后 props 传递写错会漏更新 → 单测覆盖：delta 追加、完成、工具状态变化、失败回合（render counter 断言 Process 子树不随 content 追加重渲）。
- WeakMap key 缓存以事件对象为键：事件内容变化必然产生新对象（mergeEvents 不可变更新），不会读到旧 key → 单测断言同一对象两次取 key 引用相等、内容变更后新对象 key 不同。

#### A3. 用户滚动让路（Scroll Yield）—— 补齐 + 统一现有时间戳型让路

> 现状不是“没有让路”，而是“让路全是时间戳型、零散、有缺口”。本项是**补齐缺口 + 加活跃标志 + 统一调度**，不是从零新增滚动锁。

**现有让路机制（已存在，保留）**

| 机制 | 位置 | 保护路径 | 窗口 |
|------|------|----------|------|
| `USER_SCROLL_ANCHOR_RESTORE_SUPPRESS_MS` | `useScrollAnchor.ts:262` | contentVersion 锚点恢复 | 700ms |
| `USER_SCROLL_RESIZE_RESTORE_SUPPRESS_MS` | `useResizeObserver.ts:91` | ResizeObserver 锚点恢复 | 260ms |
| `lastManualAnchorRestoreAtRef` 节流 | `useScrollAnchor.ts:269` | `restoreManualScrollAnchor` | 350ms 最低间隔 |
| `userInputLockUntilRef` | `useChatViewport.ts:132` / `useAutoFollow.ts:89` | `scrollToBottom`（贴底写） | 200ms |
| `pauseAutoFollowForUser` | `useAutoFollow.ts:201` | 整体切离 auto-follow | 持续到重新触底 |

**集成点（v2 新增，先做这个）**

- 新增 `src/utils/userScrollActivity.ts`，模块级单例（同一时间只有一个可见 ChatThread，无需按会话隔离）：

```ts
// 接口约定（实现细节执行者自定）
export function noteUserScrollActivity(): void;   // 滚动事件源调用
export function isUserScrollActive(): boolean;    // now - lastActivityAt < 350ms
export function clearUserScrollActivity(): void;  // 回到底部时立即清零
```

- 写入侧（`useChatViewport` 内部现有用户滚动判定处）：wheel、touchmove/touchstart、**scrollbar 拖动（scroll 事件 + 非程序化判定）**、**键盘翻页（PageUp/PageDown/ArrowUp/ArrowDown/Home/End/Space）** 都调用 `noteUserScrollActivity()`。
- 读取侧：`useScrollAnchor`、`useResizeObserver`、保底距 effect、`ChatNavigationRail`、`useEventStream`、A1 的 SettledRich 升级点。
- 纯时间戳实现（`Date.now() - lastAt < 350`）即可满足语义，不需要额外的超时清零定时器；`clearUserScrollActivity` 供「明确回到底部」调用。

**缺口（本项要补）**

1. **无“正在滚动”活跃标志**：全靠 `lastUserScrollAtRef` 时间戳，慢速滚轮（事件间隔 >700ms）在滚动序列中途触发锚点写入。→ 上述活跃标志为真时直接跳过保锚与保底距 effect。
2. **`useChatViewport.ts:635-664` 保底距 effect 无交互感知**：只在 `autoFollow && !userScroll` 快照门控，wheel 活跃但 `userScroll` 尚未置位的窗口期仍会写 `scrollTop`。→ 加 `isUserScrollActive()` 门控。
3. **`ChatNavigationRail` 测量频率**：`ChatNavigationRail.tsx:111-113` 的 `useLayoutEffect` 无依赖数组，每次重渲染都 `scheduleMeasure`。→ 加依赖数组（contentVersion / 会话切换）+ 滚动活跃时降频到 ≥200ms。
4. **flush 降频（读取侧在 `useEventStream`）**：`isUserScrollActive()` 为真且批内**只有可降频事件**时，flush 间隔放宽到 200–320ms。可降频事件仅指 `assistant_message` 的未完成 text/thinking delta；工具开始/结束、审批、提问、完成、失败等边界事件到达时**立即 flush 并清空已缓冲 delta**（保证即时性，不让路）。
5. **Streaming → Settled 升级延后**：`isUserScrollActive()` 为真时暂缓升级，滚动停稳后（标志失效）再升级（与 A1 协同）。

**诊断埋点**：见 Phase 0-2，本项落地「按写手来源的 `scrollTop` 写入计数」，用于验收「滚动 2s 内写入 ≈ 0」。

**flag**

- `src/utils/perfFlags.ts`：localStorage `kimix_scroll_yield`，`"0"` 关闭，默认开。关闭后退回现有纯时间戳让路（新增门控全部旁路）。

**为什么**

- 卡顿是“输出改高度 + 保锚改 scrollTop + 用户在滚”三方争用。
- 现有时间戳让路在慢速滚动下漏判，且保底距 effect / 导航轨测量 / flush 完全没让路。
- Codex 感的关键是：**人在滚时，系统别抢方向盘**。

**风险与缓解**

- 跟随时误判为用户上滚 → 依赖现有 intent 信号（wheel 方向、scrollbar、navigation key），并保留“明确回到底部则恢复跟随 + 立即清零活跃标志”。
- 活跃标志窗口太长会延迟跟尾恢复 → 取 350ms（介于 wheel 事件间隔与用户停顿之间）。
- flush 降频期间边界事件必须立即提交 → 单测覆盖：滚动活跃 + 纯 delta 不 flush；滚动活跃 + 工具完成事件立即 flush 且携带已缓冲 delta。

#### A4. 修复历史轮缓存失效 —— 方案 C：身份保持投影（WeakMap）

> 这是 Phase A 收益最大的一项。v2 修订：主方案从 v1 的「方案 A（key 比较）」改为**方案 C（身份保持投影）**，原因是评审确认引用断裂只发生在投影层 spread（§2.1 关键事实），在投影层恢复引用稳定性可以同时修好缓存命中、bubble memo 快路径、renderItems 稳定性三处，且避免每 flush 全量拼 key 的新热点。

**真因（必须先理解）**

- 缓存命中检查（`ChatThread.tsx:1063-1068`）用引用相等：`cached.events.every((event, index) => event === turnEvents[index])`。
- 投影层每次用 spread 重建事件对象（`collaborationTimeline.ts:53-58, 146-160`）→ 引用必变 → **每次 80ms flush，所有历史已完成轮缓存必 miss，全部重跑 `renderTurnBody`**。
- 但存储层事件对象引用是稳定的（`collaborationRooms.ts:335-338, 411-417`），`mergeEvents` 不可变更新只替换被合并的活跃事件。

**做什么（方案 C）**

在 `collaborationTimeline.ts` 内对投影输出做**按源事件引用的身份保持**：

1. 新增模块级缓存：`WeakMap<TimelineEvent, Map<string, TimelineEvent>>`，key 为源事件对象引用，内层 key 为投影参数签名（`roomAgentId | roomMessageId | agentTurnId [| recipientAgentIds]`）。
2. 三个重建点全部走该缓存：
   - `deliveryEvents` 的 `source.map(...)`（`collaborationTimeline.ts:53-58`）；
   - unclaimed 段的 `segment.map(...)`（`collaborationTimeline.ts:146-160`）；
   - 每条 room 消息合成的 `user_message` 对象（`collaborationTimeline.ts:113-121`，按 `message` 对象引用缓存）。
   命中即返回**同一对象引用**；未命中才 spread 新建并写入缓存。
3. `ChatThread.tsx:1063-1068` 的引用相等命中检查**保持不变**——方案 C 让它自然命中。
4. 正确性不变量：投影字段必须只是 `(源事件, roomAgentId, roomMessageId, agentTurnId, recipientAgentIds)` 的纯函数。若源事件内容变化（mergeEvents 产生新对象），WeakMap 键失效，自动得到新投影——无需手动失效。

**为什么不选 v1 方案 A（key 比较）做主方案**

- 每 flush 对全部历史事件拼全量 key，tool_call 含 `JSON.stringify(event.result)`，长会话 12.5Hz 下是新热点。
- 若执行中确需 key 比较兜底（例如某路径无法保持引用），必须：缓存侧直接存 `keys: string[]`（只算新侧），比较前先 `length + event.id` 短路。作为备选记录，不在本次实施。

**与 v1 方案 B 的区别**

- 方案 B 改 `projectCollaborationTimeline` 的控制流（`deliveryEvents`/unclaimed 段逻辑）以保留引用，触及协作时间线核心，回滚成本高。
- 方案 C 只在**对象构造点**加缓存层，不改投影的控制流与输出内容（输出字段逐字节相同，只是引用稳定），diff 小、可单测、可 `git revert`。

**为什么收益最大**

- 历史已完成轮缓存真正命中 → 流式期间 `renderTurnBody` 从 O(全会话) 降到 O(活跃轮)。
- 事件引用稳定 → A2 的 memo 引用快路径生效 → 历史泡 memo 比较从「拼两组全量字符串」降到指针比较。
- 这是 §3.1 目标 2 的直接实现路径。

**风险与缓解（高风险）**

- **触及协作时间线核心路径**，回归面覆盖：多 Agent 房间、撤回后重发、官方历史 reload、snapshot reconciliation。→ 必须配针对性回归用例（见 §8.1/§8.3），作为合并门禁。
- 投影参数签名漏字段会导致错误复用（例如两个 delivery 共享源事件但 roomMessageId 不同）→ 内层 key 必须包含全部投影输入；单测断言「同源事件 + 不同 roomMessageId 返回不同对象」。
- 缓存误命中导致旧头/旧过程 → 沿用并加强 `canCacheTurn`（运行中最新轮永不缓存）回归测试。
- **无 flag**：改动在缓存命中链路上，加 flag 反而增加分支复杂度，靠 §8.3 单测 + 回归用例作为合并门禁，回滚靠 `git revert`。

#### A5. 投影入口收窄 —— 非时间线更新不重投影

**做什么**

- `ChatThread.tsx:1219` 的 `roomTimeline` 改为按**实际输入引用**比对：自定义 hook（如 `useProjectedTimeline(session)`）用 ref 记录上次输入三元组（`session.collaboration?.agentEvents`、`session.collaboration?.messages`、`session.events` 的引用），三者全等则直接返回上次投影结果，不调用 `projectCollaborationTimeline`。
- 下游 `splitEvents` / `visibleEvents` / `renderItems` 的 memo 链随 `roomTimeline` 引用稳定而自然短路。

**为什么**

- 现在 `updateSession` 每 flush 都更新 `updatedAt` 并换新 session 引用（`useEventStream.ts:76`），title/status/updatedAt 等纯元数据更新也会触发全量重投影 + 全量 renderItems。
- 流式期间 agentEvents 必变（重投影不可避，由 A4 保证输出引用稳定）；但非流式的元数据更新应完全短路。

**风险与缓解**

- 漏比对了某个实际输入会导致投影不更新 → 三元组必须覆盖 `projectCollaborationTimeline` 读取的全部输入（单测：仅 `updatedAt` 变化返回同引用结果；agentEvents 变化返回新结果）。

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
- Phase 0 埋点保留为诊断工具（默认关闭）。

---

## 6. 建议实施顺序与依赖

```
PR-A1: Phase 0 基线+埋点 → A1 流式 Markdown 降载 → A3 滚动让路
         │  (低风险, 有 flag)
         ▼  A 验收第一轮: 边输出边滚改善 + 埋点确认历史轮仍在重跑(量化 A4 收益)
PR-A2: A4 身份保持投影 → A5 投影入口收窄 → A2 memo 快路径 + 拆泡
         │  (高风险, 无 flag, 靠单测+回归门禁; A2 依赖 A4 的引用稳定性)
         ▼  A 验收第二轮: 历史轮 renderTurnBody ≈ 0, 投影重跑受控
         │
         ▼
B1 draft 局部 store → B2 跟随单写手 → B3 过程默认摘要
         │
         ▼
C1 虚拟列表（若长会话仍吃力）→ C2 精排/埋点
```

**不要**先做 C1 虚拟列表再做 A1–A5（顺序反了，风险大、收益慢）。
**不要**把 PR-A1 和 PR-A2 合并；A4/A5 触及协作时间线核心，单 PR 难以归因和回滚。
**不要**在 PR-A2 里先做 A2 再做 A4：A2 的引用快路径依赖 A4 提供的引用稳定性，顺序反了 A2 无法验收。

---

## 7. 明确不做或慎做

| 做法 | 原因 |
|------|------|
| 把 flush 改成 16ms 更“跟手” | 更新更密，卡顿更重 |
| 滚动 handler 里做重计算 | 直接打死跟手 |
| 为性能关掉工具/完成边界的即时性 | 正确性倒退 |
| 未经测量的“全面 memo” | 全文 key 已证明 memo 会失效 |
| 一轮 PR 里虚拟列表 + draft + Markdown 全改 | 无法归因、难回滚 |
| 改 `timelineEventMemoKey` 语义（v1 A2 原方案） | 与缓存命中检查冲突，同长同尾内容会误命中（§0-1） |
| 每 flush 对全部历史事件拼 key 做缓存命中检查（v1 A4 方案 A） | `JSON.stringify(tool result)` 在 12.5Hz 下是新热点（§0-2）；仅在引用保持不可行时作为兜底，且必须缓存侧存 key + length/id 短路 |

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

### 8.2 性能（生产 build，对照 Phase 0 基线）

- [ ] Profiler：流式时历史 `MessageBubble` commit 不高于基线
- [ ] 埋点：流式期间历史轮 `renderTurnBody` 重跑 ≈ 0；投影仅在输入引用变化时重跑
- [ ] Performance：滚动期间少见 >50ms 长任务
- [ ] 对比基线：同会话同操作路径，滚动明显跟手

### 8.3 自动化

- [ ] Markdown（A1）：streaming 路径不挂载 katex/highlight（或等价断言）；fence 状态机分块对未闭合 fence/嵌套 fence/CJK/表格输入与预期分块一致
- [ ] memo/拆泡（A2）：content 追加不导致 Process 子树重渲（render counter）；equal 函数覆盖 delta 追加、完成、工具状态变化、失败回合；WeakMap key 缓存同对象两次取值引用相等、新对象 key 不同
- [ ] 滚动让路（A3）：模拟 userScroll 活跃 + contentVersion 变化，不调用 restore anchor；慢速滚轮（间隔 >700ms）在活跃窗口内不写入；滚动活跃 + 纯 delta 延迟 flush；滚动活跃 + 边界事件立即 flush 且携带已缓冲 delta
- [ ] 身份保持投影（A4）：输入引用未变时两次 `projectCollaborationTimeline` 返回引用相等的事件对象；同源事件 + 不同 roomMessageId 返回不同对象；活跃更新不重建已缓存完成轮 items；多 Agent 房间、撤回后重发、官方历史 reload、snapshot reconciliation 后缓存不误命中旧头/旧过程
- [ ] 投影入口（A5）：仅 `updatedAt`/title 变化时 `useProjectedTimeline` 返回同引用结果；agentEvents 变化返回新结果
- [ ] 诊断埋点（Phase 0）：`scrollTop` 写入计数按写手来源标注，滚动期间目标 ≈ 0；埋点关闭时零开销路径（无字符串拼接）

---

## 9. 回滚策略

- 各 Phase 拆 PR（见 §5），可单 PR revert。
- A1 flag：`kimix_streaming_plain_markdown`（localStorage，默认开，`"0"` 关回全量 Markdown）。
- A3 flag：`kimix_scroll_yield`（localStorage，默认开，`"0"` 关回现有纯时间戳让路）。
- Phase 0 埋点开关：`kimix_perf_diag`（默认关）。
- A2、A4、A5 无 flag：改动在投影身份保持与 memo 链路上，加 flag 反而增加分支复杂度。回滚靠 `git revert` 对应 PR；合并门禁靠 §8.3 单测 + 多 Agent/撤回/reload 回归用例，不通过不合并。
- 不改持久化 schema；draft 未 commit 前杀进程仅丢未落盘流式尾（与今类似或更好）。

---

## 10. 工作量粗估（供排期）

| 阶段 | 粗估 | 预期体感 |
|------|------|----------|
| PR-A1（Phase 0 + A1 + A3） | 1.5–2.5 人日 | 边输出边滚应有明显改善 |
| PR-A2（A4 + A5 + A2） | 2–3 人日 | 历史轮接近零重算，流式期间整体稳感提升 |
| Phase B | 1–2 人日 | 接近 Codex 稳感，结构更干净 |
| Phase C | 2–4 人日 | 超长会话与可观测性 |

---

## 11. 关键代码（现状，v2 已核验行号）

| 区域 | 路径 |
|------|------|
| 事件批处理 | `src/hooks/useEventStream.ts`（`STREAM_EVENT_FLUSH_MS = 80` 在 :15） |
| 会话更新 | `src/stores/sessionStore.ts`（经 `updateSession`） |
| 渲染投影 | `src/components/chat/ChatThread.tsx`（`buildRenderItems`；缓存命中检查 :1063-1068；`roomTimeline` memo :1219） |
| 协作投影 | `src/utils/collaborationTimeline.ts`（spread 重建点 :53-58, 113-121, 146-160） |
| 房间事件存取 | `src/utils/collaborationRooms.ts`（`getRoomAgentEvents` :335-338；`scopeEventToRoomAgent` :411-417） |
| 气泡/memo | `src/components/chat/MessageBubble.tsx`（`timelineEventMemoKey` :68；`messageBubblePropsEqual` :203；`streaming=` :2148） |
| Markdown | `src/components/chat/MarkdownRenderer.tsx`（分块器 :62-126；插件栈 :439-440；流式分支 :467-473） |
| 视口 | `src/hooks/useChatViewport.ts`（保底距 effect :635-664）、`useChatViewport/useScrollAnchor.ts`（:262, :269）、`useChatViewport/useResizeObserver.ts`（:91）、`useChatViewport/useAutoFollow.ts`（:89, :201） |
| 导航轨 | `src/components/chat/ChatNavigationRail.tsx`（无依赖 layoutEffect :111-113；`markersEqual` 防御 :97） |
| 滚动活跃共享（新建） | `src/utils/userScrollActivity.ts` |
| flag（新建） | `src/utils/perfFlags.ts` |
| 视口知识 | `knowledge/architecture/chat-viewport-state.md` |

---

## 12. 评审时请重点拍板的点（v2 已更新）

1. **是否同意拆 PR-A1 / PR-A2 两个 PR**（见 §5），而不是合并成一个 Phase A PR。
2. **A4 方案选择（v2 更新）**：方案 C（身份保持投影，WeakMap，**v2 推荐**）还是 v1 方案 A（key 比较兜底，必须缓存侧存 key + length/id 短路）。v1 方案 B（改投影控制流）已放弃。
3. **A2/A4/A5 无 flag** 是否接受（回滚靠 `git revert`，门禁靠单测 + 多 Agent/撤回/reload 回归用例）。
4. **A3 活跃标志窗口取 350ms**（介于 wheel 事件间隔与用户停顿之间），是否需要更长/更短。
5. **B1 activeTurnDraft** 是否纳入第二阶段，还是 A 够用就先停。
6. **运行中过程默认单行**（B3）是否接受为默认产品行为（可设置项）。
7. **（v2 新增）成功标准改锚**：主指标改为「历史轮 `renderTurnBody` 重跑 ≈ 0 + 投影重跑受控」，「历史泡 commit ≈ 0」降级为对照基线的次要指标（§3.3），是否接受。

---

## 13. 一句话摘要（给忙的人）

> 卡顿是因为流式输出以约 80ms 频率驱动「整会话更新 + 全量投影重建 + 全量 Markdown 精排 + 视口保锚」，与用户滚动抢主线程；且历史轮缓存因投影层 spread 重建事件对象而**实际完全失效**，每次 flush 重跑所有历史轮 `renderTurnBody`（存储层事件引用其实稳定，断裂只发生在投影层）。
> 最优解是：**流式轻渲染/完成再精排、滚动时补齐让路 + 加活跃标志 + flush 降频、投影层 WeakMap 身份保持恢复引用稳定（缓存自然命中）、投影入口按输入引用短路、memo 加引用快路径**。
> 先做 PR-A1（Phase 0 基线+埋点、A1、A3，低风险有 flag），再做 PR-A2（A4、A5、A2，高风险靠单测+回归门禁），用生产 build 对照基线验收；再视情况做 draft 与虚拟列表。
