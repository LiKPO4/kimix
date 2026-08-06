import type { TimelineEvent, ToolCallEvent } from "@/types/ui";
import { appendStreamingText } from "./activeTurnDraftStore";
import { buildThinkingBlocks, type ThinkingBlock } from "./thinkingBlocks";

export type AssistantMessageEvent = Extract<TimelineEvent, { type: "assistant_message" }>;
export type SubagentTimelineEvent = Extract<TimelineEvent, { type: "subagent" }>;
export type ApprovalTimelineEvent = Extract<TimelineEvent, { type: "approval_request" }>;
export type QuestionTimelineEvent = Extract<TimelineEvent, { type: "question_request" }>;

/**
 * A turn's renderable content in official kimi-web order: thinking teasers,
 * text segments, tool calls, subagent task cards, and resolved approvals
 * appear exactly where they happened in the event stream. The builder walks
 * the turn's event array once and never sorts by timestamp — official wire
 * data gives a thinking part and its following tool call the same timestamp,
 * so any timestamp-based reordering scrambles the sequence.
 */
export type TurnBlock =
  | { kind: "thinking"; key: string; blocks: ThinkingBlock[]; sourceEventIds?: string[] }
  | { kind: "text"; key: string; events: AssistantMessageEvent[]; content: string }
  | { kind: "tool"; key: string; tool: ToolCallEvent }
  | { kind: "subagent"; key: string; subagent: SubagentTimelineEvent; tool?: ToolCallEvent }
  | { kind: "approval"; key: string; approval: ApprovalTimelineEvent }
  | { kind: "question"; key: string; question: QuestionTimelineEvent };

const AGENT_DISPATCH_TOOL_NAMES = new Set(["Agent", "Task", "AgentSwarm"]);

// 同 turn 内 text 段「长前缀重复」判定阈值：共享开场白（如「你好霖江路。」）
// 不达阈值；滞留 draft 双写的正文段前缀远长于此。
const MIN_REDUNDANT_TEXT_PREFIX = 20;

/**
 * Official history and snapshot replays carry the Agent dispatch itself
 * (tool_use with description/prompt/subagent_type) but not Kimix's live
 * subagent event — replay pipelines (snapshotMessagesToServerFrames,
 * mapHistoryEvents) emit only tool.call/tool.result frames. Without synthesis
 * a restored turn degrades the dispatch to a plain tool block and the task
 * card (with its full prompt) disappears. Build a display-layer subagent from
 * the SETTLED tool call; live turns never reach this branch because a running
 * dispatch is skipped and the real subagent event matches parentToolCallId
 * once it arrives.
 */
function synthesizeSubagentFromAgentCall(event: ToolCallEvent): SubagentTimelineEvent {
  const args = event.arguments ?? {};
  const description = typeof args.description === "string" && args.description.trim()
    ? args.description.trim()
    : undefined;
  const subagentType = typeof args.subagent_type === "string" && args.subagent_type.trim()
    ? args.subagent_type.trim()
    : undefined;
  const resultText = typeof event.result === "string" ? event.result : "";
  return {
    id: `subagent:tool:${event.id}`,
    type: "subagent",
    timestamp: event.timestamp,
    parentToolCallId: event.toolCallId || undefined,
    description,
    agentName: subagentType ?? "子代理",
    status: event.status === "error" ? "error" : "completed",
    resultSummary: event.status === "error" ? undefined : resultText || undefined,
    error: event.status === "error" ? resultText || undefined : undefined,
    events: [],
  };
}

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
 *   its dispatching tool call. A SETTLED Agent/Task/AgentSwarm call with no
 *   matching subagent (official history / snapshot replays carry no subagent
 *   events) synthesizes a display-layer subagent so the task card survives
 *   restore; running unmatched calls stay plain tool blocks until the real
 *   subagent event arrives.
 * - approval_request / question_request: resolved (non-pending) cards stay in
 *   position; pending ones render as standalone interactive cards elsewhere.
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
  // A content-less assistant_message (e.g. Server route step.end / turn.ended)
  // marks a step boundary. The next text-bearing assistant_message must start a
  // new text block instead of appending to the previous one, so intermediate
  // body text stays separated from the final answer and renders inside the
  // process timeline rather than the bottom body.
  let textBoundaryPending = false;
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
          tail.sourceEventIds = Array.from(new Set([...(tail.sourceEventIds ?? []), event.id]));
        } else {
          blocks.push({ kind: "thinking", key: `thinking:${event.id}`, blocks: thinkingBlocks, sourceEventIds: [event.id] });
        }
        textBoundaryPending = false;
      }
      const content = event.content.trim();
      if (content) {
        // 同 turn 前缀包含去重（实机 532ff5cb 08:54 steer 轮）：官方在 steer 后
        // 重放 step 1 的完整正文（volatile delta 从 offset 0 重开），而 step 1 的
        // draft 未在工具边界 commit，35 字符开场白滞留并在后续 step 的 draft 上
        // 重新材料化——两个 text 段前 30+ 字符逐字相同（渲染层红框内容完全一致），
        // 只差结尾标点（「桌面：」vs「桌面。」），旧实现渲染出两处相同正文。
        // 跳过与既有 text 段构成「长前缀重复」的冗余段（保留更完整者）；正常
        // 共享开场白（如「你好霖江路。」）不达阈值，不受影响。相邻 text 仍按
        // 原有规则合并。
        const redundantPrefix = blocks.some((block) => block.kind === "text" && (
          block.content === content ||
          block.content.startsWith(content) ||
          content.startsWith(block.content) ||
          (
            Math.min(block.content.length, content.length) >= MIN_REDUNDANT_TEXT_PREFIX &&
            block.content.slice(0, MIN_REDUNDANT_TEXT_PREFIX) === content.slice(0, MIN_REDUNDANT_TEXT_PREFIX)
          )
        ));
        if (redundantPrefix) {
          textBoundaryPending = false;
          continue;
        }
        const tail = blocks.at(-1);
        if (tail?.kind === "text" && !textBoundaryPending) {
          tail.events.push(event);
          tail.content = `${tail.content}\n\n${content}`;
        } else {
          blocks.push({ kind: "text", key: `text:${event.id}`, events: [event], content });
        }
        textBoundaryPending = false;
      } else {
        // A content-less assistant step boundary: the next text-bearing event
        // must NOT merge into the previous text block.
        textBoundaryPending = true;
      }
      continue;
    }
    textBoundaryPending = false;
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
      if (event.status !== "running" && AGENT_DISPATCH_TOOL_NAMES.has(event.toolName)) {
        const synthesized = synthesizeSubagentFromAgentCall(event);
        blocks.push({ kind: "subagent", key: `subagent:${synthesized.id}`, subagent: synthesized, tool: event });
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
    if (event.type === "question_request") {
      if (event.status === "pending") continue;
      blocks.push({ kind: "question", key: `question:${event.id}`, question: event });
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
    } else if (a.kind === "question" && b.kind === "question") {
      if (a.question !== b.question) return false;
    }
  }
  return true;
}

/**
 * Determine the final visible text content for a turn body in kimi-web block
 * mode. Rules:
 * - No turnBlocks: return displayContent as-is.
 * - No text blocks: return displayContent as-is.
 * - Incomplete (streaming) turns: ALL text segments stay in the process
 *   timeline (return ""). Showing the latest segment in the body caused a
 *   flash-then-fold when tools arrived after it.
 * - Complete turns: the last text block is the final answer and must stay in
 *   the body area. Trailing tool/subagent/approval after that block must NOT
 *   hide it — multi-step turns often end with late tools (or snapshot recovery
 *   re-appends tools after the answer). Returning "" here made restart/history
 *   look like "输出完成但无正文" while official kimi-web still showed the body
 *   (local event still had content; only the final-body rule zeroed it).
 * - Intermediate text segments remain available inside the process timeline
 *   when expanded; the bottom body only surfaces the last text segment.
 */
/**
 * Streaming counterpart of computeFinalTextBlockContent. While a turn is still
 * active, the TRAILING text segment (no tool/subagent/approval/question block
 * after it) is the candidate final answer and should stream live in the body
 * area instead of being withheld until settle — otherwise the whole answer
 * appears at once when the turn ends. A following thinking phase does NOT
 * demote the segment (reasoning may precede more work but does not by itself
 * move text back into the process timeline); a real process boundary does, and
 * then this returns "" so the body hides and the segment renders in-flow.
 */
export function computeStreamingTrailingTextContent(turnBlocks: TurnBlock[] | undefined): string {
  if (!turnBlocks) return "";
  for (let index = turnBlocks.length - 1; index >= 0; index -= 1) {
    const block = turnBlocks[index];
    if (block.kind === "text") return block.content;
    if (block.kind === "tool" || block.kind === "subagent" || block.kind === "approval" || block.kind === "question") return "";
  }
  return "";
}


export type TurnBlockGroup =
  | { type: "thinking"; key: string; blocks: ThinkingBlock[]; sourceEventIds: string[] }
  | { type: "text"; key: string; content: string; sourceEventIds: string[] }
  | { type: "tool"; key: string; tools: ToolCallEvent[]; sourceEventIds: string[] }
  | { type: "subagent"; key: string; subagents: SubagentTimelineEvent[]; tools: (ToolCallEvent | undefined)[]; sourceEventIds: string[] }
  | { type: "approval"; key: string; approvals: ApprovalTimelineEvent[]; sourceEventIds: string[] }
  | { type: "question"; key: string; question: QuestionTimelineEvent; sourceEventIds: string[] };

/**
 * Group only adjacent same-kind blocks, mirroring the official kimi-web
 * assistantRenderBlocks rule: a tool run aggregates into one "N 个工具调用"
 * card only while uninterrupted; a thinking/text/subagent boundary starts a
 * new run. Order comes from the event array, never from timestamps. Subagent
 * groups keep each dispatching Agent tool call (index-aligned) so a single
 * dispatch can render as an official-style 任务 card with its full prompt.
 */
export function groupTurnBlocks(blocks: TurnBlock[]): TurnBlockGroup[] {
  const groups: TurnBlockGroup[] = [];
  for (const block of blocks) {
    const last = groups.at(-1);
    if (block.kind === "thinking") {
      if (last?.type === "thinking") {
        last.blocks.push(...block.blocks);
        last.sourceEventIds = Array.from(new Set([...last.sourceEventIds, ...(block.sourceEventIds ?? [])]));
      } else {
        groups.push({ type: "thinking", key: block.key, blocks: [...block.blocks], sourceEventIds: [...(block.sourceEventIds ?? [])] });
      }
    } else if (block.kind === "text") {
      groups.push({ type: "text", key: block.key, content: block.content, sourceEventIds: block.events.map((event) => event.id) });
    } else if (block.kind === "tool") {
      if (last?.type === "tool") {
        last.tools.push(block.tool);
        last.sourceEventIds.push(block.tool.id);
      } else {
        groups.push({ type: "tool", key: block.key, tools: [block.tool], sourceEventIds: [block.tool.id] });
      }
    } else if (block.kind === "subagent") {
      if (last?.type === "subagent") {
        last.subagents.push(block.subagent);
        last.tools.push(block.tool);
        last.sourceEventIds.push(block.subagent.id, ...(block.tool ? [block.tool.id] : []));
      } else {
        groups.push({
          type: "subagent",
          key: block.key,
          subagents: [block.subagent],
          tools: [block.tool],
          sourceEventIds: [block.subagent.id, ...(block.tool ? [block.tool.id] : [])],
        });
      }
    } else if (block.kind === "approval") {
      if (last?.type === "approval") {
        last.approvals.push(block.approval);
        last.sourceEventIds.push(block.approval.id);
      } else {
        groups.push({ type: "approval", key: block.key, approvals: [block.approval], sourceEventIds: [block.approval.id] });
      }
    } else if (block.kind === "question") {
      groups.push({ type: "question", key: block.key, question: block.question, sourceEventIds: [block.question.id] });
    }
  }
  return groups;
}

/**
 * Append the live (uncommitted) draft tail to a turn's formal blocks while the
 * turn is active. The live thinking phase goes after the formal blocks; the
 * live text tail continues the trailing formal text block (prefix-safe) when
 * no thinking phase sits between, otherwise it starts a new text block AFTER
 * the thinking — the wire order of a step is think → text. Keys match the
 * formal commit of the same segment so the live→formal swap reuses the DOM.
 */
export function mergeLiveDraftBlocks(
  turnBlocks: TurnBlock[],
  live: {
    thinkingBlocks?: ThinkingBlock[];
    thinkingBlockKey?: string;
    textTail?: string;
    textBlockKey?: string;
  },
): TurnBlock[] {
  const blocks = [...turnBlocks];
  if (live.thinkingBlocks?.length) {
    blocks.push({ kind: "thinking", key: live.thinkingBlockKey ?? "thinking:live:draft", blocks: live.thinkingBlocks });
  }
  const tail = live.textTail?.trim() ? live.textTail ?? "" : "";
  if (tail) {
    const last = blocks.at(-1);
    if (!live.thinkingBlocks?.length && last?.kind === "text") {
      blocks[blocks.length - 1] = { ...last, content: appendStreamingText(last.content, tail) };
    } else {
      blocks.push({ kind: "text", key: live.textBlockKey ?? "text:live:draft", events: [], content: tail });
    }
  }
  return blocks;
}

/**
 * Index of the text block the completed body actually selects: the block whose
 * latest event timestamp is maximal (`>=` keeps the later array item on ties).
 * The process timeline must skip exactly this block (by identity), not the
 * "last text group in array order" — a late tool after the final text, or a
 * reconciliation replay appending an older-timestamped step at the tail, would
 * otherwise make body and timeline pick different blocks, rendering the same
 * answer twice or the official final answer nowhere. Returns -1 when no block
 * is selected (streaming, or no text blocks).
 */
export function computeFinalTextBlockIndex(
  turnBlocks: TurnBlock[] | undefined,
  isComplete: boolean,
): number {
  if (!turnBlocks || !isComplete) return -1;
  // Snapshot/reconciliation events can arrive after a newer live final body
  // while retaining their older official timestamp. Array order still owns
  // the process timeline, but completed-body selection must not let such an
  // appended historical step replace the actual chronological final answer.
  let finalIndex = -1;
  let finalTimestamp = -Infinity;
  for (let index = 0; index < turnBlocks.length; index += 1) {
    const block = turnBlocks[index];
    if (block.kind !== "text") continue;
    const timestamp = Math.max(-Infinity, ...block.events.map((event) => event.timestamp));
    if (finalIndex === -1 || timestamp >= finalTimestamp) {
      finalIndex = index;
      finalTimestamp = timestamp;
    }
  }
  return finalIndex;
}

export function computeFinalTextBlockContent(
  turnBlocks: TurnBlock[] | undefined,
  displayContent: string,
  isComplete: boolean,
): string {
  if (!turnBlocks) return displayContent;
  if (!turnBlocks.some((block) => block.kind === "text")) return displayContent;
  // Streaming turn: keep every text segment in the process timeline.
  if (!isComplete) return "";
  const finalIndex = computeFinalTextBlockIndex(turnBlocks, isComplete);
  const finalBlock = finalIndex >= 0 ? turnBlocks[finalIndex] : undefined;
  return (finalBlock?.kind === "text" ? finalBlock.content : "") || displayContent;
}
