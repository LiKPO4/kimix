import { describe, expect, it } from "vitest";
import {
  inspectKimiCodeServerContract,
  isKimiCodeServerExperimentEnabled,
  KimiCodeServerHost,
} from "../../../electron/kimiCodeServerHost";
import { isKimiCodeSessionMissingError } from "../../../electron/kimiCodeServerClient";

describe("kimiCodeServerHost", () => {
  it("defaults to server host with explicit opt-out", () => {
    expect(isKimiCodeServerExperimentEnabled({})).toBe(true);
    expect(isKimiCodeServerExperimentEnabled({ KIMIX_EXPERIMENTAL_KIMI_SERVER: "1" })).toBe(true);
    expect(isKimiCodeServerExperimentEnabled({ KIMIX_EXPERIMENTAL_KIMI_SERVER: "true" })).toBe(false);
    expect(isKimiCodeServerExperimentEnabled({}, { experimentalKimiServer: true })).toBe(true);
    expect(isKimiCodeServerExperimentEnabled({}, { experimentalKimiServer: false })).toBe(false);
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

  it("recognizes missing session errors without treating them as server runtime failures", () => {
    expect(isKimiCodeSessionMissingError(new Error("/api/v1/sessions/session_a/profile: Session \"session_a\" was not found"))).toBe(true);
    expect(isKimiCodeSessionMissingError(new Error("/api/v1/sessions/session_a: HTTP 404"))).toBe(true);
    expect(isKimiCodeSessionMissingError(new Error("fetch failed"))).toBe(false);
  });
});
