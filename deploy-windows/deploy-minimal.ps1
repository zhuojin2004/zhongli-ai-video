# ============================================================================
# Zhongli - Minimal deploy (Node.js already installed, no downloads)
# ============================================================================
# Use this when Node.js is already installed and you just want to deploy.
# Skips: Node.js download, ffmpeg download (can be added later)
# Does: extract (if needed), npm install, build, .env, pm2 start, firewall
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Force UTF-8
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
  chcp 65001 | Out-Null
} catch {}

function Info($m)    { Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m)      { Write-Host "[OK]   $m" -ForegroundColor Green }
function Warn($m)    { Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Err($m)     { Write-Host "[ERR]  $m" -ForegroundColor Red; exit 1 }
function Section($m) { Write-Host ""; Write-Host "========== $m ==========" -ForegroundColor Green }

# Admin check
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Err "Please run as Administrator (right-click PowerShell -> Run as Administrator)"
}

# Refresh PATH so node/npm/pm2 (just installed) are visible
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# Paths
$AppDir    = 'C:\zhongli-src'
$ZipPath   = "$env:USERPROFILE\zhongli-src.zip"

# Check Node.js
Section "Check Node.js"
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Err "Node.js NOT FOUND. Please install from https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi first, then re-run."
}
$nodeVer = node -v
Ok "Node.js: $nodeVer"
$npmVer = npm -v
Ok "npm:     $npmVer"

# Extract project (if not already extracted by run-deploy.ps1)
Section "Extract project"
if (Test-Path "$AppDir\deploy-windows\deploy-minimal.ps1") {
  Ok "$AppDir already extracted, skipping"
} else {
  if (-not (Test-Path $ZipPath)) {
    Err "Cannot find $ZipPath. Please upload zhongli-src.zip to user home directory first."
  }
  if (Test-Path $AppDir) {
    Warn "$AppDir already exists, removing for clean install..."
    Remove-Item $AppDir -Recurse -Force
  }
  Info "Extracting $ZipPath to C:\ ..."
  Expand-Archive -Path $ZipPath -DestinationPath 'C:\' -Force
  if (-not (Test-Path "$AppDir\deploy-windows\deploy-minimal.ps1")) {
    Err "Extraction failed: deploy-minimal.ps1 not found in $AppDir"
  }
  Ok "Extracted to $AppDir"
}

Set-Location $AppDir

# npm install
Section "npm install (60-120s)"
if (Test-Path 'node_modules') {
  Warn "node_modules exists, removing for fresh install..."
  Remove-Item 'node_modules' -Recurse -Force
}
if (Test-Path 'package-lock.json') { Remove-Item 'package-lock.json' -Force }
Info "Running npm install --omit=dev ..."
$npmLog = "$env:TEMP\npm-install.log"
$npmErr = "$env:TEMP\npm-install.err"
# Use Start-Process to avoid PowerShell 5.1 false-positive on npm stderr warnings
$proc = Start-Process -FilePath "npm.cmd" -ArgumentList @("install","--omit=dev","--no-audit","--no-fund","--registry=https://registry.npmmirror.com") -NoNewWindow -Wait -PassThru -RedirectStandardOutput $npmLog -RedirectStandardError $npmErr
if ($proc.ExitCode -ne 0) {
  Info "npm install output (last 10 lines):"
  if (Test-Path $npmLog) { Get-Content $npmLog -Tail 10 }
  if (Test-Path $npmErr) { Write-Host "--- stderr ---"; Get-Content $npmErr -Tail 10 }
  Err "npm install failed (exit code $($proc.ExitCode))"
}
Ok "Dependencies installed"

# Build frontend
Section "Build frontend (30-60s)"
if (Test-Path 'dist/client/index.html') {
  Remove-Item 'dist/client' -Recurse -Force -ErrorAction SilentlyContinue
}
Info "Running npm run build:client ..."
$buildLog = "$env:TEMP\npm-build.log"
$buildErr = "$env:TEMP\npm-build.err"
$proc = Start-Process -FilePath "npm.cmd" -ArgumentList @("run","build:client") -NoNewWindow -Wait -PassThru -RedirectStandardOutput $buildLog -RedirectStandardError $buildErr
if ($proc.ExitCode -ne 0) {
  Info "build output (last 30 lines):"
  if (Test-Path $buildLog) { Get-Content $buildLog -Tail 30 }
  if (Test-Path $buildErr) { Write-Host "--- stderr ---"; Get-Content $buildErr -Tail 30 }
  Err "Frontend build failed (exit code $($proc.ExitCode))"
}
if (-not (Test-Path 'dist/client/index.html')) {
  Err "Frontend build failed: dist/client/index.html not found"
}
Ok "Frontend built"

# .env
Section "Configure .env"
if (-not (Test-Path '.env')) {
  if (Test-Path '.env.example') {
    Copy-Item '.env.example' '.env'
    Ok ".env copied from .env.example"
  } else {
    Warn ".env.example not found, creating minimal .env"
    Set-Content -Path '.env' -Value "NODE_ENV=production`nPORT=9099"
  }
} else {
  Ok ".env exists"
}

$ffmpegExe = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
if ($ffmpegExe) {
  if (-not (Select-String -Path '.env' -Pattern '^FFMPEG_PATH=' -Quiet)) {
    Add-Content -Path '.env' -Value "FFMPEG_PATH=$ffmpegExe"
    Ok "Added FFMPEG_PATH=$ffmpegExe"
  }
} else {
  Warn "ffmpeg not installed (skipping FFMPEG_PATH). Install later: https://www.gyan.dev/ffmpeg/builds/"
}

if (-not (Select-String -Path '.env' -Pattern '^VIDEO_UPLOAD_DIR=' -Quiet)) {
  Add-Content -Path '.env' -Value 'VIDEO_UPLOAD_DIR=C:\zhongli-uploads'
}
New-Item -ItemType Directory -Path 'C:\zhongli-uploads' -Force | Out-Null

# pm2 + start
Section "pm2 + start"
if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
  Info "Installing pm2 globally (this takes ~30s)..."
  npm install -g pm2 --registry=https://registry.npmmirror.com 2>&1 | Select-Object -Last 3
  if ($LASTEXITCODE -ne 0) { Err "pm2 install failed" }
}
Ok "pm2: $(pm2 -v)"

if (-not (Test-Path 'logs')) { New-Item -ItemType Directory -Path 'logs' | Out-Null }

pm2 delete ecosystem.config.cjs 2>$null | Out-Null
pm2 start ecosystem.config.cjs
pm2 save
Ok "pm2 started 2 processes"

# Firewall
Section "Firewall"
$ruleName1 = 'Zhongli Web (8080)'
$ruleName2 = 'Zhongli API (9099)'
if (-not (Get-NetFirewallRule -DisplayName $ruleName1 -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $ruleName1 -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8080 | Out-Null
  Ok "Firewall: opened 8080"
} else { Ok "Firewall: 8080 rule exists" }
if (-not (Get-NetFirewallRule -DisplayName $ruleName2 -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $ruleName2 -Direction Inbound -Action Allow -Protocol TCP -LocalPort 9099 | Out-Null
  Ok "Firewall: opened 9099"
} else { Ok "Firewall: 9099 rule exists" }

# Wait + health check
Info "Waiting 5s for services to start..."
Start-Sleep -Seconds 5

Section "Health check"
try {
  $health = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/api/health' -UseBasicParsing -TimeoutSec 5
  Ok "Frontend 8080: HTTP $($health.StatusCode)"
} catch {
  Warn "8080 health check failed: $($_.Exception.Message)"
}

try {
  $loginResp = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/api/auth/login' `
    -Method POST -ContentType 'application/json' `
    -Body '{"username":"admin","password":"admin123"}' `
    -UseBasicParsing -TimeoutSec 5
  $loginData = $loginResp.Content | ConvertFrom-Json
  if ($loginData.data.token) {
    Ok "Login OK: token=${($loginData.data.token).Substring(0,16)}..."
  }
} catch {
  Warn "API health check failed: $($_.Exception.Message)"
}

# Public IP
$pubIp = ''
try { $pubIp = (Invoke-WebRequest -Uri 'https://api.ipify.org' -UseBasicParsing -TimeoutSec 5).Content.Trim() } catch {}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host " DEPLOY SUCCESS!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Public URL:  http://${pubIp}:8080/" -ForegroundColor Cyan
Write-Host "  Username:    admin / admin123"
Write-Host "  Data path:   C:\zhongli-src\data\pglite\"
Write-Host ""
Write-Host "  Useful commands:" -ForegroundColor Yellow
Write-Host "    pm2 status                # process status"
Write-Host "    pm2 logs                  # realtime logs"
Write-Host "    pm2 restart all           # restart"
Write-Host "    pm2 stop all              # stop"
Write-Host "    notepad C:\zhongli-src\.env   # edit env vars"
Write-Host ""
Write-Host "  IMPORTANT: Tencent Cloud console -> Firewall -> allow TCP 8080 and 9099" -ForegroundColor Yellow
Write-Host ""
Write-Host "If Feishu/MiniMax/OSS keys are needed, edit .env then run 'pm2 restart all'" -ForegroundColor Yellow
Write-Host ""

Read-Host "Press Enter to close"