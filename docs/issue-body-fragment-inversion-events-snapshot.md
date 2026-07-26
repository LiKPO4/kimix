# 根因快照：正文片段乱序「霖江路。你好我来查…」（v2.20.23）

> 状态：已定位根因。结论：服务端按正确顺序发送，乱序发生在 Kimix 渲染层 active-turn draft 的**跨身份代提交顺序**。

## 现象

用户 v2.20.23 GIF（2026-07-26 12:37 本地，Project06 会话「快速、全面了解一下当前项目」）：工具前正文短句在**运行中**显示为「霖江路。你好我来查敌方 buff 体系里…」，正确顺序应为「你好霖江路。我来查…」。回合结束后（完成屏障回放）文本被权威快照修复为正确顺序。

## 证据一：持久化终态正确

CDP 读取 dev IndexedDB（`kimix-state`，session_cc972967-b75e-4f8d-a834-1fb615ec8ada，idx 1309）：

- 持久化正文 = `你好霖江路。我来查敌方 buff 体系里有没有类似荆棘（受击反伤）的机制，以及尸气具体是什么：`（47 字符，正确）
- 事件属性：`snapshotMessageIdStable: true`、`completionBarrierReplay: true`、`isComplete: true`
- 邻域：前一个事件是 user_message（ts 1785040640912），后续是 tool_call / assistant（thinking）

→ 乱序只存在于**运行中的 live 显示**，完成屏障已修复落盘文本；肉眼可见的错乱发生在 draft 装配阶段。

## 证据二：服务端发送顺序正确、帧无 offset

diag.log（v2.20.23 dev，liveDiag 摘要模式也记录 assistant.delta），该轮（sid=15ec8ada）正文 delta：

```
04:37:21.844 [wsc] prompt accepted → refresh live subscription（关闭→250ms→重连→快照回放 seq=1591→resub）
04:37:25.866 thinking.delta 开始
04:37:27.822 [wsframe] assistant.delta vol=1 main dlen=2   ←「你好」
04:37:27.822 [wsframe] assistant.delta vol=1 main dlen=4   ←「霖江路。」
04:37:28.198 [wsframe] assistant.delta vol=1 main dlen=22  ←「我来查敌方 buff 体系里…」
04:37:28.494 [wsframe] assistant.delta vol=1 main dlen=19  ← 句尾
```

- 线上顺序 = 正确顺序（2 → 4 → 22 → 19，2+4+22+19=47 = 最终正文长度）。
- 四帧均**无 `off=` 字段**（0.29.1 volatile delta 不带 offset）→ offset 锚定路径（Invariant F/G）不参与。
- 04:38:42.572 起另一段正文（dlen=2、22、21…）同样先 2 后 22，线上顺序亦正确。

→ 排除「服务端乱序到达」。乱序必然发生在 Kimix 渲染层。

## 根因：draft 提交不遵守真实到达顺序

渲染层有两条通道（`src/hooks/useEventStream.ts`）：

- **draft 通道**：`resolveActiveTurnDraftKey` 要求 `event.agentTurnId` 非空；delta 进 `activeTurnDraftStore`（按身份代分 key：optimistic turn id vs 官方 turn id，迁移依赖 `roomMessageId` 匹配，`activeTurnDraftStore.ts:261-285`）。
- **formal 通道**：无 agentTurnId 或带快照/屏障标记的帧进 batch → `mergeEvents`。

两条通道在提交点汇合时**没有任何按到达时间排序**：

1. `commitActiveTurnDraftsToBatch`（`useEventStream.ts:97-139`）按 drafts Map 插入顺序收集，且 `enqueueStreamStreamEvent:246-251` 的**带 agentTurnId 过滤**提交可以只提交新一代 draft、把更老的上一代 draft 留在缓冲区——新段先落正式事件，老段后追加，顺序反转。
2. 提交段被**无条件 prepend 到 batch 头部**（`[...prepended.items, ...current.items]`），若 batch 里已有更早到达的 formal 事件（如无 agentTurnId 的首个 delta），后到的 draft 段反而排在它前面。
3. 汇合后 `mergeEvents` 对同一未完成 assistant 只做 append 合并，先入者在前 → 文本被永久拼成「f2, f1, f3」形态，直到完成屏障的权威帧整体替换。

可精确复现观测串的两条时序（共享同一根因）：

- A（双 draft）：f1→draft(optimistic)，f2→draft(官方，迁移因 roomMessageId 缺失失败)，某 formal 帧触发**仅官方 key 过滤**的提交 → E(「霖江路。」)；随后全量 flush 提交 optimistic 段 → append「你好」；f3/f4 再提交 → 「霖江路。你好我来查…」。
- B（formal+draft）：f1 无 agentTurnId→formal batch，f2→draft；80ms flush 把 draft 段 prepend 到 batch 头部 → E(「霖江路。」+append「你好」)；f3/f4 后续追加 → 同一结果。

知识库 `streaming-render-pipeline.md:81-82` 曾记录同类问题（重复 unshift 反转「你好」「霖江路。我会」两个身份代片段），当时的修复（收集后整体 prepend 一次）只覆盖了**单批次内**的顺序，未覆盖上述**跨批次/跨通道**顺序。

## 修复方向（v2.20.24）

`commitActiveTurnDraftsToBatch` 改为按 draft 首帧时间戳排序提交：

1. 过滤后扩展候选：同 (session, roomAgent) 下，凡首帧时间戳 ≤ 已匹配 draft 最大时间戳的 draft 一并提交（禁止越过更老的同房间 draft 提交新段）。
2. 选中段按首帧时间戳升序（稳定排序，同毫秒保持创建顺序）。
3. prepend 到已有 batch 时按时间戳插入：仅插到**严格更晚**的 batch 项之前，同毫秒或更早的 formal 项保持在段前面。

回归测试覆盖：双身份代乱序提交、过滤提交不越过老段、draft 段与更早 formal batch 项的相对顺序。
