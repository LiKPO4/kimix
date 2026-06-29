/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePresence } from "../usePresence";

function Probe({ present }: { present: boolean }) {
  const presence = usePresence(present, 150);
  return createElement("div", {
    "data-mounted": presence.mounted,
    "data-visible": presence.visible,
  });
}

describe("usePresence", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.useRealTimers();
  });

  it("keeps content mounted until the exit duration elapses", () => {
    const root = createRoot(container);

    act(() => root.render(createElement(Probe, { present: true })));
    expect(container.firstElementChild?.getAttribute("data-mounted")).toBe("true");
    expect(container.firstElementChild?.getAttribute("data-visible")).toBe("true");

    act(() => root.render(createElement(Probe, { present: false })));
    expect(container.firstElementChild?.getAttribute("data-mounted")).toBe("true");
    expect(container.firstElementChild?.getAttribute("data-visible")).toBe("false");

    act(() => vi.advanceTimersByTime(149));
    expect(container.firstElementChild?.getAttribute("data-mounted")).toBe("true");

    act(() => vi.advanceTimersByTime(1));
    expect(container.firstElementChild?.getAttribute("data-mounted")).toBe("false");

    act(() => root.unmount());
  });
});
