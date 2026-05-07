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
const sendingLocks = new Set<string>();

let mainWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow | null) {
  mainWindow = win;
}

function sendEvent(sessionId: string, event: unknown) {
  try {
    mainWindow?.webContents.send("kimi:event", { sessionId, event });
  } catch {
    // Window may be destroyed
  }
}

function sendStatus(sessionId: string, status: "idle" | "running" | "error" | "interrupted" | "completed") {
  try {
    mainWindow?.webContents.send("kimi:status", { sessionId, status });
  } catch {
    // Window may be destroyed
  }
}

export async function startSession(options: {
  workDir: string;
  sessionId?: string;
  model?: string;
  thinking?: boolean;
}): Promise<{ sessionId: string; workDir: string }> {
  const existing = options.sessionId ? activeSessions.get(options.sessionId) : undefined;
  if (existing) {
    await existing.close();
    activeSessions.delete(options.sessionId!);
  }

  const session = createSession({
    workDir: options.workDir,
    sessionId: options.sessionId,
    thinking: options.thinking ?? true,
    executable: "kimi",
  });

  activeSessions.set(session.sessionId, session);
  return { sessionId: session.sessionId, workDir: session.workDir };
}

export async function sendPrompt(sessionId: string, content: string) {
  if (sendingLocks.has(sessionId)) throw new Error("Turn already in progress");
  sendingLocks.add(sessionId);

  const session = activeSessions.get(sessionId);
  if (!session) {
    sendingLocks.delete(sessionId);
    throw new Error("Session not found");
  }

  const turn = session.prompt(content);
  activeTurns.set(sessionId, turn);
  sendStatus(sessionId, "running");

  try {
    for await (const event of turn) {
      sendEvent(sessionId, event);
    }

    const result = await turn.result;
    sendEvent(sessionId, { type: "TurnResult", payload: { result } });
    sendStatus(sessionId, "completed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try { sendEvent(sessionId, { type: "Error", payload: { message } }); } catch {}
    try { sendStatus(sessionId, "error"); } catch {}
  } finally {
    activeTurns.delete(sessionId);
    sendingLocks.delete(sessionId);
  }
}

export async function stopTurn(sessionId: string) {
  const turn = activeTurns.get(sessionId);
  if (!turn) return;
  try {
    await turn.interrupt();
  } finally {
    activeTurns.delete(sessionId);
    sendingLocks.delete(sessionId);
    sendStatus(sessionId, "interrupted");
  }
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
  const turn = activeTurns.get(sessionId);
  if (turn) {
    try { await turn.interrupt(); } catch {}
    activeTurns.delete(sessionId);
    sendingLocks.delete(sessionId);
  }
}

export async function getSessions(workDir: string) {
  return listSessions(workDir);
}

export async function getSessionHistory(workDir: string, sessionId: string) {
  return parseSessionEvents(workDir, sessionId);
}
