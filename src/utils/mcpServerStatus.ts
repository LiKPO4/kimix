// MCP 服务状态文案/配色映射。
// 取值集合来自上游 0.34.0（kimi-code #2694）：
// pending/connected/failed/disabled/needs-auth/removed；
// 兼容旧 Server 路由（/api/v1/mcp/servers）的 connecting/error/disconnected。
// 未知值兜底显示原始字符串，避免再次出现“未连接”这类误导文案。

export function mcpStatusLabel(status: string): string {
  switch (status) {
    case "connected":
      return "已连接";
    case "pending":
    case "connecting":
      return "连接中";
    case "failed":
    case "error":
      return "连接失败";
    case "disabled":
      return "已禁用";
    case "needs-auth":
      return "需要授权";
    case "removed":
      return "已移除";
    default:
      return status;
  }
}

export function mcpStatusTone(status: string): string {
  switch (status) {
    case "connected":
      return "text-accent-success";
    case "failed":
    case "error":
    case "needs-auth":
      return "text-accent-danger";
    default:
      return "text-[var(--kimix-panel-text-muted)]";
  }
}
