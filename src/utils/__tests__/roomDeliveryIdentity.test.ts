import { describe, expect, it } from "vitest";
import type { RoomAgentDelivery, RoomUserMessage, TimelineEvent } from "@/types/ui";
import {
  isOfficialUserEventIdUniqueToDelivery,
  resolveRoomDeliveryUserEvents,
} from "../roomDeliveryIdentity";

function userEvent(overrides: Partial<Extract<TimelineEvent, { type: "user_message" }>> = {}): TimelineEvent {
  return {
    id: "user-event",
    type: "user_message",
    timestamp: 100,
    content: "Hello",
    ...overrides,
  };
}

function baseMessage(overrides: Partial<RoomUserMessage> = {}): RoomUserMessage {
  return {
    id: "room-message",
    content: "Hello",
    recipientAgentIds: ["agent-a"],
    deliveries: {
      "agent-a": {
        status: "completed",
        agentTurnId: "turn-a",
      },
    },
    timestamp: 100,
    ...overrides,
  };
}

function baseDelivery(overrides: Partial<RoomAgentDelivery> = {}): RoomAgentDelivery {
  return {
    status: "completed",
    agentTurnId: "turn-a",
    ...overrides,
  };
}

describe("resolveRoomDeliveryUserEvents", () => {
  it("matches a complete room delivery identity exactly", () => {
    const message = baseMessage();
    const delivery = baseDelivery({
      dispatchAttemptId: "attempt-a",
    });
    const events: TimelineEvent[] = [
      userEvent({
        id: "canonical-user",
        roomMessageId: "room-message",
        agentTurnId: "turn-a",
        dispatchAttemptId: "attempt-a",
      }),
    ];

    const result = resolveRoomDeliveryUserEvents(events, message, delivery, true);

    expect(result.transactionIndexes).toEqual([0]);
    expect(result.hasTransactionConflict).toBe(false);
    expect(result.legacyOfficialIndexes).toEqual([]);
  });

  it("resolves dispatchAttemptId conflicts by exact attempt match", () => {
    const message = baseMessage();
    const delivery = baseDelivery({
      dispatchAttemptId: "attempt-first",
    });
    const events: TimelineEvent[] = [
      userEvent({
        id: "user-first",
        roomMessageId: "room-message",
        agentTurnId: "turn-a",
        dispatchAttemptId: "attempt-first",
      }),
      userEvent({
        id: "user-second",
        roomMessageId: "room-message",
        agentTurnId: "turn-a",
        dispatchAttemptId: "attempt-second",
      }),
    ];

    const result = resolveRoomDeliveryUserEvents(events, message, delivery, true);

    expect(result.transactionIndexes).toEqual([0]);
    expect(result.hasTransactionConflict).toBe(true);
    expect(result.legacyOfficialIndexes).toEqual([]);
  });

  it("returns empty when the delivery has no attempt id and candidates carry multiple attempts", () => {
    const message = baseMessage();
    const delivery = baseDelivery();
    const events: TimelineEvent[] = [
      userEvent({
        id: "user-first",
        roomMessageId: "room-message",
        agentTurnId: "turn-a",
        dispatchAttemptId: "attempt-first",
      }),
      userEvent({
        id: "user-second",
        roomMessageId: "room-message",
        agentTurnId: "turn-a",
        dispatchAttemptId: "attempt-second",
      }),
    ];

    const result = resolveRoomDeliveryUserEvents(events, message, delivery, true);

    expect(result.transactionIndexes).toEqual([]);
    expect(result.hasTransactionConflict).toBe(true);
    expect(result.legacyOfficialIndexes).toEqual([]);
  });

  it("falls back to an identity-less official event id when exact identity is absent", () => {
    const message = baseMessage();
    const delivery = baseDelivery({
      officialUserEventId: "canonical-user",
    });
    const events: TimelineEvent[] = [
      userEvent({
        id: "canonical-user",
        content: "Hello",
      }),
    ];

    const result = resolveRoomDeliveryUserEvents(events, message, delivery, true);

    expect(result.transactionIndexes).toEqual([]);
    expect(result.legacyOfficialIndexes).toEqual([0]);
    expect(result.hasTransactionConflict).toBe(false);
  });

  it("does not use the legacy official id path when it is disabled", () => {
    const message = baseMessage();
    const delivery = baseDelivery({
      officialUserEventId: "canonical-user",
    });
    const events: TimelineEvent[] = [
      userEvent({
        id: "canonical-user",
        content: "Hello",
      }),
    ];

    const result = resolveRoomDeliveryUserEvents(events, message, delivery, false);

    expect(result.transactionIndexes).toEqual([]);
    expect(result.legacyOfficialIndexes).toEqual([]);
    expect(result.hasTransactionConflict).toBe(false);
  });

  it("prefers complete identity over legacy official id even when both match", () => {
    const message = baseMessage();
    const delivery = baseDelivery({
      dispatchAttemptId: "attempt-a",
      officialUserEventId: "canonical-user",
    });
    const events: TimelineEvent[] = [
      userEvent({
        id: "canonical-user",
        content: "Hello",
      }),
      userEvent({
        id: "transaction-user",
        roomMessageId: "room-message",
        agentTurnId: "turn-a",
        dispatchAttemptId: "attempt-a",
      }),
    ];

    const result = resolveRoomDeliveryUserEvents(events, message, delivery, true);

    expect(result.transactionIndexes).toEqual([1]);
    expect(result.legacyOfficialIndexes).toEqual([]);
    expect(result.hasTransactionConflict).toBe(false);
  });

  it("ignores non-user_message events", () => {
    const message = baseMessage();
    const delivery = baseDelivery({
      dispatchAttemptId: "attempt-a",
    });
    const events: TimelineEvent[] = [
      {
        id: "assistant-event",
        type: "assistant_message",
        timestamp: 100,
        content: "Hi",
        isThinking: false,
        isComplete: true,
        roomMessageId: "room-message",
        agentTurnId: "turn-a",
        dispatchAttemptId: "attempt-a",
      },
    ];

    const result = resolveRoomDeliveryUserEvents(events, message, delivery, true);

    expect(result.transactionIndexes).toEqual([]);
    expect(result.legacyOfficialIndexes).toEqual([]);
    expect(result.hasTransactionConflict).toBe(false);
  });

  it("returns empty when exact identity matches a different message", () => {
    const message = baseMessage();
    const delivery = baseDelivery({
      dispatchAttemptId: "attempt-a",
    });
    const events: TimelineEvent[] = [
      userEvent({
        id: "canonical-user",
        roomMessageId: "other-message",
        agentTurnId: "turn-a",
        dispatchAttemptId: "attempt-a",
      }),
    ];

    const result = resolveRoomDeliveryUserEvents(events, message, delivery, true);

    expect(result.transactionIndexes).toEqual([]);
    expect(result.legacyOfficialIndexes).toEqual([]);
    expect(result.hasTransactionConflict).toBe(false);
  });

  it("keeps identity-less official id unbound when multiple deliveries compete for it", () => {
    const message = baseMessage();
    const delivery = baseDelivery({
      officialUserEventId: "shared-canonical",
    });
    const otherMessage: RoomUserMessage = {
      id: "room-message-other",
      content: "Other",
      recipientAgentIds: ["agent-a"],
      deliveries: {
        "agent-a": {
          status: "completed",
          agentTurnId: "turn-other",
          officialUserEventId: "shared-canonical",
        },
      },
      timestamp: 200,
    };
    const events: TimelineEvent[] = [
      userEvent({
        id: "shared-canonical",
        content: "Hello",
      }),
    ];

    const result = resolveRoomDeliveryUserEvents(events, message, delivery, true);

    expect(result.legacyOfficialIndexes).toEqual([0]);

    const otherResult = resolveRoomDeliveryUserEvents(events, otherMessage, otherMessage.deliveries["agent-a"], true);
    expect(otherResult.legacyOfficialIndexes).toEqual([0]);
  });
});

describe("isOfficialUserEventIdUniqueToDelivery", () => {
  it("returns true when only the target delivery owns the official id", () => {
    const messages: RoomUserMessage[] = [
      baseMessage({
        deliveries: {
          "agent-a": baseDelivery({
            officialUserEventId: "canonical-user",
          }),
        },
      }),
    ];

    expect(isOfficialUserEventIdUniqueToDelivery(messages, "agent-a", "canonical-user")).toBe(true);
  });

  it("returns false when two deliveries share the same official id", () => {
    const messages: RoomUserMessage[] = [
      baseMessage({
        id: "room-message-first",
        deliveries: {
          "agent-a": baseDelivery({
            agentTurnId: "turn-first",
            officialUserEventId: "shared-canonical",
          }),
        },
      }),
      baseMessage({
        id: "room-message-second",
        deliveries: {
          "agent-a": baseDelivery({
            agentTurnId: "turn-second",
            officialUserEventId: "shared-canonical",
          }),
        },
      }),
    ];

    expect(isOfficialUserEventIdUniqueToDelivery(messages, "agent-a", "shared-canonical")).toBe(false);
  });

  it("counts ownership through previousAttempts", () => {
    const messages: RoomUserMessage[] = [
      baseMessage({
        deliveries: {
          "agent-a": baseDelivery({
            officialUserEventId: "latest-canonical",
            previousAttempts: [
              {
                dispatchAttemptId: "attempt-old",
                agentTurnId: "turn-a",
                status: "completed",
                officialUserEventId: "old-canonical",
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          }),
        },
      }),
      baseMessage({
        id: "room-message-other",
        deliveries: {
          "agent-a": baseDelivery({
            agentTurnId: "turn-other",
            officialUserEventId: "old-canonical",
          }),
        },
      }),
    ];

    expect(isOfficialUserEventIdUniqueToDelivery(messages, "agent-a", "old-canonical")).toBe(false);
  });

  it("returns false for missing or empty official id", () => {
    const messages: RoomUserMessage[] = [
      baseMessage({
        deliveries: {
          "agent-a": baseDelivery(),
        },
      }),
    ];

    expect(isOfficialUserEventIdUniqueToDelivery(messages, "agent-a", undefined)).toBe(false);
    expect(isOfficialUserEventIdUniqueToDelivery(messages, "agent-a", "")).toBe(false);
  });

  it("returns false when no delivery owns the official id", () => {
    const messages: RoomUserMessage[] = [
      baseMessage({
        deliveries: {
          "agent-a": baseDelivery({
            officialUserEventId: "canonical-user",
          }),
        },
      }),
    ];

    expect(isOfficialUserEventIdUniqueToDelivery(messages, "agent-a", "unrelated-id")).toBe(false);
  });
});
