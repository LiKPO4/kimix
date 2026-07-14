export interface ActivatableWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  isAlwaysOnTop(): boolean;
  setAlwaysOnTop(enabled: boolean): void;
  show(): void;
  moveTop(): void;
  focus(): void;
}

const WINDOWS_TOPMOST_PULSE_MS = 200;

export function activateWindow(
  window: ActivatableWindow | null | undefined,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!window || window.isDestroyed()) return false;
  if (window.isMinimized()) window.restore();

  const pulseTopmost = platform === "win32" && !window.isAlwaysOnTop();
  if (pulseTopmost) window.setAlwaysOnTop(true);

  window.show();
  if (platform === "win32") window.moveTop();
  window.focus();

  if (pulseTopmost) {
    setTimeout(() => {
      if (!window.isDestroyed()) window.setAlwaysOnTop(false);
    }, WINDOWS_TOPMOST_PULSE_MS);
  }
  return true;
}
