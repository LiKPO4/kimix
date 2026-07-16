import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const scriptPath = resolve(__dirname, "../../../scripts/restart-kimix-dev.ps1");
const devScriptPath = resolve(__dirname, "../../../scripts/dev.cjs");
const require = createRequire(import.meta.url);

describe("restart-kimix-dev.ps1", () => {
  it("exists and contains runtime-token helpers", () => {
    const content = readFileSync(scriptPath, "utf-8");
    expect(content).toContain("Get-RuntimeToken");
    expect(content).toContain("Set-RuntimeToken");
    expect(content).toContain("New-RuntimeToken");
    expect(content).toContain("--kimix-runtime-token=");
    expect(content).toContain("KIMIX_RUNTIME_TOKEN");
  });

  it("parses as valid PowerShell syntax", () => {
    const escapedPath = scriptPath.replace(/'/g, "''").replace(/\\/g, "\\\\");
    const parseCommand = `$errors=@(); [void]([System.Management.Automation.Language.Parser]::ParseFile('${escapedPath}',[ref]$null,[ref]$errors)); if ($errors.Count -gt 0) { foreach ($err in $errors) { Write-Error $err }; exit 1 }; exit 0`;
    expect(() => {
      execSync(`powershell -NoProfile -Command "${parseCommand}"`, {
        windowsHide: true,
        timeout: 30_000,
      });
    }).not.toThrow();
  });
});

describe("scripts/dev.cjs", () => {
  it("forwards the runtime token after the electron-vite option boundary", () => {
    const { buildElectronViteArgs } = require(devScriptPath) as {
      buildElectronViteArgs: (runtimeToken?: string) => string[];
    };
    const args = buildElectronViteArgs("review-probe");
    expect(args.slice(-2)).toEqual(["--", "--kimix-runtime-token=review-probe"]);
  });

  it("does not add an Electron option boundary when no token is present", () => {
    const { buildElectronViteArgs } = require(devScriptPath) as {
      buildElectronViteArgs: (runtimeToken?: string) => string[];
    };
    expect(buildElectronViteArgs("")).not.toContain("--");
  });
});
