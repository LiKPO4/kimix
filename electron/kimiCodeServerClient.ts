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
  session_id?: string;
  payload?: unknown;
};

type ServerEnvelope<T> = { code: number; msg?: string; data: T };
type FrameListener = (frame: ServerFrame) => void;

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
  private readonly queued: ServerFrame[] = [];
  private readonly waiters = new Set<{
    match: (frame: ServerFrame) => boolean;
    resolve: (frame: ServerFrame) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private nextId = 0;

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
    await this.ensureConnected();
    const ack = await this.sendControl("subscribe", { session_ids: [sessionId] });
    if (ack.code !== 0) throw new Error(`Kimi Server subscribe 失败：${ack.msg ?? ack.code}`);
  }

  async unsubscribe(sessionId: string): Promise<void> {
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
    this.socket?.close();
    this.socket = null;
    this.connected = null;
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
    const socket = new WebSocket(`${this.endpoint.replace(/^http/, "ws")}/api/v1/ws`);
    this.socket = socket;
    socket.addEventListener("message", (event) => this.receive(JSON.parse(String(event.data)) as ServerFrame));
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("Kimi Server WebSocket 连接失败")), { once: true });
    });
    await this.waitFor((frame) => frame.type === "server_hello", CONTROL_TIMEOUT_MS);
    const ack = await this.sendControl("client_hello", {
      client_id: `kimix-${process.pid}-${Date.now()}`,
      subscriptions: [],
    });
    if (ack.code !== 0) throw new Error(`Kimi Server handshake 失败：${ack.msg ?? ack.code}`);
  }

  private async sendControl(type: string, payload: unknown) {
    const id = `kimix-${++this.nextId}`;
    this.socket?.send(JSON.stringify({ type, id, payload }));
    return this.waitFor((frame) => frame.type === "ack" && frame.id === id, CONTROL_TIMEOUT_MS);
  }

  private receive(frame: ServerFrame) {
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
