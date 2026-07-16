# Kimi Code 0.26.0 子代理/工具事件探针

- 生成时间：2026-07-16T14:19:24.771Z
- 帧总数：219
- 结果：10 通过 / 0 失败

- 通过：catalog model — `{"model":"kimi-code/kimi-for-coding"}`
- 通过：tool phase prompt completed
- 通过：tool.call(.started)/tool.result frames observed — `{"tool.call.started":1,"tool.result":1}`
- 通过：tool.call payload has id+name — `["type","turnId","toolCallId","name","args","description","display","agentId","sessionId"]`
- 通过：subagent phase prompt completed
- 通过：subagent lifecycle frames present — `{"subagent.spawned":1,"subagent.started":1,"subagent.completed":1}`
- 通过：spawned payload fields — `{"subagentId":"agent-0","subagentName":"coder","parentAgentId":"main","callerAgentId":"main","hasSwarmIndex":false,"runInBackground":false}`
- 通过：completed payload has resultSummary — `{"subagentId":"agent-0","summaryLength":531}`
- 通过：nested agent frames scoped to subagentId — `{"mcp.server.status":1,"tool.list.updated":1,"agent.status.updated":17,"turn.started":2,"context.spliced":2,"turn.step.started":2,"thinking.delta":21,"assistant.delta":26,"turn.step.completed":2,"turn.ended":2,"prompt.completed":2}`
- 通过：snapshot has subagents key — `{"subagentsType":"array(1)"}`

