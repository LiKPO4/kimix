import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Circle, Loader2, Network, PauseCircle, X } from "lucide-react";
import type { TimelineEvent } from "@/types/ui";

type SubagentEvent = Extract<TimelineEvent, { type: "subagent" }>;

interface SwarmPanelProps {
  events: TimelineEvent[];
  onDismiss?: () => void;
}

function subagentKey(event: SubagentEvent, index: number) {
  return event.agentId || `${event.parentToolCallId || "swarm"}:${event.swarmIndex ?? index}:${event.agentName}`;
}

export function getLatestSwarmAgents(events: TimelineEvent[]): SubagentEvent[] {
  const latest = new Map<string, SubagentEvent>();
  events.forEach((event, index) => {
    if (event.type !== "subagent") return;
    const key = subagentKey(event, index);
    latest.set(key, { ...latest.get(key), ...event });
  });
  return Array.from(latest.values()).sort((a, b) => {
    const left = typeof a.swarmIndex === "number" ? a.swarmIndex : Number.MAX_SAFE_INTEGER;
    const right = typeof b.swarmIndex === "number" ? b.swarmIndex : Number.MAX_SAFE_INTEGER;
    return left - right || a.timestamp - b.timestamp;
  });
}

export function getVisibleSwarmAgents(events: TimelineEvent[]): SubagentEvent[] {
  const latestSubagentIndex = events.findLastIndex((event) => event.type === "subagent");
  if (latestSubagentIndex === -1) return [];
  const latest = events[latestSubagentIndex] as SubagentEvent;
  const latestGroupStart = events.findLastIndex((event, index) => (
    index <= latestSubagentIndex &&
    event.type === "subagent" &&
    event.status === "queued" &&
    (
      (latest.parentToolCallId && event.parentToolCallId === latest.parentToolCallId) ||
      (!latest.parentToolCallId && event.timestamp >= latest.timestamp - 10_000)
    )
  ));
  const groupEvents = latestGroupStart >= 0 ? events.slice(latestGroupStart) : events.slice(latestSubagentIndex);
  const agents = getLatestSwarmAgents(groupEvents);
  if (agents.length < 2) return [];
  const hasActive = agents.some((agent) => agent.status === "queued" || agent.status === "running" || agent.status === "suspended");
  const hasError = agents.some((agent) => agent.status === "error");
  return hasActive || hasError ? agents : [];
}

function statusLabel(status: SubagentEvent["status"]) {
  if (status === "queued") return "排队";
  if (status === "running") return "运行中";
  if (status === "suspended") return "限流等待";
  if (status === "completed") return "完成";
  return "失败";
}

function compactText(value: string, maxLength = 92) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function stringifyResult(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") {
    const output = (value as Record<string, unknown>).output;
    if (typeof output === "string") return output;
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return "";
}

function argumentPreview(args: Record<string, unknown>) {
  const keys = ["path", "filePath", "command", "pattern", "query", "content", "prompt", "description"];
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return compactText(value, 64);
  }
  const first = Object.values(args).find((value) => typeof value === "string" && value.trim());
  return typeof first === "string" ? compactText(first, 64) : "";
}

function activityLabel(event: TimelineEvent) {
  if (event.type === "tool_call") {
    const preview = argumentPreview(event.arguments);
    const verb = event.status === "running" ? "正在使用" : event.status === "success" ? "已完成" : "工具失败";
    return `${verb} ${event.toolName}${preview ? `：${preview}` : ""}`;
  }
  if (event.type === "tool_result") {
    const result = compactText(stringifyResult(event.result), 72);
    return result ? `工具返回：${result}` : "工具已返回结果";
  }
  if (event.type === "assistant_message") {
    const text = event.content || event.thinking || "";
    if (!text.trim()) return event.isComplete ? "已结束当前步骤" : "";
    return `${event.content ? "正在输出" : "正在思考"}：${compactText(text, 72)}`;
  }
  if (event.type === "status_update" && event.message) {
    return compactText(event.message, 72);
  }
  return "";
}

function agentActivity(agent: SubagentEvent) {
  if (agent.status === "completed" && agent.resultSummary) return compactText(agent.resultSummary);
  if (agent.status === "error" && agent.error) return compactText(agent.error);
  for (let index = agent.events.length - 1; index >= 0; index -= 1) {
    const label = activityLabel(agent.events[index]);
    if (label) return label;
  }
  if (agent.description) return "等待子代理上报进度";
  return "";
}

function StatusIcon({ status }: { status: SubagentEvent["status"] }) {
  if (status === "completed") return <CheckCircle2 size={17} className="shrink-0 text-accent-success" />;
  if (status === "running") return <Loader2 size={17} className="shrink-0 animate-spin text-accent-primary" />;
  if (status === "suspended") return <PauseCircle size={17} className="shrink-0 text-accent-warning" />;
  if (status === "error") return <AlertCircle size={17} className="shrink-0 text-accent-danger" />;
  return <Circle size={17} className="shrink-0 text-text-muted" />;
}

function agentSummary(agent: SubagentEvent) {
  return agentActivity(agent) || agent.resultSummary || agent.error || agent.description || agent.agentName;
}

export function SwarmPanel({ events, onDismiss }: SwarmPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const agents = useMemo(() => getVisibleSwarmAgents(events), [events]);
  if (agents.length === 0) return null;

  const completedCount = agents.filter((agent) => agent.status === "completed").length;
  const runningCount = agents.filter((agent) => agent.status === "running").length;
  const waitingCount = agents.filter((agent) => agent.status === "queued" || agent.status === "suspended").length;
  const failedCount = agents.filter((agent) => agent.status === "error").length;
  const doneCount = completedCount + failedCount;

  return (
    <div
      className="overflow-hidden rounded-[16px] border border-border-subtle bg-surface-elevated text-[14.5px] shadow-hover-token"
      style={{ marginBottom: 14 }}
    >
      <div className={`flex h-11 items-center border-border-subtle text-text-secondary ${collapsed ? "" : "border-b"}`} style={{ paddingLeft: 24, paddingRight: 12 }}>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="no-focus-outline flex h-full min-w-0 flex-1 items-center text-left transition-colors hover:text-text-primary focus:outline-none focus-visible:outline-none"
          style={{ gap: 11, paddingRight: 10 }}
        >
          {collapsed ? <ChevronRight size={17} className="shrink-0" /> : <ChevronDown size={17} className="shrink-0" />}
          <Network size={17} className="shrink-0 text-text-muted" />
          <span className="min-w-0 flex-1 truncate">Swarm 子进程</span>
          {runningCount > 0 && <span className="shrink-0 text-text-muted">{runningCount} 个运行中</span>}
          {waitingCount > 0 && <span className="shrink-0 text-text-muted">{waitingCount} 个等待</span>}
          {failedCount > 0 && <span className="shrink-0 text-accent-danger">{failedCount} 个失败</span>}
          <span className="shrink-0 text-text-muted">{doneCount}/{agents.length}</span>
        </button>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="kimix-muted-action flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
            title="收起到侧栏"
            aria-label="收起 Swarm 子进程"
          >
            <X size={13} />
          </button>
        )}
      </div>
      {!collapsed && (
        <div className="max-h-52 overflow-y-auto" style={{ paddingTop: 8, paddingBottom: 8 }}>
          <div className="flex flex-col" style={{ gap: 8, paddingLeft: 16, paddingRight: 16 }}>
            {agents.map((agent, index) => (
              <div
                key={subagentKey(agent, index)}
                className="grid min-h-[52px] min-w-0 items-center rounded-[10px] border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-soft-bg)] text-[14px] leading-5"
                style={{ gridTemplateColumns: "minmax(0, 1fr) auto", columnGap: 12, paddingLeft: 14, paddingRight: 14, paddingTop: 9, paddingBottom: 9 }}
              >
                <div className="flex min-w-0 items-center" style={{ gap: 10 }}>
                  <StatusIcon status={agent.status} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-text-primary">{agent.description || agent.agentName || `子进程 ${index + 1}`}</div>
                    <div className="truncate text-[12.5px] text-text-muted" style={{ marginTop: 4 }}>
                      {agentSummary(agent)}
                    </div>
                  </div>
                </div>
                <div className="flex h-7 min-w-[64px] shrink-0 items-center justify-center rounded-lg bg-surface-elevated text-[12.5px] text-text-muted" style={{ paddingLeft: 10, paddingRight: 10 }}>
                  {statusLabel(agent.status)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
