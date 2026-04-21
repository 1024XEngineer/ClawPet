@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "PS1=%SCRIPT_DIR%GoClaw-OneClickStart.ps1"

if not exist "%PS1%" exit /b 1

start "" powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%PS1%" -Mode petclaw -NoTerminalWindows
exit /b 0
