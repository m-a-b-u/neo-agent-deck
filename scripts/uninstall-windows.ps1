Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") { throw "This uninstaller must run on Windows." }

. (Join-Path $PSScriptRoot "windows-service-common.ps1")

$AppDirectory = Join-Path $env:LOCALAPPDATA "NeoAgentDeck"
$ConfigDirectory = Get-NeoConfigDirectory
$StartupDirectory = [Environment]::GetFolderPath([Environment+SpecialFolder]::Startup)
$StartupFile = Join-Path $StartupDirectory "Neo Agent Deck.vbs"

Stop-NeoService -ConfigDirectory $ConfigDirectory
Remove-Item $StartupFile -Force -ErrorAction SilentlyContinue
Remove-Item $AppDirectory -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Neo Agent Deck has been removed from Windows startup."
Write-Host "Preferences and logs were kept in $ConfigDirectory."
Write-Host "You can reopen the Elgato Stream Deck app to return control to it."
