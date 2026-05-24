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
import { exec } from "node:child_process";
import path from "node:path";
import { TextDecoder } from "node:util";
import * as projectService from "./projectService";
import * as settingsService from "./settingsService";
import type { HookRule, HookRunLogEntry } from "./types/ipc";

const activeSessions = new Map<string, Session>();
const activeTurns = new Map<string, Turn>();
const sendingLocks = new Set<string>();
const interruptedTurns = new WeakSet<Turn>();
const HIDDEN_SESSION_PREFIXES = ["kimix-hidden-hooks-"];
const CLARIFICATION_ORIGINAL_MARKER = "\n\n用户原始需求：\n";

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

function isPathInside(parent: string, child: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function hookRuleApplies(rule: HookRule, workDir: string) {
  if (!rule.enabled || !rule.command?.trim()) return false;
  if (rule.scope !== "project") return true;
  return Boolean(rule.projectPath && isPathInside(rule.projectPath, workDir));
}

type KimixHookRequest = {
  event: string;
  target: string;
  input_data: Record<string, unknown>;
};

function runHookCommand(rule: HookRule, request: KimixHookRequest, workDir: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = exec(rule.command!, {
      cwd: workDir,
      windowsHide: true,
      encoding: "buffer",
      timeout: Math.max(1, Math.min(600, rule.timeout ?? 30)) * 1000,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      const code = typeof (error as { code?: unknown } | null)?.code === "number" ? (error as { code: number }).code : 0;
      resolve({ stdout: decodeHookOutput(stdout).trim(), stderr: decodeHookOutput(stderr).trim(), code });
    });
    child.stdin?.end(JSON.stringify({
      hook_event: request.event,
      target: request.target,
      input_data: request.input_data,
    }));
  });
}

function decodeHookOutput(value: string | Buffer) {
  if (typeof value === "string") return value;
  const utf8 = value.toString("utf8");
  if (!utf8.includes("\uFFFD")) return utf8;
  try {
    return new TextDecoder("gb18030").decode(value);
  } catch {
    return utf8;
  }
}

function cleanHookOutput(value: string) {
  return value
    .replace(/\uFFFD/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\?{1,4}\s+(?=[\u3400-\u9fff])/u, ""))
    .join("\n")
    .trim();
}

function getPromptSubmitTarget(content: string | ContentPart[]) {
  const text = typeof content === "string"
    ? content
    : content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  if (!text.startsWith("【Kimix 需求澄清工具：")) return text;
  const markerIndex = text.indexOf(CLARIFICATION_ORIGINAL_MARKER);
  return markerIndex === -1 ? text : text.slice(markerIndex + CLARIFICATION_ORIGINAL_MARKER.length);
}

function appendHookLog(rule: HookRule, request: KimixHookRequest, result: "allow" | "block" | "notify" | "run_command" | "error", message: string) {
  const settings = settingsService.loadSettings();
  const entry: HookRunLogEntry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ruleId: rule.id,
    ruleName: rule.name,
    event: rule.event,
    action: rule.action,
    result,
    message: `${request.target || request.event}: ${message}`.slice(0, 500),
    timestamp: Date.now(),
  };
  settingsService.saveSettings({ hookRunLog: [entry, ...(settings.hookRunLog ?? [])].slice(0, 80) });
}

function matchesHookTarget(rule: HookRule, target: string) {
  const matcher = rule.matcher?.trim();
  if (!matcher || matcher === ".*") return true;
  try {
    return new RegExp(matcher, "i").test(target);
  } catch {
    return target.toLowerCase().includes(matcher.toLowerCase());
  }
}

function emitHookEvent(sessionId: string, type: "HookTriggered" | "HookResolved", payload: Record<string, unknown>) {
  sendEvent(sessionId, { type, payload });
}

function appendPromptSubmitInstructionToText(text: string, context: string) {
  const instruction = `

【Kimix Hooks 上下文】
以下内容由启用的 UserPromptSubmit Hooks 在用户消息提交前产生。
本轮回答必须显式使用这些 Hook 输出；如果 Hook 输出包含当前时间、提醒、约束或要点，请先回答这些内容，再处理用户原始消息。不要忽略本段要求。

${context}
`;
  return `${text}${instruction}`;
}

function withPromptSubmitContext(content: string | ContentPart[], context: string): string | ContentPart[] {
  if (typeof content === "string") return appendPromptSubmitInstructionToText(content, context);
  const firstTextIndex = content.findIndex((part) => part.type === "text");
  if (firstTextIndex === -1) {
    return [{ type: "text", text: appendPromptSubmitInstructionToText("", context).trimEnd() }, ...content];
  }
  return content.map((part, index) => (
    index === firstTextIndex && part.type === "text"
      ? { ...part, text: appendPromptSubmitInstructionToText(part.text, context) }
      : part
  ));
}

async function applyPromptSubmitHooks(sessionId: string, content: string | ContentPart[], workDir: string): Promise<string | ContentPart[]> {
  const target = getPromptSubmitTarget(content);
  const rules = (settingsService.loadSettings().hookRules ?? [])
    .filter((rule) => rule.event === "UserPromptSubmit")
    .filter((rule) => hookRuleApplies(rule, workDir))
    .filter((rule) => matchesHookTarget(rule, target));
  if (rules.length === 0) return content;

  const outputs: string[] = [];
  for (const rule of rules) {
    const startedAt = Date.now();
    let blocked = false;
    const request: KimixHookRequest = {
      event: "UserPromptSubmit",
      target: target.slice(0, 220),
      input_data: {
        prompt: target,
        cwd: workDir,
        hook_event_name: "UserPromptSubmit",
      },
    };
    emitHookEvent(sessionId, "HookTriggered", {
      event: "UserPromptSubmit",
      target: rule.name,
      hook_count: 1,
    });
    try {
      const ranRaw = await runHookCommand(rule, request, workDir);
      const ran = {
        ...ranRaw,
        stdout: cleanHookOutput(ranRaw.stdout),
        stderr: cleanHookOutput(ranRaw.stderr),
      };
      const message = ran.stdout || ran.stderr || rule.reason || rule.name;
      if (rule.action === "block" || ran.code === 2) {
        blocked = true;
        appendHookLog(rule, request, "block", message);
        emitHookEvent(sessionId, "HookResolved", {
          event: "UserPromptSubmit",
          target: rule.name,
          action: "block",
          reason: message,
          duration_ms: Date.now() - startedAt,
        });
        throw new Error(message || "用户输入被 Hook 规则阻断");
      }
      appendHookLog(rule, request, rule.action, message);
      emitHookEvent(sessionId, "HookResolved", {
        event: "UserPromptSubmit",
        target: rule.name,
        action: "allow",
        reason: message,
        duration_ms: Date.now() - startedAt,
      });
      if (ran.stdout) outputs.push(`Hook「${rule.name}」输出：\n${ran.stdout}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (blocked) throw err;
      appendHookLog(rule, request, "error", message);
      emitHookEvent(sessionId, "HookResolved", {
        event: "UserPromptSubmit",
        target: rule.name,
        action: "allow",
        reason: `Hook 执行失败：${message}`,
        duration_ms: Date.now() - startedAt,
      });
    }
  }

  const context = outputs.map((item) => item.trim()).filter(Boolean).join("\n\n");
  return context ? withPromptSubmitContext(content, context) : content;
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
  let promptContent = content;
  try {
    promptContent = await applyPromptSubmitHooks(sessionId, content, session.workDir);
  } catch (err) {
    sendingLocks.delete(sessionId);
    const message = err instanceof Error ? err.message : String(err);
    try { sendEvent(sessionId, { type: "Error", payload: { message } }); } catch {}
    try { sendStatus(sessionId, "error"); } catch {}
    throw err;
  }

  const gitBaseline = await getTurnGitBaseline(session.workDir);

  let turn: Turn;
  try {
    turn = session.prompt(promptContent);
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

export async function runOneShotPrompt(options: {
  workDir: string;
  content: string | ContentPart[];
  model?: string;
  thinking?: boolean;
  yoloMode?: boolean;
  agentFile?: string;
  sessionId?: string;
  timeoutMs?: number;
}): Promise<string> {
  const session = createSession({
    workDir: options.workDir,
    sessionId: options.sessionId,
    model: options.model,
    thinking: options.thinking ?? true,
    yoloMode: options.yoloMode ?? false,
    executable: "kimi",
    agentFile: options.agentFile,
  });
  const turn = session.prompt(options.content);
  const parts: string[] = [];
  const timeoutMs = options.timeoutMs ?? 120000;
  const timeout = setTimeout(() => {
    void turn.interrupt().catch(() => {});
  }, timeoutMs);

  try {
    for await (const event of turn) {
      const source = event && typeof event === "object" && "message" in event && event.message && typeof event.message === "object"
        ? event.message as Record<string, unknown>
        : event as Record<string, unknown>;
      const payload = source.payload && typeof source.payload === "object" ? source.payload as Record<string, unknown> : {};
      if (source.type === "ContentPart" && payload.type === "text" && typeof payload.text === "string") {
        parts.push(payload.text);
      }
    }
    await turn.result;
    return parts.join("").trim();
  } finally {
    clearTimeout(timeout);
    await session.close().catch((err) => {
      console.error(`Failed to close one-shot session ${session.sessionId}:`, err);
    });
  }
}

export function getActiveSessionIds(): string[] {
  return Array.from(activeSessions.keys());
}

export async function getSessions(workDir: string) {
  const sessions = await listSessions(workDir);
  return sessions.filter((session) => !HIDDEN_SESSION_PREFIXES.some((prefix) => session.id.startsWith(prefix)));
}

export async function getSessionHistory(workDir: string, sessionId: string) {
  return parseSessionEvents(workDir, sessionId);
}
