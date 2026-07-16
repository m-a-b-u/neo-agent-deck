Set-StrictMode -Version Latest

function Get-NeoConfigDirectory {
  if ($env:NEO_AGENT_DECK_HOME) {
    return $env:NEO_AGENT_DECK_HOME
  }
  return Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)) ".neo-agent-deck"
}

function Test-NeoProcess {
  param(
    [Parameter(Mandatory = $true)][int]$Id,
    [Parameter(Mandatory = $true)][string]$CommandNeedle
  )

  try {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $Id" -ErrorAction Stop
    return $null -ne $process -and
      $null -ne $process.CommandLine -and
      $process.CommandLine.IndexOf($CommandNeedle, [StringComparison]::OrdinalIgnoreCase) -ge 0
  } catch {
    return $false
  }
}

function Stop-NeoService {
  param([string]$ConfigDirectory = (Get-NeoConfigDirectory))

  $supervisorFile = Join-Path $ConfigDirectory "supervisor.pid"
  $serviceFile = Join-Path $ConfigDirectory "service.pid"
  $processes = @()

  foreach ($entry in @(
    @{ Path = $supervisorFile; Needle = "start-windows.ps1" },
    @{ Path = $serviceFile; Needle = "dist\src\index.js" }
  )) {
    if (-not (Test-Path $entry.Path)) { continue }
    $storedId = 0
    if ([int]::TryParse((Get-Content $entry.Path -Raw).Trim(), [ref]$storedId) -and
        (Test-NeoProcess -Id $storedId -CommandNeedle $entry.Needle)) {
      $processes += @{ Id = $storedId; Needle = $entry.Needle }
    }
  }

  # Stop the supervisor first so it cannot restart the child while uninstalling.
  foreach ($entry in $processes) {
    Stop-Process -Id $entry.Id -Force -ErrorAction SilentlyContinue
    Wait-Process -Id $entry.Id -Timeout 5 -ErrorAction SilentlyContinue
  }
  Remove-Item $supervisorFile, $serviceFile -Force -ErrorAction SilentlyContinue
}
