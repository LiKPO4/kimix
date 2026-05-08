import { X, Sun, Moon, Monitor, Shield, Zap, GitBranch } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import type { Theme, PermissionMode } from "@/types/ui";

export function SettingsPanel() {
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const setPermissionMode = useAppStore((s) => s.setPermissionMode);

  if (!settingsOpen) return null;

  const themes: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "浅色", icon: Sun },
    { value: "dark", label: "深色", icon: Moon },
    { value: "system", label: "跟随系统", icon: Monitor },
  ];

  const permissions: { value: PermissionMode; label: string; desc: string; icon: typeof Shield }[] = [
    { value: "manual", label: "手动审批", desc: "每次工具调用都需要确认", icon: Shield },
    { value: "approve_for_session", label: "本会话允许", desc: "当前会话内自动批准同类请求", icon: Zap },
    { value: "yolo", label: "完全访问", desc: "自动批准所有工具请求（谨慎使用）", icon: GitBranch },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={() => setSettingsOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <div
        className="w-full max-w-md bg-bg-elevated rounded-2xl shadow-xl border border-border-default overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-default">
          <h2 id="settings-title" className="text-lg font-semibold text-text-primary">设置</h2>
          <button
            onClick={() => setSettingsOpen(false)}
            className="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-muted hover:text-text-secondary transition-colors"
            aria-label="关闭设置"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* Theme */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
              <Sun size={16} className="text-text-muted" />
              <span>主题</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {themes.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setTheme(t.value)}
                  className={`flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-xl border text-sm transition-all ${
                    theme === t.value
                      ? "border-accent-blue bg-accent-blue/5 text-accent-blue"
                      : "border-border-default hover:border-border-strong text-text-secondary hover:bg-bg-secondary"
                  }`}
                >
                  <t.icon size={18} />
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Permission Mode */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
              <Shield size={16} className="text-text-muted" />
              <span>权限模式</span>
            </div>
            <div className="space-y-2">
              {permissions.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPermissionMode(p.value)}
                  className={`w-full flex items-start gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                    permissionMode === p.value
                      ? "border-accent-blue bg-accent-blue/5"
                      : "border-border-default hover:border-border-strong hover:bg-bg-secondary"
                  }`}
                >
                  <p.icon size={18} className={`shrink-0 mt-0.5 ${permissionMode === p.value ? "text-accent-blue" : "text-text-muted"}`} />
                  <div>
                    <div className={`text-sm font-medium ${permissionMode === p.value ? "text-accent-blue" : "text-text-primary"}`}>
                      {p.label}
                    </div>
                    <div className="text-xs text-text-muted mt-0.5">{p.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Info */}
          <div className="text-xs text-text-muted text-center pt-2 border-t border-border-default">
            Kimix v0.1.0 · 设置将自动保存到本地
          </div>
        </div>
      </div>
    </div>
  );
}
