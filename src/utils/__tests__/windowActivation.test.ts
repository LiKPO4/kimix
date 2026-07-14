import { afterEach, describe, expect, it, vi } from "vitest";
import { activateWindow } from "../../../electron/windowActivation";

function createWindow(options: {
  destroyed?: boolean;
  minimized?: boolean;
  alwaysOnTop?: boolean;
} = {}) {
  const calls: string[] = [];
  const window = {
    isDestroyed: vi.fn(() => options.destroyed ?? false),
    isMinimized: vi.fn(() => options.minimized ?? false),
    restore: vi.fn(() => calls.push("restore")),
    isAlwaysOnTop: vi.fn(() => options.alwaysOnTop ?? false),
    setAlwaysOnTop: vi.fn((enabled: boolean) => calls.push(`always:${enabled}`)),
    show: vi.fn(() => calls.push("show")),
    moveTop: vi.fn(() => calls.push("moveTop")),
    focus: vi.fn(() => calls.push("focus")),
  };
  return { window, calls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("activateWindow", () => {
  it("restores and foregrounds a Windows window with a temporary topmost pulse", () => {
    vi.useFakeTimers();
    const { window, calls } = createWindow({ minimized: true });

    expect(activateWindow(window, "win32")).toBe(true);
    expect(calls).toEqual(["restore", "always:true", "show", "moveTop", "focus"]);

    vi.advanceTimersByTime(200);
    expect(calls).toEqual(["restore", "always:true", "show", "moveTop", "focus", "always:false"]);
  });

  it("does not clear a pre-existing always-on-top state", () => {
    vi.useFakeTimers();
    const { window, calls } = createWindow({ alwaysOnTop: true });

    expect(activateWindow(window, "win32")).toBe(true);
    vi.runAllTimers();
    expect(calls).toEqual(["show", "moveTop", "focus"]);
  });

  it("does not touch a destroyed window", () => {
    const { window, calls } = createWindow({ destroyed: true });

    expect(activateWindow(window, "win32")).toBe(false);
    expect(calls).toEqual([]);
  });

  it("uses the normal show and focus path outside Windows", () => {
    const { window, calls } = createWindow({ minimized: true });

    expect(activateWindow(window, "darwin")).toBe(true);
    expect(calls).toEqual(["restore", "show", "focus"]);
  });
});
