# Kimi Code 0.26.0 Server 探针结果

- 生成时间：2026-07-16T14:14:21.833Z
- CLI：C:\Users\Administrator\.kimi-code\bin\kimi.exe
- Server：http://127.0.0.1:58639
- 官方源码：C:\Users\Administrator\AppData\Local\Temp\kimix-kimi-code-research
- 结果：6 通过 / 0 失败 / 4 跳过

## 明细

### 通过：installed CLI version

```json
{
  "code": 0,
  "timedOut": false,
  "durationMs": 553,
  "stdout": "0.26.0\n",
  "stderr": ""
}
```

### 通过：health/meta/auth + OpenAPI/AsyncAPI

```json
{
  "serverId": "01KXNME19ENHZ9AWPJKJVZGFQ5",
  "serverVersion": "0.26.0",
  "authReady": true,
  "openapiVersion": "0.26.0",
  "openapiPathCount": 66,
  "asyncapiVersion": "0.26.0",
  "asyncapiChannels": [
    "kimiCodeWebSocket"
  ]
}
```

### 通过：session create + snapshot

```json
{
  "sessionId": "session_a706ceff-0e75-43c1-b698-70724eb6dea9",
  "snapshotKeys": [
    "as_of_seq",
    "epoch",
    "session",
    "messages",
    "in_flight_turn",
    "subagents",
    "pending_approvals",
    "pending_questions"
  ]
}
```

### 通过：Kimix snapshot replay + session status adapter

```json
{
  "sessionId": "session_244b36b0-cbec-46bc-b2c7-5ee4c4952eb9",
  "promptId": "msg_01KXNME2V36K39GKYHF4HXX4BP",
  "snapshotKeys": [
    "as_of_seq",
    "epoch",
    "session",
    "messages",
    "in_flight_turn",
    "subagents",
    "pending_approvals",
    "pending_questions"
  ],
  "snapshotMessageCount": 2,
  "replayPayloadCount": 1,
  "assistantReplay": {
    "snapshotReplay": "history",
    "snapshotRole": "assistant",
    "snapshotMessageId": "msg_session_244b36b0-cbec-46bc-b2c7-5ee4c4952eb9_000001",
    "textLength": 135,
    "containsMarker": true
  },
  "skipExisting": true,
  "keepMissing": true,
  "sessionStatus": {
    "contextTokens": 26804,
    "maxContextTokens": 262144,
    "contextUsage": 0.1022491455078125,
    "contextFieldsValid": true
  }
}
```

### 通过：Kimix Server BTW adapter

```json
{
  "sessionId": "session_3b58f67d-e771-4ed2-b158-456ab47e5f74",
  "promptId": "msg_01KXNME7JNH2DDGESTHQ0ZVA62",
  "agentId": "agent-0",
  "frameCount": 27,
  "btwFrameCount": 24,
  "mainContentFrameCount": 0,
  "containsMarker": true,
  "ended": true
}
```

### 通过：Kimix Server task adapter

```json
{
  "sessionId": "session_ae80003a-4838-44d0-b5af-b1f01289acf5",
  "promptId": "msg_01KXNME9Z9EAPBVMHK1T6SS3D3",
  "taskId": "bash-kslbezt4",
  "kind": "bash",
  "approvedBashRequests": 0,
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
    "outputBytes": 0,
    "hasOutputPreview": false
  },
  "secondCancel": {
    "httpStatus": 200,
    "code": 40904,
    "cancelled": false
  }
}
```

### 跳过：03-refresh-replay.ts

```json
{
  "skipped": true,
  "coverage": "WS 握手、断线重连、seq replay、messages/tasks、prompt",
  "reason": "upstream removed @moonshot-ai/server-e2e (agent-core-v2 default since 0.24)"
}
```

### 跳过：08-pending-recovery.ts

```json
{
  "skipped": true,
  "coverage": "approval/question pending 列表与响应闭环",
  "reason": "upstream removed @moonshot-ai/server-e2e (agent-core-v2 default since 0.24)"
}
```

### 跳过：10-prompt-queue-steer.ts

```json
{
  "skipped": true,
  "coverage": "queued prompt steer 与 WS 事件",
  "reason": "upstream removed @moonshot-ai/server-e2e (agent-core-v2 default since 0.24)"
}
```

### 跳过：12-send-and-cancel.ts

```json
{
  "skipped": true,
  "coverage": "prompt 完成、queued/active/session cancel 与恢复",
  "reason": "upstream removed @moonshot-ai/server-e2e (agent-core-v2 default since 0.24)"
}
```

## 结论

- 官方 0.24+ 已移除 @moonshot-ai/server-e2e 场景包；刷新重放、pending 闭环、队列 steer、cancel 语义改由 Kimix 自有回归与适配器检查覆盖。
- Kimix snapshot replay 与 session status adapter 已用真实 Server session / prompt 验证：history replay 可去重补偿，context tokens/limit/usage 可回填现有 ContextRing。
- Kimix Server BTW adapter 已用真实 Server session 验证：`:btw` 返回独立 agent_id，prompt 事件只归属该子 Agent，可按 Agent ID 隔离并汇总而不污染主对话。
- Kimix Server task adapter 已用真实 Server session / Bash background task 验证：list/get/cancel、输出元数据和 already-finished 幂等停止均可被 Kimix 现有后台任务接口承接。
- REST 与 WebSocket 默认要求 `~/.kimi-code/server.token` 鉴权（REST 走 authorization 头，WS 走 ?token= 查询参数）；`/meta` 自报 server_version、capabilities 与 backend 字段。

