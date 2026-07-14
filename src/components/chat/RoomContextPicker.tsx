import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { RoomContextShareMode, RoomContextShareSelection, Session } from "@/types/ui";
import { estimateRoomContextShare, getRoomContextTurns } from "@/utils/roomContextBridge";

const MODES: Array<{ value: RoomContextShareMode; label: string; title: string }> = [
  { value: "last", label: "上一轮", title: "补入上一条用户消息及其下各 Agent 最终正文" },
  { value: "recent3", label: "最近 3 轮", title: "补入最近三个已完成房间轮次" },
  { value: "selected", label: "选择消息", title: "只补入本次勾选的用户或 Agent 正文" },
  { value: "all", label: "全部正文", title: "补入目标 Agent 尚未读过的全部可见正文" },
  { value: "none", label: "不补充", title: "本次只发送当前消息" },
];

function triggerLabel(selection: RoomContextShareSelection) {
  if (selection.mode === "selected") return `已选 ${selection.selectedEntryIds?.length ?? 0} 条`;
  return MODES.find((mode) => mode.value === selection.mode)?.label ?? "上一轮";
}

export function RoomContextPicker({
  session,
  selectedAgentIds,
  selection,
  disabled,
  onChange,
}: {
  session: Session;
  selectedAgentIds: string[];
  selection: RoomContextShareSelection;
  disabled?: boolean;
  onChange: (selection: RoomContextShareSelection) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const turns = useMemo(() => getRoomContextTurns(session), [session]);
  const entries = useMemo(() => turns.flatMap((turn) => turn.entries).reverse(), [turns]);
  const estimate = useMemo(() => {
    try {
      return estimateRoomContextShare(session, selectedAgentIds, selection);
    } catch {
      return { entryCount: 0, maxContentChars: 0, overLimitAgentNames: [] };
    }
  }, [selectedAgentIds, selection, session]);
  const selectedIds = new Set(selection.selectedEntryIds ?? []);
  const invalidSelection = selection.mode === "selected" && selectedIds.size === 0;

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => setOpen(false), [session.id]);

  const toggleEntry = (entryId: string) => {
    const next = new Set(selection.selectedEntryIds ?? []);
    if (next.has(entryId)) next.delete(entryId);
    else next.add(entryId);
    onChange({ mode: "selected", selectedEntryIds: [...next] });
  };

  return (
    <div ref={rootRef} className="relative shrink-0" style={{ flex: "0 0 104px", width: 104 }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className={`kimix-icon-text-button kimix-muted-action is-compact w-full min-w-0 disabled:cursor-not-allowed disabled:opacity-40 ${invalidSelection ? "text-accent-warning" : ""}`}
        style={{ width: "100%", maxWidth: "100%", height: 34, minHeight: 34, gap: 6, paddingLeft: 12, paddingRight: 12, lineHeight: "20px" }}
        title="设置本次发送给 Agent 的房间正文范围；发送后恢复为上一轮"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="min-w-0 flex-1 truncate" style={{ lineHeight: "20px" }}>{triggerLabel(selection)}</span>
        <ChevronDown size={12} className="shrink-0" />
      </button>

      {open && (
        <div
          className="kimix-floating-panel absolute bottom-full right-0 z-40 rounded-2xl"
          style={{ width: "min(372px, calc(100vw - 40px))", marginBottom: 8, padding: 16 }}
          role="menu"
        >
          <div style={{ paddingLeft: 2, paddingRight: 2 }}>
            <div className="text-[13.5px] font-medium text-[var(--kimix-panel-text)]">本次补充正文</div>
            <div className="text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ marginTop: 4 }}>
              仅补入目标 Agent 尚未读过的可见正文；发送后恢复为上一轮。
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 14 }}>
            {MODES.map((mode) => {
              const active = selection.mode === mode.value;
              return (
                <button
                  key={mode.value}
                  type="button"
                  title={mode.title}
                  onClick={() => onChange({ mode: mode.value, selectedEntryIds: mode.value === "selected" ? selection.selectedEntryIds ?? [] : [] })}
                  className={`rounded-xl border text-[12.5px] transition-colors ${active ? "border-[var(--kimix-panel-border)] bg-[var(--kimix-panel-soft-bg)] text-[var(--kimix-panel-text)]" : "border-[var(--kimix-panel-border-soft)] text-[var(--kimix-panel-text-secondary)] hover:bg-[var(--kimix-panel-hover)]"}`}
                  style={{ minHeight: 38, paddingLeft: 10, paddingRight: 10 }}
                >
                  {mode.label}
                </button>
              );
            })}
          </div>

          {selection.mode === "selected" && (
            <section className="border-t border-[var(--kimix-panel-divider)]" style={{ marginTop: 14, paddingTop: 14 }}>
              <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, paddingLeft: 2, paddingRight: 2 }}>
                <div className="text-[12.5px] font-medium text-[var(--kimix-panel-text-secondary)]">选择消息</div>
                <div className="text-[11.5px] text-[var(--kimix-panel-text-muted)]">已选 {selectedIds.size} 条</div>
              </div>
              <div className="flex max-h-[280px] flex-col overflow-y-auto" style={{ gap: 8, marginTop: 10, paddingRight: 2 }}>
                {entries.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--kimix-panel-border-soft)] text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ padding: "12px 14px" }}>
                    房间还没有可补充的已完成正文。
                  </div>
                ) : entries.map((entry) => {
                  const selected = selectedIds.has(entry.id);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => toggleEntry(entry.id)}
                      className={`grid w-full rounded-xl border text-left transition-colors ${selected ? "border-[var(--kimix-panel-border)] bg-[var(--kimix-panel-soft-bg)]" : "border-[var(--kimix-panel-border-soft)] hover:bg-[var(--kimix-panel-hover)]"}`}
                      style={{ gridTemplateColumns: "22px minmax(0, 1fr)", gap: 10, height: 76, minHeight: 76, maxHeight: 76, overflow: "hidden", padding: "10px 12px" }}
                    >
                      <span className={`flex h-[22px] w-[22px] items-center justify-center rounded-md border ${selected ? "border-accent-primary bg-accent-primary text-white" : "border-[var(--kimix-panel-border)] text-transparent"}`}>
                        <Check size={13} />
                      </span>
                      <span className="min-w-0 self-center" style={{ height: 54, minHeight: 54, maxHeight: 54, overflow: "hidden" }}>
                        <span className="block truncate text-[12.5px] font-medium text-[var(--kimix-panel-text)]">{entry.label}</span>
                        <span
                          className="block text-[11.5px] text-[var(--kimix-panel-text-muted)]"
                          style={{
                            display: "-webkit-box",
                            WebkitBoxOrient: "vertical",
                            WebkitLineClamp: 2,
                            marginTop: 3,
                            maxHeight: 36,
                            overflow: "hidden",
                            overflowWrap: "anywhere",
                            lineHeight: "18px",
                            whiteSpace: "normal",
                            wordBreak: "break-word",
                          }}
                        >
                          {entry.content}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <div
            className={`rounded-xl text-[12px] leading-5 ${estimate.overLimitAgentNames.length > 0 || invalidSelection ? "text-accent-warning" : "text-[var(--kimix-panel-text-muted)]"}`}
            style={{ marginTop: 14, padding: "10px 12px", background: "var(--kimix-panel-soft-bg)" }}
          >
            {invalidSelection
              ? "请选择至少一条正文；未选择时不会发送。"
              : estimate.overLimitAgentNames.length > 0
                ? `${estimate.overLimitAgentNames.join("、")} 超过安全上限，请缩小范围。`
                : estimate.entryCount > 0
                  ? `最多为单个 Agent 补入 ${estimate.entryCount} 条，约 ${estimate.maxContentChars.toLocaleString()} 字。`
                  : "所选目标已经读过这些正文，本次不会重复补入。"}
          </div>
        </div>
      )}
    </div>
  );
}
