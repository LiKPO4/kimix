$ErrorActionPreference = "Stop"

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$nodePath = "C:\Program Files\nodejs"
$pnpmPath = "C:\Users\lijialin08\AppData\Roaming\npm"
$env:Path = "$nodePath;$pnpmPath;$env:Path"
$fullClean = $args -contains "--clean"
$hotReloadDev = $args -contains "--dev"
$fastLaunch = $args -contains "--fast"
$runtimeTokenPath = Join-Path $workspace "out\.kimix-runtime-token"

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

function Get-CurrentGitHead {
  $head = (& git -C $workspace rev-parse HEAD 2>$null)
  if ($LASTEXITCODE -ne 0) { return "" }
  return ([string]$head).Trim()
}

function Test-BuildOutputStale {
  param([string]$OutMarker)
  if (-not (Test-Path -LiteralPath $OutMarker)) { return $true }

  # A dirty workspace is always rebuilt. File timestamps are not a reliable
  # build identity after checkout, restore, or copying the workspace.
  $porcelain = @(& git -C $workspace status --porcelain --untracked-files=all 2>$null)
  if ($LASTEXITCODE -ne 0 -or $porcelain.Count -gt 0) { return $true }

  $stampPath = Join-Path $workspace "out\.kimix-build-fingerprint"
  if (-not (Test-Path -LiteralPath $stampPath)) { return $true }
  $expected = Get-CurrentGitHead
  if (-not $expected) { return $true }
  $actual = (Get-Content -LiteralPath $stampPath -Raw).Trim()
  return $actual -ne $expected
}

function Write-BuildFingerprint {
  $head = Get-CurrentGitHead
  if (-not $head) { throw "Cannot read Git HEAD; refusing to launch a stale build." }
  $stampPath = Join-Path $workspace "out\.kimix-build-fingerprint"
  Set-Content -LiteralPath $stampPath -Value $head -NoNewline -Encoding UTF8
}

function Get-RuntimeToken {
  if (-not (Test-Path -LiteralPath $runtimeTokenPath)) { return $null }
  return (Get-Content -LiteralPath $runtimeTokenPath -Raw).Trim()
}

function Set-RuntimeToken {
  param([string]$Token)
  $outDir = Join-Path $workspace "out"
  if (-not (Test-Path -LiteralPath $outDir)) {
    New-Item -ItemType Directory -Path $outDir | Out-Null
  }
  Set-Content -LiteralPath $runtimeTokenPath -Value $Token -NoNewline -Encoding UTF8
}

function New-RuntimeToken {
  return [Guid]::NewGuid().ToString("N")
}

function Stop-KimixProcessTree {
  $oldToken = Get-RuntimeToken
  $all = Get-CimInstance Win32_Process | Where-Object { $_.Name -in @("cmd.exe", "powershell.exe", "pwsh.exe", "Kimix.exe", "electron.exe", "node.exe", "esbuild.exe") }
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
    $processIdentity = @([string]$process.ExecutablePath, $commandLine) -join " "
    $isProtected = $protectedIds.Contains([int]$process.ProcessId)

    # Primary matching: a dedicated runtime token written by the previous launch.
    # This avoids killing unrelated Electron/Node processes on the same machine.
    $hasRuntimeToken = $oldToken -and (Test-ContainsIgnoreCase $commandLine "--kimix-runtime-token=$oldToken")

    # Fallback path-based heuristics for backward compatibility when no token
    # file exists (first run after this change) or a process lost its args.
    $inKnownKimixPath = (Test-ContainsIgnoreCase $processIdentity $workspace) -or
      (Test-ContainsIgnoreCase $processIdentity "kimix-pre-dev-compat") -or
      ($processIdentity -match "(?i)[\\/]kimix(?:-[^\\/\s]+)?[\\/]")
    $isKimixElectron = $process.Name -eq "electron.exe" -and (
      $inKnownKimixPath
    )
    $isKimixPackaged = $process.Name -eq "Kimix.exe"
    $isKimixShell = $process.Name -in @("cmd.exe", "powershell.exe", "pwsh.exe") -and $inKnownKimixPath -and (
      (Test-ContainsIgnoreCase $commandLine "start-kimix.bat") -or
      (Test-ContainsIgnoreCase $commandLine "restart-kimix-dev.ps1")
    )
    $isKimixNode = $process.Name -eq "node.exe" -and (
      $inKnownKimixPath -and (
        (Test-ContainsIgnoreCase $commandLine "scripts/dev.cjs") -or
        (Test-ContainsIgnoreCase $commandLine "electron-vite") -or
        (Test-ContainsIgnoreCase $commandLine "pnpm")
      )
    )
    $isKimixEsbuild = $process.Name -eq "esbuild.exe" -and $inKnownKimixPath

    if (-not $isProtected -and ($hasRuntimeToken -or $isKimixElectron -or $isKimixPackaged -or $isKimixShell -or $isKimixNode -or $isKimixEsbuild)) {
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

# Generate a fresh runtime token for this launch and make it available to the
# child process tree via both the command line and the environment.
$script:RuntimeToken = New-RuntimeToken
Set-RuntimeToken $script:RuntimeToken
$env:KIMIX_RUNTIME_TOKEN = $script:RuntimeToken

function Test-BuildOutputComplete {
  $mainBundle = Join-Path $workspace "out\main\index.cjs"
  $rendererIndex = Join-Path $workspace "out\renderer\index.html"
  return (Test-Path -LiteralPath $mainBundle) -and (Test-Path -LiteralPath $rendererIndex)
}

function Start-KimixBuiltApp {
  $electronBin = Join-Path $workspace "node_modules\electron\dist\electron.exe"
  if (-not (Test-Path -LiteralPath $electronBin)) {
    # Fallback to the npm wrapper if the direct binary is missing.
    $electronBin = Join-Path $workspace "node_modules\.bin\electron.cmd"
  }
  Start-Process -FilePath $electronBin -ArgumentList ". --kimix-runtime-token=$($script:RuntimeToken)" -WorkingDirectory $workspace
}

function Invoke-KimixBuild {
  pnpm build
  if ($LASTEXITCODE -ne 0) {
    throw "pnpm build failed; refusing to launch the stale build output."
  }
  Write-BuildFingerprint
}

if ($hotReloadDev) {
  Write-Host "Starting dev server with hot reload..."
  # Use node directly so the runtime token appears in the top-level command line
  # and is forwarded by scripts/dev.cjs to the Electron process tree.
  $devScript = Join-Path $workspace "scripts\dev.cjs"
  Start-Process -FilePath "node" -ArgumentList "$devScript --kimix-runtime-token=$($script:RuntimeToken)" -WorkingDirectory $workspace -Wait
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
  Invoke-KimixBuild
  Start-KimixBuiltApp
  return
}

$needsBuild = $false
$outMarker = Join-Path $workspace "out\renderer\index.html"
if ($fastLaunch) {
  Write-Host "Fast launch: using existing built output."
} elseif (-not (Test-BuildOutputComplete)) {
  Write-Host "No built output found; building..."
  $needsBuild = $true
} elseif (Test-BuildOutputStale $outMarker) {
  Write-Host "Build fingerprint missing or stale; rebuilding..."
  $needsBuild = $true
} else {
  Write-Host "Built output is up to date; launching directly."
}

if ($needsBuild) {
  Invoke-KimixBuild
}

Start-KimixBuiltApp
