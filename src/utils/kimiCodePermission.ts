import type { PermissionMode } from "@/types/ui";
import { isKimiCodeSessionInactiveError } from "./kimiCodeSessionRecovery";

type PermissionResponse = { success: true; data: unknown } | { success: false; error: string };
type ResumeResponse = {
  success: true;
  data: { sessionId: string; workDir: string };
} | { success: false; error: string };

function sameWorkDir(left?: string, right?: string) {
  return Boolean(left && right) && left!.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() === right!.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export async function setKimiCodePermissionWithRecovery(input: {
  sessionId: string;
  mode: PermissionMode;
  projectPath?: string;
  additionalWorkDirs: string[];
  setPermission: (request: { sessionId: string; mode: PermissionMode }) => Promise<PermissionResponse>;
  resumeSession: (request: { sessionId: string; additionalWorkDirs: string[] }) => Promise<ResumeResponse>;
}): Promise<{ success: true; sessionId: string } | { success: false; error: string }> {
  const initial = await input.setPermission({ sessionId: input.sessionId, mode: input.mode });
  if (initial.success) return { success: true, sessionId: input.sessionId };
  if (!isKimiCodeSessionInactiveError(initial.error)) return initial;

  const resumed = await input.resumeSession({
    sessionId: input.sessionId,
    additionalWorkDirs: input.additionalWorkDirs,
  });
  if (!resumed.success) return { success: false, error: `恢复会话失败：${resumed.error}` };
  if (input.projectPath && !sameWorkDir(resumed.data.workDir, input.projectPath)) {
    return { success: false, error: "恢复后的会话属于其他项目，已拒绝切换权限" };
  }

  const retried = await input.setPermission({ sessionId: resumed.data.sessionId, mode: input.mode });
  return retried.success
    ? { success: true, sessionId: resumed.data.sessionId }
    : { success: false, error: retried.error };
}
