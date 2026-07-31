/**
 * 队列失败重排测试：dispatchNextPendingKimiMessage 发送失败后，
 * 消息必须回到队首，保持其余消息原有相对顺序。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useSessionStore, type PendingMessage } from "@/stores/sessionStore";

function seedQueue() {
  const store = useSessionStore.getState();
  store.addPendingMessage("s1", "第一条");
  store.addPendingMessage("s1", "第二条");
  store.addPendingMessage("s1", "第三条");
  return useSessionStore.getState().pendingMessages;
}

describe("requeuePendingMessageFront", () => {
  beforeEach(() => {
    useSessionStore.setState({ pendingMessages: [] });
  });

  it("把消息放回队首，其余消息保持原有相对顺序", () => {
    const [first] = seedQueue();
    // 模拟 shiftPendingMessage 取出第一条
    useSessionStore.getState().removePendingMessage(first.id);
    expect(useSessionStore.getState().pendingMessages.map((m) => m.content)).toEqual(["第二条", "第三条"]);

    useSessionStore.getState().requeuePendingMessageFront(first);
    expect(useSessionStore.getState().pendingMessages.map((m) => m.content)).toEqual(["第一条", "第二条", "第三条"]);
  });

  it("保留消息身份与房间字段", () => {
    const message: PendingMessage = {
      id: "m1",
      sessionId: "s1",
      content: "房间消息",
      createdAt: 123,
      roomAgentId: "agent-1",
      roomMessageId: "room-msg-1",
    };
    useSessionStore.getState().requeuePendingMessageFront(message);
    expect(useSessionStore.getState().pendingMessages[0]).toEqual(message);
  });

  it("不可变更新：原数组与未受影响的消息对象不被改写", () => {
    const seeded = seedQueue();
    const before = useSessionStore.getState().pendingMessages;
    const [first] = seeded;
    useSessionStore.getState().removePendingMessage(first.id);
    useSessionStore.getState().requeuePendingMessageFront(first);

    const after = useSessionStore.getState().pendingMessages;
    expect(after).not.toBe(before);
    expect(after[1]).toBe(seeded[1]);
    expect(after[2]).toBe(seeded[2]);
  });

  it("按 id 去重，重复入队不会产生两条", () => {
    const [first] = seedQueue();
    useSessionStore.getState().requeuePendingMessageFront(first);
    const queue = useSessionStore.getState().pendingMessages;
    expect(queue.filter((m) => m.id === first.id)).toHaveLength(1);
    expect(queue[0].id).toBe(first.id);
  });
});
