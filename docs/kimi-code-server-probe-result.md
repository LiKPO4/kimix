# Kimi Code 0.17.1 Server P1 探针结果

- 生成时间：2026-06-18T08:17:08.618Z
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
  "durationMs": 415,
  "stdout": "0.17.1\n",
  "stderr": ""
}
```

### 通过：health/meta/auth + OpenAPI/AsyncAPI

```json
{
  "serverId": "01KVCWV6D4CS0EAMS2MRPCDTV0",
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
  "sessionId": "session_f3472d32-c2b3-4137-a6cf-98d92dc7d1d3",
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
  "sessionId": "session_9b49de77-3d7f-4df8-a43b-e39d7b9145fd",
  "promptId": "prompt_01KVCWV7EJDGTV72T72D054D1C",
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
    "snapshotMessageId": "msg_session_9b49de77-3d7f-4df8-a43b-e39d7b9145fd_000001",
    "textLength": 109,
    "containsMarker": true
  },
  "skipExisting": true,
  "keepMissing": true,
  "sessionStatus": {
    "status": "idle",
    "contextTokens": 20833,
    "maxContextTokens": 262144,
    "contextUsage": 0.07947158813476562,
    "contextFieldsValid": true
  }
}
```

### 通过：Kimix Server BTW adapter

```json
{
  "sessionId": "session_2d1d0b07-0a0a-45e6-9f3b-6a69ce7aaf95",
  "promptId": "prompt_01KVCWVANEQQG6BKXK7Y1F5E5C",
  "agentId": "agent-0",
  "frameCount": 48,
  "btwFrameCount": 44,
  "mainContentFrameCount": 0,
  "containsMarker": true,
  "ended": true
}
```

### 通过：Kimix Server task adapter

```json
{
  "sessionId": "session_d77f9eae-a4a4-4bd2-8009-0d7b01310ed1",
  "promptId": "prompt_01KVCWVCRJTQKD9N5J4NXZK3FH",
  "taskId": "bash-97uof385",
  "kind": "bash",
  "approvedBashRequests": 1,
  "promptCompletedAfterCancel": true,
  "runningListCount": 1,
  "beforeCancel": {
    "status": "running",
    "outputBytes": 0,
    "hasOutputPreview": false
  },
  "firstCancel": {
    "httpStatus": 200,
    "code": 0,
    "cancelled": true
  },
  "afterCancel": {
    "status": "cancelled",
    "outputBytes": 331,
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
  "durationMs": 4948,
  "stdout": "▶ server at http://127.0.0.1:58639\n▶ phase 0: server_id=01KVCWV6D4CS0EAMS2MRPCDTV0 version=0.0.0\n▶ phase 0: auth.ready=true\n▶ session session_28cc7fcb-d0f7-483f-a320-49c2031780ab created\n▶ prompt prompt_01KVCWVQWMZDEC4A3BGAC848E1 completed; maxSeq=13\n▶ refresh #1: caught-up; accepted=[session_28cc7fcb-d0f7-483f-a320-49c2031780ab], replayed=0\n▶ refresh #2: replay seq=1..13 (13 events)\n▶ phase 2: messages=2 tasks=0\n▶ phase 5: follow-up prompt completed at seq=21\n✓ 03-refresh-replay: refresh round-trip preserves subscription + replay semantics\n",
  "stderr": ""
}
```

### 通过：08-pending-recovery.ts

```json
{
  "coverage": "approval/question pending 列表与响应闭环",
  "code": 0,
  "timedOut": false,
  "durationMs": 8104,
  "stdout": "▶ server at http://127.0.0.1:58639\n▶ pending: session session_c5dd0e5c-23df-4a54-bd34-3aa801361de7 created\n▶ approval: prompt prompt_01KVCWVWQJH0PPVYPZYSC5YYCV submitted\n▶ approval: pending approval 01KVCWVYS1ZEE3W8XEVK72SFT2 tool=Bash\n▶ approval: prompt completed via prompt.completed\n▶ question: prompt prompt_01KVCWW0760K5N5GPSR4PV6HR2 submitted\n▶ question: pending question 01KVCWW1X6M00X4466MXBK7TV4 items=1\n▶ question: prompt completed via prompt.completed\n✓ 08-pending-recovery: pending approvals and questions round-tripped\n",
  "stderr": ""
}
```

### 通过：10-prompt-queue-steer.ts

```json
{
  "coverage": "queued prompt steer 与 WS 事件",
  "code": 0,
  "timedOut": false,
  "durationMs": 2211,
  "stdout": "▶ session session_9cd14b91-a86b-4c20-904c-d67ad8c0d862 created\n▶ session session_9cd14b91-a86b-4c20-904c-d67ad8c0d862 subscribed\n▶ active prompt injected: prompt_debug_queue_steer_9324\n▶ first prompt queued: prompt_01KVCWW4NXTKK1QFDK5QFDTCK9\n▶ second prompt queued: prompt_01KVCWW4TEBWH4MG07A9CPAJZH\n▶ queue before steer: prompt_01KVCWW4NXTKK1QFDK5QFDTCK9, prompt_01KVCWW4TEBWH4MG07A9CPAJZH\n▶ steer response: {\"steered\":true,\"prompt_ids\":[\"prompt_01KVCWW4NXTKK1QFDK5QFDTCK9\",\"prompt_01KVCWW4TEBWH4MG07A9CPAJZH\"]}\n▶ prompt.steered frame: {\"type\":\"prompt.steered\",\"seq\":9,\"session_id\":\"session_9cd14b91-a86b-4c20-904c-d67ad8c0d862\",\"payload\":{\"type\":\"prompt.steered\",\"agentId\":\"main\",\"sessionId\":\"session_9cd14b91-a86b-4c20-904c-d67ad8c0d862\",\"activePromptId\":\"prompt_debug_queue_steer_9324\",\"promptIds\":[\"prompt_01KVCWW4NXTKK1QFDK5QFDTCK9\",\"prompt_01KVCWW4TEBWH4MG07A9CPAJZH\"],\"content\":[{\"type\":\"text\",\"text\":\"First queued prompt for server steer.\"},{\"type\":\"text\",\"text\":\"Second queued prompt for server steer.\"}],\"steeredAt\":\"2026-06-18T08:17:01.957Z\"}}\n✓ 10-prompt-queue-steer: queued prompts steered and queue drained\n",
  "stderr": ""
}
```

### 通过：12-send-and-cancel.ts

```json
{
  "coverage": "prompt 完成、queued/active/session cancel 与恢复",
  "code": 0,
  "timedOut": false,
  "durationMs": 6140,
  "stdout": "▶ session session_7c5c8cdc-d02d-465f-8d99-a5122502d6cd created\n▶ session session_7c5c8cdc-d02d-465f-8d99-a5122502d6cd subscribed\n▶ prompt completed: prompt_01KVCWW6V3Z0827ZS4J47YA12G\n▶ injected active prompt for queued cancel: prompt_debug_cancel_queued_9456\n▶ queued prompt submitted: prompt_01KVCWW8SB8BSGFNKSJT7A68D2\n▶ abort queued response: {\"aborted\":true}\n▶ prompt.aborted frame received for queued prompt prompt_01KVCWW8SB8BSGFNKSJT7A68D2\n▶ injected active prompt for session abort: prompt_debug_cancel_session_9456\n▶ session abort response: {\"aborted\":true}\n▶ prompt.aborted frame received for session-aborted prompt prompt_debug_cancel_session_9456\n▶ injected active prompt for repeated ESC: prompt_debug_repeated_esc_9456\n▶ first ESC abort response: {\"aborted\":true}\n▶ prompt.aborted frame received for repeated ESC prompt prompt_debug_repeated_esc_9456\n▶ second ESC abort returned 40903 as expected\n▶ injected active prompt for repeated session abort: prompt_debug_repeated_session_abort_9456\n▶ first session-level ESC abort response: {\"aborted\":true}\n▶ second session-level ESC abort response: {\"aborted\":true}\n▶ third session-level ESC abort response: {\"aborted\":true}\n▶ repeated session-level ESC produced exactly one prompt.aborted frame\n▶ recovered prompt completed: prompt_01KVCWW9QMV86FC538E2ANJ78C\n✓ 12-send-and-cancel: submit + abort round-trips succeeded\n",
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
