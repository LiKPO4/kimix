/**
 * 运行时平台判断工具。
 *
 * Electron 渲染进程通过 `window.api.platform` 获取主进程的平台信息；
 * Node 环境直接读取 `process.platform`；浏览器/测试环境回退到 `navigator.platform`。
 */

export type KimixPlatform = NodeJS.Platform | "browser-preview";

export function getPlatform(): KimixPlatform | undefined {
  const browserWindow = typeof window !== "undefined"
    ? window as Window & { api?: { platform?: KimixPlatform } }
    : undefined;
  if (browserWindow?.api?.platform) {
    return browserWindow.api.platform;
  }
  if (typeof process !== "undefined" && process.platform) {
    return process.platform;
  }
  if (typeof navigator !== "undefined" && navigator.platform) {
    const p = navigator.platform;
    if (p.startsWith("Win")) return "win32";
    if (p.startsWith("Mac")) return "darwin";
    if (p.startsWith("Linux")) return "linux";
  }
  return undefined;
}

export function isWindows(): boolean {
  return getPlatform() === "win32";
}
