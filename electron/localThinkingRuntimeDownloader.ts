import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import * as tar from "tar";
import {
  LOCAL_THINKING_RUNTIME_PACKAGES,
  runtimePackageEntryIncluded,
  runtimePackageRegistries,
  runtimeTarballUrl,
  type LocalThinkingRuntimePackage,
} from "./localThinkingRuntimeManifest";

export type LocalThinkingRuntimeProgress = {
  downloadedBytes: number;
  totalBytes: number;
  currentFile?: string;
};

type InstalledMap = Record<string, string>;

const MARKER_FILE = ".kimix-runtime-ready.json";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;

export function verifyIntegrity(integrity: string, data: Buffer): boolean {
  const [algorithm, expected] = integrity.split("-", 2);
  if (!algorithm || !expected) return false;
  try {
    const actual = crypto.createHash(algorithm).update(data).digest("base64");
    return actual === expected;
  } catch {
    return false;
  }
}

function readMarker(markerPath: string): InstalledMap | null {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(markerPath, "utf-8"));
    if (!raw || typeof raw !== "object" || !("packages" in raw)) return null;
    const packages = (raw as { packages?: unknown }).packages;
    if (!packages || typeof packages !== "object") return null;
    return packages as InstalledMap;
  } catch {
    return null;
  }
}

function downloadToFile(
  url: string,
  destPath: string,
  onBytes?: (chunkBytes: number) => void,
  redirectsLeft = MAX_REDIRECTS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const request = client.get(url, (response) => {
      const status = response.statusCode ?? 0;
      if ([301, 302, 307, 308].includes(status) && typeof response.headers.location === "string") {
        response.resume();
        if (redirectsLeft <= 0) return reject(new Error(`下载重定向次数过多：${url}`));
        const next = new URL(response.headers.location, url).toString();
        resolve(downloadToFile(next, destPath, onBytes, redirectsLeft - 1));
        return;
      }
      if (status !== 200) {
        response.resume();
        return reject(new Error(`下载失败（HTTP ${status}）：${url}`));
      }
      const out = fs.createWriteStream(destPath);
      response.on("data", (chunk: Buffer) => onBytes?.(chunk.length));
      response.pipe(out);
      out.on("finish", () => out.close((err) => (err ? reject(err) : resolve())));
      out.on("error", reject);
      response.on("error", reject);
    });
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`下载超时：${url}`));
    });
    request.on("error", reject);
  });
}

export class LocalThinkingRuntimeDownloader {
  constructor(private readonly runtimeDir: string) {}

  private get markerPath(): string {
    return path.join(this.runtimeDir, MARKER_FILE);
  }

  private get modulesDir(): string {
    return path.join(this.runtimeDir, "node_modules");
  }

  private packageDir(pkg: LocalThinkingRuntimePackage): string {
    return path.join(this.modulesDir, ...pkg.name.split("/"));
  }

  isReady(): boolean {
    return fs.existsSync(path.join(this.sharpStubDir, "package.json")) && this.pendingPackages().length === 0;
  }

  private get sharpStubDir(): string {
    return path.join(this.modulesDir, "sharp");
  }

  // transformers.node.mjs 顶层静态 import "sharp"，但翻译路径从不调用它；sharp 原生库体积大且
  // 生产环境从未携带（打包版本地翻译因此一直是潜在坏掉的），这里用桩模块满足模块加载。
  // 若未来引入图像类 pipeline，必须改为随清单下载真实 sharp 与 @img/sharp-<平台>-<架构>。
  private writeSharpStub(): void {
    fs.rmSync(this.sharpStubDir, { recursive: true, force: true });
    fs.mkdirSync(this.sharpStubDir, { recursive: true });
    fs.writeFileSync(
      path.join(this.sharpStubDir, "package.json"),
      JSON.stringify({
        name: "sharp",
        version: "0.0.0-kimix-stub",
        type: "module",
        main: "index.mjs",
        exports: "./index.mjs",
      }),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(this.sharpStubDir, "index.mjs"),
      [
        'const unavailable = () => {',
        '  throw new Error("Kimix 本地翻译运行时未包含 sharp 图像库（翻译功能不需要它）。");',
        "};",
        "export default unavailable;",
        "",
      ].join("\n"),
      "utf-8",
    );
  }

  private pendingPackages(): LocalThinkingRuntimePackage[] {
    const installed = readMarker(this.markerPath) ?? {};
    return LOCAL_THINKING_RUNTIME_PACKAGES.filter(
      (pkg) =>
        installed[pkg.name] !== pkg.version ||
        !fs.existsSync(path.join(this.packageDir(pkg), "package.json")),
    );
  }

  async ensureInstalled(onProgress?: (progress: LocalThinkingRuntimeProgress) => void): Promise<void> {
    fs.mkdirSync(this.modulesDir, { recursive: true });
    this.writeSharpStub();
    const pending = this.pendingPackages();
    if (pending.length === 0) return;
    const totalBytes = LOCAL_THINKING_RUNTIME_PACKAGES.reduce((sum, pkg) => sum + pkg.tarballBytes, 0);
    const installed = readMarker(this.markerPath) ?? {};
    let downloadedBytes = LOCAL_THINKING_RUNTIME_PACKAGES.filter((pkg) => !pending.includes(pkg)).reduce(
      (sum, pkg) => sum + pkg.tarballBytes,
      0,
    );
    for (const pkg of pending) {
      const fileName = path.basename(runtimeTarballUrl(runtimePackageRegistries()[0], pkg));
      const tarballPath = path.join(
        this.runtimeDir,
        `.download-${pkg.name.replace(/[@/]/g, "_")}-${pkg.version}.tgz`,
      );
      try {
        await this.downloadVerified(pkg, tarballPath, (chunkBytes) => {
          downloadedBytes += chunkBytes;
          onProgress?.({ downloadedBytes, totalBytes, currentFile: fileName });
        });
        await this.extract(pkg, tarballPath);
        installed[pkg.name] = pkg.version;
        fs.writeFileSync(this.markerPath, JSON.stringify({ packages: installed }), "utf-8");
      } finally {
        fs.rmSync(tarballPath, { force: true });
      }
    }
  }

  private async downloadVerified(
    pkg: LocalThinkingRuntimePackage,
    destPath: string,
    onBytes: (chunkBytes: number) => void,
  ): Promise<void> {
    const errors: string[] = [];
    for (const registry of runtimePackageRegistries()) {
      const url = runtimeTarballUrl(registry, pkg);
      try {
        await downloadToFile(url, destPath, onBytes);
        const data = fs.readFileSync(destPath);
        if (!verifyIntegrity(pkg.integrity, data)) {
          errors.push(`${registry}: 完整性校验失败`);
          continue;
        }
        return;
      } catch (error) {
        errors.push(`${registry}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error(`本地翻译运行时组件 ${pkg.name}@${pkg.version} 下载失败（${errors.join("；")}）。`);
  }

  private async extract(pkg: LocalThinkingRuntimePackage, tarballPath: string): Promise<void> {
    const targetDir = this.packageDir(pkg);
    const stagingDir = `${targetDir}.staging-${process.pid}-${Date.now()}`;
    fs.rmSync(stagingDir, { recursive: true, force: true });
    fs.mkdirSync(stagingDir, { recursive: true });
    try {
      await tar.extract({
        file: tarballPath,
        cwd: stagingDir,
        strip: 1,
        filter: (entryPath) =>
          runtimePackageEntryIncluded(pkg.name, entryPath, process.platform, process.arch),
      });
      fs.rmSync(targetDir, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(targetDir), { recursive: true });
      fs.renameSync(stagingDir, targetDir);
    } finally {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
  }

  async remove(): Promise<void> {
    fs.rmSync(this.runtimeDir, { recursive: true, force: true });
  }
}
