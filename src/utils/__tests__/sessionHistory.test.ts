import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseKimiCodeRecord, readKimiCodeSessionModelFromWire, convertSessionImageHistoryToText } from "../../../electron/sessionHistory";
import { mapHistoryEvents } from "../eventMapper";
import { buildThinkingBlocks } from "../thinkingBlocks";

describe("Kimi Code wire history", () => {
  it("uses the latest model record as the current session model", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kimix-model-wire-"));
    const wire = path.join(dir, "wire.jsonl");
    fs.writeFileSync(wire, [
      JSON.stringify({ type: "config.update", modelAlias: "kimi-code/kimi-for-coding" }),
      JSON.stringify({ type: "config.update", modelAlias: "opencode-go/deepseek-v4-flash" }),
      JSON.stringify({ type: "usage.record", model: "kimi-code/kimi-for-coding" }),
    ].join("\n"));
    try {
      expect(readKimiCodeSessionModelFromWire(wire)).toBe("kimi-code/kimi-for-coding");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("maps turn usage to the model actually used by that response", () => {
    const parsed = parseKimiCodeRecord({
      type: "usage.record",
      model: "kimi-code/kimi-for-coding",
      usageScope: "turn",
      usage: { inputOther: 10, inputCacheRead: 20, inputCacheCreation: 5, output: 46 },
      time: 123,
    });
    expect(parsed).toMatchObject({
      type: "StatusUpdate",
      payload: {
        model: "kimi-code/kimi-for-coding",
        token_usage: { output: 46 },
      },
    });
    expect(mapHistoryEvents(parsed ? [parsed] : [])).toMatchObject([{
      type: "status_update",
      message: "模型：kimi-code/kimi-for-coding",
      tokenCount: 46,
      inputTokenCount: 35,
    }]);
  });

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

  it("converts historical image_url parts to text references for non-vision models", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kimix-image-wire-"));
    const agentsMain = path.join(dir, "agents", "main");
    fs.mkdirSync(agentsMain, { recursive: true });
    const wire = path.join(agentsMain, "wire.jsonl");
    const records = [
      { type: "turn.prompt", input: [{ type: "text", text: "hello" }] },
      {
        type: "turn.prompt",
        input: [
          { type: "text", text: "describe this" },
          { type: "image_url", imageUrl: { url: "data:image/png;base64,abc", id: "img1.png" } },
        ],
      },
    ];
    fs.writeFileSync(wire, records.map((r) => JSON.stringify(r)).join("\n"));
    try {
      expect(convertSessionImageHistoryToText(dir)).toBe(true);
      const lines = fs.readFileSync(wire, "utf-8").split("\n").filter(Boolean);
      expect(lines).toHaveLength(1);
      const remaining = JSON.parse(lines[0]);
      expect(remaining.type).toBe("turn.prompt");
      expect(remaining.input).toEqual([{ type: "text", text: "hello" }]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("handles TurnBegin records and preserves original line endings", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kimix-turnbegin-wire-"));
    const agentsMain = path.join(dir, "agents", "main");
    fs.mkdirSync(agentsMain, { recursive: true });
    const wire = path.join(agentsMain, "wire.jsonl");
    const records = [
      { type: "config.update", modelAlias: "opencode-go/deepseek-v4-flash" },
      {
        type: "other",
        message: {
          type: "TurnBegin",
          payload: { user_input: [{ type: "image_url", imageUrl: { url: "data:image/png;base64,xyz", id: "shot.png" } }] },
        },
      },
      { type: "turn.prompt", input: "latest prompt" },
    ];
    fs.writeFileSync(wire, records.map((r) => JSON.stringify(r)).join("\r\n"));
    try {
      expect(convertSessionImageHistoryToText(dir)).toBe(true);
      const content = fs.readFileSync(wire, "utf-8");
      expect(content).toContain("\r\n");
      const lines = content.split("\r\n").filter(Boolean);
      expect(lines).toHaveLength(2);
      const configRecord = JSON.parse(lines[0]);
      expect(configRecord.type).toBe("config.update");
      const imageRecord = JSON.parse(lines[1]);
      expect(imageRecord.message.payload.user_input).toBe("[图片: shot.png]");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("removes the latest prompt record even when there are no images to convert", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kimix-clean-wire-"));
    const agentsMain = path.join(dir, "agents", "main");
    fs.mkdirSync(agentsMain, { recursive: true });
    const wire = path.join(agentsMain, "wire.jsonl");
    fs.writeFileSync(wire, JSON.stringify({ type: "turn.prompt", input: "no images" }));
    try {
      expect(convertSessionImageHistoryToText(dir)).toBe(true);
      expect(fs.readFileSync(wire, "utf-8")).toBe("");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
