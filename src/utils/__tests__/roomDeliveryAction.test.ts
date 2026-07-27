import { afterEach, describe, expect, it } from "vitest";
import {
  requestRoomDeliveryAction,
  ROOM_DELIVERY_ACTION_EVENT,
  type RoomDeliveryActionDetail,
} from "@/utils/roomDeliveryAction";

const listeners: EventListener[] = [];

function listen(listener: EventListener) {
  listeners.push(listener);
  window.addEventListener(ROOM_DELIVERY_ACTION_EVENT, listener);
}

afterEach(() => {
  for (const listener of listeners.splice(0)) {
    window.removeEventListener(ROOM_DELIVERY_ACTION_EVENT, listener);
  }
});

describe("requestRoomDeliveryAction", () => {
  const request = {
    action: "retry" as const,
    sessionId: "session-1",
    roomMessageId: "message-1",
    roomAgentId: "agent-1",
  };

  it("waits for the delivery handler completion receipt", async () => {
    let complete: RoomDeliveryActionDetail["complete"];
    listen(((event: CustomEvent<RoomDeliveryActionDetail>) => {
      complete = event.detail.complete;
    }) as EventListener);

    let settled = false;
    const pending = requestRoomDeliveryAction(request, 1_000).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    complete?.({ success: true });
    await pending;
    expect(settled).toBe(true);
  });

  it("rejects when the actual delivery fails", async () => {
    listen(((event: CustomEvent<RoomDeliveryActionDetail>) => {
      event.detail.complete?.({ success: false, error: "WebSocket 仍未恢复" });
    }) as EventListener);

    await expect(requestRoomDeliveryAction(request, 1_000)).rejects.toThrow("WebSocket 仍未恢复");
  });

  it("rejects when no delivery handler responds", async () => {
    await expect(requestRoomDeliveryAction(request, 5)).rejects.toThrow("重试请求未在预期时间内完成");
  });
});
