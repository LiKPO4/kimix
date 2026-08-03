import type { PermissionMode } from "@/types/ui";
import { runKimiCodeSessionMutationWithRecovery } from "./kimiCodeSessionRecovery";

type PermissionResponse = { success: true; data: unknown } | { success: false; error: string };

/**
 * 从官方 agent.status.updated 事件中提取权威权限模式；只接受 manual/auto/yolo，
 * 其余值（含缺失）一律视为未提供，避免把未知状态误写进会话。
 */
export function extractPermissionModeStatus(value: unknown): PermissionMode | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as { permission?: unknown };
  return record.permission === "manual" || record.permission === "auto" || record.permission === "yolo"
    ? record.permission
    : undefined;
}

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
