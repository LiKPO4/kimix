# Kimi Code SDK / Wire P0 探针结果

- 生成时间：2026-06-04T01:32:56.023Z
- Kimix 仓库：D:\WORKS\Android Project\kimix
- 官方源码：C:\Users\Administrator\AppData\Local\Temp\kimix-kimi-code-research
- 探针工作目录：C:\Users\ADMINI~1\AppData\Local\Temp\kimix-kimi-code-sdk-probe\work
- KIMI_CODE_HOME：C:\Users\Administrator\.kimi-code

## 结论

下一步建议接官方 `packages/node-sdk` 的 `KimiHarness` / `Session` API，事件源使用 `Session.onEvent()`，并用 `session.id` 对齐 `~/.kimi-code/sessions/.../<sessionId>/agents/main/wire.jsonl`。
如果 npm 新包不可安装，短期使用官方源码 `packages/node-sdk` 的 file/vendor 接入；它比旧 `@moonshot-ai/kimi-agent-sdk` 更贴近目标 API。

### CLI 0.9.0 tag + node-sdk 0.7.0 重跑结论

2026-06-04 重跑确认：vendored SDK 来源为官方 `@moonshot-ai/kimi-code@0.9.0` tag，研究仓库 HEAD 为 `6c0afc4d9c10e4d9001f2a891e20bf61e34ec754`，`packages/node-sdk` 版本为 `0.7.0`。SDK 运行时新增 `createKimiHarness()` 工厂，直接 `new KimiHarness(options)` 已不兼容；Kimix 已改为优先走工厂并保留旧构造器兜底。

0.9.0 新增 `/btw` 对应真 SDK 能力 `Session.startBtw()`：动态烟测可返回侧通道 `agentId`，事件带 `agentId`，assistant delta 可独立收集。ACP 子命令是 CLI/IDE stdio 入口，Kimix 当前内嵌 SDK，不作为本轮 GUI 能力接入。其余 0.9.0 修复项会随 vendored SDK 升级自然进入主链路，重点回归 OpenAI-compatible Provider 的输出上限与 DeepSeek 场景。

## 结果明细

### 通过：git status --short

```text
{
  "command": "git status --short",
  "cwd": "D:\\WORKS\\Android Project\\kimix",
  "code": 0,
  "timedOut": false,
  "durationMs": 60,
  "stdout": " M electron/kimiCodeHost.ts\n M electron/main.ts\n M electron/preload.ts\n M electron/types/ipc.ts\n M package.json\n M scripts/probe-kimi-code-0.8.mjs\n M scripts/probe-kimi-code-sdk.mjs\n M src/components/layout/AppShell.tsx\n M src/components/layout/LongTaskInspectorPanel.tsx\n M src/components/layout/Sidebar.tsx\n M src/components/settings/SettingsPanel.tsx\n M src/main.tsx\n M vendor/kimi-code-sdk/README.md\n M vendor/kimi-code-sdk/index.mjs\n",
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
  "durationMs": 329,
  "stdout": "0.8.0\n",
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
  "durationMs": 297,
  "stdout": "Usage: kimi [options] [command]\n\nThe Starting Point for Next-Gen Agents\n\nOptions:\n  -V, --version                 output the version number\n  -S, --session [id]            Resume a session. With ID: resume that session. Without ID:\n                                interactively pick.\n  -C, --continue                Continue the previous session for the working directory. (default:\n                                false)\n  -y, --yolo                    Automatically approve all actions. (default: false)\n  --auto                        Start in auto permission mode. (default: false)\n  -m, --model <model>           LLM model alias to use for this invocation. Defaults to\n                                default_model in config.toml.\n  -p, --prompt <prompt>         Run one prompt non-interactively and print the response.\n  --output-format <format>      Output format for prompt mode. Defaults to text. (choices: \"text\",\n                                \"stream-json\")\n  --skills-dir <dir>            Load skills from this directory instead of auto-discovered user and\n                                project directories. Can be repeated. (default: [])\n  --plan                        Start in plan mode. (default: false)\n  -h, --help                    Show help.\n\nCommands:\n  export [options] [sessionId]  Export a session as a ZIP archive.\n  provider                      Manage LLM providers non-interactively.\n  migrate                       Migrate data from a legacy kimi-cli installation into kimi-code.\n  upgrade                       Upgrade Kimi Code to the latest version.\n\nDocumentation:        https://moonshotai.github.io/kimi-code/\n\n",
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
  "durationMs": 301,
  "stdout": "Usage: kimi [options] [command]\n\nThe Starting Point for Next-Gen Agents\n\nOptions:\n  -V, --version                 output the version number\n  -S, --session [id]            Resume a session. With ID: resume that session. Without ID:\n                                interactively pick.\n  -C, --continue                Continue the previous session for the working directory. (default:\n                                false)\n  -y, --yolo                    Automatically approve all actions. (default: false)\n  --auto                        Start in auto permission mode. (default: false)\n  -m, --model <model>           LLM model alias to use for this invocation. Defaults to\n                                default_model in config.toml.\n  -p, --prompt <prompt>         Run one prompt non-interactively and print the response.\n  --output-format <format>      Output format for prompt mode. Defaults to text. (choices: \"text\",\n                                \"stream-json\")\n  --skills-dir <dir>            Load skills from this directory instead of auto-discovered user and\n                                project directories. Can be repeated. (default: [])\n  --plan                        Start in plan mode. (default: false)\n  -h, --help                    Show help.\n\nCommands:\n  export [options] [sessionId]  Export a session as a ZIP archive.\n  provider                      Manage LLM providers non-interactively.\n  migrate                       Migrate data from a legacy kimi-cli installation into kimi-code.\n  upgrade                       Upgrade Kimi Code to the latest version.\n\nDocumentation:        https://moonshotai.github.io/kimi-code/\n\n",
  "stderr": ""
}
```
### 失败：kimi --wire raw launch
- 错误：closed with 1

```text
{
  "kind": "close",
  "code": 1,
  "durationMs": 319,
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
  "durationMs": 1889,
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
  "durationMs": 1291,
  "stdout": "0.1.8\n",
  "stderr": ""
}
```
### 失败：installed @moonshot-ai/kimi-agent-sdk
- 错误：Error: ENOENT: no such file or directory, open 'D:\WORKS\Android Project\kimix\node_modules\@moonshot-ai\kimi-agent-sdk\package.json'
### 跳过：old ProtocolClient wire handshake
- 原因：ProtocolClient export is unavailable
### 通过：official packages/node-sdk source

```text
{
  "repo": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\kimix-kimi-code-research",
  "name": "@moonshot-ai/kimi-code-sdk",
  "version": "0.7.0",
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
  "durationMs": 54,
  "stdout": "6c0afc4 2026-06-03 22:00:17 +0800 ci: release packages (#360)",
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
  "durationMs": 2855,
  "stdout": "\n> @moonshot-ai/kimi-code-sdk@0.7.0 build C:\\Users\\Administrator\\AppData\\Local\\Temp\\kimix-kimi-code-research\\packages\\node-sdk\n> tsdown && pnpm run build:dts\n\nℹ tsdown v0.22.0 powered by rolldown v1.0.1\nℹ config file: C:\\Users\\Administrator\\AppData\\Local\\Temp\\kimix-kimi-code-research\\packages\\node-sdk\\tsdown.config.ts \nℹ entry: ./src/index.ts\nℹ tsconfig: tsconfig.json\nℹ Build start\nℹ Cleaning 6 files\nℹ Hint: consider adding deps.onlyBundle option to avoid unintended bundling of dependencies, or set deps.onlyBundle: false to disable this hint.\nSee more at https://tsdown.dev/options/dependencies#deps-onlybundle\nDetected dependencies in bundle:\n- pathe\n- @anthropic-ai/sdk\n- standardwebhooks\n- @stablelib/base64\n- fast-sha256\n- retry\n- p-retry\n- extend\n- gaxios\n- bignumber.js\n- json-bigint\n- gcp-metadata\n- google-logging-utils\n- base64-js\n- google-auth-library\n- safe-buffer\n- ecdsa-sig-formatter\n- jws\n- buffer-equal-constant-time\n- jwa\n- ws\n- @google/genai\n- openai\n- nunjucks\n- asap\n- a-sync-waterfall\n- picomatch\n- js-yaml\n- object-keys\n- es-define-property\n- es-errors\n- gopd\n- define-data-property\n- has-property-descriptors\n- define-properties\n- es-object-atoms\n- math-intrinsics\n- has-symbols\n- get-proto\n- function-bind\n- call-bind-apply-helpers\n- dunder-proto\n- hasown\n- get-intrinsic\n- set-function-length\n- call-bind\n- call-bound\n- es-abstract\n- is-callable\n- for-each\n- has-tostringtag\n- is-regex\n- safe-regex-test\n- regexp.escape\n- ajv\n- fast-deep-equal\n- json-schema-traverse\n- fast-uri\n- ajv-formats\n- pkce-challenge\n- @modelcontextprotocol/sdk\n- tar\n- pend\n- yauzl\n- buffer-crc32\n- zod-to-json-schema\n- eventsource-parser\n- isexe\n- which\n- path-key\n- cross-spawn\n- shebang-regex\n- shebang-command\n- @mozilla/readability\n- linkedom\n- entities\n- htmlparser2\n- domelementtype\n- domhandler\n- dom-serializer\n- domutils\n- boolbase\n- css-what\n- css-select\n- nth-check\n- uhyphen\n- cssom\n- graceful-fs\n- signal-exit\n- proper-lockfile\n- ms\n- debug\n- has-flag\n- supports-color\n- agent-base\n- https-proxy-agent\n- web-streams-polyfill\n- fetch-blob\n- formdata-polyfill\n- node-domexception\n- node-fetch\n- data-uri-to-buffer\nℹ dist\\index.mjs                        4.29 MB\nℹ dist\\from--FGcjEDx.mjs              171.67 kB │ gzip: 30.00 kB\nℹ dist\\src-DG-fsidf.mjs                43.02 kB │ gzip: 11.38 kB\nℹ dist\\dist-lcz-lC-K.mjs               38.15 kB │ gzip: 10.69 kB\nℹ dist\\multipart-parser-CO_QxzY-.mjs    9.00 kB │ gzip:  2.65 kB\nℹ 5 files, total: 4.55 MB\n✔ Build complete in 650ms\n\n> @moonshot-ai/kimi-code-sdk@0.7.0 build:dts C:\\Users\\Administrator\\AppData\\Local\\Temp\\kimix-kimi-code-research\\packages\\node-sdk\n> node scripts/build-dts.mjs\n\n ELIFECYCLE  Command failed with exit code 1.\nC:\\Users\\Administrator\\AppData\\Local\\Temp\\kimix-kimi-code-research\\packages\\node-sdk:\r\n ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @moonshot-ai/kimi-code-sdk@0.7.0 build: `tsdown && pnpm run build:dts`\nExit status 1\n",
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
  "sessionId": "session_d93059e6-3f93-4232-8d25-8aae126713a1",
  "workDir": "C:/Users/ADMINI~1/AppData/Local/Temp/kimix-kimi-code-sdk-probe/work",
  "model": "kimi-code/kimi-for-coding",
  "sessionDir": "C:\\Users\\Administrator\\.kimi-code\\sessions\\wd_work_bc69271920cd\\session_d93059e6-3f93-4232-8d25-8aae126713a1",
  "wirePath": "C:\\Users\\Administrator\\.kimi-code\\sessions\\wd_work_bc69271920cd\\session_d93059e6-3f93-4232-8d25-8aae126713a1\\agents\\main\\wire.jsonl",
  "wireExists": true
}
```
### 通过：official SDK resume session

```text
{
  "sessionId": "session_d93059e6-3f93-4232-8d25-8aae126713a1",
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
  "eventCount": 250,
  "firstEventMs": 26,
  "firstDeltaMs": 1760,
  "turnStartedMs": 54,
  "endedMs": 9693,
  "turnEnd": {
    "type": "turn.ended",
    "reason": "completed",
    "turnId": 0
  },
  "eventTypeCounts": {
    "session.meta.updated": 1,
    "mcp.server.status": 1,
    "tool.list.updated": 1,
    "turn.started": 1,
    "turn.step.started": 1,
    "thinking.delta": 232,
    "assistant.delta": 10,
    "turn.step.completed": 1,
    "agent.status.updated": 1,
    "turn.ended": 1
  },
  "eventTypePreview": [
    "session.meta.updated",
    "mcp.server.status",
    "tool.list.updated",
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
    "thinking.delta"
  ]
}
```
### 通过：official SDK steer same session

```text
{
  "sessionId": "session_d93059e6-3f93-4232-8d25-8aae126713a1",
  "sessionCountBeforeSteer": 5,
  "sessionCountAfterSteer": 5,
  "prompt": {
    "turnId": 1,
    "eventCount": 742,
    "firstEventMs": 31,
    "firstDeltaMs": 1576,
    "turnStartedMs": 53,
    "endedMs": 24152,
    "turnEnd": {
      "type": "turn.ended",
      "reason": "completed",
      "turnId": 1
    },
    "eventTypeCounts": {
      "session.meta.updated": 1,
      "turn.started": 1,
      "turn.step.started": 2,
      "thinking.delta": 433,
      "assistant.delta": 300,
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
  "turnStartedMs": 53,
  "endedMs": 829,
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
    "eventCount": 4045,
    "firstEventMs": 9,
    "firstDeltaMs": 1662,
    "turnStartedMs": 28,
    "endedMs": 118132,
    "turnEnd": {
      "type": "turn.ended",
      "reason": "completed",
      "turnId": 3
    },
    "eventTypeCounts": {
      "session.meta.updated": 1,
      "turn.started": 1,
      "turn.step.started": 2,
      "thinking.delta": 251,
      "tool.call.delta": 21,
      "tool.call.started": 1,
      "tool.result": 1,
      "turn.step.completed": 2,
      "agent.status.updated": 2,
      "assistant.delta": 3762,
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
    "eventCount": 317,
    "firstEventMs": 2,
    "firstDeltaMs": 1963,
    "turnStartedMs": 8,
    "endedMs": 12264,
    "turnEnd": {
      "type": "turn.ended",
      "reason": "completed",
      "turnId": 4
    },
    "eventTypeCounts": {
      "session.meta.updated": 1,
      "turn.started": 1,
      "turn.step.started": 2,
      "thinking.delta": 246,
      "tool.call.delta": 48,
      "tool.call.started": 1,
      "tool.result": 1,
      "turn.step.completed": 2,
      "agent.status.updated": 2,
      "assistant.delta": 12,
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
