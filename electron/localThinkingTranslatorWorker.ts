type ParentPort = {
  on: (event: "message", listener: (event: { data: WorkerRequest }) => void) => void;
  postMessage: (message: WorkerMessage) => void;
};

type WorkerRequest =
  | { type: "load"; id: string; cacheDir: string; runtimeDir?: string }
  | { type: "translate"; id: string; cacheDir: string; runtimeDir?: string; text: string };

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

type TransformersModule = {
  env: { cacheDir: string; allowLocalModels: boolean; allowRemoteModels: boolean };
  pipeline: (task: string, model: string, options: Record<string, unknown>) => Promise<unknown>;
};

// 打包环境从按需下载的运行时目录加载；开发环境回退到项目 node_modules。
// 必须走 ESM 入口（transformers.node.mjs）：CJS 入口在模块作用域静态 require("sharp")，
// 而 sharp 原生库按生产环境惯例不携带，只有 ESM 入口对它是惰性加载。
async function loadTransformers(runtimeDir?: string): Promise<TransformersModule> {
  if (runtimeDir) {
    const [{ pathToFileURL }, path] = await Promise.all([import("node:url"), import("node:path")]);
    const entry = path.join(
      runtimeDir,
      "node_modules",
      "@huggingface",
      "transformers",
      "dist",
      "transformers.node.mjs",
    );
    return (await import(pathToFileURL(entry).href)) as unknown as TransformersModule;
  }
  return (await import("@huggingface/transformers")) as unknown as TransformersModule;
}

async function loadPipeline(cacheDir: string, runtimeDir?: string): Promise<TranslationPipeline> {
  if (pipelineInstance && pipelineCacheDir === cacheDir) return pipelineInstance;
  if (loading && pipelineCacheDir === cacheDir) return loading;
  pipelineCacheDir = cacheDir;
  loading = (async () => {
    const transformers = await loadTransformers(runtimeDir);
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
      const translator = await loadPipeline(request.cacheDir, request.runtimeDir);
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
