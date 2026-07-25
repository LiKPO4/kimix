/**
 * Live-turn 一口诊断：把症状 7/11/12/13 收敛到可 grep 的 `[live]` 行。
 *
 * 设计原则：
 * - 关键状态机跃迁（display/settle/silence/connect）默认写 diag.log
 * - 全量 WS 帧仍走 KIMIX_FRAME_DIAG（避免刷屏）
 * - 纯函数可单测；写盘经 window.api.writeDiag，失败吞掉
 */

export type LiveDisplayMode =
  | "thinking"
  | "running"
  | "settled_complete"
  | "settled_visible"
  | "idle";

export type LiveTurnSnapshot = {
  openAssistants: number;
  completeAssistants: number;
  latestBodyLen: number;
  latestIsComplete: boolean;
  latestDurationMs?: number;
  latestTimestamp?: number;
  toolRunning: number;
  toolDone: number;
  hasThinking: boolean;
};

/** UI 头栏实际展示的完成/运行态（对齐 MessageBubble isSettledForDisplay）。 */
export function resolveLiveDisplayMode(input: {
  isActiveAssistant: boolean;
  isComplete: boolean;
  hasVisibleOutput: boolean;
  isThinking?: boolean;
}): LiveDisplayMode {
  if (input.isActiveAssistant) {
    return input.isThinking ? "thinking" : "running";
  }
  if (input.isComplete) return "settled_complete";
  if (input.hasVisibleOutput) return "settled_visible";
  return "idle";
}

export function shouldLogDisplayModeChange(
  prev: LiveDisplayMode | undefined,
  next: LiveDisplayMode,
): boolean {
  return prev !== next;
}

type AssistantLike = {
  type?: string;
  content?: string;
  thinking?: string;
  thinkingParts?: Array<{ text?: string }>;
  isComplete?: boolean;
  durationMs?: number;
  timestamp?: number;
};

type ToolLike = {
  type?: string;
  status?: string;
};

/** 从时间线抽一轮 live 摘要（不拷贝正文，只长度/计数）。 */
export function summarizeLiveTurn(
  events: Array<AssistantLike | ToolLike | { type?: string }>,
): LiveTurnSnapshot {
  let openAssistants = 0;
  let completeAssistants = 0;
  let latestBodyLen = 0;
  let latestIsComplete = false;
  let latestDurationMs: number | undefined;
  let latestTimestamp: number | undefined;
  let toolRunning = 0;
  let toolDone = 0;
  let hasThinking = false;

  for (const event of events) {
    if (event.type === "assistant_message") {
      const a = event as AssistantLike;
      const body = typeof a.content === "string" ? a.content : "";
      if (a.isComplete) completeAssistants += 1;
      else openAssistants += 1;
      latestBodyLen = body.length;
      latestIsComplete = Boolean(a.isComplete);
      latestDurationMs = typeof a.durationMs === "number" ? a.durationMs : undefined;
      latestTimestamp = typeof a.timestamp === "number" ? a.timestamp : undefined;
      if (a.thinking?.trim() || a.thinkingParts?.some((p) => p.text?.trim())) {
        hasThinking = true;
      }
    } else if (event.type === "tool_call") {
      const t = event as ToolLike;
      if (t.status === "running") toolRunning += 1;
      else toolDone += 1;
    }
  }

  return {
    openAssistants,
    completeAssistants,
    latestBodyLen,
    latestIsComplete,
    latestDurationMs,
    latestTimestamp,
    toolRunning,
    toolDone,
    hasThinking,
  };
}

/** 流式帧粗分类，便于 grep 7/12（正文空窗）与 13（进度停）。 */
export function classifyLiveStreamFrame(type: string | undefined): "body" | "think" | "tool" | "terminal" | "status" | "other" {
  if (!type) return "other";
  if (
    type === "assistant.delta" ||
    type === "content.part" ||
    type === "AssistantMessageDelta" ||
    type === "MessageDelta"
  ) return "body";
  if (type === "thinking.delta" || type === "ThinkingDelta") return "think";
  if (
    type.startsWith("tool.") ||
    type === "ToolCall" ||
    type === "ToolResult" ||
    type === "tool_call" ||
    type === "tool_result"
  ) return "tool";
  if (
    type === "prompt.completed" ||
    type === "prompt.aborted" ||
    type === "turn.ended" ||
    type === "TurnEnd" ||
    type === "turn.step.completed"
  ) return "terminal";
  if (
    type === "agent.status.updated" ||
    type === "usage.record" ||
    type === "status_update" ||
    type === "session.status_changed"
  ) return "status";
  return "other";
}

const lastDisplayModeByKey = new Map<string, LiveDisplayMode>();
const lastSilenceLogAtBySid = new Map<string, number>();
const lastStreamSampleAtBySid = new Map<string, number>();
type StreamKindCounts = {
  body: number;
  think: number;
  tool: number;
  terminal: number;
  status: number;
  other: number;
  firstAt: number;
  lastAt: number;
  lastBodyAt: number;
};
const streamCountsBySid = new Map<string, StreamKindCounts>();

export function resetLiveTurnDiagStateForTests() {
  lastDisplayModeByKey.clear();
  lastSilenceLogAtBySid.clear();
  lastStreamSampleAtBySid.clear();
  streamCountsBySid.clear();
}

function writeLive(message: string, data?: Record<string, unknown>) {
  try {
    const api = (typeof window !== "undefined" ? window.api : undefined) as
      | { writeDiag?: (req: { message: string; data?: unknown }) => Promise<unknown> }
      | undefined;
    void api?.writeDiag?.({ message, data })?.catch?.(() => undefined);
  } catch {
    /* diag must never break UI */
  }
}

export function noteLiveDisplayMode(input: {
  key: string;
  mode: LiveDisplayMode;
  sessionId?: string;
  bodyLen?: number;
  isComplete?: boolean;
  durationMs?: number | null;
  wallElapsedMs?: number;
  isActiveAssistant?: boolean;
}) {
  const prev = lastDisplayModeByKey.get(input.key);
  if (!shouldLogDisplayModeChange(prev, input.mode)) return;
  lastDisplayModeByKey.set(input.key, input.mode);
  writeLive("[live] display", {
    from: prev ?? "init",
    to: input.mode,
    sid: input.sessionId?.slice(-8),
    key: input.key.slice(-24),
    // 字段名避免 *body*/*content*：writeDiag 默认 redact 会吞掉长度
    textChars: input.bodyLen ?? 0,
    isComplete: Boolean(input.isComplete),
    durationMs: input.durationMs ?? undefined,
    wallElapsedMs: input.wallElapsedMs,
    active: Boolean(input.isActiveAssistant),
  });
}

export function noteLiveStreamFrame(input: {
  runtimeSessionId: string;
  rawType?: string;
  mappedType?: string;
  bodyLen?: number;
  isComplete?: boolean;
  isThinking?: boolean;
  volatile?: boolean;
  offset?: number;
}) {
  const sid = input.runtimeSessionId;
  const kind = classifyLiveStreamFrame(input.rawType) !== "other"
    ? classifyLiveStreamFrame(input.rawType)
    : classifyLiveStreamFrame(input.mappedType);
  const now = Date.now();
  const counts = streamCountsBySid.get(sid) ?? {
    body: 0, think: 0, tool: 0, terminal: 0, status: 0, other: 0, firstAt: now, lastAt: now, lastBodyAt: 0,
  };
  counts[kind] += 1;
  counts.lastAt = now;
  if (kind === "body") counts.lastBodyAt = now;
  streamCountsBySid.set(sid, counts);

  // 首帧 / 终端帧立即记；其它类最多 2s 采样一次
  const lastSample = lastStreamSampleAtBySid.get(sid) ?? 0;
  const isTerminal = kind === "terminal";
  const isFirst = counts.body + counts.think + counts.tool + counts.terminal + counts.status + counts.other === 1;
  if (!isFirst && !isTerminal && now - lastSample < 2000) return;
  lastStreamSampleAtBySid.set(sid, now);
  writeLive("[live] stream", {
    sid: sid.slice(-8),
    kind,
    rawType: input.rawType,
    mappedType: input.mappedType,
    textChars: input.bodyLen ?? 0,
    isComplete: Boolean(input.isComplete),
    isThinking: Boolean(input.isThinking),
    volatile: input.volatile,
    offset: input.offset,
    counts: {
      bodyDelta: counts.body,
      think: counts.think,
      tool: counts.tool,
      terminal: counts.terminal,
      status: counts.status,
      other: counts.other,
    },
    sinceFirstMs: now - counts.firstAt,
    sinceBodyMs: counts.lastBodyAt ? now - counts.lastBodyAt : null,
  });
}

export function noteLiveSilence(input: {
  runtimeSessionId: string;
  engineStatus?: string;
  streamAgeMs: number;
  turn?: LiveTurnSnapshot;
  runningSessionId?: string | null;
  minAgeMs?: number;
  everyMs?: number;
}) {
  const minAge = input.minAgeMs ?? 10_000;
  const every = input.everyMs ?? 15_000;
  if (input.streamAgeMs < minAge) return;
  const sid = input.runtimeSessionId;
  const now = Date.now();
  const last = lastSilenceLogAtBySid.get(sid) ?? 0;
  if (now - last < every) return;
  lastSilenceLogAtBySid.set(sid, now);
  const counts = streamCountsBySid.get(sid);
  const turn = input.turn
    ? {
        openAssistants: input.turn.openAssistants,
        completeAssistants: input.turn.completeAssistants,
        textChars: input.turn.latestBodyLen,
        latestIsComplete: input.turn.latestIsComplete,
        latestDurationMs: input.turn.latestDurationMs,
        latestTimestamp: input.turn.latestTimestamp,
        toolRunning: input.turn.toolRunning,
        toolDone: input.turn.toolDone,
        hasThinking: input.turn.hasThinking,
      }
    : undefined;
  writeLive("[live] silence", {
    sid: sid.slice(-8),
    engine: input.engineStatus,
    streamAgeMs: input.streamAgeMs,
    running: input.runningSessionId ? input.runningSessionId.slice(-8) : null,
    turn,
    streamCounts: counts
      ? {
          bodyDelta: counts.body,
          think: counts.think,
          tool: counts.tool,
          terminal: counts.terminal,
          status: counts.status,
          sinceBodyMs: counts.lastBodyAt ? now - counts.lastBodyAt : null,
        }
      : null,
  });
}

export function noteLiveSettle(input: {
  roomId: string;
  runtimeSessionId: string;
  roomAgentId?: string;
  terminalStatus: string;
  terminalPolls: number;
  turnReceivedBody: boolean;
  turn?: LiveTurnSnapshot;
  runningSessionId?: string | null;
  activityStatus?: string | null;
  wallSinceStartMs?: number;
}) {
  const turn = input.turn
    ? {
        openAssistants: input.turn.openAssistants,
        completeAssistants: input.turn.completeAssistants,
        textChars: input.turn.latestBodyLen,
        latestIsComplete: input.turn.latestIsComplete,
        latestDurationMs: input.turn.latestDurationMs,
        latestTimestamp: input.turn.latestTimestamp,
        toolRunning: input.turn.toolRunning,
        toolDone: input.turn.toolDone,
        hasThinking: input.turn.hasThinking,
      }
    : undefined;
  writeLive("[live] settle", {
    room: input.roomId.slice(-8),
    sid: input.runtimeSessionId.slice(-8),
    agent: input.roomAgentId,
    terminalStatus: input.terminalStatus,
    terminalPolls: input.terminalPolls,
    turnReceivedBody: input.turnReceivedBody,
    turn,
    running: input.runningSessionId ? input.runningSessionId.slice(-8) : null,
    activity: input.activityStatus ?? null,
    wallSinceStartMs: input.wallSinceStartMs,
  });
}

export function noteLivePoll(input: {
  runtimeSessionId: string;
  engineStatus?: string;
  active: boolean;
  streamAgeMs?: number;
  turn?: LiveTurnSnapshot;
}) {
  // poll 很密：只在 active 且有 turn 摘要时偶尔记，或 engine 变化由调用方决定。
  // 这里提供统一格式，调用方做节流。
  writeLive("[live] poll", {
    sid: input.runtimeSessionId.slice(-8),
    engine: input.engineStatus,
    active: input.active,
    streamAgeMs: input.streamAgeMs,
    turn: input.turn,
  });
}
