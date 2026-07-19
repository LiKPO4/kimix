import { describe, expect, it } from "vitest";
import { hasExpandableChatHistory, selectInitialChatTail, shouldUseInitialChatTail } from "../chatTailWindow";

type Item = { id: string; completedAssistant?: boolean };

const select = (items: Item[]) => selectInitialChatTail(items, {
  isCompletedAssistant: (item) => Boolean(item.completedAssistant),
});

describe("selectInitialChatTail", () => {
  it("keeps a compact four-item tail when it already includes recent answers", () => {
    const items = [
      { id: "old" },
      { id: "assistant-1", completedAssistant: true },
      { id: "user-1" },
      { id: "assistant-2", completedAssistant: true },
      { id: "user-2" },
    ];

    expect(select(items).map((item) => item.id)).toEqual(["assistant-1", "user-1", "assistant-2", "user-2"]);
  });

  it("looks backward when orphan user turns would crowd answers out of the tail", () => {
    const items = [
      { id: "assistant-1", completedAssistant: true },
      { id: "user-1" },
      { id: "assistant-2", completedAssistant: true },
      { id: "user-with-image" },
      { id: "orphan-user-retry" },
      { id: "status" },
    ];

    expect(select(items).map((item) => item.id)).toEqual([
      "assistant-1",
      "user-1",
      "assistant-2",
      "user-with-image",
      "orphan-user-retry",
      "status",
    ]);
  });

  it("never expands beyond twelve items when no answer exists", () => {
    const items = Array.from({ length: 20 }, (_, index) => ({ id: `user-${index}` }));
    expect(select(items)).toHaveLength(12);
    expect(select(items)[0]?.id).toBe("user-8");
  });
});

describe("shouldUseInitialChatTail", () => {
  it("keeps the bounded tail until that session is explicitly expanded", () => {
    expect(shouldUseInitialChatTail("session-1", null)).toBe(true);
    expect(shouldUseInitialChatTail("session-1", "session-2")).toBe(true);
    expect(shouldUseInitialChatTail("session-1", "session-1")).toBe(false);
  });

  it("exposes initial-tail history to explicit navigation even below the ordinary page limit", () => {
    expect(hasExpandableChatHistory(false, true)).toBe(true);
    expect(hasExpandableChatHistory(false, false)).toBe(false);
  });
});
