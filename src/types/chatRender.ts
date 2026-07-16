import type { TimelineEvent, ToolCallEvent } from "@/types/ui";

export type RenderItem =
  | { type: "event"; event: TimelineEvent; turnStartedAt?: number; leadingTools?: ToolCallEvent[]; leadingSubagents?: Extract<TimelineEvent, { type: "subagent" }>[]; leadingHooks?: Extract<TimelineEvent, { type: "hook" }>[]; leadingApprovals?: Extract<TimelineEvent, { type: "approval_request" }>[]; attachedSteers?: Extract<TimelineEvent, { type: "steer_message" }>[]; attachedUserStatuses?: Extract<TimelineEvent, { type: "status_update" }>[]; activeStatus?: Extract<TimelineEvent, { type: "status_update" }>; changedFiles?: string[]; changeSummary?: Extract<TimelineEvent, { type: "change_summary" }>; trailingStatuses?: Extract<TimelineEvent, { type: "status_update" }>[]; hideProcessSummary?: boolean; approvalDiffs?: { path: string; oldText?: string; newText?: string; additions?: number; deletions?: number }[] }
  | { type: "tool_group"; id: string; tools: ToolCallEvent[] }
  | { type: "plan_preview"; id: string; path: string; projectPath?: string }
  | { type: "change_group"; id: string; changes: { path: string; oldText?: string; newText?: string; additions?: number; deletions?: number }[] };

export interface CompletedTurnRenderCacheEntry {
  events: TimelineEvent[];
  items: RenderItem[];
  sessionEngine?: "prompt" | "kimi-code";
}
