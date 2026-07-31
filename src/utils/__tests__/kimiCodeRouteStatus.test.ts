import { describe, expect, it } from "vitest";
import { kimiCodeRouteStatus } from "../kimiCodeRouteStatus";

describe("kimiCodeRouteStatus", () => {
  it("labels the server route", () => {
    expect(kimiCodeRouteStatus("server")).toBe("经 Server 发送中");
  });

  it("labels the sdk route", () => {
    expect(kimiCodeRouteStatus("sdk")).toBe("经 SDK 发送中");
  });

  it("labels the sdk fallback route with the server-unavailable hint", () => {
    expect(kimiCodeRouteStatus("sdk-fallback")).toBe("经 SDK 发送中（Server 不可用）");
  });

  it("appends the fallback reason to the sdk fallback route", () => {
    expect(kimiCodeRouteStatus("sdk-fallback", "连接超时")).toBe("经 SDK 发送中（Server 不可用：连接超时）");
  });

  it("truncates a long fallback reason", () => {
    const status = kimiCodeRouteStatus("sdk-fallback", "x".repeat(80));
    expect(status.startsWith("经 SDK 发送中（Server 不可用：")).toBe(true);
    expect(status.endsWith("…）")).toBe(true);
    expect(status.length).toBeLessThan("经 SDK 发送中（Server 不可用：）".length + 80);
  });

  it("keeps the neutral label when the route is omitted", () => {
    expect(kimiCodeRouteStatus()).toBe("消息发送中");
  });

  it("drops the in-progress wording once the prompt is sent", () => {
    expect(kimiCodeRouteStatus("server", undefined, "sent")).toBe("经 Server 发送");
    expect(kimiCodeRouteStatus("sdk", undefined, "sent")).toBe("经 SDK 发送");
    expect(kimiCodeRouteStatus("sdk-fallback", undefined, "sent")).toBe("经 SDK 发送（Server 不可用）");
    expect(kimiCodeRouteStatus(undefined, undefined, "sent")).toBe("消息已发送");
  });
});
