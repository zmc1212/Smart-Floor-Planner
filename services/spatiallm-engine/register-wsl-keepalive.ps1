param(
    [string]$Distribution = "Ubuntu-24.04",
    [string]$LinuxUser = "spatiallm",
    [string]$TaskName = "SpatialLM WSL Keepalive"
)

$ErrorActionPreference = "Stop"

wsl.exe -d $Distribution -u $LinuxUser -- id -u | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "WSL distribution '$Distribution' or user '$LinuxUser' is unavailable."
}

$wslPath = Join-Path $env:SystemRoot "System32\wsl.exe"
$arguments = "-d $Distribution -u $LinuxUser -- sleep infinity"
$action = New-ScheduledTaskAction -Execute $wslPath -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Keeps $Distribution active so SpatialLM remains reachable on localhost:8002." `
    -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State, TaskPath
