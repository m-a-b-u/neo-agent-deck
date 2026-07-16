Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "windows-service-common.ps1")

$AppDirectory = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ConfigDirectory = Get-NeoConfigDirectory
$LogDirectory = Join-Path $ConfigDirectory "logs"
$SupervisorPidFile = Join-Path $ConfigDirectory "supervisor.pid"
$ServicePidFile = Join-Path $ConfigDirectory "service.pid"
$NodePathFile = Join-Path $AppDirectory "node-path.txt"
$EntryPoint = Join-Path $AppDirectory "dist\src\index.js"

New-Item -ItemType Directory -Force -Path $ConfigDirectory, $LogDirectory | Out-Null

if (Test-Path $SupervisorPidFile) {
  $existingId = 0
  if ([int]::TryParse((Get-Content $SupervisorPidFile -Raw).Trim(), [ref]$existingId) -and
      (Test-NeoProcess -Id $existingId -CommandNeedle "start-windows.ps1")) {
    exit 0
  }
}

if (-not (Test-Path $NodePathFile)) { throw "node-path.txt is missing; run npm run install:win again." }
if (-not (Test-Path $EntryPoint)) { throw "The built entry point is missing; run npm run install:win again." }

$NodeBinary = (Get-Content $NodePathFile -Raw).Trim()
if (-not (Test-Path $NodeBinary)) { throw "The installed Node.js executable no longer exists: $NodeBinary" }

Set-Content -Path $SupervisorPidFile -Value $PID -Encoding Ascii

try {
  while ($true) {
    $stdout = Join-Path $LogDirectory "NeoAgentDeck.log"
    $stderr = Join-Path $LogDirectory "NeoAgentDeck.error.log"
    $quotedEntryPoint = '"' + $EntryPoint + '"'
    $child = Start-Process -FilePath $NodeBinary -ArgumentList $quotedEntryPoint -WorkingDirectory $AppDirectory `
      -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    Set-Content -Path $ServicePidFile -Value $child.Id -Encoding Ascii
    $child.WaitForExit()
    Remove-Item $ServicePidFile -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 5
  }
} finally {
  Remove-Item $ServicePidFile, $SupervisorPidFile -Force -ErrorAction SilentlyContinue
}
