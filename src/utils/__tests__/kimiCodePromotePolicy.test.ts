import { describe, expect, it } from "vitest";
import { isDaemonLevelPromoteError, PromoteFailureBackoff } from "../../../electron/kimiCodePromotePolicy";

describe("isDaemonLevelPromoteError", () => {
  it("网络层失败判定为 daemon 级", () => {
    expect(isDaemonLevelPromoteError(new TypeError("fetch failed"))).toBe(true);
    expect(isDaemonLevelPromoteError(new Error("connect ECONNREFUSED 127.0.0.1:3939"))).toBe(true);
    expect(isDaemonLevelPromoteError(new Error("read ECONNRESET"))).toBe(true);
    expect(isDaemonLevelPromoteError(new Error("Kimi Server WebSocket 尚未连接"))).toBe(true);
    expect(isDaemonLevelPromoteError(new Error("Kimi Server 尚未就绪"))).toBe(true);
  });

  it("daemon 应用层错误判定为会话级（不升级全局故障）", () => {
    // 损坏会话：daemon 活着但 getSession 持续 500
    expect(isDaemonLevelPromoteError(new Error("/api/v1/sessions/abc: HTTP 500"))).toBe(false);
    expect(isDaemonLevelPromoteError(new Error("/api/v1/sessions/abc: HTTP 410"))).toBe(false);
    // envelope 业务错误
    expect(isDaemonLevelPromoteError(new Error("/api/v1/sessions/abc: 40904"))).toBe(false);
    // 注册/本地转换失败
    expect(isDaemonLevelPromoteError(new Error("附件“a.png”缺少可读取的文件路径"))).toBe(false);
  });
});

describe("PromoteFailureBackoff", () => {
  it("首次失败后立即重试被跳过，过窗后放行", () => {
    const backoff = new PromoteFailureBackoff(1000, 60_000);
    const retryAt = backoff.noteFailure("s1", 0);
    expect(retryAt).toBe(1000);
    expect(backoff.isActive("s1", 999)).toBe(true);
    expect(backoff.isActive("s1", 1000)).toBe(false);
  });

  it("退避按 4 倍指数增长并封顶", () => {
    const backoff = new PromoteFailureBackoff(1000, 10_000);
    expect(backoff.noteFailure("s1", 0)).toBe(1000);
    expect(backoff.noteFailure("s1", 1000)).toBe(5000);
    expect(backoff.noteFailure("s1", 5000)).toBe(15000); // 16s 封顶到 10s
    expect(backoff.noteFailure("s1", 15000)).toBe(25000);
  });

  it("clear 后立即允许重试", () => {
    const backoff = new PromoteFailureBackoff();
    backoff.noteFailure("s1");
    expect(backoff.isActive("s1")).toBe(true);
    backoff.clear("s1");
    expect(backoff.isActive("s1")).toBe(false);
  });

  it("会话之间互不影响", () => {
    const backoff = new PromoteFailureBackoff();
    backoff.noteFailure("s1");
    expect(backoff.isActive("s1")).toBe(true);
    expect(backoff.isActive("s2")).toBe(false);
  });
});
