# 切换 Swarm 后上一条 assistant 气泡被掏空：事件快照

记录时间：2026-08-02（Asia/Shanghai）

目标会话：`session_336f7ae6-2570-4b6e-924f-cb49500ba901`（标题「快速全面了解一下当前项目，准备接手」，模型 AI8/grok-4.5）

## 现象

用户截图（约 2026-08-02 20:54，win98 需求轮刚开始、显示「消息发送中 25 秒」）：切换 Swarm 后，上一轮 assistant（v2.20.145 发布轮）气泡只剩 `文件变更` 卡 + `模型：grok-4.5` 页脚，合并正文（约 900 字）与工具过程卡消失。

## 结论

- **当前三层数据全部健康，气泡应已自愈**：
  1. 官方 wire canonical（`agents/main/wire.jsonl`，57MB）经 `getSessionHistory → mapHistoryEvents` 投影：1969 事件，被毁轮次正文（39/47/24/790 字四段）、8 个工具调用、change_summary + diff、模型 status 全部齐全。
  2. 安装版 IndexedDB `kimix-state / kimix_local_session_session_336f7ae6-…`：1969 事件，内容与 canonical 一致；事件 id 已全部重生成（随机 id），证明 20:54 之后本地时间线被一次完整 canonical 水合整体替换过——这就是自愈路径。
  3. 用真实事件跑 `buildRenderItems(events, "kimi-code")`：该轮产出单个完整 render item（合并正文 906 字、leadingTools 8、changeSummary 1、trailingStatuses ["模型：AI8/grok-4.5"]），渲染管线无 bug。
- **破坏是切换 Swarm 触发 Server→SDK 迁移窗口内的瞬态事件**：`setSwarmMode` 对 Server 会话执行 `migrateServerSessionToSdk`（SDK resume + 退订 Server），迁移前后存在 Server 快照回放（`kimix.server.snapshot → snapshotMessagesToServerFrames`）、历史水合（`loadKimiCodeSession`）与 wire 重写（wire.jsonl 于迁移时段被整体重写）等多个写入源竞态。
- **精确写入路径已不可回溯**：破坏发生在 20:53–20:54，自愈发生在其后；两层持久化都已被健康数据覆盖，没有留下被破坏状态的直接快照。

## 已排除的机制（带证据）

| 候选 | 证据 | 结论 |
| --- | --- | --- |
| 官方历史/canonical 映射丢正文 | 真实 wire 投影 1969 事件全部齐全 | 排除 |
| 渲染管线（buildRenderItems/ChatThread）丢正文 | 真实数据渲染出完整气泡 | 排除 |
| live merge（mergeEvents assistant 守护段）空正文覆盖 | 2040-2218 行全部有 `incoming.content \|\| target.content` / `replaceCanonicalBody` 守卫，identity-terminal 直接丢弃 | 排除 |
| dedup（mergeAssistantReplayCopies）空正文覆盖 | bodyKey 匹配要求正文一致才合并，空正文副本进不了合并分支 | 排除 |
| settleInactiveEvents 清空正文 | 只删除空占位，不动有正文事件 | 排除 |
| reconciliation 采纳残缺 canonical | `shouldReplaceWithCanonicalKimiHistory` 有 assistant-body/thinking/process/image 四重回归拒绝 + 熔断器 | 正常路径排除；但非房间会话的 `preserveLocalUserMediaInCanonicalHistory` 直换路径（App.tsx ~2343）无此守卫 |

## 未排除的候选（按可能性排序）

1. **迁移窗口内的 Server 快照回放帧**与本地事件合并时，该轮 assistant 被替换成无正文副本（回放帧的具体载荷当时未抓帧，无法验证）。
2. **非房间会话水合直换路径**（`preserveLocalUserMediaInCanonicalHistory`，无 `shouldReplaceWithCanonicalKimiHistory` 守卫）在迁移瞬间拿到不完整的 canonical（如 Server 快照缺正文、wire 重写中读到撕裂文件）并整体替换本地事件。该路径只保留用户媒体，不保留本地 assistant 正文/工具事件，是唯一无回归守卫的替换入口。

## 建议后续（未实施）

- 若复现：打开「帧级诊断」（setFrameDiagLogger）+ 水合打点后再切 Swarm，抓迁移窗口的事件流。
- 防御方向：给非房间水合直换路径加与房间路径同级的「assistant 正文不得回退」守卫（canonical 正文总量 < 本地且非身份修复场景时拒绝替换）。
- 当前无需兜底：三层数据健康，无用户可见残留。
