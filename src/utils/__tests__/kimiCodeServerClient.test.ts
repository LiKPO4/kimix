import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyServerSessionActivity,
  flattenServerEvent,
  isKimiCodeServerSessionRoutingEnabled,
  KimiCodeServerClient,
  mergeServerRelatedSessions,
  normalizeServerTerminalCreateError,
  recoveredPromptCompletedFrame,
  resolveServerPromptIdleTimeout,
  snapshotMessagesToServerFrames,
  snapshotToHistoryFrames,
  toServerConfigPatch,
  toServerPromptContent,
} from "../../../electron/kimiCodeServerClient";
import { mapHistoryEvents } from "../eventMapper";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

class FailingWebSocket {
  static OPEN = 1;
  readyState = 0;
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: (...args: unknown[]) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  close() {
    this.emit("close");
  }

  send() {}

  emit(type: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(type) ?? []) listener(...args);
  }
}

describe("KimiCodeServerClient protocol adapters", () => {
  it("defaults to server session routing and reserves the environment override for diagnostics", () => {
    expect(isKimiCodeServerSessionRoutingEnabled({})).toBe(true);
    expect(isKimiCodeServerSessionRoutingEnabled({ KIMIX_EXPERIMENTAL_KIMI_SERVER: "1" })).toBe(true);
    expect(isKimiCodeServerSessionRoutingEnabled({ KIMIX_EXPERIMENTAL_KIMI_SERVER_SESSIONS: "1" })).toBe(true);
    expect(isKimiCodeServerSessionRoutingEnabled({ KIMIX_EXPERIMENTAL_KIMI_SERVER_SESSIONS: "0" })).toBe(false);
  });

  it("maps SDK prompt parts to the official server content shape", async () => {
    await expect(toServerPromptContent("hello")).resolves.toEqual([{ type: "text", text: "hello" }]);
    await expect(toServerPromptContent([
      { type: "text", text: "look" },
      { type: "image_url", imageUrl: { url: "data:image/png;base64,AA==", id: "img-1" } },
      { type: "image_url", imageUrl: { url: "https://example.com/image.png" } },
    ])).resolves.toEqual([
      { type: "text", text: "look" },
      { type: "image", source: { kind: "base64", media_type: "image/png", data: "AA==" } },
      { type: "image", source: { kind: "url", url: "https://example.com/image.png" } },
    ]);
  });

  it("uploads inline images and references the official file id", async () => {
    const upload = vi.fn(async () => ({ id: "file-1" }));
    await expect(toServerPromptContent([
      { type: "image_url", imageUrl: { url: "data:image/png;base64,AA==", id: "shot.png" } },
    ], upload)).resolves.toEqual([
      { type: "image", source: { kind: "file", file_id: "file-1" } },
    ]);
    expect(upload).toHaveBeenCalledWith({ name: "shot.png", mediaType: "image/png", data: "AA==" });
  });

  it("sniffs inline image bytes before sending base64 content or uploading files", async () => {
    const pngBytes = "iVBORw0KGgo=";
    await expect(toServerPromptContent([
      { type: "image_url", imageUrl: { url: `data:image/jpeg;base64,${pngBytes}`, id: "shot.jpg" } },
    ])).resolves.toEqual([
      { type: "image", source: { kind: "base64", media_type: "image/png", data: pngBytes } },
    ]);

    const upload = vi.fn(async () => ({ id: "file-png" }));
    await expect(toServerPromptContent([
      { type: "image_url", imageUrl: { url: `data:image/jpeg;base64,${pngBytes}`, id: "shot.jpg" } },
    ], upload)).resolves.toEqual([
      { type: "image", source: { kind: "file", file_id: "file-png" } },
    ]);
    expect(upload).toHaveBeenCalledWith({ name: "shot.jpg", mediaType: "image/png", data: pngBytes });
  });

  it("uploads files through the official multipart route", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
      code: 0,
      data: { id: "file-1", name: "shot.png", media_type: "image/png", size: 1 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    await expect(client.uploadFile({ name: "shot.png", mediaType: "image/png", data: "AA==" })).resolves.toMatchObject({ id: "file-1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:58627/api/v1/files");
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.headers as Record<string, string>)["content-type"]).toBeUndefined();
  });

  it("notifies after repeated websocket reconnect failures", async () => {
    vi.useFakeTimers();
    const sockets: FailingWebSocket[] = [];
    vi.stubGlobal("WebSocket", class extends FailingWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    });
    const onRuntimeFailure = vi.fn();
    const client = new KimiCodeServerClient("http://127.0.0.1:58627", {
      onRuntimeFailure,
      reconnectFailureThreshold: 2,
    });

    const subscribe = client.subscribe("session-1");
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0].emit("error");
    await expect(subscribe).rejects.toThrow("Kimi Server WebSocket 连接失败");
    sockets[0].emit("close");

    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    sockets[1].emit("error");
    sockets[1].emit("close");
    await vi.advanceTimersByTimeAsync(500);
    await vi.waitFor(() => expect(sockets).toHaveLength(3));
    sockets[2].emit("error");
    await vi.waitFor(() => expect(onRuntimeFailure).toHaveBeenCalledTimes(1));

    vi.useRealTimers();
    await client.close();
  });

  it("flattens websocket event payloads into the SDK-compatible event shape", () => {
    expect(flattenServerEvent({
      type: "assistant.delta",
      seq: 7,
      session_id: "s1",
      payload: { delta: "hi", agentId: "main" },
    })).toEqual({
      type: "assistant.delta",
      delta: "hi",
      agentId: "main",
      seq: 7,
      kimixTerminalScope: "prompt",
    });
  });

  it("classifies Server activity without collapsing missing or future states into terminal", () => {
    expect(classifyServerSessionActivity({ busy: true })).toBe("active");
    expect(classifyServerSessionActivity({ busy: false })).toBe("terminal");
    expect(classifyServerSessionActivity({ status: "running" })).toBe("active");
    expect(classifyServerSessionActivity({ status: "awaiting_question" })).toBe("active");
    expect(classifyServerSessionActivity({ status: "idle" })).toBe("terminal");
    expect(classifyServerSessionActivity({ status: "aborted" })).toBe("terminal");
    expect(classifyServerSessionActivity({ status: "future-paused-state" })).toBe("unknown");
    expect(classifyServerSessionActivity({})).toBe("unknown");
    expect(classifyServerSessionActivity(undefined)).toBe("unknown");
  });

  it("keeps silent prompts open when status is active, unknown, or unavailable", async () => {
    const recoverSnapshot = vi.fn(async () => undefined);

    await expect(resolveServerPromptIdleTimeout(
      async () => ({ busy: true }),
      recoverSnapshot,
    )).resolves.toMatchObject({ action: "wait", activity: "active" });
    await expect(resolveServerPromptIdleTimeout(
      async () => ({ status: "future-paused-state" }),
      recoverSnapshot,
    )).resolves.toMatchObject({ action: "wait", activity: "unknown" });
    await expect(resolveServerPromptIdleTimeout(
      async () => { throw new Error("status unavailable"); },
      recoverSnapshot,
    )).resolves.toMatchObject({ action: "wait", activity: "unknown" });
    expect(recoverSnapshot).not.toHaveBeenCalled();
  });

  it("reports idle recovery only after terminal status and successful snapshot application", async () => {
    const status = async () => ({ busy: false });
    const recoverSnapshot = vi.fn(async () => undefined);
    await expect(resolveServerPromptIdleTimeout(status, recoverSnapshot)).resolves.toMatchObject({
      action: "recovered",
      activity: "terminal",
    });
    expect(recoverSnapshot).toHaveBeenCalledTimes(1);

    await expect(resolveServerPromptIdleTimeout(
      status,
      async () => { throw new Error("snapshot unavailable"); },
    )).rejects.toThrow("snapshot unavailable");
  });

  it("emits an authoritative completion frame after snapshot recovery", () => {
    expect(recoveredPromptCompletedFrame("session-1", "prompt-1", { seq: 7, epoch: "epoch-1" })).toEqual({
      type: "prompt.completed",
      session_id: "session-1",
      seq: 7,
      epoch: "epoch-1",
      payload: {
        prompt_id: "prompt-1",
        recovered_from_snapshot: true,
      },
    });
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
    await client.getTask("parent", "task/1", 4096);
    await client.listTerminals("parent");
    expect(calls).toEqual([
      "http://127.0.0.1:58627/api/v1/sessions/parent:fork",
      "http://127.0.0.1:58627/api/v1/sessions/parent/children?page_size=100",
      "http://127.0.0.1:58627/api/v1/sessions/parent/children",
      "http://127.0.0.1:58627/api/v1/sessions/parent/tasks",
      "http://127.0.0.1:58627/api/v1/sessions/parent/tasks/task%2F1?with_output=true&output_bytes=4096",
      "http://127.0.0.1:58627/api/v1/sessions/parent/terminals",
    ]);
  });

  it("asks the official Server to exclude empty sessions", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ code: 0, data: { items: [], has_more: false } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));
    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    await expect(client.listSessions()).resolves.toEqual([]);
    expect(calls).toEqual([
      "http://127.0.0.1:58627/api/v1/sessions?page_size=100&exclude_empty=true",
    ]);
  });

  it("reads messages and prompt queue through official diagnostic routes", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      const data = url.includes("/messages?")
        ? { items: [{ id: "m1", session_id: "session/1", role: "user", content: [], created_at: "2026-06-18T00:00:00Z" }], has_more: true }
        : { active: { prompt_id: "p1", user_message_id: "m1", status: "running", created_at: "2026-06-18T00:00:00Z" }, queued: [] };
      return new Response(JSON.stringify({ code: 0, data }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    await expect(client.listMessages("session/1", 20)).resolves.toMatchObject({ has_more: true });
    await expect(client.listPrompts("session/1")).resolves.toMatchObject({ active: { prompt_id: "p1" }, queued: [] });
    expect(calls).toEqual([
      "http://127.0.0.1:58627/api/v1/sessions/session%2F1/messages?page_size=20",
      "http://127.0.0.1:58627/api/v1/sessions/session%2F1/prompts",
    ]);
  });

  it("uses the official OAuth lifecycle routes", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      const data = init?.method === "DELETE"
        ? { cancelled: true, status: "cancelled" }
        : url.endsWith("/logout")
          ? { logged_out: true, provider: "kimi-code" }
          : {
              flow_id: "flow-1", provider: "kimi-code", verification_uri: "https://auth.example",
              verification_uri_complete: "https://auth.example/code", user_code: "CODE", expires_in: 600,
              interval: 5, status: "pending", expires_at: "2026-06-21T16:00:00Z",
            };
      return new Response(JSON.stringify({ code: 0, data }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    await expect(client.startOAuthLogin()).resolves.toMatchObject({ flow_id: "flow-1" });
    await expect(client.cancelOAuthLogin()).resolves.toMatchObject({ cancelled: true });
    await expect(client.logoutOAuth()).resolves.toMatchObject({ logged_out: true });
    expect(calls).toEqual([
      { url: "http://127.0.0.1:58627/api/v1/oauth/login", method: "POST" },
      { url: "http://127.0.0.1:58627/api/v1/oauth/login", method: "DELETE" },
      { url: "http://127.0.0.1:58627/api/v1/oauth/logout", method: "POST" },
    ]);
  });

  it("maps and writes configuration through the official merge route", async () => {
    const patch = toServerConfigPatch({
      defaultModel: "openai/gpt",
      providers: { openai: { type: "openai", apiKey: "secret", baseUrl: "https://api.example", defaultModel: "gpt" } },
      models: { "openai/gpt": { provider: "openai", model: "gpt", maxContextSize: 128000, adaptiveThinking: true, overrides: { maxOutputSize: 32768, supportEfforts: ["low", "high"], defaultEffort: "high" } } },
      experimental: { "tool-select": true },
    });
    expect(patch).toEqual({
      default_model: "openai/gpt",
      providers: { openai: { type: "openai", api_key: "secret", base_url: "https://api.example", default_model: "gpt" } },
      models: { "openai/gpt": { provider: "openai", model: "gpt", max_context_size: 128000, adaptive_thinking: true, overrides: { max_output_size: 32768, support_efforts: ["low", "high"], default_effort: "high" } } },
      experimental: { "tool-select": true },
    });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
      code: 0, data: { providers: {}, default_model: "openai/gpt" },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    await expect(client.setConfig(patch)).resolves.toMatchObject({ default_model: "openai/gpt" });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:58627/api/v1/config", expect.objectContaining({
      method: "POST",
      body: JSON.stringify(patch),
    }));
  });

  it("sets the default model through the dedicated official route", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      code: 0, data: { default_model: "openai/gpt" },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    await expect(client.setDefaultModel("openai/gpt")).resolves.toMatchObject({ default_model: "openai/gpt" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:58627/api/v1/models/openai%2Fgpt:set_default",
      expect.objectContaining({ method: "POST", body: "{}" }),
    );
  });

  it("lists and restores archived sessions through official routes", async () => {
    const calls: Array<{ url: string; method?: string; body?: BodyInit | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body });
      const data = url.includes("archived_only=true")
        ? { items: [{ id: "session-1", title: "Old", status: "idle", archived: true, created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-02T00:00:00Z", metadata: { cwd: "D:/repo" }, agent_config: {} }], has_more: false }
        : { id: "session-1", title: "Old", status: "idle", archived: false, created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-03T00:00:00Z", metadata: { cwd: "D:/repo" }, agent_config: {} };
      return new Response(JSON.stringify({ code: 0, data }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    await expect(client.listArchivedSessions()).resolves.toMatchObject([{ id: "session-1", archived: true }]);
    await expect(client.restoreSession("session/1")).resolves.toMatchObject({ id: "session-1", archived: false });
    expect(calls).toEqual([
      { url: "http://127.0.0.1:58627/api/v1/sessions?page_size=100&archived_only=true", method: undefined, body: undefined },
      { url: "http://127.0.0.1:58627/api/v1/sessions/session%2F1:restore", method: "POST", body: "{}" },
    ]);
  });

  it("searches files through the official session-scoped filesystem route", async () => {
    const calls: Array<{ url: string; method?: string; body?: BodyInit | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body });
      return new Response(JSON.stringify({
        code: 0,
        data: {
          items: [{ path: "src/App.tsx", name: "App.tsx", kind: "file", score: 10, match_positions: [4] }],
          truncated: false,
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    await expect(client.searchFiles("session/1", "app", 12)).resolves.toMatchObject({
      items: [{ path: "src/App.tsx", kind: "file" }],
      truncated: false,
    });
    expect(calls).toEqual([{
      url: "http://127.0.0.1:58627/api/v1/sessions/session%2F1/fs:search",
      method: "POST",
      body: JSON.stringify({ query: "app", limit: 12, follow_gitignore: true }),
    }]);
  });

  it("reads text through the official session-scoped filesystem route", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({
      code: 0,
      data: {
        path: "README.md",
        content: "# Readme",
        encoding: "utf-8",
        size: 8,
        truncated: false,
        etag: "etag-1",
        mime: "text/markdown",
        is_binary: false,
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    await expect(client.readFile("session/1", "README.md")).resolves.toMatchObject({
      path: "README.md",
      content: "# Readme",
      encoding: "utf-8",
      is_binary: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:58627/api/v1/sessions/session%2F1/fs:read",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ path: "README.md", offset: 0, length: 1_048_576, encoding: "utf-8" }),
      }),
    );
  });

  it("registers the official workspace when 0.27 omits Git decoration fields", async () => {
    const calls: Array<{ url: string; method?: string; body?: BodyInit | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body });
      const data = url.endsWith("/workspaces")
        ? {
            id: "wd_repo_123456789abc",
            root: "D:/repo",
            name: "repo",
            created_at: "2026-06-21T00:00:00Z",
            last_opened_at: "2026-06-21T00:00:00Z",
            session_count: 0,
          }
        : {
            id: "session-1",
            workspace_id: "wd_repo_123456789abc",
            status: "idle",
            metadata: { cwd: "D:/repo" },
          };
      return new Response(JSON.stringify({ code: 0, data }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));

    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    await expect(client.createSession({
      workDir: "D:\\repo",
      id: "agent-2",
      model: "kimi-code/kimi-for-coding",
      permission: "auto",
      metadata: {
        source: "kimix-room-agent",
        kimixRoomSchemaVersion: 1,
        kimixRoomId: "room-1",
        kimixRoomAgentId: "agent-2",
        kimixPrimarySessionId: "session-primary",
      },
    })).resolves.toMatchObject({ workspace_id: "wd_repo_123456789abc" });

    expect(calls).toEqual([
      {
        url: "http://127.0.0.1:58627/api/v1/workspaces",
        method: "POST",
        body: JSON.stringify({ root: "D:\\repo" }),
      },
      {
        url: "http://127.0.0.1:58627/api/v1/sessions",
        method: "POST",
        body: JSON.stringify({
          id: "agent-2",
          workspace_id: "wd_repo_123456789abc",
          metadata: {
            source: "kimix-room-agent",
            kimixRoomSchemaVersion: 1,
            kimixRoomId: "room-1",
            kimixRoomAgentId: "agent-2",
            kimixPrimarySessionId: "session-primary",
            cwd: "D:/repo",
          },
          agent_config: {
            model: "kimi-code/kimi-for-coding",
            permission_mode: "auto",
            plan_mode: false,
          },
        }),
      },
      {
        // Kimi Code 0.24+（agent-core-v2）的 create 路由不消费 agent_config，
        // 同一配置必须经 profile 端点再应用一次（旧版本上是幂等冗余）。
        url: "http://127.0.0.1:58627/api/v1/sessions/session-1/profile",
        method: "POST",
        body: JSON.stringify({
          agent_config: {
            model: "kimi-code/kimi-for-coding",
            permission_mode: "auto",
            plan_mode: false,
          },
        }),
      },
    ]);
  });

  it("sends thinking only when explicitly requested", async () => {
    const calls: Array<{ url: string; body?: BodyInit | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body });
      const data = String(url).endsWith("/api/v1/workspaces")
        ? { id: "wd_repo_123456789abc", root: "D:/repo", name: "repo", created_at: "2026-06-21T00:00:00Z", last_opened_at: "2026-06-21T00:00:00Z", session_count: 0 }
        : { id: "session-1", workspace_id: "wd_repo_123456789abc", status: "idle", metadata: { cwd: "D:/repo" } };
      return new Response(JSON.stringify({ code: 0, data }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    await client.createSession({ workDir: "D:\\repo", thinking: "off" });
    const sessionCall = calls.find((call) => call.url.endsWith("/api/v1/sessions"));
    expect(sessionCall?.body).toBe(JSON.stringify({
      workspace_id: "wd_repo_123456789abc",
      metadata: { cwd: "D:/repo" },
      agent_config: {
        thinking: "off",
        permission_mode: "manual",
        plan_mode: false,
      },
    }));
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
            ? { items: [{ provider: "kimi-code", model: "kimi-for-coding", display_name: "K2.7 Code High Speed", max_context_size: 262144, capabilities: ["thinking", "tool_use"], support_efforts: ["low", "medium", "high"], default_effort: "medium" }] }
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
      expect.objectContaining({
        model: "kimi-for-coding",
        max_context_size: 262144,
        support_efforts: ["low", "medium", "high"],
        default_effort: "medium",
      }),
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
          { id: "msg-user", role: "user", created_at: "2026-07-01T20:15:00+08:00", content: [{ type: "text", text: "用户历史问题" }] },
          { id: "msg-history", role: "assistant", created_at: "2026-07-01T20:16:00+08:00", content: [{ type: "text", text: "历史消息可按需补偿" }] },
        ],
      },
      in_flight_turn: {
        items: [
          { role: "user", content: [{ type: "text", text: "本地 UI 已有用户消息" }] },
          { id: "msg-active", role: "assistant", content: [{ type: "thinking", thinking: "先分析", signature: "sig-history" }, { type: "text", text: "最终回答" }] },
          { role: "tool", content: [{ type: "tool_result", tool_call_id: "call-1", output: "工具输出" }] },
        ],
      },
    }, "session-1");

    expect(frames[0]).toMatchObject({
      type: "TurnBegin",
      payload: {
        snapshotReplay: "history",
        snapshotMessageId: "msg-user",
        snapshotMessageIdStable: true,
        snapshotMessageText: "用户历史问题",
        created_at: "2026-07-01T20:15:00+08:00",
        user_input: [{ type: "text", text: "用户历史问题" }],
      },
    });
    expect(frames[1]).toMatchObject({
      type: "content.part",
      payload: {
        snapshotReplay: "history",
        snapshotMessageId: "msg-history",
        snapshotMessageIdStable: true,
        snapshotMessageText: "历史消息可按需补偿",
        created_at: "2026-07-01T20:16:00+08:00",
        part: { type: "text", text: "历史消息可按需补偿" },
      },
    });
    expect(frames.slice(3)).toEqual([
      { type: "turn.started", session_id: "session-1", seq: 42, epoch: "epoch-1", payload: { type: "turn.started" } },
      {
        type: "content.part",
        session_id: "session-1",
        seq: 42,
        epoch: "epoch-1",
        payload: {
          snapshotReplay: "in_flight",
          snapshotMessageId: "msg-active",
          snapshotMessageIdStable: true,
          snapshotMessageText: "先分析\n最终回答",
          snapshotRole: "assistant",
          part: { type: "think", think: "先分析", signature: "sig-history" },
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
          snapshotMessageIdStable: true,
          snapshotMessageText: "先分析\n最终回答",
          snapshotRole: "assistant",
          part: { type: "text", text: "最终回答" },
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
          snapshotMessageIdStable: false,
          snapshotMessageText: "工具输出",
          snapshotRole: "tool",
        },
      },
    ]);
    expect(frames.some((frame) => (
      frame.type === "turn.ended" &&
      (frame.payload as { snapshotReplay?: unknown } | undefined)?.snapshotReplay === "in_flight"
    ))).toBe(false);
    const mapped = mapHistoryEvents(frames.map((frame) => ({ type: frame.type, payload: frame.payload })));
    const activeAssistant = mapped.findLast((event) => event.type === "assistant_message");
    expect(activeAssistant).toMatchObject({
      type: "assistant_message",
      content: "最终回答",
      isComplete: false,
    });
  });

  it("adds pending approvals and questions when loading a server snapshot as history", () => {
    const frames = snapshotToHistoryFrames({
      as_of_seq: 12,
      epoch: "epoch-pending",
      session: { id: "session-1", status: "awaiting_question" },
      messages: { items: [] },
      pending_approvals: [{ approval_id: "approval-1", tool_name: "Bash", description: "运行命令" }],
      pending_questions: [{ question_id: "question-1", questions: [{ id: "q1", question: "继续吗？", options: [] }] }],
    }, "session-1");

    expect(frames).toEqual([
      {
        type: "event.approval.requested",
        session_id: "session-1",
        seq: 12,
        epoch: "epoch-pending",
        payload: { approval_id: "approval-1", tool_name: "Bash", description: "运行命令" },
      },
      {
        type: "event.question.requested",
        session_id: "session-1",
        seq: 12,
        epoch: "epoch-pending",
        payload: { question_id: "question-1", questions: [{ id: "q1", question: "继续吗？", options: [] }] },
      },
    ]);
  });
});
