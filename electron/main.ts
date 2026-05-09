import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { z } from "zod";
import * as kimiBridge from "./kimiBridge";
import * as projectService from "./projectService";
import * as settingsService from "./settingsService";
import type { ContentPart } from "@moonshot-ai/kimi-agent-sdk";

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
    const child = execFile(command, args, { windowsHide: true, timeout: 5000 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve((stdout || stderr).trim());
    });
    child.on("error", reject);
  });
}

function spawnDetached(command: string, args: string[], cwd?: string) {
  const child = spawn(command, args, {
    cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
}

async function openTerminalAt(dir: string) {
  if (process.platform === "win32") {
    const wtPath = await checkCommand("wt");
    if (wtPath) {
      spawnDetached(wtPath, ["-d", dir], dir);
      return;
    }
    spawnDetached("powershell.exe", ["-NoExit", "-NoLogo", "-Command", "Set-Location -LiteralPath $args[0]", dir], dir);
    return;
  }

  const terminal = await checkCommand("x-terminal-emulator") ?? await checkCommand("gnome-terminal") ?? await checkCommand("konsole");
  if (terminal) {
    spawnDetached(terminal, [], dir);
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
  spawnDetached(commandPath, [dir], dir);
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

export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const RENDERER_DIST = path.join(process.env.APP_ROOT, "..", "out", "renderer");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

function ensureDirectoryExists(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getDefaultProject() {
  const workDir = settingsService.getDefaultWorkDir();
  ensureDirectoryExists(workDir);
  return {
    id: "default-kimi-project",
    path: workDir,
    name: path.basename(workDir) || "kimi",
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

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(RENDERER_DIST, "index.html"));
  }

  mainWindow.webContents.once("did-finish-load", () => {
    void restoreLastContext();
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
          VITE_DEV_SERVER_URL
            ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:* ws://localhost:*; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws://localhost:* http://localhost:*;"
            : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self';"
        ],
      },
    });
  });

  // Renderer crash handler (production only)
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer process gone:", details.reason, details.exitCode);
    if (VITE_DEV_SERVER_URL) {
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
  const projects = projectService.getRecentProjects();
  return { success: true, data: projects };
});

const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(256),
  path: z.string().max(4096),
  lastOpenedAt: z.number(),
  gitBranch: z.string().optional(),
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

ipcMain.handle("project:getGitInfo", async (_, projectPath: string) => {
  const branch = await projectService.getGitBranch(projectPath);
  const status = await projectService.getGitStatus(projectPath);
  return { success: true, data: { branch: branch ?? "main", status } };
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

// Kimi IPC handlers
ipcMain.handle("kimi:checkCli", async (_, request?: { verify?: boolean }) => {
  try {
    const kimiPath = await checkCommand("kimi");
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

ipcMain.handle("kimi:startSession", async (_, request: { workDir: string; sessionId?: string; model?: string; thinking?: boolean; yoloMode?: boolean }) => {
  try {
    const result = await kimiBridge.startSession(request);
    return { success: true, data: result };
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
  }
  return { success: true };
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
