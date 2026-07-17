Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") { throw "Use ./install.sh on macOS or Linux." }

$Root = $PSScriptRoot
Push-Location $Root
try {
  if (-not (Get-Command node.exe -ErrorAction SilentlyContinue) -or
      -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw "Node.js 22.13+ (Node 22) or Node.js 24+ is required: https://nodejs.org/"
  }

  & node.exe -e 'const [major, minor] = process.versions.node.split(".").map(Number); const ok = (major === 22 && minor >= 13) || major >= 24; if (!ok) { console.error(`Node.js 22.13+ or 24+ is required (the 23.x line is unsupported); found ${process.version}`); process.exit(1); }'
  if ($LASTEXITCODE -ne 0) { throw "Unsupported Node.js version." }

  Write-Host "Installing setup dependencies..."
  & npm.cmd ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE." }

  Write-Host ""
  Write-Host "Opening the guided Neo Agent Deck setup..."
  & npm.cmd run setup
  if ($LASTEXITCODE -ne 0) { throw "Setup failed with exit code $LASTEXITCODE." }

  & npm.cmd run install:win
  if ($LASTEXITCODE -ne 0) { throw "Windows installation failed with exit code $LASTEXITCODE." }

  Write-Host ""
  Write-Host "Setup complete. Connect the Neo whenever you are ready."
} finally {
  Pop-Location
}
