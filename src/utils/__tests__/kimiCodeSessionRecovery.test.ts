import { describe, expect, it } from "vitest";
import { isKimiCodeSessionMissingError, removeStaleKimiCodeStartupErrors } from "../kimiCodeSessionRecovery";

describe("Kimi Code session recovery", () => {
  const missingMessage = "恢复上次 Kimi Code 会话失败：/api/v1/sessions/session_fb2569cb-6649-4a2d-a879-3ecb1e532141/profile: Session \"session_fb2569cb-6649-4a2d-a879-3ecb1e532141\" was not found";

  it("recognizes the Server profile missing-session response", () => {
    expect(isKimiCodeSessionMissingError(missingMessage)).toBe(true);
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
