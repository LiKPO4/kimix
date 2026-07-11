export type UpdateAssetPlatform = "win32" | "darwin" | "linux" | string;

function isMacInstaller(name: string): boolean {
  return name.endsWith(".dmg") || name.endsWith(".zip");
}

/**
 * Select an installer without ever falling back from one macOS architecture to
 * the other. Older electron-builder x64 macOS assets have no `x64` suffix, so
 * an unmarked macOS installer is treated as x64 for backward compatibility.
 */
export function pickUpdateAssetForPlatform<T extends { name: string }>(
  assets: T[],
  platform: UpdateAssetPlatform,
  arch: string,
  portableWindows = false,
): T | null {
  const named = assets.map((asset) => ({ asset, name: asset.name.toLowerCase() }));
  if (platform === "win32") {
    const preferred = portableWindows
      ? named.find(({ name }) => name.endsWith(".exe") && !name.includes("setup"))
      : named.find(({ name }) => name.includes("setup") && name.endsWith(".exe"));
    return preferred?.asset ?? named.find(({ name }) => name.endsWith(".exe"))?.asset ?? null;
  }
  if (platform === "darwin") {
    const installers = named.filter(({ name }) => isMacInstaller(name));
    if (arch === "arm64") {
      return installers.find(({ name }) => name.includes("arm64"))?.asset ??
        installers.find(({ name }) => name.includes("universal"))?.asset ??
        null;
    }
    return installers.find(({ name }) => name.includes("x64"))?.asset ??
      installers.find(({ name }) => !name.includes("arm64") && !name.includes("universal"))?.asset ??
      installers.find(({ name }) => name.includes("universal"))?.asset ??
      null;
  }
  return named.find(({ name }) => name.endsWith(".appimage"))?.asset ??
    named.find(({ name }) => name.endsWith(".deb"))?.asset ??
    null;
}
