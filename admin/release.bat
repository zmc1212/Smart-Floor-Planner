@echo off
setlocal EnableExtensions

rem Let Windows PowerShell use its own modules when launched from PowerShell 7.
set "PSModulePath="
PowerShell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0release.ps1" %*
if errorlevel 1 (
  echo.
  echo [ERROR] Release build failed. Review the error above.
  pause
  exit /b 1
)

echo.
pause
