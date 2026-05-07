import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as kimiBridge from "./kimiBridge";
import * as projectService from "./projectService";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, "..");

export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"] || "http://localhost:5173";
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "..", "out", "renderer");

process.env.VITE_PUBLIC = process.env["VITE_DEV_SERVER_URL"]
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

let mainWindow: BrowserWindow | null = null;

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
      sandbox: false,
    },
  });

  kimiBridge.setMainWindow(mainWindow);

  if (process.env["VITE_DEV_SERVER_URL"]) {
    mainWindow.loadURL(process.env["VITE_DEV_SERVER_URL"]);
  } else {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("dom-ready", () => {
    setTimeout(() => {
      mainWindow?.webContents.executeJavaScript(`document.getElementById("root")?.innerHTML?.substring(0, 500)`)
        .then((html: unknown) => {
          console.log("[KIMIX DOM] root content:", html || "(empty)");
        })
        .catch((err: unknown) => {
          console.log("[KIMIX DOM] error:", err);
        });
    }, 3000);
  });
}

// Project IPC handlers
ipcMain.handle("project:open", async (_, request?: { defaultPath?: string }) => {
  if (!mainWindow) return { success: false, error: "Window not available" };
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    defaultPath: request?.defaultPath,
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { success: true, data: null };
  }
  const p = result.filePaths[0];
  const project = {
    id: crypto.randomUUID(),
    path: p,
    name: path.basename(p),
    lastOpenedAt: Date.now(),
    gitBranch: projectService.getGitBranch(p),
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

ipcMain.handle("project:addRecent", async (_, project: unknown) => {
  projectService.addRecentProject(project as ReturnType<typeof projectService.getRecentProjects>[number]);
  return { success: true, data: undefined };
});

ipcMain.handle("project:removeRecent", async (_, id: string) => {
  projectService.removeRecentProject(id);
  return { success: true, data: undefined };
});

ipcMain.handle("project:getGitInfo", async (_, projectPath: string) => {
  const branch = projectService.getGitBranch(projectPath);
  const status = projectService.getGitStatus(projectPath);
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

ipcMain.handle("kimi:sendPrompt", async (_, request: { sessionId: string; content: string }) => {
  try {
    // Start prompt in background (don't await the full turn)
    kimiBridge.sendPrompt(request.sessionId, request.content).catch((err) => {
      console.error("Send prompt error:", err);
    });
    return { success: true, data: { turnId: request.sessionId } };
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
  return {
    success: true,
    data: {
      defaultModel: "kimi-latest",
      defaultThinking: true,
      maxTurns: 50,
      enableCompaction: true,
      defaultPermissionMode: "manual",
      theme: "light",
      fontSize: 14,
      showThinking: true,
      expandToolCalls: false,
      autoReadAgentsMd: true,
      autoShowGitStatus: true,
    },
  };
});

ipcMain.handle("app:saveSettings", async (_, settings: unknown) => {
  return { success: true, data: undefined };
});

ipcMain.handle("app:openExternal", async (_, url: string) => {
  await shell.openExternal(url);
  return { success: true, data: undefined };
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
