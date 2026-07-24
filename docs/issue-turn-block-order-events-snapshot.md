# Issue 快照：turn 内工具/思考/正文时序与官方 web 不一致

日期：2026-07-24
会话：`session_dd37beb3-d8c3-4896-96f1-851519f3ba43`（项目 clipstash，官方 Server 0.29 路由）

## 现象

用户对比同一会话在 Kimix 与官方 Kimi Code web 端的展示，发现：

1. 一大段子代理内部的思考/碎片文字被当成主时间线正文渲染（语无伦次的段落）。
2. 一个 turn 内出现 4 个分离的「N 个工具调用」卡片与多张「Swarm」卡片，相对顺序与官方不一致。
3. 正文把整轮多段「你好霖江路…」拼接成一团，时序感丢失。

官方 web 端同会话表现：思考收进右侧「预览/思考过程」面板；工具调用聚合成连续段的「N 个工具调用 · 已完成」；Agent 调用是「任务」行；正文按 step 分段干净。

## 官方原始事件序列（wire.jsonl + Server 快照双源一致）

数据源：

- 本地 wire 镜像：`~/.kimi-code/sessions/wd_clipstash_856fd212d170/session_dd37beb3-…/agents/main/wire.jsonl`（75 行，子代理 agent-0..5 各有 wire）
- 官方 Server 快照：`GET /api/v1/sessions/<id>/snapshot`（19 条消息，msg_000006~000018 对应该 turn）

用户消息（wire 行 29/30，t=1784858377281）之后共 5 个 step（turnId=1）：

| wire 行 | 事件 | 内容 | 快照消息 |
|---|---|---|---|
| 31–39 | step 1 | think[2910]「用户报告了两个问题…」→ text[50]「你好霖江路。两个问题的调查我拆成两路并行委派…」→ tool.call Agent「调查安卓版本号不同步」+ Agent「调查安卓两个 bug 根因」→ tool.result ×2 → step.end(tool_use) | msg_000007~9 |
| 41–47 | step 2 | think[5065]「两个调查子代理返回了详细结论…」→ text[624]「你好霖江路。两路调查都拿到了精确根因…## 调查结论…」→ tool.call Agent「修复版本同步与两个安卓 bug」→ tool.result → step.end(tool_use) | msg_000010/11 |
| 49–59 | step 3 | think[697] → text[38] → tool.call Read ×3 → tool.result ×3 → step.end(tool_use) | msg_000012~15 |
| 61–67 | step 4 | think[1608] → text[166] → tool.call Agent「修正下载路径超时设置」（续派 agent-5）→ tool.result → step.end(tool_use) | msg_000016/17 |
| 69–73 | step 5 | think[183] → text[1306]（最终汇总）→ step.end(end_turn) | msg_000018 |

## 数据层结论（排除 SDK/模型侧根因）

- 每个 step 恒为 think → text → tool.call(s) → tool.result(s)，时间戳单调递增，wire 与快照结构一致。
- 不存在 thinking 被标成 text；5 个 think part（2910/5065/697/1608/183 字）与 5 个 text part（50/624/38/166/1306 字）类型标注完全正确。
- wire/快照的 content.part 均不带 offset（offset 仅存在于 live WS delta 帧），历史路径只能依赖消息/part 顺序。
- think 与其后第一个 tool.call 同毫秒（470300/470301；step 4 甚至完全同时间戳 237087）——任何按 timestamp 重排的逻辑在此数据上必然失序。

## 根因（全部在 Kimix 装配层）

1. `ChatThread.tsx mergeAssistantProcessEvents`：整轮 assistant 事件合并成单气泡，content 以 `\n\n` 拼接，过程全部堆在气泡顶部。
2. `src/utils/chatRenderItems.ts createSubagentOnlyAssistantEvent`：主时间线无 assistant 正文时，把子代理内部 content/thinking 拼接提升为正文气泡（现象 1 的直接来源；diag.log 有 `chatRenderItems.subagentContentSurfaced` 记录）。且 `kimiHistoryReconciliation` 以 `process-history-regression`（localProcessEvents:262 vs canonicalProcessEvents:10）拒绝官方快照，合成气泡永久残留。
3. `MessageBubble.tsx AssistantProcessSummary`：thinking/tools/subagents/approvals 混合后按 timestamp + 类型优先级重排（同毫秒 thinking<tool<subagent），并用工具时间戳反切 thinking 段（`buildThinkingBlocks` 的 `boundaryTimestamps`）→ 连续工具段被切成 4 组（现象 2）。
4. 历史路径无 offset，装配却不用事件数组顺序而用 timestamp（根因 3 的结构性原因）。

## 官方参照逻辑（kimi-code apps/kimi-web）

- `agentEventProjector.ts`：live delta 按 wire offset 锚定（skip/append/gap→重快照）；`agentId !== 'main'` 的帧从不进主 transcript，只投影为 task 进度；tool.use 原位 push 进当前 assistant message 的 content 末尾。
- `messagesToTurns.ts`：连续 assistant message 合并为一个 ChatTurn；`absorbContent` 把 parts 转成有序 blocks[]（text/thinking/toolUse 原位，"thinking renders WHERE it happened"）。
- `chatTurnRendering.ts assistantRenderBlocks`：只聚合**连续** tool block（≥2 成 ToolGroup）；`ToolGroup.vue` 行头「{count} 个工具调用 · 运行中/有失败/已完成」。
- Agent 工具渲染为「任务」卡（`AgentTool.vue`），子代理详情进右侧面板；思考为 teaser，点击开右侧 ThinkingPanel。

## 修复方向

turn 内按事件数组顺序构建有序 blocks（thinking/text/tool/subagent/approval），替代整轮合并 + timestamp 重排；删除子代理内容提升；连续工具段才聚合。详见本轮计划与提交。
