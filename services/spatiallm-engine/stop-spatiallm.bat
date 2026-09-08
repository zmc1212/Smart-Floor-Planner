@echo off
setlocal
title SpatialLM Engine - Stop

echo Stopping SpatialLM Engine...
where wsl.exe >nul 2>&1
if errorlevel 1 (
  echo ERROR: WSL is not installed or is not available in PATH.
  goto :failed
)

wsl.exe -d Ubuntu-24.04 -u root -- systemctl stop spatiallm-engine.service
if errorlevel 1 (
  echo ERROR: Could not stop spatiallm-engine.service.
  goto :failed
)

powershell.exe -NoProfile -Command ^
  "$task = Get-ScheduledTask -TaskName 'SpatialLM WSL Keepalive' -ErrorAction SilentlyContinue; if ($null -ne $task -and $task.State -ne 'Disabled') { Stop-ScheduledTask -TaskName $task.TaskName -ErrorAction SilentlyContinue }"

wsl.exe --terminate Ubuntu-24.04 >nul
if errorlevel 1 (
  echo ERROR: The service stopped, but Ubuntu-24.04 could not be terminated.
  goto :failed
)

echo.
echo SpatialLM Engine has stopped. Its WSL memory and GPU memory were released.
goto :success

:failed
echo.
echo SpatialLM Engine could not be stopped cleanly.
if /i not "%~1"=="--no-pause" pause
exit /b 1

:success
if /i not "%~1"=="--no-pause" pause
exit /b 0
