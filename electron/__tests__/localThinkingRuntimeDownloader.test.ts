import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import * as tar from "tar";
import {
  LOCAL_THINKING_RUNTIME_PACKAGES,
  LOCAL_THINKING_RUNTIME_TOTAL_BYTES,
  runtimePackageEntryIncluded,
  runtimePackageRegistries,
  runtimeTarballUrl,
} from "../localThinkingRuntimeManifest";
import { LocalThinkingRuntimeDownloader, verifyIntegrity } from "../localThinkingRuntimeDownloader";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kimix-runtime-test-"));
}

describe("本地翻译运行时清单", () => {
  it("清单中每个包的 version 与 integrity 与 pnpm-lock.yaml 一致", () => {
    const lockText = fs.readFileSync(path.resolve(__dirname, "../../pnpm-lock.yaml"), "utf-8");
    for (const pkg of LOCAL_THINKING_RUNTIME_PACKAGES) {
      const key = `${pkg.name}@${pkg.version}`;
      // lockfile packages 区条目形如 [']<name>@<version>[带 peer 后缀][']:\n    resolution: {integrity: sha512-...}（无 scope 的包不加引号）
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = lockText.match(new RegExp(`'?${escaped}(\\([^'\\s]*\\))?'?:\\s*\\n\\s*resolution: \\{integrity: (sha\\d+-[^}]+)\\}`));
      expect(match, `${key} 不在 pnpm-lock.yaml 中——升级依赖后需同步 localThinkingRuntimeManifest.ts`).toBeTruthy();
      expect(
        match?.[2],
        `${key} 的 integrity 与 lockfile 不一致——升级依赖后需同步 localThinkingRuntimeManifest.ts`,
      ).toBe(pkg.integrity);
    }
  });

  it("包含推理链路的核心包，且总体积为各包之和", () => {
    const names = new Set(LOCAL_THINKING_RUNTIME_PACKAGES.map((pkg) => pkg.name));
    for (const required of ["@huggingface/transformers", "@huggingface/jinja", "onnxruntime-node", "onnxruntime-common"]) {
      expect(names.has(required)).toBe(true);
    }
    // sharp 由下载器写入本地桩模块替代（transformers 顶层静态 import 它，但翻译路径从不调用）；
    // sharp 链（含 @img/*）与 onnxruntime-web（Web 后端）必须排除在闭包外
    expect(names.has("sharp")).toBe(false);
    expect(names.has("onnxruntime-web")).toBe(false);
    for (const name of names) expect(name.startsWith("@img/")).toBe(false);
    const sum = LOCAL_THINKING_RUNTIME_PACKAGES.reduce((acc, pkg) => acc + pkg.tarballBytes, 0);
    expect(sum).toBe(LOCAL_THINKING_RUNTIME_TOTAL_BYTES);
  });

  it("tarball URL 遵循 npm 规范（scope 包取后段作为文件名）", () => {
    const registry = runtimePackageRegistries()[0];
    expect(runtimeTarballUrl(registry, { name: "@huggingface/transformers", version: "3.8.1", tarballBytes: 0, integrity: "" }))
      .toBe(`${registry}/@huggingface/transformers/-/transformers-3.8.1.tgz`);
    expect(runtimeTarballUrl(registry, { name: "tar", version: "7.5.22", tarballBytes: 0, integrity: "" }))
      .toBe(`${registry}/tar/-/tar-7.5.22.tgz`);
  });

  it("镜像列表优先 npmmirror、兜底 npmjs", () => {
    expect(runtimePackageRegistries()[0]).toContain("npmmirror");
    expect(runtimePackageRegistries()).toContain("https://registry.npmjs.org");
  });
});

describe("运行时提取过滤器", () => {
  it("transformers 只保留 dist 与 package.json，丢弃 src/types", () => {
    const keep = (p: string) => runtimePackageEntryIncluded("@huggingface/transformers", p, "win32", "x64");
    expect(keep("package/package.json")).toBe(true);
    expect(keep("package/dist/transformers.node.cjs")).toBe(true);
    expect(keep("package/src/transformers.js")).toBe(false);
    expect(keep("package/types/transformers.d.ts")).toBe(false);
  });

  it("onnxruntime-node 只保留当前平台+架构的原生库并剔除 DirectML", () => {
    const keep = (p: string) => runtimePackageEntryIncluded("onnxruntime-node", p, "win32", "x64");
    expect(keep("package/dist/index.js")).toBe(true);
    expect(keep("package/bin/napi-v3/win32/x64/onnxruntime.dll")).toBe(true);
    expect(keep("package/bin/napi-v3/win32/x64/onnxruntime_binding.node")).toBe(true);
    expect(keep("package/bin/napi-v3/win32/x64/DirectML.dll")).toBe(false);
    expect(keep("package/bin/napi-v3/win32/arm64/onnxruntime.dll")).toBe(false);
    expect(keep("package/bin/napi-v3/linux/x64/libonnxruntime.so.1.21.0")).toBe(false);
    expect(keep("package/bin/napi-v3/darwin/arm64/libonnxruntime.1.21.0.dylib")).toBe(false);
  });

  it("拒绝 package/ 前缀之外与包含 .. 的条目", () => {
    expect(runtimePackageEntryIncluded("tar", "evil/x", "win32", "x64")).toBe(false);
    expect(runtimePackageEntryIncluded("tar", "package/../../evil", "win32", "x64")).toBe(false);
    expect(runtimePackageEntryIncluded("tar", "package/index.js", "win32", "x64")).toBe(true);
  });
});

describe("完整性校验", () => {
  it("sha512 校验通过与拒绝", () => {
    const data = Buffer.from("kimix-runtime-fixture");
    const integrity = `sha512-${crypto.createHash("sha512").update(data).digest("base64")}`;
    expect(verifyIntegrity(integrity, data)).toBe(true);
    expect(verifyIntegrity(integrity, Buffer.from("tampered"))).toBe(false);
    expect(verifyIntegrity("not-a-valid-integrity", data)).toBe(false);
  });
});

describe("运行时安装状态", () => {
  // 写入全部清单包的 marker 与 package.json，再经 ensureInstalled 补上 sharp 桩（pending 为空，不触发下载）
  async function installFakeRuntime(dir: string): Promise<void> {
    const packages: Record<string, string> = {};
    for (const pkg of LOCAL_THINKING_RUNTIME_PACKAGES) {
      const pkgDir = path.join(dir, "node_modules", ...pkg.name.split("/"));
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ name: pkg.name, version: pkg.version }), "utf-8");
      packages[pkg.name] = pkg.version;
    }
    fs.writeFileSync(path.join(dir, ".kimix-runtime-ready.json"), JSON.stringify({ packages }), "utf-8");
    await new LocalThinkingRuntimeDownloader(dir).ensureInstalled();
  }

  it("空目录未就绪，完整安装后就绪，marker 版本漂移后需要重装", async () => {
    const dir = makeTempDir();
    const downloader = new LocalThinkingRuntimeDownloader(dir);
    expect(downloader.isReady()).toBe(false);

    await installFakeRuntime(dir);
    expect(new LocalThinkingRuntimeDownloader(dir).isReady()).toBe(true);
    // sharp 桩已写入且调用时抛出明确错误
    const stub = await import(path.join(dir, "node_modules", "sharp", "index.mjs"));
    expect(() => stub.default()).toThrowError(/未包含 sharp/);

    // 模拟清单升级前的旧安装：marker 里 tar 版本落后于清单（不改写磁盘文件，避免触发自愈下载）
    const markerPath = path.join(dir, ".kimix-runtime-ready.json");
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf-8")) as { packages: Record<string, string> };
    marker.packages["tar"] = "0.0.0-outdated";
    fs.writeFileSync(markerPath, JSON.stringify(marker), "utf-8");
    expect(new LocalThinkingRuntimeDownloader(dir).isReady()).toBe(false);
  });

  it("marker 存在但包目录缺失时视为未就绪", async () => {
    const dir = makeTempDir();
    await installFakeRuntime(dir);
    fs.rmSync(path.join(dir, "node_modules", "tar"), { recursive: true, force: true });
    expect(new LocalThinkingRuntimeDownloader(dir).isReady()).toBe(false);
  });

  it("sharp 桩被删除后视为未就绪，且 ensureInstalled 能无损补齐", async () => {
    const dir = makeTempDir();
    await installFakeRuntime(dir);
    fs.rmSync(path.join(dir, "node_modules", "sharp"), { recursive: true, force: true });
    const downloader = new LocalThinkingRuntimeDownloader(dir);
    expect(downloader.isReady()).toBe(false);
    await downloader.ensureInstalled();
    expect(downloader.isReady()).toBe(true);
  });
});

describe("运行时解包", () => {
  it("从 tgz 按过滤器提取并剥掉 package/ 前缀", async () => {
    const dir = makeTempDir();
    const sourceDir = path.join(dir, "src-pkg");
    fs.mkdirSync(path.join(sourceDir, "package", "dist"), { recursive: true });
    fs.mkdirSync(path.join(sourceDir, "package", "src"), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "package", "package.json"), JSON.stringify({ name: "@huggingface/transformers", version: "3.8.1" }));
    fs.writeFileSync(path.join(sourceDir, "package", "dist", "transformers.node.cjs"), "module.exports = {};");
    fs.writeFileSync(path.join(sourceDir, "package", "src", "transformers.js"), "export {};");
    const tgzPath = path.join(dir, "fixture.tgz");
    await tar.create({ file: tgzPath, cwd: sourceDir }, ["package"]);

    const downloader = new LocalThinkingRuntimeDownloader(path.join(dir, "runtime"));
    const extract = (downloader as unknown as {
      extract(pkg: { name: string; version: string; tarballBytes: number; integrity: string }, tarballPath: string): Promise<void>;
    }).extract.bind(downloader);
    await extract({ name: "@huggingface/transformers", version: "3.8.1", tarballBytes: 0, integrity: "" }, tgzPath);

    const target = path.join(dir, "runtime", "node_modules", "@huggingface", "transformers");
    expect(fs.existsSync(path.join(target, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(target, "dist", "transformers.node.cjs"))).toBe(true);
    expect(fs.existsSync(path.join(target, "src", "transformers.js"))).toBe(false);
  });
});
