# Kimi Code 0.17.1 Server P1 探针结果

- 生成时间：2026-06-18T13:39:24.144Z
- CLI：C:\Users\Administrator\.kimi-code\bin\kimi.exe
- Server：http://127.0.0.1:58639
- 官方源码：C:\Users\Administrator\AppData\Local\Temp\kimix-kimi-code-research
- 结果：10 通过 / 0 失败

## 明细

### 通过：installed CLI version

```json
{
  "code": 0,
  "timedOut": false,
  "durationMs": 373,
  "stdout": "0.17.1\n",
  "stderr": ""
}
```

### 通过：health/meta/auth + OpenAPI/AsyncAPI

```json
{
  "serverId": "01KVDF98X7KRR31AJFZPB5HEZP",
  "serverVersion": "0.0.0",
  "authReady": true,
  "openapiVersion": "0.0.0",
  "openapiPathCount": 57,
  "asyncapiVersion": "0.0.0",
  "asyncapiChannels": [
    "kimiCodeWebSocket"
  ]
}
```

### 通过：session create + snapshot

```json
{
  "sessionId": "session_16035ae5-fd79-498b-ae0d-5f32c20e7a6c",
  "snapshotKeys": [
    "as_of_seq",
    "epoch",
    "session",
    "messages",
    "in_flight_turn",
    "pending_approvals",
    "pending_questions"
  ]
}
```

### 通过：Kimix snapshot replay + session status adapter

```json
{
  "sessionId": "session_481e52cd-9541-4dfc-a1e7-3fe4d8eba3e6",
  "promptId": "prompt_01KVDF99ZDYJQMBQ6ZM12JN1H2",
  "snapshotKeys": [
    "as_of_seq",
    "epoch",
    "session",
    "messages",
    "in_flight_turn",
    "pending_approvals",
    "pending_questions"
  ],
  "snapshotMessageCount": 2,
  "replayPayloadCount": 1,
  "assistantReplay": {
    "snapshotReplay": "history",
    "snapshotRole": "assistant",
    "snapshotMessageId": "msg_session_481e52cd-9541-4dfc-a1e7-3fe4d8eba3e6_000001",
    "textLength": 74,
    "containsMarker": true
  },
  "skipExisting": true,
  "keepMissing": true,
  "sessionStatus": {
    "status": "idle",
    "contextTokens": 20834,
    "maxContextTokens": 262144,
    "contextUsage": 0.07947540283203125,
    "contextFieldsValid": true
  }
}
```

### 通过：Kimix Server BTW adapter

```json
{
  "sessionId": "session_564e819f-278c-4e60-a24e-281d9a679fec",
  "promptId": "prompt_01KVDF9D16MA4WFX5XK2XJ82YT",
  "agentId": "agent-0",
  "frameCount": 45,
  "btwFrameCount": 41,
  "mainContentFrameCount": 0,
  "containsMarker": true,
  "ended": true
}
```

### 通过：Kimix Server task adapter

```json
{
  "sessionId": "session_2c277849-ac4a-4489-9ecc-2af3c038ea37",
  "promptId": "prompt_01KVDF9F2PAJ9C8XYC9YZ3E4F8",
  "taskId": "bash-gmngdwmw",
  "kind": "bash",
  "approvedBashRequests": 0,
  "promptCompletedAfterCancel": true,
  "runningListCount": 1,
  "beforeCancel": {
    "status": "running",
    "outputBytes": 66,
    "hasOutputPreview": true
  },
  "firstCancel": {
    "httpStatus": 200,
    "code": 0,
    "cancelled": true
  },
  "afterCancel": {
    "status": "cancelled",
    "outputBytes": 399,
    "hasOutputPreview": true
  },
  "secondCancel": {
    "httpStatus": 200,
    "code": 40904,
    "cancelled": false
  }
}
```

### 通过：03-refresh-replay.ts

```json
{
  "coverage": "WS 握手、断线重连、seq replay、messages/tasks、prompt",
  "code": 0,
  "timedOut": false,
  "durationMs": 5317,
  "stdout": "▶ server at http://127.0.0.1:58639\n▶ phase 0: server_id=01KVDF98X7KRR31AJFZPB5HEZP version=0.0.0\n▶ phase 0: auth.ready=true\n▶ session session_1465ca5c-683c-44c3-b095-7e2953008ab4 created\n▶ prompt prompt_01KVDF9TGZKX6NMNX9DNZKN1CB completed; maxSeq=13\n▶ refresh #1: caught-up; accepted=[session_1465ca5c-683c-44c3-b095-7e2953008ab4], replayed=0\n▶ refresh #2: replay seq=1..13 (13 events)\n▶ phase 2: messages=2 tasks=0\n▶ phase 5: follow-up prompt completed at seq=21\n✓ 03-refresh-replay: refresh round-trip preserves subscription + replay semantics\n",
  "stderr": ""
}
```

### 通过：08-pending-recovery.ts

```json
{
  "coverage": "approval/question pending 列表与响应闭环",
  "code": 0,
  "timedOut": false,
  "durationMs": 7501,
  "stdout": "▶ server at http://127.0.0.1:58639\n▶ pending: session session_2f649709-ed2c-4aa1-8806-62ebcaf23c41 created\n▶ approval: prompt prompt_01KVDF9ZGCP1M8MJW75GEAR0KY submitted\n▶ approval: pending approval 01KVDFA13MS4V14WPBK5GKKZQK tool=Bash\n▶ approval: prompt completed via prompt.completed\n▶ question: prompt prompt_01KVDFA2DTYFARKN9XW0CH68CT submitted\n▶ question: pending question 01KVDFA49D3PNMEJTWX59GBJTS items=1\n▶ question: prompt completed via prompt.completed\n✓ 08-pending-recovery: pending approvals and questions round-tripped\n",
  "stderr": ""
}
```

### 通过：10-prompt-queue-steer.ts

```json
{
  "coverage": "queued prompt steer 与 WS 事件",
  "code": 0,
  "timedOut": false,
  "durationMs": 2247,
  "stdout": "▶ session session_9d5514cc-ece1-47de-a03d-8c576af4b9ca created\n▶ session session_9d5514cc-ece1-47de-a03d-8c576af4b9ca subscribed\n▶ active prompt injected: prompt_debug_queue_steer_8944\n▶ first prompt queued: prompt_01KVDFA6VSQ8HXVZG6DQ7BC9CP\n▶ second prompt queued: prompt_01KVDFA7157JFP6JFAFXFWCK1S\n▶ queue before steer: prompt_01KVDFA6VSQ8HXVZG6DQ7BC9CP, prompt_01KVDFA7157JFP6JFAFXFWCK1S\n▶ steer response: {\"steered\":true,\"prompt_ids\":[\"prompt_01KVDFA6VSQ8HXVZG6DQ7BC9CP\",\"prompt_01KVDFA7157JFP6JFAFXFWCK1S\"]}\n▶ prompt.steered frame: {\"type\":\"prompt.steered\",\"seq\":9,\"session_id\":\"session_9d5514cc-ece1-47de-a03d-8c576af4b9ca\",\"payload\":{\"type\":\"prompt.steered\",\"agentId\":\"main\",\"sessionId\":\"session_9d5514cc-ece1-47de-a03d-8c576af4b9ca\",\"activePromptId\":\"prompt_debug_queue_steer_8944\",\"promptIds\":[\"prompt_01KVDFA6VSQ8HXVZG6DQ7BC9CP\",\"prompt_01KVDFA7157JFP6JFAFXFWCK1S\"],\"content\":[{\"type\":\"text\",\"text\":\"First queued prompt for server steer.\"},{\"type\":\"text\",\"text\":\"Second queued prompt for server steer.\"}],\"steeredAt\":\"2026-06-18T13:39:17.363Z\"}}\n✓ 10-prompt-queue-steer: queued prompts steered and queue drained\n",
  "stderr": ""
}
```

### 通过：12-send-and-cancel.ts

```json
{
  "coverage": "prompt 完成、queued/active/session cancel 与恢复",
  "code": 0,
  "timedOut": false,
  "durationMs": 6206,
  "stdout": "▶ session session_d79716c2-58c5-45af-a516-adb7cea599b7 created\n▶ session session_d79716c2-58c5-45af-a516-adb7cea599b7 subscribed\n▶ prompt completed: prompt_01KVDFA913YV8CG6C4GHM9QZFE\n▶ injected active prompt for queued cancel: prompt_debug_cancel_queued_23108\n▶ queued prompt submitted: prompt_01KVDFAAZQGBYEEB46ZNZN72VX\n▶ abort queued response: {\"aborted\":true}\n▶ prompt.aborted frame received for queued prompt prompt_01KVDFAAZQGBYEEB46ZNZN72VX\n▶ injected active prompt for session abort: prompt_debug_cancel_session_23108\n▶ session abort response: {\"aborted\":true}\n▶ prompt.aborted frame received for session-aborted prompt prompt_debug_cancel_session_23108\n▶ injected active prompt for repeated ESC: prompt_debug_repeated_esc_23108\n▶ first ESC abort response: {\"aborted\":true}\n▶ prompt.aborted frame received for repeated ESC prompt prompt_debug_repeated_esc_23108\n▶ second ESC abort returned 40903 as expected\n▶ injected active prompt for repeated session abort: prompt_debug_repeated_session_abort_23108\n▶ first session-level ESC abort response: {\"aborted\":true}\n▶ second session-level ESC abort response: {\"aborted\":true}\n▶ third session-level ESC abort response: {\"aborted\":true}\n▶ repeated session-level ESC produced exactly one prompt.aborted frame\n▶ recovered prompt completed: prompt_01KVDFAC1GH3MY6YJB4ZBX4FQ4\n✓ 12-send-and-cancel: submit + abort round-trips succeeded\n",
  "stderr": ""
}
```

## 结论

- Server REST、WebSocket、事件重放、快照、prompt、steer、cancel、approval 和 question 均由官方 server-e2e 场景验证。
- Kimix snapshot replay 与 session status adapter 已用真实 Server session / prompt 验证：history replay 可去重补偿，context tokens/limit/usage 可回填现有 ContextRing。
- Kimix Server BTW adapter 已用真实 Server session 验证：`:btw` 返回独立 agent_id，prompt 事件只归属该子 Agent，可按 Agent ID 隔离并汇总而不污染主对话。
- Kimix Server task adapter 已用真实 Server session / Bash background task 验证：list/get/cancel、输出元数据和 already-finished 幂等停止均可被 Kimix 现有后台任务接口承接。
- 当前 0.17.1 native CLI 的 `/meta` 与 OpenAPI 自报版本为 `0.0.0`；P2 必须按 endpoint / contract capability 探测，不能只按 server_version 判断。
- P2 可在实验开关后新增 Kimix Server Host；现有 vendored SDK Host 继续作为默认与回滚路径。

## P3 Kimix 接入复验（2026-06-18）

- 跨工作区会话：实验路由下 `listSessions({})` 改走 Server 全局列表，现有 UI 的“全部工作目录”入口可复用。
- 官方 fork / 子会话：fork、children list/create 已接入主进程与 preload API。
- 任务管理：Server task list/get/cancel 已接入现有 Kimix 后台任务接口；主探针会真实启动、读取、取消一个 running bash 后台任务，并复验重复停止的 already-finished 语义。
- 终端管理：terminal list 真实读取通过，create/list/close 与 WS attach/detach/input/resize 已接入主进程与 preload API。
- Windows 限制：本机 0.17.1 CLI 调用 terminal create 时返回 `Failed to load native module: conpty.node`，说明接口存在但当前安装包缺少可加载的 Windows ConPTY native 模块；Kimix 将该上游错误归一为可读中文提示并保留原始错误，不伪装为成功。
- 断线重放：Kimix 客户端携带 cursor 重连并触发 snapshot 恢复；history replay 已增加去重补偿，in-flight replay 用于恢复断线中正在生成的正文。
