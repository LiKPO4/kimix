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

相关：`src/hooks/useEventStream.ts`、`src/components/chat/ChatThread.tsx`（`buildRenderItems` / `canCacheTurn`）。

### 2.2 渲染过重

| 点 | 现状 | 影响 |
|----|------|------|
| 流式 Markdown | `streaming={isActiveAssistant}` 仍用完整 remark/rehype 栈 | 每批对“最后一块”全量 parse + highlight/math |
| memo 失效 | `timelineEventMemoKey` 把整段 `content`/`thinking` 拼进 key | 每字变化 → 整泡（过程区+正文+footer）重渲 |
| 过程区与正文同泡 | 同一 `AssistantMessageBubble` | 正文变也会带动过程摘要/工具行重算 |

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

### Phase A — 质变（优先，建议 1～2 个工作日量级）

> 目标：先让“边输出边滚”明显好转。

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

#### A2. 过程区与正文拆分订阅 + memo 收紧

**做什么**

- 将助手泡拆成稳定壳 + 两个子树：
  - `ProcessSummary`：只依赖 tools / thinkingParts / 运行状态；
  - `BodyMarkdown`：只依赖 content / isActive / isComplete。
- `timelineEventMemoKey`（assistant）**不再拼接全文** content/thinking；
  - 改为 `revision` 或 `length + 尾部切片` 等轻量签名。

**为什么**

- 现在 content 一变，过程摘要和工具行跟着整泡重渲，折叠也省不下多少。
- React `memo` 只有在 props 真稳定时才有效；全文 key 导致每字必破。

**风险与缓解**

- 自定义 equal 写错会漏更新 → 单测覆盖：delta 追加、完成、工具状态变化、失败回合。

#### A3. 用户滚动锁（Scroll Yield）

**做什么**

在最近约 **400–700ms** 存在 wheel/touch/scrollbar 等明确用户滚动意图时：

| 子系统 | 行为 |
|--------|------|
| 脱离子跟随的 anchor restore | 跳过 |
| 导航轨 measure | 暂停或降频到 ≥200ms |
| auto-follow 抢尾 | 保持 detached，不写 `scrollTop` |
| 文本类 flush | 降频到 200–320ms |
| Streaming → Settled 升级 | 延后到滚动停稳 |

工具开始/结束、审批、完成、失败等**边界事件仍立即提交**。

**为什么**

- 卡顿是“输出改高度 + 保锚改 scrollTop + 用户在滚”三方争用。
- Codex 感的关键是：**人在滚时，系统别抢方向盘**。

**风险与缓解**

- 跟随时误判为用户上滚 → 依赖现有 intent 信号（wheel 方向、scrollbar、navigation key），并保留“明确回到底部则恢复跟随”。

#### A4. `buildRenderItems` 只重算 open turn

**做什么**

- 流式期间：已完成轮继续走 `completedTurnRenderCache`，且**不因活跃轮更新而失效**。
- 仅对“未完成 / 最新活跃轮”调用 `renderTurnBody`。
- 保证 cache key 与事件身份比较在活跃轮更新时仍正确。

**为什么**

- 现在活跃轮每批全量投影；历史轮虽有 cache，仍可能被整次 `buildRenderItems` 扫到。
- 目标复杂度：更新 ≈ O(活跃轮)，不是 O(全会话)。

**风险与缓解**

- 缓存误命中导致旧头/旧过程 → 沿用并加强 `canCacheTurn`（运行中最新轮永不缓存）回归测试。

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
A1 流式 Markdown 降载 ─┐
A2 拆泡 + memo       ├─→ A 验收（边输出边滚）
A3 滚动锁            │
A4 open-turn 投影    ─┘
         │
         ▼
B1 draft 局部 store → B2 跟随单写手 → B3 过程默认摘要
         │
         ▼
C1 虚拟列表（若长会话仍吃力）→ C2 精排/埋点
```

**不要**先做 C1 虚拟列表再做 A1–A3（顺序反了，风险大、收益慢）。

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
- [ ] memo/拆分：content 追加不导致 Process 无故重渲（可用 render counter 测试）
- [ ] 滚动锁：模拟 userScroll + contentVersion，不调用 restore anchor
- [ ] open-turn：活跃更新不重建已缓存完成轮 items

---

## 9. 回滚策略

- 各 Phase 独立 PR/提交，可单相 revert。
- A1 可用 flag：`streamingPlainMarkdown`（默认开，出问题关回全量 Markdown）。
- A3 可用 flag：`scrollYieldWhenUserScrolling`。
- 不改持久化 schema；draft 未 commit 前杀进程仅丢未落盘流式尾（与今类似或更好）。

---

## 10. 工作量粗估（供排期）

| 阶段 | 粗估 | 预期体感 |
|------|------|----------|
| Phase A | 1–2 人日 | 边输出边滚应有明显改善 |
| Phase B | 1–2 人日 | 接近 Codex 稳感，结构更干净 |
| Phase C | 2–4 人日 | 超长会话与可观测性 |

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

1. **是否同意 Phase A 四项作为第一刀**（尤其 StreamingPlain，会有流式/完成态一次视觉升级）。
2. **滚动锁窗口** 400ms vs 700ms（更跟手 vs 更少误伤跟随）。
3. **B1 activeTurnDraft** 是否纳入第二阶段，还是 A 够用就先停。
4. **运行中过程默认单行**（B3）是否接受为默认产品行为（可设置项）。

---

## 13. 一句话摘要（给忙的人）

> 卡顿是因为流式输出以约 80ms 频率驱动「整会话更新 + 全量 Markdown 精排 + 视口保锚」，与用户滚动抢主线程。  
> 最优解是：**活跃轮局部写、流式轻渲染/完成再精排、滚动时暂停保锚与降频、历史轮冻结**。  
> 先做 Phase A，用生产 build 验滚动；再视情况做 draft 与虚拟列表。
