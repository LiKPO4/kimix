/**
 * 跨平台路径大小写处理工具。
 *
 * Windows/macOS 默认文件系统大小写不敏感，Linux 大小写敏感。
 * 进行路径比较、去重时应统一使用本模块，避免在 Linux 上把 /Foo 和 /foo
 * 当成同一个目录。
 */

import { getPlatform, type KimixPlatform } from "./platform";

export function isWindowsCaseInsensitive(platform?: KimixPlatform): boolean {
  return platform === "win32";
}

export function normalizePathForComparison(
  input: string | undefined | null,
  platform: KimixPlatform | undefined = getPlatform(),
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
