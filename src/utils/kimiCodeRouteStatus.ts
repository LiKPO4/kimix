type KimiCodePromptRoute = "server" | "sdk" | "sdk-fallback";

export function kimiCodeRouteStatus(route: KimiCodePromptRoute) {
  return route === "server"
    ? "使用kimi server链路已发送消息"
    : "kimi sdk链路已发送消息";
}
