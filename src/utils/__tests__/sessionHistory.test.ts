import { describe, expect, it } from "vitest";
import { parseKimiCodeRecord } from "../../../electron/sessionHistory";
import { mapHistoryEvents } from "../eventMapper";
import { buildThinkingBlocks } from "../thinkingBlocks";

describe("Kimi Code wire history", () => {
  it("preserves tool calls nested between thinking loop events", () => {
    const time = 1_782_047_978_947;
    const records = [
      {
        type: "context.append_loop_event",
        time,
        event: {
          type: "content.part",
          part: { type: "think", think: "Read around line 4380-4420 for event panel." },
        },
      },
      {
        type: "context.append_loop_event",
        time,
        event: {
          type: "tool.call",
          toolCallId: "tool-1",
          name: "ReadFile",
          args: { path: "lib/features/run/presentation/run_page.dart", line_start: 4380 },
        },
      },
      {
        type: "context.append_loop_event",
        time: time + 5,
        event: {
          type: "tool.result",
          toolCallId: "tool-1",
          result: "4380: event panel",
        },
      },
      {
        type: "context.append_loop_event",
        time: time + 4_016,
        event: {
          type: "content.part",
          part: { type: "think", think: "Events are displayed directly with title/body." },
        },
      },
      {
        type: "context.append_loop_event",
        time: time + 4_016,
        event: {
          type: "tool.call",
          toolCallId: "tool-2",
          name: "Shell",
          args: { command: "list event fields" },
        },
      },
      {
        type: "context.append_loop_event",
        time: time + 4_134,
        event: {
          type: "tool.result",
          toolCallId: "tool-2",
          result: "id,title,body,choices",
        },
      },
    ];

    const history = records.map(parseKimiCodeRecord).filter((event) => event !== null);
    expect(history.map((event) => event.type)).toEqual([
      "ContentPart",
      "tool.call",
      "tool.result",
      "ContentPart",
      "tool.call",
      "tool.result",
    ]);

    const timeline = mapHistoryEvents(history);
    expect(timeline).toHaveLength(3);
    expect(timeline[0]).toMatchObject({
      type: "assistant_message",
      thinking: "Read around line 4380-4420 for event panel.Events are displayed directly with title/body.",
    });
    expect(timeline[1]).toMatchObject({
      type: "tool_call",
      timestamp: time,
      toolCallId: "tool-1",
      toolName: "ReadFile",
      status: "success",
      result: "4380: event panel",
    });
    expect(timeline[2]).toMatchObject({
      type: "tool_call",
      toolCallId: "tool-2",
      status: "success",
      result: "id,title,body,choices",
    });

    const assistant = timeline[0];
    if (assistant.type !== "assistant_message") throw new Error("Expected assistant history event");
    const tools = timeline.filter((event) => event.type === "tool_call");
    const blocks = buildThinkingBlocks({
      ...assistant,
      boundaryTimestamps: tools.map((tool) => tool.timestamp),
    });
    expect(blocks.map((block) => block.summary)).toEqual([
      "Read around line 4380-4420 for event panel.",
      "Events are displayed directly with title/body.",
    ]);
  });
});
