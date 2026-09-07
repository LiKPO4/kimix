/**
 * v2 wire 被打断轮（无 step.end end_turn / turn.ended 收口）的回归测试。
 *
 * 真实事故（session_d4035d92，docs/issue-old-session-truncated-body-events-snapshot.md）：
 * 一轮被用户打断后直接收到下一条 turn.prompt（如「继续」），wire 里没有任何
 * TurnEnd/turn.ended。此时上一轮最后一条 assistant 正文事件保持 isComplete:false，
 * mergeEvents 会把下一轮的首条正文追加并进上一轮，跨过 user 边界——UI 上表现为
 * 「继续」按钮之前的那句正文其实是续跑段的首句（与官方 web 不一致）。
 *
 * 修复：解析层在 turn.prompt 到达且上一轮未收口时，先合成一条 TurnEnd 关闭上一轮。
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseKimiCodeWireEvents } from "../sessionHistory";

let seq = 0;
function loopEvent(event: Record<string, unknown>): string {
  return JSON.stringify({ type: "context.append_loop_event", agentId: "main", event, time: ++seq });
}

function textPart(turnId: string, text: string): string {
  return loopEvent({ type: "content.part", turnId, part: { type: "text", text }, time: ++seq });
}

function writeFixture(lines: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), "kimix-wire-interrupt-"));
  const file = path.join(dir, "wire.jsonl");
  writeFileSync(file, lines.join("\n") + "\n", "utf-8");
  return file;
}

const tempFiles: string[] = [];
function fixture(lines: string[]): string {
  const file = writeFixture(lines);
  tempFiles.push(file);
  return file;
}

afterAll(() => {
  for (const file of tempFiles) rmSync(path.dirname(file), { recursive: true, force: true });
});

const INTERRUPTED_WIRE = [
  // turn 1：正常开始，两条正文 + 工具，随后被打断（没有任何收口记录）
  JSON.stringify({ type: "turn.prompt", agentId: "main", input: [{ type: "text", text: "认可，按顺序执行" }], origin: { kind: "user" }, time: ++seq }),
  loopEvent({ type: "step.begin", turnId: "1" }),
  textPart("1", "第一轮正文甲"),
  loopEvent({ type: "tool.call", turnId: "1", toolCall: { name: "Bash" }, time: ++seq }),
  loopEvent({ type: "step.end", turnId: "1", finishReason: "tool_use" }),
  loopEvent({ type: "step.begin", turnId: "1" }),
  textPart("1", "缺依赖，补上再测："),
  loopEvent({ type: "step.begin", turnId: "1" }),
  // 用户点击「继续」：新的 turn.prompt 直接到来，turn 1 永远没有 end_turn/turn.ended
  JSON.stringify({ type: "turn.prompt", agentId: "main", input: [{ type: "text", text: "继续" }], origin: { kind: "user" }, time: ++seq }),
  loopEvent({ type: "step.begin", turnId: "2" }),
  textPart("2", "你好，继续。先看目录结构："),
  loopEvent({ type: "step.end", turnId: "2", finishReason: "end_turn" }),
  JSON.stringify({ type: "turn.ended", agentId: "main", time: ++seq }),
  JSON.stringify({ type: "prompt.completed", agentId: "main", time: ++seq }),
];

describe("v2 wire 被打断轮收口", () => {
  it("turn.prompt 到达时上一轮未收口 → 先合成 TurnEnd，正文不跨轮合并", async () => {
    const events = await parseKimiCodeWireEvents(fixture(INTERRUPTED_WIRE));
    const types = events.map((event) => event.type);
    const continueBegin = events.findIndex(
      (event) => event.type === "TurnBegin" && JSON.stringify(event.payload).includes("继续"),
    );
    expect(continueBegin).toBeGreaterThan(0);
    // 「继续」TurnBegin 之前必须紧邻一条（合成的）TurnEnd，关闭被打断的 turn 1
    expect(types[continueBegin - 1]).toBe("TurnEnd");
    const synthetic = events[continueBegin - 1];
    expect((synthetic.payload as { finishReason?: string }).finishReason).toBe("interrupted_by_next_prompt");

    // 顺序断言：turn 1 的最后一条正文之后、「继续」TurnBegin 之前必须是合成 TurnEnd，
    // turn 2 的首句正文排在「继续」之后——渲染层据此绝不会跨 user 边界合并正文。
    const indexOf = (pred: (event: (typeof events)[number]) => boolean) => events.findIndex(pred);
    const idxTurn1Text = indexOf((event) => event.type === "ContentPart" && JSON.stringify(event.payload).includes("缺依赖，补上再测"));
    const idxSyntheticEnd = continueBegin - 1;
    const idxTurn2Text = indexOf((event) => event.type === "ContentPart" && JSON.stringify(event.payload).includes("你好，继续。先看目录结构"));
    expect(idxTurn1Text).toBeGreaterThan(-1);
    expect(idxTurn2Text).toBeGreaterThan(continueBegin);
    expect(idxTurn1Text).toBeLessThan(idxSyntheticEnd);
  });

  it("正常收口的轮不会多出合成 TurnEnd", async () => {
    const normalWire = [
      JSON.stringify({ type: "turn.prompt", agentId: "main", input: [{ type: "text", text: "你好" }], time: ++seq }),
      loopEvent({ type: "step.begin", turnId: "1" }),
      textPart("1", "正常轮正文"),
      loopEvent({ type: "step.end", turnId: "1", finishReason: "end_turn" }),
      JSON.stringify({ type: "turn.ended", agentId: "main", time: ++seq }),
      JSON.stringify({ type: "prompt.completed", agentId: "main", time: ++seq }),
      JSON.stringify({ type: "turn.prompt", agentId: "main", input: [{ type: "text", text: "第二轮" }], time: ++seq }),
      loopEvent({ type: "step.begin", turnId: "2" }),
      textPart("2", "第二轮正文"),
      loopEvent({ type: "step.end", turnId: "2", finishReason: "end_turn" }),
      JSON.stringify({ type: "turn.ended", agentId: "main", time: ++seq }),
      JSON.stringify({ type: "prompt.completed", agentId: "main", time: ++seq }),
    ];
    const events = await parseKimiCodeWireEvents(fixture(normalWire));
    const turnEnds = events.filter(
      (event) => event.type === "TurnEnd"
        && (event.payload as { finishReason?: string }).finishReason === "interrupted_by_next_prompt",
    );
    expect(turnEnds).toHaveLength(0);
    // 正常路径行为不变：两个 TurnBegin、两条正文各自成轮
    expect(events.filter((event) => event.type === "TurnBegin")).toHaveLength(2);
  });
});
