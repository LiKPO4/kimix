import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getSessionHistory, kimiWorkDirBucketNames, parseKimiCodeRecord, readKimiCodeSessionModelFromWire } from "../../../electron/sessionHistory";
import { mapHistoryEvents } from "../eventMapper";
import { buildThinkingBlocks } from "../thinkingBlocks";

describe("Kimi Code wire history", () => {
  it("preserves official full compaction lifecycle records", () => {
    expect([
      parseKimiCodeRecord({ type: "full_compaction.begin", source: "manual", instruction: "保留待办", time: 100 }),
      parseKimiCodeRecord({ type: "full_compaction.complete", time: 200 }),
      parseKimiCodeRecord({ type: "full_compaction.cancel", time: 300 }),
    ]).toEqual([
      {
        type: "full_compaction.begin",
        payload: { type: "full_compaction.begin", source: "manual", instruction: "保留待办", time: 100 },
        time: 100,
      },
      {
        type: "full_compaction.complete",
        payload: { type: "full_compaction.complete", time: 200 },
        time: 200,
      },
      {
        type: "full_compaction.cancel",
        payload: { type: "full_compaction.cancel", time: 300 },
        time: 300,
      },
    ]);
  });

  it("keeps post-compaction session usage after the completion boundary", () => {
    const records = [
      { type: "full_compaction.begin", source: "manual", time: 100 },
      {
        type: "usage.record",
        model: "kimi-code/k3",
        usageScope: "session",
        usage: { inputOther: 5_879, inputCacheRead: 19_200, inputCacheCreation: 0, output: 1_294 },
        time: 190,
      },
      { type: "full_compaction.complete", time: 200 },
    ].map(parseKimiCodeRecord).filter((event) => event !== null);

    const timeline = mapHistoryEvents(records);
    expect(timeline).toHaveLength(3);
    expect(timeline[0]).toMatchObject({ type: "compaction", phase: "begin" });
    expect(timeline[1]).toMatchObject({ type: "compaction", phase: "end", outcome: "completed" });
    expect(timeline[2]).toMatchObject({
      type: "status_update",
      usageScope: "session",
      inputTokenCount: 25_079,
      tokenCount: 1_294,
    });
  });

  it("preserves timestamps from wrapped wire messages", () => {
    expect(parseKimiCodeRecord({
      time: "2026-07-01T20:03:27+08:00",
      message: {
        type: "ContentPart",
        payload: { type: "text", text: "昨晚的回答" },
      },
    })).toEqual({
      type: "ContentPart",
      payload: { type: "text", text: "昨晚的回答" },
      time: "2026-07-01T20:03:27+08:00",
    });

    expect(parseKimiCodeRecord({
      time: "2026-07-02T09:59:52+08:00",
      message: {
        type: "ContentPart",
        created_at: "2026-07-01T20:03:27+08:00",
        payload: { type: "text", text: "消息时间优先" },
      },
    })?.time).toBe("2026-07-01T20:03:27+08:00");
  });

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
    // With break-segment, the second thinking after tool-1 becomes a separate
    // assistant event (4 events: a1, tool-1, a2, tool-2).
    expect(timeline).toHaveLength(4);
    expect(timeline[0]).toMatchObject({
      type: "assistant_message",
      thinking: "Read around line 4380-4420 for event panel.",
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
      type: "assistant_message",
      thinking: "Events are displayed directly with title/body.",
    });
    expect(timeline[3]).toMatchObject({
      type: "tool_call",
      toolCallId: "tool-2",
      status: "success",
      result: "id,title,body,choices",
    });

    const firstAssistant = timeline[0];
    const secondAssistant = timeline[2];
    if (firstAssistant.type !== "assistant_message" || secondAssistant.type !== "assistant_message") throw new Error("Expected assistant history event");
    // First assistant's thinking blocks end at tool-1's timestamp.
    let blocks = buildThinkingBlocks({
      ...firstAssistant,
      boundaryTimestamps: [timeline[1].timestamp],
    });
    expect(blocks.map((block) => block.summary)).toEqual([
      "Read around line 4380-4420 for event panel.",
    ]);

    // Second assistant's thinking blocks end at tool-2's timestamp.
    blocks = buildThinkingBlocks({
      ...secondAssistant,
      boundaryTimestamps: [timeline[3].timestamp],
    });
    expect(blocks.map((block) => block.summary)).toEqual([
      "Events are displayed directly with title/body.",
    ]);
  });

  it("treats only end_turn step ends as terminal history events", () => {
    expect(parseKimiCodeRecord({
      type: "context.append_loop_event",
      time: 100,
      event: { type: "step.end", finishReason: "tool_use" },
    })).toBeNull();

    expect(parseKimiCodeRecord({
      type: "context.append_loop_event",
      time: 101,
      event: { type: "step.end", finish_reason: "end_turn" },
    })).toEqual({
      type: "TurnEnd",
      payload: { finishReason: "end_turn" },
      time: 101,
    });
  });

  it("keeps history older than the former 2000-event parser limit", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "kimix-long-history-"));
    const workDir = path.join(home, "project");
    const sessionId = "session_11111111-1111-4111-8111-111111111111";
    const wireDir = path.join(home, "sessions", kimiWorkDirBucketNames(workDir)[0], sessionId, "agents", "main");
    const previousHome = process.env.KIMI_CODE_HOME;
    fs.mkdirSync(wireDir, { recursive: true });
    fs.writeFileSync(path.join(wireDir, "wire.jsonl"), Array.from({ length: 2_105 }, (_, index) => JSON.stringify({
      type: "turn.prompt",
      input: `message-${index}`,
      time: index,
    })).join("\n"));
    process.env.KIMI_CODE_HOME = home;
    try {
      const history = await getSessionHistory(workDir, sessionId);
      expect(history).toHaveLength(2_105);
      expect(history[0]).toMatchObject({ type: "TurnBegin", payload: { user_input: "message-0" } });
      expect(history.at(-1)).toMatchObject({ type: "TurnBegin", payload: { user_input: "message-2104" } });
    } finally {
      if (previousHome === undefined) delete process.env.KIMI_CODE_HOME;
      else process.env.KIMI_CODE_HOME = previousHome;
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

});
