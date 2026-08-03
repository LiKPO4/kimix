# Server → SDK 跳链触发矩阵与官方对齐性评估

> 2026-08-02 五路并行只读排查（kimiCodeHost / main IPC / serverClient+serverHost / 渲染层 / 知识库与探针）。结论：**主动「强行迁移」只有 3 处，其余全是故障兜底；双引擎是刻意设计，不能与官方 Web 完全一致（官方无 Swarm/Goal/plugin commands/reload 的 Server REST），但现有兼容逻辑有 5 个可收敛的不一致点。**

## 一、跳链触发点全表

### A. 功能缺失强行迁移（同 id、空闲会话、Swarm 类钉死 SDK）

| 触发 | 入口 | host 位置 | 行为 |
| --- | --- | --- | --- |
| 开启 Swarm（按钮 / `/swarm on`） | Composer | `setSwarmMode` kimiCodeHost.ts:1397 | **v2.20.152 起**：官方 0.31+ profile `agent_config.swarm_mode` 直接切换，不迁移；运行中只记 `swarmModeDesired` 下轮生效。此前：同 id 迁移到 SDK + pin |
| 发起 Swarm 任务（`/swarm xxx`） | Composer | `swarm` :1415 | **v2.20.152 起**：profile 置 swarm_mode + 请求级 `swarm_mode` 标记，同一条 WS 收子代理事件。此前：同 id 迁移到 SDK + pin |
| 刷新 Skill 注册表（`/reload`、设置页） | 斜杠/设置 | `reloadSession` :994 | 同 id 迁移，**未 pin**（见风险 1） |

### B. 故障兜底（保可用性）

| 触发 | host 位置 | 行为 |
| --- | --- | --- |
| sendPrompt mid-turn 失败 | :1319-1330 | 新建 SDK 会话（**换 id**）+ `serverSessionMigrations` 映射 + `migratedTo` 通知 + 全局 markServerRuntimeFailure |
| createSession / resumeSession 失败 | :811 / :835 | markServerRuntimeFailure → SDK 新建/resume |
| WS 重连连败 ≥3 | serverClient:1942 | markServerRuntimeFailure（全局降级，不迁移已打开会话） |
| promote 回 Server 失败 | :1374 | markServerRuntimeFailure，保持 SDK |
| 初始刷新 missing | :2820 | 删绑定抛错，上层接走 SDK |

全局降级后 30s `scheduleServerRecovery` 自动尝试恢复；反向 `promoteSdkSessionToServer` 会让空闲 SDK 会话下次发消息自动升回 Server（除非 pinned）。

### C. 只报错不迁移（同一「不支持」家族，策略与 A 分裂）

Goal 五件套（`SERVER_GOAL_UNSUPPORTED_MESSAGE`）、plugin commands、detachBackgroundTask、`getMcpStartupMetrics`（报「session is not active」，文案差）。

## 二、与官方 Kimi Code Web 的差异判断

官方 Web 是纯 Server 客户端：Server 没有的能力（Swarm、Goal 队列、reload、plugin commands、additionalDirs、detach 后台转前台）就是不可用。Kimix 做不到也不应做到「完全一致」——这些能力官方只有 SDK 实现（vendor SDK 是官方 tag 干净构建），知识库已有决策记录：不批量强迁移、同 id、仅 turn 之间、0.31 后 SDK 兜底不缺 Agent 能力（runtime-routing.md 不变量 18/18a/45-46/73）。

**问题不在「有兼容链路」，而在兼容链路的 5 个毛边：**

1. **reload 迁移后不 pin**：Server 恢复后下次发消息被 `promoteSdkSessionToServer` 弹回 Server——「切了兼容链路又弹回」的瞬态（上轮气泡掏空事件正是这个迁移窗口的多写入源竞态）。
2. **「不支持」策略分裂**：Swarm/reload 静默迁移，Goal/plugin commands 只报错。用户无法预期。
3. **mid-turn 失败换 id**：`resolveMigratedSessionId` 只覆盖 8 个函数；`askBtw/undo/setPlanMode/setThinking/setPermission/compact/fork` 持旧 id 调用会报「session is not active」。
4. **全局 fallback 后已打开 Server 会话变僵尸**：后续操作必报错「Kimi Server 尚未就绪」，只能手动重开。
5. **迁移静默**：Swarm/reload 换引擎对用户无任何提示，之后出现的差异（如 Server 专属诊断/终端不可用）无法归因。

## 三、收敛建议（实施状态跟踪）

> 2026-08-03 更新：v2.20.153 完成 2、3、6；v2.20.154 完成 1、4、5。六条全部落地。

1. **迁移显式化** ✅（v2.20.154）：`migrateServerSessionToSdk` 迁移成功后发 `emitStatus(sessionId, "idle")`，渲染层据此刷新 runtime 绑定（mid-turn 失败换 id 场景已有 `migratedTo` 通知，v2.20.152 前已存在）。
2. **统一不支持策略** ✅（v2.20.153）：Goal 读侧接入 `GET /sessions/{id}/goal`、`SERVER_GOAL_UNSUPPORTED_MESSAGE` 文案改为「仅支持读取」；plugin commands 文案已带「请等待官方 Server API 暴露等价能力，或在 SDK route 会话中使用」。
3. **补齐 `resolveMigratedSessionId` 覆盖** ✅（v2.20.153）：askBtw/undoHistory/compactSession/setPlanMode/setThinking/setPermission/getStatus/getUsage/listMcpServers/reconnectMcpServer/后台任务组/listSkills/activateSkill 全部补上；`closeSession` 双向清理迁移映射。
4. **reload 迁移语义定案** ✅（v2.20.154）：**pin 到 SDK**（与 Swarm 一致）——reload 的目的是让 SDK 重载 Skill/Plugin 注册表，钉住避免 Server 恢复后被 `promoteSdkSessionToServer` 弹回导致 reload 效果丢失与链路反复横跳。
5. **僵尸会话自愈** ✅（v2.20.154）：`markServerRuntimeFailure` 后新增 `migrateIdleServerSessionsToSdk`——把已打开的非运行中 Server 会话批量 best-effort 迁到 SDK（复用 `migrateServerSessionToSdk`，unsubscribe 失败被 catch），运行中/等待中的会话保留（其失败路径走 `createSdkFallbackSession`）。
6. **`getMcpStartupMetrics` 换成友好不支持文案** ✅（v2.20.153）：改为「当前官方 Server 会话未提供 MCP 启动指标；该数据仅由兼容链路提供。」；另 `listChildSessions` 报错文案改为「会话子级列表仅由实验性 Kimi Server 提供。」
