import { describe, expect, it } from "vitest";
import { kimiCodeRouteStatus } from "../kimiCodeRouteStatus";

describe("kimiCodeRouteStatus", () => {
  it("reports the server route without internal handoff details", () => {
    expect(kimiCodeRouteStatus("server")).toBe("使用kimi server链路已发送消息");
  });

  it.each(["sdk", "sdk-fallback"] as const)("reports %s as the SDK route", (route) => {
    expect(kimiCodeRouteStatus(route)).toBe("kimi sdk链路已发送消息");
  });
});
