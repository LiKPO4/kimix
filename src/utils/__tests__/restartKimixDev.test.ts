import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const scriptPath = resolve(__dirname, "../../../scripts/restart-kimix-dev.ps1");

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
