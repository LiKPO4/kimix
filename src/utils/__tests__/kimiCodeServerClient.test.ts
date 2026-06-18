import { afterEach, describe, expect, it, vi } from "vitest";
import {
  flattenServerEvent,
  isKimiCodeServerSessionRoutingEnabled,
  KimiCodeServerClient,
  normalizeServerTerminalCreateError,
  snapshotMessagesToServerFrames,
  toServerPromptContent,
} from "../../../electron/kimiCodeServerClient";

afterEach(() => vi.unstubAllGlobals());

describe("KimiCodeServerClient protocol adapters", () => {
  it("requires a separate explicit flag for server session routing", () => {
    expect(isKimiCodeServerSessionRoutingEnabled({})).toBe(false);
    expect(isKimiCodeServerSessionRoutingEnabled({ KIMIX_EXPERIMENTAL_KIMI_SERVER: "1" })).toBe(false);
    expect(isKimiCodeServerSessionRoutingEnabled({ KIMIX_EXPERIMENTAL_KIMI_SERVER_SESSIONS: "1" })).toBe(true);
  });

  it("maps SDK prompt parts to the official server content shape", () => {
    expect(toServerPromptContent("hello")).toEqual([{ type: "text", text: "hello" }]);
    expect(toServerPromptContent([
      { type: "text", text: "look" },
      { type: "image_url", imageUrl: { url: "data:image/png;base64,AA==", id: "img-1" } },
    ])).toEqual([
      { type: "text", text: "look" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AA==", id: "img-1" } },
    ]);
  });

  it("flattens websocket event payloads into the SDK-compatible event shape", () => {
    expect(flattenServerEvent({
      type: "assistant.delta",
      seq: 7,
      session_id: "s1",
      payload: { delta: "hi", agentId: "main" },
    })).toEqual({ type: "assistant.delta", delta: "hi", agentId: "main", seq: 7 });
  });

  it("uses official P3 REST routes for fork, children, tasks and terminals", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      const data = url.includes("/children") && !url.endsWith("/children")
        ? { items: [] }
        : url.includes("/tasks") || url.endsWith("/terminals")
          ? { items: [] }
          : { id: "child", status: "idle" };
      return new Response(JSON.stringify({ code: 0, data }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));
    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    await client.forkSession("parent", { title: "fork" });
    await client.listChildren("parent");
    await client.createChild("parent", { title: "child" });
    await client.listTasks("parent");
    await client.listTerminals("parent");
    expect(calls).toEqual([
      "http://127.0.0.1:58627/api/v1/sessions/parent:fork",
      "http://127.0.0.1:58627/api/v1/sessions/parent/children?page_size=100",
      "http://127.0.0.1:58627/api/v1/sessions/parent/children",
      "http://127.0.0.1:58627/api/v1/sessions/parent/tasks",
      "http://127.0.0.1:58627/api/v1/sessions/parent/terminals",
    ]);
  });

  it("turns the upstream Windows ConPTY packaging failure into an actionable terminal error", () => {
    const normalized = normalizeServerTerminalCreateError(
      new Error("Failed to load native module: conpty.node: No such built-in module"),
    );
    expect(normalized.message).toContain("官方 Kimi Code Server 终端创建失败");
    expect(normalized.message).toContain("Windows 0.17.1");
    expect(normalized.message).toContain("conpty.node");
    expect(normalized.message).toContain("Kimix 已接入 terminal create/list/close");
    expect(normalized.message).toContain("原始错误：Failed to load native module");
  });

  it("replays only in-flight snapshot messages through existing raw event shapes", () => {
    const frames = snapshotMessagesToServerFrames({
      as_of_seq: 42,
      epoch: "epoch-1",
      session: { id: "session-1", status: "idle" },
      messages: {
        items: [
          { role: "assistant", content: [{ type: "text", text: "历史消息不自动重放，避免重复" }] },
        ],
      },
      in_flight_turn: {
        items: [
          { role: "user", content: [{ type: "text", text: "本地 UI 已有用户消息" }] },
          { role: "assistant", content: [{ type: "think", think: "先分析" }, { type: "text", text: "最终回答" }] },
          { role: "tool", toolCallId: "call-1", content: [{ type: "text", text: "工具输出" }] },
        ],
      },
    }, "session-1");

    expect(frames).toEqual([
      { type: "turn.started", session_id: "session-1", seq: 42, epoch: "epoch-1", payload: { type: "turn.started" } },
      { type: "content.part", session_id: "session-1", seq: 42, epoch: "epoch-1", payload: { part: { type: "think", think: "先分析" } } },
      { type: "content.part", session_id: "session-1", seq: 42, epoch: "epoch-1", payload: { part: { type: "text", text: "最终回答" } } },
      { type: "turn.ended", session_id: "session-1", seq: 42, epoch: "epoch-1", payload: { type: "turn.ended" } },
      { type: "tool.result", session_id: "session-1", seq: 42, epoch: "epoch-1", payload: { type: "tool.result", toolCallId: "call-1", output: "工具输出" } },
    ]);
  });
});
