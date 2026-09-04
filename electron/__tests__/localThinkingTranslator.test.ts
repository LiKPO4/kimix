import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("electron", () => ({
  utilityProcess: { fork: vi.fn() },
}));

import { isPathInside, LocalThinkingTranslator } from "../localThinkingTranslator";
import { LOCAL_THINKING_RUNTIME_PACKAGES } from "../localThinkingRuntimeManifest";
import { LocalThinkingRuntimeDownloader } from "../localThinkingRuntimeDownloader";
import { normalizeThinkingTranslationProvider } from "../settingsService";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kimix-translator-test-"));
}

function writeModelMarker(userDataDir: string): void {
  const modelDir = path.join(userDataDir, "thinking-translation-models", "opus-mt-en-zh");
  fs.mkdirSync(modelDir, { recursive: true });
  fs.writeFileSync(path.join(modelDir, ".kimix-ready.json"), "{}", "utf-8");
}

async function writeRuntimeMarker(userDataDir: string): Promise<void> {
  const runtimeDir = path.join(userDataDir, "thinking-translation-runtime");
  const packages: Record<string, string> = {};
  for (const pkg of LOCAL_THINKING_RUNTIME_PACKAGES) {
    const pkgDir = path.join(runtimeDir, "node_modules", ...pkg.name.split("/"));
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ name: pkg.name, version: pkg.version }), "utf-8");
    packages[pkg.name] = pkg.version;
  }
  fs.writeFileSync(path.join(runtimeDir, ".kimix-runtime-ready.json"), JSON.stringify({ packages }), "utf-8");
  // pending 为空时 ensureInstalled 只补写 sharp 桩，不触发下载
  await new LocalThinkingRuntimeDownloader(runtimeDir).ensureInstalled();
}

describe("本地思考翻译边界", () => {
  it("只允许删除模型根目录内部的明确子目录", () => {
    const root = path.resolve("kimix-test-data", "models");
    expect(isPathInside(root, path.join(root, "opus-mt-en-zh"))).toBe(true);
    expect(isPathInside(root, root)).toBe(false);
    expect(isPathInside(root, path.resolve(root, "..", "other"))).toBe(false);
  });

  it("把旧版已开启布尔值迁移为 Azure，并优先保留新版互斥提供方", () => {
    expect(normalizeThinkingTranslationProvider(undefined, true)).toBe("azure");
    expect(normalizeThinkingTranslationProvider(undefined, false)).toBe("off");
    expect(normalizeThinkingTranslationProvider("local", true)).toBe("local");
    expect(normalizeThinkingTranslationProvider("invalid", true)).toBe("azure");
  });
});

describe("本地思考翻译就绪门槛（运行时 + 模型双就绪）", () => {
  const noop = () => {};

  it("全新目录为 not_downloaded", () => {
    const translator = new LocalThinkingTranslator(makeTempDir(), "worker.cjs", noop);
    expect(translator.getStatus().state).toBe("not_downloaded");
  });

  it("老用户只有模型缓存、没有运行时时仍为 not_downloaded（升级后需补下运行时）", () => {
    const userDataDir = makeTempDir();
    writeModelMarker(userDataDir);
    const translator = new LocalThinkingTranslator(userDataDir, "worker.cjs", noop);
    expect(translator.getStatus().state).toBe("not_downloaded");
    // 体积口径变为运行时 + 模型
    expect(translator.getStatus().estimatedBytes).toBeGreaterThan(200_000_000);
  });

  it("运行时与模型都就绪后为 ready", async () => {
    const userDataDir = makeTempDir();
    writeModelMarker(userDataDir);
    await writeRuntimeMarker(userDataDir);
    const translator = new LocalThinkingTranslator(userDataDir, "worker.cjs", noop);
    expect(translator.getStatus().state).toBe("ready");
  });

  it("开发模式（runtimeRequired=false）只看模型标记", () => {
    const userDataDir = makeTempDir();
    writeModelMarker(userDataDir);
    const translator = new LocalThinkingTranslator(userDataDir, "worker.cjs", noop, { runtimeRequired: false });
    expect(translator.getStatus().state).toBe("ready");
    expect(translator.getStatus().estimatedBytes).toBe(121_000_000);
  });

  it("模型未就绪时 translate 直接返回 model_not_downloaded", async () => {
    const translator = new LocalThinkingTranslator(makeTempDir(), "worker.cjs", noop);
    const result = await translator.translate("hello");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("model_not_downloaded");
  });
});
