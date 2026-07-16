Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") { throw "This installer must run on Windows." }

. (Join-Path $PSScriptRoot "windows-service-common.ps1")

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$AppDirectory = Join-Path $env:LOCALAPPDATA "NeoAgentDeck"
$ConfigDirectory = Get-NeoConfigDirectory
$StartupDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
$StartupFile = Join-Path $StartupDirectory "Neo Agent Deck.vbs"
$NodeBinary = (Get-Command node.exe -ErrorAction Stop).Source
$PowerShellBinary = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"

Stop-NeoService -ConfigDirectory $ConfigDirectory
Get-Process -Name "StreamDeck" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Push-Location $Root
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "Build failed with exit code $LASTEXITCODE." }
} finally {
  Pop-Location
}

New-Item -ItemType Directory -Force -Path $AppDirectory, $StartupDirectory, $ConfigDirectory | Out-Null

& robocopy.exe $Root $AppDirectory /MIR /XD node_modules .git test coverage /XF "*.log" | Out-Host
$robocopyExit = $LASTEXITCODE
if ($robocopyExit -ge 8) { throw "Copy failed with robocopy exit code $robocopyExit." }
$global:LASTEXITCODE = 0

Push-Location $AppDirectory
try {
  & npm.cmd ci --omit=dev
  if ($LASTEXITCODE -ne 0) { throw "Production dependency install failed with exit code $LASTEXITCODE." }
} finally {
  Pop-Location
}

Set-Content -Path (Join-Path $AppDirectory "node-path.txt") -Value $NodeBinary -Encoding UTF8

$StartScript = Join-Path $AppDirectory "scripts\start-windows.ps1"
$command = "$PowerShellBinary -NoProfile -ExecutionPolicy Bypass -File `"$StartScript`""
$escapedCommand = $command.Replace('"', '""')
Set-Content -Path $StartupFile -Encoding Unicode -Value "CreateObject(`"WScript.Shell`").Run `"$escapedCommand`", 0, False"

Start-Process -FilePath $PowerShellBinary `
  -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$StartScript`"" `
  -WindowStyle Hidden
Start-Sleep -Seconds 2

$SupervisorPidFile = Join-Path $ConfigDirectory "supervisor.pid"
if (-not (Test-Path $SupervisorPidFile)) { throw "The Windows login service did not start." }
$supervisorId = [int](Get-Content $SupervisorPidFile -Raw).Trim()
if (-not (Test-NeoProcess -Id $supervisorId -CommandNeedle "start-windows.ps1")) {
  throw "The Windows login service exited during startup."
}

Write-Host "Neo Agent Deck installed and started for the current Windows user."
Write-Host "Startup entry: $StartupFile"
Write-Host "Logs: $(Join-Path $ConfigDirectory 'logs')"
Write-Host "Elgato Stream Deck was closed so Neo Agent Deck can own the USB device."
