# 功能点 × 链路 × 官方 Web 一致性全量审查

> 2026-08-03 五路并行只读审查（IPC 层 / SDK 兜底引擎 / Server 能力面实测 / 渲染层 / 辅助模块）+ 主代理在线复核（Server 0.31.1 实例 58627 实测）。目标：找出所有「没有走与官方 Kimi Code Web 一致链路」的功能点，评估可迁移性，确保后续开发与运行稳定性。

## 一、链路定义与总览

| 链路 | 实现 | 官方 Web 一致性 |
| --- | --- | --- |
| **server-rest** | `kimiCodeServerClient.ts` REST `/api/v1/*`（+ `kimiCodeServerHost.ts` 托管） | ✅ 与官方 Web 同链路 |
| **server-ws** | `kimiCodeServerClient.ts` WS `/api/v1/ws`（client_id=web_*，官方 Web 同源） | ✅ 与官方 Web 同链路 |
| **sdk** | `kimiCodeHost.ts` 加载 `vendor/kimi-code-sdk`（官方 tag 干净构建，兜底） | ⚠️ 官方 Web 不使用；仅官方 SDK 能力 |
| **本地文件读取** | 读 `~/.kimi-code/...` wire.jsonl / state.json / config.toml / mcp.json | ⚠️ 非协议链路，数据镜像或配置源 |
| **本地合成/伪造** | 本地合成事件帧（如 steer 记录、`agent.status.updated`、失败帧、session_recommendation） | ❌ 非官方数据来源，UI 层补偿 |
| **纯本地** | git/文件/窗口/设置/长程任务/更新等（不触引擎） | — 与 Kimi Code 无关 |

**路由开关**：新会话走 Server 需 `shouldRouteNewSessionToServer()`（kimiCodeHost.ts:2850）`= isKimiCodeServerSessionRoutingEnabled(env) && kimiCodeServerHost.isReady()`；会话级分流一律看 `serverSessions.has(sessionId)`。

---

## 二、全量功能点矩阵（按「当前链路」分组）

### A. 已走官方 Server 链路（与 Web 一致，无需迁移）✅

| 功能点 | 位置 | 链路 |
| --- | --- | --- |
| 会话创建/恢复/重命名 | kimiCodeHost.ts:790/818/983 | server-rest（失败降 sdk） |
| prompt 发送（含图片/视频/文件附件） | kimiCodeHost.ts:1296-1349；serverClient:1312 | server-rest + server-ws（附件 `/api/v1/files`，图片 500 时 base64 内嵌 fallback） |
| steer 引导 | kimiCodeHost.ts:1526-1546 | server-rest（但本地合成 steer 事件，见 §四-4） |
| abort/undo/btw/fork/children | kimiCodeHost.ts:1558/1548/1452/916/961 | server-rest（实测全部路由存在） |
| setModel/setPlanMode/setThinking/setPermission | kimiCodeHost.ts:1075/1572/1587/1601 | server-rest（profile） |
| Swarm（0.31+ 原生） | kimiCodeHost.ts:1397-1450 | server-rest（profile swarm_mode + prompts 请求级标记） |
| 会话列表/归档/恢复 | kimiCodeHost.ts:2437/1636/1692/1701 | server-rest（`listSessions` 已双链，Server 优先） |
| skills 列表/激活 | kimiCodeHost.ts:2281/2290 | server-rest（`/skills`、`:activate`） |
| MCP 运行时状态/重启 | kimiCodeHost.ts:1898/1913 | server-rest（`/mcp/servers`、`:restart`） |
| 后台任务 list/output/stop | kimiCodeHost.ts:2112/2141/2158 | server-rest（`/tasks`） |
| 终端全生命周期 | kimiCodeHost.ts:2185-2230 | server-rest + server-ws（SDK 会话抛错，仅 Server 提供） |
| approvals/questions 响应 | kimiCodeHost.ts:2711/2743 | server-rest（`/approvals`、`/questions`） |
| getStatus/getUsage（server 会话） | kimiCodeHost.ts:1806/1827 | server-rest |
| 模型/Provider 目录、config、auth 汇总 | kimiCodeHost.ts:2057-2110 | server-rest |
| 登录/登出（server OAuth 优先） | main.ts:5710-5788 | server-rest，失败降 SDK device flow |
| setConfig/setExperimentalFeature | kimiCodeHost.ts:2514-2534 | server-rest 优先，失败降 SDK |
| 历史正文加载（server 会话） | kimiCodeHost.ts:2463-2483 | server-rest（snapshot），截断/失败时本地 wire 兜底 |
| 搜索/读文件（会话内 fs） | kimiCodeHost.ts:2024/2041 | server-rest（`/fs:search`、`/fs:read`） |

### B. 走 SDK / 本地读取 / 协议外，但官方 Server **有等价能力**（可迁移候选）🔶

| # | 功能点 | 当前链路证据 | 官方 Server 等价（已实测） | 可迁移性评估 |
| --- | --- | --- | --- | --- |
| B1 | **套餐用量读取（getManagedUsage）** | kimiCodeHost.ts:1839-1843 `sdkHarness.auth.getManagedUsage`；main.ts:7110-7145 再直连官方 Web HTTP（api.kimi.com/coding/v1/usages） | `GET /api/v1/oauth/usage` → **200**（周窗口 used 98/100 + 5 小时窗口 + reset_at） | ✅ **能**，但返回结构（`summary.window.used/limit/reset_at` + `limits[]` 无 `label`）与现有 `parseManagedUsagePayload`（kimiUsage.ts:304-325，依赖 `row.label` 正则匹配）**不兼容**，需适配层或新解析函数（主代理已复核） |
| B2 | **Goal 读取（getGoal）** | kimiCodeHost.ts:1775 对 server 会话第一行抛 `SERVER_GOAL_UNSUPPORTED_MESSAGE`（:773 文案「暂未公开 Goal API」） | `GET /sessions/{id}/goal` → **200**（data:null，路由存在）；POST → `unsupported action: goal` | ✅ **能（仅读取）**；创建/暂停/恢复官方仍无端点，维持报错。**报错文案已过时**（0.31.1 已可读） |
| B3 | **历史会话列表（搜索浮层 SearchOverlay）** | main.ts:7101-7108 → `sessionHistory.getSessions`（sessionHistory.ts:556-591 磁盘扫描 wire.jsonl/state.json） | `GET /api/v1/sessions`（serverClient:1223-1235），且同仓库双链版 `kimi-code:listSessions`（main.ts:6723）已存在 | ✅ **能**；两条列表 IPC 并存，SearchOverlay 走旧链，未接 server 权威源 |
| B4 | **模型/默认模型读取** | sessionHistory.ts:71-81（config.toml `default_model`）、297-328（wire.jsonl model） | `GET /api/v1/config`、`GET /api/v1/models`（serverClient:1190/1206） | ✅ **能**；但 `resolveSessionModel`（sessionHistory.ts:330-341）全仓无调用者，疑似死代码（需复核后再定） |
| B5 | **会话历史页脚补全（StatusUpdate/用量/模型）** | main.ts:6767-6770 server 成功后仍读本地 wire.jsonl；sessionHistory.ts:416-434 解析 usage.record | 无：快照消息 usage/model 全 null（sessionHistoryFallback.ts:38-40） | ❌ 官方无此数据；`/transcript*` 端点可提供同源消息体（见 B6），需评估字段覆盖 |
| B6 | **compact/steer 结果确认机制** | kimiCodeHost.ts:3354-3371 `waitForOfficialCompactionResult` → `getSessionWireFile`（3332-3340）读本地 wire.jsonl 尾部 256KB；steer 同（3408-3426） | `GET /sessions/{id}/transcript/user-messages` → **200**（含 turn 列表，默认 main agent）；`/transcript`、`/ops`、`/plan` 路由存在（需 agent_id） | ✅ **能（替代方案）**；可消除对本地 wire 文件布局的依赖；但 wire 里有 Kimix 独有字段（如 `kimix-fallback` steer 记录）需评估兼容性 |
| B7 | **会话导出（exportSession）** | kimiCodeHost.ts:2494-2501 仅 SDK export + `kimi export` CLI 兜底 | `POST /sessions/{id}/export` → **200**（实测返回 JSON 载荷，子代理曾见 ZIP 流，主代理复核为 JSON envelope） | ✅ **能**；官方「导出对话」能力现成，可替代 SDK+CLI 双兜底 |
| B8 | **hook 规则生成一次性 prompt（generateRule）** | main.ts:5467 → kimiCodeHost.ts:2619-2691 强制 `sdkHarness.createSession`（注释说明隔离意图） | Server `:btw`（agent_id 侧问）可等价 | ⚠️ **可选**；当前刻意隔离（不落 sessions 缓存、不触发事件流），迁移收益低，保留 SDK 合理 |

### C. 走 SDK / 本地，官方 Server **无等价能力**（不可迁移，需保留兼容链路）⛔

| # | 功能点 | 链路证据 | 官方 Server 等价 |
| --- | --- | --- | --- |
| C1 | **Goal 五件套（create/pause/resume/cancel）** | kimiCodeHost.ts:1767-1804 SDK `managed.session.createGoal` 等；server 会话抛错 | **无**（POST `/goal` 实测 `unsupported action`） |
| C2 | **插件管理（list/install/setEnabled/setPluginMcpEnabled）** | kimiCodeHost.ts:2265-2383；server 会话下 `getOrCreatePluginSession()`（2235-2251）建 **SDK 临时会话**（`os.tmpdir()/kimix-plugin-mgmt`）执行 | **无**（serverClient 无插件路由） |
| C3 | **插件命令（listPluginCommands/activatePluginCommand）** | kimiCodeHost.ts:2300-2316 server 会话抛错；SDK 会话走 SDK | **无** |
| C4 | **reloadSession（刷新 Skill/Plugin 注册表）** | kimiCodeHost.ts:994-1006 server 会话 **同 id 迁移 SDK**（`migrateServerSessionToSdk` 1008-1073，`sdkHarness.reloadSession` 1024-1027，删 server 绑定 + 钉 `sdkPinnedSessionIds` 1063） | **无**（实测无 reload 端点） |
| C5 | **getMcpStartupMetrics** | kimiCodeHost.ts:1907-1911 无 server 分支，server 会话 `getManagedSession` 抛「session is not active」 | **无**（报错文案不指向能力缺失，需优化） |
| C6 | **detachBackgroundTask（前台转后台）** | kimiCodeHost.ts:2168-2176 server 会话抛错 | **无**（tasks `:detach` 实测 `unsupported action`） |
| C7 | **getBackgroundTaskOutputPath** | kimiCodeHost.ts:2151-2156 server 会话**静默返回 undefined** | **无**（官方只给 output_preview） |
| C8 | **SDK 会话归档/恢复** | kimiCodeHost.ts:1709-1765 **直接改写 state.json**（JSON.parse+writeFile） | SDK 侧官方无 archive API；仅 server 禁用时触发，属兜底 |

### D. 本地合成/推断事件（渲染层可见但非官方数据源）❌

| # | 事件/功能 | 位置 | 说明 |
| --- | --- | --- | --- |
| D1 | steer 用户事件本地合成 | kimiCodeHost.ts:1531（server 分支）/1538-1545（SDK 分支）+ 3394-3402 | 两条分支都先发 `syntheticSteerRecord`（source:`kimix-fallback`）；SDK 分支 15s 内用 wire 官方 `turn.steer` 覆盖，server 分支**不覆盖** |
| D2 | `agent.status.updated` 合成 | kimiCodeHost.ts:3077-3089 `serverStatusToAgentEvent`（由 `/status` busy 映射） | 官方无此事件名，是 Kimix 状态 UI 的适配层 |
| D3 | 失败帧合成 | kimiCodeServerClient.ts:745-785（空正文 assistant 时合成「模型请求失败」`turn.step.interrupted`+`content.part`+`turn.ended`） | 数据是本地文案，仅触发条件来自 server snapshot；**最接近「伪造 Server 事件」的一处** |
| D4 | 草稿缓冲合成 assistant 事件 | useEventStream.ts:156-159 `draftToAssistantEvent`（kimiCodeEventMapper.ts:11-14 本地生成事件 id） | 内容 100% 来自真实 `assistant.delta`/`thinking.delta`，属延迟提交非伪造；但事件 id 与官方消息 id 无对应 |
| D5 | session_recommendation 卡片 | App.tsx:615-647 | 纯本地合成插入时间线 |
| D6 | 乐观 UI 占位（用户消息/assistant 占位） | App.tsx:1899-1922 | 乐观渲染，官方事件到达后替换 |
| D7 | 长程任务 proxy 消息 | App.tsx:1607-1697（本地合成 assistant_message/error，`agentRole:"executor"/"reviewer"`） | 纯本地编排层，非官方链路 |
| D8 | settleInactiveEvents 本地终态 | 渲染层历史恢复路径 | 把未完成事件本地标 settled |

### E. 官方 Server 已有但 Kimix **未接入**（能力闲置，实测 200）🔷

| 能力 | 实测路由 | 建议 |
| --- | --- | --- |
| **全局跨会话搜索** | `POST /api/v1/search` → 200（跨 session 命中） | 可做「全局搜索/侧栏搜索」，低成本 |
| **账号 userinfo** | `GET /api/v1/oauth/userinfo` → 200（昵称/头像/用户等级，实测 nickname=临江路） | 账号信息展示；当前头像等无来源 |
| **会话 warnings** | `GET /sessions/{id}/warnings` → 200 `{warnings:[]}` | 会话级警告横幅 |
| **transcript 四接口** | `GET /transcript`、`/ops`、`/plan`、`/transcript/user-messages` → 200（需 agent_id） | 官方 Web 对话回放数据源，可替代本地 wire.jsonl（见 B6） |
| **workspace trust** | `GET /workspaces/{wid}/trust` → 200 `{trusted:false}` | 官方真实信任模型；Kimix 当前用本地路径推断 trustLevel（main.ts:3805-3824） |
| **catalog/providers** | `GET /catalog/providers`、`/{id}` → 200 | 更全的模型目录（含 name/env_key），优化模型管理 UI |
| **全局 fs 端点** | `GET /fs:home`（home+recent_roots）、`/fs:browse`、`/fs:content`、`POST /fs:mkdir` | 文件浏览/最近项目复用 |
| **文件删除** | `DELETE /files/{id}`（路由存在） | **上传文件从不删除，附件垃圾累积风险**，建议补清理 |
| **单条消息/approvals/questions 列表/profile 读取** | 路由存在 | 低价值，快照已覆盖 |

### F. 纯本地（与 Kimi Code 链路无关，无需迁移）—

git 全套、文件读写/预览/diff、窗口控制、设置持久化、主题、更新源、长程任务编排、交接、通知、定时关机、`kimi vis`/`kimi web` spawn、MCP 配置文件管理（`/mcp/servers` 只有运行时状态无配置读写）、providerModelDiscovery（探测用户私有端点，Server 无此接口）、listMarketplace（官方源直连）、listProviderCatalog（models.dev）。

---

## 三、核心结论：未走 Web 一致链路的功能点汇总

### 可迁移（官方 Server 已支持，建议迁移）→ B1/B2/B3/B6/B7
1. **B1 套餐用量**：`GET /oauth/usage` 实测可用，替代 SDK `getManagedUsage` + 官方 HTTP 直连双兜底。**注意结构差异需适配**。
2. **B2 Goal 读取**：`GET /sessions/{id}/goal` 实测可用；`SERVER_GOAL_UNSUPPORTED_MESSAGE`（kimiCodeHost.ts:773）文案过时，至少应修正。
3. **B3 历史会话列表**：SearchOverlay 改走 `listSessions` 双链（已存在），消除磁盘扫描与 server 权威双源。
4. **B6 compact/steer 确认**：用 `/transcript/user-messages` 替代本地 wire.jsonl 尾部读取。
5. **B7 会话导出**：用 `POST /export` 替代 SDK export + CLI 双兜底。

### 不可迁移（官方 Server 无此能力，保留兼容链路）→ C1–C8
Goal 写操作、插件管理/命令、reloadSession、getMcpStartupMetrics、detachBackgroundTask、getBackgroundTaskOutputPath、SDK 归档。其中 C5（getMcpStartupMetrics）报错文案应改为能力提示而非「session is not active」。

### 可接可不接（能力闲置，产品决策）→ E 表
全局搜索、userinfo、warnings、transcript、workspace trust、catalog/providers、全局 fs、文件删除清理。

### 已知跳链毛边（v2.20.152 已收敛大部分，剩余待处理）
1. **`resolveMigratedSessionId`（kimiCodeHost.ts:748）只覆盖 8 个函数**（setModel:1076、sendPrompt:1301、setSwarmMode:1398、swarm:1418、steer:1527、cancel:1559、archiveSession:1637、closeSession:2580）；**遗漏** askBtw:1457、undoHistory:1549、compactSession:1616、setPlanMode:1573、setThinking:1587、setPermission:1602、getStatus:1807、getUsage:1828、Goal 五件套、listMcpServers:1899、getMcpStartupMetrics:1907、reconnectMcpServer:1914、listBackgroundTasks:2113、getBackgroundTaskOutput:2142、getBackgroundTaskOutputPath:2152、stopBackgroundTask:2159、detachBackgroundTask:2169、listSkills:2282、activateSkill:2291、listPluginCommands:2301、activatePluginCommand:2310（迁移后持旧 id 调用会「session is not active」）。
2. **迁移映射残留**：`serverSessionMigrations` 只在 archiveSession 清理（:1651-1655），closeSession 不清理（:2580-2600），map 无限增长。
3. **全局 fallback 后已打开 Server 会话变僵尸**：markServerRuntimeFailure（:2858-2865）只断 client，已打开 Server 会话后续操作报「Kimi Server 尚未就绪」，需手动重开（matrix 风险 4）。
4. **reload 迁移后不 pin**：Server 恢复后 `promoteSdkSessionToServer`（:1351-1382）会把 reload 迁移的 SDK 会话弹回 Server（上轮气泡掏空事件的窗口）。
5. **scheduleServerRecovery 无次数上限**（:1384-1395），SDK 会话持续存在期间无限重试（可接受但无界）。
6. **forkSession server 分支未传 forkId**（:922-925），渲染层若依赖 forkId 定位派生会话会失效。
7. **SDK 会话带 fileId 附件强制依赖 server**（kimiCodeHost.ts:1195 物化调 `/api/v1/files` 下载），server 挂时附件发送失败——需确认是否有意。
8. **listChildSessions 对 SDK 会话报错文案误导**（:961-962「Kimi Server 尚未就绪」）。
9. **listSlashCommands 用本地静态表**（main.ts:6979），server 会话无插件命令项，与官方 Web 前端静态命令+插件命令不一致。
10. **MCP 配置面板双轨**：全局配置走本地 config 文件（main.ts:5790-5812），会话级走 server——官方 Web 配置面板走 server，需产品决策。
11. **模型配置面板双轨**：保存走 SDK config.toml（main.ts:5600-5628），展示走 server catalog——存在配置漂移窗口。
12. **上传文件无 DELETE 清理**：附件垃圾累积。

---

## 四、待主代理复核/用户决策项

1. **B1 套餐用量迁移**：先对照 `parseManagedUsagePayload`（kimiUsage.ts:304-325）与 Server `/oauth/usage` 结构差异写适配，再替换 getManagedUsage 调用链（kimiCodeHost.ts:1839 + main.ts:7110-7145）。
2. **B2 Goal 读侧接入 + 文案修正**：`getGoal` server 分支接 `GET /goal`，其余四件套文案改为「官方 Server 仅支持读取 Goal 状态」。
3. **B3 SearchOverlay 迁移**：`listHistorySessions` 改走 `listSessions` 双链（注意排序/标题口径差异是产品决策）。
4. **B6 compact/steer 确认改 transcript**：评估 wire.jsonl 独有字段（`kimix-fallback` steer 记录、`full_compaction.*`）在 transcript 的覆盖度，决定去留。
5. **B7 export 迁移**：实测 `POST /export` 返回 JSON envelope（非 ZIP），确认内容与 SDK export 等价性。
6. **E 能力闲置**：全局搜索/账号 userinfo/文件删除清理——是否本轮做，由产品决策。
7. **跳链毛边 1-5**：resolveMigratedSessionId 补齐 + 迁移映射清理 + 僵尸会话自愈——见 `docs/server-sdk-migration-matrix.md` 第三节收敛建议，是否本轮实施。

---

## 五、审查方法与证据

- **五路并行只读审查**：IPC 层（main.ts/preload/ipc 类型）、SDK 兜底引擎（kimiCodeHost.ts 全量）、Server 能力面（serverClient/serverHost + 在线实测）、渲染层（src/ 全量）、辅助模块（16 个 electron 模块）。
- **在线实测**：实例 58627（0.31.1，backend v2，capabilities: websocket/file_upload/fs_query/mcp/tasks/terminal），`Authorization: Bearer $(cat ~/.kimi-code/server.token)`，全部 `--max-time 3`。
- **主代理复核**：goal GET 200 / oauth/usage 200（used 98/100 周窗口）/ userinfo 200（nickname=临江路）/ warnings 200 / search 200（跨会话命中）/ export 200（JSON envelope）/ transcript/user-messages 200 / profile GET 200 / resolveMigratedSessionId 覆盖 8 处（grep 复核）。
- **未验证**：WS 在线握手帧面（避免创建测试会话）；SDK `getManagedUsage` 与 Server `/oauth/usage` 返回结构逐字段对照（B1 迁移前必做）；`POST /providers` 变更类语义（未实测避免污染）。
