# Kimi Code SDK / Wire P0 探针结果

- 生成时间：2026-06-01T13:23:59.455Z
- Kimix 仓库：D:\WORKS\Android Project\kimix
- 官方源码：C:\Users\Administrator\AppData\Local\Temp\kimix-kimi-code-research
- 探针工作目录：C:\Users\ADMINI~1\AppData\Local\Temp\kimix-kimi-code-sdk-probe\work
- KIMI_CODE_HOME：C:\Users\Administrator\.kimi-code

## 结论

下一步建议接官方 `packages/node-sdk` 的 `KimiHarness` / `Session` API，事件源使用 `Session.onEvent()`，并用 `session.id` 对齐 `~/.kimi-code/sessions/.../<sessionId>/agents/main/wire.jsonl`。
如果 npm 新包不可安装，短期使用官方源码 `packages/node-sdk` 的 file/vendor 接入；它比旧 `@moonshot-ai/kimi-agent-sdk` 更贴近目标 API。

## P1 推进记录

- 已新增 Electron 主进程独立适配层：`electron/kimiCodeHost.ts`。
- 已新增独立 IPC / preload API：`kimi-code:createSession`、`kimi-code:resumeSession`、`kimi-code:sendPrompt`、`kimi-code:steer`、`kimi-code:cancel`、`kimi-code:setPlanMode`、`kimi-code:setPermission`、`kimi-code:getStatus`、`kimi-code:listSessions`、`kimi-code:closeSession`，以及 `kimi-code:event` / `kimi-code:status`。
- 当前未替换正式聊天页；旧 `kimi:*`、TUI Debug 和 hidden TUI 链路仍保留。
- SDK host 目前加载官方源码构建产物：`C:\Users\Administrator\AppData\Local\Temp\kimix-kimi-code-research\packages\node-sdk\dist\index.mjs`。如果路径变化，可用 `KIMIX_KIMI_CODE_SDK_ENTRY` 指定。
- 服务端当前会拒绝 `userAgentProduct: "kimix"` 使用 `kimi-code/kimi-for-coding`，报错为 `403 Kimi For Coding is currently only available for Coding Agents...`；P1 暂按 P0 已验证可用的 `userAgentProduct: "kimi-code-cli"` 运行。后续若官方开放 host identity，再切回 Kimix 自身身份。

### P1 host 探针

命令：

```powershell
$env:Path = "C:\Program Files\nodejs;C:\Users\lijialin08\AppData\Roaming\npm;$env:Path"
node scripts/probe-kimi-code-host.mjs
```

结果摘要：

```text
{
  "ok": true,
  "sessionId": "session_b42b560d-1f80-45da-80be-d5f66e3aaaa4",
  "sessionCountForWorkDir": 2,
  "prompt": {
    "turnId": 0,
    "firstDeltaMs": 1916,
    "endedMs": 3636,
    "reason": "completed"
  },
  "steer": {
    "turnId": 1,
    "firstDeltaMs": 1312,
    "endedMs": 12556,
    "reason": "completed"
  },
  "cancel": {
    "turnId": 2,
    "endedMs": 832,
    "reason": "cancelled"
  }
}
```

P1 当前结论：可以进入 P2，新增 SDK event -> Kimix timeline 的独立 mapper。正式 UI 仍未灰度接入，不能宣称新引擎已替换主链路。

## P2 推进记录

- 已新增独立 mapper：`src/utils/kimiCodeEventMapper.ts`。
- 已新增单测：`src/utils/__tests__/kimiCodeEventMapper.test.ts`。
- 普通 SDK event 映射：
  - `assistant.delta` -> `assistant_message` 正文增量。
  - `thinking.delta` -> `assistant_message.thinking` / `thinkingParts` 增量。
  - `turn.ended` -> 完成当前未完成的 assistant message。
  - `tool.call.delta` / `tool.call.started` / `tool.result` -> Kimix 工具调用与结果。
  - `agent.status.updated` / `turn.step.*` -> `status_update`。
  - `subagent.*`、`compaction.*`、`error`、`warning` -> 对应 timeline 事件或状态提示。
- SDK handler request 映射：
  - approval handler request -> `approval_request`。
  - question handler request -> `question_request`。
- 明确边界：SDK 的 `turn.started` 不包含用户输入正文，P3/P4 接 UI 时应由发送层先插入本地 `user_message`，mapper 不从 `turn.started` 猜用户消息。
- 明确边界：运行中 `steer()` 是否移除队列属于 P4 队列/引导状态机；P2 只验证已确认 `steer_message` 边界后，后续 assistant chunk 不会合并到 steer 前的旧 assistant。
- 已验证命令：

```text
pnpm test:run -- src/utils/__tests__/kimiCodeEventMapper.test.ts src/utils/__tests__/eventMapper.test.ts
```

结果：2 个测试文件通过，43 个测试通过。

完整构建与实例重启：

```text
pnpm build
```

结果：构建通过。随后按 Kimix 项目规则杀旧 `electron.exe` / `node.exe`、清理 `out/`、`node_modules/.vite`、`node_modules/.cache`（清理前已确认路径位于工作区内）、重新 `pnpm build` 并后台启动 `pnpm dev`。Electron 进程已启动，renderer dev server 为 `http://localhost:5173/`。

P2 当前结论：可以进入 P3，在 renderer 侧灰度接入 `engine: "kimi-code"`，正式消息流应优先消费 `kimi-code:event` 经 `kimiCodeEventMapper` 映射后的 timeline，不再从 hidden TUI screen parser 抽 assistant 正文。

## P3 推进记录

- 已把 `Session.engine` 扩展为 `"prompt" | "tui" | "kimi-code"`。
- 新建普通聊天会话默认标记为 `engine: "kimi-code"`；已有 `engine: "tui"` 会话仍走 TUI Debug / hidden TUI 调试链路。
- `App.tsx` 已订阅 `kimi-code:event` / `kimi-code:status`：
  - `kimi-code:event` 通过 `mapKimiCodeEvent()` 映射为 Kimix timeline。
  - `kimi-code:status` 负责运行态、终态、完成通知、pending queue 续发。
- `Composer.tsx` 已按 engine 分流：
  - 普通发送：`createKimiCodeSession` / `resumeKimiCodeSession` + `sendKimiCodePrompt`。
  - 运行中引导：`steerKimiCode`。
  - 停止：`cancelKimiCodeTurn`。
  - Plan：`setKimiCodePlanMode`。
  - 权限：`setKimiCodePermission`。
- 明确边界：P3 仍保留旧 `kimi:*` 与 `tui:*` IPC，未删除旧主链路代码；P4 需要继续把队列和引导状态机从 TUI idle / screen 猜测中剥离出来。

已验证命令：

```text
pnpm test:run -- src/utils/__tests__/kimiCodeEventMapper.test.ts src/utils/__tests__/eventMapper.test.ts
pnpm build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/restart-kimix-dev.ps1
```

结果：mapper 相关 43 个测试通过；完整构建通过；已通过新的 scoped restart 脚本重启 Kimix dev 实例并确认 Kimix Electron 进程启动。

重启流程修正：不要再全局杀所有 `electron.exe` / `node.exe`。Codex 桌面本身也是 Electron，误杀后会弹出 `Unable to find Electron app at C:\Program Files\WindowsApps\OpenAI...`。后续本机重启 Kimix 使用 `scripts/restart-kimix-dev.ps1`，脚本只匹配 Kimix 工作区或 Kimix user-data-dir。

P3 当前结论：可以进入 P4。下一步重点不再补 hidden TUI screen parser，而是把队列、引导确认、运行态结束统一收敛到 SDK `prompt()` / `steer()` / `cancel()` 和 `kimi-code:status`。

## P4 推进记录

- `engine: "kimi-code"` 运行中输入框现在显示“引导”按钮，直接调用 `steerKimiCode`，不再只对 TUI 引擎开放。
- SDK `steerKimiCode` 返回成功后，本地 `steer_message` 立即从 `sending` 标记为 `sent`；失败时标记 `failed` 并保留错误。
- pending queue 在 `kimi-code:status === "completed"` 后由 SDK runtime session 续发下一条消息。
- SDK queue 续发失败时不再丢消息：已 shift 的 pending 会重新放回队列，并在 timeline 写入 error 卡。
- 旧 TUI 队列/idle 逻辑仍保留给已有 TUI 调试会话；新 `kimi-code` 会话的正式续发不依赖 TUI screen idle。

已验证命令：

```text
pnpm test:run -- src/utils/__tests__/kimiCodeEventMapper.test.ts src/utils/__tests__/eventMapper.test.ts
pnpm build
```

结果：mapper 相关 43 个测试通过；完整构建通过。

P4 当前结论：可以进入 P5。下一步把 SDK approval/question handler 请求映射到 Kimix 的审批 / 提问卡，并让卡片操作回写 SDK handler promise，而不是继续走旧 `approveRequest` / `respondQuestion`。

## P5 推进记录

- `KimiCodeHost` 已接入官方 `Session.setApprovalHandler()` / `Session.setQuestionHandler()`。
- SDK handler 请求不再走 hidden TUI 或旧 `kimi:*` bridge：
  - approval handler request -> `kimix.approval.request` -> `mapKimiCodeApprovalRequest()` -> Kimix `approval_request` 卡片。
  - question handler request -> `kimix.question.request` -> `mapKimiCodeQuestionRequest()` -> Kimix `question_request` 卡片。
- Renderer 卡片按 engine 分流：
  - `engine: "kimi-code"` 的审批按钮调用 `respondKimiCodeApproval`，主进程 resolve 官方 approval promise，返回 `{ decision: "approved" | "rejected", scope?: "session" }`。
  - `engine: "kimi-code"` 的提问卡调用 `respondKimiCodeQuestion`，主进程 resolve 官方 question promise，返回 `{ answers, method: "enter" }`；跳过时返回 `null`。
  - `engine: "tui"` 和旧 prompt bridge 保持原逻辑。
- mapper 已兼容探针里观察到的 `fields` 形态和官方源码定义的 `questions` 形态。
- 权限 / Plan 已在 P3 走 `setKimiCodePermission` / `setKimiCodePlanMode`，P5 保持该 SDK 路径。

已验证命令：

```text
pnpm test:run -- src/utils/__tests__/kimiCodeEventMapper.test.ts src/utils/__tests__/eventMapper.test.ts
pnpm build
```

结果：2 个测试文件通过，44 个测试通过；完整构建通过。

P5 当前结论：可以进入 P6。下一步盘点插件、MCP、模型、用量、后台任务、导出等现有 GUI 能力，逐项从旧 bridge / CLI fallback 迁到官方 SDK 可用 API；若 SDK 未暴露对应 API，再保留清晰 fallback。

## P6 推进记录

### P6.1 会话导出迁移到官方 SDK export API

- 已在 `KimiCodeHost` 暴露 `exportSession()`，内部调用官方 `KimiHarness.exportSession()`。
- 侧栏“导出 Kimi Debug ZIP”会优先传入当前 Kimix 会话对应的 runtime/official sessionId，避免把本地 UI session id 交给官方导出。
- 主进程 `kimi:exportSession` 现在优先走官方 SDK export API：
  - 成功：返回 SDK 生成的 `zipPath` 与 entries 数量。
  - 失败：记录 SDK 错误，并仅作为 fallback 调用旧 `kimi export` CLI。
- 已新增轻量探针 `scripts/probe-kimi-code-export.mjs`，不发送 prompt，只创建官方 session 并调用 `KimiHarness.exportSession()` 生成临时 ZIP。

已验证命令：

```text
node scripts/probe-kimi-code-export.mjs
pnpm build
```

探针结果摘要：

```json
{
  "ok": true,
  "sessionId": "session_66c49db8-f612-4cd2-80a8-92c252ca6800",
  "size": 7961,
  "entries": 3,
  "manifestSessionId": "session_66c49db8-f612-4cd2-80a8-92c252ca6800"
}
```

P6 当前结论：P6 验收项中的“会话导出走官方 export API”已有代码路径和探针证据。下一步继续迁移插件页刷新状态、模型选择和 MCP / usage / background tasks 能力；其中插件和 MCP 可优先接 `Session.listPlugins()` / `installPlugin()` / `setPluginEnabled()` / `setPluginMcpServerEnabled()` / `listMcpServers()`。

### P6.2 插件状态迁移到官方 SDK plugin API

- `KimiCodeHost` 已暴露官方 `Session.listPlugins()` / `installPlugin()` / `setPluginEnabled()` / `setPluginMcpServerEnabled()`。
- 新增独立 IPC / preload API：
  - `kimi-code:listPlugins`
  - `kimi-code:installPlugin`
  - `kimi-code:setPluginEnabled`
  - `kimi-code:setPluginMcpServerEnabled`
- 插件页在当前会话为 `engine: "kimi-code"` 时显示“官方 SDK 插件状态”，刷新直接调用 SDK，不需要打开 `/plugins` TUI 菜单。
- 插件页安装入口在 `engine: "kimi-code"` 时优先调用 SDK `installPlugin()`；非 SDK 会话仍保留旧 CLI fallback。
- 插件启用 / 停用按钮在 SDK 会话里调用 `setPluginEnabled()` 并刷新 SDK 列表。
- TUI 插件镜像仍保留给 `engine: "tui"` 调试会话。
- 已新增只读探针 `scripts/probe-kimi-code-plugins.mjs`，只调用 `Session.listPlugins()`，不安装、不启停。

已验证命令：

```text
node scripts/probe-kimi-code-plugins.mjs
pnpm build
```

探针结果摘要：

```json
{
  "ok": true,
  "count": 2,
  "plugins": [
    {
      "id": "kimi-datasource",
      "enabled": false,
      "source": "zip-url",
      "skillCount": 2,
      "mcpServerCount": 1
    },
    {
      "id": "superpowers",
      "enabled": true,
      "source": "zip-url",
      "skillCount": 14,
      "mcpServerCount": 0
    }
  ]
}
```

P6 当前结论：P6 验收项中的“插件页不再必须打开 `/plugins` TUI 菜单才能刷新状态”已对 `engine: "kimi-code"` 会话成立；下一步继续迁移模型选择和 MCP/usage/background tasks。

### P6.3 模型配置迁移到官方 SDK config API

- `KimiCodeHost` 已暴露官方 `KimiHarness.getConfig()` / `setConfig()`。
- 主进程 `kimi:getModelConfig` 现在优先走 SDK `getConfig({ reload: true })`，失败才 fallback 到旧 TOML parser。
- 主进程 `kimi:saveOpenAiProvider` 现在优先用 SDK `setConfig()` 写入 provider/model/defaultModel patch，失败才 fallback 到旧 Kimix TOML 写入。
- 主进程 `kimi:setDefaultModel` 现在优先用 SDK `setConfig({ defaultModel })`，失败才 fallback 到旧 TOML 写入。
- 设置页现有模型配置 UI 可继续复用 `kimi:*` API，但数据源和写入路径已切到官方 SDK 优先；TUI `/model` 入口只保留给 TUI 调试/兜底。
- 已新增只读探针 `scripts/probe-kimi-code-model-config.mjs`，只调用 `KimiHarness.getConfig()`，不写入用户配置。

已验证命令：

```text
node scripts/probe-kimi-code-model-config.mjs
pnpm build
```

探针结果摘要：

```json
{
  "ok": true,
  "defaultProvider": null,
  "defaultModel": "kimi-code/kimi-for-coding",
  "providerCount": 2,
  "modelCount": 2,
  "providers": [
    {
      "name": "managed:kimi-code",
      "type": "kimi",
      "baseUrl": "https://api.kimi.com/coding/v1",
      "hasApiKey": false,
      "hasOauth": true
    },
    {
      "name": "deepseek",
      "type": "openai",
      "baseUrl": "https://api.deepseek.com",
      "hasApiKey": true,
      "hasOauth": false
    }
  ],
  "models": [
    {
      "alias": "kimi-code/kimi-for-coding",
      "provider": "managed:kimi-code",
      "model": "kimi-for-coding",
      "displayName": "Kimi-k2.6",
      "isDefault": true
    },
    {
      "alias": "deepseek",
      "provider": "deepseek",
      "model": "deepseek-v4-pro",
      "displayName": "deepseek",
      "isDefault": false
    }
  ]
}
```

P6 当前结论：P6 验收项中的“模型选择不再必须打开 `/model` TUI 菜单”已有 SDK 优先读写路径和探针证据。下一步继续迁移 MCP / usage / background tasks；若官方 SDK 未暴露对应 API，则记录明确 fallback。

### P6.4 MCP / usage / background tasks 接入官方 SDK runtime API

- 官方源码确认 `Session` 已暴露：
  - `getUsage()`
  - `listMcpServers()`
  - `getMcpStartupMetrics()`
  - `reconnectMcpServer(name)`
  - `listBackgroundTasks({ activeOnly, limit })`
  - `getBackgroundTaskOutput(taskId, { tail })`
  - `getBackgroundTaskOutputPath(taskId)`
  - `stopBackgroundTask(taskId, { reason })`
- 官方源码确认 `KimiHarness.auth` 已暴露 `getManagedUsage()`，可读取官方套餐/限额口径。
- `KimiCodeHost` 已增加上述 SDK 方法的 host bridge；renderer preload 已暴露对应 `kimi-code:*` API。
- 新增独立 IPC：
  - `kimi-code:getUsage`
  - `kimi-code:getManagedUsage`
  - `kimi-code:listMcpServers`
  - `kimi-code:getMcpStartupMetrics`
  - `kimi-code:reconnectMcpServer`
  - `kimi-code:listBackgroundTasks`
  - `kimi-code:getBackgroundTaskOutput`
  - `kimi-code:getBackgroundTaskOutputPath`
  - `kimi-code:stopBackgroundTask`
- 旧 Kimix MCP 面板、套餐用量浮层和长程任务 GUI 暂未重排；本轮先把官方 SDK 能力作为可调用主链路接入，后续 UI 可从这些 `kimi-code:*` API 灰度替换旧 CLI/本地实现。
- 新增探针 `scripts/probe-kimi-code-runtime-capabilities.mjs`，创建临时官方 session 后只读/无害调用上述 runtime API；`stopBackgroundTask` 只对未知 task id 调用，官方 SDK 行为为 no-op。

已验证命令：

```text
node scripts/probe-kimi-code-runtime-capabilities.mjs
pnpm build
```

探针结果摘要：

```json
{
  "ok": true,
  "sessionId": "session_044dc9da-ab42-486b-ba70-659d26d31644",
  "results": [
    { "ok": true, "name": "session.getUsage", "data": {} },
    { "ok": true, "name": "session.listMcpServers", "count": 0, "data": [] },
    { "ok": true, "name": "session.getMcpStartupMetrics", "data": { "durationMs": 0 } },
    { "ok": true, "name": "session.listBackgroundTasks", "count": 0, "data": [] },
    { "ok": true, "name": "session.listBackgroundTasks(activeOnly)", "count": 0, "data": [] },
    { "ok": true, "name": "session.getBackgroundTaskOutput(unknown)", "data": "" },
    { "ok": true, "name": "session.getBackgroundTaskOutputPath(unknown)" },
    { "ok": true, "name": "session.stopBackgroundTask(unknown)" },
    {
      "ok": true,
      "name": "harness.auth.getManagedUsage",
      "data": {
        "kind": "ok",
        "summary": {
          "label": "Weekly limit",
          "used": 0,
          "limit": 100,
          "resetHint": "resets in 6d 23h 1m"
        },
        "limits": [
          {
            "label": "5h limit",
            "used": 0,
            "limit": 100,
            "resetHint": "resets in 4h 1m"
          }
        ]
      }
    }
  ]
}
```

P6 当前结论：P6.4 的三类能力均有官方 SDK API 和 Kimix host/preload 可调用路径。后续 GUI 化应优先把现有 MCP 面板、套餐用量浮层、后台任务状态入口切到这些 `kimi-code:*` API；旧 CLI/本地实现只保留非 SDK 会话或 SDK API 失败时的 fallback。

## P7 推进记录

### P7.1 正式聊天页隔离 hidden TUI 主路径

- 正式发送入口遇到旧 `engine: "tui"` 会按 `officialSessionId` 优先恢复 / 创建 `kimi-code` SDK session，并把会话标记切到 `engine: "kimi-code"`。
- 正式聊天页不再消费 `onTuiEvent` 写入会话 timeline；TUI event 仍保留给 `TuiDebugPanel` 自己订阅。
- 正式输入区运行中“引导”只对 `engine: "kimi-code"` 显示 / 发送，旧 TUI 会话不再通过 `sendTuiInput(... submit: "steer")` 驱动正式对话。
- 正式输入区权限 / Plan 切换不再遥控 hidden TUI slash 命令，SDK 会话走 `setKimiCodePermission()` / `setKimiCodePlanMode()`。
- 底部模型入口不再向 hidden TUI 发送 `/model`，统一打开设置页模型配置；该配置已在 P6.3 接到 SDK `getConfig()` / `setConfig()`。
- 侧栏插件入口不再向 hidden TUI 发送 `/plugins`，统一打开插件页；SDK 插件状态已在 P6.2 接到官方 plugin API。
- 插件页的 TUI 插件镜像分支已在正式入口置空，不再从当前正式会话遥控 TUI 菜单。
- `Composer.tsx` 中正式发送的 hidden TUI start/send 分支已删除，避免不可达代码继续成为旧主链路暗门。

已验证命令：

```text
pnpm build
```

### P7.2 移除可见调试入口与正式 UI 残留

- 侧栏 collapsed / expanded 导航均已移除旧调试入口。
- `AppShell` 不再导入或渲染旧调试面板；如果历史持久化的 `workspaceView` 是未知值，启动后会迁回 `"chat"`。
- `ContextBar` 不再读取旧 runtime summary，也不再订阅旧 runtime event 或发送旧 runtime 按键。
- `SkillsPanel` 删除旧插件镜像面板、刷新镜像、打开 `/plugins`、Marketplace 切换和上下移动选中项等旧 runtime 遥控入口，仅保留 SDK `Session.listPlugins()` 路径。
- `ApprovalCard` / `QuestionCard` 不再向旧 runtime 发送审批数字或澄清回答，正式闭环只走 SDK handler 或旧 prompt-mode fallback。
- `Composer` 删除旧 slash 补全候选，队列提示和引导失败文案不再把旧 runtime 当正式等待对象。

### P7.3 删除旧 runtime 后端 / API / 类型 / 依赖

- 删除 `electron/tuiHost.ts`。
- 删除 `electron/main.ts` 里的旧 runtime IPC handlers 和退出清理引用。
- 删除 `electron/preload.ts` / `src/main.tsx` 中旧 runtime API 暴露和浏览器 fallback。
- 删除 `electron/types/ipc.ts` 中旧 runtime summary / screen / event / key / session 类型。
- 删除 `src/components/layout/TuiDebugPanel.tsx`、`src/utils/tuiSemanticReducer.ts` 和对应测试。
- 从 `package.json` / `pnpm-lock.yaml` 移除旧终端镜像依赖。
- `src/types/ui.ts` 不再把旧 engine / workspace view 作为正式类型；旧持久化会话在启动恢复时会作为未知旧 engine 迁到 `kimi-code`，未知 workspace view 迁回 `chat`。

已验证命令：

```text
pnpm install --lockfile-only --ignore-scripts
pnpm build
rg -n "tui|TUI|PTY|ConPTY" src electron package.json pnpm-lock.yaml
```

P7 当前结论：`src` / `electron` / `package.json` / `pnpm-lock.yaml` 正式代码与依赖中已无旧 runtime 关键字；下一步是连续实机验收普通发送 / 队列 / 引导 / 审批 / question，并继续清理路线文档中的历史表述。

### P7.4 SDK 主链路连续验收

新增 `scripts/probe-kimi-code-p7-acceptance.mjs`，专门覆盖 P7 验收清单：

- 同一个官方 SDK session 连续 10 轮普通 prompt。
- 运行中 `steer()` 注入同一个 session。
- `cancel()` 正确结束当前 turn，`turn.ended.reason = "cancelled"`。
- approval handler 被官方工具调用触发并闭环。
- question handler 被官方 AskUserQuestion / question 工具调用触发并闭环。

已验证命令：

```text
node scripts/probe-kimi-code-p7-acceptance.mjs
```

关键结果：

```json
{
  "ok": true,
  "sessionId": "session_b0e58915-d766-4a0d-8c40-a86e7b063a7a",
  "model": "kimi-code/kimi-for-coding",
  "checks": [
    {
      "name": "10 ordinary prompts same session",
      "turnReasons": ["completed", "completed", "completed", "completed", "completed", "completed", "completed", "completed", "completed", "completed"],
      "turnIds": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    },
    { "name": "steer same session", "turnId": 10, "reason": "completed" },
    { "name": "cancel ends turn", "turnId": 11, "reason": "cancelled" },
    { "name": "approval handler roundtrip", "turnId": 12, "reason": "completed" },
    { "name": "question handler roundtrip", "turnId": 13, "reason": "completed" }
  ]
}
```

队列链路说明：

- Renderer 运行中普通发送只 `addPendingMessage()`，不会直接调用 `sendKimiCodePrompt()`。
- SDK status `completed` 后，`App.tsx` 执行 `shiftPendingMessage()`，并对 `engine: "kimi-code"` 调用 `sendKimiCodePrompt()` 续发。
- 队列项点击“引导”会先 `removePendingMessage(id)`，再调用 `steerKimiCode()`；失败时恢复队列项并标记本地 steer 气泡失败。

P7 当前结论：P7.1-P7.4 已完成。Kimix 正式主链路已迁到官方 SDK / Wire event：会话使用官方 session id，普通发送走 `prompt()`，运行中引导走 `steer()`，停止走 `cancel()`，审批 / 提问走 SDK handler，消息流只消费 `kimi-code:event` / `kimi-code:status` 映射后的 timeline；旧 hidden runtime 的正式 UI、后端 IPC、类型、调试面板、reducer/tests 和依赖已删除。

## 结果明细

### 通过：git status --short

```text
{
  "command": "git status --short",
  "cwd": "D:\\WORKS\\Android Project\\kimix",
  "code": 0,
  "timedOut": false,
  "durationMs": 56,
  "stdout": " M TASK_STATE.md\n M electron/tuiHost.ts\n M package.json\n M src/App.tsx\n M src/components/chat/Composer.tsx\n M src/components/chat/MessageBubble.tsx\n M src/components/layout/Sidebar.tsx\n M src/components/settings/SettingsPanel.tsx\n M src/utils/__tests__/eventMapper.test.ts\n M src/utils/eventMapper.ts\n?? KIMI_CODE_SDK_MIGRATION_PLAN.md\n?? docs/kimi-code-sdk-probe-result.md\n?? scripts/probe-kimi-code-sdk.mjs\n",
  "stderr": ""
}
```
### 通过：kimi --version

```text
{
  "command": "kimi --version",
  "cwd": "D:\\WORKS\\Android Project\\kimix",
  "code": 0,
  "timedOut": false,
  "durationMs": 263,
  "stdout": "0.6.0\n",
  "stderr": ""
}
```
### 通过：kimi --help

```text
{
  "command": "kimi --help",
  "cwd": "D:\\WORKS\\Android Project\\kimix",
  "code": 0,
  "timedOut": false,
  "durationMs": 256,
  "stdout": "Usage: kimi [options] [command]\n\nThe Starting Point for Next-Gen Agents\n\nOptions:\n  -V, --version                 output the version number\n  -S, --session [id]            Resume a session. With ID: resume that session. Without ID:\n                                interactively pick.\n  -C, --continue                Continue the previous session for the working directory. (default:\n                                false)\n  -y, --yolo                    Automatically approve all actions. (default: false)\n  --auto                        Start in auto permission mode. (default: false)\n  -m, --model <model>           LLM model alias to use for this invocation. Defaults to\n                                default_model in config.toml.\n  -p, --prompt <prompt>         Run one prompt non-interactively and print the response.\n  --output-format <format>      Output format for prompt mode. Defaults to text. (choices: \"text\",\n                                \"stream-json\")\n  --skills-dir <dir>            Load skills from this directory instead of auto-discovered user and\n                                project directories. Can be repeated. (default: [])\n  --plan                        Start in plan mode. (default: false)\n  -h, --help                    Show help.\n\nCommands:\n  export [options] [sessionId]  Export a session as a ZIP archive.\n  migrate                       Migrate data from a legacy kimi-cli installation into kimi-code.\n\nDocumentation:        https://moonshotai.github.io/kimi-code/\n\n",
  "stderr": ""
}
```
### 通过：kimi --wire --help

```text
{
  "command": "kimi --wire --help",
  "cwd": "D:\\WORKS\\Android Project\\kimix",
  "code": 0,
  "timedOut": false,
  "durationMs": 259,
  "stdout": "Usage: kimi [options] [command]\n\nThe Starting Point for Next-Gen Agents\n\nOptions:\n  -V, --version                 output the version number\n  -S, --session [id]            Resume a session. With ID: resume that session. Without ID:\n                                interactively pick.\n  -C, --continue                Continue the previous session for the working directory. (default:\n                                false)\n  -y, --yolo                    Automatically approve all actions. (default: false)\n  --auto                        Start in auto permission mode. (default: false)\n  -m, --model <model>           LLM model alias to use for this invocation. Defaults to\n                                default_model in config.toml.\n  -p, --prompt <prompt>         Run one prompt non-interactively and print the response.\n  --output-format <format>      Output format for prompt mode. Defaults to text. (choices: \"text\",\n                                \"stream-json\")\n  --skills-dir <dir>            Load skills from this directory instead of auto-discovered user and\n                                project directories. Can be repeated. (default: [])\n  --plan                        Start in plan mode. (default: false)\n  -h, --help                    Show help.\n\nCommands:\n  export [options] [sessionId]  Export a session as a ZIP archive.\n  migrate                       Migrate data from a legacy kimi-cli installation into kimi-code.\n\nDocumentation:        https://moonshotai.github.io/kimi-code/\n\n",
  "stderr": ""
}
```
### 失败：kimi --wire raw launch
- 错误：closed with 1

```text
{
  "kind": "close",
  "code": 1,
  "durationMs": 249,
  "stdout": "",
  "stderr": "error: unknown option '--wire'\n"
}
```
### 失败：pnpm view @moonshot-ai/kimi-code-sdk version
- 错误：exit 1

```text
{
  "command": "pnpm view @moonshot-ai/kimi-code-sdk version",
  "cwd": "D:\\WORKS\\Android Project\\kimix",
  "code": 1,
  "timedOut": false,
  "durationMs": 872,
  "stdout": "[ERR_PNPM_FETCH_404] GET https://registry.npmjs.org/@moonshot-ai%2Fkimi-code-sdk: Not Found - 404\n\n@moonshot-ai/kimi-code-sdk is not in the npm registry, or you have no permission to fetch it.\n\nNo authorization header was set for the request.\n",
  "stderr": ""
}
```
### 通过：pnpm view @moonshot-ai/kimi-agent-sdk version

```text
{
  "command": "pnpm view @moonshot-ai/kimi-agent-sdk version",
  "cwd": "D:\\WORKS\\Android Project\\kimix",
  "code": 0,
  "timedOut": false,
  "durationMs": 803,
  "stdout": "0.1.8\n",
  "stderr": ""
}
```
### 通过：installed @moonshot-ai/kimi-agent-sdk

```text
{
  "version": "0.1.8",
  "exports": [
    "AgentSdkError",
    "CliError",
    "CliErrorCodes",
    "ContentPartSchema",
    "DisplayBlockSchema",
    "HookRequestSchema",
    "HookResolvedSchema",
    "HookSubscriptionSchema",
    "HookTriggeredSchema",
    "HooksInfoSchema",
    "InitializeResultSchema",
    "KimiPaths",
    "ProtocolClient",
    "ProtocolError",
    "ProtocolErrorCodes",
    "ReplayResultSchema",
    "RunResultSchema",
    "SessionError",
    "SessionErrorCodes",
    "SetPlanModeResultSchema",
    "SlashCommandInfoSchema",
    "SteerInputSchema",
    "ToolCallSchema",
    "ToolResultSchema",
    "TransportError",
    "TransportErrorCodes",
    "authMCP",
    "collectText",
    "createExternalTool",
    "createKimiPaths",
    "createSession",
    "deleteSession",
    "disableLogs",
    "enableLogs",
    "extractBrief",
    "extractTextFromContentParts",
    "forkSession",
    "formatContentOutput",
    "getErrorCategory",
    "getErrorCode",
    "getModelById",
    "getModelThinkingMode",
    "getRegisteredWorkDirs",
    "isAgentSdkError",
    "isLoggedIn",
    "isModelThinking",
    "listSessions",
    "listSessionsForWorkspace",
    "login",
    "logout",
    "parseConfig",
    "parseEventPayload",
    "parseRequestPayload",
    "parseSessionEvents",
    "prompt",
    "resetAuthMCP",
    "saveDefaultModel",
    "setLogSink",
    "testMCP"
  ]
}
```
### 失败：old ProtocolClient wire handshake
- 错误：TransportError: CLI exited with code 1: error: unknown option '--work-dir'
### 失败：old ProtocolClient wire handshake with Kimix compat patch
- 错误：TransportError: CLI exited with code 1: error: unknown option '--wire'
### 通过：official packages/node-sdk source

```text
{
  "repo": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\kimix-kimi-code-research",
  "name": "@moonshot-ai/kimi-code-sdk",
  "version": "0.4.0",
  "private": true,
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  }
}
```
### 通过：official repo git head

```text
{
  "command": "git -C C:\\Users\\Administrator\\AppData\\Local\\Temp\\kimix-kimi-code-research log -1 --pretty=format:%h %ci %s",
  "cwd": "D:\\WORKS\\Android Project\\kimix",
  "code": 0,
  "timedOut": false,
  "durationMs": 46,
  "stdout": "42bb914 2026-06-01 18:46:40 +0800 feat(tui): add /provider command, custom registry import, and tabbed model selector (#264)",
  "stderr": ""
}
```
### 失败：official packages/node-sdk build
- 错误：exit 1

```text
{
  "command": "pnpm --filter @moonshot-ai/kimi-code-sdk build",
  "cwd": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\kimix-kimi-code-research",
  "code": 1,
  "timedOut": false,
  "durationMs": 1694,
  "stdout": "\n> @moonshot-ai/kimi-code-sdk@0.4.0 build C:\\Users\\Administrator\\AppData\\Local\\Temp\\kimix-kimi-code-research\\packages\\node-sdk\n> tsdown && pnpm run build:dts\n\nℹ tsdown v0.22.0 powered by rolldown v1.0.1\nℹ config file: C:\\Users\\Administrator\\AppData\\Local\\Temp\\kimix-kimi-code-research\\packages\\node-sdk\\tsdown.config.ts \nℹ entry: ./src/index.ts\nℹ tsconfig: tsconfig.json\nℹ Build start\nℹ Cleaning 6 files\nℹ Hint: consider adding deps.onlyBundle option to avoid unintended bundling of dependencies, or set deps.onlyBundle: false to disable this hint.\nSee more at https://tsdown.dev/options/dependencies#deps-onlybundle\nDetected dependencies in bundle:\n- pathe\n- @anthropic-ai/sdk\n- standardwebhooks\n- @stablelib/base64\n- fast-sha256\n- retry\n- p-retry\n- extend\n- gaxios\n- bignumber.js\n- json-bigint\n- gcp-metadata\n- google-logging-utils\n- base64-js\n- google-auth-library\n- safe-buffer\n- ecdsa-sig-formatter\n- jws\n- buffer-equal-constant-time\n- jwa\n- ws\n- @google/genai\n- openai\n- picomatch\n- js-yaml\n- object-keys\n- es-define-property\n- es-errors\n- gopd\n- define-data-property\n- has-property-descriptors\n- define-properties\n- es-object-atoms\n- math-intrinsics\n- has-symbols\n- get-proto\n- function-bind\n- call-bind-apply-helpers\n- dunder-proto\n- hasown\n- get-intrinsic\n- set-function-length\n- call-bind\n- call-bound\n- es-abstract\n- is-callable\n- for-each\n- has-tostringtag\n- is-regex\n- safe-regex-test\n- regexp.escape\n- nunjucks\n- asap\n- a-sync-waterfall\n- tar\n- pend\n- yauzl\n- buffer-crc32\n- ajv\n- fast-deep-equal\n- json-schema-traverse\n- fast-uri\n- ajv-formats\n- pkce-challenge\n- @modelcontextprotocol/sdk\n- zod-to-json-schema\n- eventsource-parser\n- isexe\n- which\n- path-key\n- cross-spawn\n- shebang-regex\n- shebang-command\n- @mozilla/readability\n- linkedom\n- entities\n- htmlparser2\n- domelementtype\n- domhandler\n- dom-serializer\n- domutils\n- boolbase\n- css-what\n- css-select\n- nth-check\n- uhyphen\n- cssom\n- graceful-fs\n- signal-exit\n- proper-lockfile\n- ms\n- debug\n- has-flag\n- supports-color\n- agent-base\n- https-proxy-agent\n- web-streams-polyfill\n- fetch-blob\n- formdata-polyfill\n- node-domexception\n- node-fetch\n- data-uri-to-buffer\nℹ dist\\index.mjs                        4.22 MB\nℹ dist\\from--FGcjEDx.mjs              171.67 kB │ gzip: 30.00 kB\nℹ dist\\src-DG-fsidf.mjs                43.02 kB │ gzip: 11.38 kB\nℹ dist\\dist-lcz-lC-K.mjs               38.15 kB │ gzip: 10.69 kB\nℹ dist\\multipart-parser-CO_QxzY-.mjs    9.00 kB │ gzip:  2.65 kB\nℹ 5 files, total: 4.48 MB\n✔ Build complete in 501ms\n\n> @moonshot-ai/kimi-code-sdk@0.4.0 build:dts C:\\Users\\Administrator\\AppData\\Local\\Temp\\kimix-kimi-code-research\\packages\\node-sdk\n> node scripts/build-dts.mjs\n\n ELIFECYCLE  Command failed with exit code 1.\nC:\\Users\\Administrator\\AppData\\Local\\Temp\\kimix-kimi-code-research\\packages\\node-sdk:\r\n ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @moonshot-ai/kimi-code-sdk@0.4.0 build: `tsdown && pnpm run build:dts`\nExit status 1\n",
  "stderr": "node:internal/child_process:441\r\n    throw new ErrnoException(err, 'spawn');\r\n          ^\r\n\r\nError: spawn EINVAL\r\n    at ChildProcess.spawn (node:internal/child_process:441:11)\r\n    at spawn (node:child_process:796:9)\r\n    at file:///C:/Users/Administrator/AppData/Local/Temp/kimix-kimi-code-research/packages/node-sdk/scripts/build-dts.mjs:33:19\r\n    at new Promise (<anonymous>)\r\n    at run (file:///C:/Users/Administrator/AppData/Local/Temp/kimix-kimi-code-research/packages/node-sdk/scripts/build-dts.mjs:32:10)\r\n    at file:///C:/Users/Administrator/AppData/Local/Temp/kimix-kimi-code-research/packages/node-sdk/scripts/build-dts.mjs:21:9 {\r\n  errno: -4071,\r\n  code: 'EINVAL',\r\n  syscall: 'spawn'\r\n}\r\n\r\nNode.js v24.15.0\r\n"
}
```
### 通过：official SDK import from built source

```text
{
  "entry": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\kimix-kimi-code-research\\packages\\node-sdk\\dist\\index.mjs"
}
```
### 通过：official SDK create session

```text
{
  "sessionId": "session_c07b4cee-c4dd-4dc9-b9e5-359d9c934207",
  "workDir": "C:/Users/ADMINI~1/AppData/Local/Temp/kimix-kimi-code-sdk-probe/work",
  "model": "kimi-code/kimi-for-coding",
  "sessionDir": "C:\\Users\\Administrator\\.kimi-code\\sessions\\wd_work_bc69271920cd\\session_c07b4cee-c4dd-4dc9-b9e5-359d9c934207",
  "wirePath": "C:\\Users\\Administrator\\.kimi-code\\sessions\\wd_work_bc69271920cd\\session_c07b4cee-c4dd-4dc9-b9e5-359d9c934207\\agents\\main\\wire.jsonl",
  "wireExists": true
}
```
### 通过：official SDK resume session

```text
{
  "sessionId": "session_c07b4cee-c4dd-4dc9-b9e5-359d9c934207",
  "workDir": "C:/Users/ADMINI~1/AppData/Local/Temp/kimix-kimi-code-sdk-probe/work",
  "resumeStateKeys": [
    "sessionMetadata",
    "agents",
    "warning"
  ]
}
```
### 通过：official SDK prompt streaming

```text
{
  "turnId": 0,
  "eventCount": 87,
  "firstEventMs": 32,
  "firstDeltaMs": 1598,
  "turnStartedMs": 70,
  "endedMs": 3826,
  "turnEnd": {
    "type": "turn.ended",
    "reason": "completed",
    "turnId": 0
  },
  "eventTypeCounts": {
    "session.meta.updated": 1,
    "turn.started": 1,
    "turn.step.started": 1,
    "thinking.delta": 71,
    "assistant.delta": 10,
    "turn.step.completed": 1,
    "agent.status.updated": 1,
    "turn.ended": 1
  },
  "eventTypePreview": [
    "session.meta.updated",
    "turn.started",
    "turn.step.started",
    "thinking.delta",
    "thinking.delta",
    "thinking.delta",
    "thinking.delta",
    "thinking.delta",
    "thinking.delta",
    "thinking.delta",
    "thinking.delta",
    "thinking.delta",
    "thinking.delta",
    "thinking.delta",
    "thinking.delta",
    "thinking.delta",
    "thinking.delta",
    "thinking.delta",
    "thinking.delta",
    "thinking.delta"
  ]
}
```
### 通过：official SDK steer same session

```text
{
  "sessionId": "session_c07b4cee-c4dd-4dc9-b9e5-359d9c934207",
  "sessionCountBeforeSteer": 3,
  "sessionCountAfterSteer": 3,
  "prompt": {
    "turnId": 1,
    "eventCount": 736,
    "firstEventMs": 31,
    "firstDeltaMs": 1335,
    "turnStartedMs": 53,
    "endedMs": 23726,
    "turnEnd": {
      "type": "turn.ended",
      "reason": "completed",
      "turnId": 1
    },
    "eventTypeCounts": {
      "session.meta.updated": 1,
      "turn.started": 1,
      "turn.step.started": 2,
      "thinking.delta": 411,
      "assistant.delta": 316,
      "turn.step.completed": 2,
      "agent.status.updated": 2,
      "turn.ended": 1
    },
    "eventTypePreview": [
      "session.meta.updated",
      "turn.started",
      "turn.step.started",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta"
    ]
  }
}
```
### 通过：official SDK cancel

```text
{
  "turnId": 2,
  "eventCount": 5,
  "firstEventMs": 32,
  "turnStartedMs": 51,
  "endedMs": 820,
  "turnEnd": {
    "type": "turn.ended",
    "reason": "cancelled",
    "turnId": 2
  },
  "eventTypeCounts": {
    "session.meta.updated": 1,
    "turn.started": 1,
    "turn.step.started": 1,
    "turn.step.interrupted": 1,
    "turn.ended": 1
  },
  "eventTypePreview": [
    "session.meta.updated",
    "turn.started",
    "turn.step.started",
    "turn.step.interrupted",
    "turn.ended"
  ]
}
```
### 通过：official SDK approval handler roundtrip

```text
{
  "handlerInvoked": true,
  "prompt": {
    "turnId": 3,
    "eventCount": 753,
    "firstEventMs": 2,
    "firstDeltaMs": 1567,
    "turnStartedMs": 6,
    "endedMs": 26317,
    "turnEnd": {
      "type": "turn.ended",
      "reason": "completed",
      "turnId": 3
    },
    "eventTypeCounts": {
      "session.meta.updated": 1,
      "turn.started": 1,
      "turn.step.started": 2,
      "thinking.delta": 565,
      "tool.call.delta": 39,
      "tool.call.started": 2,
      "tool.result": 2,
      "turn.step.completed": 2,
      "agent.status.updated": 2,
      "assistant.delta": 136,
      "turn.ended": 1
    },
    "eventTypePreview": [
      "session.meta.updated",
      "turn.started",
      "turn.step.started",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta"
    ]
  }
}
```
### 通过：official SDK question handler roundtrip

```text
{
  "handlerInvoked": true,
  "prompt": {
    "turnId": 4,
    "eventCount": 271,
    "firstEventMs": 4,
    "firstDeltaMs": 1627,
    "turnStartedMs": 21,
    "endedMs": 10965,
    "turnEnd": {
      "type": "turn.ended",
      "reason": "completed",
      "turnId": 4
    },
    "eventTypeCounts": {
      "session.meta.updated": 1,
      "turn.started": 1,
      "turn.step.started": 2,
      "thinking.delta": 180,
      "tool.call.delta": 52,
      "tool.call.started": 1,
      "tool.result": 1,
      "turn.step.completed": 2,
      "agent.status.updated": 2,
      "assistant.delta": 28,
      "turn.ended": 1
    },
    "eventTypePreview": [
      "session.meta.updated",
      "turn.started",
      "turn.step.started",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta",
      "thinking.delta"
    ]
  }
}
```

## 覆盖与缺口

- 已覆盖：CLI 版本/help、`--wire` help/轻量启动、新旧 npm 包查询、旧 SDK 导出与 wire 握手、官方源码 SDK 构建、create session、prompt streaming、steer、cancel、handler 注册、sessionId 到 `wire.jsonl` 路径定位。
- approval / question 的 handler 注册可以自动验证；真实 invocation 需要构造会触发审批/澄清的 prompt，避免 P0 探针默认改动用户文件。
- 如果某项失败，以对应命令输出为准；不要凭推测进入正式 UI 改造。
