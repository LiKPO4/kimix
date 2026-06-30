import { describe, expect, it, vi } from "vitest";
import type { Session } from "@/types/ui";
import { archiveSessionOfficialFirst, getOfficialArchiveSessionId } from "../sessionArchive";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "local-1",
    engine: "kimi-code",
    title: "会话",
    projectPath: "D:\\work\\demo",
    createdAt: 1,
    updatedAt: 1,
    events: [],
    isLoading: false,
    ...overrides,
  };
}

describe("official-first session archive", () => {
  it("优先使用 runtime 或 official id", () => {
    expect(getOfficialArchiveSessionId(session({ runtimeSessionId: "runtime", officialSessionId: "official" }))).toBe("runtime");
    expect(getOfficialArchiveSessionId(session({ officialSessionId: "official" }))).toBe("official");
    expect(getOfficialArchiveSessionId(session())).toBeNull();
  });

  it("官方归档成功后才写入本地归档", async () => {
    const order: string[] = [];
    const result = await archiveSessionOfficialFirst(
      session({ officialSessionId: "official" }),
      async () => { order.push("official"); return { success: true, data: undefined }; },
      () => order.push("local"),
    );

    expect(result).toEqual({ success: true });
    expect(order).toEqual(["official", "local"]);
  });

  it("官方归档失败时不隐藏本地会话", async () => {
    const archiveLocal = vi.fn();
    const result = await archiveSessionOfficialFirst(
      session({ officialSessionId: "official" }),
      async () => ({ success: false, error: "WebSocket error" }),
      archiveLocal,
    );

    expect(result).toEqual({ success: false, error: "WebSocket error" });
    expect(archiveLocal).not.toHaveBeenCalled();
  });

  it("官方会话已不存在时按幂等成功隐藏本地镜像", async () => {
    const archiveLocal = vi.fn();
    const result = await archiveSessionOfficialFirst(
      session({ officialSessionId: "session_2c277849-ac4a-4489-9ecc-2af3c038ea37" }),
      async () => ({ success: false, error: "/api/v1/sessions/session_2c277849-ac4a-4489-9ecc-2af3c038ea37:archive: session session_2c277849-ac4a-4489-9ecc-2af3c038ea37 does not exist" }),
      archiveLocal,
    );

    expect(result).toEqual({ success: true });
    expect(archiveLocal).toHaveBeenCalledWith("local-1");
  });

  it("SDK-only 会话在 Server 不可用时回退到本地归档", async () => {
    const archiveLocal = vi.fn();
    const result = await archiveSessionOfficialFirst(
      session({ id: "sdk-session", runtimeSessionId: "sdk-session" }),
      async () => { throw new Error("Session not found on Kimi Server"); },
      archiveLocal,
    );

    expect(result).toEqual({ success: true });
    expect(archiveLocal).toHaveBeenCalledWith("sdk-session");
  });
});
