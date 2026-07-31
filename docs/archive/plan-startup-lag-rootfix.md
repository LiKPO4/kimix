# 启动卡顿根治计划（persist 风暴 × 永败 reconcile）

> 2026-07-25 立项。目标：一次性根治启动卡顿，并通过机制设计避免随数据规模增长复发。
> 根因证据：见 `TASK_STATE.md` 2026-07-25 诊断条目（diag.log 04:46-04:48 启动段石锤）。

## 根因回顾（三层）

1. **L1 直接成本**：persist 对全量 sessions（实测 365 会话 / 39560 事件）做单键 strip + stringify + IDB 克隆，单次 1.4~13.9s，成本随数据规模线性增长。
2. **L2 触发放大**：Swarm 房间会话本地过程事件远多于 canonical 快照（119 vs 19-64），`process-history-regression` 保护逻辑（正确行为）永远拒绝；修复候选条件恒真（`App.tsx:218-229`），repair 循环 / startup recovery / running-sample 每次启动无限重试，无熔断无记忆，且 rejected 后仍 setState（recoveryIssue 写入、patch 路径）。
3. **L3 防线失效**：引用守卫只拦"引用相同"；启动档防抖只走订阅 debounce；`archiveOrDeletionChanged` 立即 flush 等路径绕过；叠加后启动窗口每秒级全量落盘。

## 根治设计（四路 + 防线）

### A. reconcile 熔断/记忆（砍风暴源）

- 在 `kimiHistoryReconciliation.ts` 的 `shouldReplaceWithCanonicalKimiHistory` rejected 分支登记**拒绝指纹**：key = `sessionId:roomAgentId`，签名 = local/canonical 双方的轻量特征（processEventCount + assistantBodyText 长度 + thinkingHistorySize + 最新事件 id）。accepted 分支清除登记。
- 指纹持久化到 localStorage（LRU 上限 500 条，几 KB）。
- 导出 `isCanonicalReconciliationCircuitOpen(...)`：签名未变 → 返回 true。后台调用源（reason 为 `repair` / `startup` / `running-sample`）命中时**整体跳过该 target**（不调 reconcile、不 setState、不写 recoveryIssue）。`undo` 等用户手动路径不跳过（canonical 变了指纹自然失效，不影响正确性）。
- canonical 增长后指纹变化 → 自动重试一次 → 修得好就 accepted 清除，修不好登记新指纹。把"每秒 15 次永败"降到"仅状态变化时一次"。

### B. persist 触发收口

- `useStatePersistence.ts` 订阅加**浅比较守卫**：sessions 数组逐项引用相同且 pendingMessages 引用相同 → 直接 return（根治 `map` 无变化产出新数组导致的假变化）。
- 启动窗口（30s）内 `archiveOrDeletionChanged` 的立即 flush 改走启动档防抖合并（tombstone 小数据写入保持立即）；窗口外语义不变。

### C. 增量持久化（治本：单次成本 O(变化集)）

- **分键存储**：`kimix_local_sessions_index`（id + 轻元数据）+ 每会话 `kimix_local_session_<id>`。stateStorage 现有按 key API 直接复用。
- **写路径**：runPersist 按会话与引用缓存比对——未变会话零成本跳过；变化会话单独 strip + stringify + put；删除的会话清 key；index 变化才重写。pendingMessages 保持单键（体量小）。
- **读路径**：loadLocalSessions 读 index → 分批并行读会话 key → hydrateSessions 不变；旧单键格式自动迁移（读出后首轮 persist 分键写回并删旧键）。
- **hydration 登记**：每会话引用缓存随 hydration 建立，启动后首次 persist 全跳过（衔接 5bfbe35 守卫语义）。
- **图片 GC**：refs 按会话缓存，变化会话才重算。

### D. 归因补强

- rejected/accepted 日志补 `callerReason` 字段（当前被判定 reason 覆盖，无法区分调用源）。
- persist.run 归因日志（已有）补 `changedSessions/totalSessions` 字段，下次可直接观测增量命中率。

### 防线（防复发）

- 测试：熔断（登记/命中/重试/清除/LRU）、订阅浅比较、启动窗口 flush 合并、分键读写往返、增量跳过、迁移兼容、图片 refs 缓存。
- 知识库：streaming-render-pipeline 持久化段更新分键结构与三条新不变量；log.md 记录。
- 可观测：persist.run + rejected 日志归因完整，下次异常直接可见。

## 不做（避免范围爆炸）

- 会话事件体懒加载（侧栏只读 index）：架构改动大，分键后写成本已 O(变化集)、读为异步分批，暂不需要。若未来 hydration 读成本成为瓶颈再立项。
- localStorage fallback 双轨：分键逻辑统一，超配额报错行为与现状一致。

## 验收标准

1. typecheck + 全量测试通过 + build 通过。
2. 新增定向测试覆盖上述防线全部条目。
3. 用户重启实测：KIMIX_PERF 启动 30s 窗口长任务总时长从 26065ms 降到 <1500ms；diag.log 启动窗口 persist.run ≤ 2 次且 totalMs 均 <500ms（仅变化会话）；同指纹 rejected 日志每目标 ≤1 次。
4. 版本 bump 2.20.0 + release notes。

## 执行顺序

Phase 1 (D+A) → 验证提交 → Phase 2 (B) → 验证提交 → Phase 3 (C) → 验证提交 → Phase 4（版本/文档/知识库）→ 全量验证提交。
