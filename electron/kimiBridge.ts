import {
  createSession,
  createKimiPaths,
  parseEventPayload,
  type Session,
  type SessionInfo,
  type Turn,
  type StreamEvent,
  type ApprovalResponse,
  type ContentPart,
  type SlashCommandInfo,
  ProtocolClient,
  parseRequestPayload,
} from "@moonshot-ai/kimi-agent-sdk";
import type { BrowserWindow } from "electron";
import { exec, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { TextDecoder } from "node:util";
import * as projectService from "./projectService";
import * as settingsService from "./settingsService";
import type { HookRule, HookRunLogEntry } from "./types/ipc";

type PromptModeSession = {
  sessionId: string;
  cliSessionId?: string;
  workDir: string;
  model?: string;
  thinking: boolean;
  yoloMode: boolean;
  autoMode: boolean;
  planMode: boolean;
  skillsDir?: string;
  agentFile?: string;
  continueNextPrompt: boolean;
};

const activeSessions = new Map<string, Session>();
const activeTurns = new Map<string, Turn>();
const promptModeSessions = new Map<string, PromptModeSession>();
const activePromptProcesses = new Map<string, ChildProcessWithoutNullStreams>();
const sendingLocks = new Set<string>();
const interruptedTurns = new WeakSet<Turn>();
const HIDDEN_SESSION_PREFIXES = ["kimix-hidden-hooks-"];
const CLARIFICATION_ORIGINAL_MARKER = "\n\n用户原始需求：\n";
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function defaultKimiCodeShareDir() {
  return path.join(os.homedir(), ".kimi-code");
}

function legacyKimiShareDir() {
  return path.join(os.homedir(), ".kimi");
}

function resolveKimiShareDir() {
  if (process.env.KIMI_SHARE_DIR) return process.env.KIMI_SHARE_DIR;
  const current = defaultKimiCodeShareDir();
  const legacy = legacyKimiShareDir();
  if (fs.existsSync(current)) return current;
  if (fs.existsSync(legacy)) return legacy;
  return current;
}

function candidateKimiShareDirs() {
  const dirs = process.env.KIMI_SHARE_DIR
    ? [process.env.KIMI_SHARE_DIR]
    : [defaultKimiCodeShareDir(), legacyKimiShareDir()];
  return Array.from(new Set(dirs));
}

function collectKimiModelEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key, value]) => (
      key.startsWith("KIMI_MODEL_") && typeof value === "string"
    ))
  ) as Record<string, string>;
}

let kimiWireSupportPromise: Promise<boolean> | null = null;

function supportsKimiWireMode() {
  if (kimiWireSupportPromise) return kimiWireSupportPromise;
  kimiWireSupportPromise = new Promise((resolve) => {
    const child = spawn("kimi", ["--wire"], { cwd: os.homedir(), windowsHide: true });
    let output = "";
    const done = (supported: boolean) => {
      clearTimeout(timer);
      child.removeAllListeners();
      if (!child.killed) {
        try { child.kill(); } catch {}
      }
      resolve(supported);
    };
    const timer = setTimeout(() => done(true), 1200);
    child.stdout.on("data", (data) => { output += data.toString(); });
    child.stderr.on("data", (data) => { output += data.toString(); });
    child.on("error", () => done(false));
    child.on("exit", () => {
      done(!/unknown option ['"]?--wire/i.test(output));
    });
  });
  return kimiWireSupportPromise;
}

function contentToPromptText(content: string | ContentPart[]) {
  if (typeof content === "string") return content;
  return content
    .map((part) => {
      if (part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string") return part.text;
      if (part && typeof part === "object" && "type" in part && part.type === "image_url") return "[图片]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function readSessionMetadata(sessionDir: string): { title?: string } | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(sessionDir, "metadata.json"), "utf-8")) as { title?: string };
  } catch {
    return null;
  }
}

function stripFileTags(text: string) {
  return text
    .replace(/<uploaded_files>[\s\S]*?<\/uploaded_files>\s*/g, "")
    .replace(/<document[^>]*>[\s\S]*?<\/document>\s*/g, "")
    .replace(/<image[^>]*>[\s\S]*?<\/image>\s*/g, "")
    .trim();
}

function extractUserText(userInput: unknown) {
  if (typeof userInput === "string") return stripFileTags(userInput);
  if (Array.isArray(userInput)) {
    return stripFileTags(userInput
      .filter((part): part is { type: string; text: string } => (
        part && typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
      ))
      .map((part) => part.text)
      .join("\n"));
  }
  return "";
}

async function getFirstUserMessage(wireFile: string) {
  try {
    const stream = fs.createReadStream(wireFile, { encoding: "utf-8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as { message?: { type?: string; payload?: { user_input?: unknown } } };
        if (record.message?.type !== "TurnBegin") continue;
        const text = extractUserText(record.message.payload?.user_input);
        if (text) {
          rl.close();
          stream.destroy();
          return text;
        }
      } catch {
        continue;
      }
    }
  } catch {
    // Ignore unreadable history files.
  }
  return "";
}

function sanitizeKimiWorkDirName(workDir: string) {
  const base = path.basename(path.resolve(workDir)).toLowerCase() || "default-project";
  return base.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "default-project";
}

function kimiWorkDirBucketNames(workDir: string) {
  const resolved = path.resolve(workDir);
  const normalized = resolved.replace(/\\/g, "/");
  const variants = Array.from(new Set([normalized, resolved]));
  return variants.map((value) => {
    const hash = createHash("sha256").update(value).digest("hex").slice(0, 12);
    return `wd_${sanitizeKimiWorkDirName(workDir)}_${hash}`;
  });
}

function kimiSessionDirNames(sessionId: string) {
  const bare = sessionId.replace(/^(session_|ses_)/, "");
  return Array.from(new Set([sessionId, `session_${bare}`, `ses_${bare}`, bare]));
}

function getNewKimiWireFile(sessionDir: string) {
  return path.join(sessionDir, "agents", "main", "wire.jsonl");
}

async function findKimiCodeSessionDir(shareDir: string, workDir: string, sessionId: string): Promise<string | null> {
  const sessionsRoot = path.join(shareDir, "sessions");
  const names = kimiSessionDirNames(sessionId);
  const buckets = kimiWorkDirBucketNames(workDir);

  for (const bucket of buckets) {
    for (const name of names) {
      const candidate = path.join(sessionsRoot, bucket, name);
      if (fs.existsSync(getNewKimiWireFile(candidate))) return candidate;
    }
  }

  const bucketEntries = await fsp.readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  for (const bucket of bucketEntries) {
    if (!bucket.isDirectory() || !buckets.includes(bucket.name)) continue;
    const bucketDir = path.join(sessionsRoot, bucket.name);
    const sessionEntries = await fsp.readdir(bucketDir, { withFileTypes: true }).catch(() => []);
    for (const entry of sessionEntries) {
      if (!entry.isDirectory() || !names.includes(entry.name)) continue;
      const candidate = path.join(bucketDir, entry.name);
      if (fs.existsSync(getNewKimiWireFile(candidate))) return candidate;
    }
  }

  return null;
}

async function getKimiCodeSessionDirs(shareDir: string, workDir: string) {
  const sessionsRoot = path.join(shareDir, "sessions");
  const buckets = new Set(kimiWorkDirBucketNames(workDir));
  const bucketEntries = await fsp.readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const dirs: string[] = [];
  for (const bucket of bucketEntries) {
    if (!bucket.isDirectory() || !buckets.has(bucket.name)) continue;
    const bucketDir = path.join(sessionsRoot, bucket.name);
    const sessionEntries = await fsp.readdir(bucketDir, { withFileTypes: true }).catch(() => []);
    for (const entry of sessionEntries) {
      if (!entry.isDirectory() || !/^(session_|ses_)?[0-9a-f-]{36}$/i.test(entry.name)) continue;
      const sessionDir = path.join(bucketDir, entry.name);
      if (fs.existsSync(getNewKimiWireFile(sessionDir))) dirs.push(sessionDir);
    }
  }
  return dirs;
}

function readKimiCodeSessionMetadata(sessionDir: string): { title?: string; updatedAt?: string; lastPrompt?: string } | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(sessionDir, "state.json"), "utf-8")) as { title?: string; updatedAt?: string; lastPrompt?: string };
  } catch {
    return null;
  }
}

function parseKimiCodeRecord(record: Record<string, unknown>): StreamEvent | null {
  if (record.message && typeof record.message === "object") {
    const message = record.message as { type?: unknown; payload?: unknown };
    if (typeof message.type !== "string") return null;
    const result = parseEventPayload(message.type, message.payload);
    return result.ok ? result.value : null;
  }

  if (record.type === "turn.prompt") {
    return {
      type: "TurnBegin",
      payload: { user_input: record.input },
      time: record.time,
    } as unknown as StreamEvent;
  }

  if (record.type === "context.append_loop_event" && record.event && typeof record.event === "object") {
    const event = record.event as { type?: unknown; part?: unknown; time?: unknown };
    if (event.type === "content.part" && event.part && typeof event.part === "object") {
      return {
        type: "ContentPart",
        payload: event.part,
        time: event.time ?? record.time,
      } as unknown as StreamEvent;
    }
    if (event.type === "step.end") {
      return {
        type: "TurnEnd",
        payload: {},
        time: event.time ?? record.time,
      } as unknown as StreamEvent;
    }
  }

  return null;
}

async function parseKimiCodeWireEvents(wireFile: string): Promise<StreamEvent[]> {
  if (!fs.existsSync(wireFile)) return [];
  const events: StreamEvent[] = [];
  const stream = fs.createReadStream(wireFile, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      const event = parseKimiCodeRecord(record);
      if (event) events.push(event);
    } catch {
      continue;
    }
  }
  return events;
}

async function readLatestKimiCodeTurnThinking(shareDir: string, workDir: string, sessionId: string): Promise<StreamEvent[]> {
  const sessionDir = await findKimiCodeSessionDir(shareDir, workDir, sessionId);
  if (!sessionDir) return [];
  const wireFile = getNewKimiWireFile(sessionDir);
  const records: Array<{ turnId: string; event: StreamEvent }> = [];
  const stream = fs.createReadStream(wireFile, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as { type?: unknown; event?: { type?: unknown; turnId?: unknown; part?: { type?: unknown; think?: unknown }; time?: unknown }; time?: unknown };
      const loopEvent = record.type === "context.append_loop_event" ? record.event : null;
      if (loopEvent?.type !== "content.part" || loopEvent.part?.type !== "think" || typeof loopEvent.part.think !== "string") continue;
      records.push({
        turnId: typeof loopEvent.turnId === "string" ? loopEvent.turnId : "",
        event: {
          type: "ContentPart",
          payload: loopEvent.part,
          time: loopEvent.time ?? record.time,
        } as unknown as StreamEvent,
      });
    } catch {
      continue;
    }
  }
  const latestTurnId = [...records].reverse().find((record) => record.turnId)?.turnId ?? records.at(-1)?.turnId;
  return latestTurnId ? records.filter((record) => record.turnId === latestTurnId).map((record) => record.event) : [];
}

async function listSessionsFromShareDir(shareDir: string, workDir: string): Promise<SessionInfo[]> {
  const sessionsDir = createKimiPaths(shareDir).sessionsDir(workDir);
  const newSessionDirs = await getKimiCodeSessionDirs(shareDir, workDir);
  const entries = await fsp.readdir(sessionsDir, { withFileTypes: true }).catch(() => []);
  const sessions: SessionInfo[] = [];
  for (const sessionDir of newSessionDirs) {
    const wireFile = getNewKimiWireFile(sessionDir);
    try {
      const stat = await fsp.stat(wireFile);
      if (stat.size === 0) continue;
      const metadata = readKimiCodeSessionMetadata(sessionDir);
      const brief = metadata?.title || metadata?.lastPrompt || await getFirstUserMessage(wireFile);
      if (!brief) continue;
      sessions.push({
        id: path.basename(sessionDir),
        workDir,
        contextFile: wireFile,
        updatedAt: metadata?.updatedAt ? Date.parse(metadata.updatedAt) || stat.mtimeMs : stat.mtimeMs,
        brief,
      });
    } catch {
      continue;
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !UUID_REGEX.test(entry.name)) continue;
    const sessionDir = path.join(sessionsDir, entry.name);
    const wireFile = path.join(sessionDir, "wire.jsonl");
    if (!fs.existsSync(wireFile)) continue;
    try {
      const stat = await fsp.stat(wireFile);
      if (stat.size === 0) continue;
      const metadata = readSessionMetadata(sessionDir);
      const brief = metadata?.title || await getFirstUserMessage(wireFile);
      if (!brief) continue;
      sessions.push({ id: entry.name, workDir, contextFile: wireFile, updatedAt: stat.mtimeMs, brief });
    } catch {
      continue;
    }
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function parseSessionEventsFromShareDir(shareDir: string, workDir: string, sessionId: string): Promise<StreamEvent[]> {
  const newSessionDir = await findKimiCodeSessionDir(shareDir, workDir, sessionId);
  if (newSessionDir) {
    const events = await parseKimiCodeWireEvents(getNewKimiWireFile(newSessionDir));
    if (events.length > 0) return events;
  }
  const wireFile = path.join(createKimiPaths(shareDir).sessionDir(workDir, sessionId), "wire.jsonl");
  if (!fs.existsSync(wireFile)) return [];
  const events: StreamEvent[] = [];
  const stream = fs.createReadStream(wireFile, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as { message?: { type?: string; payload?: unknown } };
      if (!record.message?.type) continue;
      const result = parseEventPayload(record.message.type, record.message.payload);
      if (result.ok) events.push(result.value);
    } catch {
      continue;
    }
  }
  return events;
}

type PatchableProtocolClient = typeof ProtocolClient & {
  prototype: {
    __kimixQuestionRequestPatch?: boolean;
    __kimixKimiCodeCliCompatPatch?: boolean;
    __kimixAutoModePatch?: boolean;
    __kimixAddDirPatch?: boolean;
    buildArgs?: (options: { environmentVariables?: Record<string, string>; workDir?: string }) => string[];
    handleServerRequest?: (requestId: string, params: unknown) => void;
    pushEvent?: (event: unknown) => void;
    emitParseError?: (code: string, message: string, raw?: string) => void;
  };
};

function installKimiCodeCliCompatPatch() {
  const proto = (ProtocolClient as PatchableProtocolClient).prototype;
  if (proto.__kimixKimiCodeCliCompatPatch || typeof proto.buildArgs !== "function") return;
  const original = proto.buildArgs;
  proto.buildArgs = function patchedBuildArgs(this: PatchableProtocolClient["prototype"], options: { environmentVariables?: Record<string, string>; workDir?: string }) {
    const args = original.call(this, options);
    const workDirIndex = args.indexOf("--work-dir");
    if (workDirIndex >= 0) {
      args.splice(workDirIndex, args[workDirIndex + 1] ? 2 : 1);
    }
    return args;
  };
  proto.__kimixKimiCodeCliCompatPatch = true;
}

installKimiCodeCliCompatPatch();

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

function installAutoModePatch() {
  const proto = (ProtocolClient as PatchableProtocolClient).prototype;
  if (proto.__kimixAutoModePatch || typeof proto.buildArgs !== "function") return;
  const original = proto.buildArgs;
  proto.buildArgs = function patchedBuildArgs(this: PatchableProtocolClient["prototype"], options: { environmentVariables?: Record<string, string> }) {
    const args = original.call(this, options);
    if (options.environmentVariables?.KIMIX_KIMI_AUTO === "1" && !args.includes("--auto")) {
      const wireIndex = args.indexOf("--wire");
      if (wireIndex >= 0) {
        args.splice(wireIndex, 0, "--auto");
      } else {
        args.push("--auto");
      }
    }
    return args;
  };
  proto.__kimixAutoModePatch = true;
}

installAutoModePatch();

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
  autoMode?: boolean;
  planMode?: boolean;
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

  const env: Record<string, string> = collectKimiModelEnv();
  if (options.autoMode) {
    env.KIMIX_KIMI_AUTO = "1";
  }
  const dirs = Array.from(new Set((options.additionalWorkDirs ?? settingsService.loadSettings().additionalWorkDirs ?? [])
    .map((dir) => dir.trim())
    .filter(Boolean)));
  if (dirs.length > 0) {
    env.KIMIX_KIMI_ADD_DIRS = dirs.join("\n");
  }

  if (!(await supportsKimiWireMode())) {
    const sessionId = options.sessionId || `kimix-prompt-${randomUUID()}`;
    promptModeSessions.set(sessionId, {
      sessionId,
      workDir: options.workDir,
      model: options.model,
      thinking: options.thinking ?? true,
      yoloMode: options.yoloMode ?? false,
      autoMode: options.autoMode ?? false,
      planMode: options.planMode ?? false,
      skillsDir: options.skillsDir,
      agentFile: options.agentFile,
      continueNextPrompt: Boolean(options.sessionId),
    });
    return { sessionId, workDir: options.workDir, slashCommands: [] };
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
    shareDir: resolveKimiShareDir(),
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
  const promptSession = promptModeSessions.get(sessionId);
  if (promptSession) {
    promptSession.planMode = enabled;
    return enabled;
  }
  const session = activeSessions.get(sessionId);
  if (!session) throw new Error("Session not found");
  return session.setPlanMode(enabled);
}

export async function getSlashCommands(sessionId: string): Promise<SlashCommandInfo[]> {
  if (promptModeSessions.has(sessionId)) return [];
  const session = activeSessions.get(sessionId);
  if (!session) throw new Error("Session not found");
  await warmSessionMetadata(session);
  return session.slashCommands;
}

function buildPromptModeArgs(session: PromptModeSession, prompt: string) {
  const args: string[] = [];
  if (session.model) args.push("--model", session.model);
  if (session.skillsDir) args.push("--skills-dir", session.skillsDir);
  if (session.continueNextPrompt) args.push("--continue");
  args.push("--output-format", "stream-json", "-p", prompt);
  return args;
}

function runPromptModeTurn(sessionId: string, session: PromptModeSession, prompt: string, gitBaseline: TurnGitBaseline) {
  const child = spawn("kimi", buildPromptModeArgs(session, prompt), {
    cwd: session.workDir,
    windowsHide: true,
    env: {
      ...process.env,
    },
  });
  activePromptProcesses.set(sessionId, child);
  sendStatus(sessionId, "running");

  let stdoutBuffer = "";
  let stderr = "";
  let assistantText = "";
  const flushLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const record = JSON.parse(trimmed) as { role?: string; content?: string; type?: string; session_id?: string };
      if (record.role === "assistant" && typeof record.content === "string") {
        assistantText += record.content;
        sendEvent(sessionId, { type: "ContentPart", payload: { type: "text", text: record.content } });
      }
      if (record.role === "meta" && record.type === "session.resume_hint" && typeof record.session_id === "string") {
        session.cliSessionId = record.session_id;
        session.continueNextPrompt = true;
      }
    } catch {
      assistantText += `${trimmed}\n`;
      sendEvent(sessionId, { type: "ContentPart", payload: { type: "text", text: `${trimmed}\n` } });
    }
  };

  child.stdout.on("data", (data) => {
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) flushLine(line);
  });
  child.stderr.on("data", (data) => {
    stderr += data.toString();
  });
  child.on("error", (err) => {
    activePromptProcesses.delete(sessionId);
    sendingLocks.delete(sessionId);
    sendEvent(sessionId, { type: "Error", payload: { message: err.message } });
    sendStatus(sessionId, "error");
  });
  child.on("exit", (code) => {
    void (async () => {
      activePromptProcesses.delete(sessionId);
      try {
        if (stdoutBuffer.trim()) flushLine(stdoutBuffer);
        if (code === 0) {
          if (session.cliSessionId) {
            try {
              const thinkingEvents = await readLatestKimiCodeTurnThinking(resolveKimiShareDir(), session.workDir, session.cliSessionId);
              for (const event of thinkingEvents) sendEvent(sessionId, event);
            } catch (err) {
              console.error(`[kimiBridge] Failed to replay prompt-mode thinking for ${session.cliSessionId}:`, err);
            }
          }
          sendEvent(sessionId, { type: "TurnEnd", payload: {} });
          sendEvent(sessionId, { type: "TurnResult", payload: { result: assistantText } });
          void emitTurnChanges(sessionId, session.workDir, gitBaseline).finally(() => {
            sendStatus(sessionId, "completed");
            sendingLocks.delete(sessionId);
          });
          return;
        }
        const message = (stderr || `CLI exited with code ${code ?? "unknown"}`).trim();
        sendEvent(sessionId, { type: "Error", payload: { message } });
        sendStatus(sessionId, "error");
      } finally {
        if (code !== 0) sendingLocks.delete(sessionId);
      }
    })();
  });
}

export async function sendPrompt(sessionId: string, content: string | ContentPart[], options?: { thinking?: boolean; yoloMode?: boolean; autoMode?: boolean; planMode?: boolean }) {
  if (sendingLocks.has(sessionId)) throw new Error("Turn already in progress");
  sendingLocks.add(sessionId);

  const promptSession = promptModeSessions.get(sessionId);
  if (promptSession) {
    if (typeof options?.thinking === "boolean") promptSession.thinking = options.thinking;
    if (typeof options?.yoloMode === "boolean") promptSession.yoloMode = options.yoloMode;
    if (typeof options?.autoMode === "boolean") promptSession.autoMode = options.autoMode;
    if (typeof options?.planMode === "boolean") promptSession.planMode = options.planMode;
    let promptContent = content;
    try {
      promptContent = await applyPromptSubmitHooks(sessionId, content, promptSession.workDir);
    } catch (err) {
      sendingLocks.delete(sessionId);
      const message = err instanceof Error ? err.message : String(err);
      try { sendEvent(sessionId, { type: "Error", payload: { message } }); } catch {}
      try { sendStatus(sessionId, "error"); } catch {}
      throw err;
    }
    const promptText = contentToPromptText(promptContent);
    const gitBaseline = await getTurnGitBaseline(promptSession.workDir);
    sendEvent(sessionId, { type: "TurnBegin", payload: { user_input: promptContent } });
    runPromptModeTurn(sessionId, promptSession, promptText, gitBaseline);
    return;
  }

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
  if (typeof options?.autoMode === "boolean") {
    session.env = options.autoMode ? { ...session.env, KIMIX_KIMI_AUTO: "1" } : Object.fromEntries(Object.entries(session.env).filter(([key]) => key !== "KIMIX_KIMI_AUTO"));
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
  const promptProcess = activePromptProcesses.get(sessionId);
  if (promptProcess) {
    activePromptProcesses.delete(sessionId);
    sendingLocks.delete(sessionId);
    try { promptProcess.kill(); } catch {}
    sendStatus(sessionId, "interrupted");
    return;
  }
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
  const promptProcess = activePromptProcesses.get(sessionId);
  if (promptProcess) {
    activePromptProcesses.delete(sessionId);
    try { promptProcess.kill(); } catch {}
  }
  promptModeSessions.delete(sessionId);
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
    shareDir: resolveKimiShareDir(),
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
  const byId = new Map<string, SessionInfo>();
  for (const shareDir of candidateKimiShareDirs()) {
    const sessions = await listSessionsFromShareDir(shareDir, workDir);
    for (const session of sessions) {
      if (HIDDEN_SESSION_PREFIXES.some((prefix) => session.id.startsWith(prefix))) continue;
      const existing = byId.get(session.id);
      if (!existing || session.updatedAt > existing.updatedAt) byId.set(session.id, session);
    }
  }
  return Array.from(byId.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getSessionHistory(workDir: string, sessionId: string) {
  for (const shareDir of candidateKimiShareDirs()) {
    const events = await parseSessionEventsFromShareDir(shareDir, workDir, sessionId);
    if (events.length > 0) return events;
  }
  return [];
}
