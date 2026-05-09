import { useEffect, useState } from "react";
import { X, Sun, Moon, Monitor, Shield, Zap, GitBranch, Terminal, CheckCircle2, AlertCircle, RefreshCw, Circle } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import type { Theme, PermissionMode } from "@/types/ui";

export function SettingsPanel() {
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const setPermissionMode = useAppStore((s) => s.setPermissionMode);
  const detailedContext = useAppStore((s) => s.detailedContext);
  const setDetailedContext = useAppStore((s) => s.setDetailedContext);
  const [connection, setConnection] = useState<{
    loading: boolean;
    available: boolean | null;
    verified: boolean;
    message: string;
    path?: string;
    output?: string;
  }>({ loading: true, available: null, verified: false, message: "正在查找 Kimi CLI" });

  const checkConnection = async (verify = false) => {
    setConnection((current) => ({
      ...current,
      loading: true,
      message: verify ? "正在检查 Kimi CLI 响应" : "正在查找 Kimi CLI",
    }));
    const res = await window.api.checkKimiCli({ verify });
    if (res.success) {
      setConnection({
        loading: false,
        available: res.data.available,
        verified: res.data.verified,
        message: res.data.message,
        path: res.data.path,
        output: res.data.output,
      });
      return;
    }
    setConnection({ loading: false, available: false, verified: false, message: res.error });
  };

  useEffect(() => {
    if (settingsOpen) void checkConnection(false);
  }, [settingsOpen]);

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
      <div className="kimix-settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="kimix-settings-header">
          <h2 id="settings-title" className="kimix-settings-title">设置</h2>
          <button onClick={() => setSettingsOpen(false)} className="kimix-settings-icon-button" aria-label="关闭设置">
            <X size={18} />
          </button>
        </div>

        <div className="kimix-settings-body">
          <div className="kimix-settings-section">
            <div className="kimix-settings-section-title">
              <Sun size={16} className="text-[#8f887e]" />
              <span>主题</span>
            </div>
            <div className="kimix-settings-theme-grid">
              {themes.map((t) => (
                <button key={t.value} onClick={() => setTheme(t.value)} className={`kimix-settings-theme ${theme === t.value ? "is-active" : ""}`}>
                  <t.icon size={18} />
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="kimix-settings-section">
            <div className="kimix-settings-row-title">
              <div className="kimix-settings-section-title">
                <Terminal size={16} className="text-[#8f887e]" />
                <span>连接情况</span>
              </div>
              <button onClick={() => void checkConnection(Boolean(connection.path))} disabled={connection.loading || !connection.path} className="kimix-settings-check-button" title={connection.path ? "检查 Kimi CLI 响应" : "未找到路径，无法检查"}>
                <RefreshCw size={15} className={connection.loading ? "kimix-spin" : ""} />
                <span>检查</span>
              </button>
            </div>
            <div className={`kimix-settings-connection ${connection.verified ? "is-verified" : connection.available ? "is-found" : "is-missing"}`}>
              <div className="kimix-settings-connection-inner">
                {connection.loading ? (
                  <RefreshCw size={18} className="kimix-spin mt-0.5 shrink-0 text-[#8f887e]" />
                ) : connection.verified ? (
                  <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[#107c10]" />
                ) : connection.available ? (
                  <Circle size={18} className="mt-0.5 shrink-0 text-[#8f887e]" />
                ) : (
                  <AlertCircle size={18} className="mt-0.5 shrink-0 text-[#d97706]" />
                )}
                <div className="kimix-settings-connection-copy">
                  <div className="kimix-settings-connection-label">
                    {connection.loading ? "检测中" : connection.verified ? "Kimi CLI 连接正常" : connection.available ? "已找到 Kimi CLI" : "Kimi CLI 未连接"}
                  </div>
                  <div className="kimix-settings-connection-detail">{connection.output ?? connection.path ?? connection.message}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="kimix-settings-section">
            <div className="kimix-settings-section-title">
              <Shield size={16} className="text-[#8f887e]" />
              <span>权限模式</span>
            </div>
            <div className="kimix-settings-permissions">
              {permissions.map((p) => (
                <button key={p.value} onClick={() => setPermissionMode(p.value)} className={`kimix-settings-permission ${permissionMode === p.value ? "is-active" : ""}`}>
                  <p.icon size={18} className={`mt-0.5 shrink-0 ${permissionMode === p.value ? "text-[#0078d4]" : "text-[#8f887e]"}`} />
                  <div className="kimix-settings-permission-copy">
                    <div className="kimix-settings-permission-label">{p.label}</div>
                    <div className="kimix-settings-permission-desc">{p.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="kimix-settings-section">
            <button onClick={() => setDetailedContext(!detailedContext)} className={`kimix-settings-permission ${detailedContext ? "is-active" : ""}`}>
              <Terminal size={18} className={`mt-0.5 shrink-0 ${detailedContext ? "text-[#0078d4]" : "text-[#8f887e]"}`} />
              <div className="kimix-settings-permission-copy">
                <div className="kimix-settings-permission-label">上下文详细显示</div>
                <div className="kimix-settings-permission-desc">开启后显示 12.34/256k，关闭后显示百分比</div>
              </div>
            </button>
          </div>

          <div className="kimix-settings-footer">Kimix v2.3.4 · 设置将自动保存到本地</div>
        </div>
      </div>
    </div>
  );
}
