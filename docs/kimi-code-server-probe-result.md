# Kimi Code 0.17.1 Server P1 探针结果

- 生成时间：2026-06-18T07:43:26.891Z
- CLI：C:\Users\Administrator\.kimi-code\bin\kimi.exe
- Server：http://127.0.0.1:58639
- 官方源码：C:\Users\Administrator\AppData\Local\Temp\kimix-kimi-code-research
- 结果：9 通过 / 0 失败

## 明细

### 通过：installed CLI version

```json
{
  "code": 0,
  "timedOut": false,
  "durationMs": 420,
  "stdout": "0.17.1\n",
  "stderr": ""
}
```

### 通过：health/meta/auth + OpenAPI/AsyncAPI

```json
{
  "serverId": "01KVCTXB9HWDXJGWTNGJ8D8EXX",
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
  "sessionId": "session_df8b8a26-1681-4f89-9d6a-28a9c3e6d88d",
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

### 通过：Kimix snapshot replay adapter

```json
{
  "sessionId": "session_3a868501-f617-4fb5-a8d7-dd762024b928",
  "promptId": "prompt_01KVCTXCC7KFEW1BS31X7DBZWY",
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
    "snapshotMessageId": "msg_session_3a868501-f617-4fb5-a8d7-dd762024b928_000001",
    "textLength": 58,
    "containsMarker": true
  },
  "skipExisting": true,
  "keepMissing": true
}
```

### 通过：Kimix Server task adapter

```json
{
  "sessionId": "session_edf47e9d-fc03-4f65-956c-1d6ff960c960",
  "promptId": "prompt_01KVCTXFH1NY7AV57FB1YCW5MX",
  "taskId": "bash-xx217by7",
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
  "durationMs": 5236,
  "stdout": "▶ server at http://127.0.0.1:58639\n▶ phase 0: server_id=01KVCTXB9HWDXJGWTNGJ8D8EXX version=0.0.0\n▶ phase 0: auth.ready=true\n▶ session session_5e90cba2-d36c-4bcd-ae3c-4c25c80103bd created\n▶ prompt prompt_01KVCTXWXXCT67E9A9QRYQQ0BA completed; maxSeq=13\n▶ refresh #1: caught-up; accepted=[session_5e90cba2-d36c-4bcd-ae3c-4c25c80103bd], replayed=0\n▶ refresh #2: replay seq=1..13 (13 events)\n▶ phase 2: messages=2 tasks=0\n▶ phase 5: follow-up prompt completed at seq=21\n✓ 03-refresh-replay: refresh round-trip preserves subscription + replay semantics\n",
  "stderr": ""
}
```

### 通过：08-pending-recovery.ts

```json
{
  "coverage": "approval/question pending 列表与响应闭环",
  "code": 0,
  "timedOut": false,
  "durationMs": 11608,
  "stdout": "▶ server at http://127.0.0.1:58639\n▶ pending: session session_551d1ea9-3018-486e-8434-b72b1c2433e5 created\n▶ approval: prompt prompt_01KVCTY1ZM7PPJ79CT6VXV5EBN submitted\n▶ approval: pending approval 01KVCTY4PVQ9A5X75D5B2GXVW7 tool=Bash\n▶ approval: prompt completed via prompt.completed\n▶ question: prompt prompt_01KVCTY6S3SKWWYSCBZTY3RWMD submitted\n▶ question: pending question 01KVCTYA78PCQSF61CZKY23S8T items=1\n▶ question: prompt completed via prompt.completed\n✓ 08-pending-recovery: pending approvals and questions round-tripped\n",
  "stderr": ""
}
```

### 通过：10-prompt-queue-steer.ts

```json
{
  "coverage": "queued prompt steer 与 WS 事件",
  "code": 0,
  "timedOut": false,
  "durationMs": 2252,
  "stdout": "▶ session session_f8a7fe62-dd1c-44d3-9087-70c0eb941bb0 created\n▶ session session_f8a7fe62-dd1c-44d3-9087-70c0eb941bb0 subscribed\n▶ active prompt injected: prompt_debug_queue_steer_2440\n▶ first prompt queued: prompt_01KVCTYDA448RFRR4ZJQ8VWN1A\n▶ second prompt queued: prompt_01KVCTYDESVJGN324R19BGQNX7\n▶ queue before steer: prompt_01KVCTYDA448RFRR4ZJQ8VWN1A, prompt_01KVCTYDESVJGN324R19BGQNX7\n▶ steer response: {\"steered\":true,\"prompt_ids\":[\"prompt_01KVCTYDA448RFRR4ZJQ8VWN1A\",\"prompt_01KVCTYDESVJGN324R19BGQNX7\"]}\n▶ prompt.steered frame: {\"type\":\"prompt.steered\",\"seq\":9,\"session_id\":\"session_f8a7fe62-dd1c-44d3-9087-70c0eb941bb0\",\"payload\":{\"type\":\"prompt.steered\",\"agentId\":\"main\",\"sessionId\":\"session_f8a7fe62-dd1c-44d3-9087-70c0eb941bb0\",\"activePromptId\":\"prompt_debug_queue_steer_2440\",\"promptIds\":[\"prompt_01KVCTYDA448RFRR4ZJQ8VWN1A\",\"prompt_01KVCTYDESVJGN324R19BGQNX7\"],\"content\":[{\"type\":\"text\",\"text\":\"First queued prompt for server steer.\"},{\"type\":\"text\",\"text\":\"Second queued prompt for server steer.\"}],\"steeredAt\":\"2026-06-18T07:43:19.181Z\"}}\n✓ 10-prompt-queue-steer: queued prompts steered and queue drained\n",
  "stderr": ""
}
```

### 通过：12-send-and-cancel.ts

```json
{
  "coverage": "prompt 完成、queued/active/session cancel 与恢复",
  "code": 0,
  "timedOut": false,
  "durationMs": 7141,
  "stdout": "▶ session session_ca5340ef-ed3d-456e-97b7-a76885df1ca5 created\n▶ session session_ca5340ef-ed3d-456e-97b7-a76885df1ca5 subscribed\n▶ prompt completed: prompt_01KVCTYFHEGQGBHD1F5E29EXPJ\n▶ injected active prompt for queued cancel: prompt_debug_cancel_queued_8988\n▶ queued prompt submitted: prompt_01KVCTYJ5CQ3BRGJC1C89AKSSQ\n▶ abort queued response: {\"aborted\":true}\n▶ prompt.aborted frame received for queued prompt prompt_01KVCTYJ5CQ3BRGJC1C89AKSSQ\n▶ injected active prompt for session abort: prompt_debug_cancel_session_8988\n▶ session abort response: {\"aborted\":true}\n▶ prompt.aborted frame received for session-aborted prompt prompt_debug_cancel_session_8988\n▶ injected active prompt for repeated ESC: prompt_debug_repeated_esc_8988\n▶ first ESC abort response: {\"aborted\":true}\n▶ prompt.aborted frame received for repeated ESC prompt prompt_debug_repeated_esc_8988\n▶ second ESC abort returned 40903 as expected\n▶ injected active prompt for repeated session abort: prompt_debug_repeated_session_abort_8988\n▶ first session-level ESC abort response: {\"aborted\":true}\n▶ second session-level ESC abort response: {\"aborted\":true}\n▶ third session-level ESC abort response: {\"aborted\":true}\n▶ repeated session-level ESC produced exactly one prompt.aborted frame\n▶ recovered prompt completed: prompt_01KVCTYK325E0Y6TNS978H9S2A\n✓ 12-send-and-cancel: submit + abort round-trips succeeded\n",
  "stderr": ""
}
```

## 结论

- Server REST、WebSocket、事件重放、快照、prompt、steer、cancel、approval 和 question 均由官方 server-e2e 场景验证。
- Kimix snapshot replay adapter 已用真实 Server session / prompt / snapshot 验证：history replay 有稳定标记，renderer 可跳过已存在内容并补入缺失内容。
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
