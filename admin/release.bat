@echo off
setlocal EnableExtensions

PowerShell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0release.ps1"
if errorlevel 1 (
  echo.
  echo [ERROR] Release build failed. Review the error above.
  pause
  exit /b 1
)

echo.
pause
