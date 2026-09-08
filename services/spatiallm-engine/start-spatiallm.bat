@echo off
setlocal
title SpatialLM Engine - Start
cd /d "%~dp0"

echo Starting SpatialLM Engine...
where wsl.exe >nul 2>&1
if errorlevel 1 (
  echo ERROR: WSL is not installed or is not available in PATH.
  goto :failed
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0register-wsl-keepalive.ps1" >nul
if errorlevel 1 (
  echo ERROR: Could not start the Ubuntu-24.04 keepalive task.
  goto :failed
)

wsl.exe -d Ubuntu-24.04 -u root -- systemctl start spatiallm-engine.service
if errorlevel 1 (
  echo ERROR: Could not start spatiallm-engine.service.
  goto :failed
)

echo Loading the model on the RTX 4080. This normally takes 10-20 seconds...
powershell.exe -NoProfile -Command ^
  "$deadline = (Get-Date).AddSeconds(90); do { try { $health = Invoke-RestMethod -Uri 'http://localhost:8002/healthz' -TimeoutSec 2; if ($health.status -eq 'ok' -and $health.mode -eq 'real' -and $health.device -eq 'cuda') { exit 0 } } catch {}; Start-Sleep -Seconds 1 } while ((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 (
  echo ERROR: The service did not become healthy within 90 seconds.
  echo Check logs with: wsl -d Ubuntu-24.04 -u root -- journalctl -u spatiallm-engine.service -n 100
  goto :failed
)

echo.
echo SpatialLM Engine is ready: http://localhost:8002
echo API documentation:          http://localhost:8002/docs
goto :success

:failed
echo.
echo SpatialLM Engine was not started.
if /i not "%~1"=="--no-pause" pause
exit /b 1

:success
if /i not "%~1"=="--no-pause" pause
exit /b 0
