# Default behavior only refreshes the current user's Startup shortcut.
# Use -Start only after the remote databases are verified and local source ports are free.
[CmdletBinding()]
param(
    [switch]$Start,
    [switch]$NoStart
)

$ErrorActionPreference = 'Stop'

if ($Start -and $NoStart) {
    throw 'Use either -Start or -NoStart, not both.'
}

$scriptPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'tunnel.ps1')).Path
$powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $scriptPath
$startupPath = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupPath 'SFP-Remote-Dev-Tunnel.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershellPath
$shortcut.Arguments = $arguments
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.WindowStyle = 7
$shortcut.Description = 'Smart Floor Planner remote database SSH tunnel'
$shortcut.Save()

if (-not $Start) {
    Write-Output 'SFP-Remote-Dev-Tunnel shortcut installed; tunnel not started.'
    exit 0
}

$existingMutex = $null
try {
    try {
        $existingMutex = [System.Threading.Mutex]::OpenExisting('Local\SFP-Remote-Dev-Tunnel')
    } catch [System.Threading.WaitHandleCannotBeOpenedException] {
        $existingMutex = $null
    }

    if ($existingMutex) {
        Write-Output 'SFP-Remote-Dev-Tunnel is already running; shortcut refreshed.'
        exit 0
    }

    Start-Process -FilePath $powershellPath -ArgumentList $arguments -WindowStyle Hidden
    Write-Output 'SFP-Remote-Dev-Tunnel shortcut installed and tunnel start requested.'
} finally {
    if ($existingMutex) {
        $existingMutex.Dispose()
    }
}
