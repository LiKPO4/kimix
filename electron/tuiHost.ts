import * as pty from "@lydell/node-pty";
import xtermHeadless from "@xterm/headless";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type {
  ListTuiSessionsResponse,
  SendTuiKeyRequest,
  SendTuiInputRequest,
  StartTuiSessionRequest,
  StartTuiSessionResponse,
  StopTuiSessionRequest,
  ResizeTuiSessionRequest,
  TuiEventPayload,
  TuiApprovalPreviewSnapshot,
  TuiChangeSummarySnapshot,
  TuiPluginSnapshot,
  TuiModelOptionSnapshot,
  TuiScreenSnapshot,
  TuiSessionSummary,
  TuiSemanticEvent,
  TuiToolCallSnapshot,
} from "./types/ipc";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";

const { Terminal } = xtermHeadless as typeof import("@xterm/headless");

type ManagedTuiSession = TuiSessionSummary & {
  child: ChildProcessWithoutNullStreams | null;
  ptyProcess: pty.IPty | null;
  terminal: HeadlessTerminal | null;
  exitTimer: NodeJS.Timeout | null;
  disposables: pty.IDisposable[];
  lastAutoExpandAt: number;
  lastAutoExpandSignature: string;
  wireOffset: number;
  wirePollTimer: NodeJS.Timeout | null;
  seenSemanticKeys: Set<string>;
};

type TuiEventSink = (payload: TuiEventPayload) => void;

const sessions = new Map<string, ManagedTuiSession>();
let eventSink: TuiEventSink | null = null;

const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const ANSI_OSC_PATTERN = /\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g;
const OUTPUT_LIMIT = 120_000;
const WIRE_TAIL_LIMIT = 120_000;
const SEMANTIC_EVENT_TAIL_LIMIT = 240;
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 32;
const KIMI_SESSION_ID_PATTERN = /\b(?:session_|ses_)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

function sanitizeKimiWorkDirName(workDir: string) {
  const base = path.basename(path.resolve(workDir)).toLowerCase() || "default-project";
  return base.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "default-project";
}

function kimiWorkDirBucketName(workDir: string) {
  const resolved = path.resolve(workDir);
  const normalized = resolved.replace(/\\/g, "/");
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 12);
  return `wd_${sanitizeKimiWorkDirName(workDir)}_${hash}`;
}

function kimiCodeHomeDir() {
  return process.env.KIMI_CODE_HOME || path.join(os.homedir(), ".kimi-code");
}

function getKimiWireFile(sessionDir: string) {
  return path.join(sessionDir, "agents", "main", "wire.jsonl");
}

function normalizeOfficialSessionId(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("session_") || trimmed.startsWith("ses_") ? trimmed : `session_${trimmed}`;
}

function extractOfficialSessionIdFromScreen(screen: TuiScreenSnapshot | null) {
  const lines = screen?.lines ?? [];
  for (const line of lines) {
    const normalized = cleanTuiTextLine(line);
    const match = normalized.match(new RegExp(`Session:\\s*(${KIMI_SESSION_ID_PATTERN.source})`, "i"));
    if (match?.[1]) return normalizeOfficialSessionId(match[1]);
  }
  return "";
}

function findKimiSessionDir(workDir: string, officialSessionId?: string | null) {
  const bucketDir = path.join(kimiCodeHomeDir(), "sessions", kimiWorkDirBucketName(workDir));
  if (!fs.existsSync(bucketDir)) return null;
  const bare = officialSessionId?.replace(/^(session_|ses_)/, "") ?? "";
  const names = officialSessionId
    ? [officialSessionId, `session_${bare}`, `ses_${bare}`, bare]
    : [];
  for (const name of names) {
    const candidate = path.join(bucketDir, name);
    if (fs.existsSync(getKimiWireFile(candidate))) return candidate;
  }
  try {
    return fs.readdirSync(bucketDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(bucketDir, entry.name))
      .filter((dir) => fs.existsSync(getKimiWireFile(dir)))
      .map((dir) => ({ dir, mtime: fs.statSync(getKimiWireFile(dir)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)[0]?.dir ?? null;
  } catch {
    return null;
  }
}

function prependProcessPath(dir: string) {
  if (!dir) return;
  const delimiter = process.platform === "win32" ? ";" : ":";
  const current = process.env.PATH ?? "";
  const normalized = path.resolve(dir);
  const hasDir = current
    .split(delimiter)
    .filter(Boolean)
    .some((entry) => path.resolve(entry) === normalized);
  if (!hasDir) {
    process.env.PATH = current ? `${dir}${delimiter}${current}` : dir;
  }
}

function commandHintPaths(command: string) {
  const ext = process.platform === "win32" ? ".exe" : "";
  const fileName = command.endsWith(ext) ? command : `${command}${ext}`;
  const home = os.homedir();
  const hints = [
    path.join(process.env.KIMI_INSTALL_DIR || path.join(home, ".kimi-code"), "bin", fileName),
    path.join(home, ".local", "bin", fileName),
  ];
  if (process.platform === "win32") {
    hints.push(path.join(home, "AppData", "Roaming", "Python", "Scripts", fileName));
  } else {
    hints.push(path.join(home, ".cargo", "bin", fileName));
  }
  return hints;
}

function checkCommand(command: string): Promise<string | null> {
  const lookup = process.platform === "win32" ? "where" : "which";
  return new Promise((resolve) => {
    execFile(lookup, [command], { windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const first = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      resolve(first ?? null);
    });
  });
}

async function resolveCommand(command: string): Promise<string | null> {
  const fromPath = await checkCommand(command);
  if (fromPath) {
    prependProcessPath(path.dirname(fromPath));
    return fromPath;
  }
  const hinted = commandHintPaths(command).find((candidate) => fs.existsSync(candidate));
  if (hinted) {
    prependProcessPath(path.dirname(hinted));
    return hinted;
  }
  return null;
}

async function resolveKimiCommand(): Promise<string | null> {
  const hinted = commandHintPaths("kimi").find((candidate) => fs.existsSync(candidate));
  if (hinted) {
    prependProcessPath(path.dirname(hinted));
    return hinted;
  }
  return resolveCommand("kimi");
}

function stripAnsi(value: string) {
  return value
    .replace(ANSI_OSC_PATTERN, "")
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(/\r/g, "\n");
}

function trimOutput(value: string) {
  if (value.length <= OUTPUT_LIMIT) return value;
  return value.slice(value.length - OUTPUT_LIMIT);
}

function trimWireTail(value: string) {
  if (value.length <= WIRE_TAIL_LIMIT) return value;
  return value.slice(value.length - WIRE_TAIL_LIMIT);
}

function sanitizeTuiUploadFileName(name: string) {
  const parsed = path.parse(name.trim() || "image.png");
  return (parsed.name || "image")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "image";
}

function imageExtensionFromMime(mime: string) {
  if (/jpe?g/i.test(mime)) return ".jpg";
  if (/webp/i.test(mime)) return ".webp";
  if (/gif/i.test(mime)) return ".gif";
  return ".png";
}

async function materializeTuiInputImages(session: ManagedTuiSession, request: SendTuiInputRequest) {
  const images = (request.images ?? []).filter((image) => image.dataUrl.startsWith("data:image/"));
  if (images.length === 0) return request.text;
  const uploadDir = path.join(session.workDir, ".kimix-uploads", "images");
  await fs.promises.mkdir(uploadDir, { recursive: true });
  const imageLines: string[] = [];
  for (const [index, image] of images.entries()) {
    const dataMatch = image.dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
    if (!dataMatch) continue;
    const ext = imageExtensionFromMime(dataMatch[1]);
    const fileName = `${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}-${sanitizeTuiUploadFileName(image.name)}${ext}`;
    const filePath = path.join(uploadDir, fileName);
    await fs.promises.writeFile(filePath, Buffer.from(dataMatch[2], "base64"));
    imageLines.push(`- 图片 ${index + 1}：${filePath}`);
  }
  if (imageLines.length === 0) return request.text;
  return [
    request.text.trim(),
    "",
    "图片附件：",
    ...imageLines,
  ].filter(Boolean).join("\n");
}

function normalizeInput(text: string) {
  return text.replace(/\r?\n/g, "\r\n");
}

function tuiKeySequence(key: SendTuiKeyRequest["key"]) {
  switch (key) {
    case "escape":
      return "\x1b";
    case "enter":
      return "\r";
    case "space":
      return " ";
    case "tab":
      return "\t";
    case "arrowUp":
      return "\x1b[A";
    case "arrowDown":
      return "\x1b[B";
    case "arrowRight":
      return "\x1b[C";
    case "arrowLeft":
      return "\x1b[D";
    case "ctrlO":
      return "\x0f";
    default:
      return "";
  }
}

function createSessionSummary(session: ManagedTuiSession): TuiSessionSummary {
  const { child, ptyProcess, terminal, exitTimer, disposables, wirePollTimer, seenSemanticKeys, ...summary } = session;
  void child;
  void ptyProcess;
  void terminal;
  void exitTimer;
  void disposables;
  void wirePollTimer;
  void seenSemanticKeys;
  return { ...summary };
}

function emitSessionUpdate(session: ManagedTuiSession, kind: TuiEventPayload["kind"], chunk?: string, message?: string, semanticEvents?: TuiSemanticEvent[]) {
  if (!eventSink) return;
  eventSink({
    sessionId: session.sessionId,
    kind,
    session: createSessionSummary(session),
    chunk,
    message,
    semanticEvents,
  });
}

function updateSession(session: ManagedTuiSession, patch: Partial<ManagedTuiSession>, kind: TuiEventPayload["kind"] = "status", chunk?: string, message?: string, semanticEvents?: TuiSemanticEvent[]) {
  Object.assign(session, patch, { updatedAt: Date.now() });
  emitSessionUpdate(session, kind, chunk, message, semanticEvents);
}

function appendOutput(session: ManagedTuiSession, chunk: string) {
  session.rawOutput = trimOutput(session.rawOutput + chunk);
  session.output = trimOutput(session.output + stripAnsi(chunk));
  session.terminal?.write(chunk, () => {
    session.screen = createScreenSnapshot(session.terminal, session.workDir);
    syncTuiWireSession(session);
    readTuiWireEvents(session);
    maybeAutoExpandCollapsedTuiBlock(session);
    updateSession(session, {}, "screen");
  });
  updateSession(session, {}, "output", chunk);
}

function syncTuiWireSession(session: ManagedTuiSession) {
  const officialSessionId = extractOfficialSessionIdFromScreen(session.screen);
  if (officialSessionId && officialSessionId !== session.officialSessionId) {
    session.officialSessionId = officialSessionId;
    session.sessionDir = null;
    session.wireFile = null;
    session.wireOffset = 0;
    session.rawWireTail = "";
    session.semanticEventsTail = [];
    session.seenSemanticKeys.clear();
  }
  if (session.wireFile && fs.existsSync(session.wireFile)) return;
  const sessionDir = findKimiSessionDir(session.workDir, session.officialSessionId);
  if (!sessionDir) return;
  session.sessionDir = sessionDir;
  session.wireFile = getKimiWireFile(sessionDir);
  session.wireOffset = 0;
  session.seenSemanticKeys.clear();
}

function semanticKey(event: TuiSemanticEvent) {
  return [
    event.type,
    event.turnId ?? "",
    event.toolCallId ?? "",
    event.time ?? "",
    JSON.stringify(event.payload ?? {}),
  ].join("|");
}

function readTuiWireEvents(session: ManagedTuiSession) {
  if (!session.wireFile || !fs.existsSync(session.wireFile)) return;
  try {
    const content = fs.readFileSync(session.wireFile, "utf8");
    if (content.length < session.wireOffset) {
      session.wireOffset = 0;
      session.seenSemanticKeys.clear();
    }
    const chunk = content.slice(session.wireOffset);
    session.wireOffset = content.length;
    if (chunk.trim()) {
      session.rawWireTail = trimWireTail(`${session.rawWireTail ?? ""}${chunk}`);
    }
    const semanticEvents = chunk
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap(parseTuiWireRecord)
      .filter((event) => {
        if (typeof event.time === "number" && event.time < session.startedAt - 5000) return false;
        const key = semanticKey(event);
        if (session.seenSemanticKeys.has(key)) return false;
        session.seenSemanticKeys.add(key);
        return true;
      });
    if (semanticEvents.length > 0) {
      session.semanticEventsTail = [
        ...(session.semanticEventsTail ?? []),
        ...semanticEvents,
      ].slice(-SEMANTIC_EVENT_TAIL_LIMIT);
      updateSession(session, {}, "semantic", undefined, undefined, semanticEvents);
    }
  } catch {
    // Keep screen mirroring alive even if the side-channel is briefly unreadable.
  }
}

function parseTuiWireRecord(line: string): TuiSemanticEvent[] {
  try {
    const record = JSON.parse(line) as Record<string, unknown>;
    const time = typeof record.time === "number" ? record.time : Date.now();
    if (record.type === "turn.prompt") {
      return [{ type: "TurnBegin", payload: { user_input: record.input }, time }];
    }
    if (record.type === "turn.cancel") {
      return [{ type: "TurnCancel", payload: {}, time }];
    }
    if (record.type !== "context.append_loop_event" || !record.event || typeof record.event !== "object") {
      return [];
    }
    const event = record.event as Record<string, unknown>;
    const eventTime = typeof event.time === "number" ? event.time : time;
    const turnId = typeof event.turnId === "string" ? event.turnId : undefined;
    if (event.type === "content.part" && event.part && typeof event.part === "object") {
      return [{ type: "ContentPart", payload: event.part as Record<string, unknown>, time: eventTime, turnId }];
    }
    if (event.type === "tool.call") {
      const args = event.args && typeof event.args === "object" ? event.args : {};
      const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : typeof event.uuid === "string" ? event.uuid : randomUUID();
      const name = typeof event.name === "string" ? event.name : "unknown";
      return [{
        type: "ToolCall",
        payload: {
          id: toolCallId,
          function: {
            name,
            arguments: JSON.stringify(args),
          },
        },
        time: eventTime,
        turnId,
        toolCallId,
      }];
    }
    if (event.type === "tool.result") {
      const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : typeof event.parentUuid === "string" ? event.parentUuid : "";
      const result = event.result && typeof event.result === "object" ? event.result as Record<string, unknown> : {};
      return [{
        type: "ToolResult",
        payload: {
          tool_call_id: toolCallId,
          return_value: {
            output: result.output ?? result,
          },
        },
        time: eventTime,
        turnId,
        toolCallId,
      }];
    }
    if (event.type === "step.end") {
      const finishReason = typeof event.finishReason === "string" ? event.finishReason : "";
      if (finishReason !== "end_turn") return [];
      return [{ type: "TurnEnd", payload: { finish_reason: finishReason }, time: eventTime, turnId }];
    }
    return [];
  } catch {
    return [];
  }
}

function startWirePolling(session: ManagedTuiSession) {
  if (session.wirePollTimer) return;
  session.wirePollTimer = setInterval(() => {
    syncTuiWireSession(session);
    readTuiWireEvents(session);
  }, 350);
}

function maybeAutoExpandCollapsedTuiBlock(session: ManagedTuiSession) {
  const lines = session.screen?.lines ?? [];
  const hintLine = lines.map(cleanTuiTextLine).find(isTuiCollapsedHintLine);
  if (!hintLine) return;
  const now = Date.now();
  const signature = hintLine;
  if (session.lastAutoExpandSignature === signature) return;
  if (now - session.lastAutoExpandAt < 2500) return;
  session.lastAutoExpandSignature = signature;
  session.lastAutoExpandAt = now;
  try {
    if (session.ptyProcess) {
      session.ptyProcess.write("\x0f");
    } else if (session.child) {
      session.child.stdin.write("\x0f");
    }
  } catch {}
}

function createScreenSnapshot(terminal: HeadlessTerminal | null, workDir = ""): TuiScreenSnapshot | null {
  if (!terminal) return null;
  const buffer = terminal.buffer.active;
  const lines = Array.from({ length: terminal.rows }, (_, index) => {
    const line = buffer.getLine(buffer.viewportY + index);
    return line?.translateToString(false).slice(0, terminal.cols) ?? "";
  });
  const semanticText = extractSemanticText(lines);
  const rawVisibleText = extractVisibleAnswerText(lines, true);
  const approvalText = detectApprovalText(rawVisibleText);
  const approvalPreview = approvalText ? extractTuiApprovalPreview(lines, workDir) : null;
  const changeSummaries = extractTuiChangeSummaries(lines);
  const changeSummary = changeSummaries[0] ?? null;
  const toolCalls = extractTuiToolCalls(lines);
  const answerText = approvalText ? "" : semanticText.answerText;
  const activity = detectTuiActivity(lines, answerText, Boolean(approvalText));
  const questionRequest = !approvalText && activity.isInputIdle ? extractTuiQuestionRequest(answerText) : null;
  const permissionMode = extractTuiPermissionMode(lines);
  const modelName = extractTuiModelName(lines);
  const models = extractTuiModelOptions(lines);
  const plugins = extractTuiPlugins(lines);
  const menuVisible = models.length > 0 || plugins.length > 0 || isTuiMenuScreen(lines);
  const safeAnswerText = menuVisible ? "" : answerText;
  const safeThinkingText = menuVisible ? "" : semanticText.thinkingText;
  return {
    cols: terminal.cols,
    rows: terminal.rows,
    cursorX: buffer.cursorX,
    cursorY: buffer.cursorY,
    viewportY: buffer.viewportY,
    baseY: buffer.baseY,
    lines,
    assistantText: approvalText ? "" : safeAnswerText || semanticText.latestBlockText,
    answerText: safeAnswerText,
    thinkingText: safeThinkingText,
    approvalText,
    approvalPreview,
    changeSummary,
    changeSummaries,
    toolCalls,
    questionRequest,
    permissionMode,
    modelName,
    models,
    plugins,
    isBusy: activity.isBusy,
    isAwaitingApproval: activity.isAwaitingApproval,
    isInputIdle: activity.isInputIdle,
    updatedAt: Date.now(),
  };
}

function extractTuiModelName(lines: string[]) {
  for (const line of [...lines].reverse()) {
    const normalized = cleanTuiTextLine(line);
    const welcomeMatch = normalized.match(/^Model:\s*(.+)$/i);
    if (welcomeMatch?.[1]?.trim()) return welcomeMatch[1].trim();
    const statusMatch = normalized.match(/(?:^|\s)(Kimi-[\w.-]+)\s+thinking\b/);
    if (statusMatch?.[1]?.trim()) return statusMatch[1].trim();
  }
  return null;
}

function parseTuiModelOption(line: string): TuiModelOptionSnapshot | null {
  const selected = /^❯\s*/.test(line);
  const normalized = line.replace(/^❯\s*/, "").replace(/\s*←\s*current\s*$/i, "").trim();
  const current = /←\s*current\s*$/i.test(line);
  const match = normalized.match(/^(.+?)\s+\(([^)]+)\)\s*$/);
  if (!match) return null;
  const name = match[1].trim();
  if (!name || /^Thinking$/i.test(name) || /^\[?\s*(On|Off)\s*\]?$/i.test(name)) return null;
  const provider = match?.[2]?.trim() || null;
  return {
    id: `${name}:${provider ?? ""}`.toLowerCase(),
    name,
    provider,
    selected,
    current,
  };
}

function extractTuiModelOptions(lines: string[]): TuiModelOptionSnapshot[] {
  const normalized = lines.map(cleanTuiTextLine);
  const titleIndex = normalized.findIndex((line) => /^Select a model\b/i.test(line));
  if (titleIndex < 0) return [];
  const models: TuiModelOptionSnapshot[] = [];
  const seen = new Set<string>();
  for (let index = titleIndex + 1; index < normalized.length; index += 1) {
    const line = normalized[index];
    if (/^Thinking$/i.test(line) || /^[-─]+$/.test(line)) break;
    const parsed = parseTuiModelOption(line);
    if (!parsed) continue;
    if (seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    models.push(parsed);
  }
  return models;
}

function extractTuiPermissionMode(lines: string[]) {
  for (const line of [...lines].reverse()) {
    const normalized = cleanTuiTextLine(line);
    if (/^Auto mode:\s+ON\b/i.test(normalized) || /^auto\s+Kimi-[\w.-]+\s+thinking\b/i.test(normalized)) {
      return "auto" as const;
    }
    if (/^Auto mode:\s+OFF\b/i.test(normalized)) {
      return "manual" as const;
    }
    const match = normalized.match(/\/auto:\s+(auto|manual)\s+permission mode/i);
    if (match?.[1]) return match[1].toLowerCase() === "auto" ? "auto" as const : "manual" as const;
  }
  return null;
}

function normalizeTuiPluginStatus(value: string): TuiPluginSnapshot["status"] {
  const normalized = value.toLowerCase();
  if (normalized === "enabled") return "enabled";
  if (normalized === "installed") return "installed";
  if (normalized === "disabled") return "disabled";
  if (normalized === "available") return "available";
  return "unknown";
}

function extractTuiPluginTrustLevel(detail: string): TuiPluginSnapshot["trustLevel"] {
  if (/\bofficial\b|official plugin/i.test(detail)) return "official";
  if (/\bcurated\b|curated plugin/i.test(detail)) return "curated";
  if (/\bthird[-\s]?party\b/i.test(detail)) return "third-party";
  return "unknown";
}

function parseTuiPluginDetail(detail: string) {
  const id = detail.match(/(?:^|·)\s*id\s+([^\s·]+)/i)?.[1]?.trim() ?? "";
  const skillsCount = detail.match(/(?:^|·)\s*(\d+)\s+skills?\b/i)?.[1];
  const mcpSummary = detail.match(/(?:^|·)\s*(MCP\s+\d+\/\d+)\b/i)?.[1]?.trim() ?? null;
  const version = detail.match(/(?:^|·)\s*v([0-9][\w.-]*)\b/i)?.[1]?.trim() ?? null;
  return {
    id,
    skillsCount: skillsCount ? Number(skillsCount) : null,
    mcpSummary,
    version,
    trustLevel: extractTuiPluginTrustLevel(detail),
  };
}

function parseTuiPluginTitle(line: string) {
  const selected = /^❯\s*/.test(line);
  const normalized = line.replace(/^❯\s*/, "").trim();
  const match = normalized.match(/^(.+?)\s{2,}(enabled|installed|disabled|available)\s*$/i);
  if (!match) return null;
  return {
    name: match[1]?.trim() ?? "",
    status: normalizeTuiPluginStatus(match[2] ?? ""),
    selected,
  };
}

function extractTuiPlugins(lines: string[]): TuiPluginSnapshot[] {
  const normalized = lines.map(cleanTuiTextLine);
  const isPluginScreen = normalized.some((line) => /^(Plugins|Official plugins)$/i.test(line));
  if (!isPluginScreen) return [];
  const source: TuiPluginSnapshot["source"] = normalized.some((line) => /^Marketplace\s+\(\d+\)/i.test(line)) ? "marketplace" : "installed";
  const plugins: TuiPluginSnapshot[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < normalized.length; index += 1) {
    const parsedTitle = parseTuiPluginTitle(normalized[index]);
    if (!parsedTitle?.name) continue;
    const detail = normalized[index + 1] ?? "";
    const parsedDetail = parseTuiPluginDetail(detail);
    const id = parsedDetail.id || parsedTitle.name.toLowerCase().replace(/\s+/g, "-");
    const key = `${source}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    plugins.push({
      id,
      name: parsedTitle.name,
      status: parsedTitle.status,
      trustLevel: parsedDetail.trustLevel,
      skillsCount: parsedDetail.skillsCount,
      mcpSummary: parsedDetail.mcpSummary,
      version: parsedDetail.version,
      source,
      selected: parsedTitle.selected,
    });
  }
  return plugins;
}

function stableTuiQuestionId(questionText: string) {
  let hash = 0;
  for (let index = 0; index < questionText.length; index += 1) {
    hash = ((hash << 5) - hash + questionText.charCodeAt(index)) | 0;
  }
  return `question:${Math.abs(hash).toString(36)}`;
}

function extractTuiQuestionRequest(answerText: string) {
  const text = answerText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!text || text.length > 700) return null;
  const lines = text.split(/\r?\n/);
  if (lines.length > 5) return null;
  const lastLine = lines[lines.length - 1] ?? "";
  if (!/[?？][）)\]"'”’】》」』]*\s*$/.test(lastLine)) return null;
  if (!/(请.*(告诉|提供|选择|确认|补充)|你想|你希望|是否|哪个|哪种|哪类|要不要|需要.*吗|可以.*吗)/i.test(text)) return null;
  return {
    questionId: stableTuiQuestionId(text),
    questionText: text,
  };
}

function cleanTuiTextLine(line: string) {
  return line
    .replace(/\ufe0f/g, "")
    .replace(/[ \t]+$/g, "")
    .trim();
}

function isTuiChromeLine(line: string) {
  return (
    !line ||
    /^╭[─╮]+$/.test(line) ||
    /^╰[─╯]+$/.test(line) ||
    /^│\s*$/.test(line) ||
    /^│\s*>/.test(line) ||
    /^│\s*(Directory|Session|Model|Version):\s/i.test(line) ||
    /^Kimi-[\w.-]+/.test(line) ||
    /^context:\s/i.test(line) ||
    /^MCP server\b/i.test(line) ||
    /^Welcome to Kimi Code!?/i.test(line) ||
    /^(Directory|Session|Model|Version):\s/i.test(line) ||
    isTuiMoonSpinnerLine(line) ||
    isTuiMenuChromeLine(line) ||
    /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+(thinking|working)/i.test(line)
  );
}

function isTuiCollapsedHintLine(line: string) {
  return /^(?:\.{3}|…)\s*\(\d+\s+more lines,\s*ctrl\+o to expand\)$/i.test(line);
}

function isTuiMenuScreen(lines: string[]) {
  const normalized = lines.map(cleanTuiTextLine);
  return normalized.some((line) => /^Select a model\b/i.test(line))
    || normalized.some((line) => /^(Installed plugins|Official plugins|Marketplace|Plugins)\b/i.test(line));
}

function isTuiMenuChromeLine(line: string) {
  return (
    /^Select a model\b/i.test(line) ||
    /^(Installed plugins|Official plugins|Marketplace|Plugins)\b/i.test(line) ||
    /^Search:\s*/i.test(line) ||
    /^No matches\b/i.test(line) ||
    /\bEnter apply\b/i.test(line) ||
    /\bEsc cancel\b/i.test(line) ||
    /[↑↓←→].*(model|thinking|plugin|plugins)/i.test(line) ||
    /^[-─]{8,}$/.test(line)
  );
}

function isTuiMoonSpinnerLine(line: string) {
  const chars = Array.from(line.trim());
  return chars.length > 0 && chars.every((char) => "🌑🌒🌓🌔🌕🌖🌗🌘".includes(char));
}

function isTuiSpinnerLine(line: string) {
  return (
    isTuiMoonSpinnerLine(line) ||
    /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+(thinking|working)/i.test(line) ||
    /\b(thinking|working)\.\.\./i.test(line)
  );
}

function detectTuiActivity(lines: string[], answerText: string, isAwaitingApproval: boolean) {
  const normalized = lines.map(cleanTuiTextLine);
  const hasPromptBox = normalized.some((line) => /^│\s*>/.test(line));
  const hasSpinner = normalized.some(isTuiSpinnerLine);
  const isBusy = isAwaitingApproval || hasSpinner || (!answerText && normalized.some((line) => /^Kimi-[\w.-]+\s+thinking\b/.test(line)));
  return {
    isBusy,
    isAwaitingApproval,
    isInputIdle: Boolean(answerText && hasPromptBox && !hasSpinner),
  };
}

function compactTextBlock(block: string[]) {
  return block
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function parseTuiBashTitle(line: string) {
  const match = line.match(/^([●✗])\s+(Using|Used)\s+Bash\s+\((.*)\)\s*$/i);
  if (!match) return null;
  const command = match[3]?.trim() ?? "";
  return {
    status: match[1] === "✗" ? "error" as const : match[2]?.toLowerCase() === "used" ? "success" as const : "running" as const,
    command,
  };
}

function stableTuiToolCallId(toolName: string, command: string) {
  const source = `${toolName}:${command}`;
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) - hash + source.charCodeAt(index)) | 0;
  }
  return `tui:${toolName}:${Math.abs(hash).toString(36)}`;
}

function extractTuiToolCalls(lines: string[]): TuiToolCallSnapshot[] {
  const normalized = lines.map(cleanTuiTextLine);
  const calls: TuiToolCallSnapshot[] = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const parsed = parseTuiBashTitle(normalized[index]);
    if (!parsed) continue;
    let command = parsed.command;
    const outputLines: string[] = [];
    for (let nextIndex = index + 1; nextIndex < normalized.length; nextIndex += 1) {
      const line = normalized[nextIndex];
      if (isTuiBlockTitle(line) || line.startsWith("✨") || /^╭|^╰|^─/.test(line) || /^│\s*>/.test(line)) break;
      if (!line || isTuiChromeLine(line) || isTuiSpinnerLine(line)) continue;
      if (line.startsWith("$ ")) {
        command = line.slice(2).trim() || command;
        continue;
      }
      if (/^Approved:\s/i.test(line) || /^▶\s*Run this command\?/i.test(line) || /^\d+\.\s*(Approve|Reject)/i.test(line) || /^cwd:\s/i.test(line)) continue;
      outputLines.push(line);
    }
    calls.push({
      toolCallId: stableTuiToolCallId("Bash", command),
      toolName: "Bash",
      command,
      status: parsed.status,
      output: outputLines.join("\n").trim(),
    });
  }
  return calls;
}

function extractNumberedPreviewLines(lines: string[], startIndex: number) {
  const textLines: string[] = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = cleanTuiTextLine(lines[index]);
    if (!line || line.startsWith("▶") || /^\d+\.\s*(Approve|Reject)/i.test(line) || /^↑\/↓/.test(line) || /^─/.test(line)) break;
    const match = line.match(/^\d+\s{1,}(.*)$/);
    if (match) {
      textLines.push(match[1] ?? "");
    }
  }
  return textLines.join("\n");
}

function resolveTuiFilePath(filePath: string, workDir: string) {
  if (!filePath) return "";
  return path.isAbsolute(filePath) ? filePath : path.resolve(workDir || process.cwd(), filePath);
}

function readTuiPreviewOldText(filePath: string, workDir: string) {
  const resolved = resolveTuiFilePath(filePath, workDir);
  if (!resolved || !fs.existsSync(resolved)) return "";
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size > 200_000) return "";
    return fs.readFileSync(resolved, "utf8");
  } catch {
    return "";
  }
}

function extractTuiApprovalPreview(lines: string[], workDir: string): TuiApprovalPreviewSnapshot | null {
  const editPreview = extractTuiEditApprovalPreview(lines);
  if (editPreview) return editPreview;

  const normalized = lines.map(cleanTuiTextLine);
  const writeTitleIndex = normalized.findIndex((line) => /^●\s+Using\s+Write\s+\(/i.test(line));
  const writePromptIndex = normalized.findIndex((line) => /^▶\s*Write this file\?/i.test(line));
  if (writeTitleIndex < 0 || writePromptIndex < 0) return null;
  const pathIndex = normalized.findIndex((line, index) => (
    index > writePromptIndex &&
    /^(?:[A-Za-z]:[\\/]|\/|\.{1,2}[\\/])/.test(line)
  ));
  if (pathIndex < 0) return null;
  const filePath = normalized[pathIndex];
  const newText = extractNumberedPreviewLines(lines, pathIndex + 1);
  if (!filePath || !newText) return null;
  const oldText = readTuiPreviewOldText(filePath, workDir);
  return {
    kind: "write",
    toolName: "Write",
    filePath,
    oldText,
    newText,
  };
}

function extractTuiEditApprovalPreview(lines: string[]): TuiApprovalPreviewSnapshot | null {
  const normalized = lines.map(cleanTuiTextLine);
  const editTitleIndex = normalized.findIndex((line) => /^●\s+Using\s+Edit\s+\(/i.test(line));
  const editPromptIndex = normalized.findIndex((line) => /^▶\s*Apply these edits\?/i.test(line));
  if (editTitleIndex < 0 || editPromptIndex < 0) return null;
  const summaryIndex = normalized.findIndex((line, index) => (
    index > editPromptIndex &&
    /^[+-]\d+\s+-\d+\s+/.test(line)
  ));
  if (summaryIndex < 0) return null;
  const filePath = normalized[summaryIndex].replace(/^[+-]\d+\s+-\d+\s+/, "").trim();
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (let index = summaryIndex + 1; index < normalized.length; index += 1) {
    const line = normalized[index];
    if (!line || line.startsWith("▶") || /^\d+\.\s*(Approve|Reject)/i.test(line) || /^↑\/↓/.test(line) || /^─/.test(line)) break;
    const removed = line.match(/^\d+\s+-\s?(.*)$/);
    if (removed) {
      oldLines.push(removed[1] ?? "");
      continue;
    }
    const added = line.match(/^\d+\s+\+\s?(.*)$/);
    if (added) {
      newLines.push(added[1] ?? "");
    }
  }
  if (!filePath || (oldLines.length === 0 && newLines.length === 0)) return null;
  return {
    kind: "edit",
    toolName: "Edit",
    filePath,
    oldText: oldLines.join("\n"),
    newText: newLines.join("\n"),
  };
}

function parseTuiWriteTitle(line: string) {
  const match = line.match(/^●\s+(Using|Used)\s+Write\s+\((.*)\)(?:\s+·\s+(\d+)\s+lines?)?\s*$/i);
  if (!match) return null;
  return {
    status: match[1]?.toLowerCase() === "used" ? "success" as const : "running" as const,
    filePath: match[2]?.trim() ?? "",
    lineCount: Number(match[3] ?? 0),
  };
}

function parseTuiEditTitle(line: string) {
  const match = line.match(/^●\s+(Using|Used)\s+Edit\s+\((.*)\)(?:\s+·\s+\+(\d+)\s+-(\d+))?\s*$/i);
  if (!match) return null;
  return {
    status: match[1]?.toLowerCase() === "used" ? "success" as const : "running" as const,
    filePath: match[2]?.trim() ?? "",
    additions: Number(match[3] ?? 0),
    deletions: Number(match[4] ?? 0),
  };
}

function parseTuiReadTitle(line: string) {
  return /^●\s+(Using|Used)\s+Read\s+\(/i.test(line);
}

function isTuiToolBlockTitle(line: string) {
  return Boolean(parseTuiBashTitle(line) || parseTuiWriteTitle(line) || parseTuiEditTitle(line) || parseTuiReadTitle(line));
}

function isTuiBlockTitle(line: string) {
  return /^[●✗]\s+/.test(line);
}

function extractTuiChangeSummaries(lines: string[]): TuiChangeSummarySnapshot[] {
  const normalized = lines.map(cleanTuiTextLine);
  const summaries: TuiChangeSummarySnapshot[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < normalized.length; index += 1) {
    const line = normalized[index];
    const write = parseTuiWriteTitle(line);
    if (write?.status === "success" && write.filePath) {
      const summary = {
        kind: "write",
        filePath: write.filePath,
        additions: write.lineCount || 1,
        deletions: 0,
      } satisfies TuiChangeSummarySnapshot;
      const key = `${summary.kind}:${summary.filePath}`;
      if (!seen.has(key)) {
        seen.add(key);
        summaries.push(summary);
      }
      continue;
    }
    const edit = parseTuiEditTitle(line);
    if (!edit || edit.status !== "success" || !edit.filePath) continue;
    const summaryLine = normalized.slice(index + 1).find((candidate) => /^[+-]\d+\s+-\d+\s+/.test(candidate));
    const counts = summaryLine?.match(/^\+(\d+)\s+-(\d+)\s+/);
    const summary = {
      kind: "edit",
      filePath: edit.filePath,
      additions: edit.additions || Number(counts?.[1] ?? 0),
      deletions: edit.deletions || Number(counts?.[2] ?? 0),
    } satisfies TuiChangeSummarySnapshot;
    const key = `${summary.kind}:${summary.filePath}`;
    if (!seen.has(key)) {
      seen.add(key);
      summaries.push(summary);
    }
  }
  return summaries;
}

function extractSemanticText(lines: string[]) {
  const normalized = lines.map(cleanTuiTextLine);
  const lastUserIndex = normalized.reduce((result, line, index) => line.startsWith("✨") ? index : result, -1);
  const searchLines = normalized.slice(Math.max(0, lastUserIndex + 1));
  const hasPromptBox = searchLines.some((line) => /^│\s*>/.test(line));
  const blocks: string[][] = [];
  let current: string[] | null = null;

  for (const line of searchLines) {
    if (isTuiBlockTitle(line)) {
      if (isTuiToolBlockTitle(line)) {
        current = null;
        continue;
      }
      const title = line.replace(/^[●✗]\s*/, "").trim();
      if (isTuiChromeLine(title)) {
        current = null;
        continue;
      }
      current = [title];
      blocks.push(current);
      continue;
    }
    if (!current) continue;
    if (isTuiChromeLine(line) || line.startsWith("✨")) continue;
    current.push(line);
  }

  const textBlocks = blocks.map(compactTextBlock).filter(Boolean);
  const shouldPromoteSingleBlockToAnswer = hasPromptBox && textBlocks.length === 1 && !isLikelyTuiThinkingText(textBlocks[0]);
  const answerText = textBlocks.length >= 2 || shouldPromoteSingleBlockToAnswer ? textBlocks[textBlocks.length - 1] : "";
  const thinkingText = textBlocks.length >= 2
    ? textBlocks.slice(0, -1).join("\n\n").trim()
    : shouldPromoteSingleBlockToAnswer
      ? ""
      : textBlocks.join("\n\n").trim();
  return {
    latestBlockText: textBlocks[textBlocks.length - 1] ?? "",
    answerText,
    thinkingText,
  };
}

function isLikelyTuiThinkingText(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return (
    /\b(the user|user said|user asks?|the request|system-reminder|guidelines?)\b/i.test(normalized) ||
    /\b(I should|I need to|I can|I will|I'll|doesn't involve|do not need|no need to)\b/i.test(normalized) ||
    /(用户.*(说|要求|问|想|只是|希望)|这是.*(简单|问候|指令)|我(应该|需要|可以|将|要)|不需要.*(工具|技能)|根据.*(规则|要求)|AGENTS\.md|技能|system-reminder)/i.test(normalized)
  );
}

function extractVisibleAnswerText(lines: string[], includeToolBlocks = false) {
  const normalized = lines.map(cleanTuiTextLine);
  const promptIndex = normalized.findIndex((line) => /^│\s*>/.test(line));
  const visibleBeforePrompt = normalized.slice(0, promptIndex >= 0 ? promptIndex : normalized.length);
  const visibleLines: string[] = [];
  let inToolBlock = false;
  for (const line of visibleBeforePrompt) {
    if (isTuiBlockTitle(line)) {
      inToolBlock = isTuiToolBlockTitle(line);
      if (inToolBlock && !includeToolBlocks) continue;
    } else if (inToolBlock && !includeToolBlocks) {
      continue;
    }
    if (isTuiChromeLine(line) || line.startsWith("✨")) continue;
    visibleLines.push(line);
  }
  return visibleLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function detectApprovalText(visibleText: string) {
  if (!/Run this command\?|Approve once|Reject with feedback/i.test(visibleText)) return "";
  return visibleText;
}

function disposePtyListeners(session: ManagedTuiSession) {
  session.disposables.forEach((disposable) => {
    try { disposable.dispose(); } catch {}
  });
  session.disposables = [];
}

function cleanSession(session: ManagedTuiSession) {
  if (session.exitTimer) {
    clearTimeout(session.exitTimer);
    session.exitTimer = null;
  }
  if (session.wirePollTimer) {
    clearInterval(session.wirePollTimer);
    session.wirePollTimer = null;
  }
  disposePtyListeners(session);
  if (session.ptyProcess) {
    try { session.ptyProcess.kill(); } catch {}
    session.ptyProcess = null;
  }
  if (session.terminal) {
    try { session.terminal.dispose(); } catch {}
    session.terminal = null;
  }
  if (session.child) {
    session.child.removeAllListeners();
    if (!session.child.killed) {
      try { session.child.kill(); } catch {}
    }
    session.child = null;
  }
}

async function forceKillProcess(pid: number) {
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve());
    });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}

function createSession(sessionId: string, workDir: string, command: string, args: string[]): ManagedTuiSession {
  const terminal = new Terminal({
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    scrollback: 5000,
    allowProposedApi: true,
    convertEol: false,
  });
  return {
    sessionId,
    workDir,
    command,
    args,
    backend: "pty",
    status: "starting",
    pid: null,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    exitCode: null,
    signal: null,
    interrupted: false,
    error: null,
    rawOutput: "",
    output: "",
    screen: createScreenSnapshot(terminal, workDir),
    officialSessionId: null,
    sessionDir: null,
    wireFile: null,
    rawWireTail: "",
    semanticEventsTail: [],
    child: null,
    ptyProcess: null,
    terminal,
    exitTimer: null,
    disposables: [],
    lastAutoExpandAt: 0,
    lastAutoExpandSignature: "",
    wireOffset: 0,
    wirePollTimer: null,
    seenSemanticKeys: new Set<string>(),
  };
}

function startPtyProcess(session: ManagedTuiSession) {
  const env = {
    ...process.env,
    TERM: process.env.TERM || "xterm-256color",
    COLORTERM: process.env.COLORTERM || "truecolor",
  };
  const ptyProcess = pty.spawn(session.command, session.args, {
    name: "xterm-256color",
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    cwd: session.workDir,
    env,
    useConpty: process.platform === "win32" ? true : undefined,
  });
  session.ptyProcess = ptyProcess;
  session.backend = "pty";
  session.pid = ptyProcess.pid;
  session.disposables.push(
    ptyProcess.onData((chunk) => appendOutput(session, chunk)),
    ptyProcess.onExit(({ exitCode, signal }) => {
      updateSession(session, {
        status: "exited",
        exitCode,
        signal: signal ?? null,
      }, "exit", undefined, `PTY 已退出，退出码 ${exitCode}`);
      if (session.wirePollTimer) {
        clearInterval(session.wirePollTimer);
        session.wirePollTimer = null;
      }
      session.ptyProcess = null;
      if (session.exitTimer) {
        clearTimeout(session.exitTimer);
        session.exitTimer = null;
      }
    }),
  );
  startWirePolling(session);
  updateSession(session, { status: "running", error: null }, "started", undefined, `已启动 PTY：${session.command}`);
}

function startPipeFallback(session: ManagedTuiSession, reason?: string) {
  const child = spawn(session.command, session.args, {
    cwd: session.workDir,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      TERM: process.env.TERM || "xterm-256color",
      COLORTERM: process.env.COLORTERM || "truecolor",
    },
  }) as ChildProcessWithoutNullStreams;
  session.child = child;
  session.backend = "pipe";
  session.pid = child.pid ?? null;
  if (reason) appendOutput(session, `[kimix] PTY 启动失败，已降级 pipe fallback：${reason}\n`);

  child.stdout.on("data", (data: Buffer | string) => {
    appendOutput(session, typeof data === "string" ? data : data.toString("utf8"));
  });
  child.stderr.on("data", (data: Buffer | string) => {
    appendOutput(session, typeof data === "string" ? data : data.toString("utf8"));
  });
  child.on("error", (error) => {
    updateSession(session, {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    }, "error", undefined, "pipe fallback 启动失败");
  });
  child.on("exit", (code, signal) => {
    updateSession(session, {
      status: "exited",
      exitCode: code ?? null,
      signal: signal ?? null,
    }, "exit", undefined, `pipe fallback 已退出${typeof code === "number" ? `，退出码 ${code}` : ""}`);
    if (session.wirePollTimer) {
      clearInterval(session.wirePollTimer);
      session.wirePollTimer = null;
    }
    session.child = null;
    if (session.exitTimer) {
      clearTimeout(session.exitTimer);
      session.exitTimer = null;
    }
  });
  startWirePolling(session);
  updateSession(session, { status: "running", error: null }, "started", undefined, `已启动 pipe fallback：${session.command}`);
}

async function stopPipeSession(session: ManagedTuiSession, force = false) {
  if (!session.child || session.status === "exited") return;
  updateSession(session, { status: "stopping", interrupted: true, error: null });
  const child = session.child;
  const pid = child.pid;
  const timeoutMs = force ? 500 : 1200;
  if (!child.killed) {
    try { child.kill("SIGINT"); } catch {}
  }
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(session.exitTimer as NodeJS.Timeout);
      session.exitTimer = null;
      child.off("exit", onExit);
      resolve();
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      updateSession(session, {
        status: "exited",
        exitCode: code ?? null,
        signal: signal ?? null,
      }, "exit", undefined, `pipe fallback 已退出${typeof code === "number" ? `，退出码 ${code}` : ""}`);
      if (session.wirePollTimer) {
        clearInterval(session.wirePollTimer);
        session.wirePollTimer = null;
      }
      session.child = null;
      finish();
    };
    child.once("exit", onExit);
    session.exitTimer = setTimeout(() => {
      if (settled) return;
      if (!session.child || session.status === "exited") {
        finish();
        return;
      }
      if (!pid) {
        finish();
        return;
      }
      void forceKillProcess(pid).finally(() => {
        if (session.child && session.status !== "exited") {
          updateSession(session, {
            status: "exited",
            exitCode: session.exitCode ?? null,
            signal: session.signal ?? null,
          }, "exit", undefined, "pipe fallback 已停止");
          if (session.wirePollTimer) {
            clearInterval(session.wirePollTimer);
            session.wirePollTimer = null;
          }
          session.child = null;
        }
        finish();
      });
    }, timeoutMs);
  });
}

async function stopPtySession(session: ManagedTuiSession, force = false) {
  if (!session.ptyProcess || session.status === "exited") return;
  updateSession(session, { status: "stopping", interrupted: true, error: null });
  const activePty = session.ptyProcess;
  const pid = activePty.pid;
  const timeoutMs = force ? 500 : 1200;
  try {
    activePty.write("\x03");
  } catch {}
  await new Promise<void>((resolve) => {
    let settled = false;
    let waitExit: pty.IDisposable | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(session.exitTimer as NodeJS.Timeout);
      session.exitTimer = null;
      try { waitExit?.dispose(); } catch {}
      resolve();
    };
    waitExit = activePty.onExit(() => finish());
    session.exitTimer = setTimeout(() => {
      if (settled) return;
      try { activePty.kill(); } catch {}
      const forceKill = pid ? forceKillProcess(pid) : Promise.resolve();
      void forceKill.finally(() => {
        if (session.ptyProcess && session.status !== "exited") {
          updateSession(session, {
            status: "exited",
            exitCode: session.exitCode ?? null,
            signal: session.signal ?? null,
          }, "exit", undefined, "PTY 已停止");
          if (session.wirePollTimer) {
            clearInterval(session.wirePollTimer);
            session.wirePollTimer = null;
          }
          session.ptyProcess = null;
        }
        finish();
      });
    }, timeoutMs);
  });
}

async function stopSessionProcess(session: ManagedTuiSession, force = false) {
  if (session.ptyProcess) {
    await stopPtySession(session, force);
    return;
  }
  await stopPipeSession(session, force);
}

export function setTuiEventSink(sink: TuiEventSink | null) {
  eventSink = sink;
}

export function listTuiSessions(): ListTuiSessionsResponse {
  return {
    success: true,
    data: Array.from(sessions.values()).map(createSessionSummary),
  };
}

export async function startTuiSession(request?: StartTuiSessionRequest): Promise<StartTuiSessionResponse> {
  const command = (request?.command?.trim() || await resolveKimiCommand() || "kimi").trim();
  if (!command) {
    return { success: false, error: "未找到 kimi 命令" };
  }
  const workDir = request?.workDir?.trim() || process.cwd();
  const args = Array.isArray(request?.args) ? request.args.filter((item) => typeof item === "string" && item.trim().length > 0) : [];
  const session = createSession(randomUUID(), workDir, command, args);
  sessions.set(session.sessionId, session);
  emitSessionUpdate(session, "status", undefined, "正在启动 hidden PTY");

  try {
    startPtyProcess(session);
    return { success: true, data: createSessionSummary(session) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    try {
      startPipeFallback(session, reason);
      return { success: true, data: createSessionSummary(session) };
    } catch (fallbackError) {
      sessions.delete(session.sessionId);
      return {
        success: false,
        error: fallbackError instanceof Error ? `${reason}；fallback 失败：${fallbackError.message}` : `${reason}；fallback 失败：${String(fallbackError)}`,
      };
    }
  }
}

export async function sendTuiInput(request: SendTuiInputRequest) {
  const session = sessions.get(request.sessionId);
  if (!session) {
    return { success: false, error: "未找到 TUI 会话" };
  }
  if (session.status !== "running") {
    return { success: false, error: "TUI 进程未运行" };
  }
  try {
    const payload = normalizeInput(await materializeTuiInputImages(session, request));
    if (session.ptyProcess) {
      session.ptyProcess.write(`${payload}\r`);
    } else if (session.child) {
      session.child.stdin.write(`${payload}\r\n`);
    } else {
      return { success: false, error: "TUI 进程未运行" };
    }
    updateSession(session, {}, "status", undefined, `已发送输入到 ${session.backend}`);
    return { success: true, data: undefined };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function sendTuiKey(request: SendTuiKeyRequest) {
  const session = sessions.get(request.sessionId);
  if (!session) {
    return { success: false, error: "未找到 TUI 会话" };
  }
  if (session.status !== "running") {
    return { success: false, error: "TUI 进程未运行" };
  }
  const sequence = tuiKeySequence(request.key);
  if (!sequence) {
    return { success: false, error: "不支持的 TUI 按键" };
  }
  try {
    if (session.ptyProcess) {
      session.ptyProcess.write(sequence);
    } else if (session.child) {
      session.child.stdin.write(sequence);
    } else {
      return { success: false, error: "TUI 进程未运行" };
    }
    updateSession(session, {}, "status", undefined, `已发送按键 ${request.key} 到 ${session.backend}`);
    return { success: true, data: undefined };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function stopTuiSession(request: StopTuiSessionRequest) {
  const session = sessions.get(request.sessionId);
  if (!session) {
    return { success: false, error: "未找到 TUI 会话" };
  }
  try {
    await stopSessionProcess(session);
    return { success: true, data: undefined };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function resizeTuiSession(request: ResizeTuiSessionRequest) {
  const session = sessions.get(request.sessionId);
  if (!session) {
    return { success: false, error: "未找到 TUI 会话" };
  }
  const cols = Math.max(20, Math.min(240, Math.floor(request.cols)));
  const rows = Math.max(8, Math.min(120, Math.floor(request.rows)));
  if (!Number.isFinite(cols) || !Number.isFinite(rows)) {
    return { success: false, error: "Invalid terminal size" };
  }
  try {
    if (session.ptyProcess) {
      session.ptyProcess.resize(cols, rows);
      session.terminal?.resize(cols, rows);
      session.screen = createScreenSnapshot(session.terminal, session.workDir);
      updateSession(session, {}, "status");
      return { success: true, data: undefined };
    }
    return { success: false, error: "当前 TUI 后端不支持 resize" };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function closeAllTuiSessions() {
  await Promise.all(Array.from(sessions.values()).map(async (session) => {
    try {
      await stopSessionProcess(session, true);
    } catch {}
    cleanSession(session);
  }));
}
