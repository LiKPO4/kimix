$ErrorActionPreference = "Stop"

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$nodePath = "C:\Program Files\nodejs"
$pnpmPath = "C:\Users\lijialin08\AppData\Roaming\npm"
$env:Path = "$nodePath;$pnpmPath;$env:Path"

function Test-InWorkspace {
  param([string]$Path)
  $full = [System.IO.Path]::GetFullPath($Path)
  return $full.StartsWith($workspace, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-ContainsIgnoreCase {
  param(
    [string]$Text,
    [string]$Needle
  )
  return $Text.IndexOf($Needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Stop-KimixProcessTree {
  $all = Get-CimInstance Win32_Process | Where-Object { $_.Name -in @("electron.exe", "node.exe") }
  $targetIds = New-Object "System.Collections.Generic.HashSet[int]"

  foreach ($process in $all) {
    $commandLine = [string]$process.CommandLine
    $isKimixElectron = $process.Name -eq "electron.exe" -and (
      (Test-ContainsIgnoreCase $commandLine $workspace) -or
      (Test-ContainsIgnoreCase $commandLine "AppData\Roaming\kimix")
    )
    $isKimixNode = $process.Name -eq "node.exe" -and (
      (Test-ContainsIgnoreCase $commandLine $workspace) -or
      (Test-ContainsIgnoreCase $commandLine "scripts/dev.cjs") -or
      (Test-ContainsIgnoreCase $commandLine "electron-vite")
    )

    if ($isKimixElectron -or $isKimixNode) {
      [void]$targetIds.Add([int]$process.ProcessId)
    }
  }

  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($process in $all) {
      if ($targetIds.Contains([int]$process.ParentProcessId) -and -not $targetIds.Contains([int]$process.ProcessId)) {
        [void]$targetIds.Add([int]$process.ProcessId)
        $changed = $true
      }
    }
  }

  foreach ($id in $targetIds) {
    Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
  }
}

$cleanTargets = @(
  (Join-Path $workspace "out"),
  (Join-Path $workspace "node_modules\.vite"),
  (Join-Path $workspace "node_modules\.cache")
)

foreach ($target in $cleanTargets) {
  if (-not (Test-InWorkspace $target)) {
    throw "Refusing to clean outside workspace: $target"
  }
}

Stop-KimixProcessTree

foreach ($target in $cleanTargets) {
  if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
  }
}

Set-Location $workspace
pnpm build

$command = "set `"PATH=$nodePath;$pnpmPath;%PATH%`" && cd /d `"$workspace`" && pnpm dev > kimix-dev.log 2>&1"
Start-Process -FilePath "cmd.exe" -ArgumentList "/d", "/s", "/c", $command -WindowStyle Hidden

Start-Sleep -Seconds 8
Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq "electron.exe" -and
    (Test-ContainsIgnoreCase ([string]$_.CommandLine) $workspace)
  } |
  Select-Object ProcessId, Name, CommandLine
