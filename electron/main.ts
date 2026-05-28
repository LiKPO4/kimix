import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, net, Notification, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import AdmZip from "adm-zip";
import { z } from "zod";
import * as kimiBridge from "./kimiBridge";
import * as projectService from "./projectService";
import * as settingsService from "./settingsService";
import * as longTaskService from "./longTaskService";
import {
  authMCP,
  createKimiPaths,
  isLoggedIn,
  login,
  logout,
  parseConfig,
  resetAuthMCP,
  testMCP,
} from "@moonshot-ai/kimi-agent-sdk";
import type { ContentPart } from "@moonshot-ai/kimi-agent-sdk";

const GITHUB_REPO = "LiKPO4/kimix";
const KIMI_CODE_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
const KIMI_CODE_USAGE_URL = "https://api.kimi.com/coding/v1/usages";
const KIMI_CODE_REFRESH_URL = "https://auth.kimi.com/api/oauth/token";
const KIMI_CLI_INSTALL_PS1_URL = "https://code.kimi.com/install.ps1";
const KIMI_CLI_INSTALL_SH_URL = "https://code.kimi.com/install.sh";
const KIMI_CLI_PYPI_URL = "https://pypi.org/pypi/kimi-cli/json";
const SUPERPOWERS_ZIP_URL = "https://github.com/obra/superpowers/archive/refs/heads/main.zip";
const SUPERPOWERS_GIT_URL = "https://github.com/obra/superpowers.git";
const SUPERPOWERS_SKILL_NAMES = [
  "brainstorming",
  "dispatching-parallel-agents",
  "executing-plans",
  "finishing-a-development-branch",
  "receiving-code-review",
  "requesting-code-review",
  "subagent-driven-development",
  "systematic-debugging",
  "test-driven-development",
  "using-git-worktrees",
  "using-superpowers",
  "verification-before-completion",
  "writing-plans",
  "writing-skills",
];

const HOOK_EVENTS = ["PreToolUse", "PostToolUse", "PostToolUseFailure", "Notification", "Stop", "StopFailure", "UserPromptSubmit", "SessionStart", "SessionEnd", "SubagentStart", "SubagentStop", "PreCompact", "PostCompact"] as const;
const HOOK_ACTIONS = ["allow", "block", "notify", "run_command"] as const;

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

function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { windowsHide: true, timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
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
    const child = execFile(command, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
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
  const match = output.match(/(?:kimi-cli version:|kimi,\s*version)\s*v?([0-9]+(?:\.[0-9]+){1,3})/i);
  return match?.[1] ?? null;
}

async function getInstalledKimiCliInfo() {
  const kimiPath = await resolveCommand("kimi");
  if (!kimiPath) {
    return {
      available: false,
      path: undefined,
      version: null,
      output: "",
    };
  }
  const output = await runCommand(kimiPath, ["--version"]).catch(() => "");
  return {
    available: true,
    path: kimiPath,
    version: extractKimiCliVersion(output),
    output,
  };
}

async function fetchLatestKimiCliVersion() {
  const res = await fetch(KIMI_CLI_PYPI_URL, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "Kimix",
    },
  });
  if (!res.ok) throw new Error(`PyPI 返回 ${res.status}`);
  const data = await res.json() as { info?: { version?: unknown } };
  const version = data.info && typeof data.info.version === "string" ? data.info.version : "";
  if (!version) throw new Error("PyPI 未返回 Kimi CLI 最新版本");
  return version;
}

async function checkKimiCliUpdate() {
  const [installed, latestVersion] = await Promise.all([
    getInstalledKimiCliInfo(),
    fetchLatestKimiCliVersion(),
  ]);
  if (!installed.available) {
    return {
      available: false,
      currentVersion: null,
      latestVersion,
      hasUpdate: true,
      path: undefined,
      message: `未找到 Kimi CLI，可安装最新版本 ${latestVersion}`,
    };
  }
  const currentVersion = installed.version;
  const hasUpdate = currentVersion ? isVersionGreater(latestVersion, currentVersion) : true;
  return {
    available: true,
    currentVersion,
    latestVersion,
    hasUpdate,
    path: installed.path,
    message: hasUpdate
      ? `发现 Kimi CLI 新版本 ${latestVersion}`
      : `Kimi CLI 已是最新版本 ${currentVersion ?? latestVersion}`,
  };
}

async function updateKimiCli() {
  const latestVersion = await fetchLatestKimiCliVersion();
  const uvPath = await resolveCommand("uv");
  let output = "";
  let upgradeError = "";
  if (uvPath) {
    try {
      output = await runLongCommand(uvPath, ["tool", "upgrade", "kimi-cli"]);
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

  const checked = await checkKimiCliUpdate();
  if (checked.currentVersion && !isVersionGreater(latestVersion, checked.currentVersion)) {
    return {
      ...checked,
      latestVersion,
      hasUpdate: false,
      output: output || upgradeError,
      message: upgradeError
        ? `Kimi CLI 已更新到 ${checked.currentVersion}，但安装器提示：${upgradeError}`
        : `Kimi CLI 已更新到 ${checked.currentVersion}`,
    };
  }

  throw new Error(upgradeError || `Kimi CLI 更新后仍未达到最新版本 ${latestVersion}`);
}

async function installKimiCli() {
  if (process.platform === "win32") {
    const output = await runLongCommand("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Invoke-RestMethod ${KIMI_CLI_INSTALL_PS1_URL} | Invoke-Expression`,
    ]);
    const kimiPath = await resolveCommand("kimi");
    if (!kimiPath) throw new Error("安装完成后仍未找到 kimi 命令，请重新打开 Kimix 后再试");
    const version = await runCommand(kimiPath, ["--version"]).catch(() => output);
    return { path: kimiPath, output: version, message: "Kimi CLI 安装完成" };
  }

  const shellPath = await resolveCommand("bash");
  if (!shellPath) throw new Error("未找到 bash，无法执行 Kimi CLI 安装脚本");
  const output = await runLongCommand(shellPath, ["-lc", `curl -LsSf ${KIMI_CLI_INSTALL_SH_URL} | bash`]);
  const kimiPath = await resolveCommand("kimi");
  if (!kimiPath) throw new Error("安装完成后仍未找到 kimi 命令，请重新打开 Kimix 后再试");
  const version = await runCommand(kimiPath, ["--version"]).catch(() => output);
  return { path: kimiPath, output: version, message: "Kimi CLI 安装完成" };
}

type McpServerRecord = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  url?: string;
  transport?: "http" | "stdio";
  auth?: "oauth" | string;
};

function getKimiPaths() {
  return createKimiPaths(process.env.KIMI_SHARE_DIR);
}

async function getKimiAuthStatus() {
  const kimiPath = await resolveCommand("kimi");
  const paths = getKimiPaths();
  const config = parseConfig(process.env.KIMI_SHARE_DIR);
  const loggedIn = isLoggedIn(process.env.KIMI_SHARE_DIR);
  return {
    available: Boolean(kimiPath),
    path: kimiPath ?? undefined,
    loggedIn,
    configPath: paths.config,
    mcpConfigPath: paths.mcpConfig,
    defaultModel: config.defaultModel,
    defaultThinking: config.defaultThinking,
    message: !kimiPath
      ? "未找到 kimi CLI，请先安装或检查 PATH"
      : loggedIn
        ? "Kimi CLI 已登录"
        : "Kimi CLI 已安装，但当前未登录",
  };
}

function readMcpServers() {
  const paths = getKimiPaths();
  if (!fs.existsSync(paths.mcpConfig)) {
    return {
      configPath: paths.mcpConfig,
      servers: [],
      rawExists: false,
    };
  }
  const raw = fs.readFileSync(paths.mcpConfig, "utf-8");
  const parsed = JSON.parse(raw) as { mcpServers?: Record<string, McpServerRecord> };
  const entries = parsed && parsed.mcpServers && typeof parsed.mcpServers === "object" ? parsed.mcpServers : {};
  const servers = Object.entries(entries).map(([name, value]) => ({
    name,
    transport: value.transport === "http" || value.url ? "http" as const : "stdio" as const,
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
    rawExists: true,
  };
}

async function requireKimiExecutable() {
  const kimiPath = await resolveCommand("kimi");
  if (!kimiPath) {
    throw new Error("未找到 kimi CLI，请先安装或检查 PATH");
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

function isPathInside(parent: string, child: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveReadableTextFile(requestPath: string, projectPath?: string) {
  const trimmedPath = requestPath.trim();
  if (!trimmedPath) throw new Error("Missing file path");

  const kimiPlansDir = path.join(os.homedir(), ".kimi", "plans");
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
  const isKimiPlanRelative = normalizedRequest.startsWith(".kimi/plans/");
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
  const allowedExts = new Set([".md", ".txt", ".json", ".log", ".yaml", ".yml"]);
  if (!allowedExts.has(ext)) {
    throw new Error("Only text files can be read");
  }

  const stat = fs.statSync(resolvedFile);
  if (!stat.isFile()) throw new Error("Path is not a file");
  if (stat.size > 1024 * 1024) throw new Error("Text file is too large");
  return { resolvedFile, updatedAt: stat.mtimeMs };
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
  const windowAvailable = Boolean(mainWindow && !mainWindow.isDestroyed());
  const windowFocused = rendererWindowFocused || Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused());
  const windowVisible = windowAvailable && Boolean(mainWindow?.isVisible()) && !mainWindow?.isMinimized();
  const userCanSeeKimix = windowFocused || (rendererPageVisible && windowVisible);
  if (notificationMode === "never") return;
  if (notificationMode === "unfocused" && userCanSeeKimix) return;
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
      console.log(`[RENDERER] content check rootHtml=${result.rootHtmlLength} bodyText=${result.bodyTextLength} children=${result.rootChildCount}`);
      if (result.rootHtmlLength === 0 && result.rootChildCount === 0 && !rendererReloadedAfterBlank) {
        rendererReloadedAfterBlank = true;
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

async function fetchLatestRelease() {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": "Kimix",
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub 返回 ${res.status}`);
  const data = await res.json() as {
    tag_name?: unknown;
    name?: unknown;
    body?: unknown;
    published_at?: unknown;
    html_url?: unknown;
    assets?: unknown;
  };
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

type ReleaseAssetInfo = {
  name: string;
  downloadUrl: string;
  size?: number;
};

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

async function downloadUpdateAsset(asset: ReleaseAssetInfo, tagName: string) {
  const updateDir = path.join(app.getPath("downloads"), "Kimix Updates", sanitizeDownloadName(tagName || "latest"));
  ensureDirectoryExists(updateDir);
  const targetPath = path.join(updateDir, sanitizeDownloadName(asset.name));
  const tempPath = `${targetPath}.download`;
  let response: Response;
  try {
    response = await fetch(asset.downloadUrl, {
      headers: {
        "User-Agent": "Kimix",
      },
    });
  } catch (fetchError) {
    try {
      response = await net.fetch(asset.downloadUrl, {
        headers: {
          "User-Agent": "Kimix",
        },
      });
    } catch (netError) {
      const detail = netError instanceof Error ? netError.message : fetchError instanceof Error ? fetchError.message : String(netError);
      throw new Error(`下载失败：${detail}`);
    }
  }
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

function searchProjectFiles(projectPath: string, query = "", limit = 40) {
  const normalizedQuery = query.trim().toLowerCase();
  const maxResults = Math.max(1, Math.min(limit, 80));
  const results: { path: string; name: string }[] = [];

  function walk(dir: string, depth: number) {
    if (results.length >= maxResults || depth > 8) return;
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
      const relativePath = path.relative(projectPath, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (normalizedQuery && !relativePath.toLowerCase().includes(normalizedQuery)) continue;
      results.push({ path: relativePath, name: entry.name });
    }
  }

  walk(projectPath, 0);
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
    path.join(os.homedir(), ".kimi", "skills"),
    path.join(os.homedir(), ".config", "agents", "skills"),
    path.join(os.homedir(), ".codex", "skills"),
  ];
  const settings = settingsService.loadSettings();
  const enabled = new Set(settings.enabledSkillNames ?? []);
  const results: { name: string; description: string; path: string; source: string; enabled: boolean }[] = [];
  const seen = new Set<string>();

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
    for (const skillPath of collectSkillFiles(root)) {
      const normalizedSkillPath = path.resolve(skillPath);
      if (seen.has(normalizedSkillPath)) continue;
      try {
        const raw = fs.readFileSync(skillPath, "utf-8");
        const meta = parseSkillFrontmatter(raw);
        const skillDir = path.dirname(skillPath);
        const fallbackName = path.basename(skillDir);
        results.push({
          name: meta.name || fallbackName,
          description: meta.description || "本地 Skill",
          path: skillPath,
          source: root,
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

function superpowersAgentFile() {
  return path.join(os.homedir(), ".kimix", "superpowers-agent.yaml");
}

function legacySuperpowersAgentFile() {
  return path.join(os.homedir(), ".kimix", "superpowers-agent.md");
}

function importedSkillsDir() {
  return path.join(os.homedir(), ".kimix", "skills");
}

function superpowersSkillsDir() {
  return path.join(importedSkillsDir(), "superpowers");
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

async function downloadFile(url: string, targetPath: string) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`下载失败：HTTP ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, buffer);
}

function findCachedSuperpowersSkillsRoot() {
  const candidates: string[] = [];
  try {
    const tempEntries = fs.readdirSync(os.tmpdir(), { withFileTypes: true });
    for (const entry of tempEntries) {
      if (!entry.isDirectory() || !entry.name.startsWith("kimix-superpowers-check-")) continue;
      candidates.push(path.join(os.tmpdir(), entry.name, "skills"));
    }
  } catch {
    // Temp directory may be inaccessible in restricted environments.
  }
  candidates.push(
    path.join(os.homedir(), ".codex", "plugins", "cache", "superpowers", "skills"),
    path.join(os.homedir(), ".claude", "plugins", "superpowers", "skills"),
  );
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, "using-superpowers", "SKILL.md"))) ?? null;
}

async function cloneSuperpowersTo(targetDir: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("git", ["clone", "--depth", "1", SUPERPOWERS_GIT_URL, targetDir], {
      windowsHide: true,
      stdio: "pipe",
    });
    let output = "";
    child.stdout?.on("data", (chunk) => { output += String(chunk); });
    child.stderr?.on("data", (chunk) => { output += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(output.trim() || `git clone exited with ${code}`));
    });
  });
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

function findSuperpowersSkillsRoot(root: string) {
  const candidates = [
    path.join(root, "skills"),
    ...fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name, "skills")),
  ];
  const found = candidates.find((candidate) => (
    fs.existsSync(path.join(candidate, "using-superpowers", "SKILL.md"))
  ));
  if (!found) {
    throw new Error("Superpowers 压缩包内未找到 skills/using-superpowers/SKILL.md");
  }
  return found;
}

async function installSuperpowersSkills() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kimix-superpowers-"));
  try {
    const errors: string[] = [];
    let sourceSkillsRoot = findCachedSuperpowersSkillsRoot();
    if (!sourceSkillsRoot) {
      const cloneDir = path.join(tempDir, "repo");
      try {
        await cloneSuperpowersTo(cloneDir);
        sourceSkillsRoot = path.join(cloneDir, "skills");
      } catch (err) {
        errors.push(`git clone: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (!sourceSkillsRoot || !fs.existsSync(path.join(sourceSkillsRoot, "using-superpowers", "SKILL.md"))) {
      const archivePath = path.join(tempDir, "superpowers.zip");
      try {
        await downloadFile(SUPERPOWERS_ZIP_URL, archivePath);
        const extractedDir = path.join(tempDir, "extracted");
        extractArchiveSafe(archivePath, extractedDir);
        sourceSkillsRoot = findSuperpowersSkillsRoot(extractedDir);
      } catch (err) {
        errors.push(`zip download: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (!sourceSkillsRoot || !fs.existsSync(path.join(sourceSkillsRoot, "using-superpowers", "SKILL.md"))) {
      throw new Error(`安装 Superpowers 失败：${errors.join("；") || "未找到可用的 Superpowers skills"}`);
    }
    const targetRoot = superpowersSkillsDir();
    fs.rmSync(targetRoot, { recursive: true, force: true });
    fs.mkdirSync(targetRoot, { recursive: true });
    copyDirectorySafe(sourceSkillsRoot, targetRoot);

    const allSkills = listLocalSkills();
    const installed = allSkills.filter((skill) => path.resolve(skill.path).startsWith(path.resolve(targetRoot)));
    const installedNames = installed.map((skill) => skill.name);
    const settings = settingsService.loadSettings();
    const enabledNames = Array.from(new Set([
      ...(settings.enabledSkillNames ?? []),
      ...SUPERPOWERS_SKILL_NAMES.filter((name) => installedNames.includes(name)),
    ]));
    const synced = syncEnabledSkills(enabledNames);
    return {
      installed,
      skills: listLocalSkills(),
      enabledNames: synced.enabledNames,
      enabledDir: synced.enabledDir,
    };
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

function readSuperpowersBootstrap() {
  const settings = settingsService.loadSettings();
  const enabledNames = settings.enabledSkillNames ?? [];
  const skillsDir = settings.enabledSkillsDir || enabledSkillsDir();
  const agentFile = superpowersAgentFile();
  const legacyAgentFile = legacySuperpowersAgentFile();
  const diagnostics: string[] = [];
  if (!enabledNames.includes("using-superpowers")) {
    diagnostics.push("using-superpowers 未启用");
    return {
      enabled: false,
      content: "",
      agentFile,
      skillsDir,
      enabledNames,
      superpowerSkills: [],
      agentFileExists: fs.existsSync(agentFile),
      skillsDirExists: fs.existsSync(skillsDir),
      legacyAgentFileExists: fs.existsSync(legacyAgentFile),
      diagnostics,
    };
  }
  const skills = listLocalSkills().filter((item) => enabledNames.includes(item.name));
  const usingSkill = skills.find((item) => item.name === "using-superpowers");
  if (!usingSkill || !fs.existsSync(usingSkill.path)) {
    diagnostics.push("using-superpowers 已勾选，但没有找到对应 SKILL.md");
    return {
      enabled: false,
      content: "",
      agentFile,
      skillsDir,
      enabledNames,
      superpowerSkills: [],
      agentFileExists: fs.existsSync(agentFile),
      skillsDirExists: fs.existsSync(skillsDir),
      legacyAgentFileExists: fs.existsSync(legacyAgentFile),
      diagnostics,
    };
  }
  const superpowerSkills = skills
    .filter((item) => path.resolve(item.path).includes(`${path.sep}superpowers${path.sep}`))
    .map((item) => item.name)
    .sort();
  diagnostics.push(`using-superpowers 已启用：${usingSkill.path}`);
  diagnostics.push(`--skills-dir：${skillsDir}`);
  diagnostics.push(`--agent-file：${agentFile}`);
  if (superpowerSkills.length === 0) diagnostics.push("未识别到来自 superpowers 目录的 Skill");
  if (fs.existsSync(legacyAgentFile)) diagnostics.push(`发现旧 agent 文件残留：${legacyAgentFile}`);
  const roleAdditional = [
    "当前会话已启用 Superpowers skills，并已通过 Kimi CLI 的 --skills-dir 提供给你。",
    "不要把本文件内容复述给用户，不要声称调用了不存在的 Skill tool。",
    "在回答或执行用户任务前，先判断是否有相关 Superpowers skill 适用；如果适用，请按该 skill 的工作流执行，并在回复开头用一句中文简短说明“我会按 <skill-name> 的流程处理”。",
    "如果需要读取 skill 内容，请使用当前可用的文件/读取工具查看启用 skills 目录下对应的 SKILL.md；不要把整篇 SKILL.md 原样展示给用户。",
    superpowerSkills.length > 0 ? `当前可用 Superpowers skills：${superpowerSkills.join("、")}` : "",
  ].filter(Boolean).join("\n");
  const content = [
    "version: 1",
    "agent:",
    "  extend: default",
    "  name: Kimix Superpowers",
    "  system_prompt_args:",
    "    ROLE_ADDITIONAL: |",
    ...roleAdditional.split("\n").map((line) => `      ${line}`),
    "",
  ].join("\n");
  fs.mkdirSync(path.dirname(agentFile), { recursive: true });
  fs.writeFileSync(agentFile, content, "utf-8");
  return {
    enabled: true,
    content: roleAdditional,
    agentFile,
    skillsDir,
    enabledNames,
    superpowerSkills,
    agentFileExists: fs.existsSync(agentFile),
    skillsDirExists: fs.existsSync(skillsDir),
    legacyAgentFileExists: fs.existsSync(legacyAgentFile),
    usingSkillPath: usingSkill.path,
    diagnostics,
  };
}

function resolveAgentFileForSkills(skillsDir?: string) {
  const bootstrap = readSuperpowersBootstrap();
  if (!bootstrap.enabled || !bootstrap.agentFile) return undefined;
  if (!skillsDir) return undefined;
  return bootstrap.agentFile;
}

type KimiOAuthToken = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
  token_type: string;
  expires_in?: number;
};

type KimiUsagePeriod = {
  label: string;
  used?: number;
  limit?: number;
  percent?: number;
  available: boolean;
  refreshAt?: number;
  message?: string;
};

function kimiShareDir() {
  return path.join(os.homedir(), ".kimi");
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
    "X-Msh-Platform": "kimi_cli",
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
    throw new Error("未找到 Kimi 登录凭证，请先在 Kimi Code CLI 中完成登录");
  }
  const raw = JSON.parse(fs.readFileSync(tokenPath, "utf-8")) as Partial<KimiOAuthToken>;
  if (!raw.access_token || !raw.refresh_token) {
    throw new Error("Kimi 登录凭证不完整，请重新登录 Kimi Code CLI");
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
  const res = await fetch(KIMI_CODE_REFRESH_URL, {
    method: "POST",
    headers: {
      ...kimiCommonHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: KIMI_CODE_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
    }),
  });
  if (!res.ok) {
    throw new Error(`Kimi 登录刷新失败：HTTP ${res.status}`);
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

function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function toTimestamp(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "number") {
    const normalized = value > 0 && value < 10_000_000_000 ? value * 1000 : value;
    return Number.isFinite(normalized) ? normalized : undefined;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return toTimestamp(numeric);
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function findRefreshTimestamp(detail: Record<string, unknown> | null, fallback: number): number {
  const keys = [
    "refreshAt",
    "resetTime",
    "refreshTime",
    "resetAt",
    "resetsAt",
    "nextRefreshAt",
    "nextResetAt",
    "nextRefreshTime",
    "nextResetTime",
    "next_reset_time",
    "reset_time",
    "expireAt",
    "expiresAt",
  ];
  for (const source of [detail, getRecord(detail?.window)]) {
    if (!source) continue;
    for (const key of keys) {
      const timestamp = toTimestamp(source[key]);
      if (timestamp !== undefined) return timestamp;
    }
  }
  return fallback;
}

function usagePeriodFromDetail(label: string, detail: Record<string, unknown> | null, fallbackRefreshAt: number): KimiUsagePeriod {
  if (!detail) return { label, available: false, percent: 0, refreshAt: fallbackRefreshAt, message: "暂无官方数据" };
  const limit = toNumber(detail.limit);
  const remaining = toNumber(detail.remaining);
  let used = toNumber(detail.used);
  if (used === undefined && limit !== undefined && remaining !== undefined) {
    used = Math.max(0, limit - remaining);
  }
  const refreshAt = findRefreshTimestamp(detail, fallbackRefreshAt);
  if (limit === undefined || used === undefined || limit <= 0) {
    return { label, available: false, percent: 0, refreshAt, message: "暂无官方数据" };
  }
  return {
    label,
    used,
    limit,
    percent: Math.max(0, Math.min(100, (used / limit) * 100)),
    available: true,
    refreshAt,
  };
}

function findWindowLimit(payload: Record<string, unknown>, duration: number, timeUnit: string) {
  const limits = Array.isArray(payload.limits) ? payload.limits : [];
  for (const item of limits) {
    const itemRecord = getRecord(item);
    if (!itemRecord) continue;
    const window = getRecord(itemRecord.window);
    const detail = getRecord(itemRecord.detail) ?? itemRecord;
    const itemDuration = toNumber(window?.duration ?? itemRecord.duration ?? detail.duration);
    const itemUnit = String(window?.timeUnit ?? itemRecord.timeUnit ?? detail.timeUnit ?? "");
    if (itemDuration === duration && itemUnit.includes(timeUnit)) {
      return { ...detail, window };
    }
  }
  return null;
}

function nextWeekRefreshAt(now: number) {
  const date = new Date(now);
  const day = date.getDay();
  const daysUntilMonday = day === 0 ? 1 : 8 - day;
  date.setDate(date.getDate() + daysUntilMonday);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function parseKimiUsagePayload(payload: Record<string, unknown>) {
  const updatedAt = Date.now();
  const fiveHour = usagePeriodFromDetail("5小时", findWindowLimit(payload, 300, "MINUTE"), updatedAt + 5 * 60 * 60 * 1000);
  const weekly = usagePeriodFromDetail("本周", getRecord(payload.usage), nextWeekRefreshAt(updatedAt));
  return {
    available: [fiveHour, weekly].some((period) => period.available),
    updatedAt,
    source: "Kimi Code 官方用量接口",
    periods: [fiveHour, weekly],
  };
}

function getDefaultProject() {
  const workDir = path.join(app.getPath("userData"), "default-project");
  ensureDirectoryExists(workDir);
  return {
    id: "default-kimi-project",
    path: workDir,
    name: "kimix",
    lastOpenedAt: Date.now(),
  };
}

function createWindow() {
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
    },
    autoHideMenuBar: true,
    frame: false,
    icon: path.join(process.env.APP_ROOT, "..", "Kimix.png"),
  });

  kimiBridge.setMainWindow(mainWindow);

  if (DEV_SERVER_URL) {
    mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(RENDERER_DIST, "index.html"));
  }

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[RENDERER] did-fail-load ${errorCode} ${errorDescription} ${validatedURL}`);
  });

  mainWindow.webContents.once("did-finish-load", () => {
    void restoreLastContext();
    emitWindowState();
    verifyRendererContent();
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
    mainWindow = null;
    kimiBridge.setMainWindow(null);
  });
  mainWindow.on("maximize", emitWindowState);
  mainWindow.on("unmaximize", emitWindowState);
  mainWindow.on("restore", emitWindowState);
  mainWindow.on("enter-full-screen", emitWindowState);
  mainWindow.on("leave-full-screen", emitWindowState);
}

async function restoreLastContext() {
  const recentProjects = projectService.getRecentProjects();
  const project = recentProjects[0] ?? getDefaultProject();

  projectService.addRecentProject(project);

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
    name: path.basename(p),
    lastOpenedAt: Date.now(),
    gitBranch: await projectService.getGitBranch(p),
  };
  projectService.addRecentProject(project);
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
    projectService.addRecentProject(defaultProject);
    projects = [defaultProject];
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
  afkMode: z.boolean().optional(),
});

ipcMain.handle("project:addRecent", async (_, project: unknown) => {
  const parsed = ProjectSchema.safeParse(project);
  if (!parsed.success) {
    return { success: false, error: "Invalid project data" };
  }
  projectService.addRecentProject(parsed.data);
  return { success: true, data: undefined };
});

ipcMain.handle("project:removeRecent", async (_, id: unknown) => {
  if (typeof id !== "string") {
    return { success: false, error: "Invalid project id" };
  }
  projectService.removeRecentProject(id);
  return { success: true, data: undefined };
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
  let reviewerSessionId: string | null = null;
  try {
    const parsed = CreateLongTaskSchema.safeParse(request);
    if (!parsed.success) {
      return { success: false, error: "Invalid long task create request" };
    }
    const { project, initialRequest } = parsed.data;
    if (!fs.existsSync(project.path)) {
      return { success: false, error: "Project path does not exist" };
    }
    projectService.addRecentProject({ ...project, lastOpenedAt: Date.now() });
    const title = (parsed.data.title?.trim() || initialRequest.trim().split(/\r?\n/)[0] || "长程任务").slice(0, 80);
    const thinking = parsed.data.thinking ?? true;
    const yoloMode = parsed.data.yoloMode ?? false;
    const afkMode = parsed.data.afkMode ?? false;

    const executor = await kimiBridge.startSession({
      workDir: project.path,
      model: "kimi-code/kimi-for-coding",
      thinking,
      yoloMode,
      afkMode,
    });
    executorSessionId = executor.sessionId;

    const reviewer = await kimiBridge.startSession({
      workDir: project.path,
      model: "kimi-code/kimi-for-coding",
      thinking,
      yoloMode,
      afkMode,
    });
    reviewerSessionId = reviewer.sessionId;

    const task = longTaskService.createLongTask({
      project,
      title,
      initialRequest,
      executorSessionId,
      reviewerSessionId,
    });
    return { success: true, data: task };
  } catch (err) {
    if (executorSessionId) await kimiBridge.closeSession(executorSessionId).catch(() => {});
    if (reviewerSessionId) await kimiBridge.closeSession(reviewerSessionId).catch(() => {});
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("project:getGitInfo", async (_, projectPath: string) => {
  const branch = await projectService.getGitBranch(projectPath);
  const status = await projectService.getGitStatus(projectPath);
  return { success: true, data: { branch, status } };
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
    const req = request as { projectPath?: unknown; query?: unknown; limit?: unknown };
    if (typeof req.projectPath !== "string" || !req.projectPath) {
      return { success: false, error: "Invalid project path" };
    }
    if (!fs.existsSync(req.projectPath)) {
      return { success: false, error: "Project path does not exist" };
    }
    const query = typeof req.query === "string" ? req.query : "";
    const limit = typeof req.limit === "number" ? req.limit : 40;
    return { success: true, data: searchProjectFiles(req.projectPath, query, limit) };
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

ipcMain.handle("project:installSuperpowers", async () => {
  try {
    return { success: true, data: await installSuperpowersSkills() };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("project:getSuperpowersBootstrap", async () => {
  try {
    return { success: true, data: readSuperpowersBootstrap() };
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
    if (requestPath.trim() === "__latest_kimi_plan__") {
      const kimiPlansDir = path.join(os.homedir(), ".kimi", "plans");
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

只允许输出一个 JSON 对象，不要 Markdown，不要解释。

字段要求：
- name: 简短中文名称，最多 20 个汉字。
- event: 只能是 PreToolUse / PostToolUse / PostToolUseFailure / Notification / Stop / StopFailure / UserPromptSubmit / SessionStart / SessionEnd / SubagentStart / SubagentStop / PreCompact / PostCompact。
- matcher: 简短正则或关键词，用来匹配工具名、命令、文件路径、事件摘要或会话状态；SessionStart/SubagentStart 通常用 ".*"。
- action: 只能是 allow / block / notify / run_command。
- command: 必须尽量填写真正可执行的一行 hook 脚本；Kimi hooks 会执行 command，并把 hook 事件 JSON 传入 stdin，stdout 会补充给 agent 上下文，退出码 2 表示阻断。
- reason: 面向用户展示的阻断、通知或执行说明，必须具体写清楚触发后做什么。
- timeout: 秒数，通知/提示 30，构建/测试 120。
- enabled: true。
- scope: global 或 project。

选择规则：
- 危险命令、删除、强推、重置：PreToolUse + block，command 要检查 stdin 中的命令并在命中时输出风险说明后 exit 2。
- 任务结束后构建、测试、lint：Stop + run_command，command 填用户要求的真实命令。
- 失败、等待用户、需要提醒：StopFailure + notify，command 要输出提醒文本。
- 每轮用户输入前、每次注入上下文、提示当前时间：UserPromptSubmit + notify，command 要输出要注入上下文的文本。
- 会话创建时一次性提示：SessionStart + notify。
- 子 agent 启动时提示：SubagentStart + notify。
- 如果用户说“每轮开始前/每轮开始时提示当前时间给 agent”，必须生成能输出当前时间的 command：
  powershell -NoProfile -Command "Write-Output ('当前时间：' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))"

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
    next.reason = next.reason?.trim() || "每轮开始时把当前时间写入 hook 输出，提示给 agent。";
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
    const workDir = projectPath && fs.existsSync(projectPath) ? projectPath : app.getPath("home");
    const output = await kimiBridge.runOneShotPrompt({
      workDir,
      sessionId: `kimix-hidden-hooks-${randomUUID()}`,
      content: buildHookRulePrompt(description),
      thinking: true,
      yoloMode: false,
      timeoutMs: 120000,
    });
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
    const kimiPath = await resolveCommand("kimi");
    if (!kimiPath) {
      return {
        success: true,
        data: {
          available: false,
          verified: false,
          command: "kimi",
          message: "未找到 kimi CLI，请检查 PATH",
        },
      };
    }
    if (request?.verify) {
      const output = await runCommand(kimiPath, ["--version"]);
      return {
        success: true,
        data: {
          available: true,
          verified: true,
          command: "kimi",
          path: kimiPath,
          output,
          message: output || "Kimi CLI 响应正常",
        },
      };
    }
    return {
      success: true,
      data: {
        available: true,
        verified: false,
        command: "kimi",
        path: kimiPath,
        message: "已找到 kimi CLI，点击检查验证响应",
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

ipcMain.handle("kimi:login", async () => {
  try {
    const kimiPath = await requireKimiExecutable();
    let verificationUrl = "";
    const result = await login({
      executable: kimiPath,
      onUrl: (url) => {
        verificationUrl = url;
        void shell.openExternal(url).catch(() => {});
      },
    });
    if (!result.success) {
      return { success: false, error: result.error ?? "登录失败" };
    }
    const status = await getKimiAuthStatus();
    return {
      success: true,
      data: {
        ...status,
        verificationUrl: verificationUrl || undefined,
        message: status.loggedIn ? "登录完成" : (verificationUrl ? "已打开登录链接，请在浏览器中继续完成授权" : status.message),
      },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:logout", async () => {
  try {
    const kimiPath = await requireKimiExecutable();
    const result = await logout({ executable: kimiPath });
    if (!result.success) {
      return { success: false, error: result.error ?? "退出登录失败" };
    }
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
    const parsed = z.object({
      name: z.string().trim().min(1),
      transport: z.enum(["http", "stdio"]),
      url: z.string().trim().optional(),
      command: z.string().trim().optional(),
      args: z.array(z.string().trim()).optional(),
      env: z.array(z.string().trim()).optional(),
      headers: z.array(z.string().trim()).optional(),
      auth: z.literal("oauth").optional(),
    }).parse(request);
    const kimiPath = await requireKimiExecutable();
    const args = ["mcp", "add", parsed.name, "--transport", parsed.transport];
    if (parsed.auth) args.push("--auth", parsed.auth);
    for (const envValue of parsed.env ?? []) {
      if (envValue) args.push("--env", envValue);
    }
    for (const headerValue of parsed.headers ?? []) {
      if (headerValue) args.push("--header", headerValue);
    }
    if (parsed.transport === "http") {
      if (!parsed.url) throw new Error("HTTP MCP 需要填写 URL");
      args.push(parsed.url);
    } else {
      if (!parsed.command) throw new Error("stdio MCP 需要填写命令");
      args.push("--", parsed.command, ...(parsed.args ?? []).filter(Boolean));
    }
    await runCommand(kimiPath, args);
    return { success: true, data: { message: `已添加 MCP 服务 ${parsed.name}` } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:removeMcpServer", async (_, request: unknown) => {
  try {
    const parsed = z.object({ name: z.string().trim().min(1) }).parse(request);
    const kimiPath = await requireKimiExecutable();
    await runCommand(kimiPath, ["mcp", "remove", parsed.name]);
    return { success: true, data: { message: `已移除 MCP 服务 ${parsed.name}` } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:authMcpServer", async (_, request: unknown) => {
  try {
    const parsed = z.object({ name: z.string().trim().min(1) }).parse(request);
    const kimiPath = await requireKimiExecutable();
    await authMCP(parsed.name, { executable: kimiPath });
    return { success: true, data: { message: `已完成 ${parsed.name} 的 MCP 授权` } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:resetMcpServerAuth", async (_, request: unknown) => {
  try {
    const parsed = z.object({ name: z.string().trim().min(1) }).parse(request);
    const kimiPath = await requireKimiExecutable();
    await resetAuthMCP(parsed.name, { executable: kimiPath });
    return { success: true, data: { message: `已重置 ${parsed.name} 的 MCP 授权` } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:testMcpServer", async (_, request: unknown) => {
  try {
    const parsed = z.object({ name: z.string().trim().min(1) }).parse(request);
    const kimiPath = await requireKimiExecutable();
    const result = await testMCP(parsed.name, { executable: kimiPath });
    return { success: true, data: result };
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

ipcMain.handle("kimi:startSession", async (_, request: { workDir: string; sessionId?: string; model?: string; thinking?: boolean; yoloMode?: boolean; planMode?: boolean; afkMode?: boolean; skillsDir?: string; agentFile?: string }) => {
  try {
    const settings = settingsService.loadSettings();
    const skillsDir = request.skillsDir || ((settings.enabledSkillNames ?? []).length > 0 ? settings.enabledSkillsDir || enabledSkillsDir() : undefined);
    const agentFile = request.agentFile || resolveAgentFileForSkills(skillsDir);
    const result = await kimiBridge.startSession({ ...request, skillsDir, agentFile });
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:listSlashCommands", async (_, request: { sessionId: string }) => {
  try {
    const sessionId = request && typeof request.sessionId === "string" ? request.sessionId : "";
    if (!sessionId) {
      return { success: false, error: "Missing sessionId" };
    }
    const commands = await Promise.race([
      kimiBridge.getSlashCommands(sessionId),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("List slash commands timed out")), 6000)),
    ]);
    return { success: true, data: commands };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:setPlanMode", async (_, request: unknown) => {
  try {
    if (!request || typeof request !== "object") {
      return { success: false, error: "Invalid request" };
    }
    const req = request as Record<string, unknown>;
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    const enabled = typeof req.enabled === "boolean" ? req.enabled : null;
    if (!sessionId || enabled === null) {
      return { success: false, error: "Missing sessionId or enabled" };
    }
    await kimiBridge.setPlanMode(sessionId, enabled);
    return { success: true, data: { enabled } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:sendPrompt", async (_, request: unknown) => {
  if (!request || typeof request !== "object") {
    return { success: false, error: "Invalid request" };
  }
  const req = request as Record<string, unknown>;
  const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
  const content = typeof req.content === "string" ? req.content : "";
  const images = Array.isArray(req.images)
    ? req.images.filter((item): item is { name: string; dataUrl: string } =>
        !!item &&
        typeof item === "object" &&
        typeof (item as { name?: unknown }).name === "string" &&
        typeof (item as { dataUrl?: unknown }).dataUrl === "string" &&
        (item as { dataUrl: string }).dataUrl.startsWith("data:image/")
      )
    : [];
  const thinking = typeof req.thinking === "boolean" ? req.thinking : undefined;
  const yoloMode = typeof req.yoloMode === "boolean" ? req.yoloMode : undefined;
  const planMode = typeof req.planMode === "boolean" ? req.planMode : undefined;
  const afkMode = typeof req.afkMode === "boolean" ? req.afkMode : undefined;
  if (!sessionId || (!content && images.length === 0)) {
    return { success: false, error: "Missing sessionId or content" };
  }
  const promptContent: string | ContentPart[] = images.length > 0
    ? [
        ...(content ? [{ type: "text" as const, text: content }] : []),
        ...images.map((image) => ({ type: "image_url" as const, image_url: { url: image.dataUrl } })),
      ]
    : content;
  try {
    await kimiBridge.sendPrompt(sessionId, promptContent, { thinking, yoloMode, planMode, afkMode });
    return { success: true, data: { sessionId } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:steerPrompt", async (_, request: unknown) => {
  if (!request || typeof request !== "object") {
    return { success: false, error: "Invalid request" };
  }
  const req = request as Record<string, unknown>;
  const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
  const content = typeof req.content === "string" ? req.content : "";
  const images = Array.isArray(req.images)
    ? req.images.filter((item): item is { name: string; dataUrl: string } =>
        !!item &&
        typeof item === "object" &&
        typeof (item as { name?: unknown }).name === "string" &&
        typeof (item as { dataUrl?: unknown }).dataUrl === "string" &&
        (item as { dataUrl: string }).dataUrl.startsWith("data:image/")
      )
    : [];
  if (!sessionId || (!content && images.length === 0)) {
    return { success: false, error: "Missing sessionId or content" };
  }
  const steerContent: string | ContentPart[] = images.length > 0
    ? [
        ...(content ? [{ type: "text" as const, text: content }] : []),
        ...images.map((image) => ({ type: "image_url" as const, image_url: { url: image.dataUrl } })),
      ]
    : content;
  try {
    await kimiBridge.steerPrompt(sessionId, steerContent);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:stopTurn", async (_, request: { sessionId: string }) => {
  try {
    await kimiBridge.stopTurn(request.sessionId);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:approveRequest", async (_, request: { sessionId: string; requestId: string; approved: boolean; scope?: "once" | "session" }) => {
  try {
    await kimiBridge.approveRequest(request.sessionId, request.requestId, request.approved, request.scope);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:respondQuestion", async (_, request: unknown) => {
  try {
    if (!request || typeof request !== "object") {
      return { success: false, error: "Invalid request" };
    }
    const req = request as Record<string, unknown>;
    const sessionId = typeof req.sessionId === "string" ? req.sessionId : "";
    const rpcRequestId = typeof req.rpcRequestId === "string" ? req.rpcRequestId : "";
    const questionRequestId = typeof req.questionRequestId === "string" ? req.questionRequestId : "";
    const answers = req.answers && typeof req.answers === "object" && !Array.isArray(req.answers)
      ? Object.fromEntries(Object.entries(req.answers as Record<string, unknown>).filter(([, value]) => typeof value === "string")) as Record<string, string>
      : {};
    if (!sessionId || !rpcRequestId || !questionRequestId) {
      return { success: false, error: "Missing question response fields" };
    }
    await kimiBridge.respondQuestion(sessionId, rpcRequestId, questionRequestId, answers);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:closeSession", async (_, request: { sessionId: string }) => {
  try {
    await kimiBridge.closeSession(request.sessionId);
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:listSessions", async (_, request: { workDir: string }) => {
  try {
    const sessions = await kimiBridge.getSessions(request.workDir);
    return { success: true, data: sessions };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:getUsage", async () => {
  try {
    const accessToken = await resolveKimiAccessToken();
    const res = await fetch(KIMI_CODE_USAGE_URL, {
      method: "GET",
      headers: {
        ...kimiCommonHeaders(),
        "Authorization": `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) {
      if (res.status === 401) {
        throw new Error("Kimi 授权失败，请重新登录 Kimi Code CLI");
      }
      throw new Error(`Kimi 用量接口返回 HTTP ${res.status}`);
    }
    const payload = getRecord(await res.json());
    if (!payload) throw new Error("Kimi 用量接口返回格式异常");
    return { success: true, data: parseKimiUsagePayload(payload) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:startVis", async () => {
  try {
    let kimiPath = await resolveCommand("kimi");
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
      return { success: false, error: "未找到 kimi CLI。请先安装并在终端运行 'kimi --version' 确认可用。" };
    }

    // 验证 kimi 可执行
    try {
      await runCommand(kimiPath, ["--version"]);
    } catch {
      return { success: false, error: `找到 kimi 路径 ${kimiPath}，但无法运行。请检查安装是否完整。` };
    }

    const child = spawn(kimiPath, ["vis", "--no-open"], {
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
        error: "kimi vis 进程启动后立刻退出。请确保 kimi CLI 已正确安装，并能在终端运行 'kimi vis --no-open'。",
      };
    }

    // 确认进程仍在运行
    try {
      if (child.pid) process.kill(child.pid, 0);
    } catch {
      return {
        success: false,
        error: "kimi vis 进程已退出。请确保 kimi CLI 已正确安装。",
      };
    }

    child.unref();
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:loadSession", async (_, request: { workDir: string; sessionId: string }) => {
  try {
    const events = await kimiBridge.getSessionHistory(request.workDir, request.sessionId);
    return { success: true, data: { sessionId: request.sessionId, events } };
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
    const latest = await fetchLatestRelease();
    if (!latest || !latest.tagName) {
      return {
        success: true,
        data: {
          currentVersion,
          latest: null,
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
      return { success: false, error: "未找到适合当前系统的升级包" };
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

const SettingsSchema = z.object({
  defaultModel: z.string().optional(),
  defaultThinking: z.boolean().optional(),
  defaultPlanMode: z.boolean().optional(),
  defaultAfkMode: z.boolean().optional(),
  maxTurns: z.number().int().min(1).max(1000).optional(),
  enableCompaction: z.boolean().optional(),
  defaultPermissionMode: z.enum(["manual", "approve_for_session", "yolo"]).optional(),
  theme: z.enum(["dark", "light", "system"]).optional(),
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
  expandToolCalls: z.boolean().optional(),
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
  const ids = kimiBridge.getActiveSessionIds();
  if (ids.length === 0) return;
  event.preventDefault();
  isQuitting = true;
  Promise.race([
    Promise.all(ids.map((id) => kimiBridge.closeSession(id).catch(() => {}))),
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

app.whenReady().then(createWindow);
