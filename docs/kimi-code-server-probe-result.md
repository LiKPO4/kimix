# Kimi Code 0.17.1 Server P1 探针结果

- 生成时间：2026-06-18T06:57:44.901Z
- CLI：C:\Users\Administrator\.kimi-code\bin\kimi.exe
- Server：http://127.0.0.1:58639
- 官方源码：C:\Users\Administrator\AppData\Local\Temp\kimix-kimi-code-research
- 结果：8 通过 / 0 失败

## 明细

### 通过：installed CLI version

```json
{
  "code": 0,
  "timedOut": false,
  "durationMs": 414,
  "stdout": "0.17.1\n",
  "stderr": ""
}
```

### 通过：health/meta/auth + OpenAPI/AsyncAPI

```json
{
  "serverId": "01KVCRA0CEMVQA8CF47WB45PE3",
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
  "sessionId": "session_3ffa302e-d7b9-4d58-975a-43660e130afa",
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
  "sessionId": "session_c0f72169-5d0d-4bea-a638-0bbb88e68174",
  "promptId": "prompt_01KVCRA1MSMWW1FJT3V5V1D5B9",
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
    "snapshotMessageId": "msg_session_c0f72169-5d0d-4bea-a638-0bbb88e68174_000001",
    "textLength": 130,
    "containsMarker": true
  },
  "skipExisting": true,
  "keepMissing": true
}
```

### 通过：03-refresh-replay.ts

```json
{
  "coverage": "WS 握手、断线重连、seq replay、messages/tasks、prompt",
  "code": 0,
  "timedOut": false,
  "durationMs": 6001,
  "stdout": "▶ server at http://127.0.0.1:58639\n▶ phase 0: server_id=01KVCRA0CEMVQA8CF47WB45PE3 version=0.0.0\n▶ phase 0: auth.ready=true\n▶ session session_77b8e4a7-5aeb-457b-b6cf-a51cadc6e7f9 created\n▶ prompt prompt_01KVCRA5VCW1SVQBT6P32TE840 completed; maxSeq=13\n▶ refresh #1: caught-up; accepted=[session_77b8e4a7-5aeb-457b-b6cf-a51cadc6e7f9], replayed=0\n▶ refresh #2: replay seq=1..13 (13 events)\n▶ phase 2: messages=2 tasks=0\n▶ phase 5: follow-up prompt completed at seq=21\n✓ 03-refresh-replay: refresh round-trip preserves subscription + replay semantics\n",
  "stderr": ""
}
```

### 通过：08-pending-recovery.ts

```json
{
  "coverage": "approval/question pending 列表与响应闭环",
  "code": 0,
  "timedOut": false,
  "durationMs": 12442,
  "stdout": "▶ server at http://127.0.0.1:58639\n▶ pending: session session_4757fb9d-b7a4-423e-a9f6-f7bdba7ff0e7 created\n▶ approval: prompt prompt_01KVCRABN5XENC5Z3M6YEQVAQA submitted\n▶ approval: pending approval 01KVCRAEZZ196A4QENSAG10YMM tool=Bash\n▶ approval: prompt completed via prompt.completed\n▶ question: prompt prompt_01KVCRAHCJV7Z7B90WZQB231J8 submitted\n▶ question: pending question 01KVCRAMPHT4S1EQ34CK65F31G items=1\n▶ question: prompt completed via prompt.completed\n✓ 08-pending-recovery: pending approvals and questions round-tripped\n",
  "stderr": ""
}
```

### 通过：10-prompt-queue-steer.ts

```json
{
  "coverage": "queued prompt steer 与 WS 事件",
  "code": 0,
  "timedOut": false,
  "durationMs": 2192,
  "stdout": "▶ session session_030658d7-43c9-43fa-b75b-e12fb557abd0 created\n▶ session session_030658d7-43c9-43fa-b75b-e12fb557abd0 subscribed\n▶ active prompt injected: prompt_debug_queue_steer_408\n▶ first prompt queued: prompt_01KVCRAQTBWR5KEHAX952EQN7C\n▶ second prompt queued: prompt_01KVCRAQYF4Z3QDE560X9VAPME\n▶ queue before steer: prompt_01KVCRAQTBWR5KEHAX952EQN7C, prompt_01KVCRAQYF4Z3QDE560X9VAPME\n▶ steer response: {\"steered\":true,\"prompt_ids\":[\"prompt_01KVCRAQTBWR5KEHAX952EQN7C\",\"prompt_01KVCRAQYF4Z3QDE560X9VAPME\"]}\n▶ prompt.steered frame: {\"type\":\"prompt.steered\",\"seq\":9,\"session_id\":\"session_030658d7-43c9-43fa-b75b-e12fb557abd0\",\"payload\":{\"type\":\"prompt.steered\",\"agentId\":\"main\",\"sessionId\":\"session_030658d7-43c9-43fa-b75b-e12fb557abd0\",\"activePromptId\":\"prompt_debug_queue_steer_408\",\"promptIds\":[\"prompt_01KVCRAQTBWR5KEHAX952EQN7C\",\"prompt_01KVCRAQYF4Z3QDE560X9VAPME\"],\"content\":[{\"type\":\"text\",\"text\":\"First queued prompt for server steer.\"},{\"type\":\"text\",\"text\":\"Second queued prompt for server steer.\"}],\"steeredAt\":\"2026-06-18T06:57:37.418Z\"}}\n✓ 10-prompt-queue-steer: queued prompts steered and queue drained\n",
  "stderr": ""
}
```

### 通过：12-send-and-cancel.ts

```json
{
  "coverage": "prompt 完成、queued/active/session cancel 与恢复",
  "code": 0,
  "timedOut": false,
  "durationMs": 6966,
  "stdout": "▶ session session_b3489daa-b6bb-489a-888a-cb7b7e516c31 created\n▶ session session_b3489daa-b6bb-489a-888a-cb7b7e516c31 subscribed\n▶ prompt completed: prompt_01KVCRASXARHBCDD90CKCQ011P\n▶ injected active prompt for queued cancel: prompt_debug_cancel_queued_21552\n▶ queued prompt submitted: prompt_01KVCRAWH76SP69V2963RTVD0J\n▶ abort queued response: {\"aborted\":true}\n▶ prompt.aborted frame received for queued prompt prompt_01KVCRAWH76SP69V2963RTVD0J\n▶ injected active prompt for session abort: prompt_debug_cancel_session_21552\n▶ session abort response: {\"aborted\":true}\n▶ prompt.aborted frame received for session-aborted prompt prompt_debug_cancel_session_21552\n▶ injected active prompt for repeated ESC: prompt_debug_repeated_esc_21552\n▶ first ESC abort response: {\"aborted\":true}\n▶ prompt.aborted frame received for repeated ESC prompt prompt_debug_repeated_esc_21552\n▶ second ESC abort returned 40903 as expected\n▶ injected active prompt for repeated session abort: prompt_debug_repeated_session_abort_21552\n▶ first session-level ESC abort response: {\"aborted\":true}\n▶ second session-level ESC abort response: {\"aborted\":true}\n▶ third session-level ESC abort response: {\"aborted\":true}\n▶ repeated session-level ESC produced exactly one prompt.aborted frame\n▶ recovered prompt completed: prompt_01KVCRAXEG6CDCBWWFF1WX005N\n✓ 12-send-and-cancel: submit + abort round-trips succeeded\n",
  "stderr": ""
}
```

## 结论

- Server REST、WebSocket、事件重放、快照、prompt、steer、cancel、approval 和 question 均由官方 server-e2e 场景验证。
- Kimix snapshot replay adapter 已用真实 Server session / prompt / snapshot 验证：history replay 有稳定标记，renderer 可跳过已存在内容并补入缺失内容。
- 当前 0.17.1 native CLI 的 `/meta` 与 OpenAPI 自报版本为 `0.0.0`；P2 必须按 endpoint / contract capability 探测，不能只按 server_version 判断。
- P2 可在实验开关后新增 Kimix Server Host；现有 vendored SDK Host 继续作为默认与回滚路径。

## P3 Kimix 接入复验（2026-06-18）

- 跨工作区会话：实验路由下 `listSessions({})` 改走 Server 全局列表，现有 UI 的“全部工作目录”入口可复用。
- 官方 fork / 子会话：fork、children list/create 已接入主进程与 preload API。
- 任务管理：Server task list/get/cancel 已接入现有 Kimix 后台任务接口；真实启动、读取、取消一个 running bash 后台任务已验证。
- 终端管理：terminal list 真实读取通过，create/list/close 与 WS attach/detach/input/resize 已接入主进程与 preload API。
- Windows 限制：本机 0.17.1 CLI 调用 terminal create 时返回 `Failed to load native module: conpty.node`，说明接口存在但当前安装包缺少可加载的 Windows ConPTY native 模块；Kimix 将该上游错误归一为可读中文提示并保留原始错误，不伪装为成功。
- 断线重放：Kimix 客户端携带 cursor 重连并触发 snapshot 恢复；history replay 已增加去重补偿，in-flight replay 用于恢复断线中正在生成的正文。
