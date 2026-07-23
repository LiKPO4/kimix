import { describe, expect, it, vi } from "vitest";
import { isKimiCodeSessionInactiveError, isKimiCodeSessionMissingError, isKimiCodeSessionUnavailableError, removeStaleKimiCodeStartupErrors, runKimiCodeSessionMutationWithRecovery } from "../kimiCodeSessionRecovery";

describe("Kimi Code session recovery", () => {
  const missingMessage = "恢复上次 Kimi Code 会话失败：/api/v1/sessions/session_fb2569cb-6649-4a2d-a879-3ecb1e532141/profile: Session \"session_fb2569cb-6649-4a2d-a879-3ecb1e532141\" was not found";

  it("recognizes the Server profile missing-session response", () => {
    expect(isKimiCodeSessionMissingError(missingMessage)).toBe(true);
  });

  it("recognizes an inactive runtime binding without treating arbitrary errors as inactive", () => {
    expect(isKimiCodeSessionInactiveError("Kimi Code session is not active: session_a")).toBe(true);
    expect(isKimiCodeSessionInactiveError("Kimi Server session is not active: session_a")).toBe(true);
    expect(isKimiCodeSessionInactiveError("network unavailable")).toBe(false);
  });

  it("treats inactive and missing sessions as unavailable terminal runtimes", () => {
    expect(isKimiCodeSessionUnavailableError("Kimi Code session is not active: session_a")).toBe(true);
    expect(isKimiCodeSessionUnavailableError(missingMessage)).toBe(true);
    expect(isKimiCodeSessionUnavailableError("network unavailable")).toBe(false);
  });

  it("matches recovery-wrapped unavailable errors produced by runKimiCodeSessionMutationWithRecovery", () => {
    expect(isKimiCodeSessionUnavailableError("恢复会话失败：Kimi Code session is not active: session-1")).toBe(true);
    expect(isKimiCodeSessionInactiveError("恢复会话失败：Kimi Code session is not active: session-1")).toBe(true);
    expect(isKimiCodeSessionUnavailableError("恢复会话失败：Kimi Server session is not active: session-1")).toBe(true);
    expect(isKimiCodeSessionInactiveError("恢复会话失败：Kimi Server session is not active: session-1")).toBe(true);
    expect(isKimiCodeSessionUnavailableError("恢复会话失败：session not found")).toBe(true);
    expect(isKimiCodeSessionMissingError("恢复会话失败：session not found")).toBe(true);
    expect(isKimiCodeSessionUnavailableError("恢复会话失败：network unavailable")).toBe(false);
  });

  it("removes only persisted startup missing-session errors", () => {
    const events = [
      { id: "stale", type: "error", message: missingMessage },
      { id: "other", type: "error", message: "模型请求失败" },
      { id: "assistant", type: "assistant_message", message: undefined },
    ];

    expect(removeStaleKimiCodeStartupErrors(events).map((event) => event.id)).toEqual(["other", "assistant"]);
  });
});

describe("runKimiCodeSessionMutationWithRecovery", () => {
  it("resumes an inactive session and retries the mutation on the recovered runtime", async () => {
    const mutate = vi.fn()
      .mockResolvedValueOnce({ success: false, error: "Kimi Code session is not active: session-1" })
      .mockResolvedValueOnce({ success: true, data: undefined });
    const resumeSession = vi.fn().mockResolvedValue({
      success: true,
      data: { sessionId: "session-2", workDir: "D:/work/demo" },
    });

    await expect(runKimiCodeSessionMutationWithRecovery({
      sessionId: "session-1",
      projectPath: "d:\\work\\demo\\",
      additionalWorkDirs: ["D:/shared"],
      crossProjectError: "wrong project",
      mutate,
      resumeSession,
    })).resolves.toEqual({ success: true, sessionId: "session-2" });
    expect(mutate).toHaveBeenNthCalledWith(1, "session-1");
    expect(mutate).toHaveBeenNthCalledWith(2, "session-2");
    expect(resumeSession).toHaveBeenCalledWith({ sessionId: "session-1", additionalWorkDirs: ["D:/shared"] });
  });

  it("does not recover unrelated errors or accept another project", async () => {
    const unrelatedResume = vi.fn();
    await expect(runKimiCodeSessionMutationWithRecovery({
      sessionId: "session-1",
      projectPath: "D:/work/demo",
      additionalWorkDirs: [],
      crossProjectError: "wrong project",
      mutate: vi.fn().mockResolvedValue({ success: false, error: "network unavailable" }),
      resumeSession: unrelatedResume,
    })).resolves.toEqual({ success: false, error: "network unavailable" });
    expect(unrelatedResume).not.toHaveBeenCalled();

    await expect(runKimiCodeSessionMutationWithRecovery({
      sessionId: "session-1",
      projectPath: "D:/work/demo",
      additionalWorkDirs: [],
      crossProjectError: "wrong project",
      mutate: vi.fn().mockResolvedValue({ success: false, error: "Kimi Code session is not active: session-1" }),
      resumeSession: vi.fn().mockResolvedValue({ success: true, data: { sessionId: "session-2", workDir: "D:/work/other" } }),
    })).resolves.toEqual({ success: false, error: "wrong project" });
  });
});
