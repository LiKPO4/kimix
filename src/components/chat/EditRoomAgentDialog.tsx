import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, Loader2, X } from "lucide-react";
import type { RoomAgent } from "@/types/ui";

export function EditRoomAgentDialog({
  agent,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  agent: RoomAgent;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (input: { displayName: string; mentionName: string }) => void;
}) {
  const [displayName, setDisplayName] = useState(agent.displayName);
  const [mentionName, setMentionName] = useState(agent.mentionName);

  useEffect(() => {
    setDisplayName(agent.displayName);
    setMentionName(agent.mentionName);
  }, [agent.id, agent.displayName, agent.mentionName]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[125] flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
      style={{ padding: 20 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-room-agent-title"
        className="kimix-floating-panel w-full max-w-[440px] overflow-hidden rounded-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) onSubmit({ displayName, mentionName });
        }}
      >
        <header
          className="grid items-center border-b border-[var(--kimix-panel-divider)]"
          style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 14, padding: "18px 20px" }}
        >
          <div className="flex min-w-0 items-center text-[15px] font-semibold text-[var(--kimix-panel-text)]" style={{ gap: 10 }}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--kimix-panel-soft-bg)] text-[var(--kimix-panel-text-secondary)]">
              <Bot size={16} />
            </span>
            <span id="edit-room-agent-title" className="truncate">编辑 {agent.displayName}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="kimix-inline-icon-action flex h-8 w-8 items-center justify-center rounded-lg text-[var(--kimix-panel-text-secondary)] hover:bg-[var(--kimix-panel-hover)] disabled:opacity-40"
            title="关闭"
            aria-label="关闭编辑 Agent"
          >
            <X size={15} />
          </button>
        </header>

        <div style={{ padding: 20 }}>
          <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 14 }}>
            <label className="min-w-0 text-[12.5px] font-medium text-[var(--kimix-panel-text-secondary)]">
              显示名称
              <input
                value={displayName}
                maxLength={40}
                onChange={(event) => setDisplayName(event.target.value)}
                className="kimix-settings-input h-10 w-full rounded-xl text-[13.5px] outline-none"
                style={{ marginTop: 8, paddingLeft: 14, paddingRight: 14 }}
                autoFocus
              />
            </label>
            <label className="min-w-0 text-[12.5px] font-medium text-[var(--kimix-panel-text-secondary)]">
              @名称
              <div className="relative" style={{ marginTop: 8 }}>
                <span className="pointer-events-none absolute left-[14px] top-1/2 -translate-y-1/2 text-[13.5px] text-[var(--kimix-panel-text-muted)]">@</span>
                <input
                  value={mentionName}
                  maxLength={32}
                  onChange={(event) => setMentionName(event.target.value.replace(/^@+/, ""))}
                  className="kimix-settings-input h-10 w-full rounded-xl text-[13.5px] outline-none"
                  style={{ paddingLeft: 30, paddingRight: 14 }}
                />
              </div>
            </label>
          </div>

          <div
            className="rounded-xl border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-soft-bg)] text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]"
            style={{ marginTop: 16, padding: "10px 12px" }}
          >
            只修改房间内显示身份，不会重置上下文、模型、Provider 或官方会话。
          </div>

          {error && (
            <div className="rounded-xl border border-accent-danger/25 bg-accent-danger/5 text-[12.5px] leading-5 text-accent-danger" style={{ marginTop: 14, padding: "10px 12px" }}>
              {error}
            </div>
          )}
        </div>

        <footer
          className="flex items-center justify-end border-t border-[var(--kimix-panel-divider)]"
          style={{ gap: 10, padding: "14px 20px" }}
        >
          <button type="button" onClick={onClose} disabled={busy} className="kimix-icon-text-button kimix-muted-action" style={{ height: 34, paddingLeft: 14, paddingRight: 14 }}>
            取消
          </button>
          <button
            type="submit"
            disabled={busy || !displayName.trim() || !mentionName.trim()}
            className="kimix-icon-text-button bg-accent-primary text-white hover:bg-accent-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
            style={{ height: 34, minWidth: 86, justifyContent: "center", paddingLeft: 14, paddingRight: 14 }}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            <span>{busy ? "保存中" : "保存"}</span>
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
