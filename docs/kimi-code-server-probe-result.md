# Kimi Code 0.17.1 Server P1 探针结果

- 生成时间：2026-06-18T03:39:46.452Z
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
  "durationMs": 423,
  "stdout": "0.17.1\n",
  "stderr": ""
}
```

### 通过：health/meta/auth + OpenAPI/AsyncAPI

```json
{
  "serverId": "01KVCCZN4S760CYKKA0BZSVJFX",
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
  "sessionId": "session_5ab0972f-b53b-427c-b99e-bf07f5bb1f6a",
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
  "durationMs": 5627,
  "stdout": "▶ server at http://127.0.0.1:58639\n▶ phase 0: server_id=01KVCCZN4S760CYKKA0BZSVJFX version=0.0.0\n▶ phase 0: auth.ready=true\n▶ session session_fe767fd0-5987-4019-9a40-0373ebd620c4 created\n▶ prompt prompt_01KVCCZQ88RTHX3BZC0ARWY3W3 completed; maxSeq=13\n▶ refresh #1: caught-up; accepted=[session_fe767fd0-5987-4019-9a40-0373ebd620c4], replayed=0\n▶ refresh #2: replay seq=1..13 (13 events)\n▶ phase 2: messages=2 tasks=0\n▶ phase 5: follow-up prompt completed at seq=21\n✓ 03-refresh-replay: refresh round-trip preserves subscription + replay semantics\n",
  "stderr": ""
}
```

### 通过：08-pending-recovery.ts

```json
{
  "coverage": "approval/question pending 列表与响应闭环",
  "code": 0,
  "timedOut": false,
  "durationMs": 11286,
  "stdout": "▶ server at http://127.0.0.1:58639\n▶ pending: session session_c2fb0d80-62ad-443d-b9c9-b9c1f10a6d6a created\n▶ approval: prompt prompt_01KVCCZWQN3Q6E75NJHRP1C1C8 submitted\n▶ approval: pending approval 01KVCD0057K1V0PERXBY8WC4WV tool=Bash\n▶ approval: prompt completed via prompt.completed\n▶ question: prompt prompt_01KVCD024QSX4ECY2BRYBS9YJ5 submitted\n▶ question: pending question 01KVCD04YGAPPF6XCEFA8E5WC1 items=1\n▶ question: prompt completed via prompt.completed\n✓ 08-pending-recovery: pending approvals and questions round-tripped\n",
  "stderr": ""
}
```

### 通过：10-prompt-queue-steer.ts

```json
{
  "coverage": "queued prompt steer 与 WS 事件",
  "code": 0,
  "timedOut": false,
  "durationMs": 2074,
  "stdout": "▶ session session_0cd9ed55-df6b-4493-ab72-58582b650b98 created\n▶ session session_0cd9ed55-df6b-4493-ab72-58582b650b98 subscribed\n▶ active prompt injected: prompt_debug_queue_steer_6100\n▶ first prompt queued: prompt_01KVCD07QWG953CDK750DJJN38\n▶ second prompt queued: prompt_01KVCD07V93TJ2EE9VNBX100DG\n▶ queue before steer: prompt_01KVCD07QWG953CDK750DJJN38, prompt_01KVCD07V93TJ2EE9VNBX100DG\n▶ steer response: {\"steered\":true,\"prompt_ids\":[\"prompt_01KVCD07QWG953CDK750DJJN38\",\"prompt_01KVCD07V93TJ2EE9VNBX100DG\"]}\n▶ prompt.steered frame: {\"type\":\"prompt.steered\",\"seq\":9,\"session_id\":\"session_0cd9ed55-df6b-4493-ab72-58582b650b98\",\"payload\":{\"type\":\"prompt.steered\",\"agentId\":\"main\",\"sessionId\":\"session_0cd9ed55-df6b-4493-ab72-58582b650b98\",\"activePromptId\":\"prompt_debug_queue_steer_6100\",\"promptIds\":[\"prompt_01KVCD07QWG953CDK750DJJN38\",\"prompt_01KVCD07V93TJ2EE9VNBX100DG\"],\"content\":[{\"type\":\"text\",\"text\":\"First queued prompt for server steer.\"},{\"type\":\"text\",\"text\":\"Second queued prompt for server steer.\"}],\"steeredAt\":\"2026-06-18T03:39:38.901Z\"}}\n✓ 10-prompt-queue-steer: queued prompts steered and queue drained\n",
  "stderr": ""
}
```

### 通过：12-send-and-cancel.ts

```json
{
  "coverage": "prompt 完成、queued/active/session cancel 与恢复",
  "code": 0,
  "timedOut": false,
  "durationMs": 7057,
  "stdout": "▶ session session_e1a935cb-5add-4fb4-9583-993eb7593e27 created\n▶ session session_e1a935cb-5add-4fb4-9583-993eb7593e27 subscribed\n▶ prompt completed: prompt_01KVCD09QN6H8AB00TPRG3BPWJ\n▶ injected active prompt for queued cancel: prompt_debug_cancel_queued_22936\n▶ queued prompt submitted: prompt_01KVCD0CN8WRT7F9VSQZFBYENZ\n▶ abort queued response: {\"aborted\":true}\n▶ prompt.aborted frame received for queued prompt prompt_01KVCD0CN8WRT7F9VSQZFBYENZ\n▶ injected active prompt for session abort: prompt_debug_cancel_session_22936\n▶ session abort response: {\"aborted\":true}\n▶ prompt.aborted frame received for session-aborted prompt prompt_debug_cancel_session_22936\n▶ injected active prompt for repeated ESC: prompt_debug_repeated_esc_22936\n▶ first ESC abort response: {\"aborted\":true}\n▶ prompt.aborted frame received for repeated ESC prompt prompt_debug_repeated_esc_22936\n▶ second ESC abort returned 40903 as expected\n▶ injected active prompt for repeated session abort: prompt_debug_repeated_session_abort_22936\n▶ first session-level ESC abort response: {\"aborted\":true}\n▶ second session-level ESC abort response: {\"aborted\":true}\n▶ third session-level ESC abort response: {\"aborted\":true}\n▶ repeated session-level ESC produced exactly one prompt.aborted frame\n▶ recovered prompt completed: prompt_01KVCD0DHMFNTSCEZ0FT5ZVDX3\n✓ 12-send-and-cancel: submit + abort round-trips succeeded\n",
  "stderr": ""
}
```

## 结论

- Server REST、WebSocket、事件重放、快照、prompt、steer、cancel、approval 和 question 均由官方 server-e2e 场景验证。
- 当前 0.17.1 native CLI 的 `/meta` 与 OpenAPI 自报版本为 `0.0.0`；P2 必须按 endpoint / contract capability 探测，不能只按 server_version 判断。
- P2 可在实验开关后新增 Kimix Server Host；现有 vendored SDK Host 继续作为默认与回滚路径。

## P3 Kimix 接入复验（2026-06-18）

- 跨工作区：创建两个不同 `cwd` 的会话后，Server 全局列表同时返回两者。
- 官方 fork：父会话成功派生新 session id；Kimix 现有“派生会话”入口已自动分流。
- 官方子会话：`POST /children` 创建成功，`GET /children` 可检索；已增加主进程与 preload API。
- 任务管理：Server task list/get/cancel 已接入现有 Kimix 后台任务接口；真实启动 `bash` 后台任务、读取 running 状态并取消成功。
- 终端管理：terminal list 真实读取通过，create/list/close 与 WS attach/detach/input/resize 已接入主进程与 preload API。
- Windows 限制：本机 0.17.1 CLI 调用 terminal create 时返回 `Failed to load native module: conpty.node`，说明接口存在但当前安装包缺少可加载的 Windows ConPTY native 模块；Kimix 保留原始错误，不伪装为成功。
- 断线重放：Kimix 客户端首轮 prompt 后主动断开，携带 cursor 重连，再完成第二轮；序号从 12 前进到 22，收到 2 个 `prompt.completed`。
