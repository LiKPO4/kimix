import { afterEach, describe, expect, it, vi } from "vitest";
import {
  flattenServerEvent,
  isKimiCodeServerSessionRoutingEnabled,
  KimiCodeServerClient,
  mergeServerRelatedSessions,
  normalizeServerTerminalCreateError,
  snapshotMessagesToServerFrames,
  toServerPromptContent,
} from "../../../electron/kimiCodeServerClient";

afterEach(() => vi.unstubAllGlobals());

describe("KimiCodeServerClient protocol adapters", () => {
  it("defaults to server session routing with explicit opt-out", () => {
    expect(isKimiCodeServerSessionRoutingEnabled({})).toBe(true);
    expect(isKimiCodeServerSessionRoutingEnabled({ KIMIX_EXPERIMENTAL_KIMI_SERVER: "1" })).toBe(true);
    expect(isKimiCodeServerSessionRoutingEnabled({ KIMIX_EXPERIMENTAL_KIMI_SERVER_SESSIONS: "1" })).toBe(true);
    expect(isKimiCodeServerSessionRoutingEnabled({}, { experimentalKimiServerSessions: true })).toBe(true);
    expect(isKimiCodeServerSessionRoutingEnabled({}, { experimentalKimiServerSessions: false })).toBe(false);
    expect(isKimiCodeServerSessionRoutingEnabled({ KIMIX_EXPERIMENTAL_KIMI_SERVER_SESSIONS: "0" }, { experimentalKimiServerSessions: true })).toBe(false);
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

  it("merges official children with Kimix fork metadata for the session tree", () => {
    const child = { id: "child-1", status: "idle", metadata: { parent_session_id: "parent" } };
    const fork = { id: "fork-1", status: "idle", metadata: { forkedFrom: "parent" } };
    const unrelated = { id: "other", status: "idle", metadata: { forkedFrom: "elsewhere" } };
    expect(mergeServerRelatedSessions("parent", [child], [child, fork, unrelated])).toEqual([child, fork]);
  });

  it("uses official session action routes for compact, undo, BTW and archive", async () => {
    const calls: Array<{ url: string; body?: BodyInit | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body });
      const data = url.endsWith(":btw")
        ? { agent_id: "agent-btw" }
        : url.endsWith(":archive")
          ? { archived: true }
          : {};
      return new Response(JSON.stringify({ code: 0, data }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));

    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    await client.compactSession("session/1", "保留验收结果");
    await client.undoSession("session/1", 2);
    await client.startBtwSession("session/1");
    await client.archiveSession("session/1");

    expect(calls).toEqual([
      { url: "http://127.0.0.1:58627/api/v1/sessions/session%2F1:compact", body: JSON.stringify({ instruction: "保留验收结果" }) },
      { url: "http://127.0.0.1:58627/api/v1/sessions/session%2F1:undo", body: JSON.stringify({ count: 2 }) },
      { url: "http://127.0.0.1:58627/api/v1/sessions/session%2F1:btw", body: "{}" },
      { url: "http://127.0.0.1:58627/api/v1/sessions/session%2F1:archive", body: "{}" },
    ]);
  });

  it("reads the official session status endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      data: {
        status: "idle",
        model: "kimi-code/kimi-for-coding",
        thinking_level: "high",
        permission: "manual",
        plan_mode: false,
        swarm_mode: false,
        context_tokens: 1234,
        max_context_tokens: 262144,
        context_usage: 0.0047,
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    await expect(client.getSessionStatus("session/1")).resolves.toMatchObject({
      context_tokens: 1234,
      max_context_tokens: 262144,
      context_usage: 0.0047,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:58627/api/v1/sessions/session%2F1/status",
      expect.any(Object),
    );
  });

  it("uses official Skill and MCP list/action routes", async () => {
    const calls: Array<{ url: string; method?: string; body?: BodyInit | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body });
      const data = url.endsWith("/skills")
        ? { skills: [{ name: "review", description: "Review", path: "/skills/review", source: "project" }] }
        : url.includes("/tools?")
          ? { tools: [{ name: "ReadFile", description: "Read", input_schema: {}, source: "builtin" }] }
          : url.endsWith("/connections")
            ? { connections: [{ id: "conn-1", connected_at: "2026-06-18T00:00:00Z", remote_address: "127.0.0.1", user_agent: null, has_client_hello: true, subscriptions: ["session/1"] }] }
        : url.endsWith("/mcp/servers")
          ? { servers: [{ id: "mcp-1", name: "docs", transport: "http", status: "connected", tool_count: 3 }] }
          : url.includes(":activate")
            ? { activated: true, skill_name: "review" }
            : { restarting: true };
      return new Response(JSON.stringify({ code: 0, data }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));

    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    await expect(client.listSkills("session/1")).resolves.toHaveLength(1);
    await expect(client.activateSkill("session/1", "review", "src/app.ts")).resolves.toMatchObject({ activated: true });
    await expect(client.listMcpServers()).resolves.toHaveLength(1);
    await expect(client.listTools("session/1")).resolves.toHaveLength(1);
    await expect(client.listConnections()).resolves.toHaveLength(1);
    await expect(client.restartMcpServer("mcp/1")).resolves.toEqual({ restarting: true });

    expect(calls).toEqual([
      { url: "http://127.0.0.1:58627/api/v1/sessions/session%2F1/skills", method: undefined, body: undefined },
      { url: "http://127.0.0.1:58627/api/v1/sessions/session%2F1/skills/review:activate", method: "POST", body: JSON.stringify({ args: "src/app.ts" }) },
      { url: "http://127.0.0.1:58627/api/v1/mcp/servers", method: undefined, body: undefined },
      { url: "http://127.0.0.1:58627/api/v1/tools?session_id=session%2F1", method: undefined, body: undefined },
      { url: "http://127.0.0.1:58627/api/v1/connections", method: undefined, body: undefined },
      { url: "http://127.0.0.1:58627/api/v1/mcp/servers/mcp%2F1:restart", method: "POST", body: "{}" },
    ]);
  });

  it("reads the official redacted auth, config, model, and provider catalog routes", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      const data = url.endsWith("/auth")
        ? { ready: true, providers_count: 1, default_model: "kimi-code/kimi-for-coding", managed_provider: { name: "kimi-code", status: "authenticated" } }
        : url.endsWith("/config")
          ? { default_provider: "kimi-code", providers: { "kimi-code": { type: "kimi", has_api_key: false } } }
          : url.endsWith("/models")
            ? { items: [{ provider: "kimi-code", model: "kimi-for-coding", display_name: "K2.7 Code High Speed", max_context_size: 262144, capabilities: ["thinking", "tool_use"] }] }
            : { items: [{ id: "managed:kimi-code", type: "kimi", has_api_key: false, status: "connected", models: ["kimi-for-coding"] }] };
      return new Response(JSON.stringify({ code: 0, data }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));

    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    await expect(client.getAuthSummary()).resolves.toMatchObject({ ready: true, providers_count: 1 });
    await expect(client.getRedactedConfig()).resolves.toMatchObject({ default_provider: "kimi-code" });
    await expect(client.listModels()).resolves.toEqual([
      expect.objectContaining({ model: "kimi-for-coding", max_context_size: 262144 }),
    ]);
    await expect(client.listProviders()).resolves.toEqual([
      expect.objectContaining({ id: "managed:kimi-code", status: "connected" }),
    ]);
    expect(calls).toEqual([
      "http://127.0.0.1:58627/api/v1/auth",
      "http://127.0.0.1:58627/api/v1/config",
      "http://127.0.0.1:58627/api/v1/models",
      "http://127.0.0.1:58627/api/v1/providers",
    ]);
  });

  it("treats already-finished Server task cancellation as an idempotent stop result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      code: 40904,
      msg: "task already finished",
      data: { cancelled: false },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));

    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    await expect(client.cancelTask("session-1", "task-1")).resolves.toEqual({ cancelled: false });
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

  it("marks history replay frames and in-flight replay frames separately", () => {
    const frames = snapshotMessagesToServerFrames({
      as_of_seq: 42,
      epoch: "epoch-1",
      session: { id: "session-1", status: "idle" },
      messages: {
        items: [
          { id: "msg-history", role: "assistant", content: [{ type: "text", text: "历史消息可按需补偿" }] },
        ],
      },
      in_flight_turn: {
        items: [
          { role: "user", content: [{ type: "text", text: "本地 UI 已有用户消息" }] },
          { id: "msg-active", role: "assistant", content: [{ type: "thinking", thinking: "先分析" }, { type: "text", text: "最终回答" }] },
          { role: "tool", content: [{ type: "tool_result", tool_call_id: "call-1", output: "工具输出" }] },
        ],
      },
    }, "session-1");

    expect(frames[0]).toMatchObject({
      type: "content.part",
      payload: {
        snapshotReplay: "history",
        snapshotMessageId: "msg-history",
        snapshotMessageText: "历史消息可按需补偿",
        part: { type: "text", text: "历史消息可按需补偿" },
      },
    });
    expect(frames.slice(2)).toEqual([
      { type: "turn.started", session_id: "session-1", seq: 42, epoch: "epoch-1", payload: { type: "turn.started" } },
      {
        type: "content.part",
        session_id: "session-1",
        seq: 42,
        epoch: "epoch-1",
        payload: {
          snapshotReplay: "in_flight",
          snapshotMessageId: "msg-active",
          snapshotMessageText: "先分析\n最终回答",
          snapshotRole: "assistant",
          part: { type: "think", think: "先分析" },
        },
      },
      {
        type: "content.part",
        session_id: "session-1",
        seq: 42,
        epoch: "epoch-1",
        payload: {
          snapshotReplay: "in_flight",
          snapshotMessageId: "msg-active",
          snapshotMessageText: "先分析\n最终回答",
          snapshotRole: "assistant",
          part: { type: "text", text: "最终回答" },
        },
      },
      {
        type: "turn.ended",
        session_id: "session-1",
        seq: 42,
        epoch: "epoch-1",
        payload: {
          type: "turn.ended",
          snapshotReplay: "in_flight",
          snapshotMessageId: "msg-active",
          snapshotMessageText: "先分析\n最终回答",
          snapshotRole: "assistant",
        },
      },
      {
        type: "tool.result",
        session_id: "session-1",
        seq: 42,
        epoch: "epoch-1",
        payload: {
          type: "tool.result",
          toolCallId: "call-1",
          output: "工具输出",
          snapshotReplay: "in_flight",
          snapshotMessageId: "tool:工具输出",
          snapshotMessageText: "工具输出",
          snapshotRole: "tool",
        },
      },
    ]);
  });
});
