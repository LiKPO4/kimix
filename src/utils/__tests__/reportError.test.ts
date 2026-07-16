import { describe, expect, it, vi, beforeEach } from "vitest";
import { logError, logEvent, reportError } from "@/utils/reportError";

describe("reportError", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "api", {
      value: { writeDiag: vi.fn() },
      writable: true,
      configurable: true,
    });
  });

  it("writes background errors to diag without toast", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    reportError(new Error("bg fail"), { context: "test" });
    expect(consoleWarn).toHaveBeenCalledWith("[test] bg fail");
    expect(window.api.writeDiag).toHaveBeenCalledWith({
      message: "[test] background error",
      data: { message: "bg fail" },
    });
  });

  it("writes user-visible errors to diag and dispatches toast", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const dispatchSpy = vi.spyOn(window, "dispatchEvent").mockImplementation(() => true);
    reportError(new Error("visible fail"), { context: "test", userVisible: true });
    expect(consoleError).toHaveBeenCalled();
    expect(window.api.writeDiag).toHaveBeenCalledWith({
      message: "[test] user-visible error",
      data: expect.objectContaining({ message: "visible fail" }),
    });
    expect(dispatchSpy).toHaveBeenCalledWith(expect.any(CustomEvent));
    const event = dispatchSpy.mock.calls.find((call) => call[0] instanceof CustomEvent)?.[0] as CustomEvent;
    expect(event?.type).toBe("kimix:toast");
  });

  it("swallows writeDiag failures", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = new Error("diag write failed");
    (window.api.writeDiag as ReturnType<typeof vi.fn>).mockRejectedValue(err);
    reportError(new Error("original"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("logEvent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "api", {
      value: { writeDiag: vi.fn() },
      writable: true,
      configurable: true,
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("logs structured events to console and diag", () => {
    logEvent("test.context", { foo: "bar" });
    expect(console.log).toHaveBeenCalledWith("[test.context]", { foo: "bar" });
    expect(window.api.writeDiag).toHaveBeenCalledWith({
      message: "test.context",
      data: { foo: "bar" },
    });
  });

  it("survives missing writeDiag implementation", () => {
    Object.defineProperty(window, "api", { value: {}, writable: true, configurable: true });
    expect(() => logEvent("test.context", { foo: "bar" })).not.toThrow();
  });

  it("swallows writeDiag failures via logError", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = new Error("diag write failed");
    (window.api.writeDiag as ReturnType<typeof vi.fn>).mockRejectedValue(err);
    logEvent("test.context", { foo: "bar" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(consoleWarn).toHaveBeenCalled();
  });
});

describe("logError", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "api", {
      value: { writeDiag: vi.fn() },
      writable: true,
      configurable: true,
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("creates a contextualized error logger", () => {
    const logger = logError("my.context");
    logger(new Error("oops"));
    expect(window.api.writeDiag).toHaveBeenCalledWith({
      message: "[my.context] background error",
      data: { message: "oops" },
    });
  });
});
