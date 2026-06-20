type KimiCodePromptRoute = "server" | "sdk" | "sdk-fallback";

export function kimiCodeRouteStatus(_route: KimiCodePromptRoute) {
  return "消息发送中";
}
