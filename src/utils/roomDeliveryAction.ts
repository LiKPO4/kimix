export const ROOM_DELIVERY_ACTION_EVENT = "kimix:room-delivery-action";

export type RoomDeliveryActionResult =
  | { success: true }
  | { success: false; error: string };

export type RoomDeliveryActionDetail = {
  action: "cancel" | "retry";
  sessionId: string;
  roomMessageId: string;
  roomAgentId: string;
  complete?: (result: RoomDeliveryActionResult) => void;
};

type RoomDeliveryActionRequest = Omit<RoomDeliveryActionDetail, "complete">;

export function requestRoomDeliveryAction(
  request: RoomDeliveryActionRequest,
  timeoutMs = 60_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result: RoomDeliveryActionResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (result.success) {
        resolve();
      } else {
        reject(new Error(result.error));
      }
    };
    const timeout = window.setTimeout(() => {
      finish({ success: false, error: "重试请求未在预期时间内完成" });
    }, timeoutMs);

    window.dispatchEvent(new CustomEvent<RoomDeliveryActionDetail>(ROOM_DELIVERY_ACTION_EVENT, {
      detail: {
        ...request,
        complete: finish,
      },
    }));
  });
}
