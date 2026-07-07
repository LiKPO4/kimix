import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "../../types/ui";
import {
  mapKimiCodeApprovalRequest,
  mapKimiCodeEvent,
  mapKimiCodeQuestionRequest,
  reduceKimiCodeEvents,
} from "../kimiCodeEventMapper";

function testOptions() {
  let id = 0;
  return {
    now: 1000,
    idFactory: () => `id-${++id}`,
  };
}

describe("mapKimiCodeEvent", () => {
  it("ignores turn.started because UI inserts the user message locally", () => {
    expect(mapKimiCodeEvent({ type: "turn.started", turnId: 1 }, testOptions())).toBeNull();
  });

  it("maps assistant and thinking deltas to assistant_message chunks", () => {
    const options = testOptions();
    const thinking = mapKimiCodeEvent({ type: "thinking.delta", delta: "思考中" }, options);
    const assistant = mapKimiCodeEvent({ type: "assistant.delta", delta: "完成" }, options);

    expect(thinking?.type).toBe("assistant_message");
    expect((thinking as Extract<TimelineEvent, { type: "assistant_message" }>).thinking).toBe("思考中");
    expect((thinking as Extract<TimelineEvent, { type: "assistant_message" }>).thinkingParts).toHaveLength(1);
    expect(assistant?.type).toBe("assistant_message");
    expect((assistant as Extract<TimelineEvent, { type: "assistant_message" }>).content).toBe("完成");
  });

  it("maps Kimi Code wire content parts to assistant_message chunks", () => {
    const options = testOptions();
    const thinking = mapKimiCodeEvent({
      type: "context.append_loop_event",
      time: 2000,
      event: { type: "content.part", part: { type: "think", think: "先想一下" } },
    }, options);
    const assistant = mapKimiCodeEvent({
      type: "context.append_loop_event",
      time: 3000,
      event: { type: "content.part", part: { type: "text", text: "正文结果" } },
    }, options);

    expect(thinking?.type).toBe("assistant_message");
    expect((thinking as Extract<TimelineEvent, { type: "assistant_message" }>).thinking).toBe("先想一下");
    expect(thinking?.timestamp).toBe(2000);
    expect(assistant?.type).toBe("assistant_message");
    expect((assistant as Extract<TimelineEvent, { type: "assistant_message" }>).content).toBe("正文结果");
    expect(assistant?.timestamp).toBe(3000);
  });

  it("maps tool call streaming and result events", () => {
    const options = testOptions();
    const delta = mapKimiCodeEvent({
      type: "tool.call.delta",
      toolCallId: "call-1",
      name: "Bash",
      argumentsPart: "{\"command\":\"pwd\"}",
    }, options);
    const started = mapKimiCodeEvent({
      type: "tool.call.started",
      toolCallId: "call-1",
      name: "Bash",
      args: { command: "pwd" },
    }, options);
    const result = mapKimiCodeEvent({
      type: "tool.result",
      toolCallId: "call-1",
      output: "D:/WORKS",
    }, options);

    expect(delta?.type).toBe("tool_call");
    expect((delta as Extract<TimelineEvent, { type: "tool_call" }>).arguments).toEqual({ command: "pwd" });
    expect(started?.type).toBe("tool_call");
    expect((started as Extract<TimelineEvent, { type: "tool_call" }>).toolName).toBe("Bash");
    expect(result?.type).toBe("tool_result");
    expect((result as Extract<TimelineEvent, { type: "tool_result" }>).result).toBe("D:/WORKS");
  });

  it("maps shell tool progress output while the tool is still running", () => {
    const progress = mapKimiCodeEvent({
      type: "tool.progress",
      toolCallId: "call-1",
      name: "Bash",
      update: { kind: "stdout", text: "line 1\n" },
    }, testOptions());
    const stderr = mapKimiCodeEvent({
      type: "tool.progress",
      toolCallId: "call-1",
      name: "Bash",
      update: { kind: "stderr", text: "warn\n" },
    }, testOptions());

    expect(progress?.type).toBe("tool_call");
    expect((progress as Extract<TimelineEvent, { type: "tool_call" }>).status).toBe("running");
    expect((progress as Extract<TimelineEvent, { type: "tool_call" }>).result).toBe("line 1\n");
    expect((stderr as Extract<TimelineEvent, { type: "tool_call" }>).result).toBe("[stderr] warn\n");
  });

  it("preserves non-main agent ids on assistant and tool events", () => {
    const options = testOptions();
    const assistant = mapKimiCodeEvent({ type: "assistant.delta", agentId: "agent-1", delta: "正在检查" }, options);
    const tool = mapKimiCodeEvent({ type: "tool.call.started", agentId: "agent-1", toolCallId: "call-1", name: "ReadFile", args: { path: "a.ts" } }, options);

    expect((assistant as Extract<TimelineEvent, { type: "assistant_message" }>).agentId).toBe("agent-1");
    expect((tool as Extract<TimelineEvent, { type: "tool_call" }>).agentId).toBe("agent-1");
  });

  it("maps Kimi Code wire tool calls and final step end", () => {
    const options = testOptions();
    const tool = mapKimiCodeEvent({
      type: "context.append_loop_event",
      event: { type: "tool.call", toolCallId: "call-1", name: "Bash", args: { command: "pwd" } },
    }, options);
    const intermediateStepEnd = mapKimiCodeEvent({
      type: "context.append_loop_event",
      event: { type: "step.end", finishReason: "tool_use" },
    }, options);
    const finalStepEnd = mapKimiCodeEvent({
      type: "context.append_loop_event",
      event: { type: "step.end", finishReason: "end_turn" },
    }, options);

    expect(tool?.type).toBe("tool_call");
    expect((tool as Extract<TimelineEvent, { type: "tool_call" }>).toolName).toBe("Bash");
    expect(intermediateStepEnd).toBeNull();
    expect(finalStepEnd?.type).toBe("assistant_message");
    expect((finalStepEnd as Extract<TimelineEvent, { type: "assistant_message" }>).isComplete).toBe(true);
  });

  it("maps SDK status, cancel, compaction and error events", () => {
    const options = testOptions();
    const status = mapKimiCodeEvent({
      type: "agent.status.updated",
      model: "kimi-k2",
      contextTokens: 120,
      maxContextTokens: 1000,
      planMode: true,
      swarmMode: true,
      usage: { currentTurn: { inputOther: 10, inputCacheRead: 2, inputCacheCreation: 3, output: 20 } },
    }, options);
    const stepStarted = mapKimiCodeEvent({ type: "turn.step.started", step: 5 }, options);
    const stepCompleted = mapKimiCodeEvent({ type: "turn.step.completed", step: 5 }, options);
    const intermediateStepCompleted = mapKimiCodeEvent({ type: "turn.step.completed", step: 6, finishReason: "tool_use" }, options);
    const finalStepCompleted = mapKimiCodeEvent({ type: "turn.step.completed", step: 7, finishReason: "end_turn" }, options);
    const interrupted = mapKimiCodeEvent({ type: "turn.step.interrupted", step: 2, message: "cancelled" }, options);
    const compaction = mapKimiCodeEvent({ type: "compaction.completed" }, options);
    const error = mapKimiCodeEvent({ type: "error", message: "broken" }, options);

    expect(status?.type).toBe("status_update");
    expect((status as Extract<TimelineEvent, { type: "status_update" }>).inputTokenCount).toBe(15);
    expect((status as Extract<TimelineEvent, { type: "status_update" }>).tokenCount).toBe(20);
    expect((status as Extract<TimelineEvent, { type: "status_update" }>).swarmMode).toBe(true);
    const idleStatus = mapKimiCodeEvent({
      type: "agent.status.updated",
      model: "deepseek-v4-flash",
      contextTokens: 120,
      maxContextTokens: 1000,
    }, options) as Extract<TimelineEvent, { type: "status_update" }>;
    const usageRecord = mapKimiCodeEvent({
      type: "usage.record",
      model: "kimi-code/kimi-for-coding",
      usage: { inputOther: 10, inputCacheRead: 2, inputCacheCreation: 3, output: 20 },
    }, options) as Extract<TimelineEvent, { type: "status_update" }>;
    expect(idleStatus.message).toBeUndefined();
    expect(usageRecord.message).toBe("模型：kimi-code/kimi-for-coding");
    expect(usageRecord.tokenCount).toBe(20);
    expect(stepStarted).toBeNull();
    expect(stepCompleted).toBeNull();
    expect(intermediateStepCompleted).toBeNull();
    expect(finalStepCompleted).toMatchObject({ type: "assistant_message", isComplete: true });
    expect(interrupted?.type).toBe("status_update");
    expect((interrupted as Extract<TimelineEvent, { type: "status_update" }>).message).toBe("输出打断");
    expect(compaction?.type).toBe("compaction");
    expect((compaction as Extract<TimelineEvent, { type: "compaction" }>).phase).toBe("end");
    expect(error?.type).toBe("error");
    expect((error as Extract<TimelineEvent, { type: "error" }>).source).toBe("sdk");
  });

  it("maps official turn.steer as the steer success marker", () => {
    const steer = mapKimiCodeEvent({
      type: "turn.steer",
      input: [
        { type: "text", text: "顺便看一下配色" },
        { type: "image_url", imageUrl: { url: "data:image/png;base64,abc", id: "shot.png" } },
      ],
    }, testOptions()) as Extract<TimelineEvent, { type: "steer_message" }>;

    expect(steer.type).toBe("steer_message");
    expect(steer.status).toBe("sent");
    expect(steer.content).toBe("顺便看一下配色");
    expect(steer.images).toHaveLength(1);
    expect(steer.images?.[0].name).toBe("shot.png");
  });

  it("does not treat Kimix fallback steer record as official confirmation", () => {
    const steer = mapKimiCodeEvent({
      type: "turn.steer",
      input: "先不要动手，只做计划",
      source: "kimix-fallback",
    }, testOptions()) as Extract<TimelineEvent, { type: "steer_message" }>;

    expect(steer.type).toBe("steer_message");
    expect(steer.status).toBe("accepted");
    expect(steer.content).toBe("先不要动手，只做计划");
  });

  it("maps official turn.steer inside append_loop_event", () => {
    const steer = mapKimiCodeEvent({
      type: "context.append_loop_event",
      event: {
        type: "turn.steer",
        input: "改一下方向",
      },
    }, testOptions()) as Extract<TimelineEvent, { type: "steer_message" }>;

    expect(steer.type).toBe("steer_message");
    expect(steer.status).toBe("sent");
    expect(steer.content).toBe("改一下方向");
  });

  it("maps subagent lifecycle fields for swarm progress", () => {
    const options = testOptions();
    const spawned = mapKimiCodeEvent({
      type: "subagent.spawned",
      subagentId: "agent-1",
      parentToolCallId: "call-swarm",
      subagentName: "worker",
      swarmIndex: 2,
      description: "检查样式",
    }, options) as Extract<TimelineEvent, { type: "subagent" }>;
    const started = mapKimiCodeEvent({
      type: "subagent.started",
      subagentId: "agent-1",
      parentToolCallId: "call-swarm",
      subagentName: "worker",
      swarmIndex: 2,
    }, options) as Extract<TimelineEvent, { type: "subagent" }>;
    const suspended = mapKimiCodeEvent({
      type: "subagent.suspended",
      subagentId: "agent-1",
      parentToolCallId: "call-swarm",
      subagentName: "worker",
      reason: "rate limited",
    }, options) as Extract<TimelineEvent, { type: "subagent" }>;
    const completed = mapKimiCodeEvent({
      type: "subagent.completed",
      subagentId: "agent-1",
      parentToolCallId: "call-swarm",
      subagentName: "worker",
      resultSummary: "样式检查完成",
    }, options) as Extract<TimelineEvent, { type: "subagent" }>;

    expect(spawned.status).toBe("queued");
    expect(spawned.agentId).toBe("agent-1");
    expect(spawned.parentToolCallId).toBe("call-swarm");
    expect(spawned.swarmIndex).toBe(2);
    expect(spawned.description).toBe("检查样式");
    expect(started.status).toBe("running");
    expect(suspended.status).toBe("suspended");
    expect(completed.status).toBe("completed");
    expect(completed.resultSummary).toBe("样式检查完成");
  });
});

describe("SDK request mapping", () => {
  it("maps approval handler requests to pending approval_request", () => {
    const event = mapKimiCodeApprovalRequest({
      toolCallId: "call-write",
      toolName: "WriteFile",
      action: "write",
      display: { description: "写入文件" },
    }, testOptions());

    expect(event?.type).toBe("approval_request");
    const approval = event as Extract<TimelineEvent, { type: "approval_request" }>;
    expect(approval.requestId).toBe("call-write");
    expect(approval.riskLevel).toBe("high");
    expect(approval.status).toBe("pending");
  });

  it("maps question handler requests to pending question_request", () => {
    const event = mapKimiCodeQuestionRequest({
      toolCallId: "ask-1",
      questions: [{
        header: "模式",
        question: "请选择",
        options: [{ label: "继续", description: "继续当前计划" }],
      }],
    }, testOptions());

    expect(event?.type).toBe("question_request");
    const question = event as Extract<TimelineEvent, { type: "question_request" }>;
    expect(question.requestId).toBe("ask-1");
    expect(question.questions[0].options[0].label).toBe("继续");
    expect(question.status).toBe("pending");
  });

  it("maps probe-style question fields as SDK question_request", () => {
    const event = mapKimiCodeQuestionRequest({
      toolCallId: "ask-fields",
      fields: [{
        label: "下一步？",
        options: [{ label: "继续" }],
        otherLabel: "自定义",
      }],
    }, testOptions());

    expect(event?.type).toBe("question_request");
    const question = event as Extract<TimelineEvent, { type: "question_request" }>;
    expect(question.requestId).toBe("ask-fields");
    expect(question.questions[0].question).toBe("下一步？");
    expect(question.questions[0].options.map((option) => option.label)).toEqual(["继续", "自定义"]);
  });
});

describe("reduceKimiCodeEvents", () => {
  it("reduces a normal prompt stream into one completed assistant message", () => {
    const events = reduceKimiCodeEvents([], [
      { type: "turn.started", turnId: 1 },
      { type: "thinking.delta", delta: "先想一下" },
      { type: "assistant.delta", delta: "你好" },
      { type: "assistant.delta", delta: "，完成" },
      { type: "turn.ended", turnId: 1, reason: "completed" },
    ], testOptions());

    expect(events).toHaveLength(1);
    const assistant = events[0] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(assistant.type).toBe("assistant_message");
    expect(assistant.thinking).toBe("先想一下");
    expect(assistant.content).toBe("你好，完成");
    expect(assistant.isComplete).toBe(true);
    expect(assistant.isThinking).toBe(false);
  });

  it("maps provider safety-policy filtered turns as an error instead of normal completion", () => {
    const events = reduceKimiCodeEvents([], [
      { type: "assistant.delta", delta: "部分输出" },
      { type: "turn.ended", reason: "filtered" },
    ], testOptions());

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("assistant_message");
    expect(events[1]).toMatchObject({
      type: "error",
      message: "模型安全策略拦截了本轮回复",
      source: "sdk",
    });
  });

  it("reduces Kimi Code wire loop events without losing the final text body", () => {
    const events = reduceKimiCodeEvents([], [
      {
        type: "context.append_loop_event",
        event: { type: "content.part", part: { type: "think", think: "先检查一下" } },
      },
      {
        type: "context.append_loop_event",
        event: { type: "tool.call", toolCallId: "call-1", name: "ReadFile", args: { path: "a.ts" } },
      },
      {
        type: "context.append_loop_event",
        event: { type: "tool.result", toolCallId: "call-1", result: { output: "内容" } },
      },
      {
        type: "context.append_loop_event",
        event: { type: "step.end", finishReason: "tool_use" },
      },
      {
        type: "context.append_loop_event",
        event: { type: "content.part", part: { type: "text", text: "最终正文" } },
      },
      {
        type: "context.append_loop_event",
        event: { type: "step.end", finishReason: "end_turn" },
      },
    ], testOptions());

    expect(events).toHaveLength(2);
    const assistant = events[0] as Extract<TimelineEvent, { type: "assistant_message" }>;
    const tool = events[1] as Extract<TimelineEvent, { type: "tool_call" }>;
    expect(assistant.type).toBe("assistant_message");
    expect(assistant.thinking).toBe("先检查一下");
    expect(assistant.content).toBe("最终正文");
    expect(assistant.isComplete).toBe(true);
    expect(tool.type).toBe("tool_call");
    expect(tool.status).toBe("success");
  });

  it("places assistant chunks after official turn.steer confirmation", () => {
    const initial: TimelineEvent[] = [
      { id: "user-1", type: "user_message", timestamp: 1, content: "开始" },
      { id: "assistant-1", type: "assistant_message", timestamp: 2, content: "前半段", isThinking: false, isComplete: false },
      { id: "steer-1", type: "steer_message", timestamp: 3, content: "改一下方向", status: "accepted" },
    ];
    const events = reduceKimiCodeEvents(initial, [
      { type: "assistant.delta", delta: "旧轮继续" },
      { type: "context.append_loop_event", event: { type: "turn.steer", input: "改一下方向" } },
      { type: "assistant.delta", delta: "处理引导" },
      { type: "turn.ended", reason: "completed" },
    ], testOptions());

    expect(events).toHaveLength(4);
    expect(events[2].type).toBe("steer_message");
    expect((events[2] as Extract<TimelineEvent, { type: "steer_message" }>).status).toBe("sent");
    const before = events[1] as Extract<TimelineEvent, { type: "assistant_message" }>;
    const after = events[3] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(before.content).toBe("前半段旧轮继续");
    expect(before.isComplete).toBe(true);
    expect(after.content).toBe("处理引导");
    expect(after.isComplete).toBe(false);
  });

  it("absorbs tool_result into the linked tool_call through existing merge rules", () => {
    const events = reduceKimiCodeEvents([], [
      { type: "tool.call.started", toolCallId: "call-1", name: "ReadFile", args: { path: "a.ts" } },
      { type: "tool.result", toolCallId: "call-1", output: "content" },
    ], testOptions());

    expect(events).toHaveLength(1);
    const tool = events[0] as Extract<TimelineEvent, { type: "tool_call" }>;
    expect(tool.type).toBe("tool_call");
    expect(tool.status).toBe("success");
    expect(tool.result).toBe("content");
  });

  it("extracts structured diff from SDK tool result display blocks", () => {
    const events = reduceKimiCodeEvents([], [
      { type: "tool.call.started", toolCallId: "call-1", name: "Edit", args: { path: "src/app.ts" } },
      {
        type: "tool.result",
        toolCallId: "call-1",
        name: "Edit",
        output: "ok",
        display: [
          {
            type: "diff",
            path: "src/app.ts",
            old_text: "const a = 1;\n",
            new_text: "const a = 2;\n",
          },
        ],
      },
    ], testOptions());

    expect(events).toHaveLength(3);
    expect(events[0].type).toBe("tool_call");
    expect(events[1].type).toBe("change_summary");
    const change = events[1] as Extract<TimelineEvent, { type: "change_summary" }>;
    expect(change.files[0].path).toBe("src/app.ts");
    expect(events[2].type).toBe("diff");
    const diff = events[2] as Extract<TimelineEvent, { type: "diff" }>;
    expect(diff.filePath).toBe("src/app.ts");
    expect(diff.oldText).toBe("const a = 1;\n");
    expect(diff.newText).toBe("const a = 2;\n");
  });

  it("extracts structured diff from SDK tool result output blocks", () => {
    const events = reduceKimiCodeEvents([], [
      {
        type: "tool.result",
        toolCallId: "call-1",
        name: "Edit",
        output: [
          {
            type: "diff",
            path: "src/app.ts",
            oldText: "before",
            newText: "after",
          },
        ],
      },
    ], testOptions());

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("change_summary");
    const diff = events[1] as Extract<TimelineEvent, { type: "diff" }>;
    expect(diff.type).toBe("diff");
    expect(diff.filePath).toBe("src/app.ts");
    expect(diff.oldText).toBe("before");
    expect(diff.newText).toBe("after");
  });

  it("merges shell tool progress into the running tool call", () => {
    const events = reduceKimiCodeEvents([], [
      { type: "tool.call.started", toolCallId: "call-1", name: "Bash", args: { command: "printf hi" } },
      { type: "tool.progress", toolCallId: "call-1", name: "Bash", update: { kind: "stdout", text: "h" } },
      { type: "tool.progress", toolCallId: "call-1", name: "Bash", update: { kind: "stdout", text: "i" } },
    ], testOptions());

    expect(events).toHaveLength(1);
    const tool = events[0] as Extract<TimelineEvent, { type: "tool_call" }>;
    expect(tool.status).toBe("running");
    expect(tool.arguments).toEqual({ command: "printf hi" });
    expect(tool.result).toBe("hi");
  });

  it("does not finish an active assistant when compaction completes before turn end", () => {
    const events = reduceKimiCodeEvents([], [
      { type: "assistant.delta", delta: "正在整理" },
      { type: "compaction.completed" },
    ], testOptions());

    const assistant = events[0] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(assistant.type).toBe("assistant_message");
    expect(assistant.isComplete).toBe(false);
    expect(events[1].type).toBe("compaction");
  });

  it("closes running tool calls only when the turn really ends", () => {
    const events = reduceKimiCodeEvents([], [
      { type: "assistant.delta", delta: "准备执行" },
      { type: "tool.call.started", toolCallId: "call-1", name: "Bash", args: { command: "sleep 1" } },
      { type: "compaction.completed" },
      { type: "turn.ended", reason: "completed" },
    ], testOptions());

    const assistant = events.find((event): event is Extract<TimelineEvent, { type: "assistant_message" }> => event.type === "assistant_message");
    const tool = events.find((event): event is Extract<TimelineEvent, { type: "tool_call" }> => event.type === "tool_call");
    expect(assistant?.isComplete).toBe(true);
    expect(tool?.status).toBe("success");
  });

  it("reduces swarm subagent lifecycle updates by agent id", () => {
    const events = reduceKimiCodeEvents([], [
      { type: "subagent.spawned", subagentId: "agent-1", parentToolCallId: "call-swarm", subagentName: "worker", swarmIndex: 1, description: "检查 UI" },
      { type: "subagent.started", subagentId: "agent-1", parentToolCallId: "call-swarm", subagentName: "worker", swarmIndex: 1 },
      { type: "subagent.spawned", subagentId: "agent-2", parentToolCallId: "call-swarm", subagentName: "worker", swarmIndex: 2, description: "检查测试" },
      { type: "subagent.completed", subagentId: "agent-1", parentToolCallId: "call-swarm", subagentName: "worker", resultSummary: "UI 完成" },
    ], testOptions());

    expect(events).toHaveLength(2);
    const first = events[0] as Extract<TimelineEvent, { type: "subagent" }>;
    const second = events[1] as Extract<TimelineEvent, { type: "subagent" }>;
    expect(first.agentId).toBe("agent-1");
    expect(first.status).toBe("completed");
    expect(first.resultSummary).toBe("UI 完成");
    expect(second.agentId).toBe("agent-2");
    expect(second.status).toBe("queued");
  });

  it("keeps swarm descriptions and nests scoped agent activity", () => {
    const events = reduceKimiCodeEvents([], [
      { type: "subagent.spawned", subagentId: "agent-1", parentToolCallId: "call-swarm", subagentName: "worker", swarmIndex: 1, description: "检查 layout" },
      { type: "subagent.started", subagentId: "agent-1", parentToolCallId: "call-swarm", subagentName: "worker", swarmIndex: 1 },
      { type: "tool.call.started", agentId: "agent-1", toolCallId: "call-read", name: "ReadFile", args: { path: "src/layout.tsx" } },
      { type: "assistant.delta", agentId: "agent-1", delta: "发现侧栏间距异常" },
    ], testOptions());

    expect(events).toHaveLength(1);
    const agent = events[0] as Extract<TimelineEvent, { type: "subagent" }>;
    expect(agent.description).toBe("检查 layout");
    expect(agent.status).toBe("running");
    expect(agent.events).toHaveLength(2);
    expect((agent.events[0] as Extract<TimelineEvent, { type: "tool_call" }>).toolName).toBe("ReadFile");
    expect((agent.events[1] as Extract<TimelineEvent, { type: "assistant_message" }>).content).toBe("发现侧栏间距异常");
  });

  it("does not force queued or suspended subagents completed on turn end", () => {
    const events = reduceKimiCodeEvents([], [
      { type: "subagent.spawned", subagentId: "agent-queued", subagentName: "worker", swarmIndex: 1, description: "排队任务" },
      { type: "subagent.spawned", subagentId: "agent-suspended", subagentName: "worker", swarmIndex: 2, description: "限流任务" },
      { type: "subagent.suspended", subagentId: "agent-suspended", subagentName: "worker", swarmIndex: 2 },
      { type: "turn.ended" },
      { type: "subagent.failed", subagentId: "agent-suspended", subagentName: "worker", error: "rate limit" },
    ], testOptions());

    expect(events).toHaveLength(2);
    const queued = events[0] as Extract<TimelineEvent, { type: "subagent" }>;
    const suspended = events[1] as Extract<TimelineEvent, { type: "subagent" }>;
    expect(queued.agentId).toBe("agent-queued");
    expect(queued.status).toBe("queued");
    expect(suspended.agentId).toBe("agent-suspended");
    expect(suspended.status).toBe("error");
    expect(suspended.error).toBe("rate limit");
  });
});
