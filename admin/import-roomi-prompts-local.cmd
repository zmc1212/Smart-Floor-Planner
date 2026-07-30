@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\import-roomi-prompts-local.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
  echo Import failed. Review the error above.
) else (
  echo Import completed successfully.
)
pause
exit /b %EXIT_CODE%
