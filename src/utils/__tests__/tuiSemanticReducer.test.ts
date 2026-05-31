import { describe, expect, it } from "vitest";
import { reduceTuiSemanticEvents } from "../tuiSemanticReducer";
import type { TimelineEvent } from "@/types/ui";

describe("reduceTuiSemanticEvents", () => {
  it("keeps official thinking separate from assistant text", () => {
    const result = reduceTuiSemanticEvents([], [
      { type: "TurnBegin", payload: { user_input: "你好" }, time: 100 },
      { type: "ContentPart", payload: { type: "think", think: "用户在打招呼。" }, time: 110 },
      { type: "ContentPart", payload: { type: "text", text: "你好！" }, time: 120 },
      { type: "TurnEnd", payload: {}, time: 130 },
    ]);

    const assistant = result.events.find((event): event is Extract<TimelineEvent, { type: "assistant_message" }> => event.type === "assistant_message");
    expect(assistant?.content).toBe("你好！");
    expect(assistant?.thinking).toBe("用户在打招呼。");
    expect(assistant?.thinkingParts?.[0]?.text).toBe("用户在打招呼。");
    expect(result.shouldFinish).toBe(true);
    expect(result.hasRunningSemantic).toBe(true);
  });

  it("filters Kimix synthetic prompt-mode thinking placeholders", () => {
    const result = reduceTuiSemanticEvents([], [
      {
        type: "ContentPart",
        payload: {
          type: "think",
          think: "【实时状态】官方 Kimi Code 已开始第 1 步模型请求。当前 prompt-mode 尚未实时写出思考正文；一旦官方 wire 写入真实思考，Kimix 会继续回放。",
        },
        time: 100,
      },
      { type: "ContentPart", payload: { type: "text", text: "正文" }, time: 110 },
    ]);

    const assistant = result.events.find((event): event is Extract<TimelineEvent, { type: "assistant_message" }> => event.type === "assistant_message");
    expect(assistant?.content).toBe("正文");
    expect(assistant?.thinking).toBeUndefined();
    expect(assistant?.thinkingParts).toBeUndefined();
  });

  it("marks an open turn interrupted on TurnCancel", () => {
    const openAssistant: TimelineEvent = {
      id: "assistant-1",
      type: "assistant_message",
      timestamp: 100,
      content: "处理中",
      isThinking: true,
      isComplete: false,
    };

    const result = reduceTuiSemanticEvents([openAssistant], [
      { type: "TurnCancel", payload: {}, time: 200 },
    ], {
      now: 250,
      idFactory: () => "status-1",
    });

    const assistant = result.events[0] as Extract<TimelineEvent, { type: "assistant_message" }>;
    const status = result.events[1] as Extract<TimelineEvent, { type: "status_update" }>;
    expect(assistant.isComplete).toBe(true);
    expect(assistant.isThinking).toBe(false);
    expect(assistant.durationMs).toBe(150);
    expect(status.message).toBe("TUI 已停止生成。");
    expect(result.wasCancelled).toBe(true);
  });
});
