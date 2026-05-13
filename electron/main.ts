import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell } from "electron";
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
import type { ContentPart } from "@moonshot-ai/kimi-agent-sdk";

const GITHUB_REPO = "LiKPO4/kimix";
const KIMI_CODE_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
const KIMI_CODE_USAGE_URL = "https://api.kimi.com/coding/v1/usages";
const KIMI_CODE_REFRESH_URL = "https://auth.kimi.com/api/oauth/token";
const KIMI_CLI_INSTALL_PS1_URL = "https://code.kimi.com/install.ps1";
const KIMI_CLI_INSTALL_SH_URL = "https://code.kimi.com/install.sh";

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

function resolveProjectFile(projectPath: string, filePath: string) {
  const resolvedProject = path.resolve(projectPath);
  const resolvedFile = path.resolve(resolvedProject, filePath);
  const relative = path.relative(resolvedProject, resolvedFile);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("File path escapes project");
  }
  return resolvedFile;
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

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let rendererReloadedAfterBlank = false;

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
      .filter((asset): asset is { name?: unknown; browser_download_url?: unknown } => typeof asset === "object" && asset !== null)
      .map((asset) => ({
        name: typeof asset.name === "string" ? asset.name : "下载文件",
        downloadUrl: typeof asset.browser_download_url === "string" ? asset.browser_download_url : "",
      }))
      .filter((asset) => asset.downloadUrl.length > 0),
  };
}

type ReleaseAssetInfo = {
  name: string;
  downloadUrl: string;
};

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
  const res = await fetch(asset.downloadUrl, {
    headers: {
      "User-Agent": "Kimix",
    },
  });
  if (!res.ok) throw new Error(`下载失败：GitHub 返回 ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const updateDir = path.join(app.getPath("downloads"), "Kimix Updates", sanitizeDownloadName(tagName || "latest"));
  ensureDir(updateDir);
  const targetPath = path.join(updateDir, sanitizeDownloadName(asset.name));
  fs.writeFileSync(targetPath, bytes);
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

function usagePeriodFromDetail(label: string, detail: Record<string, unknown> | null): KimiUsagePeriod {
  if (!detail) return { label, available: false, percent: 0, message: "暂无官方数据" };
  const limit = toNumber(detail.limit);
  const remaining = toNumber(detail.remaining);
  let used = toNumber(detail.used);
  if (used === undefined && limit !== undefined && remaining !== undefined) {
    used = Math.max(0, limit - remaining);
  }
  if (limit === undefined || used === undefined || limit <= 0) {
    return { label, available: false, percent: 0, message: "暂无官方数据" };
  }
  return {
    label,
    used,
    limit,
    percent: Math.max(0, Math.min(100, (used / limit) * 100)),
    available: true,
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
      return detail;
    }
  }
  return null;
}

function parseKimiUsagePayload(payload: Record<string, unknown>) {
  const fiveHour = usagePeriodFromDetail("5小时", findWindowLimit(payload, 300, "MINUTE"));
  const weekly = usagePeriodFromDetail("本周", getRecord(payload.usage));
  const monthly = usagePeriodFromDetail("本月", getRecord(payload.totalQuota));
  return {
    available: [fiveHour, weekly, monthly].some((period) => period.available),
    updatedAt: Date.now(),
    source: "Kimi Code 官方用量接口",
    periods: [fiveHour, weekly, monthly],
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
            ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:* ws://localhost:*; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws://localhost:* http://localhost:*;"
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

    const executor = await kimiBridge.startSession({
      workDir: project.path,
      model: "kimi-code/kimi-for-coding",
      thinking,
      yoloMode,
    });
    executorSessionId = executor.sessionId;

    const reviewer = await kimiBridge.startSession({
      workDir: project.path,
      model: "kimi-code/kimi-for-coding",
      thinking,
      yoloMode,
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
    const files = req.files.filter((file): file is string => typeof file === "string" && file.trim().length > 0);
    files.forEach((file) => resolveProjectFile(req.projectPath as string, file));
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

ipcMain.handle("kimi:installCli", async () => {
  try {
    const result = await installKimiCli();
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle("kimi:startSession", async (_, request: { workDir: string; sessionId?: string; model?: string; thinking?: boolean; yoloMode?: boolean; skillsDir?: string }) => {
  try {
    const settings = settingsService.loadSettings();
    const skillsDir = request.skillsDir || ((settings.enabledSkillNames ?? []).length > 0 ? settings.enabledSkillsDir || enabledSkillsDir() : undefined);
    const result = await kimiBridge.startSession({ ...request, skillsDir });
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
    await kimiBridge.sendPrompt(sessionId, promptContent, { thinking, yoloMode });
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
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

const SettingsSchema = z.object({
  defaultModel: z.string().optional(),
  defaultThinking: z.boolean().optional(),
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
  clarificationToolMode: z.enum(["off", "on", "auto"]).optional(),
  clarificationToolEnabled: z.boolean().optional(),
  expandToolCalls: z.boolean().optional(),
  defaultOpenDir: z.string().optional(),
  autoReadAgentsMd: z.boolean().optional(),
  autoShowGitStatus: z.boolean().optional(),
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
