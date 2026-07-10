import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, Notification, session, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import AdmZip from "adm-zip";
import { z } from "zod";
import * as hookRunner from "./hookRunner";
import * as kimiCodeHost from "./kimiCodeHost";
import { loadSessionHistoryWithFallback } from "./sessionHistoryFallback";
import { kimiCodeServerHost } from "./kimiCodeServerHost";
import { listKimiCodeSlashCommands } from "./kimiCodeSlashCommands";
import { deleteKimiThemeSourceFile } from "./kimiThemeFiles";
import * as sessionHistory from "./sessionHistory";
import { formatKimiUsageError, getRecord, parseKimiUsagePayload, parseManagedUsagePayload, stripHtmlForError } from "./kimiUsage";
import {
  installNonVisionFetchInterceptor,
  markModelAsNonVision,
  modelSupportsImages,
} from "./nonVisionFetchInterceptor";
import * as projectService from "./projectService";
import * as settingsService from "./settingsService";
import { prepareSkillDirectoryForKimi, syncAgentSkillDirectories } from "./skillMigration";
import * as longTaskService from "./longTaskService";
import { parseReleaseAtom } from "./releaseFeed";
import type { ExportSessionBackupRequest, ImportSessionBackupRequest, SessionBackupSnapshot, RendererHeartbeatPayload, LoggerWriteRequest, LoggerWriteResponse } from "./types/ipc";

const GITHUB_REPO = "LiKPO4/kimix";
const KIMI_CODE_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
const KIMI_CODE_USAGE_URL = "https://api.kimi.com/coding/v1/usages";
const KIMI_CODE_REFRESH_URL = "https://auth.kimi.com/api/oauth/token";
const KIMI_CODE_INSTALL_BASE_URL = "https://code.kimi.com/kimi-code";
const KIMI_CODE_BINARY_BASE_URL = `${KIMI_CODE_INSTALL_BASE_URL}/binaries`;
const KIMI_CODE_INSTALL_PS1_URL = "https://code.kimi.com/kimi-code/install.ps1";
const KIMI_CODE_INSTALL_SH_URL = "https://code.kimi.com/kimi-code/install.sh";
const DEFAULT_PROJECT_ID = "default-kimi-project";
const DEFAULT_PROJECT_DISPLAY_NAME = "Kimix 默认项目";

const HOOK_EVENTS = ["PreToolUse", "PostToolUse", "PostToolUseFailure", "Notification", "Stop", "StopFailure", "Interrupt", "UserPromptSubmit", "SessionStart", "SessionEnd", "SubagentStart", "SubagentStop", "PreCompact", "PostCompact"] as const;
const HOOK_ACTIONS = ["allow", "block", "notify", "run_command"] as const;
let kimiServerStartupScheduled = false;

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

async function resolveGitBashCommand(): Promise<string | null> {
  if (process.platform !== "win32") return resolveCommand("bash");
  const envShell = process.env.KIMI_SHELL_PATH?.trim();
  if (envShell && fs.existsSync(envShell)) return envShell;
  const fromPath = await checkCommand("bash");
  if (fromPath) return fromPath;
  const candidates = [
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe"),
    path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "usr", "bin", "bash.exe"),
    path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Git", "bin", "bash.exe"),
    path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Git", "usr", "bin", "bash.exe"),
    path.join(os.homedir(), "AppData", "Local", "Programs", "Git", "bin", "bash.exe"),
    path.join(os.homedir(), "AppData", "Local", "Programs", "Git", "usr", "bin", "bash.exe"),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (found) {
    prependProcessPath(path.dirname(found));
    return found;
  }
  return null;
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

function getKimiCodeCommandEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    KIMI_CODE_NO_AUTO_UPDATE: process.env.KIMI_CODE_NO_AUTO_UPDATE || "1",
    KIMI_CLI_NO_AUTO_UPDATE: process.env.KIMI_CLI_NO_AUTO_UPDATE || "1",
  };
}

function redactProxyValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.username || parsed.password) {
      parsed.username = parsed.username ? "***" : "";
      parsed.password = parsed.password ? "***" : "";
    }
    return parsed.toString();
  } catch {
    return trimmed.replace(/\/\/([^/@\s]+)@/g, "//***@").slice(0, 180);
  }
}

function getKimiEnvironmentSummary() {
  const env = getKimiCodeCommandEnv();
  const proxyKeys = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"] as const;
  return {
    kimiCodeHome: env.KIMI_CODE_HOME || resolveKimiShareDir(),
    proxy: proxyKeys.map((key) => ({
      key,
      value: typeof env[key] === "string" && env[key]?.trim() ? redactProxyValue(env[key]!) : "",
      configured: Boolean(typeof env[key] === "string" && env[key]?.trim()),
    })),
  };
}

function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { windowsHide: true, timeout: 5000, maxBuffer: 8 * 1024 * 1024, env: getKimiCodeCommandEnv() }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve((stdout || stderr).trim());
    });
    child.on("error", reject);
  });
}

function runLongCommand(command: string, args: string[], timeoutMs = 10 * 60 * 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, env: getKimiCodeCommandEnv() }, (error, stdout, stderr) => {
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();
      if (error) {
        reject(new Error(output || error.message));
        return;
      }
      resolve(output);
    });
    child.on("error", reject);
  });
}

function extractKimiCliVersion(output: string): string | null {
  const match = output.match(/(?:kimi(?:-code|-cli)?(?:\s+code)?(?:\s+version)?[:,\s]*)?v?([0-9]+(?:\.[0-9]+){1,3})/i);
  return match?.[1] ?? null;
}

function isLegacyKimiCodeInstallation(output: string, kimiPath?: string | null) {
  if (/kimi-cli/i.test(output)) return true;
  if (!kimiPath) return false;
  const normalized = kimiPath.replace(/\\/g, "/").toLowerCase();
  return normalized.includes("/.local/bin/") && !normalized.includes("/.kimi-code/bin/");
}

async function getInstalledKimiCodeInfo() {
  const kimiPath = await resolveKimiCommand();
  if (!kimiPath) {
    return {
      available: false,
      path: undefined,
      version: null,
      output: "",
      isLegacy: false,
    };
  }
  const output = await runCommand(kimiPath, ["--version"]).catch(() => "");
  const version = extractKimiCliVersion(output);
  return {
    available: true,
    path: kimiPath,
    version,
    output,
    isLegacy: isLegacyKimiCodeInstallation(output, kimiPath),
  };
}

async function fetchLatestKimiCodeVersion() {
  const res = await fetch(`${KIMI_CODE_INSTALL_BASE_URL}/latest`, {
    headers: {
      "Accept": "text/plain",
      "User-Agent": "Kimix",
    },
  });
  if (!res.ok) throw new Error(`Kimi Code 安装源返回 ${res.status}`);
  const version = (await res.text()).trim();
  if (!version) throw new Error("Kimi Code 安装源未返回最新可安装版本");
  return version;
}

async function checkKimiCliUpdate() {
  ensureKimiCodeMigratedConfig();
  const [installed, latestVersion] = await Promise.all([
    getInstalledKimiCodeInfo(),
    fetchLatestKimiCodeVersion(),
  ]);
  if (!installed.available) {
    return {
      available: false,
      currentVersion: null,
      latestVersion,
      hasUpdate: true,
      path: undefined,
      message: `未找到 Kimi Code，可安装最新版本 ${latestVersion}`,
    };
  }
  const currentVersion = installed.version;
  const hasUpdate = currentVersion ? isVersionGreater(latestVersion, currentVersion) : false;
  const migrationHint = installed.isLegacy
    ? "检测到旧版 Kimi。更新到 Kimi Code 后，请在终端运行 kimi migrate，并重新登录与授权 MCP。"
    : undefined;
  return {
    available: true,
    currentVersion,
    latestVersion,
    hasUpdate: hasUpdate || installed.isLegacy,
    isLegacy: installed.isLegacy,
    migrationHint,
    path: installed.path,
    message: installed.isLegacy
      ? `检测到旧版 Kimi ${currentVersion ?? ""}，建议升级并迁移到 Kimi Code`
      : hasUpdate
        ? `发现 Kimi Code 新版本 ${latestVersion}`
        : currentVersion
          ? `Kimi Code 已是最新版本 ${currentVersion}`
          : `Kimi Code 已安装，最新可安装版本 ${latestVersion}`,
  };
}

async function updateKimiCli() {
  ensureKimiCodeMigratedConfig();
  const latestVersion = await fetchLatestKimiCodeVersion();
  const before = await getInstalledKimiCodeInfo();
  let output = "";
  let upgradeError = "";
  if (process.platform === "win32" || before.isLegacy || !before.available) {
    try {
      const result = await installKimiCli();
      output = result.output || result.message;
    } catch (err) {
      upgradeError = err instanceof Error ? err.message : String(err);
    }
  } else {
    const npmPath = await resolveCommand(process.platform === "win32" ? "npm.cmd" : "npm");
    if (npmPath) {
      try {
        output = process.platform === "win32"
          ? await runLongCommand("cmd.exe", ["/d", "/s", "/c", `"${npmPath}" install -g @moonshot-ai/kimi-code@latest`])
          : await runLongCommand(npmPath, ["install", "-g", "@moonshot-ai/kimi-code@latest"]);
      } catch (err) {
        upgradeError = err instanceof Error ? err.message : String(err);
      }
    } else {
      try {
        const result = await installKimiCli();
        output = result.output || result.message;
      } catch (err) {
        upgradeError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  const checked = await checkKimiCliUpdate();
  if (!checked.isLegacy && checked.currentVersion && !isVersionGreater(latestVersion, checked.currentVersion)) {
    return {
      ...checked,
      latestVersion,
      hasUpdate: false,
      output: output || upgradeError,
      message: upgradeError
        ? `Kimi Code 已更新到 ${checked.currentVersion}，但安装器提示：${upgradeError}`
        : `Kimi Code 已更新到 ${checked.currentVersion}`,
    };
  }

  throw new Error(upgradeError || (checked.isLegacy
    ? "安装器执行后仍检测到旧版 Kimi，请确认新版安装目录已加入 PATH，或重启系统后再检查"
    : `Kimi Code 更新后仍未达到最新版本 ${latestVersion}`));
}

async function installKimiCli() {
  ensureKimiCodeMigratedConfig();
  if (process.platform === "win32") {
    const result = await installKimiCodeWindows();
    const kimiPath = result.binaryPath || await resolveKimiCommand();
    if (!kimiPath) throw new Error("安装完成后仍未找到 kimi 命令，请重新打开 Kimix 后再试");
    const version = await runCommand(kimiPath, ["--version"]).catch(() => result.output);
    return { path: kimiPath, output: version, message: "Kimi Code 安装完成" };
  }

  const shellPath = await resolveCommand("bash");
  if (!shellPath) throw new Error("未找到 bash，无法执行 Kimi Code 安装脚本");
  const output = await runLongCommand(shellPath, ["-lc", `curl -LsSf ${KIMI_CODE_INSTALL_SH_URL} | bash`]);
  const kimiPath = await resolveKimiCommand();
  if (!kimiPath) throw new Error("安装完成后仍未找到 kimi 命令，请重新打开 Kimix 后再试");
  const version = await runCommand(kimiPath, ["--version"]).catch(() => output);
  return { path: kimiPath, output: version, message: "Kimi Code 安装完成" };
}

async function installKimiCodeWindows(): Promise<{ binaryPath: string; output: string }> {
  const latestBuffer = await downloadBufferWithProgress(`${KIMI_CODE_INSTALL_BASE_URL}/latest`, "script", "正在获取最新版本");
  const version = latestBuffer.toString("utf8").trim();
  if (!version) throw new Error("无法获取 Kimi Code 最新版本");

  const manifestUrl = `${KIMI_CODE_BINARY_BASE_URL}/${version}/manifest.json`;
  const manifestBuffer = await downloadBufferWithProgress(manifestUrl, "manifest", "正在获取安装清单");
  const manifest = JSON.parse(manifestBuffer.toString("utf8")) as {
    platforms?: Record<string, { filename?: string; checksum?: string }>;
  };
  const target = process.arch === "arm64" ? "win32-arm64" : process.arch === "ia32" ? "win32-x86" : "win32-x64";
  const entry = manifest.platforms?.[target];
  if (!entry?.filename || !entry.checksum) throw new Error(`安装清单缺少 ${target}`);

  const baseUrl = KIMI_CODE_BINARY_BASE_URL;
  const binaryUrl = `${baseUrl}/${version}/${entry.filename}`;
  const binary = await downloadBufferWithProgress(binaryUrl, "binary", "正在下载 Kimi Code 安装包");
  const actual = createHash("sha256").update(binary).digest("hex");
  if (actual.toLowerCase() !== entry.checksum.toLowerCase()) {
    throw new Error(`安装包校验失败：expected ${entry.checksum}, got ${actual}`);
  }

  emitKimiCodeInstallProgress({ phase: "install", message: "正在写入安装目录并迁移旧版命令", receivedBytes: binary.length, totalBytes: binary.length });
  const installDir = process.env.KIMI_INSTALL_DIR || path.join(os.homedir(), ".kimi-code");
  const binDir = path.join(installDir, "bin");
  ensureDirectoryExists(binDir);
  const binaryDest = path.join(binDir, "kimi.exe");
  if (fs.existsSync(binaryDest)) {
    const backup = `${binaryDest}.bak`;
    try { if (fs.existsSync(backup)) fs.rmSync(backup, { force: true }); } catch {}
    fs.renameSync(binaryDest, backup);
  }
  fs.writeFileSync(binaryDest, binary);
  await ensureUserPathContains(binDir);
  const migrationOutput = await runBundledKimiLegacyMigrationScript();
  ensureKimiCodeMigratedConfig();
  emitKimiCodeInstallProgress({ phase: "done", message: "Kimi Code 安装完成", receivedBytes: binary.length, totalBytes: binary.length });
  return { binaryPath: binaryDest, output: [`Installed ${version} to ${binaryDest}`, migrationOutput].filter(Boolean).join("\n") };
}

async function ensureUserPathContains(dir: string) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$dir = ${JSON.stringify(dir)}`,
    "$current = [Environment]::GetEnvironmentVariable('Path', 'User')",
    "if (-not $current -or -not ($current.Split(';') -contains $dir)) {",
    "  $next = if ($current) { \"$dir;$current\" } else { $dir }",
    "  [Environment]::SetEnvironmentVariable('Path', $next, 'User')",
    "}",
  ].join("\n");
  await runLongCommandWithOutput("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]);
  prependProcessPath(dir);
}

async function runBundledKimiLegacyMigrationScript() {
  const installScript = (await downloadBufferWithProgress(KIMI_CODE_INSTALL_PS1_URL, "script", "正在获取旧版迁移脚本")).toString("utf8");
  const match = installScript.match(/# ---------- legacy kimi-cli migration ----------[\s\S]*?Invoke-LegacyMigration/);
  if (!match) return "";
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$KimiNoPath = $env:KIMI_NO_MODIFY_PATH",
    `$KimiInstallDir = ${JSON.stringify(process.env.KIMI_INSTALL_DIR || path.join(os.homedir(), ".kimi-code"))}`,
    match[0],
  ].join("\n");
  return runLongCommandWithOutput("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]).catch((err) => `旧版迁移脚本提示：${err instanceof Error ? err.message : String(err)}`);
}

type McpServerRecord = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  url?: string;
  transport?: "http" | "sse" | "stdio";
  auth?: "oauth" | string;
  enabled?: boolean;
};

type ImportCcCodexPlanItem = {
  kind: "instruction" | "skill" | "mcp";
  source: string;
  target: string;
  label: string;
  action: "append" | "copy" | "merge" | "skip";
  reason?: string;
  content?: string;
  skillSourceDir?: string;
  flatSkillFile?: string;
  mcpName?: string;
  mcpServer?: McpServerRecord;
};

type ImportCcCodexPlan = {
  previewId: string;
  kimiHome: string;
  projectRoot?: string;
  items: ImportCcCodexPlanItem[];
  warnings: string[];
  createdAt: number;
};

const importCcCodexPreviewCache = new Map<string, ImportCcCodexPlan>();

type ThemePaletteColors = {
  primary: string;
  surface: string;
  accent: string;
};

type KimiThemePalette = {
  primary: string;
  accent: string;
  text: string;
  textStrong: string;
  textDim: string;
  textMuted: string;
  border: string;
  borderFocus: string;
  success: string;
  warning: string;
  error: string;
  diffAdded: string;
  diffRemoved: string;
  diffAddedStrong: string;
  diffRemovedStrong: string;
  diffGutter: string;
  diffMeta: string;
  roleUser: string;
};

type KimiThemeImportItem = {
  id: string;
  name: string;
  displayName: string;
  path: string;
  base: "light" | "dark";
  colors: ThemePaletteColors;
  kimiColors: KimiThemePalette;
  sourceTokens: {
    primary?: string;
    surface?: string;
    accent?: string;
  };
  warning?: string;
};

type KimiThemeImportPlan = {
  previewId: string;
  themesDir: string;
  items: KimiThemeImportItem[];
  warnings: string[];
  createdAt: number;
};

const kimiThemeImportPreviewCache = new Map<string, KimiThemeImportPlan>();

function getKimiPaths() {
  const shareDir = resolveKimiShareDir();
  return {
    config: path.join(shareDir, "config.toml"),
    mcpConfig: path.join(shareDir, "mcp.json"),
  };
}

function defaultKimiCodeShareDir() {
  return path.join(os.homedir(), ".kimi-code");
}

function legacyKimiShareDir() {
  return path.join(os.homedir(), ".kimi");
}

function resolveKimiShareDir() {
  if (process.env.KIMI_CODE_HOME) return process.env.KIMI_CODE_HOME;
  if (process.env.KIMI_SHARE_DIR) return process.env.KIMI_SHARE_DIR;
  const current = defaultKimiCodeShareDir();
  const legacy = legacyKimiShareDir();
  if (fs.existsSync(current)) return current;
  if (fs.existsSync(legacy)) return legacy;
  return current;
}

function readKimiServerToken() {
  try {
    const token = fs.readFileSync(path.join(resolveKimiShareDir(), "server.token"), "utf8").trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

async function waitForKimiWebReady(port: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  const healthUrl = `http://127.0.0.1:${port}/api/v1/healthz`;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) {
        const envelope = await response.json() as { code?: unknown; data?: { ok?: unknown } };
        if (envelope.code === 0 && envelope.data?.ok === true) return;
      }
    } catch {
      // The daemon may still be replacing a stale lock or binding the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Kimi Web 启动超时，实时服务尚未就绪。请稍后重试。");
}

function backupFileIfExists(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const backup = `${filePath}.kimix-backup-${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)}`;
  fs.copyFileSync(filePath, backup);
}

function backupFileIfExistsWithPath(filePath: string) {
  if (!fs.existsSync(filePath)) return null;
  const backup = `${filePath}.kimix-backup-${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)}`;
  fs.copyFileSync(filePath, backup);
  return backup;
}

function findNearestGitRoot(startDir?: string) {
  if (!startDir) return undefined;
  let current = path.resolve(startDir);
  try {
    if (!fs.existsSync(current) || !fs.statSync(current).isDirectory()) return undefined;
  } catch {
    return undefined;
  }
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function publicImportPlanItem(item: ImportCcCodexPlanItem) {
  const { content: _content, skillSourceDir: _skillSourceDir, flatSkillFile: _flatSkillFile, mcpServer: _mcpServer, ...publicItem } = item;
  return publicItem;
}

function instructionBlock(sourceLabel: string, sourcePath: string, content: string) {
  return [
    `<!-- Imported from ${sourceLabel}: ${sourcePath} -->`,
    "",
    content.trim(),
    "",
    `<!-- End imported from ${sourceLabel}: ${sourcePath} -->`,
    "",
  ].join("\n");
}

function readTextIfExists(filePath: string) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > 512 * 1024) return null;
  return fs.readFileSync(filePath, "utf-8");
}

function parseJsonMcpServers(filePath: string): Record<string, McpServerRecord> {
  const raw = readTextIfExists(filePath);
  if (!raw) return {};
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const source = parsed.mcpServers && typeof parsed.mcpServers === "object" && !Array.isArray(parsed.mcpServers)
    ? parsed.mcpServers as Record<string, unknown>
    : parsed.mcp_servers && typeof parsed.mcp_servers === "object" && !Array.isArray(parsed.mcp_servers)
      ? parsed.mcp_servers as Record<string, unknown>
      : {};
  const result: Record<string, McpServerRecord> = {};
  for (const [name, value] of Object.entries(source)) {
    const server = normalizeMcpServerRecord(value);
    if (server) result[name] = server;
  }
  return result;
}

function parseCodexTomlMcpServers(filePath: string): Record<string, McpServerRecord> {
  const raw = readTextIfExists(filePath);
  if (!raw) return {};
  const result: Record<string, McpServerRecord> = {};
  let currentName: string | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const section = line.match(/^\s*\[mcp_servers\.([^\]]+)\]\s*$/i);
    if (section) {
      currentName = section[1].trim().replace(/^"|"$/g, "");
      result[currentName] = result[currentName] ?? {};
      continue;
    }
    const otherSection = line.match(/^\s*\[[^\]]+\]\s*$/);
    if (otherSection) {
      currentName = null;
      continue;
    }
    if (!currentName) continue;
    const pair = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*(?:#.*)?$/);
    if (!pair) continue;
    const key = pair[1];
    const valueRaw = pair[2].trim();
    const server = result[currentName];
    if (key === "command" && /^".*"$/.test(valueRaw)) server.command = valueRaw.slice(1, -1);
    else if (key === "url" && /^".*"$/.test(valueRaw)) {
      server.url = valueRaw.slice(1, -1);
      server.transport = "http";
    } else if (key === "transport" && /^".*"$/.test(valueRaw)) {
      const transport = valueRaw.slice(1, -1);
      if (transport === "http" || transport === "sse" || transport === "stdio") server.transport = transport;
    } else if (key === "args" && /^\[.*\]$/.test(valueRaw)) {
      server.args = Array.from(valueRaw.matchAll(/"([^"]*)"/g)).map((match) => match[1]);
    }
  }
  return Object.fromEntries(Object.entries(result).filter(([, server]) => server.command || server.url));
}

function readTargetMcpConfig(targetPath: string) {
  if (!fs.existsSync(targetPath)) return {};
  return JSON.parse(fs.readFileSync(targetPath, "utf-8")) as { mcpServers?: Record<string, McpServerRecord> };
}

function addInstructionImportItems(items: ImportCcCodexPlanItem[], warnings: string[], sourceLabel: string, sourcePath: string, targetPath: string) {
  try {
    const content = readTextIfExists(sourcePath);
    if (!content?.trim()) return;
    const targetText = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, "utf-8") : "";
    const marker = `Imported from ${sourceLabel}: ${sourcePath}`;
    const action = targetText.includes(marker) ? "skip" : "append";
    items.push({
      kind: "instruction",
      source: sourcePath,
      target: targetPath,
      label: `${sourceLabel} instructions`,
      action,
      reason: action === "skip" ? "目标文件已包含这段导入标记" : undefined,
      content: instructionBlock(sourceLabel, sourcePath, content),
    });
  } catch (error) {
    warnings.push(`读取指令文件失败：${sourcePath}：${error instanceof Error ? error.message : String(error)}`);
  }
}

function addSkillImportItems(items: ImportCcCodexPlanItem[], warnings: string[], sourceLabel: string, sourceRoot: string, targetRoot: string) {
  if (!fs.existsSync(sourceRoot)) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(sourceRoot, { withFileTypes: true });
  } catch (error) {
    warnings.push(`读取 Skill 目录失败：${sourceRoot}：${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  for (const entry of entries) {
    if (SKILL_SEARCH_IGNORES.has(entry.name)) continue;
    const sourcePath = path.join(sourceRoot, entry.name);
    try {
      let sourceDir: string | undefined;
      let flatSkillFile: string | undefined;
      let skillFile: string;
      if (entry.isDirectory()) {
        skillFile = path.join(sourcePath, "SKILL.md");
        if (!fs.existsSync(skillFile)) continue;
        sourceDir = sourcePath;
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        skillFile = sourcePath;
        flatSkillFile = sourcePath;
      } else {
        continue;
      }
      const meta = parseSkillFrontmatter(fs.readFileSync(skillFile, "utf-8"));
      const name = meta.name || path.basename(sourcePath, path.extname(sourcePath));
      const targetDir = path.join(targetRoot, sanitizeSkillDirName(name));
      items.push({
        kind: "skill",
        source: sourcePath,
        target: entry.isDirectory() ? path.join(targetDir, "SKILL.md") : path.join(targetDir, "SKILL.md"),
        label: `${sourceLabel} Skill：${name}`,
        action: fs.existsSync(targetDir) ? "skip" : "copy",
        reason: fs.existsSync(targetDir) ? "目标 Skill 已存在" : undefined,
        skillSourceDir: sourceDir,
        flatSkillFile,
      });
    } catch (error) {
      warnings.push(`读取 Skill 失败：${sourcePath}：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function addMcpImportItems(items: ImportCcCodexPlanItem[], warnings: string[], sourceLabel: string, sourcePath: string, targetPath: string, parser: (filePath: string) => Record<string, McpServerRecord>) {
  if (!fs.existsSync(sourcePath)) return;
  let servers: Record<string, McpServerRecord>;
  try {
    servers = parser(sourcePath);
  } catch (error) {
    warnings.push(`读取 MCP 配置失败：${sourcePath}：${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  let existing: Record<string, McpServerRecord> = {};
  try {
    existing = readTargetMcpConfig(targetPath).mcpServers ?? {};
  } catch (error) {
    warnings.push(`目标 MCP 配置暂不可合并：${targetPath}：${error instanceof Error ? error.message : String(error)}`);
    existing = {};
  }
  for (const [name, server] of Object.entries(servers)) {
    const imported = uniqueMcpServerName(existing, name, server);
    items.push({
      kind: "mcp",
      source: sourcePath,
      target: targetPath,
      label: `${sourceLabel} MCP：${name}`,
      action: imported.alreadyExists ? "skip" : "merge",
      reason: imported.alreadyExists ? `同名同配置已存在：${imported.name}` : imported.name !== name ? `同名不同配置，将导入为 ${imported.name}` : undefined,
      mcpName: imported.name,
      mcpServer: server,
    });
    existing[imported.name] = server;
  }
}

function buildImportFromCcCodexPlan(workDir?: string): ImportCcCodexPlan {
  const kimiHome = resolveKimiShareDir();
  const projectRoot = findNearestGitRoot(workDir);
  const targetUserAgents = path.join(kimiHome, "AGENTS.md");
  const targetUserSkills = path.join(kimiHome, "skills");
  const targetProjectAgents = projectRoot ? path.join(projectRoot, ".kimi-code", "AGENTS.md") : undefined;
  const targetProjectSkills = projectRoot ? path.join(projectRoot, ".kimi-code", "skills") : undefined;
  const targetMcp = getKimiPaths().mcpConfig;
  const items: ImportCcCodexPlanItem[] = [];
  const warnings: string[] = [];
  const home = os.homedir();

  addInstructionImportItems(items, warnings, "Claude Code", path.join(home, ".claude", "AGENTS.md"), targetUserAgents);
  addInstructionImportItems(items, warnings, "Claude Code", path.join(home, ".claude", "CLAUDE.md"), targetUserAgents);
  addInstructionImportItems(items, warnings, "Codex", path.join(home, ".codex", "AGENTS.md"), targetUserAgents);
  addInstructionImportItems(items, warnings, "Codex", path.join(home, ".codex", "CLAUDE.md"), targetUserAgents);
  addSkillImportItems(items, warnings, "Claude Code", path.join(home, ".claude", "skills"), targetUserSkills);
  addSkillImportItems(items, warnings, "Codex", path.join(home, ".codex", "skills"), targetUserSkills);
  addMcpImportItems(items, warnings, "Claude Code", path.join(home, ".claude.json"), targetMcp, parseJsonMcpServers);
  addMcpImportItems(items, warnings, "Codex", path.join(home, ".codex", "config.toml"), targetMcp, parseCodexTomlMcpServers);

  if (projectRoot && targetProjectAgents && targetProjectSkills) {
    addInstructionImportItems(items, warnings, "Claude Code", path.join(projectRoot, ".claude", "AGENTS.md"), targetProjectAgents);
    addInstructionImportItems(items, warnings, "Claude Code", path.join(projectRoot, ".claude", "CLAUDE.md"), targetProjectAgents);
    addInstructionImportItems(items, warnings, "Codex", path.join(projectRoot, ".codex", "AGENTS.md"), targetProjectAgents);
    addInstructionImportItems(items, warnings, "Codex", path.join(projectRoot, ".codex", "CLAUDE.md"), targetProjectAgents);
    addSkillImportItems(items, warnings, "Claude Code", path.join(projectRoot, ".claude", "skills"), targetProjectSkills);
    addSkillImportItems(items, warnings, "Codex", path.join(projectRoot, ".codex", "skills"), targetProjectSkills);
    addMcpImportItems(items, warnings, "Codex", path.join(projectRoot, ".codex", "config.toml"), targetMcp, parseCodexTomlMcpServers);
  } else if (workDir) {
    warnings.push("未找到项目 .git 根目录，已跳过项目级 .claude/.codex 导入。");
  }

  const previewId = randomUUID().slice(0, 8);
  return { previewId, kimiHome, projectRoot, items, warnings, createdAt: Date.now() };
}

function applyImportFromCcCodexPlan(plan: ImportCcCodexPlan) {
  const imported: ImportCcCodexPlanItem[] = [];
  const skipped: ImportCcCodexPlanItem[] = [];
  const backups: string[] = [];
  const warnings = [...plan.warnings];
  const touchedBackups = new Set<string>();

  function backupOnce(filePath: string) {
    if (touchedBackups.has(filePath)) return;
    touchedBackups.add(filePath);
    const backup = backupFileIfExistsWithPath(filePath);
    if (backup) backups.push(backup);
  }

  for (const item of plan.items) {
    if (item.action === "skip") {
      skipped.push(item);
      continue;
    }
    try {
      if (item.kind === "instruction") {
        if (!item.content) throw new Error("缺少指令内容");
        fs.mkdirSync(path.dirname(item.target), { recursive: true });
        backupOnce(item.target);
        const existing = fs.existsSync(item.target) ? fs.readFileSync(item.target, "utf-8") : "";
        fs.writeFileSync(item.target, `${existing.trimEnd()}\n\n${item.content}`, "utf-8");
        imported.push(item);
      } else if (item.kind === "skill") {
        fs.mkdirSync(path.dirname(path.dirname(item.target)), { recursive: true });
        if (item.skillSourceDir) {
          backupOnce(path.dirname(item.target));
          copyDirectorySafe(item.skillSourceDir, path.dirname(item.target));
        } else if (item.flatSkillFile) {
          fs.mkdirSync(path.dirname(item.target), { recursive: true });
          backupOnce(item.target);
          fs.copyFileSync(item.flatSkillFile, item.target);
        } else {
          throw new Error("缺少 Skill 来源");
        }
        imported.push(item);
      } else if (item.kind === "mcp") {
        if (!item.mcpName || !item.mcpServer) throw new Error("缺少 MCP 配置");
        fs.mkdirSync(path.dirname(item.target), { recursive: true });
        backupOnce(item.target);
        const config = readTargetMcpConfig(item.target);
        const mcpServers = config.mcpServers && typeof config.mcpServers === "object" ? config.mcpServers : {};
        mcpServers[item.mcpName] = item.mcpServer;
        fs.writeFileSync(item.target, `${JSON.stringify({ ...config, mcpServers }, null, 2)}\n`, "utf-8");
        imported.push(item);
      }
    } catch (error) {
      skipped.push({ ...item, action: "skip", reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    imported: imported.map(publicImportPlanItem),
    skipped: skipped.map(publicImportPlanItem),
    backups,
    warnings,
  };
}

function normalizeThemeHex(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toUpperCase();
  const short = trimmed.match(/^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  return null;
}

function pickThemeColor(colors: Record<string, unknown>, keys: string[], fallback: string) {
  for (const key of keys) {
    const value = normalizeThemeHex(colors[key]);
    if (value) return { value, key };
  }
  return { value: fallback, key: undefined };
}

function themeImportId(filePath: string) {
  return createHash("sha1").update(filePath).digest("hex").slice(0, 8);
}

function uniqueColorCount(values: string[]) {
  return new Set(values.map((value) => value.toUpperCase())).size;
}

function buildKimiThemeQualityWarning(colors: KimiThemePalette) {
  const warnings: string[] = [];
  if (colors.diffAdded.toUpperCase() === colors.success.toUpperCase()) warnings.push("diffAdded 复用了 success");
  if (colors.diffRemoved.toUpperCase() === colors.error.toUpperCase()) warnings.push("diffRemoved 复用了 error");
  if (colors.diffAddedStrong.toUpperCase() === colors.diffAdded.toUpperCase()) warnings.push("diffAddedStrong 未独立加深");
  if (colors.diffRemovedStrong.toUpperCase() === colors.diffRemoved.toUpperCase()) warnings.push("diffRemovedStrong 未独立加深");
  if (uniqueColorCount([colors.success, colors.warning, colors.error]) < 3) warnings.push("success/warning/error 区分不足");
  if (colors.textDim.toUpperCase() === colors.textMuted.toUpperCase()) warnings.push("textDim 与 textMuted 相同");
  if (uniqueColorCount([colors.border, colors.textMuted, colors.diffGutter]) === 1) warnings.push("border/textMuted/diffGutter 层级过于接近");
  const usage = new Map<string, number>();
  Object.values(colors).forEach((value) => usage.set(value.toUpperCase(), (usage.get(value.toUpperCase()) ?? 0) + 1));
  if ([...usage.values()].some((count) => count > 3)) warnings.push("多个语义 token 共用同一颜色");
  return warnings.slice(0, 3).join("；") || undefined;
}

const DEFAULT_KIMI_LIGHT_THEME: KimiThemePalette = {
  primary: "#1565C0",
  accent: "#00838F",
  text: "#1A1A1A",
  textStrong: "#1A1A1A",
  textDim: "#454545",
  textMuted: "#5F5F5F",
  border: "#737373",
  borderFocus: "#92660A",
  success: "#0E7A38",
  warning: "#92660A",
  error: "#B91C1C",
  diffAdded: "#0E7A38",
  diffRemoved: "#B91C1C",
  diffAddedStrong: "#0E7A38",
  diffRemovedStrong: "#B91C1C",
  diffGutter: "#737373",
  diffMeta: "#5F5F5F",
  roleUser: "#9A4A00",
};

const DEFAULT_KIMI_DARK_THEME: KimiThemePalette = {
  primary: "#4FA8FF",
  accent: "#5BC0BE",
  text: "#E0E0E0",
  textStrong: "#F5F5F5",
  textDim: "#888888",
  textMuted: "#6B6B6B",
  border: "#5A5A5A",
  borderFocus: "#E8A838",
  success: "#4EC87E",
  warning: "#E8A838",
  error: "#E85454",
  diffAdded: "#4EC87E",
  diffRemoved: "#E85454",
  diffAddedStrong: "#7AD99B",
  diffRemovedStrong: "#F08585",
  diffGutter: "#6B6B6B",
  diffMeta: "#888888",
  roleUser: "#FFCB6B",
};

function normalizeKimiThemeColors(colors: Record<string, unknown>, base: "light" | "dark"): KimiThemePalette {
  const defaults = base === "light" ? DEFAULT_KIMI_LIGHT_THEME : DEFAULT_KIMI_DARK_THEME;
  return Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [
      key,
      normalizeThemeHex(colors[key]) ?? fallback,
    ]),
  ) as unknown as KimiThemePalette;
}

function mapKimiThemeToPalette(filePath: string): KimiThemeImportItem | null {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : path.basename(filePath, ".json");
  const displayName = typeof raw.displayName === "string" && raw.displayName.trim() ? raw.displayName.trim() : name;
  const base = raw.base === "light" ? "light" : "dark";
  const colors = raw.colors && typeof raw.colors === "object" && !Array.isArray(raw.colors) ? raw.colors as Record<string, unknown> : {};
  const kimiColors = normalizeKimiThemeColors(colors, base);
  const primary = pickThemeColor(colors, ["primary", "borderFocus", "roleUser"], "#1982FF");
  const accent = pickThemeColor(colors, ["accent", "warning", "success", "roleUser"], "#B85C38");
  const surface = pickThemeColor(
    colors,
    ["surface", "background", "bg", "panel", "textMuted", "border"],
    base === "light" ? "#EDE9E0" : "#2A2D33",
  );
  const validColorCount = Object.values(colors).filter((value) => normalizeThemeHex(value)).length;
  const qualityWarning = buildKimiThemeQualityWarning(kimiColors);
  return {
    id: themeImportId(filePath),
    name,
    displayName,
    path: filePath,
    base,
    colors: {
      primary: primary.value,
      surface: surface.value,
      accent: accent.value,
    },
    kimiColors,
    sourceTokens: {
      primary: primary.key,
      surface: surface.key,
      accent: accent.key,
    },
    warning: validColorCount === 0 ? "未找到有效颜色 token，使用默认映射" : qualityWarning,
  };
}

function buildKimiThemeImportPlan(): KimiThemeImportPlan {
  const themesDir = path.join(resolveKimiShareDir(), "themes");
  const warnings: string[] = [];
  const items: KimiThemeImportItem[] = [];
  if (!fs.existsSync(themesDir)) {
    warnings.push(`未找到 Kimi Code themes 目录：${themesDir}`);
  } else {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(themesDir, { withFileTypes: true });
    } catch (error) {
      warnings.push(`读取 themes 目录失败：${error instanceof Error ? error.message : String(error)}`);
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) continue;
      const filePath = path.join(themesDir, entry.name);
      try {
        const item = mapKimiThemeToPalette(filePath);
        if (item) items.push(item);
      } catch (error) {
        warnings.push(`解析主题失败：${filePath}：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  const previewId = randomUUID().slice(0, 8);
  return { previewId, themesDir, items, warnings, createdAt: Date.now() };
}

function ensureKimiCodeMigratedConfig() {
  const current = defaultKimiCodeShareDir();
  const legacy = legacyKimiShareDir();
  const currentConfig = path.join(current, "config.toml");
  const legacyConfig = path.join(legacy, "config.toml");
  if (fs.existsSync(legacyConfig)) {
    const currentText = fs.existsSync(currentConfig) ? fs.readFileSync(currentConfig, "utf-8") : "";
    const legacyText = fs.readFileSync(legacyConfig, "utf-8");
    const currentHasModel = /default_model\s*=\s*"[^"]+"/.test(currentText) && /\[models\."kimi-code\/kimi-for-coding"\]/.test(currentText);
    const legacyHasModel = /default_model\s*=\s*"[^"]+"/.test(legacyText) && /\[models\."kimi-code\/kimi-for-coding"\]/.test(legacyText);
    if (!currentHasModel && legacyHasModel) {
      ensureDirectoryExists(current);
      backupFileIfExists(currentConfig);
      fs.copyFileSync(legacyConfig, currentConfig);
    }
  }
}

function hasKimiCodeOAuthReloginNotice() {
  try {
    const reportPath = path.join(defaultKimiCodeShareDir(), "migration-report.json");
    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8")) as {
      notices?: { oauthLoginsRequiringRelogin?: unknown };
    };
    const notices = report.notices?.oauthLoginsRequiringRelogin;
    return Array.isArray(notices) && notices.some((item) => item === "kimi-code.json");
  } catch {
    return false;
  }
}

function hasUsableKimiCredential(shareDir: string) {
  try {
    const tokenPath = path.join(shareDir, "credentials", "kimi-code.json");
    const raw = JSON.parse(fs.readFileSync(tokenPath, "utf-8")) as {
      access_token?: unknown;
      refresh_token?: unknown;
    };
    return typeof raw.access_token === "string" && raw.access_token.trim().length > 0
      && typeof raw.refresh_token === "string" && raw.refresh_token.trim().length > 0;
  } catch {
    return false;
  }
}

function clearKimiCredential(shareDir: string) {
  const tokenPath = path.join(shareDir, "credentials", "kimi-code.json");
  if (!fs.existsSync(tokenPath)) return;
  backupFileIfExists(tokenPath);
  fs.rmSync(tokenPath, { force: true });
}

function stripAnsi(input: string) {
  return input.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, "");
}

async function getKimiAuthStatus() {
  ensureKimiCodeMigratedConfig();
  const kimiPath = await resolveKimiCommand();
  const paths = getKimiPaths();
  const shareDir = resolveKimiShareDir();
  let defaultModel: string | undefined;
  try { const c = await kimiCodeHost.getConfig(); defaultModel = c.defaultModel; } catch { /* use undefined */ }
  const serverAuth = await kimiCodeHost.getServerAuthSummaryIfReady().catch(() => undefined);
  const loggedIn = serverAuth
    ? serverAuth.managed_provider?.status === "authenticated"
    : hasUsableKimiCredential(shareDir);
  defaultModel = serverAuth?.default_model ?? defaultModel;
  const needsRelogin = !loggedIn && hasKimiCodeOAuthReloginNotice();
  return {
    available: Boolean(kimiPath),
    path: kimiPath ?? undefined,
    loggedIn,
    configPath: paths.config,
    mcpConfigPath: paths.mcpConfig,
    defaultModel,
    defaultThinking: undefined as string | undefined,
    message: !kimiPath
      ? "未找到 Kimi Code，请先安装或检查 PATH"
      : loggedIn
        ? "Kimi Code 已登录"
        : needsRelogin
          ? "Kimi Code 0.6.0 迁移后需要重新登录，请点击登录并在浏览器中完成授权"
          : "Kimi Code 已安装，但当前未登录",
  };
}

function unescapeTomlString(value: string) {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function escapeTomlString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function readTomlString(sectionText: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sectionText.match(new RegExp(`^\\s*${escaped}\\s*=\\s*"((?:\\\\.|[^"])*)"`, "m"));
  return match ? unescapeTomlString(match[1]) : null;
}

function readTomlInteger(sectionText: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sectionText.match(new RegExp(`^\\s*${escaped}\\s*=\\s*([0-9]+)\\s*$`, "m"));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

const KIMIX_MODEL_CONFIG_BEGIN = "# >>> Kimix managed models >>>";
const KIMIX_MODEL_CONFIG_END = "# <<< Kimix managed models <<<";

function removeKimixManagedModelBlock(raw: string) {
  const escapedBegin = KIMIX_MODEL_CONFIG_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedEnd = KIMIX_MODEL_CONFIG_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return raw.replace(new RegExp(`\\n?${escapedBegin}[\\s\\S]*?${escapedEnd}\\n?`, "m"), "\n");
}

function listTomlSectionNames(raw: string) {
  return Array.from(raw.matchAll(/^\s*\[([^\]]+)\]\s*$/gm)).map((match) => match[1].trim());
}

function toTomlTableKey(name: string) {
  return /^[A-Za-z0-9_-]+$/.test(name) ? name : `"${escapeTomlString(name)}"`;
}

function setTopLevelTomlString(raw: string, key: string, value: string) {
  const line = `${key} = "${escapeTomlString(value)}"`;
  const pattern = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*"((?:\\\\.|[^"])*)"\\s*$`, "m");
  if (pattern.test(raw)) return raw.replace(pattern, line);
  return `${line}\n${raw.trimStart()}`;
}

type SavedOpenAiProviderConfig = z.infer<typeof SaveOpenAiProviderConfigSchema> & { apiKey: string };

function normalizeOpenAiProviderContextSize(config: Pick<z.infer<typeof OpenAiProviderBaseConfigSchema>, "maxContextSize">) {
  const fallback = 262144;
  const input = typeof config.maxContextSize === "number" && Number.isFinite(config.maxContextSize) ? config.maxContextSize : fallback;
  return Math.max(1, input);
}

function isDeepSeekModelConfig(summary: ReturnType<typeof readKimiModelConfig>, modelAlias?: string | null) {
  const alias = modelAlias || summary.defaultModel || "";
  const model = summary.models.find((item) => item.alias === alias);
  const provider = summary.providers.find((item) => item.name === model?.provider);
  return `${alias} ${model?.provider ?? ""} ${model?.model ?? ""} ${provider?.baseUrl ?? ""}`.toLowerCase().includes("deepseek");
}

function readTomlSectionBody(raw: string, sectionName: string) {
  const sectionPattern = /^\s*\[([^\]]+)\]\s*$/gm;
  const matches = Array.from(raw.matchAll(sectionPattern));
  const matchIndex = matches.findIndex((match) => match[1].trim() === sectionName);
  if (matchIndex < 0) return null;
  const match = matches[matchIndex];
  return raw.slice((match.index ?? 0) + match[0].length, matches[matchIndex + 1]?.index ?? raw.length);
}

function removeTomlSection(raw: string, sectionName: string) {
  const sectionPattern = /^\s*\[([^\]]+)\]\s*$/gm;
  const matches = Array.from(raw.matchAll(sectionPattern));
  const matchIndex = matches.findIndex((match) => match[1].trim() === sectionName);
  if (matchIndex < 0) return raw;
  const start = matches[matchIndex].index ?? 0;
  const end = matches[matchIndex + 1]?.index ?? raw.length;
  const before = raw.slice(0, start).trimEnd();
  const after = raw.slice(end).trimStart();
  return `${before}${before && after ? "\n\n" : ""}${after}`;
}

function resolveExistingManagedApiKey(raw: string, providerName: string) {
  const providerKey = toTomlTableKey(providerName);
  const body = readTomlSectionBody(raw, `providers.${providerKey}`);
  return body ? readTomlString(body, "api_key") : null;
}

function buildKimixManagedModelBlock(config: SavedOpenAiProviderConfig) {
  const maxContextSize = normalizeOpenAiProviderContextSize(config);
  const disableAdaptiveThinking = `${config.providerName} ${config.baseUrl} ${config.model}`.toLowerCase().includes("deepseek");
  const providerKey = toTomlTableKey(config.providerName);
  const modelKey = toTomlTableKey(config.modelAlias);
  return [
    KIMIX_MODEL_CONFIG_BEGIN,
    `[providers.${providerKey}]`,
    `type = "openai"`,
    `base_url = "${escapeTomlString(config.baseUrl)}"`,
    `api_key = "${escapeTomlString(config.apiKey)}"`,
    "",
    `[models.${modelKey}]`,
    `provider = "${escapeTomlString(config.providerName)}"`,
    `model = "${escapeTomlString(config.model)}"`,
    `max_context_size = ${maxContextSize}`,
    `display_name = "${escapeTomlString(config.modelAlias)}"`,
    ...(disableAdaptiveThinking ? ["adaptive_thinking = false"] : []),
    KIMIX_MODEL_CONFIG_END,
    "",
  ].join("\n");
}

function readKimiModelConfig() {
  ensureKimiCodeMigratedConfig();
  const paths = getKimiPaths();
  const configPath = paths.config;
  if (!fs.existsSync(configPath)) {
    return {
      configPath,
      exists: false,
      defaultModel: null,
      providers: [],
      models: [],
    };
  }

  const raw = fs.readFileSync(configPath, "utf-8");
  const defaultModel = readTomlString(raw, "default_model");
  const sectionPattern = /^\s*\[([^\]]+)\]\s*$/gm;
  const matches = Array.from(raw.matchAll(sectionPattern));
  const sections = matches.map((match, index) => ({
    name: match[1].trim(),
    body: raw.slice((match.index ?? 0) + match[0].length, matches[index + 1]?.index ?? raw.length),
  }));

  const providerSections = sections.filter((section) => /^providers\./.test(section.name) && !/\.oauth$|\.env$/.test(section.name));
  const modelSections = sections.filter((section) => /^models\./.test(section.name));
  const hasOauth = new Set(
    sections
      .filter((section) => /^providers\..+\.oauth$/.test(section.name))
      .map((section) => section.name.replace(/\.oauth$/, ""))
  );
  const stripTablePrefix = (sectionName: string, prefix: string) => {
    const rawName = sectionName.slice(prefix.length);
    const quoted = rawName.match(/^"((?:\\.|[^"])*)"$/);
    return quoted ? unescapeTomlString(quoted[1]) : rawName;
  };

  return {
    configPath,
    exists: true,
    defaultModel,
    providers: providerSections.map((section) => ({
      name: stripTablePrefix(section.name, "providers."),
      type: readTomlString(section.body, "type"),
      baseUrl: readTomlString(section.body, "base_url"),
      hasApiKey: Boolean(readTomlString(section.body, "api_key")),
      hasOauth: hasOauth.has(section.name),
    })).sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
    models: modelSections.map((section) => {
      const alias = stripTablePrefix(section.name, "models.");
      return {
        alias,
        provider: readTomlString(section.body, "provider"),
        model: readTomlString(section.body, "model"),
        displayName: readTomlString(section.body, "display_name"),
        maxContextSize: readTomlInteger(section.body, "max_context_size"),
        isDefault: alias === defaultModel,
      };
    }).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.alias.localeCompare(b.alias, "zh-CN")),
  };
}

function kimiCodeConfigToModelSummary(config: kimiCodeHost.KimiCodeConfig) {
  ensureKimiCodeMigratedConfig();
  const configPath = getKimiPaths().config;
  const providers = Object.entries(config.providers ?? {}).map(([name, provider]) => ({
    name,
    type: provider.type ?? null,
    baseUrl: provider.baseUrl ?? null,
    hasApiKey: Boolean(provider.apiKey),
    hasOauth: Boolean(provider.oauth),
  })).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  const defaultModel = config.defaultModel ?? null;
  const models = Object.entries(config.models ?? {}).map(([alias, model]) => ({
    alias,
    provider: model.provider ?? null,
    model: model.model ?? null,
    displayName: model.displayName ?? null,
    maxContextSize: typeof model.maxContextSize === "number" ? model.maxContextSize : null,
    adaptiveThinking: typeof model.adaptiveThinking === "boolean" ? model.adaptiveThinking : null,
    isDefault: alias === defaultModel,
  })).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.alias.localeCompare(b.alias, "zh-CN"));

  return {
    configPath,
    exists: fs.existsSync(configPath),
    defaultModel,
    providers,
    models,
  };
}

async function readKimiModelConfigWithSdk() {
  try {
    return kimiCodeConfigToModelSummary(await kimiCodeHost.getConfig({ reload: true }));
  } catch (error) {
    console.warn("[kimi-code] SDK getConfig failed, falling back to TOML parser:", error);
    return readKimiModelConfig();
  }
}

const OpenAiProviderBaseConfigSchema = z.object({
  providerName: z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9_.:-]+$/),
  modelAlias: z.string().trim().min(2).max(120).regex(/^[A-Za-z0-9_./:-]+$/),
  baseUrl: z.string().trim().url(),
  model: z.string().trim().min(1).max(160),
  maxContextSize: z.number().int().min(1).max(1048576).optional(),
  makeDefault: z.boolean().optional(),
});

const SaveOpenAiProviderConfigSchema = OpenAiProviderBaseConfigSchema.extend({
  apiKey: z.string().trim().max(4096).optional(),
});

const TestOpenAiProviderConfigSchema = OpenAiProviderBaseConfigSchema.extend({
  apiKey: z.string().trim().min(1).max(4096),
});

function saveOpenAiProviderConfig(input: unknown) {
  const config = SaveOpenAiProviderConfigSchema.parse(input);
  ensureKimiCodeMigratedConfig();
  const paths = getKimiPaths();
  const configPath = paths.config;
  ensureDirectoryExists(path.dirname(configPath));
  const current = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf-8") : "";
  const apiKey = config.apiKey?.trim() || resolveExistingManagedApiKey(current, config.providerName);
  if (!apiKey) {
    throw new Error("API Key 为空，无法保存新 Provider。");
  }
  const withoutManagedBlock = removeKimixManagedModelBlock(current);
  const existingSections = new Set(listTomlSectionNames(withoutManagedBlock));
  if (existingSections.has(`providers.${toTomlTableKey(config.providerName)}`)) {
    throw new Error(`Provider ${config.providerName} 已存在于非 Kimix 管理区，请换一个名称或手动整理 config.toml`);
  }
  if (existingSections.has(`models.${toTomlTableKey(config.modelAlias)}`)) {
    throw new Error(`模型别名 ${config.modelAlias} 已存在于非 Kimix 管理区，请换一个名称或手动整理 config.toml`);
  }

  backupFileIfExists(configPath);
  const base = config.makeDefault
    ? setTopLevelTomlString(withoutManagedBlock, "default_model", config.modelAlias)
    : withoutManagedBlock;
  const next = `${base.trimEnd()}${base.trim() ? "\n\n" : ""}${buildKimixManagedModelBlock({ ...config, apiKey })}`;
  fs.writeFileSync(configPath, next, "utf-8");
  return readKimiModelConfig();
}

async function saveOpenAiProviderConfigWithSdk(input: unknown) {
  const config = SaveOpenAiProviderConfigSchema.parse(input);
  ensureKimiCodeMigratedConfig();
  const configPath = getKimiPaths().config;
  const current = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf-8") : "";
  const apiKey = config.apiKey?.trim() || resolveExistingManagedApiKey(current, config.providerName);
  if (!apiKey) {
    throw new Error("API Key 为空，无法保存新 Provider。");
  }
  try {
    const patch: kimiCodeHost.KimiCodeConfigPatch = {
      providers: {
        [config.providerName]: {
          type: "openai",
          baseUrl: config.baseUrl,
          apiKey,
          defaultModel: config.model,
        },
      },
      models: {
        [config.modelAlias]: {
          provider: config.providerName,
          model: config.model,
          maxContextSize: normalizeOpenAiProviderContextSize(config),
          displayName: config.modelAlias,
          adaptiveThinking: `${config.providerName} ${config.baseUrl} ${config.model}`.toLowerCase().includes("deepseek") ? false : undefined,
        },
      },
      ...(config.makeDefault ? { defaultModel: config.modelAlias } : {}),
    };
    await kimiCodeHost.setConfig(patch);
    if (config.makeDefault) {
      return await readKimiModelConfigAfterSdkSet(config.modelAlias);
    }
    return kimiCodeConfigToModelSummary(await kimiCodeHost.getConfig({ reload: true }));
  } catch (error) {
    console.warn("[kimi-code] SDK setConfig(provider) failed, falling back to TOML writer:", error);
    return saveOpenAiProviderConfig(input);
  }
}

function setDefaultKimiModel(input: unknown) {
  const req = z.object({ modelAlias: z.string().trim().min(1).max(160) }).parse(input);
  ensureKimiCodeMigratedConfig();
  const paths = getKimiPaths();
  const configPath = paths.config;
  if (!fs.existsSync(configPath)) throw new Error("尚未找到 Kimi Code config.toml");
  const current = fs.readFileSync(configPath, "utf-8");
  const summary = readKimiModelConfig();
  if (!summary.models.some((model) => model.alias === req.modelAlias)) {
    throw new Error(`模型别名 ${req.modelAlias} 不存在，请先保存或刷新模型配置`);
  }
  backupFileIfExists(configPath);
  fs.writeFileSync(configPath, setTopLevelTomlString(current, "default_model", req.modelAlias), "utf-8");
  return readKimiModelConfig();
}

async function setDefaultKimiModelWithSdk(input: unknown) {
  const req = z.object({ modelAlias: z.string().trim().min(1).max(160) }).parse(input);
  try {
    const current = await kimiCodeHost.getConfig({ reload: true });
    if (!Object.keys(current.models ?? {}).includes(req.modelAlias)) {
      throw new Error(`模型别名 ${req.modelAlias} 不存在，请先保存或刷新模型配置`);
    }
    await kimiCodeHost.setConfig({ defaultModel: req.modelAlias });
    return await readKimiModelConfigAfterSdkSet(req.modelAlias);
  } catch (error) {
    console.warn("[kimi-code] SDK setConfig(defaultModel) failed, falling back to TOML writer:", error);
    return setDefaultKimiModel(input);
  }
}

async function readKimiModelConfigAfterSdkSet(expectedDefaultModel: string) {
  const reloaded = kimiCodeConfigToModelSummary(await kimiCodeHost.getConfig({ reload: true }));
  if (reloaded.defaultModel === expectedDefaultModel) return reloaded;
  const disk = readKimiModelConfig();
  if (disk.defaultModel === expectedDefaultModel) return disk;
  throw new Error(`Kimi Code 未将默认模型持久化为 ${expectedDefaultModel}`);
}

async function reloadIdleKimiCodeSessionsAfterConfigChange() {
  try {
    return await kimiCodeHost.reloadIdleSessions();
  } catch (error) {
    console.warn("[kimi-code] reload idle sessions after config change failed:", error);
    return { reloaded: [], skipped: [], errors: [{ sessionId: "", message: error instanceof Error ? error.message : String(error) }] };
  }
}

function buildConfigReloadSuffix(result: Awaited<ReturnType<typeof reloadIdleKimiCodeSessionsAfterConfigChange>>) {
  if (result.reloaded.length > 0) return `，已重载 ${result.reloaded.length} 个空闲会话`;
  if (result.skipped.length > 0) return "，当前运行中的会话会在下一轮或新会话中使用新配置";
  return "";
}

async function runKimiDoctor() {
  const kimiPath = await requireKimiExecutable();
  const output = await runLongCommand(kimiPath, ["doctor"], 30_000);
  return {
    ok: true,
    output: output.trim(),
    message: output.trim() || "Kimi Code 配置诊断通过",
    environment: getKimiEnvironmentSummary(),
  };
}

async function setKimiModelAdaptiveThinkingWithSdk(input: unknown) {
  const req = z.object({
    modelAlias: z.string().trim().min(1).max(160),
    adaptiveThinking: z.boolean(),
  }).parse(input);
  const current = await kimiCodeHost.getConfig({ reload: true });
  const existing = current.models?.[req.modelAlias];
  if (!existing) {
    throw new Error(`模型别名 ${req.modelAlias} 不存在，请先刷新模型配置`);
  }
  const updated = await kimiCodeHost.setConfig({
    models: {
      [req.modelAlias]: {
        ...existing,
        adaptiveThinking: req.adaptiveThinking,
      },
    },
  });
  return kimiCodeConfigToModelSummary(updated);
}

function removeKimiModelConfig(input: unknown) {
  const req = z.object({ modelAlias: z.string().trim().min(1).max(160) }).parse(input);
  ensureKimiCodeMigratedConfig();
  const configPath = getKimiPaths().config;
  if (!fs.existsSync(configPath)) throw new Error("尚未找到 Kimi Code config.toml");

  const current = fs.readFileSync(configPath, "utf-8");
  const summary = readKimiModelConfig();
  const target = summary.models.find((model) => model.alias === req.modelAlias);
  if (!target) throw new Error(`模型别名 ${req.modelAlias} 不存在，请先刷新模型配置`);
  const provider = summary.providers.find((item) => item.name === target.provider);
  if (provider?.type !== "openai") {
    throw new Error("只能在 Kimix 中删除 OpenAI-compatible 外部模型；官方 managed 模型请保留。");
  }

  const fallbackDefault = "kimi-code/kimi-for-coding";
  backupFileIfExists(configPath);
  let next = removeTomlSection(current, `models.${toTomlTableKey(target.alias)}`);
  const remainingModels = summary.models.filter((model) => model.alias !== target.alias);
  const providerStillUsed = remainingModels.some((model) => model.provider === target.provider);
  if (target.provider && !providerStillUsed) {
    const providerKey = toTomlTableKey(target.provider);
    next = removeTomlSection(next, `providers.${providerKey}`);
    next = removeTomlSection(next, `providers.${providerKey}.oauth`);
    next = removeTomlSection(next, `providers.${providerKey}.env`);
  }
  if (summary.defaultModel === target.alias) {
    const fallback = remainingModels.find((model) => model.alias === fallbackDefault)?.alias ?? remainingModels[0]?.alias ?? fallbackDefault;
    next = setTopLevelTomlString(next, "default_model", fallback);
  }
  fs.writeFileSync(configPath, next.trimEnd() + "\n", "utf-8");
  return readKimiModelConfig();
}

async function testOpenAiProviderConfig(input: unknown) {
  const config = TestOpenAiProviderConfigSchema.parse(input);
  const kimiPath = await requireKimiExecutable();
  // 把测试会话隔离到临时 KIMI_CODE_HOME，避免污染用户真实会话历史和当前项目侧栏。
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kimix-provider-test-"));
  try {
    const env = {
      ...process.env,
      KIMI_CODE_HOME: tmpDir,
      KIMI_MODEL_PROVIDER_TYPE: "openai",
      KIMI_MODEL_NAME: config.model,
      KIMI_MODEL_BASE_URL: config.baseUrl,
      KIMI_MODEL_API_KEY: config.apiKey,
      KIMI_MODEL_MAX_CONTEXT_SIZE: String(normalizeOpenAiProviderContextSize(config)),
      KIMI_MODEL_DISPLAY_NAME: config.modelAlias,
    };
    const output = await new Promise<string>((resolve, reject) => {
      const child = execFile(kimiPath, ["--output-format", "stream-json", "-p", "只回复 OK，不要输出其它内容。"], {
        windowsHide: true,
        timeout: 60000,
        maxBuffer: 8 * 1024 * 1024,
        cwd: tmpDir,
        env,
      }, (error, stdout, stderr) => {
        const text = [stdout, stderr].filter(Boolean).join("\n").trim();
        if (error) {
          reject(new Error(normalizeModelConfigError(text || error.message)));
          return;
        }
        resolve(text);
      });
      child.on("error", (err) => reject(new Error(normalizeModelConfigError(err.message))));
    });
    return {
      message: "连接测试通过",
      output: summarizeKimiPromptOutput(output),
    };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // 临时目录清理失败不影响测试结果
    }
  }
}

function summarizeKimiPromptOutput(output: string) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const assistantText = lines.map((line) => {
    try {
      const record = JSON.parse(line) as { role?: string; content?: unknown };
      return record.role === "assistant" && typeof record.content === "string" ? record.content : "";
    } catch {
      return "";
    }
  }).filter(Boolean).join("");
  return assistantText.trim() || output.slice(0, 500);
}

function normalizeModelConfigError(message: string) {
  const text = stripAnsi(message).trim();
  if (/401|unauthorized|api[_ -]?key|invalid key|authentication/i.test(text)) {
    return `API Key 无效或无权限：${text}`;
  }
  if (/404|model.*not.*found|unknown model|invalid model/i.test(text)) {
    return `模型名不可用或不存在：${text}`;
  }
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|base_url|Invalid URL/i.test(text)) {
    return `Base URL 无法连接或格式不兼容：${text}`;
  }
  return text || "连接测试失败";
}

function readMcpServers() {
  const paths = getKimiPaths();
  const pluginServers = readPluginMcpServers();
  if (!fs.existsSync(paths.mcpConfig)) {
    return {
      configPath: paths.mcpConfig,
      servers: [],
      pluginServers,
      rawExists: false,
    };
  }
  const raw = fs.readFileSync(paths.mcpConfig, "utf-8");
  const parsed = JSON.parse(raw) as { mcpServers?: Record<string, McpServerRecord> };
  const entries = parsed && parsed.mcpServers && typeof parsed.mcpServers === "object" ? parsed.mcpServers : {};
  const servers = Object.entries(entries).map(([name, value]) => ({
    name,
    transport: value.transport === "sse" ? "sse" as const : value.transport === "http" || value.url ? "http" as const : "stdio" as const,
    url: value.url,
    command: value.command,
    args: Array.isArray(value.args) ? value.args : [],
    env: value.env && typeof value.env === "object" ? value.env : undefined,
    headers: value.headers && typeof value.headers === "object" ? value.headers : undefined,
    auth: value.auth,
  }));
  servers.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  return {
    configPath: paths.mcpConfig,
    servers,
    pluginServers,
    rawExists: true,
  };
}

function findPluginManifestFiles() {
  const roots = [
    path.join(resolveKimiShareDir(), "plugins", "managed"),
    path.join(resolveKimiShareDir(), "plugins"),
    path.join(os.homedir(), ".kimi-code", "plugins"),
    path.join(os.homedir(), ".kimi", "plugins"),
  ];
  const seenRoots = new Set<string>();
  const seenFiles = new Set<string>();
  const manifests: string[] = [];

  function walk(dir: string, depth: number) {
    if (depth > 5) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKILL_SEARCH_IGNORES.has(entry.name) || entry.name === ".git" || entry.name === "node_modules") continue;
        walk(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const normalized = fullPath.replace(/\\/g, "/").toLowerCase();
      // Only Kimi-specific manifests. A bare plugin.json also lives inside
      // .claude-plugin / .codex-plugin / .cursor-plugin folders of multi-tool
      // plugins (e.g. superpowers) — counting those would surface one card per
      // tool variant. Restrict to kimi.plugin.json and .kimi-plugin/plugin.json.
      const isManifest = entry.name === "kimi.plugin.json"
        || normalized.endsWith("/.kimi-plugin/plugin.json")
        || (entry.name === "plugin.json" && !normalized.includes("-plugin/plugin.json"));
      if (!isManifest) continue;
      const resolved = path.resolve(fullPath);
      if (seenFiles.has(resolved)) continue;
      seenFiles.add(resolved);
      manifests.push(fullPath);
    }
  }

  for (const root of roots) {
    const resolvedRoot = path.resolve(root);
    if (seenRoots.has(resolvedRoot) || !fs.existsSync(root)) continue;
    seenRoots.add(resolvedRoot);
    walk(root, 0);
  }
  return manifests;
}

function pluginRootFromManifest(manifestPath: string) {
  const parent = path.dirname(manifestPath);
  return path.basename(parent) === ".kimi-plugin" ? path.dirname(parent) : parent;
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeMcpServerRecord(value: unknown): McpServerRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const env = record.env && typeof record.env === "object" && !Array.isArray(record.env)
    ? Object.fromEntries(Object.entries(record.env as Record<string, unknown>).map(([key, item]) => [key, String(item)]))
    : undefined;
  const headers = record.headers && typeof record.headers === "object" && !Array.isArray(record.headers)
    ? Object.fromEntries(Object.entries(record.headers as Record<string, unknown>).map(([key, item]) => [key, String(item)]))
    : undefined;
  const transport = record.transport === "http" || record.transport === "sse" || record.transport === "stdio" ? record.transport : undefined;
  return {
    command: typeof record.command === "string" ? record.command : undefined,
    args: toStringArray(record.args),
    env,
    headers,
    url: typeof record.url === "string" ? record.url : undefined,
    transport,
    auth: typeof record.auth === "string" ? record.auth : undefined,
    enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
  };
}

function readPluginMcpServers() {
  const servers: {
    name: string;
    transport: "http" | "sse" | "stdio";
    url?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    headers?: Record<string, string>;
    auth?: "oauth" | string;
    pluginId: string;
    pluginName: string;
    pluginPath: string;
    manifestPath: string;
    enabled: boolean;
  }[] = [];

  for (const manifestPath of findPluginManifestFiles()) {
    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
      const pluginPath = pluginRootFromManifest(manifestPath);
      const pluginName = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : path.basename(pluginPath);
      const pluginId = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : pluginName;
      const mcpServers = raw.mcpServers && typeof raw.mcpServers === "object" && !Array.isArray(raw.mcpServers)
        ? raw.mcpServers as Record<string, unknown>
        : {};
      for (const [name, value] of Object.entries(mcpServers)) {
        const server = normalizeMcpServerRecord(value);
        if (!server) continue;
        servers.push({
          name,
          transport: server.transport === "sse" ? "sse" : server.transport === "http" || server.url ? "http" : "stdio",
          url: server.url,
          command: server.command,
          args: server.args ?? [],
          env: server.env,
          headers: server.headers,
          auth: server.auth,
          pluginId,
          pluginName,
          pluginPath,
          manifestPath,
          enabled: server.enabled !== false,
        });
      }
    } catch {
      // Ignore malformed third-party plugin manifests; install errors are surfaced separately.
    }
  }
  servers.sort((a, b) => `${a.pluginName}:${a.name}`.localeCompare(`${b.pluginName}:${b.name}`, "zh-CN"));
  return servers;
}

function sanitizeMcpServerName(name: string) {
  return (name || "plugin-mcp")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    || "plugin-mcp";
}

function sameMcpServerConfig(left: McpServerRecord, right: McpServerRecord) {
  return JSON.stringify({
    command: left.command || "",
    args: left.args ?? [],
    env: left.env ?? {},
    headers: left.headers ?? {},
    url: left.url || "",
    transport: left.transport || "",
    auth: left.auth || "",
  }) === JSON.stringify({
    command: right.command || "",
    args: right.args ?? [],
    env: right.env ?? {},
    headers: right.headers ?? {},
    url: right.url || "",
    transport: right.transport || "",
    auth: right.auth || "",
  });
}

function uniqueMcpServerName(existing: Record<string, McpServerRecord>, preferredName: string, server: McpServerRecord) {
  const base = sanitizeMcpServerName(preferredName);
  if (!existing[base]) return { name: base, alreadyExists: false };
  if (sameMcpServerConfig(existing[base], server)) return { name: base, alreadyExists: true };
  let index = 2;
  while (existing[`${base}-${index}`]) {
    if (sameMcpServerConfig(existing[`${base}-${index}`], server)) {
      return { name: `${base}-${index}`, alreadyExists: true };
    }
    index += 1;
  }
  return { name: `${base}-${index}`, alreadyExists: false };
}

function findPluginMcpServer(manifestPath: string, serverName: string) {
  const resolvedManifest = path.resolve(manifestPath);
  const knownManifests = new Set(findPluginManifestFiles().map((item) => path.resolve(item)));
  if (!knownManifests.has(resolvedManifest)) {
    throw new Error("未找到可信的 Plugin manifest，请刷新 MCP 面板后重试");
  }
  const raw = JSON.parse(fs.readFileSync(resolvedManifest, "utf-8")) as Record<string, unknown>;
  const pluginPath = pluginRootFromManifest(resolvedManifest);
  const pluginName = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : path.basename(pluginPath);
  const mcpServers = raw.mcpServers && typeof raw.mcpServers === "object" && !Array.isArray(raw.mcpServers)
    ? raw.mcpServers as Record<string, unknown>
    : {};
  const server = normalizeMcpServerRecord(mcpServers[serverName]);
  if (!server) throw new Error(`Plugin manifest 中未找到 MCP 服务 ${serverName}`);
  return { pluginName, serverName, server };
}

function importPluginMcpServerToConfig(request: unknown) {
  const parsed = z.object({
    manifestPath: z.string().trim().min(1),
    name: z.string().trim().min(1),
  }).parse(request);
  const { pluginName, serverName, server } = findPluginMcpServer(parsed.manifestPath, parsed.name);
  const paths = getKimiPaths();
  let config: { mcpServers?: Record<string, McpServerRecord> } = {};
  if (fs.existsSync(paths.mcpConfig)) {
    config = JSON.parse(fs.readFileSync(paths.mcpConfig, "utf-8")) as { mcpServers?: Record<string, McpServerRecord> };
  }
  const mcpServers = config.mcpServers && typeof config.mcpServers === "object" ? config.mcpServers : {};
  const imported = uniqueMcpServerName(mcpServers, `plugin-${pluginName}-${serverName}`, server);
  if (imported.alreadyExists) {
    return { message: `Plugin MCP 已在配置中：${imported.name}` };
  }
  fs.mkdirSync(path.dirname(paths.mcpConfig), { recursive: true });
  backupFileIfExists(paths.mcpConfig);
  mcpServers[imported.name] = {
    transport: server.transport === "sse" ? "sse" : server.transport === "http" || server.url ? "http" : "stdio",
    url: server.url,
    command: server.command,
    args: server.args ?? [],
    env: server.env,
    headers: server.headers,
    auth: server.auth,
  };
  fs.writeFileSync(paths.mcpConfig, `${JSON.stringify({ ...config, mcpServers }, null, 2)}\n`, "utf-8");
  return { message: `已将 ${pluginName} / ${serverName} 加入 MCP 配置：${imported.name}` };
}

function readMcpConfigForWrite() {
  const paths = getKimiPaths();
  let config: { mcpServers?: Record<string, McpServerRecord> } = {};
  if (fs.existsSync(paths.mcpConfig)) {
    config = JSON.parse(fs.readFileSync(paths.mcpConfig, "utf-8")) as { mcpServers?: Record<string, McpServerRecord> };
  }
  const mcpServers = config.mcpServers && typeof config.mcpServers === "object" && !Array.isArray(config.mcpServers)
    ? config.mcpServers
    : {};
  return { paths, config, mcpServers };
}

function parseKeyValueList(values?: string[]) {
  if (!values?.length) return undefined;
  const entries: Record<string, string> = {};
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error(`配置项格式应为 KEY=VALUE：${trimmed}`);
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const itemValue = trimmed.slice(separatorIndex + 1).trim();
    if (!key) throw new Error(`配置项 Key 不能为空：${trimmed}`);
    entries[key] = itemValue;
  }
  return Object.keys(entries).length ? entries : undefined;
}

function addMcpServerToConfig(request: unknown) {
  const parsed = z.object({
    name: z.string().trim().min(1),
    transport: z.enum(["http", "sse", "stdio"]),
    url: z.string().trim().optional(),
    command: z.string().trim().optional(),
    args: z.array(z.string().trim()).optional(),
    env: z.array(z.string().trim()).optional(),
    headers: z.array(z.string().trim()).optional(),
    auth: z.literal("oauth").optional(),
  }).parse(request);
  const name = sanitizeMcpServerName(parsed.name);
  if (name !== parsed.name) {
    throw new Error(`MCP 名称只能包含字母、数字、点、下划线和短横线；建议使用：${name}`);
  }
  const { paths, config, mcpServers } = readMcpConfigForWrite();
  if (mcpServers[name]) {
    throw new Error(`MCP 服务 ${name} 已存在，请先删除旧配置或换一个名称`);
  }
  const server: McpServerRecord = {
    transport: parsed.transport,
    auth: parsed.auth,
    env: parseKeyValueList(parsed.env),
    headers: parseKeyValueList(parsed.headers),
  };
  if (parsed.transport === "http" || parsed.transport === "sse") {
    if (!parsed.url) throw new Error(`${parsed.transport.toUpperCase()} MCP 需要填写 URL`);
    server.url = parsed.url;
  } else {
    if (!parsed.command) throw new Error("stdio MCP 需要填写命令");
    server.command = parsed.command;
    server.args = (parsed.args ?? []).filter(Boolean);
  }
  fs.mkdirSync(path.dirname(paths.mcpConfig), { recursive: true });
  backupFileIfExists(paths.mcpConfig);
  mcpServers[name] = server;
  fs.writeFileSync(paths.mcpConfig, `${JSON.stringify({ ...config, mcpServers }, null, 2)}\n`, "utf-8");
  return { message: `已写入 MCP 服务 ${name} 到 mcp.json` };
}

function removeMcpServerFromConfig(request: unknown) {
  const parsed = z.object({ name: z.string().trim().min(1) }).parse(request);
  const { paths, config, mcpServers } = readMcpConfigForWrite();
  if (!mcpServers[parsed.name]) {
    throw new Error(`mcp.json 中未找到 MCP 服务 ${parsed.name}，请刷新后重试`);
  }
  backupFileIfExists(paths.mcpConfig);
  delete mcpServers[parsed.name];
  fs.writeFileSync(paths.mcpConfig, `${JSON.stringify({ ...config, mcpServers }, null, 2)}\n`, "utf-8");
  return { message: `已从 mcp.json 删除 MCP 服务 ${parsed.name}` };
}

function unsupportedKimiMcpCliMessage(action: string, name: string) {
  return [
    `当前 Kimi Code CLI 未暴露 \`kimi mcp ${action}\` 子命令，Kimix 不能通过旧 CLI 入口直接操作 ${name}。`,
    "Plugin 随带 MCP 默认会随官方 Kimi Code 会话加载，不需要写入 mcp.json 才能使用。",
    "请在上方“当前会话运行态”查看连接状态；如需刷新插件，请点 Plugin 卡片里的“更新 MCP”。",
  ].join(" ");
}

async function requireKimiExecutable() {
  const kimiPath = await resolveKimiCommand();
  if (!kimiPath) {
    throw new Error("未找到 Kimi Code，请先安装或检查 PATH");
  }
  return kimiPath;
}

function spawnDetached(command: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function parseShortcut(shortcut: string): { modifiers: number[]; key: number } {
  const parts = shortcut
    .split("+")
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);
  if (parts.length === 0) throw new Error("快捷键不能为空");

  const modifierMap: Record<string, number> = {
    CTRL: 0x11,
    CONTROL: 0x11,
    ALT: 0x12,
    SHIFT: 0x10,
    WIN: 0x5B,
    WINDOWS: 0x5B,
    META: 0x5B,
    CMD: 0x5B,
    COMMAND: 0x5B,
  };
  const keyMap: Record<string, number> = {
    SPACE: 0x20,
    ENTER: 0x0D,
    RETURN: 0x0D,
    ESC: 0x1B,
    ESCAPE: 0x1B,
    TAB: 0x09,
    BACKSPACE: 0x08,
    DELETE: 0x2E,
    INSERT: 0x2D,
    HOME: 0x24,
    END: 0x23,
    PAGEUP: 0x21,
    PAGEDOWN: 0x22,
    UP: 0x26,
    DOWN: 0x28,
    LEFT: 0x25,
    RIGHT: 0x27,
  };
  for (let i = 1; i <= 24; i += 1) keyMap[`F${i}`] = 0x70 + i - 1;
  for (let code = 65; code <= 90; code += 1) keyMap[String.fromCharCode(code)] = code;
  for (let code = 48; code <= 57; code += 1) keyMap[String.fromCharCode(code)] = code;

  const modifiers: number[] = [];
  let key: number | null = null;
  parts.forEach((part) => {
    const modifier = modifierMap[part];
    if (modifier) {
      if (!modifiers.includes(modifier)) modifiers.push(modifier);
      return;
    }
    const mappedKey = keyMap[part];
    if (!mappedKey) throw new Error(`不支持的快捷键：${part}`);
    key = mappedKey;
  });
  if (!key) throw new Error("快捷键必须包含一个主按键");
  return { modifiers, key };
}

function triggerKeyboardShortcut(shortcut: string): Promise<void> {
  const { modifiers, key } = parseShortcut(shortcut);
  if (process.platform !== "win32") {
    throw new Error("当前快捷键触发仅支持 Windows");
  }
  const pressOrder = [...modifiers, key];
  const releaseOrder = [...pressOrder].reverse();
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class KeyboardSender {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@
$press = @(${pressOrder.join(",")})
$release = @(${releaseOrder.join(",")})
foreach ($key in $press) { [KeyboardSender]::keybd_event([byte]$key, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 24 }
foreach ($key in $release) { [KeyboardSender]::keybd_event([byte]$key, 0, 2, [UIntPtr]::Zero); Start-Sleep -Milliseconds 24 }
`;
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true, timeout: 3000 }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function openTerminalAt(dir: string) {
  if (process.platform === "win32") {
    const wtPath = await checkCommand("wt");
    if (wtPath) {
      await spawnDetached(wtPath, ["-d", dir], dir);
      return;
    }
    await spawnDetached("powershell.exe", ["-NoExit", "-NoLogo", "-Command", "Set-Location -LiteralPath $args[0]", dir], dir);
    return;
  }

  const terminal = await checkCommand("x-terminal-emulator") ?? await checkCommand("gnome-terminal") ?? await checkCommand("konsole");
  if (terminal) {
    await spawnDetached(terminal, [], dir);
    return;
  }

  throw new Error("未找到可用终端");
}

async function openEditorAt(target: "vscode" | "trae" | "coder", dir: string) {
  const command = target === "vscode" ? "code" : target;
  const commandPath = await checkCommand(command);
  if (!commandPath) {
    const label = target === "vscode" ? "VS Code" : target;
    throw new Error(`未找到 ${label} 命令`);
  }
  await spawnDetached(commandPath, [dir], dir);
}

async function openFileAt(filePath: string) {
  const codePath = await checkCommand("code");
  if (codePath) {
    try {
      await spawnDetached(codePath, ["-g", filePath], path.dirname(filePath));
      return;
    } catch (err) {
      console.warn("Failed to open file with VS Code, falling back to shell.openPath:", err);
    }
  }
  await shell.openPath(filePath);
}

async function launchExecutableFile(filePath: string) {
  if (!fs.existsSync(filePath)) throw new Error("文件不存在");
  const ext = path.extname(filePath).toLowerCase();
  const cwd = path.dirname(filePath);
  if (process.platform === "win32") {
    if (ext === ".bat" || ext === ".cmd") {
      await spawnDetached("cmd.exe", ["/c", "start", "", filePath], cwd);
      return;
    }
    if (ext === ".ps1") {
      await spawnDetached("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", filePath], cwd);
      return;
    }
  }
  try {
    await spawnDetached(filePath, [], cwd);
  } catch {
    const openError = await shell.openPath(filePath);
    if (openError) throw new Error(openError);
  }
}

async function launchShellCommand(command: string, cwd?: string) {
  const trimmed = command.trim();
  if (!trimmed) throw new Error("启动命令为空");
  const resolvedCwd = cwd && fs.existsSync(cwd) && fs.statSync(cwd).isDirectory() ? cwd : settingsService.getDefaultWorkDir();
  if (process.platform === "win32") {
    await spawnDetached("powershell.exe", ["-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", trimmed], resolvedCwd);
    return;
  }
  const shellPath = process.env.SHELL || (await resolveCommand("bash")) || (await resolveCommand("sh"));
  if (!shellPath) throw new Error("未找到可用 shell");
  await spawnDetached(shellPath, ["-lc", trimmed], resolvedCwd);
}

function resolveProjectFile(projectPath: string, filePath: string) {
  const resolvedProject = path.resolve(projectPath);
  const resolvedFile = path.resolve(resolvedProject, filePath);
  const relative = path.relative(resolvedProject, resolvedFile);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("File path escapes project");
  }
  return resolvedFile;
}

function normalizePreviewExtensions(input: unknown, fallback = ["md", "txt"]) {
  const raw = Array.isArray(input) ? input : fallback;
  const normalized = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase().replace(/^\.+/, ""))
    .filter((item) => /^[a-z0-9]{1,12}$/.test(item));
  return Array.from(new Set(normalized)).slice(0, 20);
}

function previewExtensionSet(input?: unknown) {
  return new Set(normalizePreviewExtensions(input).map((item) => `.${item}`));
}

const READABLE_TEXT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".json",
  ".log",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".csv",
  ".tsv",
]);

function isPathInside(parent: string, child: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveReadableTextFile(requestPath: string, projectPath?: string) {
  const trimmedPath = requestPath.trim();
  if (!trimmedPath) throw new Error("Missing file path");

  const kimiPlansDir = path.join(resolveKimiShareDir(), "plans");
  if (trimmedPath === "__latest_kimi_plan__") {
    const latest = fs.readdirSync(kimiPlansDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
      .map((entry) => {
        const filePath = path.join(kimiPlansDir, entry.name);
        const stat = fs.statSync(filePath);
        return { filePath, mtimeMs: stat.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    if (!latest) throw new Error("No Kimi plan file found");
    const stat = fs.statSync(latest.filePath);
    if (stat.size > 1024 * 1024) throw new Error("Text file is too large");
    return { resolvedFile: latest.filePath, updatedAt: stat.mtimeMs };
  }
  const normalizedRequest = trimmedPath.replace(/\\/g, "/");
  const isKimiPlanRelative = normalizedRequest.startsWith(".kimi/plans/") || normalizedRequest.startsWith(".kimi-code/plans/");
  const resolvedFile = isKimiPlanRelative
    ? path.resolve(os.homedir(), trimmedPath)
    : path.isAbsolute(trimmedPath)
      ? path.resolve(trimmedPath)
      : projectPath
        ? resolveProjectFile(projectPath, trimmedPath)
        : path.resolve(trimmedPath);

  const allowedProjectFile = Boolean(projectPath && isPathInside(projectPath, resolvedFile));
  const allowedKimiPlan = isPathInside(kimiPlansDir, resolvedFile) && path.extname(resolvedFile).toLowerCase() === ".md";
  if (!allowedProjectFile && !allowedKimiPlan) {
    throw new Error("File path is not allowed");
  }

  const ext = path.extname(resolvedFile).toLowerCase();
  if (!READABLE_TEXT_EXTENSIONS.has(ext)) {
    throw new Error("Only text files can be read");
  }

  const stat = fs.statSync(resolvedFile);
  if (!stat.isFile()) throw new Error("Path is not a file");
  if (stat.size > 1024 * 1024) throw new Error("Text file is too large");
  return { resolvedFile, updatedAt: stat.mtimeMs };
}

function listProjectPreviewFiles(projectPath: string, extensions?: unknown) {
  const resolvedProject = path.resolve(projectPath);
  const allowedExts = previewExtensionSet(extensions);
  if (!fs.existsSync(resolvedProject) || !fs.statSync(resolvedProject).isDirectory()) {
    throw new Error("Project path does not exist");
  }
  const results: Array<{
    path: string;
    name: string;
    extension: string;
    size: number;
    updatedAt: number;
    depth: number;
  }> = [];

  function addFile(relativePath: string, depth: number) {
    const fullPath = resolveProjectFile(resolvedProject, relativePath);
    const stat = fs.statSync(fullPath);
    const ext = path.extname(relativePath).toLowerCase();
    const extension = ext.replace(/^\./, "");
    if (!allowedExts.has(ext) || !READABLE_TEXT_EXTENSIONS.has(ext)) return;
    if (stat.size > 1024 * 1024) return;
    results.push({
      path: relativePath.replace(/\\/g, "/"),
      name: path.basename(relativePath),
      extension,
      size: stat.size,
      updatedAt: stat.mtimeMs,
      depth,
    });
  }

  const rootEntries = fs.readdirSync(resolvedProject, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (entry.name.startsWith(".") || FILE_SEARCH_IGNORES.has(entry.name)) continue;
    if (entry.isFile()) {
      addFile(entry.name, 0);
    }
  }

  for (const entry of rootEntries) {
    if (entry.name.startsWith(".") || FILE_SEARCH_IGNORES.has(entry.name) || !entry.isDirectory()) continue;
    const dirPath = path.join(resolvedProject, entry.name);
    let children: fs.Dirent[] = [];
    try {
      children = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      if (child.name.startsWith(".") || !child.isFile()) continue;
      addFile(path.join(entry.name, child.name), 1);
    }
  }

  return results
    .sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      return a.path.localeCompare(b.path, "zh-CN");
    })
    .map(({ depth: _depth, ...item }) => item);
}

// Log unhandled errors to prevent silent crashes
process.on("unhandledRejection", (reason) => {
  console.error("[MAIN] Unhandled Rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[MAIN] Uncaught Exception:", err);
});

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, "..");

export const DEV_SERVER_URL = process.env["ELECTRON_RENDERER_URL"] ?? process.env["VITE_DEV_SERVER_URL"];
const RENDERER_DIST = path.join(process.env.APP_ROOT, "..", "out", "renderer");

process.env.VITE_PUBLIC = DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

if (process.platform === "win32") {
  app.setAppUserModelId("com.kimix.app");
}

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let rendererReloadedAfterBlank = false;
let taskbarAttentionActive = false;
let taskbarOverlayIcon: Electron.NativeImage | null = null;
let lastRendererHeartbeat: { receivedAt: number; payload: RendererHeartbeatPayload | null } | null = null;
let rendererWatchdogTimer: NodeJS.Timeout | null = null;
let rendererWatchdogReported = false;
const mainStartupAt = Date.now();

const RENDERER_WATCHDOG_CHECK_MS = 3000;
const RENDERER_WATCHDOG_TIMEOUT_MS = 12000;

function logMainStartup(label: string, extra?: unknown) {
  const elapsedMs = Date.now() - mainStartupAt;
  if (extra === undefined) {
    console.info(`[KimixStartup] main ${label} ${elapsedMs}ms`);
    return;
  }
  console.info(`[KimixStartup] main ${label} ${elapsedMs}ms`, extra);
}

const FILE_SEARCH_IGNORES = new Set([
  ".git",
  "node_modules",
  "out",
  "dist",
  "build",
  ".vite",
  ".cache",
  ".dart_tool",
  ".gradle",
]);

const SKILL_SEARCH_IGNORES = new Set([
  ".git",
  "node_modules",
  "out",
  "dist",
  "build",
  ".vite",
  ".cache",
]);

function emitWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("window:maximized-change", {
    maximized: mainWindow.isMaximized(),
    fullscreen: mainWindow.isFullScreen(),
  });
}

function getTaskbarOverlayIcon() {
  if (taskbarOverlayIcon) return taskbarOverlayIcon;
  taskbarOverlayIcon = nativeImage.createFromDataURL("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAJ5SURBVFhH1VevTxxBFEZWIpH9E4oCRSpwGOQpgiE52aDOgcGRNMEUhSJBIAiqKCorECQYcJS2lKa99soBgQv0veabnRnefrvc3V7nBF/ymdl9v+e9tzsy8lwhIpOq+tqS30kKVR0TkbqIvNcuEJGPqtpQ1ZesYyCo6qiqLovILRvrBRF5B8dZZ99AWkWkxYqBu6MjvT04yLEMcFxEaqy7J1R1nqOG0ebSkn6emtJP4+MFnk1M6M9GQ2/2961YwDLbeBIwbiUfmk39sbhYMNiN3xcWtHNyYtUgG2/ZVgE+7TFyRP1lerpgoB8iI9d7e+xEnW1G+Jsea466stJBaJ3wwb1i2w5IUXjx/vx84MiZyIQth4jssO0QfUx91Zr34rdaLTrgkc+CHx4OqVLPvNrdjdYxI3IO+AnmgFZi4RS8mJuzDlzY6DHtsgedjqsZC6ci7pZBVga/WBzQdiyUktQR2YRU1dlwiCnGQil5ublpHXgTMlAPh+3t7YJQSrbW16MDcTwjFeEEKWKhlPyzsWEdaIQS4IPCYVgtGGhbETsnODAWTv622wWhlKSJOOkb0ZXhNDzAJmPBFPw6M2ONY+q+sA7EPTCsi9haW7MO5PcBhkJ8qupmNyv4H2KxYcgZzOYcAOBVeJr6MtIeOGTbDpwFDA1WNAh/r65atUAx+gC7FQH0LSuswl8rK1ZdcQuWQUS2rBDKUfXjBB+uuMwWfuM+3vyngJfYCVwgZAOtxMYs4ShSjnmSk8+Mj7KtrsCszmnxwDCBM5jrltikZfA/KL0jL4P/Sv7ASvuBiBx3vXBVAEUoC/+slMH/P2ZzfhjwywvdghJZ4rxSqv8B8Jd6o0/rE/wAAAAASUVORK5CYII=");
  return taskbarOverlayIcon;
}

function setTaskbarAttention() {
  taskbarAttentionActive = true;
  if (process.platform === "darwin") {
    app.setBadgeCount(1);
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (process.platform === "win32") {
    mainWindow.setOverlayIcon(getTaskbarOverlayIcon(), "Kimix 有已完成的轮次");
  } else {
    app.setBadgeCount(1);
  }
}

function clearTaskbarAttention() {
  if (!taskbarAttentionActive) return;
  taskbarAttentionActive = false;
  if (process.platform === "darwin") {
    app.setBadgeCount(0);
    return;
  }
  if (process.platform === "win32" && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setOverlayIcon(null, "");
    return;
  }
  app.setBadgeCount(0);
}

function showTurnCompleteNotification(title: string, body: string, rendererWindowFocused = false, rendererPageVisible = false) {
  const settings = settingsService.loadSettings();
  const notificationMode = settings.notificationMode ?? "unfocused";
  const windowFocused = rendererWindowFocused || Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused());
  if (notificationMode === "never") return;
  if (notificationMode === "unfocused" && windowFocused) return;
  if (!windowFocused) setTaskbarAttention();
  if (!Notification.isSupported()) return;
  const notification = new Notification({
    title: title.trim() || "Kimix 本轮已完成",
    body: body.trim() || "当前轮次处理已完成，可以回来查看结果。",
    silent: false,
  });
  notification.on("click", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    clearTaskbarAttention();
  });
  notification.show();
}

function verifyRendererContent() {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    win.webContents.executeJavaScript(`
      (() => {
        const root = document.getElementById("root");
        return {
          bodyTextLength: document.body?.innerText?.trim().length ?? 0,
          rootHtmlLength: root?.innerHTML?.trim().length ?? 0,
          rootChildCount: root?.childElementCount ?? 0,
        };
      })()
    `).then((result: { bodyTextLength: number; rootHtmlLength: number; rootChildCount: number }) => {
      if (result.rootHtmlLength === 0 && result.rootChildCount === 0 && !rendererReloadedAfterBlank) {
        rendererReloadedAfterBlank = true;
        console.log(`[RENDERER] content check rootHtml=${result.rootHtmlLength} bodyText=${result.bodyTextLength} children=${result.rootChildCount}`);
        console.warn("[RENDERER] blank root detected, reloading once");
        win.webContents.reloadIgnoringCache();
      }
    }).catch((err) => {
      console.error("[RENDERER] content check failed:", err);
    });
  }, 1800);
}

function ensureDirectoryExists(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function sanitizeFileNamePart(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-").replace(/\s+/g, "-").slice(0, 80);
}

function getRendererWatchdogLogDir() {
  return path.join(app.getPath("userData"), "freeze-reports");
}

function pruneRendererWatchdogReports(dir: string, keep = 20) {
  try {
    if (!fs.existsSync(dir)) return;
    const reports = fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^kimix-watchdog-freeze-.*\.json$/i.test(entry.name))
      .map((entry) => {
        const filePath = path.join(dir, entry.name);
        const stat = fs.statSync(filePath);
        return { filePath, mtimeMs: stat.mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    reports.slice(keep).forEach((report) => {
      try { fs.unlinkSync(report.filePath); } catch { /* ignore stale cleanup errors */ }
    });
  } catch (error) {
    console.warn("[watchdog] failed to prune renderer freeze reports:", error);
  }
}

function writeRendererWatchdogReport(stalledMs: number) {
  const win = mainWindow;
  const heartbeat = lastRendererHeartbeat;
  const sessionId = heartbeat?.payload?.currentSession?.id ?? heartbeat?.payload?.runningSessionId ?? "no-session";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `kimix-watchdog-freeze-${stamp}-${sanitizeFileNamePart(sessionId)}.json`;
  const filePath = path.join(getRendererWatchdogLogDir(), filename);
  const report = {
    source: "main-process-renderer-watchdog",
    reason: "renderer heartbeat timeout",
    createdAt: new Date().toISOString(),
    stalledMs: Math.round(stalledMs),
    thresholds: {
      checkMs: RENDERER_WATCHDOG_CHECK_MS,
      timeoutMs: RENDERER_WATCHDOG_TIMEOUT_MS,
    },
    app: {
      version: app.getVersion(),
      name: app.getName(),
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      userData: app.getPath("userData"),
    },
    process: {
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      uptime: Math.round(process.uptime()),
      memoryUsage: process.memoryUsage(),
    },
    window: win && !win.isDestroyed() ? {
      id: win.id,
      visible: win.isVisible(),
      focused: win.isFocused(),
      minimized: win.isMinimized(),
      maximized: win.isMaximized(),
      fullscreen: win.isFullScreen(),
      bounds: win.getBounds(),
      webContentsDestroyed: win.webContents.isDestroyed(),
      rendererProcessId: win.webContents.getOSProcessId(),
      url: win.webContents.getURL(),
      title: win.webContents.getTitle(),
    } : null,
    kimiCode: {
      activeSessionIds: kimiCodeHost.getActiveSessionIds(),
    },
    lastHeartbeat: heartbeat ? {
      receivedAt: new Date(heartbeat.receivedAt).toISOString(),
      ageMs: Math.max(0, Date.now() - heartbeat.receivedAt),
      payload: heartbeat.payload,
    } : null,
  };
  ensureDirectoryExists(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), "utf-8");
  pruneRendererWatchdogReports(path.dirname(filePath));
  console.warn(`[watchdog] renderer heartbeat stalled for ${Math.round(stalledMs)}ms, report written: ${filePath}`);
  return filePath;
}

function checkRendererHeartbeat() {
  if (!mainWindow || mainWindow.isDestroyed() || isQuitting) return;
  if (!lastRendererHeartbeat) return;
  const stalledMs = Date.now() - lastRendererHeartbeat.receivedAt;
  if (stalledMs < RENDERER_WATCHDOG_TIMEOUT_MS) {
    rendererWatchdogReported = false;
    return;
  }
  if (rendererWatchdogReported) return;
  rendererWatchdogReported = true;
  try {
    writeRendererWatchdogReport(stalledMs);
  } catch (error) {
    console.error("[watchdog] failed to write renderer freeze report:", error);
  }
}

function startRendererWatchdog() {
  if (rendererWatchdogTimer) clearInterval(rendererWatchdogTimer);
  rendererWatchdogReported = false;
  lastRendererHeartbeat = null;
  rendererWatchdogTimer = setInterval(checkRendererHeartbeat, RENDERER_WATCHDOG_CHECK_MS);
}

function stopRendererWatchdog() {
  if (!rendererWatchdogTimer) return;
  clearInterval(rendererWatchdogTimer);
  rendererWatchdogTimer = null;
}

function parseVersion(version: string): number[] {
  return version.replace(/^v/i, "").split(".").map((part) => {
    const parsed = Number.parseInt(part.replace(/\D.*/, ""), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
}

function isVersionGreater(a: string, b: string): boolean {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

function mapGitHubRelease(data: {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  published_at?: unknown;
  html_url?: unknown;
  assets?: unknown;
}) {
  const assets = Array.isArray(data.assets) ? data.assets : [];
  return {
    tagName: typeof data.tag_name === "string" ? data.tag_name : "",
    name: typeof data.name === "string" ? data.name : "",
    body: typeof data.body === "string" ? data.body : "",
    publishedAt: typeof data.published_at === "string" ? data.published_at : "",
    htmlUrl: typeof data.html_url === "string" ? data.html_url : `https://github.com/${GITHUB_REPO}/releases`,
    assets: assets
      .filter((asset): asset is { name?: unknown; browser_download_url?: unknown; size?: unknown } => typeof asset === "object" && asset !== null)
      .map((asset) => ({
        name: typeof asset.name === "string" ? asset.name : "下载文件",
        downloadUrl: typeof asset.browser_download_url === "string" ? asset.browser_download_url : "",
        size: typeof asset.size === "number" && Number.isFinite(asset.size) ? asset.size : undefined,
      }))
      .filter((asset) => asset.downloadUrl.length > 0),
  };
}

async function fetchReleaseAtom(limit: number) {
  const res = await fetchGitHubUpdateUrl(`https://github.com/${GITHUB_REPO}/releases.atom`, {
    headers: { "User-Agent": "Kimix" },
  });
  if (!res.ok) throw new Error(`GitHub Releases 返回 ${res.status}`);
  return parseReleaseAtom(await res.text(), limit, `https://github.com/${GITHUB_REPO}/releases`);
}

async function fetchRecentReleases(limit = 3) {
  const res = await fetchGitHubUpdateUrl(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=${limit}`, {
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": "Kimix",
    },
  });
  if (res.status === 403 || res.status === 429) return fetchReleaseAtom(limit);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GitHub 返回 ${res.status}`);
  const data = await res.json() as unknown;
  if (!Array.isArray(data)) return [];
  return data
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map(mapGitHubRelease)
    .filter((release) => release.tagName);
}

async function fetchLatestRelease() {
  return (await fetchRecentReleases(1))[0] ?? null;
}

type ReleaseAssetInfo = {
  name: string;
  downloadUrl: string;
  size?: number;
};

let githubUpdateSessionPromise: Promise<Electron.Session> | null = null;

function getUpdateProxyRules() {
  const proxyValue = [process.env.HTTPS_PROXY, process.env.HTTP_PROXY, process.env.ALL_PROXY]
    .find((value) => typeof value === "string" && value.trim())
    ?.trim();
  if (!proxyValue) return undefined;
  try {
    const proxy = new URL(proxyValue);
    const hostPort = `${proxy.hostname}${proxy.port ? `:${proxy.port}` : ""}`;
    if (proxy.protocol.startsWith("socks")) return proxyValue;
    return `http=${hostPort};https=${hostPort}`;
  } catch {
    return undefined;
  }
}

async function getGitHubUpdateSession() {
  if (!githubUpdateSessionPromise) {
    githubUpdateSessionPromise = (async () => {
      const updateSession = session.fromPartition("persist:kimix-github-updates");
      const proxyRules = getUpdateProxyRules();
      await updateSession.setProxy({
        mode: proxyRules ? "fixed_servers" : "system",
        proxyRules,
        proxyBypassRules: process.env.NO_PROXY?.trim() || "localhost,127.0.0.1,::1",
      });
      return updateSession;
    })();
  }
  return githubUpdateSessionPromise;
}

async function fetchGitHubUpdateUrl(url: string, init?: RequestInit) {
  try {
    const updateSession = await getGitHubUpdateSession();
    return await updateSession.fetch(url, init);
  } catch (sessionError) {
    try {
      return await fetch(url, init);
    } catch (directError) {
      const detail = sessionError instanceof Error ? sessionError.message : directError instanceof Error ? directError.message : String(sessionError);
      throw new Error(`GitHub 请求失败：${detail}`);
    }
  }
}

function emitDownloadUpdateProgress(receivedBytes: number, totalBytes?: number, bytesPerSecond?: number) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const percent = totalBytes && totalBytes > 0
    ? Math.max(0, Math.min(100, (receivedBytes / totalBytes) * 100))
    : 0;
  mainWindow.webContents.send("app:downloadUpdateProgress", {
    percent,
    receivedBytes,
    totalBytes,
    bytesPerSecond,
  });
}

function runLongCommandWithOutput(command: string, args: string[], timeoutMs = 10 * 60 * 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" }, (error, stdout, stderr) => {
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();
      if (error) {
        reject(new Error(output || error.message));
        return;
      }
      resolve(output);
    });
    child.on("error", reject);
  });
}

function emitKimiCodeInstallProgress(payload: {
  phase: "script" | "manifest" | "binary" | "install" | "done";
  message: string;
  receivedBytes?: number;
  totalBytes?: number;
  percent?: number;
  bytesPerSecond?: number;
}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("app:downloadUpdateProgress", {
    scope: "kimi-code",
    phase: payload.phase,
    message: payload.message,
    receivedBytes: payload.receivedBytes ?? 0,
    totalBytes: payload.totalBytes,
    bytesPerSecond: payload.bytesPerSecond,
    percent: payload.percent ?? (payload.totalBytes && payload.totalBytes > 0 ? Math.max(0, Math.min(100, ((payload.receivedBytes ?? 0) / payload.totalBytes) * 100)) : 0),
  });
}

async function downloadBufferWithProgress(url: string, phase: "script" | "manifest" | "binary", message: string) {
  const startedAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": "Kimix" } });
  if (!res.ok) throw new Error(`${message}失败：HTTP ${res.status}`);
  const totalBytes = Number(res.headers.get("content-length") || 0) || undefined;
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  emitKimiCodeInstallProgress({ phase, message, receivedBytes, totalBytes });
  if (!res.body) {
    const buffer = Buffer.from(await res.arrayBuffer());
    emitKimiCodeInstallProgress({ phase, message, receivedBytes: buffer.length, totalBytes: totalBytes ?? buffer.length, percent: 100 });
    return buffer;
  }
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    receivedBytes += value.byteLength;
    const elapsedSeconds = Math.max(0.001, (Date.now() - startedAt) / 1000);
    emitKimiCodeInstallProgress({
      phase,
      message,
      receivedBytes,
      totalBytes,
      bytesPerSecond: receivedBytes / elapsedSeconds,
    });
  }
  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  emitKimiCodeInstallProgress({ phase, message, receivedBytes: buffer.length, totalBytes: totalBytes ?? buffer.length, percent: 100 });
  return buffer;
}

function isPortableRuntime() {
  if (process.platform !== "win32") return false;
  const exeName = path.basename(process.execPath).toLowerCase();
  return /^kimix\s+\d/.test(exeName) || exeName.includes("portable");
}

function pickUpdateAsset(assets: ReleaseAssetInfo[]) {
  const names = assets.map((asset) => ({ ...asset, lowerName: asset.name.toLowerCase() }));
  if (process.platform === "win32") {
    const portable = isPortableRuntime();
    const preferred = portable
      ? names.find((asset) => asset.lowerName.endsWith(".exe") && !asset.lowerName.includes("setup"))
      : names.find((asset) => asset.lowerName.includes("setup") && asset.lowerName.endsWith(".exe"));
    return preferred ?? names.find((asset) => asset.lowerName.endsWith(".exe")) ?? null;
  }
  if (process.platform === "darwin") {
    return names.find((asset) => asset.lowerName.endsWith(".dmg")) ??
      names.find((asset) => asset.lowerName.endsWith(".zip")) ??
      null;
  }
  return names.find((asset) => asset.lowerName.endsWith(".appimage")) ??
    names.find((asset) => asset.lowerName.endsWith(".deb")) ??
    null;
}

function sanitizeDownloadName(name: string) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim() || "Kimix-update";
}

function normalizeKimiExportSessionId(sessionId?: string) {
  const trimmed = sessionId?.trim();
  if (!trimmed || trimmed.startsWith("kimix-prompt-") || trimmed.startsWith("creating-")) return "";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return `session_${trimmed}`;
  }
  return trimmed;
}

async function exportMarkdownDocument(request: unknown) {
  const parsed = z.object({
    title: z.string().trim().optional(),
    content: z.string().min(1),
  }).parse(request);
  const defaultName = `${sanitizeDownloadName(parsed.title || "Kimix 会话")}-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
  const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
    title: "导出 Markdown",
    defaultPath: path.join(app.getPath("downloads"), defaultName),
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (result.canceled || !result.filePath) {
    return { path: "", output: "用户取消导出" };
  }
  ensureDirectoryExists(path.dirname(result.filePath));
  fs.writeFileSync(result.filePath, parsed.content, "utf-8");
  await shell.showItemInFolder(result.filePath);
  return { path: result.filePath, output: "Markdown 导出完成" };
}
async function exportKimiSessionArchive(request: { sessionId?: string; title?: string }) {
  const defaultName = `${sanitizeDownloadName(request.title || "Kimi 会话")}-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
  const result = await dialog.showSaveDialog({
    title: "导出 Kimi Debug ZIP",
    defaultPath: path.join(app.getPath("downloads"), defaultName),
    filters: [{ name: "ZIP 归档", extensions: ["zip"] }],
  });
  if (result.canceled || !result.filePath) {
    return { path: "", output: "用户取消导出" };
  }
  ensureDirectoryExists(path.dirname(result.filePath));
  const exportSessionId = normalizeKimiExportSessionId(request.sessionId);
  if (!exportSessionId) throw new Error("缺少可导出的官方 Kimi Code sessionId");
  let fallbackKimiPath: string | null = null;
  try {
    const sdkResult = await kimiCodeHost.exportSession({
      id: exportSessionId,
      outputPath: result.filePath,
      includeGlobalLog: true,
    });
    await shell.showItemInFolder(sdkResult.zipPath || result.filePath);
    return {
      path: sdkResult.zipPath || result.filePath,
      output: `SDK export completed: ${sdkResult.entries.length} entries`,
    };
  } catch (sdkError) {
    fallbackKimiPath = await resolveKimiCommand();
    if (!fallbackKimiPath) {
      throw new Error(`官方配置导出失败，且未找到 Kimi Code 兼容配置：${sdkError instanceof Error ? sdkError.message : String(sdkError)}`);
    }
    console.warn("[kimi-code] SDK export failed, falling back to CLI export:", sdkError);
  }
  const args = ["export", ...(exportSessionId ? [exportSessionId] : []), "-o", result.filePath, "-y"];
  const output = await runLongCommand(fallbackKimiPath, args, 2 * 60 * 1000);
  await shell.showItemInFolder(result.filePath);
  return { path: result.filePath, output: `Kimi Code fallback export completed\n${output}` };
}

const SESSION_BACKUP_SCHEMA_VERSION = 1;

function emptySessionBackupSnapshot(): SessionBackupSnapshot {
  return {
    schemaVersion: SESSION_BACKUP_SCHEMA_VERSION,
    appVersion: app.getVersion(),
    exportedAt: new Date().toISOString(),
    source: "Kimix",
    sessions: [],
    pendingMessages: [],
    projects: [],
    archivedTombstones: [],
    hiddenHandoffSessionIds: [],
  };
}

function asPlainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function unknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))))
    : [];
}

function normalizeSessionBackupSnapshot(value: unknown): SessionBackupSnapshot {
  const record = asPlainRecord(value);
  if (!record) throw new Error("会话快照格式无效");
  const schemaVersion = typeof record.schemaVersion === "number" && Number.isFinite(record.schemaVersion)
    ? record.schemaVersion
    : SESSION_BACKUP_SCHEMA_VERSION;
  return {
    schemaVersion,
    appVersion: typeof record.appVersion === "string" ? record.appVersion : undefined,
    exportedAt: typeof record.exportedAt === "string" ? record.exportedAt : undefined,
    source: typeof record.source === "string" ? record.source : undefined,
    sessions: unknownArray(record.sessions),
    pendingMessages: unknownArray(record.pendingMessages),
    projects: unknownArray(record.projects),
    archivedTombstones: unknownArray(record.archivedTombstones ?? record.archivedSessionTombstones),
    hiddenHandoffSessionIds: stringArray(record.hiddenHandoffSessionIds),
    activeContext: record.activeContext,
  };
}

function addBackupJson(zip: AdmZip, name: string, value: unknown) {
  zip.addFile(name, Buffer.from(JSON.stringify(value, null, 2), "utf8"));
}

async function readFileIfExists(filePath: string) {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function exportSessionBackupArchive(request: unknown) {
  const req = asPlainRecord(request);
  if (!req) throw new Error("缺少导出请求");
  const snapshot = normalizeSessionBackupSnapshot(req.snapshot);
  const suggestedName = typeof req.suggestedName === "string" && req.suggestedName.trim()
    ? req.suggestedName.trim()
    : "Kimix 会话快照";
  const defaultName = `${sanitizeDownloadName(suggestedName)}-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
  const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
    title: "导出 Kimix 会话快照",
    defaultPath: path.join(app.getPath("downloads"), defaultName),
    filters: [{ name: "Kimix 会话快照", extensions: ["zip"] }],
  });
  if (result.canceled || !result.filePath) {
    return { path: "", output: "用户取消导出" };
  }
  ensureDirectoryExists(path.dirname(result.filePath));
  const zip = new AdmZip();
  const fullSnapshot: SessionBackupSnapshot = {
    ...snapshot,
    schemaVersion: SESSION_BACKUP_SCHEMA_VERSION,
    exportedAt: snapshot.exportedAt || new Date().toISOString(),
    source: snapshot.source || "Kimix",
  };
  addBackupJson(zip, "manifest.json", {
    schemaVersion: fullSnapshot.schemaVersion,
    appVersion: fullSnapshot.appVersion,
    exportedAt: fullSnapshot.exportedAt,
    source: fullSnapshot.source,
    counts: {
      sessions: fullSnapshot.sessions.length,
      pendingMessages: fullSnapshot.pendingMessages.length,
      projects: fullSnapshot.projects.length,
      archivedTombstones: fullSnapshot.archivedTombstones.length,
      hiddenHandoffSessionIds: fullSnapshot.hiddenHandoffSessionIds.length,
    },
  });
  addBackupJson(zip, "sessions.json", fullSnapshot.sessions);
  addBackupJson(zip, "pending.json", fullSnapshot.pendingMessages);
  addBackupJson(zip, "projects.json", fullSnapshot.projects);
  addBackupJson(zip, "archived-tombstones.json", fullSnapshot.archivedTombstones);
  addBackupJson(zip, "hidden-handoff-session-ids.json", fullSnapshot.hiddenHandoffSessionIds);
  addBackupJson(zip, "active-context.json", fullSnapshot.activeContext ?? null);
  addBackupJson(zip, "snapshot.json", fullSnapshot);
  await zip.writeZipPromise(result.filePath, { overwrite: true });
  await shell.showItemInFolder(result.filePath);
  return { path: result.filePath, output: "Kimix 会话快照导出完成" };
}

function parseBackupJsonText(text: string, label: string) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} 不是有效 JSON：${error instanceof Error ? error.message : String(error)}`);
  }
}

function readZipJson(zip: AdmZip, name: string) {
  const entry = zip.getEntry(name);
  if (!entry) return undefined;
  return parseBackupJsonText(entry.getData().toString("utf8"), name);
}

async function readSessionBackupSnapshot(filePath: string): Promise<SessionBackupSnapshot> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") {
    const text = await fs.promises.readFile(filePath, "utf8");
    return normalizeSessionBackupSnapshot(parseBackupJsonText(text, path.basename(filePath)));
  }
  if (ext !== ".zip") throw new Error("请选择 .zip 或 .json 会话快照文件");
  const zip = new AdmZip(await fs.promises.readFile(filePath));
  const snapshot = readZipJson(zip, "snapshot.json");
  if (snapshot) return normalizeSessionBackupSnapshot(snapshot);
  return normalizeSessionBackupSnapshot({
    schemaVersion: SESSION_BACKUP_SCHEMA_VERSION,
    sessions: readZipJson(zip, "sessions.json") ?? [],
    pendingMessages: readZipJson(zip, "pending.json") ?? [],
    projects: readZipJson(zip, "projects.json") ?? [],
    archivedTombstones: readZipJson(zip, "archived-tombstones.json") ?? [],
    hiddenHandoffSessionIds: readZipJson(zip, "hidden-handoff-session-ids.json") ?? [],
    activeContext: readZipJson(zip, "active-context.json") ?? undefined,
  });
}

async function importSessionBackupArchive(request?: ImportSessionBackupRequest) {
  if (request?.path) {
    const filePath = path.resolve(request.path);
    if (!await readFileIfExists(filePath)) throw new Error("快照文件不存在");
    return { path: filePath, snapshot: await readSessionBackupSnapshot(filePath), canceled: false };
  }
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    title: "导入 Kimix 会话快照",
    properties: ["openFile"],
    filters: [
      { name: "Kimix 会话快照", extensions: ["zip", "json"] },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { path: "", snapshot: emptySessionBackupSnapshot(), canceled: true };
  }
  const filePath = result.filePaths[0];
  return { path: filePath, snapshot: await readSessionBackupSnapshot(filePath), canceled: false };
}

async function downloadUpdateAsset(asset: ReleaseAssetInfo, tagName: string) {
  const updateDir = path.join(app.getPath("downloads"), "Kimix Updates", sanitizeDownloadName(tagName || "latest"));
  ensureDirectoryExists(updateDir);
  const targetPath = path.join(updateDir, sanitizeDownloadName(asset.name));
  const tempPath = `${targetPath}.download`;
  const response = await fetchGitHubUpdateUrl(asset.downloadUrl, {
    headers: {
      "User-Agent": "Kimix",
    },
  }).catch((error) => {
    throw new Error(`下载失败：${error instanceof Error ? error.message : String(error)}`);
  });
  if (!response.ok) throw new Error(`下载失败：GitHub 返回 ${response.status}`);
  const totalBytesHeader = response.headers.get("content-length");
  const parsedTotalBytes = totalBytesHeader ? Number.parseInt(totalBytesHeader, 10) : undefined;
  const totalBytes = Number.isFinite(parsedTotalBytes) && parsedTotalBytes && parsedTotalBytes > 0
    ? parsedTotalBytes
    : asset.size;
  let receivedBytes = 0;
  const startedAt = Date.now();
  const knownTotalBytes = Number.isFinite(totalBytes) ? totalBytes : undefined;
  const speed = () => {
    const seconds = Math.max(0.25, (Date.now() - startedAt) / 1000);
    return receivedBytes / seconds;
  };
  emitDownloadUpdateProgress(0, knownTotalBytes, 0);
  try {
    await fs.promises.rm(tempPath, { force: true });
    const writer = fs.createWriteStream(tempPath);
    try {
      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          const chunk = Buffer.from(value);
          await new Promise<void>((resolve, reject) => {
            writer.write(chunk, (err) => err ? reject(err) : resolve());
          });
          receivedBytes += chunk.length;
          emitDownloadUpdateProgress(receivedBytes, knownTotalBytes, speed());
        }
      } else {
        const bytes = Buffer.from(await response.arrayBuffer());
        await new Promise<void>((resolve, reject) => {
          writer.write(bytes, (err) => err ? reject(err) : resolve());
        });
        receivedBytes = bytes.length;
        emitDownloadUpdateProgress(receivedBytes, receivedBytes, speed());
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        writer.end((err?: Error | null) => err ? reject(err) : resolve());
      });
    }
    emitDownloadUpdateProgress(receivedBytes, knownTotalBytes ?? receivedBytes, speed());
    await fs.promises.rename(tempPath, targetPath);
  } catch (err) {
    await fs.promises.rm(tempPath, { force: true }).catch(() => {});
    throw err;
  }
  return targetPath;
}

function searchProjectFiles(projectPath: string, query = "", limit = 40, additionalWorkDirs: string[] = []) {
  const normalizedQuery = query.trim().toLowerCase();
  const maxResults = Math.max(1, Math.min(limit, 80));
  const results: { path: string; name: string; rootPath?: string; sourceLabel?: string }[] = [];
  const roots = [
    { root: path.resolve(projectPath), sourceLabel: "当前项目", useAbsolutePath: false },
    ...additionalWorkDirs.map((dir) => ({ root: path.resolve(dir), sourceLabel: path.basename(path.resolve(dir)) || "额外目录", useAbsolutePath: true })),
  ].filter((entry, index, entries) => (
    fs.existsSync(entry.root) &&
    entries.findIndex((candidate) => candidate.root.toLowerCase() === entry.root.toLowerCase()) === index
  ));

  function walk(root: string, dir: string, depth: number, sourceLabel: string, useAbsolutePath: boolean) {
    if (results.length >= maxResults || depth > 32) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxResults) return;
      if (entry.name.startsWith(".") && entry.name !== ".env") continue;
      if (FILE_SEARCH_IGNORES.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(root, fullPath).replace(/\\/g, "/");
      const candidatePath = useAbsolutePath ? fullPath.replace(/\\/g, "/") : relativePath;
      if (entry.isDirectory()) {
        walk(root, fullPath, depth + 1, sourceLabel, useAbsolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (normalizedQuery && !relativePath.toLowerCase().includes(normalizedQuery) && !candidatePath.toLowerCase().includes(normalizedQuery)) continue;
      results.push({ path: candidatePath, name: entry.name, rootPath: root, sourceLabel });
    }
  }

  for (const root of roots) {
    if (results.length >= maxResults) break;
    walk(root.root, root.root, 0, root.sourceLabel, root.useAbsolutePath);
  }
  return results;
}

function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fields: { name?: string; description?: string } = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim().replace(/^["']|["']$/g, "");
    if (key === "name") fields.name = value;
    if (key === "description") fields.description = value;
  }
  return fields;
}

function listLocalSkills() {
  const roots = [
    path.join(os.homedir(), ".kimix", "skills"),
    path.join(os.homedir(), ".kimi-code", "skills"),
    path.join(os.homedir(), ".kimi-code", "plugins"),
    path.join(os.homedir(), ".kimi", "skills"),
    path.join(os.homedir(), ".agents", "skills"),
    path.join(os.homedir(), ".config", "agents", "skills"),
    path.join(os.homedir(), ".codex", "skills"),
  ];
  const settings = settingsService.loadSettings();
  const enabled = new Set(settings.enabledSkillNames ?? []);
  const results: { name: string; description: string; path: string; source: string; sourceLabel: string; trustLevel: "kimi-official" | "curated" | "third-party" | "local"; enabled: boolean }[] = [];
  const seen = new Set<string>();

  function classifySkillSource(root: string, skillPath: string) {
    const normalizedRoot = root.replace(/\\/g, "/").toLowerCase();
    const normalizedPath = skillPath.replace(/\\/g, "/").toLowerCase();
    if (normalizedPath.includes("/.kimi-code/plugins/")) {
      return { sourceLabel: "Kimi Plugin", trustLevel: "kimi-official" as const };
    }
    if (normalizedPath.includes("/superpowers/") || normalizedPath.includes("/.codex/plugins/cache/")) {
      return { sourceLabel: "Curated", trustLevel: "curated" as const };
    }
    if (normalizedRoot.includes("/.kimix/skills")) {
      return { sourceLabel: "Kimix 导入", trustLevel: "third-party" as const };
    }
    if (normalizedRoot.includes("/.kimi-code/skills")) {
      return { sourceLabel: "Kimi Code 用户 Skill", trustLevel: "local" as const };
    }
    return { sourceLabel: "本地 Skill", trustLevel: "local" as const };
  }

  function collectSkillFiles(root: string) {
    const skillFiles: string[] = [];

    function walk(dir: string, depth: number) {
      if (depth > 5) return;
      const skillPath = path.join(dir, "SKILL.md");
      if (fs.existsSync(skillPath)) {
        skillFiles.push(skillPath);
        return;
      }

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (SKILL_SEARCH_IGNORES.has(entry.name)) continue;
        walk(path.join(dir, entry.name), depth + 1);
      }
    }

    walk(root, 0);
    return skillFiles;
  }

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    if (root.replace(/\\/g, "/").toLowerCase().includes("/.kimi-code/plugins")) {
      const normalizedRoot = path.resolve(root);
      for (const manifestPath of findPluginManifestFiles().filter((item) => path.resolve(item).startsWith(normalizedRoot))) {
        const normalizedManifestPath = path.resolve(manifestPath);
        if (seen.has(normalizedManifestPath)) continue;
        // SDK-managed plugins (plugins/managed/...) are surfaced and toggled in the
        // dedicated "官方 SDK 插件状态" panel; don't duplicate them as un-toggleable
        // local-skill cards here.
        if (normalizedManifestPath.replace(/\\/g, "/").toLowerCase().includes("/plugins/managed/")) {
          seen.add(normalizedManifestPath);
          continue;
        }
        try {
          const raw = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
          const pluginPath = pluginRootFromManifest(manifestPath);
          const interfaceInfo = raw.interface && typeof raw.interface === "object" ? raw.interface as Record<string, unknown> : {};
          const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : path.basename(pluginPath);
          const displayName = typeof interfaceInfo.displayName === "string" && interfaceInfo.displayName.trim() ? interfaceInfo.displayName.trim() : name;
          const description = typeof interfaceInfo.shortDescription === "string" && interfaceInfo.shortDescription.trim()
            ? interfaceInfo.shortDescription.trim()
            : typeof raw.description === "string" && raw.description.trim()
            ? raw.description.trim()
            : "Kimi Plugin";
          results.push({
            name: displayName,
            description,
            path: manifestPath,
            source: root,
            sourceLabel: "Kimi Plugin",
            trustLevel: "kimi-official",
            enabled: true,
          });
          seen.add(normalizedManifestPath);
        } catch {
          // Ignore malformed plugin manifests; Plugin management surfaces install errors separately.
        }
      }
      continue;
    }
    for (const skillPath of collectSkillFiles(root)) {
      const normalizedSkillPath = path.resolve(skillPath);
      if (seen.has(normalizedSkillPath)) continue;
      try {
        const raw = fs.readFileSync(skillPath, "utf-8");
        const meta = parseSkillFrontmatter(raw);
        const skillDir = path.dirname(skillPath);
        const fallbackName = path.basename(skillDir);
        const sourceInfo = classifySkillSource(root, skillPath);
        results.push({
          name: meta.name || fallbackName,
          description: meta.description || "本地 Skill",
          path: skillPath,
          source: root,
          sourceLabel: sourceInfo.sourceLabel,
          trustLevel: sourceInfo.trustLevel,
          enabled: enabled.has(meta.name || fallbackName),
        });
        seen.add(normalizedSkillPath);
      } catch {
        // Ignore unreadable skill files.
      }
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

function enabledSkillsDir() {
  return path.join(os.homedir(), ".kimix", "enabled-skills");
}

function importedSkillsDir() {
  return path.join(os.homedir(), ".kimix", "skills");
}

function sanitizeSkillDirName(name: string) {
  return (name || "imported-skill").replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_").trim() || "imported-skill";
}

function uniqueTargetDir(baseDir: string, preferredName: string) {
  const safeName = sanitizeSkillDirName(preferredName);
  let target = path.join(baseDir, safeName);
  let index = 2;
  while (fs.existsSync(target)) {
    target = path.join(baseDir, `${safeName}-${index}`);
    index += 1;
  }
  return target;
}

function copyDirectorySafe(sourceDir: string, targetDir: string) {
  const resolvedSource = path.resolve(sourceDir);
  const resolvedTarget = path.resolve(targetDir);
  fs.mkdirSync(resolvedTarget, { recursive: true });

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const sourcePath = path.join(dir, entry.name);
      const relative = path.relative(resolvedSource, sourcePath);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("Skill path escapes source directory");
      }
      const targetPath = path.join(resolvedTarget, relative);
      if (entry.isDirectory()) {
        fs.mkdirSync(targetPath, { recursive: true });
        walk(sourcePath);
      } else if (entry.isFile()) {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.copyFileSync(sourcePath, targetPath);
      }
    }
  }

  walk(resolvedSource);
}

function extractArchiveSafe(archivePath: string, targetDir: string) {
  const zip = new AdmZip(archivePath);
  const resolvedTarget = path.resolve(targetDir);
  fs.mkdirSync(resolvedTarget, { recursive: true });

  for (const entry of zip.getEntries()) {
    const entryName = entry.entryName.replace(/\\/g, "/");
    if (!entryName || entryName.startsWith("/") || /^[a-zA-Z]:\//.test(entryName)) {
      throw new Error("压缩包包含不安全路径");
    }
    const targetPath = path.resolve(resolvedTarget, entryName);
    const relative = path.relative(resolvedTarget, targetPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("压缩包路径越界");
    }
    if (entry.isDirectory) {
      fs.mkdirSync(targetPath, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, entry.getData());
  }
}

function findSkillFiles(root: string) {
  const skillFiles: string[] = [];

  function walk(dir: string, depth: number) {
    if (depth > 6) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === "SKILL.md") {
        skillFiles.push(fullPath);
      } else if (entry.isDirectory() && !SKILL_SEARCH_IGNORES.has(entry.name)) {
        walk(fullPath, depth + 1);
      }
    }
  }

  walk(root, 0);
  return skillFiles;
}

function importSkillArchive(archivePath: string) {
  if (!archivePath || !fs.existsSync(archivePath)) {
    throw new Error("压缩包不存在");
  }
  if (path.extname(archivePath).toLowerCase() !== ".zip") {
    throw new Error("目前仅支持 .zip 技能压缩包");
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kimix-skill-"));
  try {
    extractArchiveSafe(archivePath, tempDir);
    const skillFiles = findSkillFiles(tempDir);
    if (skillFiles.length === 0) {
      throw new Error("压缩包内未找到 SKILL.md");
    }

    const importedRoot = importedSkillsDir();
    fs.mkdirSync(importedRoot, { recursive: true });
    const imported: { name: string; description: string; path: string; source: string; enabled: boolean }[] = [];

    for (const skillPath of skillFiles) {
      const raw = fs.readFileSync(skillPath, "utf-8");
      const meta = parseSkillFrontmatter(raw);
      const sourceDir = path.dirname(skillPath);
      const fallbackName = path.basename(sourceDir);
      const skillName = meta.name || fallbackName;
      const targetDir = uniqueTargetDir(importedRoot, skillName);
      copyDirectorySafe(sourceDir, targetDir);
      imported.push({
        name: skillName,
        description: meta.description || "导入的 Skill",
        path: path.join(targetDir, "SKILL.md"),
        source: importedRoot,
        enabled: false,
      });
    }

    return imported;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function syncEnabledSkills(names: string[]) {
  const uniqueNames = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
  const allSkills = listLocalSkills();
  const byName = new Map(allSkills.map((skill) => [skill.name, skill]));
  const targetDir = enabledSkillsDir();
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  for (const name of uniqueNames) {
    const skill = byName.get(name);
    if (!skill) continue;
    const sourceDir = path.dirname(skill.path);
    const targetSkillDir = path.join(targetDir, name.replace(/[<>:"/\\|?*]+/g, "_"));
    fs.cpSync(sourceDir, targetSkillDir, { recursive: true });
  }
  settingsService.saveSettings({ enabledSkillNames: uniqueNames, enabledSkillsDir: targetDir });
  return { enabledNames: uniqueNames, enabledDir: targetDir };
}

function prepareLocalSkillForKimi(name: string) {
  const normalizedName = name.trim().toLowerCase();
  if (!normalizedName) throw new Error("Skill 名称不能为空");
  const skill = listLocalSkills().find((item) => item.name.toLowerCase() === normalizedName);
  if (!skill) throw new Error(`未找到 Skill：${name}`);

  return prepareSkillDirectoryForKimi(skill.path, skill.name, resolveKimiShareDir());
}

function syncInstalledAgentSkillsForKimi() {
  const agentSkillsRoot = path.join(os.homedir(), ".agents", "skills");
  return syncAgentSkillDirectories(agentSkillsRoot, resolveKimiShareDir());
}

type KimiOAuthToken = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
  token_type: string;
  expires_in?: number;
};

function kimiShareDir() {
  return resolveKimiShareDir();
}

function kimiCredentialsPath() {
  return path.join(kimiShareDir(), "credentials", "kimi-code.json");
}

function readKimiDeviceId() {
  const devicePath = path.join(kimiShareDir(), "device_id");
  try {
    const existing = fs.readFileSync(devicePath, "utf-8").trim();
    if (existing) return existing;
  } catch {
    // Generate below.
  }
  const deviceId = randomUUID().replace(/-/g, "");
  ensureDirectoryExists(path.dirname(devicePath));
  fs.writeFileSync(devicePath, deviceId, "utf-8");
  return deviceId;
}

function kimiCommonHeaders() {
  return {
    "X-Msh-Platform": "kimi_code",
    "X-Msh-Version": app.getVersion(),
    "X-Msh-Device-Name": os.hostname() || "unknown",
    "X-Msh-Device-Model": `${os.type()} ${os.release()} ${os.arch()}`,
    "X-Msh-Os-Version": os.version?.() ?? os.release(),
    "X-Msh-Device-Id": readKimiDeviceId(),
  };
}

function readKimiOAuthToken(): KimiOAuthToken {
  const tokenPath = kimiCredentialsPath();
  if (!fs.existsSync(tokenPath)) {
    throw new Error("未找到 Kimi 登录凭证，请先在 Kimi Code 中完成登录");
  }
  const raw = JSON.parse(fs.readFileSync(tokenPath, "utf-8")) as Partial<KimiOAuthToken>;
  if (!raw.access_token || !raw.refresh_token) {
    throw new Error("Kimi 登录凭证不完整，请重新登录 Kimi Code");
  }
  return {
    access_token: String(raw.access_token),
    refresh_token: String(raw.refresh_token),
    expires_at: Number(raw.expires_at || 0),
    scope: String(raw.scope || ""),
    token_type: String(raw.token_type || "Bearer"),
    expires_in: Number(raw.expires_in || 0),
  };
}

async function refreshKimiOAuthToken(token: KimiOAuthToken): Promise<KimiOAuthToken> {
  const body = new URLSearchParams({
    client_id: KIMI_CODE_CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: token.refresh_token,
  }).toString();
  const res = await fetch(KIMI_CODE_REFRESH_URL, {
    method: "POST",
    headers: {
      ...kimiCommonHeaders(),
      "Accept": "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const message = detail.trim() ? `：${detail.trim().slice(0, 180)}` : "";
    throw new Error(`Kimi 登录刷新失败：HTTP ${res.status}${message}`);
  }
  const payload = await res.json() as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    scope?: unknown;
    token_type?: unknown;
  };
  const expiresIn = Number(payload.expires_in || 0);
  const nextToken: KimiOAuthToken = {
    access_token: String(payload.access_token || ""),
    refresh_token: String(payload.refresh_token || token.refresh_token),
    expires_at: Date.now() / 1000 + expiresIn,
    scope: String(payload.scope || token.scope),
    token_type: String(payload.token_type || token.token_type || "Bearer"),
    expires_in: expiresIn,
  };
  if (!nextToken.access_token) {
    throw new Error("Kimi 登录刷新返回为空");
  }
  fs.writeFileSync(kimiCredentialsPath(), `${JSON.stringify(nextToken, null, 2)}\n`, "utf-8");
  return nextToken;
}

async function resolveKimiAccessToken() {
  const token = readKimiOAuthToken();
  const refreshThresholdSeconds = 300;
  if (token.expires_at && token.expires_at - Date.now() / 1000 > refreshThresholdSeconds) {
    return token.access_token;
  }
  return (await refreshKimiOAuthToken(token)).access_token;
}

function getPackagedUserDataDir(): string {
  const platform = process.platform;
  const home = os.homedir();
  if (platform === "win32") {
    return path.join(home, "AppData", "Roaming", "Kimix");
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Kimix");
  }
  return path.join(home, ".config", "Kimix");
}

function mergeDirSync(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      mergeDirSync(srcPath, destPath);
    } else if (!fs.existsSync(destPath)) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function getDefaultProject() {
  const packagedUserData = getPackagedUserDataDir();
  const workDir = path.join(packagedUserData, "default-project");

  // Dev builds historically stored data under Electron's userData directory.
  // One-time merge into the packaged Kimix location so dev and packaged builds share data.
  if (!app.isPackaged) {
    const devWorkDir = path.join(app.getPath("userData"), "default-project");
    if (fs.existsSync(devWorkDir) && devWorkDir !== workDir) {
      try {
        fs.mkdirSync(packagedUserData, { recursive: true });
        mergeDirSync(devWorkDir, workDir);
      } catch {
        // If merge fails, ensureDirectoryExists below still creates the target dir.
      }
    }
  }

  ensureDirectoryExists(workDir);
  return {
    id: DEFAULT_PROJECT_ID,
    path: workDir,
    name: DEFAULT_PROJECT_DISPLAY_NAME,
    lastOpenedAt: Date.now(),
  };
}

function createWindow() {
  logMainStartup("createWindow:start");
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    title: "Kimix",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
    autoHideMenuBar: true,
    frame: false,
    icon: path.join(process.env.APP_ROOT, "..", "Kimix.png"),
  });

  // Kimi Code Host is the single event source for renderer sessions.
  kimiCodeHost.setKimiCodeEventSink((payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("kimi-code:event", payload);
    }
  });
  kimiCodeHost.setKimiCodeStatusSink((payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("kimi-code:status", payload);
    }
  });
  if (DEV_SERVER_URL) {
    logMainStartup("loadURL:start", DEV_SERVER_URL);
    mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    logMainStartup("loadFile:start");
    mainWindow.loadFile(path.join(RENDERER_DIST, "index.html"));
  }

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[RENDERER] did-fail-load ${errorCode} ${errorDescription} ${validatedURL}`);
  });
  mainWindow.webContents.once("dom-ready", () => {
    logMainStartup("dom-ready");
  });
  mainWindow.webContents.on("did-frame-finish-load", (_event, isMainFrame) => {
    if (isMainFrame) logMainStartup("did-frame-finish-load");
  });
  mainWindow.webContents.once("did-finish-load", () => {
    logMainStartup("did-finish-load");
    void restoreLastContext();
    emitWindowState();
    verifyRendererContent();
    startRendererWatchdog();
    scheduleKimiServerStartupAfterFirstPaint();
  });

  mainWindow.on("focus", clearTaskbarAttention);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        return { action: "deny" };
      }
      shell.openExternal(url).catch(() => {});
    } catch {
      // Invalid URL format
    }
    return { action: "deny" };
  });

  // Prevent navigation away from the app
  mainWindow.webContents.on("will-navigate", (e) => {
    e.preventDefault();
  });

  // CSP for production; dev mode needs broader rules for HMR
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          DEV_SERVER_URL
            ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*;"
            : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self';"
        ],
      },
    });
  });

  // Renderer crash handler (production only)
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer process gone:", details.reason, details.exitCode);
    if (DEV_SERVER_URL) {
      // Dev mode: just log, don't restart to avoid HMR loops
      return;
    }
    dialog.showErrorBox(
      "Application Error",
      `The renderer process has crashed (${details.reason}). The application will now restart.`
    );
    app.relaunch();
    app.quit();
  });

  mainWindow.on("closed", () => {
    stopRendererWatchdog();
    mainWindow = null;
    kimiCodeHost.setKimiCodeEventSink(null);
    kimiCodeHost.setKimiCodeStatusSink(null);
  });
  mainWindow.on("maximize", emitWindowState);
  mainWindow.on("unmaximize", emitWindowState);
  mainWindow.on("restore", emitWindowState);
  mainWindow.on("enter-full-screen", emitWindowState);
  mainWindow.on("leave-full-screen", emitWindowState);
}

function scheduleKimiServerStartupAfterFirstPaint() {
  if (kimiServerStartupScheduled) return;
  kimiServerStartupScheduled = true;
  setTimeout(() => {
    logMainStartup("kimi-server:start");
    void kimiCodeServerHost.start().then((serverStatus) => {
      if (serverStatus.enabled) {
        logMainStartup("kimi-server:ready", serverStatus);
      }
    }).catch((error) => {
      console.warn("[KimiCodeServerHost] background startup failed:", error);
    });
  }, 2_000);
}

async function restoreLastContext() {
  const recentProjects = projectService.getRecentProjects();
  const defaultProject = getDefaultProject();
  const recentProject = recentProjects[0];
  const isDefaultProject = Boolean(recentProject && (
    recentProject.id === DEFAULT_PROJECT_ID ||
    path.resolve(recentProject.path) === path.resolve(defaultProject.path)
  ));
  const project = isDefaultProject
    ? {
        ...recentProject,
        id: DEFAULT_PROJECT_ID,
        path: defaultProject.path,
        name: DEFAULT_PROJECT_DISPLAY_NAME,
        lastOpenedAt: Date.now(),
      }
    : recentProject ?? defaultProject;

  await projectService.addRecentProject(project);

  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("kimix:bootstrap", { project });
}

// Project IPC handlers
ipcMain.handle("project:open", async (_, request?: { defaultPath?: string }) => {
  if (!mainWindow) return { success: false, error: "Window not available" };
  const defaultPath =
    request?.defaultPath && typeof request.defaultPath === "string"
      ? request.defaultPath
      : undefined;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    defaultPath,
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { success: true, data: null };
  }
  const p = result.filePaths[0];
  const project = {
    id: randomUUID(),
    path: p,
    name: projectService.getProjectDisplayName(p),
    lastOpenedAt: Date.now(),
    gitBranch: await projectService.getGitBranch(p),
  };
    await projectService.addRecentProject(project);
    return {
      success: true,
      data: project,
    };
  });

ipcMain.handle("project:chooseDirectory", async (_, request?: { defaultPath?: string }) => {
  try {
    const defaultPath =
      request?.defaultPath && typeof request.defaultPath === "string"
        ? request.defaultPath
        : settingsService.loadSettings().defaultOpenDir;
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
      title: "选择额外工作目录",
      properties: ["openDirectory"],
      defaultPath,
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, data: null };
    }
    return { success: true, data: result.filePaths[0] };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("project:listRecent", async () => {
  let projects = projectService.getRecentProjects();
  if (projects.length === 0) {
    const defaultProject = getDefaultProject();
      await projectService.addRecentProject(defaultProject);
      projects = projectService.getRecentProjects();
  }
  return { success: true, data: projects };
});

const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(256),
  path: z.string().max(4096),
  lastOpenedAt: z.number(),
  gitBranch: z.string().optional(),
});

const ListLongTasksSchema = z.object({
  projectPath: z.string().min(1).max(4096),
});

const GetLongTaskDetailSchema = z.object({
  projectPath: z.string().min(1).max(4096),
  taskId: z.string().min(1).max(160),
});

const UpdateLongTaskStateSchema = z.object({
  projectPath: z.string().min(1).max(4096),
  taskId: z.string().min(1).max(160),
  patch: z.object({
    stage: z.enum(["drafting", "planning", "ready", "running", "reviewing", "paused", "completed"]).optional(),
    activeAgent: z.enum(["executor", "reviewer"]).optional(),
    currentStep: z.number().int().min(0).optional(),
    targetStep: z.number().int().min(0).nullable().optional(),
    reviewedReviewItems: z.array(z.string().max(20000)).max(500).optional(),
    executorSessionId: z.string().min(1).max(160).optional(),
    reviewerSessionId: z.string().min(1).max(160).optional(),
  }).strict(),
});

const AppendLongTaskRoundSchema = z.object({
  projectPath: z.string().min(1).max(4096),
  taskId: z.string().min(1).max(160),
  step: z.number().int().min(0),
  role: z.enum(["executor", "reviewer"]),
  phase: z.enum(["execution", "review", "fix", "handoff", "complete"]),
  conclusion: z.string().max(1000).optional(),
  content: z.string().max(50000),
});

const CreateLongTaskSchema = z.object({
  project: ProjectSchema,
  title: z.string().max(160).optional(),
  initialRequest: z.string().min(1).max(20000),
  thinking: z.boolean().optional(),
  yoloMode: z.boolean().optional(),
  autoMode: z.boolean().optional(),
});

ipcMain.handle("project:addRecent", async (_, project: unknown) => {
  const parsed = ProjectSchema.safeParse(project);
  if (!parsed.success) {
    return { success: false, error: "Invalid project data" };
  }
  await projectService.addRecentProject(parsed.data);
  return { success: true, data: undefined };
});

ipcMain.handle("project:removeRecent", async (_, id: unknown) => {
  if (typeof id !== "string") {
    return { success: false, error: "Invalid project id" };
  }
  await projectService.removeRecentProject(id);
  return { success: true, data: undefined };
});

ipcMain.handle("project:setPinned", async (_, request: unknown) => {
  const parsed = z.object({ id: z.string().min(1), pinned: z.boolean() }).safeParse(request);
  if (!parsed.success) return { success: false, error: "Invalid pin request" };
  return { success: true, data: await projectService.setProjectPinned(parsed.data.id, parsed.data.pinned) };
});

ipcMain.handle("project:reorder", async (_, request: unknown) => {
  const parsed = z.object({ orderedIds: z.array(z.string()) }).safeParse(request);
  if (!parsed.success) return { success: false, error: "Invalid reorder request" };
  return { success: true, data: await projectService.reorderProjects(parsed.data.orderedIds) };
});

ipcMain.handle("longTasks:list", async (_, request: unknown) => {
  try {
    const parsed = ListLongTasksSchema.safeParse(request);
    if (!parsed.success) {
      return { success: false, error: "Invalid long task list request" };
    }
    if (!fs.existsSync(parsed.data.projectPath)) {
      return { success: false, error: "Project path does not exist" };
    }
    return { success: true, data: longTaskService.listLongTasks(parsed.data.projectPath) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("longTasks:getDetail", async (_, request: unknown) => {
  try {
    const parsed = GetLongTaskDetailSchema.safeParse(request);
    if (!parsed.success) {
      return { success: false, error: "Invalid long task detail request" };
    }
    if (!fs.existsSync(parsed.data.projectPath)) {
      return { success: false, error: "Project path does not exist" };
    }
    return { success: true, data: longTaskService.getLongTaskDetail(parsed.data.projectPath, parsed.data.taskId) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("longTasks:updateState", async (_, request: unknown) => {
  try {
    const parsed = UpdateLongTaskStateSchema.safeParse(request);
    if (!parsed.success) {
      return { success: false, error: "Invalid long task update request" };
    }
    if (!fs.existsSync(parsed.data.projectPath)) {
      return { success: false, error: "Project path does not exist" };
    }
    return {
      success: true,
      data: longTaskService.updateLongTaskState(parsed.data.projectPath, parsed.data.taskId, parsed.data.patch),
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("longTasks:appendRound", async (_, request: unknown) => {
  try {
    const parsed = AppendLongTaskRoundSchema.safeParse(request);
    if (!parsed.success) {
      return { success: false, error: "Invalid long task round request" };
    }
    if (!fs.existsSync(parsed.data.projectPath)) {
      return { success: false, error: "Project path does not exist" };
    }
    return { success: true, data: longTaskService.appendLongTaskRound(parsed.data) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("longTasks:create", async (_, request: unknown) => {
  let executorSessionId: string | null = null;
  try {
    const parsed = CreateLongTaskSchema.safeParse(request);
    if (!parsed.success) {
      return { success: false, error: "Invalid long task create request" };
    }
    const { project, initialRequest } = parsed.data;
    if (!fs.existsSync(project.path)) {
      return { success: false, error: "Project path does not exist" };
    }
    await projectService.addRecentProject({ ...project, lastOpenedAt: Date.now() });
    const title = (parsed.data.title?.trim() || initialRequest.trim().split(/\r?\n/)[0] || "长程任务").slice(0, 80);
    const thinking = parsed.data.thinking ?? true;
    const yoloMode = parsed.data.yoloMode ?? false;
    const autoMode = parsed.data.autoMode ?? false;

    const permission = yoloMode ? "yolo" as const : autoMode ? "auto" as const : "manual" as const;
    const executor = await kimiCodeHost.createSession({
      workDir: project.path,
      permission,
      thinking: thinking ? "on" : "off",
    });
    executorSessionId = executor.sessionId;

    const task = longTaskService.createLongTask({
      project,
      title,
      initialRequest,
      executorSessionId,
      reviewerSessionId: executorSessionId,
    });
    return { success: true, data: task };
  } catch (err) {
    if (executorSessionId) await kimiCodeHost.closeSession(executorSessionId).catch(() => {});
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("project:getGitInfo", async (_, projectPath: string) => {
  try {
    const snapshot = await projectService.getGitSnapshot(projectPath, { includeRemote: true });
    return { success: true, data: snapshot };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("project:getGitDetails", async (_, projectPath: string) => {
  try {
    const details = await projectService.getGitDetails(projectPath);
    return { success: true, data: details };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("project:getGitGraph", async (_, request: unknown) => {
  try {
    const parsed = z.object({
      projectPath: z.string().min(1).max(4096),
      limit: z.number().int().min(1).max(1000).optional(),
    }).safeParse(request);
    if (!parsed.success) return { success: false, error: "Invalid git graph request" };
    if (!fs.existsSync(parsed.data.projectPath)) return { success: false, error: "Project path does not exist" };
    const graph = await projectService.getGitGraph(parsed.data.projectPath, parsed.data.limit);
    return { success: true, data: graph };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("project:gitCommit", async (_, request: unknown) => {
  try {
    const parsed = z.object({
      projectPath: z.string().min(1).max(4096),
      message: z.string().min(1).max(500),
      files: z.array(z.string().min(1).max(4096)).max(500).optional(),
    }).safeParse(request);
    if (!parsed.success) return { success: false, error: "Invalid git commit request" };
    if (!fs.existsSync(parsed.data.projectPath)) return { success: false, error: "Project path does not exist" };
    const result = await projectService.commitGitChanges(parsed.data.projectPath, parsed.data.message, parsed.data.files);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("project:gitPull", async (_, request: unknown) => {
  try {
    const parsed = z.object({
      projectPath: z.string().min(1).max(4096),
    }).safeParse(request);
    if (!parsed.success) return { success: false, error: "Invalid git pull request" };
    if (!fs.existsSync(parsed.data.projectPath)) return { success: false, error: "Project path does not exist" };
    const result = await projectService.pullGit(parsed.data.projectPath);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("project:gitPush", async (_, request: unknown) => {
  try {
    const parsed = z.object({
      projectPath: z.string().min(1).max(4096),
    }).safeParse(request);
    if (!parsed.success) return { success: false, error: "Invalid git push request" };
    if (!fs.existsSync(parsed.data.projectPath)) return { success: false, error: "Project path does not exist" };
    const result = await projectService.pushGit(parsed.data.projectPath);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("project:openPath", async (_, request: unknown) => {
  try {
    if (!request || typeof request !== "object") {
      return { success: false, error: "Invalid request" };
    }
    const dir = (request as { path?: unknown }).path;
    if (typeof dir !== "string" || !dir) {
      return { success: false, error: "Invalid path" };
    }
    if (!fs.existsSync(dir)) {
      return { success: false, error: "Path does not exist" };
    }
    await shell.openPath(dir);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("project:revealPath", async (_, request: unknown) => {
  try {
    if (!request || typeof request !== "object") {
      return { success: false, error: "Invalid request" };
    }
    const target = (request as { path?: unknown }).path;
    if (typeof target !== "string" || !target) {
      return { success: false, error: "Invalid path" };
    }
    if (!fs.existsSync(target)) {
      return { success: false, error: "Path does not exist" };
    }
    // Directory: open it directly. File: reveal in folder and select it.
    if (fs.statSync(target).isDirectory()) {
      await shell.openPath(target);
    } else {
      shell.showItemInFolder(target);
    }
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("project:openEditor", async (_, request: unknown) => {
  try {
    if (!request || typeof request !== "object") {
      return { success: false, error: "Invalid request" };
    }
    const dir = (request as { path?: unknown }).path;
    const editor = (request as { editor?: unknown }).editor;
    if (typeof dir !== "string" || !dir || !["vscode", "trae", "coder"].includes(String(editor))) {
      return { success: false, error: "Invalid editor request" };
    }
    if (!fs.existsSync(dir)) {
      return { success: false, error: "Path does not exist" };
    }
    await openEditorAt(editor as "vscode" | "trae" | "coder", dir);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("project:openTerminal", async (_, request: unknown) => {
  try {
    if (!request || typeof request !== "object") {
      return { success: false, error: "Invalid request" };
    }
    const dir = (request as { path?: unknown }).path;
    if (typeof dir !== "string" || !dir) {
      return { success: false, error: "Invalid path" };
    }
    if (!fs.existsSync(dir)) {
      return { success: false, error: "Path does not exist" };
    }
    await openTerminalAt(dir);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("app:chooseExecutable", async () => {
  try {
    const settings = settingsService.loadSettings();
    const defaultPath = settings.selectedExecutablePath && fs.existsSync(settings.selectedExecutablePath)
      ? path.dirname(settings.selectedExecutablePath)
      : settings.defaultOpenDir;
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
      title: "选择要启动的文件",
      defaultPath,
      properties: ["openFile"],
      filters: process.platform === "win32"
        ? [
            { name: "Windows 可执行文件", extensions: ["exe", "bat", "cmd", "ps1", "com", "msi", "lnk"] },
            { name: "所有文件", extensions: ["*"] },
          ]
        : [{ name: "所有文件", extensions: ["*"] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, data: undefined };
    }
    const filePath = result.filePaths[0];
    settingsService.saveSettings({ selectedExecutablePath: filePath });
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("app:launchExecutable", async () => {
  try {
    let filePath = settingsService.loadSettings().selectedExecutablePath;
    if (!filePath || !fs.existsSync(filePath)) {
      const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
        title: "选择要启动的文件",
        properties: ["openFile"],
        filters: process.platform === "win32"
          ? [
              { name: "Windows 可执行文件", extensions: ["exe", "bat", "cmd", "ps1", "com", "msi", "lnk"] },
              { name: "所有文件", extensions: ["*"] },
            ]
          : [{ name: "所有文件", extensions: ["*"] }],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, data: undefined };
      }
      filePath = result.filePaths[0];
      settingsService.saveSettings({ selectedExecutablePath: filePath });
    }
    await launchExecutableFile(filePath);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("app:setLaunchCommand", async (_, request: unknown) => {
  try {
    const command = request && typeof request === "object" && typeof (request as { command?: unknown }).command === "string"
      ? (request as { command: string }).command.trim()
      : "";
    if (!command) return { success: false, error: "启动命令为空" };
    settingsService.saveSettings({ selectedLaunchCommand: command });
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("app:launchCommand", async (_, request: unknown) => {
  try {
    const settings = settingsService.loadSettings();
    const requestObject = request && typeof request === "object" ? request as { command?: unknown; cwd?: unknown } : {};
    const command = typeof requestObject.command === "string" && requestObject.command.trim()
      ? requestObject.command.trim()
      : settings.selectedLaunchCommand?.trim();
    const cwd = typeof requestObject.cwd === "string" ? requestObject.cwd : undefined;
    if (!command) return { success: false, error: "还没有设置启动命令" };
    await launchShellCommand(command, cwd);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("project:openFile", async (_, request: unknown) => {
  try {
    if (!request || typeof request !== "object") {
      return { success: false, error: "Invalid request" };
    }
    const req = request as { projectPath?: unknown; filePath?: unknown };
    if (typeof req.projectPath !== "string" || typeof req.filePath !== "string" || !req.projectPath || !req.filePath) {
      return { success: false, error: "Invalid file request" };
    }
    const filePath = resolveProjectFile(req.projectPath, req.filePath);
    if (!fs.existsSync(filePath)) {
      return { success: false, error: "File does not exist" };
    }
    await openFileAt(filePath);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("project:revertFiles", async (_, request: unknown) => {
  try {
    if (!request || typeof request !== "object") {
      return { success: false, error: "Invalid request" };
    }
    const req = request as { projectPath?: unknown; files?: unknown };
    if (typeof req.projectPath !== "string" || !Array.isArray(req.files)) {
      return { success: false, error: "Invalid revert request" };
    }
    if (!fs.existsSync(req.projectPath)) {
      return { success: false, error: "Project path does not exist" };
    }
    const files = req.files
      .map((file) => {
        if (typeof file === "string" && file.trim().length > 0) {
          return { path: file };
        }
        if (file && typeof file === "object" && typeof (file as { path?: unknown }).path === "string" && (file as { path: string }).path.trim().length > 0) {
          const additions = (file as { additions?: unknown }).additions;
          const deletions = (file as { deletions?: unknown }).deletions;
          return {
            path: (file as { path: string }).path,
            additions: typeof additions === "number" ? additions : undefined,
            deletions: typeof deletions === "number" ? deletions : undefined,
          };
        }
        return null;
      })
      .filter((file): file is projectService.RevertFileTarget => file !== null);
    files.forEach((file) => resolveProjectFile(req.projectPath as string, file.path));
    await projectService.revertGitFiles(req.projectPath, files);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("app:copyImage", async (_, request: unknown) => {
  try {
    if (!request || typeof request !== "object") {
      return { success: false, error: "Invalid request" };
    }
    const dataUrl = (request as { dataUrl?: unknown }).dataUrl;
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
      return { success: false, error: "Invalid image data" };
    }
    const image = nativeImage.createFromDataURL(dataUrl);
    if (image.isEmpty()) {
      return { success: false, error: "Image is empty" };
    }
    clipboard.writeImage(image);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("project:searchFiles", async (_, request: unknown) => {
  try {
    if (!request || typeof request !== "object") {
      return { success: false, error: "Invalid request" };
    }
    const req = request as { projectPath?: unknown; sessionId?: unknown; query?: unknown; limit?: unknown; additionalWorkDirs?: unknown };
    if (typeof req.projectPath !== "string" || !req.projectPath) {
      return { success: false, error: "Invalid project path" };
    }
    if (!fs.existsSync(req.projectPath)) {
      return { success: false, error: "Project path does not exist" };
    }
    const query = typeof req.query === "string" ? req.query : "";
    const limit = typeof req.limit === "number" ? req.limit : 40;
    const sessionId = typeof req.sessionId === "string" ? req.sessionId.trim() : "";
    const additionalWorkDirs = Array.isArray(req.additionalWorkDirs)
      ? req.additionalWorkDirs.filter((dir): dir is string => typeof dir === "string" && dir.trim().length > 0)
      : [];
    if (sessionId && query.trim()) {
      try {
        const official = await kimiCodeHost.searchServerSessionFiles(sessionId, req.projectPath, query, limit);
        if (official && official.length > 0) return { success: true, data: official };
      } catch (error) {
        console.warn("[KimiCodeServerHost] official file search failed; using local fallback:", error);
      }
    }
    return { success: true, data: searchProjectFiles(req.projectPath, query, limit, additionalWorkDirs) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("project:listPreviewFiles", async (_, request: unknown) => {
  try {
    if (!request || typeof request !== "object") {
      return { success: false, error: "Invalid request" };
    }
    const req = request as { projectPath?: unknown; extensions?: unknown };
    if (typeof req.projectPath !== "string" || !req.projectPath) {
      return { success: false, error: "Invalid project path" };
    }
    return { success: true, data: listProjectPreviewFiles(req.projectPath, req.extensions) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("project:listSkills", async () => {
  try {
    const settings = settingsService.loadSettings();
    return {
      success: true,
      data: {
        skills: listLocalSkills(),
        enabledNames: settings.enabledSkillNames ?? [],
        enabledDir: settings.enabledSkillsDir || enabledSkillsDir(),
      },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("project:saveEnabledSkills", async (_, request: unknown) => {
  try {
    const names = request && typeof request === "object" && Array.isArray((request as { names?: unknown }).names)
      ? (request as { names: unknown[] }).names.filter((item): item is string => typeof item === "string")
      : [];
    return { success: true, data: syncEnabledSkills(names) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("project:prepareKimiSkill", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as { name?: unknown } : {};
    const name = typeof req.name === "string" ? req.name.trim() : "";
    if (!name) return { success: false, error: "Missing Skill name" };
    return { success: true, data: prepareLocalSkillForKimi(name) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("project:syncKimiAgentSkills", async () => {
  try {
    return { success: true, data: syncInstalledAgentSkillsForKimi() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("project:importSkillArchive", async (_, request: unknown) => {
  try {
    const providedPath = request && typeof request === "object" && typeof (request as { archivePath?: unknown }).archivePath === "string"
      ? (request as { archivePath: string }).archivePath
      : "";
    let archivePath = providedPath;
    if (!archivePath) {
      const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
        title: "选择 Skill 压缩包",
        properties: ["openFile"],
        filters: [{ name: "Skill 压缩包", extensions: ["zip"] }],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, data: { imported: [], skills: listLocalSkills() } };
      }
      archivePath = result.filePaths[0];
    }
    const imported = importSkillArchive(archivePath);
    return { success: true, data: { imported, skills: listLocalSkills() } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("project:readTextFile", async (_, request: unknown) => {
  try {
    if (!request || typeof request !== "object") {
      return { success: false, error: "Invalid request" };
    }
    const req = request as Record<string, unknown>;
    const requestPath = typeof req.path === "string" ? req.path : "";
    const projectPath = typeof req.projectPath === "string" ? req.projectPath : undefined;
    const sessionId = typeof req.sessionId === "string" ? req.sessionId.trim() : "";
    if (requestPath.trim() === "__latest_kimi_plan__") {
      const kimiPlansDir = path.join(resolveKimiShareDir(), "plans");
      const hasPlanFile = fs.existsSync(kimiPlansDir) && fs.readdirSync(kimiPlansDir, { withFileTypes: true })
        .some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"));
      if (!hasPlanFile) {
        return {
          success: true,
          data: {
            path: kimiPlansDir,
            content: "",
            updatedAt: 0,
            missing: true,
            message: "Kimi 还没有生成 Plan 文件",
          },
        };
      }
    }
    const normalizedRequestPath = requestPath.trim().replace(/\\/g, "/");
    const isKimiPlanPath = normalizedRequestPath.startsWith(".kimi/plans/") || normalizedRequestPath.startsWith(".kimi-code/plans/");
    if (sessionId && projectPath && requestPath.trim() && !isKimiPlanPath) {
      try {
        const official = await kimiCodeHost.readServerSessionTextFile(sessionId, projectPath, requestPath);
        if (official) {
          return { success: true, data: { ...official, updatedAt: 0 } };
        }
      } catch (error) {
        console.warn("[KimiCodeServerHost] official file read failed; using local fallback:", error);
      }
    }
    const { resolvedFile, updatedAt } = resolveReadableTextFile(requestPath, projectPath);
    const content = await fs.promises.readFile(resolvedFile, "utf8");
    return {
      success: true,
      data: {
        path: resolvedFile,
        content,
        updatedAt,
      },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

const GeneratedHookRuleSchema = z.object({
  name: z.string().min(1).max(80),
  event: z.enum(HOOK_EVENTS),
  matcher: z.string().min(1).max(500),
  action: z.enum(HOOK_ACTIONS),
  command: z.string().max(300).optional(),
  reason: z.string().max(500).optional(),
  timeout: z.number().int().min(1).max(600).optional(),
  enabled: z.boolean().optional(),
  scope: z.enum(["global", "project"]).optional(),
});

function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(source);
  } catch {
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(source.slice(start, end + 1));
    }
    throw new Error("规则创建 Agent 未返回 JSON 对象");
  }
}

function buildHookRulePrompt(description: string) {
  return `你是 Kimix Hooks 规则创建 agent。请把用户的自然语言需求转换为一条可保存的 HookRule JSON。

只输出一个 JSON 对象，不要 Markdown，不要解释，不要调用任何工具，不要读取任何文件。

字段要求：
- name: 简短中文名称，最多 20 个汉字。
- event: 只能是 PreToolUse / PostToolUse / PostToolUseFailure / Notification / Stop / StopFailure / Interrupt / UserPromptSubmit / SessionStart / SessionEnd / SubagentStart / SubagentStop / PreCompact / PostCompact。
- matcher: 简短正则或关键词，用来匹配工具名、命令、文件路径、事件摘要或会话状态；SessionStart/SubagentStart 通常用 ".*"。
- action: 只能是 allow / block / notify / run_command。
- command: notify / block / run_command 都必须填写真正可执行的一行 hook 脚本；Kimi hooks 会执行 command，并把 hook 事件 JSON 传入 stdin，stdout 会补充给 agent 上下文，退出码 2 表示阻断。
- reason: 面向用户展示的阻断、通知或执行说明，必须具体写清楚触发后做什么。
- timeout: 秒数，通知/提示 30，构建/测试 120。
- enabled: true。
- scope: global 或 project。

选择规则：
- 危险命令、删除、强推、重置：PreToolUse + block，command 要检查 stdin 中的命令并在命中时输出风险说明后 exit 2；不要生成会直接执行危险操作的 command。
- 任务结束后构建、测试、lint：Stop + run_command，command 填用户要求的真实命令。
- 失败、等待用户、需要提醒：StopFailure + notify，command 要输出提醒文本。
- 用户主动中断输出或按 Esc 停止时提醒：Interrupt + notify，command 要输出提醒文本。
- 每轮用户输入前、每次注入上下文、提示当前时间：UserPromptSubmit + notify，command 要输出要提供给 agent 的上下文文本。
- 会话创建时一次性提示：SessionStart + notify。
- 子 agent 启动时提示：SubagentStart + notify。
- 如果用户说“每轮开始前/每轮开始时提示当前时间给 agent”，必须生成能输出当前时间的 command：
  powershell -NoProfile -Command "Write-Output ('当前时间：' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))"
- Windows 命令注意引号转义；优先用 powershell -NoProfile -Command "..." 单行形式。

用户需求：
${description}`;
}

function completeGeneratedHookRule(rule: z.infer<typeof GeneratedHookRuleSchema>, description: string) {
  const text = description.toLowerCase();
  const next = { ...rule };
  if (!next.timeout) {
    next.timeout = next.action === "run_command" ? 120 : 30;
  }
  if (/时间|current\s*time|date|clock/.test(text) && !next.command?.trim()) {
    next.event = "UserPromptSubmit";
    next.action = "notify";
    next.matcher = next.matcher?.trim() || ".*";
    next.command = `powershell -NoProfile -Command "Write-Output ('当前时间：' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))"`;
    next.reason = next.reason?.trim() || "每轮开始时把当前时间作为 hook 上下文提供给 agent。";
  }
  if (next.action === "notify" && !next.command?.trim()) {
    const message = (next.reason || description).replace(/"/g, "'");
    next.command = `powershell -NoProfile -Command "Write-Output '${message}'"`;
  }
  if (next.action === "block" && !next.command?.trim()) {
    const message = (next.reason || "该操作被 Hook 规则阻断。").replace(/"/g, "'");
    next.command = `powershell -NoProfile -Command "Write-Error '${message}'; exit 2"`;
  }
  return next;
}

ipcMain.handle("hooks:generateRule", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const description = typeof req.description === "string" ? req.description.trim() : "";
    const projectPath = typeof req.projectPath === "string" ? req.projectPath : undefined;
    if (!description) return { success: false, error: "请先输入自然语言描述" };
    // 规则生成是纯 NL→JSON 转换，不能在项目目录跑：否则官方 -p agent 会把它当编码任务，
    // 去翻代码库 / 读 AGENTS.md 绕远路，最终超时且无可解析 JSON。用空临时目录隔离。
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "kimix-hooks-gen-"));
    let output: string;
    try {
      output = await kimiCodeHost.runOneShotPrompt({
        workDir,
        content: buildHookRulePrompt(description),
        thinking: true,
        yoloMode: false,
        timeoutMs: 120000,
      });
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
    const parsed = GeneratedHookRuleSchema.safeParse(extractJsonObject(output));
    if (!parsed.success) {
      return { success: false, error: "规则创建 Agent 返回的 JSON 不符合 HookRule 格式" };
    }
    const completed = completeGeneratedHookRule(parsed.data, description);
    const now = Date.now();
    const rule = {
      id: randomUUID(),
      name: completed.name.trim(),
      event: completed.event,
      matcher: completed.matcher.trim() || ".*",
      action: completed.action,
      command: completed.command?.trim() ?? "",
      reason: completed.reason?.trim() || description,
      timeout: completed.timeout,
      enabled: completed.enabled ?? true,
      scope: completed.scope ?? "global",
      projectPath: completed.scope === "project" ? projectPath : undefined,
      createdAt: now,
      updatedAt: now,
    };
    return { success: true, data: rule };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// Kimi IPC handlers
ipcMain.handle("kimi:checkCli", async (_, request?: { verify?: boolean }) => {
  try {
    const kimiPath = await resolveKimiCommand();
    const shellPath = await resolveGitBashCommand();
    if (!kimiPath) {
      return {
        success: true,
        data: {
          available: false,
          verified: false,
          command: "kimi",
          version: null,
          isLegacy: false,
          shellPath,
          shellAvailable: Boolean(shellPath),
          message: "未找到 Kimi Code，请检查 PATH",
        },
      };
    }
    if (!shellPath) {
      return {
        success: true,
        data: {
          available: true,
          verified: false,
          command: "kimi",
          path: kimiPath,
          output: "Kimi Code 已安装，但未找到 Git Bash。Windows 上 Kimi Code 需要 Git for Windows 提供 shell 环境。",
          version: null,
          isLegacy: false,
          shellPath: null,
          shellAvailable: false,
          message: "请先安装 Git for Windows，或设置 KIMI_SHELL_PATH 指向 bash.exe",
        },
      };
    }
    if (request?.verify) {
      const output = await runCommand(kimiPath, ["--version"]);
      const version = extractKimiCliVersion(output);
      const isLegacy = isLegacyKimiCodeInstallation(output, kimiPath);
      return {
        success: true,
        data: {
          available: true,
          verified: true,
          command: "kimi",
          path: kimiPath,
          output,
          version,
          isLegacy,
          shellPath,
          shellAvailable: true,
          message: isLegacy ? `检测到旧版 Kimi ${version ?? ""}，建议升级并迁移到 Kimi Code` : output || "Kimi Code 响应正常",
        },
      };
    }
    const output = await runCommand(kimiPath, ["--version"]).catch(() => "");
    const version = extractKimiCliVersion(output);
    const isLegacy = isLegacyKimiCodeInstallation(output, kimiPath);
    return {
      success: true,
      data: {
        available: true,
        verified: false,
        command: "kimi",
        path: kimiPath,
        output,
        version,
        isLegacy,
        shellPath,
        shellAvailable: true,
        message: isLegacy ? `已找到旧版 Kimi ${version ?? ""}，请升级并迁移` : "已找到 Kimi Code，点击检查验证响应",
      },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:getAuthStatus", async () => {
  try {
    return { success: true, data: await getKimiAuthStatus() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:getModelConfig", async () => {
  try {
    return { success: true, data: await readKimiModelConfigWithSdk() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:saveOpenAiProvider", async (_, request: unknown) => {
  try {
    const config = await saveOpenAiProviderConfigWithSdk(request);
    const reloadResult = await reloadIdleKimiCodeSessionsAfterConfigChange();
    return { success: true, data: { ...config, message: `已保存 OpenAI-compatible Provider${buildConfigReloadSuffix(reloadResult)}` } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:setDefaultModel", async (_, request: unknown) => {
  try {
    const config = await setDefaultKimiModelWithSdk(request);
    const reloadResult = await reloadIdleKimiCodeSessionsAfterConfigChange();
    return { success: true, data: { ...config, message: `已切换使用模型${buildConfigReloadSuffix(reloadResult)}` } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:setModelAdaptiveThinking", async (_, request: unknown) => {
  try {
    const config = await setKimiModelAdaptiveThinkingWithSdk(request);
    const reloadResult = await reloadIdleKimiCodeSessionsAfterConfigChange();
    return { success: true, data: { ...config, message: `已更新自适应思考${buildConfigReloadSuffix(reloadResult)}` } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:removeModelConfig", async (_, request: unknown) => {
  try {
    const config = removeKimiModelConfig(request);
    const reloadResult = await reloadIdleKimiCodeSessionsAfterConfigChange();
    return { success: true, data: { ...config, message: `已删除模型配置${buildConfigReloadSuffix(reloadResult)}` } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:doctorConfig", async () => {
  try {
    return { success: true, data: await runKimiDoctor() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? normalizeModelConfigError(err.message) : String(err) };
  }
});

ipcMain.handle("kimi:listProviderCatalog", async () => {
  try {
    return { success: true, data: { providers: await kimiCodeHost.listProviderCatalog() } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:testOpenAiProvider", async (_, request: unknown) => {
  try {
    return { success: true, data: await testOpenAiProviderConfig(request) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:login", async () => {
  try {
    const kimiPath = await requireKimiExecutable();
    const currentStatus = await getKimiAuthStatus();
    if (currentStatus.loggedIn) {
      return {
        success: true,
        data: {
          ...currentStatus,
          verificationUrl: undefined,
          message: "Kimi Code 已登录",
        },
      };
    }
    try {
      const serverFlow = await kimiCodeHost.startServerOAuthLogin().catch((error) => {
        console.warn("[KimiCodeServerHost] OAuth login failed; falling back to SDK:", error);
        return undefined;
      });
      if (serverFlow) {
        const verificationUrl = serverFlow.verification_uri_complete || serverFlow.verification_uri;
        if (verificationUrl) await shell.openExternal(verificationUrl);
        const status = await getKimiAuthStatus();
        return {
          success: true,
          data: {
            ...status,
            verificationUrl,
            message: "已打开 Kimi 登录链接，请在浏览器中完成授权；完成后返回 Kimix 点击刷新或重新发送消息",
          },
        };
      }
      const loginFlow = await kimiCodeHost.login("managed:kimi-code", {
        onDeviceCode: (data) => {
          const url = data.verificationUriComplete || data.verificationUri;
          if (url) void shell.openExternal(url).catch(() => {});
        },
      });
      const status = await getKimiAuthStatus();
      return {
        success: true,
        data: {
          ...status,
          verificationUrl: loginFlow.verificationUrl,
          message: status.loggedIn || loginFlow.completed
            ? "登录完成"
            : "已打开 Kimi 登录链接，请在浏览器中完成授权；完成后返回 Kimix 点击刷新或重新发送消息",
        },
      };
    } catch (interactiveError) {
      return {
        success: false,
        error: `Kimi Code 登录启动失败：${interactiveError instanceof Error ? interactiveError.message : String(interactiveError)}`,
      };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:logout", async () => {
  try {
    const loggedOutByServer = await kimiCodeHost.logoutServerOAuth().catch((error) => {
      console.warn("[KimiCodeServerHost] OAuth logout failed; falling back to local credential cleanup:", error);
      return false;
    });
    if (!loggedOutByServer) clearKimiCredential(resolveKimiShareDir());
    const status = await getKimiAuthStatus();
    return {
      success: true,
      data: {
        ...status,
        message: "已退出 Kimi 登录",
      },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:listMcpServers", async () => {
  try {
    return { success: true, data: readMcpServers() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:addMcpServer", async (_, request: unknown) => {
  try {
    return { success: true, data: addMcpServerToConfig(request) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:importPluginMcpServer", async (_, request: unknown) => {
  try {
    return { success: true, data: importPluginMcpServerToConfig(request) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:removeMcpServer", async (_, request: unknown) => {
  try {
    return { success: true, data: removeMcpServerFromConfig(request) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:authMcpServer", async (_, request: unknown) => {
  try {
    const parsed = z.object({ name: z.string().trim().min(1) }).parse(request);
    throw new Error(unsupportedKimiMcpCliMessage("auth", parsed.name));
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:resetMcpServerAuth", async (_, request: unknown) => {
  try {
    const parsed = z.object({ name: z.string().trim().min(1) }).parse(request);
    throw new Error(unsupportedKimiMcpCliMessage("reset-auth", parsed.name));
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:testMcpServer", async (_, request: unknown) => {
  try {
    const parsed = z.object({ name: z.string().trim().min(1) }).parse(request);
    throw new Error(unsupportedKimiMcpCliMessage("test", parsed.name));
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:installCli", async () => {
  try {
    const result = await installKimiCli();
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:checkCliUpdate", async () => {
  try {
    return { success: true, data: await checkKimiCliUpdate() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:updateCli", async () => {
  try {
    return { success: true, data: await updateKimiCli() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

function toKimiCodePromptInput(content: string, images: { name: string; dataUrl: string }[] = []) {
  if (images.length === 0) return content;
  return [
    ...(content ? [{ type: "text" as const, text: content }] : []),
    ...images.map((image) => ({ type: "image_url" as const, imageUrl: { url: image.dataUrl, id: image.name } })),
  ];
}

// 在会话生命周期内被自动判定为不接受图片输入的模型集合。
function isImageUnsupportedError(error: unknown): boolean {
  const text = typeof error === "string" ? error : error instanceof Error ? error.message : String(error);
  return /unknown variant [`'"]image_url[`'"]|expected [`'"]text[`'"]|image_url.*not supported|does not support images/i.test(text);
}

installNonVisionFetchInterceptor();

function adaptPromptForModel(
  content: string,
  images: { name: string; dataUrl: string }[],
  model: string | undefined,
) {
  if (images.length === 0 || modelSupportsImages(model)) {
    return { content, images };
  }
  const imageLines = images.map((image, index) => `${index + 1}. [图片: ${image.name}]`);
  const nextContent = [
    content.trim(),
    "图片：",
    ...imageLines,
    "",
  ].filter(Boolean).join("\n");
  return { content: nextContent, images: [] };
}

function parseKimiCodeImages(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is { name: string; dataUrl: string } =>
        !!item &&
        typeof item === "object" &&
        typeof (item as { name?: unknown }).name === "string" &&
        typeof (item as { dataUrl?: unknown }).dataUrl === "string" &&
        (item as { dataUrl: string }).dataUrl.startsWith("data:image/")
      )
    : [];
}

function normalizeAdditionalDirs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = path.resolve(trimmed).replace(/\\/g, "/").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    dirs.push(trimmed);
  }
  return dirs;
}

ipcMain.handle("kimi-code:createSession", async (_, request: unknown) => {
  try {
    if (!request || typeof request !== "object") return { success: false, error: "Invalid request" };
    const req = request as Record<string, unknown>;
    const workDir = typeof req.workDir === "string" ? req.workDir : "";
    if (!workDir) return { success: false, error: "Missing workDir" };
    const permission = req.permission === "manual" || req.permission === "auto" || req.permission === "yolo" ? req.permission : undefined;
    const additionalDirs = normalizeAdditionalDirs(req.additionalDirs ?? req.additionalWorkDirs);
    const data = await kimiCodeHost.createSession({
      workDir,
      id: typeof req.id === "string" ? req.id : undefined,
      model: typeof req.model === "string" ? req.model : undefined,
      thinking: typeof req.thinking === "string" ? req.thinking : undefined,
      permission,
      planMode: typeof req.planMode === "boolean" ? req.planMode : undefined,
      additionalDirs,
      metadata: { source: "kimix-p1", additionalDirs },
    });
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:resumeSession", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    if (!sessionId) return { success: false, error: "Missing sessionId" };
    return { success: true, data: await kimiCodeHost.resumeSession(sessionId, { additionalDirs: normalizeAdditionalDirs(req.additionalDirs ?? req.additionalWorkDirs) }) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:forkSession", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    if (!sessionId) return { success: false, error: "Missing sessionId" };
    const title = typeof req.title === "string" ? req.title.trim().slice(0, 200) : undefined;
    const forkId = typeof req.forkId === "string" && req.forkId.trim() ? req.forkId.trim() : undefined;
    const data = await kimiCodeHost.forkSession(sessionId, {
      forkId,
      title: title || undefined,
      metadata: { source: "kimix-fork", forkedFrom: sessionId },
    });
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:renameSession", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    const title = typeof req.title === "string" ? req.title.trim().slice(0, 200) : "";
    if (!sessionId || !title) return { success: false, error: "Missing sessionId or title" };
    await kimiCodeHost.renameSession(sessionId, title);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:reloadSession", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    if (!sessionId) return { success: false, error: "Missing sessionId" };
    await kimiCodeHost.reloadSession(sessionId);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:sendPrompt", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    const content = typeof req.content === "string" ? req.content : "";
    const images = parseKimiCodeImages(req.images);
    if (!sessionId || (!content && images.length === 0)) return { success: false, error: "Missing sessionId or content" };
    const model = kimiCodeHost.getSessionModel(sessionId);
    const trySend = async (promptContent: string, promptImages: { name: string; dataUrl: string }[]) => {
      const input = toKimiCodePromptInput(promptContent, promptImages);
      const workDir = kimiCodeHost.getSessionWorkDir(sessionId);
      const finalInput = workDir ? await hookRunner.applyPromptSubmitHooks(sessionId, input, workDir) : input;
      return kimiCodeHost.sendPrompt(sessionId, finalInput);
    };
    const adapted = adaptPromptForModel(content, images, model);
    try {
      const data = await trySend(adapted.content, adapted.images);
      return { success: true, data };
    } catch (err) {
      if (isImageUnsupportedError(err)) {
        markModelAsNonVision(model);
        const fallback = adaptPromptForModel(content, images, model);
        const data = await trySend(fallback.content, fallback.images);
        return { success: true, data };
      }
      throw err;
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:askBtw", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    const content = typeof req.content === "string" ? req.content.trim() : "";
    const timeoutMs = typeof req.timeoutMs === "number" && Number.isFinite(req.timeoutMs) ? req.timeoutMs : undefined;
    if (!sessionId || !content) return { success: false, error: "Missing sessionId or content" };
    const data = await kimiCodeHost.askBtw(sessionId, content, { timeoutMs });
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:swarm", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    const content = typeof req.content === "string" ? req.content.trim() : "";
    const enabled = typeof req.enabled === "boolean" ? req.enabled : undefined;
    const trigger = req.trigger === "task" ? "task" : "manual";
    if (!sessionId) return { success: false, error: "Missing sessionId" };
    if (typeof enabled === "boolean") {
      await kimiCodeHost.setSwarmMode(sessionId, enabled, trigger);
      return { success: true, data: undefined };
    }
    if (!content) return { success: false, error: "Missing content" };
    const workDir = kimiCodeHost.getSessionWorkDir(sessionId);
    const finalInput = workDir ? await hookRunner.applyPromptSubmitHooks(sessionId, content, workDir) : content;
    await kimiCodeHost.swarm(sessionId, finalInput);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:steer", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    const content = typeof req.content === "string" ? req.content : "";
    const images = parseKimiCodeImages(req.images);
    if (!sessionId || (!content && images.length === 0)) return { success: false, error: "Missing sessionId or content" };
    const steerModel = kimiCodeHost.getSessionModel(sessionId);
    const steerAdapted = adaptPromptForModel(content, images, steerModel);
    try {
      await kimiCodeHost.steer(sessionId, toKimiCodePromptInput(steerAdapted.content, steerAdapted.images));
      return { success: true, data: undefined };
    } catch (err) {
      if (isImageUnsupportedError(err)) {
        markModelAsNonVision(steerModel);
        const fallback = adaptPromptForModel(content, images, steerModel);
        await kimiCodeHost.steer(sessionId, toKimiCodePromptInput(fallback.content, fallback.images));
        return { success: true, data: undefined };
      }
      throw err;
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:undoHistory", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    const rawCount = typeof req.count === "number" ? req.count : 1;
    const count = Number.isInteger(rawCount) ? Math.max(1, Math.min(rawCount, 10)) : 1;
    if (!sessionId) return { success: false, error: "Missing sessionId" };
    await kimiCodeHost.undoHistory(sessionId, count);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:cancel", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    if (!sessionId) return { success: false, error: "Missing sessionId" };
    await kimiCodeHost.cancel(sessionId);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:setPlanMode", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    const enabled = typeof req.enabled === "boolean" ? req.enabled : null;
    if (!sessionId || enabled === null) return { success: false, error: "Missing sessionId or enabled" };
    await kimiCodeHost.setPlanMode(sessionId, enabled);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:setModel", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId.trim() : "";
    const model = typeof req.model === "string" ? req.model.trim() : "";
    if (!sessionId || !model) return { success: false, error: "Missing sessionId or model" };
    await kimiCodeHost.setModel(sessionId, model);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:setPermission", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    const mode = req.mode === "manual" || req.mode === "auto" || req.mode === "yolo" ? req.mode : null;
    if (!sessionId || !mode) return { success: false, error: "Missing sessionId or mode" };
    await kimiCodeHost.setPermission(sessionId, mode);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:compact", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    const instruction = typeof req.instruction === "string" && req.instruction.trim() ? req.instruction.trim() : undefined;
    if (!sessionId) return { success: false, error: "Missing sessionId" };
    await kimiCodeHost.compactSession(sessionId, instruction);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:createGoal", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    const objective = typeof req.objective === "string" ? req.objective.trim() : "";
    const completionCriterion = typeof req.completionCriterion === "string" && req.completionCriterion.trim()
      ? req.completionCriterion.trim()
      : undefined;
    const replace = typeof req.replace === "boolean" ? req.replace : undefined;
    if (!sessionId || !objective) return { success: false, error: "Missing sessionId or objective" };
    return { success: true, data: await kimiCodeHost.createGoal(sessionId, { objective, completionCriterion, replace }) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:getGoal", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    if (!sessionId) return { success: false, error: "Missing sessionId" };
    return { success: true, data: await kimiCodeHost.getGoal(sessionId) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:pauseGoal", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    const reason = typeof req.reason === "string" && req.reason.trim() ? req.reason.trim() : undefined;
    if (!sessionId) return { success: false, error: "Missing sessionId" };
    return { success: true, data: await kimiCodeHost.pauseGoal(sessionId, reason) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:resumeGoal", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    const reason = typeof req.reason === "string" && req.reason.trim() ? req.reason.trim() : undefined;
    if (!sessionId) return { success: false, error: "Missing sessionId" };
    return { success: true, data: await kimiCodeHost.resumeGoal(sessionId, reason) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:cancelGoal", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    const reason = typeof req.reason === "string" && req.reason.trim() ? req.reason.trim() : undefined;
    if (!sessionId) return { success: false, error: "Missing sessionId" };
    return { success: true, data: await kimiCodeHost.cancelGoal(sessionId, reason) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:respondApproval", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    const requestId = typeof req.requestId === "string" ? req.requestId : "";
    const approved = typeof req.approved === "boolean" ? req.approved : null;
    const scope = req.scope === "once" || req.scope === "session" ? req.scope : undefined;
    const selectedLabel = typeof req.selectedLabel === "string" ? req.selectedLabel : undefined;
    const feedback = typeof req.feedback === "string" ? req.feedback : undefined;
    if (!sessionId || !requestId || approved === null) return { success: false, error: "Missing sessionId, requestId or approved" };
    kimiCodeHost.respondApproval(sessionId, requestId, approved, scope, feedback, selectedLabel);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:respondQuestion", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    const requestId = typeof req.requestId === "string" ? req.requestId : "";
    const answers = req.answers && typeof req.answers === "object" && !Array.isArray(req.answers)
      ? Object.fromEntries(Object.entries(req.answers as Record<string, unknown>).filter(([, value]) => typeof value === "string" || value === true)) as Record<string, string | true>
      : {};
    const skipped = typeof req.skipped === "boolean" ? req.skipped : undefined;
    if (!sessionId || !requestId) return { success: false, error: "Missing sessionId or requestId" };
    kimiCodeHost.respondQuestion(sessionId, requestId, answers, skipped);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:getStatus", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    if (!sessionId) return { success: false, error: "Missing sessionId" };
    return { success: true, data: await kimiCodeHost.getStatus(sessionId) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:getUsage", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    if (!sessionId) return { success: false, error: "Missing sessionId" };
    return { success: true, data: await kimiCodeHost.getUsage(sessionId) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:getConfigDiagnostics", async () => {
  try {
    return { success: true, data: await kimiCodeHost.getConfigDiagnostics() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:getManagedUsage", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const providerName = typeof req.providerName === "string" && req.providerName.trim() ? req.providerName.trim() : undefined;
    return { success: true, data: await kimiCodeHost.getManagedUsage(providerName) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:listMcpServers", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    if (!sessionId) return { success: false, error: "Missing sessionId" };
    return { success: true, data: await kimiCodeHost.listMcpServers(sessionId) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:getMcpStartupMetrics", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    if (!sessionId) return { success: false, error: "Missing sessionId" };
    return { success: true, data: await kimiCodeHost.getMcpStartupMetrics(sessionId) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:reconnectMcpServer", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    const name = typeof req.name === "string" ? req.name.trim() : "";
    if (!sessionId || !name) return { success: false, error: "Missing sessionId or name" };
    await kimiCodeHost.reconnectMcpServer(sessionId, name);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:listBackgroundTasks", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    if (!sessionId) return { success: false, error: "Missing sessionId" };
    const activeOnly = typeof req.activeOnly === "boolean" ? req.activeOnly : undefined;
    const limit = typeof req.limit === "number" && Number.isInteger(req.limit) && req.limit > 0 ? req.limit : undefined;
    return { success: true, data: await kimiCodeHost.listBackgroundTasks(sessionId, { activeOnly, limit }) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:getBackgroundTaskOutput", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    const taskId = typeof req.taskId === "string" ? req.taskId.trim() : "";
    const tail = typeof req.tail === "number" && Number.isInteger(req.tail) && req.tail > 0 ? req.tail : undefined;
    if (!sessionId || !taskId) return { success: false, error: "Missing sessionId or taskId" };
    return { success: true, data: await kimiCodeHost.getBackgroundTaskOutput(sessionId, taskId, { tail }) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:getBackgroundTaskOutputPath", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    const taskId = typeof req.taskId === "string" ? req.taskId.trim() : "";
    if (!sessionId || !taskId) return { success: false, error: "Missing sessionId or taskId" };
    return { success: true, data: await kimiCodeHost.getBackgroundTaskOutputPath(sessionId, taskId) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:stopBackgroundTask", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    const taskId = typeof req.taskId === "string" ? req.taskId.trim() : "";
    const reason = typeof req.reason === "string" && req.reason.trim() ? req.reason.trim() : undefined;
    if (!sessionId || !taskId) return { success: false, error: "Missing sessionId or taskId" };
    await kimiCodeHost.stopBackgroundTask(sessionId, taskId, reason);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:detachBackgroundTask", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    const taskId = typeof req.taskId === "string" ? req.taskId.trim() : "";
    if (!sessionId || !taskId) return { success: false, error: "Missing sessionId or taskId" };
    return { success: true, data: await kimiCodeHost.detachBackgroundTask(sessionId, taskId) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:getServerRuntimeDiagnostics", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    if (!sessionId) return { success: false, error: "Missing sessionId" };
    return { success: true, data: await kimiCodeHost.getServerRuntimeDiagnostics(sessionId) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:getPromptQueue", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    if (!sessionId) return { success: false, error: "Missing sessionId" };
    return { success: true, data: await kimiCodeHost.getPromptQueueState(sessionId) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:getServerModelCatalog", async () => {
  try {
    return { success: true, data: await kimiCodeHost.getServerModelCatalog() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

const KimiCodeExperimentalFeatureSchema = z.object({
  id: z.literal("tool-select"),
  enabled: z.boolean(),
});

ipcMain.handle("kimi-code:setExperimentalFeature", async (_, request: unknown) => {
  try {
    const req = KimiCodeExperimentalFeatureSchema.parse(request);
    await kimiCodeHost.setExperimentalFeature(req.id, req.enabled);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:archiveSession", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    if (!sessionId) return { success: false, error: "Missing sessionId" };
    await kimiCodeHost.archiveSession(sessionId);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:listArchivedSessions", async () => {
  try {
    return { success: true, data: await kimiCodeHost.listArchivedSessions() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:restoreArchivedSession", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    if (!sessionId) return { success: false, error: "Missing sessionId" };
    return { success: true, data: await kimiCodeHost.restoreArchivedSession(sessionId) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:listServerTerminals", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    if (!sessionId) return { success: false, error: "Missing sessionId" };
    return { success: true, data: await kimiCodeHost.listServerTerminals(sessionId) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:createServerTerminal", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    if (!sessionId) return { success: false, error: "Missing sessionId" };
    const data = await kimiCodeHost.createServerTerminal(sessionId, {
      cwd: typeof req.cwd === "string" && req.cwd.trim() ? req.cwd.trim() : undefined,
      shell: typeof req.shell === "string" && req.shell.trim() ? req.shell.trim() : undefined,
      cols: typeof req.cols === "number" && req.cols > 0 ? Math.round(req.cols) : undefined,
      rows: typeof req.rows === "number" && req.rows > 0 ? Math.round(req.rows) : undefined,
    });
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:closeServerTerminal", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    const terminalId = typeof req.terminalId === "string" ? req.terminalId : "";
    if (!sessionId || !terminalId) return { success: false, error: "Missing sessionId or terminalId" };
    await kimiCodeHost.closeServerTerminal(sessionId, terminalId);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:attachServerTerminal", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    const terminalId = typeof req.terminalId === "string" ? req.terminalId : "";
    const sinceSeq = typeof req.sinceSeq === "number" && req.sinceSeq >= 0 ? Math.round(req.sinceSeq) : undefined;
    if (!sessionId || !terminalId) return { success: false, error: "Missing sessionId or terminalId" };
    return { success: true, data: await kimiCodeHost.attachServerTerminal(sessionId, terminalId, sinceSeq) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:detachServerTerminal", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    const terminalId = typeof req.terminalId === "string" ? req.terminalId : "";
    if (!sessionId || !terminalId) return { success: false, error: "Missing sessionId or terminalId" };
    await kimiCodeHost.detachServerTerminal(sessionId, terminalId);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:writeServerTerminal", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    const terminalId = typeof req.terminalId === "string" ? req.terminalId : "";
    const data = typeof req.data === "string" ? req.data : "";
    if (!sessionId || !terminalId || !data) return { success: false, error: "Missing sessionId, terminalId or data" };
    await kimiCodeHost.writeServerTerminal(sessionId, terminalId, data);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:resizeServerTerminal", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    const terminalId = typeof req.terminalId === "string" ? req.terminalId : "";
    const cols = typeof req.cols === "number" && req.cols > 0 ? Math.round(req.cols) : 0;
    const rows = typeof req.rows === "number" && req.rows > 0 ? Math.round(req.rows) : 0;
    if (!sessionId || !terminalId || !cols || !rows) return { success: false, error: "Missing terminal resize parameters" };
    await kimiCodeHost.resizeServerTerminal(sessionId, terminalId, cols, rows);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:listSessions", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const workDir = typeof req.workDir === "string" ? req.workDir : undefined;
    const source = kimiCodeHost.isListingSessionsFromServer() ? "server" : "sdk";
    return { success: true, data: await kimiCodeHost.listSessions(workDir), source };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:closeSession", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    if (!sessionId) return { success: false, error: "Missing sessionId" };
    await kimiCodeHost.closeSession(sessionId);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:loadSession", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const workDir = typeof req.workDir === "string" ? req.workDir : "";
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    if (!workDir || !sessionId) return { success: false, error: "Missing workDir or sessionId" };
    if (kimiCodeHost.isListingSessionsFromServer()) {
      const history = await loadSessionHistoryWithFallback(
        () => kimiCodeHost.loadServerSessionHistory(sessionId),
        () => sessionHistory.getSessionHistory(workDir, sessionId),
      );
      return { success: true, data: { sessionId, events: history.events, source: history.source } };
    }
    const events = await sessionHistory.getSessionHistory(workDir, sessionId);
    return { success: true, data: { sessionId, events, source: "local" } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

const KIMI_CODE_MARKETPLACE_URL = "https://code.kimi.com/kimi-code/plugins/marketplace.json";

ipcMain.handle("kimi-code:listMarketplace", async () => {
  try {
    const res = await fetch(KIMI_CODE_MARKETPLACE_URL, { headers: { "User-Agent": "Kimix" } });
    if (!res.ok) throw new Error(`官方插件市场返回 HTTP ${res.status}`);
    const payload = await res.json() as { plugins?: unknown };
    const baseUrl = KIMI_CODE_MARKETPLACE_URL.slice(0, KIMI_CODE_MARKETPLACE_URL.lastIndexOf("/") + 1);
    const plugins = Array.isArray(payload.plugins)
      ? payload.plugins
          .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
          .map((p) => {
            const source = typeof p.source === "string" ? p.source : "";
            const resolvedSource = source.startsWith("http") ? source : new URL(source, baseUrl).href;
            return {
              id: typeof p.id === "string" ? p.id : "",
              tier: typeof p.tier === "string" ? p.tier : "",
              displayName: typeof p.displayName === "string" ? p.displayName : (typeof p.id === "string" ? p.id : ""),
              version: typeof p.version === "string" ? p.version : "",
              description: typeof p.description === "string" ? p.description : "",
              homepage: typeof p.homepage === "string" ? p.homepage : undefined,
              source: resolvedSource,
            };
          })
          .filter((p) => p.id && p.source)
      : [];
    return { success: true, data: plugins };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:listPlugins", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : undefined;
    return { success: true, data: await kimiCodeHost.listPlugins(sessionId) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:listSkills", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : undefined;
    return { success: true, data: await kimiCodeHost.listSkills(sessionId) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:installPlugin", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : undefined;
    const source = typeof req.source === "string" ? req.source.trim() : "";
    if (!source) return { success: false, error: "Missing source" };
    return { success: true, data: await kimiCodeHost.installPlugin(source, sessionId) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/EBUSY|resource busy|locked|rmdir|ENOTEMPTY|EPERM/i.test(message)) {
      return {
        success: false,
        error: `${message}。插件目录仍被 Kimi Code/MCP 进程占用；Kimix 会先尝试关闭当前 runtime 和内部插件管理会话，如果仍失败，请关闭其它 Kimi Code/Kimix 窗口后再更新。`,
      };
    }
    return { success: false, error: message };
  }
});

ipcMain.handle("kimi-code:setPluginEnabled", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : undefined;
    const id = typeof req.id === "string" ? req.id.trim() : "";
    const enabled = typeof req.enabled === "boolean" ? req.enabled : null;
    if (!id || enabled === null) return { success: false, error: "Missing id or enabled" };
    await kimiCodeHost.setPluginEnabled(id, enabled, sessionId);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:setPluginMcpServerEnabled", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : undefined;
    const id = typeof req.id === "string" ? req.id.trim() : "";
    const server = typeof req.server === "string" ? req.server.trim() : "";
    const enabled = typeof req.enabled === "boolean" ? req.enabled : null;
    if (!id || !server || enabled === null) return { success: false, error: "Missing id, server or enabled" };
    await kimiCodeHost.setPluginMcpServerEnabled(id, server, enabled, sessionId);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:startRuntime", async (_, request: { workDir: string; sessionId?: string; model?: string; thinking?: boolean; yoloMode?: boolean; autoMode?: boolean; planMode?: boolean; skillsDir?: string; agentFile?: string; additionalWorkDirs?: string[]; additionalDirs?: string[] }) => {
  try {
    const additionalDirs = normalizeAdditionalDirs(request.additionalDirs ?? request.additionalWorkDirs);
    const permission = request.yoloMode ? "yolo" as const : request.autoMode ? "auto" as const : "manual" as const;
    const sameWorkDir = (a: string, b: string) =>
      path.resolve(a).replace(/\\/g, "/").toLowerCase() === path.resolve(b).replace(/\\/g, "/").toLowerCase();
    const modelSummary = await readKimiModelConfigWithSdk().catch(() => readKimiModelConfig());
    const selectedModelAlias = request.model || modelSummary.defaultModel || undefined;
    const thinking = isDeepSeekModelConfig(modelSummary, selectedModelAlias)
      ? "off"
      : request.thinking === false
        ? "off"
        : undefined;
    const createFresh = () => kimiCodeHost.createSession({
      workDir: request.workDir,
      model: selectedModelAlias,
      thinking,
      permission,
      planMode: !!request.planMode,
      additionalDirs,
    });
    const applyResumeProfile = async (sessionId: string) => {
      if (selectedModelAlias) await kimiCodeHost.setModel(sessionId, selectedModelAlias);
      // Keep the resumed session's permission in sync with the requested mode.
      await kimiCodeHost.setPermission(sessionId, permission).catch(() => {});
      if (thinking) await kimiCodeHost.setThinking(sessionId, thinking).catch(() => {});
    };
    let engineSession;
    if (request.sessionId) {
      let resumed = null;
      try {
        resumed = await kimiCodeHost.resumeSession(request.sessionId, { additionalDirs });
      } catch (err) {
        if (!kimiCodeHost.isKimiCodeSessionMissingError(err)) {
          throw err;
        }
        console.warn(`[Kimi Code] resume ${request.sessionId} failed; creating a fresh runtime for ${request.workDir}:`, err);
      }
      // Guard against resuming a session whose real workDir does not match the
      // requested project (e.g. the plugin-management temp session). Adopting it
      // would bind the chat to the wrong directory. Fall back to a fresh session.
      if (!resumed || (request.workDir && !sameWorkDir(resumed.workDir, request.workDir))) {
        engineSession = await createFresh();
      } else {
        engineSession = resumed;
        try {
          await applyResumeProfile(resumed.sessionId);
        } catch (err) {
          if (!kimiCodeHost.isKimiCodeSessionMissingError(err)) throw err;
          console.warn(`[Kimi Code] resumed session ${resumed.sessionId} vanished while applying profile; creating a fresh runtime for ${request.workDir}:`, err);
          await kimiCodeHost.closeSession(resumed.sessionId).catch(() => {});
          engineSession = await createFresh();
        }
      }
    } else {
      engineSession = await createFresh();
    }
    return { success: true, data: { sessionId: engineSession.sessionId, workDir: engineSession.workDir, model: selectedModelAlias ?? null, slashCommands: [] as const } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:listSlashCommands", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId.trim() : "";
    if (!sessionId) return { success: false, error: "Missing sessionId" };
    const runtime = kimiCodeHost.getSessionRuntimeKind(sessionId) ?? "server";
    const commands = listKimiCodeSlashCommands(runtime);
    if (runtime !== "sdk") return { success: true, data: commands };
    const pluginCommands = await kimiCodeHost.listPluginCommands(sessionId).catch((err) => {
      console.warn(`[Kimi Code] list plugin commands failed for ${sessionId}:`, err);
      return [];
    });
    return {
      success: true,
      data: [
        ...commands,
        ...pluginCommands.map((command) => ({
          name: `${command.pluginId}:${command.name}`,
          description: command.description,
          aliases: [] as string[],
          kind: "plugin-command" as const,
          pluginId: command.pluginId,
          commandName: command.name,
        })),
      ],
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:activatePluginCommand", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId.trim() : "";
    const pluginId = typeof req.pluginId === "string" ? req.pluginId.trim() : "";
    const commandName = typeof req.commandName === "string" ? req.commandName.trim() : "";
    const args = typeof req.args === "string" && req.args.trim() ? req.args.trim() : undefined;
    if (!sessionId || !pluginId || !commandName) return { success: false, error: "Missing sessionId, pluginId or commandName" };
    await kimiCodeHost.activatePluginCommand(sessionId, pluginId, commandName, args);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:previewImportFromCcCodex", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as { workDir?: unknown } : {};
    const workDir = typeof req.workDir === "string" ? req.workDir : undefined;
    const plan = buildImportFromCcCodexPlan(workDir);
    importCcCodexPreviewCache.set(plan.previewId, plan);
    for (const [id, cached] of importCcCodexPreviewCache) {
      if (Date.now() - cached.createdAt > 30 * 60 * 1000) importCcCodexPreviewCache.delete(id);
    }
    return {
      success: true,
      data: {
        previewId: plan.previewId,
        kimiHome: plan.kimiHome,
        projectRoot: plan.projectRoot,
        items: plan.items.map(publicImportPlanItem),
        warnings: plan.warnings,
      },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:applyImportFromCcCodex", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as { previewId?: unknown } : {};
    const previewId = typeof req.previewId === "string" ? req.previewId.trim() : "";
    if (!previewId) return { success: false, error: "Missing previewId" };
    const plan = importCcCodexPreviewCache.get(previewId);
    if (!plan) return { success: false, error: "预览已过期，请重新执行 /import-from-cc-codex" };
    const result = applyImportFromCcCodexPlan(plan);
    importCcCodexPreviewCache.delete(previewId);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:previewThemeImport", async () => {
  try {
    const plan = buildKimiThemeImportPlan();
    kimiThemeImportPreviewCache.set(plan.previewId, plan);
    for (const [id, cached] of kimiThemeImportPreviewCache) {
      if (Date.now() - cached.createdAt > 30 * 60 * 1000) kimiThemeImportPreviewCache.delete(id);
    }
    return {
      success: true,
      data: {
        previewId: plan.previewId,
        themesDir: plan.themesDir,
        items: plan.items,
        warnings: plan.warnings,
      },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:applyThemeImport", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as { previewId?: unknown; themeId?: unknown } : {};
    const previewId = typeof req.previewId === "string" ? req.previewId.trim() : "";
    const themeId = typeof req.themeId === "string" ? req.themeId.trim() : "";
    if (!previewId || !themeId) return { success: false, error: "Missing previewId or themeId" };
    const plan = kimiThemeImportPreviewCache.get(previewId);
    if (!plan) return { success: false, error: "主题预览已过期，请重新执行 /custom-theme" };
    const item = plan.items.find((candidate) => candidate.id === themeId || candidate.name === themeId || candidate.displayName === themeId);
    if (!item) return { success: false, error: "未找到对应主题，请重新执行 /custom-theme 查看可选项" };
    return { success: true, data: item };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:listHistorySessions", async (_, request: { workDir: string }) => {
  try {
    const sessions = await sessionHistory.getSessions(request.workDir);
    return { success: true, data: sessions };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:getAccountUsage", async () => {
  try {
    try {
      return { success: true, data: parseManagedUsagePayload(await kimiCodeHost.getManagedUsage()) };
    } catch (sdkError) {
      const sdkMessage = sdkError instanceof Error ? sdkError.message : String(sdkError);
      if (!/不支持读取套餐用量|unsupported|not support/i.test(sdkMessage)) {
        throw new Error(formatKimiUsageError(sdkMessage));
      }
    }

    const accessToken = await resolveKimiAccessToken();
    const res = await fetch(KIMI_CODE_USAGE_URL, {
      method: "GET",
      headers: {
        ...kimiCommonHeaders(),
        "Authorization": `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const cleaned = stripHtmlForError(detail).slice(0, 220);
      const summary = cleaned ? `：${cleaned}` : "";
      if (res.status === 401) {
        throw new Error(formatKimiUsageError(`HTTP ${res.status}${summary}`));
      }
      throw new Error(formatKimiUsageError(`HTTP ${res.status}${summary}`));
    }
    const payload = getRecord(await res.json());
    if (!payload) throw new Error("Kimi 用量接口返回格式异常");
    return { success: true, data: parseKimiUsagePayload(payload) };
  } catch (err) {
    return { success: false, error: formatKimiUsageError(err instanceof Error ? err.message : String(err)) };
  }
});

ipcMain.handle("kimi-code:startVis", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" && req.sessionId.trim() ? req.sessionId.trim() : undefined;
    const noOpen = req.noOpen === true;
    let kimiPath = await resolveKimiCommand();
    if (!kimiPath) {
      const hinted = commandHintPaths("kimi").find((candidate) => fs.existsSync(candidate));
      if (hinted) {
        kimiPath = hinted;
      }
    }
    if (!kimiPath) {
      // 直接在 PATH 环境变量里扫一遍
      const pathEnv = process.env.PATH || "";
      const delimiter = process.platform === "win32" ? ";" : ":";
      const ext = process.platform === "win32" ? ".exe" : "";
      for (const dir of pathEnv.split(delimiter)) {
        const candidate = path.join(dir.trim(), `kimi${ext}`);
        if (fs.existsSync(candidate)) {
          kimiPath = candidate;
          break;
        }
      }
    }
    if (!kimiPath) {
      return { success: false, error: "未找到 Kimi Code。请先安装并在终端运行 'kimi --version' 确认可用。" };
    }

    // 验证 kimi 可执行
    try {
      await runCommand(kimiPath, ["--version"]);
    } catch {
      return { success: false, error: `找到 kimi 路径 ${kimiPath}，但无法运行。请检查安装是否完整。` };
    }

    const args = ["vis", ...(sessionId ? [sessionId] : []), ...(noOpen ? ["--no-open"] : [])];
    const child = spawn(kimiPath, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      cwd: os.homedir(),
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });

    let exited = false;
    child.on("error", (err) => {
      console.error("[KIMI VIS] spawn error:", err);
    });
    child.on("exit", (code) => {
      exited = true;
      console.warn(`[KIMI VIS] exited with code ${code ?? "unknown"}`);
    });

    // 等待 3 秒，看进程是否立即崩溃
    await new Promise((resolve) => setTimeout(resolve, 3000));

    if (exited) {
      return {
        success: false,
        error: "启动 kimi vis 失败。请确认 Kimi Code CLI 已更新到 v0.16.0 或更高版本。",
      };
    }

    // 确认进程仍在运行
    try {
      if (child.pid) process.kill(child.pid, 0);
    } catch {
      return {
        success: false,
        error: "kimi vis 进程已退出。请确认 Kimi Code CLI 已更新到 v0.16.0 或更高版本。",
      };
    }

    child.unref();
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:openWebServer", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" && req.sessionId.trim() ? req.sessionId.trim() : undefined;
    const kimiPath = await resolveKimiCommand();
    if (!kimiPath) {
      return { success: false, error: "未找到 Kimi Code。请先安装并在终端运行 'kimi --version' 确认可用。" };
    }

    try {
      await runCommand(kimiPath, ["--version"]);
    } catch {
      return { success: false, error: `找到 kimi 路径 ${kimiPath}，但无法运行。请检查安装是否完整。` };
    }

    const port = process.env.KIMIX_KIMI_WEB_PORT || process.env.KIMIX_KIMI_SERVER_PORT || "58627";
    const args = ["web", "--port", port, ...(sessionId ? ["--no-open"] : [])];
    const child = spawn(kimiPath, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      cwd: os.homedir(),
      env: getKimiCodeCommandEnv(),
    });

    let exitCode: number | null | undefined;
    child.on("error", (err) => {
      console.error("[KIMI WEB] spawn error:", err);
    });
    child.on("exit", (code) => {
      exitCode = code;
      console.warn(`[KIMI WEB] exited with code ${code ?? "unknown"}`);
    });

    if (exitCode !== undefined && exitCode !== 0) {
      return {
        success: false,
        error: "启动 kimi web 失败。请确认 Kimi Code CLI 已更新，并支持 web 命令。",
      };
    }

    await waitForKimiWebReady(port);
    child.unref();
    if (sessionId) {
      const token = readKimiServerToken();
      if (!token) {
        return {
          success: false,
          error: "Kimi Web 已启动，但未读取到官方 server token。请先在终端运行 kimi web 确认官方 Web 可正常打开。",
        };
      }
      const baseUrl = `http://127.0.0.1:${port}/sessions/${encodeURIComponent(sessionId)}`;
      await shell.openExternal(`${baseUrl}#token=${encodeURIComponent(token)}`);
    }
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:deleteThemeSource", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as { path?: unknown } : {};
    const requestedPath = typeof req.path === "string" ? req.path.trim() : "";
    if (!requestedPath) return { success: false, error: "Missing theme source path" };
    const themesDir = path.join(resolveKimiShareDir(), "themes");
    const deletedPath = deleteKimiThemeSourceFile(themesDir, requestedPath);
    kimiThemeImportPreviewCache.clear();
    return { success: true, data: { path: deletedPath } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("project:exportMarkdown", async (_, request: unknown) => {
  try {
    return { success: true, data: await exportMarkdownDocument(request) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:exportSession", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    return {
      success: true,
      data: await exportKimiSessionArchive({
        sessionId: typeof req.sessionId === "string" ? req.sessionId : undefined,
        title: typeof req.title === "string" ? req.title : undefined,
      }),
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("project:exportSessionBackup", async (_, request: ExportSessionBackupRequest) => {
  try {
    return { success: true, data: await exportSessionBackupArchive(request) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("project:importSessionBackup", async (_, request?: ImportSessionBackupRequest) => {
  try {
    return { success: true, data: await importSessionBackupArchive(request) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// App IPC handlers
ipcMain.handle("app:getSettings", async () => {
  return { success: true, data: settingsService.loadSettings() };
});

ipcMain.handle("app:getInfo", async () => {
  return {
    success: true,
    data: {
      name: "Kimix",
      version: app.getVersion(),
      author: "@linjianglu",
      repository: `https://github.com/${GITHUB_REPO}`,
    },
  };
});

ipcMain.handle("app:checkForUpdates", async () => {
  try {
    const currentVersion = app.getVersion();
    const releases = await fetchRecentReleases(3);
    const latest = releases[0] ?? null;
    if (!latest || !latest.tagName) {
      return {
        success: true,
        data: {
          currentVersion,
          latest: null,
          releases: [],
          hasUpdate: false,
          message: "暂未找到 GitHub 发布版本",
        },
      };
    }
    const hasUpdate = isVersionGreater(latest.tagName, currentVersion);
    return {
      success: true,
      data: {
        currentVersion,
        latest,
        releases,
        hasUpdate,
        message: hasUpdate ? `发现新版本 ${latest.tagName}` : "当前已经是最新版本",
      },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("app:downloadUpdate", async () => {
  try {
    const currentVersion = app.getVersion();
    const latest = await fetchLatestRelease();
    if (!latest || !latest.tagName) {
      return { success: false, error: "暂未找到 GitHub 发布版本" };
    }
    if (!isVersionGreater(latest.tagName, currentVersion)) {
      return { success: false, error: "当前已经是最新版本" };
    }
    const asset = pickUpdateAsset(latest.assets);
    if (!asset) {
      await shell.openExternal(latest.htmlUrl || `https://github.com/${GITHUB_REPO}/releases/latest`);
      return {
        success: true,
        data: {
          filePath: "",
          assetName: "",
          message: "当前更新源未提供安装包清单，已打开 GitHub Release 页面",
        },
      };
    }
    const filePath = await downloadUpdateAsset(asset, latest.tagName);
    const openError = await shell.openPath(filePath);
    if (openError) {
      await shell.showItemInFolder(filePath);
      return {
        success: true,
        data: {
          filePath,
          assetName: asset.name,
          message: `升级包已下载，请手动打开：${openError}`,
        },
      };
    }
    return {
      success: true,
      data: {
        filePath,
        assetName: asset.name,
        message: "升级包已下载并启动",
      },
    };
  } catch (err) {
    const latest = await fetchLatestRelease().catch(() => null);
    if (latest?.htmlUrl) {
      await shell.openExternal(latest.htmlUrl).catch(() => {});
    }
    const detail = err instanceof Error ? err.message : String(err);
    return { success: false, error: latest?.htmlUrl ? `${detail}；已打开发布页面，请手动下载。` : detail };
  }
});

const KimiThemePaletteSchema = z.object({
  primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  text: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  textStrong: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  textDim: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  textMuted: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  border: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  borderFocus: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  success: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  warning: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  error: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  diffAdded: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  diffRemoved: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  diffAddedStrong: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  diffRemovedStrong: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  diffGutter: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  diffMeta: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  roleUser: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

const ThemePaletteColorsSchema = z.object({
  primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  surface: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

const SettingsSchema = z.object({
  defaultModel: z.string().optional(),
  defaultThinking: z.boolean().optional(),
  defaultPlanMode: z.boolean().optional(),
  maxTurns: z.number().int().min(1).max(1000).optional(),
  enableCompaction: z.boolean().optional(),
  defaultPermissionMode: z.enum(["manual", "auto", "yolo"]).optional(),
  theme: z.enum(["dark", "light", "system"]).optional(),
  themePalette: z.string().refine((value) =>
    ["warm-paper", "neutral-gray", "soft-green", "warm-orange", "custom", "kimi"].includes(value) ||
    /^kimi:[^:]+/.test(value)
  ).optional(),
  customThemePalette: ThemePaletteColorsSchema.optional(),
  kimiThemePalette: KimiThemePaletteSchema.optional(),
  kimiThemePalettes: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(160),
    displayName: z.string().trim().min(1).max(180),
    path: z.string().optional(),
    base: z.enum(["light", "dark"]).optional(),
    palette: KimiThemePaletteSchema,
    colors: ThemePaletteColorsSchema.optional(),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
  })).optional(),
  fontSize: z.number().int().min(8).max(32).optional(),
  showThinking: z.boolean().optional(),
  detailedContext: z.boolean().optional(),
  statusUpdateDisplay: z.enum(["each", "turn_end"]).optional(),
  sessionRecommendationEnabled: z.boolean().optional(),
  sessionRecommendationTurnLimit: z.number().int().min(1).max(200).optional(),
  voiceShortcut: z.string().min(1).max(80).optional(),
  notificationMode: z.enum(["never", "unfocused", "always"]).optional(),
  clarificationToolMode: z.enum(["off", "on", "auto"]).optional(),
  clarificationToolEnabled: z.boolean().optional(),
  filePreviewExtensions: z.array(z.string().trim().min(1).max(16)).max(20).optional(),
  expandToolCalls: z.boolean().optional(),
  experimentalKimiServer: z.boolean().optional(),
  experimentalKimiServerSessions: z.boolean().optional(),
  experimentalKimiToolSelect: z.boolean().optional(),
  defaultOpenDir: z.string().optional(),
  selectedExecutablePath: z.string().optional(),
  selectedLaunchCommand: z.string().optional(),
  additionalWorkDirs: z.array(z.string()).optional(),
  autoReadAgentsMd: z.boolean().optional(),
  autoShowGitStatus: z.boolean().optional(),
  hookRules: z.array(z.object({
    id: z.string(),
    name: z.string(),
    event: z.enum(HOOK_EVENTS),
    matcher: z.string(),
    action: z.enum(["allow", "block", "notify", "run_command"]),
    command: z.string().optional(),
    reason: z.string().optional(),
    timeout: z.number().int().min(1).max(600).optional(),
    enabled: z.boolean(),
    scope: z.enum(["global", "project"]),
    projectPath: z.string().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })).optional(),
  hookRunLog: z.array(z.object({
    id: z.string(),
    ruleId: z.string(),
    ruleName: z.string(),
    event: z.enum(HOOK_EVENTS),
    action: z.enum(["allow", "block", "notify", "run_command"]),
    result: z.enum(["allow", "block", "notify", "run_command", "error"]),
    message: z.string(),
    timestamp: z.number(),
  })).optional(),
});

ipcMain.handle("app:saveSettings", async (_, settings: unknown) => {
  try {
    const parsed = SettingsSchema.safeParse(settings);
    if (!parsed.success) {
      return { success: false, error: "Invalid settings data" };
    }
    settingsService.saveSettings(parsed.data);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("app:triggerShortcut", async (_, request: unknown) => {
  try {
    const shortcut = request && typeof request === "object" && typeof (request as { shortcut?: unknown }).shortcut === "string"
      ? (request as { shortcut: string }).shortcut
      : "";
    await triggerKeyboardShortcut(shortcut);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("app:notifyTurnComplete", async (_, request: unknown) => {
  try {
    const payload = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const title = typeof payload.title === "string" ? payload.title.slice(0, 80) : "Kimix 本轮已完成";
    const body = typeof payload.body === "string" ? payload.body.slice(0, 180) : "当前轮次处理已完成，可以回来查看结果。";
    const windowFocused = payload.windowFocused === true;
    const pageVisible = payload.pageVisible === true;
    showTurnCompleteNotification(title, body, windowFocused, pageVisible);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.on("app:rendererHeartbeat", (_, payload: unknown) => {
  lastRendererHeartbeat = {
    receivedAt: Date.now(),
    payload: payload && typeof payload === "object" ? payload as RendererHeartbeatPayload : null,
  };
  rendererWatchdogReported = false;
});

ipcMain.on("app:rendererStartup", (_, payload: unknown) => {
  const data = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const label = typeof data.label === "string" ? data.label : "unknown";
  const elapsedMs = typeof data.elapsedMs === "number" && Number.isFinite(data.elapsedMs)
    ? Math.round(data.elapsedMs)
    : -1;
  console.info(`[KimixStartup] ${label} ${elapsedMs}ms`);
});

ipcMain.handle("app:clearTaskbarAttention", async () => {
  clearTaskbarAttention();
  return { success: true, data: undefined };
});

ipcMain.handle("app:scheduleShutdown", async (_, request: unknown) => {
  try {
    if (process.platform !== "win32") {
      return { success: false, error: "当前仅支持 Windows 延迟关机" };
    }
    const delaySeconds = request && typeof request === "object" && typeof (request as { delaySeconds?: unknown }).delaySeconds === "number"
      ? Math.max(0, Math.min(600, Math.round((request as { delaySeconds: number }).delaySeconds)))
      : 180;
    const reason = request && typeof request === "object" && typeof (request as { reason?: unknown }).reason === "string"
      ? (request as { reason: string }).reason.slice(0, 120)
      : "Kimix 长程任务执行完成";
    await runLongCommand("shutdown.exe", ["/s", "/t", String(delaySeconds), "/c", reason], 5000);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("app:cancelShutdown", async () => {
  try {
    if (process.platform !== "win32") {
      return { success: false, error: "当前仅支持 Windows 取消关机" };
    }
    await runLongCommand("shutdown.exe", ["/a"], 5000);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// --- 诊断日志落盘（供 renderer 主动写本地文件，方便排查"画面看不到内容"这类问题） ---
function getDiagLogPath() {
  return path.join(app.getPath("userData"), "diag.log");
}

function getProjectDiagLogPath() {
  // 也写一份到 process.cwd()（通常就是项目根目录），方便 agent/用户直接查看。
  return path.join(process.cwd(), "diag.log");
}

function trimLogFile(filePath: string) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 2 * 1024 * 1024) {
      const buf = fs.readFileSync(filePath);
      const tail = buf.slice(Math.max(0, buf.length - 512 * 1024));
      fs.writeFileSync(filePath, tail);
    }
  } catch { /* file may not exist yet */ }
}

function appendDiagLine(line: string) {
  const targets = [getDiagLogPath(), getProjectDiagLogPath()];
  for (const filePath of targets) {
    try {
      trimLogFile(filePath);
      fs.appendFileSync(filePath, line + "\n", "utf8");
    } catch (error) {
      console.warn("[diag] failed to append diag.log:", error);
    }
  }
}

ipcMain.handle("app:writeDiag", async (_, request: unknown) => {
  const req = request && typeof request === "object" ? (request as { message?: string; data?: unknown }) : {};
  const msg = typeof req.message === "string" ? req.message : typeof request === "string" ? request : "";
  if (!msg) return { success: false, error: "empty message" };
  const dataPart = req.data !== undefined ? ` ${JSON.stringify(req.data)}` : "";
  appendDiagLine(`[${new Date().toISOString()}] ${msg}${dataPart}`);
  return { success: true, data: undefined };
});

ipcMain.handle("app:getDiagLogPath", async () => {
  return { success: true, data: getDiagLogPath() };
});

ipcMain.handle("app:openExternal", async (_, url: string) => {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { success: false, error: "Invalid protocol" };
    }
    await shell.openExternal(url);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

// Window controls
ipcMain.handle("window:minimize", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
  return { success: true };
});

ipcMain.handle("window:maximize", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    emitWindowState();
  }
  return { success: true };
});

ipcMain.handle("window:reload", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.reloadIgnoringCache();
  }
  return { success: true, data: undefined };
});

ipcMain.handle("window:setZoomLevel", (_, delta: unknown) => {
  if (!mainWindow || mainWindow.isDestroyed() || typeof delta !== "number") {
    return { success: false, error: "Window not available" };
  }
  const current = mainWindow.webContents.getZoomLevel();
  const next = Math.max(-4, Math.min(4, current + delta));
  mainWindow.webContents.setZoomLevel(next);
  return { success: true, data: next };
});

ipcMain.handle("window:resetZoom", () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { success: false, error: "Window not available" };
  }
  mainWindow.webContents.setZoomLevel(0);
  return { success: true, data: 0 };
});

ipcMain.handle("window:toggleFullScreen", () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { success: false, error: "Window not available" };
  }
  const next = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(next);
  emitWindowState();
  return { success: true, data: next };
});

ipcMain.handle("window:isMaximized", () => {
  return {
    success: true,
    data: Boolean(mainWindow && !mainWindow.isDestroyed() && (mainWindow.isMaximized() || mainWindow.isFullScreen())),
  };
});

ipcMain.handle("window:close", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
  return { success: true };
});

app.on("before-quit", (event) => {
  if (isQuitting) return;
  const ids = kimiCodeHost.getActiveSessionIds();
  const serverStatus = kimiCodeServerHost.getStatus();
  if (ids.length === 0 && !serverStatus.managed) return;
  event.preventDefault();
  isQuitting = true;
  Promise.race([
    Promise.all([
      ...ids.map((id) => kimiCodeHost.closeSession(id).catch(() => {})),
      kimiCodeServerHost.stop().catch(() => {}),
    ]),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Shutdown timeout")), 10000)),
  ]).then(() => {
    app.quit();
  }).catch(() => {
    app.quit();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(() => {
  logMainStartup("app-ready");
  createWindow();
});

ipcMain.handle("kimi-code:activateSkill", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId.trim() : "";
    const name = typeof req.name === "string" ? req.name.trim() : "";
    const args = typeof req.args === "string" && req.args.trim() ? req.args.trim() : undefined;
    if (!sessionId) return { success: false, error: "Missing sessionId" };
    if (!name) return { success: false, error: "Missing skill name" };
    await kimiCodeHost.activateSkill(sessionId, name, args);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:listChildSessions", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    if (!sessionId) return { success: false, error: "Missing sessionId" };
    return { success: true, data: await kimiCodeHost.listChildSessions(sessionId) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi-code:createChildSession", async (_, request: unknown) => {
  try {
    const req = request && typeof request === "object" ? request as Record<string, unknown> : {};
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    const title = typeof req.title === "string" ? req.title.trim().slice(0, 200) : undefined;
    if (!sessionId) return { success: false, error: "Missing sessionId" };
    const data = await kimiCodeHost.createChildSession(sessionId, {
      title: title || undefined,
      metadata: { source: "kimix-child", parentSessionId: sessionId },
    });
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});
