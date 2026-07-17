import { describe, expect, it } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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

  it("quotes the dev script path and restricts packaged processes to this workspace", () => {
    const content = readFileSync(scriptPath, "utf-8");
    expect(content).toContain('$devArguments = "`"$devScript`" --kimix-runtime-token=');
    expect(content).toContain('$inWorkspacePath = Test-ContainsIgnoreCase $processIdentity $workspace');
    expect(content).toContain('$isKimixPackaged = $process.Name -eq "Kimix.exe" -and ($hasRuntimeToken -or $inWorkspacePath)');
    expect(content).not.toContain('$isKimixPackaged = $process.Name -eq "Kimix.exe" -and ($hasRuntimeToken -or $inKnownKimixPath)');
  });

  it.runIf(process.platform === "win32")("preserves a script path containing spaces across Start-Process argv", () => {
    const directory = mkdtempSync(join(tmpdir(), "kimix argv probe "));
    try {
      const probePath = join(directory, "probe script.cjs");
      const outputPath = join(directory, "argv output.json");
      writeFileSync(probePath, "require('node:fs').writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)))");
      const escapePowerShell = (value: string) => value.replace(/'/g, "''");
      const command = [
        `$probe='${escapePowerShell(probePath)}'`,
        `$output='${escapePowerShell(outputPath)}'`,
        '$arguments="`"$probe`" `"$output`" --kimix-runtime-token=review-probe"',
        '$process=Start-Process -FilePath "node" -ArgumentList $arguments -Wait -PassThru',
        'exit $process.ExitCode',
      ].join("; ");
      execFileSync("powershell", ["-NoProfile", "-Command", command], {
        windowsHide: true,
        timeout: 30_000,
      });
      expect(JSON.parse(readFileSync(outputPath, "utf-8"))).toEqual(["--kimix-runtime-token=review-probe"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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
