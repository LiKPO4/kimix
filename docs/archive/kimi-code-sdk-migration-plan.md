<!-- ===================== 全盘审计结论（置顶） ===================== -->

# 审计结论：当前仓库相对本计划的偏差（2026-06-02，v2.8.247）

> 审计范围：electron/、src/ 全盘，对照本文件 §2 迁移原则与 P0–P7 要义。下列每条均已用 file:line 实测确认。
> 总评：主交互已切到官方 SDK 主链路（P0–P6 大体落地，TASK_STATE 自报 P7 完成），但仍有 **2 条严重 + 3 条中等 + 3 条轻微** 偏差未收口，其中“SDK 从临时目录加载”和“三套 session id 并存”直接违反计划核心要义。

## 已达成（与计划一致，确认通过）

- P0 探针齐全：`scripts/probe-kimi-code-sdk.mjs` 与 `docs/kimi-code-sdk-probe-result.md` 存在，确认 CLI `0.6.0`、官方 SDK `@moonshot-ai/kimi-code-sdk@0.4.0`、prompt 实时流式、steer 不裂 session、`sessionId` 与 `~/.kimi-code/sessions/.../agents/main/wire.jsonl` 一致。
- P1：`electron/kimiCodeHost.ts`（约 723 行）实现官方 `KimiHarness`/`Session` 适配，内部 `Map<sessionId, Session>` 以官方 id 为 key；新 IPC `kimi-code:event` / `kimi-code:status` 与 26 个 `kimi-code:*` handler 齐全。
- P2/P4：新 mapper `src/utils/kimiCodeEventMapper.ts` + 测试存在；正式 timeline 按 `engine === "kimi-code"` 分流，未从 screen/answerText 合并正文；队列在 `steer()` 成功后立即移除、失败回滚（`Composer.tsx`），普通排队在本轮 `completed` 后才 `prompt()`（`App.tsx:1602-1634`）。
- P5：审批/提问/权限/Plan 全部走 SDK（`ApprovalCard.tsx`、`QuestionCard.tsx`、`Composer.tsx` 的 `setKimiCodePermission`/`setKimiCodePlanMode`），正式聊天链路无 `/plan`、`/model`、`/plugins` 文本下发。
- P7 部分：`electron/tuiHost.ts`、`src/utils/tuiSemanticReducer.ts` 已删除；未发现 `isInputIdle` / `scheduleTuiIdleCompletion` / 1.5s 强制 finish 主逻辑；未发现 screen 文本进入正式消息流。

## 仍不符合计划要义（待收口）

### 🔴 严重

1. ~~**官方 SDK 不是正式依赖，靠“临时研究目录”加载**~~ → **已收口（2026-06-02，vendoring 完成）**
   - 历史问题：`electron/kimiCodeHost.ts` 把 SDK 入口解析到 `%TEMP%\kimix-kimi-code-research\…\dist\index.mjs`；该 Temp 目录在 CI/换机/安装包里不存在，发布版新引擎会 `Failed to load`。
   - 官方真源：`@moonshot-ai/kimi-code-sdk` npm **404 未发布**，无法写 `dependencies`；且其 `dist/index.mjs` **本身不自包含**（实测缺 `zod`/`ajv`/`google-auth-library`/`@modelcontextprotocol/sdk` 等 bare import），只拷 `dist/` 仍会崩。
   - **收口做法（vendoring 自包含单文件）**：
     - 用 esbuild 把官方 `node-sdk/dist/index.mjs` 重打成 **自包含单文件** `vendor/kimi-code-sdk/index.mjs`（5.5MB，所有 JS 依赖内联；`bufferutil`/`utf-8-validate`/`canvas` 等可选原生标 external，消费库自带 try/catch；注入 `createRequire` banner 解决 ESM 下动态 require）。
     - `resolveSdkEntry()` 改为**优先 vendored**（打包：`process.resourcesPath/vendor/…`；dev：`app.getAppPath()/vendor/…`），`%TEMP%`/`KIMIX_KIMI_CODE_SDK_ENTRY` 降为本地开发兜底。
     - `electron-builder.yml` 经 `extraResources` 随包发布 `vendor/kimi-code-sdk`；新增 `scripts/vendor-kimi-code-sdk.mjs` + `esbuild` devDep + `pnpm vendor:kimi-code-sdk` 可复现重生成；`vendor/kimi-code-sdk/README.md` 记录来源 commit `121a6dd` / node-sdk `0.5.0` / CLI `0.7.0`。
   - **验证**：干净目录（无 node_modules）导入 + `KimiHarness` 实例化 + `createSession` 均 OK；用真实 App 身份 `kimi-code-cli` 跑真实 prompt **流式 101 deltas、首 delta ~2.1s、`completed`**；`pnpm build` 通过；优先级实测在 Temp 目录仍存在时仍选中 vendored。
   - 仍待：把旧 `@moonshot-ai/kimi-agent-sdk` 的 `extraResources` 一并移除——属第 3 条“清旧”分阶段迁移范围，留待后续。

1b. **主引擎依赖的是官方“未公开”的内部包**（战略风险，违反 §0“以官方文档与仓库为真源”的精神）
   - 官方文档 https://moonshotai.github.io/kimi-code/zh/ 当前 **完全未记载 Node SDK**，反而主打“单文件 CLI、毫秒级启动、无需 Node.js”；官方仓库 README 也只讲 CLI/终端用法。`packages/node-sdk` 在源码里仍是 `private: true`。
   - 即：Kimix 把主交互押在一个 **官方文档未背书、未发布、private** 的内部包上。官方一旦调整该包结构或停更，Kimix 主链路会断。需在计划里明确登记此风险与应对（持续跟踪官方仓库、vendoring 锁定已验证 commit）。

1c. ~~**CLI / SDK 版本已漂移，探针结论过期**~~ → **已重跑 P0 探针对齐（2026-06-02），兼容性确认通过**
   - 历史问题：探针旧记录为 CLI `0.6.0`、SDK `0.4.0`（commit `42bb914`）；官方已漂移到 CLI `0.7.0`、node-sdk `0.5.0`（研究仓库 commit `121a6dd`）。
   - **重跑结论（CLI 0.7.0 + node-sdk 0.5.0，16 通过 / 5 失败）**：新 SDK 主路全部通过——`createSession`/`resumeSession`、prompt 实时流式（首 delta ~1.0s）、**steer 不裂 session（before/after 会话数恒为 2）**、cancel、approval/question handler 回调全部命中；`session.id` 与 `~/.kimi-code/sessions/.../<id>/agents/main/wire.jsonl` 对齐且 `wireExists: true`。**迁移核心假设在最新版本依旧成立。**
   - 5 个失败均与新主路无关、且强化既定结论：
     - `kimi --wire` 在 CLI `0.7.0` 报 `unknown option '--wire'` → **旧 wire 协议已被官方移除**，旧 `@moonshot-ai/kimi-agent-sdk` 的 `ProtocolClient` 握手随之失败（探针 2 项失败）→ 第 3 条“删除旧 SDK”从“清理”升级为“旧链路已死、必须删”。
     - `pnpm view @moonshot-ai/kimi-code-sdk` 仍 404 → 第 1 条 vendoring 仍是唯一现实路径。
     - `official packages/node-sdk build`：`tsdown` 打包成功（dist 4.22MB），仅后续 `build:dts` 在 Windows `spawn EINVAL` 失败 → 只影响 `.d.ts` 生成，**运行时 `index.mjs` 正常**（`import from built source` + 全部 runtime smoke 通过）。vendoring 用预构建 `dist` 可完全绕开此构建问题。
   - 探针完整明细见 `docs/kimi-code-sdk-probe-result.md`（已用本次重跑结果覆盖刷新）。

2. **三套 session id 仍并存、仍在互相猜**（违反 §2 原则 3、P3、P7）
   - `src/types/ui.ts:46-61`：`Session` 同时保留 `id`、`runtimeSessionId`、`officialSessionId`。
   - `src/utils/runtimeSession.ts`：`runtimeSessionId ?? id` 的兜底猜测仍在。
   - `src/App.tsx`：`resolveUiSessionId(payload.sessionId)`（1517、1543 行）与 `findLocalSessionForRuntime(...)`（约 59-65、258-264 行）仍做三路 id 匹配。
   - 计划明确要求“Kimix UI session id 最终必须等于官方 `sessionId`，避免三套 id 互相猜”。当前仍是映射层在把官方 id 翻译回 UI id，未收敛为单一 id。

### 🟡 中等

3. **旧 SDK `@moonshot-ai/kimi-agent-sdk` 仍被 import、monkey-patch 并实际调用**（P7 未收口）
   - `electron/kimiBridge.ts:2-14` 导入 `createSession` / `ProtocolClient`；`646-729` 对 `ProtocolClient.prototype` 打补丁；`1106` 仍调用 `createSession(...)`。`electron/main.ts:22-23` 也导入其类型/`ContentPart`。
   - 虽被 `supportsKimiWireMode()`（`kimiBridge.ts:105-112`，永远返回 `false`）总闸门禁用，但依赖与代码未删除；且版本钉为 `"latest"`（不可复现，违反 AGENTS“新依赖须说明并可回滚”）。

4. **仍存在完整的并行 “prompt” 引擎链路**（与 §2 原则 4“事件只来自一个主源”、P7“删除旧主链路”有距离）
   - `src/types/ui.ts:48`：`engine?: "prompt" | "kimi-code"`；`electron/kimiBridge.ts` 保留整套 prompt-mode（`kimi -p`，`promptModeSessions`、`1200ms` thinking 轮询 `1237` 行附近、`563` 行“prompt-mode 尚未实时写出思考正文”等）。
   - 现状：`kimi-code` 为新建会话默认（确认通过），`prompt` 为遗留兜底。需明确其定位并在计划中登记是“长期兜底”还是“P7 待删”，否则属于未交代的第二套主源。

5. **kimi-code 路径 duration 仍可能显示 `0s`**（违反 §5 验收用例 2 的初衷）
   - `src/utils/kimiCodeEventMapper.ts` 不计算 `durationMs`；kimi-code 事件经 `enqueueStreamEvent` 批处理（`App.tsx:1535`），**不经过** `eventMapper.ts` 的 `mergeEvents`（duration 是在那里算的）。`turn.ended` 产出的 assistant 完成事件没有 duration 来源。
   - 需实测一轮长 thinking 确认是否回归 `0s`；若回归，应在 mapper 或 status 收尾处基于官方 `turn.started`/`turn.ended` 结算 duration。

### ⚪ 轻微

6. **Hook 事件未映射**（P2 列出的 `HookTriggered/HookResolved -> hook 提示`）：`kimiCodeEventMapper.ts` 无 hook 分支。若官方 SDK 会发 hook 事件，则当前会被静默丢弃。

7. **`getSessionHistory` 未作为显式接口实现**（P1 接口清单列出）：当前历史依赖事件流回放，无独立历史 API；resume 后历史回放路径需确认。

8. **TASK_STATE 自报 P7 完成，与第 1/2/3 条现状不一致**：建议把上述偏差回填到 `TASK_STATE.md`，避免下个窗口误以为已全部收口。

## 建议下一步（最小增量，按严重度）

- [x] ~~第 1 条：vendoring~~ **已完成（2026-06-02）**，并按 1c **已重跑 P0 探针对齐 CLI `0.7.0`**（兼容性通过）。
- [ ] **第 3 条「清旧」分阶段迁移（已确认顺序：先 vendoring 后清旧）**：旧 `kimiBridge`（prompt 备用引擎 + 旧 `@moonshot-ai/kimi-agent-sdk`）经实测仍是**承重墙**——给含新引擎在内的所有会话承担 **列会话 / 重开会话 / 加载历史 / 长任务(executor+reviewer) / Hook 规则生成**。退役需先把这些迁到新引擎，再删旧依赖与 prompt-mode，最后移除其 `extraResources`。属多步真迁移，非清理。
  - 待迁移消费点（实测 file:line）：UI 建会话 `App.tsx:651/809/1247/1438`、`AppShell.tsx:432`（仍走 `window.api.startSession`+`sendPrompt`）；后端 `main.ts:3086`(longTasks)、`main.ts:3569`(`runOneShotPrompt`)；历史 `kimi:loadSession`→`getSessionHistory`（读旧 `wire.jsonl`）。旧 SDK 真死码：`kimiBridge.ts` 的 `@moonshot-ai/kimi-agent-sdk` import / monkey-patch(646-750) / `supportsKimiWireMode()`(永远 false) / wire `createSession`(1106 不可达)；`kimi --wire` 在 CLI 0.7.0 已被移除。
- [ ] 第 2 条：用一次性迁移把 UI session id 收敛到官方 `sessionId`，删除 `runtimeSessionId`/`officialSessionId` 与三路匹配。
- [ ] 第 4/5 条：prompt-mode 定位随第 3 条一并清理；补一条长 thinking 实测确认 duration 不再 `0s`。

<!-- ===================== 审计结论结束 ===================== -->

# Kimix Kimi Code 新引擎迁移执行计划

> 目标读者：下一个接手窗口 / agent。
> 当前结论：继续把 hidden TUI 当主引擎已经不合适。新主线应以新版官方 Kimi Code 文档和官方仓库为真源，优先接入官方 SDK / Wire 通信面；TUI 只保留为调试与官方交互兜底。

## 0. 真源与当前事实

### 官方真源

- 新版文档：https://moonshotai.github.io/kimi-code/zh/
- 官方仓库：https://github.com/MoonshotAI/kimi-code
- 本机已下载官方源码用于只读研究：
  - `C:\Users\Administrator\AppData\Local\Temp\kimix-kimi-code-research`
  - 当前研究仓库提交：`42bb914 2026-06-01 feat(tui): add /provider command, custom registry import, and tabbed model selector (#264)`

### 官方源码中已确认的关键点

- 新版官方会话数据默认在 `$KIMI_CODE_HOME`，未设置时是 `~/.kimi-code`。
- 会话目录形如：
  - `$KIMI_CODE_HOME/sessions/<workDirKey>/<sessionId>/`
  - 主 Agent 事件流：`agents/main/wire.jsonl`
  - 子 Agent 事件流：`agents/agent-*/wire.jsonl`
- 官方 `packages/node-sdk` 暴露的目标能力包括：
  - `KimiHarness.createSession()`
  - `KimiHarness.resumeSession()`
  - `KimiHarness.forkSession()`
  - `KimiHarness.listSessions()`
  - `KimiHarness.renameSession()`
  - `KimiHarness.exportSession()`
  - `Session.prompt()`
  - `Session.steer()`
  - `Session.cancel()`
  - `Session.onEvent()`
  - `Session.setApprovalHandler()`
  - `Session.setQuestionHandler()`
  - `Session.setPlanMode()`
  - `Session.setPermission()`
  - `Session.getUsage()`
  - `Session.getStatus()`
  - `Session.listBackgroundTasks()`
  - `Session.listPlugins()`
  - `Session.installPlugin()`
  - `Session.setPluginEnabled()`
  - `Session.setPluginMcpServerEnabled()`
  - `Session.listMcpServers()`

### Kimix 当前仓库事实

- 当前版本：`v2.8.247`
- 当前依赖里已有旧 npm SDK：
  - `@moonshot-ai/kimi-agent-sdk@0.1.8`
  - 它导出 `createSession()`、`ProtocolClient`、`Turn.steer()`、`Turn.approve()`、`Turn.respondQuestion()` 等旧 SDK 接口。
- 官方新仓库的 `packages/node-sdk/package.json` 名称是：
  - `@moonshot-ai/kimi-code-sdk`
  - 版本 `0.4.0`
  - 目前在源码里标记 `private: true`，但有 `publishConfig`。实际是否可从 npm 安装必须在 P0 探针确认。
- 当前 Kimix 同时存在三套链路：
  - prompt-mode：`electron/kimiBridge.ts` 里用 `kimi -p --output-format stream-json`
  - 旧 SDK / ProtocolClient：`electron/kimiBridge.ts` 里仍有残留，但已被 `supportsKimiWireMode()` 总闸门禁用
  - hidden TUI：`electron/tuiHost.ts` + `src/App.tsx` + `Composer.tsx`

## 1. 为什么要换路线

hidden TUI 是人类界面，不是稳定机器协议。过去多轮修补已经反复出现同类结构问题：

- 一条用户消息被拆成多段。
- 同一对话被拆成多个 Kimix session。
- 引导消息已经写入 TUI，但队列仍保留。
- agent 回复与用户引导气泡顺序错位。
- 运行状态无法可靠结束，停止按钮残留。
- 思考 / 处理时长显示 `0s`。
- 发送后长时间没有消息头，结束后事件才成批出现。

这些问题的共同根因是：Kimix 在试图从 terminal screen、PTY idle、TUI 可见文本和旁路 wire 文件共同推断真实 agent 状态。任何一个时间点不同步，UI 就会错。

新路线的判断：

- 主交互不要套 TUI。
- 主交互应直接使用官方 SDK / Wire 层。
- `wire.jsonl` 是事件回放和持久化真源，但不建议 Kimix 自己发 raw wire，除非官方 SDK 无法覆盖。
- TUI Debug 面板可以保留，用于人工打开 `/plugins`、`/model` 等官方 TUI 页面和问题诊断。

## 2. 迁移原则

1. 每次只做一个可验证最小增量。
2. 不直接删除 hidden TUI；先新增新引擎并用开关灰度。
3. Kimix UI session id 最终必须等于官方 `sessionId`，避免 `uiSessionId`、`runtimeSessionId`、`officialSessionId` 三套 id 互相猜。
4. 事件只来自一个主源：SDK `Session.onEvent()` 或其内部 RPC event。不要再把 screen 文本合并进正式消息流。
5. 队列规则以官方 turn 状态为准：`prompt()` 开始后 running，官方 turn 完成后 flush 下一条；运行中补充用 `steer()`。
6. “引导成功”只代表 `steer()` 调用成功并被官方事件确认，不代表 agent 已经回复。
7. 如果同一思路连续失败两次，停止修补，回到 P0 探针重新确认官方行为。

## 3. 分阶段计划

### P0：官方新 SDK / Wire 探针

目标：不改正式 UI，先用可重复脚本确认当前机器上新版 Kimi Code 的真实可集成面。

新增建议文件：

- `scripts/probe-kimi-code-sdk.mjs`
- `docs/kimi-code-sdk-probe-result.md`

必须确认的问题：

1. 当前 CLI 版本：
   - `kimi --version`
   - `kimi --help`
   - `kimi --wire --help` 或最小 `--wire` 启动探针
2. 当前 npm 上是否可安装新 SDK：
   - `pnpm view @moonshot-ai/kimi-code-sdk version`
   - 如果不可安装，记录“暂不走 npm 新 SDK，改用官方源码包作为参考 / vendoring 评估”。
3. 旧 `@moonshot-ai/kimi-agent-sdk@0.1.8` 的 `ProtocolClient` 是否能和当前 `kimi --wire` 正常握手。
4. 官方源码 `packages/node-sdk` 是否能在本地构建或被 Kimix 以 workspace / file dependency 方式引用。
5. 最小交互闭环：
   - create/resume session
   - prompt
   - streaming event 到达时间
   - steer
   - cancel
   - approval
   - question
   - setPlanMode
   - setPermission
   - listSessions
   - getStatus/getUsage

建议探针命令：

```powershell
$env:Path = "C:\Program Files\nodejs;C:\Users\lijialin08\AppData\Roaming\npm;$env:Path"
cd "D:\WORKS\Android Project\kimix"
kimi --version
kimi --help
pnpm view @moonshot-ai/kimi-code-sdk version
pnpm view @moonshot-ai/kimi-agent-sdk version
node scripts/probe-kimi-code-sdk.mjs
```

P0 验收标准：

- 产出 `docs/kimi-code-sdk-probe-result.md`，里面必须写清：
  - 当前 CLI 版本。
  - 当前可用 SDK 包名与版本。
  - `prompt` 是否实时流式到达。
  - `steer` 是否不会创建新 session。
  - `sessionId` 与 `$KIMI_CODE_HOME/sessions/...` 目录是否一致。
  - 如果 SDK 不可用，下一步具体 fallback 是什么。

P0 禁止事项：

- 禁止一边探针一边重写 UI。
- 禁止继续修 hidden TUI 顺序 / idle / screen parser。
- 禁止凭旧文档或旧注释判断 `--wire` 是否可用，必须以当前 CLI 实测为准。

### P1：新增主进程 `KimiCodeHost`

目标：在 Electron 主进程中建立新引擎适配层，但先不替换 UI 默认行为。

建议新增文件：

- `electron/kimiCodeHost.ts`
- `electron/kimiCodeEventMapper.ts`
- `electron/kimiCodeHostProbe.ts` 或测试辅助

建议接口：

```ts
type KimiCodeEngineSession = {
  sessionId: string;
  workDir: string;
  status: "idle" | "running" | "waiting_approval" | "waiting_question" | "completed" | "interrupted" | "error";
};

createSession(options): Promise<KimiCodeEngineSession>
resumeSession(sessionId): Promise<KimiCodeEngineSession>
sendPrompt(sessionId, content, options): Promise<void>
steer(sessionId, content): Promise<void>
cancel(sessionId): Promise<void>
setPlanMode(sessionId, enabled): Promise<void>
setPermission(sessionId, mode): Promise<void>
approve(sessionId, requestId, response): Promise<void>
respondQuestion(sessionId, requestId, questionRequestId, answers): Promise<void>
listSessions(workDir?): Promise<SessionSummary[]>
getSessionHistory(sessionId): Promise<TimelineEvent[]>
closeSession(sessionId): Promise<void>
```

实现要求：

- 内部维护 `Map<sessionId, Session>`，key 必须是官方 session id。
- 所有运行态来自官方事件或 SDK status，不再依赖 PTY idle。
- 所有事件统一发给 renderer 的新 IPC，例如：
  - `kimi-code:event`
  - `kimi-code:status`
- 保留旧 IPC，不在 P1 删除。

P1 验收标准：

- 可以从主进程脚本或临时 IPC 创建官方 session，发送一条 prompt，实时收到事件。
- 可以在运行中调用 steer，队列项不需要经过 TUI。
- 可以 cancel 并看到状态结束。
- `pnpm build` 通过。

### P2：事件映射重做

目标：把官方 SDK / Wire event 映射到 Kimix 现有 timeline，但删除 TUI screen parser 对正式消息的影响。

关键现有文件：

- `src/utils/eventMapper.ts`
- `src/utils/tuiSemanticReducer.ts`
- `src/utils/__tests__/eventMapper.test.ts`
- `src/App.tsx`

建议新增：

- `src/utils/kimiCodeEventMapper.ts`
- `src/utils/__tests__/kimiCodeEventMapper.test.ts`

映射规则：

- `TurnBegin` -> `user_message`
- `ContentPart(text)` -> assistant 正文增量
- `ContentPart(think)` -> `thinkingParts`
- `StepBegin/StepEnd` -> 思考 / 工具过程条
- `ToolCall/ToolCallPart/ToolResult` -> 工具调用卡
- `ApprovalRequest` -> 审批卡
- `QuestionRequest` -> 澄清问题卡
- `SteerInput` -> `steer_message`，并作为新用户补充，不切错上一轮 assistant
- `StatusUpdate` -> token/context/status 条，必须等本轮 settled 后再显示
- `TurnEnd/TurnResult` -> 完成本轮，结算 duration
- `Error` -> 错误卡
- `HookTriggered/HookResolved` -> hook 提示

明确废弃：

- 不从 `screen.answerText` 写正式 assistant 正文。
- 不从 TUI 可见行推断 `isInputIdle` 来完成 turn。
- 不用 1.5s timer 强制 finish 作为主逻辑。

P2 验收标准：

- 新 mapper 单测覆盖：
  - 普通一轮 prompt。
  - 长时间 thinking 后再输出。
  - steer 运行中插入。
  - steer 后队列移除但 UI 不提前显示 agent 回复。
  - question request。
  - approval request。
  - cancel。
  - error。
- `pnpm test:run -- src/utils/__tests__/kimiCodeEventMapper.test.ts src/utils/__tests__/eventMapper.test.ts`
- `pnpm build`

### P3：renderer 灰度接入新引擎

目标：新增 `engine: "kimi-code"`，先通过设置或环境变量开关启用，不删除 `engine: "tui"`。

关键现有文件：

- `src/types/ui.ts`
- `src/App.tsx`
- `src/components/chat/Composer.tsx`
- `src/components/chat/ApprovalCard.tsx`
- `src/components/chat/QuestionCard.tsx`
- `electron/preload.ts`
- `electron/main.ts`
- `electron/types/ipc.ts`

建议开关：

- 设置项：`engineMode: "kimi-code" | "tui" | "prompt"`
- 环境变量兜底：`KIMIX_ENGINE=kimi-code`

交互要求：

- 新会话默认走 `kimi-code`，旧 TUI 可在 TUI 调试页手动启动。
- 对话头、停止按钮、输入区运行态全部根据 `kimi-code` status。
- session 列表以官方 session id 为准。
- 侧栏不再因为 runtime id 变化生成新会话。

P3 验收标准：

- 新建对话，发一条消息，侧栏只出现一个会话。
- 运行中输入第二条普通消息，只进入 Kimix 队列，不直接 prompt。
- 运行中点击队列“引导”，调用 `steer()`，队列立即移除。
- agent 后续事件顺序正确：上一轮 agent 内容在对应用户消息下方，steer 气泡只在官方确认后进入合理位置。
- 完成后停止按钮消失。

### P4：队列与引导重写

目标：彻底移除 hidden TUI 下积累的队列猜测逻辑。

当前问题对应规则：

- 队列项点击“引导”后，一旦 `steer()` 调用成功，立刻从 pending queue 移除。
- UI 状态显示为“已发送引导请求”或“已引导对话”，不能继续显示“正在引导”。
- agent 的实际回复只能由后续官方 assistant event 决定，不能在 steer 成功时提前创建 assistant 正文。
- 普通 pending 消息只能在当前 turn 完成后 `prompt()` 发送。

关键现有文件：

- `src/components/chat/Composer.tsx`
- `src/App.tsx`
- `src/store/*`
- `src/utils/eventMapper.ts`

P4 验收标准：

- 运行中排队 1 条，点击引导，队列马上变 0。
- 如果 `steer()` 失败，队列项恢复并标失败 toast。
- 引导成功后，用户引导气泡下方出现的是后续 agent 事件，不提前宣称 agent 已回复。
- 不再出现“已经引导出去但队列还挂着”。

### P5：审批 / 提问 / 权限 / Plan 闭环

目标：把当前 TUI 的审批和问题回答改接 SDK handler。

必须覆盖：

- tool approval：
  - 一次批准
  - 本会话批准
  - 拒绝
- question：
  - 文本回答
  - 多字段回答
- permission：
  - manual
  - auto
  - yolo
- plan mode：
  - 开
  - 关
  - 拒绝 plan review 后继续可用

P5 验收标准：

- 触发文件写入审批，可以在 Kimix 审批卡处理，agent 收到结果继续。
- 触发需求澄清，可以在 Kimix 问题卡回答，agent 收到完整回答。
- 权限模式切换不需要向 TUI 输入 slash command。
- Plan 按钮不需要 `/plan` 文本输入。

### P6：官方能力 GUI 化迁移

目标：把已依赖 TUI 菜单的能力逐步转 SDK API。

优先级：

1. sessions：list/resume/fork/rename/export。
2. model/provider：getConfig/setConfig/setModel/setThinking。
3. plugins：list/install/enable/disable/MCP server enable。
4. MCP：list/reconnect/startup metrics。
5. usage/status/background tasks。
6. slash command 入口仅作为“发送命令文本”的兼容功能，不作为主控制 API。

P6 验收标准：

- 插件页不再必须打开 `/plugins` TUI 菜单才能刷新状态。
- 模型选择不再必须打开 `/model` TUI 菜单。
- 会话导出走官方 export API。

### P7：收口与删除旧主链路

目标：在新引擎稳定后，删除或隔离 hidden TUI 主路径。

保留：

- TUI Debug Panel。
- 手动启动官方 TUI 进行诊断的入口。

删除 / 降级：

- 正式消息页从 screen parser 合并正文。
- `scheduleTuiIdleCompletion` 主逻辑。
- 用 `runtimeSessionId` 猜官方 session 的代码。
- TUI 队列 flush 兜底。

P7 验收标准：

- 新引擎连续 10 轮普通发送 / 队列 / 引导 / 审批 / question 不裂 session。
- 不再出现本计划开头列出的 hidden TUI 回归。
- 所有旧 TUI 逻辑都有明确保留理由或删除记录。

## 4. 建议第一轮最小行动

新窗口第一轮只做 P0，不碰 UI。

具体步骤：

1. 看规则和状态：

```powershell
cd "D:\WORKS\Android Project\kimix"
Get-Content -Raw AGENTS.md
Get-Content -Raw README.md
Get-Content -Raw KIMI_CODE_SDK_MIGRATION_PLAN.md
git status --short
```

2. 确认官方源码和文档：

```powershell
$repo = Join-Path $env:TEMP "kimix-kimi-code-research"
if (!(Test-Path $repo)) {
  git clone https://github.com/MoonshotAI/kimi-code.git $repo
}
git -C $repo status --short
git -C $repo log -1 --pretty=format:"%h %ci %s"
Get-Content -Raw "$repo\packages\node-sdk\src\session.ts"
Get-Content -Raw "$repo\packages\node-sdk\src\kimi-harness.ts"
Get-Content -Raw "$repo\docs\zh\configuration\data-locations.md"
Get-Content -Raw "$repo\docs\zh\guides\sessions.md"
Get-Content -Raw "$repo\docs\zh\reference\kimi-command.md"
```

3. 写探针脚本，先只输出 JSON，不改 app：

```powershell
$env:Path = "C:\Program Files\nodejs;C:\Users\lijialin08\AppData\Roaming\npm;$env:Path"
cd "D:\WORKS\Android Project\kimix"
kimi --version
pnpm view @moonshot-ai/kimi-code-sdk version
pnpm view @moonshot-ai/kimi-agent-sdk version
```

4. 运行探针并记录：

```powershell
node scripts/probe-kimi-code-sdk.mjs
```

5. 写入结果：

```text
docs/kimi-code-sdk-probe-result.md
```

第一轮完成标准：

- 有探针脚本。
- 有探针结果文档。
- 能明确回答“Kimix 下一步到底接哪个包 / 哪个 API / 哪个事件源”。
- 如果失败，失败原因必须是具体命令和具体错误，不是推测。

## 5. 验收用例清单

后续每个阶段至少覆盖这些真实用例：

1. 普通单轮：发送“你好”，立刻出现消息头，流式输出，完成后停止按钮消失。
2. 长 thinking：思考 20 秒以上，duration 不显示 0s，过程中消息头持续更新。
3. 连续普通发送：运行中发第二条，进入队列，当前 turn 完成后自动 prompt。
4. 运行中引导：运行中队列点“引导”，队列立即移除，agent 收到完整 steer，不裂 session。
5. 多行输入：一条多行消息不会被拆成多个会话或多个用户消息。
6. 审批：写文件触发审批，Kimix 卡片批准后 agent 继续。
7. 需求澄清：agent 提问，用户回答后 agent 收到完整回答。
8. cancel：运行中点停止，turn 结束，输入区恢复，下一条可正常发。
9. resume：关闭重开 Kimix 后，恢复同一官方 session，不新建侧栏条目。
10. export/debug：导出会话能定位到官方 session 数据。

## 6. 回滚策略

- 新增 `engine: "kimi-code"` 期间，保留 `engine: "tui"` 和 prompt-mode。
- 如果新 SDK 探针失败，不回滚已有 TUI 修补，只停止扩大 TUI 修改。
- 每个阶段只 stage 本阶段文件。
- 不删除旧 `electron/tuiHost.ts`，直到 P7 验收通过。
- 新依赖若引入失败，回滚 `package.json` 和 lockfile；优先使用当前依赖或官方源码只读参考。

## 7. 当前未提交改动提醒

当前工作区已有多轮 TUI 修补的未提交改动，新窗口不要直接 `git add .`：

```text
TASK_STATE.md
electron/tuiHost.ts
package.json
src/App.tsx
src/components/chat/Composer.tsx
src/components/chat/MessageBubble.tsx
src/components/layout/Sidebar.tsx
src/components/settings/SettingsPanel.tsx
src/utils/__tests__/eventMapper.test.ts
src/utils/eventMapper.ts
```

处理建议：

- P0 只新增探针脚本和探针结果文档。
- 不碰上述 TUI 修补文件，除非明确需要更新 `TASK_STATE.md`。
- 提交前用 `git diff -- <file>` 精确确认。

## 8. 给下个窗口的交接提示词

```text
你好霖江路。请接手 Kimix 的 Kimi Code 新引擎迁移。先阅读 D:\WORKS\Android Project\kimix\AGENTS.md、README.md、TASK_STATE.md 和 KIMI_CODE_SDK_MIGRATION_PLAN.md。

当前结论：hidden TUI 主链路已经反复出现消息切分、session 裂开、引导顺序错、队列不移除、运行态不结束和 duration 0s 等结构问题。不要继续优先修 TUI。新版真源是 https://moonshotai.github.io/kimi-code/zh/ 和 https://github.com/MoonshotAI/kimi-code。

下一步最小行动只做 P0：新增脚本验证当前机器上的官方 Kimi Code CLI、新/旧 SDK、--wire、prompt、steer、cancel、approval、question、sessionId 和 wire.jsonl 路径。不要改正式 UI。探针结果写到 docs/kimi-code-sdk-probe-result.md，必须能明确回答 Kimix 下一步到底接哪个包、哪个 API、哪个事件源。

注意：仓库已有多轮 TUI 修补未提交，不要 git add .。每次实际改动后按用户要求重启实例；构建前 PowerShell 先设置 PATH：
$env:Path = "C:\Program Files\nodejs;C:\Users\lijialin08\AppData\Roaming\npm;$env:Path"
```

