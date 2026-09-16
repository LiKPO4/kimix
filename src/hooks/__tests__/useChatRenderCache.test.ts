import { describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { useChatRenderCache } from "@/hooks/useChatRenderCache";
import type { CompletedTurnRenderCacheEntry } from "@/types/chatRender";

function renderHook<T, P>(callback: (props: P) => T, options: { initialProps: P }) {
  const result = { current: null as T };
  let props = options.initialProps;
  function Wrapper() {
    result.current = callback(props);
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(Wrapper));
  });
  return {
    result,
    rerender(nextProps?: P) {
      if (arguments.length > 0) props = nextProps as P;
      act(() => {
        root.render(React.createElement(Wrapper));
      });
    },
  };
}

describe("useChatRenderCache", () => {
  it("returns an empty cache on first render", () => {
    const { result } = renderHook(() => useChatRenderCache("session-1"), { initialProps: undefined as never });
    expect(result.current.current.size).toBe(0);
  });

  it("keeps the same ref across re-renders of the same session", () => {
    const { result, rerender } = renderHook((sessionId: string) => useChatRenderCache(sessionId), {
      initialProps: "session-1",
    });
    const firstRef = result.current;
    result.current.current.set("key", { events: [], items: [] });
    rerender("session-1");
    expect(result.current).toBe(firstRef);
    expect(result.current.current.size).toBe(1);
  });

  // 跨会话保留（v2.21.214）：cacheKey 含全局唯一的 agentTurnId/事件 id，天然按会话隔离；
  // 来回切换大会话时 completed turn 直接命中——「切换即清空」会让重会话每切一次
  // 重付全额合并开销（单轮 95 assistant / 26.5 万字思考约 2 秒，213 录制归因）。
  it("keeps entries across session switches (back-navigation hits)", () => {
    const { result, rerender } = renderHook((sessionId: string) => useChatRenderCache(sessionId), {
      initialProps: "session-1",
    });
    result.current.current.set("key", { events: [], items: [] });
    rerender("session-2");
    expect(result.current.current.size).toBe(1);
    expect(result.current.current.get("key")).toBeTruthy();
    rerender("session-1");
    expect(result.current.current.get("key")).toBeTruthy();
  });

  it("keeps entries when switching to undefined session", () => {
    const { result, rerender } = renderHook((sessionId?: string) => useChatRenderCache(sessionId), {
      initialProps: "session-1",
    });
    result.current.current.set("key", { events: [], items: [] });
    rerender(undefined);
    expect(result.current.current.size).toBe(1);
  });

  it("can store and retrieve a completed turn entry", () => {
    const { result } = renderHook(() => useChatRenderCache("session-1"), { initialProps: undefined as never });
    const entry: CompletedTurnRenderCacheEntry = {
      events: [{ id: "user-1", type: "user_message", timestamp: 1, content: "hi" }],
      items: [],
    };
    result.current.current.set("turn-1", entry);
    expect(result.current.current.get("turn-1")).toBe(entry);
  });
});
