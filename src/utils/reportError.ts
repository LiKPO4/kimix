/**
 * reportError — 统一错误记录工具。
 *
 * - background: 后台操作失败（持久化/清理/轮询），仅 console.warn，不打扰用户。
 * - userVisible: 用户操作失败，console.error + toast。
 *
 * 替换 `.catch(() => {})` 的静默吞错，让无用信息进入 diag 日志便于调试。
 */

type ReportOptions = {
  context?: string;
  userVisible?: boolean;
};

export function reportError(error: unknown, options: ReportOptions = {}): void {
  const { context = "", userVisible = false } = options;
  const message = error instanceof Error ? error.message : String(error);
  const prefix = context ? `[${context}]` : "";

  if (userVisible) {
    console.error(`${prefix} ${message}`, error);
    (window.api?.writeDiag?.({ message: `${prefix} user-visible error`, data: { message, stack: error instanceof Error ? error.stack : undefined } }) ?? Promise.resolve())
      .catch(() => {});
    window.dispatchEvent(new CustomEvent("kimix:toast", { detail: message }));
  } else {
    console.warn(`${prefix} ${message}`);
    (window.api?.writeDiag?.({ message: `${prefix} background error`, data: { message } }) ?? Promise.resolve())
      .catch(() => {});
  }
}

/** 用于替换 background 类 catch 的 shorthand */
export const logError = (context: string) => (error: unknown) => reportError(error, { context });

/** 记录结构化诊断事件，不视为错误 */
export function logEvent(context: string, data: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.log(`[${context}]`, data);
  (window.api?.writeDiag?.({ message: context, data }) ?? Promise.resolve()).catch(logError("writeDiag"));
}
