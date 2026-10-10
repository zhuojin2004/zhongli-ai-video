# ============================================================================
# Zhongli - One-click deploy (uses zip + Expand-Archive)
# ============================================================================
# Place this file at: C:\Users\Administrator\run-deploy.ps1
# Also need:         C:\Users\Administrator\zhongli-src.zip
#
# Run: powershell -File C:\Users\Administrator\run-deploy.ps1
# ============================================================================

$ErrorActionPreference = 'Stop'

try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
  chcp 65001 | Out-Null
} catch {}

function Info($m)    { Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m)      { Write-Host "[OK]   $m" -ForegroundColor Green }
function Warn($m)    { Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Err($m)     { Write-Host "[ERR]  $m" -ForegroundColor Red; exit 1 }

# Refresh PATH
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

$ZipPath = "$env:USERPROFILE\zhongli-src.zip"
$AppDir  = 'C:\zhongli-src'
$Script  = "$AppDir\deploy-windows\deploy-minimal.ps1"

# 1. Check prerequisites
Info "Checking Node.js ..."
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Err "Node.js not found. Install from https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi"
}
Ok "Node.js: $(node -v)"

Info "Checking zip ..."
if (-not (Test-Path $ZipPath)) {
  Err "Zip not found: $ZipPath`nUpload zhongli-src.zip to your home directory first."
}
$size = (Get-Item $ZipPath).Length
Ok "Zip: $ZipPath ($size bytes)"
if ($size -lt 500000) {
  Err "Zip too small ($size bytes), likely corrupted. Re-upload it."
}

# 2. Clean old install
if (Test-Path $AppDir) {
  Warn "Removing old $AppDir ..."
  Remove-Item $AppDir -Recurse -Force
}

# 3. Extract using Expand-Archive (PowerShell native, no UNC bug)
Info "Extracting zip to C:\ ..."
Expand-Archive -Path $ZipPath -DestinationPath 'C:\' -Force
if (-not (Test-Path $Script)) {
  Err "deploy-minimal.ps1 not found after extraction. Zip may be wrong version."
}
Ok "Extracted to $AppDir"

# 4. Run deploy
Info "Starting deploy-minimal.ps1 (5-8 minutes) ..."
Info "Press Ctrl+C to abort."
Write-Host ""
& 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -NoProfile -ExecutionPolicy Bypass -File $Script

if ($LASTEXITCODE -ne 0) {
  Err "Deploy script failed with exit code $LASTEXITCODE. Check output above."
}

Ok "All done!"