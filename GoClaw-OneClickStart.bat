@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "PS1=%SCRIPT_DIR%GoClaw-OneClickStart.ps1"

if not exist "%PS1%" (
  echo [GoClaw] Startup script not found: "%PS1%"
  exit /b 1
)

where powershell >nul 2>nul
if errorlevel 1 (
  echo [GoClaw] powershell.exe not found in PATH.
  exit /b 1
)

pushd "%SCRIPT_DIR%" >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Mode petclaw -NoTerminalWindows %*
set "EXITCODE=%ERRORLEVEL%"
popd >nul

if not "%EXITCODE%"=="0" (
  echo [GoClaw] Startup failed with exit code %EXITCODE%.
)

exit /b %EXITCODE%
