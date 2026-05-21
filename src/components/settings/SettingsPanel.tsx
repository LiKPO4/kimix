import { useEffect, useState } from "react";
import { X, Sun, Moon, Monitor, Shield, Zap, GitBranch, Terminal, AlertCircle, RefreshCw, MessageSquare, Mic, Keyboard, Archive, RotateCcw, Trash2, Check } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Theme, PermissionMode } from "@/types/ui";

type FreezeReport = {
  at: string;
  lagMs: number;
  sessionId: string | null;
  runningSessionId: string | null;
};

const FREEZE_REPORTS_KEY = "kimix_freeze_reports";

function formatFreezeTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function SelectionIndicator({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`kimix-selection-indicator mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors ${selected ? "is-selected" : ""} ${
        selected
          ? "border-[#0078d4] bg-[#0078d4] text-white"
          : "text-transparent"
      }`}
    >
      {selected ? <Check size={11} strokeWidth={3} /> : <span className="h-1.5 w-1.5 rounded-full bg-transparent" />}
    </span>
  );
}

export function SettingsPanel() {
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const setPermissionMode = useAppStore((s) => s.setPermissionMode);
  const detailedContext = useAppStore((s) => s.detailedContext);
  const setDetailedContext = useAppStore((s) => s.setDetailedContext);
  const statusUpdateDisplay = useAppStore((s) => s.statusUpdateDisplay);
  const setStatusUpdateDisplay = useAppStore((s) => s.setStatusUpdateDisplay);
  const sessionRecommendationEnabled = useAppStore((s) => s.sessionRecommendationEnabled);
  const setSessionRecommendationEnabled = useAppStore((s) => s.setSessionRecommendationEnabled);
  const sessionRecommendationTurnLimit = useAppStore((s) => s.sessionRecommendationTurnLimit);
  const setSessionRecommendationTurnLimit = useAppStore((s) => s.setSessionRecommendationTurnLimit);
  const voiceShortcut = useAppStore((s) => s.voiceShortcut);
  const setVoiceShortcut = useAppStore((s) => s.setVoiceShortcut);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const sessions = useSessionStore((s) => s.sessions);
  const restoreSession = useSessionStore((s) => s.restoreSession);
  const [freezeReports, setFreezeReports] = useState<FreezeReport[]>([]);
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

  const loadFreezeReports = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(FREEZE_REPORTS_KEY) ?? "[]");
      const reports = Array.isArray(parsed)
        ? parsed.filter((item): item is FreezeReport => (
          item &&
          typeof item === "object" &&
          typeof item.at === "string" &&
          typeof item.lagMs === "number" &&
          ("sessionId" in item) &&
          ("runningSessionId" in item)
        ))
        : [];
      setFreezeReports(reports.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 20));
    } catch {
      setFreezeReports([]);
    }
  };

  const clearFreezeReports = () => {
    localStorage.removeItem(FREEZE_REPORTS_KEY);
    setFreezeReports([]);
  };

  useEffect(() => {
    if (settingsOpen) {
      void checkConnection(false);
      loadFreezeReports();
    }
  }, [settingsOpen]);

  if (!settingsOpen) return null;

  const themes: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "浅色", icon: Sun },
    { value: "dark", label: "深色", icon: Moon },
    { value: "system", label: "跟随系统", icon: Monitor },
  ];

  const permissions: { value: PermissionMode; label: string; desc: string; icon: typeof Shield; tooltip: string }[] = [
    { value: "manual", label: "手动审批", desc: "每次工具调用都需要确认", icon: Shield, tooltip: "手动审批：每次工具调用都会停下来等你确认，适合高风险修改。" },
    { value: "approve_for_session", label: "本会话允许", desc: "当前会话内自动批准同类请求", icon: Zap, tooltip: "本会话允许：同类工具请求在当前会话内自动批准，减少重复确认。" },
    { value: "yolo", label: "完全访问", desc: "自动批准所有工具请求（谨慎使用）", icon: GitBranch, tooltip: "完全访问：自动批准所有工具请求，适合可信任务，请谨慎开启。" },
  ];
  const archivedSessions = sessions
    .filter((session) => session.archivedAt)
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));

  const handleRestoreSession = (sessionId: string) => {
    restoreSession(sessionId);
    const restored = useSessionStore.getState().sessions.find((session) => session.id === sessionId);
    if (restored) setCurrentSession({ ...restored, archivedAt: undefined });
  };

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
                  <SelectionIndicator selected />
                ) : connection.available ? (
                  <SelectionIndicator selected />
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
                <button key={p.value} title={p.tooltip} onClick={() => setPermissionMode(p.value)} className={`kimix-settings-permission ${permissionMode === p.value ? "is-active" : ""}`}>
                  <SelectionIndicator selected={permissionMode === p.value} />
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
            <div className="kimix-settings-section-title">
              <Terminal size={16} className="text-[#8f887e]" />
              <span>上下文显示</span>
            </div>
            <button onClick={() => setDetailedContext(!detailedContext)} className={`kimix-settings-permission ${detailedContext ? "is-active" : ""}`}>
              <SelectionIndicator selected={detailedContext} />
              <Terminal size={18} className={`mt-0.5 shrink-0 ${detailedContext ? "text-[#0078d4]" : "text-[#8f887e]"}`} />
              <div className="kimix-settings-permission-copy">
                <div className="kimix-settings-permission-label">上下文详细显示</div>
                <div className="kimix-settings-permission-desc">开启后显示 12.34/256k，关闭后显示百分比</div>
              </div>
            </button>
          </div>

          <div className="kimix-settings-section">
            <div className="kimix-settings-section-title">
              <MessageSquare size={16} className="text-[#8f887e]" />
              <span>消息信息</span>
            </div>
            <div className="kimix-settings-permissions">
              <button onClick={() => setStatusUpdateDisplay("turn_end")} className={`kimix-settings-permission ${statusUpdateDisplay === "turn_end" ? "is-active" : ""}`}>
                <SelectionIndicator selected={statusUpdateDisplay === "turn_end"} />
                <div className="kimix-settings-permission-copy">
                  <div className="kimix-settings-permission-label">每轮末尾显示一次</div>
                  <div className="kimix-settings-permission-desc">默认选项，只保留本轮最后一条 Tokens 和 Context 信息</div>
                </div>
              </button>
              <button onClick={() => setStatusUpdateDisplay("each")} className={`kimix-settings-permission ${statusUpdateDisplay === "each" ? "is-active" : ""}`}>
                <SelectionIndicator selected={statusUpdateDisplay === "each"} />
                <div className="kimix-settings-permission-copy">
                  <div className="kimix-settings-permission-label">实时显示每条消息信息</div>
                  <div className="kimix-settings-permission-desc">适合调试上下文增长，会在对话中多次显示状态胶囊</div>
                </div>
              </button>
            </div>
          </div>

          <div className="kimix-settings-section">
            <div className="kimix-settings-section-title">
              <MessageSquare size={16} className="text-[#8f887e]" />
              <span>新对话建议</span>
            </div>
            <div className="kimix-settings-card" style={{ padding: "18px 16px" }}>
              <button
                type="button"
                onClick={() => setSessionRecommendationEnabled(!sessionRecommendationEnabled)}
                className="flex w-full items-start text-left"
                style={{ gap: 12 }}
              >
                <SelectionIndicator selected={sessionRecommendationEnabled} />
                <div className="min-w-0 flex-1">
                  <div className="text-[14.5px] font-medium text-[var(--kimix-panel-text)]">达到推荐轮数后提示开启新对话</div>
                  <div className="mt-1 text-[13px] leading-5 text-[var(--kimix-panel-text-secondary)]">默认用于减少长会话里旧上下文和无用信息的干扰。</div>
                </div>
              </button>
              <div className="mt-5 flex items-center justify-between" style={{ gap: 14 }}>
                <label htmlFor="session-turn-limit" className="min-w-0 text-[14px] text-[var(--kimix-panel-text-secondary)]">推荐轮数上限</label>
                <input
                  id="session-turn-limit"
                  type="number"
                  min={1}
                  max={200}
                  value={sessionRecommendationTurnLimit}
                  disabled={!sessionRecommendationEnabled}
                  onChange={(event) => setSessionRecommendationTurnLimit(Number(event.target.value || 1))}
                  className="kimix-settings-input h-9 w-24 rounded-lg text-center text-[14px] outline-none transition-colors"
                />
              </div>
            </div>
          </div>

          <div className="kimix-settings-section">
            <div className="kimix-settings-section-title">
              <Mic size={16} className="text-[#8f887e]" />
              <span>语音输入</span>
            </div>
            <div className="kimix-settings-card" style={{ padding: "18px 16px" }}>
              <div className="flex items-start" style={{ gap: 12 }}>
                <Keyboard size={18} className="mt-0.5 shrink-0 text-[#8f887e]" />
                <div className="min-w-0 flex-1">
                  <div className="text-[14.5px] font-medium text-[var(--kimix-panel-text)]">语音按钮触发快捷键</div>
                  <div className="mt-1 text-[13px] leading-5 text-[var(--kimix-panel-text-secondary)]">点击输入区麦克风后，会触发该系统快捷键，用于调用你自己的语音输入工具。</div>
                </div>
              </div>
              <div className="mt-5 flex items-center justify-between" style={{ gap: 14 }}>
                <label htmlFor="voice-shortcut" className="min-w-0 text-[14px] text-[var(--kimix-panel-text-secondary)]">快捷键</label>
                <input
                  id="voice-shortcut"
                  type="text"
                  value={voiceShortcut}
                  onChange={(event) => setVoiceShortcut(event.target.value)}
                  placeholder="Win+H"
                  className="kimix-settings-input h-9 w-40 rounded-lg text-center text-[14px] outline-none transition-colors"
                />
              </div>
              <div className="kimix-settings-hint mt-3 text-right text-[12.5px] leading-5">示例：Win+H、Ctrl+Alt+V、F8</div>
            </div>
          </div>

          <div className="kimix-settings-section">
            <div className="kimix-settings-row-title">
              <div className="kimix-settings-section-title">
                <Archive size={16} className="text-[#8f887e]" />
                <span>归档对话</span>
              </div>
              <span className="kimix-settings-badge text-[12.5px] leading-5" style={{ paddingLeft: 10, paddingRight: 10 }}>
                {archivedSessions.length}
              </span>
            </div>
            <div className="kimix-settings-card" style={{ padding: "18px 16px" }}>
              {archivedSessions.length > 0 ? (
                <div className="flex flex-col" style={{ gap: 10 }}>
                  {archivedSessions.slice(0, 8).map((session) => (
                    <div key={session.id} className="kimix-settings-list-item flex min-w-0 items-center" style={{ gap: 10, padding: "11px 11px" }}>
                      <MessageSquare size={15} className="shrink-0 text-[#8f887e]" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-medium leading-5 text-[var(--kimix-panel-text)]">{session.title}</div>
                        <div className="mt-0.5 truncate text-[12.5px] leading-5 text-[var(--kimix-panel-text-muted)]">{session.projectPath}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRestoreSession(session.id)}
                        className="kimix-icon-text-button is-compact shrink-0 text-[#625d55] hover:bg-[#f1eee8]"
                      >
                        <RotateCcw size={13} />
                        恢复
                      </button>
                    </div>
                  ))}
                  {archivedSessions.length > 8 && (
                    <div className="pt-1 text-[12.5px] leading-5 text-[var(--kimix-panel-text-muted)]">仅显示最近 8 个归档对话。</div>
                  )}
                </div>
              ) : (
                <div className="text-[13.5px] leading-6 text-[var(--kimix-panel-text-secondary)]">暂无归档对话。</div>
              )}
            </div>
          </div>

          <div className="kimix-settings-section">
            <div className="kimix-settings-row-title">
              <div className="kimix-settings-section-title">
                <AlertCircle size={16} className="text-[#8f887e]" />
                <span>卡死诊断</span>
              </div>
              <div className="flex items-center" style={{ gap: 8 }}>
                <span className="kimix-settings-badge text-[12.5px] leading-5" style={{ paddingLeft: 10, paddingRight: 10 }}>
                  {freezeReports.length}
                </span>
                <button type="button" onClick={loadFreezeReports} className="kimix-icon-text-button is-compact text-[#625d55] hover:bg-[#f1eee8]">
                  <RefreshCw size={13} />
                  刷新
                </button>
                <button type="button" onClick={clearFreezeReports} className="kimix-icon-text-button is-compact text-[#8b3d34] hover:bg-[#f8ece8]">
                  <Trash2 size={13} />
                  清空
                </button>
              </div>
            </div>
            <div className="kimix-settings-card" style={{ padding: "18px 16px" }}>
              {freezeReports.length > 0 ? (
                <div className="flex flex-col" style={{ gap: 10 }}>
                  {freezeReports.map((report, index) => (
                    <div key={`${report.at}-${index}`} className="kimix-settings-list-item" style={{ padding: "12px 12px" }}>
                      <div className="flex min-w-0 items-center justify-between" style={{ gap: 10 }}>
                        <div className="truncate text-[14px] font-medium leading-5 text-[var(--kimix-panel-text)]">{formatFreezeTime(report.at)}</div>
                        <span className="shrink-0 rounded-full bg-[#fff4f0] text-[12.5px] leading-5 text-[#8b3d34]" style={{ paddingLeft: 9, paddingRight: 9 }}>
                          {report.lagMs} ms
                        </span>
                      </div>
                      <div className="mt-2 text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]">
                        <div className="truncate">当前会话：{report.sessionId ?? "无"}</div>
                        <div className="mt-1 truncate">运行会话：{report.runningSessionId ?? "无"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[13.5px] leading-6 text-[var(--kimix-panel-text-secondary)]">暂无卡死诊断记录。</div>
              )}
            </div>
          </div>

          <div className="kimix-settings-footer">Kimix v2.8.0 · 设置将自动保存到本地</div>
        </div>
      </div>
    </div>
  );
}
