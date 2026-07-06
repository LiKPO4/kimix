type MessageEventLike = {
  type: string;
  message?: string;
};

/** HTTP 状态码或协议级别的 "not found" 错误识别。
 *  优先检查 error 上的数字状态码（statusCode），正则作向后兼容兜底。 */
// 404=不存在 410=已归档；409 是 Conflict（非 missing），归 inactive 检查
const SESSION_NOT_FOUND_CODES = [404, 410];
const SESSION_NOT_FOUND_RE = /(?:HTTP\s+404|session not found|was not found|unknown session|does not exist|会话不存在|session.*missing)/i;

function getErrorStatusCode(error: unknown): number | undefined {
  const err = error as Record<string, unknown>;
  return typeof err.statusCode === "number" ? err.statusCode
    : typeof err.code === "number" ? err.code
    : err.cause && typeof (err.cause as Record<string, unknown>).statusCode === "number"
      ? (err.cause as Record<string, unknown>).statusCode as number
      : undefined;
}

export function isKimiCodeSessionMissingError(error: unknown) {
  const statusCode = getErrorStatusCode(error);
  if (statusCode !== undefined) return SESSION_NOT_FOUND_CODES.includes(statusCode);
  const message = error instanceof Error ? error.message : String(error);
  return SESSION_NOT_FOUND_RE.test(message);
}

export function isKimiCodeSessionInactiveError(error: unknown) {
  const statusCode = getErrorStatusCode(error);
  if (statusCode !== undefined) return statusCode === 400 || statusCode === 409;
  const message = error instanceof Error ? error.message : String(error);
  return /Kimi (?:Code|Server) session is not active/i.test(message);
}

type SessionMutationResponse = { success: true; data: unknown } | { success: false; error: string };
type ResumeSessionResponse = {
  success: true;
  data: { sessionId: string; workDir: string };
} | { success: false; error: string };

function isSameWorkDir(left?: string, right?: string) {
  return Boolean(left && right) && left!.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() === right!.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export async function runKimiCodeSessionMutationWithRecovery(input: {
  sessionId: string;
  projectPath?: string;
  additionalWorkDirs: string[];
  crossProjectError: string;
  mutate: (sessionId: string) => Promise<SessionMutationResponse>;
  resumeSession: (request: { sessionId: string; additionalWorkDirs: string[] }) => Promise<ResumeSessionResponse>;
}): Promise<{ success: true; sessionId: string } | { success: false; error: string }> {
  const initial = await input.mutate(input.sessionId);
  if (initial.success) return { success: true, sessionId: input.sessionId };
  if (!isKimiCodeSessionInactiveError(initial.error)) return initial;

  const resumed = await input.resumeSession({
    sessionId: input.sessionId,
    additionalWorkDirs: input.additionalWorkDirs,
  });
  if (!resumed.success) return { success: false, error: `恢复会话失败：${resumed.error}` };
  if (input.projectPath && !isSameWorkDir(resumed.data.workDir, input.projectPath)) {
    return { success: false, error: input.crossProjectError };
  }

  const retried = await input.mutate(resumed.data.sessionId);
  return retried.success
    ? { success: true, sessionId: resumed.data.sessionId }
    : { success: false, error: retried.error };
}

export function removeStaleKimiCodeStartupErrors<T extends MessageEventLike>(events: T[]) {
  return events.filter((event) => !(
    event.type === "error" &&
    event.message?.startsWith("恢复上次 Kimi Code 会话失败：") &&
    isKimiCodeSessionMissingError(event.message)
  ));
}
