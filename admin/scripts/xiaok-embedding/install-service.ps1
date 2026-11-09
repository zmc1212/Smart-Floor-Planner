$ErrorActionPreference = 'Stop'
$root = 'D:\XiaoK-Embedding'
if (!(Test-Path "$root\api-key.txt")) {
    $bytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    [IO.File]::WriteAllText("$root\api-key.txt", [Convert]::ToBase64String($bytes))
}
# Credentials and snapshots are private to the deployment identity and SYSTEM.
icacls $root /inheritance:r /grant:r 'Administrator:(OI)(CI)F' 'SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'ACL configuration failed' }
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File $root\run-service.ps1" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'XiaoK-Embedding' -Action $action -Trigger $trigger -Settings $settings -User SYSTEM -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName 'XiaoK-Embedding'
Write-Output 'TASK_INSTALLED'
