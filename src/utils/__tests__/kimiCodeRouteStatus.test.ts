import { describe, expect, it } from "vitest";
import { kimiCodeRouteStatus } from "../kimiCodeRouteStatus";

describe("kimiCodeRouteStatus", () => {
  it.each(["server", "sdk", "sdk-fallback"] as const)("hides the internal %s route from users", (route) => {
    expect(kimiCodeRouteStatus(route)).toBe("消息发送中");
  });
});
