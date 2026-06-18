import { afterEach, describe, expect, it, vi } from "vitest";
import {
  flattenServerEvent,
  isKimiCodeServerSessionRoutingEnabled,
  KimiCodeServerClient,
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
});
