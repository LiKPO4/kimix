// electron-builder afterPack 钩子：mac 同时产出 x64/arm64 两个 dmg，
// 静态 files 过滤无法区分同平台不同架构，在这里按目标架构删除另一套 onnxruntime 原生库。
// 仅做体积裁剪，任何失败都只告警不中断构建。
const fs = require("node:fs");
const path = require("node:path");

const ARCH_NAMES = { 0: "ia32", 1: "x64", 2: "armv7l", 3: "arm64", 4: "universal" };

exports.default = async function afterPack(context) {
  try {
    if (context.electronPlatformName !== "darwin") return;
    const archName = ARCH_NAMES[context.arch];
    if (archName !== "x64" && archName !== "arm64") return;
    const otherArch = archName === "x64" ? "arm64" : "x64";
    const productFilename = context.packager?.appInfo?.productFilename;
    if (!productFilename) return;
    const target = path.join(
      context.appOutDir,
      `${productFilename}.app`,
      "Contents",
      "Resources",
      "app.asar.unpacked",
      "node_modules",
      "onnxruntime-node",
      "bin",
      "napi-v3",
      "darwin",
      otherArch,
    );
    if (!fs.existsSync(target)) return;
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`[afterPack] 已删除 onnxruntime darwin/${otherArch}（目标架构 ${archName}）`);
  } catch (error) {
    console.warn("[afterPack] 架构裁剪失败（不影响构建）:", error);
  }
};
