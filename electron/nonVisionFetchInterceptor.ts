import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow } from "electron";
import { rewriteOpenAIContentForNonVision } from "./nonVisionContent";

const nonVisionModels = new Set<string>();

let logFilePath: string | undefined;
function getLogFilePath(): string {
  if (!logFilePath) {
    try {
      const logsDir = app.getPath("logs");
      logFilePath = path.join(logsDir, "non-vision-interceptor.log");
    } catch {
      logFilePath = path.join(os.tmpdir(), "kimix-non-vision-interceptor.log");
    }
  }
  return logFilePath;
}

function forwardToRenderer(level: string, message: string) {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents && !win.webContents.isDestroyed()) {
        win.webContents.send("kimix:main-log", { level, message });
      }
    }
  } catch {
    // Ignore windows-not-ready errors.
  }
}

export function interceptorLog(level: "info" | "warn" | "error", message: string, extra?: unknown) {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}${extra !== undefined ? ` ${JSON.stringify(extra)}` : ""}`;
  try {
    fs.appendFileSync(getLogFilePath(), `${line}\n`);
  } catch {
    // Continue even if log file is not writable.
  }
  const consoleFn = console[level] ?? console.log;
  consoleFn(`[non-vision-interceptor] ${message}`, extra ?? "");
  forwardToRenderer(level, line);
}

export function markModelAsNonVision(model: string | null | undefined): void {
  if (model) {
    nonVisionModels.add(model);
    interceptorLog("info", "marked model as non-vision", model);
  }
}

function isKnownNonVisionModelName(model: string): boolean {
  const normalized = normalizeModelName(model);
  return normalized.includes("deepseek");
}

export function modelSupportsImages(model: string | null | undefined): boolean {
  if (!model) return true;
  if (isKnownNonVisionModelName(model)) return false;
  return !nonVisionModels.has(model);
}

function normalizeModelName(value: string): string {
  return value.trim().toLowerCase();
}

function requestModelIsNonVision(requestModel: unknown): boolean {
  if (typeof requestModel !== "string") return false;
  const normalized = normalizeModelName(requestModel);
  if (isKnownNonVisionModelName(normalized)) return true;
  for (const known of nonVisionModels) {
    const knownNormalized = normalizeModelName(known);
    if (knownNormalized === normalized) return true;
    if (knownNormalized.endsWith(`/${normalized}`)) return true;
    if (normalized.endsWith(`/${knownNormalized}`)) return true;
  }
  return false;
}

function rewriteOpenAIBodyForNonVision(body: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(body.messages)) return body;
  const messages = body.messages.map((msg: unknown) => {
    if (!msg || typeof msg !== "object") return msg;
    const m = msg as Record<string, unknown>;
    if (m.role !== "user" || !Array.isArray(m.content)) return msg;
    return { ...m, content: rewriteOpenAIContentForNonVision(m.content) };
  });
  return { ...body, messages };
}

function isImageUnsupportedResponseText(text: string): boolean {
  return /unknown variant [`'"]image_url[`'"]|expected [`'"]text[`'"]|image_url.*not supported|does not support images/i.test(text);
}

function buildRewrittenRequestBody(originalBody: string): { body: string; parsed: Record<string, unknown> } | null {
  try {
    const parsed = JSON.parse(originalBody) as Record<string, unknown>;
    const rewritten = rewriteOpenAIBodyForNonVision(parsed);
    const rewrittenBody = JSON.stringify(rewritten);
    return { body: rewrittenBody, parsed };
  } catch {
    return null;
  }
}

const NON_VISION_WRAPPED = Symbol.for("kimix.nonVisionFetchWrapped");

export function installNonVisionFetchInterceptor() {
  const originalFetch = globalThis.fetch;
  if ((originalFetch as unknown as Record<symbol, boolean>)[NON_VISION_WRAPPED]) {
    interceptorLog("info", "fetch interceptor already installed, skipping");
    return;
  }

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      const urlString =
        typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      if (!/\/chat\/completions/i.test(urlString)) {
        return originalFetch(input, init);
      }
      const body = init?.body;
      if (typeof body !== "string") {
        interceptorLog("warn", "fetch interceptor: chat/completions body is not a string", {
          url: urlString,
          bodyType: typeof body,
        });
        return originalFetch(input, init);
      }

      const parsed = JSON.parse(body) as Record<string, unknown>;
      const model = parsed.model;

      if (requestModelIsNonVision(model)) {
        interceptorLog("info", "fetch interceptor: known non-vision model, rewriting proactively", {
          url: urlString,
          model,
          nonVisionModelsCount: nonVisionModels.size,
        });
        const rewritten = rewriteOpenAIBodyForNonVision(parsed);
        return originalFetch(input, { ...init, body: JSON.stringify(rewritten) });
      }

      // For unknown models, try the original request first.
      interceptorLog("info", "fetch interceptor: chat/completions request", {
        url: urlString,
        model,
        nonVisionModelsCount: nonVisionModels.size,
      });
      const response = await originalFetch(input, init);
      if (!response.ok) {
        const cloned = response.clone();
        const text = await cloned.text().catch(() => "");
        if (isImageUnsupportedResponseText(text)) {
          markModelAsNonVision(model);
          const rewritten = buildRewrittenRequestBody(body);
          if (rewritten) {
            interceptorLog("info", "fetch interceptor: provider rejected images, retrying with text fallback", {
              url: urlString,
              model,
            });
            return originalFetch(input, { ...init, body: rewritten.body });
          }
        }
      }
      return response;
    } catch (err) {
      interceptorLog("error", "fetch interceptor: failed to process request", {
        error: err instanceof Error ? err.message : String(err),
      });
      return originalFetch(input, init);
    }
  };

  (globalThis.fetch as unknown as Record<symbol, boolean>)[NON_VISION_WRAPPED] = true;
  interceptorLog("info", "fetch interceptor installed");
}
