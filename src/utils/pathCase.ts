/**
 * 跨平台路径大小写处理工具。
 *
 * Windows/macOS 默认文件系统大小写不敏感，Linux 大小写敏感。
 * 进行路径比较、去重时应统一使用本模块，避免在 Linux 上把 /Foo 和 /foo
 * 当成同一个目录。
 */

type KimixPlatform = NodeJS.Platform | "browser-preview";

function getRendererPlatform(): KimixPlatform | undefined {
  if (typeof window !== "undefined" && window.api && (window.api as { platform?: KimixPlatform }).platform) {
    return (window.api as { platform?: KimixPlatform }).platform;
  }
  return undefined;
}

function inferPlatform(): KimixPlatform | undefined {
  const rendererPlatform = getRendererPlatform();
  if (rendererPlatform) return rendererPlatform;
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

export function isWindowsCaseInsensitive(platform?: KimixPlatform): boolean {
  return platform === "win32";
}

export function normalizePathForComparison(
  input: string | undefined | null,
  platform: KimixPlatform | undefined = inferPlatform(),
): string {
  const normalized = (input ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  return isWindowsCaseInsensitive(platform) ? normalized.toLowerCase() : normalized;
}

export function isSamePath(
  a: string | undefined | null,
  b: string | undefined | null,
  platform?: KimixPlatform,
): boolean {
  const left = normalizePathForComparison(a, platform);
  const right = normalizePathForComparison(b, platform);
  return Boolean(left && right && left === right);
}
