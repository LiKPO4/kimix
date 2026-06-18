# Kimi Code 0.17.1 Server P1 探针结果

- 生成时间：2026-06-18T02:09:48.463Z
- CLI：C:\Users\Administrator\.kimi-code\bin\kimi.exe
- Server：http://127.0.0.1:58639
- 官方源码：C:\Users\Administrator\AppData\Local\Temp\kimix-kimi-code-research
- 结果：7 通过 / 0 失败

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
  "serverId": "01KVC7TXNQYDP5PKN8KMBNHWJ4",
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
  "sessionId": "session_7eb28723-b99b-461e-9a47-a2e6694be40f",
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

### 通过：03-refresh-replay.ts

```json
{
  "coverage": "WS 握手、断线重连、seq replay、messages/tasks、prompt",
  "code": 0,
  "timedOut": false,
  "durationMs": 6047,
  "stdout": "▶ server at http://127.0.0.1:58639\n▶ phase 0: server_id=01KVC7TXNQYDP5PKN8KMBNHWJ4 version=0.0.0\n▶ phase 0: auth.ready=true\n▶ session session_43626284-0eef-476d-8a44-472043a560ff created\n▶ prompt prompt_01KVC7TZRHZBW5QAN08QE42AWP completed; maxSeq=13\n▶ refresh #1: caught-up; accepted=[session_43626284-0eef-476d-8a44-472043a560ff], replayed=0\n▶ refresh #2: replay seq=1..13 (13 events)\n▶ phase 2: messages=2 tasks=0\n▶ phase 5: follow-up prompt completed at seq=21\n✓ 03-refresh-replay: refresh round-trip preserves subscription + replay semantics\n",
  "stderr": ""
}
```

### 通过：08-pending-recovery.ts

```json
{
  "coverage": "approval/question pending 列表与响应闭环",
  "code": 0,
  "timedOut": false,
  "durationMs": 11304,
  "stdout": "▶ server at http://127.0.0.1:58639\n▶ pending: session session_9de9b9cc-3271-44fa-bca3-a3237c4a5df8 created\n▶ approval: prompt prompt_01KVC7V5K9Q9A95PG5HAC6K3VR submitted\n▶ approval: pending approval 01KVC7V8PRNSVS0XFPQ5G2WFGJ tool=Bash\n▶ approval: prompt completed via prompt.completed\n▶ question: prompt prompt_01KVC7VAN4RPH4JD0RR3BS5E6V submitted\n▶ question: pending question 01KVC7VDPHD1SPXTZVH839KJJY items=1\n▶ question: prompt completed via prompt.completed\n✓ 08-pending-recovery: pending approvals and questions round-tripped\n",
  "stderr": ""
}
```

### 通过：10-prompt-queue-steer.ts

```json
{
  "coverage": "queued prompt steer 与 WS 事件",
  "code": 0,
  "timedOut": false,
  "durationMs": 2045,
  "stdout": "▶ session session_a4ca9e8f-c869-4f94-9ae8-0cbc4385c701 created\n▶ session session_a4ca9e8f-c869-4f94-9ae8-0cbc4385c701 subscribed\n▶ active prompt injected: prompt_debug_queue_steer_28240\n▶ first prompt queued: prompt_01KVC7VGNPQCMR881M77209RJB\n▶ second prompt queued: prompt_01KVC7VGS5W98RQSNED15XDY3J\n▶ queue before steer: prompt_01KVC7VGNPQCMR881M77209RJB, prompt_01KVC7VGS5W98RQSNED15XDY3J\n▶ steer response: {\"steered\":true,\"prompt_ids\":[\"prompt_01KVC7VGNPQCMR881M77209RJB\",\"prompt_01KVC7VGS5W98RQSNED15XDY3J\"]}\n▶ prompt.steered frame: {\"type\":\"prompt.steered\",\"seq\":9,\"session_id\":\"session_a4ca9e8f-c869-4f94-9ae8-0cbc4385c701\",\"payload\":{\"type\":\"prompt.steered\",\"agentId\":\"main\",\"sessionId\":\"session_a4ca9e8f-c869-4f94-9ae8-0cbc4385c701\",\"activePromptId\":\"prompt_debug_queue_steer_28240\",\"promptIds\":[\"prompt_01KVC7VGNPQCMR881M77209RJB\",\"prompt_01KVC7VGS5W98RQSNED15XDY3J\"],\"content\":[{\"type\":\"text\",\"text\":\"First queued prompt for server steer.\"},{\"type\":\"text\",\"text\":\"Second queued prompt for server steer.\"}],\"steeredAt\":\"2026-06-18T02:09:41.316Z\"}}\n✓ 10-prompt-queue-steer: queued prompts steered and queue drained\n",
  "stderr": ""
}
```

### 通过：12-send-and-cancel.ts

```json
{
  "coverage": "prompt 完成、queued/active/session cancel 与恢复",
  "code": 0,
  "timedOut": false,
  "durationMs": 6715,
  "stdout": "▶ session session_b5f7143b-c334-45e3-a9ba-930b04e8e71a created\n▶ session session_b5f7143b-c334-45e3-a9ba-930b04e8e71a subscribed\n▶ prompt completed: prompt_01KVC7VJM048XWVJNZNEPTDFJ6\n▶ injected active prompt for queued cancel: prompt_debug_cancel_queued_17688\n▶ queued prompt submitted: prompt_01KVC7VN6XXV8CTHRYM7JF5RRQ\n▶ abort queued response: {\"aborted\":true}\n▶ prompt.aborted frame received for queued prompt prompt_01KVC7VN6XXV8CTHRYM7JF5RRQ\n▶ injected active prompt for session abort: prompt_debug_cancel_session_17688\n▶ session abort response: {\"aborted\":true}\n▶ prompt.aborted frame received for session-aborted prompt prompt_debug_cancel_session_17688\n▶ injected active prompt for repeated ESC: prompt_debug_repeated_esc_17688\n▶ first ESC abort response: {\"aborted\":true}\n▶ prompt.aborted frame received for repeated ESC prompt prompt_debug_repeated_esc_17688\n▶ second ESC abort returned 40903 as expected\n▶ injected active prompt for repeated session abort: prompt_debug_repeated_session_abort_17688\n▶ first session-level ESC abort response: {\"aborted\":true}\n▶ second session-level ESC abort response: {\"aborted\":true}\n▶ third session-level ESC abort response: {\"aborted\":true}\n▶ repeated session-level ESC produced exactly one prompt.aborted frame\n▶ recovered prompt completed: prompt_01KVC7VP1PET3AZKXBS18D3AJW\n✓ 12-send-and-cancel: submit + abort round-trips succeeded\n",
  "stderr": ""
}
```

## 结论

- Server REST、WebSocket、事件重放、快照、prompt、steer、cancel、approval 和 question 均由官方 server-e2e 场景验证。
- 当前 0.17.1 native CLI 的 `/meta` 与 OpenAPI 自报版本为 `0.0.0`；P2 必须按 endpoint / contract capability 探测，不能只按 server_version 判断。
- P2 可在实验开关后新增 Kimix Server Host；现有 vendored SDK Host 继续作为默认与回滚路径。
