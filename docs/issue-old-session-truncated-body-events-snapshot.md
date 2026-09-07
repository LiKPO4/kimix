# 根因快照：老会话正文残缺（session_d4035d92，2026-09-07）

> 状态：**当前版本（v2.21.179）全新打开无法复现**；用户当时的 dev 实例渲染的是一份"膨胀合并"的受损时间线。本快照留存证据与排查路径，便于复发时直接取证。

## 现象

用户截图（v2.21.179 dev）：老会话「快速了解下项目，看下今天的几次提交…」打开后，若干轮次的 assistant 正文只剩中间过程短句（如「冒烟复跑中。同时跑 pnpm build 验证打包编译：」），该轮最终长正文缺失。官方 Kimi Code web 同会话显示完整。

## 受影响会话

- `session_d4035d92-3b8e-4976-b608-cc20571fb79e`（kimix 工作目录）
- wire：`~/.kimi-code/sessions/wd_kimix_90b5212d0d7e/session_d4035d92-.../agents/main/wire.jsonl`（3794 行，v2 引擎词汇表：`context.append_loop_event` 内嵌 `content.part`，无 `turn.started`）

## 证据

1. **离线全链路干净**（vitest 探针，用完即删）：`getSessionHistoryById` → 1760 事件（ContentPart 354、文本 part 93、最长 2097 字符）；`mapHistoryEvents` → 93 条文本全保留；`deduplicateTimelineEvents` / `settleInactiveEvents` 不丢；`buildRenderItems` 后 15 个 assistant 渲染项包含全部抽查文本（含 2097 字符最终正文）。
2. **server 快照是截断窗口**：`GET /api/v1/sessions/<sid>/snapshot` 实测 `has_more=true`、仅最近 100 条消息（assistant 47 / tool 47 / user 6）→ 按 `sessionHistoryFallback.ts:24` 回退本地 wire 全量镜像，路径正确。
3. **当前 dev 实例实机复开该会话：渲染正确**。CDP 实测：完全展开「已折叠较早对话」后 DOM 含最终长正文（「三个选项全部完成」在场），中间过程短句折在折叠过程卡内（innerText/textContent 均不在场），与官方 web 表现一致。diag.log 佐证：`2026-09-07T11:21:17Z kimiHistoryReconciliation.accepted reason=repair localSize=0 canonicalSize=22362`（本地持久化为空 → 启动修复直接用 canonical 全量替换）。
4. **用户当时实例的时间线是受损的**：`2026-09-07T10:16:04Z ChatThread.subagentContentRegressionSnapshot` 显示其 `sourceEventCount=1931、assistant_message=305`，而纯 wire 映射只有 1309 / 267——多出约 620 事件，疑似 live 快照回放帧与 wire 时间线合并产生的重复/碎片（快照帧带 `snapshotMessageIdStable` 身份，wire 事件无身份，去重无法配对）。
5. **历史 stranded 证据（09-03，老版本）**：`kimiHistoryReconciliation.rejected reason=process-history-regression localProcessEvents=605 canonicalProcessEvents=285` + `fragmentTurnBodiesSkipped mismatchedTurns=1`——本地时间线一旦受损，修复门禁因"本地过程事件更多"拒绝整体替换、碎片补丁跳过不一致轮，会话永远无法自愈。

## 结论

- 当前代码的正常打开路径（快照截断 → 本地 wire → 映射渲染）不丢正文；用户看到的是该 dev 实例内一份历史累积的受损/膨胀内存时间线。
- 真正可修的产品级弱点：**受损时间线的自愈盲区**——`shouldReplaceWithCanonicalKimiHistory`（src/utils/kimiHistoryReconciliation.ts:1041）的 process-history-regression 门禁在本地被旧 bug 灌水后永久拒绝 canonical 替换，`mergeCanonicalFragmentTurnBodies` 又对不上就跳过。需要一个"正文不一致时 canonical 权威覆盖"的兜底分支（需谨慎：canonical 285 vs 本地 605 的过程事件差必须确认是重复灌水而非真实本地内容）。

## 复发时的取证动作

1. 不要重启实例；先 `node` 连 CDP（9222 端口）读 IndexedDB `kimix-state` / `state` store 中 `kimix_local_session_<id>` 的 events 统计，并抓 diag.log 中该会话的 `kimiHistoryReconciliation.*` / `ChatThread.subagentContentRegressionSnapshot` 条目。
2. 对比 `sourceEventCount` 与离线探针（`getSessionHistoryById` + `mapHistoryEvents` 长度）：超出即为合并污染。

## 更新（2026-09-08，v2.21.180 已修）

上文"无法复现 / 时间线受损"的结论被用户新截图推翻。真正根因：**v2 wire 里被用户打断的轮不会写出 `step.end(end_turn)`/`turn.ended` 任何收口记录**，下一条 `turn.prompt` 是上轮终结的唯一证据。解析层不关闭上轮 → 上轮最后一条 ContentPart 正文保持 `isComplete:false` → mergeEvents 把下一轮首句正文跨 user 边界追加进上轮 → UI 上「继续」按钮前显示续跑段首句（实机：显示「你好霖江路，继续。先看 onnxruntime-node…」，官方 web 该位置显示上轮真正的末句「缺 onnxruntime-common 依赖，补上再测：」，wire L2702 turnId=14）。

- 修复：`electron/sessionHistory.ts` `parseKimiCodeWireEvents` 在 `turn.prompt` 到达且上轮未收口时先合成 `{ type: "TurnEnd", payload: { finishReason: "interrupted_by_next_prompt" } }`；`prompt.completed`/`context.clear` 同样收口。
- 回归测试：`electron/__tests__/wireInterruptedTurn.test.ts`（2 用例）；`src/utils/__tests__/sessionHistory.test.ts` 长历史用例期望更新为 4209（2105 TurnBegin + 2104 合成 TurnEnd）。
- 离线验证：真实 wire 全链路（getSessionHistoryById → mapHistoryEvents → deduplicate → settleInactiveEvents → buildRenderItems）修复后 item 31 只含上轮末句、item 32=user「继续」、item 33=续跑首句，与官方 web 一致。
- 上文"自愈盲区"（process-history-regression 门禁永久拒绝 canonical 替换）仍然有效，留作后续项。
