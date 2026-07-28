import { describe, expect, it } from "vitest";
import {
  buildManagedKimiServerArgs,
  detectSecondaryModelInConfigToml,
  inspectKimiCodeServerContract,
  isKimiCodeServerExperimentEnabled,
  KimiCodeServerHost,
  listKimiServerInstanceRecords,
  parseKimiServerInstanceRecord,
  preferredKimiServerPorts,
  selectKimiServerAttachCandidates,
  shouldClearUnresponsiveServerLock,
} from "../../../electron/kimiCodeServerHost";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveEngineStatusAfterPromptCompleted,
  resolvePromptModel,
  resolveServerEngineStatus,
  resolveServerModelRefresh,
  shouldApplyServerModelRefresh,
} from "../../../electron/kimiCodeHost";
import { resolveRuntimeModelPolicy } from "../../../electron/kimiCodeRuntimePolicy";
import { isKimiCodeSessionMissingError } from "../../../electron/kimiCodeServerClient";
import { getKimiCodeSessionAlreadyExistsId, isKimiCodeSessionAlreadyExistsError } from "../../../electron/kimiCodeServerClient";

describe("kimiCodeServerHost", () => {
  it("defaults to server host and reserves the environment override for diagnostics", () => {
    expect(isKimiCodeServerExperimentEnabled({})).toBe(true);
    expect(isKimiCodeServerExperimentEnabled({ KIMIX_EXPERIMENTAL_KIMI_SERVER: "1" })).toBe(true);
    expect(isKimiCodeServerExperimentEnabled({ KIMIX_EXPERIMENTAL_KIMI_SERVER: "true" })).toBe(false);
    expect(isKimiCodeServerExperimentEnabled({ KIMIX_EXPERIMENTAL_KIMI_SERVER: "0" })).toBe(false);
  });

  it("launches the managed server through kimi web --no-open after 0.28 deprecates kimi server", () => {
    expect(buildManagedKimiServerArgs(58_627)).toEqual([
      "web",
      "--no-open",
      "--port",
      "58627",
      "--log-level",
      "warn",
    ]);
    expect(buildManagedKimiServerArgs("58628")).toEqual([
      "web",
      "--no-open",
      "--port",
      "58628",
      "--log-level",
      "warn",
    ]);
  });

  it("walks preferred ports when the default is already taken", () => {
    expect(preferredKimiServerPorts(58_627, 3)).toEqual([58_627, 58_628, 58_629]);
  });

  it("prefers the configured port among multi-instance registry rows", () => {
    const ordered = selectKimiServerAttachCandidates([
      { pid: 1, host: "127.0.0.1", port: 58_628, startedAtMs: 100, source: "instance" },
      { pid: 2, host: "127.0.0.1", port: 58_627, startedAtMs: 200, source: "instance" },
      { pid: 3, host: "127.0.0.1", port: 58_629, startedAtMs: 50, source: "instance" },
    ], 58_627);
    expect(ordered.map((item) => item.port)).toEqual([58_627, 58_629, 58_628]);
  });

  it("parses 0.28 instance registry files and merges the legacy lock", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kimix-server-instances-"));
    const instancesDir = path.join(root, "instances");
    fs.mkdirSync(instancesDir, { recursive: true });
    fs.writeFileSync(path.join(instancesDir, "a.json"), JSON.stringify({
      server_id: "srv-a",
      pid: 11,
      host: "127.0.0.1",
      port: 58_628,
      started_at: 1_000,
      heartbeat_at: 2_000,
      host_version: "0.28.0",
    }));
    fs.writeFileSync(path.join(root, "lock"), JSON.stringify({
      pid: 22,
      port: 58_627,
      host: "127.0.0.1",
      started_at: "2026-07-20T12:00:00.000Z",
    }));
    const records = listKimiServerInstanceRecords(root);
    expect(records).toHaveLength(2);
    expect(parseKimiServerInstanceRecord({
      server_id: "x",
      pid: "33",
      port: "58630",
      started_at: 1_784_000_000_000,
    })?.port).toBe(58_630);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("detects capabilities without trusting the reported version", () => {
    const paths = Object.fromEntries([
      "/api/v1/sessions",
      "/api/v1/sessions/{session_id}/snapshot",
      "/api/v1/sessions/{session_id}/prompts",
      "/api/v1/sessions/{session_id}/approvals",
      "/api/v1/sessions/{session_id}/questions",
      "/api/v1/sessions/{session_id}/{tail}",
      "/api/v1/sessions/{session_id}/children",
      "/api/v1/sessions/{session_id}/tasks",
      "/api/v1/sessions/{session_id}/terminals",
      "/api/v1/tools",
      "/api/v1/workspaces",
    ].map((item) => [item, {}]));
    const result = inspectKimiCodeServerContract(
      { server_id: "server-1", server_version: "0.0.0" },
      { info: { version: "0.0.0" }, paths },
      { info: { version: "0.0.0" }, channels: { kimiCodeWebSocket: {} } },
    );
    expect(result.serverVersion).toBe("0.0.0");
    expect(result.websocketChannel).toBe(true);
    expect(Object.values(result.requiredPaths).every(Boolean)).toBe(true);
  });

  it("marks runtime failures as SDK fallback", () => {
    const host = new KimiCodeServerHost({ KIMIX_EXPERIMENTAL_KIMI_SERVER: "1" });
    host.markFallback(new Error("fetch failed"));
    expect(host.getStatus()).toMatchObject({
      enabled: true,
      state: "fallback",
      routing: "sdk",
      managed: false,
      error: "fetch failed",
    });
  });

  it("clears only an old unresponsive server lock after the startup grace period", () => {
    const now = Date.parse("2026-07-17T12:00:00.000Z");
    expect(shouldClearUnresponsiveServerLock({
      started_at: "2026-07-17T11:59:00.000Z",
    }, now)).toBe(true);
    expect(shouldClearUnresponsiveServerLock({
      started_at: "2026-07-17T11:59:45.000Z",
    }, now)).toBe(false);
    expect(shouldClearUnresponsiveServerLock({}, now)).toBe(false);
    expect(shouldClearUnresponsiveServerLock({ started_at: "invalid" }, now)).toBe(false);
  });

  it("drops a managed server out of ready state after the child exits", () => {
    const host = new KimiCodeServerHost({ KIMIX_EXPERIMENTAL_KIMI_SERVER: "1" });
    const internals = host as unknown as {
      child: { exitCode: number };
      status: ReturnType<KimiCodeServerHost["getStatus"]>;
    };
    internals.child = { exitCode: 1 };
    internals.status = {
      enabled: true,
      state: "managed",
      endpoint: "http://127.0.0.1:58627",
      routing: "server",
      managed: true,
    };

    expect(host.isReady()).toBe(false);
    expect(host.getStatus()).toMatchObject({
      state: "stopped",
      routing: "sdk",
      managed: false,
      error: "Kimi Server 进程已退出：1",
    });
  });

  it("detects a configured [secondary_model] section for the external-server hint", () => {
    // 有段且 model 非空：返回模型名，用于外部 Server 警告。
    expect(detectSecondaryModelInConfigToml([
      'default_model = "kimi-for-coding"',
      "",
      "[secondary_model]",
      'model = "deepseek/deepseek-v4-flash"',
      'default_effort = "low"',
      "",
      "[models.kimi]",
      'model = "kimi-for-coding"',
    ].join("\n"))).toEqual({ model: "deepseek/deepseek-v4-flash" });
  });

  it("returns undefined when the config has no [secondary_model] section", () => {
    expect(detectSecondaryModelInConfigToml('default_model = "kimi-for-coding"\n')).toBeUndefined();
    expect(detectSecondaryModelInConfigToml("")).toBeUndefined();
  });

  it("returns undefined when [secondary_model] has an empty or missing model", () => {
    // model 为空串：视为未配置，不提示。
    expect(detectSecondaryModelInConfigToml('[secondary_model]\nmodel = ""\n')).toBeUndefined();
    // 只有 default_effort 没有 model：不提示。
    expect(detectSecondaryModelInConfigToml('[secondary_model]\ndefault_effort = "low"\n')).toBeUndefined();
    // 下一段的 model 不应被误读进 secondary_model 段。
    expect(detectSecondaryModelInConfigToml('[secondary_model]\n\n[models.kimi]\nmodel = "kimi-for-coding"\n')).toBeUndefined();
  });

  it("clears the external-server secondary model hint when leaving the attached state", () => {
    const host = new KimiCodeServerHost({ KIMIX_EXPERIMENTAL_KIMI_SERVER: "1" });
    const internals = host as unknown as {
      status: ReturnType<KimiCodeServerHost["getStatus"]>;
    };
    internals.status = {
      enabled: true,
      state: "attached",
      endpoint: "http://127.0.0.1:58627",
      routing: "server",
      managed: false,
      secondaryModelExternalServer: { model: "deepseek/deepseek-v4-flash" },
    };

    host.markFallback(new Error("fetch failed"));
    expect(host.getStatus().secondaryModelExternalServer).toBeUndefined();
  });

  it("recognizes missing session errors without treating them as server runtime failures", () => {
    expect(isKimiCodeSessionMissingError(new Error("/api/v1/sessions/session_a/profile: Session \"session_a\" was not found"))).toBe(true);
    expect(isKimiCodeSessionMissingError(new Error("/api/v1/sessions/session_a: HTTP 404"))).toBe(true);
    expect(isKimiCodeSessionMissingError(new Error("/api/v1/sessions/session_a:archive: session session_a does not exist"))).toBe(true);
    expect(isKimiCodeSessionMissingError(new Error("fetch failed"))).toBe(false);
  });

  it("recognizes already-existing server session errors", () => {
    const error = new Error('Session "session_30c60f3b-e2cc-4295-9540-fffcbfe2c7c" already exists');
    expect(isKimiCodeSessionAlreadyExistsError(error)).toBe(true);
    expect(getKimiCodeSessionAlreadyExistsId(error)).toBe("session_30c60f3b-e2cc-4295-9540-fffcbfe2c7c");
    expect(isKimiCodeSessionAlreadyExistsError(new Error("fetch failed"))).toBe(false);
  });
});

describe("resolveServerEngineStatus", () => {
  it("treats v2 busy as running even when the status string is absent or misleading", () => {
    // agent-core-v2 /status 只返回 busy；整个 prompt 期间（含 step 间隙）busy=true。
    // 此前缺失的 status 被兜底成 idle，轮询据此把运行中会话误判为终态，
    // 表现为头部闪“输出完成”、底部闪“已连接”。
    expect(resolveServerEngineStatus({ busy: true })).toBe("running");
    expect(resolveServerEngineStatus({ busy: true, status: "idle" })).toBe("running");
  });

  it("keeps terminal mapping when the turn is truly finished", () => {
    expect(resolveServerEngineStatus({ busy: false })).toBe("idle");
    expect(resolveServerEngineStatus({ busy: false, status: "aborted" })).toBe("interrupted");
  });

  it("falls back to the v1 status string when busy is absent", () => {
    expect(resolveServerEngineStatus({ status: "running" })).toBe("running");
    expect(resolveServerEngineStatus({ status: "awaiting_approval" })).toBe("waiting_approval");
    expect(resolveServerEngineStatus({ status: "awaiting_question" })).toBe("waiting_question");
    expect(resolveServerEngineStatus({ status: "unknown-future-state" })).toBe("unknown");
    expect(resolveServerEngineStatus({})).toBe("unknown");
  });

  it("uses terminal busy=false without trusting a contradictory active status", () => {
    expect(resolveServerEngineStatus({ busy: false, status: "running" })).toBe("idle");
    expect(resolveServerEngineStatus({ busy: false, status: "completed" })).toBe("completed");
    expect(resolveServerEngineStatus({ busy: false, status: "failed" })).toBe("error");
  });
});

describe("resolveEngineStatusAfterPromptCompleted", () => {
  it("does not terminalize while Server busy is still true (pseudo-body + stuck 已连接)", () => {
    // Live diag: prompt.completed → settled_complete/已连接, then watchdog
    // recoverSnapshot still delivers tool.call.started (tool counts keep rising).
    expect(resolveEngineStatusAfterPromptCompleted({ busy: true })).toBe("running");
    expect(resolveEngineStatusAfterPromptCompleted({ busy: true, status: "idle" })).toBe("running");
  });

  it("maps true terminal busy=false to completed for renderer settle", () => {
    expect(resolveEngineStatusAfterPromptCompleted({ busy: false })).toBe("completed");
    expect(resolveEngineStatusAfterPromptCompleted({ busy: false, status: "completed" })).toBe("completed");
    expect(resolveEngineStatusAfterPromptCompleted({ busy: false, status: "aborted" })).toBe("interrupted");
    expect(resolveEngineStatusAfterPromptCompleted({ busy: false, status: "failed" })).toBe("error");
  });

  it("keeps running when activity is unknown rather than faking completed", () => {
    expect(resolveEngineStatusAfterPromptCompleted({})).toBe("running");
    expect(resolveEngineStatusAfterPromptCompleted({ status: "unknown-future" })).toBe("running");
  });
});

describe("server prompt model ownership", () => {
  it("keeps the resumed official model instead of applying the global default", () => {
    expect(resolveRuntimeModelPolicy({
      isResume: true,
      resumedModel: "kimi-code/k3",
      defaultModel: "opencode-go/deepseek-v4-pro",
    })).toEqual({
      effectiveModel: "kimi-code/k3",
      modelToApply: undefined,
    });
  });

  it("only mutates a resumed session for an explicitly requested model", () => {
    expect(resolveRuntimeModelPolicy({
      isResume: true,
      requestedModel: "opencode-go/deepseek-v4-pro",
      resumedModel: "kimi-code/k3",
      defaultModel: "kimi-code/k3",
    })).toEqual({
      effectiveModel: "opencode-go/deepseek-v4-pro",
      modelToApply: "opencode-go/deepseek-v4-pro",
    });
  });

  it("uses the configured default when creating a fresh session", () => {
    expect(resolveRuntimeModelPolicy({
      isResume: false,
      defaultModel: "opencode-go/deepseek-v4-pro",
    })).toEqual({
      effectiveModel: "opencode-go/deepseek-v4-pro",
      modelToApply: undefined,
    });
  });

  it("uses the renderer-selected model as the immutable prompt override", () => {
    expect(resolvePromptModel("opencode-go/deepseek-v4-pro", "opencode-go/deepseek-v4-flash"))
      .toBe("opencode-go/deepseek-v4-pro");
    expect(resolvePromptModel(undefined, "opencode-go/deepseek-v4-flash"))
      .toBe("opencode-go/deepseek-v4-flash");
  });

  it("rejects a status response that started before a model mutation", () => {
    expect(shouldApplyServerModelRefresh(3, 3, false)).toBe(true);
    expect(shouldApplyServerModelRefresh(2, 3, false)).toBe(false);
    expect(shouldApplyServerModelRefresh(3, 3, true)).toBe(false);
  });

  it("never exposes a stale status model while or after a newer mutation", () => {
    expect(resolveServerModelRefresh(
      "opencode-go/deepseek-v4-flash",
      "opencode-go/deepseek-v4-flash",
      false,
      true,
    )).toBeUndefined();
    expect(resolveServerModelRefresh(
      "opencode-go/deepseek-v4-flash",
      "opencode-go/deepseek-v4-pro",
      false,
      false,
    )).toBe("opencode-go/deepseek-v4-pro");
  });
});
