type MessageEventLike = {
  type: string;
  message?: string;
};

export function isKimiCodeSessionMissingError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:HTTP\s+404|session not found|was not found|unknown session|does not exist|会话不存在|session.*missing)/i.test(message);
}

export function isKimiCodeSessionInactiveError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /Kimi (?:Code|Server) session is not active/i.test(message);
}

export function removeStaleKimiCodeStartupErrors<T extends MessageEventLike>(events: T[]) {
  return events.filter((event) => !(
    event.type === "error" &&
    event.message?.startsWith("恢复上次 Kimi Code 会话失败：") &&
    isKimiCodeSessionMissingError(event.message)
  ));
}
