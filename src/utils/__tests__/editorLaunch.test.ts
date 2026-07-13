import { describe, expect, it } from "vitest";
import { getWindowsVsCodeCandidates } from "@/utils/editorLaunch";

describe("editorLaunch", () => {
  it("builds common per-user and machine-wide VS Code paths", () => {
    expect(getWindowsVsCodeCandidates({
      LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
      ProgramFiles: "C:\\Program Files",
      "ProgramFiles(x86)": "C:\\Program Files (x86)",
    })).toEqual([
      "C:\\Users\\test\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
      "C:\\Program Files\\Microsoft VS Code\\Code.exe",
      "C:\\Program Files (x86)\\Microsoft VS Code\\Code.exe",
    ]);
  });

  it("omits candidates whose environment root is unavailable", () => {
    expect(getWindowsVsCodeCandidates({ ProgramFiles: "D:\\Apps" })).toEqual([
      "D:\\Apps\\Microsoft VS Code\\Code.exe",
    ]);
  });
});
