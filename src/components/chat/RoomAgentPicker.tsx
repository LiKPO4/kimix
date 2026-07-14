import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Bot, Check, ChevronDown, Pencil, RefreshCw, UserMinus } from "lucide-react";
import type { RoomAgent, RoomAgentActivity, Session } from "@/types/ui";
import { getPrimaryRoomAgent, roomAgentActivityKey } from "@/utils/collaborationRooms";

const ACTIVE_ACTIVITY_STATUSES = new Set([
  "creating",
  "queued",
  "sending",
  "accepted",
  "running",
  "waiting_approval",
  "waiting_question",
]);

function agentStatus(agent: RoomAgent, activity?: RoomAgentActivity) {
  if (activity?.status === "creating") return { label: "创建中", tone: "text-accent-primary" };
  if (activity?.status === "queued") return { label: "排队中", tone: "text-accent-warning" };
  if (activity?.status === "sending") return { label: "发送中", tone: "text-accent-primary" };
  if (activity?.status === "running") return { label: "运行中", tone: "text-accent-primary" };
  if (activity?.status === "waiting_approval") return { label: "待审批", tone: "text-accent-warning" };
  if (activity?.status === "waiting_question") return { label: "待回答", tone: "text-accent-warning" };
  if (agent.provisioningError) return { label: "创建失败", tone: "text-accent-danger" };
  if (agent.recoveryIssue) return { label: agent.recoveryIssue.status === "unavailable" ? "模型不可用" : "恢复失败", tone: "text-accent-danger" };
  if (agent.lifecycleIssue) return {
    label: agent.lifecycleIssue.operation === "archive" ? "归档失败" : "恢复失败",
    tone: "text-accent-danger",
  };
  if (agent.archivedAt) return { label: "已归档", tone: "text-[var(--kimix-panel-text-muted)]" };
  if (!agent.runtimeSessionId && !agent.officialSessionId) return { label: "未连接", tone: "text-[var(--kimix-panel-text-muted)]" };
  return { label: "空闲", tone: "text-[var(--kimix-panel-text-muted)]" };
}

export function RoomAgentPicker({
  session,
  activities,
  selectedAgentIds,
  busyAgentId,
  disabled,
  onSelectionChange,
  onEdit,
  onRetry,
  onRemove,
}: {
  session: Session;
  activities: Record<string, RoomAgentActivity>;
  selectedAgentIds: string[];
  busyAgentId?: string | null;
  disabled?: boolean;
  onSelectionChange: (roomAgentIds: string[]) => void;
  onEdit: (roomAgentId: string) => void;
  onRetry: (roomAgentId: string) => void;
  onRemove: (roomAgentId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const primaryAgentId = getPrimaryRoomAgent(session).id;
  const agents = session.collaboration?.agents.filter((agent) => !agent.removedAt) ?? [];
  const selected = selectedAgentIds
    .map((id) => agents.find((agent) => agent.id === id))
    .filter((agent): agent is RoomAgent => Boolean(agent));
  const roomBusy = agents.some((agent) => {
    const activity = activities[roomAgentActivityKey(session.id, agent.id)];
    return Boolean(activity && ACTIVE_ACTIVITY_STATUSES.has(activity.status));
  }) || Boolean(session.collaboration?.messages.some((message) => Object.values(message.deliveries).some((delivery) => (
    ["queued", "sending", "accepted", "running", "waiting_approval", "waiting_question", "indeterminate"].includes(delivery.status)
  ))));

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => setOpen(false), [session.id]);

  if (selected.length === 0 || agents.length < 2) return null;
  const selectedLabel = selected.length === 1 ? selected[0].displayName : `${selected[0].displayName} 等 ${selected.length} 个`;

  return (
    <div ref={rootRef} className="relative min-w-0 shrink">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        className="kimix-icon-text-button kimix-muted-action is-compact max-w-[210px] min-w-0 disabled:cursor-not-allowed disabled:opacity-40"
        style={{ height: 34, minHeight: 34, gap: 8, paddingLeft: 12, paddingRight: 12, lineHeight: "20px" }}
        title={`默认发送给 ${selected.map((agent) => agent.displayName).join("、")}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Bot size={14} className="shrink-0 text-[var(--kimix-panel-text-secondary)]" />
        <span className="min-w-0 truncate" style={{ lineHeight: "20px" }}>{selectedLabel}</span>
        <span
          className="shrink-0 text-[11.5px] tabular-nums text-[var(--kimix-panel-text-muted)]"
          style={{ display: "inline-flex", height: 20, alignItems: "center", lineHeight: "20px" }}
        >
          {selected.length} 个
        </span>
        <ChevronDown size={12} className="shrink-0" />
      </button>

      {open && (
        <div
          className="kimix-floating-panel absolute bottom-full left-0 z-40 w-[336px] rounded-2xl"
          style={{ marginBottom: 8, padding: 14 }}
          role="menu"
        >
          <div className="grid items-start" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, paddingLeft: 2, paddingRight: 2 }}>
            <div className="min-w-0">
              <div className="text-[13.5px] font-medium text-[var(--kimix-panel-text)]">本轮接收者</div>
              <div className="text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ marginTop: 3 }}>
                可多选；正文中的 @Agent 会覆盖这里的默认选择。
              </div>
            </div>
            <span className="shrink-0 text-[11.5px] leading-5 text-[var(--kimix-panel-text-muted)]">{agents.length}/4</span>
          </div>

          <div className="flex flex-col" style={{ gap: 8, marginTop: 12 }}>
            {agents.map((agent) => {
              const activity = activities[roomAgentActivityKey(session.id, agent.id)];
              const status = agentStatus(agent, activity);
              const selectedRow = selected.some((candidate) => candidate.id === agent.id);
              const unavailable = Boolean(agent.archivedAt || agent.provisioningError || agent.recoveryIssue);
              const actionBusy = busyAgentId === agent.id;
              return (
                <div
                  key={agent.id}
                  className={`grid rounded-xl border ${selectedRow ? "border-[var(--kimix-panel-border)] bg-[var(--kimix-panel-soft-bg)]" : "border-[var(--kimix-panel-border-soft)] bg-transparent"}`}
                  style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, padding: 8 }}
                >
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={selectedRow}
                    disabled={(unavailable && !selectedRow) || Boolean(busyAgentId)}
                    onClick={() => {
                      const next = selectedRow
                        ? selectedAgentIds.filter((id) => id !== agent.id)
                        : [...selectedAgentIds, agent.id];
                      if (next.length > 0) onSelectionChange(next);
                    }}
                    className="grid min-w-0 rounded-lg text-left transition-colors hover:bg-surface-elevated disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ gridTemplateColumns: "28px minmax(0, 1fr) 18px", gap: 9, minHeight: 48, paddingLeft: 8, paddingRight: 6 }}
                    title={agent.provisioningError || agent.recoveryIssue?.message || agent.lifecycleIssue?.message || `${selectedRow ? "取消" : "选择"} ${agent.displayName}`}
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--kimix-panel-bg)] text-[var(--kimix-panel-text-secondary)]">
                      <Bot size={14} />
                    </span>
                    <span className="min-w-0 self-center">
                      <span className="flex min-w-0 items-center" style={{ gap: 7 }}>
                        <span className="truncate text-[13px] font-medium text-[var(--kimix-panel-text)]">{agent.displayName}</span>
                        <span className={`shrink-0 text-[11.5px] ${status.tone}`}>{status.label}</span>
                      </span>
                      <span className="block truncate text-[11.5px] leading-5 text-[var(--kimix-panel-text-muted)]">
                        @{agent.mentionName} · {agent.modelLabelSnapshot || agent.modelAlias || "模型未知"}
                      </span>
                    </span>
                    <span className="flex h-[18px] w-[18px] items-center justify-center self-center text-accent-primary">
                      {selectedRow ? <Check size={14} /> : null}
                    </span>
                  </button>

                  <div className="flex items-center" style={{ gap: 2 }}>
                    <button
                      type="button"
                      onClick={() => onEdit(agent.id)}
                      disabled={roomBusy || Boolean(busyAgentId)}
                      className="kimix-inline-icon-action flex h-8 w-8 items-center justify-center rounded-lg text-[var(--kimix-panel-text-muted)] hover:bg-[var(--kimix-panel-hover)] hover:text-[var(--kimix-panel-text-secondary)] disabled:opacity-35"
                      title="编辑名称和 @名称"
                      aria-label={`编辑 ${agent.displayName}`}
                    >
                      <Pencil size={13} />
                    </button>
                    {agent.provisioningError && (
                      <button
                        type="button"
                        onClick={() => onRetry(agent.id)}
                        disabled={roomBusy || Boolean(busyAgentId)}
                        className="kimix-inline-icon-action flex h-8 w-8 items-center justify-center rounded-lg text-accent-danger hover:bg-accent-danger/8 disabled:opacity-40"
                        title={actionBusy ? "正在重试" : "重试创建 Agent"}
                        aria-label={`重试创建 ${agent.displayName}`}
                      >
                        <RefreshCw size={14} className={actionBusy ? "animate-spin" : ""} />
                      </button>
                    )}
                    {agent.id !== primaryAgentId && (
                      <button
                        type="button"
                        onClick={() => onRemove(agent.id)}
                        disabled={roomBusy || Boolean(busyAgentId)}
                        className="kimix-inline-icon-action flex h-8 w-8 items-center justify-center rounded-lg text-[var(--kimix-panel-text-muted)] hover:bg-accent-danger/8 hover:text-accent-danger disabled:opacity-35"
                        title="移出房间并保留为独立会话"
                        aria-label={`将 ${agent.displayName} 移出房间`}
                      >
                        <UserMinus size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div
            className="grid rounded-xl border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-soft-bg)] text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]"
            style={{ gridTemplateColumns: "16px minmax(0, 1fr)", gap: 10, marginTop: 14, padding: "10px 12px" }}
          >
            <AlertTriangle size={15} className="text-accent-warning" style={{ marginTop: 2 }} />
            <span>这些 Agent 共享同一工作目录。并行修改同一文件可能互相覆盖，请用接收者、@Agent 和提示词明确分工。</span>
          </div>

          {roomBusy && (
            <div className="text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ marginTop: 12, paddingLeft: 2, paddingRight: 2 }}>
              运行中的 Agent 会独立排队；编辑、重试和移出成员仍需等待房间空闲。
            </div>
          )}
        </div>
      )}
    </div>
  );
}
