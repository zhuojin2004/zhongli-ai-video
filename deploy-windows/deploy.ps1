# ============================================================================
# Zhongli Video Platform - Windows Server Deploy Script (ASCII only)
# ============================================================================
# Usage (Run as Administrator in PowerShell):
#   powershell -ExecutionPolicy Bypass -File deploy.ps1
#
# Auto: install Node.js / ffmpeg / pm2 / build frontend / start pm2
# Idempotent: safe to re-run
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Force UTF-8 output (helps if redirected)
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
  chcp 65001 | Out-Null
} catch {}

# Output helpers
function Info($m)    { Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m)      { Write-Host "[OK]   $m" -ForegroundColor Green }
function Warn($m)    { Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Err($m)     { Write-Host "[ERR]  $m" -ForegroundColor Red; exit 1 }
function Section($m) { Write-Host ""; Write-Host "========== $m ==========" -ForegroundColor Green }

# Admin check
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Err "Please run as Administrator"
}

# Paths
$AppDir    = 'C:\zhongli-src'
$Tarball   = "$env:USERPROFILE\zhongli-src.tar.gz"
$NodeUrl   = 'https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi'
$NodeMsi   = "$env:TEMP\node-20-x64.msi"
$FfmpegUrl = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
$FfmpegZip = "$env:TEMP\ffmpeg-release-essentials.zip"
$FfmpegDir = 'C:\ffmpeg'

# 0/8 Detect OS
Section "0/8 Environment"
$osInfo = Get-CimInstance Win32_OperatingSystem
Ok "OS: $($osInfo.Caption) $($osInfo.Version)"
Ok "PowerShell: $($PSVersionTable.PSVersion)"

# 1/8 Node.js
Section "1/8 Node.js"
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
  $nodeVer = node -v
  if ($nodeVer -match '^v(\d+)\.') {
    $major = [int]$Matches[1]
    if ($major -ge 18) {
      Ok "Node.js already installed: $nodeVer"
    } else {
      Warn "Node.js version too old ($nodeVer), will upgrade to 20.x"
      $needNode = $true
    }
  }
} else {
  Warn "Node.js not found, installing"
  $needNode = $true
}

if ($needNode) {
  Info "Downloading Node.js 20 LTS MSI..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $NodeUrl -OutFile $NodeMsi -UseBasicParsing
  Info "Silent installing Node.js (about 30s)..."
  Start-Process msiexec.exe -ArgumentList "/i `"$NodeMsi`" /qn ADDLOCAL=ALL" -Wait -NoNewWindow
  Remove-Item $NodeMsi -Force
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
  Ok "Node.js installed: $(node -v)"
}

# 2/8 ffmpeg
Section "2/8 ffmpeg"
$ffmpegCmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($ffmpegCmd) {
  Ok "ffmpeg already installed: $((ffmpeg -version 2>&1)[0])"
} else {
  Warn "ffmpeg not found, installing to C:\ffmpeg"
  if (-not (Test-Path $FfmpegDir)) {
    Info "Downloading ffmpeg (about 130MB, 1-3 minutes)..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $FfmpegUrl -OutFile $FfmpegZip -UseBasicParsing
    Info "Extracting to C:\ffmpeg ..."
    Expand-Archive -Path $FfmpegZip -DestinationPath "$env:TEMP\ffmpeg-extract" -Force
    $inner = Get-ChildItem "$env:TEMP\ffmpeg-extract" -Directory | Select-Object -First 1
    Move-Item $inner.FullName $FfmpegDir -Force
    Remove-Item $FfmpegZip -Force
    Remove-Item "$env:TEMP\ffmpeg-extract" -Recurse -Force
  }
  $binPath = Join-Path $FfmpegDir 'bin'
  $currentPath = [System.Environment]::GetEnvironmentVariable("Path","Machine")
  if ($currentPath -notlike "*$binPath*") {
    [System.Environment]::SetEnvironmentVariable("Path", "$currentPath;$binPath", "Machine")
    $env:Path += ";$binPath"
  }
  Ok "ffmpeg installed: $((ffmpeg -version 2>&1)[0])"
}

# 3/8 Extract project
Section "3/8 Extract project to $AppDir"
if (-not (Test-Path $Tarball)) {
  Err "Cannot find $Tarball. Please upload zhongli-src.tar.gz to user home directory first."
}

if (Test-Path $AppDir) {
  Warn "$AppDir already exists, skipping extraction (delete it first to re-extract)"
} else {
  Info "Extracting $Tarball to C:\ ..."
  New-Item -ItemType Directory -Path 'C:\' -Force | Out-Null
  & 'C:\Windows\System32\tar.exe' -xzf $Tarball -C 'C:\'
  if ($LASTEXITCODE -ne 0) { Err "Extraction failed" }
  if (-not (Test-Path $AppDir)) { Err "Extraction failed: $AppDir not found" }
  Ok "Extracted to $AppDir"
}

Set-Location $AppDir

# 4/8 npm install
Section "4/8 npm install (first run 60-120s)"
if (Test-Path 'node_modules') {
  Ok "node_modules exists, skipping"
} else {
  Info "Running npm install --omit=dev ..."
  npm install --omit=dev --no-audit --no-fund --registry=https://registry.npmmirror.com 2>&1 | Select-Object -Last 8
  if ($LASTEXITCODE -ne 0) { Err "npm install failed" }
  Ok "Dependencies installed"
}

# 5/8 Build frontend
Section "5/8 Build frontend npm run build:client (first run 30-60s)"
if (Test-Path 'dist/client/index.html') {
  Ok "dist/client exists, skipping"
} else {
  Info "Running vite build ..."
  npm run build:client 2>&1 | Select-Object -Last 8
  if ($LASTEXITCODE -ne 0) { Err "Frontend build failed" }
  Ok "Frontend built"
}

# 6/8 .env
Section "6/8 Configure .env"
if (-not (Test-Path '.env')) {
  if (Test-Path '.env.example') {
    Copy-Item '.env.example' '.env'
    Ok ".env copied from .env.example (please edit with notepad to add real keys)"
  } else {
    Warn ".env.example not found"
  }
} else {
  Ok ".env exists, skipping"
}

$ffmpegExe = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
if ($ffmpegExe) {
  Add-Content -Path '.env' -Value "FFMPEG_PATH=$ffmpegExe"
  Ok "FFMPEG_PATH=$ffmpegExe"
}
if (-not (Select-String -Path '.env' -Pattern '^VIDEO_UPLOAD_DIR=' -Quiet)) {
  Add-Content -Path '.env' -Value 'VIDEO_UPLOAD_DIR=C:\zhongli-uploads'
  New-Item -ItemType Directory -Path 'C:\zhongli-uploads' -Force | Out-Null
}

# 7/8 pm2 + start
Section "7/8 pm2 + start 2 processes"
if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
  Info "Installing pm2 globally ..."
  npm install -g pm2 --registry=https://registry.npmmirror.com 2>&1 | Select-Object -Last 3
}
Ok "pm2: $(pm2 -v)"

if (-not (Test-Path 'logs')) { New-Item -ItemType Directory -Path 'logs' | Out-Null }

pm2 delete ecosystem.config.cjs 2>$null | Out-Null
pm2 start ecosystem.config.cjs
pm2 save
Ok "pm2 started 2 processes"

Info "Configuring pm2 auto-start ..."
try {
  pm2-startup install 2>&1 | Select-Object -Last 3
  Ok "Auto-start configured"
} catch {
  Warn "pm2-startup install failed. You can run 'pm2-startup install' manually later."
}

# 8/8 Firewall + health check
Section "8/8 Windows Firewall + health check"

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

Start-Sleep -Seconds 3

Info "Local health check ..."
try {
  $health = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/api/health' -UseBasicParsing -TimeoutSec 5
  Ok "Frontend 8080: HTTP $($health.StatusCode)"
} catch {
  Warn "8080 health check failed (services may still be starting, retry later)"
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
Write-Host "    notepad C:\zhongli-src\.env   # edit env vars (then pm2 restart all)"
Write-Host ""
Write-Host "  IMPORTANT: Open Tencent Cloud console -> Firewall -> allow TCP 8080 and 9099" -ForegroundColor Yellow
Write-Host ""
Warn "If Feishu/MiniMax/OSS keys are needed, edit C:\zhongli-src\.env then pm2 restart all"
Write-Host ""