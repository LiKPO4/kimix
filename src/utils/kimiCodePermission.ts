import type { PermissionMode } from "@/types/ui";
import { runKimiCodeSessionMutationWithRecovery } from "./kimiCodeSessionRecovery";

type PermissionResponse = { success: true; data: unknown } | { success: false; error: string };
type ResumeResponse = {
  success: true;
  data: { sessionId: string; workDir: string };
} | { success: false; error: string };

export async function setKimiCodePermissionWithRecovery(input: {
  sessionId: string;
  mode: PermissionMode;
  projectPath?: string;
  additionalWorkDirs: string[];
  setPermission: (request: { sessionId: string; mode: PermissionMode }) => Promise<PermissionResponse>;
  resumeSession: (request: { sessionId: string; additionalWorkDirs: string[] }) => Promise<ResumeResponse>;
}): Promise<{ success: true; sessionId: string } | { success: false; error: string }> {
  return runKimiCodeSessionMutationWithRecovery({
    sessionId: input.sessionId,
    projectPath: input.projectPath,
    additionalWorkDirs: input.additionalWorkDirs,
    crossProjectError: "恢复后的会话属于其他项目，已拒绝切换权限",
    mutate: (sessionId) => input.setPermission({ sessionId, mode: input.mode }),
    resumeSession: input.resumeSession,
  });
}
