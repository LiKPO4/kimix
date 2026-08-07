import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acceptedPromptProgressBaseline,
  classifyServerSessionActivity,
  completedPromptMessagesToServerFrames,
  flattenServerEvent,
  inFlightPromptMessagesToServerFrames,
  isKimiCodeServerSessionRoutingEnabled,
  isServerStreamProgressFrame,
  KimiCodeServerClient,
  mergeServerRelatedSessions,
  normalizeServerTerminalCreateError,
  recoveredPromptCompletedFrame,
  resolveServerPromptIdleTimeout,
  serverMessageProgressMarker,
  type ServerMessageSummary,
  shouldReconnectForMissedServerProgress,
  shouldReconnectForFixedSilenceLimit,
  snapshotMessagesToServerFrames,
  snapshotToHistoryFrames,
  toServerConfigPatch,
  toServerPromptContent,
} from "../../../electron/kimiCodeServerClient";
import { mapHistoryEvents } from "../eventMapper";
import { reduceKimiCodeEvents } from "../kimiCodeEventMapper";
import { settleInactiveEvents } from "../eventHelpers";
import { buildRenderItems } from "../../components/chat/ChatThread";

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

  it("falls back to inline base64 when the image upload fails", async () => {
    const failure = new Error("/api/v1/files: HTTP 500");
    const upload = vi.fn(async () => { throw failure; });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(toServerPromptContent([
      { type: "image_url", imageUrl: { url: "data:image/png;base64,iVBORw0KGgo=", id: "shot.png" } },
    ], upload)).resolves.toEqual([
      { type: "image", source: { kind: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
    ]);
    expect(warn).toHaveBeenCalledWith("[KimiCodeServerClient] 图片上传失败，回退 base64 内嵌:", failure);
    warn.mockRestore();
  });

  it("does not fall back when a video upload fails", async () => {
    const failure = new Error("/api/v1/files: HTTP 500");
    const upload = vi.fn(async () => { throw failure; });
    await expect(toServerPromptContent([
      { type: "video_url", videoUrl: { url: "data:video/mp4;base64,AA==", id: "clip.mp4" } },
    ], upload)).rejects.toBe(failure);
  });

  it("does not fall back for oversize images when the upload fails", async () => {
    const failure = new Error("/api/v1/files: HTTP 500");
    const upload = vi.fn(async () => { throw failure; });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bigData = "A".repeat(13_000_001);
    await expect(toServerPromptContent([
      { type: "image_url", imageUrl: { url: `data:image/png;base64,${bigData}`, id: "big.png" } },
    ], upload)).rejects.toBe(failure);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("maps inline, uploaded, and restored videos to the official video content shape", async () => {
    await expect(toServerPromptContent([
      { type: "video_url", videoUrl: { url: "data:video/mp4;base64,AA==", id: "clip.mp4" } },
      { type: "video_url", videoUrl: { fileId: "file-restored" } },
    ])).resolves.toEqual([
      { type: "video", source: { kind: "base64", media_type: "video/mp4", data: "AA==" } },
      { type: "video", source: { kind: "file", file_id: "file-restored" } },
    ]);

    const upload = vi.fn(async () => ({ id: "file-video" }));
    await expect(toServerPromptContent([
      { type: "video_url", videoUrl: { url: "data:video/webm;base64,AQ==", id: "clip.webm" } },
    ], upload)).resolves.toEqual([
      { type: "video", source: { kind: "file", file_id: "file-video" } },
    ]);
    expect(upload).toHaveBeenCalledWith({ name: "clip.webm", mediaType: "video/webm", data: "AQ==" });
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

  it("downloads an official history file as a playable data URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([0, 1, 2]), {
      status: 200,
      headers: { "content-type": "video/mp4" },
    })));
    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    await expect(client.downloadFile("file-video")).resolves.toEqual({
      fileId: "file-video",
      data: Buffer.from([0, 1, 2]),
      mediaType: "video/mp4",
    });
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

  it("uploads generic files and sends the official structured file part", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kimix-file-upload-"));
    const filePath = path.join(tempDir, "spec.md");
    fs.writeFileSync(filePath, "# Spec\n", "utf-8");
    const upload = vi.fn(async () => ({
      id: "f_uploaded",
      name: "spec.md",
      media_type: "text/markdown",
      size: 7,
    }));
    try {
      const input = [{
        type: "file",
        file: { name: "spec.md", filePath, mediaType: "text/markdown", size: 7 },
      }];
      const expected = [{
        type: "file",
        file_id: "f_uploaded",
        name: "spec.md",
        media_type: "text/markdown",
        size: 7,
      }];
      await expect(toServerPromptContent(input, upload)).resolves.toEqual(expected);
      await expect(toServerPromptContent(input, upload)).resolves.toEqual(expected);
      expect(upload).toHaveBeenCalledWith({
        name: "spec.md",
        mediaType: "text/markdown",
        data: Buffer.from("# Spec\n"),
      });
      expect(upload).toHaveBeenCalledTimes(1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("reuses a restored official file id without reading a local path", async () => {
    await expect(toServerPromptContent([{
      type: "file",
      file: {
        name: "report.pdf",
        fileId: "f_restored",
        mediaType: "application/pdf",
        size: 24,
      },
    }])).resolves.toEqual([{
      type: "file",
      file_id: "f_restored",
      name: "report.pdf",
      media_type: "application/pdf",
      size: 24,
    }]);
  });

  it("reconnects only when official history advances during websocket silence", () => {
    const baseline = serverMessageProgressMarker({
      id: "msg-10",
      session_id: "session-1",
      role: "assistant",
      created_at: "2026-07-26T00:00:00Z",
      content: [{ type: "text", text: "old" }],
    });
    const same = serverMessageProgressMarker({
      id: "msg-10",
      session_id: "session-1",
      role: "assistant",
      created_at: "2026-07-26T00:00:00Z",
      content: [{ type: "text", text: "old" }],
    });
    const advanced = serverMessageProgressMarker({
      id: "msg-11",
      session_id: "session-1",
      role: "assistant",
      created_at: "2026-07-26T00:00:09Z",
      content: [{ type: "text", text: "new output" }],
    });
    const sameMessageAdvanced = serverMessageProgressMarker({
      id: "msg-10",
      session_id: "session-1",
      role: "assistant",
      created_at: "2026-07-26T00:00:00Z",
      content: [{ type: "text", text: "old but now longer" }],
    });

    expect(shouldReconnectForMissedServerProgress({
      silenceMs: 30_000,
      baselineMarker: baseline,
      latestMarker: same,
    })).toBe(false);
    expect(shouldReconnectForMissedServerProgress({
      silenceMs: 7_999,
      baselineMarker: baseline,
      latestMarker: advanced,
    })).toBe(false);
    expect(shouldReconnectForMissedServerProgress({
      silenceMs: 1_500,
      baselineMarker: baseline,
      latestMarker: advanced,
      minimumSilenceMs: 1_500,
    })).toBe(true);
    expect(shouldReconnectForMissedServerProgress({
      silenceMs: 8_000,
      baselineMarker: baseline,
      latestMarker: advanced,
    })).toBe(true);
    expect(shouldReconnectForMissedServerProgress({
      silenceMs: 8_000,
      baselineMarker: baseline,
      latestMarker: sameMessageAdvanced,
    })).toBe(true);
    expect(shouldReconnectForMissedServerProgress({
      silenceMs: 30_000,
      baselineMarker: undefined,
      latestMarker: advanced,
    })).toBe(false);
  });

  it("does not reconnect on the fixed silence limit while nothing is in flight", () => {
    // 空闲订阅会话：daemon 从不主动 ping，静默必然线性撞上限。旧逻辑因此每
    // 90s 断连+重拉快照一次而毫无新数据（实测连续 12 轮、as_of_seq 恒定）。
    expect(shouldReconnectForFixedSilenceLimit({
      silenceMs: 90_000,
      hasPendingPrompts: false,
    })).toBe(false);
    expect(shouldReconnectForFixedSilenceLimit({
      silenceMs: 3_600_000,
      hasPendingPrompts: false,
    })).toBe(false);
  });

  it("keeps the fixed silence limit as the stall backstop for in-flight prompts", () => {
    // v2.20.20 引入该上限要解决的正是「轮次在跑却收不到帧」，必须原样保留。
    expect(shouldReconnectForFixedSilenceLimit({
      silenceMs: 90_000,
      hasPendingPrompts: true,
    })).toBe(true);
    expect(shouldReconnectForFixedSilenceLimit({
      silenceMs: 89_999,
      hasPendingPrompts: true,
    })).toBe(false);
    expect(shouldReconnectForFixedSilenceLimit({
      silenceMs: 5_000,
      hasPendingPrompts: true,
      limitMs: 5_000,
    })).toBe(true);
  });

  it("keeps a pre-prompt baseline when the first Assistant persisted before the post-accept read", () => {
    const prePromptMarker = "msg-previous|2026-07-27T02:12:54Z|100";
    const fastAssistant: ServerMessageSummary = {
      id: "msg-assistant-first",
      session_id: "session-1",
      role: "assistant",
      created_at: "2026-07-27T02:16:38.486Z",
      content: [{ type: "think", think: "first progress" }],
    };
    const acceptedUser: ServerMessageSummary = {
      id: "msg-user",
      session_id: "session-1",
      role: "user",
      created_at: "2026-07-27T02:16:38.485Z",
      content: [{ type: "text", text: "review" }],
    };

    const fastBaseline = acceptedPromptProgressBaseline(prePromptMarker, fastAssistant);
    expect(fastBaseline).toBe(prePromptMarker);
    expect(shouldReconnectForMissedServerProgress({
      silenceMs: 8_000,
      baselineMarker: fastBaseline,
      latestMarker: serverMessageProgressMarker(fastAssistant),
    })).toBe(true);
    expect(acceptedPromptProgressBaseline(prePromptMarker, acceptedUser))
      .toBe(serverMessageProgressMarker(acceptedUser));
  });

  it("does not let status heartbeats mask a silent body/thinking/tool stream", () => {
    expect(isServerStreamProgressFrame({
      type: "agent.status.updated",
      session_id: "session-1",
    })).toBe(false);
    expect(isServerStreamProgressFrame({
      type: "ping",
      session_id: "session-1",
    })).toBe(false);
    expect(isServerStreamProgressFrame({
      type: "thinking.delta",
      session_id: "session-1",
    })).toBe(true);
    expect(isServerStreamProgressFrame({
      type: "tool.call.delta",
      session_id: "session-1",
    })).toBe(true);
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

  it("settles a dispatched prompt promptly when the server emits prompt.aborted", async () => {
    const promptId = "msg_01ABORT";
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/api/v1/sessions/session-1/prompts");
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ code: 0, data: { prompt_id: promptId } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));

    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    const internals = client as unknown as {
      subscribed: Set<string>;
      receive: (frame: { type: string; session_id: string; seq: number; epoch: string; payload: unknown }) => void;
    };
    // 本用例只验证 abort 结算；预标记订阅，prompt 不再尝试建立真实 WS 订阅。
    internals.subscribed.add("session-1");
    const dispatched = client.prompt("session-1", "数到 300", {});
    let settled: string | null = null;
    void dispatched.then(
      () => { settled = "resolved"; },
      (error) => { settled = `rejected:${error instanceof Error ? error.message : String(error)}`; },
    );

    // 其他 prompt 的 abort 不应结算本次 dispatch
    internals.receive({
      type: "prompt.aborted",
      session_id: "session-1",
      seq: 20,
      epoch: "epoch-1",
      payload: { promptId: "msg_OTHER" },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(settled).toBeNull();

    internals.receive({
      type: "prompt.aborted",
      session_id: "session-1",
      seq: 21,
      epoch: "epoch-1",
      payload: { promptId },
    });
    await vi.waitFor(() => expect(settled).toBe("resolved"));
    await expect(dispatched).resolves.toEqual({ prompt_id: promptId });
  });

  it("establishes a real websocket subscription before prompting an unsubscribed session", async () => {
    const promptId = "msg_01SUBSCRIBE";
    const order: string[] = [];
    const sentFrames: Array<{ type: string; id: string; payload: unknown }> = [];
    class FakeWebSocket {
      static OPEN = 1;
      readyState = 0;
      private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

      constructor(readonly url: string) {
        queueMicrotask(() => {
          this.readyState = 1;
          this.emit("open");
          this.emit("message", { data: JSON.stringify({ type: "server_hello" }) });
        });
      }

      addEventListener(type: string, listener: (...args: unknown[]) => void) {
        const list = this.listeners.get(type) ?? [];
        list.push(listener);
        this.listeners.set(type, list);
      }

      send(raw: string) {
        const frame = JSON.parse(raw) as { type: string; id: string; payload: unknown };
        sentFrames.push(frame);
        order.push(`ws:${frame.type}`);
        queueMicrotask(() => this.emit("message", {
          data: JSON.stringify({ type: "ack", id: frame.id, code: 0 }),
        }));
      }

      close() {
        this.readyState = 3;
      }

      emit(type: string, ...args: unknown[]) {
        for (const listener of this.listeners.get(type) ?? []) listener(...args);
      }
    }
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      expect(url).toContain("/api/v1/sessions/session-1/prompts");
      order.push("http:prompts");
      return new Response(JSON.stringify({ code: 0, data: { prompt_id: promptId } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));

    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    const internals = client as unknown as {
      receive: (frame: { type: string; session_id: string; seq: number; epoch: string; payload: unknown }) => void;
    };
    const dispatched = client.prompt("session-1", "数到 300", {});
    internals.receive({
      type: "prompt.aborted",
      session_id: "session-1",
      seq: 30,
      epoch: "epoch-1",
      payload: { promptId },
    });
    await expect(dispatched).resolves.toEqual({ prompt_id: promptId });

    const subscribeFrame = sentFrames.find((frame) => frame.type === "subscribe");
    expect(subscribeFrame?.payload).toMatchObject({ session_ids: ["session-1"] });
    expect(order.indexOf("ws:subscribe")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("ws:subscribe")).toBeLessThan(order.indexOf("http:prompts"));
    await client.close();
  });

  it("still sends the prompt when the pre-prompt subscription fails", async () => {
    const promptId = "msg_01SUBFAIL";
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/messages?")) {
        return new Response(JSON.stringify({ code: 0, data: { items: [], has_more: false } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      expect(url).toContain("/api/v1/sessions/session-1/prompts");
      return new Response(JSON.stringify({ code: 0, data: { prompt_id: promptId } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    const internals = client as unknown as {
      receive: (frame: { type: string; session_id: string; seq: number; epoch: string; payload: unknown }) => void;
    };
    const failure = new Error("Kimi Server WebSocket 连接失败");
    const subscribe = vi.spyOn(client, "subscribe").mockRejectedValue(failure);

    const dispatched = client.prompt("session-1", "数到 300", {});
    internals.receive({
      type: "prompt.aborted",
      session_id: "session-1",
      seq: 31,
      epoch: "epoch-1",
      payload: { promptId },
    });
    await expect(dispatched).resolves.toEqual({ prompt_id: promptId });
    expect(subscribe).toHaveBeenCalledWith("session-1");
    // prompt 前静默探针 /messages + 轮末观察窗基线校准 /messages + /prompts，共 3 次 REST；
    // 校准请求与 prompt 流程并发，按内容统计而非调用顺序。
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const callUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(callUrls.filter((url) => url.includes("/prompts")).length).toBe(1);
    expect(callUrls.filter((url) => url.includes("/messages?page_size=20")).length).toBe(1);
    expect(callUrls.filter((url) => url.includes("/messages?page_size=10")).length).toBe(1);
    expect(warn).toHaveBeenCalledWith("[KimiCodeServerClient] prompt 前建立会话订阅失败，继续发送（首波增量可经快照兜底）:", failure);
    warn.mockRestore();
  });

  it("refreshes an already-subscribed live connection before posting the prompt", async () => {
    const promptId = "msg_01SUBBED";
    const order: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/messages?")) {
        return new Response(JSON.stringify({ code: 0, data: { items: [], has_more: false } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      expect(url).toContain("/api/v1/sessions/session-1/prompts");
      order.push("http:prompt");
      return new Response(JSON.stringify({ code: 0, data: { prompt_id: promptId } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));

    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    const internals = client as unknown as {
      subscribed: Set<string>;
      refreshSubscriptionBeforePrompt: (sessionId: string) => Promise<void>;
      receive: (frame: { type: string; session_id: string; seq: number; epoch: string; payload: unknown }) => void;
    };
    internals.subscribed.add("session-1");
    const subscribe = vi.spyOn(client, "subscribe");
    const refresh = vi.spyOn(internals, "refreshSubscriptionBeforePrompt").mockImplementation(async () => {
      order.push("ws:refresh");
    });
    const dispatched = client.prompt("session-1", "数到 300", {});
    internals.receive({
      type: "prompt.aborted",
      session_id: "session-1",
      seq: 32,
      epoch: "epoch-1",
      payload: { promptId },
    });
    await expect(dispatched).resolves.toEqual({ prompt_id: promptId });
    expect(subscribe).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledWith("session-1");
    expect(order).toEqual(["ws:refresh", "http:prompt"]);
  });

  it("replays only the accepted prompt's persisted progress as an active turn", () => {
    const promptId = "msg-prompt";
    const frames = inFlightPromptMessagesToServerFrames([
      {
        id: "msg-assistant",
        role: "assistant",
        created_at: "2026-07-27T02:16:38.486Z",
        content: [
          { type: "thinking", thinking: "已开始分析。" },
          { type: "text", text: "第一段正文" },
        ],
      },
      {
        id: promptId,
        role: "user",
        created_at: "2026-07-27T02:16:38.485Z",
        content: [{ type: "text", text: "review" }],
      },
      {
        id: "msg-previous-assistant",
        role: "assistant",
        created_at: "2026-07-27T02:15:00.000Z",
        content: [{ type: "text", text: "上一轮正文" }],
      },
    ], "session-1", promptId, 42, "epoch-1");

    expect(frames.map((frame) => frame.type)).toEqual(["content.part", "content.part"]);
    expect(frames.every((frame) => (
      (frame.payload as Record<string, unknown>).snapshotReplay === "in_flight" &&
      (frame.payload as Record<string, unknown>).kimixMissedProgressRecovery === true
    ))).toBe(true);
    expect(JSON.stringify(frames)).toContain("第一段正文");
    expect(JSON.stringify(frames)).not.toContain("上一轮正文");
    expect(frames.some((frame) => frame.type === "turn.ended")).toBe(false);
  });

  it("delivers the completed prompt's authoritative assistant before prompt.completed", async () => {
    const promptId = "msg_01PROMPT";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      expect(url).toContain("/api/v1/sessions/session-1/messages?");
      return new Response(JSON.stringify({
        code: 0,
        data: {
          has_more: false,
          items: [
            {
              id: "msg_session-1_000002",
              role: "assistant",
              created_at: "2026-07-19T13:56:09.526Z",
              content: [
                { type: "thinking", thinking: "确认在线" },
                { type: "text", text: "在的，有什么需要？" },
              ],
            },
            {
              id: "msg_session-1_000001",
              role: "user",
              created_at: "2026-07-19T13:56:09.526Z",
              content: [{ type: "text", text: "<system-reminder>injected</system-reminder>" }],
              metadata: { origin: { kind: "injection" } },
            },
            {
              id: promptId,
              role: "user",
              created_at: "2026-07-19T13:56:09.526Z",
              content: [{ type: "text", text: "你还在吗" }],
            },
          ],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    const observed: Array<{ type: string; payload?: unknown }> = [];
    client.onFrame((frame) => observed.push(frame));
    const internals = client as unknown as {
      receive: (frame: { type: string; session_id: string; seq: number; epoch: string; payload: unknown }) => void;
    };

    internals.receive({
      type: "prompt.completed",
      session_id: "session-1",
      seq: 13,
      epoch: "epoch-1",
      payload: { prompt_id: promptId, reason: "completed" },
    });

    await vi.waitFor(() => expect(observed.some((frame) => frame.type === "prompt.completed")).toBe(true));
    const completionIndex = observed.findIndex((frame) => frame.type === "prompt.completed");
    const assistantIndex = observed.findIndex((frame) => (
      frame.type === "content.part" &&
      (frame.payload as { part?: { text?: string } } | undefined)?.part?.text === "在的，有什么需要？"
    ));
    expect(assistantIndex).toBeGreaterThanOrEqual(0);
    expect(assistantIndex).toBeLessThan(completionIndex);

    const timeline = settleInactiveEvents(reduceKimiCodeEvents([
      {
        id: promptId,
        type: "user_message",
        timestamp: Date.parse("2026-07-19T13:56:09.526Z"),
        content: "你还在吗",
      },
      {
        id: "assistant-placeholder",
        type: "assistant_message",
        timestamp: Date.parse("2026-07-19T13:56:09.526Z") + 1,
        content: "在",
        thinking: "确",
        thinkingParts: [{
          id: "thinking-partial",
          timestamp: Date.parse("2026-07-19T13:56:09.526Z") + 1,
          text: "确",
        }],
        isThinking: true,
        isComplete: false,
      },
    ], observed.map((frame) => flattenServerEvent(frame as Parameters<typeof flattenServerEvent>[0]))));
    const renderedAssistant = buildRenderItems(timeline, "kimi-code")
      .find((item) => item.type === "event" && item.event.type === "assistant_message");
    expect(renderedAssistant).toMatchObject({
      type: "event",
      event: {
        type: "assistant_message",
        content: "在的，有什么需要？",
        thinking: expect.stringContaining("确认在线"),
        isComplete: true,
      },
    });
    await client.close();
  });

  it("keeps every step's thinking when a multi-tool prompt completion barrier arrives", () => {
    const promptId = "msg_prompt_multi_step";
    const messages = [
      {
        id: "msg_asst_final",
        role: "assistant",
        created_at: "2026-07-20T10:00:10.000Z",
        content: [
          { type: "thinking", thinking: "最终整理回答要点。" },
          { type: "text", text: "三处剧情铺垫已补全。" },
        ],
      },
      {
        id: "msg_tool_2",
        role: "tool",
        created_at: "2026-07-20T10:00:09.000Z",
        tool_call_id: "tool_2",
        content: [{ type: "tool_result", tool_call_id: "tool_2", output: "ok2" }],
      },
      {
        id: "msg_asst_2",
        role: "assistant",
        created_at: "2026-07-20T10:00:08.000Z",
        content: [
          { type: "thinking", thinking: "第二段思考，准备再读一个文件。" },
          { type: "tool_use", tool_call_id: "tool_2", tool_name: "Read", input: { path: "b.ts" } },
        ],
      },
      {
        id: "msg_tool_1",
        role: "tool",
        created_at: "2026-07-20T10:00:07.000Z",
        tool_call_id: "tool_1",
        content: [{ type: "tool_result", tool_call_id: "tool_1", output: "ok1" }],
      },
      {
        id: "msg_asst_1",
        role: "assistant",
        created_at: "2026-07-20T10:00:06.000Z",
        content: [
          { type: "thinking", thinking: "第一段很长的思考内容，分析项目结构和剧情规范。" },
          { type: "tool_use", tool_call_id: "tool_1", tool_name: "Bash", input: { command: "ls" } },
        ],
      },
      {
        id: "msg_inject",
        role: "user",
        created_at: "2026-07-20T10:00:00.000Z",
        content: [{ type: "text", text: "<system-reminder>injected</system-reminder>" }],
        metadata: { origin: { kind: "injection" } },
      },
      {
        id: promptId,
        role: "user",
        created_at: "2026-07-20T10:00:00.000Z",
        content: [{ type: "text", text: "快速全面了解一下当前项目" }],
      },
    ];

    const frames = completedPromptMessagesToServerFrames(messages, "session-multi", promptId, 10, "epoch-1");
    const live = reduceKimiCodeEvents([], [
      { type: "TurnBegin", payload: { user_input: "快速全面了解一下当前项目" }, timestamp: 1 },
      { type: "thinking.delta", delta: "live partial thinking", timestamp: 2 },
      { type: "tool.call.started", payload: { toolCallId: "live-tool", name: "Bash", args: { command: "pwd" } }, timestamp: 3 },
    ] as Parameters<typeof reduceKimiCodeEvents>[1]);
    const timeline = settleInactiveEvents(reduceKimiCodeEvents(
      live,
      frames.map((frame) => flattenServerEvent(frame as Parameters<typeof flattenServerEvent>[0])),
    ));
    const rendered = buildRenderItems(timeline, "kimi-code")
      .find((item) => item.type === "event" && item.event.type === "assistant_message");
    expect(rendered).toBeTruthy();
    if (!rendered || rendered.type !== "event" || rendered.event.type !== "assistant_message") {
      throw new Error("expected assistant render item");
    }
    const thinking = [
      rendered.event.thinking ?? "",
      ...(rendered.event.thinkingParts ?? []).map((part) => part.text),
    ].join("\n");
    expect(rendered.leadingTools?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(thinking).toContain("第一段很长的思考内容");
    expect(thinking).toContain("第二段思考");
    expect(thinking).toContain("最终整理回答要点");
    expect(rendered.event.content).toContain("三处剧情铺垫已补全");
  });

  it("waits for a displayable assistant when prompt completion reaches message storage first", async () => {
    vi.useFakeTimers();
    const promptId = "msg_01DELAYED";
    let requestCount = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      requestCount += 1;
      const items = requestCount === 1
        ? [{ id: promptId, role: "user", content: [{ type: "text", text: "测试" }] }]
        : [
            { id: "msg-assistant", role: "assistant", content: [{ type: "text", text: "稍后落库的回答" }] },
            { id: promptId, role: "user", content: [{ type: "text", text: "测试" }] },
          ];
      return new Response(JSON.stringify({ code: 0, data: { has_more: false, items } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));

    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    const observed: Array<{ type: string; payload?: unknown }> = [];
    client.onFrame((current) => observed.push(current));
    const internals = client as unknown as {
      receive: (current: { type: string; session_id: string; seq: number; epoch: string; payload: unknown }) => void;
    };
    internals.receive({
      type: "prompt.completed",
      session_id: "session-1",
      seq: 18,
      epoch: "epoch-1",
      payload: { prompt_id: promptId },
    });

    await vi.waitFor(() => expect(requestCount).toBe(1));
    expect(observed.some((current) => current.type === "prompt.completed")).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => expect(observed.some((current) => current.type === "prompt.completed")).toBe(true));
    const assistantIndex = observed.findIndex((current) => current.type === "content.part");
    const completionIndex = observed.findIndex((current) => current.type === "prompt.completed");
    // Baseline calibration (/messages) races with the barrier read: 2 or 3 both valid.
    expect(requestCount).toBeGreaterThanOrEqual(2);
    expect(assistantIndex).toBeGreaterThanOrEqual(0);
    expect(assistantIndex).toBeLessThan(completionIndex);
    await client.close();
  });

  it("passes through a subagent prompt.completed without running the completion barrier", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { has_more: false, items: [] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    const observed: Array<{ type: string; payload?: unknown }> = [];
    client.onFrame((current) => observed.push(current));
    const internals = client as unknown as {
      receive: (current: { type: string; session_id: string; seq: number; epoch: string; payload: unknown }) => void;
    };

    // 0.29 实测：Swarm 子代理的 prompt.completed 携带子代理自己的 agentId，
    // 不得触发主会话的消息回放/权威快照替换屏障。
    internals.receive({
      type: "prompt.completed",
      session_id: "session-1",
      seq: 20,
      epoch: "epoch-1",
      payload: { promptId: "msg-subagent-prompt", agentId: "agent-0", reason: "completed" },
    });

    await vi.waitFor(() => expect(observed.some((current) => current.type === "prompt.completed")).toBe(true));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(observed.some((current) => current.type === "kimix.server.snapshot")).toBe(false);
    await client.close();
  });

  it("recovers a stable failure assistant before delivering a failed prompt completion", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/messages?")) {
        // Baseline calibration request for the post-terminal watch; empty items.
        return new Response(JSON.stringify({ code: 0, data: { items: [], has_more: false } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      expect(url).toBe("http://127.0.0.1:58627/api/v1/sessions/session-1/snapshot");
      return new Response(JSON.stringify({
        code: 0,
        data: {
          as_of_seq: 19,
          epoch: "epoch-1",
          session: { id: "session-1", status: "idle", busy: false, main_turn_active: false, last_turn_reason: "failed" },
          messages: {
            items: [
              { id: "msg-user-failed", role: "user", content: [{ type: "text", text: "？？？" }] },
              { id: "msg-assistant-failed", role: "assistant", content: [] },
            ],
          },
          in_flight_turn: null,
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    const observed: Array<{ type: string; payload?: unknown }> = [];
    client.onFrame((current) => observed.push(current));
    const internals = client as unknown as {
      subscribed: Set<string>;
      receive: (current: { type: string; session_id: string; seq: number; epoch: string; payload: unknown }) => void;
    };
    internals.subscribed.add("session-1");

    internals.receive({
      type: "prompt.completed",
      session_id: "session-1",
      seq: 19,
      epoch: "epoch-1",
      payload: { prompt_id: "msg-failed", reason: "failed" },
    });

    await vi.waitFor(() => expect(observed.some((current) => current.type === "prompt.completed")).toBe(true));
    const snapshotIndex = observed.findIndex((current) => current.type === "kimix.server.snapshot");
    const completionIndex = observed.findIndex((current) => current.type === "prompt.completed");
    // recoverSnapshot + getSnapshot hit the snapshot endpoint; the /messages
    // baseline calibration adds one more call.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(snapshotIndex).toBeGreaterThanOrEqual(0);
    expect(snapshotIndex).toBeLessThan(completionIndex);
    await client.close();
  });

  it("delivers failure frames for a live failed prompt completion even when snapshot is in transition", async () => {
    // Live failure snapshot is still in transition: busy=true and a non-empty
    // in_flight_turn, so snapshotMessagesToServerFrames will NOT synthesize the
    // failure body. deliverPromptCompletion must still self-construct the
    // three failure frames so the renderer sees a settled failed Assistant.
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("http://127.0.0.1:58627/api/v1/sessions/session-1/snapshot");
      return new Response(JSON.stringify({
        code: 0,
        data: {
          as_of_seq: 19,
          epoch: "epoch-1",
          session: { id: "session-1", status: "idle", busy: true, main_turn_active: true, last_turn_reason: "failed" },
          messages: {
            items: [
              { id: "msg-user-failed", role: "user", content: [{ type: "text", text: "？？？" }] },
              { id: "msg-assistant-failed", role: "assistant", content: [] },
            ],
          },
          in_flight_turn: {
            messages: [{ id: "msg-assistant-failed", role: "assistant", content: [] }],
          },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    const observed: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    client.onFrame((current) => observed.push({ type: current.type, payload: current.payload as Record<string, unknown> | undefined }));
    const internals = client as unknown as {
      subscribed: Set<string>;
      receive: (current: { type: string; session_id: string; seq: number; epoch: string; payload: unknown }) => void;
    };
    internals.subscribed.add("session-1");

    internals.receive({
      type: "prompt.completed",
      session_id: "session-1",
      seq: 19,
      epoch: "epoch-1",
      payload: { prompt_id: "msg-failed", reason: "failed" },
    });

    await vi.waitFor(() => expect(observed.some((current) => current.type === "prompt.completed")).toBe(true));
    const completionIndex = observed.findIndex((current) => current.type === "prompt.completed");
    const interruptedIndex = observed.findIndex((current) => current.type === "turn.step.interrupted");
    const contentPartIndex = observed.findIndex((current) => current.type === "content.part");
    const turnEndedIndex = observed.findIndex((current) => current.type === "turn.ended");

    // All three failure frames must be delivered before prompt.completed.
    expect(interruptedIndex).toBeGreaterThanOrEqual(0);
    expect(contentPartIndex).toBeGreaterThan(interruptedIndex);
    expect(turnEndedIndex).toBeGreaterThan(contentPartIndex);
    expect(turnEndedIndex).toBeLessThan(completionIndex);

    // content.part carries the failure body and the barrier flag for idempotent REPLACE merge.
    const contentPart = observed[contentPartIndex]?.payload;
    expect(contentPart).toMatchObject({
      snapshotMessageId: "msg-assistant-failed",
      snapshotMessageIdStable: true,
      kimixPromptCompletionBarrier: true,
    });
    expect(String((contentPart?.part as { text?: unknown })?.text)).toContain("模型请求失败");

    // turn.ended carries the failed reason and the same stable identity.
    const turnEnded = observed[turnEndedIndex]?.payload;
    expect(turnEnded).toMatchObject({
      reason: "failed",
      snapshotMessageId: "msg-assistant-failed",
      snapshotMessageIdStable: true,
    });

    await client.close();
  });

  it("delivers failure frames with stable message identity from snapshot assistant", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("http://127.0.0.1:58627/api/v1/sessions/session-1/snapshot");
      return new Response(JSON.stringify({
        code: 0,
        data: {
          as_of_seq: 19,
          epoch: "epoch-1",
          session: { id: "session-1", status: "idle", busy: false, main_turn_active: false, last_turn_reason: "failed" },
          messages: {
            items: [
              { id: "msg-user-failed", role: "user", content: [{ type: "text", text: "？？？" }] },
              { id: "msg-empty-1", role: "assistant", content: [] },
            ],
          },
          in_flight_turn: null,
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    const observed: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    client.onFrame((current) => observed.push({ type: current.type, payload: current.payload as Record<string, unknown> | undefined }));
    const internals = client as unknown as {
      subscribed: Set<string>;
      receive: (current: { type: string; session_id: string; seq: number; epoch: string; payload: unknown }) => void;
    };
    internals.subscribed.add("session-1");

    internals.receive({
      type: "prompt.completed",
      session_id: "session-1",
      seq: 19,
      epoch: "epoch-1",
      payload: { prompt_id: "msg-failed", reason: "failed" },
    });

    await vi.waitFor(() => expect(observed.some((current) => current.type === "prompt.completed")).toBe(true));
    for (const frameType of ["turn.step.interrupted", "content.part", "turn.ended"]) {
      const frame = observed.find((current) => current.type === frameType);
      expect(frame?.payload).toMatchObject({
        snapshotMessageId: "msg-empty-1",
        snapshotMessageIdStable: true,
      });
    }
    await client.close();
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

  it("restores a video-only user message from official history", () => {
    const frames = snapshotMessagesToServerFrames({
      as_of_seq: 9,
      epoch: "epoch-video",
      session: { id: "session-video", status: "idle" },
      messages: {
        items: [{
          id: "msg-video",
          role: "user",
          content: [{ type: "video", source: { kind: "file", file_id: "file-video" } }],
        }],
      },
    }, "session-video");

    expect(frames[0]).toMatchObject({
      type: "TurnBegin",
      payload: {
        snapshotMessageId: "msg-video",
        user_input: [{ type: "video", source: { kind: "file", file_id: "file-video" } }],
      },
    });
    expect(mapHistoryEvents(frames)).toMatchObject([{
      type: "user_message",
      content: "",
      images: [{ kind: "video", name: "视频 1", fileId: "file-video" }],
    }]);
  });

  it("restores snapshot tool_use parts so tool results remain visible after reopening", () => {
    const frames = snapshotMessagesToServerFrames({
      as_of_seq: 51,
      epoch: "epoch-tools",
      session: { id: "session-tools", status: "idle" },
      messages: {
        items: [
          { id: "msg-user", role: "user", content: [{ type: "text", text: "检查项目" }] },
          {
            id: "msg-assistant-tool",
            role: "assistant",
            content: [{
              type: "tool_use",
              tool_call_id: "call-1",
              tool_name: "Shell",
              input: { command: "git status --short" },
            }],
          },
          {
            id: "msg-tool-result",
            role: "tool",
            content: [{ type: "tool_result", tool_call_id: "call-1", output: "clean" }],
          },
        ],
      },
    }, "session-tools");

    expect(frames).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "tool.call.started",
        payload: expect.objectContaining({
          toolCallId: "call-1",
          name: "Shell",
          args: { command: "git status --short" },
          snapshotReplay: "history",
          snapshotMessageId: "msg-assistant-tool",
        }),
      }),
      expect.objectContaining({
        type: "tool.result",
        payload: expect.objectContaining({ toolCallId: "call-1", output: "clean" }),
      }),
    ]));
    const mapped = mapHistoryEvents(frames.map((current) => ({ type: current.type, payload: current.payload })));
    expect(mapped.find((event) => event.type === "tool_call")).toMatchObject({
      type: "tool_call",
      toolCallId: "call-1",
      toolName: "Shell",
      status: "success",
      arguments: { command: "git status --short" },
      result: "clean",
    });
  });

  it("restores a visible failure event when a real 0.27 snapshot ends with an empty assistant and omits the failure reason", () => {
    const frames = snapshotMessagesToServerFrames({
      as_of_seq: 619,
      epoch: "epoch-failed",
      session: { id: "session-failed", status: "idle", busy: false, main_turn_active: false },
      messages: {
        items: [
          { id: "msg-user-failed", role: "user", content: [{ type: "text", text: "继续检查" }] },
          { id: "msg-assistant-failed", role: "assistant", content: [] },
        ],
      },
      in_flight_turn: null,
    }, "session-failed");

    expect(frames.at(-2)).toMatchObject({
      type: "content.part",
      payload: {
        snapshotReplay: "history",
        part: { type: "text", text: expect.stringContaining("未返回可显示内容") },
      },
    });
    const mapped = mapHistoryEvents(frames.map((current) => ({
      type: current.type,
      payload: current.payload,
    })));
    expect(mapped.findLast((event) => event.type === "status_update")).toMatchObject({
      message: "输出打断",
    });
    expect(mapped.findLast((event) => event.type === "assistant_message")).toMatchObject({
      snapshotMessageId: "msg-assistant-failed",
      snapshotMessageIdStable: true,
    });
    const rendered = buildRenderItems(mapped, "kimi-code");
    expect(rendered.findLast((item) => item.type === "event" && item.event.type === "assistant_message")).toMatchObject({
      type: "event",
      trailingStatuses: [expect.objectContaining({ message: "输出打断" })],
    });
  });

  it("does not invent a failure body when the terminal turn already has visible tool output", () => {
    const frames = snapshotMessagesToServerFrames({
      as_of_seq: 620,
      epoch: "epoch-tool-only",
      session: { id: "session-tool-only", status: "idle", busy: false, main_turn_active: false },
      messages: {
        items: [
          { id: "msg-user", role: "user", content: [{ type: "text", text: "检查状态" }] },
          {
            id: "msg-tool-call",
            role: "assistant",
            content: [{ type: "tool_use", tool_call_id: "call-1", tool_name: "Shell", input: { command: "git status" } }],
          },
          { id: "msg-tool-result", role: "tool", content: [{ type: "tool_result", tool_call_id: "call-1", output: "clean" }] },
          { id: "msg-empty-assistant", role: "assistant", content: [] },
        ],
      },
      in_flight_turn: null,
    }, "session-tool-only");

    expect(frames.some((frame) => (
      frame.type === "content.part" &&
      (frame.payload as { snapshotMessageId?: string } | undefined)?.snapshotMessageId === "msg-empty-assistant"
    ))).toBe(false);
  });

  it("does not synthesize terminal failure content while the snapshot session is still busy", () => {
    const frames = snapshotMessagesToServerFrames({
      as_of_seq: 621,
      epoch: "epoch-busy-empty",
      session: { id: "session-busy-empty", status: "running", busy: true, main_turn_active: true },
      messages: {
        items: [
          { id: "msg-user", role: "user", content: [{ type: "text", text: "等待首 token" }] },
          { id: "msg-empty-assistant", role: "assistant", content: [] },
        ],
      },
      in_flight_turn: null,
    }, "session-busy-empty");

    expect(frames.some((frame) => frame.type === "content.part")).toBe(false);
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

describe("snapshot tool replay failure flag", () => {
  it("preserves is_error when replaying official tool messages", () => {
    const frames = snapshotMessagesToServerFrames({
      as_of_seq: 42,
      epoch: "epoch-1",
      session: { id: "session-1", status: "idle" },
      messages: {
        items: [
          {
            id: "msg-tool-failed",
            role: "tool",
            content: [{ type: "tool_result", tool_call_id: "call-err", output: "Failed to grep: rg: no such file", is_error: true }],
          },
        ],
      },
    }, "session-1");
    const toolFrame = frames.find((frame) => frame.type === "tool.result");
    expect(toolFrame?.payload).toMatchObject({ toolCallId: "call-err", is_error: true });
  });
});

describe("post-terminal external prompt watch probe (v2.20.195 three-step sequence)", () => {
  const terminalAt = Date.parse("2026-08-04T10:03:00Z");

  function snapshotBody(items: unknown[]) {
    return {
      as_of_seq: 20,
      epoch: "epoch-1",
      session: { id: "session-1", status: "idle", busy: false, main_turn_active: false, last_turn_reason: "completed" },
      messages: { items },
      in_flight_turn: null,
    };
  }

  async function setup(snapshot: unknown) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: snapshot }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    const internals = client as unknown as {
      subscribed: Set<string>;
      pendingPrompts: Map<string, { completionId: string; messageId: string }>;
      postTerminalExternalWatch: Map<string, { terminalAt: number; lastProbeAt: number; armedAt: number }>;
      pollPostTerminalExternalPrompts: () => void;
      cursors: Map<string, { seq: number; epoch?: string }>;
      probeExternalUserPromptAfterTerminal: (sessionId: string, terminalAt: number) => Promise<void>;
    };
    internals.subscribed.add("session-1");
    internals.postTerminalExternalWatch.set("session-1", { terminalAt, lastProbeAt: 0, armedAt: Date.now() });
    return { client, fetchMock, internals };
  }

  it("hit: boundary after the turn end -> deletes watch and recovers twice (boundary first, then resubCursor)", async () => {
    const items = [
      { id: "m1", role: "assistant", content: [], created_at: "2026-08-04T10:02:00Z" },
      { id: "m2", role: "user", content: [{ type: "text", text: "old" }], created_at: "2026-08-04T10:01:00Z" },
      { id: "m3", role: "user", content: [{ type: "text", text: "external new turn" }], created_at: "2026-08-04T10:05:00Z" },
    ];
    const { client, fetchMock, internals } = await setup(snapshotBody(items));
    internals.cursors.set("session-1", { seq: 19, epoch: "epoch-1" });
    await internals.probeExternalUserPromptAfterTerminal("session-1", terminalAt);
    // probe getSnapshot 1 + two recoverSnapshot calls = 3 /snapshot requests.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await client.close();
  });

  it("miss: newest user not after the turn end -> keeps the watch, no recovery", async () => {
    const items = [
      { id: "m1", role: "user", content: [{ type: "text", text: "old" }], created_at: "2026-08-04T10:02:00Z" },
    ];
    const { client, fetchMock, internals } = await setup(snapshotBody(items));
    await internals.probeExternalUserPromptAfterTerminal("session-1", terminalAt);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(internals.postTerminalExternalWatch.has("session-1")).toBe(true);
    await client.close();
  });

  it("no user message in snapshot -> keeps the watch for the next probe", async () => {
    const items = [
      { id: "m1", role: "assistant", content: [], created_at: "2026-08-04T10:02:00Z" },
    ];
    const { client, fetchMock, internals } = await setup(snapshotBody(items));
    await internals.probeExternalUserPromptAfterTerminal("session-1", terminalAt);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(internals.postTerminalExternalWatch.has("session-1")).toBe(true);
    await client.close();
  });

  it("local pending prompt exists -> deletes the watch without recovering", async () => {
    const items = [
      { id: "m3", role: "user", content: [{ type: "text", text: "external new turn" }], created_at: "2026-08-04T10:05:00Z" },
    ];
    const { client, fetchMock, internals } = await setup(snapshotBody(items));
    internals.pendingPrompts.set("session-1", { completionId: "c-1", messageId: "m-1" });
    await internals.probeExternalUserPromptAfterTerminal("session-1", terminalAt);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(internals.postTerminalExternalWatch.has("session-1")).toBe(false);
    await client.close();
  });

  it("watch armed longer than the TTL -> poll evicts it without probing (review B1)", async () => {
    const { client, fetchMock, internals } = await setup(snapshotBody([]));
    internals.postTerminalExternalWatch.set("session-1", {
      terminalAt,
      lastProbeAt: 0,
      armedAt: Date.now() - 31 * 60_000,
    });
    internals.pollPostTerminalExternalPrompts();
    expect(internals.postTerminalExternalWatch.has("session-1")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    await client.close();
  });
});

describe("frame queue overflow protection", () => {
  type FrameInternals = {
    deliver(frame: unknown): void;
    queued: Array<{ type?: string; payload?: Record<string, unknown> }>;
    waitForSessionEvent(
      sessionId: string,
      match: (frame: { type?: string }) => boolean,
      idleTimeoutMs: number,
    ): Promise<{ payload?: Record<string, unknown> }>;
  };

  const internalsOf = (client: KimiCodeServerClient) => client as unknown as FrameInternals;
  const normalFrame = (seq: number) => ({
    type: "assistant.delta",
    session_id: "s1",
    seq,
    payload: { text: `chunk-${seq}` },
  });
  // recovered_from_snapshot: true 避免触发 post-terminal 外部探针副作用
  const terminalFrame = (seq: number, promptId: string) => ({
    type: "prompt.completed",
    session_id: "s1",
    seq,
    payload: { prompt_id: promptId, recovered_from_snapshot: true },
  });

  it("滞回修剪：超过 2000 一次剪到 1200，之后不再每帧扫描", () => {
    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    const internals = internalsOf(client);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    for (let seq = 1; seq <= 2001; seq += 1) internals.deliver(normalFrame(seq));
    expect(internals.queued).toHaveLength(1200);

    internals.deliver(normalFrame(2002));
    expect(internals.queued).toHaveLength(1201);
    warn.mockRestore();
  });

  it("混合队列溢出只删最老普通帧，最老终止帧保留且可被 waitForSessionEvent 匹配", async () => {
    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    const internals = internalsOf(client);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // 终止帧放在最老位置——正是 160/198 修复要保护的场景
    internals.deliver(terminalFrame(1, "p-oldest"));
    for (let seq = 2; seq <= 2001; seq += 1) internals.deliver(normalFrame(seq));

    expect(internals.queued).toHaveLength(1200);
    const survivors = internals.queued.filter((frame) => frame.type === "prompt.completed");
    expect(survivors).toHaveLength(1);
    expect(survivors[0]?.payload?.prompt_id).toBe("p-oldest");
    // 最老的 801 条普通帧被剪掉，队列首帧是终止帧
    expect(internals.queued[0]?.type).toBe("prompt.completed");

    await expect(
      internals.waitForSessionEvent("s1", (frame) => frame.type === "prompt.completed", 1_000),
    ).resolves.toMatchObject({ payload: { prompt_id: "p-oldest" } });
    warn.mockRestore();
  });

  it("队列几乎全为终止帧的极端场景：兜底截断最老终止帧，较近终止帧保留", () => {
    const client = new KimiCodeServerClient("http://127.0.0.1:58627");
    const internals = internalsOf(client);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    for (let seq = 1; seq <= 2001; seq += 1) internals.deliver(terminalFrame(seq, `p-${seq}`));

    expect(internals.queued).toHaveLength(1200);
    expect(internals.queued[0]?.payload?.prompt_id).toBe("p-802");
    expect(internals.queued.at(-1)?.payload?.prompt_id).toBe("p-2001");
    warn.mockRestore();
  });
});
