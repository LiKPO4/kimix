# Kimix 用户控制的多 Agent 房间实施计划

日期：2026-07-13

状态：已批准实施。阶段 0 进行中；在事件归属、运行状态、历史分区和官方目录门禁全部通过前，不开放添加 Agent 的用户入口。

## 1. 产品目标

在普通 Kimix 会话中通过输入框旁的 `+` 添加独立 Agent，使当前会话原地升级为用户控制的多 Agent 房间：

- 每个房间 Agent 使用独立 Kimi Code session 和独立上下文。
- Agent 不预设实施者、审查者等身份，行为完全由用户提示词决定。
- 用户通过接收者选择或 `@Agent` 决定谁接收消息；未选中的 Agent 不接收、不响应。
- 每个 Agent 直接复用现有 Kimi Code Provider、模型 alias、权限、工具和事件协议。
- 不新增外部 Agent Runtime，不新增第二套 Provider/API Key 管理，也不增加独立产品模式。
- 不自动把一个 Agent 的输出注入另一个 Agent 的上下文；跨 Agent 转交必须由用户明确触发。

内部和文档统一使用“多 Agent 房间”或“协同房间”，避免与 Kimi Code 已有 Swarm 功能混用。

## 2. 第一版边界

- 最多 4 个房间 Agent。
- 仅普通 Kimi Code 会话支持；Long Task 暂不支持添加房间 Agent。
- 多个 Agent 共享当前项目目录，不自动创建 worktree，不自动加锁或回滚文件。
- 新 Agent 默认从空上下文开始，只接收用户明确路由给它的后续内容。
- Agent 不能自动触发另一个房间 Agent，也不能形成循环调用。
- 多接收者普通提示允许并行；session mutation 命令必须只有一个接收者。
- 多接收者消息暂不支持整组撤回重写；单接收者撤回只作用于对应 Agent 最新空闲轮次。
- 添加 Agent 弹层只选择现有模型和权限，不在其中管理 Provider 凭据。
- 单 Agent 会话的界面、发送、停止、队列、撤回和恢复行为必须保持不变。

## 3. 架构边界

### 3.1 房间、Agent 与 Runtime

一个现有 `Session` 继续作为侧栏中的房间。每个 `RoomAgent` 对应一个独立 Kimi Code runtime：

```text
Kimix Session / Room
  |- RoomAgent A -> Kimi Code session A -> modelAlias A
  |- RoomAgent B -> Kimi Code session B -> modelAlias B
  `- RoomAgent C -> Kimi Code session C -> modelAlias C
```

Electron 主进程现有 Host 已按真实 session ID 使用 Map 管理 Server/SDK session，因此不新增 Runtime Adapter。主要改造范围位于 renderer 的所有者解析、运行状态、事件合并、时间线投影和持久化。

### 3.2 建议数据模型

```ts
interface CollaborationState {
  schemaVersion: 1;
  primaryAgentId: string;
  defaultRecipientIds: string[];
  focusedAgentId?: string;
  agents: RoomAgent[];
  messages: RoomUserMessage[];
  agentEvents: Record<string, TimelineEvent[]>;
}

interface RoomAgent {
  id: string;
  displayName: string;
  mentionName: string;
  modelAlias: string;
  modelLabelSnapshot?: string;
  providerLabelSnapshot?: string;
  permissionMode: PermissionMode;
  runtimeSessionId?: string;
  officialSessionId?: string;
  createdAt: number;
  removedAt?: number;
}

interface RoomUserMessage {
  id: string;
  content: string;
  recipientAgentIds: string[];
  deliveries: Record<string, AgentDelivery>;
  timestamp: number;
}
```

兼容规则：

- 老 Session 在内存中映射为一个 synthetic primary Agent。
- 只有第一次添加第二个 Agent 时才把协同结构持久化。
- 顶层 `runtimeSessionId`、`officialSessionId`、`model` 和 `events` 在迁移期继续镜像 primary Agent。
- primary 只是旧结构兼容锚点，不是产品身份或预设角色。
- Provider 凭据不进入房间数据，只保存 model alias 和脱敏显示快照。
- 不批量重写旧事件 ID；新官方事件和 snapshot 映射使用确定性身份。

### 3.3 事件归属字段

新增字段：

- `roomAgentId`：房间参与者所有权。
- `roomMessageId`：房间级用户消息身份。
- `agentTurnId`：某个 Agent 回复块的稳定身份。
- `recipientAgentIds`：用户消息的实际接收者。

不得复用现有 `TimelineEvent.agentId` 或 `agentRole`；它们已分别承担 Kimi 内部 Subagent/Swarm 和 Long Task executor/reviewer 语义。

## 4. 强制运行不变量

1. runtime 事件进入归并器前必须解析出 `{ roomId, roomAgentId }`。
2. Assistant、工具、Subagent、审批、提问、用量和终态只能更新同一 `roomAgentId`。
3. 某个 Agent 的 `TurnEnd` 不得结算其他 Agent 的开放事件。
4. 官方 snapshot 只对所属 Agent 的历史分区具有权威性，不能替换整个房间。
5. official undo 允许所属 Agent 历史变短或为空，但不能删除其他 Agent 历史。
6. 审批、提问、停止、引导、模型和权限操作必须携带明确的 Agent/runtime。
7. 一条多接收者消息只显示一次，每个 delivery 生成独立且永久的 `agentTurnId`。
8. 响应块首次创建后位置固定，迟到事件或时间戳变化不得重排。
9. `agentTurnId` 同时作为 React key、滚动锚点和展开状态 key，snapshot 不得更换它。
10. 次要 Agent 的官方标题不得覆盖房间标题。
11. 已绑定房间的次要官方 session 不得重复显示在侧栏；绑定丢失时必须可作为独立会话找回。
12. Provider 配置失效时显示不可用状态，不得静默切换模型。
13. 一个 Agent 失败、停止、迁移或等待审批时，其他 Agent 的状态与队列不受影响。

## 5. 用户交互

### 5.1 添加 Agent

`+` 工具菜单顶部新增“添加 Agent”，点击后打开独立弹层。弹层包含：

- 显示名称：默认使用模型显示名，重名自动追加数字。
- 唯一 `@名称`：无空格、大小写不敏感、房间内唯一。
- 模型：复用 `buildSessionModelOptions` 和 `groupSessionModelOptions` 的 Provider 分组目录。
- 权限：复用 `manual`、`auto`、`yolo`。
- “管理模型与供应商”：跳转现有设置页。

不提供角色、身份模板或自动系统提示词。

### 5.2 接收者路由

第二个 Agent 添加后才显示接收者栏。最终接收者按以下顺序确定：

1. 输入中存在合法房间 `@Agent` 时，以这些 Agent 为准。
2. 没有房间 mention 时，使用接收者栏当前选择。
3. 没有任何选择时，发送给默认 Agent。
4. `@所有人` / `@all` 显式广播。

房间消息保留用户原始文本用于展示；发送给模型时只剥离已识别的房间路由 token。文件、插件、Skill 等其他 `@` 内容保持不变。

现有 Explorer/Implementer/Reviewer/Test Runner 是静态文本插入项，不是真实独立 Agent。正式房间功能上线时，以真实房间成员替换这组“智能体”条目，避免身份歧义。

### 5.3 时间线和控制

- 一条用户消息只显示一次，并标注实际接收者。
- 按用户选择顺序立即创建各 Agent 的独立响应块。
- 每个 Agent 独立显示空闲、排队、发送、运行、待审批、待回答、失败和完成状态。
- 空闲目标立即发送，忙碌目标进入自身队列。
- 单个停止只停止目标 Agent；多个运行时提供明确的 Agent 列表和“停止全部”。
- 模型、权限、Plan、Goal、Swarm 等 session 级操作必须先明确一个 Agent。
- 运行中的 Agent 不允许切模型，但不阻止操作其他空闲 Agent。

## 6. 官方目录、持久化和生命周期

创建次要 Agent session 时写入受控 metadata：

```json
{
  "source": "kimix-room-agent",
  "kimixRoomSchemaVersion": 1,
  "kimixRoomId": "...",
  "kimixRoomAgentId": "...",
  "kimixPrimarySessionId": "..."
}
```

目录规则：

- 已绑定本地房间的次要 session 折叠进所属房间。
- 本地房间绑定缺失时，session 作为普通独立会话显示，避免历史不可见。
- 次要 session 缺失时只标记对应 Agent missing，不归档整个房间。
- 搜索命中次要 session 时打开所属房间并定位具体 Agent。

生命周期规则：

- “移出房间”不删除历史，默认将该 Agent 变成普通独立会话。
- “归档房间”逐 Agent 调用官方归档并使用 `allSettled` 汇总。
- 部分失败时保留房间可见并显示可重试状态。
- 备份 schema 升至 2，支持 v1 -> v2 迁移。
- 导入副本必须清空全部 Agent 的 runtime/official 绑定，避免连接原官方会话。

## 7. 分阶段实施与门禁

### 阶段 0：计划、ADR、基线和开发 gate

- [x] 持久化本计划。
- [x] 记录产品与架构决策。
- [x] 记录当前 62 个文件、441 项测试基线。
- [x] 增加内部开发 gate；不作为用户产品模式。
- [x] 建立第一组兼容数据测试。

退出门禁：现有单 Agent 行为无变化。

### 阶段 1：兼容数据模型和所有者 helper

- [x] 新增 CollaborationState、RoomAgent、RoomUserMessage 和归属字段。
- [x] 新增规范化、primary、runtime owner 和事件 owner helper。
- [x] 旧 Session 只在内存中映射，不立即持久化。
- [x] primary 顶层兼容字段由统一适配器镜像。

退出门禁：老会话序列化、图片、模型、runtime 和历史无损。

### 阶段 2：Agent 级运行状态和事件隔离

- [ ] 新增 `roomId + roomAgentId` 活动表。
- [ ] `runningSessionId` 降级为单 Agent 兼容派生值。
- [ ] 事件监听、终态、轮询和 Server -> SDK 迁移使用 runtime owner。
- [ ] useEventStream 按房间 Agent 分批。

退出门禁：A 完成、取消、迁移或失败均不改变 B。

### 阶段 3：历史分区和稳定渲染投影

- [ ] 每个 Agent 拥有独立 canonical history 分区。
- [ ] merge、settle、snapshot、undo 和媒体回填限定 Agent/turn。
- [ ] 历史映射使用稳定 source identity。
- [ ] ChatThread 投影房间用户消息和多个 Agent turn。
- [ ] 展开状态与滚动锚点绑定永久 `agentTurnId`。

退出门禁：两 Agent 事件交错、ID 相同、同时运行和迟到 snapshot 均不串线、不重挂载。

### 阶段 4：持久化、目录和恢复

- [ ] IndexedDB 规范化与懒升级。
- [ ] metadata 与官方 catalog 折叠。
- [ ] 重启分别恢复每个 Agent 历史。
- [ ] 图片引用、备份 schema 2、导入 ID 重映射和 tombstone。
- [ ] 移出、归档、恢复和部分失败状态。

退出门禁：重启后侧栏仍只有一个房间，全部 Agent 绑定正确且孤儿历史可见。

### 阶段 5：添加 Agent 和单目标 UI

- [ ] `+` 菜单增加“添加 Agent”。
- [ ] 复用现有模型目录和设置入口。
- [ ] 添加名称、mention、权限校验。
- [ ] 普通会话原地升级；单 Agent UI 保持原样。
- [ ] 第一小步只开放单接收者。

退出门禁：添加、重启、重命名、模型失效和移出均可恢复。

### 阶段 6：精确路由、多目标和独立队列

- [ ] 房间 Agent mention 补全与确定性解析。
- [ ] 房间 token 从模型 payload 中剥离。
- [ ] 每 Agent delivery、placeholder、队列、重试和取消。
- [ ] 多个 Agent 并发执行和固定响应块顺序。

退出门禁：未点名 Agent 无上下文新增；忙碌 Agent 不阻塞空闲 Agent。

### 阶段 7：Agent 级高级操作

- [ ] ApprovalCard、QuestionCard、Stop、Steer 绑定事件 owner。
- [ ] 模型、权限、Plan、Goal、Swarm 绑定明确 Agent。
- [ ] session mutation 命令要求唯一目标。
- [ ] 单接收者 undo 使用 Agent scoped canonical snapshot。
- [ ] 通知包含 Agent 并定位对应 turn。

退出门禁：所有操作均命中正确 runtime；部分 Agent 失败不影响其他 Agent。

### 阶段 8：搜索、导出、归档和恢复

- [ ] 搜索结果显示 Agent 名称/模型并稳定定位。
- [ ] Markdown 导出整个房间并标注接收者/说话者。
- [ ] 官方 ZIP 导出选择具体 Agent。
- [ ] 归档/恢复逐 Agent 报告结果。
- [ ] 提供孤儿 session 找回路径。

退出门禁：备份、重启、搜索、导出和部分失败路径全部通过。

### 阶段 9：视觉、性能和发布验收

- [ ] 空态、1/2/4 Agent、窄窗口、长名称、多个并行运行。
- [ ] 历史展开与滚动稳定性回归。
- [ ] 同 Provider 不同模型、不同 Provider、单 Provider 失败。
- [ ] 多 Agent 同目录写入风险提示。
- [ ] 用户截图和真实交叉审查流程验收。
- [ ] 同步版本号三处和专属 release notes。

退出门禁：全量自动验证通过并可交给用户实测；仅在用户验收后决定推送/tag。

## 8. 自动验证矩阵

### 单元测试

- 老 Session -> synthetic primary 的幂等兼容。
- runtime -> room/Agent 解析。
- 两 Agent Assistant delta、toolCallId、requestId 和 terminal 隔离。
- snapshot/undo 只更新所属 Agent。
- 稳定 ID 重载不变。
- Provider catalog 折叠与 orphan 可见。
- `@` 路由、名称冲突和房间 token 清理。
- per-Agent pending queue 和逐 delivery 状态。
- 备份 v1 -> v2、Agent ID 重映射和副本解绑。
- Agent scoped approval、question、stop、undo、archive。

### 集成测试

- 同 Provider 不同模型。
- 不同 Provider 的模型 alias。
- 两 Agent 同时流式执行。
- 一个等待审批、另一个继续运行。
- 一个 runtime 失败或 Server -> SDK 迁移、另一个完成。
- 添加第二 Agent 后重启恢复。
- Provider 配置删除、Agent session missing、房间归档部分失败。
- 多 Agent 输出期间历史展开和滚动稳定。

### 每阶段通用命令

```powershell
$env:PATH='C:\Program Files\nodejs;C:\Users\lijialin08\AppData\Roaming\npm;' + $env:PATH
pnpm test:run
pnpm build
pnpm knowledge:validate
git diff --check
```

不在本地执行 `pnpm dist`，不手动上传 Release 资产。

## 9. 回滚策略

- 使用独立功能分支和阶段性窄提交。
- 数据模型先上线、UI 最后开放；失败时可以回滚当前阶段，不删除已保存数据。
- 不做破坏性 IndexedDB 版本迁移，不删除旧顶层字段。
- 内部 gate 关闭时仅禁用新增和发送，已存在次要 Agent 保持只读可见。
- 不把二级 Agent 历史静默隐藏或删除。
- UI 改动开始后，每轮同步版本号三处；最终发布只推 tag 触发 GitHub Actions。
