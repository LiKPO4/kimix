import { describe, expect, it } from "vitest";
import { isGitBashMissingError } from "../gitBash";

describe("isGitBashMissingError", () => {
  it("matches the exact SDK Git Bash missing error", () => {
    expect(
      isGitBashMissingError(
        "Git Bash was not found on this Windows host. Install Git for Windows from https://gitforwindows.org/ or set KIMI_SHELL_PATH to a bash.exe. Checked: C:\\Program Files\\Git\\bin\\bash.exe.",
      ),
    ).toBe(true);
  });

  it("matches variants mentioning KIMI_SHELL_PATH", () => {
    expect(
      isGitBashMissingError(
        "Git Bash was not found on this Windows host. Install Git for Windows from https://gitforwindows.org/ or set KIMI_SHELL_PATH to a bash.exe.",
      ),
    ).toBe(true);
    expect(isGitBashMissingError("set KIMI_SHELL_PATH to a bash.exe before retrying")).toBe(true);
  });

  it("does not match ordinary model errors", () => {
    expect(isGitBashMissingError("The model returned an invalid JSON response.")).toBe(false);
    expect(isGitBashMissingError("Connection to the API timed out while streaming.")).toBe(false);
  });

  it("rejects empty or missing input", () => {
    expect(isGitBashMissingError("")).toBe(false);
    expect(isGitBashMissingError(undefined)).toBe(false);
    expect(isGitBashMissingError(null)).toBe(false);
  });
});
