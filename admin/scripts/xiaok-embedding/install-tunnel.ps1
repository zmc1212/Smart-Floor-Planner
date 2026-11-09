$ErrorActionPreference = 'Stop'
$script = (Resolve-Path "$PSScriptRoot/tunnel.ps1").Path
$arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$startup = [Environment]::GetFolderPath('Startup')
$link = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $startup 'XiaoK-Embedding-Tunnel.lnk'))
$link.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$link.Arguments = $arguments
$link.WindowStyle = 7
$link.Save()
if (!(Get-NetTCPConnection -LocalPort 18089 -State Listen -ErrorAction SilentlyContinue)) {
    Start-Process powershell.exe -ArgumentList $arguments -WindowStyle Hidden
}
Write-Output 'TUNNEL_USER_LOGON_INSTALLED'
