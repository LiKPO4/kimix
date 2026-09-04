import { utilityProcess, type UtilityProcess } from "electron";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  LocalThinkingTranslationModelStatus,
  ThinkingTranslationResponse,
} from "./types/ipc";
import { LocalThinkingRuntimeDownloader } from "./localThinkingRuntimeDownloader";
import { LOCAL_THINKING_RUNTIME_TOTAL_BYTES } from "./localThinkingRuntimeManifest";

export const LOCAL_THINKING_TRANSLATION_MODEL_ID = "Xenova/opus-mt-en-zh";
export const LOCAL_THINKING_TRANSLATION_MODEL_ESTIMATED_BYTES = 121_000_000;
export const LOCAL_THINKING_TRANSLATION_TOTAL_ESTIMATED_BYTES =
  LOCAL_THINKING_RUNTIME_TOTAL_BYTES + LOCAL_THINKING_TRANSLATION_MODEL_ESTIMATED_BYTES;

type WorkerRequest =
  | { type: "load"; id: string; cacheDir: string; runtimeDir?: string }
  | { type: "translate"; id: string; cacheDir: string; runtimeDir?: string; text: string };

type WorkerMessage =
  | { type: "progress"; loadedBytes: number; totalBytes?: number; file?: string }
  | { type: "ready"; id: string }
  | { type: "translated"; id: string; translatedText: string }
  | { type: "error"; id: string; message: string };

type PendingRequest = {
  resolve: (message: WorkerMessage) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
};

export function isPathInside(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export class LocalThinkingTranslator {
  private child: UtilityProcess | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly downloader: LocalThinkingRuntimeDownloader;
  private readonly runtimeRequired: boolean;
  private runtimeBytesInCurrentDownload = 0;
  private status: LocalThinkingTranslationModelStatus;

  constructor(
    private readonly userDataDir: string,
    private readonly workerPath: string,
    private readonly onStatus: (status: LocalThinkingTranslationModelStatus) => void,
    options?: { runtimeRequired?: boolean },
  ) {
    this.runtimeRequired = options?.runtimeRequired ?? true;
    this.downloader = new LocalThinkingRuntimeDownloader(this.runtimeDir);
    this.status = this.readInitialStatus();
  }

  get modelDir(): string {
    return path.join(this.userDataDir, "thinking-translation-models", "opus-mt-en-zh");
  }

  get runtimeDir(): string {
    return path.join(this.userDataDir, "thinking-translation-runtime");
  }

  private get readyMarkerPath(): string {
    return path.join(this.modelDir, ".kimix-ready.json");
  }

  private get estimatedBytes(): number {
    return this.runtimeRequired
      ? LOCAL_THINKING_TRANSLATION_TOTAL_ESTIMATED_BYTES
      : LOCAL_THINKING_TRANSLATION_MODEL_ESTIMATED_BYTES;
  }

  private isModelReady(): boolean {
    return fs.existsSync(this.readyMarkerPath);
  }

  private isRuntimeReady(): boolean {
    return !this.runtimeRequired || this.downloader.isReady();
  }

  getStatus(): LocalThinkingTranslationModelStatus {
    return { ...this.status };
  }

  private readInitialStatus(): LocalThinkingTranslationModelStatus {
    const ready = this.isModelReady() && this.isRuntimeReady();
    return {
      state: ready ? "ready" : "not_downloaded",
      modelId: LOCAL_THINKING_TRANSLATION_MODEL_ID,
      estimatedBytes: this.estimatedBytes,
    };
  }

  private publish(next: LocalThinkingTranslationModelStatus): void {
    this.status = next;
    this.onStatus({ ...next });
  }

  private ensureChild(): UtilityProcess {
    if (this.child) return this.child;
    const child = utilityProcess.fork(this.workerPath, [], {
      serviceName: "Kimix 本地思考翻译",
      stdio: "pipe",
    });
    child.on("message", (message: unknown) => this.handleWorkerMessage(message));
    child.on("exit", (code) => {
      if (this.child !== child) return;
      this.child = null;
      const error = new Error(`本地翻译进程已退出（${code ?? "unknown"}）。`);
      for (const request of this.pending.values()) {
        if (request.timer) clearTimeout(request.timer);
        request.reject(error);
      }
      this.pending.clear();
      if (this.status.state === "downloading") {
        this.publish({
          ...this.status,
          state: "error",
          message: error.message,
        });
      }
    });
    child.stderr?.on("data", (chunk) => {
      console.warn("[local-thinking-translation]", String(chunk).trim());
    });
    child.stdout?.on("data", () => {
      // Drain optional library output so a chatty dependency cannot block the worker pipe.
    });
    this.child = child;
    return child;
  }

  private handleWorkerMessage(message: unknown): void {
    if (!message || typeof message !== "object" || !("type" in message)) return;
    const typed = message as WorkerMessage;
    if (typed.type === "progress") {
      const loadedBytes = this.runtimeBytesInCurrentDownload + Math.max(0, typed.loadedBytes);
      const totalBytes = Math.max(this.estimatedBytes, typed.totalBytes ?? 0);
      this.publish({
        state: "downloading",
        modelId: LOCAL_THINKING_TRANSLATION_MODEL_ID,
        estimatedBytes: this.estimatedBytes,
        downloadedBytes: loadedBytes,
        totalBytes,
        progress: Math.max(0, Math.min(1, loadedBytes / totalBytes)),
        currentFile: typed.file,
      });
      return;
    }
    const pending = "id" in typed ? this.pending.get(typed.id) : undefined;
    if (!pending) return;
    this.pending.delete(typed.id);
    if (pending.timer) clearTimeout(pending.timer);
    if (typed.type === "error") pending.reject(new Error(typed.message));
    else pending.resolve(typed);
  }

  private request(request: WorkerRequest, timeoutMs?: number): Promise<WorkerMessage> {
    const child = this.ensureChild();
    return new Promise((resolve, reject) => {
      const pending: PendingRequest = { resolve, reject };
      if (timeoutMs) {
        pending.timer = setTimeout(() => {
          this.pending.delete(request.id);
          reject(new Error("本地翻译超时，请稍后重试。"));
        }, timeoutMs);
      }
      this.pending.set(request.id, pending);
      child.postMessage(request);
    });
  }

  async download(): Promise<LocalThinkingTranslationModelStatus> {
    if (this.status.state === "downloading") return this.getStatus();
    if (this.isModelReady() && this.isRuntimeReady()) {
      this.publish(this.readInitialStatus());
      return this.getStatus();
    }
    fs.mkdirSync(this.modelDir, { recursive: true });
    this.runtimeBytesInCurrentDownload = 0;
    this.publish({
      state: "downloading",
      modelId: LOCAL_THINKING_TRANSLATION_MODEL_ID,
      estimatedBytes: this.estimatedBytes,
      downloadedBytes: 0,
      totalBytes: this.estimatedBytes,
      progress: 0,
    });
    try {
      if (!this.isRuntimeReady()) {
        await this.downloader.ensureInstalled((progress) => {
          const totalBytes = Math.max(this.estimatedBytes, progress.totalBytes);
          this.publish({
            state: "downloading",
            modelId: LOCAL_THINKING_TRANSLATION_MODEL_ID,
            estimatedBytes: this.estimatedBytes,
            downloadedBytes: progress.downloadedBytes,
            totalBytes,
            progress: Math.max(0, Math.min(1, progress.downloadedBytes / totalBytes)),
            currentFile: progress.currentFile,
          });
        });
        this.runtimeBytesInCurrentDownload = LOCAL_THINKING_RUNTIME_TOTAL_BYTES;
      }
      const id = randomUUID();
      await this.request({
        type: "load",
        id,
        cacheDir: this.modelDir,
        runtimeDir: this.runtimeRequired ? this.runtimeDir : undefined,
      });
      const marker = JSON.stringify({
        modelId: LOCAL_THINKING_TRANSLATION_MODEL_ID,
        readyAt: new Date().toISOString(),
      });
      fs.writeFileSync(this.readyMarkerPath, marker, "utf-8");
      this.publish(this.readInitialStatus());
      return this.getStatus();
    } catch (error) {
      this.publish({
        ...this.status,
        state: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.runtimeBytesInCurrentDownload = 0;
    }
  }

  async translate(text: string, requestId?: string): Promise<ThinkingTranslationResponse> {
    if (!this.isModelReady() || !this.isRuntimeReady()) {
      return {
        success: false,
        error: { code: "model_not_downloaded", message: "本地翻译模型尚未下载。" },
      };
    }
    try {
      const id = randomUUID();
      const message = await this.request(
        {
          type: "translate",
          id,
          cacheDir: this.modelDir,
          runtimeDir: this.runtimeRequired ? this.runtimeDir : undefined,
          text,
        },
        90_000,
      );
      if (message.type !== "translated") throw new Error("本地翻译进程返回了无效结果。");
      return {
        success: true,
        data: {
          translatedText: message.translatedText,
          targetLanguage: "zh-Hans",
          requestId,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: /超时/u.test(error instanceof Error ? error.message : "") ? "timeout" : "model_unavailable",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  async remove(): Promise<LocalThinkingTranslationModelStatus> {
    this.stop();
    const modelsRoot = path.join(this.userDataDir, "thinking-translation-models");
    if (!isPathInside(modelsRoot, this.modelDir)) {
      throw new Error("拒绝删除超出本地翻译模型目录的路径。");
    }
    fs.rmSync(this.modelDir, { recursive: true, force: true });
    if (isPathInside(this.userDataDir, this.runtimeDir)) {
      await this.downloader.remove();
    }
    this.publish(this.readInitialStatus());
    return this.getStatus();
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    child?.kill();
    const error = new Error("本地翻译进程已停止。");
    for (const request of this.pending.values()) {
      if (request.timer) clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }
}
