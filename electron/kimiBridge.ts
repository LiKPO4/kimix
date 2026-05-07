import {
  createSession,
  listSessions,
  parseSessionEvents,
  type Session,
  type Turn,
  type StreamEvent,
  type ApprovalResponse,
} from "@moonshot-ai/kimi-agent-sdk";
import type { BrowserWindow } from "electron";

const activeSessions = new Map<string, Session>();
const activeTurns = new Map<string, Turn>();

let mainWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow | null) {
  mainWindow = win;
}

function sendEvent(sessionId: string, event: unknown) {
  mainWindow?.webContents.send("kimi:event", { sessionId, event });
}

function sendStatus(sessionId: string, status: "idle" | "running" | "error" | "interrupted" | "completed") {
  mainWindow?.webContents.send("kimi:status", { sessionId, status });
}

export async function startSession(options: {
  workDir: string;
  sessionId?: string;
  model?: string;
  thinking?: boolean;
}): Promise<{ sessionId: string; workDir: string }> {
  const session = createSession({
    workDir: options.workDir,
    sessionId: options.sessionId,
    // Let CLI use its own default model from config.toml
    // model: options.model, 
    thinking: options.thinking ?? true,
    executable: "kimi",
  });

  activeSessions.set(session.sessionId, session);
  return { sessionId: session.sessionId, workDir: session.workDir };
}

export async function sendPrompt(sessionId: string, content: string) {
  const session = activeSessions.get(sessionId);
  if (!session) throw new Error("Session not found");

  const existingTurn = activeTurns.get(sessionId);
  if (existingTurn) {
    throw new Error("Turn already in progress");
  }

  const turn = session.prompt(content);
  activeTurns.set(sessionId, turn);
  sendStatus(sessionId, "running");

  try {
    for await (const event of turn) {
      sendEvent(sessionId, event);
    }

    const result = await turn.result;
    sendStatus(sessionId, "completed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendEvent(sessionId, { type: "Error", payload: { message } });
    sendStatus(sessionId, "error");
  } finally {
    activeTurns.delete(sessionId);
  }
}

export async function stopTurn(sessionId: string) {
  const turn = activeTurns.get(sessionId);
  if (!turn) return;
  await turn.interrupt();
  activeTurns.delete(sessionId);
  sendStatus(sessionId, "interrupted");
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

export async function closeSession(sessionId: string) {
  const session = activeSessions.get(sessionId);
  if (session) {
    await session.close();
    activeSessions.delete(sessionId);
  }
}

export async function getSessions(workDir: string) {
  return listSessions(workDir);
}

export async function getSessionHistory(workDir: string, sessionId: string) {
  return parseSessionEvents(workDir, sessionId);
}
