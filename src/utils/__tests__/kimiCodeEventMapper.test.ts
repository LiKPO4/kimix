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
      usage: { currentTurn: { inputOther: 10, inputCacheRead: 2, inputCacheCreation: 3, output: 20 } },
    }, options);
    const stepStarted = mapKimiCodeEvent({ type: "turn.step.started", step: 5 }, options);
    const stepCompleted = mapKimiCodeEvent({ type: "turn.step.completed", step: 5 }, options);
    const interrupted = mapKimiCodeEvent({ type: "turn.step.interrupted", step: 2, message: "cancelled" }, options);
    const compaction = mapKimiCodeEvent({ type: "compaction.completed" }, options);
    const error = mapKimiCodeEvent({ type: "error", message: "broken" }, options);

    expect(status?.type).toBe("status_update");
    expect((status as Extract<TimelineEvent, { type: "status_update" }>).inputTokenCount).toBe(15);
    expect((status as Extract<TimelineEvent, { type: "status_update" }>).tokenCount).toBe(20);
    expect(stepStarted).toBeNull();
    expect(stepCompleted).toBeNull();
    expect(interrupted?.type).toBe("status_update");
    expect((interrupted as Extract<TimelineEvent, { type: "status_update" }>).message).toContain("cancelled");
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
    expect(after.content).toBe("处理引导");
    expect(after.isComplete).toBe(true);
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
});
