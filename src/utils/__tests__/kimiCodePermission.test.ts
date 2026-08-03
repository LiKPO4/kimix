import { describe, expect, it, vi } from "vitest";
import { extractPermissionModeStatus, setKimiCodePermissionWithRecovery } from "../kimiCodePermission";

describe("setKimiCodePermissionWithRecovery", () => {
  it("resumes an inactive session and retries permission on the recovered runtime", async () => {
    const setPermission = vi.fn()
      .mockResolvedValueOnce({ success: false, error: "Kimi Code session is not active: session-1" })
      .mockResolvedValueOnce({ success: true, data: undefined });
    const resumeSession = vi.fn().mockResolvedValue({
      success: true,
      data: { sessionId: "session-1", workDir: "D:\\work\\demo" },
    });

    await expect(setKimiCodePermissionWithRecovery({
      sessionId: "session-1",
      mode: "auto",
      projectPath: "d:/work/demo/",
      additionalWorkDirs: [],
      setPermission,
      resumeSession,
    })).resolves.toEqual({ success: true, sessionId: "session-1" });
    expect(setPermission).toHaveBeenCalledTimes(2);
    expect(resumeSession).toHaveBeenCalledTimes(1);
  });

  it("does not resume for unrelated errors or accept another project", async () => {
    const unrelatedResume = vi.fn();
    await expect(setKimiCodePermissionWithRecovery({
      sessionId: "session-1",
      mode: "yolo",
      projectPath: "D:/work/demo",
      additionalWorkDirs: [],
      setPermission: vi.fn().mockResolvedValue({ success: false, error: "network unavailable" }),
      resumeSession: unrelatedResume,
    })).resolves.toEqual({ success: false, error: "network unavailable" });
    expect(unrelatedResume).not.toHaveBeenCalled();

    const crossProjectSet = vi.fn().mockResolvedValue({ success: false, error: "Kimi Code session is not active: session-1" });
    await expect(setKimiCodePermissionWithRecovery({
      sessionId: "session-1",
      mode: "manual",
      projectPath: "D:/work/demo",
      additionalWorkDirs: [],
      setPermission: crossProjectSet,
      resumeSession: vi.fn().mockResolvedValue({ success: true, data: { sessionId: "session-2", workDir: "D:/work/other" } }),
    })).resolves.toEqual({ success: false, error: "恢复后的会话属于其他项目，已拒绝切换权限" });
    expect(crossProjectSet).toHaveBeenCalledTimes(1);
  });
});

describe("extractPermissionModeStatus", () => {
  it("accepts the three official permission modes", () => {
    expect(extractPermissionModeStatus({ type: "agent.status.updated", permission: "manual" })).toBe("manual");
    expect(extractPermissionModeStatus({ type: "agent.status.updated", permission: "auto" })).toBe("auto");
    expect(extractPermissionModeStatus({ type: "agent.status.updated", permission: "yolo" })).toBe("yolo");
  });

  it("rejects unknown permission values", () => {
    expect(extractPermissionModeStatus({ type: "agent.status.updated", permission: "ask-everything" })).toBeUndefined();
    expect(extractPermissionModeStatus({ type: "agent.status.updated", permission: "" })).toBeUndefined();
    expect(extractPermissionModeStatus({ type: "agent.status.updated", permission: 42 })).toBeUndefined();
    expect(extractPermissionModeStatus({ type: "agent.status.updated", permission: null })).toBeUndefined();
  });

  it("returns undefined when permission is missing or payload is not an object", () => {
    expect(extractPermissionModeStatus({ type: "agent.status.updated" })).toBeUndefined();
    expect(extractPermissionModeStatus(null)).toBeUndefined();
    expect(extractPermissionModeStatus("manual")).toBeUndefined();
    expect(extractPermissionModeStatus(["yolo"])).toBeUndefined();
  });
});
