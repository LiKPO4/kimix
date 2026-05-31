import { AlertCircle, ClipboardCopy, LogIn, RefreshCw, RotateCcw, Settings, X } from "lucide-react";
import { useState } from "react";
import { useAppStore } from "@/stores/appStore";
import type { TimelineEvent } from "@/types/ui";

interface ErrorCardProps {
  event: Extract<TimelineEvent, { type: "error" }>;
  onRetry?: () => Promise<void>;
}

type ErrorRecoveryKind = "login" | "model_config" | "context" | "terminated" | "compact" | "generic";

function classifyError(message: string): { kind: ErrorRecoveryKind; title: string; suggestion: string } {
  if (/auth\.login_required|requires login|Kimi Code 需要重新登录|OAuth provider/i.test(message)) {
    return {
      kind: "login",
      title: "需要重新登录",
      suggestion: "登录凭证已失效或迁移后不可复用。完成浏览器授权后，再重新发送这一轮消息。",
    };
  }
  if (/API Key 无效|Base URL|模型名不可用|model.*not.*found|unknown model|invalid model|api[_ -]?key|unauthorized|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(message)) {
    return {
      kind: "model_config",
      title: "模型配置需要检查",
      suggestion: "检查 Provider 的 Base URL、API Key、模型名和默认模型；保存后可先用设置页里的连接测试确认。",
    };
  }
  if (/token|context.*(limit|length|overflow)|maximum context|上下文|context_length|too many tokens/i.test(message)) {
    return {
      kind: "context",
      title: "上下文或 token 超限",
      suggestion: "建议先导出或复制关键内容，压缩对话、缩小输入范围，或切换到上下文更大的模型后重试。",
    };
  }
  if (/compact|compaction|压缩失败|摘要失败/i.test(message)) {
    return {
      kind: "compact",
      title: "上下文压缩失败",
      suggestion: "建议保留当前输出，减少本轮上下文后重试；如果仍失败，可以先导出会话再新开会话继续。",
    };
  }
  if (/TUI|PTY|ConPTY|hidden PTY|terminated|aborted|cancelled|canceled|SIGTERM|EPIPE|process.*exit|进程.*退出|异常退出|中断/i.test(message)) {
    return {
      kind: "terminated",
      title: "请求已中断",
      suggestion: "通常是 hidden TUI / CLI 进程退出或请求被中断。确认 Kimi Code 可正常启动、网络和登录状态后，可以重新发送上一条消息。",
    };
  }
  return {
    kind: "generic",
    title: "出错了",
    suggestion: "可以复制错误详情用于排查；如果这是模型或登录相关错误，优先检查 Kimi 登录和模型配置。",
  };
}

export function ErrorCard({ event, onRetry }: ErrorCardProps) {
  const [dismissed, setDismissed] = useState(false);
  const [loginState, setLoginState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [loginMessage, setLoginMessage] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [retryState, setRetryState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [retryMessage, setRetryMessage] = useState("");
  const setWorkspaceView = useAppStore((s) => s.setWorkspaceView);
  const recovery = classifyError(event.message);
  const isKimiLoginError = recovery.kind === "login";
  const canRetry = Boolean(onRetry) && (recovery.kind === "terminated" || recovery.kind === "generic");
  if (dismissed) return null;

  const handleLogin = async () => {
    setLoginState("running");
    setLoginMessage("");
    const res = await window.api.loginKimi();
    if (res.success) {
      setLoginState("done");
      setLoginMessage(res.data.message);
      window.dispatchEvent(new CustomEvent("kimix:kimi-auth-changed"));
      return;
    }
    setLoginState("error");
    setLoginMessage(res.error);
  };

  const copyError = async () => {
    await navigator.clipboard.writeText(event.message);
    setCopyMessage("已复制错误详情");
  };

  const openModelSettings = () => {
    setWorkspaceView("settings");
  };

  const retryLastPrompt = async () => {
    if (!onRetry || !canRetry) return;
    setRetryState("running");
    setRetryMessage("");
    try {
      await onRetry();
      setRetryState("done");
      setRetryMessage("已重新发送上一条消息");
    } catch (err) {
      setRetryState("error");
      setRetryMessage(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex justify-center">
      <div
        className="w-full rounded-xl border text-text-primary shadow-[0_1px_0_rgba(25,23,20,0.02)]"
        style={{
          borderColor: "rgba(216,59,1,0.18)",
          background: "rgba(216,59,1,0.04)",
          paddingLeft: 16,
          paddingRight: 16,
          paddingTop: 12,
          paddingBottom: 12,
        }}
      >
        <div className="flex items-start" style={{ gap: 12 }}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-danger-light text-accent-danger">
            <AlertCircle size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between" style={{ gap: 12 }}>
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-medium leading-6 text-accent-danger">{recovery.title}</div>
                <p className="mt-1 text-[13.5px] leading-6 text-text-secondary">{event.message}</p>
                <div className="rounded-lg bg-surface-elevated text-[13px] leading-5 text-text-secondary" style={{ marginTop: 10, padding: "10px 12px" }}>
                  {recovery.suggestion}
                </div>
                <div className="flex flex-wrap items-center" style={{ gap: 10, marginTop: 12 }}>
                  {isKimiLoginError && (
                    <button
                      type="button"
                      onClick={() => void handleLogin()}
                      disabled={loginState === "running"}
                      className="kimix-icon-text-button is-compact bg-accent-primary text-white hover:bg-accent-primary-dark disabled:cursor-wait disabled:opacity-65"
                    >
                      {loginState === "running" ? <RefreshCw size={14} className="kimix-spin" /> : <LogIn size={14} />}
                      <span>{loginState === "running" ? "打开中" : "去登录"}</span>
                    </button>
                  )}
                  {canRetry && (
                    <button
                      type="button"
                      onClick={() => void retryLastPrompt()}
                      disabled={retryState === "running"}
                      className="kimix-icon-text-button is-compact bg-accent-primary text-white hover:bg-accent-primary-dark disabled:cursor-wait disabled:opacity-65"
                    >
                      {retryState === "running" ? <RefreshCw size={14} className="kimix-spin" /> : <RotateCcw size={14} />}
                      <span>{retryState === "running" ? "重试中" : "重试上一条"}</span>
                    </button>
                  )}
                  {recovery.kind === "model_config" && (
                    <button
                      type="button"
                      onClick={openModelSettings}
                      className="kimix-icon-text-button is-compact bg-accent-primary text-white hover:bg-accent-primary-dark"
                    >
                      <Settings size={14} />
                      <span>打开模型配置</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void copyError()}
                    className="kimix-icon-text-button is-compact text-text-muted hover:bg-surface-hover"
                  >
                    <ClipboardCopy size={14} />
                    <span>复制详情</span>
                  </button>
                  {(loginMessage || retryMessage || copyMessage) && (
                    <span className={`text-[12.5px] leading-5 ${loginState === "error" || retryState === "error" ? "text-accent-danger" : "text-text-muted"}`}>
                      {loginMessage || retryMessage || copyMessage}
                    </span>
                  )}
                </div>
              </div>
              {event.canDismiss !== false && (
                <button
                  type="button"
                  onClick={() => setDismissed(true)}
                  className="kimix-icon-text-button is-compact shrink-0 text-text-muted hover:bg-accent-danger/10 hover:text-accent-danger"
                  style={{ minWidth: 32, paddingLeft: 8, paddingRight: 8 }}
                  aria-label="关闭错误提示"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
