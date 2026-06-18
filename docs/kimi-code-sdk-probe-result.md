# Kimi Code SDK / Wire P0 探针结果

- 生成时间：2026-06-18T02:05:47.323Z
- Kimix 仓库：D:\WORKS\Android Project\kimix
- 官方源码：C:\Users\Administrator\AppData\Local\Temp\kimix-kimi-code-research
- 探针工作目录：C:\Users\ADMINI~1\AppData\Local\Temp\kimix-kimi-code-sdk-probe\work
- KIMI_CODE_HOME：C:\Users\Administrator\.kimi-code

## 结论

下一步建议接官方 `packages/node-sdk` 的 `KimiHarness` / `Session` API，事件源使用 `Session.onEvent()`，并用 `session.id` 对齐 `~/.kimi-code/sessions/.../<sessionId>/agents/main/wire.jsonl`。
如果 npm 新包不可安装，短期使用官方源码 `packages/node-sdk` 的 file/vendor 接入；它比旧 `@moonshot-ai/kimi-agent-sdk` 更贴近目标 API。

## 结果明细

### 通过：git status --short

```text
{
  "command": "git status --short",
  "cwd": "D:\\WORKS\\Android Project\\kimix",
  "code": 0,
  "timedOut": false,
  "durationMs": 55,
  "stdout": " M TASK_STATE.md\n M vendor/kimi-code-sdk/README.md\n M vendor/kimi-code-sdk/index.mjs\n?? .claude/\n?? dist2/\n?? dist3/\n?? dist4/\n?? dist5/\n?? docs/release-notes/v2.9.112.md\n?? docs/release-notes/v2.9.113.md\n?? docs/release-notes/v2.9.114.md\n?? docs/release-notes/v2.9.115.md\n?? docs/release-notes/v2.9.116.md\n?? docs/release-notes/v2.9.117.md\n?? docs/release-notes/v2.9.118.md\n?? docs/release-notes/v2.9.119.md\n?? docs/release-notes/v2.9.120.md\n?? docs/release-notes/v2.9.121.md\n?? docs/release-notes/v2.9.122.md\n?? docs/release-notes/v2.9.123.md\n?? docs/release-notes/v2.9.124.md\n?? docs/release-notes/v2.9.125.md\n?? docs/release-notes/v2.9.126.md\n?? docs/release-notes/v2.9.127.md\n?? docs/release-notes/v2.9.128.md\n?? docs/release-notes/v2.9.129.md\n?? docs/release-notes/v2.9.130.md\n?? docs/release-notes/v2.9.131.md\n?? docs/release-notes/v2.9.132.md\n?? docs/release-notes/v2.9.133.md\n?? docs/release-notes/v2.9.134.md\n?? docs/release-notes/v2.9.135.md\n?? docs/release-notes/v2.9.136.md\n?? docs/release-notes/v2.9.137.md\n?? docs/release-notes/v2.9.138.md\n?? docs/release-notes/v2.9.50.md\n?? docs/release-notes/v2.9.51.md\n?? docs/release-notes/v2.9.52.md\n?? docs/release-notes/v2.9.53.md\n?? docs/release-notes/v2.9.54.md\n?? docs/release-notes/v2.9.55.md\n?? docs/release-notes/v2.9.56.md\n?? docs/release-notes/v2.9.57.md\n?? docs/release-notes/v2.9.58.md\n?? docs/release-notes/v2.9.59.md\n?? docs/release-notes/v2.9.60.md\n?? docs/release-notes/v2.9.61.md\n?? docs/release-notes/v2.9.62.md\n?? docs/release-notes/v2.9.63.md\n?? docs/release-notes/v2.9.64.md\n?? docs/release-notes/v2.9.65.md\n?? docs/release-notes/v2.9.66.md\n?? docs/release-notes/v2.9.67.md\n?? docs/release-notes/v2.9.68.md\n?? docs/release-notes/v2.9.69.md\n?? docs/release-notes/v2.9.70.md\n?? docs/release-notes/v2.9.71.md\n?? docs/release-notes/v2.9.72.md\n?? docs/release-notes/v2.9.73.md\n?? docs/release-notes/v2.9.74.md\n?? docs/release-notes/v2.9.75.md\n?? docs/release-notes/v2.9.76.md\n?? docs/release-notes/v2.9.77.md\n?? docs/release-notes/v2.9.78.md\n?? docs/release-notes/v2.9.80.md\n?? docs/release-notes/v2.9.81.md\n?? docs/release-notes/v2.9.82.md\n?? docs/release-notes/v2.9.83.md\n?? docs/release-notes/v2.9.84.md\n?? docs/release-notes/v2.9.87.md\n?? docs/release-notes/v2.9.88.md\n?? docs/release-notes/v2.9.89.md\n?? docs/release-notes/v2.9.90.md\n?? docs/release-notes/v2.9.91.md\n?? docs/release-notes/v2.9.92.md\n?? docs/release-notes/v2.9.93.md\n?? docs/release-notes/v2.9.95.md\n?? docs/release-notes/v2.9.96.md\n?? memory/\n",
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
  "durationMs": 410,
  "stdout": "0.17.1\n",
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
  "durationMs": 425,
  "stdout": "Usage: kimi [options] [command]\n\nThe Starting Point for Next-Gen Agents\n\nOptions:\n  -V, --version                 output the version number\n  -S, --session [id]            Resume a session. With ID: resume that session. Without ID:\n                                interactively pick.\n  -C, --continue                Continue the previous session for the working directory. (default:\n                                false)\n  -y, --yolo                    Automatically approve all actions. (default: false)\n  --auto                        Start in auto permission mode. (default: false)\n  -m, --model <model>           LLM model alias to use for this invocation. Defaults to\n                                default_model in config.toml.\n  -p, --prompt <prompt>         Run one prompt non-interactively and print the response.\n  --output-format <format>      Output format for prompt mode. Defaults to text. (choices: \"text\",\n                                \"stream-json\")\n  --skills-dir <dir>            Load skills from this directory instead of auto-discovered user and\n                                project directories. Can be repeated. (default: [])\n  --plan                        Start in plan mode. (default: false)\n  -h, --help                    Show help.\n\nCommands:\n  export [options] [sessionId]  Export a session as a ZIP archive.\n  provider                      Manage LLM providers non-interactively.\n  acp [options]                 Run kimi-code as an Agent Client Protocol (ACP) server over stdio.\n  server                        Run the local Kimi server (REST + WebSocket + web UI).\n  web [options]                 Open the Kimi web UI (starts a background daemon if needed).\n  login                         Authenticate with Kimi Code CLI via the device-code flow.\n  doctor                        Validate Kimi Code configuration files.\n  vis [options] [sessionId]     Launch the session visualizer in your browser.\n  migrate                       Migrate data from a legacy kimi-cli installation into kimi-code.\n  upgrade                       Upgrade Kimi Code to the latest version.\n\nDocumentation:        https://moonshotai.github.io/kimi-code/\n\n",
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
  "durationMs": 427,
  "stdout": "Usage: kimi [options] [command]\n\nThe Starting Point for Next-Gen Agents\n\nOptions:\n  -V, --version                 output the version number\n  -S, --session [id]            Resume a session. With ID: resume that session. Without ID:\n                                interactively pick.\n  -C, --continue                Continue the previous session for the working directory. (default:\n                                false)\n  -y, --yolo                    Automatically approve all actions. (default: false)\n  --auto                        Start in auto permission mode. (default: false)\n  -m, --model <model>           LLM model alias to use for this invocation. Defaults to\n                                default_model in config.toml.\n  -p, --prompt <prompt>         Run one prompt non-interactively and print the response.\n  --output-format <format>      Output format for prompt mode. Defaults to text. (choices: \"text\",\n                                \"stream-json\")\n  --skills-dir <dir>            Load skills from this directory instead of auto-discovered user and\n                                project directories. Can be repeated. (default: [])\n  --plan                        Start in plan mode. (default: false)\n  -h, --help                    Show help.\n\nCommands:\n  export [options] [sessionId]  Export a session as a ZIP archive.\n  provider                      Manage LLM providers non-interactively.\n  acp [options]                 Run kimi-code as an Agent Client Protocol (ACP) server over stdio.\n  server                        Run the local Kimi server (REST + WebSocket + web UI).\n  web [options]                 Open the Kimi web UI (starts a background daemon if needed).\n  login                         Authenticate with Kimi Code CLI via the device-code flow.\n  doctor                        Validate Kimi Code configuration files.\n  vis [options] [sessionId]     Launch the session visualizer in your browser.\n  migrate                       Migrate data from a legacy kimi-cli installation into kimi-code.\n  upgrade                       Upgrade Kimi Code to the latest version.\n\nDocumentation:        https://moonshotai.github.io/kimi-code/\n\n",
  "stderr": ""
}
```
### 失败：kimi --wire raw launch
- 错误：closed with 1

```text
{
  "kind": "close",
  "code": 1,
  "durationMs": 396,
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
  "durationMs": 1020,
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
  "durationMs": 1242,
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
  "version": "0.9.4",
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
  "durationMs": 47,
  "stdout": "55f86564 2026-06-17 23:50:24 +0800 ci: release packages (#856)",
  "stderr": ""
}
```
### 通过：official packages/node-sdk build

```text
{
  "command": "pnpm --filter @moonshot-ai/kimi-code-sdk build",
  "cwd": "C:\\Users\\Administrator\\AppData\\Local\\Temp\\kimix-kimi-code-research",
  "code": 0,
  "timedOut": false,
  "durationMs": 7914,
  "stdout": "\n> @moonshot-ai/kimi-code-sdk@0.9.4 build C:\\Users\\Administrator\\AppData\\Local\\Temp\\kimix-kimi-code-research\\packages\\node-sdk\n> tsdown && pnpm run build:dts\n\nℹ tsdown v0.22.0 powered by rolldown v1.0.1\nℹ config file: C:\\Users\\Administrator\\AppData\\Local\\Temp\\kimix-kimi-code-research\\packages\\node-sdk\\tsdown.config.ts \nℹ entry: ./src/index.ts\nℹ tsconfig: tsconfig.json\nℹ Build start\nℹ Cleaning 8 files\nℹ Hint: consider adding deps.onlyBundle option to avoid unintended bundling of dependencies, or set deps.onlyBundle: false to disable this hint.\nSee more at https://tsdown.dev/options/dependencies#deps-onlybundle\nDetected dependencies in bundle:\n- pathe\n- @anthropic-ai/sdk\n- standardwebhooks\n- @stablelib/base64\n- fast-sha256\n- retry\n- p-retry\n- extend\n- gaxios\n- bignumber.js\n- json-bigint\n- gcp-metadata\n- google-logging-utils\n- base64-js\n- google-auth-library\n- safe-buffer\n- ecdsa-sig-formatter\n- jws\n- buffer-equal-constant-time\n- jwa\n- ws\n- @google/genai\n- openai\n- nunjucks\n- asap\n- a-sync-waterfall\n- readdirp\n- chokidar\n- picomatch\n- js-yaml\n- object-keys\n- es-define-property\n- es-errors\n- gopd\n- define-data-property\n- has-property-descriptors\n- define-properties\n- es-object-atoms\n- math-intrinsics\n- has-symbols\n- get-proto\n- function-bind\n- call-bind-apply-helpers\n- dunder-proto\n- hasown\n- get-intrinsic\n- set-function-length\n- call-bind\n- call-bound\n- es-abstract\n- is-callable\n- for-each\n- has-tostringtag\n- is-regex\n- safe-regex-test\n- regexp.escape\n- ajv\n- fast-deep-equal\n- json-schema-traverse\n- fast-uri\n- ajv-formats\n- ulid\n- pkce-challenge\n- @modelcontextprotocol/sdk\n- tar\n- pend\n- yauzl\n- buffer-crc32\n- zod-to-json-schema\n- eventsource-parser\n- eventsource\n- undici\n- smart-buffer\n- socks\n- ip-address\n- isexe\n- which\n- path-key\n- cross-spawn\n- shebang-regex\n- shebang-command\n- @mozilla/readability\n- linkedom\n- entities\n- htmlparser2\n- domelementtype\n- domhandler\n- dom-serializer\n- domutils\n- boolbase\n- css-what\n- css-select\n- nth-check\n- uhyphen\n- cssom\n- graceful-fs\n- signal-exit\n- proper-lockfile\n- ignore\n- ms\n- debug\n- has-flag\n- supports-color\n- agent-base\n- https-proxy-agent\n- web-streams-polyfill\n- fetch-blob\n- formdata-polyfill\n- node-domexception\n- node-pty\n- node-fetch\n- data-uri-to-buffer\nℹ dist\\index.mjs                        5.93 MB\nℹ dist\\from--FGcjEDx.mjs              171.67 kB │ gzip: 30.00 kB\nℹ dist\\src-Bf8NCZnY.mjs                43.02 kB │ gzip: 11.38 kB\nℹ dist\\lib-uthR5TlF.mjs                40.61 kB │ gzip:  9.13 kB\nℹ dist\\dist-lcz-lC-K.mjs               38.15 kB │ gzip: 10.69 kB\nℹ dist\\multipart-parser-CO_QxzY-.mjs    9.00 kB │ gzip:  2.65 kB\nℹ 6 files, total: 6.23 MB\n✔ Build complete in 752ms\n\n> @moonshot-ai/kimi-code-sdk@0.9.4 build:dts C:\\Users\\Administrator\\AppData\\Local\\Temp\\kimix-kimi-code-research\\packages\\node-sdk\n> node scripts/build-dts.mjs\n\n\r\n\u001b[1mapi-extractor 7.58.7 \u001b[36m - https://api-extractor.com/\u001b[39m\r\n\u001b[22m\nUsing configuration from ./api-extractor.json\nAnalysis will use the bundled TypeScript version 5.9.3\n*** The target project appears to use TypeScript 6.0.2 which is newer than the bundled compiler engine; consider upgrading API Extractor.\n\r\nAPI Extractor completed successfully\n",
  "stderr": ""
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
  "sessionId": "session_a4a61f42-451c-4245-8eb0-aa9fe0353c39",
  "workDir": "C:/Users/ADMINI~1/AppData/Local/Temp/kimix-kimi-code-sdk-probe/work",
  "model": "kimi-code/kimi-for-coding",
  "sessionDir": "C:\\Users\\Administrator\\.kimi-code\\sessions\\wd_work_bc69271920cd\\session_a4a61f42-451c-4245-8eb0-aa9fe0353c39",
  "wirePath": "C:\\Users\\Administrator\\.kimi-code\\sessions\\wd_work_bc69271920cd\\session_a4a61f42-451c-4245-8eb0-aa9fe0353c39\\agents\\main\\wire.jsonl",
  "wireExists": true
}
```
### 通过：official SDK resume session

```text
{
  "sessionId": "session_a4a61f42-451c-4245-8eb0-aa9fe0353c39",
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
  "eventCount": 29,
  "firstEventMs": 17,
  "firstDeltaMs": 1533,
  "turnStartedMs": 33,
  "endedMs": 1835,
  "turnEnd": {
    "type": "turn.ended",
    "reason": "completed",
    "turnId": 0
  },
  "eventTypeCounts": {
    "session.meta.updated": 1,
    "turn.started": 1,
    "mcp.server.status": 1,
    "tool.list.updated": 1,
    "turn.step.started": 1,
    "thinking.delta": 11,
    "assistant.delta": 10,
    "turn.step.completed": 1,
    "agent.status.updated": 1,
    "turn.ended": 1
  },
  "eventTypePreview": [
    "session.meta.updated",
    "turn.started",
    "mcp.server.status",
    "tool.list.updated",
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
    "assistant.delta",
    "assistant.delta",
    "assistant.delta",
    "assistant.delta"
  ]
}
```
### 通过：official SDK steer same session

```text
{
  "sessionId": "session_a4a61f42-451c-4245-8eb0-aa9fe0353c39",
  "sessionCountBeforeSteer": 9,
  "sessionCountAfterSteer": 9,
  "prompt": {
    "turnId": 1,
    "eventCount": 304,
    "firstEventMs": 32,
    "firstDeltaMs": 1400,
    "turnStartedMs": 54,
    "endedMs": 8863,
    "turnEnd": {
      "type": "turn.ended",
      "reason": "completed",
      "turnId": 1
    },
    "eventTypeCounts": {
      "session.meta.updated": 1,
      "turn.started": 1,
      "turn.step.started": 2,
      "thinking.delta": 55,
      "assistant.delta": 240,
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
  "firstEventMs": 31,
  "turnStartedMs": 41,
  "endedMs": 830,
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
    "eventCount": 964,
    "firstEventMs": 10,
    "firstDeltaMs": 1293,
    "turnStartedMs": 29,
    "endedMs": 26116,
    "turnEnd": {
      "type": "turn.ended",
      "reason": "completed",
      "turnId": 3
    },
    "eventTypeCounts": {
      "session.meta.updated": 1,
      "turn.started": 1,
      "turn.step.started": 2,
      "thinking.delta": 298,
      "tool.call.delta": 21,
      "tool.call.started": 1,
      "tool.result": 1,
      "turn.step.completed": 2,
      "agent.status.updated": 2,
      "assistant.delta": 634,
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
    "eventCount": 306,
    "firstEventMs": 2,
    "firstDeltaMs": 1461,
    "turnStartedMs": 7,
    "endedMs": 9668,
    "turnEnd": {
      "type": "turn.ended",
      "reason": "completed",
      "turnId": 4
    },
    "eventTypeCounts": {
      "session.meta.updated": 1,
      "turn.started": 1,
      "turn.step.started": 2,
      "thinking.delta": 209,
      "tool.call.delta": 74,
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
