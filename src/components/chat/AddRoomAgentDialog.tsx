import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, Check, Loader2, Settings, X } from "lucide-react";
import type { PermissionMode, Session } from "@/types/ui";
import type { KimiCodeServerModelCatalog, KimiModelConfigSummary } from "@electron/types/ipc";
import { buildSessionModelOptions, groupSessionModelOptions } from "@/utils/sessionModelCatalog";
import type { RoomAgentDraft } from "@/utils/roomAgentProvisioning";

const PERMISSIONS: Array<{ value: PermissionMode; label: string; description: string }> = [
  { value: "manual", label: "手动审批", description: "高风险操作先确认" },
  { value: "auto", label: "自动权限", description: "减少中断并继续推进" },
  { value: "yolo", label: "完全访问", description: "自动批准工具操作" },
];

function uniqueAgentName(label: string, session: Session) {
  const base = label.trim() || "Agent";
  const names = new Set(session.collaboration?.agents.filter((agent) => !agent.removedAt)
    .map((agent) => agent.displayName.toLocaleLowerCase()) ?? []);
  if (!names.has(base.toLocaleLowerCase())) return base;
  let index = 2;
  while (names.has(`${base} ${index}`.toLocaleLowerCase())) index += 1;
  return `${base} ${index}`;
}

function mentionFromName(value: string) {
  const normalized = value.trim().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}._-]/gu, "").slice(0, 32);
  return normalized || "agent";
}

export function AddRoomAgentDialog({
  open,
  session,
  busy,
  error,
  onClose,
  onSubmit,
  onOpenModelSettings,
}: {
  open: boolean;
  session: Session;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (draft: RoomAgentDraft) => void;
  onOpenModelSettings: () => void;
}) {
  const [modelConfig, setModelConfig] = useState<KimiModelConfigSummary | null>(null);
  const [serverCatalog, setServerCatalog] = useState<KimiCodeServerModelCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [modelAlias, setModelAlias] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [mentionName, setMentionName] = useState("");
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("manual");
  const [nameTouched, setNameTouched] = useState(false);
  const [mentionTouched, setMentionTouched] = useState(false);
  const options = useMemo(() => buildSessionModelOptions(modelConfig, serverCatalog), [modelConfig, serverCatalog]);
  const groups = useMemo(() => groupSessionModelOptions(options), [options]);
  const selectedOption = options.find((option) => option.id === modelAlias);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setCatalogError("");
    setNameTouched(false);
    setMentionTouched(false);
    setPermissionMode("manual");
    void Promise.all([
      window.api.getKimiModelConfig(),
      window.api.getKimiCodeServerModelCatalog(),
    ]).then(([configResult, serverResult]) => {
      if (cancelled) return;
      const config = configResult.success ? configResult.data : null;
      const catalog = serverResult.success ? serverResult.data : null;
      setModelConfig(config);
      setServerCatalog(catalog);
      const nextOptions = buildSessionModelOptions(config, catalog);
      const preferred = nextOptions.find((option) => option.id === config?.defaultModel) ?? nextOptions[0];
      setModelAlias(preferred?.id ?? "");
      const name = uniqueAgentName(preferred?.label ?? "Agent", session);
      setDisplayName(name);
      setMentionName(mentionFromName(name));
      if (!configResult.success && !serverResult.success) setCatalogError("暂时无法读取模型目录");
    }).catch(() => {
      if (!cancelled) setCatalogError("暂时无法读取模型目录");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, session.id]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose, open]);

  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
      style={{ padding: 20 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-room-agent-title"
        className="kimix-floating-panel flex max-h-[min(720px,calc(100dvh-40px))] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl"
        style={{ padding: 0 }}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && modelAlias) {
            onSubmit({
              displayName,
              mentionName,
              modelAlias,
              modelLabelSnapshot: selectedOption?.label,
              providerLabelSnapshot: selectedOption?.providerLabel,
              permissionMode,
            });
          }
        }}
      >
        <header
          className="grid items-center border-b border-[var(--kimix-panel-divider)]"
          style={{ gridTemplateColumns: "minmax(0, 1fr) auto", columnGap: 14, padding: "18px 20px" }}
        >
          <div className="min-w-0">
            <div className="flex items-center text-[15px] font-semibold text-[var(--kimix-panel-text)]" style={{ gap: 10 }}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--kimix-panel-soft-bg)] text-[var(--kimix-panel-text-secondary)]">
                <Bot size={16} />
              </span>
              <span id="add-room-agent-title">添加 Agent</span>
            </div>
            <p className="m-0 text-[12.5px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ marginTop: 7, paddingLeft: 42 }}>
              新 Agent 使用独立上下文；行为由你之后发送的提示词决定。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="kimix-inline-icon-action flex h-8 w-8 items-center justify-center rounded-lg text-[var(--kimix-panel-text-secondary)] hover:bg-[var(--kimix-panel-hover)] disabled:opacity-40"
            aria-label="关闭添加 Agent"
          >
            <X size={15} />
          </button>
        </header>

        <div className="min-h-0 overflow-y-auto" style={{ padding: 20 }}>
          <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 14 }}>
            <label className="min-w-0 text-[12.5px] font-medium text-[var(--kimix-panel-text-secondary)]">
              显示名称
              <input
                value={displayName}
                maxLength={40}
                onChange={(event) => {
                  const value = event.target.value;
                  setDisplayName(value);
                  setNameTouched(true);
                  if (!mentionTouched) setMentionName(mentionFromName(value));
                }}
                className="kimix-settings-input h-10 w-full rounded-xl text-[13.5px] outline-none"
                style={{ marginTop: 8, paddingLeft: 14, paddingRight: 14 }}
                placeholder="例如 Reviewer"
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
                  onChange={(event) => {
                    setMentionName(event.target.value.replace(/^@+/, ""));
                    setMentionTouched(true);
                  }}
                  className="kimix-settings-input h-10 w-full rounded-xl text-[13.5px] outline-none"
                  style={{ paddingLeft: 30, paddingRight: 14 }}
                  placeholder="reviewer"
                />
              </div>
            </label>
          </div>

          <section
            className="rounded-2xl border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-soft-bg)]"
            style={{ marginTop: 16, padding: 16 }}
          >
            <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12 }}>
              <div>
                <div className="text-[13px] font-medium text-[var(--kimix-panel-text)]">模型与供应商</div>
                <div className="text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ marginTop: 4 }}>
                  复用现有 Kimi Code 模型目录和 Provider 配置。
                </div>
              </div>
              <button
                type="button"
                onClick={onOpenModelSettings}
                className="kimix-icon-text-button kimix-muted-action is-compact"
                style={{ height: 32, paddingLeft: 12, paddingRight: 12 }}
              >
                <Settings size={14} />
                <span>管理模型</span>
              </button>
            </div>
            <div className="flex max-h-[240px] flex-col overflow-y-auto" style={{ gap: 14, marginTop: 14 }}>
              {loading ? (
                <div className="flex items-center text-[13px] text-[var(--kimix-panel-text-muted)]" style={{ gap: 9, padding: "12px 2px" }}>
                  <Loader2 size={14} className="animate-spin" />
                  <span>正在读取模型目录…</span>
                </div>
              ) : groups.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--kimix-panel-border-soft)] text-[13px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ padding: "12px 14px" }}>
                  {catalogError || "尚未配置可用模型"}
                </div>
              ) : groups.map((group) => (
                <div key={group.provider}>
                  <div className="text-[11.5px] font-medium text-[var(--kimix-panel-text-muted)]" style={{ marginBottom: 6, paddingLeft: 2 }}>
                    {group.label}
                  </div>
                  <div className="flex flex-col" style={{ gap: 6 }}>
                    {group.models.map((option) => {
                      const selected = option.id === modelAlias;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => {
                            setModelAlias(option.id);
                            if (!nameTouched) {
                              const name = uniqueAgentName(option.label, session);
                              setDisplayName(name);
                              if (!mentionTouched) setMentionName(mentionFromName(name));
                            }
                          }}
                          className="grid w-full items-center rounded-xl text-left transition-colors hover:bg-surface-elevated"
                          style={{ gridTemplateColumns: "minmax(0, 1fr) 24px", columnGap: 10, minHeight: 42, paddingLeft: 12, paddingRight: 10 }}
                          title={option.id}
                        >
                          <span className="min-w-0">
                            <span className={`block truncate text-[13px] font-medium ${selected ? "text-[var(--kimix-panel-text)]" : "text-[var(--kimix-panel-text-secondary)]"}`}>
                              {option.label}
                            </span>
                            <span className="block truncate text-[11.5px] text-[var(--kimix-panel-text-muted)]" style={{ marginTop: 2 }}>{option.id}</span>
                          </span>
                          <span className="flex h-6 w-6 items-center justify-center text-accent-primary">{selected ? <Check size={15} /> : null}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section style={{ marginTop: 16 }}>
            <div className="text-[13px] font-medium text-[var(--kimix-panel-text)]">权限</div>
            <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 10 }}>
              {PERMISSIONS.map((option) => {
                const selected = permissionMode === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setPermissionMode(option.value)}
                    className={`rounded-xl border text-left transition-colors ${selected ? "border-[var(--kimix-panel-border)] bg-[var(--kimix-panel-soft-bg)]" : "border-[var(--kimix-panel-border-soft)] hover:bg-[var(--kimix-panel-hover)]"}`}
                    style={{ minHeight: 74, padding: "11px 12px" }}
                  >
                    <span className="block text-[12.5px] font-medium text-[var(--kimix-panel-text)]">{option.label}</span>
                    <span className="block text-[11.5px] leading-4 text-[var(--kimix-panel-text-muted)]" style={{ marginTop: 6 }}>{option.description}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {(error || catalogError) && (
            <div className="rounded-xl border border-accent-danger/25 bg-accent-danger/5 text-[12.5px] leading-5 text-accent-danger" style={{ marginTop: 16, padding: "10px 12px" }}>
              {error || catalogError}
            </div>
          )}
        </div>

        <footer
          className="grid items-center border-t border-[var(--kimix-panel-divider)]"
          style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 14, padding: "14px 20px" }}
        >
          <div className="text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]">
            房间最多 4 个 Agent；当前已有 {session.collaboration?.agents.filter((agent) => !agent.removedAt).length ?? 1} 个。
          </div>
          <div className="flex items-center" style={{ gap: 10 }}>
            <button type="button" onClick={onClose} disabled={busy} className="kimix-icon-text-button kimix-muted-action" style={{ height: 34, paddingLeft: 14, paddingRight: 14 }}>
              取消
            </button>
            <button
              type="submit"
              disabled={busy || loading || !modelAlias || !displayName.trim() || !mentionName.trim()}
              className="kimix-icon-text-button bg-accent-primary text-white hover:bg-accent-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
              style={{ height: 34, minWidth: 98, justifyContent: "center", paddingLeft: 14, paddingRight: 14 }}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />}
              <span>{busy ? "添加中" : "添加 Agent"}</span>
            </button>
          </div>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
