type ParentPort = {
  on: (event: "message", listener: (event: { data: WorkerRequest }) => void) => void;
  postMessage: (message: WorkerMessage) => void;
};

type WorkerRequest =
  | { type: "load"; id: string; cacheDir: string }
  | { type: "translate"; id: string; cacheDir: string; text: string };

type WorkerMessage =
  | { type: "progress"; loadedBytes: number; totalBytes?: number; file?: string }
  | { type: "ready"; id: string }
  | { type: "translated"; id: string; translatedText: string }
  | { type: "error"; id: string; message: string };

type TranslationPipeline = (text: string) => Promise<Array<{ translation_text?: string }> | { translation_text?: string }>;

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort;
if (!parentPort) throw new Error("本地翻译进程缺少 Electron parentPort。");

let pipelineInstance: TranslationPipeline | null = null;
let pipelineCacheDir = "";
let loading: Promise<TranslationPipeline> | null = null;

async function loadPipeline(cacheDir: string): Promise<TranslationPipeline> {
  if (pipelineInstance && pipelineCacheDir === cacheDir) return pipelineInstance;
  if (loading && pipelineCacheDir === cacheDir) return loading;
  pipelineCacheDir = cacheDir;
  loading = (async () => {
    const transformers = await import("@huggingface/transformers");
    transformers.env.cacheDir = cacheDir;
    transformers.env.allowLocalModels = true;
    transformers.env.allowRemoteModels = true;
    const progressFiles = new Map<string, { loaded: number; total?: number }>();
    let lastProgressSentAt = 0;
    let lastProgressPercent = -1;
    const created = await transformers.pipeline("translation", "Xenova/opus-mt-en-zh", {
      dtype: "q8",
      progress_callback: (progress: unknown) => {
        if (!progress || typeof progress !== "object") return;
        const value = progress as { file?: unknown; loaded?: unknown; total?: unknown };
        if (typeof value.file !== "string" || typeof value.loaded !== "number") return;
        progressFiles.set(value.file, {
          loaded: value.loaded,
          total: typeof value.total === "number" ? value.total : undefined,
        });
        let loadedBytes = 0;
        let totalBytes = 0;
        for (const item of progressFiles.values()) {
          if (item.total) {
            loadedBytes += Math.min(item.loaded, item.total);
            totalBytes += item.total;
          }
        }
        const now = Date.now();
        const progressPercent = totalBytes > 0 ? Math.floor((loadedBytes / totalBytes) * 100) : -1;
        if (now - lastProgressSentAt < 150 && progressPercent === lastProgressPercent) return;
        lastProgressSentAt = now;
        lastProgressPercent = progressPercent;
        parentPort.postMessage({
          type: "progress",
          loadedBytes,
          totalBytes: totalBytes > 0 ? totalBytes : undefined,
          file: value.file,
        });
      },
    });
    pipelineInstance = created as unknown as TranslationPipeline;
    return pipelineInstance;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

parentPort.on("message", (event) => {
  const request = event.data;
  void (async () => {
    try {
      const translator = await loadPipeline(request.cacheDir);
      if (request.type === "load") {
        parentPort.postMessage({ type: "ready", id: request.id });
        return;
      }
      const raw = await translator(request.text);
      const first = Array.isArray(raw) ? raw[0] : raw;
      const translatedText = first?.translation_text?.trim();
      if (!translatedText) throw new Error("本地翻译模型未返回译文。");
      parentPort.postMessage({ type: "translated", id: request.id, translatedText });
    } catch (error) {
      parentPort.postMessage({
        type: "error",
        id: request.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  })();
});
