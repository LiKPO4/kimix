type KimiCodePromptRoute = "server" | "sdk" | "sdk-fallback";

// 发送状态文案里的回退原因摘要上限，避免长错误文本撑破状态栏
const FALLBACK_REASON_MAX_LENGTH = 40;

// phase 区分进行/完成：两个生产调用点都在发送成功后使用，完成态不应残留"发送中"字样
export function kimiCodeRouteStatus(route?: KimiCodePromptRoute, fallbackReason?: string, phase: "sending" | "sent" = "sending") {
  const sent = phase === "sent";
  if (route === "server") return sent ? "经 Server 发送" : "经 Server 发送中";
  if (route === "sdk") return sent ? "经 SDK 发送" : "经 SDK 发送中";
  if (route === "sdk-fallback") {
    const reason = fallbackReason?.replace(/\s+/g, " ").trim();
    const summary = reason
      ? `：${reason.length > FALLBACK_REASON_MAX_LENGTH ? `${reason.slice(0, FALLBACK_REASON_MAX_LENGTH - 1)}…` : reason}`
      : "";
    return `经 SDK 发送${sent ? "" : "中"}（Server 不可用${summary}）`;
  }
  return sent ? "消息已发送" : "消息发送中";
}
