import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import * as kimiBridge from "./kimiBridge";
import * as projectService from "./projectService";
import * as settingsService from "./settingsService";

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
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#F6F4EF',
      symbolColor: '#1a1a1a',
      height: 48
    },
  });

  kimiBridge.setMainWindow(mainWindow);

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(RENDERER_DIST, "index.html"));
  }

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

// Kimi IPC handlers
ipcMain.handle("kimi:startSession", async (_, request: { workDir: string; sessionId?: string; model?: string; thinking?: boolean }) => {
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
  if (!sessionId || !content) {
    return { success: false, error: "Missing sessionId or content" };
  }
  // Fire-and-forget: don't await the full turn
  kimiBridge.sendPrompt(sessionId, content).catch((err) => {
    console.error("Send prompt error:", err);
  });
  return { success: true, data: { sessionId } };
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
