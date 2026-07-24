import type { TimelineEvent, ToolCallEvent } from "@/types/ui";
import { buildThinkingBlocks, type ThinkingBlock } from "./thinkingBlocks";

export type AssistantMessageEvent = Extract<TimelineEvent, { type: "assistant_message" }>;
export type SubagentTimelineEvent = Extract<TimelineEvent, { type: "subagent" }>;
export type ApprovalTimelineEvent = Extract<TimelineEvent, { type: "approval_request" }>;

/**
 * A turn's renderable content in official kimi-web order: thinking teasers,
 * text segments, tool calls, subagent task cards, and resolved approvals
 * appear exactly where they happened in the event stream. The builder walks
 * the turn's event array once and never sorts by timestamp — official wire
 * data gives a thinking part and its following tool call the same timestamp,
 * so any timestamp-based reordering scrambles the sequence.
 */
export type TurnBlock =
  | { kind: "thinking"; key: string; blocks: ThinkingBlock[] }
  | { kind: "text"; key: string; events: AssistantMessageEvent[]; content: string }
  | { kind: "tool"; key: string; tool: ToolCallEvent }
  | { kind: "subagent"; key: string; subagent: SubagentTimelineEvent; tool?: ToolCallEvent }
  | { kind: "approval"; key: string; approval: ApprovalTimelineEvent };

/**
 * Build the ordered block list for one turn body.
 *
 * Rules (single pass over `turnEvents` array order):
 * - assistant_message: non-synthetic thinking becomes a thinking block
 *   (structural, per event — no tool-timestamp boundary cutting); non-empty
 *   content becomes a text block. Adjacent same-kind blocks merge so a
 *   streaming step keeps appending to its own segment.
 * - tool_call: when one or more subagent events carry this call's
 *   `toolCallId` as `parentToolCallId`, the call is a subagent dispatch and
 *   is absorbed into subagent block(s) at its own position (official renders
 *   the Agent tool as the task card itself). Otherwise it stays a tool block.
 * - subagent: emitted at its own position only when not already absorbed by
 *   its dispatching tool call.
 * - approval_request: resolved (non-pending) approvals stay in position;
 *   pending ones render as standalone interactive cards elsewhere.
 * - Everything else (status, compaction, steer, hooks, diffs…) keeps its
 *   existing render placement outside the block list.
 */
export function buildTurnBlocks(turnEvents: TimelineEvent[]): TurnBlock[] {
  const subagentsByParentCall = new Map<string, SubagentTimelineEvent[]>();
  for (const event of turnEvents) {
    if (event.type !== "subagent" || !event.parentToolCallId) continue;
    const list = subagentsByParentCall.get(event.parentToolCallId);
    if (list) list.push(event);
    else subagentsByParentCall.set(event.parentToolCallId, [event]);
  }
  const absorbedSubagentIds = new Set<string>();

  const blocks: TurnBlock[] = [];
  for (const event of turnEvents) {
    if (event.type === "assistant_message") {
      const thinkingBlocks = buildThinkingBlocks({
        thinking: event.thinking,
        thinkingParts: event.thinkingParts,
        timestamp: event.timestamp,
      });
      if (thinkingBlocks.length > 0) {
        const tail = blocks.at(-1);
        if (tail?.kind === "thinking") {
          tail.blocks.push(...thinkingBlocks);
        } else {
          blocks.push({ kind: "thinking", key: `thinking:${event.id}`, blocks: thinkingBlocks });
        }
      }
      const content = event.content.trim();
      if (content) {
        const tail = blocks.at(-1);
        if (tail?.kind === "text") {
          tail.events.push(event);
          tail.content = `${tail.content}\n\n${content}`;
        } else {
          blocks.push({ kind: "text", key: `text:${event.id}`, events: [event], content });
        }
      }
      continue;
    }
    if (event.type === "tool_call") {
      const spawned = event.toolCallId ? subagentsByParentCall.get(event.toolCallId) : undefined;
      if (spawned && spawned.length > 0) {
        for (const subagent of spawned) {
          if (absorbedSubagentIds.has(subagent.id)) continue;
          absorbedSubagentIds.add(subagent.id);
          blocks.push({ kind: "subagent", key: `subagent:${subagent.id}`, subagent, tool: event });
        }
        continue;
      }
      blocks.push({ kind: "tool", key: `tool:${event.id}`, tool: event });
      continue;
    }
    if (event.type === "subagent") {
      if (absorbedSubagentIds.has(event.id)) continue;
      absorbedSubagentIds.add(event.id);
      blocks.push({ kind: "subagent", key: `subagent:${event.id}`, subagent: event });
      continue;
    }
    if (event.type === "approval_request") {
      if (event.status === "pending") continue;
      blocks.push({ kind: "approval", key: `approval:${event.id}`, approval: event });
      continue;
    }
  }
  return blocks;
}

/** Joined visible text of the turn (copy/export/collapsed body). */
export function turnBlocksText(blocks: TurnBlock[]): string {
  return blocks
    .filter((block): block is Extract<TurnBlock, { kind: "text" }> => block.kind === "text")
    .map((block) => block.content)
    .join("\n\n");
}

export function countTurnBlockKind(blocks: TurnBlock[]) {
  let thinking = 0;
  let tools = 0;
  let subagents = 0;
  let approvals = 0;
  for (const block of blocks) {
    if (block.kind === "thinking") thinking += block.blocks.length;
    else if (block.kind === "tool") tools += 1;
    else if (block.kind === "subagent") subagents += 1;
    else if (block.kind === "approval") approvals += 1;
  }
  return { thinking, tools, subagents, approvals };
}

/**
 * Shallow equality for memoization: block identity is its kind/key plus the
 * identity of the underlying event objects (and thinking text), matching the
 * completed-turn cache contract that event-object changes invalidate renders.
 */
export function turnBlocksEqual(prev: TurnBlock[] | undefined, next: TurnBlock[] | undefined): boolean {
  if (prev === next) return true;
  if (!prev || !next || prev.length !== next.length) return false;
  for (let index = 0; index < prev.length; index += 1) {
    const a = prev[index];
    const b = next[index];
    if (a.kind !== b.kind || a.key !== b.key) return false;
    if (a.kind === "thinking" && b.kind === "thinking") {
      if (a.blocks.length !== b.blocks.length) return false;
      for (let blockIndex = 0; blockIndex < a.blocks.length; blockIndex += 1) {
        if (a.blocks[blockIndex].id !== b.blocks[blockIndex].id || a.blocks[blockIndex].text !== b.blocks[blockIndex].text) return false;
      }
    } else if (a.kind === "text" && b.kind === "text") {
      if (a.content !== b.content || a.events.length !== b.events.length) return false;
      for (let eventIndex = 0; eventIndex < a.events.length; eventIndex += 1) {
        if (a.events[eventIndex] !== b.events[eventIndex]) return false;
      }
    } else if (a.kind === "tool" && b.kind === "tool") {
      if (a.tool !== b.tool) return false;
    } else if (a.kind === "subagent" && b.kind === "subagent") {
      if (a.subagent !== b.subagent || a.tool !== b.tool) return false;
    } else if (a.kind === "approval" && b.kind === "approval") {
      if (a.approval !== b.approval) return false;
    }
  }
  return true;
}
