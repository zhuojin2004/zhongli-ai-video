@echo off
REM ============================================================================
REM 中力视频生产平台 - 一键部署入口（Windows）
REM ============================================================================
REM 右键 → "以管理员身份运行"
REM
REM 自动调用 PowerShell 执行 deploy-windows\deploy.ps1
REM ============================================================================

REM 强制 UTF-8 代码页，避免 PowerShell 中文输出乱码
chcp 65001 >nul

cd /d "%~dp0\.."

if not exist "deploy-windows\deploy.ps1" (
  echo [ERROR] 找不到 deploy-windows\deploy.ps1，请确认在项目根目录运行
  pause
  exit /b 1
)

echo ============================================================
echo  中力视频生产平台 - Windows 一键部署
echo ============================================================
echo.
echo 提示：此脚本会安装 Node.js / ffmpeg / pm2，
echo       并把项目部署到 C:\zhongli-src
echo.
echo 按任意键继续（Ctrl+C 取消）...
pause > nul

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-windows\deploy.ps1"

if %ERRORLEVEL% NEQ 0 (
  echo.
  echo [ERROR] 部署失败，请把上面红色错误信息截图发给我
  pause
)

pause