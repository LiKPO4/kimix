$ErrorActionPreference = "Stop"

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$nodePath = "C:\Program Files\nodejs"
$pnpmPath = "C:\Users\lijialin08\AppData\Roaming\npm"
$env:Path = "$nodePath;$pnpmPath;$env:Path"
$fullClean = $args -contains "--clean"
$hotReloadDev = $args -contains "--dev"
$fastLaunch = $args -contains "--fast"

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

function Test-GitWorkspaceDirty {
  try {
    $status = & git -C $workspace status --porcelain 2>$null
    return $status -ne $null -and $status.Length -gt 0
  } catch {
    return $false
  }
}

function Stop-KimixProcessTree {
  $all = Get-CimInstance Win32_Process | Where-Object { $_.Name -in @("cmd.exe", "powershell.exe", "pwsh.exe", "electron.exe", "node.exe", "esbuild.exe") }
  $targetIds = New-Object "System.Collections.Generic.HashSet[int]"
  $protectedIds = New-Object "System.Collections.Generic.HashSet[int]"
  $currentId = [int]$PID
  $processById = @{}
  foreach ($process in $all) {
    $processById[[int]$process.ProcessId] = $process
  }
  while ($processById.ContainsKey($currentId)) {
    [void]$protectedIds.Add($currentId)
    $currentId = [int]$processById[$currentId].ParentProcessId
  }

  foreach ($process in $all) {
    $commandLine = [string]$process.CommandLine
    $isProtected = $protectedIds.Contains([int]$process.ProcessId)
    $inWorkspace = Test-ContainsIgnoreCase $commandLine $workspace
    $isKimixElectron = $process.Name -eq "electron.exe" -and $inWorkspace
    $isKimixShell = $process.Name -in @("cmd.exe", "powershell.exe", "pwsh.exe") -and $inWorkspace -and (
      (Test-ContainsIgnoreCase $commandLine "start-kimix.bat") -or
      (Test-ContainsIgnoreCase $commandLine "restart-kimix-dev.ps1")
    )
    $isKimixNode = $process.Name -eq "node.exe" -and (
      $inWorkspace -and (
        (Test-ContainsIgnoreCase $commandLine "scripts/dev.cjs") -or
        (Test-ContainsIgnoreCase $commandLine "electron-vite") -or
        (Test-ContainsIgnoreCase $commandLine "pnpm")
      )
    )
    $isKimixEsbuild = $process.Name -eq "esbuild.exe" -and $inWorkspace

    if (-not $isProtected -and ($isKimixElectron -or $isKimixShell -or $isKimixNode -or $isKimixEsbuild)) {
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
    if (-not $protectedIds.Contains([int]$id)) {
      Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    }
  }

  $deadline = (Get-Date).AddSeconds(5)
  while ((Get-Date) -lt $deadline) {
    $remaining = Get-CimInstance Win32_Process | Where-Object {
      $targetIds.Contains([int]$_.ProcessId) -and -not $protectedIds.Contains([int]$_.ProcessId)
    }
    if (-not $remaining) {
      return
    }
    Start-Sleep -Milliseconds 150
  }
}

Set-Location $workspace
Stop-KimixProcessTree

function Test-BuildOutputComplete {
  $mainBundle = Join-Path $workspace "out\main\index.cjs"
  $rendererIndex = Join-Path $workspace "out\renderer\index.html"
  return (Test-Path -LiteralPath $mainBundle) -and (Test-Path -LiteralPath $rendererIndex)
}

function Start-KimixBuiltApp {
  $electronBin = Join-Path $workspace "node_modules\.bin\electron.cmd"
  Start-Process -FilePath $electronBin -ArgumentList "." -WorkingDirectory $workspace
}

if ($hotReloadDev) {
  Write-Host "Starting dev server with hot reload..."
  pnpm dev
  return
}

if ($fullClean) {
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

  foreach ($target in $cleanTargets) {
    if (Test-Path -LiteralPath $target) {
      Remove-Item -LiteralPath $target -Recurse -Force
    }
  }

  Write-Host "Clean rebuild..."
  pnpm build
  Start-KimixBuiltApp
  return
}

$needsBuild = $false
if ($fastLaunch) {
  Write-Host "Fast launch: using existing built output."
} elseif (-not (Test-BuildOutputComplete)) {
  Write-Host "No built output found; building..."
  $needsBuild = $true
} elseif (Test-GitWorkspaceDirty) {
  Write-Host "Uncommitted source changes detected; rebuilding..."
  $needsBuild = $true
} else {
  Write-Host "Source is clean and built output exists; launching directly."
}

if ($needsBuild) {
  pnpm build
}

Start-KimixBuiltApp
