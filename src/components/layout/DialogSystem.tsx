import {
  BookOpen,
  Copy,
  ExternalLink,
  HelpCircle,
  History,
  Info,
  Keyboard,
  Monitor,
  RefreshCw,
  SquareTerminal,
  X,
} from "lucide-react";
import type { KimiCliUpdateInfo } from "@electron/types/ipc";
import { formatDownloadPercent, formatDownloadDetail, formatReleaseDate, type DownloadProgressInfo } from "@/utils/format";

type HelpDialog = "about" | "updates" | "shortcuts" | "info";

type ReleaseInfo = {
  tagName: string;
  name: string;
  body: string;
  publishedAt: string;
  htmlUrl: string;
  assets: { name: string; downloadUrl: string }[];
};

const RELEASE_TIMELINE = [
  { version: "v2.5.0", date: "2026-05-10", text: "补齐顶部中文菜单、关于与更新页面，接入 GitHub Release 检查更新。" },
  { version: "v2.4.24", date: "2026-05-10", text: "修复引导状态显示、官方 steer 事件映射、队列续发顺序和 dev 白屏。" },
  { version: "v2.4.23", date: "2026-05-10", text: "增加启动后渲染内容自检，空 root 时自动重载一次。" },
  { version: "v2.4.22", date: "2026-05-10", text: "收敛按钮尺寸、圆角框灰色化，并优化 TodoList 面板密度。" },
  { version: "v2.4.18", date: "2026-05-10", text: "接入官方 slash 命令和项目文件候选。" },
];

const KIMI_CLI_DOCS_URL = "https://moonshotai.github.io/kimi-cli/zh/guides/getting-started.html";
const KIMI_CLI_WINDOWS_INSTALL_COMMAND = "Invoke-RestMethod https://code.kimi.com/install.ps1 | Invoke-Expression";

interface KimiOnboardingProps {
  show: boolean;
  message: string;
  installBusy: boolean;
  onDismiss: () => void;
  onInstall: () => void;
  onCheck: () => void;
  onOpenSettings: () => void;
  copyToClipboard: (text: string, toast: string) => void;
}

function KimiOnboardingDialog({
  show,
  message,
  installBusy,
  onDismiss,
  onInstall,
  onCheck,
  onOpenSettings,
  copyToClipboard,
}: KimiOnboardingProps) {
  if (!show) return null;
  return (
    <div className="kimix-onboarding-overlay fixed inset-0 z-[118] flex items-center justify-center backdrop-blur-sm" style={{ padding: 24 }}>
      <div className="kimix-onboarding-card w-full max-w-[560px] rounded-[18px] border shadow-[0_26px_80px_rgba(35,31,25,0.18)]" style={{ padding: "22px 24px" }}>
        <div className="flex items-start justify-between" style={{ gap: 16 }}>
          <div className="flex min-w-0 items-start" style={{ gap: 14 }}>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-primary-light text-accent-primary">
              <SquareTerminal size={20} />
            </div>
            <div className="min-w-0">
              <div className="text-[18px] font-semibold leading-7 text-text-primary">需要先配置 Kimi CLI</div>
              <div className="mt-1 text-[14px] leading-6 text-text-secondary">
                Kimix 通过本机的 <span className="font-medium text-text-primary">kimi</span> 命令启动对话。当前没有在 PATH 中找到 Kimi CLI，配置完成后才能正常发送消息。
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface-hover"
            aria-label="稍后配置"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-5 rounded-xl border border-border-subtle bg-surface-base" style={{ padding: "16px 16px 18px" }}>
          <div className="text-[13px] font-medium leading-5 text-text-secondary">推荐步骤</div>
          <div className="mt-2 grid gap-2 text-[13.5px] leading-6 text-text-secondary">
            <div>1. 点击"一键安装"，或使用官方脚本安装 Kimi CLI（脚本会自动安装 uv）。</div>
            <div>2. 安装完成后，在系统终端运行 <span className="rounded-md bg-surface-elevated px-1.5 py-0.5 font-mono text-[12.5px] text-text-primary">kimi</span>，再输入 <span className="rounded-md bg-surface-elevated px-1.5 py-0.5 font-mono text-[12.5px] text-text-primary">/login</span> 完成登录。</div>
            <div>3. 重启 Kimix 或点击"重新检测"。</div>
          </div>
          <div className="mt-4 rounded-lg border border-border-subtle bg-surface-elevated font-mono text-[12.5px] leading-5 text-text-primary" style={{ padding: "12px 12px" }}>
            {KIMI_CLI_WINDOWS_INSTALL_COMMAND}
          </div>
          <div className="mt-2 text-[12.5px] leading-5 text-text-muted">
            检测结果：{message}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between" style={{ gap: 12, marginTop: 24 }}>
          <div className="flex flex-wrap items-center" style={{ gap: 10 }}>
            <button
              type="button"
              onClick={() => void onInstall()}
              disabled={installBusy}
              className="kimix-icon-text-button is-compact bg-accent-primary text-text-inverse hover:bg-accent-primary-dark disabled:cursor-wait disabled:opacity-65"
              style={{ minHeight: 34, paddingTop: 6, paddingBottom: 6 }}
            >
              {installBusy ? <RefreshCw size={14} className="kimix-spin" /> : <SquareTerminal size={14} />}
              <span>{installBusy ? "安装中" : "一键安装"}</span>
            </button>
            <button
              type="button"
              onClick={() => void window.api.openExternal(KIMI_CLI_DOCS_URL)}
              className="kimix-icon-text-button is-compact text-accent-primary hover:bg-accent-primary-light"
              style={{ minHeight: 34, paddingTop: 6, paddingBottom: 6 }}
            >
              <ExternalLink size={14} />
              <span>打开官方说明</span>
            </button>
            <button
              type="button"
              onClick={() => void copyToClipboard(KIMI_CLI_WINDOWS_INSTALL_COMMAND, "已复制安装命令")}
              className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover"
              style={{ minHeight: 34, paddingTop: 6, paddingBottom: 6 }}
            >
              <Copy size={14} />
              <span>复制安装命令</span>
            </button>
          </div>
          <div className="flex flex-wrap items-center" style={{ gap: 10 }}>
            <button
              type="button"
              onClick={() => {
                onDismiss();
                onOpenSettings();
              }}
              className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover"
              style={{ minHeight: 34, paddingTop: 6, paddingBottom: 6 }}
            >
              <Monitor size={14} />
              <span>打开设置</span>
            </button>
            <button
              type="button"
              onClick={() => void onCheck()}
              className="kimix-icon-text-button is-compact text-accent-primary hover:bg-accent-primary-light"
              style={{ minHeight: 34, paddingTop: 6, paddingBottom: 6 }}
            >
              <RefreshCw size={14} />
              <span>重新检测</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface LaunchCommandDialogProps {
  open: boolean;
  draft: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}

function LaunchCommandDialog({ open, draft, onChange, onClose, onSave }: LaunchCommandDialogProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/20 px-5" onMouseDown={onClose}>
      <div
        className="kimix-modal-card w-full max-w-[520px] rounded-[18px] border shadow-[0_28px_90px_rgba(25,23,20,0.24)]"
        style={{ padding: "22px 24px 24px" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between" style={{ gap: 16 }}>
          <div className="min-w-0">
            <div className="text-[18px] font-semibold leading-6 text-text-primary">设置启动命令</div>
            <div className="mt-2 text-[13.5px] leading-6 text-text-secondary">命令会在当前项目目录中打开终端执行。</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface-hover hover:text-text-primary"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>
        <textarea
          value={draft}
          onChange={(event) => onChange(event.target.value)}
          className="mt-5 min-h-[96px] w-full resize-y rounded-xl border border-border-default bg-surface-elevated text-[14px] leading-6 text-text-primary outline-none focus:border-accent-primary-soft"
          style={{ padding: "12px 14px" }}
          placeholder="例如：pnpm dev"
          autoFocus
        />
        <div className="mt-5 flex justify-end" style={{ gap: 12 }}>
          <button
            type="button"
            onClick={onClose}
            className="kimix-icon-text-button bg-surface-hover text-text-secondary hover:bg-surface-active"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void onSave()}
            className="kimix-icon-text-button bg-text-primary text-text-inverse hover:opacity-90"
          >
            保存命令
          </button>
        </div>
      </div>
    </div>
  );
}

interface ShutdownDialogProps {
  dialog: { taskTitle: string; remainingSeconds: number } | null;
  onCancel: () => void;
}

function ShutdownDialog({ dialog, onCancel }: ShutdownDialogProps) {
  if (!dialog) return null;
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/25 px-5">
      <div className="kimix-modal-card w-full max-w-[460px] rounded-[18px] border shadow-[0_28px_90px_rgba(25,23,20,0.24)]" style={{ padding: "22px 24px" }}>
        <div className="text-[18px] font-semibold leading-6 text-text-primary">长程任务已完成</div>
        <div className="mt-3 text-[14px] leading-6 text-text-secondary">
          「{dialog.taskTitle}」已执行完成。已按你的设置安排关机。
        </div>
        <div className="mt-5 rounded-xl border border-border-subtle bg-surface-base text-center" style={{ padding: "18px 16px" }}>
          <div className="text-[13px] leading-5 text-text-muted">距离关机还有</div>
          <div className="mt-1 font-mono text-[34px] font-semibold leading-[1.2] text-text-primary">
            {Math.floor(dialog.remainingSeconds / 60)}:{String(dialog.remainingSeconds % 60).padStart(2, "0")}
          </div>
        </div>
        <div className="mt-5 flex justify-end" style={{ gap: 12 }}>
          <button
            type="button"
            onClick={() => void onCancel()}
            className="kimix-icon-text-button bg-accent-primary text-text-inverse hover:bg-accent-primary-dark"
            style={{ paddingLeft: 18, paddingRight: 18 }}
          >
            取消关机
          </button>
        </div>
      </div>
    </div>
  );
}

interface HelpDialogProps {
  dialog: HelpDialog | null;
  infoTopic: { title: string; body: string; url?: string } | null;
  appInfo: { name: string; version: string; author: string; repository: string };
  updateState: {
    loading: boolean;
    downloading: boolean;
    downloadProgress: DownloadProgressInfo | null;
    message: string;
    latest: ReleaseInfo | null;
    hasUpdate: boolean;
  };
  cliUpdateState: {
    loading: boolean;
    updating: boolean;
    message: string;
    info: KimiCliUpdateInfo | null;
    hasUpdate: boolean;
  };
  onClose: () => void;
  onDownloadUpdate: () => void;
  onOpenLatestRelease: () => void;
  onCheckUpdates: () => void;
  onUpdateKimiCli: () => void;
  onCheckCliUpdate: () => void;
}

function HelpDialogPanel({
  dialog,
  infoTopic,
  appInfo,
  updateState,
  cliUpdateState,
  onClose,
  onDownloadUpdate,
  onOpenLatestRelease,
  onCheckUpdates,
  onUpdateKimiCli,
  onCheckCliUpdate,
}: HelpDialogProps) {
  if (!dialog) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/20 px-5" onMouseDown={onClose}>
      <div className="kimix-modal-card w-full max-w-[560px] rounded-[18px] border shadow-[0_28px_90px_rgba(25,23,20,0.24)]" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border-subtle" style={{ padding: "16px 20px" }}>
          <div className="flex items-center gap-2.5 text-[18px] font-semibold text-text-primary">
            {dialog === "about" && <Info size={18} />}
            {dialog === "updates" && <History size={18} />}
            {dialog === "shortcuts" && <Keyboard size={18} />}
            {dialog === "info" && <HelpCircle size={18} />}
            <span>
              {dialog === "about" ? "关于 Kimix" : dialog === "updates" ? "更新记录" : dialog === "shortcuts" ? "键盘快捷键" : infoTopic?.title}
            </span>
          </div>
          <button className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-surface-hover hover:text-text-primary" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto" style={{ padding: 22 }}>
          {dialog === "about" && (
            <div className="space-y-4 text-[14.5px] leading-7 text-text-secondary">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-hover text-text-primary">
                  <BookOpen size={22} />
                </div>
                <div>
                  <div className="text-[20px] font-semibold text-text-primary">{appInfo.name}</div>
                  <div className="text-text-muted">版本 v{appInfo.version}</div>
                </div>
              </div>
              <p>Kimix 是一个面向 Kimi Code CLI 的桌面客户端，目标是提供接近 Codex 的项目对话、队列、引导、工具调用和本地开发体验。</p>
              <div className="rounded-xl border border-border-subtle bg-surface-base" style={{ paddingTop: 18, paddingRight: 16, paddingBottom: 18, paddingLeft: 16 }}>
                <div>开发者：{appInfo.author}</div>
                <button className="kimix-icon-text-button is-compact mt-4 text-accent-primary hover:bg-accent-primary-light" onClick={() => window.api.openExternal(appInfo.repository)}>
                  打开 GitHub 仓库 <ExternalLink size={13} />
                </button>
              </div>
            </div>
          )}

          {dialog === "updates" && (
            <div className="space-y-4 text-[14.5px] text-text-secondary">
              <div className="grid rounded-xl border border-border-subtle bg-surface-base" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", columnGap: 18, rowGap: 12, paddingLeft: 20, paddingRight: 22, paddingTop: 18, paddingBottom: 18 }}>
                <div className="min-w-0">
                  <div className="mb-1 text-[12px] font-semibold text-text-muted">Kimix 本体</div>
                  <div className="font-semibold text-text-primary">{updateState.message}</div>
                  {updateState.latest && <div className="mt-1 text-[13px] text-text-muted">最新版本：{updateState.latest.tagName} · {formatReleaseDate(updateState.latest.publishedAt)}</div>}
                  {updateState.downloadProgress && (
                    <div className="mt-2 text-[12.5px] text-text-muted">
                      {formatDownloadDetail(updateState.downloadProgress)}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center self-center" style={{ gap: 8 }}>
                  {updateState.hasUpdate && (
                    <button
                      onClick={onDownloadUpdate}
                      disabled={updateState.downloading || updateState.loading}
                      className="kimix-icon-text-button h-10 shrink-0 bg-accent-primary text-text-inverse hover:bg-accent-primary-dark disabled:opacity-45"
                      style={{ paddingLeft: 16, paddingRight: 18 }}
                    >
                      <RefreshCw size={14} className={updateState.downloading ? "kimix-spin" : ""} />
                      {updateState.downloading
                        ? `下载中 ${formatDownloadPercent(updateState.downloadProgress?.percent ?? 0)}`
                        : "升级"}
                    </button>
                  )}
                  <button
                    onClick={onOpenLatestRelease}
                    disabled={updateState.loading}
                    className="kimix-icon-text-button h-10 shrink-0 bg-surface-elevated text-text-primary hover:bg-surface-hover disabled:opacity-45"
                    style={{ paddingLeft: 16, paddingRight: 18 }}
                  >
                    <ExternalLink size={14} />
                    浏览器下载
                  </button>
                  <button
                    onClick={onCheckUpdates}
                    disabled={updateState.loading || updateState.downloading}
                    className="kimix-icon-text-button h-10 shrink-0 bg-text-primary text-text-inverse hover:opacity-90 disabled:opacity-45"
                    style={{ paddingLeft: 16, paddingRight: 18 }}
                  >
                    <RefreshCw size={14} className={updateState.loading ? "kimix-spin" : ""} />
                    检查本体
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between gap-4 rounded-xl border border-border-subtle bg-surface-base" style={{ paddingLeft: 20, paddingRight: 22, paddingTop: 18, paddingBottom: 18 }}>
                <div className="min-w-0">
                  <div className="mb-1 text-[12px] font-semibold text-text-muted">Kimi CLI</div>
                  <div className="font-semibold text-text-primary">{cliUpdateState.message}</div>
                  {cliUpdateState.info && (
                    <div className="mt-1 text-[13px] text-text-muted">
                      当前：{cliUpdateState.info.currentVersion ?? "未安装"} · 最新：{cliUpdateState.info.latestVersion ?? "未知"}
                    </div>
                  )}
                  {cliUpdateState.info?.path && <div className="mt-1 truncate text-[12px] text-text-muted" title={cliUpdateState.info.path}>{cliUpdateState.info.path}</div>}
                </div>
                <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
                  {cliUpdateState.hasUpdate && (
                    <button
                      onClick={onUpdateKimiCli}
                      disabled={cliUpdateState.updating || cliUpdateState.loading}
                      className="kimix-icon-text-button h-10 shrink-0 bg-accent-primary text-text-inverse hover:bg-accent-primary-dark disabled:opacity-45"
                      style={{ paddingLeft: 16, paddingRight: 18 }}
                    >
                      <RefreshCw size={14} className={cliUpdateState.updating ? "kimix-spin" : ""} />
                      {cliUpdateState.updating ? "更新中" : "一键更新"}
                    </button>
                  )}
                  <button
                    onClick={onCheckCliUpdate}
                    disabled={cliUpdateState.loading || cliUpdateState.updating}
                    className="kimix-icon-text-button h-10 shrink-0 bg-text-primary text-text-inverse hover:opacity-90 disabled:opacity-45"
                    style={{ paddingLeft: 16, paddingRight: 18 }}
                  >
                    <RefreshCw size={14} className={cliUpdateState.loading ? "kimix-spin" : ""} />
                    检查 CLI
                  </button>
                </div>
              </div>
              {updateState.latest && (
                <div className="rounded-xl border border-border-subtle" style={{ paddingTop: 18, paddingRight: 16, paddingBottom: 18, paddingLeft: 16 }}>
                  <div className="font-semibold text-text-primary">{updateState.latest.name || updateState.latest.tagName}</div>
                  <p className="mt-3 whitespace-pre-wrap leading-6">{updateState.latest.body || "该版本没有填写更新说明。"}</p>
                  <button className="kimix-icon-text-button is-compact mt-4 text-accent-primary hover:bg-accent-primary-light" onClick={() => window.api.openExternal(updateState.latest!.htmlUrl)}>
                    打开发布页面 <ExternalLink size={13} />
                  </button>
                </div>
              )}
              <div className="space-y-3">
                {RELEASE_TIMELINE.map((item) => (
                  <div key={item.version} className="rounded-xl border border-border-subtle bg-surface-elevated" style={{ paddingTop: 18, paddingRight: 16, paddingBottom: 18, paddingLeft: 16 }}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold text-text-primary">{item.version}</span>
                      <span className="text-[13px] text-text-muted">{item.date}</span>
                    </div>
                    <p className="mt-3 leading-6">{item.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {dialog === "shortcuts" && (
            <div className="grid gap-2 text-[14px] text-text-secondary">
              {["Ctrl+B 切换侧边栏", "Ctrl+K 聚焦输入框", "Ctrl+N 新对话", "Ctrl+O 打开项目", "Ctrl+R 重新载入页面", "Ctrl++ 放大", "Ctrl+- 缩小", "Ctrl+0 实际大小", "F11 切换全屏", "Esc 停止当前任务"].map((line) => (
                <div key={line} className="rounded-lg bg-surface-base" style={{ padding: "10px 14px" }}>{line}</div>
              ))}
            </div>
          )}

          {dialog === "info" && infoTopic && (
            <div className="space-y-4 text-[14.5px] leading-7 text-text-secondary">
              <p>{infoTopic.body}</p>
              {infoTopic.url && (
                <button className="kimix-icon-text-button is-compact text-accent-primary hover:bg-accent-primary-light" onClick={() => window.api.openExternal(infoTopic.url!)}>
                  打开相关页面 <ExternalLink size={13} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface DialogSystemProps {
  // Kimi onboarding
  showKimiOnboarding: boolean;
  kimiOnboardingMessage: string;
  kimiInstallBusy: boolean;
  onKimiDismiss: () => void;
  onKimiInstall: () => void;
  onKimiCheck: () => void;
  onKimiOpenSettings: () => void;
  copyToClipboard: (text: string, toast: string) => void;

  // Launch command
  launchCommandOpen: boolean;
  launchCommandDraft: string;
  onLaunchCommandChange: (value: string) => void;
  onLaunchCommandClose: () => void;
  onLaunchCommandSave: () => void;

  // Shutdown
  shutdownDialog: { taskTitle: string; remainingSeconds: number } | null;
  onShutdownCancel: () => void;

  // Help
  helpDialog: HelpDialog | null;
  infoTopic: { title: string; body: string; url?: string } | null;
  appInfo: { name: string; version: string; author: string; repository: string };
  updateState: HelpDialogProps["updateState"];
  cliUpdateState: HelpDialogProps["cliUpdateState"];
  onHelpClose: () => void;
  onDownloadUpdate: () => void;
  onOpenLatestRelease: () => void;
  onCheckUpdates: () => void;
  onUpdateKimiCli: () => void;
  onCheckCliUpdate: () => void;
}

export function DialogSystem(props: DialogSystemProps) {
  return (
    <>
      <KimiOnboardingDialog
        show={props.showKimiOnboarding}
        message={props.kimiOnboardingMessage}
        installBusy={props.kimiInstallBusy}
        onDismiss={props.onKimiDismiss}
        onInstall={props.onKimiInstall}
        onCheck={props.onKimiCheck}
        onOpenSettings={props.onKimiOpenSettings}
        copyToClipboard={props.copyToClipboard}
      />
      <LaunchCommandDialog
        open={props.launchCommandOpen}
        draft={props.launchCommandDraft}
        onChange={props.onLaunchCommandChange}
        onClose={props.onLaunchCommandClose}
        onSave={props.onLaunchCommandSave}
      />
      <ShutdownDialog
        dialog={props.shutdownDialog}
        onCancel={props.onShutdownCancel}
      />
      <HelpDialogPanel
        dialog={props.helpDialog}
        infoTopic={props.infoTopic}
        appInfo={props.appInfo}
        updateState={props.updateState}
        cliUpdateState={props.cliUpdateState}
        onClose={props.onHelpClose}
        onDownloadUpdate={props.onDownloadUpdate}
        onOpenLatestRelease={props.onOpenLatestRelease}
        onCheckUpdates={props.onCheckUpdates}
        onUpdateKimiCli={props.onUpdateKimiCli}
        onCheckCliUpdate={props.onCheckCliUpdate}
      />
    </>
  );
}
