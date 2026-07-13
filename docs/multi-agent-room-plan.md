# Kimix 用户控制的多 Agent 房间实施计划

日期：2026-07-13

状态：已批准实施。阶段 0-3 已完成，下一步进入阶段 4，功能仍处于内部开发 gate；在可靠投递、持久化恢复和官方目录门禁全部通过前，不开放添加 Agent 的用户入口。

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
  /** 最近一次由支持房间结构的版本同步 primary 顶层镜像的时间。 */
  primaryMirrorUpdatedAt: number;
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
  /** 未绑定 officialSessionId 时表示创建中或创建失败后可重试，不静默删除。 */
  provisioningError?: string;
  createdAt: number;
  removedAt?: number;
  missingSince?: number;
}

interface RoomUserMessage {
  id: string;
  content: string;
  recipientAgentIds: string[];
  deliveries: Record<string, AgentDelivery>;
  timestamp: number;
}

interface AgentDelivery {
  status: "queued" | "sending" | "accepted" | "running" |
    "waiting_approval" | "waiting_question" | "completed" |
    "failed" | "cancelled" | "indeterminate";
  /** 本地先生成并持久化；整个生命周期不变。 */
  agentTurnId: string;
  /** 每次明确重试生成新值，用于识别旧回包和重复提交。 */
  dispatchAttemptId: string;
  officialPromptId?: string;
  officialUserEventId?: string;
  error?: string;
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

### 3.4 两类可恢复事务

#### 添加 Agent

第一版只允许在房间全部 Agent 空闲时添加或移出 Agent，按以下顺序执行：

1. 校验四人上限、名称与 mention 唯一性、模型 alias 仍存在、权限值合法。
2. 先在本地持久化一个尚未绑定 runtime/official session 的 `RoomAgent`，使应用崩溃后仍知道有一次未完成创建。
3. 使用固定 `kimixRoomId + kimixRoomAgentId` metadata 创建官方 session；重试时先查目录并复用同一身份，不能盲目再创建。
4. 官方创建成功后绑定 `runtimeSessionId` / `officialSessionId` 并再次持久化。
5. 创建失败时保留可见的失败 Agent 条目，允许重试或移出；不自动删除可能已经创建成功的官方 session。

这样即使在“官方创建成功、本地绑定写入前”退出，目录恢复也能按 metadata 找回，而不会生成永久不可见的孤儿会话。

#### 发送房间消息

每次发送先冻结接收者快照，再逐 delivery 独立推进：

1. 解析合法房间 mention，保留原始展示文本，只从模型 payload 剥离已确认的路由 token。
2. 校验目标 Agent 可用性和命令能力；多目标 session mutation 直接拒绝，不做部分执行。
3. 在任何网络调用前，持久化 `RoomUserMessage`、接收者顺序、每个 `agentTurnId`、`dispatchAttemptId` 和初始 `queued` 状态。
4. 空闲 Agent 独立进入 `sending`，忙碌 Agent 留在自己的队列；一个目标失败不能回滚已被其他目标接受的 delivery。
5. 官方确认后记录 `officialPromptId` / `officialUserEventId`；后续事件必须同时通过 runtime owner 和 delivery 关联进入对应 Agent turn。
6. 若应用在“已发送但未收到确认”期间退出，重启后先查官方状态和 snapshot。无法证明未发送时标记为 `indeterminate`，禁止自动重发，避免模型收到重复提示。
7. 用户明确重试时创建新的 `dispatchAttemptId`，沿用原 `roomMessageId` 但创建新的 `agentTurnId`，并在 UI 中标明这是重试响应。

### 3.5 官方历史关联规则

- `officialPromptId`、官方 message ID 和持久化 delivery 是新消息关联的权威来源。
- “规范化文本 + 时间窗口”只能用于迁移旧数据的候选恢复，不能作为新房间消息的最终绑定依据。
- 候选恢复出现零个或多个匹配时，不猜测、不串线；事件保留在所属 Agent 的 canonical history 中，并显示为待关联历史或记录诊断信息。
- `agentTurnId` 必须在网络发送前生成并持久化，不能由时间戳、数组位置或 snapshot 回放顺序临时生成。
- snapshot 产生的稳定 source ID 只解决事件自身身份；它不能替代 room message、delivery 和 Agent turn 的关联。

### 3.6 兼容写入与降级保护

- `Session.collaboration` 只在真正添加第二个 Agent 后持久化，普通单 Agent 会话继续使用现有存储形态。
- 支持房间结构的版本每次持久化时同时更新 primary 顶层镜像和 `primaryMirrorUpdatedAt`。若重新加载时发现顶层 Session 更新晚于该标记，说明可能被旧版本写过，只把顶层 runtime/model/events 重新并入 primary Agent，不覆盖次要 Agent 分区。
- 读取未知的未来 collaboration schema 时进入只读保护，保留原始数据并提示升级；不得用当前 schema 重新保存或删除未知字段。
- 旧版本无法操作多 Agent 房间是允许的兼容限制，但重新回到新版本后必须做到：primary 修改可恢复、次要 Agent 历史仍在、丢失本地房间时官方次要 session 仍可单独找回。
- 目录折叠必须保守：只有 metadata 字段完整、schema 受支持、项目路径一致且本地房间/Agent 身份精确匹配时才隐藏次要官方 session；任何歧义都保持独立可见。
- room metadata 只能由主进程根据专用结构生成并校验，renderer 不得传入任意 metadata 对象。
- room metadata 必须贯穿 Server 创建、SDK 创建、Server -> SDK fallback 和 catalog summary；任何一次 runtime 迁移都不能丢失房间身份。

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
14. 新房间消息不得仅凭文本和时间戳绑定官方事件；无法唯一确认时宁可待关联，也不能绑错 Agent turn。
15. 添加 Agent 和发送消息都必须先保存本地意图，再调用官方接口；中途退出后必须可以继续、重试或明确放弃。
16. `sending` 状态恢复后若无法确认官方是否已接受，禁止自动重发，避免重复上下文和重复工具操作。
17. 用量、耗时和完成气泡只由当前 `roomAgentId + agentTurnId` 的真实终态决定；房间内其他 Agent 是否运行不得干扰。
18. 未能关联到 room message 的官方事件仍属于对应 Agent，不能被丢弃、隐藏或误挂到最近一轮。

## 5. 用户交互

### 5.1 添加 Agent

`+` 工具菜单顶部新增“添加 Agent”，点击后打开独立弹层。弹层包含：

- 显示名称：默认使用模型显示名，重名自动追加数字。
- 唯一 `@名称`：无空格、大小写不敏感、房间内唯一。
- 模型：复用 `buildSessionModelOptions` 和 `groupSessionModelOptions` 的 Provider 分组目录。
- 权限：复用 `manual`、`auto`、`yolo`。
- “管理模型与供应商”：跳转现有设置页。
- 房间有任一 Agent 正在发送、运行、待审批或待回答时，第一版禁用添加和移出，避免成员列表与在途事件所有权同时变化。

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
- `sending` 超时但官方状态不明时显示“待确认”，不伪装成失败，也不自动重试。
- 单个停止只停止目标 Agent；多个运行时提供明确的 Agent 列表和“停止全部”。
- 模型、权限、Plan、Goal、Swarm 等 session 级操作必须先明确一个 Agent。
- 运行中的 Agent 不允许切模型，但不阻止操作其他空闲 Agent。
- 每个响应块的模型、Provider、状态、审批和最终用量都来自该 Agent turn，不使用房间级最新值代替。

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
- 目录出现 metadata 完整但本地未绑定的 session 时，优先按 `kimixRoomAgentId` 恢复绑定；所属房间已不存在时作为可找回的独立会话显示。

生命周期规则：

- “移出房间”不删除历史，默认将该 Agent 变成普通独立会话。
- “归档房间”逐 Agent 调用官方归档并使用 `allSettled` 汇总。
- 部分失败时保留房间可见并显示可重试状态。
- 归档、恢复、移出和删除 Provider 配置期间禁止把 missing/unavailable 自动解释成成功，所有部分失败都保留明确记录。
- 备份 schema 升至 2，支持 v1 -> v2 迁移。
- 导入副本必须清空全部 Agent 的 runtime/official 绑定，避免连接原官方会话。

## 7. 分阶段实施与门禁

### 阶段 0：计划、ADR、基线和开发 gate

- [x] 持久化本计划。
- [x] 记录产品与架构决策。
- [x] 记录当前 62 个文件、441 项测试基线。
- [x] 保持添加 Agent 用户入口不可达；阶段 5 前再加入显式 feature gate，不作为独立产品模式。
- [x] 建立第一组兼容数据测试。

退出门禁：现有单 Agent 行为无变化。

### 阶段 1：兼容数据模型和所有者 helper

- [x] 新增 CollaborationState、RoomAgent、RoomUserMessage 和归属字段。
- [x] 新增规范化、primary、runtime owner 和事件 owner helper。
- [x] 旧 Session 只在内存中映射，不立即持久化。
- [x] primary 顶层兼容字段由统一适配器镜像。

退出门禁：老会话序列化、图片、模型、runtime 和历史无损。

### 阶段 2：Agent 级运行状态和事件隔离

- [x] 新增 `roomId + roomAgentId` 活动表。
- [x] `runningSessionId` 降级为单 Agent 兼容派生值。
- [x] 事件监听、终态、轮询和 Server -> SDK 迁移使用 runtime owner。
- [x] useEventStream 按房间 Agent 分批。

退出门禁：A 完成、取消、迁移或失败均不改变 B。

### 阶段 3：历史分区和稳定渲染投影

- [x] 每个 Agent 拥有独立 canonical history 分区。
- [x] merge、settle、snapshot、undo 和媒体回填限定 Agent/turn。
- [x] 历史映射使用稳定 source identity。
- [x] ChatThread 投影房间用户消息和多个 Agent turn。
- [x] 展开状态与滚动锚点绑定永久 `agentTurnId`。
- [x] startup、running-sample、repair、undo 全部收口到同一个 Agent-scoped canonical reconcile 入口。
- [x] 结算门禁完全 Agent/turn 化，移除房间级运行状态对单个响应块的干扰。
- [x] 新房间消息不再使用文本+时间作为权威关联；歧义历史保留但不误绑。

退出门禁：两 Agent 事件交错、ID 相同、同时运行和迟到 snapshot 均不串线、不重挂载。

### 阶段 4：持久化、目录和恢复

阶段 4 不做一个大提交，严格按 4A-4G 顺序推进。每个子阶段只修改自己的边界、补局部测试、运行全量验证并单独提交；前一子阶段未通过，不进入下一项。

#### 4A：本地持久化规范化

- [ ] 为 collaboration 增加防御性 normalizer、schema gate 和 primary 镜像版本标记。
- [ ] `sanitizePersistedEvents`、`settleInactiveEvents` 和 stale recommendation 清理按 Agent 活动态分别处理，运行中的 Agent 不被提前结算。
- [ ] 图片抽取/恢复覆盖顶层事件、`collaboration.messages[].images` 和全部 `agentEvents` 分区。
- [ ] 老 Session 保持懒升级；普通会话序列化前后不凭空出现 collaboration。
- [ ] 未知未来 schema 保留原始值并只读，不降级覆盖。

退出门禁：单 Agent 存储快照兼容；2/4 Agent 重启后消息、图片、事件分区和 primary 镜像无损。

#### 4B：受控 metadata 与幂等创建

- [ ] IPC 只增加专用 `roomMetadata`，主进程逐字段校验 schema、roomId、roomAgentId 和 primarySessionId，拒绝任意 metadata 注入。
- [ ] 创建次要 Agent 时先持久化本地身份，再调用官方创建；重试前先按固定 room/Agent metadata 查询 catalog。
- [ ] 在官方允许的情况下同时使用稳定请求 session ID；不支持时仍以 metadata 查询作为幂等恢复依据。
- [ ] `ServerManagedSession` 保存创建 metadata，Server -> SDK fallback 创建时原样透传受控字段。
- [ ] Server 和 SDK 的 session summary 都必须能返回同一组 room metadata。

退出门禁：在“官方创建前、创建成功后、绑定写入前、fallback 迁移中”四个位置强制中断，重启后都不会重复创建或失去可见性。

#### 4C：官方 catalog 分组与保守找回

- [ ] 解析受控 `kimix-room-agent` metadata，并把已绑定次要 session 折叠到对应房间 Agent。
- [ ] metadata 完整且本地 Agent 仍在但绑定缺失时自动重绑；次要标题不覆盖房间标题。
- [ ] 本地房间不存在、metadata 歧义、schema 未知或路径不一致时，官方 session 作为独立可找回会话显示。
- [ ] 单个次要 Agent 缺失只标记该 Agent `missing`，不得把整个房间归档。
- [ ] Server authoritative 空目录、SDK 非权威目录和暂时网络失败必须使用不同语义，不能把“未列出”都解释成已删除。

退出门禁：侧栏不会同时出现房间和已绑定次要镜像，也不会隐藏任何无法精确归属的官方历史。

#### 4D：逐 Agent 历史与 runtime 恢复

- [ ] startup、后台 repair、running snapshot 和 resume 对每个 Agent 独立选择 runtime/official session。
- [ ] 一个 Agent 恢复失败时保留其 canonical history 和错误状态，其他 Agent 继续恢复和使用。
- [ ] Server -> SDK 迁移更新对应 Agent 绑定和 activity，不改变房间或其他 Agent。
- [ ] Provider/model alias 缺失时标记 unavailable，不静默切换模型。

退出门禁：冷启动、热重载和部分 runtime 缺失时，各 Agent 历史、模型和状态均不串线。

#### 4E：delivery 崩溃恢复

- [ ] 网络调用前持久化 room message、接收者顺序、`agentTurnId`、`dispatchAttemptId` 和 `queued` 状态。
- [ ] 官方接受后记录 prompt/message 身份；事件只按 runtime owner + 官方身份关联。
- [ ] 在发送后、确认前退出时先查官方 snapshot；无法确认则进入 `indeterminate`，禁止自动重发。
- [ ] 用户明确重试才创建新的 attempt 和 turn，并保留原失败/不确定尝试的审计记录。

退出门禁：对每个持久化/网络边界做故障注入，不出现重复提示、重复工具执行或错误 turn 绑定。

#### 4F：备份 schema 2 与身份重映射

- [ ] schema 2 完整保存 collaboration；schema 1 继续导入为单 Agent。
- [ ] normalizer 校验 agents、messages、deliveries、agentEvents 和全部引用关系。
- [ ] 创建导入副本时重映射 room Agent ID、recipient、delivery key、roomMessageId、agentTurnId、activity 和队列引用。
- [ ] 导入副本清空全部 Agent 的 runtime/official/catalog/missing 绑定，不连接导出来源的官方会话。
- [ ] tombstone 收集全部 Agent runtime/official ID；未知未来 schema 不允许写回。

退出门禁：v1/v2 导入、冲突分叉、重复导入、损坏引用和导入副本解绑全部通过。

#### 4G：生命周期与部分失败

- [ ] 移出 Agent 不删除历史，默认转换为独立会话并保留原官方 session。
- [ ] 归档/恢复逐 Agent `Promise.allSettled`，记录每个 Agent 的成功、失败和可重试状态。
- [ ] 部分失败时房间保持可见，不写“已全部归档/恢复”。
- [ ] 房间任一 Agent 活跃时禁止添加、移出、归档和会改变身份归属的操作。

退出门禁：重启后侧栏仍只有一个房间，全部可绑定 Agent 绑定正确，missing/失败状态真实，孤儿历史始终可见。

### 阶段 5：添加 Agent 和单目标 UI

- [ ] `+` 菜单增加“添加 Agent”。
- [ ] 复用现有模型目录和设置入口。
- [ ] 添加名称、mention、权限校验。
- [ ] 普通会话原地升级；单 Agent UI 保持原样。
- [ ] 第一小步只开放单接收者。
- [ ] 内部 gate 默认关闭；已存在房间在 gate 关闭时只读可见，不丢数据。

退出门禁：添加、重启、重命名、模型失效和移出均可恢复。

### 阶段 6：精确路由、多目标和独立队列

- [ ] 房间 Agent mention 补全与确定性解析。
- [ ] 房间 token 从模型 payload 中剥离。
- [ ] 每 Agent delivery、placeholder、队列、重试和取消。
- [ ] 多个 Agent 并发执行和固定响应块顺序。
- [ ] 重启后对 `sending` delivery 先官方核验，不能自动重复投递。

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
- 重复相同文本、相同秒级时间戳时仍按官方 prompt/message 身份准确关联。
- 无法唯一关联的历史保持可见且不进入错误 turn。
- Provider catalog 折叠与 orphan 可见。
- `@` 路由、名称冲突和房间 token 清理。
- per-Agent pending queue 和逐 delivery 状态。
- 创建 Agent 在官方成功、本地绑定前崩溃后的 metadata 找回。
- delivery 在发送后、确认前崩溃时进入 `indeterminate` 且不自动重发。
- 备份 v1 -> v2、Agent ID 重映射和副本解绑。
- Agent scoped approval、question、stop、undo、archive。

### 集成测试

- 同 Provider 不同模型。
- 不同 Provider 的模型 alias。
- 两 Agent 同时流式执行。
- 一个等待审批、另一个继续运行。
- 一个 runtime 失败或 Server -> SDK 迁移、另一个完成。
- 一个 Agent 已终态时立即显示自己的最终 usage，另一个仍运行不影响它；反向也成立。
- 添加第二 Agent 后重启恢复。
- 添加 Agent 和多目标发送的每个持久化/网络边界都做故障注入。
- Provider 配置删除、Agent session missing、房间归档部分失败。
- 多 Agent 输出期间历史展开和滚动稳定。

### 故障注入检查点

| 操作 | 强制中断位置 | 必须得到的恢复结果 |
| --- | --- | --- |
| 添加 Agent | 本地意图保存前 | 房间无变化，无官方 session |
| 添加 Agent | 本地意图保存后、官方创建前 | 显示可重试 provisioning Agent |
| 添加 Agent | 官方创建后、本地绑定前 | 按 metadata 重绑，不创建第二个 session |
| 发送消息 | delivery 保存前 | 不显示已发送，不调用官方接口 |
| 发送消息 | delivery 保存后、网络前 | 恢复为 queued，可由用户继续 |
| 发送消息 | 网络后、确认前 | 官方核验；不明确时标记 indeterminate，绝不自动重发 |
| 历史恢复 | 只恢复部分 Agent | 已恢复 Agent 可用，失败 Agent 保留历史与错误状态 |
| 归档房间 | 部分 Agent 成功 | 房间保持可见，逐 Agent 展示结果并允许重试 |
| 导入副本 | ID 重映射中发现坏引用 | 拒绝该房间副本，不生成半有效 collaboration |

### 每阶段通用命令

```powershell
$env:PATH='C:\Program Files\nodejs;C:\Users\lijialin08\AppData\Roaming\npm;' + $env:PATH
pnpm test:run
pnpm build
pnpm knowledge:validate
git diff --check
```

不在本地执行 `pnpm dist`，不手动上传 Release 资产。

## 9. 风险登记与停止条件

| 风险 | 主要防线 | 必须停止实施的信号 |
| --- | --- | --- |
| Agent 事件串线 | runtime owner + Agent 分区 + stable turn ID | 任一测试出现跨 Agent terminal、审批、usage 或 snapshot 更新 |
| 重复创建官方 session | 先保存本地身份 + 固定 metadata + catalog 重绑 | 崩溃恢复生成第二个相同 roomAgent metadata session |
| 重复投递提示 | 先保存 attempt + indeterminate 不自动重试 | 无法证明未发送时仍自动调用 prompt |
| 隐藏孤儿历史 | 精确 metadata 才折叠，歧义时独立显示 | catalog 中存在 session，但侧栏和房间内都不可见 |
| 旧版本回写破坏房间 | primary 镜像标记 + 次要分区保留 + metadata 找回 | 旧版本写入后新版本覆盖或丢失次要 Agent 数据 |
| Server/SDK 行为不一致 | metadata、ID、状态和 catalog 双路契约测试 | fallback 后房间身份、模型或 session 绑定丢失 |
| 共享目录写冲突 | 用户显式选择接收者 + 风险提示，不伪造隔离 | 产品文案暗示自动锁、worktree 或原子回滚 |
| 备份导入误连原会话 | 全量 ID 重映射 + 全部 runtime/official 解绑 | 导入副本能操作导出来源的任何官方 session |
| 单 Agent 回归 | 懒升级 + 兼容投影 + 全量回归 | 普通会话 UI、发送、撤回、恢复或侧栏行为变化 |

任何一项停止信号出现时：保持开发 gate 关闭，回退当前最小提交，先补复现测试和根因说明；不得通过 UI 特判隐藏数据层错误。

## 10. 回滚策略

- 使用独立功能分支和阶段性窄提交。
- 数据模型先上线、UI 最后开放；失败时可以回滚当前阶段，不删除已保存数据。
- 不做破坏性 IndexedDB 版本迁移，不删除旧顶层字段。
- 内部 gate 关闭时仅禁用新增和发送，已存在次要 Agent 保持只读可见。
- 不把二级 Agent 历史静默隐藏或删除。
- 回滚代码不得回滚或降级已写入的 schema 2 数据；旧版本无法识别时应保留原始记录并提示升级，而不是覆盖保存。
- 网络状态不确定时回滚只改变本地可操作性，不自动取消、重发或删除官方 session。
- UI 改动开始后，每轮同步版本号三处；最终发布只推 tag 触发 GitHub Actions。

## 11. 当前实现审计与开放条件

截至 2026-07-13，阶段 0-3 已完成。阶段 3 已实现并验证：

1. `startup`、quiet running snapshot、后台 repair、消息撤回重写和 `/undo` 全部使用统一的 Agent-scoped canonical reconcile。
2. ChatThread 的响应块、展开/滚动身份和最终 usage 只由对应 `roomAgentId + agentTurnId` 控制。
3. 新房间消息只接受 delivery/room/官方事件身份绑定；文本+时间仅用于已有官方 ID 的唯一旧数据迁移，歧义时不绑定。
4. 未关联的 compaction、session meta、用户、Assistant 或工具事件保留在所属 Agent 的独立时间线段，不再静默丢失或挂到最近一轮。
5. 当前工作树已通过 66 个测试文件、465 项测试、生产构建和 diff 检查；添加 Agent UI 仍必须等待阶段 4 的持久化、目录和崩溃恢复门禁。

UI 开放必须同时满足以下 go/no-go gate：

- 单 Agent 全量回归与当前发布行为一致。
- 两 Agent 并发、终态、审批、提问、取消、迁移和 snapshot 故障注入不串线。
- 添加 Agent、发送消息和重启恢复不存在自动重复创建或自动重复投递。
- 官方目录折叠不会隐藏孤儿 session，也不会在侧栏重复显示已绑定 session。
- schema 1/2 备份、导入副本解绑、Provider 缺失和部分归档失败均可恢复。
- 内部 gate 关闭后，现有房间数据仍可只读展示，普通会话完全不出现协同 UI。
- 用户完成空态、1/2/4 Agent、窄窗口、长名称和真实跨 Provider 审查验收。

开放顺序固定为：开发者内部只读观察 -> 单目标添加/发送 -> 重启与恢复实测 -> 多目标并行 -> 用户截图和真实跨 Provider 审查验收。任何一步失败都只关闭后续能力，不删除已保存房间数据。
