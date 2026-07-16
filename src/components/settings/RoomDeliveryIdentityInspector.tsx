import { useMemo, useState } from "react";
import { Bot, Download, X } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { usePresence } from "@/hooks/usePresence";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { getRoomAgentEvents, getRoomAgents } from "@/utils/collaborationRooms";
import {
  isOfficialUserEventIdUniqueToDelivery,
  resolveRoomDeliveryUserEvents,
} from "@/utils/roomDeliveryIdentity";
import type { RoomAgentDelivery, Session, TimelineEvent } from "@/types/ui";

interface RoomDeliveryIdentityInspection {
  roomMessageId: string;
  roomAgentId: string;
  delivery: RoomAgentDelivery;
  officialIdIsUnique: boolean;
  resolution: ReturnType<typeof resolveRoomDeliveryUserEvents>;
  matchedEvents: TimelineEvent[];
}

function inspectSession(session: Session): {
  summary: {
    sessionId: string;
    title: string;
    primaryAgentId: string | undefined;
    agentCount: number;
    messageCount: number;
  };
  deliveries: RoomDeliveryIdentityInspection[];
} | null {
  const collaboration = session.collaboration;
  if (!collaboration) return null;

  const deliveries: RoomDeliveryIdentityInspection[] = [];
  for (const message of collaboration.messages) {
    for (const roomAgentId of message.recipientAgentIds) {
      const delivery = message.deliveries[roomAgentId];
      if (!delivery) continue;
      const events = getRoomAgentEvents(session, roomAgentId);
      const officialIdIsUnique = isOfficialUserEventIdUniqueToDelivery(
        collaboration.messages,
        roomAgentId,
        delivery.officialUserEventId,
      );
      const resolution = resolveRoomDeliveryUserEvents(events, message, delivery, officialIdIsUnique);
      const matchedEvents = [
        ...resolution.transactionIndexes,
        ...resolution.legacyOfficialIndexes,
      ].map((index) => events[index]);
      deliveries.push({
        roomMessageId: message.id,
        roomAgentId,
        delivery,
        officialIdIsUnique,
        resolution,
        matchedEvents,
      });
    }
  }

  return {
    summary: {
      sessionId: session.id,
      title: session.title,
      primaryAgentId: collaboration.primaryAgentId,
      agentCount: getRoomAgents(session).length,
      messageCount: collaboration.messages.length,
    },
    deliveries,
  };
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function RoomDeliveryIdentityInspector({ open, onClose }: { open: boolean; onClose: () => void }) {
  const presence = usePresence(open);
  const dialogRef = useDialogFocus<HTMLDivElement>(open);
  const currentSession = useAppStore((s) => s.currentSession);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);

  const inspection = useMemo(() => (currentSession ? inspectSession(currentSession) : null), [currentSession]);

  if (!presence.mounted) return null;

  const messageIds = Array.from(new Set(inspection?.deliveries.map((item) => item.roomMessageId) ?? []));
  const visibleDeliveries = selectedMessageId
    ? inspection?.deliveries.filter((item) => item.roomMessageId === selectedMessageId)
    : inspection?.deliveries;

  return (
    <div
      className={`kimix-presence-overlay fixed inset-0 z-[95] flex items-center justify-center bg-[color:var(--kimix-modal-overlay-bg)] px-5 ${presence.visible ? "is-visible" : ""}`}
      onMouseDown={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="房间投递身份诊断"
        className={`kimix-modal-card kimix-presence-content flex w-full max-w-[720px] flex-col rounded-[18px] ${presence.visible ? "is-visible" : ""}`}
        style={{ padding: "22px 24px 24px", maxHeight: "min(800px, 90vh)" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between" style={{ gap: 16 }}>
          <div className="flex min-w-0 items-start" style={{ gap: 12 }}>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-primary-light text-accent-primary">
              <Bot size={20} />
            </div>
            <div className="min-w-0">
              <div className="text-[18px] font-semibold leading-7 text-text-primary">房间投递身份诊断</div>
              <div className="mt-1 text-[13.5px] leading-6 text-text-secondary">
                查看当前会话的房间消息归属、delivery identity 字段以及 resolveRoomDeliveryUserEvents 的解析结果。
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="kimix-modal-close-button shrink-0"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        {!inspection ? (
          <div className="mt-6 rounded-xl border border-border-subtle bg-surface-base text-[14px] leading-6 text-text-secondary" style={{ padding: "18px 16px" }}>
            当前会话不是房间会话，或未加载 collaboration 状态。
          </div>
        ) : (
          <>
            <div className="mt-5 grid gap-3 rounded-xl border border-border-subtle bg-surface-base text-[13px] leading-5 text-text-secondary" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", padding: "14px 16px" }}>
              <div>
                <div className="text-[11.5px] font-medium uppercase tracking-wide text-text-muted">会话</div>
                <div className="mt-1 truncate text-text-primary">{inspection.summary.title}</div>
              </div>
              <div>
                <div className="text-[11.5px] font-medium uppercase tracking-wide text-text-muted">Primary Agent</div>
                <div className="mt-1 truncate font-mono text-text-primary">{inspection.summary.primaryAgentId ?? "—"}</div>
              </div>
              <div>
                <div className="text-[11.5px] font-medium uppercase tracking-wide text-text-muted">Agents</div>
                <div className="mt-1 text-text-primary">{inspection.summary.agentCount}</div>
              </div>
              <div>
                <div className="text-[11.5px] font-medium uppercase tracking-wide text-text-muted">Messages</div>
                <div className="mt-1 text-text-primary">{inspection.summary.messageCount}</div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between" style={{ gap: 12 }}>
              <div className="flex min-w-0 items-center" style={{ gap: 10 }}>
                <label htmlFor="room-inspector-message" className="text-[13px] text-text-secondary">筛选消息</label>
                <select
                  id="room-inspector-message"
                  value={selectedMessageId ?? ""}
                  onChange={(e) => setSelectedMessageId(e.target.value || null)}
                  className="kimix-settings-input h-9 min-w-[180px] rounded-lg text-[13px] outline-none"
                  style={{ padding: "0 12px" }}
                >
                  <option value="">全部</option>
                  {messageIds.map((id) => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => downloadJson(`kimix-room-identity-${Date.now()}.json`, inspection)}
                className="kimix-icon-text-button is-compact text-accent-primary hover:bg-accent-primary-light"
              >
                <Download size={13} />
                导出 JSON
              </button>
            </div>

            <div className="mt-4 flex-1 overflow-y-auto">
              <div className="flex flex-col" style={{ gap: 10 }}>
                {visibleDeliveries && visibleDeliveries.length > 0 ? (
                  visibleDeliveries.map((item) => (
                    <div
                      key={`${item.roomMessageId}-${item.roomAgentId}`}
                      className="rounded-xl border border-border-subtle bg-surface-base"
                      style={{ padding: "14px 16px" }}
                    >
                      <div className="flex items-start justify-between" style={{ gap: 12 }}>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-[13.5px] font-medium text-text-primary">
                            <span className="truncate">消息 {item.roomMessageId}</span>
                            <span className="text-text-muted">→</span>
                            <span className="truncate font-mono">{item.roomAgentId}</span>
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] leading-4 text-text-secondary">
                            <span className="rounded-md bg-surface-elevated px-1.5 py-0.5 font-mono">turn: {item.delivery.agentTurnId}</span>
                            {item.delivery.dispatchAttemptId ? (
                              <span className="rounded-md bg-surface-elevated px-1.5 py-0.5 font-mono">attempt: {item.delivery.dispatchAttemptId}</span>
                            ) : (
                              <span className="rounded-md bg-surface-elevated px-1.5 py-0.5 text-text-muted">attempt: —</span>
                            )}
                            {item.delivery.officialUserEventId ? (
                              <span className="rounded-md bg-surface-elevated px-1.5 py-0.5 font-mono">official: {item.delivery.officialUserEventId}</span>
                            ) : (
                              <span className="rounded-md bg-surface-elevated px-1.5 py-0.5 text-text-muted">official: —</span>
                            )}
                            <span className={`rounded-md px-1.5 py-0.5 ${item.officialIdIsUnique ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
                              official unique: {item.officialIdIsUnique ? "yes" : "no"}
                            </span>
                          </div>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11.5px] leading-4 ${item.resolution.hasTransactionConflict ? "bg-accent-danger-light text-accent-danger" : "bg-green-50 text-green-700"}`}>
                          {item.resolution.hasTransactionConflict ? "冲突" : "干净"}
                        </span>
                      </div>

                      <div className="mt-3 grid gap-3 text-[12px] leading-4" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                        <div className="rounded-lg bg-surface-elevated" style={{ padding: "10px 12px" }}>
                          <div className="text-[11px] font-medium uppercase tracking-wide text-text-muted">transaction indexes</div>
                          <div className="mt-1 font-mono text-text-primary">{item.resolution.transactionIndexes.join(", ") || "—"}</div>
                        </div>
                        <div className="rounded-lg bg-surface-elevated" style={{ padding: "10px 12px" }}>
                          <div className="text-[11px] font-medium uppercase tracking-wide text-text-muted">legacy indexes</div>
                          <div className="mt-1 font-mono text-text-primary">{item.resolution.legacyOfficialIndexes.join(", ") || "—"}</div>
                        </div>
                      </div>

                      {item.matchedEvents.length > 0 && (
                        <div className="mt-3">
                          <div className="text-[11px] font-medium uppercase tracking-wide text-text-muted">匹配到的官方事件</div>
                          <div className="mt-1.5 flex flex-col gap-1.5">
                            {item.matchedEvents.map((event) => (
                              <div key={event.id} className="flex items-center gap-2 text-[12px] leading-4 text-text-secondary">
                                <span className="rounded-md bg-surface-elevated px-1.5 py-0.5 font-mono">{event.type}</span>
                                <span className="truncate font-mono text-text-primary">{event.id}</span>
                                {(event.roomMessageId || event.agentTurnId || event.dispatchAttemptId) && (
                                  <span className="truncate text-text-muted">
                                    {["rm", event.roomMessageId, "turn", event.agentTurnId, "attempt", event.dispatchAttemptId]
                                      .filter((part, index) => index % 2 === 0 || part !== undefined)
                                      .join(":")}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-border-subtle bg-surface-base text-center text-[13.5px] leading-6 text-text-secondary" style={{ padding: "28px 16px" }}>
                    没有可显示的 delivery。
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
