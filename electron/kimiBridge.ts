import {
  createSession,
  listSessions,
  parseSessionEvents,
  type Session,
  type Turn,
  type StreamEvent,
  type ApprovalResponse,
  type ContentPart,
  type SlashCommandInfo,
  ProtocolClient,
  parseRequestPayload,
} from "@moonshot-ai/kimi-agent-sdk";
import type { BrowserWindow } from "electron";
import * as projectService from "./projectService";
import * as settingsService from "./settingsService";

const activeSessions = new Map<string, Session>();
const activeTurns = new Map<string, Turn>();
const sendingLocks = new Set<string>();
const interruptedTurns = new WeakSet<Turn>();

type PatchableProtocolClient = typeof ProtocolClient & {
  prototype: {
    __kimixQuestionRequestPatch?: boolean;
    __kimixAfkModePatch?: boolean;
    __kimixAddDirPatch?: boolean;
    buildArgs?: (options: { environmentVariables?: Record<string, string> }) => string[];
    handleServerRequest?: (requestId: string, params: unknown) => void;
    pushEvent?: (event: unknown) => void;
    emitParseError?: (code: string, message: string, raw?: string) => void;
  };
};

function installQuestionRequestPatch() {
  const proto = (ProtocolClient as PatchableProtocolClient).prototype;
  if (proto.__kimixQuestionRequestPatch || typeof proto.handleServerRequest !== "function") return;
  const original = proto.handleServerRequest;
  proto.handleServerRequest = function patchedQuestionRequest(this: PatchableProtocolClient["prototype"], requestId: string, params: unknown) {
    const payload = params && typeof params === "object" ? params as { type?: unknown; payload?: unknown } : {};
    if (payload.type === "QuestionRequest") {
      const parsed = parseRequestPayload("QuestionRequest", payload.payload);
      if (parsed.ok) {
        this.pushEvent?.({
          ...parsed.value,
          payload: {
            ...parsed.value.payload,
            rpc_request_id: requestId,
          },
        });
      } else {
        this.emitParseError?.("UNKNOWN_REQUEST_TYPE", parsed.error);
      }
      return;
    }
    return original.call(this, requestId, params);
  };
  proto.__kimixQuestionRequestPatch = true;
}

installQuestionRequestPatch();

function installAfkModePatch() {
  const proto = (ProtocolClient as PatchableProtocolClient).prototype;
  if (proto.__kimixAfkModePatch || typeof proto.buildArgs !== "function") return;
  const original = proto.buildArgs;
  proto.buildArgs = function patchedBuildArgs(this: PatchableProtocolClient["prototype"], options: { environmentVariables?: Record<string, string> }) {
    const args = original.call(this, options);
    if (options.environmentVariables?.KIMIX_KIMI_AFK === "1" && !args.includes("--afk")) {
      const wireIndex = args.indexOf("--wire");
      if (wireIndex >= 0) {
        args.splice(wireIndex, 0, "--afk");
      } else {
        args.push("--afk");
      }
    }
    return args;
  };
  proto.__kimixAfkModePatch = true;
}

installAfkModePatch();

function installAddDirPatch() {
  const proto = (ProtocolClient as PatchableProtocolClient).prototype;
  if (proto.__kimixAddDirPatch || typeof proto.buildArgs !== "function") return;
  const original = proto.buildArgs;
  proto.buildArgs = function patchedBuildArgs(this: PatchableProtocolClient["prototype"], options: { environmentVariables?: Record<string, string> }) {
    const args = original.call(this, options);
    const raw = options.environmentVariables?.KIMIX_KIMI_ADD_DIRS;
    if (raw) {
      const dirs = Array.from(new Set(raw.split("\n").map((dir) => dir.trim()).filter(Boolean)));
      for (const dir of dirs) {
        if (!args.includes("--add-dir") || !args.includes(dir)) {
          const wireIndex = args.indexOf("--wire");
          if (wireIndex >= 0) {
            args.splice(wireIndex, 0, "--add-dir", dir);
          } else {
            args.push("--add-dir", dir);
          }
        }
      }
    }
    return args;
  };
  proto.__kimixAddDirPatch = true;
}

installAddDirPatch();

type WarmableSession = Session & {
  getClientWithConfigCheck?: () => Promise<unknown>;
};

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

let mainWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow | null) {
  mainWindow = win;
}

function sendEvent(sessionId: string, event: unknown) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send("kimi:event", { sessionId, event });
  } catch (err) {
    console.error("[kimiBridge] sendEvent failed:", err);
  }
}

function sendStatus(sessionId: string, status: "idle" | "running" | "error" | "interrupted" | "completed") {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send("kimi:status", { sessionId, status });
  } catch (err) {
    console.error("[kimiBridge] sendStatus failed:", err);
  }
}

type TurnGitBaseline = {
  files: projectService.GitStatusFile[];
  stats: Record<string, { additions: number; deletions: number }>;
};

async function getTurnGitBaseline(workDir: string): Promise<TurnGitBaseline> {
  try {
    const files = await projectService.getGitStatusFiles(workDir);
    const stats = await projectService.getGitLineStats(workDir, files.map((file) => file.path));
    return { files, stats };
  } catch {
    return { files: [], stats: {} };
  }
}

async function emitTurnChanges(sessionId: string, workDir: string, baseline: TurnGitBaseline) {
  try {
    const currentFiles = await projectService.getGitStatusFiles(workDir);
    if (currentFiles.length === 0) return;
    const currentStats = await projectService.getGitLineStats(workDir, currentFiles.map((file) => file.path));
    const baselineByPath = new Map(baseline.files.map((file) => [file.path, file.status]));
    const changedFiles = currentFiles.filter((file) => {
      const previousStatus = baselineByPath.get(file.path);
      if (previousStatus !== file.status) return true;
      const previousStats = baseline.stats[file.path] ?? { additions: 0, deletions: 0 };
      const nextStats = currentStats[file.path] ?? { additions: 0, deletions: 0 };
      return previousStats.additions !== nextStats.additions || previousStats.deletions !== nextStats.deletions;
    });
    if (changedFiles.length === 0) return;
    sendEvent(sessionId, {
      type: "TurnChanges",
      payload: {
        project_path: workDir,
        files: changedFiles.map((file) => ({
          path: file.path,
          additions: currentStats[file.path]?.additions ?? 0,
          deletions: currentStats[file.path]?.deletions ?? 0,
        })),
      },
    });
  } catch (err) {
    console.error("[kimiBridge] collect turn changes failed:", err);
  }
}

async function warmSessionMetadata(session: Session) {
  const warmable = session as WarmableSession;
  if (typeof warmable.getClientWithConfigCheck !== "function") return;
  try {
    await Promise.race([
      warmable.getClientWithConfigCheck(),
      new Promise((_, reject) => setTimeout(() => reject(new TimeoutError("Kimi session metadata warm timed out")), 5000)),
    ]);
  } catch (err) {
    if (err instanceof TimeoutError) {
      console.warn(`[kimiBridge] Session metadata warm timed out ${session.sessionId}; continuing without blocking startup.`);
      return;
    }
    console.error(`Failed to warm session metadata ${session.sessionId}:`, err);
  }
}

function warmSessionMetadataInBackground(session: Session) {
  void warmSessionMetadata(session);
}

export async function startSession(options: {
  workDir: string;
  sessionId?: string;
  model?: string;
  thinking?: boolean;
  yoloMode?: boolean;
  planMode?: boolean;
  afkMode?: boolean;
  skillsDir?: string;
  agentFile?: string;
  additionalWorkDirs?: string[];
}): Promise<{ sessionId: string; workDir: string; slashCommands: SlashCommandInfo[] }> {
  const existing = options.sessionId ? activeSessions.get(options.sessionId) : undefined;
  if (existing) {
    activeSessions.delete(options.sessionId!);
    try {
      await existing.close();
    } catch (err) {
      console.error(`Failed to close existing session ${options.sessionId}:`, err);
    }
  }

  // Prevent concurrent creation of the same sessionId
  if (options.sessionId && activeSessions.has(options.sessionId)) {
    const session = activeSessions.get(options.sessionId)!;
    warmSessionMetadataInBackground(session);
    return { sessionId: session.sessionId, workDir: session.workDir, slashCommands: session.slashCommands };
  }

  const env: Record<string, string> = {};
  if (options.afkMode) {
    env.KIMIX_KIMI_AFK = "1";
  }
  const dirs = Array.from(new Set((options.additionalWorkDirs ?? settingsService.loadSettings().additionalWorkDirs ?? [])
    .map((dir) => dir.trim())
    .filter(Boolean)));
  if (dirs.length > 0) {
    env.KIMIX_KIMI_ADD_DIRS = dirs.join("\n");
  }

  const session = createSession({
    workDir: options.workDir,
    sessionId: options.sessionId,
    model: options.model,
    thinking: options.thinking ?? true,
    yoloMode: options.yoloMode ?? false,
    executable: "kimi",
    env: Object.keys(env).length > 0 ? env : {},
    agentFile: options.agentFile,
    skillsDir: options.skillsDir,
  });

  activeSessions.set(session.sessionId, session);
  if (typeof options.planMode === "boolean") {
    await warmSessionMetadata(session);
    await session.setPlanMode(options.planMode).catch((err) => {
      console.error(`Failed to set plan mode for session ${session.sessionId}:`, err);
    });
  }
  warmSessionMetadataInBackground(session);
  return { sessionId: session.sessionId, workDir: session.workDir, slashCommands: session.slashCommands };
}

export async function setPlanMode(sessionId: string, enabled: boolean): Promise<boolean> {
  const session = activeSessions.get(sessionId);
  if (!session) throw new Error("Session not found");
  return session.setPlanMode(enabled);
}

export async function getSlashCommands(sessionId: string): Promise<SlashCommandInfo[]> {
  const session = activeSessions.get(sessionId);
  if (!session) throw new Error("Session not found");
  await warmSessionMetadata(session);
  return session.slashCommands;
}

export async function sendPrompt(sessionId: string, content: string | ContentPart[], options?: { thinking?: boolean; yoloMode?: boolean; planMode?: boolean; afkMode?: boolean }) {
  if (sendingLocks.has(sessionId)) throw new Error("Turn already in progress");
  sendingLocks.add(sessionId);

  const session = activeSessions.get(sessionId);
  if (!session) {
    sendingLocks.delete(sessionId);
    throw new Error("Session not found");
  }
  if (typeof options?.thinking === "boolean") {
    session.thinking = options.thinking;
  }
  if (typeof options?.yoloMode === "boolean") {
    session.yoloMode = options.yoloMode;
  }
  if (typeof options?.afkMode === "boolean") {
    session.env = options.afkMode ? { ...session.env, KIMIX_KIMI_AFK: "1" } : Object.fromEntries(Object.entries(session.env).filter(([key]) => key !== "KIMIX_KIMI_AFK"));
  }
  if (typeof options?.planMode === "boolean" && session.planMode !== options.planMode) {
    await warmSessionMetadata(session);
    await session.setPlanMode(options.planMode);
  }
  const gitBaseline = await getTurnGitBaseline(session.workDir);

  let turn: Turn;
  try {
    turn = session.prompt(content);
  } catch (err) {
    sendingLocks.delete(sessionId);
    throw err;
  }

  activeTurns.set(sessionId, turn);
  sendStatus(sessionId, "running");

  void (async () => {
    try {
      for await (const event of turn) {
        if (interruptedTurns.has(turn)) break;
        sendEvent(sessionId, event);
      }

      if (interruptedTurns.has(turn)) {
        sendStatus(sessionId, "interrupted");
        return;
      }
      const result = await turn.result;
      if (interruptedTurns.has(turn)) {
        sendStatus(sessionId, "interrupted");
        return;
      }
      sendEvent(sessionId, { type: "TurnResult", payload: { result } });
      await emitTurnChanges(sessionId, session.workDir, gitBaseline);
      sendStatus(sessionId, "completed");
    } catch (err) {
      if (interruptedTurns.has(turn)) {
        sendStatus(sessionId, "interrupted");
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      try { sendEvent(sessionId, { type: "Error", payload: { message } }); } catch {}
      try { sendStatus(sessionId, "error"); } catch {}
    } finally {
      activeTurns.delete(sessionId);
      sendingLocks.delete(sessionId);
    }
  })();
}

export async function stopTurn(sessionId: string) {
  const turn = activeTurns.get(sessionId);
  if (!turn) {
    sendingLocks.delete(sessionId);
    sendStatus(sessionId, "interrupted");
    return;
  }
  interruptedTurns.add(turn);
  activeTurns.delete(sessionId);
  sendingLocks.delete(sessionId);
  sendStatus(sessionId, "interrupted");
  void turn.interrupt().catch((err) => {
    console.error(`Failed to interrupt turn ${sessionId}:`, err);
  });
}

export async function steerPrompt(sessionId: string, content: string | ContentPart[]) {
  const turn = activeTurns.get(sessionId);
  if (!turn) throw new Error("No active turn");
  await turn.steer(content);
}

export async function approveRequest(
  sessionId: string,
  requestId: string,
  approved: boolean,
  scope?: "once" | "session"
) {
  const turn = activeTurns.get(sessionId);
  if (!turn) throw new Error("No active turn");

  const response: ApprovalResponse = approved
    ? scope === "session"
      ? "approve_for_session"
      : "approve"
    : "reject";

  await turn.approve(requestId, response);
}

export async function respondQuestion(
  sessionId: string,
  rpcRequestId: string,
  questionRequestId: string,
  answers: Record<string, string>
) {
  const turn = activeTurns.get(sessionId);
  if (!turn) throw new Error("No active turn");
  await turn.respondQuestion(rpcRequestId, questionRequestId, answers);
}

export async function closeSession(sessionId: string) {
  const session = activeSessions.get(sessionId);
  if (session) {
    activeSessions.delete(sessionId);
    try {
      await session.close();
    } catch (err) {
      console.error(`Failed to close session ${sessionId}:`, err);
    }
  }
  const turn = activeTurns.get(sessionId);
  if (turn) {
    interruptedTurns.add(turn);
    try { await turn.interrupt(); } catch {}
    activeTurns.delete(sessionId);
    sendingLocks.delete(sessionId);
  }
}

export function getActiveSessionIds(): string[] {
  return Array.from(activeSessions.keys());
}

export async function getSessions(workDir: string) {
  return listSessions(workDir);
}

export async function getSessionHistory(workDir: string, sessionId: string) {
  return parseSessionEvents(workDir, sessionId);
}
