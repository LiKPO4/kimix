export type ServerPromptPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; id?: string } };

export type ServerSession = {
  id: string;
  status: string;
  metadata?: Record<string, unknown>;
  agent_config?: Record<string, unknown>;
  usage?: Record<string, unknown>;
};

export type ServerFrame = {
  type: string;
  id?: string;
  code?: number;
  msg?: string;
  seq?: number;
  epoch?: string;
  volatile?: boolean;
  session_id?: string;
  payload?: unknown;
};

type ServerEnvelope<T> = { code: number; msg?: string; data: T };
type FrameListener = (frame: ServerFrame) => void;
type ServerCursor = { seq: number; epoch?: string };

export type ServerSnapshot = {
  as_of_seq: number;
  epoch?: string;
  session: ServerSession;
  messages?: { items?: unknown[]; has_more?: boolean };
  in_flight_turn?: unknown;
  pending_approvals?: unknown[];
  pending_questions?: unknown[];
};

const CONTROL_TIMEOUT_MS = 5_000;

export function isKimiCodeServerSessionRoutingEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.KIMIX_EXPERIMENTAL_KIMI_SERVER_SESSIONS?.trim() === "1";
}

export function toServerPromptContent(input: string | Array<{ type: string; text?: string; imageUrl?: { url: string; id?: string } }>): ServerPromptPart[] {
  if (typeof input === "string") return [{ type: "text", text: input }];
  return input.map((part) => part.type === "text"
    ? { type: "text", text: part.text ?? "" }
    : { type: "image_url", image_url: { url: part.imageUrl?.url ?? "", id: part.imageUrl?.id } });
}

export function flattenServerEvent(frame: ServerFrame): Record<string, unknown> {
  const payload = frame.payload && typeof frame.payload === "object"
    ? frame.payload as Record<string, unknown>
    : {};
  return { type: frame.type, ...payload, seq: frame.seq };
}

export class KimiCodeServerClient {
  private socket: WebSocket | null = null;
  private connected: Promise<void> | null = null;
  private readonly listeners = new Set<FrameListener>();
  private readonly subscribed = new Set<string>();
  private readonly cursors = new Map<string, ServerCursor>();
  private readonly recoveringSnapshots = new Set<string>();
  private readonly queued: ServerFrame[] = [];
  private readonly waiters = new Set<{
    match: (frame: ServerFrame) => boolean;
    resolve: (frame: ServerFrame) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private nextId = 0;
  private closing = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;

  constructor(readonly endpoint: string) {}

  async createSession(input: {
    workDir: string;
    id?: string;
    model?: string;
    thinking?: string;
    permission?: string;
    planMode?: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<ServerSession> {
    return this.request("/api/v1/sessions", {
      method: "POST",
      body: JSON.stringify({
        id: input.id,
        metadata: { ...input.metadata, cwd: input.workDir },
        agent_config: {
          model: input.model,
          thinking: input.thinking ?? "off",
          permission_mode: input.permission ?? "manual",
          plan_mode: input.planMode ?? false,
        },
      }),
    });
  }

  getSession(sessionId: string): Promise<ServerSession> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}`);
  }

  updateSession(sessionId: string, agentConfig: Record<string, unknown>): Promise<ServerSession> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/profile`, {
      method: "POST",
      body: JSON.stringify({ agent_config: agentConfig }),
    });
  }

  async subscribe(sessionId: string): Promise<void> {
    this.subscribed.add(sessionId);
    await this.ensureConnected();
    const ack = await this.sendControl("subscribe", {
      session_ids: [sessionId],
      cursors: this.cursorPayload([sessionId]),
    });
    if (ack.code !== 0) throw new Error(`Kimi Server subscribe 失败：${ack.msg ?? ack.code}`);
    await this.handleAckResync(ack);
  }

  async unsubscribe(sessionId: string): Promise<void> {
    this.subscribed.delete(sessionId);
    this.cursors.delete(sessionId);
    if (!this.socket) return;
    await this.sendControl("unsubscribe", { session_ids: [sessionId] }).catch(() => undefined);
  }

  async prompt(sessionId: string, input: unknown, controls: Record<string, unknown>) {
    const result = await this.request<{ prompt_id: string }>(`/api/v1/sessions/${encodeURIComponent(sessionId)}/prompts`, {
      method: "POST",
      body: JSON.stringify({ content: toServerPromptContent(input as Parameters<typeof toServerPromptContent>[0]), ...controls }),
    });
    await this.waitFor((frame) => {
      if (frame.session_id !== sessionId || frame.type !== "prompt.completed") return false;
      const payload = frame.payload as { promptId?: unknown; prompt_id?: unknown } | undefined;
      return (payload?.promptId ?? payload?.prompt_id) === result.prompt_id;
    }, 180_000);
    return result;
  }

  async steer(sessionId: string, input: unknown, controls: Record<string, unknown>) {
    const queued = await this.request<{ prompt_id: string }>(`/api/v1/sessions/${encodeURIComponent(sessionId)}/prompts`, {
      method: "POST",
      body: JSON.stringify({ content: toServerPromptContent(input as Parameters<typeof toServerPromptContent>[0]), ...controls }),
    });
    await this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/prompts:steer`, {
      method: "POST",
      body: JSON.stringify({ prompt_ids: [queued.prompt_id] }),
    });
    return queued;
  }

  abort(sessionId: string): Promise<unknown> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}:abort`, { method: "POST", body: "{}" });
  }

  resolveApproval(sessionId: string, approvalId: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(approvalId)}`, {
      method: "POST", body: JSON.stringify(body),
    });
  }

  resolveQuestion(sessionId: string, questionId: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(questionId)}`, {
      method: "POST", body: JSON.stringify(body),
    });
  }

  onFrame(listener: FrameListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close() {
    this.closing = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
    this.connected = null;
    this.subscribed.clear();
    this.cursors.clear();
    this.recoveringSnapshots.clear();
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("Kimi Server WebSocket 已关闭"));
    }
    this.waiters.clear();
  }

  async reconnectForProbe(): Promise<void> {
    if (!this.socket) throw new Error("Kimi Server WebSocket 尚未连接");
    const previous = this.socket;
    previous.close();
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (this.socket && this.socket !== previous && this.socket.readyState === WebSocket.OPEN) {
        await this.ensureConnected();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Kimi Server WebSocket 重连探针超时");
  }

  private ensureConnected(): Promise<void> {
    if (this.connected) return this.connected;
    this.connected = this.connect().catch((error) => {
      this.connected = null;
      throw error;
    });
    return this.connected;
  }

  private async connect() {
    this.closing = false;
    const reconnecting = this.reconnectAttempt > 0;
    const socket = new WebSocket(`${this.endpoint.replace(/^http/, "ws")}/api/v1/ws`);
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      try {
        this.receive(JSON.parse(String(event.data)) as ServerFrame);
      } catch {
        // Ignore malformed server frames and keep the live connection usable.
      }
    });
    socket.addEventListener("close", () => this.handleSocketClose(socket));
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("Kimi Server WebSocket 连接失败")), { once: true });
    });
    await this.waitFor((frame) => frame.type === "server_hello", CONTROL_TIMEOUT_MS);
    const ack = await this.sendControl("client_hello", {
      client_id: `kimix-${process.pid}-${Date.now()}`,
      subscriptions: [...this.subscribed],
      cursors: this.cursorPayload(this.subscribed),
    });
    if (ack.code !== 0) throw new Error(`Kimi Server handshake 失败：${ack.msg ?? ack.code}`);
    this.reconnectAttempt = 0;
    await this.handleAckResync(ack);
    if (reconnecting) {
      for (const sessionId of this.subscribed) await this.recoverSnapshot(sessionId);
    }
  }

  private async sendControl(type: string, payload: unknown) {
    const id = `kimix-${++this.nextId}`;
    this.socket?.send(JSON.stringify({ type, id, payload }));
    return this.waitFor((frame) => frame.type === "ack" && frame.id === id, CONTROL_TIMEOUT_MS);
  }

  private receive(frame: ServerFrame) {
    if (frame.type === "ping") {
      const nonce = (frame.payload as { nonce?: unknown } | undefined)?.nonce;
      this.socket?.send(JSON.stringify({ type: "pong", payload: { nonce } }));
    }
    if (frame.session_id && typeof frame.seq === "number" && frame.volatile !== true) {
      const previous = this.cursors.get(frame.session_id);
      if (!previous || frame.seq >= previous.seq) {
        this.cursors.set(frame.session_id, { seq: frame.seq, epoch: frame.epoch ?? previous?.epoch });
      }
    }
    if (frame.type === "resync_required") {
      const sessionId = (frame.payload as { session_id?: unknown } | undefined)?.session_id;
      if (typeof sessionId === "string") void this.recoverSnapshot(sessionId).catch(() => undefined);
    }
    for (const listener of this.listeners) listener(frame);
    for (const waiter of this.waiters) {
      if (!waiter.match(frame)) continue;
      this.waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(frame);
      return;
    }
    this.queued.push(frame);
    if (this.queued.length > 2_000) this.queued.splice(0, this.queued.length - 2_000);
  }

  private handleSocketClose(socket: WebSocket) {
    if (socket !== this.socket) return;
    this.socket = null;
    this.connected = null;
    if (this.closing || this.subscribed.size === 0) return;
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.closing) return;
    const delay = Math.min(250 * (2 ** this.reconnectAttempt), 5_000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureConnected().catch(() => this.scheduleReconnect());
    }, delay);
  }

  private cursorPayload(sessionIds: Iterable<string>) {
    const entries = [...sessionIds].flatMap((sessionId) => {
      const cursor = this.cursors.get(sessionId);
      return cursor ? [[sessionId, cursor] as const] : [];
    });
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  private async handleAckResync(ack: ServerFrame) {
    const payload = ack.payload as { cursors?: Record<string, ServerCursor>; resync_required?: string[] } | undefined;
    for (const [sessionId, cursor] of Object.entries(payload?.cursors ?? {})) {
      const previous = this.cursors.get(sessionId);
      if (!previous || cursor.seq >= previous.seq) this.cursors.set(sessionId, cursor);
    }
    for (const sessionId of payload?.resync_required ?? []) await this.recoverSnapshot(sessionId);
  }

  private async recoverSnapshot(sessionId: string) {
    if (!this.subscribed.has(sessionId)) return;
    if (this.recoveringSnapshots.has(sessionId)) return;
    this.recoveringSnapshots.add(sessionId);
    try {
      const snapshot = await this.request<ServerSnapshot>(
        `/api/v1/sessions/${encodeURIComponent(sessionId)}/snapshot`,
      );
      this.cursors.set(sessionId, { seq: snapshot.as_of_seq, epoch: snapshot.epoch });
      const frame: ServerFrame = {
        type: "kimix.server.snapshot",
        session_id: sessionId,
        seq: snapshot.as_of_seq,
        epoch: snapshot.epoch,
        payload: snapshot,
      };
      for (const listener of this.listeners) listener(frame);
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      const ack = await this.sendControl("subscribe", {
        session_ids: [sessionId],
        cursors: this.cursorPayload([sessionId]),
      });
      if (ack.code !== 0) throw new Error(`Kimi Server snapshot 重订阅失败：${ack.msg ?? ack.code}`);
    } finally {
      this.recoveringSnapshots.delete(sessionId);
    }
  }

  private waitFor(match: (frame: ServerFrame) => boolean, timeoutMs: number): Promise<ServerFrame> {
    const queuedIndex = this.queued.findIndex(match);
    if (queuedIndex >= 0) return Promise.resolve(this.queued.splice(queuedIndex, 1)[0]!);
    return new Promise((resolve, reject) => {
      const waiter = {
        match, resolve, reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error(`Kimi Server WebSocket 等待超时（${timeoutMs}ms）`));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  private async request<T>(pathname: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.endpoint}${pathname}`, {
      ...options,
      headers: { accept: "application/json", ...(options?.body ? { "content-type": "application/json" } : {}) },
    });
    if (!response.ok) throw new Error(`${pathname}: HTTP ${response.status}`);
    const envelope = await response.json() as ServerEnvelope<T>;
    if (envelope.code !== 0) throw new Error(`${pathname}: ${envelope.msg ?? envelope.code}`);
    return envelope.data;
  }
}
